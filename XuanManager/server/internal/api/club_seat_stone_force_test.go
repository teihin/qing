package api

import "testing"

func TestClubSeatStoneForceKey(t *testing.T) {
	if got := clubSeatStoneForceKey(" 820084 "); got != "强制入座扣钻_俱乐部_820084" {
		t.Fatalf("unexpected key: %q", got)
	}
}

func TestValidateSeatStoneForceRequest(t *testing.T) {
	enabled := true
	expected := false
	target, current, note, err := validateSeatStoneForceRequest(updateSeatStoneForceRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "  运营强制带入钻石  ",
		Confirm:         true,
	})
	if err != nil {
		t.Fatalf("validateSeatStoneForceRequest: %v", err)
	}
	if !target || current {
		t.Fatalf("unexpected states: target=%v current=%v", target, current)
	}
	if note != "运营强制带入钻石" {
		t.Fatalf("unexpected note: %q", note)
	}
}

func TestValidateSeatStoneForceRequestRejectsMissingConfirm(t *testing.T) {
	enabled := true
	expected := false
	if _, _, _, err := validateSeatStoneForceRequest(updateSeatStoneForceRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "运营强制带入钻石",
	}); err == nil {
		t.Fatal("expected error when confirm is missing")
	}
}

func TestValidateSeatStoneForceRequestRejectsShortNote(t *testing.T) {
	enabled := true
	expected := false
	if _, _, _, err := validateSeatStoneForceRequest(updateSeatStoneForceRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "开",
		Confirm:         true,
	}); err == nil {
		t.Fatal("expected error when note is shorter than 2 runes")
	}
}
