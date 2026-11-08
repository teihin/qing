package directchat

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
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

// 托管代发图片：以托管账号身份落库成图片消息，非图片内容与已取消托管都要拒绝。
func TestHostedSendImage(t *testing.T) {
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
	raw := bytes.NewBuffer(nil)
	if err := jpeg.Encode(raw, image.NewRGBA(image.Rect(0, 0, 8, 6)), nil); err != nil {
		t.Fatalf("encode image failed: %v", err)
	}
	view, recipient, clubID, err := env.service.SendHostedImage(ctx, "100004", conversation.ConversationID, raw.Bytes())
	if err != nil {
		t.Fatalf("hosted image failed: %v", err)
	}
	if view.MessageType != MessageImage || view.SenderGuuid != "100004" || view.Attachment == nil || view.Attachment.URL == "" {
		t.Fatalf("托管图片应以托管账号身份落库: %+v", view)
	}
	if recipient != "100001" || clubID != "111111" {
		t.Fatalf("代发图片应返回接收方与俱乐部: recipient=%s club=%s", recipient, clubID)
	}
	after, err := env.service.HostedMessages(ctx, "100004", conversation.ConversationID, "", "", 20)
	if err != nil {
		t.Fatalf("hosted messages failed: %v", err)
	}
	if len(after.Items) != 1 || after.Items[0].MessageType != MessageImage {
		t.Fatalf("托管图片未出现在历史中: %+v", after.Items)
	}
	// 非图片内容不能借上传通道变成聊天图片。
	if _, _, _, err := env.service.SendHostedImage(ctx, "100004", conversation.ConversationID, []byte("<svg/>")); AsError(err).Code != CodeMediaInvalid {
		t.Fatalf("非图片内容应被拒绝: %v", err)
	}
	// 取消托管后不能继续代发图片。
	if _, err := env.service.SetHosting(ctx, host, false); err != nil {
		t.Fatalf("disable hosting failed: %v", err)
	}
	if _, _, _, err := env.service.SendHostedImage(ctx, "100004", conversation.ConversationID, raw.Bytes()); AsError(err).Code != CodeHostingInactive {
		t.Fatalf("取消托管后不应允许代发图片: %v", err)
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

// 托管展示偏好：备注名称按玩家共享、置顶排最前、单条会话可永久删除。
func TestHostedRemarkPinAndDeleteConversation(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	host := env.session(t, "100004")
	if _, err := env.service.SetHosting(ctx, host, true); err != nil {
		t.Fatalf("enable hosting failed: %v", err)
	}
	first, err := env.service.CreateConversation(ctx, host, "111111", "100001")
	if err != nil {
		t.Fatalf("create conversation failed: %v", err)
	}
	second, err := env.service.CreateConversation(ctx, host, "111111", "100002")
	if err != nil {
		t.Fatalf("create second conversation failed: %v", err)
	}
	for _, item := range []struct{ id, text, clientID string }{
		{first.ConversationID, "玩家一消息", "prefs-1"},
		{second.ConversationID, "玩家二消息", "prefs-2"},
	} {
		if _, _, err := env.service.SendMessage(ctx, host, item.id, SendRequest{
			MessageType: MessageText, Text: item.text, ClientMessageID: item.clientID,
		}); err != nil {
			t.Fatalf("seed message failed: %v", err)
		}
	}

	// 备注会去掉换行与多余空白，并按玩家共享（换会话仍能看到）。
	remark, peerGuuid, err := env.service.SetHostedRemark(ctx, "100004", first.ConversationID,
		" 老客户\n张三 ", 1, "客服甲")
	if err != nil {
		t.Fatalf("set remark failed: %v", err)
	}
	if remark != "老客户 张三" || peerGuuid != "100001" {
		t.Fatalf("备注归一化或玩家归属不正确: remark=%q peer=%q", remark, peerGuuid)
	}
	if _, _, err := env.service.SetHostedRemark(ctx, "100004", first.ConversationID,
		"一二三四五六七八九十一二三四五六七八九十一", 1, "客服甲"); err == nil {
		t.Fatal("超过20个字的备注应被拒绝")
	}

	list, err := env.service.HostedConversations(ctx, "100004")
	if err != nil || len(list) != 2 {
		t.Fatalf("hosted conversations failed: %+v err=%v", list, err)
	}
	// 置顶玩家一，即使玩家二的消息更新，也必须排在最前。
	if _, err := env.service.SetHostedPin(ctx, "100004", first.ConversationID, true, 1, "客服甲"); err != nil {
		t.Fatalf("pin failed: %v", err)
	}
	if _, _, err := env.service.SendMessage(ctx, host, second.ConversationID, SendRequest{
		MessageType: MessageText, Text: "更新的消息", ClientMessageID: "prefs-3",
	}); err != nil {
		t.Fatalf("send newer message failed: %v", err)
	}
	list, err = env.service.HostedConversations(ctx, "100004")
	if err != nil || len(list) != 2 {
		t.Fatalf("hosted conversations after pin failed: %+v err=%v", list, err)
	}
	if !list[0].Pinned || list[0].ConversationID != first.ConversationID || list[0].Remark != "老客户 张三" {
		t.Fatalf("置顶会话应排最前并带备注: %+v", list)
	}
	if list[1].Pinned || list[1].Remark != "" {
		t.Fatalf("未置顶会话不应带置顶/备注: %+v", list[1])
	}

	// 取消置顶后恢复按最后消息时间倒序。
	if _, err := env.service.SetHostedPin(ctx, "100004", first.ConversationID, false, 1, "客服甲"); err != nil {
		t.Fatalf("unpin failed: %v", err)
	}
	list, err = env.service.HostedConversations(ctx, "100004")
	if err != nil || len(list) != 2 || list[0].ConversationID != second.ConversationID {
		t.Fatalf("取消置顶后应按最新消息排序: %+v err=%v", list, err)
	}

	// 删除单条会话：消息与对面入口一起消失，重复删除返回不存在。
	if _, err := env.service.DeleteHostedConversation(ctx, "100004", first.ConversationID); err != nil {
		t.Fatalf("delete hosted conversation failed: %v", err)
	}
	list, err = env.service.HostedConversations(ctx, "100004")
	if err != nil || len(list) != 1 || list[0].ConversationID != second.ConversationID {
		t.Fatalf("删除后列表应只剩一条: %+v err=%v", list, err)
	}
	if _, err := env.service.DeleteHostedConversation(ctx, "100004", first.ConversationID); AsError(err).Code != "CONVERSATION_NOT_FOUND" {
		t.Fatalf("重复删除应返回会话不存在: %v", err)
	}
	// 别的托管账号不能删除不属于自己的会话。
	if _, err := env.service.DeleteHostedConversation(ctx, "100004", "not-mine"); err == nil {
		t.Fatal("不存在/不属于该托管账号的会话应被拒绝")
	}
}

// 置顶支持三级：分组（联盟/俱乐部）、托管账号（盟主/群主）、会话。
// 分组置顶把整个俱乐部顶到列表最前，账号置顶把该盟主顶到组内最前。
func TestHostedTargetPins(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()
	env.store.addUnion("111111", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	env.store.addClub("333333", "盟主俱乐部", "100003", Member{Guuid: "100001", Name: "玩家一", Role: RoleMember})
	env.store.addUnion("333333", Union{ID: "union-1", Name: "测试联盟", OwnerGuuid: "100004", OwnerClub: "111111"})
	env.store.addClub("444444", "普通俱乐部", "100005")

	for _, guuid := range []string{"100004", "100003", "100005"} {
		if _, err := env.service.SetHosting(ctx, env.session(t, guuid), true); err != nil {
			t.Fatalf("enable hosting %s failed: %v", guuid, err)
		}
	}

	groups, err := env.service.HostedGroups(ctx)
	if err != nil {
		t.Fatalf("hosted groups failed: %v", err)
	}
	if len(groups) != 3 || groups[0].Type != HostingGroupUnion {
		t.Fatalf("初始应为联盟在前的三个分组: %+v", groups)
	}

	// 置顶最后一个分组，应顶到最前。
	lastKey := groups[len(groups)-1].Key
	if _, _, err := env.service.SetHostedTargetPin(ctx, HostedPinGroup, lastKey, "", true, 1, "客服甲"); err != nil {
		t.Fatalf("置顶分组失败: %v", err)
	}
	groups, err = env.service.HostedGroups(ctx)
	if err != nil {
		t.Fatalf("hosted groups after group pin failed: %v", err)
	}
	if groups[0].Key != lastKey || !groups[0].Pinned {
		t.Fatalf("置顶分组应排最前: key=%s first=%s pinned=%v", lastKey, groups[0].Key, groups[0].Pinned)
	}

	// 同一分组内把后面的托管账号顶上来。
	group := groups[0]
	if len(group.Items) < 1 {
		t.Fatalf("分组内应有托管账号: %+v", group)
	}
	target := group.Items[len(group.Items)-1].Guuid
	if _, _, err := env.service.SetHostedTargetPin(ctx, HostedPinOwner, target, "", true, 1, "客服甲"); err != nil {
		t.Fatalf("置顶托管账号失败: %v", err)
	}
	groups, err = env.service.HostedGroups(ctx)
	if err != nil {
		t.Fatalf("hosted groups after owner pin failed: %v", err)
	}
	if groups[0].Key != lastKey {
		t.Fatalf("分组置顶应保持: %+v", groups)
	}
	if groups[0].Items[0].Guuid != target || !groups[0].Items[0].Pinned {
		t.Fatalf("置顶的托管账号应排组内最前: target=%s first=%s", target, groups[0].Items[0].Guuid)
	}

	// 取消分组置顶后恢复联盟在前。
	if _, _, err := env.service.SetHostedTargetPin(ctx, HostedPinGroup, lastKey, "", false, 1, "客服甲"); err != nil {
		t.Fatalf("取消置顶分组失败: %v", err)
	}
	groups, err = env.service.HostedGroups(ctx)
	if err != nil {
		t.Fatalf("hosted groups after unpin failed: %v", err)
	}
	if groups[0].Type != HostingGroupUnion || groups[0].Pinned {
		t.Fatalf("取消置顶后应恢复联盟在前: %+v", groups[0])
	}

	// 不存在的分组要被拒绝。
	if _, _, err := env.service.SetHostedTargetPin(ctx, HostedPinGroup, "club:999999", "", true, 1, "客服甲"); err == nil {
		t.Fatal("不存在的分组应拒绝置顶")
	}
}
