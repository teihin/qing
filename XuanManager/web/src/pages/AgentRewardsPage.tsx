import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import { beijingDateInput } from "../time";

type Kind = "performance" | "core" | "pool";
type Perf = { my: number; granted: number; net: number };
type Line = { todayScore: number; totalScore: number; yesterdayScore: number; todayContrib: number; totalContrib: number; teamCount: number };
type Split = { payee: string; payeeName?: string; type: "main" | "sub"; amount: number };
type Sub = { subId: string; subName: string; note: string };
type Member = {
  agentId: string; name: string; role: string; level: number; upperId: string; clubId: string;
  clubName: string; unionId: string; unionName: string;
  authorized: boolean; selected: boolean; source: string; perf: Perf | null; line: Line | null;
  amount: number; splits: Split[]; subs: Sub[]; paidAmount: number;
};
type Excluded = { agentId: string; name: string; kind: string; reason: string; operator: string; at: string };
type Overview = {
  plan: { date: string; kind: Kind; plannedTotal: number; status: string };
  members: Member[];
  excluded: Excluded[];
  totals: { amount: number; count: number; planned: number; diff: number; points: number; excluded: number; pool: number };
  warnings: string[];
};
type LedgerRow = {
  id: number; date: string; kind: Kind; agentId: string; agentName: string; payee: string;
  payeeType: string; amount: number; order: string; status: string; error: string; paidAt: string;
};
type PayResult = { total: number; paid: number; failed: number; skipped: number; status: string; orders: string[]; errors: string[] };

const KIND_LABEL: Record<Kind, string> = { performance: "业绩奖励", core: "核心奖励", pool: "奖池共享" };
// 与游戏内「代理中心」一致的角色名：大盟主 / 盟主 / 小盟主 / 合伙人 / 代理
const ROLE_LABEL: Record<string, string> = { grand: "大盟主", leader: "盟主", small_leader: "小盟主", partner: "合伙人", agent: "代理" };

const num = (value: number) => (value || 0).toLocaleString("zh-CN");
const pt = (value: number | null | undefined) => (typeof value === "number" ? value.toFixed(2) : "0.00");
const money2 = (value: number) => (value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 防止表格公式注入
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;

export default function AgentRewardsPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [kind, setKind] = useState<Kind>("performance");
  const [date, setDate] = useState(beijingDateInput(0));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [splits, setSplits] = useState<Record<string, Split[]>>({});
  const [planTotal, setPlanTotal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [unionFilter, setUnionFilter] = useState("all");
  const [clubFilter, setClubFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [lineOpen, setLineOpen] = useState<Member | null>(null);
  const [subOpen, setSubOpen] = useState<Member | null>(null);
  const [excludeOpen, setExcludeOpen] = useState<{ member: Member; scope: string; reason: string } | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listRev, setListRev] = useState(0);
  const [addId, setAddId] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const editable = Boolean(can("game.agent_reward.edit")) && data?.plan.status !== "paid" && data?.plan.status !== "paying";
  const canPay = Boolean(can("game.agent_reward.pay"));

  const autoSynced = useRef(false);
  const hasData = useRef(false);
  // keepDraft=true 表示这是一次静默刷新：保留页面上已经输入但还没保存的金额与拆分，
  // 只把服务端的新数据补进来，避免刷新时把客服正在填的数字冲掉。
  const applyData = useCallback((value: Overview, keepDraft: boolean) => {
    setData(value);
    setPlanTotal(value.plan.plannedTotal);
    setDraft(prev => {
      const next: Record<string, number> = {};
      value.members.forEach(m => {
        next[m.agentId] = keepDraft && m.agentId in prev ? prev[m.agentId] : m.amount;
      });
      return next;
    });
    setSplits(prev => {
      const next: Record<string, Split[]> = {};
      value.members.forEach(m => {
        if (keepDraft && prev[m.agentId]) next[m.agentId] = prev[m.agentId];
        else if (m.splits.length) next[m.agentId] = m.splits;
      });
      return next;
    });
    if (!keepDraft) {
      setDirty(false);
      setSelected({});
    }
  }, []);

  const load = useCallback(async (targetDate: string, targetKind: Kind, silent = false, resetDraft = false) => {
    // 只有第一次进页面才铺 loading；后续刷新一律就地更新，不把表格清空重画。
    const firstLoad = !hasData.current;
    if (!silent && firstLoad) setLoading(true);
    const url = `/api/game/agent-rewards?${new URLSearchParams({ date: targetDate, kind: targetKind })}`;
    try {
      const value = await api<Overview>(url);
      applyData(value, !firstLoad && !resetDraft);
      hasData.current = true;
      // 首次进入且名单为空时自动同步一次候选池，避免新部署后看到空白页。
      if (value.members.length === 0 && !autoSynced.current && can("game.agent_reward.edit")) {
        autoSynced.current = true;
        try {
          await api("/api/game/agent-rewards/sync", { method: "POST", ...jsonBody({}) });
          applyData(await api<Overview>(url), true);
        } catch {
          // 同步失败就保持空名单，用户可以手动点「同步名单」重试。
        }
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "读取奖励数据失败", "error");
    } finally {
      if (!silent && firstLoad) setLoading(false);
    }
  }, [notify, can, applyData]);

  // 切日期或切奖励类型属于换一份数据，草稿要重置；其余刷新一律保留页面输入。
  useEffect(() => { void load(date, kind, false, true); }, [date, kind, load]);

  const syncMembers = async () => {
    setBusy("sync");
    try {
      await api("/api/game/agent-rewards/sync", { method: "POST", ...jsonBody({}) });
      await load(date, kind, true);
      notify("代理名单已同步");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "同步失败", "error");
    } finally { setBusy(""); }
  };

  const members = useMemo(() => (data?.members ?? []).filter(m => {
    if (keyword && !(m.agentId.includes(keyword) || m.name.includes(keyword))) return false;
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    if (unionFilter !== "all" && m.unionId !== unionFilter) return false;
    if (clubFilter !== "all" && m.clubId !== clubFilter) return false;
    if (dataFilter === "has") {
      const weighted = kind === "performance" ? (m.perf?.net ?? 0) : kind === "pool" ? Math.max(m.line?.todayScore ?? 0, 0) : (draft[m.agentId] ?? 0);
      if (!(weighted > 0)) return false;
    }
    if (dataFilter === "noclub" && m.line) return false;
    return true;
  }), [data, keyword, roleFilter, unionFilter, clubFilter, dataFilter, kind, draft]);

  // 联盟/俱乐部下拉：从当前名单聚合，俱乐部随所选联盟联动。
  const unionOptions = useMemo(() => {
    const map = new Map<string, string>();
    (data?.members ?? []).forEach(m => { if (m.unionId) map.set(m.unionId, m.unionName || m.unionId); });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const clubOptions = useMemo(() => {
    const map = new Map<string, string>();
    (data?.members ?? []).forEach(m => {
      if (!m.clubId) return;
      if (unionFilter !== "all" && m.unionId !== unionFilter) return;
      map.set(m.clubId, m.clubName || m.clubId);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [data, unionFilter]);

  const amountSum = useMemo(() => members.reduce((sum, m) => sum + (draft[m.agentId] ?? 0), 0), [members, draft]);
  const allSum = useMemo(() => (data?.members ?? []).reduce((sum, m) => sum + (draft[m.agentId] ?? 0), 0), [data, draft]);
  const payCount = useMemo(() => (data?.members ?? []).filter(m => (draft[m.agentId] ?? 0) > 0).length, [data, draft]);
  const subCount = useMemo(() => Object.values(splits).reduce((sum, list) => sum + list.filter(s => s.type === "sub" && s.amount > 0).length, 0), [splits]);
  const diff = planTotal - allSum;

  const setAmount = (agentId: string, value: number) => {
    const next = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    setDraft(prev => ({ ...prev, [agentId]: next }));
    setSplits(prev => {
      if (!prev[agentId]) return prev;
      const list = prev[agentId];
      const main = list.find(s => s.type === "main");
      if (main && list.length === 1) return { ...prev, [agentId]: [{ ...main, amount: next }] };
      return prev;
    });
    setDirty(true);
  };

  const saveAll = async (): Promise<boolean> => {
    if (!data) return false;
    if (planTotal !== data.plan.plannedTotal || dirty) {
      await api("/api/game/agent-rewards/plan", { method: "PUT", ...jsonBody({ date: data.plan.date, kind, plannedTotal: planTotal }) });
    }
    const amounts: Record<string, number> = {};
    (data.members ?? []).forEach(m => { amounts[m.agentId] = draft[m.agentId] ?? 0; });
    await api("/api/game/agent-rewards/amounts", { method: "PUT", ...jsonBody({ date: data.plan.date, kind, amounts, splits }) });
    setDirty(false);
    return true;
  };

  const autoAllocate = async () => {
    if (!data) return;
    setBusy("allocate");
    try {
      await api("/api/game/agent-rewards/plan", { method: "PUT", ...jsonBody({ date: data.plan.date, kind, plannedTotal: planTotal }) });
      const result = await api<{ count: number; total: number }>("/api/game/agent-rewards/allocate",
        { method: "POST", ...jsonBody({ date: data.plan.date, kind }) });
      // 服务端刚重写了每个人的金额，这里必须重新以服务端为准，不能保留页面上的旧草稿。
      await load(date, kind, true, true);
      notify(`已分摊 ${num(result.total)} 金币，共 ${result.count} 人`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "分摊失败", "error");
    } finally { setBusy(""); }
  };

  const clearAmounts = () => {
    const next: Record<string, number> = {};
    (data?.members ?? []).forEach(m => { next[m.agentId] = 0; });
    setDraft(next); setSplits({}); setDirty(true);
  };

  const saveAmountsOnly = async () => {
    setBusy("save");
    try { await saveAll(); notify("已保存分配金额"); await load(date, kind, true, true); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "保存失败", "error"); }
    finally { setBusy(""); }
  };

  const openPay = async () => {
    if (!data) return;
    setBusy("prepay");
    try {
      if (diff !== 0) { notify(`分配合计与计划总额相差 ${num(Math.abs(diff))}，不能发放`, "error"); return; }
      await saveAll();
      await load(date, kind, true);
      setPayResult(null);
      setPayOpen(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "保存分配金额失败，未发起发放", "error");
    } finally { setBusy(""); }
  };

  const doPay = async () => {
    if (!data) return;
    setBusy("pay");
    try {
      const result = await api<PayResult>("/api/game/agent-rewards/pay",
        { method: "POST", ...jsonBody({ date: data.plan.date, kind, confirm: true }) });
      setPayResult(result);
      notify(result.status === "paid" ? `发放完成：${result.paid} 笔` : `部分完成：成功 ${result.paid} 笔，异常 ${result.failed + (result.total > 0 ? 0 : 0)} 笔`, result.status === "paid" ? "success" : "error");
      await load(date, kind, true, true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "发放失败", "error");
    } finally { setBusy(""); }
  };

  const confirmExclude = async () => {
    if (!excludeOpen) return;
    setBusy("exclude");
    try {
      await api("/api/game/agent-rewards/exclude", { method: "POST", ...jsonBody({
        agentId: excludeOpen.member.agentId, kind: excludeOpen.scope, reason: excludeOpen.reason.trim(),
      }) });
      setExcludeOpen(null);
      await load(date, kind, true);
      notify("已排除，可在「已排除」里恢复");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "排除失败", "error");
    } finally { setBusy(""); }
  };

  const restoreExclude = async (item: Excluded) => {
    setBusy("restore");
    try {
      await api(`/api/game/agent-rewards/exclude/${encodeURIComponent(item.agentId)}?kind=${encodeURIComponent(item.kind)}`, { method: "DELETE" });
      await load(date, kind, true);
      notify(`已恢复 ${item.name || item.agentId}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "恢复失败", "error");
    } finally { setBusy(""); }
  };

  const bindSub = async (agentId: string, subGuuid: string) => {
    setBusy("sub");
    try {
      await api("/api/game/agent-rewards/sub-accounts", { method: "POST", ...jsonBody({ agentId, subGuuid }) });
      await load(date, kind, true);
      const fresh = (await api<Overview>(`/api/game/agent-rewards?${new URLSearchParams({ date, kind })}`)).members.find(m => m.agentId === agentId);
      if (fresh) setSubOpen(fresh);
      notify("子账号已绑定");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "绑定失败", "error");
    } finally { setBusy(""); }
  };

  const unbindSub = async (agentId: string, subId: string) => {
    setBusy("sub");
    try {
      await api(`/api/game/agent-rewards/sub-accounts/${encodeURIComponent(agentId)}/${encodeURIComponent(subId)}`, { method: "DELETE" });
      notify("已解绑");
      setSubOpen(null);
      await load(date, kind, true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "解绑失败", "error");
    } finally { setBusy(""); }
  };

  const addMember = async () => {
    const id = addId.trim();
    if (!id) return;
    setBusy("add");
    try {
      const result = await api<{ agentId: string; name: string }>("/api/game/agent-rewards/members",
        { method: "POST", ...jsonBody({ agentId: id }) });
      notify(`已加入名单：${result.name || result.agentId}`);
      setAddOpen(false); setAddId("");
      await load(date, kind, true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "加入名单失败", "error");
    } finally { setBusy(""); }
  };

  const removeFromList = async (member: Member) => {
    setBusy("remove");
    try {
      await api("/api/game/agent-rewards/select", { method: "POST", ...jsonBody({ agentIds: [member.agentId], selected: false }) });
      await load(date, kind, true);
      notify(`已把 ${member.name || member.agentId} 移出本次分配名单`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "移出失败", "error");
    } finally { setBusy(""); }
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ["日期", "类型", "代理ID", "昵称", "身份", "联盟", "俱乐部", "今日输赢", "整条线总输赢", "整条线总贡献", "今日业绩(毛)", "已下发", "实际点数(净)", "分配金额", "子账号拆分"];
    const rows = members.map(m => [
      data.plan.date, KIND_LABEL[kind], m.agentId, m.name, ROLE_LABEL[m.role] ?? m.role,
      m.unionName || m.unionId, m.clubName || m.clubId,
      m.line ? m.line.todayScore : "", m.line ? m.line.totalScore : "", m.line ? m.line.totalContrib : "",
      m.perf ? m.perf.my : "", m.perf ? m.perf.granted : "", m.perf ? m.perf.net : "",
      draft[m.agentId] ?? 0,
      (splits[m.agentId] ?? []).filter(s => s.type === "sub").map(s => `${s.payee}:${s.amount}`).join(" "),
    ]);
    const csv = [head, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `代理奖励-${data.plan.date}-${kind}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabs: { key: Kind; hint: string }[] = [
    { key: "performance", hint: "自动" },
    { key: "core", hint: "手填" },
    { key: "pool", hint: "手填" },
  ];
  const descriptions: Record<Kind, string> = {
    performance: "按整条线今日贡献逐级扣减后的点数自动分摊计划总额（上级减掉下级那条线，不重复计算），可人工微调；合计必须等于总额才能发放。",
    core: "按代理规模、层级与整条线贡献人工填写，金额相对固定，可参考上次发放值。",
    pool: "按代理整条线每天的今日输赢人工判断分配，没有俱乐部线数据的代理会显示「无数据」。",
  };

  const totalWeight = data?.totals.points ?? 0;
  const status = data?.plan.status ?? "draft";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GAME / AGENT REWARD"
        title="业绩核心共享"
        description={descriptions[kind]}
        actions={<div className="page-header__actions">
          <input type="date" value={date} onChange={event => setDate(event.target.value)} />
          <Button onClick={() => setPickOpen(true)}>＋ 添加参与代理</Button>
          <Button variant="secondary" disabled={busy === "sync"} onClick={() => void syncMembers()}>{busy === "sync" ? "同步中…" : "同步名单"}</Button>
          <Button variant="secondary" onClick={() => setLedgerOpen(true)}>发放账单</Button>
        </div>}
      />

      <div className="reward-tabs">
        {tabs.map(tab => (
          <button key={tab.key} type="button" className={`reward-tab${kind === tab.key ? " is-on" : ""}`} onClick={() => setKind(tab.key)}>
            {KIND_LABEL[tab.key]}<small>{tab.hint}</small>
          </button>
        ))}
        <span className={`reward-status reward-status--${status}`}>
          {status === "draft" ? "编辑中" : status === "paid" ? "已发放" : status === "paying" ? "发放中" : "部分异常"}
        </span>
      </div>

      <div className="reward-metrics">
        <div className="reward-metric">
          <span>计划发放总额（金币）</span>
          <input type="number" min={0} step={100} value={planTotal} disabled={!editable}
            onChange={event => { setPlanTotal(Math.max(0, Math.floor(Number(event.target.value) || 0))); setDirty(true); }} />
          <small>每天由主管设置</small>
        </div>
        <div className="reward-metric">
          <span>已分配</span>
          <strong>{num(allSum)}</strong>
          <small>{kind === "performance" ? `净点数合计 ${pt(totalWeight)} 元` : `已填 ${payCount} 人`}</small>
        </div>
        <div className={`reward-metric${diff === 0 && allSum > 0 ? " is-ok" : Math.abs(diff) > 0 ? " is-bad" : ""}`}>
          <span>剩余 / 差额</span>
          <strong>{num(Math.abs(diff))}</strong>
          <small>{diff === 0 ? "已配平" : diff > 0 ? `还差 ${num(diff)} 未分配` : `超出 ${num(-diff)}`}</small>
        </div>
        <div className="reward-metric">
          <span>参与人数</span>
          <strong>{payCount}</strong>
          <small>名单 {data?.members.length ?? 0} 人 · 已排除 {data?.excluded.length ?? 0} 人</small>
        </div>
      </div>

      {(data?.warnings ?? []).length > 0 && (
        <div className="reward-warn">
          <b>数据提示</b>
          <ul>{(data?.warnings ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}

      <section className="panel">
        <div className="panel__header">
          <div className="reward-tools">
            <input placeholder="代理ID或昵称" value={keyword} onChange={event => setKeyword(event.target.value.trim())} />
            <select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}>
              <option value="all">全部身份</option>
              <option value="grand">大盟主</option>
              <option value="leader">盟主</option>
              <option value="small_leader">小盟主</option>
              <option value="partner">合伙人</option>
              <option value="agent">代理</option>
            </select>
            <select value={unionFilter} onChange={event => {
              const next = event.target.value;
              setUnionFilter(next);
              setClubFilter("all");
            }}>
              <option value="all">全部联盟</option>
              {unionOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select value={clubFilter} onChange={event => setClubFilter(event.target.value)}>
              <option value="all">全部俱乐部</option>
              {clubOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select value={dataFilter} onChange={event => setDataFilter(event.target.value)}>
              <option value="all">全部数据</option>
              <option value="has">有可分配数据</option>
              <option value="noclub">无线数据</option>
            </select>
            <Button variant="secondary" onClick={() => setPickOpen(true)}>＋ 批量添加</Button>
            <Button variant="secondary" onClick={() => setListOpen(true)}>名单方案</Button>
            <Button variant="secondary" disabled={!editable} onClick={() => {
              const picked = Object.keys(selected).filter(id => selected[id]);
              if (!picked.length) { notify("先勾选要排除的代理", "error"); return; }
              const first = data?.members.find(m => m.agentId === picked[0]);
              if (!first) return;
              setExcludeOpen({ member: first, scope: kind, reason: "" });
            }}>排除</Button>
            <Button variant="ghost" onClick={() => setExcludedOpen(true)}>已排除 {data?.excluded.length ?? 0}</Button>
          </div>
          <div className="reward-tools">
            <Button variant="secondary" disabled={!editable || busy === "allocate"} onClick={() => void autoAllocate()}>
              {kind === "performance" ? "按点数自动分摊" : kind === "core" ? "按上次金额预填" : "按今日输赢预填"}
            </Button>
            <Button variant="ghost" disabled={!editable} onClick={clearAmounts}>清空金额</Button>
            <Button variant="ghost" disabled={!editable || busy === "save"} onClick={() => void saveAmountsOnly()}>保存草稿</Button>
            <Button variant="ghost" onClick={exportCsv}>导出</Button>
          </div>
        </div>

        {loading ? <LoadingBlock label="正在读取代理奖励数据" /> : members.length === 0 ? (
          <div className="reward-empty">
            <strong>本次分配名单为空</strong>
            <p>先从俱乐部代理里选出要发奖励的人。只有进入名单的代理才会出现在表格里、参与分摊和发放。</p>
            <Button onClick={() => setPickOpen(true)}>＋ 批量添加参与的代理</Button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={members.length > 0 && members.every(m => selected[m.agentId])}
                      onChange={event => {
                        const next: Record<string, boolean> = {};
                        members.forEach(m => { next[m.agentId] = event.target.checked; });
                        setSelected(next);
                      }} />
                  </th>
                  <th>代理</th>
                  <th>身份</th>
                  <th>联盟</th>
                  <th>俱乐部</th>
                  {kind === "performance" && <><th className="reward-num">整条线总输赢</th><th className="reward-num">今日输赢</th>
                    <th className="reward-num">整条线总贡献</th>
                    <th className="reward-num">今日业绩(毛)</th><th className="reward-num">已下发</th><th className="reward-num">实际点数(净)</th></>}
                  {kind === "core" && <><th>代理规模</th><th className="reward-num">整条线总输赢</th><th className="reward-num">整条线总贡献</th><th className="reward-num">上次金额</th></>}
                  {kind === "pool" && <><th className="reward-num">今日输赢</th><th className="reward-num">整条线总输赢</th><th className="reward-num">整条线总贡献</th></>}
                  <th className="reward-num" style={{ width: 130 }}>本次金额</th>
                  <th style={{ width: 210 }} />
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const amount = draft[m.agentId] ?? 0;
                  const splitsOf = splits[m.agentId] ?? [];
                  return (
                    <tr key={m.agentId}>
                      <td><input type="checkbox" checked={Boolean(selected[m.agentId])}
                        onChange={event => setSelected(prev => ({ ...prev, [m.agentId]: event.target.checked }))} /></td>
                      <td className="reward-name">
                        <strong>{m.name || m.agentId}</strong>
                        <small>ID {m.agentId}{m.paidAmount > 0 ? ` · 已发 ${num(m.paidAmount)}` : ""}</small>
                      </td>
                      <td>
                        <span className={`reward-role reward-role--${m.role}`}>{ROLE_LABEL[m.role] ?? m.role}</span>
                        {splitsOf.length > 1 && <span className="reward-tag">{splitsOf.length} 个账号</span>}
                      </td>
                      <td className="reward-dim">{m.unionId ? <span title={`联盟 ID ${m.unionId}`}>{m.unionName || m.unionId}</span> : <span className="reward-muted">—</span>}</td>
                      <td className="reward-dim">{m.clubId ? <span title={`俱乐部 ID ${m.clubId}`}>{m.clubName || m.clubId}</span> : <span className="reward-muted">—</span>}</td>
                      {kind === "performance" && <>
                        <td className="reward-num">{m.line ? signed(m.line.totalScore) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.line ? signed(m.line.todayScore) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.line ? money2(m.line.totalContrib) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.perf ? pt(m.perf.my) : <span className="reward-muted">-</span>}</td>
                        <td className="reward-num">{m.perf ? pt(m.perf.granted) : <span className="reward-muted">-</span>}</td>
                        <td className="reward-num"><span className={`reward-points${(m.perf?.net ?? 0) > 0 ? "" : " is-zero"}`}>{m.perf ? pt(m.perf.net) : "-"}</span></td>
                      </>}
                      {kind === "core" && <>
                        <td>{(data?.members ?? []).filter(x => x.upperId === m.agentId).length} 个直属下级</td>
                        <td className="reward-num">{m.line ? signed(m.line.totalScore) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.line ? money2(m.line.totalContrib) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.paidAmount > 0 ? num(m.paidAmount) : <span className="reward-muted">-</span>}</td>
                      </>}
                      {kind === "pool" && <>
                        <td className="reward-num">{m.line ? signed(m.line.todayScore) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.line ? signed(m.line.totalScore) : <span className="reward-muted">无数据</span>}</td>
                        <td className="reward-num">{m.line ? money2(m.line.totalContrib) : <span className="reward-muted">无数据</span>}</td>
                      </>}
                      <td className="reward-num">
                        <input className="reward-amount" type="number" min={0} step={1} value={amount} disabled={!editable}
                          onChange={event => setAmount(m.agentId, Number(event.target.value))} />
                      </td>
                      <td>
                        <div className="reward-ops">
                          <button type="button" className="reward-link" onClick={() => setLineOpen(m)}>线数据</button>
                          <button type="button" className="reward-link" onClick={() => setSubOpen(m)}>分账号</button>
                          <button type="button" className="reward-link reward-link--danger" disabled={!editable}
                            onClick={() => void removeFromList(m)}>移出</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="reward-foot">
          <div>
            <span>参与 <b>{payCount}</b> 人</span>
            <span>合计 <b>{num(allSum)}</b> 金币</span>
            <span className={diff === 0 ? "is-ok" : "is-bad"}>差额 <b>{num(Math.abs(diff))}</b></span>
            <span className="reward-muted">可见行合计 {num(amountSum)}</span>
          </div>
          <div className="reward-tools">
            <Button variant="secondary" disabled={!canPay || !editable || diff !== 0 || allSum <= 0} onClick={() => void openPay()}>
              确认并发放
            </Button>
          </div>
        </div>
      </section>

      {lineOpen && <LineModal member={lineOpen} date={date} onClose={() => setLineOpen(null)} />}
      {subOpen && <SubModal member={subOpen} amount={draft[subOpen.agentId] ?? 0} splits={splits[subOpen.agentId] ?? []}
        canConfigure={Boolean(can("game.agent_reward.configure"))} busy={busy === "sub"}
        onBind={bindSub} onUnbind={unbindSub}
        onSave={list => { setSplits(prev => ({ ...prev, [subOpen.agentId]: list })); setDirty(true); setSubOpen(null); notify("已设置拆分，保存草稿后生效"); }}
        onClose={() => setSubOpen(null)} />}
      {excludeOpen && <Modal title={`排除 ${excludeOpen.member.name || excludeOpen.member.agentId}`} eyebrow="EXCLUDE" onClose={() => setExcludeOpen(null)}>
        <p className="reward-hint">排除后该代理从本栏名单移除、不参与分摊、不可发放；历史发放记录保留。每日同步不会把人加回来。</p>
        <Field label="排除范围">
          <select value={excludeOpen.scope} onChange={event => setExcludeOpen({ ...excludeOpen, scope: event.target.value })}>
            <option value="performance">仅业绩奖励</option>
            <option value="core">仅核心奖励</option>
            <option value="pool">仅奖池共享</option>
            <option value="all">三种奖励全部停发</option>
          </select>
        </Field>
        <Field label="排除原因（必填，进审计）">
          <textarea rows={3} value={excludeOpen.reason} onChange={event => setExcludeOpen({ ...excludeOpen, reason: event.target.value })}
            placeholder="例如：已离职 / 封号 / 代理方要求不发" />
        </Field>
        <div className="reward-modal-foot">
          <Button variant="secondary" onClick={() => setExcludeOpen(null)}>取消</Button>
          <Button variant="danger" disabled={busy === "exclude"} onClick={() => void confirmExclude()}>确认排除</Button>
        </div>
      </Modal>}

      {excludedOpen && <Modal title="已排除名单" eyebrow="EXCLUDED" onClose={() => setExcludedOpen(false)} wide>
        {(data?.excluded ?? []).length === 0 ? <EmptyState title="没有排除记录" description="在名单行点「排除」后，这里可以查到原因并恢复。" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>代理</th><th>范围</th><th>原因</th><th>操作人</th><th>时间</th><th /></tr></thead>
              <tbody>
                {(data?.excluded ?? []).map(item => (
                  <tr key={`${item.agentId}-${item.kind}`}>
                    <td className="reward-name"><strong>{item.name || item.agentId}</strong><small>ID {item.agentId}</small></td>
                    <td>{item.kind === "all" ? "三种奖励" : KIND_LABEL[item.kind as Kind] ?? item.kind}</td>
                    <td>{item.reason}</td><td>{item.operator}</td><td>{item.at}</td>
                    <td><Button variant="secondary" disabled={busy === "restore"} onClick={() => void restoreExclude(item)}>恢复</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>}

      {addOpen && <Modal title="按 ID 添加代理" eyebrow="ADD MEMBER" onClose={() => setAddOpen(false)}>
        <p className="reward-hint">
          名单默认从游戏账号表同步全部老板/盟主/合伙人/总裁/普通代理。这里用于补加已降级、但业务仍要发钱的老账号：
          加入后标记为手工来源，每日同步不会把它删掉。不发时用「排除」而不是删除，历史账目会保留。
        </p>
        <Field label="玩家 ID" hint="按游戏账号 ID 精确查询昵称与身份">
          <input placeholder="例如 725838" value={addId} onChange={event => setAddId(event.target.value.trim())} />
        </Field>
        <div className="reward-modal-foot">
          <Button variant="secondary" onClick={() => setAddOpen(false)}>取消</Button>
          <Button disabled={busy === "add" || !addId} onClick={() => void addMember()}>{busy === "add" ? "加入中…" : "加入名单"}</Button>
        </div>
      </Modal>}

      {payOpen && <Modal title={`确认发放 · ${KIND_LABEL[kind]}`} eyebrow="PAYOUT" onClose={() => { setPayOpen(false); setPayResult(null); }} wide>
        {payResult ? (
          <div>
            <div className="reward-metrics">
              <div className="reward-metric"><span>发放总额</span><strong>{num(payResult.total)}</strong><small>金币</small></div>
              <div className="reward-metric"><span>成功</span><strong>{payResult.paid}</strong><small>笔</small></div>
              <div className="reward-metric"><span>失败</span><strong>{payResult.failed}</strong><small>笔</small></div>
              <div className="reward-metric"><span>跳过</span><strong>{payResult.skipped}</strong><small>笔（已发过）</small></div>
            </div>
            {payResult.errors.length > 0 && <div className="reward-warn"><b>失败明细</b><ul>{payResult.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            <p className="reward-hint">发放结果已写入账单；异常行可在账单里按工单号核对余额后人工处理。</p>
            <div className="reward-modal-foot"><Button onClick={() => { setPayOpen(false); setPayResult(null); }}>关闭</Button></div>
          </div>
        ) : (
          <div>
            <div className="reward-metrics">
              <div className="reward-metric"><span>发放人数</span><strong>{payCount}</strong><small>人</small></div>
              <div className="reward-metric"><span>发放总额</span><strong>{num(planTotal)}</strong><small>金币</small></div>
              <div className="reward-metric"><span>子账号笔数</span><strong>{subCount}</strong><small>笔</small></div>
              <div className="reward-metric"><span>计划差额</span><strong>0</strong><small>已配平</small></div>
            </div>
            <p className="reward-hint">
              发放走游戏发钱通道，一单一笔、唯一工单号，发完逐笔回读余额核对。流水类型由游戏侧决定，
              当前写入「奖励/补分」，需求要的「补发」需要游戏端加前缀。
            </p>
            <div className="reward-modal-foot">
              <Button variant="secondary" onClick={() => { setPayOpen(false); setPayResult(null); }}>取消</Button>
              <Button disabled={busy === "pay"} onClick={() => void doPay()}>{busy === "pay" ? "发放中…" : `确认发放 ${num(planTotal)} 金币`}</Button>
            </div>
          </div>
        )}
      </Modal>}

      {pickOpen && <CandidateModal notify={notify} onClose={() => setPickOpen(false)}
        onDone={() => { setPickOpen(false); void load(date, kind, true); }} />}
      {listOpen && <RewardListModal date={date} selectedCount={payCount} rev={listRev} notify={notify}
        onClose={() => setListOpen(false)}
        onChanged={() => setListRev(value => value + 1)}
        onApplied={() => { setListOpen(false); void load(date, kind, true, true); }} />}
      {ledgerOpen && <LedgerModal onClose={() => setLedgerOpen(false)} notify={notify} />}
    </div>
  );
}

function signed(value: number) {
  const cls = value > 0 ? "is-pos" : value < 0 ? "is-neg" : "reward-muted";
  return <span className={cls}>{value > 0 ? "+" : ""}{num(value)}</span>;
}

function LineModal({ member, date, onClose }: { member: Member; date: string; onClose: () => void }) {
  const [nodes, setNodes] = useState<{ agentId: string; name: string; role: string; clubId: string; relation: string; line: Line | null; perf: Perf | null }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{ nodes: typeof nodes }>(`/api/game/agent-rewards/${encodeURIComponent(member.agentId)}/line?date=${encodeURIComponent(date)}`)
      .then(value => { if (alive) setNodes(value.nodes ?? []); })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "读取失败"); });
    return () => { alive = false; };
  }, [member.agentId, date]);

  return (
    <Modal title={`${member.name || member.agentId} · 整条线数据`} eyebrow="AGENT LINE" onClose={onClose} wide>
      <p className="reward-hint">
        {ROLE_LABEL[member.role] ?? member.role} · ID {member.agentId}
        {member.clubId ? ` · 数据范围：俱乐部 ${member.clubId}` : " · 未挂俱乐部，无俱乐部口径数据"}
      </p>
      {error && <div className="reward-warn"><b>读取失败</b><ul><li>{error}</li></ul></div>}
      {!nodes ? <LoadingBlock label="正在读取上下级与线数据" /> : nodes.length === 0 ? <EmptyState title="没有可展示的节点" description="该代理不在名单里。" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>代理（上级 → 当前 → 下级）</th><th className="reward-num">今日输赢</th><th className="reward-num">整条线总输赢</th>
              <th className="reward-num">总贡献</th><th className="reward-num">下线人数</th><th className="reward-num">净点数</th></tr></thead>
            <tbody>
              {nodes.map(node => (
                <tr key={node.agentId} className={node.relation === "self" ? "reward-self" : ""}>
                  <td className="reward-name">
                    <strong style={{ paddingLeft: node.relation === "upper" ? 0 : node.relation === "self" ? 16 : 32 }}>
                      {node.name || node.agentId}
                      <span className="reward-muted"> {ROLE_LABEL[node.role] ?? node.role}{node.relation === "self" ? " · 当前" : ""}</span>
                    </strong>
                    <small>ID {node.agentId}{node.clubId ? ` · 俱乐部 ${node.clubId}` : ""}</small>
                  </td>
                  <td className="reward-num">{node.line ? signed(node.line.todayScore) : <span className="reward-muted">无数据</span>}</td>
                  <td className="reward-num">{node.line ? signed(node.line.totalScore) : <span className="reward-muted">无数据</span>}</td>
                  <td className="reward-num">{node.line ? money2(node.line.totalContrib) : <span className="reward-muted">无数据</span>}</td>
                  <td className="reward-num">{node.line ? node.line.teamCount : <span className="reward-muted">-</span>}</td>
                  <td className="reward-num">{node.perf ? pt(node.perf.net) : <span className="reward-muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="reward-hint">输赢单位是积分，贡献单位是元（分 ÷ 100），来自不同表，不能相加。</p>
      <div className="reward-modal-foot"><Button onClick={onClose}>知道了</Button></div>
    </Modal>
  );
}

function SubModal({ member, amount, splits, canConfigure, busy, onBind, onUnbind, onSave, onClose }: {
  member: Member; amount: number; splits: Split[]; canConfigure: boolean; busy: boolean;
  onBind: (agentId: string, subGuuid: string) => Promise<void>;
  onUnbind: (agentId: string, subId: string) => Promise<void>;
  onSave: (list: Split[]) => void;
  onClose: () => void;
}) {
  const initial = splits.length ? splits : [{ payee: member.agentId, payeeName: member.name, type: "main" as const, amount }];
  const [list, setList] = useState<Split[]>(initial);
  const [subId, setSubId] = useState("");
  const sum = list.reduce((total, item) => total + item.amount, 0);
  const isValid = sum === amount;

  const update = (index: number, value: number) => {
    setList(prev => prev.map((item, i) => i === index ? { ...item, amount: Math.max(0, Math.floor(value)) } : item));
  };
  const addSub = (sub: Sub) => {
    setList(prev => {
      if (prev.some(item => item.payee === sub.subId)) return prev;
      const main = prev.find(item => item.type === "main");
      const rest = prev.filter(item => item.type !== "main");
      return [...(main ? [main] : []), ...rest, { payee: sub.subId, payeeName: sub.subName, type: "sub" as const, amount: 0 }];
    });
  };

  return (
    <Modal title={`${member.name || member.agentId} · 分账号发放`} eyebrow="SPLIT PAYOUT" onClose={onClose}>
      <p className="reward-hint">主账号与子账号金额合计必须等于该代理本次分配金额 {num(amount)} 金币。</p>
      <table>
        <thead><tr><th>收款账号</th><th>类型</th><th className="reward-num">金额</th><th /></tr></thead>
        <tbody>
          {list.map((item, index) => (
            <tr key={item.payee}>
              <td className="reward-name"><strong>{item.payeeName || item.payee}</strong><small>ID {item.payee}</small></td>
              <td>{item.type === "main" ? "主账号" : "子账号"}</td>
              <td className="reward-num"><input className="reward-amount" type="number" min={0} value={item.amount} onChange={event => update(index, Number(event.target.value))} /></td>
              <td>{item.type === "sub" && <button type="button" className="reward-link reward-link--danger" onClick={() => setList(prev => prev.filter((_, i) => i !== index))}>移除</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`reward-hint${isValid ? " is-ok" : " is-bad"}`}>合计 {num(sum)} / 应发 {num(amount)}</p>

      {member.subs.length > 0 && (
        <>
          <div className="reward-hint">已绑定子账号：</div>
          {member.subs.map(sub => (
            <div key={sub.subId} className="reward-sub-row">
              <span>{sub.subName || sub.subId} · {sub.subId}</span>
              <span>
                <button type="button" className="reward-link" onClick={() => addSub(sub)}>加入拆分</button>
                {canConfigure && <button type="button" className="reward-link reward-link--danger" disabled={busy} onClick={() => void onUnbind(member.agentId, sub.subId)}>解绑</button>}
              </span>
            </div>
          ))}
        </>
      )}

      {canConfigure && (
        <Field label="绑定新的子账号（游戏玩家 ID）" hint="绑定关系存后台自有表，不改游戏账号">
          <div style={{ display: "flex", gap: 8 }}>
            <input value={subId} onChange={event => setSubId(event.target.value.trim())} placeholder="例如 725838" />
            <Button variant="secondary" disabled={busy || !subId} onClick={() => { void onBind(member.agentId, subId); setSubId(""); }}>绑定</Button>
          </div>
        </Field>
      )}

      <div className="reward-modal-foot">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button disabled={!isValid} onClick={() => onSave(list)}>保存拆分</Button>
      </div>
    </Modal>
  );
}

function LedgerModal({ onClose, notify }: { onClose: () => void; notify: (m: string, k?: "success" | "error") => void }) {
  const [from, setFrom] = useState(beijingDateInput(-9));
  const [to, setTo] = useState(beijingDateInput(0));
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [summary, setSummary] = useState({ total: 0, performance: 0, core: 0, pool: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = await api<{ items: LedgerRow[]; summary: typeof summary }>(`/api/game/agent-rewards/ledger?${new URLSearchParams({ from, to })}`);
      setRows(value.items ?? []);
      setSummary(value.summary ?? { total: 0, performance: 0, core: 0, pool: 0 });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "读取账单失败", "error");
    } finally { setLoading(false); }
  }, [from, to, notify]);
  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    const head = ["日期", "类型", "代理ID", "代理昵称", "收款账号", "账号类型", "金额", "工单号", "状态", "到账时间"];
    const body = (rows ?? []).map(row => [row.date, KIND_LABEL[row.kind] ?? row.kind, row.agentId, row.agentName, row.payee,
      row.payeeType === "main" ? "主账号" : "子账号", row.amount, row.order, row.status, row.paidAt]);
    const csv = [head, ...body].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `发放账单-${from}-${to}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title="发放账单" eyebrow="LEDGER" onClose={onClose} wide>
      <div className="reward-tools" style={{ marginBottom: 14 }}>
        <input type="date" value={from} onChange={event => setFrom(event.target.value)} />
        <span className="reward-muted">至</span>
        <input type="date" value={to} onChange={event => setTo(event.target.value)} />
        <Button variant="secondary" onClick={() => { const d = beijingDateInput(-9); setFrom(d); setTo(beijingDateInput(0)); }}>近 10 天</Button>
        <Button variant="secondary" onClick={() => { setFrom(beijingDateInput(-14)); setTo(beijingDateInput(0)); }}>近 15 天</Button>
        <Button variant="ghost" onClick={exportCsv}>导出 CSV</Button>
      </div>
      <div className="reward-metrics">
        <div className="reward-metric"><span>合计发放</span><strong>{num(summary.total)}</strong><small>金币（仅已到账）</small></div>
        <div className="reward-metric"><span>业绩奖励</span><strong>{num(summary.performance)}</strong><small>金币</small></div>
        <div className="reward-metric"><span>核心奖励</span><strong>{num(summary.core)}</strong><small>金币</small></div>
        <div className="reward-metric"><span>奖池共享</span><strong>{num(summary.pool)}</strong><small>金币</small></div>
      </div>
      {loading ? <LoadingBlock label="正在读取账单" /> : (rows ?? []).length === 0 ? (
        <EmptyState title="这段时间没有发放记录" description="在「业绩核心共享」里发放一次后，这里会出现每个账号的明细与工单号。" />
      ) : (
        <div className="table-wrap" style={{ maxHeight: "46vh" }}>
          <table>
            <thead><tr><th>日期</th><th>类型</th><th>代理</th><th>收款账号</th><th className="reward-num">金额</th><th>工单号</th><th>状态</th><th>到账时间</th></tr></thead>
            <tbody>
              {(rows ?? []).map(row => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td className="reward-name"><strong>{row.agentName || row.agentId}</strong><small>{row.agentId}</small></td>
                  <td className="reward-name"><strong>{row.payee}</strong><small>{row.payeeType === "main" ? "主账号" : "子账号"}</small></td>
                  <td className="reward-num">{num(row.amount)}</td>
                  <td>{row.order}</td>
                  <td><span className={`reward-status reward-status--${row.status === "paid" ? "paid" : "partial"}`}>
                    {row.status === "paid" ? "已到账" : row.status === "failed" ? "失败" : row.status === "mismatch" ? "余额异常" : "处理中"}
                  </span></td>
                  <td>{row.paidAt || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="reward-hint">汇总只统计已到账行；主账号与子账号分开显示，但代理合计不重复计算。</p>
      <div className="reward-modal-foot"><Button onClick={onClose}>关闭</Button></div>
    </Modal>
  );
}

/**
 * 批量添加：从俱乐部在册代理里挑人进入本次分配名单。
 * 候选池只加载一次（几十人级别），联盟/俱乐部/关键字都在前端过滤，避免来回请求。
 */
function CandidateModal({ notify, onClose, onDone }: {
  notify: (m: string, k?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [unionId, setUnionId] = useState("all");
  const [clubId, setClubId] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ selected: 0, total: 0 });

  useEffect(() => {
    let alive = true;
    api<{ items: Member[]; selected: number; total: number }>("/api/game/agent-rewards/candidates")
      .then(value => {
        if (!alive) return;
        setItems(value.items ?? []);
        setStats({ selected: value.selected ?? 0, total: value.total ?? 0 });
        setPicked([]);
      })
      .catch(reason => { if (alive) notify(reason instanceof Error ? reason.message : "读取候选名单失败", "error"); });
    return () => { alive = false; };
  }, [notify]);

  const unions = useMemo(() => {
    const map = new Map<string, string>();
    (items ?? []).forEach(m => { if (m.unionId) map.set(m.unionId, m.unionName || m.unionId); });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);

  const clubs = useMemo(() => {
    const map = new Map<string, string>();
    (items ?? []).forEach(m => {
      if (!m.clubId) return;
      if (unionId !== "all" && m.unionId !== unionId) return;
      map.set(m.clubId, m.clubName || m.clubId);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [items, unionId]);

  const visible = useMemo(() => (items ?? []).filter(m => {
    if (m.selected) return false; // 已经在名单里的不在这里出现，移出请到列表页操作
    if (unionId !== "all" && m.unionId !== unionId) return false;
    if (clubId !== "all" && m.clubId !== clubId) return false;
    if (keyword && !(m.agentId.includes(keyword) || m.name.includes(keyword))) return false;
    return true;
  }), [items, unionId, clubId, keyword]);

  const allChecked = visible.length > 0 && visible.every(m => picked.includes(m.agentId));
  const someChecked = visible.some(m => picked.includes(m.agentId));
  const headerCk = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCk.current) headerCk.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);

  const toggle = (id: string) => {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const selectAllVisible = () => {
    setPicked(prev => {
      const next = new Set(prev);
      visible.forEach(m => next.add(m.agentId));
      return [...next];
    });
  };
  const clearVisible = () => {
    setPicked(prev => prev.filter(id => !visible.some(m => m.agentId === id)));
  };

  const toAdd = picked;

  const save = async () => {
    if (!toAdd.length) { onDone(); return; }
    setSaving(true);
    try {
      await api("/api/game/agent-rewards/select", { method: "POST", ...jsonBody({ agentIds: toAdd, selected: true }) });
      notify(`已把 ${toAdd.length} 人加入分配名单`);
      onDone();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "保存名单失败", "error");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="批量添加参与分配的代理" eyebrow="PICK AGENTS" onClose={onClose} wide>
      <p className="reward-hint">
        候选池共 {stats.total} 个俱乐部代理（大盟主 / 盟主 / 合伙人 / 代理），名单里已有 {stats.selected} 人。
        这里只列出<b>还没加入名单</b>的代理；勾选后点保存即加入，已被移出的也可以在这里重新加回来。
      </p>
      <div className="reward-tools" style={{ marginBottom: 12 }}>
        <select value={unionId} onChange={event => { setUnionId(event.target.value); setClubId("all"); }}>
          <option value="all">全部联盟</option>
          {unions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={clubId} onChange={event => setClubId(event.target.value)}>
          <option value="all">全部俱乐部</option>
          {clubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input placeholder="代理ID或昵称" value={keyword} onChange={event => setKeyword(event.target.value.trim())} />
        <Button variant="secondary" onClick={selectAllVisible}>全选当前 {visible.length} 人</Button>
        <Button variant="ghost" onClick={clearVisible}>取消全选</Button>
      </div>

      {!items ? <LoadingBlock label="正在读取候选代理" /> : visible.length === 0 ? (
        <EmptyState title="没有符合条件的代理" description="换个联盟/俱乐部，或先在游戏里把账号授权为俱乐部代理。" />
      ) : (
        <div className="table-wrap" style={{ maxHeight: "46vh" }}>
          <table>
            <thead><tr>
              <th style={{ width: 34 }}>
                <input ref={headerCk} type="checkbox" checked={allChecked} title="全选当前列表"
                  onChange={event => { if (event.target.checked) selectAllVisible(); else clearVisible(); }} />
              </th>
              <th>代理</th><th>身份</th><th>联盟</th><th>俱乐部</th>
            </tr></thead>
            <tbody>
              {visible.map(m => {
                const on = picked.includes(m.agentId);
                return (
                  <tr key={m.agentId} onClick={() => toggle(m.agentId)} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={on} onClick={event => event.stopPropagation()}
                      onChange={() => toggle(m.agentId)} /></td>
                    <td className="reward-name"><strong>{m.name || m.agentId}</strong><small>ID {m.agentId}</small></td>
                    <td><span className={`reward-role reward-role--${m.role}`}>{ROLE_LABEL[m.role] ?? m.role}</span></td>
                    <td className="reward-dim">{m.unionName || <span className="reward-muted">—</span>}</td>
                    <td className="reward-dim">{m.clubName || m.clubId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="reward-hint">
        待保存：将加入 <b>{toAdd.length}</b> 人。
      </p>
      <div className="reward-modal-foot">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存名单"}</Button>
      </div>
    </Modal>
  );
}

/** 名单方案：把当前参与名单存成命名模板，下次一键加载。 */
function RewardListModal({ date, selectedCount, rev, notify, onClose, onChanged, onApplied }: {
  date: string;
  selectedCount: number;
  rev: number;
  notify: (m: string, k?: "success" | "error") => void;
  onClose: () => void;
  onChanged: () => void;
  onApplied: () => void;
}) {
  type Row = { id: number; name: string; note: string; memberCount: number; createdBy: string; updatedAt: string };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState(`${date} 名单`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState<Row | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: Row[] }>("/api/game/agent-rewards/lists")
      .then(value => { if (alive) setRows(value.items ?? []); })
      .catch(reason => { if (alive) notify(reason instanceof Error ? reason.message : "读取名单方案失败", "error"); });
    return () => { alive = false; };
  }, [rev, notify]);

  const save = async () => {
    if (!name.trim()) { notify("请填写名单名称", "error"); return; }
    setBusy("save");
    try {
      const result = await api<{ name: string; memberCount: number }>("/api/game/agent-rewards/lists",
        { method: "POST", ...jsonBody({ name: name.trim(), note: note.trim() }) });
      notify(`已保存名单「${result.name}」，${result.memberCount} 人`);
      setNote("");
      onChanged();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "保存失败", "error");
    } finally { setBusy(""); }
  };

  const apply = async (row: Row) => {
    setBusy("apply");
    try {
      const result = await api<{ name: string; selected: number }>(
        `/api/game/agent-rewards/lists/${row.id}/apply`, { method: "POST", ...jsonBody({}) });
      notify(`已加载名单「${result.name}」，${result.selected} 人`);
      onChanged();
      onApplied();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "加载失败", "error");
    } finally { setBusy(""); setPending(null); }
  };

  const remove = async (row: Row) => {
    setBusy(`del-${row.id}`);
    try {
      await api(`/api/game/agent-rewards/lists/${row.id}`, { method: "DELETE" });
      notify(`已删除名单「${row.name}」`);
      onChanged();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "删除失败", "error");
    } finally { setBusy(""); }
  };

  return (
    <Modal title="名单方案" eyebrow="SAVED LISTS" onClose={onClose} wide>
      <div className="reward-list-save">
        <div>
          <strong>把当前名单存成模板</strong>
          <p className="reward-hint">当前入选 {selectedCount} 人。同名会覆盖旧方案；模板只记名单，不影响发放记录。</p>
        </div>
        <div className="reward-tools">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="名单名称，例如「核心 10 人」" maxLength={64} />
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="备注（可选）" maxLength={200} />
          <Button disabled={busy === "save" || selectedCount === 0} onClick={() => void save()}>
            {busy === "save" ? "保存中…" : "保存为新名单"}
          </Button>
        </div>
      </div>

      <div className="hr" />

      {!rows ? <LoadingBlock label="正在读取名单方案" /> : rows.length === 0 ? (
        <EmptyState title="还没有保存过名单" description="把当前挑好的人存成模板，下次一键加载。" />
      ) : (
        <div className="table-wrap" style={{ maxHeight: "42vh" }}>
          <table>
            <thead><tr><th>名称</th><th className="reward-num">人数</th><th>备注</th><th>更新人</th><th>更新时间</th><th /></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="reward-name"><strong>{row.name}</strong></td>
                  <td className="reward-num">{row.memberCount}</td>
                  <td className="reward-dim">{row.note || <span className="reward-muted">—</span>}</td>
                  <td className="reward-dim">{row.createdBy || "-"}</td>
                  <td className="reward-dim">{row.updatedAt}</td>
                  <td>
                    <div className="reward-ops">
                      <button type="button" className="reward-link" onClick={() => setPending(row)}>加载</button>
                      <button type="button" className="reward-link reward-link--danger" disabled={busy === `del-${row.id}`}
                        onClick={() => void remove(row)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <div className="reward-confirm">
          <span>用「{pending.name}」（{pending.memberCount} 人）替换当前名单？当前勾选会被清空。</span>
          <div className="reward-tools">
            <Button variant="secondary" onClick={() => setPending(null)}>取消</Button>
            <Button disabled={busy === "apply"} onClick={() => void apply(pending)}>{busy === "apply" ? "加载中…" : "确认加载"}</Button>
          </div>
        </div>
      )}

      <div className="reward-modal-foot"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
    </Modal>
  );
}
