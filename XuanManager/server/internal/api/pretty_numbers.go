package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// 玩家靓号：号池与绑定关系由游戏服维护，后台只做命令代理和只读展示。
// 号池表在 kbedm.usr_pretty_no_info，命令见《玩家靓号绑定-后台接口文档》。
//
// 后台把两类靓号拆成两个独立入口（账号ID靓号 / 俱乐部邀请码靓号）：
// 类型只由路由段 /api/game/pretty-numbers/{kind}/... 决定，请求体与查询串里的 kind 不参与判断，
// 避免在 A 类页面误操作 B 类号码。
const (
	prettyKindUID    = "uid"
	prettyKindInvite = "invite"

	prettyListCommand   = "异步_查询_靓号_池"
	prettyAddCommand    = "异步_添加_靓号"
	prettyBindCommand   = "异步_绑定_靓号"
	prettyUnbindCommand = "异步_解绑_靓号"

	prettyStatusInit     = "init"
	prettyStatusUsed     = "used"
	prettyStatusDisabled = "disabled"

	prettyAuditAdd    = "game.pretty_no.add"
	prettyAuditBind   = "game.pretty_no.bind"
	prettyAuditUnbind = "game.pretty_no.unbind"
)

// prettyUnbindEnabled 控制解绑是否开放。
// 2026-11-15 用户要求关闭：号码一旦绑定就不能解绑（后台同时隐藏入口）。
// 需要恢复时把这里改回 true 即可，接口与审计逻辑保持原样。
const prettyUnbindEnabled = false

var prettyNumberWriteMu sync.Mutex

type prettyNumberItem struct {
	ID       int64  `json:"id,omitempty"`
	PrettyNo string `json:"prettyNo"`
	Kind     string `json:"kind"`
	Status   string `json:"status"`
	UserID   string `json:"userId"`
	UserName string `json:"userName"`
	ClubID   string `json:"clubId"`
	ClubName string `json:"clubName"`
	BindDate string `json:"bindDate"`
	OpName   string `json:"opName"`
	Remark   string `json:"remark"`
}

type prettyNumberListResponse struct {
	Items    []prettyNumberItem `json:"items"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	Total    int                `json:"total"`
}

type prettyNumberCandidate struct {
	PrettyNo string `json:"prettyNo"`
}

type prettyNumberCandidatesResponse struct {
	Items []prettyNumberCandidate `json:"items"`
}

type addPrettyNumberRequest struct {
	Kind     string `json:"kind"`
	PrettyNo string `json:"prettyNo"`
	Remark   string `json:"remark"`
}

type bindPrettyNumberRequest struct {
	Kind   string `json:"kind"`
	UserID string `json:"userId"`
	ClubID string `json:"clubId"`
	// 邀请码靓号只需要传原邀请码：后台自己反查出代理与俱乐部。
	// 同时接受 invite_code 这种下划线写法，方便脚本直连。
	InviteCode      string `json:"inviteCode"`
	InviteCodeSnake string `json:"invite_code"`
	Remark          string `json:"remark"`
}

type unbindPrettyNumberRequest struct {
	Kind   string `json:"kind"`
	Remark string `json:"remark"`
}

type prettyNumberMutationResult struct {
	Result        int    `json:"result"`
	Kind          string `json:"kind"`
	PrettyNo      string `json:"prettyNo"`
	Status        string `json:"status"`
	UserID        string `json:"userId,omitempty"`
	UserName      string `json:"userName,omitempty"`
	ClubID        string `json:"clubId,omitempty"`
	OldInviteCode string `json:"oldInviteCode,omitempty"`
	OldUserID     string `json:"oldUserId,omitempty"`
	NewInviteCode string `json:"newInviteCode,omitempty"`
	Context       string `json:"context,omitempty"`
}

func (s *Server) handleListPrettyNumbers(w http.ResponseWriter, r *http.Request, _ principal) {
	kind, err := prettyKindFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	filter, err := parsePrettyNumberFilter(r, kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	operationContext := gameOperationContext("pretty-list")
	params := map[string]any{
		"page":    filter.Page - 1,
		"count":   filter.Size,
		"context": operationContext,
		"kind":    filter.Kind,
	}
	if filter.Status != "" {
		params["status"] = filter.Status
	}
	if filter.Keyword != "" {
		params["keyword"] = filter.Keyword
	}
	result, callErr := s.callGameCommand(ctx, prettyListCommand, params)
	if callErr != nil {
		s.logger.Error("list pretty numbers", "error", callErr, "context", operationContext)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服未返回靓号号池，请稍后重试")
		return
	}
	if result.RetCode != 512 {
		message := prettyGameErrorMessage(result.RetResult)
		s.logger.Warn("list pretty numbers rejected", "retCode", result.RetCode, "message", message)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", message)
		return
	}

	root, err := decodePrettyGamePayload(result.RetResult)
	if err != nil {
		s.logger.Error("decode pretty number list", "error", err)
		writeError(w, http.StatusBadGateway, "GAME_RESPONSE_INVALID", "游戏服靓号号池回包无法解析")
		return
	}
	items := make([]prettyNumberItem, 0, filter.Size)
	rawList, _ := root["list"].([]any)
	for _, raw := range rawList {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, prettyNumberItem{
			ID:       intField(row, "id"),
			PrettyNo: textField(row, "pretty_no", "prettyNo"),
			Kind:     textField(row, "kind"),
			Status:   normalizePrettyStatus(textField(row, "status")),
			UserID:   textField(row, "user_guuid", "user_id", "userId"),
			UserName: textField(row, "user_name", "userName"),
			ClubID:   textField(row, "club_id", "clubId"),
			ClubName: textField(row, "club_name", "clubName"),
			BindDate: textField(row, "bind_date", "bindDate"),
			OpName:   textField(row, "op_name", "opName"),
			Remark:   textField(row, "remark"),
		})
	}
	total := int(intField(root, "total"))
	if total == 0 && len(items) > 0 {
		total = len(items)
	}
	writeData(w, http.StatusOK, prettyNumberListResponse{
		Items: items, Page: filter.Page, PageSize: filter.Size, Total: total,
	})
}

func (s *Server) handlePrettyNumberCandidates(w http.ResponseWriter, r *http.Request, _ principal) {
	kind, err := prettyKindFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	pattern, err := prettyCandidatePattern(r.URL.Query().Get("mode"), r.URL.Query().Get("digits"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CANDIDATE_FILTER", err.Error())
		return
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if !s.hasPrettyNumberTable(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "PRETTY_TABLE_MISSING", "游戏服尚未建立靓号表 usr_pretty_no_info，请先完成服务端建表")
		return
	}

	query := `SELECT g.user_guuid
FROM kbedm.usr_guuid_info g
WHERE g.account_id = 0
  AND g.user_guuid LIKE ?
  AND NOT EXISTS (SELECT 1 FROM kbedm.usr_pretty_no_info p WHERE p.pretty_no = g.user_guuid)
ORDER BY g.user_guuid
LIMIT ?`
	if kind == prettyKindInvite {
		query = `SELECT c.invite_code
FROM kbedm.club_invite_code_info c
WHERE c.status = 'init'
  AND c.invite_code LIKE ?
  AND NOT EXISTS (SELECT 1 FROM kbedm.usr_pretty_no_info p WHERE p.pretty_no = c.invite_code)
ORDER BY c.invite_code
LIMIT ?`
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, query, pattern, limit)
	if err != nil {
		s.logger.Error("query pretty number candidates", "error", err, "kind", kind)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取候选靓号失败，请确认游戏服靓号相关表已建好")
		return
	}
	defer rows.Close()
	items := make([]prettyNumberCandidate, 0, limit)
	for rows.Next() {
		var number string
		if err := rows.Scan(&number); err != nil {
			s.logger.Error("scan pretty number candidate", "error", err, "kind", kind)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取候选靓号失败")
			return
		}
		items = append(items, prettyNumberCandidate{PrettyNo: number})
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate pretty number candidates", "error", err, "kind", kind)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取候选靓号失败")
		return
	}
	writeData(w, http.StatusOK, prettyNumberCandidatesResponse{Items: items})
}

func (s *Server) handleAddPrettyNumber(w http.ResponseWriter, r *http.Request, p principal) {
	var input addPrettyNumberRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	kind, err := prettyKindFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	if err := ensurePrettyBodyKind(input.Kind, kind); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	prettyNo, err := normalizePrettyNo(input.PrettyNo)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PRETTY_NO", err.Error())
		return
	}
	remark, err := normalizePrettyRemark(input.Remark)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REMARK", err.Error())
		return
	}

	prettyNumberWriteMu.Lock()
	defer prettyNumberWriteMu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	operationContext := gameOperationContext("pretty-add")
	requestAudit := map[string]any{"kind": kind, "prettyNo": prettyNo, "remark": remark, "context": operationContext}

	result, callErr := s.callGameCommand(ctx, prettyAddCommand, map[string]any{
		"kind": kind, "pretty_no": prettyNo, "op_name": p.Username,
		"remark": remark, "context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("add pretty number", "error", callErr, "prettyNo", prettyNo)
		s.audit(ctx, &p, prettyAuditAdd, "game_pretty_no", prettyNo, requestAudit, nil, nil, 502, "游戏服未确认靓号入池", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服未确认靓号入池，请稍后重试")
		return
	}
	payload, message, ok := prettyMutationPayload(w, result)
	if !ok {
		s.audit(ctx, &p, prettyAuditAdd, "game_pretty_no", prettyNo, requestAudit, nil, nil, 400, message, clientIP(r))
		return
	}
	output := prettyNumberMutationResult{
		Result:   int(intField(payload, "result")),
		Kind:     textField(payload, "kind"),
		PrettyNo: textField(payload, "pretty_no", "prettyNo"),
		Status:   normalizePrettyStatus(textField(payload, "status")),
		Context:  textField(payload, "context"),
	}
	if output.Kind == "" {
		output.Kind = kind
	}
	if output.PrettyNo == "" {
		output.PrettyNo = prettyNo
	}
	if output.Status == "" {
		output.Status = prettyStatusInit
	}
	s.audit(ctx, &p, prettyAuditAdd, "game_pretty_no", prettyNo, requestAudit, nil,
		map[string]any{"kind": output.Kind, "status": output.Status}, 0, "靓号已入池", clientIP(r))
	writeData(w, http.StatusOK, output)
}

func (s *Server) handleBindPrettyNumber(w http.ResponseWriter, r *http.Request, p principal) {
	prettyNo, err := normalizePrettyNo(r.PathValue("prettyNo"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PRETTY_NO", err.Error())
		return
	}
	var input bindPrettyNumberRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	kind, err := prettyKindFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	if err := ensurePrettyBodyKind(input.Kind, kind); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	// 邀请码靓号只要求填“原始的邀请码”：代理和俱乐部由后台反查，运营不用记 ID。
	var userID, clubID, inviteCode string
	if kind == prettyKindInvite {
		inviteCode, err = normalizePrettyNo(firstNonEmpty(input.InviteCode, input.InviteCodeSnake))
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", "请填写要替换的原始邀请码（6 位数字）")
			return
		}
		if inviteCode == prettyNo {
			writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", "原始邀请码不能和要绑定的靓号相同")
			return
		}
	} else {
		userID, err = normalizeGamePlayerID(input.UserID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
			return
		}
	}
	remark, err := normalizePrettyRemark(input.Remark)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REMARK", err.Error())
		return
	}

	prettyNumberWriteMu.Lock()
	defer prettyNumberWriteMu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	operationContext := gameOperationContext("pretty-bind")
	requestAudit := map[string]any{
		"kind": kind, "prettyNo": prettyNo, "userId": userID, "clubId": clubID,
		"inviteCode": inviteCode, "remark": remark, "context": operationContext,
	}
	params := map[string]any{
		"kind": kind, "pretty_no": prettyNo,
		"op_name": p.Username, "remark": remark, "context": operationContext,
	}
	if inviteCode != "" {
		// 游戏服自己按原邀请码定位代理与俱乐部（一个码只属于一个代理+俱乐部），后台只透传。
		params["invite_code"] = inviteCode
	} else {
		params["user_guuid"] = userID
	}
	result, callErr := s.callGameCommand(ctx, prettyBindCommand, params)
	if callErr != nil {
		s.logger.Error("bind pretty number", "error", callErr, "prettyNo", prettyNo, "userId", userID)
		s.audit(ctx, &p, prettyAuditBind, "game_pretty_no", prettyNo, requestAudit, nil, nil, 502, "游戏服未确认靓号绑定", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服未确认靓号绑定，请稍后重试")
		return
	}
	payload, message, ok := prettyMutationPayload(w, result)
	if !ok {
		s.audit(ctx, &p, prettyAuditBind, "game_pretty_no", prettyNo, requestAudit, nil, nil, 400, message, clientIP(r))
		return
	}
	output := prettyNumberMutationResult{
		Result:        int(intField(payload, "result")),
		Kind:          textField(payload, "kind"),
		PrettyNo:      textField(payload, "pretty_no", "prettyNo"),
		UserID:        textField(payload, "user_guuid", "user_id", "userId"),
		UserName:      textField(payload, "user_name", "userName"),
		ClubID:        textField(payload, "club_id", "clubId"),
		OldInviteCode: textField(payload, "old_invite_code", "oldInviteCode"),
		Context:       textField(payload, "context"),
	}
	if output.Kind == "" {
		output.Kind = kind
	}
	if output.PrettyNo == "" {
		output.PrettyNo = prettyNo
	}
	if output.UserID == "" {
		output.UserID = userID
	}
	if output.ClubID == "" && clubID != "" {
		output.ClubID = clubID
	}
	after := map[string]any{"kind": kind, "userId": output.UserID, "clubId": output.ClubID}
	if output.OldInviteCode != "" {
		after["oldInviteCode"] = output.OldInviteCode
	}
	s.audit(ctx, &p, prettyAuditBind, "game_pretty_no", prettyNo, requestAudit, nil, after, 0, "靓号绑定成功", clientIP(r))
	writeData(w, http.StatusOK, output)
}

func (s *Server) handleUnbindPrettyNumber(w http.ResponseWriter, r *http.Request, p principal) {
	if !prettyUnbindEnabled {
		writeError(w, http.StatusBadRequest, "PRETTY_UNBIND_DISABLED", "靓号解绑已关闭：已绑定的号码不支持解绑")
		return
	}
	prettyNo, err := normalizePrettyNo(r.PathValue("prettyNo"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PRETTY_NO", err.Error())
		return
	}
	var input unbindPrettyNumberRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	kind, err := prettyKindFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	if err := ensurePrettyBodyKind(input.Kind, kind); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", err.Error())
		return
	}
	remark, err := normalizePrettyRemark(input.Remark)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REMARK", err.Error())
		return
	}

	prettyNumberWriteMu.Lock()
	defer prettyNumberWriteMu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	operationContext := gameOperationContext("pretty-unbind")
	requestAudit := map[string]any{"kind": kind, "prettyNo": prettyNo, "remark": remark, "context": operationContext}
	result, callErr := s.callGameCommand(ctx, prettyUnbindCommand, map[string]any{
		"kind": kind, "pretty_no": prettyNo, "op_name": p.Username,
		"remark": remark, "context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("unbind pretty number", "error", callErr, "prettyNo", prettyNo)
		s.audit(ctx, &p, prettyAuditUnbind, "game_pretty_no", prettyNo, requestAudit, nil, nil, 502, "游戏服未确认靓号解绑", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服未确认靓号解绑，请稍后重试")
		return
	}
	payload, message, ok := prettyMutationPayload(w, result)
	if !ok {
		s.audit(ctx, &p, prettyAuditUnbind, "game_pretty_no", prettyNo, requestAudit, nil, nil, 400, message, clientIP(r))
		return
	}
	output := prettyNumberMutationResult{
		Result:        int(intField(payload, "result")),
		Kind:          textField(payload, "kind"),
		PrettyNo:      textField(payload, "pretty_no", "prettyNo"),
		Status:        normalizePrettyStatus(textField(payload, "status")),
		OldUserID:     textField(payload, "old_user_guuid", "oldUserGuuid", "oldUserId"),
		NewInviteCode: textField(payload, "new_invite_code", "newInviteCode"),
		Context:       textField(payload, "context"),
	}
	if output.Kind == "" {
		output.Kind = kind
	}
	if output.PrettyNo == "" {
		output.PrettyNo = prettyNo
	}
	if output.Status == "" {
		output.Status = prettyStatusDisabled
	}
	after := map[string]any{"kind": kind, "status": output.Status, "oldUserId": output.OldUserID}
	if output.NewInviteCode != "" {
		after["newInviteCode"] = output.NewInviteCode
	}
	s.audit(ctx, &p, prettyAuditUnbind, "game_pretty_no", prettyNo, requestAudit, nil, after, 0, "靓号已解绑并停用", clientIP(r))
	writeData(w, http.StatusOK, output)
}

// prettyMutationPayload 统一处理写命令的成功/失败，并把游戏服错误文案直接返回给前端。
func prettyMutationPayload(w http.ResponseWriter, result gameCommandResponse) (map[string]any, string, bool) {
	if result.RetCode != 512 {
		message := prettyGameErrorMessage(result.RetResult)
		writeError(w, http.StatusBadRequest, "GAME_COMMAND_REJECTED", message)
		return nil, message, false
	}
	payload, err := decodePrettyGamePayload(result.RetResult)
	if err != nil {
		writeError(w, http.StatusBadGateway, "GAME_RESPONSE_INVALID", "游戏服靓号回包无法解析")
		return nil, "游戏服靓号回包无法解析", false
	}
	if message := textField(payload, "error", "msg", "message", "errmsg"); message != "" {
		writeError(w, http.StatusBadRequest, "GAME_COMMAND_REJECTED", message)
		return nil, message, false
	}
	if value, ok := payload["result"]; ok {
		if intField(payload, "result") != 1 {
			message := fmt.Sprintf("游戏服未确认操作成功（result=%v）", value)
			writeError(w, http.StatusBadGateway, "GAME_RESPONSE_INVALID", message)
			return nil, message, false
		}
	}
	return payload, "", true
}

// prettyGameErrorMessage 优先从字符串/对象两种回包里取游戏服错误文案。
func prettyGameErrorMessage(raw json.RawMessage) string {
	if payload, err := decodePrettyGamePayload(raw); err == nil {
		if message := textField(payload, "error", "msg", "message", "errmsg"); message != "" {
			return message
		}
	}
	return gameResultMessage(raw)
}

// decodePrettyGamePayload 兼容 ret_result 是 JSON 字符串或对象两种形态。
func decodePrettyGamePayload(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 {
		return nil, errors.New("游戏服未返回结果")
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		raw = json.RawMessage(text)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("游戏服返回空对象")
	}
	// 少数命令会把真正结果包在 result 对象里；result=1 这种成功标记不展开。
	if inner, ok := payload["result"].(map[string]any); ok && payload["list"] == nil && payload["total"] == nil {
		return inner, nil
	}
	return payload, nil
}

func parsePrettyNumberFilter(r *http.Request, kind string) (prettyNumberQuery, error) {
	query := r.URL.Query()
	page, size := pageParams(r)
	normalized, err := normalizePrettyKind(kind)
	if err != nil {
		return prettyNumberQuery{Page: page, Size: size}, err
	}
	filter := prettyNumberQuery{Page: page, Size: size, Kind: normalized}
	// 旧前端会把 kind 放在查询串里；它只能和路由一致，不允许用它切换类型。
	if queryKind := strings.TrimSpace(query.Get("kind")); queryKind != "" {
		if err := ensurePrettyBodyKind(queryKind, normalized); err != nil {
			return filter, err
		}
	}
	status := strings.TrimSpace(query.Get("status"))
	if status != "" && status != prettyStatusInit && status != prettyStatusUsed && status != prettyStatusDisabled {
		return filter, errors.New("状态只能是 init、used 或 disabled")
	}
	filter.Status = status
	filter.Keyword = strings.TrimSpace(query.Get("keyword"))
	if utf8.RuneCountInString(filter.Keyword) > 100 {
		return filter, errors.New("查询文字不能超过 100 个字符")
	}
	return filter, nil
}

// prettyKindFromRequest 从 /api/game/pretty-numbers/{kind}/... 里取类型段。
// 靓号拆成两个独立入口后，类型只由路由决定，请求体与查询串都不能改写。
func prettyKindFromRequest(r *http.Request) (string, error) {
	path := strings.TrimPrefix(r.URL.Path, "/api/game/pretty-numbers/")
	segment := strings.SplitN(path, "/", 2)[0]
	return normalizePrettyKind(segment)
}

// ensurePrettyBodyKind 允许请求体/查询串继续带 kind（旧前端兼容），但必须与路由一致。
func ensurePrettyBodyKind(value, pathKind string) error {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || value == pathKind {
		return nil
	}
	return fmt.Errorf("请求类型 %s 与本页面的 %s 不一致", value, pathKind)
}

type prettyNumberQuery struct {
	Kind    string
	Status  string
	Keyword string
	Page    int
	Size    int
}

func normalizePrettyKind(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value != prettyKindUID && value != prettyKindInvite {
		return "", errors.New("类型必须是 uid 或 invite")
	}
	return value, nil
}

func normalizePrettyNo(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) != 6 {
		return "", errors.New("靓号必须是 6 位数字")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return "", errors.New("靓号必须是 6 位数字")
		}
	}
	return value, nil
}

func normalizePrettyClubID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("绑定邀请码必须指定俱乐部 ID")
	}
	if len(value) != 6 {
		return "", errors.New("俱乐部 ID 必须是 6 位数字")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return "", errors.New("俱乐部 ID 必须是 6 位数字")
		}
	}
	return value, nil
}

func normalizePrettyRemark(value string) (string, error) {
	value = strings.TrimSpace(value)
	for _, char := range value {
		if char < 0x20 && char != '\t' {
			return "", errors.New("备注不能包含换行或控制字符")
		}
	}
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) > 200 {
		return "", errors.New("备注不能超过 200 个字符")
	}
	return value, nil
}

func normalizePrettyStatus(value string) string {
	switch value {
	case prettyStatusInit, prettyStatusUsed, prettyStatusDisabled:
		return value
	default:
		return value
	}
}

func prettyCandidatePattern(mode, digits string) (string, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	digits = strings.TrimSpace(digits)
	if digits == "" || len(digits) > 6 {
		return "", errors.New("候选号数字必须是 1 到 6 位")
	}
	for _, char := range digits {
		if char < '0' || char > '9' {
			return "", errors.New("候选号只能输入数字")
		}
	}
	switch mode {
	case "", "prefix":
		return digits + "%", nil
	case "suffix":
		return "%" + digits, nil
	case "contains":
		return "%" + digits + "%", nil
	default:
		return "", errors.New("匹配方式只能是 prefix、suffix 或 contains")
	}
}

// hasPrettyNumberTable 探测游戏服靓号表；未建表时每 30 秒重试一次，建表后无需重启后台。
func (s *Server) hasPrettyNumberTable(ctx context.Context) bool {
	if s.db == nil {
		return false
	}
	s.prettyTableMu.Lock()
	defer s.prettyTableMu.Unlock()
	if s.prettyTableChecked {
		return s.prettyTableOK
	}
	// 表还没建时不要永久缓存失败：游戏服建表后最多 30 秒内自动恢复显示，无需重启后台。
	if !s.prettyTableNextCheck.IsZero() && time.Now().Before(s.prettyTableNextCheck) {
		return false
	}
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'kbedm' AND table_name = 'usr_pretty_no_info'`).Scan(&count)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("check usr_pretty_no_info table", "error", err)
		}
		s.prettyTableNextCheck = time.Now().Add(30 * time.Second)
		return false
	}
	if count > 0 {
		s.prettyTableChecked = true
		s.prettyTableOK = true
		return true
	}
	s.prettyTableNextCheck = time.Now().Add(30 * time.Second)
	return false
}

// loadPrettyNumbers 按真实玩家 ID 批量取“已绑定的个人ID靓号”，用于关联账号等列表展示。
func (s *Server) loadPrettyNumbers(ctx context.Context, playerIDs []string) map[string]string {
	result := map[string]string{}
	if len(playerIDs) == 0 || !s.hasPrettyNumberTable(ctx) {
		return result
	}
	for _, part := range chunkRelationValues(playerIDs, 400) {
		query := `SELECT user_guuid, pretty_no FROM kbedm.usr_pretty_no_info
WHERE kind = 'uid' AND status = 'used' AND user_guuid IN (` + placeholders(len(part)) + `)`
		rows, err := s.db.QueryContext(ctx, query, stringArgs(part)...)
		if err != nil {
			s.logger.Error("load pretty numbers", "error", err)
			return result
		}
		for rows.Next() {
			var playerID, prettyNo string
			if err := rows.Scan(&playerID, &prettyNo); err != nil {
				s.logger.Error("scan pretty number", "error", err)
				break
			}
			result[playerID] = prettyNo
		}
		if err := rows.Err(); err != nil {
			s.logger.Error("iterate pretty numbers", "error", err)
		}
		rows.Close()
	}
	return result
}
