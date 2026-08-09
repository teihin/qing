package api

import (
	"database/sql"
	"net/http"
	"strings"
)

type moduleRequest struct {
	ParentID  *int64 `json:"parentId"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Route     string `json:"route"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sortOrder"`
	Visible   bool   `json:"visible"`
	Status    string `json:"status"`
}

type permissionRequest struct {
	ModuleID    int64  `json:"moduleId"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Action      string `json:"action"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

func (s *Server) handleListModules(w http.ResponseWriter, r *http.Request, _ principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, parent_id, code, name, route, icon, sort_order, visible, status
FROM mgr_module ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, sort_order, id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取模块失败")
		return
	}
	defer rows.Close()
	items := []moduleItem{}
	for rows.Next() {
		var item moduleItem
		if err := rows.Scan(&item.ID, &item.ParentID, &item.Code, &item.Name, &item.Route, &item.Icon, &item.SortOrder, &item.Visible, &item.Status); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取模块数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateModule(w http.ResponseWriter, r *http.Request, p principal) {
	var input moduleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizeModule(&input)
	if message := s.validateModule(r, input, 0, true); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_MODULE", message)
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_module
(parent_id, code, name, route, icon, sort_order, visible, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, input.ParentID, input.Code, input.Name, input.Route, input.Icon, input.SortOrder, input.Visible, input.Status)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "MODULE_EXISTS", "模块编码已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建模块失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "module.create", "mgr_module", numericID(id), input, nil, input, 0, "创建成功", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "模块创建成功"})
}

func (s *Server) handleUpdateModule(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input moduleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizeModule(&input)
	if message := s.validateModule(r, input, id, false); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_MODULE", message)
		return
	}
	var before moduleRequest
	if err := s.db.QueryRowContext(r.Context(), `SELECT parent_id, code, name, route, icon, sort_order, visible, status
FROM mgr_module WHERE id = ?`, id).Scan(&before.ParentID, &before.Code, &before.Name, &before.Route, &before.Icon, &before.SortOrder, &before.Visible, &before.Status); err != nil {
		writeError(w, http.StatusNotFound, "MODULE_NOT_FOUND", "模块不存在")
		return
	}
	_, err := s.db.ExecContext(r.Context(), `UPDATE mgr_module SET
parent_id = ?, name = ?, route = ?, icon = ?, sort_order = ?, visible = ?, status = ? WHERE id = ?`,
		input.ParentID, input.Name, input.Route, input.Icon, input.SortOrder, input.Visible, input.Status, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新模块失败")
		return
	}
	input.Code = before.Code
	s.audit(r.Context(), &p, "module.update", "mgr_module", numericID(id), input, before, input, 0, "更新成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "模块已更新"})
}

func (s *Server) handleListPermissions(w http.ResponseWriter, r *http.Request, _ principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT
p.id, p.module_id, m.code, m.name, p.code, p.name, p.action, p.description, p.status
FROM mgr_permission p JOIN mgr_module m ON m.id = p.module_id
ORDER BY m.sort_order, p.id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取权限失败")
		return
	}
	defer rows.Close()
	items := []permissionItem{}
	for rows.Next() {
		var item permissionItem
		if err := rows.Scan(&item.ID, &item.ModuleID, &item.ModuleCode, &item.ModuleName, &item.Code, &item.Name, &item.Action, &item.Description, &item.Status); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取权限数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreatePermission(w http.ResponseWriter, r *http.Request, p principal) {
	var input permissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizePermission(&input)
	if message := s.validatePermission(r, input, true); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PERMISSION", message)
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_permission
(module_id, code, name, action, description, status) VALUES (?, ?, ?, ?, ?, ?)`,
		input.ModuleID, input.Code, input.Name, input.Action, input.Description, input.Status)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "PERMISSION_EXISTS", "权限编码已存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建权限失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "permission.create", "mgr_permission", numericID(id), input, nil, input, 0, "创建成功", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "操作权限创建成功"})
}

func (s *Server) handleUpdatePermission(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input permissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizePermission(&input)
	if message := s.validatePermission(r, input, false); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PERMISSION", message)
		return
	}
	var before permissionRequest
	if err := s.db.QueryRowContext(r.Context(), `SELECT module_id, code, name, action, description, status
FROM mgr_permission WHERE id = ?`, id).Scan(&before.ModuleID, &before.Code, &before.Name, &before.Action, &before.Description, &before.Status); err != nil {
		writeError(w, http.StatusNotFound, "PERMISSION_NOT_FOUND", "权限不存在")
		return
	}
	_, err := s.db.ExecContext(r.Context(), `UPDATE mgr_permission SET
module_id = ?, name = ?, action = ?, description = ?, status = ? WHERE id = ?`,
		input.ModuleID, input.Name, input.Action, input.Description, input.Status, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新权限失败")
		return
	}
	input.Code = before.Code
	s.audit(r.Context(), &p, "permission.update", "mgr_permission", numericID(id), input, before, input, 0, "更新成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "操作权限已更新"})
}

func normalizeModule(input *moduleRequest) {
	input.Code = strings.ToLower(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Route = strings.TrimSpace(input.Route)
	input.Icon = strings.TrimSpace(input.Icon)
	if input.Status == "" {
		input.Status = "enabled"
	}
}

func (s *Server) validateModule(r *http.Request, input moduleRequest, currentID int64, requireCode bool) string {
	if requireCode && !codePattern.MatchString(input.Code) {
		return "模块编码格式不正确"
	}
	if input.Name == "" || len([]rune(input.Name)) > 64 {
		return "模块名称不能为空且不能超过 64 个字符"
	}
	if input.Route != "" && !strings.HasPrefix(input.Route, "/") {
		return "页面路径必须以 / 开头"
	}
	if len(input.Route) > 128 || len(input.Icon) > 32 {
		return "页面路径或图标名称过长"
	}
	if !validStatus(input.Status) {
		return "模块状态不正确"
	}
	if input.ParentID != nil {
		if *input.ParentID <= 0 || *input.ParentID == currentID {
			return "上级模块不正确"
		}
		if s.moduleWouldCycle(r, currentID, *input.ParentID) {
			return "不能把模块移动到自己的下级模块中"
		}
	}
	return ""
}

func (s *Server) moduleWouldCycle(r *http.Request, currentID, parentID int64) bool {
	if currentID == 0 {
		var count int
		return s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_module WHERE id = ?", parentID).Scan(&count) != nil || count != 1
	}
	seen := map[int64]bool{currentID: true}
	next := parentID
	for depth := 0; depth < 64; depth++ {
		if seen[next] {
			return true
		}
		seen[next] = true
		var parent sql.NullInt64
		if err := s.db.QueryRowContext(r.Context(), "SELECT parent_id FROM mgr_module WHERE id = ?", next).Scan(&parent); err != nil {
			return true
		}
		if !parent.Valid {
			return false
		}
		next = parent.Int64
	}
	return true
}

func normalizePermission(input *permissionRequest) {
	input.Code = strings.ToLower(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Description = strings.TrimSpace(input.Description)
	if input.Status == "" {
		input.Status = "enabled"
	}
}

func (s *Server) validatePermission(r *http.Request, input permissionRequest, requireCode bool) string {
	if requireCode && !codePattern.MatchString(input.Code) {
		return "权限编码格式不正确"
	}
	if input.Name == "" || len([]rune(input.Name)) > 64 {
		return "权限名称不能为空且不能超过 64 个字符"
	}
	if !codePattern.MatchString(input.Action) || len(input.Action) > 32 {
		return "操作标识格式不正确"
	}
	if len([]rune(input.Description)) > 255 {
		return "权限说明不能超过 255 个字符"
	}
	if !validStatus(input.Status) {
		return "权限状态不正确"
	}
	var count int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_module WHERE id = ?", input.ModuleID).Scan(&count); err != nil || count != 1 {
		return "所属模块不存在"
	}
	return ""
}
