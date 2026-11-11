package directchat

import (
	"context"
	"strings"
)

// BFEntryInfo 是游戏客户端消息页看到的官方客服入口状态。
//
// Eligible 只对俱乐部创建者（大盟主/盟主/未入盟群主）为 true，客户端据此
// 显示顶部开关；Visible 决定置顶的「官方客服」行是否出现，创建者自己也遵循它。
type BFEntryInfo struct {
	Eligible bool   `json:"eligible"`
	Enabled  bool   `json:"enabled"`
	Visible  bool   `json:"visible"`
	Message  string `json:"message,omitempty"`
}

func (s *Service) bfEntryStore() (BFEntryStore, error) {
	store, ok := s.store.(BFEntryStore)
	if !ok {
		return nil, newError(500, "INTERNAL_ERROR", "BF 入口开关存储未启用")
	}
	return store, nil
}

// BFEntryStatus 返回当前账号的开关资格、开关状态和入口可见性。
// 创建者读自己的记录；其他成员按所属俱乐部创建者的记录判断，任一关闭即隐藏。
func (s *Service) BFEntryStatus(ctx context.Context, session Session) (BFEntryInfo, error) {
	clubs, err := s.directory.ListMyClubs(ctx, session.Guuid)
	if err != nil {
		return BFEntryInfo{}, relationUnavailable(err)
	}
	store, err := s.bfEntryStore()
	if err != nil {
		return BFEntryInfo{}, err
	}
	info := BFEntryInfo{Enabled: true, Visible: true}
	for _, club := range clubs {
		if strings.TrimSpace(club.OwnerGuuid) != strings.TrimSpace(session.Guuid) {
			continue
		}
		info.Eligible = true
		record, ok, err := store.GetBFEntry(ctx, session.Guuid)
		if err != nil {
			return BFEntryInfo{}, err
		}
		if ok {
			info.Enabled = record.Enabled
		}
		info.Visible = info.Enabled
		return info, nil
	}
	// 非创建者：看自己所属各俱乐部创建者的开关。没有加入俱乐部时保持默认显示。
	for _, club := range clubs {
		owner := strings.TrimSpace(club.OwnerGuuid)
		if owner == "" {
			continue
		}
		record, ok, err := store.GetBFEntry(ctx, owner)
		if err != nil {
			return BFEntryInfo{}, err
		}
		if ok && !record.Enabled {
			info.Visible = false
			info.Enabled = false
			return info, nil
		}
	}
	return info, nil
}

// SetBFEntry 开启或关闭当前账号的 BF 入口；只有俱乐部创建者可以设置。
func (s *Service) SetBFEntry(ctx context.Context, session Session, enabled bool) (BFEntryInfo, error) {
	clubs, err := s.directory.ListMyClubs(ctx, session.Guuid)
	if err != nil {
		return BFEntryInfo{}, relationUnavailable(err)
	}
	eligible := false
	for _, club := range clubs {
		if strings.TrimSpace(club.OwnerGuuid) == strings.TrimSpace(session.Guuid) {
			eligible = true
			break
		}
	}
	if !eligible {
		return BFEntryInfo{}, errBFEntryForbidden
	}
	store, err := s.bfEntryStore()
	if err != nil {
		return BFEntryInfo{}, err
	}
	if err := store.SaveBFEntry(ctx, session.Guuid, enabled); err != nil {
		return BFEntryInfo{}, err
	}
	return BFEntryInfo{Eligible: true, Enabled: enabled, Visible: enabled}, nil
}
