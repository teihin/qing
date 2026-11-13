package directchat

import (
	"context"
	"testing"
)

// BF 入口：开关已移到后台俱乐部管理，客户端只读可见性。
// 俱乐部级开关优先，旧版创建者账号开关只作为历史数据回退。
func TestBFEntryVisibilityByClub(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()

	owner := env.session(t, "100004")
	status, err := env.service.BFEntryStatus(ctx, owner)
	if err != nil {
		t.Fatalf("owner status failed: %v", err)
	}
	if status.Eligible || !status.Enabled || !status.Visible {
		t.Fatalf("默认应显示入口且不再提供客户端开关: %+v", status)
	}

	member := env.session(t, "100001")
	status, err = env.service.BFEntryStatus(ctx, member)
	if err != nil {
		t.Fatalf("member status failed: %v", err)
	}
	if status.Eligible || !status.Visible {
		t.Fatalf("普通成员默认可见且没有开关资格: %+v", status)
	}
	if _, err := env.service.SetBFEntry(ctx, owner, false); err == nil {
		t.Fatal("客户端不应再能设置 BF 入口开关")
	}

	// 后台关闭俱乐部一：该俱乐部所有层级都隐藏。
	env.store.bfClubEntries["111111"] = false
	for _, guuid := range []string{"100001", "100002", "100003", "100004", "100005"} {
		status, err = env.service.BFEntryStatus(ctx, env.session(t, guuid))
		if err != nil {
			t.Fatalf("member %s status failed: %v", guuid, err)
		}
		if status.Visible {
			t.Fatalf("俱乐部关闭后成员 %s 不应再看到 BF 入口: %+v", guuid, status)
		}
	}

	// 只在俱乐部二的账号不受俱乐部一影响。
	env.store.members["222222"]["100009"] = Member{Guuid: "100009", Name: "俱乐部二玩家", Role: RoleMember}
	onlyClubTwo := env.addSession(t, "100009", "俱乐部二玩家")
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("club two member status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("另一个俱乐部不应受影响: %+v", status)
	}

	// 俱乐部级记录优先：显式开启后即使旧版创建者记录是关闭也显示。
	env.store.bfClubEntries["111111"] = true
	env.store.bfEntries["100004"] = false
	env.store.members["111111"]["100010"] = Member{Guuid: "100010", Name: "俱乐部一玩家", Role: RoleMember}
	onlyClubOne := env.addSession(t, "100010", "俱乐部一玩家")
	status, err = env.service.BFEntryStatus(ctx, onlyClubOne)
	if err != nil {
		t.Fatalf("club one member status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("俱乐部级开启应覆盖旧版创建者关闭: %+v", status)
	}

	// 没有俱乐部级记录时回退到旧版创建者记录。
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("legacy fallback status failed: %v", err)
	}
	if status.Visible {
		t.Fatalf("没有俱乐部记录时应回退到旧版创建者关闭: %+v", status)
	}

	// 同时属于两个俱乐部：任一关闭即隐藏。
	status, err = env.service.BFEntryStatus(ctx, member)
	if err != nil {
		t.Fatalf("multi-club member status failed: %v", err)
	}
	if status.Visible {
		t.Fatalf("任一所属俱乐部关闭即应隐藏: %+v", status)
	}

	// 没有俱乐部的账号保持默认显示，也没有开关。
	outsider := env.addSession(t, "100008", "无俱乐部玩家")
	status, err = env.service.BFEntryStatus(ctx, outsider)
	if err != nil {
		t.Fatalf("outsider status failed: %v", err)
	}
	if status.Eligible || !status.Visible {
		t.Fatalf("无俱乐部账号应默认显示且无开关: %+v", status)
	}
}
