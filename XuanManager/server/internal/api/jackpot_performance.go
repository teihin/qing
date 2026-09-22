package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type jackpotAgent struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Enabled  bool   `json:"enabled"`
}

func (s *Server) jackpotAgent(ctx context.Context, id string) (jackpotAgent, error) {
	var a jackpotAgent
	err := s.gameDB.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_name,''), COALESCE(sm_role,''), COALESCE(sm_client_prop,'') = 'True' FROM tbl_Account WHERE sm_guuid = ?`, id).Scan(&a.PlayerID, &a.Name, &a.Role, &a.Enabled)
	return a, err
}

func (s *Server) handleJackpotAgents(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	id := strings.TrimSpace(r.URL.Query().Get("playerId"))
	if len(id) > 64 {
		writeError(w, 400, "INVALID_ID", "玩家ID过长")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if id != "" {
		a, err := s.jackpotAgent(ctx, id)
		if errors.Is(err, sql.ErrNoRows) {
			writeData(w, 200, map[string]any{"items": []jackpotAgent{}, "total": 0})
			return
		}
		if err != nil {
			writeError(w, 500, "QUERY_ERROR", "查询玩家失败")
			return
		}
		writeData(w, 200, map[string]any{"items": []jackpotAgent{a}, "total": 1})
		return
	}
	var total int
	if err := s.gameDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM tbl_Account WHERE sm_client_prop = 'True'`).Scan(&total); err != nil {
		writeError(w, 500, "QUERY_ERROR", "查询开通数量失败")
		return
	}
	rows, err := s.gameDB.QueryContext(ctx, `SELECT sm_guuid, COALESCE(sm_name,''), COALESCE(sm_role,'') FROM tbl_Account WHERE sm_client_prop = 'True' ORDER BY sm_guuid LIMIT ? OFFSET ?`, size, (page-1)*size)
	if err != nil {
		writeError(w, 500, "QUERY_ERROR", "查询开通名单失败")
		return
	}
	defer rows.Close()
	items := []jackpotAgent{}
	for rows.Next() {
		a := jackpotAgent{Enabled: true}
		if err := rows.Scan(&a.PlayerID, &a.Name, &a.Role); err != nil {
			writeError(w, 500, "QUERY_ERROR", "读取名单失败")
			return
		}
		items = append(items, a)
	}
	if rows.Err() != nil {
		writeError(w, 500, "QUERY_ERROR", "读取名单失败")
		return
	}
	writeData(w, 200, map[string]any{"items": items, "total": total})
}

func (s *Server) handleSetJackpotAgent(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		Enabled  *bool `json:"enabled"`
		Expected *bool `json:"expected"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	id := strings.TrimSpace(r.PathValue("playerId"))
	if id == "" || len(id) > 64 || input.Enabled == nil || input.Expected == nil {
		writeError(w, 400, "INVALID_INPUT", "必须提供玩家ID、开通状态与原状态")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	before, err := s.jackpotAgent(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "NOT_FOUND", "玩家不存在")
		return
	}
	if err != nil {
		writeError(w, 500, "QUERY_ERROR", "读取原状态失败")
		return
	}
	if before.Enabled != *input.Expected {
		writeError(w, 409, "STATE_CHANGED", "状态已变化，请刷新后再操作")
		return
	}
	if before.Enabled == *input.Enabled {
		writeData(w, 200, before)
		return
	}
	value := ""
	if *input.Enabled {
		value = "True"
	}
	op := gameOperationContext("jackpot-permission")
	result, callErr := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{"guuid": id, "name": "client_prop", "value": value, "context": op})
	code, message := 502, "游戏服务未确认设置结果，请查询状态后再操作"
	var after jackpotAgent
	verified := false
	if callErr == nil && (result.RetCode == 512 || result.RetCode == 1280) {
		for attempt := 0; attempt < 5; attempt++ {
			after, err = s.jackpotAgent(ctx, id)
			if err == nil && after.Enabled == *input.Enabled {
				verified = true
				break
			}
			select {
			case <-ctx.Done():
				attempt = 5
			case <-time.After(150 * time.Millisecond):
			}
		}
		if verified {
			code = 0
			message = "业绩权限已更新并回读确认"
		} else {
			code = 202
			message = "请求已受理，尚未确认生效，请刷新状态核对，勿重复提交"
		}
	}
	// Audit survives a cancelled browser request and records the actual readback.
	auditCtx, auditCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer auditCancel()
	s.audit(auditCtx, &p, "game.jackpot.configure", "game_player", id, map[string]any{"enabled": *input.Enabled, "context": op, "retCode": result.RetCode}, before, after, code, message, clientIP(r))
	if verified {
		writeData(w, 200, after)
		return
	}
	writeError(w, http.StatusBadGateway, "SET_NOT_CONFIRMED", message)
}

func jackpotReportDate(raw string, now time.Time) (string, error) {
	if raw == "" {
		return now.In(dashboardLocation).AddDate(0, 0, -1).Format("2006-01-02"), nil
	}
	date, err := time.ParseInLocation("2006-01-02", raw, dashboardLocation)
	if err != nil || date.Format("2006-01-02") != raw {
		return "", errors.New("日期格式不正确")
	}
	if raw > now.In(dashboardLocation).Format("2006-01-02") {
		return "", errors.New("不能查询未来日期")
	}
	return raw, nil
}

// Game deployments return ret_result either as an object or a JSON string.
func decodeJackpotReport(result gameCommandResponse, date string) (map[string]any, error) {
	if result.RetCode != 512 {
		return nil, fmt.Errorf("报表未完成，返回码 %d", result.RetCode)
	}
	raw := result.RetResult
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, errors.New("报表格式错误")
	}
	var report map[string]any
	if err := json.Unmarshal(envelope["JackpotSettlementReport"], &report); err != nil || report == nil {
		return nil, errors.New("缺少结算报表")
	}
	if report["date"] != date {
		return nil, errors.New("报表日期与查询不一致")
	}
	for _, key := range []string{"all_performance", "pool_performance", "rebate_total", "platform_keep", "count"} {
		if _, ok := report[key].(float64); !ok {
			return nil, fmt.Errorf("报表缺少 %s", key)
		}
	}
	if _, ok := report["check_ok"].(bool); !ok {
		return nil, errors.New("报表缺少对账结果")
	}
	rows, ok := report["list"].([]any)
	if !ok {
		return nil, errors.New("报表缺少明细")
	}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			return nil, errors.New("明细格式错误")
		}
		for _, key := range []string{"guuid", "name", "agent_id"} {
			if _, ok := item[key].(string); !ok {
				return nil, fmt.Errorf("明细缺少 %s", key)
			}
		}
		for _, key := range []string{"my_performance", "granted_performance", "proxy_performance", "rebate"} {
			if _, ok := item[key].(float64); !ok {
				return nil, fmt.Errorf("明细缺少 %s", key)
			}
		}
		granted, ok := item["granted_list"].([]any)
		if !ok {
			return nil, errors.New("下发明细格式错误")
		}
		for _, child := range granted {
			tuple, ok := child.([]any)
			if !ok || len(tuple) < 3 {
				return nil, errors.New("下发记录格式错误")
			}
			if _, ok := tuple[0].(string); !ok {
				return nil, errors.New("下级ID格式错误")
			}
			if _, ok := tuple[1].(string); !ok {
				return nil, errors.New("下级昵称格式错误")
			}
			if _, ok := tuple[2].(float64); !ok {
				return nil, errors.New("下级业绩格式错误")
			}
		}
	}
	return report, nil
}

func (s *Server) handleJackpotReport(w http.ResponseWriter, r *http.Request, p principal) {
	date, err := jackpotReportDate(r.URL.Query().Get("date"), time.Now())
	if err != nil {
		writeError(w, 400, "INVALID_DATE", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	result, err := s.callGameCommand(ctx, "异步_查询_奖池业绩_结算报表", map[string]any{"date": date, "context": gameOperationContext("jackpot-report")})
	var report map[string]any
	if err == nil {
		report, err = decodeJackpotReport(result, date)
	}
	if err != nil {
		s.audit(r.Context(), &p, "game.jackpot.view", "jackpot_report", date, nil, nil, nil, 502, "结算查询失败", clientIP(r))
		writeError(w, 502, "REPORT_UNAVAILABLE", "结算报表暂不可用，请稍后重试")
		return
	}
	writeData(w, 200, report)
}
