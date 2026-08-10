import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import type { PaymentChannelConfig, PaymentConfigurationState } from "../types";

const commonInfoFields = ["姓名", "手机"];
const cloneState = (value: PaymentConfigurationState) => structuredClone(value);

export default function PaymentConfigurationPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<PaymentConfigurationState | null>(null);
  const [draft, setDraft] = useState<PaymentConfigurationState | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<PaymentConfigurationState>("/api/configuration/payments");
      setOriginal(result); setDraft(cloneState(result)); setSelectedName((current) => current || result.channels[0]?.name || ""); setConfirmed(false);
    } catch (reason) { notify(reason instanceof ApiError ? reason.message : "支付配置加载失败", "error"); } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const selectedIndex = draft?.channels.findIndex((item) => item.name === selectedName) ?? -1;
  const selected = selectedIndex >= 0 ? draft?.channels[selectedIndex] : undefined;
  const dirty = Boolean(original && draft && JSON.stringify(stripMeta(original)) !== JSON.stringify(stripMeta(draft)));
  const changeCount = useMemo(() => countPaymentChanges(original, draft), [original, draft]);
  const updateChannel = (patch: Partial<PaymentChannelConfig>) => setDraft((current) => {
    if (!current) return current;
    const next = cloneState(current);
    const index = next.channels.findIndex((item) => item.name === selectedName);
    if (index >= 0) next.channels[index] = { ...next.channels[index], ...patch };
    return next;
  });
  const updateGlobal = <K extends keyof PaymentConfigurationState>(key: K, value: PaymentConfigurationState[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!draft || !original) return;
    setBusy(true);
    try {
      const result = await api<PaymentConfigurationState>("/api/configuration/payments", { method: "PUT", ...jsonBody({ ...stripMeta(draft), revision: original.revision, confirm: confirmed }) });
      setOriginal(result); setDraft(cloneState(result)); setConfirmed(false); notify("支付通道配置已保存并完成游戏端格式校验");
    } catch (reason) { notify(reason instanceof ApiError ? reason.message : "支付配置保存失败", "error"); } finally { setBusy(false); }
  };

  if (loading && !draft) return <div className="panel"><LoadingBlock label="正在读取支付通道配置" /></div>;
  if (!draft || !original) return <EmptyState title="支付配置无法显示" description="请稍后刷新页面重试。" />;
  const enabledCount = draft.channels.filter((item) => item.enabled).length;
  return <div className="page-stack payment-page">
    <PageHeader eyebrow="PAYMENT CHANNELS" title="支付通道配置" description="按运营视角配置通道入口、金额、玩家资料和展示文字；保存后自动转换为客户端现有格式。" actions={<Button variant="secondary" onClick={() => void load()}>重新读取</Button>} />
    <section className="configuration-summary-strip"><div><span>通道总数</span><strong>{draft.channels.length}</strong></div><div><span>当前启用</span><strong>{enabledCount}</strong></div><div><span>支付地址</span><strong>{draft.paymentDomain ? "已配置" : "未配置"}</strong></div><div><span>待保存变更</span><strong>{changeCount}</strong></div></section>
    <section className="payment-workspace">
      <aside className="panel payment-channel-nav"><header><div><h2>通道总览</h2><p>点击通道编辑详细规则</p></div></header><div>{draft.channels.map((channel) => <button type="button" key={channel.name} className={channel.name === selectedName ? "is-active" : ""} onClick={() => setSelectedName(channel.name)}><span><i className={channel.enabled ? "is-on" : ""} />{channel.name}</span><small>{channel.encodingError ? "原配置异常" : channel.enabled ? "已启用" : "已停用"}</small></button>)}</div></aside>
      <div className="payment-editor-stack">
        {selected && <section className="panel payment-channel-editor"><header className="configuration-card-heading"><div><span className="eyebrow">CHANNEL SETTINGS</span><h2>{selected.name}</h2><p>玩家在钱包中选择此通道后，会按下面规则展示和提交。</p></div><label className="switch-control"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateChannel({ enabled: event.target.checked })} /><span /><strong>{selected.enabled ? "通道已启用" : "通道已停用"}</strong></label></header>{selected.encodingError && <div className="form-error"><span>!</span>原支付配置无法解析。请核对本页全部字段后保存，新配置会替换异常内容。</div>}<div className="configuration-section"><h3>1. 玩家可选金额</h3><p>固定金额使用英文逗号分隔，后台会按客户端实际展示顺序保存。</p><Field label="固定金额（元）" hint="例如：100,200,500,1000"><input value={selected.presetAmounts} onChange={(event) => updateChannel({ presetAmounts: event.target.value })} placeholder="100,200,500" /></Field><div className="amount-preview">{selected.presetAmounts.split(",").map((item) => item.trim()).filter(Boolean).map((item, index) => <span key={`${item}-${index}`}>{item} 元</span>)}</div><label className="switch-row"><div><strong>允许玩家自行输入金额</strong><small>开启后必须设置最小和最大金额</small></div><input type="checkbox" checked={selected.allowCustom} onChange={(event) => updateChannel({ allowCustom: event.target.checked })} /></label>{selected.allowCustom && <div className="two-column-fields"><Field label="最小金额（元）"><input type="number" min="0" step="0.01" value={selected.customMin} onChange={(event) => updateChannel({ customMin: event.target.value })} /></Field><Field label="最大金额（元）"><input type="number" min="0" step="0.01" value={selected.customMax} onChange={(event) => updateChannel({ customMax: event.target.value })} /></Field></div>}</div>
          <div className="configuration-section"><h3>2. 玩家资料</h3><label className="switch-row"><div><strong>支付前要求填写资料</strong><small>适合人工充值、线下转账等需要核对身份的通道</small></div><input type="checkbox" checked={selected.needsInfo} onChange={(event) => updateChannel({ needsInfo: event.target.checked })} /></label>{selected.needsInfo && <div className="check-chip-list">{commonInfoFields.map((field) => <label key={field}><input type="checkbox" checked={selected.infoFields.includes(field)} onChange={(event) => updateChannel({ infoFields: event.target.checked ? [...selected.infoFields, field] : selected.infoFields.filter((item) => item !== field) })} /><span>{field}</span></label>)}</div>}</div>
          <div className="configuration-section"><h3>3. 玩家看到的说明</h3><Field label="通道提示文字" hint="显示在充值页面，建议写清到账时间、客服核对要求"><textarea rows={4} value={selected.displayText} onChange={(event) => updateChannel({ displayText: event.target.value })} placeholder="请输入该通道的操作说明" /></Field>{selected.name === "提现" && <Field label="可选银行" hint="每行一个银行，后台会自动转换为客户端 # 分隔格式"><textarea rows={7} value={selected.banks.replaceAll("#", "\n")} onChange={(event) => updateChannel({ banks: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean).join("#") + (event.target.value.trim() ? "#" : "") })} placeholder="中国工商银行&#10;中国建设银行" /></Field>}</div>
        </section>}
        <section className="panel payment-global-settings"><header className="configuration-card-heading"><div><span className="eyebrow">GLOBAL PAYMENT</span><h2>全局支付与提现设置</h2><p>这些内容由钱包页面直接读取，对所有支付通道生效。</p></div></header><div className="configuration-section"><Field label="支付服务地址" hint="必须是完整的 http:// 或 https:// 地址"><input value={draft.paymentDomain} onChange={(event) => updateGlobal("paymentDomain", event.target.value)} placeholder="http://pay.example.com" /></Field><label className="switch-row"><div><strong>银联提现要求填写支行</strong><small>启用后玩家提交银行卡提现时需要补充开户支行</small></div><input type="checkbox" checked={draft.requireBankBranch} onChange={(event) => updateGlobal("requireBankBranch", event.target.checked)} /></label><div className="withdrawal-copy-grid"><Field label="支付宝提现说明"><textarea rows={4} value={draft.alipayWithdrawalText} onChange={(event) => updateGlobal("alipayWithdrawalText", event.target.value)} /></Field><Field label="银联提现说明"><textarea rows={4} value={draft.unionWithdrawalText} onChange={(event) => updateGlobal("unionWithdrawalText", event.target.value)} /></Field><Field label="USDT 提现说明"><textarea rows={4} value={draft.usdtWithdrawalText} onChange={(event) => updateGlobal("usdtWithdrawalText", event.target.value)} /></Field></div></div></section>
      </div>
    </section>
    <section className={`configuration-savebar ${dirty ? "is-dirty" : ""}`}><div><strong>{dirty ? `共有 ${changeCount} 处待保存修改` : "当前内容与游戏配置一致"}</strong><p>保存会整体校验、写入并回读；发现其他管理员已修改时会拒绝覆盖。</p></div><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!dirty} /><span>我已核对启用通道和玩家展示内容</span></label><Button variant="secondary" disabled={!dirty || busy} onClick={() => { setDraft(cloneState(original)); setConfirmed(false); }}>放弃修改</Button><Button disabled={!dirty || !confirmed || busy || !can("configuration.payment.update")} onClick={() => void save()}>{busy ? "正在保存并校验…" : "保存全部支付配置"}</Button></section>
  </div>;
}

function stripMeta(state: PaymentConfigurationState) {
  return { channels: state.channels, paymentDomain: state.paymentDomain, requireBankBranch: state.requireBankBranch, alipayWithdrawalText: state.alipayWithdrawalText, unionWithdrawalText: state.unionWithdrawalText, usdtWithdrawalText: state.usdtWithdrawalText };
}

function countPaymentChanges(before: PaymentConfigurationState | null, after: PaymentConfigurationState | null) {
  if (!before || !after) return 0;
  let count = 0;
  const beforeGlobal = stripMeta(before); const afterGlobal = stripMeta(after);
  for (const key of ["paymentDomain", "requireBankBranch", "alipayWithdrawalText", "unionWithdrawalText", "usdtWithdrawalText"] as const) if (beforeGlobal[key] !== afterGlobal[key]) count++;
  for (let index = 0; index < after.channels.length; index++) if (JSON.stringify(before.channels[index]) !== JSON.stringify(after.channels[index])) count++;
  return count;
}
