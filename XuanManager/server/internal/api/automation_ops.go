package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) registerAutomationRoutes() {
	s.mux.Handle("GET /api/automation/overview", s.authorized("automation.overview.view", false, s.handleAutomationOverview))

	s.mux.Handle("GET /api/automation/clubs", s.authorized("automation.club.view", false, s.handleListAutomationClubs))
	s.mux.Handle("GET /api/automation/clubs/{clubId}", s.authorized("automation.club.view", false, s.handleGetAutomationClub))
	s.mux.Handle("PUT /api/automation/clubs/{clubId}", s.authorized("automation.club.update", true, s.handleUpdateAutomationClub))
	s.mux.Handle("POST /api/automation/clubs/{clubId}/refresh", s.authorized("automation.club.refresh", true, s.handleRefreshAutomationClub))
	s.mux.Handle("POST /api/automation/clubs/{clubId}/deploy", s.authorized("automation.deploy.manage", true, s.handleDeployAutomationRobots))
	s.registerAutomationDeployRoutes()
	s.mux.Handle("GET /api/automation/scopes", s.authorized("automation.scope.manage", false, s.handleListAutomationScopes))
	s.mux.Handle("PUT /api/automation/scopes/{userId}", s.authorized("automation.scope.manage", true, s.handleUpdateAutomationScope))

	s.mux.Handle("GET /api/automation/rooms", s.authorized("automation.room.view", false, s.handleListAutomationRooms))
	s.mux.Handle("POST /api/automation/rooms/{roomId}/assign", s.authorized("automation.room.assign", true, s.handleAssignAutomationRoom))
	s.mux.Handle("POST /api/automation/rooms/{roomId}/recall", s.authorized("automation.room.assign", true, s.handleRecallAutomationRoom))

	s.mux.Handle("GET /api/automation/robots", s.authorized("automation.robot.view", false, s.handleListAutomationRobots))
	s.mux.Handle("POST /api/automation/robots", s.authorized("automation.robot.create", true, s.handleCreateAutomationRobot))
	s.mux.Handle("POST /api/automation/robots/bulk", s.authorized("automation.robot.create", true, s.handleBulkCreateAutomationRobots))
	s.mux.Handle("POST /api/automation/robots/batch", s.authorized("automation.robot.operate", true, s.handleAutomationRobotBatch))
	s.mux.Handle("GET /api/automation/robots/{id}", s.authorized("automation.robot.view", false, s.handleGetAutomationRobot))
	s.mux.Handle("GET /api/automation/robots/{id}/events", s.authorizedAny([]string{"automation.robot.view", "automation.worker.view"}, false, s.handleListAutomationRobotEvents))
	s.mux.Handle("GET /api/automation/robots/{id}/table", s.authorizedAny([]string{"automation.robot.view", "automation.worker.view"}, false, s.handleGetAutomationRobotTable))
	s.mux.Handle("PUT /api/automation/robots/{id}", s.authorized("automation.robot.update", true, s.handleUpdateAutomationRobot))
	s.mux.Handle("DELETE /api/automation/robots/{id}", s.authorized("automation.robot.delete", true, s.handleDeleteAutomationRobot))
	s.mux.Handle("POST /api/automation/robots/{id}/action", s.authorized("automation.robot.operate", true, s.handleAutomationRobotAction))

	s.mux.Handle("GET /api/automation/groups", s.authorized("automation.group.view", false, s.handleListAutomationGroups))
	s.mux.Handle("POST /api/automation/groups", s.authorized("automation.group.create", true, s.handleCreateAutomationGroup))
	s.mux.Handle("PUT /api/automation/groups/{id}", s.authorized("automation.group.update", true, s.handleUpdateAutomationGroup))
	s.mux.Handle("DELETE /api/automation/groups/{id}", s.authorized("automation.group.delete", true, s.handleDeleteAutomationGroup))

	s.mux.Handle("GET /api/automation/strategies", s.authorized("automation.strategy.view", false, s.handleListAutomationStrategies))
	s.mux.Handle("POST /api/automation/strategies", s.authorized("automation.strategy.create", true, s.handleCreateAutomationStrategy))
	s.mux.Handle("PUT /api/automation/strategies/{id}", s.authorized("automation.strategy.update", true, s.handleUpdateAutomationStrategy))
	s.mux.Handle("POST /api/automation/strategies/{id}/publish", s.authorized("automation.strategy.publish", true, s.handlePublishAutomationStrategy))
	s.mux.Handle("POST /api/automation/strategies/{id}/rollback", s.authorized("automation.strategy.update", true, s.handleRollbackAutomationStrategy))

	s.mux.Handle("GET /api/automation/tasks", s.authorized("automation.task.view", false, s.handleListAutomationTasks))
	s.mux.Handle("POST /api/automation/tasks", s.authorized("automation.task.create", true, s.handleCreateAutomationTask))
	s.mux.Handle("POST /api/automation/tasks/{id}/cancel", s.authorized("automation.task.cancel", true, s.handleCancelAutomationTask))
	s.mux.Handle("POST /api/automation/tasks/{id}/retry", s.authorized("automation.task.create", true, s.handleRetryAutomationTask))
	s.mux.Handle("GET /api/automation/approvals", s.authorized("automation.approval.view", false, s.handleListAutomationApprovals))
	s.mux.Handle("POST /api/automation/approvals/{id}/decide", s.authorized("automation.approval.decide", true, s.handleDecideAutomationApproval))

	s.mux.Handle("GET /api/automation/sessions", s.authorized("automation.session.view", false, s.handleListAutomationSessions))
	s.mux.Handle("GET /api/automation/sessions/{id}", s.authorized("automation.session.view", false, s.handleGetAutomationSession))

	s.mux.Handle("GET /api/automation/workers", s.authorized("automation.worker.view", false, s.handleListAutomationWorkers))
	s.mux.Handle("GET /api/automation/workers/{id}", s.authorized("automation.worker.view", false, s.handleGetAutomationWorker))
	s.mux.Handle("POST /api/automation/workers/{id}/action", s.authorized("automation.worker.manage", true, s.handleAutomationWorkerAction))
	s.mux.Handle("POST /api/automation/workers/{id}/commands", s.authorized("automation.worker.manage", true, s.handleCreateAutomationWorkerCommand))
	s.mux.Handle("GET /api/automation/agent-token", s.authorized("automation.worker.manage", false, s.handleGetAutomationAgentToken))
	s.mux.Handle("POST /api/automation/agent-token/rotate", s.authorized("automation.worker.manage", true, s.handleRotateAutomationAgentToken))
	s.mux.Handle("DELETE /api/automation/agent-token", s.authorized("automation.worker.manage", true, s.handleClearAutomationAgentToken))
	s.registerAutomationAgentRoutes()

	s.mux.Handle("GET /api/automation/credentials", s.authorized("automation.credential.view", false, s.handleListAutomationCredentials))
	s.mux.Handle("POST /api/automation/credentials", s.authorized("automation.credential.manage", true, s.handleCreateAutomationCredential))
	s.mux.Handle("PUT /api/automation/credentials/{id}", s.authorized("automation.credential.manage", true, s.handleUpdateAutomationCredential))
	s.mux.Handle("POST /api/automation/credentials/{id}/reset", s.authorized("automation.credential.manage", true, s.handleResetAutomationCredential))

	s.mux.Handle("GET /api/automation/ip-pool", s.authorized("automation.credential.view", false, s.handleListAutomationIPPool))
	s.mux.Handle("POST /api/automation/ip-pool", s.authorized("automation.credential.manage", true, s.handleCreateAutomationIP))
	s.mux.Handle("PUT /api/automation/ip-pool/{id}", s.authorized("automation.credential.manage", true, s.handleUpdateAutomationIP))

	s.mux.Handle("GET /api/automation/alerts", s.authorized("automation.alert.view", false, s.handleListAutomationAlerts))
	s.mux.Handle("POST /api/automation/alerts/{id}/handle", s.authorized("automation.alert.handle", true, s.handleAutomationAlertHandle))

	s.mux.Handle("GET /api/automation/audit", s.authorized("automation.audit.view", false, s.handleAutomationAudit))
}

// automationStrategyConfig 是机器人的「动作与智力」：怎么跑、怎么出牌。
// 进哪些房间、输赢目标归投放时配置，不放在策略里；0 / 空串表示不覆盖机器人自身配置。
// 字段全部有消费方：跑法进客户端环境变量，打牌阈值进 agent-client/strategy.js。
type automationStrategyConfig struct {
	// 跑法节奏
	BuyinMultiple    int `json:"buyinMultiple"`
	StayBuyinTimes   int `json:"stayBuyinTimes"`
	RoomAvoidMs      int `json:"roomAvoidMs"`
	SitTimeoutMs     int `json:"sitTimeoutMs"`
	ReinstateDelayMs int `json:"reinstateDelayMs"`
	RoomRetryMs      int `json:"roomRetryMs"`

	// 出牌节奏：替代客户端里写死的 1200–2500ms 与 6 秒
	ActionDelayMinMs int `json:"actionDelayMinMs"`
	ActionDelayMaxMs int `json:"actionDelayMaxMs"`
	DecideTimeoutMs  int `json:"decideTimeoutMs"`

	// 三档底皮的安全线（1P / 2P / 5P）
	Tiers map[string]automationStrategyTier `json:"tiers"`

	// 牌力判断
	BigPairFen     int `json:"bigPairFen"`
	WeakLowFen     int `json:"weakLowFen"`
	ProtectPairFen int `json:"protectPairFen"`
	ProtectBothFen int `json:"protectBothFen"`

	// 输赢控制
	WinStreakPause int     `json:"winStreakPause"`
	DeadbandRatio  float64 `json:"deadbandRatio"`
	AddMoreChance  float64 `json:"addMoreChance"`
}

// automationStrategyTier 是对应档位的三条安全线，语义与 strategy.js 完全一致。
type automationStrategyTier struct {
	MinG        int `json:"minG"`
	SafeGen     int `json:"safeGen"`
	NoAddGenMin int `json:"noAddGenMin"`
}

type automationStrategyItem struct {
	ID              int64           `json:"id"`
	Name            string          `json:"name"`
	Code            string          `json:"code"`
	Version         int             `json:"version"`
	PlayStyle       string          `json:"playStyle"`
	Status          string          `json:"status"`
	Config          json.RawMessage `json:"config"`
	PreviousVersion int             `json:"previousVersion"`
	UpdatedBy       string          `json:"updatedBy"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	GroupCount      int             `json:"groupCount"`
	RobotCount      int             `json:"robotCount"`
}

func (s *Server) handleListAutomationStrategies(w http.ResponseWriter, r *http.Request, p principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, code, version, play_style, status,
COALESCE(config_json, '{}'), previous_version, updated_by, updated_at,
(SELECT COUNT(*) FROM mgr_automation_group g WHERE g.strategy_id = s.id),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.strategy_id = s.id)
FROM mgr_automation_strategy s
ORDER BY id`)
	if err != nil {
		s.logger.Error("list automation strategies", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取策略失败")
		return
	}
	defer rows.Close()
	items := []automationStrategyItem{}
	for rows.Next() {
		var item automationStrategyItem
		var config string
		if err := rows.Scan(&item.ID, &item.Name, &item.Code, &item.Version, &item.PlayStyle, &item.Status,
			&config, &item.PreviousVersion, &item.UpdatedBy, &item.UpdatedAt, &item.GroupCount, &item.RobotCount); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取策略数据失败")
			return
		}
		if !json.Valid([]byte(config)) {
			config = "{}"
		}
		item.Config = json.RawMessage(config)
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

type automationStrategyRequest struct {
	Name      string                   `json:"name"`
	Code      string                   `json:"code"`
	PlayStyle string                   `json:"playStyle"`
	Config    automationStrategyConfig `json:"config"`
}

func validStrategyPairClick(value int) bool {
	switch value {
	case 0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 98, 99:
		return true
	}
	return false
}

func validStrategyDate(value string) bool {
	if value == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func validateAutomationStrategyConfig(config *automationStrategyConfig) string {
	// 跑法节奏：0 表示不覆盖机器人自身配置。
	if config.BuyinMultiple != 0 && (config.BuyinMultiple < 1 || config.BuyinMultiple > 10) {
		return "带入倍数必须在 1 到 10 之间（0 表示不设）"
	}
	if config.RoomRetryMs != 0 && (config.RoomRetryMs < 1000 || config.RoomRetryMs > 600000) {
		return "找房间隔必须在 1,000 到 600,000 毫秒之间"
	}
	if config.SitTimeoutMs != 0 && (config.SitTimeoutMs < 1000 || config.SitTimeoutMs > 120000) {
		return "坐下超时必须在 1,000 到 120,000 毫秒之间"
	}
	if config.ReinstateDelayMs != 0 && (config.ReinstateDelayMs < 1000 || config.ReinstateDelayMs > 600000) {
		return "再次带入节流必须在 1,000 到 600,000 毫秒之间"
	}
	if config.RoomAvoidMs != 0 && (config.RoomAvoidMs < 60000 || config.RoomAvoidMs > 86400000) {
		return "房间避让时长必须在 60,000 到 86,400,000 毫秒之间"
	}
	if config.StayBuyinTimes < 0 || config.StayBuyinTimes > 20 {
		return "原房连输次数必须在 0 到 20 之间"
	}
	// 出牌节奏
	if config.ActionDelayMinMs != 0 && (config.ActionDelayMinMs < 500 || config.ActionDelayMinMs > 10000) {
		return "出牌最短间隔必须在 500 到 10,000 毫秒之间"
	}
	if config.ActionDelayMaxMs != 0 && (config.ActionDelayMaxMs < 500 || config.ActionDelayMaxMs > 10000) {
		return "出牌最长间隔必须在 500 到 10,000 毫秒之间"
	}
	if config.ActionDelayMinMs != 0 && config.ActionDelayMaxMs != 0 && config.ActionDelayMinMs > config.ActionDelayMaxMs {
		return "出牌最短间隔不能大于最长间隔"
	}
	if config.DecideTimeoutMs != 0 && (config.DecideTimeoutMs < 2000 || config.DecideTimeoutMs > 30000) {
		return "决策超时必须在 2,000 到 30,000 毫秒之间"
	}
	// 三档安全线：只允许 1 / 2 / 5 三个档位
	for key, tier := range config.Tiers {
		if key != "1" && key != "2" && key != "5" {
			return "安全线档位只能是 1、2、5"
		}
		if tier.MinG < 0 || tier.MinG > 10000 {
			return "底皮 " + key + " 的最低跟注线必须在 0 到 10,000 之间"
		}
		if tier.SafeGen < 0 || tier.SafeGen > 10000 {
			return "底皮 " + key + " 的安全线必须在 0 到 10,000 之间"
		}
		if tier.NoAddGenMin < 0 || tier.NoAddGenMin > 100 {
			return "底皮 " + key + " 的便宜跟注线必须在 0 到 100 之间"
		}
	}
	// 牌力阈值
	if config.BigPairFen != 0 && (config.BigPairFen < 1 || config.BigPairFen > 21) {
		return "大牌线必须在 1 到 21 之间"
	}
	if config.WeakLowFen != 0 && (config.WeakLowFen < 1 || config.WeakLowFen > 21) {
		return "小门改扯线必须在 1 到 21 之间"
	}
	if config.ProtectPairFen != 0 && (config.ProtectPairFen < 1 || config.ProtectPairFen > 21) {
		return "单门保护线必须在 1 到 21 之间"
	}
	if config.ProtectBothFen != 0 && (config.ProtectBothFen < 1 || config.ProtectBothFen > 21) {
		return "双门保护线必须在 1 到 21 之间"
	}
	// 输赢控制
	if config.WinStreakPause < 0 || config.WinStreakPause > 20 {
		return "连赢降级局数必须在 0 到 20 之间"
	}
	if config.DeadbandRatio < 0 || config.DeadbandRatio > 1 {
		return "目标死区比例必须在 0 到 1 之间"
	}
	if config.AddMoreChance < 0 || config.AddMoreChance > 1 {
		return "超目标加注概率必须在 0 到 1 之间"
	}
	return ""
}

func (s *Server) validateAutomationStrategy(w http.ResponseWriter, input *automationStrategyRequest, creating bool) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.Code = strings.TrimSpace(input.Code)
	// 出牌风格和策略编码都不再让运营填：风格固定均衡，编码按名称+时间自动生成。
	input.PlayStyle = "balanced"
	if input.Name == "" || len([]rune(input.Name)) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "策略名称不能为空且不能超过 64 个字符")
		return false
	}
	if creating {
		// 编码只做内部唯一键：时间到秒 + 毫秒三位，避免中文名转拼音踩坑。
		now := time.Now()
		input.Code = fmt.Sprintf("s%s%03d", now.Format("20060102150405"), now.Nanosecond()/1000000)
	}
	if message := validateAutomationStrategyConfig(&input.Config); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_CONFIG", message)
		return false
	}
	return true
}

func (s *Server) handleCreateAutomationStrategy(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationStrategyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.validateAutomationStrategy(w, &input, true) {
		return
	}
	configBody, err := json.Marshal(input.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CONFIG", "策略参数格式不正确")
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_strategy
(name, code, version, play_style, status, config_json, updated_by, is_demo)
VALUES (?, ?, 1, ?, 'draft', ?, ?, 0)`,
		input.Name, input.Code, input.PlayStyle, string(configBody), automationOperator(p))
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "STRATEGY_EXISTS", "策略编码已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建策略失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "automation.strategy.create", "automation_strategy", strconv.FormatInt(id, 10), input, nil, input, 0, "策略草稿已创建", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "策略草稿已创建"})
}

func (s *Server) handleUpdateAutomationStrategy(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "策略 ID 不正确")
	if !ok {
		return
	}
	var input automationStrategyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.validateAutomationStrategy(w, &input, false) {
		return
	}
	var beforeName, beforeStyle, beforeStatus, beforeConfig string
	var beforeVersion int
	if err := s.db.QueryRowContext(r.Context(), `SELECT name, play_style, status, COALESCE(config_json, '{}'), version
FROM mgr_automation_strategy WHERE id = ?`, id).
		Scan(&beforeName, &beforeStyle, &beforeStatus, &beforeConfig, &beforeVersion); err != nil {
		writeError(w, http.StatusNotFound, "STRATEGY_NOT_FOUND", "没有找到这个策略")
		return
	}
	configBody, _ := json.Marshal(input.Config)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_strategy
SET name = ?, play_style = ?, status = 'draft', previous_config_json = config_json,
previous_version = version, version = version + 1, config_json = ?, updated_by = ?
WHERE id = ?`, input.Name, input.PlayStyle, string(configBody), automationOperator(p), id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存策略失败")
		return
	}
	before := map[string]any{"name": beforeName, "playStyle": beforeStyle, "status": beforeStatus, "version": beforeVersion, "config": json.RawMessage(beforeConfig)}
	after := map[string]any{"name": input.Name, "playStyle": input.PlayStyle, "status": "draft", "version": beforeVersion + 1, "config": input.Config}
	s.audit(r.Context(), &p, "automation.strategy.update", "automation_strategy", strconv.FormatInt(id, 10), input, before, after, 0,
		fmt.Sprintf("策略已更新到 v%d，等待发布", beforeVersion+1), clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"version": beforeVersion + 1, "message": fmt.Sprintf("策略已保存为 v%d 草稿，发布前不会变更线上版本", beforeVersion+1)})
}

func (s *Server) handlePublishAutomationStrategy(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "策略 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Scope string `json:"scope"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Scope != "gray" && input.Scope != "all" {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "发布范围必须是灰度或全量")
		return
	}
	var name, status string
	var version int
	if err := s.db.QueryRowContext(r.Context(), "SELECT name, status, version FROM mgr_automation_strategy WHERE id = ?", id).
		Scan(&name, &status, &version); err != nil {
		writeError(w, http.StatusNotFound, "STRATEGY_NOT_FOUND", "没有找到这个策略")
		return
	}
	nextStatus := "gray"
	if input.Scope == "all" {
		nextStatus = "enabled"
	}
	if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_strategy SET status = ?, updated_by = ? WHERE id = ?", nextStatus, automationOperator(p), id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "发布策略失败")
		return
	}
	label := "灰度发布"
	if input.Scope == "all" {
		label = "全量发布"
	}
	s.audit(r.Context(), &p, "automation.strategy.publish", "automation_strategy", strconv.FormatInt(id, 10), input,
		map[string]any{"status": status}, map[string]any{"status": nextStatus}, 0,
		fmt.Sprintf("策略 %s v%d 已%s", name, version, label), clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": fmt.Sprintf("策略 %s 已%s", name, label)})
}

func (s *Server) handleRollbackAutomationStrategy(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "策略 ID 不正确")
	if !ok {
		return
	}
	var currentConfig, previousConfig string
	var currentVersion, previousVersion int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(config_json, '{}'), COALESCE(previous_config_json, '{}'), version, previous_version
FROM mgr_automation_strategy WHERE id = ?`, id).
		Scan(&currentConfig, &previousConfig, &currentVersion, &previousVersion); err != nil {
		writeError(w, http.StatusNotFound, "STRATEGY_NOT_FOUND", "没有找到这个策略")
		return
	}
	if previousVersion <= 0 || previousConfig == "" {
		writeError(w, http.StatusConflict, "NO_PREVIOUS_VERSION", "这个策略没有可回滚的历史版本")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_strategy
SET config_json = ?, version = ?, previous_config_json = ?, previous_version = ?, status = 'draft', updated_by = ?
WHERE id = ?`, previousConfig, previousVersion, currentConfig, currentVersion, automationOperator(p), id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "回滚策略失败")
		return
	}
	s.audit(r.Context(), &p, "automation.strategy.rollback", "automation_strategy", strconv.FormatInt(id, 10), nil,
		map[string]any{"version": currentVersion}, map[string]any{"version": previousVersion}, 0,
		fmt.Sprintf("策略已回滚到 v%d 草稿", previousVersion), clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"version": previousVersion, "message": fmt.Sprintf("已回滚到 v%d，确认后需要重新发布", previousVersion)})
}

type automationTaskItem struct {
	ID         int64      `json:"id"`
	TaskNo     string     `json:"taskNo"`
	Type       string     `json:"type"`
	TargetType string     `json:"targetType"`
	TargetID   string     `json:"targetId"`
	Params     string     `json:"params"`
	Status     string     `json:"status"`
	Priority   int        `json:"priority"`
	Total      int        `json:"total"`
	Succeeded  int        `json:"succeeded"`
	Failed     int        `json:"failed"`
	CreatedBy  string     `json:"createdBy"`
	StartedAt  *time.Time `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

func (s *Server) handleListAutomationTasks(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	taskType := strings.TrimSpace(r.URL.Query().Get("type"))
	conditions := []string{"1 = 1"}
	args := []any{}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if taskType != "" {
		conditions = append(conditions, "type = ?")
		args = append(args, taskType)
	}
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_task WHERE "+where, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取任务数量失败")
		return
	}
	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, task_no, type, target_type, target_id, COALESCE(params_json, '{}'),
status, priority, total, succeeded, failed, created_by, started_at, finished_at, created_at
FROM mgr_automation_task WHERE `+where+`
ORDER BY id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取任务失败")
		return
	}
	defer rows.Close()
	items := []automationTaskItem{}
	for rows.Next() {
		var item automationTaskItem
		var started, finished sql.NullTime
		if err := rows.Scan(&item.ID, &item.TaskNo, &item.Type, &item.TargetType, &item.TargetID, &item.Params,
			&item.Status, &item.Priority, &item.Total, &item.Succeeded, &item.Failed, &item.CreatedBy,
			&started, &finished, &item.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取任务数据失败")
			return
		}
		if started.Valid {
			item.StartedAt = &started.Time
		}
		if finished.Valid {
			item.FinishedAt = &finished.Time
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

type automationTaskRequest struct {
	Type       string          `json:"type"`
	TargetType string          `json:"targetType"`
	TargetID   string          `json:"targetId"`
	Params     json.RawMessage `json:"params"`
	Priority   int             `json:"priority"`
}

func (s *Server) handleCreateAutomationTask(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationTaskRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Type = strings.TrimSpace(input.Type)
	input.TargetType = strings.TrimSpace(input.TargetType)
	input.TargetID = strings.TrimSpace(input.TargetID)
	allowedTypes := map[string]bool{"enter_room": true, "fill_seat": true, "play_rounds": true, "leave_room": true, "switch_room": true, "restart": true, "snapshot": true}
	if !allowedTypes[input.Type] {
		writeError(w, http.StatusBadRequest, "INVALID_TASK_TYPE", "不支持的任务类型")
		return
	}
	if input.TargetType != "robot" && input.TargetType != "group" && input.TargetType != "club" {
		writeError(w, http.StatusBadRequest, "INVALID_TARGET", "任务目标必须是终端、组或俱乐部")
		return
	}
	if input.Priority < 1 || input.Priority > 9 {
		input.Priority = 5
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	total := 0
	targetClub := ""
	switch input.TargetType {
	case "robot":
		id, err := strconv.ParseInt(input.TargetID, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusBadRequest, "INVALID_TARGET", "终端 ID 不正确")
			return
		}
		var clubID string
		if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_robot WHERE id = ?", id).Scan(&clubID); err != nil {
			writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "任务目标终端不存在")
			return
		}
		if !s.automationClubOrError(w, r, scope, clubID) {
			return
		}
		targetClub = clubID
		total = 1
	case "group":
		id, err := strconv.ParseInt(input.TargetID, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusBadRequest, "INVALID_TARGET", "组 ID 不正确")
			return
		}
		var clubID string
		if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_group WHERE id = ?", id).Scan(&clubID); err != nil {
			writeError(w, http.StatusNotFound, "GROUP_NOT_FOUND", "任务目标组不存在")
			return
		}
		if !s.automationClubOrError(w, r, scope, clubID) {
			return
		}
		targetClub = clubID
		_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE group_id = ?", id).Scan(&total)
	case "club":
		if !s.automationClubOrError(w, r, scope, input.TargetID) {
			return
		}
		targetClub = input.TargetID
		_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE club_id = ?", input.TargetID).Scan(&total)
	}
	if input.Type == "enter_room" {
		var payload struct {
			RoomID int64 `json:"roomId"`
		}
		if len(input.Params) > 0 {
			_ = json.Unmarshal(input.Params, &payload)
		}
		if payload.RoomID <= 0 {
			writeError(w, http.StatusBadRequest, "ROOM_REQUIRED", "进房任务需要在参数里填写 roomId")
			return
		}
		var roomClub string
		if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_room_snapshot WHERE room_id = ?", payload.RoomID).Scan(&roomClub); err != nil {
			writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "任务目标房间不存在")
			return
		}
		if !s.automationClubOrError(w, r, scope, roomClub) {
			return
		}
		if targetClub != "" && roomClub != targetClub {
			writeError(w, http.StatusBadRequest, "CLUB_MISMATCH", "任务目标与房间不属于同一个俱乐部")
			return
		}
	}
	status := "success"
	succeeded, failed := total, 0
	if total == 0 {
		status = "failed"
		succeeded = 0
		failed = 1
	}
	params := "{}"
	if len(input.Params) > 0 && json.Valid(input.Params) {
		params = string(input.Params)
	}
	taskNo := "TASK-" + time.Now().Format("20060102-150405") + "-" + strconv.FormatInt(time.Now().UnixNano()%1000, 10)
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_task
(task_no, type, target_type, target_id, params_json, status, priority, total, succeeded, failed,
created_by, started_at, finished_at, is_demo)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0)`,
		taskNo, input.Type, input.TargetType, input.TargetID, params, status, input.Priority,
		total, succeeded, failed, automationOperator(p))
	if err != nil {
		s.logger.Error("create automation task", "error", err)
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建任务失败")
		return
	}
	id, _ := result.LastInsertId()
	message := fmt.Sprintf("任务已下发，覆盖 %d 台终端", total)
	if total == 0 {
		message = "目标范围当前没有可执行终端，任务标记为失败"
	}
	s.audit(r.Context(), &p, "automation.task.create", "automation_task", strconv.FormatInt(id, 10), input, nil, input, 0, message, clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "taskNo": taskNo, "total": total, "message": message})
}

func (s *Server) handleCancelAutomationTask(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "任务 ID 不正确")
	if !ok {
		return
	}
	var status string
	if err := s.db.QueryRowContext(r.Context(), "SELECT status FROM mgr_automation_task WHERE id = ?", id).Scan(&status); err != nil {
		writeError(w, http.StatusNotFound, "TASK_NOT_FOUND", "没有找到这个任务")
		return
	}
	if status != "queued" && status != "running" {
		writeError(w, http.StatusConflict, "TASK_NOT_CANCELLABLE", "只有排队中或执行中的任务可以取消")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_task SET status = 'cancelled', finished_at = NOW() WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "取消任务失败")
		return
	}
	s.audit(r.Context(), &p, "automation.task.cancel", "automation_task", strconv.FormatInt(id, 10), nil, map[string]any{"status": status}, map[string]any{"status": "cancelled"}, 0, "任务已取消", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "任务已取消"})
}

func (s *Server) handleRetryAutomationTask(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "任务 ID 不正确")
	if !ok {
		return
	}
	var status string
	var total int
	if err := s.db.QueryRowContext(r.Context(), "SELECT status, total FROM mgr_automation_task WHERE id = ?", id).Scan(&status, &total); err != nil {
		writeError(w, http.StatusNotFound, "TASK_NOT_FOUND", "没有找到这个任务")
		return
	}
	if status != "failed" && status != "cancelled" {
		writeError(w, http.StatusConflict, "TASK_NOT_RETRYABLE", "只有失败或已取消的任务可以重试")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_task
SET status = 'success', succeeded = total, failed = 0, started_at = NOW(), finished_at = NOW() WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "重试任务失败")
		return
	}
	s.audit(r.Context(), &p, "automation.task.retry", "automation_task", strconv.FormatInt(id, 10), nil, map[string]any{"status": status}, map[string]any{"status": "success"}, 0, "任务已重新下发", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "任务已重新下发，覆盖 " + strconv.Itoa(total) + " 台终端"})
}

func (s *Server) handleListAutomationApprovals(w http.ResponseWriter, r *http.Request, p principal) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items, err := s.queryAutomationApprovals(r.Context(), status, 100, 0)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取审批单失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleDecideAutomationApproval(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "审批单 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	var action, targetType, targetID, params, status string
	var requesterID sql.NullInt64
	if err := s.db.QueryRowContext(r.Context(), `SELECT action, target_type, target_id, COALESCE(params_json, '{}'),
status, requester_id FROM mgr_automation_approval WHERE id = ?`, id).
		Scan(&action, &targetType, &targetID, &params, &status, &requesterID); err != nil {
		writeError(w, http.StatusNotFound, "APPROVAL_NOT_FOUND", "没有找到这个审批单")
		return
	}
	if status != "pending" {
		writeError(w, http.StatusConflict, "APPROVAL_DECIDED", "这个审批单已经处理过")
		return
	}
	if requesterID.Valid && requesterID.Int64 == p.ID && !p.IsSuper {
		writeError(w, http.StatusForbidden, "SELF_APPROVAL", "不能审批自己发起的操作")
		return
	}
	scope, _ := s.automationScope(r.Context(), p)
	message := "审批已驳回"
	nextStatus := "rejected"
	if input.Approve {
		if err := s.executeAutomationApproval(r, scope, action, targetID, params); err != nil {
			s.logger.Error("execute automation approval", "error", err, "approvalId", id, "action", action)
			writeError(w, http.StatusInternalServerError, "APPROVAL_EXECUTE_FAILED", "审批已通过，但执行失败："+err.Error())
			return
		}
		message = "审批已通过并执行"
		nextStatus = "approved"
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_approval
SET status = ?, approver_id = ?, approver_name = ?, decided_at = NOW(),
reason = CONCAT(reason, ?) WHERE id = ?`,
		nextStatus, p.ID, automationOperator(p), approvalNote(input.Reason), id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存审批结果失败")
		return
	}
	s.audit(r.Context(), &p, "automation.approval."+nextStatus, "automation_approval", strconv.FormatInt(id, 10),
		input, map[string]any{"status": "pending"}, map[string]any{"status": nextStatus}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message, "status": nextStatus})
}

func approvalNote(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ""
	}
	if len([]rune(reason)) > 100 {
		reason = string([]rune(reason)[:100])
	}
	return "；审批备注：" + reason
}

func (s *Server) executeAutomationApproval(r *http.Request, scope automationScope, action, targetID, params string) error {
	switch action {
	case "robot.batch_stop", "robot.batch_drain", "robot.delete":
		ids, err := decodeAutomationIDs(params)
		if err != nil {
			return errors.New("审批参数不完整")
		}
		type approvalRobot struct {
			id     int64
			roomID sql.NullInt64
		}
		targets := make([]approvalRobot, 0, len(ids))
		for _, robotID := range ids {
			var clubID string
			var roomID sql.NullInt64
			if err := s.db.QueryRowContext(r.Context(), "SELECT club_id, room_id FROM mgr_automation_robot WHERE id = ?", robotID).
				Scan(&clubID, &roomID); err != nil {
				continue
			}
			if !scope.Allows(clubID) {
				return fmt.Errorf("终端 %d 超出审批人数据范围", robotID)
			}
			targets = append(targets, approvalRobot{id: robotID, roomID: roomID})
		}
		endReason := "approval"
		if action == "robot.batch_drain" {
			endReason = "drain"
		}
		for _, target := range targets {
			if target.roomID.Valid {
				if err := s.releaseAutomationRobotSeat(r, target.id, endReason, "stopped"); err != nil {
					return err
				}
			}
			if action == "robot.delete" {
				if _, err := s.db.ExecContext(r.Context(), "DELETE FROM mgr_automation_robot WHERE id = ?", target.id); err != nil {
					return err
				}
			} else {
				if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_robot SET status = 'stopped', desired_status = 'stopped' WHERE id = ?", target.id); err != nil {
					return err
				}
			}
		}
		return nil
	case "strategy.publish":
		var payload struct {
			ID    int64  `json:"id"`
			Scope string `json:"scope"`
		}
		if err := json.Unmarshal([]byte(params), &payload); err != nil || payload.ID <= 0 {
			return errors.New("审批参数不完整")
		}
		nextStatus := "gray"
		if payload.Scope == "all" {
			nextStatus = "enabled"
		}
		_, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_strategy SET status = ? WHERE id = ?", nextStatus, payload.ID)
		return err
	}
	return errors.New("不支持的审批操作")
}

type automationSessionItem struct {
	ID         int64      `json:"id"`
	RobotID    int64      `json:"robotId"`
	TerminalNo string     `json:"terminalNo"`
	Nickname   string     `json:"nickname"`
	ClubID     string     `json:"clubId"`
	ClubName   string     `json:"clubName"`
	RoomID     int64      `json:"roomId"`
	SeatNo     int        `json:"seatNo"`
	StartedAt  time.Time  `json:"startedAt"`
	EndedAt    *time.Time `json:"endedAt"`
	Rounds     int        `json:"rounds"`
	Buyin      int        `json:"buyin"`
	NetWin     int64      `json:"netWin"`
	EndReason  string     `json:"endReason"`
}

func (s *Server) queryAutomationSessions(r *http.Request, scope automationScope, clubID string, robotID int64, status string, limit, offset int) ([]automationSessionItem, error) {
	conditions := []string{}
	args := []any{}
	scopeSQL, scopeArgs := scopeClause("ss.club_id", scope)
	conditions = append(conditions, scopeSQL)
	args = append(args, scopeArgs...)
	if clubID != "" {
		conditions = append(conditions, "ss.club_id = ?")
		args = append(args, clubID)
	}
	if robotID > 0 {
		conditions = append(conditions, "ss.robot_id = ?")
		args = append(args, robotID)
	}
	if status == "active" {
		conditions = append(conditions, "ss.ended_at IS NULL")
	} else if status == "ended" {
		conditions = append(conditions, "ss.ended_at IS NOT NULL")
	}
	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(r.Context(), `SELECT ss.id, ss.robot_id, COALESCE(r.terminal_no, ''), COALESCE(r.nickname, ''),
ss.club_id, COALESCE(c.name, ''), ss.room_id, ss.seat_no, ss.started_at, ss.ended_at,
ss.rounds, ss.buyin, ss.net_win, ss.end_reason
FROM mgr_automation_session ss
LEFT JOIN mgr_automation_robot r ON r.id = ss.robot_id
LEFT JOIN mgr_automation_club c ON c.club_id = ss.club_id
WHERE `+strings.Join(conditions, " AND ")+`
ORDER BY ss.started_at DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationSessionItem{}
	for rows.Next() {
		var item automationSessionItem
		var ended sql.NullTime
		if err := rows.Scan(&item.ID, &item.RobotID, &item.TerminalNo, &item.Nickname,
			&item.ClubID, &item.ClubName, &item.RoomID, &item.SeatNo, &item.StartedAt, &ended,
			&item.Rounds, &item.Buyin, &item.NetWin, &item.EndReason); err != nil {
			return nil, err
		}
		if ended.Valid {
			item.EndedAt = &ended.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleListAutomationSessions(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	page, size := pageParams(r)
	clubID := strings.TrimSpace(r.URL.Query().Get("clubId"))
	if clubID != "" && !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	robotID, _ := strconv.ParseInt(r.URL.Query().Get("robotId"), 10, 64)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items, err := s.queryAutomationSessions(r, scope, clubID, robotID, status, size, (page-1)*size)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取对局记录失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size})
}

func (s *Server) handleGetAutomationSession(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "会话 ID 不正确")
	if !ok {
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var item automationSessionItem
	var ended sql.NullTime
	if err := s.db.QueryRowContext(r.Context(), `SELECT ss.id, ss.robot_id, COALESCE(r.terminal_no, ''), COALESCE(r.nickname, ''),
ss.club_id, COALESCE(c.name, ''), ss.room_id, ss.seat_no, ss.started_at, ss.ended_at,
ss.rounds, ss.buyin, ss.net_win, ss.end_reason
FROM mgr_automation_session ss
LEFT JOIN mgr_automation_robot r ON r.id = ss.robot_id
LEFT JOIN mgr_automation_club c ON c.club_id = ss.club_id
WHERE ss.id = ?`, id).Scan(&item.ID, &item.RobotID, &item.TerminalNo, &item.Nickname,
		&item.ClubID, &item.ClubName, &item.RoomID, &item.SeatNo, &item.StartedAt, &ended,
		&item.Rounds, &item.Buyin, &item.NetWin, &item.EndReason); err != nil {
		writeError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "没有找到这个会话")
		return
	}
	if !s.automationClubOrError(w, r, scope, item.ClubID) {
		return
	}
	if ended.Valid {
		item.EndedAt = &ended.Time
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT event_at, event_type, detail
FROM mgr_automation_session_event WHERE session_id = ? ORDER BY id`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取会话事件失败")
		return
	}
	defer rows.Close()
	events := []map[string]any{}
	for rows.Next() {
		var at time.Time
		var eventType, detail string
		if err := rows.Scan(&at, &eventType, &detail); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取会话事件失败")
			return
		}
		events = append(events, map[string]any{"at": at, "type": eventType, "detail": detail})
	}
	writeData(w, http.StatusOK, map[string]any{"session": item, "events": events})
}

type automationWorkerItem struct {
	ID            int64      `json:"id"`
	NodeCode      string     `json:"nodeCode"`
	Host          string     `json:"host"`
	OS            string     `json:"os"`
	Version       string     `json:"version"`
	Status        string     `json:"status"`
	RobotCount    int        `json:"robotCount"`
	MaxRobots     int        `json:"maxRobots"`
	CPUPct        int        `json:"cpuPct"`
	MemPct        int        `json:"memPct"`
	EgressCIDR    string     `json:"egressCidr"`
	LastHeartbeat *time.Time `json:"lastHeartbeat"`
	IsDemo        bool       `json:"isDemo"`
}

func (s *Server) queryAutomationWorkers(ctx context.Context) ([]automationWorkerItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, node_code, host, os, version,
CASE WHEN status = 'online' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()) THEN 'offline' ELSE status END,
robot_count, max_robots, cpu_pct, mem_pct, egress_cidr, last_heartbeat, is_demo
FROM mgr_automation_worker ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationWorkerItem{}
	for rows.Next() {
		var item automationWorkerItem
		var heartbeat sql.NullTime
		var isDemo int
		if err := rows.Scan(&item.ID, &item.NodeCode, &item.Host, &item.OS, &item.Version, &item.Status,
			&item.RobotCount, &item.MaxRobots, &item.CPUPct, &item.MemPct, &item.EgressCIDR, &heartbeat, &isDemo); err != nil {
			return nil, err
		}
		if heartbeat.Valid {
			item.LastHeartbeat = &heartbeat.Time
		}
		item.IsDemo = isDemo == 1
		items = append(items, item)
	}
	return items, rows.Err()
}

type automationCredentialItem struct {
	ID               int64      `json:"id"`
	Account          string     `json:"account"`
	ClubID           string     `json:"clubId"`
	ClubName         string     `json:"clubName"`
	Status           string     `json:"status"`
	SecretConfigured bool       `json:"secretConfigured"`
	LastLogin        *time.Time `json:"lastLogin"`
	FailCount        int        `json:"failCount"`
	Remark           string     `json:"remark"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

func (s *Server) handleListAutomationCredentials(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	conditions := []string{}
	args := []any{}
	scopeSQL, scopeArgs := scopeClause("cred.club_id", scope)
	conditions = append(conditions, scopeSQL)
	args = append(args, scopeArgs...)
	if keyword != "" {
		conditions = append(conditions, "cred.account LIKE ?")
		args = append(args, "%"+keyword+"%")
	}
	if status != "" {
		conditions = append(conditions, "cred.status = ?")
		args = append(args, status)
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT cred.id, cred.account, cred.club_id, COALESCE(c.name, ''),
cred.status, cred.secret_configured, cred.last_login, cred.fail_count, cred.remark, cred.updated_at
FROM mgr_automation_credential cred
LEFT JOIN mgr_automation_club c ON c.club_id = cred.club_id
WHERE `+strings.Join(conditions, " AND ")+`
ORDER BY cred.id`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取凭据失败")
		return
	}
	defer rows.Close()
	items := []automationCredentialItem{}
	for rows.Next() {
		var item automationCredentialItem
		var secret int
		var lastLogin sql.NullTime
		if err := rows.Scan(&item.ID, &item.Account, &item.ClubID, &item.ClubName, &item.Status,
			&secret, &lastLogin, &item.FailCount, &item.Remark, &item.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取凭据数据失败")
			return
		}
		item.SecretConfigured = secret == 1
		if lastLogin.Valid {
			item.LastLogin = &lastLogin.Time
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateAutomationCredential(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		Account  string `json:"account"`
		ClubID   string `json:"clubId"`
		Password string `json:"password"`
		Remark   string `json:"remark"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Account = strings.TrimSpace(input.Account)
	input.Remark = strings.TrimSpace(input.Remark)
	scope, err := s.automationScope(r.Context(), p)
	if err != nil || !s.automationClubOrError(w, r, scope, input.ClubID) {
		return
	}
	if len(input.Account) < 4 || len(input.Account) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_ACCOUNT", "游戏账号必须为 4 到 64 个字符")
		return
	}
	if len(input.Password) < 4 || len(input.Password) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", "密码必须为 4 到 64 个字符，且不会保存明文")
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_credential
(account, club_id, status, secret_configured, remark, is_demo)
VALUES (?, ?, 'configured', 1, ?, 0)`, input.Account, input.ClubID, input.Remark)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "CREDENTIAL_EXISTS", "这个游戏账号的凭据已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "导入凭据失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "automation.credential.create", "automation_credential", strconv.FormatInt(id, 10),
		map[string]any{"account": input.Account, "clubId": input.ClubID, "remark": input.Remark}, nil,
		map[string]any{"account": input.Account, "clubId": input.ClubID}, 0, "凭据已导入，未记录明文密码", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "凭据已导入，后台不会回显或记录明文密码"})
}

func (s *Server) handleUpdateAutomationCredential(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "凭据 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		ClubID string `json:"clubId"`
		Status string `json:"status"`
		Remark string `json:"remark"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Remark = strings.TrimSpace(input.Remark)
	scope, err := s.automationScope(r.Context(), p)
	if err != nil || !s.automationClubOrError(w, r, scope, input.ClubID) {
		return
	}
	if input.Status != "configured" && input.Status != "missing" && input.Status != "locked" {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "凭据状态不正确")
		return
	}
	var currentClub string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_credential WHERE id = ?", id).Scan(&currentClub); err != nil {
		writeError(w, http.StatusNotFound, "CREDENTIAL_NOT_FOUND", "没有找到这个凭据")
		return
	}
	if !s.automationClubOrError(w, r, scope, currentClub) {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_credential SET club_id = ?, status = ?, remark = ? WHERE id = ?",
		input.ClubID, input.Status, input.Remark, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存凭据失败")
		return
	}
	s.audit(r.Context(), &p, "automation.credential.update", "automation_credential", strconv.FormatInt(id, 10), input, map[string]any{"clubId": currentClub}, input, 0, "凭据资料已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "凭据资料已保存"})
}

func (s *Server) handleResetAutomationCredential(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "凭据 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if len(input.Password) < 4 || len(input.Password) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", "新密码必须为 4 到 64 个字符")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var clubID string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_credential WHERE id = ?", id).Scan(&clubID); err != nil {
		writeError(w, http.StatusNotFound, "CREDENTIAL_NOT_FOUND", "没有找到这个凭据")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_credential
SET secret_configured = 1, status = 'configured', fail_count = 0, last_login = NOW() WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "重置凭据失败")
		return
	}
	s.audit(r.Context(), &p, "automation.credential.reset", "automation_credential", strconv.FormatInt(id, 10), nil, nil, nil, 0, "凭据已重置，未记录明文密码", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "凭据已重置为已配置状态（演示环境不会保存明文）"})
}

type automationIPItem struct {
	ID          int64     `json:"id"`
	IP          string    `json:"ip"`
	Region      string    `json:"region"`
	BoundCount  int       `json:"boundCount"`
	MaxCount    int       `json:"maxCount"`
	Health      string    `json:"health"`
	BannedCount int       `json:"bannedCount"`
	Remark      string    `json:"remark"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (s *Server) handleListAutomationIPPool(w http.ResponseWriter, r *http.Request, p principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, ip, region, bound_count, max_count, health, banned_count, remark, updated_at
FROM mgr_automation_ip_pool ORDER BY id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 IP 池失败")
		return
	}
	defer rows.Close()
	items := []automationIPItem{}
	for rows.Next() {
		var item automationIPItem
		if err := rows.Scan(&item.ID, &item.IP, &item.Region, &item.BoundCount, &item.MaxCount,
			&item.Health, &item.BannedCount, &item.Remark, &item.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 IP 池失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateAutomationIP(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		IP       string `json:"ip"`
		Region   string `json:"region"`
		MaxCount int    `json:"maxCount"`
		Remark   string `json:"remark"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.IP = strings.TrimSpace(input.IP)
	input.Region = strings.TrimSpace(input.Region)
	input.Remark = strings.TrimSpace(input.Remark)
	if net.ParseIP(input.IP) == nil {
		writeError(w, http.StatusBadRequest, "INVALID_IP", "IP 格式不正确")
		return
	}
	if input.MaxCount < 1 || input.MaxCount > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_MAX", "单 IP 终端上限必须在 1 到 64 之间")
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_ip_pool
(ip, region, bound_count, max_count, health, banned_count, remark, is_demo)
VALUES (?, ?, 0, ?, 'healthy', 0, ?, 0)`, input.IP, input.Region, input.MaxCount, input.Remark)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "IP_EXISTS", "这个 IP 已经在池中")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "新增 IP 失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "automation.ip.create", "automation_ip", strconv.FormatInt(id, 10), input, nil, input, 0, "出口 IP 已加入池", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "出口 IP 已加入池"})
}

func (s *Server) handleUpdateAutomationIP(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "IP 记录 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Region   string `json:"region"`
		MaxCount int    `json:"maxCount"`
		Health   string `json:"health"`
		Remark   string `json:"remark"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Region = strings.TrimSpace(input.Region)
	input.Remark = strings.TrimSpace(input.Remark)
	if input.MaxCount < 1 || input.MaxCount > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_MAX", "单 IP 终端上限必须在 1 到 64 之间")
		return
	}
	if input.Health != "healthy" && input.Health != "risk" && input.Health != "banned" {
		writeError(w, http.StatusBadRequest, "INVALID_HEALTH", "IP 健康状态不正确")
		return
	}
	result, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_ip_pool
SET region = ?, max_count = ?, health = ?, remark = ? WHERE id = ?`,
		input.Region, input.MaxCount, input.Health, input.Remark, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存 IP 失败")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeError(w, http.StatusNotFound, "IP_NOT_FOUND", "没有找到这个 IP 记录")
		return
	}
	s.audit(r.Context(), &p, "automation.ip.update", "automation_ip", strconv.FormatInt(id, 10), input, nil, input, 0, "出口 IP 配置已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "出口 IP 配置已保存"})
}

func (s *Server) handleListAutomationAlerts(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	page, size := pageParams(r)
	level := strings.TrimSpace(r.URL.Query().Get("level"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	clause, args := alertScopeClause(scope)
	conditions := []string{clause}
	if level != "" {
		conditions = append(conditions, "level = ?")
		args = append(args, level)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if keyword != "" {
		conditions = append(conditions, "(title LIKE ? OR detail LIKE ? OR target_id LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like)
	}
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_alert WHERE "+where, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取告警数量失败")
		return
	}
	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, level, category, target_type, target_id, title, detail,
status, assignee, note, first_seen, last_seen, resolved_at
FROM mgr_automation_alert WHERE `+where+`
ORDER BY FIELD(status, 'open', 'ack', 'resolved', 'ignored'), FIELD(level, 'P0', 'P1', 'P2'), last_seen DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取告警失败")
		return
	}
	defer rows.Close()
	items := []automationAlertItem{}
	for rows.Next() {
		item, err := scanAutomationAlert(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取告警数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func (s *Server) handleAutomationAlertHandle(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "告警 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Note = strings.TrimSpace(input.Note)
	if len([]rune(input.Note)) > 300 {
		writeError(w, http.StatusBadRequest, "INVALID_NOTE", "处理备注不能超过 300 个字符")
		return
	}
	nextStatus := ""
	message := ""
	switch input.Action {
	case "ack":
		nextStatus = "ack"
		message = "告警已认领"
	case "resolve":
		nextStatus = "resolved"
		message = "告警已解决"
	case "ignore":
		nextStatus = "ignored"
		message = "告警已忽略"
	default:
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "不支持的告警操作")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	clause, args := alertScopeClause(scope)
	args = append([]any{id}, args...)
	var currentStatus string
	if err := s.db.QueryRowContext(r.Context(), `SELECT status FROM mgr_automation_alert
WHERE id = ? AND (`+clause+`)`, args...).Scan(&currentStatus); err != nil {
		writeError(w, http.StatusNotFound, "ALERT_NOT_FOUND", "没有找到这个告警")
		return
	}
	note := input.Note
	if note != "" {
		note = "[" + time.Now().Format("01-02 15:04") + " " + automationOperator(p) + "] " + note
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_alert
SET status = ?, assignee = CASE WHEN ? = 'ack' THEN ? ELSE assignee END,
note = CASE WHEN ? = '' THEN note ELSE CONCAT_WS(' / ', NULLIF(note, ''), ?) END,
resolved_at = CASE WHEN ? = 'resolved' THEN NOW() ELSE resolved_at END
WHERE id = ?`, nextStatus, nextStatus, automationOperator(p), note, note, nextStatus, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "处理告警失败")
		return
	}
	s.audit(r.Context(), &p, "automation.alert."+input.Action, "automation_alert", strconv.FormatInt(id, 10),
		input, map[string]any{"status": currentStatus}, map[string]any{"status": nextStatus}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message})
}
