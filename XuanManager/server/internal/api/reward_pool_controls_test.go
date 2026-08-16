package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"xuanmanager/internal/config"
)

func TestFetchRewardPoolControlsUsesVerifiedHallConfigurationShape(t *testing.T) {
	values := map[string]string{
		"reward_rate":       "100,100,100,100,100,100,100,100",
		"reward_nopai_on":   "0",
		"reward_nopai_dipi": "70,70,70,70,70,70,70,70,70",
		"reward_modify":     "0,0,2,3,5,10,20,0",
	}
	calls := 0
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.Query().Get("header") != "获取_大厅_配置数据" {
			t.Fatalf("unexpected header: %s", request.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		key, _ := params["param_name"].(string)
		value, ok := values[key]
		if !ok {
			t.Fatalf("unexpected config key: %q", key)
		}
		return gameHTTPResponse(`{"ret_code":512,"ret_result":{"param_name":` + mustJSON(key) + `,"param_value":` + mustJSON(value) + `}}`), nil
	})
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	snapshot, err := server.fetchRewardPoolControls(context.Background(), "test")
	if err != nil {
		t.Fatalf("fetch controls: %v", err)
	}
	if calls != 4 || snapshot.GlobalNoRewardRate != 0 || snapshot.TierNoRewardRates["底皮100/200"] != 70 || snapshot.PlatformRetentionYuan["底皮20/40"] != 20 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	state := rewardPoolControlStateFromSnapshot(snapshot)
	if len(state.Items) != 9 || state.Items[0].EstimatedActualRewardRate == nil || *state.Items[0].EstimatedActualRewardRate != 30 {
		t.Fatalf("unexpected control state: %#v", state)
	}
	if state.Items[8].BaseRewardRate != nil || state.Items[8].PlatformRetentionYuan != nil || state.Items[8].EstimatedActualRewardRate != nil {
		t.Fatalf("ninth tier must expose only reward_nopai_dipi: %#v", state.Items[8])
	}
}

func TestRewardPoolControlValidationAndSerialization(t *testing.T) {
	snapshot := testRewardPoolControlSnapshot()
	if err := validateRewardPoolControlSnapshot(snapshot); err != nil {
		t.Fatalf("valid snapshot rejected: %v", err)
	}
	if got := serializeRewardControlValues(snapshot.RewardRates, 8); got != "100,100,100,100,100,100,100,100" {
		t.Fatalf("reward_rate serialization = %q", got)
	}
	if got := serializeRewardControlValues(snapshot.TierNoRewardRates, 9); got != "70,70,70,70,70,70,70,70,70" {
		t.Fatalf("reward_nopai_dipi serialization = %q", got)
	}
	if got := serializeRewardControlValues(snapshot.PlatformRetentionYuan, 8); got != "0,0,2,3,5,10,20,0" {
		t.Fatalf("reward_modify serialization = %q", got)
	}

	invalid := testRewardPoolControlSnapshot()
	invalid.GlobalNoRewardRate = 101
	if err := validateRewardPoolControlSnapshot(invalid); err == nil {
		t.Fatal("global probability above 100 accepted")
	}
	invalid = testRewardPoolControlSnapshot()
	delete(invalid.RewardRates, "底皮2/5")
	if err := validateRewardPoolControlSnapshot(invalid); err == nil {
		t.Fatal("missing configured reward-rate tier accepted")
	}
	invalid = testRewardPoolControlSnapshot()
	invalid.PlatformRetentionYuan["底皮1/3"] = -1
	if err := validateRewardPoolControlSnapshot(invalid); err == nil {
		t.Fatal("negative platform retention accepted")
	}
}

func TestWriteRewardPoolControlsOnlyWritesChangedFields(t *testing.T) {
	before := testRewardPoolControlSnapshot()
	target := testRewardPoolControlSnapshot()
	target.GlobalNoRewardRate = 10
	target.PlatformRetentionYuan["底皮1/3"] = 8
	writes := map[string]string{}
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		key, _ := params["param_name"].(string)
		value, _ := params["param_value"].(string)
		writes[key] = value
		return gameHTTPResponse(`{"ret_code":512,"ret_result":{}}`), nil
	})
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := server.writeRewardPoolControls(context.Background(), before, target, false, "test"); err != nil {
		t.Fatalf("write controls: %v", err)
	}
	want := map[string]string{
		"reward_nopai_on": "10",
		"reward_modify":   "0,0,8,3,5,10,20,0",
	}
	if !reflect.DeepEqual(writes, want) {
		t.Fatalf("writes = %#v, want %#v", writes, want)
	}
}

func TestParseRewardControlCSVRejectsWrongCountAndRange(t *testing.T) {
	if values, err := parseRewardControlCSV("0, 70,100", 3, 0, 100, "test"); err != nil || !reflect.DeepEqual(values, []int64{0, 70, 100}) {
		t.Fatalf("valid CSV = %#v, %v", values, err)
	}
	if _, err := parseRewardControlCSV("0,70", 3, 0, 100, "test"); err == nil {
		t.Fatal("wrong count accepted")
	}
	if _, err := parseRewardControlCSV("0,101,70", 3, 0, 100, "test"); err == nil {
		t.Fatal("out-of-range probability accepted")
	}
}

func TestRewardPoolControlUpdateRequiresConfirmationBeforeGameCalls(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodPut, "/api/configuration/reward-pools/controls", bytes.NewBufferString(`{"confirm":false}`))
	response := httptest.NewRecorder()
	server.handleUpdateRewardPoolControls(response, request, principal{})
	if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("REWARD_POOL_CONTROL_CONFIRM_REQUIRED")) {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func testRewardPoolControlSnapshot() rewardPoolControlSnapshot {
	rewardRates := map[string]int{}
	tierRates := map[string]int{}
	retentions := map[string]int64{}
	for index, definition := range rewardPoolDefinitions {
		tierRates[definition.Key] = 70
		if index < rewardPoolConfiguredTierCount() {
			rewardRates[definition.Key] = 100
		}
	}
	retentionValues := []int64{0, 0, 2, 3, 5, 10, 20, 0}
	for index, value := range retentionValues {
		retentions[rewardPoolDefinitions[index].Key] = value
	}
	return rewardPoolControlSnapshot{
		RewardRates:           rewardRates,
		GlobalNoRewardRate:    0,
		TierNoRewardRates:     tierRates,
		PlatformRetentionYuan: retentions,
	}
}

func mustJSON(value string) string {
	body, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(body)
}
