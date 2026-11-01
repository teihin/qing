package directchat

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ImageInfo 是服务端重新识别出的图片元数据，客户端自报的尺寸一律不采信。
type ImageInfo struct {
	MimeType string
	Width    int
	Height   int
}

// SniffImage 按文件头识别图片类型并解析尺寸，拒绝 SVG/HTML 等可执行内联内容。
func SniffImage(data []byte) (ImageInfo, error) {
	if len(data) < 32 {
		return ImageInfo{}, errors.New("图片内容为空")
	}
	switch {
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return ImageInfo{}, err
		}
		return ImageInfo{MimeType: "image/jpeg", Width: cfg.Width, Height: cfg.Height}, nil
	case bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		cfg, err := pngConfig(data)
		if err != nil {
			return ImageInfo{}, err
		}
		return ImageInfo{MimeType: "image/png", Width: cfg.Width, Height: cfg.Height}, nil
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		w, h, err := webpSize(data)
		if err != nil {
			return ImageInfo{}, err
		}
		return ImageInfo{MimeType: "image/webp", Width: w, Height: h}, nil
	}
	return ImageInfo{}, errors.New("只支持 JPEG、PNG、WebP 图片")
}

func pngConfig(data []byte) (image.Config, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	return cfg, err
}

// webpSize 解析 WebP 三种容器头的基本尺寸。
func webpSize(data []byte) (int, int, error) {
	if len(data) < 30 {
		return 0, 0, errors.New("WebP 数据不完整")
	}
	switch string(data[12:16]) {
	case "VP8 ":
		return int(binary.LittleEndian.Uint16(data[26:28]) & 0x3FFF), int(binary.LittleEndian.Uint16(data[28:30]) & 0x3FFF), nil
	case "VP8L":
		b := data[21:25]
		w := 1 + (int(b[0])|int(b[1])<<8)&0x3FFF
		h := 1 + ((int(b[1])>>6)|int(b[2])<<2|int(b[3])<<10)&0x3FFF
		return w, h, nil
	case "VP8X":
		w := 1 + int(data[24]) + int(data[25])<<8 + int(data[26])<<16
		h := 1 + int(data[27]) + int(data[28])<<8 + int(data[29])<<16
		return w, h, nil
	}
	return 0, 0, errors.New("WebP 头无法识别")
}

// MediaStorage 管理图片原图与缩略图的落盘、读取和临时下载地址。
type MediaStorage struct {
	root    string
	signKey []byte
	baseURL string
	maxSide int
}

// NewMediaStorage 创建图片存储；root 是未对外暴露的本地目录。
func NewMediaStorage(root string, signKey []byte, baseURL string) *MediaStorage {
	return &MediaStorage{root: root, signKey: signKey, baseURL: strings.TrimRight(baseURL, "/"), maxSide: MaxImageSide}
}

// Save 校验并保存图片，返回 storage_key、缩略图 key 与服务端识别出的元数据。
func (m *MediaStorage) Save(attachmentID string, data []byte) (string, string, ImageInfo, error) {
	if len(data) > MaxImageBytes {
		return "", "", ImageInfo{}, errMediaTooLarge
	}
	info, err := SniffImage(data)
	if err != nil {
		return "", "", ImageInfo{}, invalidMedia(err.Error())
	}
	if info.Width <= 0 || info.Height <= 0 || info.Width > m.maxSide || info.Height > m.maxSide {
		return "", "", ImageInfo{}, invalidMedia("图片尺寸超出限制")
	}
	ext := ".bin"
	switch info.MimeType {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	}
	rel := filepath.Join("direct", time.Now().Format("2006"), time.Now().Format("01"), attachmentID+ext)
	full := filepath.Join(m.root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
		return "", "", ImageInfo{}, err
	}
	if err := os.WriteFile(full, data, 0o600); err != nil {
		return "", "", ImageInfo{}, err
	}
	thumbRel := ""
	if info.MimeType != "image/webp" {
		if thumb, err := makeThumbnail(data, 480); err == nil {
			thumbRel = filepath.Join("direct", time.Now().Format("2006"), time.Now().Format("01"), attachmentID+"_t.jpg")
			thumbFull := filepath.Join(m.root, thumbRel)
			if err := os.WriteFile(thumbFull, thumb, 0o600); err == nil {
				thumbRel = filepath.ToSlash(thumbRel)
			} else {
				thumbRel = ""
			}
		}
	}
	return filepath.ToSlash(rel), thumbRel, info, nil
}

// Open 打开已保存的图片（原图或缩略图）。
func (m *MediaStorage) Open(key string) (io.ReadSeekCloser, string, error) {
	clean := filepath.Clean(strings.TrimPrefix(key, "/"))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return nil, "", errors.New("非法的存储路径")
	}
	full := filepath.Join(m.root, clean)
	file, err := os.Open(full)
	if err != nil {
		return nil, "", err
	}
	contentType := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(full)) {
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".png":
		contentType = "image/png"
	case ".webp":
		contentType = "image/webp"
	}
	return file, contentType, nil
}

// Remove 删除原图与缩略图，供过期清理与孤儿回收使用。
func (m *MediaStorage) Remove(keys ...string) {
	for _, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		clean := filepath.Clean(strings.TrimPrefix(key, "/"))
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			continue
		}
		_ = os.Remove(filepath.Join(m.root, clean))
	}
}

// MediaURL 生成带签名的临时下载地址；数据库 storage_key 不暴露给客户端。
func (m *MediaStorage) MediaURL(attachmentID, guuid, variant string, ttl time.Duration) string {
	if attachmentID == "" {
		return ""
	}
	expiry := time.Now().Add(ttl).Unix()
	payload := attachmentID + "|" + guuid + "|" + variant + "|" + strconv.FormatInt(expiry, 10)
	mac := hmac.New(sha256.New, m.signKey)
	mac.Write([]byte(payload))
	ticket := base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + hex.EncodeToString(mac.Sum(nil))[:32]))
	// 变体（原图/缩略图）已经签进票据，不再作为可篡改的查询参数出现。
	return m.baseURL + "/api/direct/media/" + attachmentID + "?ticket=" + ticket
}

// ValidateMediaTicket 校验临时下载地址里的签名，返回票据绑定的变体（空或 thumb）。
func (m *MediaStorage) ValidateMediaTicket(attachmentID, ticket string) (string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(ticket))
	if err != nil {
		return "", false
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 5 || parts[0] != attachmentID {
		return "", false
	}
	expiry, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil || time.Now().Unix() > expiry {
		return "", false
	}
	payload := parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3]
	mac := hmac.New(sha256.New, m.signKey)
	mac.Write([]byte(payload))
	if !hmac.Equal([]byte(parts[4]), []byte(hex.EncodeToString(mac.Sum(nil))[:32])) {
		return "", false
	}
	return parts[2], true
}

// makeThumbnail 生成等比缩略图（JPEG）。原图本身小于目标宽度时直接沿用原图编码。
func makeThumbnail(data []byte, maxWidth int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("图片尺寸无效")
	}
	if w <= maxWidth {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 82}); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	ratio := float64(maxWidth) / float64(w)
	targetW := maxWidth
	targetH := int(float64(h) * ratio)
	if targetH < 1 {
		targetH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	for y := 0; y < targetH; y++ {
		sy := bounds.Min.Y + y*h/targetH
		for x := 0; x < targetW; x++ {
			sx := bounds.Min.X + x*w/targetW
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 80}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// AudioVoiceProvider 校验 AudioServer 已生成的 voiceId（复用现有录音链路，
// 不另建一套编码服务）。
type AudioVoiceProvider struct {
	baseURL  string
	client   *http.Client
	maxBytes int64
	minMS    int
	maxMS    int
}

// NewAudioVoiceProvider 创建语音校验器。baseURL 为空表示未配置，语音功能将不可用。
func NewAudioVoiceProvider(baseURL string, minMS, maxMS int) *AudioVoiceProvider {
	return &AudioVoiceProvider{
		baseURL:  strings.TrimRight(baseURL, "/"),
		client:   &http.Client{Timeout: 8 * time.Second},
		maxBytes: 4 << 20,
		minMS:    minMS,
		maxMS:    maxMS,
	}
}

// Enabled 表示是否配置了 AudioServer 地址。
func (p *AudioVoiceProvider) Enabled() bool { return p.baseURL != "" }

// FileURL 返回语音文件的下载地址（客户端仍通过 QingVoiceBridge 播放）。
func (p *AudioVoiceProvider) FileURL(voiceID string) string {
	if p.baseURL == "" || voiceID == "" {
		return ""
	}
	return p.baseURL + "/v1/files/" + voiceID
}

// VerifyVoice 校验 voiceId 格式、存在性、实际文件大小与时长。
func (p *AudioVoiceProvider) VerifyVoice(ctx context.Context, voiceID string) (int, int64, error) {
	if !p.Enabled() {
		return 0, 0, invalidMedia("语音服务未配置")
	}
	if !isVoiceID(voiceID) {
		return 0, 0, invalidMedia("语音编号不合法")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.FileURL(voiceID), nil)
	if err != nil {
		return 0, 0, invalidMedia("语音编号不合法")
	}
	response, err := p.client.Do(request)
	if err != nil {
		return 0, 0, invalidMedia("语音文件不可用")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0, 0, invalidMedia("语音文件不存在或已过期")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, p.maxBytes+1))
	if err != nil {
		return 0, 0, invalidMedia("语音文件读取失败")
	}
	if int64(len(data)) > p.maxBytes {
		return 0, 0, errMediaTooLarge
	}
	durationMS, ok := parseM4ADuration(data)
	if !ok {
		return 0, 0, invalidMedia("语音文件格式不正确")
	}
	if durationMS < p.minMS {
		return 0, 0, invalidMedia("语音太短")
	}
	if durationMS > p.maxMS {
		return 0, 0, invalidMedia("语音超出时长上限")
	}
	return durationMS, int64(len(data)), nil
}

// ProxiedFile 把语音文件转发给客户端（仅在直连 AudioServer 不可达时使用）。
func (p *AudioVoiceProvider) ProxiedFile(ctx context.Context, voiceID string) (io.ReadCloser, int64, error) {
	if !p.Enabled() {
		return nil, 0, invalidMedia("语音服务未配置")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.FileURL(voiceID), nil)
	if err != nil {
		return nil, 0, invalidMedia("语音编号不合法")
	}
	response, err := p.client.Do(request)
	if err != nil {
		return nil, 0, invalidMedia("语音文件不可用")
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, 0, invalidMedia("语音文件不存在或已过期")
	}
	return response.Body, response.ContentLength, nil
}

func isVoiceID(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// parseM4ADuration 解析 MP4/M4A 的 mvhd 盒子，得到毫秒时长。
func parseM4ADuration(data []byte) (int, bool) {
	index := bytes.Index(data, []byte("mvhd"))
	if index < 0 || len(data) < index+4+20 {
		return 0, false
	}
	body := data[index+4:]
	version := body[0]
	if version == 0 {
		if len(body) < 20 {
			return 0, false
		}
		timescale := binary.BigEndian.Uint32(body[12:16])
		duration := binary.BigEndian.Uint32(body[16:20])
		if timescale == 0 {
			return 0, false
		}
		return int(uint64(duration) * 1000 / uint64(timescale)), true
	}
	if len(body) < 32 {
		return 0, false
	}
	timescale := binary.BigEndian.Uint32(body[20:24])
	duration := binary.BigEndian.Uint64(body[24:32])
	if timescale == 0 {
		return 0, false
	}
	return int(duration * 1000 / uint64(timescale)), true
}
