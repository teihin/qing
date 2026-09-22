package api

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"xuanmanager/internal/config"
)

func TestJackpotReportDate(t *testing.T) {
	// UTC 16:30 is already the next day in Beijing.
	now := time.Date(2026, 9, 22, 16, 30, 0, 0, time.UTC)
	got, err := jackpotReportDate("", now)
	if err != nil || got != "2026-09-22" {
		t.Fatalf("default date %q %v", got, err)
	}
	for _, raw := range []string{"2026-02-30", "2026-9-21", "2026-09-24", "2026-09-21 OR 1=1"} {
		if _, err := jackpotReportDate(raw, now); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestDecodeJackpotReport(t *testing.T) {
	raw := `{"JackpotSettlementReport":{"date":"2026-09-21","all_performance":4000,"pool_performance":2000,"rebate_total":150,"platform_keep":1850,"count":1,"check_ok":false,"list":[{"guuid":"test-agent","name":"测试","agent_id":"boss","my_performance":400,"granted_performance":100,"proxy_performance":300,"rebate":150,"granted_list":[["child","下级",100]]}]}}`
	encoded, _ := json.Marshal(raw)
	for _, body := range []json.RawMessage{json.RawMessage(raw), encoded} {
		report, err := decodeJackpotReport(gameCommandResponse{RetCode: 512, RetResult: body}, "2026-09-21")
		if err != nil {
			t.Fatal(err)
		}
		if report["check_ok"] != false || report["all_performance"] != float64(4000) {
			t.Fatalf("report altered: %v", report)
		}
	}
	for _, code := range []int{769, 1280} {
		if _, err := decodeJackpotReport(gameCommandResponse{RetCode: code, RetResult: json.RawMessage(raw)}, "2026-09-21"); err == nil {
			t.Fatalf("treated %d as completed", code)
		}
	}
	if _, err := decodeJackpotReport(gameCommandResponse{RetCode: 512, RetResult: json.RawMessage(raw)}, "2026-09-20"); err == nil {
		t.Fatal("accepted wrong date")
	}
	for _, body := range []string{`{}`, `null`, `{"JackpotSettlementReport":null}`, `{"JackpotSettlementReport":{"date":"2026-09-21"}}`} {
		if _, err := decodeJackpotReport(gameCommandResponse{RetCode: 512, RetResult: json.RawMessage(body)}, "2026-09-21"); err == nil {
			t.Fatalf("accepted malformed %s", body)
		}
	}
}

func TestJackpotCommandEncoding(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hall/command" || r.URL.Query().Get("header") != "异步_查询_奖池业绩_结算报表" {
			t.Errorf("incorrect command URL %s", r.URL)
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Error(err)
		}
		if params["date"] != "2026-09-21" || params["context"] != "test-context" {
			t.Errorf("incorrect params %v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":"{\"JackpotSettlementReport\":{}}"}`))
	}))
	defer upstream.Close()
	s := &Server{cfg: config.Config{GameAdminURL: upstream.URL}, gameHTTPClient: upstream.Client()}
	result, err := s.callGameCommand(context.Background(), "异步_查询_奖池业绩_结算报表", map[string]any{"date": "2026-09-21", "context": "test-context"})
	if err != nil || result.RetCode != 512 {
		t.Fatalf("result %v %v", result, err)
	}
}

// Exercise configuration through a real database/sql connection and HTTP mock:
// accepted-but-not-persisted must never become a success response.
type jackpotTestDB struct {
	enabled bool
	audits  int
}
type jackpotTestDriver struct{ state *jackpotTestDB }
type jackpotTestConn struct{ state *jackpotTestDB }
type jackpotTestRows struct {
	state *jackpotTestDB
	done  bool
}

func (d jackpotTestDriver) Open(string) (driver.Conn, error) {
	return &jackpotTestConn{state: d.state}, nil
}
func (c *jackpotTestConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not used") }
func (c *jackpotTestConn) Close() error                        { return nil }
func (c *jackpotTestConn) Begin() (driver.Tx, error)           { return nil, errors.New("not used") }
func (c *jackpotTestConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &jackpotTestRows{state: c.state}, nil
}
func (c *jackpotTestConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	c.state.audits++
	return driver.RowsAffected(1), nil
}
func (r *jackpotTestRows) Columns() []string {
	return []string{"sm_guuid", "sm_name", "sm_role", "enabled"}
}
func (r *jackpotTestRows) Close() error { return nil }
func (r *jackpotTestRows) Next(values []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	copy(values, []driver.Value{"qa001", "测试代理", "代理", r.state.enabled})
	return nil
}

func TestJackpotConfigureReadback(t *testing.T) {
	for _, test := range []struct {
		name     string
		ret      int
		persist  bool
		status   int
		audits   int
		initial  bool
		expected bool
		enabled  bool
	}{
		{"confirmed", 512, true, 200, 1, false, false, true},
		{"asyncConfirmed", 1280, true, 200, 1, false, false, true},
		{"acceptedNotPersisted", 1280, false, 502, 1, false, false, true},
		{"successNotPersisted", 512, false, 502, 1, false, false, true},
		{"rejected", 769, false, 502, 1, false, false, true},
		{"close", 512, true, 200, 1, true, true, false},
		{"stale", 512, false, 409, 0, true, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := &jackpotTestDB{enabled: test.initial}
			driverName := fmt.Sprintf("jackpot-test-%s-%d", test.name, time.Now().UnixNano())
			sql.Register(driverName, jackpotTestDriver{state: state})
			db, err := sql.Open(driverName, "")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var params map[string]any
				_ = json.Unmarshal([]byte(r.URL.Query().Get("param")), &params)
				value := ""
				if test.enabled {
					value = "True"
				}
				if r.URL.Query().Get("header") != "异步_设置_玩家_属性" || params["guuid"] != "qa001" || params["name"] != "client_prop" || params["value"] != value {
					t.Errorf("wrong command: %v", params)
				}
				if test.persist {
					state.enabled = test.enabled
				}
				_, _ = fmt.Fprintf(w, `{"ret_code":%d,"ret_result":"{}"}`, test.ret)
			}))
			defer upstream.Close()
			s := &Server{db: db, gameDB: db, cfg: config.Config{GameAdminURL: upstream.URL}, gameHTTPClient: upstream.Client()}
			req := httptest.NewRequest("PUT", "/api/game/jackpot/agents/qa001", strings.NewReader(fmt.Sprintf(`{"enabled":%t,"expected":%t}`, test.enabled, test.expected)))
			req.SetPathValue("playerId", "qa001")
			out := httptest.NewRecorder()
			s.handleSetJackpotAgent(out, req, principal{IsSuper: true})
			if out.Code != test.status {
				t.Fatalf("HTTP %d expected %d: %s", out.Code, test.status, out.Body.String())
			}
			if state.audits != test.audits {
				t.Fatalf("audit count %d expected %d", state.audits, test.audits)
			}
		})
	}
}
