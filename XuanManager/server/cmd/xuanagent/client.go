package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// 与后台 /agent/v1/* 通道对应的最小客户端。
// 只做协议本身：注册换租约、心跳（顺便领指派清单）、拉命令、回执、批量上报事件。

type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("HTTP %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// unauthorized 用来判断是否需要重新注册（租约过期 / 节点被停用）。
func (e *apiError) unauthorized() bool {
	return e.Status == http.StatusUnauthorized
}

type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type apiClient struct {
	base  string
	http  *http.Client
	token string
}

func newAPIClient(base string) *apiClient {
	return &apiClient{
		base: strings.TrimRight(base, "/"),
		http: &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *apiClient) call(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("User-Agent", "xuanagent/"+version)
	if c.token != "" {
		request.Header.Set("X-Agent-Token", c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return err
	}
	var env envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return &apiError{Status: response.StatusCode, Message: "返回内容不是合法 JSON：" + snippet(payload)}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || !env.OK {
		detail := &apiError{Status: response.StatusCode, Message: "请求失败"}
		if env.Error != nil {
			detail.Code = env.Error.Code
			detail.Message = env.Error.Message
		}
		return detail
	}
	if out != nil && len(env.Data) > 0 {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return fmt.Errorf("解析 %s 响应失败: %w", path, err)
		}
	}
	return nil
}

func snippet(value []byte) string {
	text := strings.TrimSpace(string(value))
	if len(text) > 160 {
		return text[:160] + "…"
	}
	return text
}

// ---- 注册 ----

type registerRequest struct {
	WorkerCode  string `json:"workerCode"`
	Platform    string `json:"platform"`
	Arch        string `json:"arch"`
	Version     string `json:"version"`
	Capacity    int    `json:"capacity"`
	Labels      string `json:"labels"`
	EnrollToken string `json:"enrollToken"`
}

type registerResponse struct {
	WorkerID          int64  `json:"workerId"`
	WorkerCode        string `json:"workerCode"`
	Status            string `json:"status"`
	LeaseToken        string `json:"leaseToken"`
	LeaseExpiresAt    string `json:"leaseExpiresAt"`
	HeartbeatInterval int    `json:"heartbeatInterval"`
	ServerTime        string `json:"serverTime"`
}

func (c *apiClient) register(ctx context.Context, request registerRequest) (registerResponse, error) {
	var result registerResponse
	err := c.call(ctx, http.MethodPost, "/agent/v1/register", request, &result)
	if err == nil {
		c.token = result.LeaseToken
	}
	return result, err
}

// ---- 心跳 ----

type heartbeatRequest struct {
	Version         string `json:"version"`
	CPUPct          int    `json:"cpuPct"`
	MemPct          int    `json:"memPct"`
	ActiveTerminals int    `json:"activeTerminals"`
	ActiveTasks     int    `json:"activeTasks"`
	LastEventSeq    int64  `json:"lastEventSeq"`
	Capacity        int    `json:"capacity"`
	EgressCIDR      string `json:"egressCidr"`
}

type assignment struct {
	RobotID      int64  `json:"robotId"`
	TerminalNo   string `json:"terminalNo"`
	Account      string `json:"account"`
	Password     string `json:"password"`
	Nickname     string `json:"nickname"`
	ClubID       string `json:"clubId"`
	InviteCode   string `json:"inviteCode"`
	GroupName    string `json:"groupName"`
	StrategyName string `json:"strategyName"`
	// 绑定策略的运行参数原文，由 ensureTerminal 解析成终端运行参数。
	StrategyConfig json.RawMessage `json:"strategyConfig"`
	BuyinMultiple  int             `json:"buyinMultiple"`
	RoomPi         string          `json:"roomPi"`
	Intelligence   int             `json:"intelligence"`
	DesiredStatus  string          `json:"desiredStatus"`
	Status         string          `json:"status"`
	JoinStatus     string          `json:"joinStatus"`
	Enabled        bool            `json:"enabled"`
	Gps            string          `json:"gps"`
	ProfitMode     string          `json:"profitMode"`
	ProfitTarget   int64           `json:"profitTarget"`
	PeriodStart    string          `json:"periodStart"`
	PeriodEnd      string          `json:"periodEnd"`
	TodayNet       int64           `json:"todayNet"`
	PeriodNet      int64           `json:"periodNet"`
}

type heartbeatResponse struct {
	Status            string       `json:"status"`
	PendingCommands   int          `json:"pendingCommands"`
	HeartbeatInterval int          `json:"heartbeatInterval"`
	LeaseExpiresAt    string       `json:"leaseExpiresAt"`
	ServerTime        string       `json:"serverTime"`
	Assignments       []assignment `json:"assignments"`
}

func (c *apiClient) heartbeat(ctx context.Context, request heartbeatRequest) (heartbeatResponse, error) {
	var result heartbeatResponse
	err := c.call(ctx, http.MethodPost, "/agent/v1/heartbeat", request, &result)
	return result, err
}

// ---- 下线 ----

type offlineRequest struct {
	Reason string `json:"reason"`
}

func (c *apiClient) offline(ctx context.Context, reason string) error {
	return c.call(ctx, http.MethodPost, "/agent/v1/offline", offlineRequest{Reason: reason}, nil)
}

// ---- 命令 ----

type command struct {
	CommandNo  string          `json:"commandNo"`
	Type       string          `json:"commandType"`
	Label      string          `json:"label"`
	RobotID    *int64          `json:"robotId"`
	TerminalNo string          `json:"terminalNo"`
	Params     json.RawMessage `json:"params"`
	ExpiresAt  *time.Time      `json:"expiresAt"`
	Attempts   int             `json:"attempts"`
}

type commandBatch struct {
	Items  []command `json:"items"`
	Cursor int64     `json:"cursor"`
}

func (c *apiClient) pullCommands(ctx context.Context, cursor int64, limit int) (commandBatch, error) {
	var result commandBatch
	path := fmt.Sprintf("/agent/v1/commands?cursor=%d&limit=%d", cursor, limit)
	err := c.call(ctx, http.MethodGet, path, nil, &result)
	return result, err
}

type ackRequest struct {
	Status       string `json:"status"`
	Result       any    `json:"result,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

func (c *apiClient) ack(ctx context.Context, commandNo, status string, result any, errCode, errMessage string) error {
	body := ackRequest{Status: status, Result: result, ErrorCode: errCode, ErrorMessage: errMessage}
	return c.call(ctx, http.MethodPost, "/agent/v1/commands/"+commandNo+"/ack", body, nil)
}

// ---- 事件 ----

type event struct {
	EventID         string         `json:"eventId"`
	TerminalNo      string         `json:"terminalNo"`
	RobotID         int64          `json:"robotId"`
	Type            string         `json:"eventType"`
	Sequence        int64          `json:"sequence"`
	RoomID          int64          `json:"roomId"`
	RoundID         string         `json:"roundId"`
	StrategyVersion int            `json:"strategyVersion"`
	CommandNo       string         `json:"commandNo"`
	OccurredAt      string         `json:"occurredAt"`
	Payload         map[string]any `json:"payload,omitempty"`
}

type eventBatch struct {
	Events []event `json:"events"`
}

func (c *apiClient) reportEvents(ctx context.Context, events []event) error {
	if len(events) == 0 {
		return nil
	}
	return c.call(ctx, http.MethodPost, "/agent/v1/events/batch", eventBatch{Events: events}, nil)
}
