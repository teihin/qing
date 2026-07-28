package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"qing-audio-server/internal/audio"
	"qing-audio-server/internal/auth"
	"qing-audio-server/internal/config"
	"qing-audio-server/internal/metrics"
	"qing-audio-server/internal/model"
	"qing-audio-server/internal/service"
	"qing-audio-server/internal/store"
)

type integrationFixture struct {
	server   *httptest.Server
	tokens   *auth.Manager
	voices   *service.VoiceService
	metadata *store.FileMetadataStore
	root     string
}

func newIntegrationFixture(t *testing.T, tlsEnabled bool) integrationFixture {
	t.Helper()
	cfg := config.Default()
	cfg.Auth.HMACSecret = strings.Repeat("integration-secret-", 2)
	cfg.Storage.RootDirectory = t.TempDir()
	cfg.Server.AllowedOrigins = []string{"*"}
	cfg.Audio.FFmpegPath = "ffmpeg"

	tokenManager, err := auth.NewManager(
		cfg.Auth.HMACSecret,
		time.Duration(cfg.Auth.MaxTokenLifetimeSecs)*time.Second,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	files, err := store.NewFileStorage(cfg.Storage.RootDirectory)
	if err != nil {
		t.Fatal(err)
	}
	metadataStore, err := store.NewFileMetadataStore(filepath.Join(cfg.Storage.RootDirectory, "metadata"))
	if err != nil {
		t.Fatal(err)
	}
	encoderFactory := audio.NewFFmpegFactory("ffmpeg", 16000, 1, "24k")
	if err := encoderFactory.Check(); err != nil {
		t.Skipf("ffmpeg is not installed: %v", err)
	}
	serviceMetrics := &metrics.Metrics{}
	voiceService, err := service.NewVoiceService(service.Config{
		SampleRate:          16000,
		Channels:            1,
		MinDurationMS:       300,
		MaxDurationMS:       10000,
		MaxFrameBytes:       32768,
		Retention:           time.Hour,
		MaxActiveRecordings: 4,
		IDSecret:            cfg.Auth.HMACSecret,
	}, encoderFactory, files, metadataStore, serviceMetrics)
	if err != nil {
		t.Fatal(err)
	}
	apiServer := NewServer(cfg, tokenManager, voiceService, serviceMetrics, log.New(io.Discard, "", 0))
	var server *httptest.Server
	if tlsEnabled {
		server = httptest.NewTLSServer(apiServer.Handler())
	} else {
		server = httptest.NewServer(apiServer.Handler())
	}
	t.Cleanup(server.Close)
	return integrationFixture{
		server:   server,
		tokens:   tokenManager,
		voices:   voiceService,
		metadata: metadataStore,
		root:     cfg.Storage.RootDirectory,
	}
}

func (f integrationFixture) token(t *testing.T, userID, roomID string) string {
	t.Helper()
	token, _, err := f.tokens.Issue(userID, roomID, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestHTTPUploadIdempotencyAndRoomDownload(t *testing.T) {
	fixture := newIntegrationFixture(t, false)
	token := fixture.token(t, "user-1", "room-1")
	pcm := sinePCM(500*time.Millisecond, 440)

	first := uploadPCM(t, fixture.server.Client(), fixture.server.URL, token, "request_http_0001", pcm)
	second := uploadPCM(t, fixture.server.Client(), fixture.server.URL, token, "request_http_0001", pcm)
	if first.VoiceID != second.VoiceID {
		t.Fatalf("idempotent upload returned different IDs: %s != %s", first.VoiceID, second.VoiceID)
	}

	request, _ := http.NewRequest(http.MethodGet, fixture.server.URL+"/v1/files/"+first.VoiceID, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := fixture.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("download status = %d body=%s", response.StatusCode, body)
	}
	if response.Header.Get("Content-Type") != "audio/mp4" || len(body) < 100 {
		t.Fatalf("unexpected downloaded audio: type=%q size=%d", response.Header.Get("Content-Type"), len(body))
	}

	otherRoomToken := fixture.token(t, "user-2", "room-2")
	request, _ = http.NewRequest(http.MethodGet, fixture.server.URL+"/v1/files/"+first.VoiceID, nil)
	request.Header.Set("Authorization", "Bearer "+otherRoomToken)
	response, err = fixture.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-room download status = %d, want 403", response.StatusCode)
	}

	matches, err := filepath.Glob(filepath.Join(fixture.root, "voices", "*", "*", "*", "*", "*", "*.m4a"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("stored voice files = %#v error=%v", matches, err)
	}
}

func TestWebSocketStreamingUpload(t *testing.T) {
	fixture := newIntegrationFixture(t, false)
	token := fixture.token(t, "user-ws", "room-ws")

	serverURL, _ := url.Parse(fixture.server.URL)
	serverURL.Scheme = "ws"
	serverURL.Path = "/v1/stream"
	connection, _, err := websocket.DefaultDialer.Dial(serverURL.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()

	writeJSONMessage(t, connection, clientControl{Type: "auth", Token: token})
	authResponse := readServerControl(t, connection)
	if authResponse.Type != "authenticated" {
		t.Fatalf("auth response = %#v", authResponse)
	}
	writeJSONMessage(t, connection, clientControl{Type: "start", RequestID: "request_ws_000001"})
	startResponse := readServerControl(t, connection)
	if startResponse.Type != "started" {
		t.Fatalf("start response = %#v", startResponse)
	}

	pcm := sinePCM(500*time.Millisecond, 660)
	const payloadSize = 640
	var sequence uint32
	for offset := 0; offset < len(pcm); offset += payloadSize {
		end := min(offset+payloadSize, len(pcm))
		frame := make([]byte, audioHeaderBytes+end-offset)
		frame[0] = protocolVersion
		frame[1] = audioFrameType
		binary.BigEndian.PutUint32(frame[2:6], sequence)
		binary.BigEndian.PutUint64(frame[6:14], uint64(offset*1000/(16000*2)))
		copy(frame[audioHeaderBytes:], pcm[offset:end])
		if err := connection.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			t.Fatal(err)
		}
		sequence++
	}
	writeJSONMessage(t, connection, clientControl{Type: "finish"})
	ready := readServerControl(t, connection)
	if ready.Type != "ready" || ready.Voice == nil || ready.Voice.DurationMS < 490 {
		t.Fatalf("ready response = %#v", ready)
	}
}

func TestShortUploadIsRejectedAndTemporaryFileIsRemoved(t *testing.T) {
	fixture := newIntegrationFixture(t, false)
	token := fixture.token(t, "user-short", "room-short")
	pcm := sinePCM(100*time.Millisecond, 440)

	request, _ := http.NewRequest(http.MethodPost, fixture.server.URL+"/v1/voices", bytes.NewReader(pcm))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("X-Request-ID", "request_short_0001")
	response, err := fixture.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("short upload status = %d body=%s", response.StatusCode, body)
	}
	tempFiles, err := filepath.Glob(filepath.Join(fixture.root, "tmp", "*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(tempFiles) != 0 {
		t.Fatalf("short upload left temporary files: %#v", tempFiles)
	}
}

func TestCleanupDeletesExpiredVoiceAndMetadata(t *testing.T) {
	fixture := newIntegrationFixture(t, false)
	token := fixture.token(t, "user-cleanup", "room-cleanup")
	voice := uploadPCM(
		t,
		fixture.server.Client(),
		fixture.server.URL,
		token,
		"request_cleanup_0001",
		sinePCM(400*time.Millisecond, 440),
	)
	metadata, err := fixture.metadata.Get(voice.VoiceID)
	if err != nil {
		t.Fatal(err)
	}
	metadata.ExpiresAt = time.Now().UTC().Add(-time.Minute)
	if err := fixture.metadata.Put(metadata); err != nil {
		t.Fatal(err)
	}
	deletedVoices, _, err := fixture.voices.Cleanup(time.Now().UTC(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if deletedVoices != 1 {
		t.Fatalf("deleted voices = %d, want 1", deletedVoices)
	}
	if _, err := fixture.metadata.Get(voice.VoiceID); !errors.Is(err, store.ErrMetadataNotFound) {
		t.Fatalf("metadata still exists after cleanup: %v", err)
	}
}

func TestHandlerWorksThroughTLS(t *testing.T) {
	fixture := newIntegrationFixture(t, true)
	response, err := fixture.server.Client().Get(fixture.server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("TLS health status = %d", response.StatusCode)
	}
}

func uploadPCM(t *testing.T, client *http.Client, baseURL, token, requestID string, pcm []byte) model.PublicVoice {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/v1/voices", bytes.NewReader(pcm))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("X-Request-ID", requestID)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d body=%s", response.StatusCode, body)
	}
	var envelope struct {
		OK   bool              `json:"ok"`
		Data model.PublicVoice `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.OK || envelope.Data.VoiceID == "" {
		t.Fatalf("unexpected upload response: %s", body)
	}
	return envelope.Data
}

func sinePCM(duration time.Duration, frequency float64) []byte {
	sampleCount := int(float64(16000) * duration.Seconds())
	result := make([]byte, sampleCount*2)
	for index := 0; index < sampleCount; index++ {
		value := int16(math.Sin(2*math.Pi*frequency*float64(index)/16000) * 10000)
		binary.LittleEndian.PutUint16(result[index*2:index*2+2], uint16(value))
	}
	return result
}

func writeJSONMessage(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	if err := connection.WriteJSON(value); err != nil {
		t.Fatal(err)
	}
}

func readServerControl(t *testing.T, connection *websocket.Conn) serverControl {
	t.Helper()
	_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	var response serverControl
	if err := connection.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestMain(m *testing.M) {
	if _, err := os.Stat("/opt/homebrew/bin/ffmpeg"); err == nil {
		_ = os.Setenv("PATH", "/opt/homebrew/bin:"+os.Getenv("PATH"))
	}
	os.Exit(m.Run())
}

func Example_audioFrame() {
	frame := make([]byte, audioHeaderBytes+640)
	frame[0] = protocolVersion
	frame[1] = audioFrameType
	binary.BigEndian.PutUint32(frame[2:6], 0)
	binary.BigEndian.PutUint64(frame[6:14], 0)
	fmt.Println(len(frame))
	// Output: 654
}
