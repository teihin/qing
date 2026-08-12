package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

type recordingSessionExecer struct {
	queries  []string
	args     [][]any
	failCall int
}

func (r *recordingSessionExecer) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	r.queries = append(r.queries, query)
	r.args = append(r.args, args)
	if r.failCall == len(r.queries) {
		return nil, errors.New("test failure")
	}
	if len(r.queries) == 2 {
		return sessionTestResult(2), nil
	}
	return sessionTestResult(1), nil
}

type sessionTestResult int64

func (r sessionTestResult) LastInsertId() (int64, error) { return 0, nil }
func (r sessionTestResult) RowsAffected() (int64, error) { return int64(r), nil }

func TestReplaceUserSessionSerializesThenDeletesPreviousSessions(t *testing.T) {
	executor := &recordingSessionExecer{}
	expires := time.Now().Add(time.Hour)
	replaced, err := replaceUserSession(context.Background(), executor, "token", 9, "csrf", "127.0.0.1", "test-agent", expires)
	if err != nil {
		t.Fatalf("replaceUserSession: %v", err)
	}
	if replaced != 2 || len(executor.queries) != 3 {
		t.Fatalf("replaced=%d queries=%#v", replaced, executor.queries)
	}
	if !strings.HasPrefix(executor.queries[0], "UPDATE mgr_user SET") || !strings.HasPrefix(executor.queries[1], "DELETE FROM mgr_session WHERE user_id") || !strings.HasPrefix(executor.queries[2], "INSERT INTO mgr_session") {
		t.Fatalf("single-session statements executed in wrong order: %#v", executor.queries)
	}
	if executor.args[0][0] != int64(9) || executor.args[1][0] != int64(9) || executor.args[2][1] != int64(9) {
		t.Fatalf("unexpected user id arguments: %#v", executor.args)
	}
}

func TestReplaceUserSessionStopsWhenUserCannotBeLocked(t *testing.T) {
	executor := &recordingSessionExecer{failCall: 1}
	if _, err := replaceUserSession(context.Background(), executor, "token", 9, "csrf", "127.0.0.1", "test-agent", time.Now()); err == nil {
		t.Fatal("session replacement continued after the user row could not be locked")
	}
	if len(executor.queries) != 1 {
		t.Fatalf("unexpected statements after user lock failure: %#v", executor.queries)
	}
}
