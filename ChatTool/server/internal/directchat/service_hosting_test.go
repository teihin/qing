package directchat

import (
	"context"
	"log/slog"
	"testing"
)

// 聊天托管：联盟总群主归到联盟，已入盟俱乐部创建者归到俱乐部，
// 普通成员和未入盟群主不开放。
func TestHostingEligibilityAndGroups(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	env.store.addClub("333333", "盟主俱乐部", "100003",
		Member{Guuid: "100001", Name: "玩家一", Role: RoleMember})
	env.store.addUnion("333333", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	env.store.addClub("444444", "普通俱乐部", "100005")

	member, err := env.service.HostingStatus(ctx, env.session(t, "100001"))
	if err != nil {
		t.Fatalf("member status failed: %v", err)
	}
	if member.Eligible {
		t.Fatalf("普通成员不应有托管资格: %+v", member)
	}

	unionOwner, err := env.service.HostingStatus(ctx, env.session(t, "100004"))
	if err != nil {
		t.Fatalf("union owner status failed: %v", err)
	}
	if !unionOwner.Eligible || unionOwner.GroupType != HostingGroupUnion || unionOwner.GroupName != "测试联盟" {
		t.Fatalf("联盟总群主应归到联盟: %+v", unionOwner)
	}

	enabled, err := env.service.SetHosting(ctx, env.session(t, "100004"), true)
	if err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	if !enabled.Enabled {
		t.Fatalf("开启后状态应为 enabled: %+v", enabled)
	}

	clubOwner, err := env.service.SetHosting(ctx, env.session(t, "100003"), true)
	if err != nil {
		t.Fatalf("club owner enable failed: %v", err)
	}
	if !clubOwner.Enabled || clubOwner.GroupType != HostingGroupClub || clubOwner.GroupID != "333333" {
		t.Fatalf("已入盟俱乐部创建者应归到俱乐部: %+v", clubOwner)
	}

	// 未入盟的普通俱乐部群主同样可以托管，显示「群主」。
	plainOwner, err := env.service.SetHosting(ctx, env.session(t, "100005"), true)
	if err != nil {
		t.Fatalf("plain club owner enable failed: %v", err)
	}
	if !plainOwner.Enabled || plainOwner.GroupType != HostingGroupClub || plainOwner.GroupID != "444444" || plainOwner.RoleName != "群主" {
		t.Fatalf("未入盟群主应可托管并显示群主: %+v", plainOwner)
	}

	groups, err := env.service.HostedGroups(ctx)
	if err != nil {
		t.Fatalf("hosted groups failed: %v", err)
	}
	if len(groups) != 3 || groups[0].Type != HostingGroupUnion {
		t.Fatalf("托管分组应联盟在前、俱乐部在后: %+v", groups)
	}
	if len(groups[0].Items) != 1 || groups[0].Items[0].Guuid != "100004" {
		t.Fatalf("联盟分组内容不正确: %+v", groups[0])
	}
	foundPlain := false
	for _, group := range groups {
		for _, owner := range group.Items {
			if owner.Guuid == "100005" {
				foundPlain = owner.RoleName == "群主" && owner.GroupID == "444444"
			}
		}
	}
	if !foundPlain {
		t.Fatalf("未入盟群主分组不正确: %+v", groups)
	}
}

// 客服代发必须以托管账号身份落库，并返回真实接收方用于实时通知。
func TestHostedConversationAndReply(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})

	host := env.session(t, "100004")
	if _, err := env.service.SetHosting(ctx, host, true); err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	conversation, err := env.service.CreateConversation(ctx, host, "111111", "100001")
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}
	if _, _, err := env.service.SendMessage(ctx, host, conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "本人消息", ClientMessageID: "host-msg-1",
	}); err != nil {
		t.Fatalf("send host message failed: %v", err)
	}

	list, err := env.service.HostedConversations(ctx, "100004")
	if err != nil {
		t.Fatalf("hosted conversations failed: %v", err)
	}
	if len(list) != 1 || list[0].Peer.Guuid != "100001" || list[0].HostedGuuid != "100004" {
		t.Fatalf("托管会话列表不正确: %+v", list)
	}
	page, err := env.service.HostedMessages(ctx, "100004", conversation.ConversationID, "", "", 20)
	if err != nil {
		t.Fatalf("hosted messages failed: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].Text != "本人消息" {
		t.Fatalf("托管历史不正确: %+v", page.Items)
	}

	view, duplicate, recipient, clubID, err := env.service.SendHostedMessage(ctx, "100004", conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "客服代回", ClientMessageID: "hosted-reply-1",
	})
	if err != nil {
		t.Fatalf("hosted reply failed: %v", err)
	}
	if duplicate || view.SenderGuuid != "100004" || view.Text != "客服代回" {
		t.Fatalf("代发消息应以托管账号身份落库: %+v duplicate=%v", view, duplicate)
	}
	if recipient != "100001" || clubID != "111111" {
		t.Fatalf("代发应返回接收方与俱乐部: recipient=%s club=%s", recipient, clubID)
	}
	after, err := env.service.HostedMessages(ctx, "100004", conversation.ConversationID, "", "", 20)
	if err != nil {
		t.Fatalf("hosted messages after reply failed: %v", err)
	}
	if len(after.Items) != 2 || after.Items[1].Text != "客服代回" {
		t.Fatalf("代发消息未出现在历史中: %+v", after.Items)
	}

	// 对方发来的新消息计入客服共享未读；任一客服打开会话后清除。
	if _, _, err := env.service.SendMessage(ctx, env.session(t, "100001"), conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "玩家追问", ClientMessageID: "notice-3",
	}); err != nil {
		t.Fatalf("send player message failed: %v", err)
	}
	unread, err := env.service.HostedConversations(ctx, "100004")
	if err != nil {
		t.Fatalf("hosted conversations unread failed: %v", err)
	}
	if len(unread) != 1 || unread[0].Unread != 1 {
		t.Fatalf("对方新消息应产生 1 条客服未读: %+v", unread)
	}
	if _, err := env.service.HostedMessages(ctx, "100004", conversation.ConversationID, "", "", 20); err != nil {
		t.Fatalf("open hosted conversation failed: %v", err)
	}
	read, err := env.service.HostedConversations(ctx, "100004")
	if err != nil {
		t.Fatalf("hosted conversations after read failed: %v", err)
	}
	if len(read) != 1 || read[0].Unread != 0 {
		t.Fatalf("打开会话后客服未读应清零: %+v", read)
	}

	_, _, _, _, err = env.service.SendHostedMessage(ctx, "100002", conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "未托管", ClientMessageID: "hosted-reply-2",
	})
	if biz := AsError(err); biz.Code != CodeHostingInactive {
		t.Fatalf("未托管账号代发应被拒绝: %v", err)
	}
}

// 托管账号收到消息时通知客服工作台；托管账号自己发出的消息不应触发提示。
func TestHostedMessageNotifier(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	host := env.session(t, "100004")
	if _, err := env.service.SetHosting(ctx, host, true); err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	conversation, err := env.service.CreateConversation(ctx, host, "111111", "100001")
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}

	handler := NewHandler(env.service, slog.Default())
	notices := make([]HostedMessageNotice, 0)
	handler.SetHostedMessageNotifier(func(notice HostedMessageNotice) { notices = append(notices, notice) })

	if _, _, err := handler.sendMessageAndPublish(ctx, env.session(t, "100001"), conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "在吗", ClientMessageID: "notice-1",
	}); err != nil {
		t.Fatalf("send to hosted failed: %v", err)
	}
	if len(notices) != 1 || notices[0].HostedGuuid != "100004" || notices[0].Preview != "在吗" || !notices[0].Incoming {
		t.Fatalf("托管账号收到消息应通知客服: %+v", notices)
	}

	notices = notices[:0]
	if _, _, err := handler.sendMessageAndPublish(ctx, host, conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "回复", ClientMessageID: "notice-2",
	}); err != nil {
		t.Fatalf("send from hosted failed: %v", err)
	}
	if len(notices) != 1 || notices[0].HostedGuuid != "100004" || notices[0].Incoming {
		t.Fatalf("托管账号自己发送也应实时同步客服（不提示来消息）: %+v", notices)
	}
}

// 网页显示的角色名与游戏内统一：大盟主/盟主/群主/合伙人/玩家。
func TestRoleDisplayNameMatchesGame(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	cases := []struct {
		name   string
		clubID string
		member Member
		want   string
	}{
		{name: "联盟总群主", clubID: "111111", member: Member{Role: RoleUnionOwner}, want: "大盟主"},
		{name: "总群主在本俱乐部", clubID: "111111", member: Member{Role: RoleOwner, IsUnionOwner: true}, want: "大盟主"},
		{name: "已入盟俱乐部创建者", clubID: "111111", member: Member{Role: RoleOwner}, want: "盟主"},
		{name: "未入盟俱乐部创建者", clubID: "222222", member: Member{Role: RoleOwner}, want: "群主"},
		{name: "代理", clubID: "111111", member: Member{Role: RoleAgent}, want: "合伙人"},
		{name: "上级代理", clubID: "111111", member: Member{Role: RoleLeader}, want: "合伙人"},
		{name: "普通成员", clubID: "111111", member: Member{Role: RoleMember}, want: "玩家"},
	}
	for _, item := range cases {
		if got := env.service.roleDisplayName(ctx, item.clubID, item.member); got != item.want {
			t.Errorf("%s: got %s want %s", item.name, got, item.want)
		}
	}
}

// 客服托管上下分：以托管账号发带「（客服托管）」的系统通报，并返回正确的操作目标。
func TestHostedGoldTargetAndNotice(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	host := env.session(t, "100004")
	if _, err := env.service.SetHosting(ctx, host, true); err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	conversation, err := env.service.CreateConversation(ctx, host, "111111", "100001")
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}
	target, err := env.service.HostedGoldTarget(ctx, "100004", conversation.ConversationID)
	if err != nil {
		t.Fatalf("hosted gold target failed: %v", err)
	}
	if target.ClubID != "111111" || target.PeerGuuid != "100001" || target.PeerName != "玩家一" {
		t.Fatalf("上下分目标不正确: %+v", target)
	}
	env.store.setClubGold("111111", "100001", 888)
	balance, err := env.service.HostedBalance(ctx, "100004", conversation.ConversationID)
	if err != nil {
		t.Fatalf("hosted balance failed: %v", err)
	}
	if balance.ClubGold == nil || *balance.ClubGold != 888 || balance.PeerName != "玩家一" || balance.ClubName != "测试俱乐部一" {
		t.Fatalf("托管余额不正确: %+v", balance)
	}
	view, _, _, _, err := env.service.SendHostedMessage(ctx, "100004", conversation.ConversationID, SendRequest{
		MessageType: MessageTypeSystem, Text: "玩家 玩家一 上分 100 成功（客服托管）", ClientMessageID: "hosted-gold-notice",
	})
	if err != nil {
		t.Fatalf("hosted system notice failed: %v", err)
	}
	if view.MessageType != MessageTypeSystem || view.Text != "玩家 玩家一 上分 100 成功（客服托管）" {
		t.Fatalf("系统通报内容不正确: %+v", view)
	}
}

// 取消托管后记录和会话保留为只读，可手动删除；删除前不能继续代发。
func TestHostingDisabledKeepsHistoryAndCanDelete(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})

	host := env.session(t, "100004")
	if _, err := env.service.SetHosting(ctx, host, true); err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	conversation, err := env.service.CreateConversation(ctx, host, "111111", "100001")
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}
	if _, _, err := env.service.SendMessage(ctx, host, conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "托管前消息", ClientMessageID: "host-disabled-msg-1",
	}); err != nil {
		t.Fatalf("send host message failed: %v", err)
	}

	if _, err := env.service.SetHosting(ctx, host, false); err != nil {
		t.Fatalf("disable hosting failed: %v", err)
	}
	record, ok, err := env.store.GetHosting(ctx, "100004")
	if err != nil || !ok {
		t.Fatalf("取消托管后记录应保留: ok=%v err=%v", ok, err)
	}
	if record.Enabled {
		t.Fatalf("取消托管后应为停用: %+v", record)
	}

	groups, err := env.service.HostedGroups(ctx)
	if err != nil || len(groups) != 1 || len(groups[0].Items) != 1 {
		t.Fatalf("取消托管后仍应显示托管账号: groups=%+v err=%v", groups, err)
	}
	if groups[0].Items[0].Enabled {
		t.Fatalf("取消托管后账号应标记只读: %+v", groups[0].Items[0])
	}
	list, err := env.service.HostedConversations(ctx, "100004")
	if err != nil || len(list) != 1 || list[0].CanSend {
		t.Fatalf("取消托管后会话应保留且只读: list=%+v err=%v", list, err)
	}
	if _, _, _, _, err := env.service.SendHostedMessage(ctx, "100004", conversation.ConversationID, SendRequest{
		MessageType: MessageText, Text: "不应发送", ClientMessageID: "host-disabled-reply-1",
	}); err == nil {
		t.Fatal("取消托管后不应允许继续代发")
	}

	if err := env.service.DeleteHostedOwner(ctx, "100004"); err != nil {
		t.Fatalf("删除托管记录失败: %v", err)
	}
	if _, ok, _ := env.store.GetHosting(ctx, "100004"); ok {
		t.Fatal("手动删除后托管记录应不存在")
	}
}
