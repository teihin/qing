package api

import (
	"encoding/json"
	"testing"
)

func TestDecodeAutoBalancePayloadShapes(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"object", `{"teams":[{"team_name":"A"}],"members":[]}`, "A"},
		{"string object", `"{\"teams\":[{\"team_name\":\"A\"}]}"`, "A"},
		{"array", `[{"teams":[{"team_name":"B"}],"members":[]}]`, "B"},
		{"string array", `"[{\"ok\":true,\"teams\":2,\"members\":25}]"`, "ok"},
		{"result array", `{"result":[{"teams":[{"team_name":"C"}]}]}`, "C"},
		{"array empty", `[]`, ""},
		{"garbage", `not-json`, ""},
	}
	for _, tc := range cases {
		payload := decodeAutoBalancePayload(json.RawMessage(tc.raw))
		if tc.name == "string array" {
			if payload["ok"] != true || anyInt(payload["teams"]) != 2 || anyInt(payload["members"]) != 25 {
				t.Fatalf("%s: got %#v", tc.name, payload)
			}
			continue
		}
		teams, _ := payload["teams"].([]any)
		if tc.want == "" {
			if len(teams) != 0 {
				t.Fatalf("%s: want empty, got %#v", tc.name, payload)
			}
			continue
		}
		if len(teams) != 1 {
			t.Fatalf("%s: want 1 team, got %#v", tc.name, payload)
		}
		team, _ := teams[0].(map[string]any)
		if gameValueString(team, "team_name") != tc.want {
			t.Fatalf("%s: want team %s, got %#v", tc.name, tc.want, payload)
		}
	}
}
