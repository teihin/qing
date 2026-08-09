package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type gameCommandResponse struct {
	RetCode   int             `json:"ret_code"`
	RetResult json.RawMessage `json:"ret_result"`
}

func (s *Server) callGameCommand(ctx context.Context, header string, params map[string]any) (gameCommandResponse, error) {
	paramBody, err := json.Marshal(params)
	if err != nil {
		return gameCommandResponse{}, fmt.Errorf("encode game command: %w", err)
	}
	endpoint := strings.TrimRight(s.cfg.GameAdminURL, "/") + "/hall/command"
	query := url.Values{}
	query.Set("header", header)
	query.Set("param", string(paramBody))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return gameCommandResponse{}, fmt.Errorf("create game command request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.gameHTTPClient.Do(request)
	if err != nil {
		return gameCommandResponse{}, fmt.Errorf("call game command: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return gameCommandResponse{}, fmt.Errorf("read game command response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return gameCommandResponse{}, fmt.Errorf("game command HTTP status %d", response.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	var result gameCommandResponse
	if err := decoder.Decode(&result); err != nil {
		return gameCommandResponse{}, fmt.Errorf("decode game command response: %w", err)
	}
	return result, nil
}

func gameOperationContext(action string) string {
	token, err := security.NewToken()
	if err == nil && len(token) >= 12 {
		return "xuan-" + action + "-" + token[:12]
	}
	return fmt.Sprintf("xuan-%s-%d", action, time.Now().UnixNano())
}
