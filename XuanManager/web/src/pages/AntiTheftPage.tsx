import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, formatDate, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import type { AntiTheftAccountItem, AntiTheftAccountsResponse } from "../types";

const reasonOptions = [
  { value: "DEVICE_LOST", label: "原设备丢失或损坏" },
  { value: "BROWSER_DATA_CLEARED", label: "网页版数据被清除" },
  { value: "DEVICE_REPLACED", label: "玩家更换设备" },
  { value: "OTHER", label: "其他已核实原因" },
] as const;

const platformNames: Record<string, string> = { android: "Android", ios: "iOS", web: "网页版" };

export default function AntiTheftPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<AntiTheftAccountsResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [platform, setPlatform] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<AntiTheftAccountItem | null>(null);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (appliedKeyword) params.set("keyword", appliedKeyword);
      if (status) params.set("status", status);
      if (platform) params.set("platform", platform);
      const result = await api<AntiTheftAccountsResponse>(`/api/game/anti-theft?${params.toString()}`);
      setData(result);
      if (result.total > 0 && page > Math.ceil(result.total / pageSize)) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
    } catch (cause) {
      notify(errorMessage(cause, "防盗号账号加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, notify, page, pageSize, platform, queryRevision, status]);

  useEffect(() => { void load(); }, [load]);

  const search = () => { setAppliedKeyword(keyword.trim()); setPage(1); refreshQuery(); };
  const reset = () => { setKeyword(""); setAppliedKeyword(""); setStatus(""); setPlatform(""); setPage(1); refreshQuery(); };
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;
  const hasFilters = Boolean(appliedKeyword || status || platform);

  return <div className="page-stack anti-theft-page">
    <PageHeader eyebrow="DEVICE BINDING CONTROL" title="防盗号管理" description="查看玩家的本机登录绑定状态；仅在客服完成身份核验后解除绑定。" actions={<span className="configuration-status is-live"><i />KB 状态回读</span>} />

    <section className="panel anti-theft-overview">
      <div className="anti-theft-overview__mark">盾</div>
      <div><span>ACCOUNT DEVICE PROTECTION</span><h2>账号与设备绑定</h2><p>开启后，账号只能携带匹配设备标识登录。后台不会展示完整设备 ID，解绑也只通过 KB 服务命令执行。</p></div>
      <div className="anti-theft-overview__warning"><strong>客服操作要求</strong><span>核对玩家身份和账号信息；不要在核验说明中填写密码、验证码等敏感信息。</span></div>
    </section>

    <section className="panel anti-theft-list-panel">
      <form className="anti-theft-toolbar" onSubmit={submitGuard(async () => search())}>
        <label className="anti-theft-keyword"><span>查询账号</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家 ID、登录账号或昵称" /></label>
        <label><span>绑定状态</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="enabled">已开启</option><option value="disabled">未开启</option></select></label>
        <label><span>设备平台</span><select value={platform} onChange={(event) => { setPlatform(event.target.value); setPage(1); }}><option value="">全部平台</option><option value="android">Android</option><option value="ios">iOS</option><option value="web">网页版</option></select></label>
        <div className="anti-theft-toolbar__actions"><Button type="submit">查询</Button>{hasFilters && <Button type="button" variant="secondary" onClick={reset}>清空</Button>}</div>
      </form>

      {loading && !data ? <LoadingBlock label="正在读取防盗号状态" /> : !data || data.items.length === 0 ? <EmptyState title={hasFilters ? "没有匹配账号" : "暂无注册账号"} description={hasFilters ? "请调整或清空查询条件。" : "KB 注册数据中暂时没有账号。"} /> : <>
        <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
          <table className="anti-theft-table"><thead><tr><th>玩家</th><th>登录账号 / 注册（北京时间）</th><th>防盗号</th><th>绑定设备</th><th>绑定记录（北京时间）</th><th className="align-right">操作</th></tr></thead><tbody>{data.items.map((item) => <AntiTheftRow key={item.registrationId} item={item} canUnbind={can("game.anti_theft.unbind")} onUnbind={setUnbindTarget} />)}</tbody></table>
        </div>
        <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 个注册账号</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </>}
    </section>

    {unbindTarget && <AntiTheftUnbindModal item={unbindTarget} notify={notify} onClose={() => setUnbindTarget(null)} onDone={async () => { setUnbindTarget(null); await load(); }} />}
  </div>;
}

function AntiTheftRow({ item, canUnbind, onUnbind }: { item: AntiTheftAccountItem; canUnbind: boolean; onUnbind: (item: AntiTheftAccountItem) => void }) {
  return <tr>
    <td><div className="user-cell"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId || "等待创建"}</small></div></div></td>
    <td><code>{item.loginName}</code><small className="cell-subtitle">注册：{formatDate(item.registrationAt)}</small></td>
    <td><span className={`anti-theft-state ${item.enabled ? "is-enabled" : "is-disabled"}`}><i />{item.enabled ? "已开启" : "未开启"}</span>{!item.stateHealthy && <small className="cell-subtitle anti-theft-state-error">绑定数据异常</small>}</td>
    <td>{item.enabled ? <><strong>{platformNames[item.devicePlatform] || "未知平台"}</strong><code className="anti-theft-device-id">{item.deviceMasked || "设备 ID 缺失"}</code></> : <span>—</span>}</td>
    <td>{item.enabled ? <><strong>{formatDate(item.boundAt)}</strong><small className="cell-subtitle">版本 {item.deviceVersion} · 变更 {item.bindingRevision}</small></> : <><span>未绑定</span><small className="cell-subtitle">最近登录：{formatDate(item.lastLoginAt)}</small></>}</td>
    <td><div className="row-actions row-actions--right">{item.enabled && canUnbind ? <button className="anti-theft-unbind-button" type="button" onClick={() => onUnbind(item)}>客服解绑</button> : <span className="readonly-badge"><i />{item.enabled ? "仅查看" : "无需解绑"}</span>}</div></td>
  </tr>;
}

function AntiTheftUnbindModal({ item, notify, onClose, onDone }: { item: AntiTheftAccountItem; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onDone: () => Promise<void> }) {
  const [reasonCode, setReasonCode] = useState<(typeof reasonOptions)[number]["value"]>("DEVICE_LOST");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasonLength = Array.from(reason.trim()).length;
  const valid = reasonLength >= 2 && reasonLength <= 120;
  const submit = async () => {
    if (!valid || !confirmed) { notify("请填写身份核验说明并确认解绑影响", "error"); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>(`/api/game/anti-theft/${encodeURIComponent(item.playerId)}/unbind`, { method: "POST", ...jsonBody({ reasonCode, reason: reason.trim(), confirm: true }) });
      notify(result.message);
      await onDone();
    } catch (cause) {
      notify(errorMessage(cause, "防盗号解绑失败"), "error");
      setBusy(false);
    }
  };
  return <Modal eyebrow="CUSTOMER SERVICE UNBIND" title="解除防盗号绑定" onClose={busy ? () => undefined : onClose}>
    <form className="anti-theft-unbind-form" onSubmit={submitGuard(submit)}>
      <div className="anti-theft-unbind-summary"><span>盾</span><div><strong>{item.name || "玩家"}（{item.playerId}）</strong><small>{platformNames[item.devicePlatform] || "未知平台"} · {item.deviceMasked}</small></div></div>
      <p className="anti-theft-unbind-notice">解绑成功后，账号可在其他设备登录并重新开启防盗号。此操作不可由 XuanManager 直接改表，会提交 KB 命令并等待状态回读。</p>
      <label className="field"><span className="field__label">解绑原因</span><select value={reasonCode} disabled={busy} onChange={(event) => { setReasonCode(event.target.value as typeof reasonCode); setConfirmed(false); }}>{reasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="field"><span className="field__label">身份核验说明</span><textarea rows={3} maxLength={120} value={reason} disabled={busy} placeholder="例如：已核对注册信息和历史登录资料" onChange={(event) => { setReason(event.target.value.replace(/[\r\n]/g, " ")); setConfirmed(false); }} /><span className={`field__hint ${reason && !valid ? "is-error" : ""}`}>{reasonLength} / 120 字，至少 2 字；请勿填写密码或验证码</span></label>
      <label className={`ban-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认已完成玩家身份核验</strong><small>我已核对玩家 ID 和绑定信息，确认需要解除当前设备限制。</small></span></label>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="danger" disabled={!valid || !confirmed || busy}>{busy ? "正在提交并回读…" : "确认解绑"}</Button></div>
    </form>
  </Modal>;
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}
