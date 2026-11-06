package directchat

import (
	"context"
	"strings"
)

// 聊天托管的展示偏好：给玩家设置备注名称、把重要玩家的会话置顶、删除单条会话。
// 这些操作只影响客服工作台的展示与托管数据，不改变游戏客户端的私聊模型。

// maxPlayerRemarkRunes 备注名称的最大长度；导航栏和列表行都需要能完整显示。
const maxPlayerRemarkRunes = 20

// normalizePlayerRemark 去掉换行和多余空白，避免把备注写进列表行后撑破布局。
func normalizePlayerRemark(value string) string {
	cleaned := strings.NewReplacer("\r", " ", "\n", " ", "\t", " ").Replace(value)
	return strings.TrimSpace(strings.Join(strings.Fields(cleaned), " "))
}

func (s *Service) hostedPrefsStore() (HostedPrefsStore, error) {
	store, ok := s.store.(HostedPrefsStore)
	if !ok {
		return nil, newError(500, "INTERNAL_ERROR", "托管偏好存储未启用")
	}
	return store, nil
}

// attachHostedPrefs 给托管会话列表补上备注名与置顶状态。
// 偏好读取失败不影响会话本身，客服仍然可以查看和回复。
func (s *Service) attachHostedPrefs(ctx context.Context, views []HostedConversationView) {
	store, err := s.hostedPrefsStore()
	if err != nil || len(views) == 0 {
		return
	}
	playerIDs := make([]string, 0, len(views))
	conversationIDs := make([]string, 0, len(views))
	for _, view := range views {
		playerIDs = append(playerIDs, view.Peer.Guuid)
		conversationIDs = append(conversationIDs, view.ConversationID)
	}
	if remarks, err := store.PlayerRemarks(ctx, playerIDs); err == nil {
		for i := range views {
			views[i].Remark = remarks[views[i].Peer.Guuid]
		}
	} else if s.logger != nil {
		s.logger.Warn("读取玩家备注失败", "error", err)
	}
	if pins, err := store.HostedPins(ctx, HostedPinConversation, conversationIDs); err == nil {
		for i := range views {
			if pinnedAt, ok := pins[views[i].ConversationID]; ok {
				views[i].Pinned = true
				views[i].PinnedAt = fmtTime(pinnedAt)
			}
		}
	} else if s.logger != nil {
		s.logger.Warn("读取托管会话置顶失败", "error", err)
	}
}

// attachHostedTargetPrefs 给一级分组（联盟/俱乐部）和二级托管账号（盟主/群主）补置顶状态。
// 读取失败只记日志，不影响托管列表本身。
func (s *Service) attachHostedTargetPrefs(ctx context.Context, groups []HostedGroupView) {
	if len(groups) == 0 {
		return
	}
	store, err := s.hostedPrefsStore()
	if err != nil {
		return
	}
	groupKeys := make([]string, 0, len(groups))
	ownerGuuids := make([]string, 0, len(groups))
	for _, group := range groups {
		groupKeys = append(groupKeys, group.Key)
		for _, owner := range group.Items {
			ownerGuuids = append(ownerGuuids, owner.Guuid)
		}
	}
	groupPins, groupErr := store.HostedPins(ctx, HostedPinGroup, groupKeys)
	ownerPins, ownerErr := store.HostedPins(ctx, HostedPinOwner, ownerGuuids)
	if groupErr != nil || ownerErr != nil {
		if s.logger != nil {
			s.logger.Warn("读取托管分组置顶失败", "error", groupErr, "ownerError", ownerErr)
		}
		return
	}
	for i := range groups {
		if pinnedAt, ok := groupPins[groups[i].Key]; ok {
			groups[i].Pinned = true
			groups[i].PinnedAt = fmtTime(pinnedAt)
		}
		for j := range groups[i].Items {
			if pinnedAt, ok := ownerPins[groups[i].Items[j].Guuid]; ok {
				groups[i].Items[j].Pinned = true
				groups[i].Items[j].PinnedAt = fmtTime(pinnedAt)
			}
		}
	}
}

// SetHostedRemark 给会话对方（玩家）设置备注名称；传空字符串表示清除备注。
// 返回归一化后的备注和该玩家 guuid，供调用方推送实时事件。
func (s *Service) SetHostedRemark(ctx context.Context, hostedGuuid, conversationID, remark string,
	agentID int64, agentName string) (string, string, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return "", "", err
	}
	conv, _, peer, err := s.requireConversation(ctx, s.hostedSession(ctx, record.Guuid), conversationID)
	if err != nil {
		return "", "", err
	}
	peerGuuid := strings.TrimSpace(peer.Guuid)
	if peerGuuid == "" {
		peerGuuid = strings.TrimSpace(conv.PeerGuuid(record.Guuid))
	}
	if peerGuuid == "" || peerGuuid == record.Guuid {
		return "", "", errConvForbidden
	}
	value := normalizePlayerRemark(remark)
	if len([]rune(value)) > maxPlayerRemarkRunes {
		return "", "", newError(400, "REMARK_TOO_LONG", "备注名称不能超过20个字")
	}
	store, err := s.hostedPrefsStore()
	if err != nil {
		return "", "", err
	}
	if err := store.SetPlayerRemark(ctx, peerGuuid, value, agentID, agentName); err != nil {
		return "", "", err
	}
	return value, peerGuuid, nil
}

// SetHostedPin 置顶或取消置顶一条托管会话，返回会话对方 guuid。
func (s *Service) SetHostedPin(ctx context.Context, hostedGuuid, conversationID string, pinned bool,
	agentID int64, agentName string) (string, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return "", err
	}
	conv, _, _, err := s.requireConversation(ctx, s.hostedSession(ctx, record.Guuid), conversationID)
	if err != nil {
		return "", err
	}
	store, err := s.hostedPrefsStore()
	if err != nil {
		return "", err
	}
	if err := store.SetHostedPin(ctx, HostedPinConversation, conv.ID, pinned, agentID, agentName); err != nil {
		return "", err
	}
	return strings.TrimSpace(conv.PeerGuuid(record.Guuid)), nil
}

// SetHostedTargetPin 统一处理三级置顶：分组（联盟/俱乐部）、托管账号（盟主/群主）、会话。
// 会话需要 hostedGuuid 做归属校验；托管账号和分组只校验目标存在。
// 返回受影响的托管账号 guuid（供 SSE 精确刷新），分组置顶返回空串。
func (s *Service) SetHostedTargetPin(ctx context.Context, targetType, targetID, hostedGuuid string,
	pinned bool, agentID int64, agentName string) (string, string, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return "", "", newError(400, "INVALID_REQUEST", "缺少置顶对象")
	}
	switch targetType {
	case HostedPinConversation:
		peerGuuid, err := s.SetHostedPin(ctx, hostedGuuid, targetID, pinned, agentID, agentName)
		return strings.TrimSpace(hostedGuuid), peerGuuid, err
	case HostedPinOwner:
		if _, err := s.requireHosted(ctx, targetID); err != nil {
			return "", "", err
		}
	case HostedPinGroup:
		if _, err := s.requireHostedGroup(ctx, targetID); err != nil {
			return "", "", err
		}
	default:
		return "", "", newError(400, "INVALID_REQUEST", "置顶类型不正确")
	}
	store, err := s.hostedPrefsStore()
	if err != nil {
		return "", "", err
	}
	if err := store.SetHostedPin(ctx, targetType, targetID, pinned, agentID, agentName); err != nil {
		return "", "", err
	}
	return "", "", nil
}

// requireHostedGroup 校验分组 key（形如 club:123 / union:45）确实有托管账号。
func (s *Service) requireHostedGroup(ctx context.Context, key string) (bool, error) {
	store, err := s.hostingStore()
	if err != nil {
		return false, err
	}
	records, err := store.ListHostings(ctx)
	if err != nil {
		return false, relationUnavailable(err)
	}
	for _, record := range records {
		if record.GroupType+":"+record.GroupID == key {
			return true, nil
		}
	}
	return false, newError(404, "GROUP_NOT_FOUND", "分组不存在或没有托管账号")
}

// DeleteHostedConversation 永久删除一条托管会话及其消息、图片和语音。
// 托管记录即使已取消也允许删除，方便客服清理历史脏数据。
func (s *Service) DeleteHostedConversation(ctx context.Context, hostedGuuid, conversationID string) (string, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return "", err
	}
	conv, _, _, err := s.requireConversation(ctx, s.hostedSession(ctx, record.Guuid), conversationID)
	if err != nil {
		return "", err
	}
	peerGuuid := strings.TrimSpace(conv.PeerGuuid(record.Guuid))
	store, err := s.hostedPrefsStore()
	if err != nil {
		return "", err
	}
	keys, err := store.DeleteHostedConversation(ctx, record.Guuid, conv.ID)
	if err != nil {
		return "", err
	}
	if s.media != nil && len(keys) > 0 {
		s.media.Remove(keys...)
	}
	return peerGuuid, nil
}
