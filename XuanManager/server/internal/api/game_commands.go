package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

// 排查时默认打印所有发往游戏服的命令和回包；日志过多时可设 XUAN_LOG_GAME_COMMANDS=0 关闭。
var logGameCommandsEnabled = os.Getenv("XUAN_LOG_GAME_COMMANDS") != "0"

const gameCommandRoute = "/hall/command"

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type gameCommandResponse struct {
	RetCode   int             `json:"ret_code"`
	RetResult json.RawMessage `json:"ret_result"`
}

func (s *Server) callGameCommand(ctx context.Context, header string, params map[string]any) (gameCommandResponse, error) {
	started := time.Now()
	paramBody, err := json.Marshal(params)
	if err != nil {
		return gameCommandResponse{}, fmt.Errorf("encode game command: %w", err)
	}
	paramsSummary := summarizeJSON(paramBody, 2000)
	if s.logger != nil && logGameCommandsEnabled {
		s.logger.Info(
			fmt.Sprintf("[游戏服调用] GET %s | 命令=%s | 参数=%s", gameCommandRoute, header, paramsSummary),
			"route", gameCommandRoute, "header", header, "params", paramsSummary)
	}
	endpoint := strings.TrimRight(s.cfg.GameAdminURL, "/") + gameCommandRoute
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
		if s.logger != nil {
			s.logger.Error(
				fmt.Sprintf("[游戏服调用失败] GET %s | 命令=%s | 参数=%s | 错误=%v | 耗时=%dms",
					gameCommandRoute, header, paramsSummary, err, time.Since(started).Milliseconds()),
				"route", gameCommandRoute, "header", header, "params", paramsSummary, "error", err,
				"duration_ms", time.Since(started).Milliseconds())
		}
		return gameCommandResponse{}, fmt.Errorf("call game command: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		if s.logger != nil {
			s.logger.Error(
				fmt.Sprintf("[游戏服返回读取失败] GET %s | 命令=%s | 参数=%s | 错误=%v | 耗时=%dms",
					gameCommandRoute, header, paramsSummary, err, time.Since(started).Milliseconds()),
				"route", gameCommandRoute, "header", header, "params", paramsSummary, "error", err,
				"duration_ms", time.Since(started).Milliseconds())
		}
		return gameCommandResponse{}, fmt.Errorf("read game command response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		bodySummary := summarizeJSON(body, 2000)
		if s.logger != nil {
			s.logger.Error(
				fmt.Sprintf("[游戏服返回 HTTP 错误] GET %s | 命令=%s | 参数=%s | HTTP=%d | 返回=%s | 耗时=%dms",
					gameCommandRoute, header, paramsSummary, response.StatusCode, bodySummary, time.Since(started).Milliseconds()),
				"route", gameCommandRoute, "header", header, "params", paramsSummary, "http_status", response.StatusCode,
				"body", bodySummary, "duration_ms", time.Since(started).Milliseconds())
		}
		return gameCommandResponse{}, fmt.Errorf("game command HTTP status %d", response.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	var result gameCommandResponse
	if err := decoder.Decode(&result); err != nil {
		bodySummary := summarizeJSON(body, 2000)
		if s.logger != nil {
			s.logger.Error(
				fmt.Sprintf("[游戏服返回解码失败] GET %s | 命令=%s | 参数=%s | 错误=%v | 返回=%s | 耗时=%dms",
					gameCommandRoute, header, paramsSummary, err, bodySummary, time.Since(started).Milliseconds()),
				"route", gameCommandRoute, "header", header, "params", paramsSummary, "error", err,
				"body", bodySummary, "duration_ms", time.Since(started).Milliseconds())
		}
		return gameCommandResponse{}, fmt.Errorf("decode game command response: %w", err)
	}
	if s.logger != nil && logGameCommandsEnabled {
		retSummary := summarizeJSON(result.RetResult, 8000)
		duration := time.Since(started).Milliseconds()
		summary := fmt.Sprintf(
			"[游戏服返回] GET %s | 命令=%s | HTTP=%d | ret_code=%d (0x%X) | ret_result=%s | 耗时=%dms",
			gameCommandRoute, header, response.StatusCode, result.RetCode, result.RetCode, retSummary, duration)
		fields := []any{
			"route", gameCommandRoute, "header", header, "params", paramsSummary,
			"http_status", response.StatusCode, "ret_code", result.RetCode,
			"ret_result", retSummary, "duration_ms", duration,
		}
		if result.RetCode == 512 {
			s.logger.Info(summary, fields...)
		} else {
			s.logger.Warn(summary, fields...)
		}
	}
	return result, nil
}

func describeGameFailure(header string, retCode int, raw json.RawMessage) string {
	message := gameResultMessage(raw)
	if strings.TrimSpace(message) == "" || message == "游戏服未返回结果" {
		return fmt.Sprintf("游戏服命令 %s 返回 %d (0x%X)，接口未注册或暂未开放", header, retCode, retCode)
	}
	return fmt.Sprintf("游戏服命令 %s 返回 %d (0x%X)：%s", header, retCode, retCode, message)
}

func summarizeJSON(raw []byte, limit int) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err == nil {
		if encoded, err := json.Marshal(redactSensitive(value)); err == nil {
			return truncateText(string(encoded), limit)
		}
	}
	return truncateText(string(raw), limit)
}

func redactSensitive(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if isSensitiveKey(key) {
				result[key] = "***"
				continue
			}
			result[key] = redactSensitive(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = redactSensitive(item)
		}
		return result
	default:
		return value
	}
}

func isSensitiveKey(key string) bool {
	lower := strings.ToLower(key)
	return lower == "pass" || strings.Contains(lower, "password") || strings.Contains(lower, "passwd") ||
		strings.Contains(lower, "pwd") || strings.Contains(lower, "token") || strings.Contains(lower, "secret") ||
		strings.Contains(lower, "authorization")
}

func truncateText(text string, limit int) string {
	if limit <= 0 || len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}

func gameOperationContext(action string) string {
	token, err := security.NewToken()
	if err == nil && len(token) >= 12 {
		return "xuan-" + action + "-" + token[:12]
	}
	return fmt.Sprintf("xuan-%s-%d", action, time.Now().UnixNano())
}
