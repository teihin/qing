import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import type { PaymentChannelConfig, PaymentConfigurationState } from "../types";

const commonInfoFields = ["姓名", "手机"];
const paymentIconOptions: Array<{ value: PaymentChannelConfig["iconType"]; label: string; hint: string; mark: string }> = [
  { value: "default", label: "客户端默认", hint: "旧配置兼容", mark: "默认" },
  { value: "alipay", label: "支付宝", hint: "官方蓝色", mark: "支" },
  { value: "unionpay", label: "银联", hint: "红蓝青配色", mark: "银联" },
  { value: "wechat", label: "微信", hint: "官方绿色", mark: "微信" },
  { value: "other", label: "其他支付", hint: "通用支付图标", mark: "其他" },
];
const defaultBankNames = [
  "中国建设银行", "中国邮政储蓄银行", "中国工商银行", "中国银行", "兴业银行", "中国农业银行", "中国光大银行",
  "广发银行", "平安银行", "交通银行", "中国民生银行", "招商银行", "浦发银行", "华夏银行",
];
const cloneState = (value: PaymentConfigurationState) => structuredClone(value);
const parseBanks = (value: string) => value.split("#").map((item) => item.trim()).filter(Boolean);
const serializeBanks = (values: string[]) => values.length ? `${values.map((item) => item.trim()).filter(Boolean).join("#")}#` : "";

type EditingBank = { channelName: string; index: number; value: string } | null;

export default function PaymentConfigurationPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<PaymentConfigurationState | null>(null);
  const [draft, setDraft] = useState<PaymentConfigurationState | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [editingBank, setEditingBank] = useState<EditingBank>(null);

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
  const selectedBanks = useMemo(() => parseBanks(selected?.banks ?? ""), [selected?.banks]);
  const canUpdate = can("configuration.payment.update");
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
  const updateBanks = (values: string[]) => updateChannel({ banks: serializeBanks(values) });
  const selectChannel = (name: string) => {
    setSelectedName(name);
    setNewBankName("");
    setEditingBank(null);
  };
  const initializeBanks = () => {
    const existing = new Set(selectedBanks);
    const missing = defaultBankNames.filter((name) => !existing.has(name));
    if (!missing.length) {
      notify(`${selectedName} 已包含全部常用银行`);
      return;
    }
    const appended = missing.slice(0, Math.max(0, 50 - selectedBanks.length));
    updateBanks([...selectedBanks, ...appended]);
    notify(`${selectedName} 已补充 ${appended.length} 家常用银行，请保存后生效`);
  };
  const addBank = () => {
    const name = newBankName.trim();
    const error = validateBankName(name, selectedBanks);
    if (error) {
      notify(error, "error");
      return;
    }
    updateBanks([...selectedBanks, name]);
    setNewBankName("");
  };
  const startEditBank = (index: number) => setEditingBank({ channelName: selectedName, index, value: selectedBanks[index] });
  const saveEditedBank = () => {
    if (!editingBank || editingBank.channelName !== selectedName) return;
    const name = editingBank.value.trim();
    const error = validateBankName(name, selectedBanks.filter((_, index) => index !== editingBank.index));
    if (error) {
      notify(error, "error");
      return;
    }
    const next = [...selectedBanks];
    next[editingBank.index] = name;
    updateBanks(next);
    setEditingBank(null);
  };
  const removeBank = (index: number) => {
    updateBanks(selectedBanks.filter((_, itemIndex) => itemIndex !== index));
    setEditingBank(null);
  };
  const moveBank = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= selectedBanks.length) return;
    const next = [...selectedBanks];
    [next[index], next[target]] = [next[target], next[index]];
    updateBanks(next);
    setEditingBank(null);
  };
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
      <aside className="panel payment-channel-nav"><header><div><h2>通道总览</h2><p>点击通道编辑详细规则</p></div></header><div>{draft.channels.map((channel) => <button type="button" key={channel.name} className={channel.name === selectedName ? "is-active" : ""} onClick={() => selectChannel(channel.name)}><span><i className={channel.enabled ? "is-on" : ""} />{channel.name}</span><small>{channel.encodingError ? "原配置异常" : paymentIconLabel(channel.iconType)}</small></button>)}</div></aside>
      <div className="payment-editor-stack">
        {selected && <section className="panel payment-channel-editor"><header className="configuration-card-heading"><div><span className="eyebrow">CHANNEL SETTINGS</span><h2>{selected.name}</h2><p>玩家在钱包中选择此通道后，会按下面规则展示和提交。</p></div><label className="switch-control"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateChannel({ enabled: event.target.checked })} /><span /><strong>{selected.enabled ? "通道已启用" : "通道已停用"}</strong></label></header>{selected.encodingError && <div className="form-error"><span>!</span>原支付配置无法解析。请核对本页全部字段后保存，新配置会替换异常内容。</div>}<div className="configuration-section"><h3>1. 玩家端通道图标</h3><p>选择该通道在游戏充值页面显示的品牌图标；保存后客户端会按通道配置动态替换。</p><div className="payment-icon-picker">{paymentIconOptions.map((option) => <label key={option.value} className={selected.iconType === option.value ? "is-selected" : ""}><input type="radio" name={`payment-icon-${selected.name}`} checked={selected.iconType === option.value} disabled={!canUpdate} onChange={() => updateChannel({ iconType: option.value })} /><span className={`payment-icon-preview payment-icon-preview--${option.value}`}><b>{option.mark}</b></span><strong>{option.label}</strong><small>{option.hint}</small></label>)}</div></div><div className="configuration-section"><h3>2. 玩家可选金额</h3><p>固定金额使用英文逗号分隔，后台会按客户端实际展示顺序保存。</p><Field label="固定金额（元）" hint="例如：100,200,500,1000"><input value={selected.presetAmounts} onChange={(event) => updateChannel({ presetAmounts: event.target.value })} placeholder="100,200,500" /></Field><div className="amount-preview">{selected.presetAmounts.split(",").map((item) => item.trim()).filter(Boolean).map((item, index) => <span key={`${item}-${index}`}>{item} 元</span>)}</div><label className="switch-row"><div><strong>允许玩家自行输入金额</strong><small>开启后必须设置最小和最大金额</small></div><input type="checkbox" checked={selected.allowCustom} onChange={(event) => updateChannel({ allowCustom: event.target.checked })} /></label>{selected.allowCustom && <div className="two-column-fields"><Field label="最小金额（元）"><input type="number" min="0" step="0.01" value={selected.customMin} onChange={(event) => updateChannel({ customMin: event.target.value })} /></Field><Field label="最大金额（元）"><input type="number" min="0" step="0.01" value={selected.customMax} onChange={(event) => updateChannel({ customMax: event.target.value })} /></Field></div>}</div>
          <div className="configuration-section"><h3>3. 玩家资料</h3><label className="switch-row"><div><strong>支付前要求填写资料</strong><small>适合人工充值、线下转账等需要核对身份的通道</small></div><input type="checkbox" checked={selected.needsInfo} onChange={(event) => updateChannel({ needsInfo: event.target.checked })} /></label>{selected.needsInfo && <div className="check-chip-list">{commonInfoFields.map((field) => <label key={field}><input type="checkbox" checked={selected.infoFields.includes(field)} onChange={(event) => updateChannel({ infoFields: event.target.checked ? [...selected.infoFields, field] : selected.infoFields.filter((item) => item !== field) })} /><span>{field}</span></label>)}</div>}</div>
          <div className="configuration-section"><h3>4. 玩家看到的说明</h3><Field label="通道提示文字" hint="显示在充值页面，建议写清到账时间、客服核对要求"><textarea rows={4} value={selected.displayText} onChange={(event) => updateChannel({ displayText: event.target.value })} placeholder="请输入该通道的操作说明" /></Field></div>
          <div className="configuration-section payment-bank-section">
            <div className="payment-bank-heading">
              <div><h3>5. 可选银行</h3><p>{selected.name === "提现" ? "玩家选择银行卡提现时读取此列表。" : "玩家在本充值通道填写银行卡资料时读取此列表。"} 当前共 {selectedBanks.length} 家，顺序即客户端展示顺序。</p></div>
              <Button type="button" variant="secondary" disabled={!canUpdate || selectedBanks.length >= 50} onClick={initializeBanks}>初始化常用银行</Button>
            </div>
            <div className="payment-bank-add">
              <input value={newBankName} maxLength={40} disabled={!canUpdate || selectedBanks.length >= 50} onChange={(event) => setNewBankName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addBank(); } }} placeholder="输入银行名称，例如：中国工商银行" />
              <Button type="button" disabled={!canUpdate || selectedBanks.length >= 50} onClick={addBank}>新增银行</Button>
            </div>
            {selectedBanks.length === 0 ? <div className="payment-bank-empty"><strong>还没有配置银行</strong><p>可以一键初始化客户端原有的 14 家常用银行，也可以逐项新增。</p></div> : <ol className="payment-bank-list">
              {selectedBanks.map((bank, index) => {
                const isEditing = editingBank?.channelName === selectedName && editingBank.index === index;
                return <li key={`${bank}-${index}`}>
                  <span className="payment-bank-order">{index + 1}</span>
                  {isEditing ? <input className="payment-bank-edit-input" autoFocus maxLength={40} value={editingBank.value} onChange={(event) => setEditingBank({ ...editingBank, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") saveEditedBank(); if (event.key === "Escape") setEditingBank(null); }} /> : <strong>{bank}</strong>}
                  <div className="payment-bank-actions">
                    {isEditing ? <><button type="button" onClick={saveEditedBank}>保存</button><button type="button" onClick={() => setEditingBank(null)}>取消</button></> : <><button type="button" disabled={!canUpdate || index === 0} onClick={() => moveBank(index, -1)} aria-label={`上移${bank}`}>↑</button><button type="button" disabled={!canUpdate || index === selectedBanks.length - 1} onClick={() => moveBank(index, 1)} aria-label={`下移${bank}`}>↓</button><button type="button" disabled={!canUpdate} onClick={() => startEditBank(index)}>修改</button><button type="button" className="is-danger" disabled={!canUpdate} onClick={() => removeBank(index)}>删除</button></>}
                  </div>
                </li>;
              })}
            </ol>}
            <p className="payment-bank-footnote">此处直接维护每个充值或提现通道自己的银行列表；页面保存时仍会转换为客户端兼容的 <code>bank</code> 字段并回读核对。</p>
          </div>
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

function validateBankName(value: string, existing: string[]) {
  if (!value) return "请输入银行名称";
  if (value.length > 40) return "银行名称不能超过 40 个字符";
  if (value.includes("#") || [...value].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) return "银行名称不能包含 # 或控制字符";
  if (existing.includes(value)) return `银行列表中已存在“${value}”`;
  return "";
}

function paymentIconLabel(value: PaymentChannelConfig["iconType"]) {
  return paymentIconOptions.find((option) => option.value === value)?.label ?? "客户端默认";
}
