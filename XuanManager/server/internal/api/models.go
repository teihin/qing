package api

import "time"

type principal struct {
	ID              int64
	Username        string
	DisplayName     string
	RoleID          int64
	RoleCode        string
	RoleName        string
	IsSuper         bool
	IsProtectedRoot bool
	CSRFHash        string
	Permissions     map[string]bool
}

func (p principal) Can(code string) bool {
	return p.IsSuper || p.Permissions[code]
}

type userItem struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	RoleID      int64      `json:"roleId"`
	RoleCode    string     `json:"roleCode"`
	RoleName    string     `json:"roleName"`
	IsSuper     bool       `json:"isSuper"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"lastLoginAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type roleItem struct {
	ID            int64   `json:"id"`
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	Description   string  `json:"description"`
	Status        string  `json:"status"`
	IsSystem      bool    `json:"isSystem"`
	UserCount     int64   `json:"userCount"`
	PermissionIDs []int64 `json:"permissionIds"`
}

type moduleItem struct {
	ID        int64  `json:"id"`
	ParentID  *int64 `json:"parentId"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Route     string `json:"route"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sortOrder"`
	Visible   bool   `json:"visible"`
	Status    string `json:"status"`
}

type permissionItem struct {
	ID          int64  `json:"id"`
	ModuleID    int64  `json:"moduleId"`
	ModuleCode  string `json:"moduleCode"`
	ModuleName  string `json:"moduleName"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Action      string `json:"action"`
	Description string `json:"description"`
	Status      string `json:"status"`
}
