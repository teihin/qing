package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type playerMemoItem struct {
	ID            int64     `json:"id"`
	PlayerID      string    `json:"playerId"`
	Content       string    `json:"content"`
	CreatedBy     int64     `json:"createdBy"`
	CreatedByName string    `json:"createdByName"`
	CreatedAt     time.Time `json:"createdAt"`
}

func normalizeMemoPlayerID(value string) (string, bool) {
	value = strings.TrimSpace(value)
	return value, value != "" && len([]rune(value)) <= 64
}

func (s *Server) ensureMemoPlayerAccessible(r *http.Request, p agentPrincipal, playerID string) error {
	var exists int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_player player
WHERE player.player_id=? AND EXISTS (
  SELECT 1 FROM chat_conversation conversation WHERE conversation.player_id=player.player_id AND conversation.channel_code=?
)`, playerID, p.ChannelCode).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Server) handlePlayerMemos(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	playerID, ok := normalizeMemoPlayerID(r.PathValue("playerId"))
	if !ok {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", "玩家ID格式不正确")
		return
	}
	if err := s.ensureMemoPlayerAccessible(r, p, playerID); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "玩家客服资料不存在")
		} else {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取玩家备忘")
		}
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,player_id,content,created_by,created_by_name,created_at
FROM chat_player_memo WHERE player_id=? ORDER BY created_at DESC,id DESC LIMIT 100`, playerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取玩家备忘")
		return
	}
	defer rows.Close()
	items := make([]playerMemoItem, 0)
	for rows.Next() {
		var item playerMemoItem
		if err := rows.Scan(&item.ID, &item.PlayerID, &item.Content, &item.CreatedBy, &item.CreatedByName, &item.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取玩家备忘")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取玩家备忘")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreatePlayerMemo(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	playerID, ok := normalizeMemoPlayerID(r.PathValue("playerId"))
	if !ok {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", "玩家ID格式不正确")
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &req, 8<<10) {
		return
	}
	content, err := requireText(req.Content, 500)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MEMO", "备忘内容不能为空且不能超过500个字符")
		return
	}
	if err := s.ensureMemoPlayerAccessible(r, p, playerID); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "玩家客服资料不存在")
		} else {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法新增玩家备忘")
		}
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO chat_player_memo
(player_id,content,created_by,created_by_name,created_at) VALUES(?,?,?,?,NOW())`, playerID, content, p.ID, p.DisplayName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法新增玩家备忘")
		return
	}
	id, _ := result.LastInsertId()
	item := playerMemoItem{ID: id, PlayerID: playerID, Content: content, CreatedBy: p.ID, CreatedByName: p.DisplayName, CreatedAt: time.Now()}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "player.memo.create", "player", playerID, map[string]any{"memoId": id, "contentLength": len([]rune(content))}, clientIP(r))
	s.publishPlayerMemoChanged(r.Context(), playerID)
	writeData(w, http.StatusCreated, item)
}

func (s *Server) handleDeletePlayerMemo(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	playerID, ok := normalizeMemoPlayerID(r.PathValue("playerId"))
	if !ok {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", "玩家ID格式不正确")
		return
	}
	if err := s.ensureMemoPlayerAccessible(r, p, playerID); err != nil {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "玩家客服资料不存在或无权查看")
		return
	}
	memoID, ok := parseInt64Path(w, r.PathValue("memoId"))
	if !ok {
		return
	}
	result, err := s.db.ExecContext(r.Context(), `DELETE FROM chat_player_memo WHERE id=? AND player_id=?`, memoID, playerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法删除玩家备忘")
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		writeError(w, http.StatusNotFound, "MEMO_NOT_FOUND", "备忘不存在或已经删除")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "player.memo.delete", "player", playerID, map[string]any{"memoId": memoID}, clientIP(r))
	s.publishPlayerMemoChanged(r.Context(), playerID)
	w.WriteHeader(http.StatusNoContent)
}
