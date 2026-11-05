package directchat

import (
	"context"
	"sort"
	"strings"
	"time"
)

// 聊天托管：大群主/盟主在游戏内开启后，客服工作台按联盟或俱乐部归组，
// 查看其私聊并以该账号身份回复。托管只是读取与代发入口，不改变会话模型。

const (
	HostingGroupUnion = "union"
	HostingGroupClub  = "club"
)

// HostingInfo 是游戏客户端看到的状态与身份。
type HostingInfo struct {
	Eligible  bool   `json:"eligible"`
	Enabled   bool   `json:"enabled"`
	Role      string `json:"role"`
	RoleName  string `json:"roleName"`
	GroupType string `json:"groupType"`
	GroupID   string `json:"groupId"`
	GroupName string `json:"groupName"`
	ClubID    string `json:"clubId"`
	ClubName  string `json:"clubName"`
	EnabledAt string `json:"enabledAt"`
	Message   string `json:"message,omitempty"`
}

// HostedOwnerView 是客服工作台分组里的托管账号摘要。
type HostedOwnerView struct {
	Guuid             string `json:"guuid"`
	Name              string `json:"name"`
	Avatar            string `json:"avatar"`
	Role              string `json:"role"`
	RoleName          string `json:"roleName"`
	GroupType         string `json:"groupType"`
	GroupID           string `json:"groupId"`
	GroupName         string `json:"groupName"`
	ClubID            string `json:"clubId"`
	ClubName          string `json:"clubName"`
	EnabledAt         string `json:"enabledAt"`
	ConversationCount int    `json:"conversationCount"`
	Unread            int    `json:"unread"`
	LastMessageAt     string `json:"lastMessageAt"`
}

// HostedGroupView 是客服工作台的一级分组（联盟或俱乐部）。
type HostedGroupView struct {
	Key   string            `json:"key"`
	Type  string            `json:"type"`
	Name  string            `json:"name"`
	Items []HostedOwnerView `json:"items"`
}

// HostedConversationView 是托管账号的一条会话摘要。
type HostedConversationView struct {
	ConversationView
	HostedGuuid    string `json:"hostedGuuid"`
	HostedName     string `json:"hostedName"`
	HostedRole     string `json:"hostedRole"`
	HostedRoleName string `json:"hostedRoleName"`
}

// HostingStatus 返回当前账号是否可以开启托管，以及是否已开启。
func (s *Service) HostingStatus(ctx context.Context, session Session) (HostingInfo, error) {
	info, err := s.hostingEligibility(ctx, session.Guuid)
	if err != nil {
		return HostingInfo{}, err
	}
	store, err := s.hostingStore()
	if err != nil {
		return HostingInfo{}, err
	}
	record, ok, err := store.GetHosting(ctx, session.Guuid)
	if err != nil {
		return HostingInfo{}, err
	}
	if !ok {
		return info, nil
	}
	// 身份或归属已变化时自动失效，避免客服继续看到已失去权限的账号。
	if !info.Eligible || record.GroupType != info.GroupType || record.GroupID != info.GroupID {
		if err := store.DeleteHosting(ctx, session.Guuid); err != nil && s.logger != nil {
			s.logger.Warn("清理失效聊天托管失败", "guuid", session.Guuid, "error", err)
		}
		return info, nil
	}
	if record.GroupName != info.GroupName {
		record.GroupName = info.GroupName
		record.UpdatedAt = time.Now()
		if err := store.UpsertHosting(ctx, record); err != nil && s.logger != nil {
			s.logger.Warn("更新聊天托管分组名称失败", "guuid", session.Guuid, "error", err)
		}
	}
	info.Enabled = true
	info.GroupName = record.GroupName
	info.EnabledAt = fmtTime(record.EnabledAt)
	return info, nil
}

// SetHosting 开启或关闭当前账号的聊天托管。
func (s *Service) SetHosting(ctx context.Context, session Session, enabled bool) (HostingInfo, error) {
	store, err := s.hostingStore()
	if err != nil {
		return HostingInfo{}, err
	}
	if !enabled {
		if err := store.DeleteHosting(ctx, session.Guuid); err != nil {
			return HostingInfo{}, err
		}
		info, err := s.hostingEligibility(ctx, session.Guuid)
		if err != nil {
			return HostingInfo{}, err
		}
		return info, nil
	}
	info, err := s.hostingEligibility(ctx, session.Guuid)
	if err != nil {
		return HostingInfo{}, err
	}
	if !info.Eligible {
		return HostingInfo{}, errHostingForbidden
	}
	now := time.Now()
	if err := store.UpsertHosting(ctx, Hosting{
		Guuid: session.Guuid, GroupType: info.GroupType, GroupID: info.GroupID,
		GroupName: info.GroupName, ClubID: info.ClubID, Role: info.Role,
		EnabledAt: now, UpdatedAt: now,
	}); err != nil {
		return HostingInfo{}, err
	}
	info.Enabled = true
	info.EnabledAt = fmtTime(now)
	return info, nil
}

// HostedGroups 返回客服工作台可见的托管账号，按联盟/俱乐部归组。
func (s *Service) HostedGroups(ctx context.Context) ([]HostedGroupView, error) {
	store, err := s.hostingStore()
	if err != nil {
		return nil, err
	}
	records, err := store.ListHostings(ctx)
	if err != nil {
		return nil, err
	}
	groups := map[string]*HostedGroupView{}
	order := make([]string, 0, len(records))
	for _, record := range records {
		info, eligibleErr := s.hostingEligibility(ctx, record.Guuid)
		if eligibleErr != nil {
			return nil, relationUnavailable(eligibleErr)
		}
		if !info.Eligible || info.GroupType != record.GroupType || info.GroupID != record.GroupID {
			if err := store.DeleteHosting(ctx, record.Guuid); err != nil && s.logger != nil {
				s.logger.Warn("清理失效聊天托管失败", "guuid", record.Guuid, "error", err)
			}
			continue
		}
		session := s.hostedSession(ctx, record.Guuid)
		views, listErr := s.hostedConversationViews(ctx, session)
		if listErr != nil {
			return nil, relationUnavailable(listErr)
		}
		key := record.GroupType + ":" + record.GroupID
		group := groups[key]
		if group == nil {
			group = &HostedGroupView{Key: key, Type: record.GroupType, Name: record.GroupName}
			groups[key] = group
			order = append(order, key)
		}
		owner := HostedOwnerView{
			Guuid: record.Guuid, Name: session.Name, Avatar: session.Avatar,
			Role: record.Role, RoleName: info.RoleName,
			GroupType: record.GroupType, GroupID: record.GroupID, GroupName: record.GroupName,
			ClubID: record.ClubID, EnabledAt: fmtTime(record.EnabledAt),
			ConversationCount: len(views),
		}
		for _, view := range views {
			owner.Unread += view.Unread
			if view.LastMessageAt > owner.LastMessageAt {
				owner.LastMessageAt = view.LastMessageAt
			}
		}
		group.Items = append(group.Items, owner)
	}
	result := make([]HostedGroupView, 0, len(groups))
	for _, key := range order {
		group := groups[key]
		sort.SliceStable(group.Items, func(i, j int) bool {
			if group.Items[i].Unread != group.Items[j].Unread {
				return group.Items[i].Unread > group.Items[j].Unread
			}
			if group.Items[i].LastMessageAt != group.Items[j].LastMessageAt {
				return group.Items[i].LastMessageAt > group.Items[j].LastMessageAt
			}
			return group.Items[i].Name < group.Items[j].Name
		})
		result = append(result, *group)
	}
	// 联盟分组排在俱乐部前面，方便客服先看跨俱乐部托管。
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Type != result[j].Type {
			return result[i].Type == HostingGroupUnion
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}

// HostingRecord 读取账号当前托管记录。消息通知只需要判断是否开启，
// 不做身份重算，避免每条消息额外查询俱乐部关系。
func (s *Service) HostingRecord(ctx context.Context, guuid string) (Hosting, bool, error) {
	store, err := s.hostingStore()
	if err != nil {
		return Hosting{}, false, err
	}
	return store.GetHosting(ctx, guuid)
}

// HostedBalance 是托管会话对方在当前俱乐部的积分。
type HostedBalance struct {
	ClubID    string `json:"clubId"`
	ClubName  string `json:"clubName"`
	PeerGuuid string `json:"peerGuuid"`
	PeerName  string `json:"peerName"`
	ClubGold  *int64 `json:"clubGold"`
}

// HostedBalance 读取会话对方在当前俱乐部的积分，供客服上下分旁展示。
func (s *Service) HostedBalance(ctx context.Context, hostedGuuid, conversationID string) (HostedBalance, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return HostedBalance{}, err
	}
	session := s.hostedSession(ctx, record.Guuid)
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return HostedBalance{}, err
	}
	peerGuuid := strings.TrimSpace(conv.PeerGuuid(record.Guuid))
	member, ok, err := s.peerForClub(ctx, conv.ClubID, peerGuuid)
	if err != nil {
		return HostedBalance{}, relationUnavailable(err)
	}
	if !ok {
		return HostedBalance{}, errPeerNotClubMember
	}
	club, err := s.directory.GetClub(ctx, conv.ClubID)
	if err != nil {
		return HostedBalance{}, err
	}
	name := strings.TrimSpace(member.Name)
	if name == "" {
		name = peerGuuid
	}
	view := HostedBalance{ClubID: club.ClubID, ClubName: club.ClubName, PeerGuuid: peerGuuid, PeerName: name}
	value, ok, err := s.directory.GetClubGold(ctx, conv.ClubID, peerGuuid)
	if err != nil {
		return HostedBalance{}, relationUnavailable(err)
	}
	if ok {
		view.ClubGold = &value
	}
	return view, nil
}

// HostedGoldTarget 是客服上下分要操作的对象（会话对方）。
type HostedGoldTarget struct {
	ClubID    string
	PeerGuuid string
	PeerName  string
}

// HostedGoldTarget 校验托管状态与会话归属，返回上下分目标。
func (s *Service) HostedGoldTarget(ctx context.Context, hostedGuuid, conversationID string) (HostedGoldTarget, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return HostedGoldTarget{}, err
	}
	session := s.hostedSession(ctx, record.Guuid)
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return HostedGoldTarget{}, err
	}
	peerGuuid := strings.TrimSpace(conv.PeerGuuid(record.Guuid))
	if peerGuuid == "" || peerGuuid == record.Guuid {
		return HostedGoldTarget{}, errConvForbidden
	}
	member, ok, err := s.peerForClub(ctx, conv.ClubID, peerGuuid)
	if err != nil {
		return HostedGoldTarget{}, relationUnavailable(err)
	}
	if !ok {
		return HostedGoldTarget{}, errPeerNotClubMember
	}
	name := strings.TrimSpace(member.Name)
	if name == "" {
		name = peerGuuid
	}
	return HostedGoldTarget{ClubID: conv.ClubID, PeerGuuid: peerGuuid, PeerName: name}, nil
}

// HostedConversations 返回某个托管账号的真实会话摘要（按最后消息倒序）。
func (s *Service) HostedConversations(ctx context.Context, hostedGuuid string) ([]HostedConversationView, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return nil, err
	}
	views, err := s.hostedConversationViews(ctx, s.hostedSession(ctx, record.Guuid))
	if err != nil {
		return nil, relationUnavailable(err)
	}
	result := make([]HostedConversationView, 0, len(views))
	roleName := ""
	if info, infoErr := s.hostingEligibility(ctx, record.Guuid); infoErr == nil {
		roleName = info.RoleName
	}
	for _, view := range views {
		result = append(result, HostedConversationView{
			ConversationView: view, HostedGuuid: record.Guuid,
			HostedName: s.hostedSession(ctx, record.Guuid).Name, HostedRole: record.Role,
			HostedRoleName: roleName,
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].LastMessageAt != result[j].LastMessageAt {
			return result[i].LastMessageAt > result[j].LastMessageAt
		}
		return result[i].Peer.Name < result[j].Peer.Name
	})
	return result, nil
}

// HostedMessages 以托管账号身份读取会话消息。读取最新一页时同步推进客服共享的
// 已读游标：任一客服打开会话后，其他客服看到的未读红点也一起清除。
func (s *Service) HostedMessages(ctx context.Context, hostedGuuid, conversationID, before, after string, limit int) (MessagePage, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return MessagePage{}, err
	}
	page, err := s.Messages(ctx, s.hostedSession(ctx, record.Guuid), conversationID, before, after, limit)
	if err != nil {
		return MessagePage{}, err
	}
	if strings.TrimSpace(before) == "" && strings.TrimSpace(after) == "" && len(page.Items) > 0 {
		if store, storeErr := s.hostingStore(); storeErr == nil {
			newest := page.Items[len(page.Items)-1]
			if markErr := store.SetHostingRead(ctx, page.ConversationID, newest.ID); markErr != nil && s.logger != nil {
				s.logger.Warn("更新托管已读游标失败", "conversation_id", page.ConversationID, "error", markErr)
			}
		}
	}
	return page, nil
}

// SendHostedMessage 以托管账号身份发送消息，返回对方和俱乐部，供调用方推送实时事件。
func (s *Service) SendHostedMessage(ctx context.Context, hostedGuuid, conversationID string, request SendRequest) (MessageView, bool, string, string, error) {
	record, err := s.requireHosted(ctx, hostedGuuid)
	if err != nil {
		return MessageView{}, false, "", "", err
	}
	session := s.hostedSession(ctx, record.Guuid)
	recipient, clubID, err := s.RealtimeTarget(ctx, session, conversationID)
	if err != nil {
		return MessageView{}, false, "", "", err
	}
	view, duplicate, err := s.SendMessage(ctx, session, conversationID, request)
	if err != nil {
		return MessageView{}, false, "", "", err
	}
	return view, duplicate, recipient, clubID, nil
}

// ---------------- 内部工具 ----------------

func (s *Service) hostingStore() (HostingStore, error) {
	store, ok := s.store.(HostingStore)
	if !ok {
		return nil, newError(500, "INTERNAL_ERROR", "托管存储未启用")
	}
	return store, nil
}

// hostingEligibility 计算账号的托管身份：联盟总群主优先归到联盟，否则
// 已入盟俱乐部的创建者归到俱乐部。未入盟的群主不开放托管。
func (s *Service) hostingEligibility(ctx context.Context, guuid string) (HostingInfo, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return HostingInfo{Message: "当前账号未登录"}, nil
	}
	clubs, err := s.directory.ListMyClubs(ctx, guuid)
	if err != nil {
		return HostingInfo{}, relationUnavailable(err)
	}
	for _, club := range clubs {
		union, ok, unionErr := s.directory.GetUnionByClub(ctx, club.ClubID)
		if unionErr != nil {
			return HostingInfo{}, relationUnavailable(unionErr)
		}
		if !ok || strings.TrimSpace(union.OwnerGuuid) != guuid {
			continue
		}
		clubID := strings.TrimSpace(union.OwnerClub)
		if clubID == "" {
			clubID = club.ClubID
		}
		return HostingInfo{
			Eligible: true, Role: RoleUnionOwner, RoleName: "大盟主",
			GroupType: HostingGroupUnion, GroupID: union.ID, GroupName: union.Name,
			ClubID: clubID, ClubName: club.ClubName,
		}, nil
	}
	// 俱乐部创建者都能托管：已入盟显示盟主并归俱乐部，未入盟显示群主。
	var fallback *HostingInfo
	for _, club := range clubs {
		if strings.TrimSpace(club.OwnerGuuid) != guuid {
			continue
		}
		_, ok, unionErr := s.directory.GetUnionByClub(ctx, club.ClubID)
		if unionErr != nil {
			return HostingInfo{}, relationUnavailable(unionErr)
		}
		info := HostingInfo{
			Eligible: true, Role: RoleOwner,
			GroupType: HostingGroupClub, GroupID: club.ClubID, GroupName: club.ClubName,
			ClubID: club.ClubID, ClubName: club.ClubName,
		}
		if ok {
			info.RoleName = "盟主"
			return info, nil
		}
		info.RoleName = "群主"
		if fallback == nil {
			copy := info
			fallback = &copy
		}
	}
	if fallback != nil {
		return *fallback, nil
	}
	return HostingInfo{Message: "只有俱乐部群主、盟主或大盟主可以开启聊天托管"}, nil
}

func (s *Service) requireHosted(ctx context.Context, guuid string) (Hosting, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return Hosting{}, errHostingInactive
	}
	store, err := s.hostingStore()
	if err != nil {
		return Hosting{}, err
	}
	record, ok, err := store.GetHosting(ctx, guuid)
	if err != nil {
		return Hosting{}, err
	}
	if !ok {
		return Hosting{}, errHostingInactive
	}
	info, err := s.hostingEligibility(ctx, guuid)
	if err != nil {
		return Hosting{}, err
	}
	if !info.Eligible || info.GroupType != record.GroupType || info.GroupID != record.GroupID {
		if err := store.DeleteHosting(ctx, guuid); err != nil && s.logger != nil {
			s.logger.Warn("清理失效聊天托管失败", "guuid", guuid, "error", err)
		}
		return Hosting{}, errHostingInactive
	}
	return record, nil
}

func (s *Service) hostedSession(ctx context.Context, guuid string) Session {
	name := guuid
	avatar := ""
	if user, ok, err := s.directory.GetAccount(ctx, guuid); err == nil && ok {
		if strings.TrimSpace(user.Name) != "" {
			name = user.Name
		}
		avatar = user.Avatar
	}
	return Session{Guuid: guuid, Name: name, Avatar: avatar}
}

// hostedConversationViews 读取托管账号的全部真实会话（没有消息的空入口不返回）。
func (s *Service) hostedConversationViews(ctx context.Context, session Session) ([]ConversationView, error) {
	const maxConversations = 200
	all := make([]ConversationView, 0)
	seen := map[string]bool{}
	for offset := 0; offset < maxConversations; offset += MaxPageSize {
		items, total, err := s.store.ListConversationsByUser(ctx, session.Guuid, offset, MaxPageSize)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if item.Conversation.LastMessageID == "" && item.Conversation.LastMessageAt.IsZero() {
				continue
			}
			view, ok := s.conversationView(ctx, session, item)
			if !ok || seen[view.ConversationID] {
				continue
			}
			seen[view.ConversationID] = true
			all = append(all, view)
		}
		if offset+len(items) >= total || len(items) == 0 {
			break
		}
	}
	if store, err := s.hostingStore(); err == nil && len(all) > 0 {
		ids := make([]string, 0, len(all))
		for _, view := range all {
			ids = append(ids, view.ConversationID)
		}
		counts, countErr := store.HostingUnreadCounts(ctx, ids, session.Guuid)
		if countErr != nil {
			return nil, countErr
		}
		for i := range all {
			all[i].Unread = counts[all[i].ConversationID]
		}
	}
	return all, nil
}
