package directchat

import "testing"

func TestClubGoldFrom(t *testing.T) {
	cases := []struct {
		name   string
		raw    any
		want   int64
		ok     bool
		clubID string
	}{
		{name: "number", raw: int64(12580), want: 12580, ok: true},
		{name: "string", raw: "12580", want: 12580, ok: true},
		{name: "json", raw: `{"820084":300,"999999":50}`, want: 300, ok: true},
		{name: "json other club", raw: `{"999999":50}`, ok: false},
		{name: "sentinel", raw: "-99", ok: false},
		{name: "json sentinel", raw: `{"820084":-99}`, ok: false},
		{name: "nil", raw: nil, ok: false},
		{name: "bad json", raw: `{bad`, ok: false},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			clubID := "820084"
			value, ok := clubGoldFrom(item.raw, clubID)
			if ok != item.ok || (ok && value != item.want) {
				t.Fatalf("clubGoldFrom(%v)=%d,%v want %d,%v", item.raw, value, ok, item.want, item.ok)
			}
		})
	}
}
