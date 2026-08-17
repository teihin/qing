package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-sql-driver/mysql"
	"xuanmanager/internal/security"
)

type createUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	RoleID      int64  `json:"roleId"`
	Status      string `json:"status"`
}

type updateUserRequest struct {
	DisplayName string `json:"displayName"`
	RoleID      int64  `json:"roleId"`
}

type statusRequest struct {
	Status string `json:"status"`
}

type passwordRequest struct {
	Password string `json:"password"`
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	like := "%" + keyword + "%"
	canSeeSuper := canSeeProtectedRootFlag(p)
	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_user u
WHERE (? = 1 OR u.username <> 'admin999')
  AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ?)`, canSeeSuper, keyword, like, like).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取用户数量失败")
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT
u.id, u.username, u.display_name, u.role_id, r.code, r.name,
(u.is_super = 1 OR r.code = 'super_admin'), u.status,
DATE_ADD(u.last_login_at, INTERVAL 8 HOUR), DATE_ADD(u.created_at, INTERVAL 8 HOUR)
FROM mgr_user u JOIN mgr_role r ON r.id = u.role_id
WHERE (? = 1 OR u.username <> 'admin999')
  AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ?)
ORDER BY (u.is_super = 1 OR r.code = 'super_admin') DESC, u.id DESC LIMIT ? OFFSET ?`, canSeeSuper, keyword, like, like, size, (page-1)*size)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取用户列表失败")
		return
	}
	defer rows.Close()
	items := make([]userItem, 0)
	for rows.Next() {
		var item userItem
		if err := rows.Scan(&item.ID, &item.Username, &item.DisplayName, &item.RoleID, &item.RoleCode, &item.RoleName,
			&item.IsSuper, &item.Status, &item.LastLoginAt, &item.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取用户数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func (s *Server) handleRoleOptions(w http.ResponseWriter, r *http.Request, p principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, code, name, description, status, is_system,
(SELECT COUNT(*) FROM mgr_user u WHERE u.role_id = mgr_role.id
 AND (? = 1 OR u.username <> 'admin999'))
FROM mgr_role
WHERE status = 'enabled' AND (? = 1 OR code <> 'super_admin')
ORDER BY is_system DESC, id`, canSeeProtectedRootFlag(p), booleanFlag(p.IsSuper))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取可用角色失败")
		return
	}
	defer rows.Close()
	items := []roleItem{}
	for rows.Next() {
		var item roleItem
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Description, &item.Status, &item.IsSystem, &item.UserCount); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取可用角色失败")
			return
		}
		item.PermissionIDs = []int64{}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request, p principal) {
	var input createUserRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.Status == "" {
		input.Status = "enabled"
	}
	if err := security.ValidateUsername(input.Username); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_USERNAME", err.Error())
		return
	}
	if input.DisplayName == "" || len([]rune(input.DisplayName)) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "显示名称不能为空且不能超过 64 个字符")
		return
	}
	if !validStatus(input.Status) {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "用户状态不正确")
		return
	}
	roleAvailable, roleIsSuper := s.roleState(r, input.RoleID)
	if !roleAvailable {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", "所选角色不存在或已停用")
		return
	}
	if roleIsSuper && !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ROLE_PROTECTED", "只有超级管理员可以分配超级管理员角色")
		return
	}
	hash, err := security.HashPassword(input.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_user
(username, password_hash, display_name, role_id, is_super, status, created_by)
VALUES (?, ?, ?, ?, 0, ?, ?)`, input.Username, hash, input.DisplayName, input.RoleID, input.Status, p.ID)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "USERNAME_EXISTS", "该后台账号已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建用户失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "user.create", "mgr_user", numericID(id),
		map[string]any{"username": input.Username, "displayName": input.DisplayName, "roleId": input.RoleID, "status": input.Status},
		nil, map[string]any{"id": id, "username": input.Username}, 0, "创建成功", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "用户创建成功"})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input updateUserRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.DisplayName == "" || len([]rune(input.DisplayName)) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "显示名称不能为空且不能超过 64 个字符")
		return
	}
	roleAvailable, targetRoleIsSuper := s.roleState(r, input.RoleID)
	if !roleAvailable {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", "所选角色不存在或已停用")
		return
	}
	if targetRoleIsSuper && !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ROLE_PROTECTED", "只有超级管理员可以分配超级管理员角色")
		return
	}
	var username, beforeName string
	var beforeRole int64
	var isSuper, isProtectedRoot bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT u.username, u.display_name, u.role_id,
(u.is_super = 1 OR role_row.code = 'super_admin'), (u.username = 'admin999')
FROM mgr_user u JOIN mgr_role role_row ON role_row.id = u.role_id WHERE u.id = ?`, id).
		Scan(&username, &beforeName, &beforeRole, &isSuper, &isProtectedRoot); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if hideSuperUserFrom(p, isProtectedRoot) {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if isSuper && !targetRoleIsSuper {
		writeError(w, http.StatusForbidden, "SUPER_PROTECTED", "超级管理员不能被降权")
		return
	}
	_, err := s.db.ExecContext(r.Context(), "UPDATE mgr_user SET display_name = ?, role_id = ? WHERE id = ?", input.DisplayName, input.RoleID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新用户失败")
		return
	}
	s.audit(r.Context(), &p, "user.update", "mgr_user", numericID(id),
		map[string]any{"displayName": input.DisplayName, "roleId": input.RoleID},
		map[string]any{"displayName": beforeName, "roleId": beforeRole},
		map[string]any{"displayName": input.DisplayName, "roleId": input.RoleID}, 0, "更新成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "用户资料已更新", "username": username})
}

func (s *Server) handleUserStatus(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input statusRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validStatus(input.Status) {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "用户状态不正确")
		return
	}
	if id == p.ID {
		writeError(w, http.StatusForbidden, "SELF_PROTECTED", "不能停用当前登录账号")
		return
	}
	var beforeStatus string
	var isSuper, isProtectedRoot bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT u.status,
(u.is_super = 1 OR role_row.code = 'super_admin'), (u.username = 'admin999')
FROM mgr_user u JOIN mgr_role role_row ON role_row.id = u.role_id WHERE u.id = ?`, id).Scan(&beforeStatus, &isSuper, &isProtectedRoot); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if hideSuperUserFrom(p, isProtectedRoot) {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if isSuper {
		writeError(w, http.StatusForbidden, "SUPER_PROTECTED", "超级管理员不能被停用")
		return
	}
	_, err := s.db.ExecContext(r.Context(), "UPDATE mgr_user SET status = ? WHERE id = ?", input.Status, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新用户状态失败")
		return
	}
	if input.Status == "disabled" {
		_, _ = s.db.ExecContext(r.Context(), "DELETE FROM mgr_session WHERE user_id = ?", id)
	}
	s.audit(r.Context(), &p, "user.status", "mgr_user", numericID(id), input,
		map[string]any{"status": beforeStatus}, map[string]any{"status": input.Status}, 0, "状态已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "用户状态已更新"})
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input passwordRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	hash, err := security.HashPassword(input.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		return
	}
	var isSuper, isProtectedRoot bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT
(u.is_super = 1 OR role_row.code = 'super_admin'), (u.username = 'admin999')
FROM mgr_user u JOIN mgr_role role_row ON role_row.id = u.role_id WHERE u.id = ?`, id).Scan(&isSuper, &isProtectedRoot); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if hideSuperUserFrom(p, isProtectedRoot) {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if isSuper {
		writeError(w, http.StatusForbidden, "SUPER_PROTECTED", "超级管理员密码不能通过用户管理重置")
		return
	}
	_, err = s.db.ExecContext(r.Context(), "UPDATE mgr_user SET password_hash = ?, password_changed_at = NOW(), login_fail_count = 0, locked_until = NULL WHERE id = ?", hash, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "重置密码失败")
		return
	}
	_, _ = s.db.ExecContext(r.Context(), "DELETE FROM mgr_session WHERE user_id = ?", id)
	s.audit(r.Context(), &p, "user.reset_password", "mgr_user", numericID(id),
		map[string]any{"passwordChanged": true}, nil, nil, 0, "密码已重置，旧会话已失效", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "密码已重置，用户需要重新登录"})
}

func (s *Server) roleState(r *http.Request, roleID int64) (bool, bool) {
	var code, status string
	if err := s.db.QueryRowContext(r.Context(), "SELECT code, status FROM mgr_role WHERE id = ?", roleID).Scan(&code, &status); err != nil {
		return false, false
	}
	return status == "enabled", code == superAdminRoleCode
}

func duplicateKey(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}
