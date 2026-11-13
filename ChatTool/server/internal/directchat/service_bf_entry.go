package directchat

import (
	"context"
	"strings"
)

// BFEntryInfo 是游戏客户端消息页看到的官方客服入口状态。
//
// 开关已移到后台「俱乐部管理」，Eligible 恒为 false：旧客户端据此隐藏顶部开关。
// Visible 决定置顶的「官方客服」行是否出现，按账号所属俱乐部逐个判断，任一关闭即隐藏。
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

// BFEntryStatus 返回当前账号的入口可见性。
// 俱乐部级记录优先；没有俱乐部记录时回落到旧版创建者账号记录；都没有则默认显示。
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
		enabled, err := s.bfEntryEnabledForClub(ctx, store, club)
		if err != nil {
			return BFEntryInfo{}, err
		}
		if !enabled {
			info.Enabled = false
			info.Visible = false
			return info, nil
		}
	}
	return info, nil
}

func (s *Service) bfEntryEnabledForClub(ctx context.Context, store BFEntryStore, club Club) (bool, error) {
	record, ok, err := store.GetBFClubEntry(ctx, club.ClubID)
	if err != nil {
		return false, err
	}
	if ok {
		return record.Enabled, nil
	}
	owner := strings.TrimSpace(club.OwnerGuuid)
	if owner == "" {
		return true, nil
	}
	legacy, ok, err := store.GetBFEntry(ctx, owner)
	if err != nil {
		return false, err
	}
	if ok {
		return legacy.Enabled, nil
	}
	return true, nil
}

// SetBFEntry 保留旧版客户端的写入口，但不再允许游戏内设置；开关统一由后台俱乐部管理控制。
func (s *Service) SetBFEntry(ctx context.Context, session Session, enabled bool) (BFEntryInfo, error) {
	return BFEntryInfo{}, errBFEntryForbidden
}
