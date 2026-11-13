package api

import "testing"

func TestIPCodeRoundTrip(t *testing.T) {
	cases := map[string]string{
		"221.236.103.129": "43Ypq1",
		"127.0.0.1":       "2kce4N",
		"0.0.0.0":         "000000",
		"255.255.255.255": "4GFfc3",
		"192.168.1.20":    "3wK8bq",
	}
	for ip, want := range cases {
		code := EncodeIPCode(ip)
		if code != want {
			t.Fatalf("EncodeIPCode(%q) = %q, want %q", ip, code, want)
		}
		got, err := DecodeIPCode(code)
		if err != nil {
			t.Fatalf("DecodeIPCode(%q): %v", code, err)
		}
		if got != ip {
			t.Fatalf("DecodeIPCode(%q) = %q, want %q", code, got, ip)
		}
	}
}

func TestIPCodeRejectsInvalidInput(t *testing.T) {
	for _, ip := range []string{"", "::1", "1.2.3.999", "1.2.3", "1.2.3.4.5"} {
		if code := EncodeIPCode(ip); code != "" {
			t.Fatalf("EncodeIPCode(%q) = %q, want empty", ip, code)
		}
	}
	for _, code := range []string{"", "43Ypq", "43Ypq12", "43Yp-1", "zzzzzz"} {
		if _, err := DecodeIPCode(code); err == nil {
			t.Fatalf("DecodeIPCode(%q) accepted invalid code", code)
		}
	}
}
