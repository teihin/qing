package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func TestExtractGameRows(t *testing.T) {
	raw := json.RawMessage(`{"NumberList":[{"user_id":"1001","name":"A","total_contrib_fen":"12345","total_score":"-300"}]}`)
	rows := extractGameRows(raw)
	if len(rows) != 1 || textField(rows[0], "user_id") != "1001" {
		t.Fatalf("unexpected rows: %#v", rows)
	}
}

func TestMapAgentContributionNode(t *testing.T) {
	row := map[string]any{
		"user_id": "1001", "name": "A", "is_agent": "1", "level": "98",
		"upper_guuid": "9001", "team_count": "12",
		"today_contrib_fen": "100", "yesterday_contrib_fen": "200", "total_contrib_fen": "300",
		"today_score": "1", "yesterday_score": "2", "total_score": "-30",
		"percent":              "20",
		"contrib_display_rule": map[string]any{"mode": "percent", "percent": 80, "source": "self"},
		"score_display_rule":   map[string]any{"mode": "fixed", "delta": 20000, "source": "inherit", "source_agent_name": "上级"},
	}
	node := mapAgentContributionNode(row)
	if node.PlayerID != "1001" || node.Role != "agent" || node.TotalContribFen != "300" || node.TotalScore != "-30" {
		t.Fatalf("unexpected node: %#v", node)
	}
	if node.ContribRule.Mode != "percent" || node.ContribRule.Percent == nil || *node.ContribRule.Percent != 80 || !node.ContribRule.Sim {
		t.Fatalf("unexpected contrib rule: %#v", node.ContribRule)
	}
	if node.ScoreRule.Mode != "fixed" || node.ScoreRule.Delta == nil || *node.ScoreRule.Delta != 20000 {
		t.Fatalf("unexpected score rule: %#v", node.ScoreRule)
	}
}

func TestMapAgentContributionDisplayFields(t *testing.T) {
	row := map[string]any{
		"user_id": "1001", "total_contrib_fen": "1000",
		"total_contrib_display_fen": "800",
		"today_contrib_display_fen": "80",
	}
	node := mapAgentContributionNode(row)
	if node.TotalContribFen != "1000" || node.TotalContribDisplayFen != "800" || node.TodayContribDisplayFen != "80" {
		t.Fatalf("unexpected display fields: %#v", node)
	}
}

func TestSummarizeJSONRedactsSensitiveFields(t *testing.T) {
	text := summarizeJSON([]byte(`{"password":"p1","nested":{"token":"t1","value":2},"items":[{"secret":"s1","ok":1}]}`), 2000)
	for _, secret := range []string{"p1", "t1", "s1"} {
		if strings.Contains(text, secret) {
			t.Fatalf("sensitive value %q leaked in %s", secret, text)
		}
	}
	if !strings.Contains(text, "***") || !strings.Contains(text, "value") {
		t.Fatalf("unexpected summary: %s", text)
	}
}

func TestAnyStringMap(t *testing.T) {
	mapping := anyStringMap(map[string]any{"total_score": "-4", "team_count": 2})
	if mapping["total_score"] != "-4" || mapping["team_count"] != "2" {
		t.Fatalf("unexpected mapping: %#v", mapping)
	}
}

func TestParseDisplayRuleFromRowFlatFields(t *testing.T) {
	row := map[string]any{
		"score_display_mode": "fixed", "score_display_delta": "5000",
		"score_display_source": "inherit", "score_display_source_agent_name": "A",
	}
	rule := parseDisplayRuleFromRow(row, "score")
	if rule.Mode != "fixed" || rule.Delta == nil || *rule.Delta != 5000 || rule.SourceAgentName != "A" {
		t.Fatalf("unexpected rule: %#v", rule)
	}
	if !rule.Sim {
		t.Fatalf("non-zero fixed rule should be marked simulated")
	}
}

func TestParseDisplayRuleFromJSONString(t *testing.T) {
	row := map[string]any{"contrib_display_rule": `{"mode":"percent","percent":75,"source":"self"}`}
	rule := parseDisplayRuleFromRow(row, "contrib")
	if rule.Mode != "percent" || rule.Percent == nil || *rule.Percent != 75 || !rule.Sim {
		t.Fatalf("unexpected rule: %#v", rule)
	}
}

func TestParseRulePayload(t *testing.T) {
	rule := parseRulePayload(json.RawMessage(`{"rule":{"mode":"percent","percent":80,"source":"self"}}`), "contrib")
	if rule.Mode != "percent" || rule.Percent == nil || *rule.Percent != 80 || !rule.Sim {
		t.Fatalf("unexpected rule: %#v", rule)
	}
}

func TestNormalizeRuleMode(t *testing.T) {
	for input, want := range map[string]string{
		"": "none", "none": "none", "inherit": "none", "percent": "percent",
		"ratio": "percent", "fixed": "fixed", "amount": "fixed", "other": "unknown",
	} {
		if got := normalizeRuleMode(input); got != want {
			t.Fatalf("normalizeRuleMode(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestHandleAgentContributionMembersParsesDisplayFields(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionMembersCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["show_type"] != "member" {
			t.Errorf("unexpected show_type: %#v", params["show_type"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"NumberList":[{"user_id":"1001","name":"A","club_id":"267493","club_name":"A1俱乐部","is_leader":"1","total_contrib_fen":"1000","total_contrib_display_fen":"800","total_score":"-30","total_score_display":"-15"}]}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodGet,
		"/api/game/agent-contributions/clubs/710701/members?agentId=1001&showType=member", nil)
	request.SetPathValue("clubId", "710701")
	response := httptest.NewRecorder()
	server.handleAgentContributionMembers(response, request, principal{IsSuper: true})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data agentContributionMembersResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !envelope.Data.RawAvailable || len(envelope.Data.Items) != 1 {
		t.Fatalf("unexpected response: %#v", envelope.Data)
	}
	item := envelope.Data.Items[0]
	if item.TotalContribFen != "1000" || item.TotalContribDisplayFen != "800" || item.TotalScore != "-30" || item.TotalScoreDisplay != "-15" {
		t.Fatalf("unexpected item: %#v", item)
	}
	if item.ClubID != "267493" || item.ClubName != "A1俱乐部" || !item.IsLeader {
		t.Fatalf("unexpected club/leader fields: %#v", item)
	}
}

func TestHandleAgentContributionMembersSelfOnly(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["user_id"] != "1001" {
			t.Errorf("selfOnly should pass user_id=agentId, got %#v", params["user_id"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"NumberList":[{"user_id":"1001","name":"A","club_id":"710701","total_contrib_fen":"10"}]}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodGet,
		"/api/game/agent-contributions/clubs/710701/members?agentId=1001&showType=member&selfOnly=1", nil)
	request.SetPathValue("clubId", "710701")
	response := httptest.NewRecorder()
	server.handleAgentContributionMembers(response, request, principal{IsSuper: true})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data agentContributionMembersResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(envelope.Data.Items) != 1 || envelope.Data.Items[0].PlayerID != "1001" {
		t.Fatalf("unexpected selfOnly response: %#v", envelope.Data)
	}
}

func TestHandleAgentContributionMembersRejectsInvalidShowType(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodGet,
		"/api/game/agent-contributions/clubs/710701/members?agentId=1001&showType=unknown", nil)
	request.SetPathValue("clubId", "710701")
	response := httptest.NewRecorder()
	server.handleAgentContributionMembers(response, request, principal{IsSuper: true})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestHandleAgentContributionDisplayData(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionDisplayDataCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["club_id"] != "267493" || params["agent_id"] != "1001" {
			t.Errorf("game command used wrong club/agent: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"metric":"contrib","agent_income_show_percent":100,"self_raw":{"total_score":"-4","total_contrib_fen":"60"},"self_display":{"total_score":"-4","total_contrib_fen":"48"},"team_raw":{"total_score":"355","total_contrib_fen":"1645","team_count":"2"},"team_display":{"total_score":"284","total_contrib_fen":"1316","team_count":"2"}}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodPost,
		"/api/game/agent-contributions/clubs/710701/display-data",
		strings.NewReader(`{"items":[{"agentId":"1001","clubId":"267493"}]}`))
	request.SetPathValue("clubId", "710701")
	response := httptest.NewRecorder()
	server.handleAgentContributionDisplayData(response, request, principal{IsSuper: true})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data agentContributionDisplayBatchResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	payload := envelope.Data
	item := payload.Items["1001"]
	if !item.Available || item.ClubID != "267493" || item.TeamDisplay["total_score"] != "284" || item.TeamRaw["total_contrib_fen"] != "1645" {
		t.Fatalf("unexpected display item: %#v", item)
	}
}

func TestHandleAgentContributionRuleSetRejectsInvalidInput(t *testing.T) {
	cases := []struct{ name, metric, body string }{
		{"invalid metric", "unknown", `{"mode":"percent","percent":80,"note":"测试原因"}`},
		{"invalid mode", "contrib", `{"mode":"other","note":"测试原因"}`},
		{"percent too high", "contrib", `{"mode":"percent","percent":101,"note":"测试原因"}`},
		{"fixed zero", "score", `{"mode":"fixed","delta":0,"note":"测试原因"}`},
		{"short note", "score", `{"mode":"percent","percent":80,"note":"a"}`},
	}
	for _, test := range cases {
		request := httptest.NewRequest(http.MethodPut,
			"/api/game/agent-contributions/clubs/710701/agents/1001/rule?metric="+test.metric,
			strings.NewReader(test.body))
		request.SetPathValue("clubId", "710701")
		request.SetPathValue("agentId", "1001")
		response := httptest.NewRecorder()
		server := &Server{}
		server.handleAgentContributionRuleSet(response, request, principal{IsSuper: true, Username: "admin"})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d: %s", test.name, response.Code, response.Body.String())
		}
	}
}

func TestShowPercentSource(t *testing.T) {
	hundred := int64(100)
	eighty := int64(80)
	if got := showPercentSource(nil, nil); got != "" {
		t.Fatalf("expected empty source, got %q", got)
	}
	if got := showPercentSource(&eighty, &eighty); got != "self" {
		t.Fatalf("expected self, got %q", got)
	}
	if got := showPercentSource(&eighty, nil); got != "inherit" {
		t.Fatalf("expected inherit, got %q", got)
	}
	if got := showPercentSource(&hundred, nil); got != "default" {
		t.Fatalf("expected default, got %q", got)
	}
	if got := showPercentSource(&hundred, &hundred); got != "self" {
		t.Fatalf("expected self for explicit 100, got %q", got)
	}
}

func TestAgentContributionDisplayDataCarriesBonusDarkPercent(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionDisplayDataCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"metric":"contrib","agent_income_show_percent":80,"bonus_dark_percent":10,"self_raw":{},"self_display":{},"team_raw":{},"team_display":{}}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodPost, "/api/game/agent-contributions/clubs/710701/display-data",
		strings.NewReader(`{"items":[{"agentId":"1001","clubId":"267493"}]}`))
	request.SetPathValue("clubId", "710701")
	response := httptest.NewRecorder()
	server.handleAgentContributionDisplayData(response, request, principal{IsSuper: true})
	var envelope struct {
		Data agentContributionDisplayBatchResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	item := envelope.Data.Items["1001"]
	if item.BonusDarkPercent == nil || *item.BonusDarkPercent != 10 {
		t.Fatalf("expected bonus dark 10, got %#v", item.BonusDarkPercent)
	}
}

func TestAgentContributionBonusDarkGetReadsCurrentValue(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionBonusDarkCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		var params map[string]any
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
		if params["club_id"] != "710701" || params["user_id"] != "1001" {
			t.Errorf("game command used wrong club/agent: %#v", params)
		}
		if _, ok := params["bonus_dark_percent"]; ok {
			t.Errorf("read request must not carry bonus_dark_percent: %#v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"club_id":"710701","agent_id":"1001","user_id":"1001","bonus_dark_percent":"7"}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodGet, "/api/game/agent-contributions/clubs/710701/agents/1001/bonus-dark", nil)
	request.SetPathValue("clubId", "710701")
	request.SetPathValue("agentId", "1001")
	response := httptest.NewRecorder()
	server.handleAgentContributionBonusDarkGet(response, request, principal{IsSuper: true})
	var envelope struct {
		Data agentContributionBonusDarkResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !envelope.Data.Available || envelope.Data.BonusDarkPercent == nil || *envelope.Data.BonusDarkPercent != 7 {
		t.Fatalf("unexpected bonus dark response: %#v", envelope.Data)
	}
}

func TestAgentContributionBonusDarkSetRejectsInvalidInput(t *testing.T) {
	cases := []struct{ name, body string }{
		{"missing percent", `{"note":"测试原因"}`},
		{"percent too high", `{"percent":101,"note":"测试原因"}`},
		{"negative percent", `{"percent":-1,"note":"测试原因"}`},
		{"short note", `{"percent":10,"note":"a"}`},
	}
	for _, test := range cases {
		request := httptest.NewRequest(http.MethodPut,
			"/api/game/agent-contributions/clubs/710701/agents/1001/bonus-dark", strings.NewReader(test.body))
		request.SetPathValue("clubId", "710701")
		request.SetPathValue("agentId", "1001")
		response := httptest.NewRecorder()
		server := &Server{}
		server.handleAgentContributionBonusDarkSet(response, request, principal{IsSuper: true, Username: "admin"})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d: %s", test.name, response.Code, response.Body.String())
		}
	}
}
