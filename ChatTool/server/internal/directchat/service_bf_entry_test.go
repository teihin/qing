package directchat

import (
	"context"
	"testing"
)

// BF 入口开关：创建者能看到顶部开关并控制自己俱乐部的入口；
// 俱乐部内所有层级的成员跟随创建者的开关，俱乐部外账号不受影响。
func TestBFEntryVisibility(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()

	owner := env.session(t, "100004")
	status, err := env.service.BFEntryStatus(ctx, owner)
	if err != nil {
		t.Fatalf("owner status failed: %v", err)
	}
	if !status.Eligible || !status.Enabled || !status.Visible {
		t.Fatalf("创建者默认应有开关且显示入口: %+v", status)
	}

	member := env.session(t, "100001")
	status, err = env.service.BFEntryStatus(ctx, member)
	if err != nil {
		t.Fatalf("member status failed: %v", err)
	}
	if status.Eligible || !status.Visible {
		t.Fatalf("普通成员默认可见但没有开关资格: %+v", status)
	}
	if _, err := env.service.SetBFEntry(ctx, member, false); err == nil {
		t.Fatal("普通成员不应能设置 BF 入口开关")
	}

	closed, err := env.service.SetBFEntry(ctx, owner, false)
	if err != nil {
		t.Fatalf("close BF entry failed: %v", err)
	}
	if closed.Enabled || closed.Visible {
		t.Fatalf("关闭后创建者自己也应隐藏: %+v", closed)
	}
	for _, guuid := range []string{"100001", "100002", "100003", "100005"} {
		status, err = env.service.BFEntryStatus(ctx, env.session(t, guuid))
		if err != nil {
			t.Fatalf("member %s status failed: %v", guuid, err)
		}
		if status.Visible {
			t.Fatalf("创建者关闭后成员 %s 不应再看到 BF 入口: %+v", guuid, status)
		}
	}

	// 另一个创建者不受影响。
	other := env.addSession(t, "100006", "另一个群主")
	env.store.addClub("333333", "另一个俱乐部", "100006",
		Member{Guuid: "100007", Name: "另一个玩家", Role: RoleMember})
	if _, err := env.service.SetBFEntry(ctx, other, true); err != nil {
		t.Fatalf("other owner set failed: %v", err)
	}
	otherMember := env.addSession(t, "100007", "另一个玩家")
	status, err = env.service.BFEntryStatus(ctx, otherMember)
	if err != nil {
		t.Fatalf("other member status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("其他创建者的俱乐部不应受影响: %+v", status)
	}

	// 没有俱乐部的账号保持默认显示，也没有开关资格。
	outsider := env.addSession(t, "100008", "无俱乐部玩家")
	status, err = env.service.BFEntryStatus(ctx, outsider)
	if err != nil {
		t.Fatalf("outsider status failed: %v", err)
	}
	if status.Eligible || !status.Visible {
		t.Fatalf("无俱乐部账号应默认显示且无开关: %+v", status)
	}

	// 重新打开后，创建者和下属都恢复显示。
	if _, err := env.service.SetBFEntry(ctx, owner, true); err != nil {
		t.Fatalf("reopen BF entry failed: %v", err)
	}
	status, err = env.service.BFEntryStatus(ctx, member)
	if err != nil {
		t.Fatalf("member status after reopen failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("重新打开后成员应恢复显示: %+v", status)
	}
}
