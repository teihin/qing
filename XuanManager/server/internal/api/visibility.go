package api

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// nonRootAuditVisibilitySQL expects the audit table to be aliased as
// audit_row. It hides both actions performed by the protected root account and
// account actions whose target is the protected root account. The latter also
// covers failed-login audit rows, whose target_id is the submitted username.
const nonRootAuditVisibilitySQL = `NOT EXISTS (
  SELECT 1
  FROM mgr_user hidden_super
  WHERE hidden_super.username = 'admin999'
    AND (
      hidden_super.id = audit_row.operator_id
      OR (
        audit_row.target_type = 'mgr_user'
        AND (
          audit_row.target_id = CAST(hidden_super.id AS CHAR)
          OR audit_row.target_id = hidden_super.username
        )
      )
    )
)`

func canSeeProtectedRootFlag(p principal) int {
	return booleanFlag(p.IsProtectedRoot)
}

func booleanFlag(value bool) int {
	if value {
		return 1
	}
	return 0
}

func hideSuperUserFrom(p principal, isProtectedRoot bool) bool {
	return isProtectedRoot && !p.IsProtectedRoot
}

// latestAuditAttribution intentionally checks the latest successful action
// before applying visibility. Any account other than admin999 gets no
// attribution when that latest action belongs to admin999; it must not fall
// back to an older administrator and misrepresent who made the current change.
func (s *Server) latestAuditAttribution(ctx context.Context, action string, p principal) (string, *time.Time, error) {
	var operatorName string
	var createdAt time.Time
	var operatorIsSuper bool
	err := s.db.QueryRowContext(ctx, `SELECT
audit_row.operator_name, DATE_ADD(audit_row.created_at, INTERVAL 8 HOUR), COALESCE(operator_user.username = 'admin999', 0)
FROM mgr_audit_log audit_row
LEFT JOIN mgr_user operator_user ON operator_user.id = audit_row.operator_id
WHERE audit_row.action = ? AND audit_row.result_code = 0
ORDER BY audit_row.id DESC LIMIT 1`, action).Scan(&operatorName, &createdAt, &operatorIsSuper)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	if hideSuperUserFrom(p, operatorIsSuper) {
		return "", nil, nil
	}
	return operatorName, &createdAt, nil
}
