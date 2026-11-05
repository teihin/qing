package api

import (
	"context"
	"strconv"
	"strings"
)

const avatarCount = 100

// avatarIndex 与客户端 ImageManager 一致：只接受 1~100 的序号，其他回退头像 1。
func avatarIndex(value string) int {
	text := strings.TrimSpace(value)
	index, err := strconv.Atoi(text)
	if err != nil || index < 1 || index > avatarCount {
		return 1
	}
	return index
}

func (s *Server) avatarURLFromIndex(value string) string {
	index := avatarIndex(value)
	base := strings.TrimRight(strings.TrimSpace(s.cfg.PublicBaseURL), "/")
	name := "/avatars/avatar" + leftPad2(index) + ".png"
	if base == "" {
		return name
	}
	return base + name
}

func leftPad2(value int) string {
	if value < 10 {
		return "0" + strconv.Itoa(value)
	}
	return strconv.Itoa(value)
}

// playerAvatarURLs 从游戏库 sm_photo 批量读取玩家头像序号，供客服工作台显示与客户端一致的头像。
func (s *Server) playerAvatarURLs(ctx context.Context, playerIDs []string) map[string]string {
	result := map[string]string{}
	if s.gameDB == nil || len(playerIDs) == 0 {
		return result
	}
	seen := map[string]bool{}
	args := make([]any, 0, len(playerIDs))
	for _, id := range playerIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		args = append(args, id)
	}
	if len(args) == 0 {
		return result
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")
	rows, err := s.gameDB.QueryContext(ctx, `SELECT sm_guuid, COALESCE(sm_photo,'') FROM tbl_Account
WHERE sm_guuid IN (`+placeholders+`)`, args...)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var guuid, photo string
		if err := rows.Scan(&guuid, &photo); err != nil {
			continue
		}
		result[guuid] = s.avatarURLFromIndex(photo)
	}
	return result
}

func (s *Server) playerAvatarURL(ctx context.Context, playerID, fallback string) string {
	avatars := s.playerAvatarURLs(ctx, []string{playerID})
	if url, ok := avatars[strings.TrimSpace(playerID)]; ok {
		return url
	}
	return fallback
}
