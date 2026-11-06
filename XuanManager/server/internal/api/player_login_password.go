package api

import (
	"context"
	"strings"

	"xuanmanager/internal/security"
)

// 玩家登录密码的明文副本。
//
// 游戏端只在 third_marketing_info.player_wxpwd 和 tbl_Account.sm_userPWD 里保存 MD5，
// 摘要是单向的、无法还原。所以 XuanManager 在**确实拿到明文**的三个入口把明文用
// XUAN_CREDENTIAL_KEY 加密后单独存一份，只服务于后台「玩家管理」的管理员查看：
//   - 客户端注册（POST /api/game/registrations）
//   - 后台重置玩家密码（POST /api/game/players/{id}/password）
//   - 玩家自助改登录密码（POST /api/game/change-login-password）
//
// 没有收录的历史账号（改密发生在本功能上线之前，或密码在游戏端内部被改过）返回空，
// 前端显示「未收录」，不猜测、不回退成 MD5 摘要。

const (
	playerPasswordSourceRegistration = "registration"
	playerPasswordSourceAdminReset   = "admin_reset"
	playerPasswordSourceSelfService  = "self_service"
	playerPasswordSourceRecovered    = "recovered"
)

func normalizeLoginNameKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// savePlayerLoginPassword 写入或覆盖明文副本；密码为空时不做任何事。
// 调用方只记录错误，不能因为收录失败而影响注册/改密本身。
func (s *Server) savePlayerLoginPassword(ctx context.Context, loginName, plaintext, source string) error {
	loginName = normalizeLoginNameKey(loginName)
	if loginName == "" || plaintext == "" {
		return nil
	}
	sealed, err := security.SealCredential(s.credentialKey(), plaintext)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO mgr_player_login_password
(player_wxid, sealed_password, source, updated_at)
VALUES (?, ?, ?, NOW())
ON DUPLICATE KEY UPDATE sealed_password = VALUES(sealed_password),
source = VALUES(source), updated_at = NOW()`, loginName, sealed, source)
	return err
}

// attachPlayerLoginPasswords 给当前页玩家补上明文密码（没有收录的保持空）。
func (s *Server) attachPlayerLoginPasswords(ctx context.Context, items []playerItem) error {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.LoginName)
	}
	passwords, err := s.loadPlayerLoginPasswords(ctx, names)
	if err != nil {
		return err
	}
	for index := range items {
		plain, ok := passwords[normalizeLoginNameKey(items[index].LoginName)]
		if !ok || plain == "" {
			continue
		}
		items[index].LoginPassword = plain
		items[index].PasswordRecorded = true
	}
	return nil
}

// loadPlayerLoginPasswords 批量读取并解密，返回小写登录账号到明文密码的映射。
// 单条密文解不开时只记日志并跳过，不影响其余玩家。
func (s *Server) loadPlayerLoginPasswords(ctx context.Context, loginNames []string) (map[string]string, error) {
	passwords := make(map[string]string, len(loginNames))
	placeholders := make([]string, 0, len(loginNames))
	args := make([]any, 0, len(loginNames))
	seen := make(map[string]struct{}, len(loginNames))
	for _, name := range loginNames {
		key := normalizeLoginNameKey(name)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		placeholders = append(placeholders, "?")
		args = append(args, key)
	}
	if len(args) == 0 {
		return passwords, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT player_wxid, sealed_password
FROM mgr_player_login_password WHERE player_wxid IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	key := s.credentialKey()
	for rows.Next() {
		var loginName, sealed string
		if err := rows.Scan(&loginName, &sealed); err != nil {
			return nil, err
		}
		plain, err := security.OpenCredential(key, sealed)
		if err != nil {
			s.logger.Error("open player login password", "error", err, "loginName", loginName)
			continue
		}
		passwords[normalizeLoginNameKey(loginName)] = plain
	}
	return passwords, rows.Err()
}
