package api

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{2,63}$`)

type roleRequest struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

type rolePermissionRequest struct {
	PermissionIDs []int64 `json:"permissionIds"`
}

func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request, p principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT
r.id, r.code, r.name, r.description, r.status, r.is_system, COUNT(u.id)
FROM mgr_role r LEFT JOIN mgr_user u ON u.role_id = r.id AND (? = 1 OR u.username <> 'admin999')
GROUP BY r.id, r.code, r.name, r.description, r.status, r.is_system
ORDER BY r.is_system DESC, r.id`, canSeeProtectedRootFlag(p))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取角色失败")
		return
	}
	defer rows.Close()
	items := make([]roleItem, 0)
	byID := map[int64]*roleItem{}
	for rows.Next() {
		var item roleItem
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Description, &item.Status, &item.IsSystem, &item.UserCount); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取角色数据失败")
			return
		}
		item.PermissionIDs = []int64{}
		items = append(items, item)
	}
	for index := range items {
		byID[items[index].ID] = &items[index]
	}
	permRows, err := s.db.QueryContext(r.Context(), "SELECT role_id, permission_id FROM mgr_role_permission ORDER BY permission_id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取角色权限失败")
		return
	}
	defer permRows.Close()
	for permRows.Next() {
		var roleID, permissionID int64
		if err := permRows.Scan(&roleID, &permissionID); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取角色权限失败")
			return
		}
		if item := byID[roleID]; item != nil {
			item.PermissionIDs = append(item.PermissionIDs, permissionID)
		}
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateRole(w http.ResponseWriter, r *http.Request, p principal) {
	var input roleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizeRole(&input)
	if message := validateRole(input, true); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", message)
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_role
(code, name, description, status, is_system) VALUES (?, ?, ?, ?, 0)`, input.Code, input.Name, input.Description, input.Status)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "ROLE_EXISTS", "角色编码已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建角色失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "role.create", "mgr_role", numericID(id), input, nil, input, 0, "创建成功", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "角色创建成功"})
}

func (s *Server) handleUpdateRole(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input roleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizeRole(&input)
	if message := validateRole(input, false); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_ROLE", message)
		return
	}
	var before roleRequest
	var isSystem bool
	if err := s.db.QueryRowContext(r.Context(), "SELECT code, name, description, status, is_system FROM mgr_role WHERE id = ?", id).
		Scan(&before.Code, &before.Name, &before.Description, &before.Status, &isSystem); err != nil {
		writeError(w, http.StatusNotFound, "ROLE_NOT_FOUND", "角色不存在")
		return
	}
	if isSystem {
		writeError(w, http.StatusForbidden, "SYSTEM_ROLE_PROTECTED", "系统角色不能编辑或停用")
		return
	}
	_, err := s.db.ExecContext(r.Context(), "UPDATE mgr_role SET name = ?, description = ?, status = ? WHERE id = ?", input.Name, input.Description, input.Status, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新角色失败")
		return
	}
	if input.Status == "disabled" {
		_, _ = s.db.ExecContext(r.Context(), `DELETE sess FROM mgr_session sess JOIN mgr_user u ON u.id = sess.user_id WHERE u.role_id = ?`, id)
	}
	input.Code = before.Code
	s.audit(r.Context(), &p, "role.update", "mgr_role", numericID(id), input, before, input, 0, "更新成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "角色已更新"})
}

func (s *Server) handleRolePermissions(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input rolePermissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var code string
	var isSystem bool
	if err := s.db.QueryRowContext(r.Context(), "SELECT code, is_system FROM mgr_role WHERE id = ?", id).Scan(&code, &isSystem); err != nil {
		writeError(w, http.StatusNotFound, "ROLE_NOT_FOUND", "角色不存在")
		return
	}
	if isSystem || code == "super_admin" {
		writeError(w, http.StatusForbidden, "SYSTEM_ROLE_PROTECTED", "超级管理员始终拥有全部权限")
		return
	}
	ids := uniquePositiveIDs(input.PermissionIDs)
	for _, permissionID := range ids {
		if isSuperOnlyPermissionID(permissionID) {
			writeError(w, http.StatusBadRequest, "SUPER_ONLY_PERMISSION", "包含超级管理员专属权限，不能分配给其他角色")
			return
		}
	}
	if len(ids) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, len(ids))
		for i, value := range ids {
			args[i] = value
		}
		var count int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_permission WHERE status = 'enabled' AND id IN ("+placeholders+")", args...).Scan(&count); err != nil || count != len(ids) {
			writeError(w, http.StatusBadRequest, "INVALID_PERMISSION", "包含不存在或已停用的权限")
			return
		}
		var superOnlyCount int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_permission WHERE module_id IN (?, ?) AND id IN ("+placeholders+")", append([]any{roomMaintenanceModuleID, platformRevenueModuleID}, args...)...).Scan(&superOnlyCount); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验超级管理员专属权限失败")
			return
		}
		if superOnlyCount > 0 {
			writeError(w, http.StatusBadRequest, "SUPER_ONLY_PERMISSION", "包含超级管理员专属权限，不能分配给其他角色")
			return
		}
	}
	before, err := s.rolePermissionIDs(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取原权限失败")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新权限失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM mgr_role_permission WHERE role_id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新权限失败")
		return
	}
	for _, permissionID := range ids {
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO mgr_role_permission(role_id, permission_id) VALUES (?, ?)", id, permissionID); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新权限失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新权限失败")
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `DELETE sess FROM mgr_session sess JOIN mgr_user u ON u.id = sess.user_id WHERE u.role_id = ?`, id)
	s.audit(r.Context(), &p, "role.assign_permissions", "mgr_role", numericID(id), map[string]any{"permissionIds": ids},
		map[string]any{"permissionIds": before}, map[string]any{"permissionIds": ids}, 0, "权限已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "角色权限已保存"})
}

func (s *Server) rolePermissionIDs(r *http.Request, roleID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT permission_id FROM mgr_role_permission WHERE role_id = ? ORDER BY permission_id", roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func normalizeRole(input *roleRequest) {
	input.Code = strings.ToLower(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if input.Status == "" {
		input.Status = "enabled"
	}
}

func validateRole(input roleRequest, requireCode bool) string {
	if requireCode && !codePattern.MatchString(input.Code) {
		return "角色编码须以小写字母开头，只能包含小写字母、数字、点、下划线或短横线"
	}
	if input.Name == "" || len([]rune(input.Name)) > 64 {
		return "角色名称不能为空且不能超过 64 个字符"
	}
	if len([]rune(input.Description)) > 255 {
		return "角色说明不能超过 255 个字符"
	}
	if !validStatus(input.Status) {
		return "角色状态不正确"
	}
	return ""
}

func uniquePositiveIDs(input []int64) []int64 {
	seen := map[int64]bool{}
	result := make([]int64, 0, len(input))
	for _, value := range input {
		if value > 0 && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}
