package api

import (
	"math"
	"testing"
)

func TestValidateClubSeatStoneRatio(t *testing.T) {
	value, text, err := validateClubSeatStoneRatio(0.1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if value != 0.1 || text != "0.1" {
		t.Fatalf("got %v / %q, want 0.1 / 0.1", value, text)
	}

	value, text, err = validateClubSeatStoneRatio(1.234567)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if math.Abs(value-1.2346) > 1e-9 || text != "1.2346" {
		t.Fatalf("got %v / %q, want 1.2346", value, text)
	}

	if _, _, err := validateClubSeatStoneRatio(-0.1); err == nil {
		t.Fatal("negative ratio must be rejected")
	}
	if _, _, err := validateClubSeatStoneRatio(clubSeatStoneRatioMax + 1); err == nil {
		t.Fatal("over max ratio must be rejected")
	}
	if _, _, err := validateClubSeatStoneRatio(math.NaN()); err == nil {
		t.Fatal("NaN must be rejected")
	}
}

func TestParseClubSeatStoneRatio(t *testing.T) {
	for _, input := range []string{"0.1", " 0.1 ", "1", "1.0", "0"} {
		if _, err := parseClubSeatStoneRatio(input); err != nil {
			t.Fatalf("%q should parse: %v", input, err)
		}
	}
	for _, input := range []string{"", "abc", "-0.1", "1001"} {
		if _, err := parseClubSeatStoneRatio(input); err == nil {
			t.Fatalf("%q must be rejected", input)
		}
	}
}

func TestFormatClubSeatStoneRatio(t *testing.T) {
	if got := formatClubSeatStoneRatio(0.1); got != "0.1" {
		t.Fatalf("got %q, want 0.1", got)
	}
	if got := formatClubSeatStoneRatio(1); got != "1" {
		t.Fatalf("got %q, want 1", got)
	}
}
