package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// 客服托管上下分：ChatTool 通过本机服务通道调用后台，后台再执行游戏厅命令。
// 两套系统保持分离：ChatTool 不直接访问 8890 游戏管理通道。

// 客服上分 / 下分后同步调整盟主额度用的游戏命令（以游戏服实际注册名为准）。
// 一个命令两个方向：`quota_fen` 正数=授信（联盟池 → 俱乐部），负数=收回（俱乐部 → 联盟池）。
// 2026-11-26 实测 `quota_fen:-1` 返回 512、俱乐部额度确实减少，负数已可用。
const clubQuotaCreditCommand = "后台_授信_盟主_额度"

type serviceClubMemberGoldRequest struct {
	Delta   int    `json:"delta"`
	Actor   string `json:"actor"`
	Context string `json:"context"`
	// SyncUnionQuota 由客服上分弹窗的「同步增加盟主额度」勾选决定（默认勾选）。
	// 仅在上分（Delta>0）时生效：额外调「授信_联盟_额度」把同等额度从联盟池划给该俱乐部。
	SyncUnionQuota bool `json:"syncUnionQuota"`
}

func (s *Server) handleServiceClubMemberGold(w http.ResponseWriter, r *http.Request) {
	var input serviceClubMemberGoldRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	clubID := strings.TrimSpace(r.PathValue("clubId"))
	userID := strings.TrimSpace(r.PathValue("userId"))
	if clubID == "" || userID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少俱乐部或玩家编号")
		return
	}
	if input.Delta == 0 || input.Delta > 1_000_000_000 || input.Delta < -1_000_000_000 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "积分变动必须是 -1000000000 到 1000000000 之间的非零整数")
		return
	}
	actor := strings.TrimSpace(input.Actor)
	if len(actor) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "操作人标识过长")
		return
	}
	if actor == "" {
		actor = "chattool"
	}
	operationContext := strings.TrimSpace(input.Context)
	if operationContext == "" || len(operationContext) > 128 {
		operationContext = gameOperationContext("chat-hosted-gold")
	}
	auditRequest := map[string]any{
		"clubId": clubID, "userId": userID, "delta": input.Delta,
		"actor": actor, "context": operationContext, "syncUnionQuota": input.SyncUnionQuota,
	}
	result, callErr := s.callGameCommand(r.Context(), "添加_俱乐部_成员_积分", map[string]any{
		"club_id": clubID, "user_id": userID, "user_add_gold": input.Delta,
		"context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("service club member gold command failed", "error", callErr,
			"clubId", clubID, "userId", userID, "actor", actor)
		s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
			auditRequest, nil, nil, 502, "游戏服务调用失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GOLD_COMMAND_FAILED", "游戏服务未确认上下分成功")
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		message := gameCommandErrorMessage(result, "上下分被游戏服务拒绝")
		s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
			auditRequest, nil, nil, 400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "GOLD_REJECTED", message)
		return
	}

	// 上分已成功：按勾选同步给该俱乐部盟主增加额度。第二步失败不回滚积分，
	// 只把原因回给客服，避免「钱加了但客服不知道额度没跟上」。
	quotaSyncError := ""
	if input.SyncUnionQuota && input.Delta != 0 {
		// 客服上/下分金额是「元/积分」，联盟额度池按「分」记账（界面上 1 元 = 100 分），
		// 少乘这 100 会出现「上分 11 元、额度只加 0.11 元」（2026-11-26 用户发现）。
		// 负数表示下分同步扣额度。
		quotaSyncError = s.syncClubUnionQuota(r.Context(), clubID, int64(input.Delta)*100, operationContext)
	}
	auditAfter := map[string]any{"retCode": result.RetCode}
	auditMessage := "客服托管上下分成功"
	if quotaSyncError != "" {
		auditAfter["quotaSyncError"] = quotaSyncError
		auditMessage = "客服托管上下分成功，盟主额度同步失败"
	}
	s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
		auditRequest, nil, auditAfter, 0, auditMessage, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"retCode": result.RetCode, "message": "上下分成功", "quotaSyncError": quotaSyncError,
	})
}

// syncClubUnionQuota 按上下分方向同步调整俱乐部盟主额度：正数授信（联盟池 → 俱乐部），
// 负数收回（俱乐部 → 联盟池，用于客服下分同步扣额度）。
// 2026-11-26 起改用「后台_授信_盟主_额度」：服务端按俱乐部自身 union_id 定位联盟，
// 写 opt_type='额度联盟授信'（不进奖励统计），不再用「发放_盟主_奖励」记成奖励流水。
// 也不再传 union_id —— 契约只接受 club_id/quota_fen/context，传错联盟会被拒。
// 命令名以游戏服注册为准：`异步_授信_盟主_额度` 返回 769 空返回（不存在），
// `后台_授信_盟主_额度` 会走金额校验（"授信金额必须大于 0"），后者才是真名。
// 返回空串表示成功；否则返回给客服看的原因。联盟池不足、俱乐部不在联盟等都会在这里暴露。
func (s *Server) syncClubUnionQuota(ctx context.Context, clubID string, deltaFen int64, operationContext string) string {
	if deltaFen == 0 {
		return ""
	}
	// 方向直接由金额正负表达：正数授信、负数收回，不再换成另一条命令。
	command := clubQuotaCreditCommand
	quotaFen := deltaFen
	// 授信要写联盟池 + 俱乐部两边流水并下发通知，回包比普通命令慢（实测超过 6 秒），
	// 这里给足超时，避免「已经记账但我们先断连」。
	cmdCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	quotaContext := operationContext + "-quota"
	var unionID string
	var before int64
	beforeErr := errors.New("未读取到操作前额度")
	if s.db != nil {
		unionID, before, beforeErr = s.readClubQuotaAndUnion(cmdCtx, clubID)
		// 独立俱乐部没有联盟池可划拨，明确告知客服「没加」，不静默跳过。
		if beforeErr == nil && strings.TrimSpace(unionID) == "" {
			return "该俱乐部未加入联盟，无法同步盟主额度"
		}
	}
	params := map[string]any{"club_id": clubID, "quota_fen": quotaFen, "context": quotaContext}
	result, callErr := s.callGameCommandWith(slowGameHTTPClient, cmdCtx, command, params)
	if callErr != nil {
		s.logger.Error("sync club union quota command failed", "error", callErr,
			"clubId", clubID, "unionId", unionID, "deltaFen", deltaFen, "context", quotaContext)
		// 回包超时 ≠ 没执行：游戏服可能已经记完账才回。这里回读额度自证，
		// 到账就按成功返回，绝不提示客服重复提交（会多加一份）。
		if beforeErr == nil {
			verifyCtx, verifyCancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer verifyCancel()
			if after, readErr := s.waitForClubUnionQuota(verifyCtx, clubID, before+deltaFen); readErr == nil && after == before+deltaFen {
				s.logger.Warn("授信回包超时但额度已到账", "clubId", clubID, "before", before, "after", after)
				return ""
			}
		}
		return "额度命令回包超时，额度未确认：请先核对俱乐部额度，确认没变再重新操作，不要重复提交"
	}
	// 512=同步成功；1280=异步入口已受理。之后仍按额度回读核对，两者都放过。
	if result.RetCode != 512 && result.RetCode != 1280 {
		fallbackText := "盟主额度调整被游戏服务拒绝"
		if deltaFen < 0 {
			fallbackText = "扣减盟主额度被游戏服务拒绝"
		}
		message := gameCommandErrorMessage(result, fallbackText)
		if strings.TrimSpace(message) == "" || message == fallbackText {
			message = fmt.Sprintf("游戏服未受理「%s」（返回 %d，无原因），请确认游戏服已部署并 reload 该命令", command, result.RetCode)
		}
		s.logger.Warn("sync club union quota rejected", "command", command, "clubId", clubID, "unionId", unionID,
			"deltaFen", deltaFen, "retCode", result.RetCode, "message", message)
		return message
	}
	if beforeErr != nil {
		return ""
	}
	if after, verifyErr := s.waitForClubUnionQuota(cmdCtx, clubID, before+deltaFen); verifyErr != nil {
		s.logger.Error("verify club union quota after grant", "error", verifyErr,
			"clubId", clubID, "before", before, "deltaFen", deltaFen, "after", after)
		return fmt.Sprintf("额度已提交，但未回读到预期值（当前 %d 分），请稍后核对", after)
	}
	return ""
}

// readClubQuotaAndUnion 读取俱乐部的联盟归属与当前额度（分）。unionID 为空表示独立俱乐部。
func (s *Server) readClubQuotaAndUnion(ctx context.Context, clubID string) (string, int64, error) {
	var unionID string
	var quota int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(union_id, ''), union_quota FROM kbedm.club_guuid_info
WHERE club_guuid = ? AND club_status NOT IN ('init', 'del') ORDER BY id DESC LIMIT 1`, clubID).Scan(&unionID, &quota)
	return unionID, quota, err
}

func (s *Server) readClubUnionQuota(ctx context.Context, clubID string) (int64, error) {
	_, quota, err := s.readClubQuotaAndUnion(ctx, clubID)
	return quota, err
}

func (s *Server) waitForClubUnionQuota(ctx context.Context, clubID string, expected int64) (int64, error) {
	var last int64
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		last, lastErr = s.readClubUnionQuota(ctx, clubID)
		if lastErr == nil && last == expected {
			return last, nil
		}
		if attempt < 5 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(400 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, errors.New("俱乐部额度未达到预期值")
}
