package directchat

import (
	"context"
	"sort"
	"time"
)

// fakeStore 是 Store 的内存实现，用于在没有 MySQL 的环境里验证业务规则。
// 它的行为与 SQLStore 对齐：唯一约束、幂等、隐藏、已读、分页顺序。
type fakeStore struct {
	clubs        map[string]Club
	members      map[string]map[string]Member // clubID -> guuid -> member
	unions       map[string]Union             // clubID -> union
	accounts     map[string]GameUser
	convs        map[string]Conversation
	participants map[string]map[string]Participant // convID -> guuid -> participant
	messages     map[string]Message
	attachments  map[string]Attachment
	sessions     map[string]Session
	seq          int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		clubs:        map[string]Club{},
		members:      map[string]map[string]Member{},
		unions:       map[string]Union{},
		accounts:     map[string]GameUser{},
		convs:        map[string]Conversation{},
		participants: map[string]map[string]Participant{},
		messages:     map[string]Message{},
		attachments:  map[string]Attachment{},
		sessions:     map[string]Session{},
	}
}

func (f *fakeStore) addClub(clubID, name, owner string, members ...Member) {
	f.clubs[clubID] = Club{ClubID: clubID, ClubName: name, OwnerGuuid: owner}
	if f.members[clubID] == nil {
		f.members[clubID] = map[string]Member{}
	}
	for _, member := range members {
		f.members[clubID][member.Guuid] = member
	}
	if _, ok := f.members[clubID][owner]; !ok {
		f.members[clubID][owner] = Member{Guuid: owner, Name: "群主" + owner, Role: RoleOwner}
	}
}

func (f *fakeStore) removeMember(clubID, guuid string) { delete(f.members[clubID], guuid) }

// addUnion 让 clubID 成为 union 内的俱乐部；owner 账号自动登记，便于跨俱乐部展示。
func (f *fakeStore) addUnion(clubID string, union Union) {
	f.unions[clubID] = union
	if _, ok := f.accounts[union.OwnerGuuid]; !ok {
		f.accounts[union.OwnerGuuid] = GameUser{Guuid: union.OwnerGuuid, Name: "大群主" + union.OwnerGuuid}
	}
}

func (f *fakeStore) GetUnionByClub(_ context.Context, clubID string) (Union, bool, error) {
	union, ok := f.unions[clubID]
	if !ok || union.ID == "" {
		return Union{}, false, nil
	}
	return union, true, nil
}

func (f *fakeStore) GetAccount(_ context.Context, guuid string) (GameUser, bool, error) {
	if user, ok := f.accounts[guuid]; ok {
		return user, true, nil
	}
	for _, members := range f.members {
		if member, ok := members[guuid]; ok {
			return GameUser{Guuid: member.Guuid, Name: member.Name, Avatar: member.Avatar}, true, nil
		}
	}
	return GameUser{}, false, nil
}

func (f *fakeStore) ListMyClubs(_ context.Context, guuid string) ([]Club, error) {
	var result []Club
	for clubID, members := range f.members {
		if member, ok := members[guuid]; ok {
			club := f.clubs[clubID]
			club.Role = member.Role
			result = append(result, club)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ClubID < result[j].ClubID })
	return result, nil
}

func (f *fakeStore) GetClub(_ context.Context, clubID string) (Club, error) {
	club, ok := f.clubs[clubID]
	if !ok {
		return Club{}, errClubNotFound
	}
	return club, nil
}

func (f *fakeStore) GetMember(_ context.Context, clubID, guuid string) (Member, bool, error) {
	member, ok := f.members[clubID][guuid]
	return member, ok, nil
}

func (f *fakeStore) ListMembers(_ context.Context, clubID, keyword, excludeGuuid string, offset, limit int) ([]Member, int, error) {
	var items []Member
	for _, member := range f.members[clubID] {
		if member.Guuid == excludeGuuid {
			continue
		}
		if keyword != "" && !contains(member.Name, keyword) && !contains(member.Guuid, keyword) {
			continue
		}
		items = append(items, member)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Guuid < items[j].Guuid })
	total := len(items)
	if offset >= total {
		return nil, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return items[offset:end], total, nil
}

func (f *fakeStore) UnreadByClub(ctx context.Context, guuid string) (map[string]int, error) {
	result := map[string]int{}
	for convID, conv := range f.convs {
		count, err := f.unreadOf(ctx, convID, guuid)
		if err != nil {
			return nil, err
		}
		if count > 0 {
			result[conv.ClubID] += count
		}
	}
	return result, nil
}

func (f *fakeStore) unreadOf(ctx context.Context, convID, guuid string) (int, error) {
	participant, ok := f.participants[convID][guuid]
	if !ok {
		return 0, nil
	}
	var cutoff *Message
	if participant.LastReadMessageID != "" {
		if msg, ok := f.messages[participant.LastReadMessageID]; ok {
			cutoff = &msg
		}
	}
	count := 0
	for _, msg := range f.messages {
		if msg.ConversationID != convID || msg.SenderGuuid == guuid {
			continue
		}
		if cutoff == nil || messageAfter(msg, *cutoff) {
			count++
		}
	}
	return count, nil
}

func (f *fakeStore) FindConversation(_ context.Context, clubID, pairKey string) (Conversation, bool, error) {
	for _, conv := range f.convs {
		if conv.ClubID == clubID && conv.PairKey == pairKey {
			return conv, true, nil
		}
	}
	return Conversation{}, false, nil
}

func (f *fakeStore) GetConversation(_ context.Context, id string) (Conversation, bool, error) {
	conv, ok := f.convs[id]
	return conv, ok, nil
}

func (f *fakeStore) EnsureConversation(_ context.Context, clubID, lowGuuid, highGuuid string) (Conversation, error) {
	_, _, pairKey := PairKey(lowGuuid, highGuuid)
	if conv, ok, _ := f.FindConversation(nil, clubID, pairKey); ok {
		return conv, nil
	}
	f.seq++
	conv := Conversation{ID: "conv" + itoa(f.seq), ClubID: clubID, PairKey: pairKey,
		LowGuuid: lowGuuid, HighGuuid: highGuuid, Status: "active",
		CreatedAt: time.Now(), UpdatedAt: time.Now()}
	f.convs[conv.ID] = conv
	f.participants[conv.ID] = map[string]Participant{}
	now := time.Now()
	for _, guuid := range []string{lowGuuid, highGuuid} {
		f.participants[conv.ID][guuid] = Participant{ConversationID: conv.ID, Guuid: guuid, FirstJoinedAt: now}
	}
	return conv, nil
}

func (f *fakeStore) GetParticipant(_ context.Context, convID, guuid string) (Participant, bool, error) {
	participant, ok := f.participants[convID][guuid]
	return participant, ok, nil
}

func (f *fakeStore) RevealConversation(_ context.Context, convID, guuid string) error {
	participant, ok := f.participants[convID][guuid]
	if !ok {
		return nil
	}
	participant.HiddenAt = time.Time{}
	f.participants[convID][guuid] = participant
	return nil
}

func (f *fakeStore) HideConversation(_ context.Context, convID, guuid string) error {
	participant, ok := f.participants[convID][guuid]
	if !ok {
		return errConvForbidden
	}
	participant.HiddenAt = time.Now()
	f.participants[convID][guuid] = participant
	return nil
}

func (f *fakeStore) SetLastRead(_ context.Context, convID, guuid, messageID string) error {
	participant := f.participants[convID][guuid]
	newer, ok := f.messages[messageID]
	if !ok {
		return nil
	}
	if older, ok := f.messages[participant.LastReadMessageID]; ok && !messageAfter(newer, older) {
		return nil
	}
	participant.LastReadMessageID = messageID
	f.participants[convID][guuid] = participant
	return nil
}

func (f *fakeStore) ListConversations(ctx context.Context, clubID, guuid string, offset, limit int) ([]ConversationItem, int, error) {
	return f.listConversations(ctx, clubID, guuid, offset, limit)
}

func (f *fakeStore) ListConversationsByUser(ctx context.Context, guuid string, offset, limit int) ([]ConversationItem, int, error) {
	return f.listConversations(ctx, "", guuid, offset, limit)
}

func (f *fakeStore) listConversations(ctx context.Context, clubID, guuid string, offset, limit int) ([]ConversationItem, int, error) {
	var items []ConversationItem
	for convID, conv := range f.convs {
		if (clubID != "" && conv.ClubID != clubID) || conv.Status != "active" {
			continue
		}
		participant, ok := f.participants[convID][guuid]
		if !ok || participant.IsHidden() {
			continue
		}
		item := ConversationItem{Conversation: conv, HiddenAt: participant.HiddenAt, PeerGuuid: conv.PeerGuuid(guuid)}
		item.Peer = f.members[conv.ClubID][item.PeerGuuid]
		if conv.LastMessageID != "" {
			if msg, ok := f.messages[conv.LastMessageID]; ok {
				item.LastType = msg.MessageType
				item.LastText = previewText(msg)
			}
		}
		unread, err := f.unreadOf(ctx, convID, guuid)
		if err != nil {
			return nil, 0, err
		}
		item.Unread = unread
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i].Conversation, items[j].Conversation
		if a.LastMessageAt.Equal(b.LastMessageAt) {
			return a.ID > b.ID
		}
		return a.LastMessageAt.After(b.LastMessageAt)
	})
	total := len(items)
	if offset >= total {
		return nil, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return items[offset:end], total, nil
}

func (f *fakeStore) GetMessage(_ context.Context, convID, messageID string) (Message, bool, error) {
	msg, ok := f.messages[messageID]
	if !ok || msg.ConversationID != convID {
		return Message{}, false, nil
	}
	return msg, true, nil
}

func (f *fakeStore) FindMessageByClientID(_ context.Context, convID, senderGuuid, clientID string) (Message, bool, error) {
	for _, msg := range f.messages {
		if msg.ConversationID == convID && msg.SenderGuuid == senderGuuid && msg.ClientMessageID == clientID {
			return msg, true, nil
		}
	}
	return Message{}, false, nil
}

func (f *fakeStore) InsertMessage(_ context.Context, msg Message, receiverGuuid string) (Message, bool, error) {
	if existing, ok, _ := f.FindMessageByClientID(nil, msg.ConversationID, msg.SenderGuuid, msg.ClientMessageID); ok {
		return existing, true, nil
	}
	if msg.AttachmentID != "" {
		attachment, ok := f.attachments[msg.AttachmentID]
		if !ok || attachment.ConversationID != msg.ConversationID || attachment.Status != AttachmentUploaded ||
			attachment.MessageID != "" {
			return Message{}, false, errMediaIncomplete
		}
		attachment.MessageID = msg.ID
		attachment.Status = AttachmentBound
		f.attachments[msg.AttachmentID] = attachment
	}
	f.messages[msg.ID] = msg
	conv := f.convs[msg.ConversationID]
	conv.LastMessageID = msg.ID
	conv.LastMessageAt = msg.CreatedAt
	f.convs[conv.ID] = conv
	if receiverGuuid != "" {
		participant := f.participants[conv.ID][receiverGuuid]
		participant.HiddenAt = time.Time{}
		f.participants[conv.ID][receiverGuuid] = participant
	}
	return msg, false, nil
}

func (f *fakeStore) MessagesBefore(_ context.Context, convID string, cur *Cursor, limit int) ([]Message, error) {
	var items []Message
	for _, msg := range f.messages {
		if msg.ConversationID != convID {
			continue
		}
		if cur != nil && !messageBefore(msg, *cur) {
			continue
		}
		items = append(items, msg)
	}
	sortMessages(items)
	if len(items) > limit {
		items = items[len(items)-limit:]
	}
	return items, nil
}

func (f *fakeStore) MessagesAfter(_ context.Context, convID string, cur Cursor, limit int) ([]Message, error) {
	var items []Message
	for _, msg := range f.messages {
		if msg.ConversationID != convID {
			continue
		}
		if !messageAfter(msg, Message{ID: cur.ID, CreatedAt: cur.At}) {
			continue
		}
		items = append(items, msg)
	}
	sortMessages(items)
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (f *fakeStore) CreateAttachment(_ context.Context, a Attachment) error {
	f.attachments[a.ID] = a
	return nil
}

func (f *fakeStore) GetAttachment(_ context.Context, id string) (Attachment, bool, error) {
	attachment, ok := f.attachments[id]
	return attachment, ok, nil
}

func (f *fakeStore) CompleteImageAttachment(_ context.Context, id, storageKey, thumbKey, mime string, size int64, width, height int) error {
	attachment, ok := f.attachments[id]
	if !ok || attachment.StorageKey != "" {
		return errMediaIncomplete
	}
	attachment.StorageKey = storageKey
	attachment.ThumbnailKey = thumbKey
	attachment.MimeType = mime
	attachment.ByteSize = size
	attachment.Width = width
	attachment.Height = height
	f.attachments[id] = attachment
	return nil
}

func (f *fakeStore) AttachmentsByIDs(_ context.Context, ids []string) (map[string]Attachment, error) {
	result := map[string]Attachment{}
	for _, id := range ids {
		if attachment, ok := f.attachments[id]; ok {
			result[id] = attachment
		}
	}
	return result, nil
}

func (f *fakeStore) SaveSession(_ context.Context, session Session) error {
	f.sessions[session.TokenHash] = session
	return nil
}

func (f *fakeStore) LoadSession(_ context.Context, tokenHash string) (Session, bool, error) {
	session, ok := f.sessions[tokenHash]
	if !ok || session.ExpiresAt.Before(time.Now()) {
		return Session{}, false, nil
	}
	return session, true, nil
}

func (f *fakeStore) TouchSession(_ context.Context, _ string) {}

func (f *fakeStore) DeleteSession(_ context.Context, tokenHash string) error {
	delete(f.sessions, tokenHash)
	return nil
}

// ---------------- 排序辅助 ----------------

func sortMessages(items []Message) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
}

func messageBefore(msg Message, cur Cursor) bool {
	if msg.CreatedAt.Equal(cur.At) {
		return msg.ID < cur.ID
	}
	return msg.CreatedAt.Before(cur.At)
}

func messageAfter(msg Message, cur Message) bool {
	if msg.CreatedAt.Equal(cur.CreatedAt) {
		return msg.ID > cur.ID
	}
	return msg.CreatedAt.After(cur.CreatedAt)
}

func contains(value, sub string) bool {
	if sub == "" {
		return true
	}
	if len(sub) > len(value) {
		return false
	}
	for i := 0; i+len(sub) <= len(value); i++ {
		if value[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
