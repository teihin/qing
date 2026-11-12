package api

import (
	"reflect"
	"testing"
)

func TestNormalizeManageScopeIDs(t *testing.T) {
	ids, err := normalizeManageScopeIDs([]string{"310521, 310522", "984470", " 984470 "})
	if err != nil {
		t.Fatalf("normalize ids: %v", err)
	}
	if !reflect.DeepEqual(ids, []string{"310521", "310522", "984470"}) {
		t.Fatalf("unexpected ids: %#v", ids)
	}

	empty, err := normalizeManageScopeIDs(nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty ids should normalize to empty slice: %#v %v", empty, err)
	}

	if _, err := normalizeManageScopeIDs([]string{"31052"}); err == nil {
		t.Fatal("5-digit id should be rejected")
	}
	if _, err := normalizeManageScopeIDs([]string{"310521a"}); err == nil {
		t.Fatal("non-numeric id should be rejected")
	}
}

func TestSplitCommaIDs(t *testing.T) {
	ids := splitCommaIDs(" 310521, 310522,,310521 ")
	if !reflect.DeepEqual(ids, []string{"310521", "310522"}) {
		t.Fatalf("unexpected ids: %#v", ids)
	}
	if ids := splitCommaIDs(""); len(ids) != 0 {
		t.Fatalf("empty raw should return empty ids: %#v", ids)
	}
}

func TestScopeIDsEqual(t *testing.T) {
	if !scopeIDsEqual("984470,710701", []string{"710701", "984470"}) {
		t.Fatal("same ids in different order should be equal")
	}
	if scopeIDsEqual("984470", []string{"984470", "710701"}) {
		t.Fatal("different id counts should not be equal")
	}
	if scopeIDsEqual("", []string{"984470"}) {
		t.Fatal("empty value should not equal non-empty ids")
	}
	if !scopeIDsEqual("", nil) {
		t.Fatal("empty value should equal empty ids")
	}
}
