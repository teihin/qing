// Package directchat 实现俱乐部 1 对 1 私聊（direct chat）。
//
// 它与 ChatTool 现有客服模块共用进程、数据库和部署，但使用独立的表
// （chat_direct_*）、独立的路由（/api/direct/*）和独立的鉴权，不读写
// 客服的 chat_conversation / chat_message，也不进入客服队列。
//
// 权限模型的唯一依据是「当前用户与对方当前都属于同一个俱乐部」，角色
// 只影响入口和删除按钮，不改变会话模型。
package directchat

import (
	"errors"
	"fmt"
	"net/http"
	"time"
)

// 统一错误码，见设计文档第 9 章。
const (
	CodeAuthRequired        = "DIRECT_AUTH_REQUIRED"
	CodeAuthExpired         = "DIRECT_AUTH_EXPIRED"
	CodeClubNotFound        = "CLUB_NOT_FOUND"
	CodeNotClubMember       = "NOT_CLUB_MEMBER"
	CodePeerNotClubMember   = "PEER_NOT_CLUB_MEMBER"
	CodeConversationForbid  = "CONVERSATION_FORBIDDEN"
	CodeConversationMissing = "CONVERSATION_NOT_FOUND"
	CodeDeleteForbidden     = "DIRECT_DELETE_FORBIDDEN"
	CodeMessageInvalid      = "MESSAGE_INVALID"
	CodeCursorInvalid       = "MESSAGE_CURSOR_INVALID"
	CodeMediaInvalid        = "MEDIA_INVALID"
	CodeMediaIncomplete     = "MEDIA_UPLOAD_INCOMPLETE"
	CodeMediaTooLarge       = "MEDIA_TOO_LARGE"
	CodeRateLimited         = "MESSAGE_RATE_LIMITED"
	CodeMessageDuplicate    = "MESSAGE_DUPLICATE"
	CodeRelationUnavailable = "DIRECT_RELATION_UNAVAILABLE"
)

// Error 是可直接映射为 HTTP 响应的业务错误。
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func newError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

var (
	errAuthRequired      = newError(http.StatusUnauthorized, CodeAuthRequired, "聊天登录已失效，请重新进入游戏")
	errAuthExpired       = newError(http.StatusUnauthorized, CodeAuthExpired, "聊天票据已过期，请重新进入游戏")
	errClubNotFound      = newError(http.StatusNotFound, CodeClubNotFound, "俱乐部不存在")
	errNotClubMember     = newError(http.StatusForbidden, CodeNotClubMember, "你已不在该俱乐部")
	errPeerNotClubMember = newError(http.StatusForbidden, CodePeerNotClubMember, "对方已退出该俱乐部")
	errConvForbidden     = newError(http.StatusForbidden, CodeConversationForbid, "无权访问该会话")
	errConvMissing       = newError(http.StatusNotFound, CodeConversationMissing, "会话不存在")
	errDeleteForbidden   = newError(http.StatusForbidden, CodeDeleteForbidden, "当前身份不能删除聊天")
	errMessageInvalid    = newError(http.StatusBadRequest, CodeMessageInvalid, "消息内容不合法")
	errCursorInvalid     = newError(http.StatusBadRequest, CodeCursorInvalid, "历史消息游标无效")
	errMediaInvalid      = newError(http.StatusBadRequest, CodeMediaInvalid, "图片或语音不合法")
	errMediaIncomplete   = newError(http.StatusConflict, CodeMediaIncomplete, "媒体尚未上传完成")
	errMediaTooLarge     = newError(http.StatusRequestEntityTooLarge, CodeMediaTooLarge, "媒体超过大小限制")
	errRateLimited       = newError(http.StatusTooManyRequests, CodeRateLimited, "发送过于频繁，请稍后再试")
	errRelationUnavail   = newError(http.StatusServiceUnavailable, CodeRelationUnavailable, "俱乐部关系服务暂时不可用")
)

// AsError 把任意错误转换为带错误码的业务错误；未知错误一律视为服务内部错误。
func AsError(err error) *Error {
	var target *Error
	if errors.As(err, &target) {
		return target
	}
	return newError(http.StatusInternalServerError, "INTERNAL_ERROR", "服务暂时不可用，请稍后再试")
}

// 角色取值。manager 按普通成员处理（不显示删除），但仍可被同俱乐部成员聊天。
const (
	RoleOwner   = "owner"
	RoleLeader  = "leader"
	RoleAgent   = "agent"
	RoleManager = "manager"
	RoleMember  = "member"
)

// CanHideConversation 表示该角色是否有「删除（隐藏）聊天」入口。
func CanHideConversation(role string) bool {
	return role == RoleOwner || role == RoleLeader || role == RoleAgent
}

// CanCreateFromMemberList 表示玩家列表的「聊天」按钮是否对该角色开放。
func CanCreateFromMemberList(role string) bool {
	return CanHideConversation(role)
}

// CanSendSystemNotice 表示该角色能否发系统通报（上下分/下分成功）。
// 只有俱乐部管理角色能发，并且文案还要过 systemNoticePattern 的格式校验。
func CanSendSystemNotice(role string) bool {
	return role == RoleOwner || role == RoleLeader || role == RoleAgent
}

// NormalizeRole 把未知角色归一化为 member，避免脏数据影响权限判断。
func NormalizeRole(role string) string {
	switch role {
	case RoleOwner, RoleLeader, RoleAgent, RoleManager, RoleMember:
		return role
	default:
		return RoleMember
	}
}

// 消息类型。
const (
	MessageText       = "text"
	MessageImage      = "image"
	MessageVoice      = "voice"
	MessageTypeSystem = "system"
)

// 一期限制。
const (
	MaxTextRunes      = 2000
	MaxClientMsgIDLen = 64
	MaxImageBytes     = 10 << 20
	MaxImageSide      = 4096
	MinVoiceDuration  = 300
	DefaultPageSize   = 30
	MaxPageSize       = 50
)

// Club 是当前用户所属俱乐部。
type Club struct {
	ClubID     string `json:"clubId"`
	ClubName   string `json:"clubName"`
	Role       string `json:"role"`
	Unread     int    `json:"unread"`
	OwnerGuuid string `json:"-"`
}

// Member 是俱乐部成员（含角色与上下级关系）。
type Member struct {
	Guuid               string `json:"guuid"`
	Name                string `json:"name"`
	Avatar              string `json:"avatar"`
	Note                string `json:"-"`
	Role                string `json:"role"`
	Online              bool   `json:"online"`
	SuperiorAgentGuuid  string `json:"-"`
	SuperiorLeaderGuuid string `json:"-"`
}

// Conversation 是一条俱乐部内的双人会话。
type Conversation struct {
	ID            string
	ClubID        string
	PairKey       string
	LowGuuid      string
	HighGuuid     string
	Status        string
	LastMessageID string
	LastMessageAt time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// PeerGuuid 返回会话中相对 me 的对方 guuid。
func (c Conversation) PeerGuuid(me string) string {
	if c.LowGuuid == me {
		return c.HighGuuid
	}
	return c.LowGuuid
}

// Participant 是会话参与者状态（已读位置、隐藏状态）。
type Participant struct {
	ConversationID    string
	Guuid             string
	FirstJoinedAt     time.Time
	LastReadMessageID string
	HiddenAt          time.Time
}

// IsHidden 判断该参与者是否已隐藏（删除入口）。
func (p Participant) IsHidden() bool { return !p.HiddenAt.IsZero() }

// Message 是一条直聊消息。
type Message struct {
	ID                 string
	ConversationID     string
	SenderGuuid        string
	SenderNameSnapshot string
	SenderRoleSnapshot string
	MessageType        string
	Text               string
	AttachmentID       string
	ClientMessageID    string
	CreatedAt          time.Time
}

// Attachment 是图片或语音附件。
type Attachment struct {
	ID              string
	ConversationID  string
	MessageID       string
	MediaType       string
	Provider        string
	ExternalMediaID string
	StorageKey      string
	ThumbnailKey    string
	MimeType        string
	ByteSize        int64
	DurationMS      int
	Width           int
	Height          int
	Status          string
	CreatedAt       time.Time
}

// 附件状态。
const (
	AttachmentUploaded = "uploaded"
	AttachmentBound    = "bound"
	AttachmentDeleted  = "deleted"
)

// 媒体 Provider。
const (
	ProviderChatStorage = "chat_storage"
	ProviderAudioServer = "audio_server"
)

// Session 是短期聊天会话（票据换来的访问凭证）。
type Session struct {
	TokenHash  string
	Guuid      string
	Name       string
	Avatar     string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// GameUser 是票据解析出的游戏身份。
type GameUser struct {
	Guuid  string
	Name   string
	Avatar string
}

// ConversationView 是会话列表的返回项（真实会话或默认入口）。
type ConversationView struct {
	ConversationID  string   `json:"conversationId"`
	IsDefaultTarget bool     `json:"isDefaultTarget"`
	ID              string   `json:"id,omitempty"`
	ClubID          string   `json:"clubId"`
	ClubName        string   `json:"clubName"`
	Peer            PeerView `json:"peer"`
	LastMessage     string   `json:"lastMessage"`
	LastMessageType string   `json:"lastMessageType"`
	LastMessageAt   string   `json:"lastMessageAt"`
	Unread          int      `json:"unread"`
	HiddenAt        string   `json:"hiddenAt"`
	CanSend         bool     `json:"canSend"`
}

// PeerView 是会话对方资料。
type PeerView struct {
	Guuid  string `json:"guuid"`
	Name   string `json:"name"`
	Note   string `json:"note,omitempty"`
	Avatar string `json:"avatar"`
	Role   string `json:"role"`
}

// AttachmentView 是消息里的附件视图。客户端只能拿到临时地址，不暴露 storage_key。
type AttachmentView struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl"`
	DurationMS   int    `json:"durationMs"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	VoiceID      string `json:"voiceId,omitempty"`
}

// MessageView 是消息的返回结构。
type MessageView struct {
	ID              string          `json:"id"`
	MessageType     string          `json:"messageType"`
	Text            string          `json:"text"`
	Attachment      *AttachmentView `json:"attachment"`
	SenderGuuid     string          `json:"senderGuuid"`
	SenderName      string          `json:"senderName"`
	SenderRole      string          `json:"senderRole"`
	ClientMessageID string          `json:"clientMessageId"`
	CreatedAt       string          `json:"createdAt"`
	Pending         bool            `json:"pending,omitempty"`
	Failed          bool            `json:"failed,omitempty"`
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02 15:04:05")
}

func fmtMilliTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02 15:04:05.000")
}

func invalidMessage(reason string) error {
	return newError(http.StatusBadRequest, CodeMessageInvalid, reason)
}

func invalidMedia(reason string) error {
	return newError(http.StatusBadRequest, CodeMediaInvalid, reason)
}

func relationUnavailable(err error) error {
	return fmt.Errorf("%w: %v", errRelationUnavail, err)
}
