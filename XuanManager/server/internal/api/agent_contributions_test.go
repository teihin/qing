package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
