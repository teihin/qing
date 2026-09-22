import { useEffect, useRef, useState } from "react";
import { api, jsonBody } from "../api";
import { Button, EmptyState, Field, Modal, PageHeader } from "../components/ui";
import { beijingDateInput } from "../time";

type Agent = { playerId: string; name: string; role: string; enabled: boolean };
type Entry = { guuid: string; name: string; agent_id: string; my_performance: number; granted_performance: number; proxy_performance: number; rebate: number; granted_list: [string, string, number][] };
type Report = { date: string; all_performance: number; pool_performance: number; rebate_total: number; platform_keep: number; check_ok: boolean; count: number; list: Entry[] };
const money = (cents: number) => (cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const ratio = (cents: number, total: number) => `${(total > 0 ? cents * 100 / total : 0).toFixed(2)}%`;
// Neutralize spreadsheet formulas in server-supplied nicknames/IDs.
const csvCell = (value: unknown) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;

export default function JackpotPerformancePage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [filter, setFilter] = useState({ id: "", page: 1, revision: 0 });
  const [agents, setAgents] = useState<{ items: Agent[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [date, setDate] = useState(beijingDateInput(-1));
  const [query, setQuery] = useState({ date: beijingDateInput(-1), revision: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [search, setSearch] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const saveLock = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setAgents(null);
    api<{ items: Agent[]; total: number }>(`/api/game/jackpot/agents?${new URLSearchParams({ playerId: filter.id, page: String(filter.page), pageSize: "20" })}`)
      .then(value => { if (alive) setAgents(value); })
      .catch(reason => { if (alive) notify(reason instanceof Error ? reason.message : "查询失败", "error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filter, notify]);
  useEffect(() => {
    let alive = true;
    setReportLoading(true); setReport(null); setReportError("");
    api<Report>(`/api/game/jackpot/report?date=${encodeURIComponent(query.date)}`)
      .then(value => { if (alive) setReport(value); })
      .catch(reason => { if (alive) setReportError(reason instanceof Error ? reason.message : "报表加载失败"); })
      .finally(() => { if (alive) setReportLoading(false); });
    return () => { alive = false; };
  }, [query]);

  const save = async () => {
    if (!selected || saveLock.current) return;
    saveLock.current = true; setSaving(true);
    try {
      await api<Agent>(`/api/game/jackpot/agents/${encodeURIComponent(selected.playerId)}`, { method: "PUT", ...jsonBody({ enabled: !selected.enabled, expected: selected.enabled }) });
      notify("业绩权限已更新并确认生效");
    } catch (reason) { notify(reason instanceof Error ? reason.message : "设置失败，请刷新核对", "error"); }
    finally {
      saveLock.current = false; setSaving(false); setSelected(null); setReportPage(1);
      setFilter(value => ({ ...value, revision: value.revision + 1 }));
      setQuery(value => ({ ...value, revision: value.revision + 1 }));
    }
  };
  const entries = report?.list.filter(item => !search || item.guuid.includes(search) || item.name.includes(search)) ?? [];
  const exportReport = () => {
    if (!report) return;
    const rows: unknown[][] = [
      ["统计日", report.date, "对账", report.check_ok ? "通过" : "异常，需人工复核"],
      ["提留总额（元）", money(report.pool_performance), "应返款合计（元）", money(report.rebate_total), "平台保留（元）", money(report.platform_keep)],
      ["日期", "代理ID", "昵称", "上级ID", "毛业绩（元）", "下发（元）", "净业绩（元）", "业绩比例", "应返款（元）", "下发明细"],
      ...entries.map(item => [report.date, item.guuid, item.name, item.agent_id, money(item.my_performance), money(item.granted_performance), money(item.proxy_performance), ratio(item.proxy_performance, report.all_performance), money(item.rebate), item.granted_list.map(([id, name, amount]) => `${id} ${name} ${money(amount)}元`).join("；")]),
    ];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `奖池业绩-${report.date}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="page-stack jackpot-page">
    <PageHeader eyebrow="JACKPOT PERFORMANCE" title="奖池业绩" description="配置业绩入口，查询昨日或指定日期的代理业绩及线下应返款。"
      actions={<Button disabled={!can("game.jackpot.configure") || saving} title={can("game.jackpot.configure") ? "为现有玩家开通业绩权限" : "需要奖池业绩配置权限"} onClick={() => setAddOpen(true)}>＋ 新增开通人员</Button>} />
    {addOpen && <AddJackpotAgent onClose={() => setAddOpen(false)} onSaved={() => {
      setAddOpen(false); setPlayerId(""); setSelected(null); setFilter(value => ({ id: "", page: 1, revision: value.revision + 1 }));
      setReportPage(1); setQuery(value => ({ ...value, revision: value.revision + 1 })); notify("新增开通成功，已确认服务器生效");
    }} />}
    {!can("game.jackpot.configure") && <p className="jackpot-warning">当前账号仅有查询权限；请由超级管理员分配「配置业绩权限」后新增开通人员。</p>}
    <section className="panel jackpot-section">
      <h2>业绩开通配置</h2><p>开通后，玩家代理中心显示「业绩比例」。比例由服务器计算；关闭后入口隐藏，上级下发口径相应变化。</p>
      <form className="jackpot-filters" onSubmit={event => { event.preventDefault(); setFilter({ id: playerId.trim(), page: 1, revision: filter.revision + 1 }); }}>
        <Field label="玩家ID"><input value={playerId} maxLength={64} placeholder="输入完整玩家ID查询，留空显示已开通名单" onChange={event => setPlayerId(event.target.value)} /></Field>
        <Button type="submit" disabled={loading || saving}>查询状态</Button>
      </form>
      {loading ? <p>正在查询…</p> : agents && agents.items.length > 0 ? <>
        <div className="table-wrap"><table><thead><tr><th>玩家ID</th><th>昵称</th><th>身份</th><th>业绩入口</th>{can("game.jackpot.configure") && <th>配置</th>}</tr></thead><tbody>{agents.items.map(item => <tr key={item.playerId}><td>{item.playerId}</td><td>{item.name}</td><td>{item.role}</td><td>{item.enabled ? "已开通" : "未开通"}</td>{can("game.jackpot.configure") && <td><Button variant="secondary" disabled={saving} onClick={() => setSelected(item)}>{item.enabled ? "关闭业绩" : "开通业绩"}</Button></td>}</tr>)}</tbody></table></div>
        <div className="jackpot-pager"><Button variant="secondary" disabled={filter.page <= 1 || saving} onClick={() => setFilter(value => ({ ...value, page: value.page - 1 }))}>上一页</Button><span>{filter.page} / {Math.max(1, Math.ceil(agents.total / 20))} · 共 {agents.total} 人</span><Button variant="secondary" disabled={filter.page * 20 >= agents.total || saving} onClick={() => setFilter(value => ({ ...value, page: value.page + 1 }))}>下一页</Button></div>
      </> : agents && <EmptyState title={filter.id ? "未找到该玩家" : "暂无已开通玩家"} description="点击右上方「新增开通人员」，输入玩家ID并确认开通。" />}
      {selected && <div className="jackpot-confirm" role="alert"><strong>确认{selected.enabled ? "关闭" : "开通"} {selected.name}（{selected.playerId}）的业绩入口？</strong><p>此操作会影响该玩家入口及其上级业绩扣减口径。</p><Button disabled={saving} onClick={() => void save()}>{saving ? "正在核对结果…" : "确认配置"}</Button> <Button variant="secondary" disabled={saving} onClick={() => setSelected(null)}>取消</Button></div>}
    </section>
    <section className="panel jackpot-section">
      <h2>每日结算查询</h2>
      <form className="jackpot-filters" onSubmit={event => { event.preventDefault(); if (!date) return; setQuery(value => ({ date, revision: value.revision + 1 })); setReportPage(1); }}>
        <Field label="统计日期（北京时间）"><input type="date" required value={date} max={beijingDateInput()} onChange={event => setDate(event.target.value)} /></Field><Button type="submit" disabled={reportLoading}>查询报表</Button><Button variant="secondary" disabled={!report || reportLoading} onClick={exportReport}>导出当前查询</Button>
      </form>
      {reportLoading && <p>正在读取结算报表…</p>}{reportError && <p role="alert" className="jackpot-warning">{reportError}</p>}
      {report && <>
        <p><strong>统计日：{report.date}</strong> · 金额单位：元 · 已开通代理：{report.count}</p>
        <div className="jackpot-summary">{[["提留总额", report.pool_performance], ["应返款合计", report.rebate_total], ["平台保留", report.platform_keep]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{money(Number(value))}</strong></article>)}</div>
        <p className={report.check_ok ? "" : "jackpot-warning"}>{report.check_ok ? "对账检查通过；实际返款仍以平台每日对账为准。" : "对账异常：请先人工复核，再处理线下返款。"}</p>
        <Field label="筛选代理ID或昵称"><input value={search} onChange={event => { setSearch(event.target.value); setReportPage(1); }} placeholder="筛选当前日期报表" /></Field>
        {entries.length ? <div className="table-wrap"><table><thead><tr><th>代理 / 上级</th><th>我（毛）</th><th>下发</th><th>剩（净）</th><th>业绩比例</th><th>应返款</th><th>下发明细</th></tr></thead><tbody>{entries.slice((reportPage - 1) * 20, reportPage * 20).map(item => <tr key={item.guuid}><td><strong>{item.name}</strong><small className="cell-subtitle">ID {item.guuid} · 上级 {item.agent_id}</small></td><td>{money(item.my_performance)}</td><td>{money(item.granted_performance)}</td><td>{money(item.proxy_performance)}</td><td>{ratio(item.proxy_performance, report.all_performance)}</td><td><strong>{money(item.rebate)}</strong></td><td>{item.granted_list.length ? <details><summary>{item.granted_list.length} 位下级</summary>{item.granted_list.map(([id, name, amount]) => <p key={id}>{name}（{id}）· {money(amount)} 元 · {ratio(amount, report.all_performance)}</p>)}</details> : "无"}</td></tr>)}</tbody></table></div> : <EmptyState title="暂无匹配业绩" description="可更换日期或清空代理筛选条件。" />}
        <div className="jackpot-pager"><Button variant="secondary" disabled={reportPage <= 1} onClick={() => setReportPage(value => value - 1)}>上一页</Button><span>{reportPage} / {Math.max(1, Math.ceil(entries.length / 20))} · 共 {entries.length} 人</span><Button variant="secondary" disabled={reportPage * 20 >= entries.length} onClick={() => setReportPage(value => value + 1)}>下一页</Button></div>
      </>}
    </section>
  </div>;
}

function AddJackpotAgent({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState("");
  const [player, setPlayer] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const saveLock = useRef(false);
  useEffect(() => () => { sequence.current += 1; }, []);
  const lookup = async () => {
    const target = id.trim();
    if (!target || saveLock.current) return;
    const request = ++sequence.current;
    setLoading(true); setError(""); setPlayer(null);
    try {
      const result = await api<{ items: Agent[] }>(`/api/game/jackpot/agents?playerId=${encodeURIComponent(target)}`);
      if (request !== sequence.current) return;
      const found = result.items.find(item => item.playerId === target);
      if (!found) setError("未找到该玩家，请核对玩家ID。");
      else setPlayer(found);
    } catch (reason) {
      if (request === sequence.current) setError(reason instanceof Error ? reason.message : "查询失败，请重试");
    } finally { if (request === sequence.current) setLoading(false); }
  };
  const activate = async () => {
    if (!player || player.enabled || player.playerId !== id.trim() || saveLock.current) return;
    saveLock.current = true; setSaving(true); setError("");
    try {
      await api<Agent>(`/api/game/jackpot/agents/${encodeURIComponent(player.playerId)}`, { method: "PUT", ...jsonBody({ enabled: true, expected: false }) });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "开通未确认，请重新查询状态");
      setPlayer(null);
    } finally { saveLock.current = false; setSaving(false); }
  };
  return <Modal title="新增开通人员" onClose={() => { if (!saveLock.current) onClose(); }}>
    <p>为现有玩家开通「业绩比例」入口。输入玩家ID，核对昵称和身份后确认开通。</p>
    <form className="jackpot-filters" onSubmit={event => { event.preventDefault(); void lookup(); }}>
      <Field label="待开通玩家ID"><input autoFocus required maxLength={64} value={id} disabled={saving} placeholder="请输入完整玩家ID" onChange={event => {
        sequence.current += 1; setLoading(false); setId(event.target.value); setPlayer(null); setError("");
      }} /></Field>
      <Button type="submit" variant="secondary" disabled={!id.trim() || loading || saving}>{loading ? "查询中…" : "核对玩家"}</Button>
    </form>
    {error && <p role="alert" className="jackpot-warning">{error}</p>}
    {player && <div className="jackpot-confirm">
      <strong>{player.name || "未设置昵称"}（ID：{player.playerId}）</strong>
      <p>身份：{player.role || "未设置"} · {player.enabled ? "已开通，无需重复开通" : "当前未开通"}</p>
      {!player.enabled && <p>开通后，该玩家客户端将显示业绩比例，其上级业绩扣减口径会相应变化。</p>}
    </div>}
    <div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button><Button disabled={!player || player.enabled || loading || saving} onClick={() => void activate()}>{saving ? "正在开通并核对…" : "确认开通"}</Button></div>
  </Modal>;
}
