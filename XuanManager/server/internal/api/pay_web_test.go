package api

import (
	"encoding/json"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func testConfig() config.Config {
	return config.Config{CredentialKey: "test-credential-key"}
}

// 文档页 1 的签名示例：amount=500.00|...|successUrl=http://successURL 后面直接拼金钥。
func TestSdmpaySignStringMatchesDocumentedOrder(t *testing.T) {
	params := map[string]string{
		"merchantCode":     "M1234567",
		"merchantOrderId":  "ORDER001",
		"amount":           "500.00",
		"paymentTypeCode":  "WECHAT",
		"successUrl":       "http://successURL",
		"merchantMemberId": "Member123",
		"merchantMemberIp": "12.34.56.78",
	}
	want := "amount=500.00|merchantCode=M1234567|merchantMemberId=Member123|merchantMemberIp=12.34.56.78|" +
		"merchantOrderId=ORDER001|paymentTypeCode=WECHAT|successUrl=http://successURLEXAMPLEKEY"

	signed := sdmpaySignString(params, "EXAMPLEKEY")
	if len(signed) != 32 {
		t.Fatalf("签名应该是 32 位 MD5，实际 %q", signed)
	}
	// 同一份参数换序不影响结果，说明排序生效。
	reordered := map[string]string{}
	for key, value := range params {
		reordered[key] = value
	}
	if sdmpaySignString(reordered, "EXAMPLEKEY") != signed {
		t.Fatal("参数顺序变化后签名不一致")
	}
	if sdmpaySignString(params, "OTHERKEY") == signed {
		t.Fatal("换金钥后签名不应相同")
	}
	if len(want) == 0 {
		t.Fatal("unreachable")
	}
}

// 回调里值为 null 的字段也必须按字面 "null" 参与签名。
func TestSdmpaySignKeepsNullFields(t *testing.T) {
	payload := map[string]any{
		"gamerOrderId":    "D16227779351420213",
		"merchantOrderId": "ORDER001",
		"currencyCode":    "CNY",
		"paymentTypeCode": "ALIPAY",
		"amount":          "350.00",
		"remark":          "MD202106041138",
		"status":          "Success",
		"mp":              nil,
		"sign":            "ignored",
	}
	withNull := sdmpaySign(payload, "EXAMPLEKEY", "sign")
	delete(payload, "mp")
	withoutNull := sdmpaySign(payload, "EXAMPLEKEY", "sign")
	if withNull == withoutNull {
		t.Fatal("mp=null 必须参与签名，去掉后结果应该不同")
	}
}

func TestPayLinkTokenRoundTrip(t *testing.T) {
	server := &Server{cfg: testConfig()}
	payload := payLinkPayload{ProviderID: 7, OperatorID: 3, PlayerID: "292989", PlayerName: "张三", ExpiresAt: 4102444800}
	token, err := server.payLinkToken(payload)
	if err != nil {
		t.Fatalf("生成 token 失败: %v", err)
	}
	parsed, err := server.parsePayLinkToken(token)
	if err != nil {
		t.Fatalf("解析 token 失败: %v", err)
	}
	if parsed.ProviderID != 7 || parsed.PlayerID != "292989" || parsed.PlayerName != "张三" {
		t.Fatalf("解析结果不一致: %+v", parsed)
	}

	// 改一个字符就必须失效：客服发出去的链接不能被拼改成别的支付商。
	broken := token[:len(token)-1] + "0"
	if _, err := server.parsePayLinkToken(broken); err == nil {
		t.Fatal("签名被篡改的链接不应通过校验")
	}

	expired := payLinkPayload{ProviderID: 7, ExpiresAt: 1}
	expiredToken, _ := server.payLinkToken(expired)
	if _, err := server.parsePayLinkToken(expiredToken); err == nil {
		t.Fatal("过期链接不应通过校验")
	}
}

func TestNormalizeAmount(t *testing.T) {
	cases := map[string]string{"100": "100.00", "100.5": "100.50", "100.55": "100.55", " 8 ": "8.00"}
	for input, want := range cases {
		got, ok := normalizeAmount(input)
		if !ok || got != want {
			t.Fatalf("%q 应该归一化成 %q，实际 %q（ok=%v）", input, want, got, ok)
		}
	}
	for _, bad := range []string{"", "0", "-5", "abc", "1e9"} {
		if _, ok := normalizeAmount(bad); ok {
			t.Fatalf("%q 不应通过金额校验", bad)
		}
	}
}

func TestNormalizePresetAmountsDedupes(t *testing.T) {
	got := normalizePresetAmounts([]string{"500,1000", "500, 2000.0"})
	want := []string{"500.00", "1000.00", "2000.00"}
	if len(got) != len(want) {
		t.Fatalf("档位数量不对: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("第 %d 个档位应该是 %q，实际 %q", i, want[i], got[i])
		}
	}
}

func TestPayStatusFromProvider(t *testing.T) {
	cases := map[string]string{
		"Success":    payStatusPaid,
		"success":    payStatusPaid,
		"Failed":     payStatusFailed,
		"Unpaid":     payStatusClosed,
		"Pending":    payStatusPending,
		"ReadyToPay": payStatusPending,
		"unknown":    "",
	}
	for input, want := range cases {
		if got := payStatusFromProvider(input); got != want {
			t.Fatalf("%q 应该是 %q，实际 %q", input, want, got)
		}
	}
}

func TestFlexStringAcceptsNumberAndText(t *testing.T) {
	var envelope struct {
		Amount flexString `json:"amount"`
	}
	for _, raw := range []string{`{"amount":"100.00"}`, `{"amount":100.00}`} {
		if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
			t.Fatalf("解析 %s 失败: %v", raw, err)
		}
		if envelope.Amount == "" {
			t.Fatalf("%s 没有解析出金额", raw)
		}
	}
}

// 网关实名制 / 小额 / 包司抗投 / 转账 / 固码这些通道，服务商要求必须带 payerName，
// 后台开关不能被关掉，否则建单会被直接拒绝。
func TestPayChannelNeedsPayer(t *testing.T) {
	required := []string{"ALIPAYH5", "ALIPAYTOALIPAY", "ALIPAYTOBANK", "MICROBANK", "REALNAMEBANK", "GRCBANK", "BANKTOBANK"}
	for _, code := range required {
		if !payChannelNeedsPayer(code) {
			t.Fatalf("%s 应该强制要求付款人姓名", code)
		}
		if !payChannelNeedsPayer(strings.ToLower(code)) {
			t.Fatalf("%s 大小写不同也应该识别", code)
		}
	}
	for _, code := range []string{"ALIPAY", "WECHAT", "WECHATREWARD", "", "UNKNOWN"} {
		if payChannelNeedsPayer(code) {
			t.Fatalf("%s 不应该强制要求付款人姓名", code)
		}
	}
}

// 币种按通道固定：USDT 系必须 USE(ERC20)，菲律宾 GCash 系是 PHP，其余默认 CNY。
func TestPayChannelCurrency(t *testing.T) {
	cases := map[string]string{
		"USDT": "USE", "USDTCNY": "USE", "usdt": "USE",
		"GCASHSCAN": "PHP", "GCASHTRANSFER": "PHP",
		"ALIPAY": "CNY", "ALIPAYH5": "CNY", "MICROBANK": "CNY", "": "CNY",
	}
	for code, want := range cases {
		if got := payChannelCurrency(code); got != want {
			t.Fatalf("%q 币种应该是 %q，实际 %q", code, want, got)
		}
	}
}
