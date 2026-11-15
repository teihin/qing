package directchat

import (
	"context"
	"testing"
)

// BF 入口：开关已移到后台俱乐部管理，默认关闭，只有后台显式开启的俱乐部可见。
// 俱乐部级开关优先，旧版创建者账号开关只作为历史数据回退。
func TestBFEntryVisibilityByClub(t *testing.T) {
	env := newDevEnv(t)
	ctx := context.Background()

	// 没有任何记录时默认关闭：群主、普通成员和无俱乐部账号都看不到入口。
	for _, guuid := range []string{"100004", "100001"} {
		status, err := env.service.BFEntryStatus(ctx, env.session(t, guuid))
		if err != nil {
			t.Fatalf("status of %s failed: %v", guuid, err)
		}
		if status.Eligible || status.Enabled || status.Visible {
			t.Fatalf("默认应关闭入口且不提供客户端开关: %+v", status)
		}
	}
	outsider := env.addSession(t, "100008", "无俱乐部玩家")
	status, err := env.service.BFEntryStatus(ctx, outsider)
	if err != nil {
		t.Fatalf("outsider status failed: %v", err)
	}
	if status.Eligible || status.Enabled || status.Visible {
		t.Fatalf("无俱乐部账号应默认关闭且无开关: %+v", status)
	}

	if _, err := env.service.SetBFEntry(ctx, env.session(t, "100004"), true); err == nil {
		t.Fatal("客户端不应再能设置 BF 入口开关")
	}

	env.store.members["222222"]["100009"] = Member{Guuid: "100009", Name: "俱乐部二玩家", Role: RoleMember}
	onlyClubTwo := env.addSession(t, "100009", "俱乐部二玩家")

	// 后台开启两个俱乐部：所有成员都能看到；群主同时在两个俱乐部，需要都开启。
	env.store.bfClubEntries["111111"] = true
	env.store.bfClubEntries["222222"] = true
	for _, guuid := range []string{"100001", "100002", "100003", "100004", "100005"} {
		status, err = env.service.BFEntryStatus(ctx, env.session(t, guuid))
		if err != nil {
			t.Fatalf("member %s status failed: %v", guuid, err)
		}
		if !status.Enabled || !status.Visible {
			t.Fatalf("俱乐部开启后成员 %s 应看到 BF 入口: %+v", guuid, status)
		}
	}

	// 只关俱乐部一：俱乐部一的成员隐藏，只属于俱乐部二的账号不受影响。
	env.store.bfClubEntries["111111"] = false
	for _, guuid := range []string{"100001", "100002", "100004"} {
		status, err = env.service.BFEntryStatus(ctx, env.session(t, guuid))
		if err != nil {
			t.Fatalf("member %s status failed: %v", guuid, err)
		}
		if status.Visible {
			t.Fatalf("俱乐部关闭后成员 %s 不应再看到 BF 入口: %+v", guuid, status)
		}
	}
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("club two member status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("另一个俱乐部不应受影响: %+v", status)
	}

	// 没有俱乐部级记录时回退到旧版创建者记录：开启可见。
	delete(env.store.bfClubEntries, "222222")
	env.store.bfEntries["100004"] = true
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("legacy fallback status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("没有俱乐部记录时应回退到旧版创建者开启: %+v", status)
	}

	// 旧版创建者记录关闭时同样隐藏。
	env.store.bfEntries["100004"] = false
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("legacy fallback status failed: %v", err)
	}
	if status.Visible {
		t.Fatalf("旧版创建者关闭时不应显示: %+v", status)
	}

	// 俱乐部级记录优先：显式开启后即使旧版创建者记录是关闭也显示。
	env.store.bfClubEntries["222222"] = true
	status, err = env.service.BFEntryStatus(ctx, onlyClubTwo)
	if err != nil {
		t.Fatalf("club level override status failed: %v", err)
	}
	if !status.Visible {
		t.Fatalf("俱乐部级开启应覆盖旧版创建者关闭: %+v", status)
	}
}
