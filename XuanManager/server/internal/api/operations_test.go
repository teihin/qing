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

func TestCurrentRoomListDoesNotUseStalePlayerRoomIDs(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/game/room-maintenance", nil)
	server := &Server{}
	server.handleListCurrentRooms(recorder, request, principal{})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data struct {
			Available bool   `json:"available"`
			Source    string `json:"source"`
			Total     int    `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Available || response.Data.Source != "unavailable" || response.Data.Total != 0 {
		t.Fatalf("unexpected live-room state: %#v", response.Data)
	}
	if strings.Contains(recorder.Body.String(), "\"source\":\"tbl_Account.sm_roomID\"") {
		t.Fatal("stale player room IDs must not be exposed as current rooms")
	}
}
