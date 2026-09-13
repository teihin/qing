package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func withdrawalBool(value bool) *bool { return &value }

func TestWithdrawalSwitchHashRoundTrip(t *testing.T) {
	for mask := 0; mask < 8; mask++ {
		t.Run(fmt.Sprint(mask), func(t *testing.T) {
			input := updatePaymentConfigurationRequest{
				Channels:                []paymentChannelConfig{{Name: "提现"}},
				BankWithdrawalEnabled:   withdrawalBool(mask&1 != 0),
				AlipayWithdrawalEnabled: withdrawalBool(mask&2 != 0),
				USDTWithdrawalEnabled:   withdrawalBool(mask&4 != 0), USDTExchangeRate: " 7.2500 ",
			}
			if err := normalizeAndValidatePaymentRequest(&input); err != nil {
				t.Fatal(err)
			}
			writes, err := paymentHashWrites(input)
			if err != nil {
				t.Fatal(err)
			}
			for i, key := range []string{paymentBankEnabledKey, paymentAlipayEnabledKey, paymentUSDTEnabledKey} {
				want := "关"
				if mask&(1<<i) != 0 {
					want = "开"
				}
				if writes[key] != want {
					t.Fatalf("%s = %q; want %q", key, writes[key], want)
				}
			}
			if writes[paymentLegacyWithdrawKey] != fmt.Sprint(mask&3) {
				t.Fatal("legacy bank/Alipay mask not synchronized")
			}
			state := paymentConfigurationState{Channels: []paymentChannelConfig{{Name: "提现", IconType: paymentIconDefault, InfoFields: []string{}, Configured: true}}}
			applyPaymentWithdrawalValues(&state, writes)
			if !paymentStateMatchesRequest(state, input) {
				t.Fatal(paymentStateMismatchFields(state, input))
			}
			if state.USDTExchangeRate != "7.25" {
				t.Fatal("rate was not normalized/read back")
			}
			revision := paymentStateRevision(state)
			state.BankWithdrawalEnabled = !state.BankWithdrawalEnabled
			if paymentStateRevision(state) == revision || paymentStateMatchesRequest(state, input) {
				t.Fatal("bank switch missing from revision/readback")
			}
			state.BankWithdrawalEnabled = !state.BankWithdrawalEnabled
			state.AlipayWithdrawalEnabled = !state.AlipayWithdrawalEnabled
			if paymentStateMatchesRequest(state, input) {
				t.Fatal("Alipay switch missing from readback")
			}
			state.AlipayWithdrawalEnabled = !state.AlipayWithdrawalEnabled
			state.USDTWithdrawalEnabled = !state.USDTWithdrawalEnabled
			if paymentStateMatchesRequest(state, input) {
				t.Fatal("USDT switch missing from readback")
			}
			state.USDTWithdrawalEnabled = !state.USDTWithdrawalEnabled
			state.USDTExchangeRate = "8"
			if paymentStateMatchesRequest(state, input) {
				t.Fatal("rate missing from readback")
			}
			audit := paymentAuditSummary(input)
			if audit["bankWithdrawalEnabled"] != (mask&1 != 0) || audit["alipayWithdrawalEnabled"] != (mask&2 != 0) ||
				audit["usdtWithdrawalEnabled"] != (mask&4 != 0) || audit["usdtExchangeRate"] != "7.25" {
				t.Fatal("incomplete audit")
			}
		})
	}
}

func TestWithdrawalDefaultsAndLegacyCompatibility(t *testing.T) {
	for _, legacy := range []string{"", "0", "1", "2", "3", "invalid"} {
		values := map[string]string{paymentLegacyWithdrawKey: legacy}
		var state paymentConfigurationState
		applyPaymentWithdrawalValues(&state, values)
		if state.BankWithdrawalEnabled != (legacy == "1" || legacy == "3") || state.AlipayWithdrawalEnabled != (legacy == "2" || legacy == "3") || state.USDTWithdrawalEnabled {
			t.Fatalf("wrong legacy defaults for %q", legacy)
		}
		values[paymentBankEnabledKey] = "关"
		values[paymentAlipayEnabledKey] = "关"
		values[paymentUSDTEnabledKey] = "true"
		applyPaymentWithdrawalValues(&state, values)
		if state.BankWithdrawalEnabled || state.AlipayWithdrawalEnabled || state.USDTWithdrawalEnabled {
			t.Fatal("only explicit 开 enables a configured switch")
		}
	}
}

func TestUSDTRequiresValidConfiguredRate(t *testing.T) {
	for _, rate := range []string{"", "0", "-1", "NaN", "Inf", "Infinity", "1000001", "oops"} {
		input := updatePaymentConfigurationRequest{Channels: []paymentChannelConfig{{Name: "提现"}}, USDTWithdrawalEnabled: withdrawalBool(true), USDTExchangeRate: rate}
		if normalizeAndValidatePaymentRequest(&input) == nil {
			t.Fatalf("accepted bad rate %q", rate)
		}
	}
	input := updatePaymentConfigurationRequest{Channels: []paymentChannelConfig{{Name: "提现"}}, USDTWithdrawalEnabled: withdrawalBool(false)}
	if err := normalizeAndValidatePaymentRequest(&input); err != nil {
		t.Fatal("disabled USDT may leave rate empty", err)
	}
}

func TestPaymentUpdateRejectsMissingWithdrawalSwitches(t *testing.T) {
	// An old browser must not silently turn off methods when it saves unrelated fields.
	for _, omitted := range []string{"bankWithdrawalEnabled", "alipayWithdrawalEnabled", "usdtWithdrawalEnabled"} {
		body := map[string]any{"confirm": true, "bankWithdrawalEnabled": true, "alipayWithdrawalEnabled": true, "usdtWithdrawalEnabled": false}
		delete(body, omitted)
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest(http.MethodPut, "/api/configuration/payments", strings.NewReader(string(encoded)))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		(&Server{}).handleUpdatePaymentConfiguration(w, r, principal{})
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "WITHDRAWAL_SWITCHES_REQUIRED") {
			t.Fatalf("missing %s not rejected: %d %s", omitted, w.Code, w.Body.String())
		}
	}
}
