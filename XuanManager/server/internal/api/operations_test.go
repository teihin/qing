package api

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func TestCallBalanceExchangeUsesLegacySignedProtocol(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/newmeng793afw/exchange" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		var params map[string]string
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode param: %v", err)
		}
		if params["coin"] != "-25" || params["coin2"] != "0" || params["num"] != "-25" || params["guuid"] != "123456" || params["work_order"] != "TKXMTEST" {
			t.Fatalf("unexpected params: %#v", params)
		}
		digest := md5.Sum([]byte("test-sign-25" + "123456"))
		if params["sgin"] != hex.EncodeToString(digest[:]) {
			t.Fatal("legacy exchange signature mismatch")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"ret_code":512,"ret_result":{}}`))}, nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890", GameExchangeSign: "test-sign"}, gameHTTPClient: client}
	if err := s.callBalanceExchange(context.Background(), "123456", -25, "TKXMTEST"); err != nil {
		t.Fatalf("callBalanceExchange: %v", err)
	}
}

func TestPaymentHashWritesMatchClientConfiguration(t *testing.T) {
	input := updatePaymentConfigurationRequest{
		Channels:      []paymentChannelConfig{{Name: "支付1", Enabled: true, NeedsInfo: true, InfoFields: []string{"姓名", "手机"}, PresetAmounts: "100,200", DisplayText: "测试", Banks: "中国银行#", AllowCustom: true, CustomMin: "50", CustomMax: "500"}},
		PaymentDomain: "http://pay.example.com", RequireBankBranch: true,
	}
	if err := normalizeAndValidatePaymentRequest(&input); err != nil {
		t.Fatalf("validate payment: %v", err)
	}
	writes, err := paymentHashWrites(input)
	if err != nil {
		t.Fatalf("paymentHashWrites: %v", err)
	}
	if writes[paymentListKey] != "支付1#" || writes[paymentBranchKey] != "true" {
		t.Fatalf("unexpected global writes: %#v", writes)
	}
	decoded, err := decodeClientBase64(writes["支付配置_支付1"])
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	var client paymentClientConfig
	if err := json.Unmarshal([]byte(decoded), &client); err != nil {
		t.Fatalf("decode client JSON: %v", err)
	}
	if client.InfoList != "姓名#手机#" || client.Money != "100,200" || client.InputRange != "50,500" || !client.NeedInfo || !client.OpenInput {
		t.Fatalf("unexpected client config: %#v", client)
	}
}

func TestActivityWritesUseVerifiedClientKeys(t *testing.T) {
	input := updateActivityConfigurationRequest{
		Enabled: true,
		Activities: []activityItemState{
			{Code: "hand-rank", Name: "玩家手数榜", Enabled: true, StartDate: "2026-08-10", StartTime: "10:00", EndDate: "2026-08-11", EndTime: "10:00", RewardRule: "奖励", AllowClaim: true, RankLimit: 20, PlayerText: "说明"},
			{Code: "score-rank", Name: "玩家赢分榜", Enabled: false, RankLimit: 20},
			{Code: "agent-bonus-rank", Name: "代理红利榜", Enabled: false, RankLimit: 20},
		},
		HandRankPower: activityPowerState{One: "1", Two: "2", Five: "5", Ten: "10", Twenty: "20"},
	}
	if err := normalizeAndValidateActivityRequest(&input); err != nil {
		t.Fatalf("validate activity: %v", err)
	}
	configs, texts := activityWrites(input)
	if configs["activity_on"] != "True" || configs["activity3_reward_list_xiao"] != "奖励" || configs["activity3_list_power"] != "1,1,1,2,5,10,20,1,1" {
		t.Fatalf("unexpected configs: %#v", configs)
	}
	if configs["activity2_start_date"] != "" || texts["活动文本_玩家手数榜"] != "说明" {
		t.Fatalf("unexpected disabled/text mapping: %#v %#v", configs, texts)
	}
}

func TestGetBossConfigurationTreatsUnsetLegacyKeyAsEmpty(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"ret_code":769,"ret_result":{}}`))}, nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	value, err := s.getBossConfiguration(context.Background(), "missing", "test")
	if err != nil || value != "" {
		t.Fatalf("unset key = %q, %v", value, err)
	}
}

func TestValidateDissolveAllRequiresExplicitScope(t *testing.T) {
	if err := validateDissolveRequest(dissolveRoomRequest{Mode: "friendly", Confirm: true}, true); err == nil {
		t.Fatal("all-room operation without scope confirmation should fail")
	}
	if err := validateDissolveRequest(dissolveRoomRequest{Mode: "force", Confirm: true, ConfirmScope: "ALL_ROOMS"}, true); err != nil {
		t.Fatalf("valid all-room request rejected: %v", err)
	}
}

func TestCurrentRoomListUsesKBHallRoomCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/hall/command" || request.URL.Query().Get("header") != "查询_大厅_所有房间" {
			t.Fatalf("unexpected request: %s", request.URL.String())
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		if params["page"] != float64(1) || params["count"] != float64(200) || !strings.HasPrefix(params["context"].(string), "xuan-hall-room-list-") {
			t.Fatalf("unexpected params: %#v", params)
		}
		body := `{"ret_code":512,"ret_result":{"number":1,"count":3,"result":[{"room_id":851724,"room_type":"Custom","room_name":"1-851724","room_status":"游戏中","game_status":"playing","play_mode":"传销扯旋","special_rule":["特牌","底皮1/3"],"round_count":3,"game_round":99999,"player_count":4,"watcher_count":1,"player_and_watcher_count":5,"inhold_count":2,"max_number":8,"club_id":"0","club_name":"","creator_guuid":"648425","creator_name":"boss","create_datetime":"2026-08-11 10:00:00","remark":"26分钟"}],"context":"admin-room-list"}}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/admin/hall/rooms?page=2&page_size=999", nil)
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	server.handleListCurrentRooms(recorder, request, principal{})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Available    bool           `json:"available"`
			Source       string         `json:"source"`
			Page         int            `json:"page"`
			PageSize     int            `json:"pageSize"`
			Total        int            `json:"total"`
			PlayerCount  int            `json:"playerCount"`
			WatcherCount int            `json:"watcherCount"`
			InholdCount  int            `json:"inholdCount"`
			Items        []hallRoomItem `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Data.Available || response.Data.Source != "kb_hall_active_rooms" || response.Data.Page != 2 || response.Data.PageSize != 200 || response.Data.Total != 3 {
		t.Fatalf("unexpected live-room state: %#v", response.Data)
	}
	if response.Data.PlayerCount != 4 || response.Data.WatcherCount != 1 || response.Data.InholdCount != 2 || len(response.Data.Items) != 1 || response.Data.Items[0].RoomID != 851724 {
		t.Fatalf("unexpected room totals/items: %#v", response.Data)
	}
}

func TestCurrentRoomListRejectsLegacyFailure(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"ret_code":769,"ret_result":{"error":"权限不足"}}`))}, nil
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/admin/hall/rooms", nil)
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	server.handleListCurrentRooms(recorder, request, principal{})
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), "ROOM_LIST_REJECTED") || !strings.Contains(recorder.Body.String(), "权限不足") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestHallRoomPageParams(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/admin/hall/rooms?page=3&page_size=201", nil)
	page, size := hallRoomPageParams(request)
	if page != 3 || size != 200 {
		t.Fatalf("page params = %d, %d", page, size)
	}
	request = httptest.NewRequest(http.MethodGet, "/api/admin/hall/rooms?page=0&page_size=bad", nil)
	page, size = hallRoomPageParams(request)
	if page != 1 || size != 50 {
		t.Fatalf("invalid params should use defaults, got %d, %d", page, size)
	}
}

func TestDecodeHallRoomListRequiresResultArray(t *testing.T) {
	for _, raw := range []string{`[]`, `{}`, `{"number":0,"count":0,"result":{}}`} {
		if _, err := decodeHallRoomListResult(json.RawMessage(raw), 0); err == nil {
			t.Fatalf("malformed result accepted: %s", raw)
		}
	}
}

func TestSafeHallRoomListErrorDoesNotExposeUnknownMessage(t *testing.T) {
	if got := safeHallRoomListError(json.RawMessage(`{"error":"内部异常堆栈"}`)); got != "获取大厅房间列表失败" {
		t.Fatalf("unsafe error exposed: %q", got)
	}
	if got := safeHallRoomListError(json.RawMessage(`{"error":"BOSS未初始化"}`)); got != "BOSS未初始化" {
		t.Fatalf("safe error hidden: %q", got)
	}
}
