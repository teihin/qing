package directchat

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// systemNoticePattern 是客户端唯一允许发出的系统通报格式：
// 「玩家 名字 上分/下分/赠送 金额 成功」，可选带「，积分 A → B」；
// 客服托管代发的通报末尾带「（客服托管）」。
var systemNoticePattern = regexp.MustCompile(`^玩家 .{1,40} (上分|下分|赠送) [1-9]\d{0,11} 成功(，积分 \d{1,15} → \d{1,15})?(（客服托管）)?$`)

// Directory 是游戏俱乐部目录查询接口。生产实现直接读取游戏库，
// 测试使用内存实现。它不允许直聊服务写入游戏库。
type Directory interface {
	ListMyClubs(ctx context.Context, guuid string) ([]Club, error)
	GetClub(ctx context.Context, clubID string) (Club, error)
	GetMember(ctx context.Context, clubID, guuid string) (Member, bool, error)
	ListMembers(ctx context.Context, clubID, keyword, excludeGuuid string, offset, limit int) ([]Member, int, error)
	/** 俱乐部所属联盟；未入盟 ok=false。 */
	GetUnionByClub(ctx context.Context, clubID string) (Union, bool, error)
	/** 跨俱乐部展示昵称/头像（联盟总群主不是对方俱乐部成员）。 */
	GetAccount(ctx context.Context, guuid string) (GameUser, bool, error)
	/** 账号在指定俱乐部的当前积分（元）。 */
	GetClubGold(ctx context.Context, clubID, guuid string) (int64, bool, error)
}

// Store 是直聊自身数据访问接口。SQLStore 是生产实现；测试使用内存实现。
// 俱乐部、成员和角色不属于 Store，避免误把游戏目录复制到聊天库。
type Store interface {
	UnreadByClub(ctx context.Context, guuid string) (map[string]int, error)

	FindConversation(ctx context.Context, clubID, pairKey string) (Conversation, bool, error)
	GetConversation(ctx context.Context, id string) (Conversation, bool, error)
	EnsureConversation(ctx context.Context, clubID, lowGuuid, highGuuid string) (Conversation, error)
	GetParticipant(ctx context.Context, conversationID, guuid string) (Participant, bool, error)
	RevealConversation(ctx context.Context, conversationID, guuid string) error
	HideConversation(ctx context.Context, conversationID, guuid string) error
	/** 单方清除：只记录清除时间，不删除消息行。 */
	ClearConversation(ctx context.Context, conversationID, guuid string) error
	SetLastRead(ctx context.Context, conversationID, guuid, messageID string) error
	ListConversations(ctx context.Context, clubID, guuid string, offset, limit int) ([]ConversationItem, int, error)
	/** 跨俱乐部：当前用户参与的全部会话（联盟总群主的跨俱乐部私聊在这里出现）。 */
	ListConversationsByUser(ctx context.Context, guuid string, offset, limit int) ([]ConversationItem, int, error)

	GetMessage(ctx context.Context, conversationID, messageID string) (Message, bool, error)
	FindMessageByClientID(ctx context.Context, conversationID, senderGuuid, clientID string) (Message, bool, error)
	InsertMessage(ctx context.Context, msg Message, receiverGuuid string) (Message, bool, error)
	MessagesBefore(ctx context.Context, conversationID string, cur *Cursor, notBefore time.Time, limit int) ([]Message, error)
	MessagesAfter(ctx context.Context, conversationID string, cur Cursor, notBefore time.Time, limit int) ([]Message, error)

	CreateAttachment(ctx context.Context, a Attachment) error
	GetAttachment(ctx context.Context, id string) (Attachment, bool, error)
	CompleteImageAttachment(ctx context.Context, id, storageKey, thumbKey, mime string, size int64, width, height int) error
	AttachmentsByIDs(ctx context.Context, ids []string) (map[string]Attachment, error)

	SaveSession(ctx context.Context, session Session) error
	LoadSession(ctx context.Context, tokenHash string) (Session, bool, error)
	TouchSession(ctx context.Context, tokenHash string)
	DeleteSession(ctx context.Context, tokenHash string) error
}

// Limiter 是发送频率限制器；不可用时按放行处理（限流不是权限判断）。
type Limiter interface {
	Allow(key string) bool
}

// Options 是直聊运行参数。
type Options struct {
	SessionTTL     time.Duration
	Retention      time.Duration
	CursorKey      []byte
	MediaTicketTTL time.Duration
	MinVoiceMS     int
	MaxVoiceMS     int
	AllowDevLogin  bool
	// LinkKey/LinkTTL 用于「游戏客户端轻量加密资料」换票，与客服入口同一套口令。
	LinkKey string
	LinkTTL time.Duration
}

// Service 承载全部直聊业务规则。
type Service struct {
	store     Store
	directory Directory
	tickets   TicketVerifier
	links     LinkVerifier
	media     *MediaStorage
	voice     *AudioVoiceProvider
	limiter   Limiter
	opts      Options
	logger    *slog.Logger
}

// NewService 组装业务层。
func NewService(store Store, directory Directory, tickets TicketVerifier, media *MediaStorage, voice *AudioVoiceProvider,
	limiter Limiter, opts Options, logger *slog.Logger) *Service {
	var links LinkVerifier
	if opts.SessionTTL <= 0 {
		opts.SessionTTL = 7 * 24 * time.Hour
	}
	if opts.MediaTicketTTL <= 0 {
		opts.MediaTicketTTL = 10 * time.Minute
	}
	if opts.MinVoiceMS <= 0 {
		opts.MinVoiceMS = MinVoiceDuration
	}
	if opts.MaxVoiceMS <= 0 {
		opts.MaxVoiceMS = 10000
	}
	if len(opts.CursorKey) == 0 {
		opts.CursorKey = []byte("chattool-direct-cursor-key")
	}
	if len(opts.LinkKey) >= 16 {
		links = NewAESLinkVerifier(opts.LinkKey, opts.LinkTTL)
	}
	return &Service{store: store, directory: directory, tickets: tickets, links: links, media: media, voice: voice,
		limiter: limiter, opts: opts, logger: logger}
}

// ---------------- 会话鉴权 ----------------

// CreateSession 用游戏票据换取聊天会话令牌。客户端不能传 meGuuid。
func (s *Service) CreateSession(ctx context.Context, ticket string) (string, Session, error) {
	user, err := s.tickets.Verify(ctx, strings.TrimSpace(ticket))
	if err != nil {
		return "", Session{}, AsError(err)
	}
	return s.issueSession(ctx, user)
}

// CreateLinkSession 用游戏客户端的轻量加密资料换取聊天令牌。
//
// 客户端提交的是密文（与客服入口同一套口令与 ts），服务端解密后才得到 guuid，
// 请求体里没有 meGuuid 字段，因此不构成「客户端自报身份」。
func (s *Service) CreateLinkSession(ctx context.Context, payload string) (string, Session, error) {
	if s.links == nil {
		return "", Session{}, errAuthRequired
	}
	user, err := s.links.Verify(ctx, strings.TrimSpace(payload))
	if err != nil {
		return "", Session{}, AsError(err)
	}
	return s.issueSession(ctx, user)
}

// CreateDevSession 仅用于联调/本地测试：必须显式开启，否则一律拒绝。
func (s *Service) CreateDevSession(ctx context.Context, guuid, name string) (string, Session, error) {
	if !s.opts.AllowDevLogin {
		return "", Session{}, errAuthRequired
	}
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return "", Session{}, errAuthRequired
	}
	if strings.TrimSpace(name) == "" {
		name = guuid
	}
	return s.issueSession(ctx, GameUser{Guuid: guuid, Name: name})
}

func (s *Service) issueSession(ctx context.Context, user GameUser) (string, Session, error) {
	token, err := NewToken()
	if err != nil {
		return "", Session{}, err
	}
	now := time.Now()
	session := Session{
		TokenHash:  HashToken(token),
		Guuid:      user.Guuid,
		Name:       user.Name,
		Avatar:     user.Avatar,
		ExpiresAt:  now.Add(s.opts.SessionTTL),
		CreatedAt:  now,
		LastSeenAt: now,
	}
	if session.Name == "" {
		session.Name = user.Guuid
	}
	if err := s.store.SaveSession(ctx, session); err != nil {
		return "", Session{}, err
	}
	return token, session, nil
}

// Authenticate 校验请求携带的令牌。
func (s *Service) Authenticate(ctx context.Context, token string) (Session, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return Session{}, errAuthRequired
	}
	session, ok, err := s.store.LoadSession(ctx, HashToken(token))
	if err != nil {
		return Session{}, err
	}
	if !ok {
		return Session{}, errAuthRequired
	}
	s.store.TouchSession(ctx, session.TokenHash)
	return session, nil
}

// Logout 注销当前会话。
func (s *Service) Logout(ctx context.Context, session Session) error {
	return s.store.DeleteSession(ctx, session.TokenHash)
}

// ---------------- 当前用户与俱乐部 ----------------

// MeView 是 /api/direct/me 的返回结构。
type MeView struct {
	Guuid  string     `json:"guuid"`
	Name   string     `json:"name"`
	Avatar string     `json:"avatar"`
	Clubs  []ClubView `json:"clubs"`
}

// ClubView 是俱乐部条目。
type ClubView struct {
	ClubID   string `json:"clubId"`
	ClubName string `json:"clubName"`
	Role     string `json:"role"`
	Unread   int    `json:"unread,omitempty"`
}

// Me 返回当前用户与所属俱乐部。
func (s *Service) Me(ctx context.Context, session Session) (MeView, error) {
	clubs, err := s.directory.ListMyClubs(ctx, session.Guuid)
	if err != nil {
		return MeView{}, relationUnavailable(err)
	}
	view := MeView{Guuid: session.Guuid, Name: session.Name, Avatar: session.Avatar, Clubs: []ClubView{}}
	for _, club := range clubs {
		view.Clubs = append(view.Clubs, ClubView{ClubID: club.ClubID, ClubName: club.ClubName, Role: club.Role})
	}
	return view, nil
}

// Clubs 返回当前用户的俱乐部与未读数。
func (s *Service) Clubs(ctx context.Context, session Session) ([]ClubView, error) {
	clubs, err := s.directory.ListMyClubs(ctx, session.Guuid)
	if err != nil {
		return nil, relationUnavailable(err)
	}
	unread, err := s.store.UnreadByClub(ctx, session.Guuid)
	if err != nil {
		return nil, err
	}
	views := make([]ClubView, 0, len(clubs))
	for _, club := range clubs {
		views = append(views, ClubView{ClubID: club.ClubID, ClubName: club.ClubName, Role: club.Role, Unread: unread[club.ClubID]})
	}
	return views, nil
}

// UnreadView 是未读汇总。
type UnreadView struct {
	Total  int            `json:"total"`
	ByClub map[string]int `json:"byClub"`
}

// Unread 返回所有俱乐部未读总和。
func (s *Service) Unread(ctx context.Context, session Session) (UnreadView, error) {
	byClub, err := s.store.UnreadByClub(ctx, session.Guuid)
	if err != nil {
		return UnreadView{}, err
	}
	total := 0
	for _, count := range byClub {
		total += count
	}
	return UnreadView{Total: total, ByClub: byClub}, nil
}

// MemberPage 是成员列表返回结构。
type MemberPage struct {
	ClubID   string       `json:"clubId"`
	Items    []MemberView `json:"items"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
	HasMore  bool         `json:"hasMore"`
	Role     string       `json:"role"`
}

// MemberView 是成员列表项。
type MemberView struct {
	Guuid   string `json:"guuid"`
	Name    string `json:"name"`
	Note    string `json:"note,omitempty"`
	Avatar  string `json:"avatar"`
	Role    string `json:"role"`
	Online  bool   `json:"online"`
	CanChat bool   `json:"canChat"`
}

// Members 分页返回当前俱乐部成员，不包含自己。联盟总群主可查看联盟内任意俱乐部。
func (s *Service) Members(ctx context.Context, session Session, clubID, keyword string, page, pageSize int) (MemberPage, error) {
	me, err := s.viewerForClub(ctx, session, clubID)
	if err != nil {
		return MemberPage{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	keyword = strings.TrimSpace(keyword)
	if len([]rune(keyword)) > 32 {
		keyword = string([]rune(keyword)[:32])
	}
	items, total, err := s.directory.ListMembers(ctx, clubID, keyword, session.Guuid, (page-1)*pageSize, pageSize)
	if err != nil {
		return MemberPage{}, relationUnavailable(err)
	}
	views := make([]MemberView, 0, len(items))
	for _, member := range items {
		peer := s.peerView(ctx, session, me, clubID, member)
		views = append(views, MemberView{
			Guuid: peer.Guuid, Name: peer.Name, Note: peer.Note, Avatar: peer.Avatar,
			Role: peer.Role, Online: member.Online,
			CanChat: CanCreateFromMemberList(me.Role) || me.IsUnionOwner,
		})
	}
	return MemberPage{ClubID: clubID, Items: views, Page: page, PageSize: pageSize,
		HasMore: page*pageSize < total, Role: me.Role}, nil
}

// ---------------- 会话列表 ----------------

// ConversationPage 是会话列表返回结构。
type ConversationPage struct {
	ClubID    string             `json:"clubId"`
	Items     []ConversationView `json:"items"`
	Page      int                `json:"page"`
	PageSize  int                `json:"pageSize"`
	HasMore   bool               `json:"hasMore"`
	Role      string             `json:"role"`
	CanDelete bool               `json:"canDelete"`
}

// AllConversationPage 是跨俱乐部消息列表返回结构。列表只聚合会话摘要，
// 具体消息仍通过 conversationId 进入原所属俱乐部的会话并单独鉴权。
type AllConversationPage struct {
	Items    []ConversationView `json:"items"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	HasMore  bool               `json:"hasMore"`
}

// Conversations 返回当前俱乐部会话与玩家固定入口。
func (s *Service) Conversations(ctx context.Context, session Session, clubID string, page, pageSize int) (ConversationPage, error) {
	me, err := s.viewerForClub(ctx, session, clubID)
	if err != nil {
		return ConversationPage{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	items, total, err := s.store.ListConversations(ctx, clubID, session.Guuid, (page-1)*pageSize, pageSize)
	if err != nil {
		return ConversationPage{}, err
	}
	if err := s.enrichConversationPeers(ctx, clubID, items); err != nil {
		return ConversationPage{}, relationUnavailable(err)
	}
	club, err := s.directory.GetClub(ctx, clubID)
	if err != nil {
		return ConversationPage{}, err
	}
	views := s.buildConversationViews(ctx, session, club, me, items)
	return ConversationPage{
		ClubID: clubID, Items: views, Page: page, PageSize: pageSize,
		HasMore: page*pageSize < total, Role: me.Role, CanDelete: CanHideConversation(me.Role),
	}, nil
}

// AllConversations 返回当前账号所有会话摘要，并按最新消息统一排序。
// 会话不跨俱乐部合并：同一个人在多个俱乐部各有一条；联盟总群主的跨俱乐部
// 会话按对方所在俱乐部归属，因此这里不能只遍历“我的俱乐部”。
func (s *Service) AllConversations(ctx context.Context, session Session, page, pageSize int) (AllConversationPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	all := make([]ConversationView, 0)
	seen := map[string]bool{}
	for offset := 0; ; offset += MaxPageSize {
		items, total, err := s.store.ListConversationsByUser(ctx, session.Guuid, offset, MaxPageSize)
		if err != nil {
			return AllConversationPage{}, err
		}
		for _, item := range items {
			view, ok := s.conversationView(ctx, session, item)
			if !ok {
				continue
			}
			key := view.ClubID + "|" + view.Peer.Guuid
			if seen[key] {
				continue
			}
			seen[key] = true
			all = append(all, view)
		}
		if offset+len(items) >= total || len(items) == 0 {
			break
		}
	}
	// 固定入口按俱乐部补齐：本俱乐部老板（盟主/群主）与联盟大盟主。
	clubs, err := s.directory.ListMyClubs(ctx, session.Guuid)
	if err != nil {
		return AllConversationPage{}, err
	}
	for _, club := range clubs {
		me, err := s.viewerForClub(ctx, session, club.ClubID)
		if err != nil {
			continue
		}
		for _, target := range s.defaultTargets(ctx, club, me) {
			key := club.ClubID + "|" + target.Guuid
			if seen[key] {
				continue
			}
			seen[key] = true
			all = append(all, s.fixedConversationView(ctx, session, club, me, target))
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		// 排序优先级：有未读的在前 → 固定上级入口次之 → 最后消息时间倒序。
		unreadI := all[i].Unread > 0
		unreadJ := all[j].Unread > 0
		if unreadI != unreadJ {
			return unreadI
		}
		if all[i].IsDefaultTarget != all[j].IsDefaultTarget {
			return all[i].IsDefaultTarget
		}
		if all[i].LastMessageAt != all[j].LastMessageAt {
			return all[i].LastMessageAt > all[j].LastMessageAt
		}
		if all[i].ClubName != all[j].ClubName {
			return all[i].ClubName < all[j].ClubName
		}
		if all[i].Peer.Name != all[j].Peer.Name {
			return all[i].Peer.Name < all[j].Peer.Name
		}
		return all[i].Peer.Guuid < all[j].Peer.Guuid
	})
	start := (page - 1) * pageSize
	if start > len(all) {
		start = len(all)
	}
	end := start + pageSize
	if end > len(all) {
		end = len(all)
	}
	items := all[start:end]
	if items == nil {
		items = []ConversationView{}
	}
	return AllConversationPage{Items: items, Page: page, PageSize: pageSize, HasMore: end < len(all)}, nil
}

// conversationView 把一个真实会话转成列表项。俱乐部或查看者权限已失效时跳过。
func (s *Service) conversationView(ctx context.Context, session Session, item ConversationItem) (ConversationView, bool) {
	conv := item.Conversation
	club, err := s.directory.GetClub(ctx, conv.ClubID)
	if err != nil {
		return ConversationView{}, false
	}
	me, err := s.viewerForClub(ctx, session, club.ClubID)
	if err != nil {
		return ConversationView{}, false
	}
	peer, peerOK, err := s.peerForClub(ctx, club.ClubID, item.PeerGuuid)
	if err != nil {
		return ConversationView{}, false
	}
	if !peerOK {
		// 对方已退出：保留历史摘要，用已知资料或 guuid 占位。
		peer = Member{Guuid: item.PeerGuuid, Name: item.PeerGuuid, Role: RoleMember}
		if strings.TrimSpace(item.Peer.Guuid) != "" {
			peer = item.Peer
		}
	}
	return ConversationView{
		ConversationID:  conv.ID,
		IsDefaultTarget: s.isFixedTarget(ctx, club, me, item.PeerGuuid),
		ID:              conv.ID,
		ClubID:          club.ClubID,
		ClubName:        club.ClubName,
		Peer:            s.peerView(ctx, session, me, club.ClubID, peer),
		LastMessage:     item.LastText,
		LastMessageType: item.LastType,
		LastMessageAt:   fmtMilliTime(conv.LastMessageAt),
		Unread:          item.Unread,
		CanSend:         peerOK,
	}, true
}

// fixedConversationView 生成固定联系人入口；已有隐藏会话时也复用同一 conversationId。
func (s *Service) fixedConversationView(ctx context.Context, session Session, club Club, me Member, target Member) ConversationView {
	view := ConversationView{
		IsDefaultTarget: true,
		ClubID:          club.ClubID,
		ClubName:        club.ClubName,
		Peer:            s.peerView(ctx, session, me, club.ClubID, target),
		CanSend:         true,
	}
	_, _, pairKey := PairKey(session.Guuid, target.Guuid)
	if existing, ok, err := s.store.FindConversation(ctx, club.ClubID, pairKey); err == nil && ok {
		view.ConversationID = existing.ID
		view.ID = existing.ID
		view.LastMessage, view.LastMessageType = s.lastPreview(ctx, existing, session.Guuid)
		view.LastMessageAt = fmtMilliTime(existing.LastMessageAt)
	}
	return view
}

func (s *Service) enrichConversationPeers(ctx context.Context, clubID string, items []ConversationItem) error {
	for i := range items {
		if items[i].PeerGuuid == "" {
			continue
		}
		member, ok, err := s.directory.GetMember(ctx, clubID, items[i].PeerGuuid)
		if err != nil {
			return err
		}
		if ok {
			items[i].Peer = member
		}
	}
	return nil
}

func (s *Service) buildConversationViews(ctx context.Context, session Session, club Club, me Member, items []ConversationItem) []ConversationView {
	views := make([]ConversationView, 0, len(items)+3)
	seen := map[string]bool{}
	for _, item := range items {
		view, ok := s.conversationView(ctx, session, item)
		if !ok {
			continue
		}
		seen[item.PeerGuuid] = true
		views = append(views, view)
	}
	for _, target := range s.defaultTargets(ctx, club, me) {
		if seen[target.Guuid] {
			continue
		}
		seen[target.Guuid] = true
		views = append(views, s.fixedConversationView(ctx, session, club, me, target))
	}
	return views
}

func (s *Service) lastPreview(ctx context.Context, conv Conversation, guuid string) (string, string) {
	if conv.LastMessageID == "" {
		return "", ""
	}
	participant, ok, err := s.store.GetParticipant(ctx, conv.ID, guuid)
	if err != nil || (ok && !participant.ClearedAt.IsZero() && !conv.LastMessageAt.After(participant.ClearedAt)) {
		return "", ""
	}
	msg, ok, err := s.store.GetMessage(ctx, conv.ID, conv.LastMessageID)
	if err != nil || !ok {
		return "", ""
	}
	return previewText(msg), msg.MessageType
}

// defaultTargets 返回默认对话入口：本俱乐部老板（盟主/群主）与联盟大盟主。
// 玩家和合伙人只保留这两级，代理链条上的其他层级（含直属上级合伙人）不再生成默认入口；
// 他们已有的真实会话仍按普通会话显示。两人为同一人时去重，对方已退出或不存在时跳过。
func (s *Service) defaultTargets(ctx context.Context, club Club, me Member) []Member {
	result := make([]Member, 0, 2)
	// 大群主在联盟内没有需要固定置顶的上级/老板入口，直接用成员列表找人。
	if me.IsUnionOwner || me.Role == RoleUnionOwner {
		return result
	}
	seen := map[string]bool{strings.TrimSpace(me.Guuid): true}
	add := func(member Member) {
		guuid := strings.TrimSpace(member.Guuid)
		if guuid == "" || seen[guuid] {
			return
		}
		seen[guuid] = true
		result = append(result, member)
	}
	if strings.TrimSpace(club.OwnerGuuid) != "" {
		if member, ok, err := s.directory.GetMember(ctx, club.ClubID, club.OwnerGuuid); err == nil && ok {
			add(member)
		}
	}
	if union, ok, err := s.directory.GetUnionByClub(ctx, club.ClubID); err == nil && ok {
		if member, ok, err := s.peerForClub(ctx, club.ClubID, union.OwnerGuuid); err == nil && ok {
			add(member)
		}
	}
	return result
}

// isFixedTarget 判断会话是否属于默认入口（不可隐藏）：本俱乐部老板（盟主/群主）与联盟大盟主。
// 口径必须与 defaultTargets 一致；与直属上级合伙人的会话改按普通会话处理。
func (s *Service) isFixedTarget(ctx context.Context, club Club, me Member, peerGuuid string) bool {
	peerGuuid = strings.TrimSpace(peerGuuid)
	if peerGuuid == "" || peerGuuid == strings.TrimSpace(me.Guuid) {
		return false
	}
	if me.IsUnionOwner || me.Role == RoleUnionOwner {
		return false
	}
	if strings.TrimSpace(club.OwnerGuuid) == peerGuuid {
		return true
	}
	if union, ok, err := s.directory.GetUnionByClub(ctx, club.ClubID); err == nil && ok &&
		strings.TrimSpace(union.OwnerGuuid) == peerGuuid {
		return true
	}
	return false
}

func (s *Service) peerView(ctx context.Context, session Session, viewer Member, clubID string, member Member) PeerView {
	note := ""
	if s.canSeeMemberNote(ctx, clubID, viewer, member) {
		note = member.Note
	}
	return PeerView{Guuid: member.Guuid, Name: member.Name, Note: note, Avatar: member.Avatar,
		Role: member.Role, RoleName: s.roleDisplayName(ctx, clubID, member)}
}

// roleDisplayName 与游戏内统一：联盟创始人=大盟主，已入盟俱乐部创始人=盟主，
// 未入盟创始人=群主，代理/上级代理=合伙人。
func (s *Service) roleDisplayName(ctx context.Context, clubID string, member Member) string {
	switch member.Role {
	case RoleUnionOwner:
		return "大盟主"
	case RoleOwner:
		if member.IsUnionOwner {
			return "大盟主"
		}
		if _, ok, err := s.directory.GetUnionByClub(ctx, clubID); err == nil && ok {
			return "盟主"
		}
		return "群主"
	case RoleLeader, RoleAgent:
		return "合伙人"
	case RoleManager:
		return "管理员"
	default:
		return "玩家"
	}
}

// canSeeMemberNote 只允许目标成员的俱乐部上级链查看备注；下级、同级和无关系成员不返回。
func (s *Service) canSeeMemberNote(ctx context.Context, clubID string, viewer, target Member) bool {
	if strings.TrimSpace(target.Note) == "" || strings.TrimSpace(viewer.Guuid) == "" || viewer.Guuid == target.Guuid {
		return false
	}
	current := target
	seen := map[string]bool{}
	for i := 0; i < 64; i++ {
		currentGuuid := strings.TrimSpace(current.Guuid)
		if currentGuuid == "" || seen[currentGuuid] {
			return false
		}
		seen[currentGuuid] = true
		upper := strings.TrimSpace(current.SuperiorAgentGuuid)
		if upper == "" {
			return false
		}
		if upper == strings.TrimSpace(viewer.Guuid) {
			return true
		}
		next, ok, err := s.directory.GetMember(ctx, clubID, upper)
		if err != nil || !ok {
			return false
		}
		current = next
	}
	return false
}

// CreateConversation 创建或获取会话（幂等）。同时清除当前用户的隐藏状态。
//
// clubID 是会话归属俱乐部：同俱乐部聊天就是该俱乐部；联盟总群主跨俱乐部
// 聊天时是对方所在的俱乐部。普通成员只能和本俱乐部成员、以及本联盟大群主
// 建会话；大群主可以和联盟内任意成员建会话。
func (s *Service) CreateConversation(ctx context.Context, session Session, clubID, peerGuuid string) (ConversationView, error) {
	peerGuuid = strings.TrimSpace(peerGuuid)
	if peerGuuid == "" {
		return ConversationView{}, invalidMessage("缺少对方账号")
	}
	if peerGuuid == session.Guuid {
		return ConversationView{}, invalidMessage("不能和自己建立会话")
	}
	club, err := s.directory.GetClub(ctx, clubID)
	if err != nil {
		return ConversationView{}, err
	}
	me, err := s.viewerForClub(ctx, session, clubID)
	if err != nil {
		return ConversationView{}, err
	}
	peer, ok, err := s.peerForClub(ctx, clubID, peerGuuid)
	if err != nil {
		return ConversationView{}, relationUnavailable(err)
	}
	if !ok {
		return ConversationView{}, errPeerNotClubMember
	}
	conv, err := s.store.EnsureConversation(ctx, clubID, session.Guuid, peerGuuid)
	if err != nil {
		return ConversationView{}, err
	}
	if err := s.store.RevealConversation(ctx, conv.ID, session.Guuid); err != nil {
		return ConversationView{}, err
	}
	lastText, lastType := s.lastPreview(ctx, conv, session.Guuid)
	unread := 0
	items, _, err := s.store.ListConversations(ctx, clubID, session.Guuid, 0, MaxPageSize)
	if err == nil {
		for _, item := range items {
			if item.Conversation.ID == conv.ID {
				unread = item.Unread
				break
			}
		}
	}
	return ConversationView{
		ConversationID:  conv.ID,
		ID:              conv.ID,
		ClubID:          clubID,
		ClubName:        club.ClubName,
		Peer:            s.peerView(ctx, session, me, clubID, peer),
		LastMessage:     lastText,
		LastMessageType: lastType,
		LastMessageAt:   fmtMilliTime(conv.LastMessageAt),
		Unread:          unread,
		CanSend:         true,
	}, nil
}

// ---------------- 消息 ----------------

// MessagePage 是消息分页返回结构。
type MessagePage struct {
	Items          []MessageView `json:"items"`
	HasMoreBefore  bool          `json:"hasMoreBefore"`
	BeforeCursor   string        `json:"beforeCursor"`
	HasMoreAfter   bool          `json:"hasMoreAfter"`
	AfterCursor    string        `json:"afterCursor"`
	ConversationID string        `json:"conversationId"`
	Peer           PeerView      `json:"peer"`
	CanSend        bool          `json:"canSend"`
	CanDelete      bool          `json:"canDelete"`
	Role           string        `json:"role"`
	ReadOnlyReason string        `json:"readOnlyReason"`
}

// Messages 查询历史（before 游标）或增量（after 消息 ID）。
func (s *Service) Messages(ctx context.Context, session Session, conversationID, before, after string, limit int) (MessagePage, error) {
	conv, me, peer, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return MessagePage{}, err
	}
	participant, _, err := s.store.GetParticipant(ctx, conv.ID, session.Guuid)
	if err != nil {
		return MessagePage{}, err
	}
	clearedAt := participant.ClearedAt
	if limit <= 0 {
		limit = DefaultPageSize
	}
	if limit > MaxPageSize {
		limit = MaxPageSize
	}
	club, err := s.directory.GetClub(ctx, conv.ClubID)
	if err != nil {
		return MessagePage{}, err
	}
	fixed := s.isFixedTarget(ctx, club, me, peer.Guuid)
	page := MessagePage{ConversationID: conv.ID, Peer: peer, Role: me.Role,
		CanDelete: CanHideConversation(me.Role) && !fixed, CanSend: true, Items: []MessageView{}}
	// 对方已退出俱乐部：保留历史可读，但不能再发送。
	_, peerOK, err := s.peerForClub(ctx, conv.ClubID, peer.Guuid)
	if err != nil {
		return MessagePage{}, relationUnavailable(err)
	}
	if !peerOK {
		page.CanSend = false
		page.ReadOnlyReason = "对方已退出该俱乐部"
	}

	if strings.TrimSpace(after) != "" && strings.TrimSpace(before) != "" {
		return MessagePage{}, invalidMessage("before 与 after 不能同时使用")
	}
	if strings.TrimSpace(after) != "" {
		cursorMsg, ok, err := s.store.GetMessage(ctx, conv.ID, strings.TrimSpace(after))
		if err != nil {
			return MessagePage{}, err
		}
		if !ok {
			return MessagePage{}, errCursorInvalid
		}
		items, err := s.store.MessagesAfter(ctx, conv.ID, Cursor{At: cursorMsg.CreatedAt, ID: cursorMsg.ID}, clearedAt, limit)
		if err != nil {
			return MessagePage{}, err
		}
		views, err := s.messageViews(ctx, session.Guuid, items)
		if err != nil {
			return MessagePage{}, err
		}
		page.Items = views
		page.HasMoreAfter = len(items) == limit
		if len(items) > 0 {
			last := items[len(items)-1]
			page.AfterCursor = last.ID
			page.BeforeCursor = EncodeCursor(s.opts.CursorKey, items[0].CreatedAt, items[0].ID)
		} else {
			page.AfterCursor = cursorMsg.ID
		}
		return page, nil
	}

	var cursor *Cursor
	if strings.TrimSpace(before) != "" {
		decoded, err := DecodeCursor(s.opts.CursorKey, before)
		if err != nil {
			return MessagePage{}, errCursorInvalid
		}
		// 游标必须属于当前会话，防止用别的会话游标探测数据。
		if _, ok, err := s.store.GetMessage(ctx, conv.ID, decoded.ID); err != nil {
			return MessagePage{}, err
		} else if !ok {
			return MessagePage{}, errCursorInvalid
		}
		cursor = &decoded
	}
	// 多取一条用于判断是否还有更早的消息。
	items, err := s.store.MessagesBefore(ctx, conv.ID, cursor, clearedAt, limit+1)
	if err != nil {
		return MessagePage{}, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[len(items)-limit:]
	}
	views, err := s.messageViews(ctx, session.Guuid, items)
	if err != nil {
		return MessagePage{}, err
	}
	page.Items = views
	page.HasMoreBefore = hasMore
	if len(items) > 0 {
		page.BeforeCursor = EncodeCursor(s.opts.CursorKey, items[0].CreatedAt, items[0].ID)
		page.AfterCursor = items[len(items)-1].ID
	}
	return page, nil
}

// SendRequest 是发送消息的请求体。
type SendRequest struct {
	MessageType     string `json:"messageType"`
	ClientMessageID string `json:"clientMessageId"`
	Text            string `json:"text"`
	AttachmentID    string `json:"attachmentId"`
}

// SendMessage 校验并落库一条消息。重试返回原消息，不产生重复。
func (s *Service) SendMessage(ctx context.Context, session Session, conversationID string, request SendRequest) (MessageView, bool, error) {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return MessageView{}, false, err
	}
	// 接收方必须仍在该俱乐部，或仍是该俱乐部的联盟大群主。
	receiver := conv.PeerGuuid(session.Guuid)
	if receiver == "" || receiver == session.Guuid {
		return MessageView{}, false, errConvForbidden
	}
	if _, ok, err := s.peerForClub(ctx, conv.ClubID, receiver); err != nil {
		return MessageView{}, false, relationUnavailable(err)
	} else if !ok {
		return MessageView{}, false, errPeerNotClubMember
	}
	clientID := strings.TrimSpace(request.ClientMessageID)
	if clientID == "" || len(clientID) > MaxClientMsgIDLen {
		return MessageView{}, false, invalidMessage("缺少客户端消息编号")
	}
	if s.limiter != nil && !s.limiter.Allow("direct:"+session.Guuid+":"+conv.ID) {
		return MessageView{}, false, errRateLimited
	}
	// 幂等：先查已有消息，避免重试时再走一遍校验与限流。
	if existing, ok, err := s.store.FindMessageByClientID(ctx, conv.ID, session.Guuid, clientID); err != nil {
		return MessageView{}, false, err
	} else if ok {
		views, err := s.messageViews(ctx, session.Guuid, []Message{existing})
		if err != nil {
			return MessageView{}, false, err
		}
		return views[0], true, nil
	}

	msg := Message{
		ConversationID:     conv.ID,
		SenderGuuid:        session.Guuid,
		SenderNameSnapshot: session.Name,
		SenderRoleSnapshot: s.senderRole(ctx, conv.ClubID, session.Guuid),
		ClientMessageID:    clientID,
	}
	messageType := strings.ToLower(strings.TrimSpace(request.MessageType))
	switch messageType {
	case MessageText:
		text := strings.TrimSpace(request.Text)
		if text == "" {
			return MessageView{}, false, invalidMessage("消息不能为空")
		}
		if len([]rune(text)) > MaxTextRunes {
			return MessageView{}, false, invalidMessage("消息不能超过 2000 个字符")
		}
		msg.MessageType = MessageText
		msg.Text = text
	case MessageImage, MessageVoice:
		attachmentID := strings.TrimSpace(request.AttachmentID)
		if attachmentID == "" {
			return MessageView{}, false, errMediaIncomplete
		}
		attachment, ok, err := s.store.GetAttachment(ctx, attachmentID)
		if err != nil {
			return MessageView{}, false, err
		}
		if !ok || attachment.ConversationID != conv.ID || attachment.Status != AttachmentUploaded || attachment.MessageID != "" {
			return MessageView{}, false, errMediaIncomplete
		}
		if attachment.MediaType != messageType {
			return MessageView{}, false, errMediaIncomplete
		}
		if attachment.MediaType == MessageImage && attachment.StorageKey == "" {
			return MessageView{}, false, errMediaIncomplete
		}
		if attachment.MediaType == MessageVoice {
			// 绑定时再次向 AudioServer 校验，避免客户端伪造 voiceId 或时长。
			duration, size, err := s.voice.VerifyVoice(ctx, attachment.ExternalMediaID)
			if err != nil {
				return MessageView{}, false, AsError(err)
			}
			attachment.DurationMS = duration
			attachment.ByteSize = size
		}
		msg.MessageType = attachment.MediaType
		msg.AttachmentID = attachment.ID
		// 图片/语音消息正文为空，符合字段约束。
	case MessageTypeSystem:
		// 系统通报只给俱乐部管理角色用（上下分/下分成功），并且文案必须是固定格式。
		// 这样既能持久化、跨端可见，又不会被客户端拿来发任意“系统消息”。
		if !CanSendSystemNotice(msg.SenderRoleSnapshot) {
			return MessageView{}, false, invalidMessage("没有发送系统消息的权限")
		}
		text := strings.TrimSpace(request.Text)
		if !systemNoticePattern.MatchString(text) {
			return MessageView{}, false, invalidMessage("系统消息格式不正确")
		}
		msg.MessageType = MessageTypeSystem
		msg.Text = text
	default:
		return MessageView{}, false, invalidMessage("不支持的消息类型")
	}
	id, err := NewID()
	if err != nil {
		return MessageView{}, false, err
	}
	msg.ID = id
	// 同一会话内保证时间戳单调递增：同毫秒内连发两条时，游标分页依赖
	// (created_at, id) 的稳定顺序，这里把时间推到上一条之后。
	created := time.Now().Truncate(time.Millisecond)
	if !conv.LastMessageAt.IsZero() && !created.After(conv.LastMessageAt) {
		created = conv.LastMessageAt.Add(time.Millisecond)
	}
	msg.CreatedAt = created

	stored, duplicate, err := s.store.InsertMessage(ctx, msg, receiver)
	if err != nil {
		return MessageView{}, false, AsError(err)
	}
	views, err := s.messageViews(ctx, session.Guuid, []Message{stored})
	if err != nil {
		return MessageView{}, false, err
	}
	return views[0], duplicate, nil
}

// RealtimeTarget 返回一条消息落库后应通知的对方账号和俱乐部。
// 它只做与当前用户一致的会话/成员校验，不向客户端暴露会话内部结构。
func (s *Service) RealtimeTarget(ctx context.Context, session Session, conversationID string) (string, string, error) {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return "", "", err
	}
	recipient := conv.PeerGuuid(session.Guuid)
	if recipient == "" || recipient == session.Guuid {
		return "", "", errConvForbidden
	}
	return recipient, conv.ClubID, nil
}

// MarkRead 提交当前用户的已读位置。
func (s *Service) MarkRead(ctx context.Context, session Session, conversationID, messageID string) error {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return err
	}
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return invalidMessage("缺少已读消息编号")
	}
	if _, ok, err := s.store.GetMessage(ctx, conv.ID, messageID); err != nil {
		return err
	} else if !ok {
		return errCursorInvalid
	}
	return s.store.SetLastRead(ctx, conv.ID, session.Guuid, messageID)
}

// Hide 隐藏当前用户的会话入口（删除）。固定联系人（上级代理/俱乐部老板/大群主）
// 或角色不足时返回 DIRECT_DELETE_FORBIDDEN。
func (s *Service) Hide(ctx context.Context, session Session, conversationID string) error {
	conv, me, peer, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return err
	}
	club, err := s.directory.GetClub(ctx, conv.ClubID)
	if err != nil {
		return err
	}
	if !CanHideConversation(me.Role) || s.isFixedTarget(ctx, club, me, peer.Guuid) {
		return errDeleteForbidden
	}
	// 只更新当前参与者的隐藏状态，不删除消息、不影响对方。
	return s.store.HideConversation(ctx, conv.ID, session.Guuid)
}

// Clear 清除当前用户这一侧的聊天记录：只记录清除时间，消息行保留，
// 对方和客服侧仍能看到；之后本人拉取消息和会话预览都会跳过清除前的内容。
// 所有角色都可以清除自己这一侧，不受删除权限限制。
func (s *Service) Clear(ctx context.Context, session Session, conversationID string) error {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return err
	}
	return s.store.ClearConversation(ctx, conv.ID, session.Guuid)
}

// ---------------- 附件 ----------------

// AttachmentRequest 是创建附件的请求体。
type AttachmentRequest struct {
	Type            string `json:"type"`
	MimeType        string `json:"mimeType"`
	ByteSize        int64  `json:"byteSize"`
	Sha256          string `json:"sha256"`
	DurationMS      int    `json:"durationMs"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	Provider        string `json:"provider"`
	ExternalMediaID string `json:"externalMediaId"`
}

// AttachmentTicket 是创建附件的返回。
type AttachmentTicket struct {
	AttachmentID string `json:"attachmentId"`
	Type         string `json:"type"`
	UploadURL    string `json:"uploadUrl"`
	UploadMethod string `json:"uploadMethod"`
	CompleteURL  string `json:"completeUrl"`
	DurationMS   int    `json:"durationMs"`
	ByteSize     int64  `json:"byteSize"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
}

// CreateAttachment 创建待上传/待绑定附件。语音在这里直接向 AudioServer 校验。
func (s *Service) CreateAttachment(ctx context.Context, session Session, conversationID string, request AttachmentRequest) (AttachmentTicket, error) {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return AttachmentTicket{}, err
	}
	id, err := NewID()
	if err != nil {
		return AttachmentTicket{}, err
	}
	attachment := Attachment{ID: id, ConversationID: conv.ID, Status: AttachmentUploaded, CreatedAt: time.Now()}
	switch strings.ToLower(strings.TrimSpace(request.Type)) {
	case MessageImage:
		if request.ByteSize > MaxImageBytes {
			return AttachmentTicket{}, errMediaTooLarge
		}
		mime := strings.ToLower(strings.TrimSpace(request.MimeType))
		switch mime {
		case "image/jpeg", "image/png", "image/webp":
		default:
			return AttachmentTicket{}, invalidMedia("只支持 JPEG、PNG、WebP 图片")
		}
		attachment.MediaType = MessageImage
		attachment.Provider = ProviderChatStorage
		attachment.MimeType = mime
		attachment.ByteSize = request.ByteSize
		attachment.Width = request.Width
		attachment.Height = request.Height
		if request.Width > MaxImageSide || request.Height > MaxImageSide {
			return AttachmentTicket{}, invalidMedia("图片尺寸超出限制")
		}
		if err := s.store.CreateAttachment(ctx, attachment); err != nil {
			return AttachmentTicket{}, err
		}
		base := "/api/direct/conversations/" + conv.ID + "/attachments/" + id
		return AttachmentTicket{AttachmentID: id, Type: MessageImage,
			UploadURL: base + "/upload", UploadMethod: "POST",
			CompleteURL: base + "/complete", Width: request.Width, Height: request.Height}, nil
	case MessageVoice:
		external := strings.TrimSpace(request.ExternalMediaID)
		if external == "" {
			return AttachmentTicket{}, invalidMedia("缺少语音编号")
		}
		provider := strings.ToLower(strings.TrimSpace(request.Provider))
		if provider != "" && provider != ProviderAudioServer {
			return AttachmentTicket{}, invalidMedia("不支持的语音来源")
		}
		duration, size, err := s.voice.VerifyVoice(ctx, external)
		if err != nil {
			return AttachmentTicket{}, AsError(err)
		}
		attachment.MediaType = MessageVoice
		attachment.Provider = ProviderAudioServer
		attachment.ExternalMediaID = external
		attachment.MimeType = "audio/mp4"
		attachment.ByteSize = size
		attachment.DurationMS = duration
		if err := s.store.CreateAttachment(ctx, attachment); err != nil {
			return AttachmentTicket{}, err
		}
		base := "/api/direct/conversations/" + conv.ID + "/attachments/" + id
		return AttachmentTicket{AttachmentID: id, Type: MessageVoice, DurationMS: duration, ByteSize: size,
			CompleteURL: base + "/complete"}, nil
	}
	return AttachmentTicket{}, invalidMedia("不支持的附件类型")
}

// UploadImage 接收受控上传的图片二进制，服务端重新做格式、尺寸、大小校验。
func (s *Service) UploadImage(ctx context.Context, session Session, conversationID, attachmentID string, data []byte) (AttachmentView, error) {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return AttachmentView{}, err
	}
	attachment, ok, err := s.store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return AttachmentView{}, err
	}
	if !ok || attachment.ConversationID != conv.ID || attachment.MediaType != MessageImage ||
		attachment.Status != AttachmentUploaded || attachment.MessageID != "" {
		return AttachmentView{}, errMediaIncomplete
	}
	if len(data) == 0 {
		return AttachmentView{}, errMediaIncomplete
	}
	if int64(len(data)) > MaxImageBytes {
		return AttachmentView{}, errMediaTooLarge
	}
	key, thumbKey, info, err := s.media.Save(attachmentID, data)
	if err != nil {
		return AttachmentView{}, AsError(err)
	}
	if err := s.store.CompleteImageAttachment(ctx, attachmentID, key, thumbKey, info.MimeType,
		int64(len(data)), info.Width, info.Height); err != nil {
		s.media.Remove(key, thumbKey)
		return AttachmentView{}, AsError(err)
	}
	return AttachmentView{ID: attachmentID, Type: MessageImage, Width: info.Width, Height: info.Height}, nil
}

// CompleteAttachment 确认附件可用：图片重新核对落盘文件，语音重新向 AudioServer 校验。
func (s *Service) CompleteAttachment(ctx context.Context, session Session, conversationID, attachmentID string) (AttachmentView, error) {
	conv, _, _, err := s.requireConversation(ctx, session, conversationID)
	if err != nil {
		return AttachmentView{}, err
	}
	attachment, ok, err := s.store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return AttachmentView{}, err
	}
	if !ok || attachment.ConversationID != conv.ID || attachment.Status != AttachmentUploaded {
		return AttachmentView{}, errMediaIncomplete
	}
	switch attachment.MediaType {
	case MessageImage:
		if attachment.StorageKey == "" {
			return AttachmentView{}, errMediaIncomplete
		}
		file, contentType, err := s.media.Open(attachment.StorageKey)
		if err != nil {
			return AttachmentView{}, errMediaIncomplete
		}
		defer file.Close()
		_ = contentType
		return AttachmentView{ID: attachment.ID, Type: MessageImage,
			URL:   s.media.MediaURL(attachment.ID, session.Guuid, "", s.opts.MediaTicketTTL),
			Width: attachment.Width, Height: attachment.Height}, nil
	case MessageVoice:
		duration, _, err := s.voice.VerifyVoice(ctx, attachment.ExternalMediaID)
		if err != nil {
			return AttachmentView{}, AsError(err)
		}
		return AttachmentView{ID: attachment.ID, Type: MessageVoice, VoiceID: attachment.ExternalMediaID,
			URL: s.voice.FileURL(attachment.ExternalMediaID), DurationMS: duration,
			Width: 0, Height: 0}, nil
	}
	return AttachmentView{}, errMediaIncomplete
}

// ---------------- 内部工具 ----------------

func (s *Service) senderRole(ctx context.Context, clubID, guuid string) string {
	member, ok, err := s.directory.GetMember(ctx, clubID, guuid)
	if err == nil && ok {
		return member.Role
	}
	if union, ok, err := s.directory.GetUnionByClub(ctx, clubID); err == nil && ok &&
		strings.TrimSpace(union.OwnerGuuid) == strings.TrimSpace(guuid) {
		return RoleUnionOwner
	}
	return RoleMember
}

// requireMembership 校验当前用户是否属于俱乐部。
func (s *Service) requireMembership(ctx context.Context, guuid, clubID string) (Member, error) {
	clubID = strings.TrimSpace(clubID)
	if clubID == "" {
		return Member{}, errClubNotFound
	}
	if _, err := s.directory.GetClub(ctx, clubID); err != nil {
		var biz *Error
		if errors.As(err, &biz) {
			return Member{}, biz
		}
		return Member{}, relationUnavailable(err)
	}
	member, ok, err := s.directory.GetMember(ctx, clubID, guuid)
	if err != nil {
		return Member{}, relationUnavailable(err)
	}
	if !ok {
		return Member{}, errNotClubMember
	}
	return member, nil
}

// viewerForClub 返回当前用户在俱乐部里的身份。联盟总群主不是其他俱乐部的
// 成员，但对联盟内任意俱乐部使用合成身份 union_owner，可读成员、可发起会话。
func (s *Service) viewerForClub(ctx context.Context, session Session, clubID string) (Member, error) {
	clubID = strings.TrimSpace(clubID)
	if clubID == "" {
		return Member{}, errClubNotFound
	}
	if _, err := s.directory.GetClub(ctx, clubID); err != nil {
		var biz *Error
		if errors.As(err, &biz) {
			return Member{}, biz
		}
		return Member{}, relationUnavailable(err)
	}
	member, ok, err := s.directory.GetMember(ctx, clubID, session.Guuid)
	if err != nil {
		return Member{}, relationUnavailable(err)
	}
	if ok {
		if union, hasUnion, unionErr := s.directory.GetUnionByClub(ctx, clubID); unionErr == nil && hasUnion &&
			strings.TrimSpace(union.OwnerGuuid) == strings.TrimSpace(session.Guuid) {
			member.IsUnionOwner = true
		}
		return member, nil
	}
	union, ok, err := s.directory.GetUnionByClub(ctx, clubID)
	if err != nil {
		return Member{}, relationUnavailable(err)
	}
	if ok && strings.TrimSpace(union.OwnerGuuid) == strings.TrimSpace(session.Guuid) {
		name := strings.TrimSpace(session.Name)
		if name == "" {
			name = session.Guuid
		}
		return Member{Guuid: session.Guuid, Name: name, Avatar: session.Avatar, Role: RoleUnionOwner}, nil
	}
	return Member{}, errNotClubMember
}

// peerForClub 读取会话对方。联盟总群主不在对方俱乐部成员表里，需要用
// club_union_info.owner_guuid 判定，并从账号表补昵称头像。
func (s *Service) peerForClub(ctx context.Context, clubID, peerGuuid string) (Member, bool, error) {
	peerGuuid = strings.TrimSpace(peerGuuid)
	if peerGuuid == "" {
		return Member{}, false, nil
	}
	member, ok, err := s.directory.GetMember(ctx, clubID, peerGuuid)
	if err != nil {
		return Member{}, false, err
	}
	if ok {
		if union, hasUnion, unionErr := s.directory.GetUnionByClub(ctx, clubID); unionErr == nil && hasUnion &&
			strings.TrimSpace(union.OwnerGuuid) == peerGuuid {
			member.IsUnionOwner = true
		}
		return member, true, nil
	}
	union, ok, err := s.directory.GetUnionByClub(ctx, clubID)
	if err != nil || !ok {
		return Member{}, false, err
	}
	if strings.TrimSpace(union.OwnerGuuid) != peerGuuid {
		return Member{}, false, nil
	}
	user, has, err := s.directory.GetAccount(ctx, peerGuuid)
	if err != nil {
		return Member{}, false, err
	}
	name := peerGuuid
	avatar := ""
	if has {
		if strings.TrimSpace(user.Name) != "" {
			name = user.Name
		}
		avatar = user.Avatar
	}
	return Member{Guuid: peerGuuid, Name: name, Avatar: avatar, Role: RoleUnionOwner}, true, nil
}

// requireConversation 校验会话归属：会话存在、当前用户是参与者，并且仍是该
// 俱乐部成员或该俱乐部的联盟大群主。
func (s *Service) requireConversation(ctx context.Context, session Session, conversationID string) (Conversation, Member, PeerView, error) {
	conv, ok, err := s.store.GetConversation(ctx, strings.TrimSpace(conversationID))
	if err != nil {
		return Conversation{}, Member{}, PeerView{}, err
	}
	if !ok {
		return Conversation{}, Member{}, PeerView{}, errConvMissing
	}
	participant, ok, err := s.store.GetParticipant(ctx, conv.ID, session.Guuid)
	if err != nil {
		return Conversation{}, Member{}, PeerView{}, err
	}
	if !ok {
		return Conversation{}, Member{}, PeerView{}, errConvForbidden
	}
	_ = participant
	me, err := s.viewerForClub(ctx, session, conv.ClubID)
	if err != nil {
		return Conversation{}, Member{}, PeerView{}, err
	}
	peerGuuid := conv.PeerGuuid(session.Guuid)
	peer := PeerView{Guuid: peerGuuid, Name: peerGuuid, Role: RoleMember}
	if member, ok, err := s.peerForClub(ctx, conv.ClubID, peerGuuid); err == nil && ok {
		peer = s.peerView(ctx, session, me, conv.ClubID, member)
	}
	return conv, me, peer, nil
}

// messageViews 组装消息返回结构（含临时媒体地址）。
func (s *Service) messageViews(ctx context.Context, meGuuid string, messages []Message) ([]MessageView, error) {
	if len(messages) == 0 {
		return []MessageView{}, nil
	}
	var attachmentIDs []string
	for _, msg := range messages {
		if msg.AttachmentID != "" {
			attachmentIDs = append(attachmentIDs, msg.AttachmentID)
		}
	}
	attachments, err := s.store.AttachmentsByIDs(ctx, attachmentIDs)
	if err != nil {
		return nil, err
	}
	views := make([]MessageView, 0, len(messages))
	for _, msg := range messages {
		view := MessageView{
			ID: msg.ID, MessageType: msg.MessageType, Text: msg.Text,
			SenderGuuid: msg.SenderGuuid, SenderName: msg.SenderNameSnapshot,
			SenderRole: msg.SenderRoleSnapshot, ClientMessageID: msg.ClientMessageID,
			CreatedAt: fmtTime(msg.CreatedAt),
		}
		if msg.AttachmentID != "" {
			attachment, ok := attachments[msg.AttachmentID]
			if ok {
				view.Attachment = s.attachmentView(attachment, meGuuid)
			}
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) attachmentView(attachment Attachment, meGuuid string) *AttachmentView {
	view := &AttachmentView{ID: attachment.ID, Type: attachment.MediaType,
		DurationMS: attachment.DurationMS, Width: attachment.Width, Height: attachment.Height}
	switch attachment.MediaType {
	case MessageImage:
		view.URL = s.media.MediaURL(attachment.ID, meGuuid, "", s.opts.MediaTicketTTL)
		if attachment.ThumbnailKey != "" {
			view.ThumbnailURL = s.media.MediaURL(attachment.ID, meGuuid, "thumb", s.opts.MediaTicketTTL)
		} else {
			view.ThumbnailURL = view.URL
		}
	case MessageVoice:
		view.VoiceID = attachment.ExternalMediaID
		view.URL = s.voice.FileURL(attachment.ExternalMediaID)
	}
	return view
}

// OpenMedia 供 HTTP 层下载图片：签名票据校验通过后返回文件句柄与内容类型。
func (s *Service) OpenMedia(ctx context.Context, attachmentID, ticket, variant string) (io.ReadSeekCloser, string, error) {
	ticketVariant, ok := s.media.ValidateMediaTicket(attachmentID, ticket)
	if !ok {
		return nil, "", newError(http.StatusForbidden, "MEDIA_TICKET_INVALID", "媒体地址已失效，请重新进入会话")
	}
	if variant != "" && variant != ticketVariant {
		return nil, "", newError(http.StatusForbidden, "MEDIA_TICKET_INVALID", "媒体地址已失效，请重新进入会话")
	}
	if variant == "" {
		variant = ticketVariant
	}
	attachment, ok, err := s.store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return nil, "", err
	}
	if !ok {
		return nil, "", errMediaIncomplete
	}
	if attachment.MediaType != MessageImage {
		return nil, "", errMediaIncomplete
	}
	key := attachment.StorageKey
	if variant == "thumb" && attachment.ThumbnailKey != "" {
		key = attachment.ThumbnailKey
	}
	if key == "" {
		return nil, "", errMediaIncomplete
	}
	return s.media.Open(key)
}

// VoiceFile 代理转发语音文件（客户端直连 AudioServer 失败时兜底）。
func (s *Service) VoiceFile(ctx context.Context, attachmentID, ticket string) (io.ReadCloser, int64, error) {
	if _, ok := s.media.ValidateMediaTicket(attachmentID, ticket); !ok {
		return nil, 0, newError(http.StatusForbidden, "MEDIA_TICKET_INVALID", "媒体地址已失效，请重新进入会话")
	}
	attachment, ok, err := s.store.GetAttachment(ctx, attachmentID)
	if err != nil {
		return nil, 0, err
	}
	if !ok || attachment.MediaType != MessageVoice {
		return nil, 0, errMediaIncomplete
	}
	return s.voice.ProxiedFile(ctx, attachment.ExternalMediaID)
}
