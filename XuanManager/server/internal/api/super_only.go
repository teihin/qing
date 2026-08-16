package api

const (
	roomMaintenanceModuleID = int64(26)
	superAdminRoleCode      = "super_admin"
	protectedRootUsername   = "admin999"
)

var roomMaintenancePermissionIDs = map[int64]struct{}{
	2601: {},
	2602: {},
	2603: {},
	2604: {},
}

func isSuperOnlyModuleID(moduleID int64) bool {
	return moduleID == roomMaintenanceModuleID || moduleID == platformRevenueModuleID
}

func isSuperOnlyPermissionID(permissionID int64) bool {
	if permissionID == platformRevenuePermissionID {
		return true
	}
	_, ok := roomMaintenancePermissionIDs[permissionID]
	return ok
}

func isEffectiveSuper(isSuper bool, roleCode string) bool {
	return isSuper || roleCode == superAdminRoleCode
}

func isProtectedRootIdentity(username string) bool {
	return username == protectedRootUsername
}
