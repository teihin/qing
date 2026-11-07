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
		"percent":       "20",
		"score_percent": "80",
		"contrib_add":   "200",
	}
	node := mapAgentContributionNode(row)
	if node.PlayerID != "1001" || node.Role != "agent" || node.TotalContribFen != "300" || node.TotalScore != "-30" {
		t.Fatalf("unexpected node: %#v", node)
	}
	if node.ScorePercent == nil || *node.ScorePercent != 80 || node.ContribAdd == nil || *node.ContribAdd != 200 {
		t.Fatalf("unexpected display rule fields: %#v", node)
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
		{"invalid metric", "unknown", `{"scorePercent":80,"note":"测试原因"}`},
		{"missing both", "contrib", `{"note":"测试原因"}`},
		{"score percent too high", "contrib", `{"scorePercent":101,"note":"测试原因"}`},
		{"score percent negative", "score", `{"scorePercent":-2,"note":"测试原因"}`},
		{"contrib add too large", "contrib", `{"contribAdd":100000001,"note":"测试原因"}`},
		{"contrib add negative", "contrib", `{"contribAdd":-2,"note":"测试原因"}`},
		{"short note", "score", `{"scorePercent":80,"note":"a"}`},
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

func TestHandleAgentContributionRuleSetSendsTwoFields(t *testing.T) {
	var received map[string]any
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionRuleSetCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &received)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"score_percent":80,"contrib_add":200}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodPut,
		"/api/game/agent-contributions/clubs/710701/agents/1001/rule?metric=contrib",
		strings.NewReader(`{"scorePercent":80,"contribAdd":200,"note":"测试原因"}`))
	request.SetPathValue("clubId", "710701")
	request.SetPathValue("agentId", "1001")
	response := httptest.NewRecorder()
	server.handleAgentContributionRuleSet(response, request, principal{IsSuper: true, Username: "admin"})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if received["score_percent"] != float64(80) || received["contrib_add"] != float64(200) {
		t.Fatalf("game command should carry new fields: %#v", received)
	}
	if _, ok := received["percent"]; ok {
		t.Fatalf("game command must not carry percent: %#v", received)
	}
	if _, ok := received["mode"]; ok {
		t.Fatalf("game command must not carry mode: %#v", received)
	}
}

func TestHandleAgentContributionRuleResetSendsClear(t *testing.T) {
	var received map[string]any
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &received)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("header") == agentContributionRuleGetCommand {
			_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"score_percent":100,"contrib_add":0,"effective_score_percent":80,"effective_contrib_add":200}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodDelete,
		"/api/game/agent-contributions/clubs/710701/agents/1001/rule?metric=contrib", nil)
	request.SetPathValue("clubId", "710701")
	request.SetPathValue("agentId", "1001")
	response := httptest.NewRecorder()
	server.handleAgentContributionRuleReset(response, request, principal{IsSuper: true, Username: "admin"})
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if received["score_percent"] != float64(-1) || received["contrib_add"] != float64(-1) {
		t.Fatalf("reset should send -1 to clear, got %#v", received)
	}
	var envelope struct {
		Data agentContributionRuleResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Data.Rule.ScorePercent == nil || *envelope.Data.Rule.ScorePercent != 80 {
		t.Fatalf("reset should return inherited effective value: %#v", envelope.Data.Rule)
	}
}

func TestHandleAgentContributionRuleGetParsesTwoFields(t *testing.T) {
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if header := r.URL.Query().Get("header"); header != agentContributionRuleGetCommand {
			t.Errorf("unexpected game command header: %q", header)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"score_percent":100,"contrib_add":0,"effective_score_percent":80,"effective_contrib_add":200}}`))
	}))
	defer game.Close()
	server := &Server{cfg: config.Config{GameAdminURL: game.URL}, gameHTTPClient: game.Client()}
	request := httptest.NewRequest(http.MethodGet,
		"/api/game/agent-contributions/clubs/710701/agents/1001/rule?metric=contrib", nil)
	request.SetPathValue("clubId", "710701")
	request.SetPathValue("agentId", "1001")
	response := httptest.NewRecorder()
	server.handleAgentContributionRuleGet(response, request, principal{IsSuper: true})
	var envelope struct {
		Data agentContributionRuleQueryResponse `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	data := envelope.Data
	if !data.Available || data.ScorePercent == nil || *data.ScorePercent != 100 || data.ContribAdd == nil || *data.ContribAdd != 0 {
		t.Fatalf("unexpected own values: %#v", data)
	}
	if data.EffectiveScorePercent == nil || *data.EffectiveScorePercent != 80 ||
		data.EffectiveContribAdd == nil || *data.EffectiveContribAdd != 200 {
		t.Fatalf("unexpected effective values: %#v", data)
	}
	if data.Rule.ScoreSource != "inherit" || data.Rule.ContribSource != "inherit" || !data.Rule.Sim {
		t.Fatalf("unexpected rule sources: %#v", data.Rule)
	}
}

func TestDisplayRuleSource(t *testing.T) {
	hundred := int64(100)
	eighty := int64(80)
	if got := displayRuleSource(nil, nil, 100); got != "" {
		t.Fatalf("expected empty source, got %q", got)
	}
	if got := displayRuleSource(&eighty, &eighty, 100); got != "self" {
		t.Fatalf("expected self, got %q", got)
	}
	if got := displayRuleSource(&eighty, nil, 100); got != "inherit" {
		t.Fatalf("expected inherit, got %q", got)
	}
	if got := displayRuleSource(&hundred, nil, 100); got != "default" {
		t.Fatalf("expected default, got %q", got)
	}
	if got := displayRuleSource(&hundred, &hundred, 100); got != "self" {
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
