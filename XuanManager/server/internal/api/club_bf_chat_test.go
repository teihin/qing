package api

import "testing"

func TestValidateBFChatRequest(t *testing.T) {
	enabled := true
	expected := false
	target, current, err := validateBFChatRequest(updateBFChatRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Confirm:         true,
	})
	if err != nil {
		t.Fatalf("validateBFChatRequest: %v", err)
	}
	if !target || current {
		t.Fatalf("unexpected states: target=%v current=%v", target, current)
	}
}

func TestValidateBFChatRequestRejectsMissingConfirm(t *testing.T) {
	enabled := true
	expected := false
	if _, _, err := validateBFChatRequest(updateBFChatRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
	}); err == nil {
		t.Fatal("expected missing confirm to be rejected")
	}
}

func TestValidateBFChatRequestRejectsMissingState(t *testing.T) {
	enabled := true
	if _, _, err := validateBFChatRequest(updateBFChatRequest{
		Enabled: &enabled,
		Confirm: true,
	}); err == nil {
		t.Fatal("expected missing expectedEnabled to be rejected")
	}
}
