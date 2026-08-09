package api

import (
	"net/http"
	"strings"
	"time"
)

type auditItem struct {
	ID            int64     `json:"id"`
	OperatorName  string    `json:"operatorName"`
	Action        string    `json:"action"`
	TargetType    string    `json:"targetType"`
	TargetID      string    `json:"targetId"`
	ResultCode    int       `json:"resultCode"`
	ResultMessage string    `json:"resultMessage"`
	IP            string    `json:"ip"`
	CreatedAt     time.Time `json:"createdAt"`
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request, _ principal) {
	var userCount, enabledUserCount, roleCount, moduleCount, todayAuditCount int64
	err := s.db.QueryRowContext(r.Context(), `SELECT
(SELECT COUNT(*) FROM mgr_user),
(SELECT COUNT(*) FROM mgr_user WHERE status = 'enabled'),
(SELECT COUNT(*) FROM mgr_role WHERE status = 'enabled'),
(SELECT COUNT(*) FROM mgr_module WHERE status = 'enabled'),
(SELECT COUNT(*) FROM mgr_audit_log WHERE created_at >= CURDATE())`).Scan(
		&userCount, &enabledUserCount, &roleCount, &moduleCount, &todayAuditCount,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取工作台数据失败")
		return
	}
	recent, err := s.queryAudits(r, "", 1, 8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取最近操作失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"userCount": userCount, "enabledUserCount": enabledUserCount,
		"roleCount": roleCount, "moduleCount": moduleCount, "todayAuditCount": todayAuditCount,
		"recentAudits": recent,
	})
}

func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	like := "%" + keyword + "%"
	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_audit_log
WHERE (? = '' OR operator_name LIKE ? OR action LIKE ? OR target_id LIKE ?)`, keyword, like, like, like).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取审计数量失败")
		return
	}
	items, err := s.queryAudits(r, keyword, page, size)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取审计记录失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func (s *Server) queryAudits(r *http.Request, keyword string, page, size int) ([]auditItem, error) {
	like := "%" + keyword + "%"
	rows, err := s.db.QueryContext(r.Context(), `SELECT
id, operator_name, action, target_type, target_id, result_code, result_message, ip, created_at
FROM mgr_audit_log
WHERE (? = '' OR operator_name LIKE ? OR action LIKE ? OR target_id LIKE ?)
ORDER BY id DESC LIMIT ? OFFSET ?`, keyword, like, like, like, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []auditItem{}
	for rows.Next() {
		var item auditItem
		if err := rows.Scan(&item.ID, &item.OperatorName, &item.Action, &item.TargetType, &item.TargetID,
			&item.ResultCode, &item.ResultMessage, &item.IP, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
