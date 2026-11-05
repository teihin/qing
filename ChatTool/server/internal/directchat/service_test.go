package directchat

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"testing"
	"time"
)

type testEnv struct {
	service *Service
	store   *fakeStore
	tokens  map[string]string
	media   *MediaStorage
}

func (env *testEnv) session(t *testing.T, guuid string) Session {
	t.Helper()
	session, err := env.service.Authenticate(context.Background(), env.tokens[guuid])
	if err != nil {
		t.Fatalf("authenticate %s: %v", guuid, err)
	}
	return session
}

func (env *testEnv) addSession(t *testing.T, guuid, name string) Session {
	t.Helper()
	token, _, err := env.service.CreateDevSession(context.Background(), guuid, name)
	if err != nil {
		t.Fatalf("dev session %s: %v", guuid, err)
	}
	env.tokens[guuid] = token
	return env.session(t, guuid)
}

// devOptions 让 CreateDevSession 可用（测试里只开到需要的用例）。
func devOptions() Options {
	return Options{SessionTTL: time.Hour, CursorKey: []byte("cursor-key-for-tests"), AllowDevLogin: true}
}

func newDevEnv(t *testing.T) *testEnv {
	t.Helper()
	store := newFakeStore()
	store.addClub("111111", "测试俱乐部一", "100004",
		Member{Guuid: "100001", Name: "玩家一", Note: "玩家备注", Role: RoleMember, SuperiorAgentGuuid: "100002", SuperiorLeaderGuuid: "100003"},
		Member{Guuid: "100002", Name: "代理二", Note: "代理备注", Role: RoleAgent},
		Member{Guuid: "100003", Name: "盟主三", Note: "盟主备注", Role: RoleLeader},
		Member{Guuid: "100005", Name: "管理员五", Role: RoleManager},
	)
	store.addClub("222222", "测试俱乐部二", "100004",
		Member{Guuid: "100001", Name: "玩家一", Note: "玩家备注", Role: RoleMember, SuperiorAgentGuuid: "100002"},
		Member{Guuid: "100002", Name: "代理二", Note: "代理备注", Role: RoleAgent},
	)
	media := NewMediaStorage(t.TempDir(), []byte("media-key-for-tests"), "http://127.0.0.1:8893/chattool")
	voice := NewAudioVoiceProvider("", 300, 10000)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	service := NewService(store, store, NewTicketVerifier(nil, time.Minute), media, voice, nil, devOptions(), logger)
	tokens := map[string]string{}
	for _, guuid := range []string{"100001", "100002", "100003", "100004", "100005"} {
		token, _, err := service.CreateDevSession(context.Background(), guuid, "用户"+guuid)
		if err != nil {
			t.Fatalf("dev session failed: %v", err)
		}
		tokens[guuid] = token
	}
	return &testEnv{service: service, store: store, tokens: tokens, media: media}
}

func TestCreateConversationIsIdempotentAndClubScoped(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	b := env.session(t, "100002")

	first, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	second, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if first.ConversationID == "" || first.ConversationID != second.ConversationID {
		t.Fatalf("repeated create must return the same conversation: %q vs %q", first.ConversationID, second.ConversationID)
	}
	// 另一个俱乐部必须产生另一条会话，消息与未读互不影响。
	other, err := env.service.CreateConversation(ctx, a, "222222", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if other.ConversationID == first.ConversationID {
		t.Fatal("different clubs must not share a conversation")
	}
	// 反向创建（对方发起）也命中同一条会话。
	reverse, err := env.service.CreateConversation(ctx, b, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	if reverse.ConversationID != first.ConversationID {
		t.Fatal("pair key must be order independent")
	}
	// 三个用户应有三条不同会话。
	c := env.session(t, "100003")
	third, err := env.service.CreateConversation(ctx, c, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if third.ConversationID == first.ConversationID || third.ConversationID == other.ConversationID {
		t.Fatal("three users must produce distinct conversations")
	}
}

func TestCrossClubIsolationForMessages(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")

	clubOne, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	clubTwo, err := env.service.CreateConversation(ctx, a, "222222", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, a, clubOne.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-1", Text: "俱乐部一的消息"}); err != nil {
		t.Fatal(err)
	}
	pageOne, err := env.service.Messages(ctx, a, clubOne.ConversationID, "", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	pageTwo, err := env.service.Messages(ctx, a, clubTwo.ConversationID, "", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(pageOne.Items) != 1 || len(pageTwo.Items) != 0 {
		t.Fatalf("messages must not leak across clubs: %d vs %d", len(pageOne.Items), len(pageTwo.Items))
	}
	// 各俱乐部列表也只显示自己的会话。
	listOne, err := env.service.Conversations(ctx, a, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	listTwo, err := env.service.Conversations(ctx, a, "222222", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	realOne := 0
	for _, item := range listOne.Items {
		if item.ConversationID != "" {
			realOne++
		}
	}
	realTwo := 0
	for _, item := range listTwo.Items {
		if item.ConversationID != "" {
			realTwo++
			if item.LastMessage != "" || item.LastMessageAt != "" {
				t.Fatal("club two conversation must not show club one preview")
			}
		}
	}
	if realOne != 1 || realTwo != 1 {
		t.Fatalf("unexpected real conversation counts: %d %d", realOne, realTwo)
	}
}

func TestAllConversationsAcrossClubs(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	player := env.session(t, "100001")

	clubOne, err := env.service.CreateConversation(ctx, player, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if clubOne.ClubName != "测试俱乐部一" {
		t.Fatalf("conversation must carry its club name, got %q", clubOne.ClubName)
	}
	if _, _, err := env.service.SendMessage(ctx, player, clubOne.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "all-club-one", Text: "俱乐部一"}); err != nil {
		t.Fatal(err)
	}

	// 确保跨俱乐部统一排序可以观察到最新消息在前。
	time.Sleep(2 * time.Millisecond)
	clubTwo, err := env.service.CreateConversation(ctx, player, "222222", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, player, clubTwo.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "all-club-two", Text: "俱乐部二"}); err != nil {
		t.Fatal(err)
	}

	page, err := env.service.AllConversations(ctx, player, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	// 两条真实会话 + 每个俱乐部一条固定「俱乐部老板」入口。
	if len(page.Items) != 4 {
		t.Fatalf("expected two real conversations and two fixed club-owner entries, got %d: %+v", len(page.Items), page.Items)
	}
	if page.Items[0].ClubID != "222222" || page.Items[0].ClubName != "测试俱乐部二" || page.Items[0].LastMessage != "俱乐部二" {
		t.Fatalf("newest cross-club conversation must be first: %+v", page.Items[0])
	}
	seen := map[string]int{}
	for _, item := range page.Items {
		seen[item.ClubID+":"+item.Peer.Guuid]++
		if item.ClubName == "" {
			t.Fatalf("every global list item must identify its club: %+v", item)
		}
	}
	if seen["111111:100002"] != 1 || seen["222222:100002"] != 1 {
		t.Fatalf("same peer in different clubs must remain two rows: %#v", seen)
	}
	if seen["111111:100004"] != 1 || seen["222222:100004"] != 1 {
		t.Fatalf("each club must carry one fixed club-owner entry: %#v", seen)
	}
}

func TestAllConversationsIncludesClubSuperiorsWithoutHistory(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	player := env.session(t, "100001")

	page, err := env.service.AllConversations(ctx, player, 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 4 {
		t.Fatalf("global message list must include superior and club-owner entries per club, got %d: %+v", len(page.Items), page.Items)
	}
	peers := map[string]bool{}
	for _, item := range page.Items {
		if !item.IsDefaultTarget || item.ConversationID != "" {
			t.Fatalf("history-free fixed entry is not default: %+v", item)
		}
		peers[item.Peer.Guuid] = true
	}
	if !peers["100002"] || !peers["100004"] {
		t.Fatalf("fixed entries must cover superior agent and club owner: %#v", peers)
	}
}

func TestSendMessageValidationAndIdempotency(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	conv, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	// 空消息必须拒绝。
	if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-empty", Text: "   "}); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("empty message must be rejected, got %v", err)
	}
	// 超长消息必须拒绝。
	long := ""
	for i := 0; i < MaxTextRunes+1; i++ {
		long += "字"
	}
	if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-long", Text: long}); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("too long message must be rejected, got %v", err)
	}
	// 客户端不能伪造系统消息。
	if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, ClientMessageID: "c-sys", Text: "系统"}); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("system message must be rejected, got %v", err)
	}
	// 弱网重试：同一个 clientMessageId 返回原消息，不产生第二条。
	first, duplicate, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-1", Text: "你好"})
	if err != nil || duplicate {
		t.Fatalf("first send failed: %v %v", err, duplicate)
	}
	again, duplicate, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-1", Text: "你好"})
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate || again.ID != first.ID {
		t.Fatalf("retry must return the original message: %v %v", duplicate, again.ID == first.ID)
	}
	page, err := env.service.Messages(ctx, a, conv.ConversationID, "", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("retry must not insert a second message, got %d", len(page.Items))
	}
}

func TestMessagePaginationUsesCursor(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	conv, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 75; i++ {
		text := "第" + itoa(i+1) + "条"
		if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
			MessageType: MessageText, ClientMessageID: "msg-" + itoa(i+1), Text: text}); err != nil {
			t.Fatal(err)
		}
	}
	// 首次进入只返回最新一页（默认 30 条），不能返回全部历史。
	first, err := env.service.Messages(ctx, a, conv.ConversationID, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != DefaultPageSize || !first.HasMoreBefore {
		t.Fatalf("first page size=%d hasMore=%v", len(first.Items), first.HasMoreBefore)
	}
	if first.Items[len(first.Items)-1].Text != "第75条" {
		t.Fatalf("latest message must be at the bottom, got %q", first.Items[len(first.Items)-1].Text)
	}
	// 连续向前翻页，不能重复、不能漏。
	seen := map[string]bool{}
	for _, item := range first.Items {
		seen[item.ID] = true
	}
	cursor := first.BeforeCursor
	total := len(first.Items)
	for i := 0; i < 3; i++ {
		page, err := env.service.Messages(ctx, a, conv.ConversationID, cursor, "", 30)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("duplicate message across pages: %s", item.ID)
			}
			seen[item.ID] = true
		}
		total += len(page.Items)
		if !page.HasMoreBefore {
			break
		}
		cursor = page.BeforeCursor
	}
	if total != 75 {
		t.Fatalf("paging must cover every message exactly once, got %d", total)
	}
	// 篡改游标必须拒绝。
	if _, err := env.service.Messages(ctx, a, conv.ConversationID, "not-a-cursor", "", 30); AsError(err).Code != CodeCursorInvalid {
		t.Fatalf("invalid cursor must be rejected, got %v", err)
	}
	// 超过单页上限时截断到最大值。
	big, err := env.service.Messages(ctx, a, conv.ConversationID, "", "", 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(big.Items) > MaxPageSize {
		t.Fatalf("page size must be capped at %d, got %d", MaxPageSize, len(big.Items))
	}
	// after 增量查询。
	after, err := env.service.Messages(ctx, a, conv.ConversationID, "", first.Items[0].ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Items) != DefaultPageSize-1 {
		t.Fatalf("after query returned %d items", len(after.Items))
	}
}

func TestParticipantAndMembershipChecks(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	b := env.session(t, "100002")
	conv, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	// 非参与者不能读。
	c := env.session(t, "100003")
	if _, err := env.service.Messages(ctx, c, conv.ConversationID, "", "", 30); AsError(err).Code != CodeConversationForbid {
		t.Fatalf("non participant must be forbidden, got %v", err)
	}
	// 非参与者不能发。
	if _, _, err := env.service.SendMessage(ctx, c, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "x", Text: "hi"}); AsError(err).Code != CodeConversationForbid {
		t.Fatalf("non participant send must be forbidden, got %v", err)
	}
	// 不同俱乐部成员不能创建会话。
	if _, err := env.service.CreateConversation(ctx, a, "222222", "100003"); AsError(err).Code != CodePeerNotClubMember {
		t.Fatalf("cross club create must fail, got %v", err)
	}
	// 自己不能和自己聊天。
	if _, err := env.service.CreateConversation(ctx, a, "111111", "100001"); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("self conversation must fail, got %v", err)
	}
	// 对方退会后：历史可读、发送被拒。
	env.store.removeMember("111111", "100002")
	page, err := env.service.Messages(ctx, a, conv.ConversationID, "", "", 30)
	if err != nil {
		if AsError(err).Code != CodePeerNotClubMember {
			t.Fatalf("read after peer left should keep history, got %v", err)
		}
	} else if page.CanSend || page.ReadOnlyReason == "" {
		t.Fatalf("peer left must disable sending: %+v", page)
	}
	if _, _, err := env.service.SendMessage(ctx, b, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "leaved", Text: "还能发吗"}); err == nil {
		t.Fatal("peer who left the club must not send")
	}
}

func TestHideRulesAndReveal(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001") // 玩家：不能删除
	agent := env.session(t, "100002")
	manager := env.session(t, "100005")

	conv, err := env.service.CreateConversation(ctx, agent, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	// 玩家与管理员都不能隐藏。
	if err := env.service.Hide(ctx, a, conv.ConversationID); AsError(err).Code != CodeDeleteForbidden {
		t.Fatalf("member must not hide, got %v", err)
	}
	managerConv, err := env.service.CreateConversation(ctx, manager, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	if err := env.service.Hide(ctx, manager, managerConv.ConversationID); AsError(err).Code != CodeDeleteForbidden {
		t.Fatalf("manager must not hide, got %v", err)
	}
	// 代理可以隐藏，且只影响自己。
	if err := env.service.Hide(ctx, agent, conv.ConversationID); err != nil {
		t.Fatal(err)
	}
	agentList, err := env.service.Conversations(ctx, agent, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range agentList.Items {
		if item.ConversationID == conv.ConversationID {
			t.Fatalf("hidden conversation must disappear from own list: %+v", agentList.Items)
		}
	}
	if !agentList.CanDelete {
		t.Fatal("agent must see delete permission")
	}
	// 玩家侧不受影响（默认入口仍可见）。
	playerList, err := env.service.Conversations(ctx, a, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range playerList.Items {
		if item.Peer.Guuid == "100002" {
			found = true
		}
	}
	if !found {
		t.Fatal("peer hide must not remove the other side's entry")
	}
	// 对方发新消息后，隐藏的会话重新出现。
	if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "revive", Text: "在吗"}); err != nil {
		t.Fatal(err)
	}
	agentList, err = env.service.Conversations(ctx, agent, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	revived := false
	for _, item := range agentList.Items {
		if item.ConversationID == conv.ConversationID {
			revived = true
			if item.Unread != 1 {
				t.Fatalf("revived conversation must carry unread=1: %+v", item)
			}
		}
	}
	if !revived {
		t.Fatalf("new message must reveal conversation: %+v", agentList.Items)
	}
	// 从玩家列表再次打开：恢复原会话，不产生重复会话。
	reopened, err := env.service.CreateConversation(ctx, agent, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	if reopened.ConversationID != conv.ConversationID {
		t.Fatal("reopening must reuse the same conversation")
	}
	if err := env.service.Hide(ctx, agent, conv.ConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.service.CreateConversation(ctx, agent, "111111", "100001"); err != nil {
		t.Fatal(err)
	}
	agentList, _ = env.service.Conversations(ctx, agent, "111111", 1, 30)
	restored := false
	for _, item := range agentList.Items {
		if item.ConversationID == conv.ConversationID {
			restored = true
		}
	}
	if !restored {
		t.Fatalf("reopen after hide must restore the conversation: %+v", agentList.Items)
	}
}

func TestDefaultTargetsForMember(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")

	page, err := env.service.Conversations(ctx, a, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("player must see fixed superior-agent and club-owner targets, got %d: %+v", len(page.Items), page.Items)
	}
	want := []string{"100002", "100004"} // 直属上级代理 + 俱乐部老板
	for i, guuid := range want {
		item := page.Items[i]
		if !item.IsDefaultTarget || item.ConversationID != "" {
			t.Fatalf("default entry must have null conversation: %+v", item)
		}
		if item.Peer.Guuid != guuid {
			t.Fatalf("default target order mismatch at %d: %s", i, item.Peer.Guuid)
		}
	}
	// 代理/群主端不返回默认入口，只看真实会话。
	owner := env.session(t, "100004")
	ownerPage, err := env.service.Conversations(ctx, owner, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerPage.Items) != 0 {
		t.Fatalf("owner must see only real conversations, got %d", len(ownerPage.Items))
	}
	// 上级代理退出俱乐部后，固定入口不再返回。
	env.store.removeMember("111111", "100002")
	page, err = env.service.Conversations(ctx, a, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.Peer.Guuid == "100002" {
			t.Fatal("superior who left the club must not appear")
		}
	}
}

func TestExistingSuperiorAgentConversationStaysFixed(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	player := env.session(t, "100001")
	conversation, err := env.service.CreateConversation(ctx, player, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	page, err := env.service.Conversations(ctx, player, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if item.ConversationID == conversation.ConversationID {
			found = true
			if !item.IsDefaultTarget || item.Peer.Guuid != "100002" {
				t.Fatalf("existing superior-agent conversation must remain fixed: %+v", item)
			}
		}
	}
	if !found {
		t.Fatalf("existing superior-agent conversation missing from list: %+v", page.Items)
	}
	if err := env.service.Hide(ctx, player, conversation.ConversationID); AsError(err).Code != CodeDeleteForbidden {
		t.Fatal("ordinary player must not delete the fixed superior-agent conversation")
	}
}

func TestAgentAlsoGetsClubSuperiorAsFixedConversation(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	agentMember := env.store.members["111111"]["100002"]
	agentMember.SuperiorAgentGuuid = "100003"
	env.store.members["111111"]["100002"] = agentMember
	agent := env.session(t, "100002")

	page, err := env.service.Conversations(ctx, agent, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("agent must see superior and club-owner fixed entries, got %+v", page.Items)
	}
	foundSuperior := false
	for _, item := range page.Items {
		if !item.IsDefaultTarget {
			t.Fatalf("agent fixed entries must be default: %+v", item)
		}
		if item.Peer.Guuid == "100003" {
			foundSuperior = true
		}
	}
	if !foundSuperior {
		t.Fatalf("agent must see club superior fixed entry: %+v", page.Items)
	}

	conversation, err := env.service.CreateConversation(ctx, agent, "111111", "100003")
	if err != nil {
		t.Fatal(err)
	}
	messagePage, err := env.service.Messages(ctx, agent, conversation.ConversationID, "", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	if messagePage.CanDelete {
		t.Fatal("fixed superior conversation must not expose delete permission")
	}
	if err := env.service.Hide(ctx, agent, conversation.ConversationID); AsError(err).Code != CodeDeleteForbidden {
		t.Fatal("agent must not delete the fixed superior conversation")
	}
}

func TestMemberNoteOnlyVisibleToSuperiorChain(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	player := env.session(t, "100001")
	agent := env.session(t, "100002")

	conversation, err := env.service.CreateConversation(ctx, player, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	playerList, err := env.service.Conversations(ctx, player, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	var playerConversation *ConversationView
	for i := range playerList.Items {
		if playerList.Items[i].ConversationID == conversation.ConversationID {
			playerConversation = &playerList.Items[i]
			break
		}
	}
	if playerConversation == nil || playerConversation.Peer.Note != "" {
		t.Fatalf("downline must not see superior note: %+v", playerList.Items)
	}

	agentList, err := env.service.Conversations(ctx, agent, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	var playerItem *ConversationView
	for i := range agentList.Items {
		if agentList.Items[i].ConversationID == conversation.ConversationID {
			playerItem = &agentList.Items[i]
			break
		}
	}
	if playerItem == nil || playerItem.Peer.Note != "玩家备注" {
		t.Fatalf("superior must see downline note: %+v", agentList.Items)
	}

	messagePage, err := env.service.Messages(ctx, agent, conversation.ConversationID, "", "", 30)
	if err != nil {
		t.Fatal(err)
	}
	if messagePage.Peer.Note != "玩家备注" {
		t.Fatalf("chat detail must keep the same note visibility: %+v", messagePage.Peer)
	}
}

func TestUnreadAndReadAreIndependent(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	b := env.session(t, "100002")
	conv, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	var first MessageView
	var last MessageView
	for i := 0; i < 2; i++ {
		view, _, err := env.service.SendMessage(ctx, b, conv.ConversationID, SendRequest{
			MessageType: MessageText, ClientMessageID: "b-" + itoa(i), Text: "消息" + itoa(i)})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = view
		}
		last = view
	}
	unread, err := env.service.Unread(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if unread.Total != 2 || unread.ByClub["111111"] != 2 {
		t.Fatalf("unexpected unread: %+v", unread)
	}
	// 自己发的消息不增加自己的未读。
	selfUnread, err := env.service.Unread(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	if selfUnread.Total != 0 {
		t.Fatalf("own messages must not increase own unread: %+v", selfUnread)
	}
	// 提交已读只影响自己。
	if err := env.service.MarkRead(ctx, a, conv.ConversationID, last.ID); err != nil {
		t.Fatal(err)
	}
	unread, _ = env.service.Unread(ctx, a)
	if unread.Total != 0 {
		t.Fatalf("read must clear own unread, got %+v", unread)
	}
	// 旧的并发已读请求不能把游标从最新消息退回到更早消息。
	if err := env.service.MarkRead(ctx, a, conv.ConversationID, first.ID); err != nil {
		t.Fatal(err)
	}
	unread, _ = env.service.Unread(ctx, a)
	if unread.Total != 0 {
		t.Fatalf("older read request must not restore unread, got %+v", unread)
	}
	// 未读 0 的会话不能跨俱乐部计算。
	other, err := env.service.CreateConversation(ctx, a, "222222", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, b, other.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "b-2", Text: "另一个俱乐部"}); err != nil {
		t.Fatal(err)
	}
	unread, _ = env.service.Unread(ctx, a)
	if unread.Total != 1 || unread.ByClub["222222"] != 1 {
		t.Fatalf("unread must be reported per club, got %+v", unread)
	}
}

func TestAttachmentFlowRequiresUploadAndBind(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	conv, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	// 未上传的图片附件不能绑定消息。
	ticket, err := env.service.CreateAttachment(ctx, a, conv.ConversationID, AttachmentRequest{
		Type: MessageImage, MimeType: "image/jpeg", ByteSize: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageImage, ClientMessageID: "img-1", AttachmentID: ticket.AttachmentID}); AsError(err).Code != CodeMediaIncomplete {
		t.Fatalf("unfinished attachment must not be sent, got %v", err)
	}
	// 上传非图片内容必须被拒。
	if _, err := env.service.UploadImage(ctx, a, conv.ConversationID, ticket.AttachmentID, []byte("<svg/>")); err == nil {
		t.Fatal("non image upload must be rejected")
	}
	// 合法图片必须完成上传、确认并成功绑定到图片消息。
	validImage := bytes.NewBuffer(nil)
	if err := jpeg.Encode(validImage, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatal(err)
	}
	imageTicket, err := env.service.CreateAttachment(ctx, a, conv.ConversationID, AttachmentRequest{
		Type: MessageImage, MimeType: "image/jpeg", ByteSize: int64(validImage.Len()), Width: 1, Height: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.service.UploadImage(ctx, a, conv.ConversationID, imageTicket.AttachmentID, validImage.Bytes()); err != nil {
		t.Fatal(err)
	}
	if _, err := env.service.CompleteAttachment(ctx, a, conv.ConversationID, imageTicket.AttachmentID); err != nil {
		t.Fatal(err)
	}
	imageMessage, _, err := env.service.SendMessage(ctx, a, conv.ConversationID, SendRequest{
		MessageType: MessageImage, ClientMessageID: "img-2", AttachmentID: imageTicket.AttachmentID})
	if err != nil || imageMessage.MessageType != MessageImage || imageMessage.Attachment == nil {
		t.Fatalf("uploaded image must be bindable, message=%+v err=%v", imageMessage, err)
	}
	// 超大附件在创建时即拒绝。
	if _, err := env.service.CreateAttachment(ctx, a, conv.ConversationID, AttachmentRequest{
		Type: MessageImage, MimeType: "image/jpeg", ByteSize: MaxImageBytes + 1}); AsError(err).Code != CodeMediaTooLarge {
		t.Fatalf("oversized attachment must be rejected, got %v", err)
	}
	// 语音在创建时就要经 AudioServer 校验；未配置时必须失败，不能只信客户端参数。
	if _, err := env.service.CreateAttachment(ctx, a, conv.ConversationID, AttachmentRequest{
		Type: MessageVoice, Provider: ProviderAudioServer, ExternalMediaID: "aabb", DurationMS: 1200}); err == nil {
		t.Fatal("voice without verifiable AudioServer must be rejected")
	}
}

// 消息首页全局列表：一次返回所有已加入俱乐部的会话，并带上 clubId/clubName。
func TestConversationsAllAggregatesClubs(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")

	first, err := env.service.CreateConversation(ctx, a, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	second, err := env.service.CreateConversation(ctx, a, "222222", "100002")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, a, first.ConversationID, SendRequest{
		MessageType: "text", ClientMessageID: "c-1", Text: "俱乐部1的消息",
	}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)
	if _, _, err := env.service.SendMessage(ctx, a, second.ConversationID, SendRequest{
		MessageType: "text", ClientMessageID: "c-2", Text: "俱乐部2的消息",
	}); err != nil {
		t.Fatal(err)
	}

	page, err := env.service.AllConversations(ctx, a, 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	// 两个俱乐部的上级代理会话都要出现，且各自带 clubId + clubName。
	real := map[string]ConversationView{}
	for _, item := range page.Items {
		if item.ConversationID == "" {
			continue
		}
		real[item.ClubID] = item
	}
	if len(real) != 2 {
		t.Fatalf("期望两个俱乐部各一条会话，实际 %d：%+v", len(real), page.Items)
	}
	if real["111111"].ClubName != "测试俱乐部一" || real["222222"].ClubName != "测试俱乐部二" {
		t.Fatalf("clubName 不正确：%+v", real)
	}
	if page.Items[0].ClubID != "222222" {
		t.Fatalf("应按最后消息时间倒序，首条应是俱乐部二：%+v", page.Items[0])
	}
}

// 上下分/下分成功后的系统通报：管理角色 + 固定文案才放行，其余一律拒绝。
func TestSystemNoticeRequiresManagerRoleAndFixedText(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	leader := env.session(t, "100003")
	member := env.session(t, "100001")
	conv, err := env.service.CreateConversation(ctx, leader, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	notice := "玩家 玩家一 上分 100 成功，积分 1000 → 1100"
	msg, _, err := env.service.SendMessage(ctx, leader, conv.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, ClientMessageID: "sys-ok", Text: notice})
	if err != nil {
		t.Fatalf("leader must be allowed to send system notice: %v", err)
	}
	if msg.MessageType != MessageTypeSystem || msg.Text != notice {
		t.Fatalf("unexpected system message: %+v", msg)
	}
	// 不限格式就能发广告，所以自由文本必须拒绝。
	if _, _, err := env.service.SendMessage(ctx, leader, conv.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, ClientMessageID: "sys-bad", Text: "系统公告：快来充值"}); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("free-form system text must be rejected, got %v", err)
	}
	// 普通成员不能发系统通报。
	if _, _, err := env.service.SendMessage(ctx, member, conv.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, ClientMessageID: "sys-member", Text: notice}); AsError(err).Code != CodeMessageInvalid {
		t.Fatalf("member must not send system notice, got %v", err)
	}
}

// 赠送积分也走同一个通报格式。
func TestSystemNoticeAcceptsGiveVerb(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	agent := env.session(t, "100002")
	conv, err := env.service.CreateConversation(ctx, agent, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, agent, conv.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, ClientMessageID: "sys-give",
		Text: "玩家 玩家一 赠送 200 成功，积分 800 → 1000"}); err != nil {
		t.Fatalf("agent must be allowed to send give notice: %v", err)
	}
}

// 有新消息（未读）的会话必须排在最前面，不能被固定上级入口挤到后面。
func TestAllConversationsPutsUnreadFirst(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	a := env.session(t, "100001")
	leader := env.session(t, "100003")

	conv, err := env.service.CreateConversation(ctx, a, "111111", "100003")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.service.CreateConversation(ctx, a, "111111", "100002"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.service.SendMessage(ctx, leader, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-unread", Text: "在吗"}); err != nil {
		t.Fatal(err)
	}

	page, err := env.service.AllConversations(ctx, a, 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 {
		t.Fatal("no conversations")
	}
	if page.Items[0].Unread <= 0 {
		t.Fatalf("unread conversation must be first, got peer=%s unread=%d default=%v",
			page.Items[0].Peer.Guuid, page.Items[0].Unread, page.Items[0].IsDefaultTarget)
	}
}

// ---------------- 联盟模式 V2 ----------------

func unionEnv(t *testing.T) (*testEnv, Session, Session, Session) {
	t.Helper()
	env := newDevEnv(t)
	union := Union{ID: "900001", Name: "测试联盟", OwnerGuuid: "100009", OwnerClub: "111111"}
	env.store.addUnion("111111", union)
	env.store.addUnion("222222", union)
	unionOwner := env.addSession(t, "100009", "大群主")
	return env, unionOwner, env.session(t, "100001"), env.session(t, "100003")
}

func TestUnionOwnerAndClubOwnerAreFixedTargets(t *testing.T) {
	env, _, player, _ := unionEnv(t)
	ctx := context.Background()

	page, err := env.service.Conversations(ctx, player, "111111", 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"100002", "100004", "100009"}
	if len(page.Items) != len(want) {
		t.Fatalf("player must see superior, club owner and union owner fixed entries, got %d: %+v", len(page.Items), page.Items)
	}
	for i, guuid := range want {
		item := page.Items[i]
		if !item.IsDefaultTarget || item.ConversationID != "" {
			t.Fatalf("fixed entry %d must be default: %+v", i, item)
		}
		if item.Peer.Guuid != guuid {
			t.Fatalf("fixed target order mismatch at %d: got %s want %s", i, item.Peer.Guuid, guuid)
		}
	}
	if page.Items[2].Peer.Role != RoleUnionOwner {
		t.Fatalf("union owner must expose union_owner role: %+v", page.Items[2].Peer)
	}

	conversation, err := env.service.CreateConversation(ctx, player, "111111", "100009")
	if err != nil {
		t.Fatal(err)
	}
	if err := env.service.Hide(ctx, player, conversation.ConversationID); AsError(err).Code != CodeDeleteForbidden {
		t.Fatalf("member must not delete union-owner conversation, got %v", err)
	}
}

func TestUnionOwnerCanChatWithAnyMemberAcrossClubs(t *testing.T) {
	env, unionOwner, player, outsider := unionEnv(t)
	ctx := context.Background()

	conversation, err := env.service.CreateConversation(ctx, unionOwner, "222222", "100001")
	if err != nil {
		t.Fatalf("union owner must open cross-club conversation: %v", err)
	}
	if _, _, err := env.service.SendMessage(ctx, unionOwner, conversation.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "union-owner-hello", Text: "你好"}); err != nil {
		t.Fatal(err)
	}
	reply, _, err := env.service.SendMessage(ctx, player, conversation.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "member-reply", Text: "收到"})
	if err != nil {
		t.Fatalf("member must reply in union-owner conversation: %v", err)
	}
	if reply.SenderRole != RoleMember {
		t.Fatalf("member reply must keep member role, got %q", reply.SenderRole)
	}

	// 普通代理不能跨俱乐部找别人，只能找本俱乐部成员或大群主。
	_, crossErr := env.service.CreateConversation(ctx, outsider, "222222", "100001")
	if biz := AsError(crossErr); biz.Code != CodePeerNotClubMember && biz.Code != CodeNotClubMember {
		t.Fatalf("non-union cross-club chat must be rejected, got %v", biz)
	}
	// 但可以找本俱乐部的大群主。
	if _, err := env.service.CreateConversation(ctx, outsider, "111111", "100009"); err != nil {
		t.Fatalf("club member must open conversation with union owner: %v", err)
	}

	// 大群主的消息首页必须包含跨俱乐部会话。
	page, err := env.service.AllConversations(ctx, unionOwner, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if item.ConversationID == conversation.ConversationID && item.ClubID == "222222" {
			found = true
		}
	}
	if !found {
		t.Fatalf("union owner cross-club conversation missing from global list: %+v", page.Items)
	}
}

func TestUnionOwnerCanListAnyClubMembers(t *testing.T) {
	env, unionOwner, _, outsider := unionEnv(t)
	ctx := context.Background()

	page, err := env.service.Members(ctx, unionOwner, "222222", "", 1, 30)
	if err != nil {
		t.Fatalf("union owner must list union club members: %v", err)
	}
	found := false
	for _, item := range page.Items {
		if item.Guuid == "100001" {
			found = true
			if !item.CanChat {
				t.Fatalf("union owner must be allowed to chat with club members: %+v", item)
			}
		}
	}
	if !found {
		t.Fatalf("expected player 100001 in club 222222 members: %+v", page.Items)
	}
	if _, err := env.service.Members(ctx, outsider, "222222", "", 1, 30); err == nil {
		t.Fatal("non-member must not list another club's members")
	}
}

func TestUnionOwnerConversationsStaySeparatePerClub(t *testing.T) {
	env, unionOwner, _, _ := unionEnv(t)
	ctx := context.Background()

	first, err := env.service.CreateConversation(ctx, unionOwner, "111111", "100001")
	if err != nil {
		t.Fatal(err)
	}
	second, err := env.service.CreateConversation(ctx, unionOwner, "222222", "100001")
	if err != nil {
		t.Fatal(err)
	}
	if first.ConversationID == second.ConversationID {
		t.Fatal("same person in different clubs must keep separate conversations")
	}
	page, err := env.service.AllConversations(ctx, unionOwner, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, item := range page.Items {
		if item.Peer.Guuid == "100001" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("union owner must see one conversation per club, got %d: %+v", count, page.Items)
	}
}

func TestClearChatIsPerUserAndKeepsMessages(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	player := env.session(t, "100001")
	agent := env.session(t, "100002")
	conv, err := env.service.CreateConversation(ctx, player, "111111", "100002")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		session Session
		client  string
		text    string
	}{{player, "c-1", "第一条"}, {agent, "c-2", "第二条"}, {player, "c-3", "第三条"}} {
		if _, _, err := env.service.SendMessage(ctx, item.session, conv.ConversationID, SendRequest{
			MessageType: MessageText, ClientMessageID: item.client, Text: item.text}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond)
	}

	page, err := env.service.Messages(ctx, player, conv.ConversationID, "", "", 30)
	if err != nil || len(page.Items) != 3 {
		t.Fatalf("before clear, player must see 3 messages: %v %d", err, len(page.Items))
	}
	if err := env.service.Clear(ctx, player, conv.ConversationID); err != nil {
		t.Fatal(err)
	}
	page, err = env.service.Messages(ctx, player, conv.ConversationID, "", "", 30)
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("after clear, player must see nothing: %v %d", err, len(page.Items))
	}
	// 对方/客服侧仍保留完整记录。
	page, err = env.service.Messages(ctx, agent, conv.ConversationID, "", "", 30)
	if err != nil || len(page.Items) != 3 {
		t.Fatalf("agent must still see the history: %v %d", err, len(page.Items))
	}
	// 列表预览和未读也要跟着清掉。
	list, err := env.service.AllConversations(ctx, player, 1, 30)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range list.Items {
		if item.ConversationID != conv.ConversationID {
			continue
		}
		if item.LastMessage != "" || item.Unread != 0 {
			t.Fatalf("cleared conversation must not keep preview/unread: %+v", item)
		}
	}
	// 清除之后的新消息仍然要能看到。
	time.Sleep(2 * time.Millisecond)
	if _, _, err := env.service.SendMessage(ctx, agent, conv.ConversationID, SendRequest{
		MessageType: MessageText, ClientMessageID: "c-4", Text: "清除后的新消息"}); err != nil {
		t.Fatal(err)
	}
	page, err = env.service.Messages(ctx, player, conv.ConversationID, "", "", 30)
	if err != nil || len(page.Items) != 1 || page.Items[0].Text != "清除后的新消息" {
		t.Fatalf("new message after clear must be visible: %v %+v", err, page.Items)
	}
}
