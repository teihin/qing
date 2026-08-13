package api

import (
	"net/http/httptest"
	"testing"
)

func TestAgentIdentityMatchesRequest(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		query    string
		agentID  int64
		expected bool
	}{
		{name: "legacy request without expected identity", agentID: 3, expected: true},
		{name: "matching header", header: "3", agentID: 3, expected: true},
		{name: "different account in shared browser", header: "2", agentID: 3, expected: false},
		{name: "event stream matching query", query: "3", agentID: 3, expected: true},
		{name: "event stream different query", query: "2", agentID: 3, expected: false},
		{name: "header takes precedence over query", header: "2", query: "3", agentID: 3, expected: false},
		{name: "invalid expected identity", header: "invalid", agentID: 3, expected: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "http://example.invalid/api/agent/events", nil)
			if test.header != "" {
				request.Header.Set("X-Agent-Expected-ID", test.header)
			}
			if test.query != "" {
				values := request.URL.Query()
				values.Set("expectedAgentId", test.query)
				request.URL.RawQuery = values.Encode()
			}
			if actual := agentIdentityMatchesRequest(request, test.agentID); actual != test.expected {
				t.Fatalf("agentIdentityMatchesRequest() = %v, want %v", actual, test.expected)
			}
		})
	}
}
