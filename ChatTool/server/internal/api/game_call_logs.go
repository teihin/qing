package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 游戏服接口日志：客服站不直连游戏服 8890，托管上下分由后台服务（XuanManager）执行游戏命令。
//
// 这里代理后台的服务通道，取回「后台 → 游戏服」的调用与回包（命令、参数、HTTP、ret_code、
// ret_result、耗时、错误），并按客服上下分的 context 前缀过滤，只留客服触发的命令。
// 数据源仍是后台进程自己的日志文件，不额外落库；只对根账号 admin999 开放。
const (
	gameCallLogDefault       = 200
	gameCallLogMax           = 500
	gameCallLogContextPrefix = "cs-hosted-gold-"

	// rootAgentUsername 是唯一可以查看服务端调用日志的根客服账号。
	rootAgentUsername = "admin999"
)

// gameCallLogEntry 与后台「游戏接口日志」字段一一对应：
// kind=call 表示下发给游戏服的调用，kind=result 表示游戏服回包，kind=error 表示调用或回包异常。
type gameCallLogEntry struct {
	Key        string `json:"key"`
	Time       string `json:"time"`
	Level      string `json:"level"`
	Kind       string `json:"kind"`
	Tag        string `json:"tag"`
	Command    string `json:"command"`
	Params     string `json:"params"`
	Result     string `json:"result"`
	RetCode    string `json:"retCode"`
	HTTPStatus string `json:"httpStatus"`
	DurationMS string `json:"durationMs"`
	Error      string `json:"error"`
}

var gameCallLogHTTPClient = &http.Client{Timeout: 12 * time.Second}

// handleGameCallLogs 只对根账号 admin999 开放：其它客服（含主管）一律 403。
func (s *Server) handleGameCallLogs(w http.ResponseWriter, r *http.Request, principal agentPrincipal) {
	if strings.TrimSpace(principal.Username) != rootAgentUsername {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "只有管理员可以查看服务端调用日志")
		return
	}
	limit := gameCallLogDefault
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > gameCallLogMax {
				parsed = gameCallLogMax
			}
			limit = parsed
		}
	}
	entries, updatedAt, err := s.fetchGameCallLogs(r.Context(), limit)
	if err != nil {
		if s.logger != nil {
			s.logger.Error("读取游戏服接口日志失败", "error", err)
		}
		writeError(w, http.StatusServiceUnavailable, "GAME_CALL_LOG_UNAVAILABLE", err.Error())
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"entries":     entries,
		"updatedAt":   updatedAt,
		"contextPath": gameCallLogContextPrefix,
	})
}

// fetchGameCallLogs 调后台服务通道拿「后台 → 游戏服」的调用记录（本机直连 + 服务令牌）。
func (s *Server) fetchGameCallLogs(ctx context.Context, limit int) ([]gameCallLogEntry, string, error) {
	if strings.TrimSpace(s.cfg.XuanServiceToken) == "" {
		return nil, "", fmt.Errorf("客服尚未配置后台服务令牌，无法读取游戏服调用日志")
	}
	endpoint := strings.TrimRight(s.cfg.XuanManagerURL, "/") + "/api/service/game-call-logs?limit=" +
		strconv.Itoa(limit) + "&contextPrefix=" + gameCallLogContextPrefix
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("游戏服调用日志请求创建失败")
	}
	request.Header.Set("Authorization", "Bearer "+s.cfg.XuanServiceToken)
	response, err := gameCallLogHTTPClient.Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("后台服务暂不可用，请稍后重试")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, "", fmt.Errorf("后台服务返回内容读取失败")
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Entries   []gameCallLogEntry `json:"entries"`
			UpdatedAt string             `json:"updatedAt"`
		} `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, "", fmt.Errorf("后台服务返回内容无法识别")
	}
	if response.StatusCode != http.StatusOK || !envelope.OK {
		message := strings.TrimSpace(envelope.Error.Message)
		if message == "" {
			message = "后台服务拒绝读取游戏服调用日志"
		}
		return nil, "", fmt.Errorf("%s", message)
	}
	entries := envelope.Data.Entries
	if entries == nil {
		entries = []gameCallLogEntry{}
	}
	return entries, envelope.Data.UpdatedAt, nil
}
