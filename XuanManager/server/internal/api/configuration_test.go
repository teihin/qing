package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

type fakeGameHTTPClient func(*http.Request) (*http.Response, error)

func (client fakeGameHTTPClient) Do(request *http.Request) (*http.Response, error) {
	return client(request)
}

func TestClientBase64MatchesCocosEncoding(t *testing.T) {
	tests := map[string]string{
		"系统公告 A+B, 100%!": "JUU3JUIzJUJCJUU3JUJCJTlGJUU1JTg1JUFDJUU1JTkxJThBJTIwQSUyQkIlMkMlMjAxMDAlMjUh",
		"第一行\n第二行":        "JUU3JUFDJUFDJUU0JUI4JTgwJUU4JUExJThDJTBBJUU3JUFDJUFDJUU0JUJBJThDJUU4JUExJThD",
		"!*'()~":          "ISonKCl+",
	}
	for input, expected := range tests {
		encoded := encodeClientBase64(input)
		if encoded != expected {
			t.Fatalf("encodeClientBase64(%q) = %q, want %q", input, encoded, expected)
		}
		decoded, err := decodeClientBase64(encoded)
		if err != nil || decoded != input {
			t.Fatalf("decodeClientBase64(%q) = %q, %v", encoded, decoded, err)
		}
	}
}

func TestNormalizeNotificationContent(t *testing.T) {
	got := normalizeNotificationContent("  系统维护,\n请稍后登录  ")
	if got != "系统维护， 请稍后登录" {
		t.Fatalf("normalized notification = %q", got)
	}
}

func TestValidateConfigurationText(t *testing.T) {
	if err := validateConfigurationText("第一行\n第二行", 0, 20, true, "公告内容"); err != nil {
		t.Fatalf("multiline announcement should be valid: %v", err)
	}
	if err := validateConfigurationText("通知\n内容", 1, 20, false, "通知内容"); err == nil {
		t.Fatal("notification control character should be rejected before normalization")
	}
	if err := validateConfigurationText("", 1, 20, false, "通知内容"); err == nil {
		t.Fatal("empty notification should be rejected")
	}
}

func TestNormalizeAnnouncementContentPreservesFormatting(t *testing.T) {
	input := "\r\n  居中前导空格  \r\n\r\n正文保留尾部空格  \r\n"
	want := "\n  居中前导空格  \n\n正文保留尾部空格  \n"
	got := normalizeAnnouncementContent(input)
	if got != want {
		t.Fatalf("normalized announcement = %q, want %q", got, want)
	}
	encoded := encodeClientBase64(got)
	decoded, err := decodeClientBase64(encoded)
	if err != nil || decoded != want {
		t.Fatalf("announcement formatting round trip = %q, %v", decoded, err)
	}
	if got := normalizeAnnouncementContent(" \r\n\t "); got != "" {
		t.Fatalf("whitespace-only announcement = %q", got)
	}
}

func TestCallGameCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/hall/command" || r.URL.Query().Get("header") != "通知_所有玩家_信息" {
			t.Fatalf("unexpected request: %s %s", r.URL.Path, r.URL.RawQuery)
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode param: %v", err)
		}
		if params["system_content"] != ",,,,测试通知" || params["context"] != "test-context" {
			t.Fatalf("unexpected params: %#v", params)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"ret_code":512,"ret_result":{}}`)),
		}, nil
	})

	s := &Server{
		cfg:            config.Config{GameAdminURL: "http://127.0.0.1:8890"},
		gameHTTPClient: client,
	}
	response, err := s.callGameCommand(context.Background(), "通知_所有玩家_信息", map[string]any{
		"system_content": ",,,,测试通知",
		"context":        "test-context",
	})
	if err != nil {
		t.Fatalf("callGameCommand: %v", err)
	}
	if response.RetCode != 512 {
		t.Fatalf("ret code = %d", response.RetCode)
	}
}

func TestNotificationCarouselContentAndOrder(t *testing.T) {
	input := updateNotificationCarouselRequest{}
	input.Items = append(input.Items, struct {
		Content string `json:"content"`
	}{Content: "  第一条, 公告  "}, struct {
		Content string `json:"content"`
	}{Content: "第二条公告"})
	items, err := normalizeNotificationCarouselItems(input.Items)
	if err != nil {
		t.Fatalf("normalize carousel items: %v", err)
	}
	if got := items[0].Content; got != "第一条， 公告" {
		t.Fatalf("normalized first item = %q", got)
	}
	if got := notificationSystemContent(items[0].Content); got != ",,,,第一条， 公告" {
		t.Fatalf("system content = %q", got)
	}
	if strings.Contains(notificationSystemContent(items[0].Content), "系统广播") || strings.Contains(notificationSystemContent(items[0].Content), "####") {
		t.Fatal("carousel content must not add a system prefix or special-colour marker")
	}
	next := nextNotificationCarouselItem(items, sql.NullInt64{Int64: items[0].ID, Valid: true})
	if next.Content != items[1].Content {
		t.Fatalf("next item = %q", next.Content)
	}
}

func TestFetchRewardPoolsUsesVerifiedKeys(t *testing.T) {
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("header") != "异步_获取_奖池_数据" {
			t.Fatalf("unexpected header: %s", r.URL.Query().Get("header"))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(`{"ret_code":512,"ret_result":{
"底皮0.1/0.3":1,"底皮0.2/0.5":"2","底皮1/3":3,"底皮2/5":4,"底皮5/10":5,
"底皮10/20":6,"底皮20/40":7,"底皮50/100":8,"底皮100/200":9,"未来皮池":10}}`)),
		}, nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	snapshot, err := s.fetchRewardPools(context.Background(), "test-context")
	if err != nil {
		t.Fatalf("fetchRewardPools: %v", err)
	}
	if snapshot.Values["底皮0.2/0.5"] != 2 || len(snapshot.UnexpectedKeys) != 1 || snapshot.UnexpectedKeys[0] != "未来皮池" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	state := rewardPoolStateFromSnapshot(snapshot)
	if state.Total != 45 || len(state.Items) != 9 {
		t.Fatalf("unexpected state: %#v", state)
	}
}

func TestValidateRewardPoolValues(t *testing.T) {
	values := make(map[string]int64, len(rewardPoolDefinitions))
	for _, definition := range rewardPoolDefinitions {
		values[definition.Key] = 100
	}
	if err := validateRewardPoolValues(values); err != nil {
		t.Fatalf("valid reward pools rejected: %v", err)
	}
	values[rewardPoolDefinitions[0].Key] = -1
	if err := validateRewardPoolValues(values); err == nil {
		t.Fatal("negative reward pool should be rejected")
	}
	delete(values, rewardPoolDefinitions[0].Key)
	if err := validateRewardPoolValues(values); err == nil {
		t.Fatal("missing reward pool should be rejected")
	}
}

func TestRestoreRewardPoolsSendsAllValuesAndVerifies(t *testing.T) {
	values := make(map[string]int64, len(rewardPoolDefinitions))
	for index, definition := range rewardPoolDefinitions {
		values[definition.Key] = int64(index * 10)
	}
	calls := 0
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		calls++
		header := r.URL.Query().Get("header")
		if calls == 1 {
			if header != "异步_设置_奖池_数据" {
				t.Fatalf("unexpected restore header: %s", header)
			}
			var params struct {
				Rewards map[string]int64 `json:"rewards"`
			}
			if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
				t.Fatalf("decode restore params: %v", err)
			}
			if !rewardPoolValuesEqual(params.Rewards, values) {
				t.Fatalf("restore values mismatch: %#v", params.Rewards)
			}
			return gameHTTPResponse(`{"ret_code":512,"ret_result":{}}`), nil
		}
		if header != "异步_获取_奖池_数据" {
			t.Fatalf("unexpected verify header: %s", header)
		}
		body, err := json.Marshal(map[string]any{"ret_code": 512, "ret_result": values})
		if err != nil {
			t.Fatalf("encode verify response: %v", err)
		}
		return gameHTTPResponse(string(body)), nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := s.restoreRewardPools(context.Background(), values, "restore-test"); err != nil {
		t.Fatalf("restoreRewardPools: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func gameHTTPResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
