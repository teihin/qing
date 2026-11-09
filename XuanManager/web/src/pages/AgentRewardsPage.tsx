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
  sharePercent: number;
  amount: number; splits: Split[]; subs: Sub[]; paidAmount: number;
};
type Excluded = { agentId: string; name: string; kind: string; reason: string; operator: string; at: string };
type Overview = {
  plan: {
    date: string; kind: Kind; plannedTotal: number; status: string;
    poolAvailable: boolean; poolTotal: number; poolHalf: number; poolPercent: number; poolSuggested: number;
  };
  members: Member[];
  excluded: Excluded[];
  totals: { amount: number; count: number; planned: number; diff: number; points: number; excluded: number; pool: number };
  warnings: string[];
  lastAmounts: Record<string, number>;
  lastDate: string;
};
type KindSummary = { kind: Kind; plannedTotal: number; allocated: number; count: number; status: string };
type Summary = { date: string; items: KindSummary[]; selected: number };
type LedgerRow = {
  id: number; date: string; kind: Kind; agentId: string; agentName: string; payee: string;
  payeeType: string; amount: number; order: string; status: string; error: string; paidAt: string;
};
type PayResult = { total: number; paid: number; failed: number; skipped: number; status: string; orders: string[]; errors: string[] };

const KIND_LABEL: Record<Kind, string> = { performance: "业绩奖励", core: "核心奖励", pool: "奖池共享" };
// 与游戏内「代理中心」一致的角色名：大盟主 / 盟主 / 小盟主 / 合伙人 / 代理
const ROLE_LABEL: Record<string, string> = { grand: "大盟主", leader: "盟主", small_leader: "小盟主", partner: "合伙人", agent: "代理" };
// 占比堆叠条的分段颜色，按占比从高到低循环使用。
const SHARE_COLORS = ["#1f948a", "#3f7fbf", "#c69132", "#a4639f", "#4f9160", "#b65f43", "#6b72bd", "#7f8f34", "#2b9aa8", "#9a5a6f"];

const num = (value: number) => (value || 0).toLocaleString("zh-CN");
const pt = (value: number | null | undefined) => (typeof value === "number" ? value.toFixed(2) : "0.00");
const money2 = (value: number) => (value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value: number | null | undefined) => `${(value || 0).toFixed(2)}%`;
const syncClock = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
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
  const [pickOpen, setPickOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listRev, setListRev] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [poolPercent, setPoolPercent] = useState(60);
  const [lastSync, setLastSync] = useState("");

  const editable = Boolean(can("game.agent_reward.edit")) && data?.plan.status !== "paid" && data?.plan.status !== "paying";
  const canPay = Boolean(can("game.agent_reward.pay"));

  const autoSynced = useRef(false);
  const hasData = useRef(false);
  const perfRefreshing = useRef(false);
  const perfKey = useRef("");
  // keepDraft=true 表示这是一次静默刷新：保留页面上已经输入但还没保存的金额与拆分，
  // 只把服务端的新数据补进来，避免刷新时把客服正在填的数字冲掉。
  const applyData = useCallback((value: Overview, keepDraft: boolean) => {
    setData(value);
    setPlanTotal(value.plan.plannedTotal);
    if (!keepDraft) setPoolPercent(value.plan.poolPercent || 60);
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

  const loadSummary = useCallback(async (targetDate: string) => {
    try {
      setSummary(await api<Summary>(`/api/game/agent-rewards/summary?date=${encodeURIComponent(targetDate)}`));
    } catch {
      // 汇总只是顶部的辅助信息，失败不打断主流程。
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
      setLastSync(syncClock());
      void loadSummary(targetDate);
      // 首次进入且名单为空时自动同步一次候选池，避免新部署后看到空白页。
      if (value.members.length === 0 && !autoSynced.current && can("game.agent_reward.edit")) {
        autoSynced.current = true;
        try {
          await api("/api/game/agent-rewards/sync", { method: "POST", ...jsonBody({}) });
          applyData(await api<Overview>(url), true);
          void loadSummary(targetDate);
        } catch {
          // 同步失败就保持空名单，用户可以手动点「同步名单」重试。
        }
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "读取奖励数据失败", "error");
    } finally {
      if (!silent && firstLoad) setLoading(false);
    }
  }, [notify, can, applyData, loadSummary]);

  // 切日期或切奖励类型属于换一份数据，草稿要重置；其余刷新一律保留页面输入。
  useEffect(() => { void load(date, kind, false, true); }, [date, kind, load]);

  // 轮询回来时如果日期/分栏已经切换，丢弃旧响应，避免把上一份业绩合并进新页面。
  useEffect(() => { perfKey.current = `${date}|${kind}`; }, [date, kind]);

  // 只把游戏实时业绩/占比合并回当前页面，不碰客服正在填的金额、总额和拆分。
  // 三栏切换、日期切换都走同一份净点数口径，所以顶部占比在哪个分栏都一致。
  const refreshPerformance = useCallback(async (manual = false) => {
    if (perfRefreshing.current || !hasData.current) return;
    perfRefreshing.current = true;
    const key = `${date}|${kind}`;
    try {
      const value = await api<Overview>(`/api/game/agent-rewards?${new URLSearchParams({ date, kind })}`);
      if (perfKey.current !== key) return;
      setData(prev => {
        if (!prev) return value;
        const fresh = new Map(value.members.map(m => [m.agentId, m]));
        return {
          ...prev,
          members: prev.members.map(m => {
            const row = fresh.get(m.agentId);
            return row ? { ...m, perf: row.perf, line: row.line, sharePercent: row.sharePercent } : m;
          }),
          totals: { ...prev.totals, points: value.totals.points },
          warnings: value.warnings,
        };
      });
      setLastSync(syncClock());
      if (manual) notify("今日业绩占比已同步");
    } catch (reason) {
      if (manual) notify(reason instanceof Error ? reason.message : "同步业绩失败", "error");
    } finally {
      perfRefreshing.current = false;
    }
  }, [date, kind, notify]);

  // 业绩是游戏服实时累计的，页面每 30 秒静默同步一次；切到后台标签页时暂停。
  const hasOverview = Boolean(data);
  useEffect(() => {
    if (!hasOverview) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refreshPerformance();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [hasOverview, refreshPerformance]);

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

  // 顶部占比区不受筛选影响：展示本次名单里所有已加入代理，按占比从高到低排。
  const shareRows = useMemo(() => (data?.members ?? [])
    .map(m => ({ id: m.agentId, name: m.name || m.agentId, role: m.role, net: m.perf?.net ?? 0, percent: m.sharePercent ?? 0 }))
    .sort((a, b) => b.percent - a.percent || b.net - a.net || a.id.localeCompare(b.id)), [data]);
  const shareSum = useMemo(() => shareRows.reduce((sum, row) => sum + row.percent, 0), [shareRows]);
  const shareTotal = data?.totals.points ?? 0;

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
    const needPlan = planTotal !== data.plan.plannedTotal || dirty
      || (kind === "pool" && Math.abs(poolPercent - (data.plan.poolPercent || 0)) > 0.001);
    if (needPlan) {
      await api("/api/game/agent-rewards/plan", {
        method: "PUT",
        ...jsonBody({ date: data.plan.date, kind, plannedTotal: planTotal, ...(kind === "pool" ? { poolPercent } : {}) }),
      });
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
      await api("/api/game/agent-rewards/plan", {
        method: "PUT",
        ...jsonBody({ date: data.plan.date, kind, plannedTotal: planTotal, ...(kind === "pool" ? { poolPercent } : {}) }),
      });
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

  // 从名单里删除代理：只把 selected 置 0，记录与历史账保留，之后可在「添加代理」里重新加回来。
  const removeFromList = async (member: Member) => {
    setBusy("remove");
    try {
      await api("/api/game/agent-rewards/select", { method: "POST", ...jsonBody({ agentIds: [member.agentId], selected: false }) });
      await load(date, kind, true);
      notify(`已从名单删除 ${member.name || member.agentId}，需要时可重新添加`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "删除失败", "error");
    } finally { setBusy(""); }
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ["日期", "类型", "代理ID", "昵称", "身份", "联盟", "俱乐部", "今日输赢", "整条线总输赢", "整条线总贡献", "今日业绩(毛)", "已下发", "实际点数(净)", "业绩占比", "分配金额", "子账号拆分"];
    const rows = members.map(m => [
      data.plan.date, KIND_LABEL[kind], m.agentId, m.name, ROLE_LABEL[m.role] ?? m.role,
      m.unionName || m.unionId, m.clubName || m.clubId,
      m.line ? m.line.todayScore : "", m.line ? m.line.totalScore : "", m.line ? m.line.totalContrib : "",
      m.perf ? m.perf.my : "", m.perf ? m.perf.granted : "", m.perf ? m.perf.net : "",
      pct(m.sharePercent),
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
    performance: "按整条线今日贡献逐级扣减后的点数自动分摊计划总额（上级扣掉已给下级的那部分，不重复计算），可人工微调；合计必须等于总额才能发放。",
    core: "按代理规模、层级与整条线贡献人工填写，金额相对固定。表格会带出上一次已发放金额作参考，可一键预填。",
    pool: "直接关联平台当天真实奖池：今日奖池 50% × 共享比例 = 本次计划发放金额（可手动覆盖），再按每人整条线的今日输赢人工分配。",
  };

  const totalWeight = data?.totals.points ?? 0;
  const summaryMap = useMemo(() => {
    const map: Record<string, KindSummary> = {};
    (summary?.items ?? []).forEach(item => { map[item.kind] = item; });
    return map;
  }, [summary]);
  // 奖池共享：比例是加在「奖池 50%」上的，和需求里 100000 → 50000 → 60% → 30000 一致。
  const poolHalf = data?.plan.poolHalf ?? 0;
  const poolSuggested = Math.round(poolHalf * (poolPercent || 0) / 100);
  const kindStatusText = (value?: string) =>
    value === "paid" ? "已发放" : value === "paying" ? "发放中" : value === "partial" ? "部分异常" : "编辑中";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GAME / AGENT REWARD"
        title="业绩核心共享"
        description={descriptions[kind]}
        actions={<div className="page-header__actions">
          <input type="date" value={date} onChange={event => setDate(event.target.value)} />
          <Button onClick={() => setPickOpen(true)}>＋ 添加代理</Button>
          <Button variant="secondary" onClick={() => void refreshPerformance(true)}>刷新业绩</Button>
          <Button variant="secondary" disabled={busy === "sync"} onClick={() => void syncMembers()}>{busy === "sync" ? "同步中…" : "同步名单"}</Button>
          <Button variant="secondary" onClick={() => setLedgerOpen(true)}>发放账单</Button>
        </div>}
      />

      <div className="reward-kinds">
        {tabs.map(tab => {
          const row = summaryMap[tab.key];
          const planned = row?.plannedTotal ?? 0;
          const allocated = row?.allocated ?? 0;
          const gap = planned - allocated;
          return (
            <button key={tab.key} type="button" className={`reward-kind${kind === tab.key ? " is-on" : ""}`}
              onClick={() => setKind(tab.key)}>
              <span className="reward-kind__head">
                {KIND_LABEL[tab.key]}<small>{tab.hint}</small>
                <em className={`reward-status reward-status--${row?.status ?? "draft"}`}>{kindStatusText(row?.status)}</em>
              </span>
              <dl>
                <div><dt>计划发放</dt><dd>{num(planned)}</dd></div>
                <div><dt>已分配</dt><dd>{num(allocated)}</dd></div>
                <div><dt>剩余</dt><dd className={planned > 0 ? (gap === 0 ? "is-ok" : "is-bad") : ""}>{num(Math.abs(gap))}</dd></div>
                <div><dt>参与人数</dt><dd>{row?.count ?? 0}</dd></div>
              </dl>
            </button>
          );
        })}
      </div>

      {data && (
      <section className={`reward-share${shareTotal > 0 ? "" : " is-empty"}`}>
        <div className="reward-share__head">
          <div>
            <strong>今日业绩占比</strong>
            <small>
              本次名单 {shareRows.length} 人 · 按净点数归一，合计 {pct(shareSum)} · 跟随游戏服实时累计，每 30 秒刷新
            </small>
          </div>
          <div className="reward-share__meta">
            <span>合计净点数 <b>{pt(shareTotal)}</b></span>
            <span>最近同步 <b>{lastSync || "—"}</b></span>
            <Button variant="ghost" onClick={() => void refreshPerformance(true)}>立即同步</Button>
          </div>
        </div>
        {shareTotal > 0 && shareRows.length > 0 ? (
          <>
            <div className="reward-share__bar" role="img" aria-label="今日业绩占比分布">
              {shareRows.map((row, index) => row.percent > 0 && (
                <i key={row.id} style={{ width: `${row.percent}%`, background: SHARE_COLORS[index % SHARE_COLORS.length] }}
                  title={`${row.name}：${pct(row.percent)} · 净点数 ${pt(row.net)}`} />
              ))}
            </div>
            <div className="reward-share__chips">
              {shareRows.map((row, index) => (
                <span key={row.id} className={`reward-share__chip${row.percent > 0 ? "" : " is-zero"}`}
                  title={`${ROLE_LABEL[row.role] ?? row.role} · ID ${row.id} · 净点数 ${pt(row.net)}`}>
                  <i style={{ background: SHARE_COLORS[index % SHARE_COLORS.length] }} />
                  <b>{row.name}</b>
                  <em>{pct(row.percent)}</em>
                  <small>{pt(row.net)} 点</small>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="reward-share__empty">
            今日名单内所有代理的净点数都是 0，暂无可分配业绩；游戏产生今日贡献后会自动同步过来。
          </p>
        )}
        <p className="reward-share__note">
          「今日业绩」= 该代理整条线的今日贡献，扣掉直接下级后得到净点数；占比按本次名单内净点数归一，和「业绩奖励」自动分摊比例一致。
        </p>
      </section>
      )}

      <div className="reward-metrics">
        <div className="reward-metric">
          <span>计划发放总额（金币）</span>
          <input type="number" min={0} step={100} value={planTotal} disabled={!editable}
            onChange={event => { setPlanTotal(Math.max(0, Math.floor(Number(event.target.value) || 0))); setDirty(true); }} />
          <small>{kind === "pool" ? "可手动覆盖自动算出的金额" : "每天由主管设置"}</small>
        </div>
        <div className="reward-metric">
          <span>已分配</span>
          <strong>{num(allSum)}</strong>
          <small>{kind === "performance" ? `净点数合计 ${pt(totalWeight)}` : `已填 ${payCount} 人`}</small>
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

      {kind === "pool" && (
        <div className="reward-pool">
          <div className="reward-pool__cell">
            <span>今日奖池总额</span>
            <strong>{data?.plan.poolAvailable ? money2(data.plan.poolTotal) : "读取失败"}</strong>
            <small>平台各皮池实时合计（金币）</small>
          </div>
          <div className="reward-pool__cell">
            <span>今日奖池 50%</span>
            <strong>{data?.plan.poolAvailable ? money2(data.plan.poolHalf) : "—"}</strong>
            <small>共享比例的基数</small>
          </div>
          <div className="reward-pool__cell">
            <span>本次共享比例（%）</span>
            <input type="number" min={0} max={100} step={5} value={poolPercent} disabled={!editable}
              onChange={event => {
                const next = Number(event.target.value);
                setPoolPercent(Math.min(100, Math.max(0, Number.isFinite(next) ? next : 0)));
                setDirty(true);
              }} />
            <small>常用 50% / 60% / 70%，按 50% 基数计算</small>
          </div>
          <div className="reward-pool__cell">
            <span>本次应发（自动计算）</span>
            <strong>{num(poolSuggested)}</strong>
            <small>今日奖池 50% × 共享比例</small>
          </div>
          <div className="reward-pool__foot">
            <span>自动算出的金额只是建议值，可写进计划总额后再逐个代理分配。</span>
            <Button variant="secondary" disabled={!editable || poolSuggested <= 0}
              onClick={() => { setPlanTotal(poolSuggested); setDirty(true); notify(`计划发放总额已设为 ${num(poolSuggested)}`); }}>
              按比例写入计划总额
            </Button>
          </div>
        </div>
      )}

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
            <Button variant="secondary" onClick={() => setPickOpen(true)}>＋ 添加代理</Button>
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
          </div>
        </div>

        {loading ? <LoadingBlock label="正在读取代理奖励数据" /> : members.length === 0 ? (
          <div className="reward-empty">
            <strong>本次分配名单为空</strong>
            <p>先添加要发奖励的代理，只有进入名单的代理才会出现在表格里、参与分摊和发放。名单会一直保留，不用每天重新添加。</p>
            <Button onClick={() => setPickOpen(true)}>＋ 添加代理</Button>
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
                  <th className="reward-num">今日业绩</th>
                  <th className="reward-num">实际点数</th>
                  <th className="reward-num" title="本人净点数 ÷ 本次名单净点数合计；有正业绩时合计固定 100%">业绩占比</th>
                  <th className="reward-num">整条线总输赢</th>
                  <th className="reward-num">今日输赢</th>
                  <th className="reward-num">整条线总贡献</th>
                  {kind === "core" && <th className="reward-num">上次金额</th>}
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
                      {/* 三栏都显示同一套代理数据：今日业绩（毛）、实际点数（净，逐级扣减后）、线输赢与贡献 */}
                      <td className="reward-num">{m.perf ? money2(m.perf.my) : <span className="reward-muted">无数据</span>}</td>
                      <td className="reward-num">
                        <span className={`reward-points${(m.perf?.net ?? 0) > 0 ? "" : " is-zero"}`} title={m.perf ? `毛 ${pt(m.perf.my)} − 下发 ${pt(m.perf.granted)}` : ""}>
                          {m.perf ? pt(m.perf.net) : "无数据"}
                        </span>
                      </td>
                      <td className="reward-num">
                        <span className={`reward-share-pct${(m.sharePercent ?? 0) > 0 ? "" : " is-zero"}`}
                          title={`净点数 ${pt(m.perf?.net ?? 0)} / 名单合计 ${pt(shareTotal)}`}>
                          {pct(m.sharePercent)}
                        </span>
                      </td>
                      <td className="reward-num">{m.line ? signed(m.line.totalScore) : <span className="reward-muted">无数据</span>}</td>
                      <td className="reward-num">{m.line ? signed(m.line.todayScore) : <span className="reward-muted">无数据</span>}</td>
                      <td className="reward-num">{m.line ? money2(m.line.totalContrib) : <span className="reward-muted">无数据</span>}</td>
                      {kind === "core" && (
                        <td className="reward-num">
                          {(data?.lastAmounts?.[m.agentId] ?? 0) > 0
                            ? <span title={data?.lastDate ? `参考 ${data.lastDate} 的发放金额` : ""}>{num(data?.lastAmounts?.[m.agentId] ?? 0)}</span>
                            : <span className="reward-muted">-</span>}
                        </td>
                      )}
                      <td className="reward-num">
                        <input className="reward-amount" type="number" min={0} step={1} value={amount} disabled={!editable}
                          onChange={event => setAmount(m.agentId, Number(event.target.value))} />
                      </td>
                      <td>
                        <div className="reward-ops">
                          <button type="button" className="reward-link" onClick={() => setLineOpen(m)}>线数据</button>
                          <button type="button" className="reward-link" onClick={() => setSubOpen(m)}>分账号</button>
                          <button type="button" className="reward-link reward-link--danger" disabled={!editable}
                            onClick={() => void removeFromList(m)}>删除</button>
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
            <span>业绩占比合计 <b>{shareTotal > 0 ? pct(shareSum) : "—"}</b></span>
            <span>合计 <b>{num(allSum)}</b> 金币</span>
            <span className={diff === 0 ? "is-ok" : "is-bad"}>剩余差额 <b>{num(Math.abs(diff))}</b></span>
            <span className="reward-muted">可见行合计 {num(amountSum)}</span>
          </div>
          <div className="reward-tools">
            <Button variant="ghost" disabled={!editable || busy === "save"} onClick={() => void saveAmountsOnly()}>
              {busy === "save" ? "保存中…" : "保存草稿"}
            </Button>
            <Button variant="secondary" onClick={exportCsv}>导出账单</Button>
            <Button disabled={!canPay || !editable || diff !== 0 || allSum <= 0} onClick={() => void openPay()}>
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
              发放走游戏发钱通道：一单一笔、唯一工单号（前缀 <b>BF</b>），发完逐笔回读余额核对。
              玩家金币流水按工单前缀显示为<b>补发（补分）</b>，三类奖励都一样；主账号与子账号各自独立一笔。
            </p>
            <div className="reward-modal-foot">
              <Button variant="secondary" onClick={() => { setPayOpen(false); setPayResult(null); }}>取消</Button>
              <Button disabled={busy === "pay"} onClick={() => void doPay()}>{busy === "pay" ? "发放中…" : `确认发放 ${num(planTotal)} 金币`}</Button>
            </div>
          </div>
        )}
      </Modal>}

      {pickOpen && <CandidateModal notify={notify} onClose={() => setPickOpen(false)}
        onChanged={() => { void load(date, kind, true); }}
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
function CandidateModal({ notify, onClose, onDone, onChanged }: {
  notify: (m: string, k?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
  /** 名单有变化但弹窗要继续开着（按 ID 直接加入后）时通知外层刷新表格。 */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [unionId, setUnionId] = useState("all");
  const [clubId, setClubId] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [directIds, setDirectIds] = useState("");
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ selected: 0, total: 0 });

  const reload = useCallback(async () => {
    try {
      const value = await api<{ items: Member[]; selected: number; total: number }>("/api/game/agent-rewards/candidates");
      setItems(value.items ?? []);
      setStats({ selected: value.selected ?? 0, total: value.total ?? 0 });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "读取候选名单失败", "error");
    }
  }, [notify]);

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

  // 候选池里没有的账号（还没被授权成俱乐部代理、或已降级的老代理），按 ID 直接加。
  const addDirect = async () => {
    const ids = directIds.split(/[\s,，;；]+/).map(item => item.trim()).filter(Boolean);
    if (!ids.length) return;
    setSaving(true);
    try {
      const result = await api<{ count: number; failed: string[]; added: { agentId: string; name: string }[] }>(
        "/api/game/agent-rewards/members",
        { method: "POST", ...jsonBody({ agentIds: ids }) });
      if (result.failed?.length) {
        notify(`已加入 ${result.count} 人；失败：${result.failed.join("；")}`, "error");
      } else {
        notify(`已加入名单并参与本次分配：${result.added.map(item => `${item.name || item.agentId}(${item.agentId})`).join("、")}`);
      }
      setDirectIds("");
      await reload();
      onChanged();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "按 ID 加入失败", "error");
    } finally { setSaving(false); }
  };

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
    <Modal title="添加参与分配的代理" eyebrow="ADD AGENTS" onClose={onClose} wide>
      <p className="reward-hint">
        候选池共 {stats.total} 个俱乐部代理（大盟主 / 盟主 / 合伙人 / 代理），名单里已有 {stats.selected} 人。
        下方直接勾选即可加入；已被移出的也在这里重新勾回来。列表里没有的账号（还没授权成俱乐部代理的），
        用最下面一行填 ID 加入。
      </p>

      <div className="reward-tools" style={{ marginBottom: 10 }}>
        <input placeholder="搜代理 ID 或昵称" value={keyword} onChange={event => setKeyword(event.target.value.trim())} />
        <select value={unionId} onChange={event => { setUnionId(event.target.value); setClubId("all"); }}>
          <option value="all">全部联盟</option>
          {unions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={clubId} onChange={event => setClubId(event.target.value)}>
          <option value="all">全部俱乐部</option>
          {clubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Button variant="secondary" onClick={selectAllVisible}>全选当前 {visible.length} 人</Button>
        <Button variant="ghost" onClick={clearVisible}>取消全选</Button>
      </div>

      <div className="reward-tools reward-direct-add" style={{ marginBottom: 12 }}>
        <span className="reward-dim">按 ID 直接加入</span>
        <input placeholder="例如 725838，多个用逗号或空格分隔" value={directIds}
          onChange={event => setDirectIds(event.target.value)} style={{ flex: 1, minWidth: 240 }} />
        <Button variant="secondary" disabled={saving || !directIds.trim()} onClick={() => void addDirect()}>
          加入名单
        </Button>
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
