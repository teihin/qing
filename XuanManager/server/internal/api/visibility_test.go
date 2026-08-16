package api

import (
	"strings"
	"testing"
)

func TestProtectedRootVisibilityFlags(t *testing.T) {
	ordinary := principal{}
	superRole := principal{IsSuper: true}
	protectedRoot := principal{IsSuper: true, IsProtectedRoot: true}
	if canSeeProtectedRootFlag(ordinary) != 0 || canSeeProtectedRootFlag(superRole) != 0 || canSeeProtectedRootFlag(protectedRoot) != 1 {
		t.Fatal("unexpected protected-root visibility flag")
	}
	if !hideSuperUserFrom(ordinary, true) || !hideSuperUserFrom(superRole, true) {
		t.Fatal("non-root administrator can see the protected root user")
	}
	if hideSuperUserFrom(protectedRoot, true) || hideSuperUserFrom(ordinary, false) {
		t.Fatal("protected-root visibility hid an allowed user")
	}
}

func TestNonSuperAuditVisibilityCoversOperatorAndAccountTarget(t *testing.T) {
	for _, fragment := range []string{
		"hidden_super.username = 'admin999'",
		"hidden_super.id = audit_row.operator_id",
		"audit_row.target_type = 'mgr_user'",
		"audit_row.target_id = CAST(hidden_super.id AS CHAR)",
		"audit_row.target_id = hidden_super.username",
	} {
		if !strings.Contains(nonRootAuditVisibilitySQL, fragment) {
			t.Fatalf("audit visibility predicate is missing %q", fragment)
		}
	}
}
