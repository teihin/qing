package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"chattool/internal/config"
)

func TestCallXuanMemberGold(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	var gotDelta int
	var gotSync bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/service/clubs/club-1/members/user-1/gold" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Errorf("unexpected authorization: %s", r.Header.Get("Authorization"))
		}
		var body struct {
			Delta          int  `json:"delta"`
			SyncUnionQuota bool `json:"syncUnionQuota"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotDelta = body.Delta
		gotSync = body.SyncUnionQuota
		_, _ = w.Write([]byte(`{"ok":true,"data":{"retCode":512,"message":"ok","quotaSyncError":"联盟池额度不足"}}`))
	}))
	defer server.Close()

	s := &Server{cfg: config.Config{XuanManagerURL: server.URL, XuanServiceToken: token}}
	quotaSyncError, err := s.callXuanMemberGold(context.Background(), "club-1", "user-1", -100, "chattool:agent:1", "ctx-1", true)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if gotDelta != -100 {
		t.Fatalf("delta=%d want -100", gotDelta)
	}
	if !gotSync {
		t.Fatal("syncUnionQuota not forwarded")
	}
	if quotaSyncError != "联盟池额度不足" {
		t.Fatalf("quotaSyncError=%q", quotaSyncError)
	}
}

func TestCallXuanMemberGoldRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"GOLD_REJECTED","message":"积分不足"}}`))
	}))
	defer server.Close()

	s := &Server{cfg: config.Config{XuanManagerURL: server.URL, XuanServiceToken: "0123456789abcdef0123456789abcdef"}}
	_, err := s.callXuanMemberGold(context.Background(), "club-1", "user-1", 100, "actor", "ctx", false)
	if err == nil {
		t.Fatal("expected rejection")
	}
	serviceErr, ok := err.(*xuanServiceError)
	if !ok || serviceErr.Status != http.StatusBadRequest || serviceErr.Message != "积分不足" {
		t.Fatalf("unexpected error: %#v", err)
	}
}
