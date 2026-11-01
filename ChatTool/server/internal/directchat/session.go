package directchat

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// HashToken 计算会话令牌的存储摘要；数据库只保存摘要。
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// SaveSession 写入新的聊天会话。
func (s *SQLStore) SaveSession(ctx context.Context, session Session) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_session
(token_hash, guuid, name, avatar, expires_at, created_at, last_seen_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`, session.TokenHash, session.Guuid, session.Name, session.Avatar,
		session.ExpiresAt, session.CreatedAt, session.LastSeenAt)
	return err
}

// LoadSession 读取未过期的聊天会话。
func (s *SQLStore) LoadSession(ctx context.Context, tokenHash string) (Session, bool, error) {
	var session Session
	err := s.db.QueryRowContext(ctx, `SELECT token_hash, guuid, name, avatar, expires_at, created_at, last_seen_at
FROM chat_direct_session WHERE token_hash = ? AND expires_at > ?`, tokenHash, time.Now()).
		Scan(&session.TokenHash, &session.Guuid, &session.Name, &session.Avatar,
			&session.ExpiresAt, &session.CreatedAt, &session.LastSeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	return session, true, nil
}

// TouchSession 刷新最近活跃时间（失败不影响业务）。
func (s *SQLStore) TouchSession(ctx context.Context, tokenHash string) {
	_, _ = s.db.ExecContext(ctx, `UPDATE chat_direct_session SET last_seen_at = ? WHERE token_hash = ?`,
		time.Now(), tokenHash)
}

// DeleteSession 注销会话。
func (s *SQLStore) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_session WHERE token_hash = ?`, tokenHash)
	return err
}

// UpdateProfile 在票据带来新昵称/头像时同步会话资料。
func (s *SQLStore) UpdateProfile(ctx context.Context, tokenHash, name, avatar string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE chat_direct_session SET name = ?, avatar = ? WHERE token_hash = ?`,
		name, avatar, tokenHash)
	return err
}
