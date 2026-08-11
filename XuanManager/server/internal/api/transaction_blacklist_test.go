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

func TestParseTransactionBlacklistIDs(t *testing.T) {
	ids, warnings := parseTransactionBlacklistIDs("648425， 123456;648425\n654321,wrong,123")
	expected := []string{"648425", "123456", "654321"}
	if !reflect.DeepEqual(ids, expected) {
		t.Fatalf("ids = %#v, want %#v", ids, expected)
	}
	if !reflect.DeepEqual(warnings, []string{"wrong", "123"}) {
		t.Fatalf("warnings = %#v", warnings)
	}
	if serialized := serializeTransactionBlacklistIDs(ids); serialized != "648425,123456,654321" {
		t.Fatalf("serialized = %q", serialized)
	}
}

func TestTransactionBlacklistRevisionIncludesStatusAndOrder(t *testing.T) {
	base := transactionBlacklistRevision(false, []string{"648425", "123456"})
	if base == transactionBlacklistRevision(true, []string{"648425", "123456"}) {
		t.Fatal("enabled status must change revision")
	}
	if base == transactionBlacklistRevision(false, []string{"123456", "648425"}) {
		t.Fatal("list order must change revision")
	}
}

func TestReplicaConfigurationUsesVerifiedLegacyCommands(t *testing.T) {
	calls := 0
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		calls++
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		if params["param_name"] != transactionBlacklistUsersKey {
			t.Fatalf("unexpected params: %#v", params)
		}
		if calls == 1 {
			if request.URL.Query().Get("header") != "设置_副本_配置数据" || params["param_value"] != "648425,123456" {
				t.Fatalf("unexpected set request: %s %#v", request.URL.Query().Get("header"), params)
			}
			return gameHTTPResponse(`{"ret_code":512,"ret_result":{}}`), nil
		}
		if request.URL.Query().Get("header") != "获取_副本_配置数据" {
			t.Fatalf("unexpected get header: %s", request.URL.Query().Get("header"))
		}
		return gameHTTPResponse(`{"ret_code":512,"ret_result":{"param_name":"npc","param_value":"648425,123456"}}`), nil
	})
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := server.setAndVerifyReplicaConfiguration(context.Background(), transactionBlacklistUsersKey, "648425,123456", "test"); err != nil {
		t.Fatalf("set and verify: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func TestTransactionBlacklistMutationsRequireConfirmation(t *testing.T) {
	server := &Server{}

	createRequest := httptest.NewRequest(http.MethodPost, "/api/game/transaction-blacklist", bytes.NewBufferString(`{"playerId":"648425","revision":"r","confirm":false}`))
	createResponse := httptest.NewRecorder()
	server.handleCreateTransactionBlacklist(createResponse, createRequest, principal{})
	if createResponse.Code != http.StatusBadRequest || !bytes.Contains(createResponse.Body.Bytes(), []byte("TRANSACTION_BLACKLIST_CONFIRM_REQUIRED")) {
		t.Fatalf("unexpected create response: %d %s", createResponse.Code, createResponse.Body.String())
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/game/transaction-blacklist/648425", bytes.NewBufferString(`{"revision":"r","confirm":false}`))
	deleteRequest.SetPathValue("playerId", "648425")
	deleteResponse := httptest.NewRecorder()
	server.handleDeleteTransactionBlacklist(deleteResponse, deleteRequest, principal{})
	if deleteResponse.Code != http.StatusBadRequest || !bytes.Contains(deleteResponse.Body.Bytes(), []byte("TRANSACTION_BLACKLIST_CONFIRM_REQUIRED")) {
		t.Fatalf("unexpected delete response: %d %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	updateRequest := httptest.NewRequest(http.MethodPut, "/api/game/transaction-blacklist/648425", bytes.NewBufferString(`{"newPlayerId":"123456","revision":"r","confirm":false}`))
	updateRequest.SetPathValue("playerId", "648425")
	updateResponse := httptest.NewRecorder()
	server.handleUpdateTransactionBlacklist(updateResponse, updateRequest, principal{})
	if updateResponse.Code != http.StatusBadRequest || !bytes.Contains(updateResponse.Body.Bytes(), []byte("TRANSACTION_BLACKLIST_CONFIRM_REQUIRED")) {
		t.Fatalf("unexpected update response: %d %s", updateResponse.Code, updateResponse.Body.String())
	}

	statusRequest := httptest.NewRequest(http.MethodPut, "/api/game/transaction-blacklist/status", bytes.NewBufferString(`{"enabled":true,"revision":"r","confirm":false}`))
	statusResponse := httptest.NewRecorder()
	server.handleUpdateTransactionBlacklistStatus(statusResponse, statusRequest, principal{})
	if statusResponse.Code != http.StatusBadRequest || !bytes.Contains(statusResponse.Body.Bytes(), []byte("TRANSACTION_BLACKLIST_CONFIRM_REQUIRED")) {
		t.Fatalf("unexpected status response: %d %s", statusResponse.Code, statusResponse.Body.String())
	}
}
