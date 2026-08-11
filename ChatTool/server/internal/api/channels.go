package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

const defaultChannelCode = "general"

var channelCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
var playerSessionRefPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

type serviceChannel struct {
	Code        string `json:"code"`
	DisplayName string `json:"displayName"`
}

func normalizeChannelCode(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return defaultChannelCode, true
	}
	return value, channelCodePattern.MatchString(value)
}

func (s *Server) loadEnabledChannel(ctx context.Context, code string) (serviceChannel, error) {
	var channel serviceChannel
	err := s.db.QueryRowContext(ctx, `SELECT code,display_name FROM chat_channel WHERE code=? AND enabled=1`, code).Scan(&channel.Code, &channel.DisplayName)
	return channel, err
}

func (s *Server) listEnabledChannels(ctx context.Context) ([]serviceChannel, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT code,display_name FROM chat_channel WHERE enabled=1 ORDER BY sort_order,code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]serviceChannel, 0)
	for rows.Next() {
		var item serviceChannel
		if err := rows.Scan(&item.Code, &item.DisplayName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func playerSessionRefFromRequest(r *http.Request) string {
	value := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Player-Session-Ref")))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sessionRef")))
	}
	if playerSessionRefPattern.MatchString(value) {
		return value
	}
	return ""
}

func playerSessionCookieName(ref string) string {
	if playerSessionRefPattern.MatchString(ref) {
		return playerSessionCookie + "_" + ref
	}
	return playerSessionCookie
}

func playerCSRFCookieName(ref string) string {
	if playerSessionRefPattern.MatchString(ref) {
		return playerCSRFCookie + "_" + ref
	}
	return playerCSRFCookie
}

func (s *Server) conversationChannel(ctx context.Context, conversationID string) (string, error) {
	var channelCode string
	err := s.db.QueryRowContext(ctx, `SELECT channel_code FROM chat_conversation WHERE id=?`, conversationID).Scan(&channelCode)
	return channelCode, err
}

func (s *Server) publishConversationEvent(ctx context.Context, conversationID string, event liveEvent) {
	channelCode, err := s.conversationChannel(ctx, conversationID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger.Warn("conversation channel lookup failed", "conversation_id", conversationID, "error", err)
		}
		return
	}
	s.hub.publish("channel:"+channelCode, event)
}

func (s *Server) publishPlayerMemoChanged(ctx context.Context, playerID string) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT channel_code FROM chat_conversation WHERE player_id=?`, playerID)
	if err != nil {
		s.logger.Warn("player memo channel lookup failed", "error", err)
		return
	}
	defer rows.Close()
	event := liveEvent{Type: "player.memo.changed", Payload: map[string]any{"playerId": playerID}}
	for rows.Next() {
		var channelCode string
		if rows.Scan(&channelCode) == nil {
			s.hub.publish("channel:"+channelCode, event)
		}
	}
}
