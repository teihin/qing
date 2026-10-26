package api

import (
	"strings"
	"testing"
)

func TestValidatePromotionDownloadURL(t *testing.T) {
	valid := []string{
		"http://www.baidu.com",
		"https://down.example.com/by/index.html?from=promo",
	}
	for _, value := range valid {
		got, err := validatePromotionDownloadURL("  " + value + "  ")
		if err != nil {
			t.Fatalf("%q 应当被接受: %v", value, err)
		}
		// 首尾空格必须被裁掉：这个值会原样显示在玩家手机上的推广页里。
		if got != value {
			t.Fatalf("got %q, want %q", got, value)
		}
	}

	invalid := []string{
		"",
		"   ",
		"www.baidu.com",
		"./downloads/BY.apk",
		"/downloads/BY.apk",
		"javascript:alert(1)",
		"http://user:pass@example.com/a",
		"http://exa mple.com/a",
		"http://example.com/a\nb",
		"http://" + strings.Repeat("a", promotionDownloadURLMaxLength),
	}
	for _, value := range invalid {
		if _, err := validatePromotionDownloadURL(value); err == nil {
			t.Fatalf("%q 必须被拒绝", value)
		}
	}
}

// 键名写死和客户端 ConfigManager.GetOneHashKey("下载url") 必须一致，
// 改错一个字符后台就写到了没人读的哈希项上。
func TestPromotionDownloadURLKeyMatchesClient(t *testing.T) {
	if promotionDownloadURLKey != "下载url" {
		t.Fatalf("哈希键必须与客户端一致，当前 %q", promotionDownloadURLKey)
	}
	if promotionDownloadURLDefault != "http://www.baidu.com" {
		t.Fatalf("内置默认值应与客户端 ConfigManager.downloadurl 一致，当前 %q", promotionDownloadURLDefault)
	}
}
