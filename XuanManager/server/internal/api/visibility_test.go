package api

import (
	"strings"
	"testing"
)

func TestSuperVisibilityFlags(t *testing.T) {
	ordinary := principal{}
	super := principal{IsSuper: true}
	if canSeeSuperFlag(ordinary) != 0 || canSeeSuperFlag(super) != 1 {
		t.Fatal("unexpected super visibility flag")
	}
	if !hideSuperUserFrom(ordinary, true) {
		t.Fatal("ordinary administrator can see a super user")
	}
	if hideSuperUserFrom(super, true) || hideSuperUserFrom(ordinary, false) {
		t.Fatal("super visibility hid an allowed user")
	}
}

func TestNonSuperAuditVisibilityCoversOperatorAndAccountTarget(t *testing.T) {
	for _, fragment := range []string{
		"hidden_super.id = audit_row.operator_id",
		"audit_row.target_type = 'mgr_user'",
		"audit_row.target_id = CAST(hidden_super.id AS CHAR)",
		"audit_row.target_id = hidden_super.username",
	} {
		if !strings.Contains(nonSuperAuditVisibilitySQL, fragment) {
			t.Fatalf("audit visibility predicate is missing %q", fragment)
		}
	}
}
