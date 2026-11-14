package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func newPrettyTestServer(t *testing.T, handler http.HandlerFunc) *Server {
	t.Helper()
	game := httptest.NewServer(handler)
	t.Cleanup(game.Close)
	return &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
}

func TestNormalizePrettyValues(t *testing.T) {
	if got, err := normalizePrettyKind(" UID "); err != nil || got != prettyKindUID {
		t.Fatalf("kind = %q, %v", got, err)
	}
	if _, err := normalizePrettyKind("phone"); err == nil {
		t.Fatal("非法 kind 应被拒绝")
	}
	for _, value := range []string{"88888", "8888888", "88a888", ""} {
		if _, err := normalizePrettyNo(value); err == nil {
			t.Fatalf("靓号 %q 应被拒绝", value)
		}
	}
	if got, err := normalizePrettyNo(" 888888 "); err != nil || got != "888888" {
		t.Fatalf("靓号 = %q, %v", got, err)
	}
	if _, err := normalizePrettyClubID(""); err == nil {
		t.Fatal("邀请码绑定缺少俱乐部应被拒绝")
	}
	if _, err := normalizePrettyRemark("备注\n换行"); err == nil {
		t.Fatal("备注不应允许换行")
	}
}

func TestPrettyCandidatePattern(t *testing.T) {
	cases := map[string]string{
		"prefix:888":   "888%",
		"suffix:888":   "%888",
		"contains:888": "%888%",
		":888":         "888%",
	}
	for input, want := range cases {
		parts := strings.SplitN(input, ":", 2)
		got, err := prettyCandidatePattern(parts[0], parts[1])
		if err != nil || got != want {
			t.Fatalf("%s => %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range [][2]string{{"prefix", ""}, {"prefix", "1234567"}, {"prefix", "88a"}, {"middle", "888"}} {
		if _, err := prettyCandidatePattern(input[0], input[1]); err == nil {
			t.Fatalf("%v 应被拒绝", input)
		}
	}
}

func TestParsePrettyNumberFilter(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/game/pretty-numbers/invite?status=init&keyword=888&page=2&pageSize=50", nil)
	filter, err := parsePrettyNumberFilter(request, prettyKindInvite)
	if err != nil {
		t.Fatalf("parse filter: %v", err)
	}
	if filter.Kind != prettyKindInvite || filter.Status != prettyStatusInit || filter.Keyword != "888" || filter.Page != 2 || filter.Size != 50 {
		t.Fatalf("unexpected filter: %#v", filter)
	}
	for _, query := range []string{"status=unknown", "keyword=" + strings.Repeat("a", 101)} {
		request := httptest.NewRequest(http.MethodGet, "/api/game/pretty-numbers/uid?"+query, nil)
		if _, err := parsePrettyNumberFilter(request, prettyKindUID); err == nil {
			t.Fatalf("query %q 应被拒绝", query)
		}
	}
	// 查询串不能再把页面类型改掉：本页是 uid，传 kind=invite 直接拒绝。
	request = httptest.NewRequest(http.MethodGet, "/api/game/pretty-numbers/uid?kind=invite", nil)
	if _, err := parsePrettyNumberFilter(request, prettyKindUID); err == nil {
		t.Fatal("查询串 kind 与页面类型不一致时应被拒绝")
	}
}

func TestDecodePrettyGamePayloadAcceptsStringAndObject(t *testing.T) {
	fromObject, err := decodePrettyGamePayload(json.RawMessage(`{"total":1,"list":[]}`))
	if err != nil || intField(fromObject, "total") != 1 {
		t.Fatalf("object payload = %#v, %v", fromObject, err)
	}
	fromString, err := decodePrettyGamePayload(json.RawMessage(`"{\"total\":2,\"list\":[]}"`))
	if err != nil || intField(fromString, "total") != 2 {
		t.Fatalf("string payload = %#v, %v", fromString, err)
	}
	wrapped, err := decodePrettyGamePayload(json.RawMessage(`{"result":{"total":3,"list":[]}}`))
	if err != nil || intField(wrapped, "total") != 3 {
		t.Fatalf("wrapped payload = %#v, %v", wrapped, err)
	}
}

func TestHandleListPrettyNumbersParsesStringPayload(t *testing.T) {
	server := newPrettyTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != prettyListCommand {
			t.Errorf("unexpected header: %q", header)
		}
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["page"] != float64(0) || params["count"] != float64(20) {
			t.Errorf("unexpected pagination: %#v", params)
		}
		if params["kind"] != prettyKindUID || params["status"] != prettyStatusInit {
			t.Errorf("unexpected filters: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":"{\"total\":1,\"list\":[{\"pretty_no\":\"888888\",\"kind\":\"uid\",\"status\":\"used\",\"user_guuid\":\"580629\",\"user_name\":\"a3\"}]}"}`))
	})
	request := httptest.NewRequest(http.MethodGet, "/api/game/pretty-numbers/uid?status=init&page=1&pageSize=20", nil)
	response := httptest.NewRecorder()
	server.handleListPrettyNumbers(response, request, principal{})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data prettyNumberListResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Total != 1 || len(envelope.Data.Items) != 1 {
		t.Fatalf("unexpected list: %#v", envelope.Data)
	}
	item := envelope.Data.Items[0]
	if item.PrettyNo != "888888" || item.Kind != "uid" || item.Status != "used" || item.UserID != "580629" || item.UserName != "a3" {
		t.Fatalf("unexpected item: %#v", item)
	}
}

func TestHandleAddPrettyNumberSendsOperatorAndContext(t *testing.T) {
	server := newPrettyTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != prettyAddCommand {
			t.Errorf("unexpected header: %q", header)
		}
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["kind"] != "uid" || params["pretty_no"] != "888888" || params["op_name"] != "ops-zhang" {
			t.Errorf("unexpected params: %#v", params)
		}
		if !strings.HasPrefix(textFromAny(params["context"]), "xuan-pretty-add-") {
			t.Errorf("unexpected context: %#v", params["context"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":"{\"result\":1,\"kind\":\"uid\",\"pretty_no\":\"888888\",\"status\":\"init\"}"}`))
	})
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/uid",
		strings.NewReader(`{"prettyNo":"888888","remark":"客户购买"}`))
	response := httptest.NewRecorder()
	server.handleAddPrettyNumber(response, request, principal{Username: "ops-zhang"})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data prettyNumberMutationResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Result != 1 || envelope.Data.Status != "init" || envelope.Data.PrettyNo != "888888" {
		t.Fatalf("unexpected result: %#v", envelope.Data)
	}
}

func TestHandleBindPrettyNumberRequiresInviteCode(t *testing.T) {
	// 邀请码靓号只收原始邀请码，没传就在调库/调游戏服前拒绝。
	server := &Server{}
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/invite/666666/bind",
		strings.NewReader(`{}`))
	request.SetPathValue("prettyNo", "666666")
	response := httptest.NewRecorder()
	server.handleBindPrettyNumber(response, request, principal{Username: "ops"})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "原始邀请码") {
		t.Fatalf("expected 400 before game call, got %d: %s", response.Code, response.Body.String())
	}
}

func TestHandleBindPrettyNumberSendsInviteCode(t *testing.T) {
	// 邀请码靓号只把 invite_code 透传给游戏服，不带 user_guuid / club_id。
	server := newPrettyTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["invite_code"] != "482913" || params["kind"] != "invite" || params["pretty_no"] != "666666" {
			t.Errorf("unexpected params: %#v", params)
		}
		if _, ok := params["user_guuid"]; ok {
			t.Errorf("邀请码绑定不应带 user_guuid: %#v", params)
		}
		if _, ok := params["club_id"]; ok {
			t.Errorf("邀请码绑定不应带 club_id: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"result":1,"kind":"invite","pretty_no":"666666","user_guuid":"580629","user_name":"a3","club_id":"820084","old_invite_code":"482913"}}`))
	})
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/invite/666666/bind",
		strings.NewReader(`{"invite_code":"482913"}`))
	request.SetPathValue("prettyNo", "666666")
	response := httptest.NewRecorder()
	server.handleBindPrettyNumber(response, request, principal{Username: "ops"})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data prettyNumberMutationResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.OldInviteCode != "482913" || envelope.Data.UserName != "a3" {
		t.Fatalf("unexpected result: %#v", envelope.Data)
	}
}

func TestHandleBindPrettyNumberSendsUserId(t *testing.T) {
	// 账号ID靓号仍按真实玩家 ID 绑定。
	server := newPrettyTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["user_guuid"] != "580629" || params["kind"] != "uid" {
			t.Errorf("unexpected params: %#v", params)
		}
		if _, ok := params["club_id"]; ok {
			t.Errorf("账号ID绑定不应带 club_id: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"result":1,"kind":"uid","pretty_no":"888888","user_guuid":"580629","user_name":"a3"}}`))
	})
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/uid/888888/bind",
		strings.NewReader(`{"userId":"580629"}`))
	request.SetPathValue("prettyNo", "888888")
	response := httptest.NewRecorder()
	server.handleBindPrettyNumber(response, request, principal{Username: "ops"})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data prettyNumberMutationResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.UserID != "580629" || envelope.Data.UserName != "a3" {
		t.Fatalf("unexpected result: %#v", envelope.Data)
	}
}

func TestHandleUnbindPrettyNumberDisabled(t *testing.T) {
	// 2026-11-15 起解绑关闭：接口一律拒绝，且不应调用游戏服。
	called := false
	server := newPrettyTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":"{\"result\":1}"}`))
	})
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/uid/888888/unbind",
		strings.NewReader(`{}`))
	request.SetPathValue("prettyNo", "888888")
	response := httptest.NewRecorder()
	server.handleUnbindPrettyNumber(response, request, principal{Username: "ops"})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "解绑已关闭") {
		t.Fatalf("expected 400 解绑已关闭, got %d: %s", response.Code, response.Body.String())
	}
	if called {
		t.Fatal("解绑关闭时不应调用游戏服")
	}
}

func TestHandleBindPrettyNumberRejectsKindMismatch(t *testing.T) {
	server := &Server{}
	// 账号ID靓号页面里不允许借请求体把类型改成邀请码。
	request := httptest.NewRequest(http.MethodPost, "/api/game/pretty-numbers/uid/888888/bind",
		strings.NewReader(`{"kind":"invite","userId":"580629","clubId":"820084"}`))
	request.SetPathValue("prettyNo", "888888")
	response := httptest.NewRecorder()
	server.handleBindPrettyNumber(response, request, principal{Username: "ops"})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "不一致") {
		t.Fatalf("expected 400 kind mismatch, got %d: %s", response.Code, response.Body.String())
	}
}

func TestBuildPlayerWhereSupportsPrettyNumber(t *testing.T) {
	where, args := buildPlayerWhere(playerFilters{PrettyNo: "888888"}, false, true)
	if !strings.Contains(where, "p.pretty_no = ?") || len(args) != 1 || args[0] != "888888" {
		t.Fatalf("unexpected where/args: %s %#v", where, args)
	}
	where, args = buildPlayerWhere(playerFilters{PrettyNo: "888888"}, false, false)
	if !strings.Contains(where, "1 = 0") || len(args) != 0 {
		t.Fatalf("缺表时应返回空集: %s %#v", where, args)
	}
	where, args = buildPlayerWhere(playerFilters{Keyword: "888888"}, false, true)
	if !strings.Contains(where, "p.pretty_no = ?") || len(args) != 7 {
		t.Fatalf("关键字应命中靓号: %s %#v", where, args)
	}
}

func textFromAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
