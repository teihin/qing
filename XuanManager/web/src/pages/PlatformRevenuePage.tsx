import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import { beijingDateInput, dateInputDayCount, formatBeijingDateTime } from "../time";

interface RevenueMetrics {
  normalWater: number;
  normalProxyPayout: number;
  rewardDiscount: number;
  rewardProxyPayout: number;
  rewardProxyPool: number;
  lotteryPoolTransfer: number;
  playerConsumption: number;
  withdrawalFee: number;
  grossInflow: number;
  proxyPayout: number;
  totalExpense: number;
  netRevenue: number;
  normalEventCount: number;
  rewardDiscountCount: number;
  rewardProxyCount: number;
  playerConsumptionCount: number;
  withdrawalFeeCount: number;
}

interface RevenuePeriod {
  label: string;
  dateFrom: string;
  dateTo: string;
  complete: boolean;
  metrics: RevenueMetrics;
}

interface RevenueSummaryResponse {
  today: RevenuePeriod;
  month: RevenuePeriod;
  total: RevenuePeriod;
  cache: {
    sourceFrom: string;
    syncedFrom: string;
    syncedTo: string;
    refreshedAt: string;
    historyComplete: boolean;
    monthComplete: boolean;
  };
  unit: string;
  formula: string;
  warnings: string[];
}

type RevenueSource = "all" | "normal_water" | "reward_discount" | "reward_proxy" | "player_consumption" | "withdrawal_fee";

interface RevenueDetailItem {
  id: string;
  sourceType: Exclude<RevenueSource, "all">;
  date: string;
  time: string;
  occurredAt: string;
  playerId: string;
  playerName: string;
  roomId: string;
  roomName: string;
  round: string;
  consumeType: string;
  inflow: number;
  proxyPayout: number;
  lotteryPoolTransfer: number;
  rewardProxyPool: number;
  netRevenue: number;
  note: string;
}

interface RevenueDetailsResponse {
  dateFrom: string;
  dateTo: string;
  source: RevenueSource;
  summary: RevenueMetrics;
  daily: Array<{ date: string; metrics: RevenueMetrics }>;
  items: RevenueDetailItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface RevenueFilters {
  dateFrom: string;
  dateTo: string;
  source: RevenueSource;
}

const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("zh-CN");

const sourceLabels: Record<Exclude<RevenueSource, "all">, string> = {
  normal_water: "普通结算抽水",
  reward_discount: "奖池中奖折扣",
  reward_proxy: "奖池代理红利",
  player_consumption: "玩家消费",
  withdrawal_fee: "提现手续费",
};

function monthStartDate() {
  return `${beijingDateInput().slice(0, 8)}01`;
}

export default function PlatformRevenuePage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const today = beijingDateInput();
  const [summary, setSummary] = useState<RevenueSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryRevision, refreshSummary] = useQueryRefresh();
  const [draft, setDraft] = useState<RevenueFilters>({ dateFrom: today, dateTo: today, source: "all" });
  const [applied, setApplied] = useState<RevenueFilters | null>(null);
  const [details, setDetails] = useState<RevenueDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsRevision, refreshDetails] = useQueryRefresh();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const loadSummary = useCallback(async () => {
    void summaryRevision;
    setSummaryLoading(true);
    try {
      setSummary(await api<RevenueSummaryResponse>("/api/game/platform-revenue/summary"));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "平台收益汇总加载失败", "error");
    } finally {
      setSummaryLoading(false);
    }
  }, [notify, summaryRevision]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const detailsQuery = useMemo(() => {
    if (!applied) return "";
    return new URLSearchParams({
      dateFrom: applied.dateFrom,
      dateTo: applied.dateTo,
      source: applied.source,
      page: String(page),
      pageSize: String(pageSize),
    }).toString();
  }, [applied, page, pageSize]);

  const loadDetails = useCallback(async () => {
    void detailsRevision;
    if (!detailsQuery) return;
    setDetailsLoading(true);
    try {
      setDetails(await api<RevenueDetailsResponse>(`/api/game/platform-revenue/details?${detailsQuery}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "收益明细加载失败", "error");
    } finally {
      setDetailsLoading(false);
    }
  }, [detailsQuery, detailsRevision, notify]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const applyFilters = () => {
    if (!draft.dateFrom || !draft.dateTo) { notify("请选择开始日期和结束日期", "error"); return; }
    if (draft.dateTo < draft.dateFrom) { notify("结束日期不能早于开始日期", "error"); return; }
    const dayCount = dateInputDayCount(draft.dateFrom, draft.dateTo);
    if (dayCount > 31) { notify("为了保护游戏数据库，单次最多查询 31 天", "error"); return; }
    setApplied({ ...draft });
    setPage(1);
    refreshDetails();
  };

  const applyPreset = (kind: "today" | "seven" | "month") => {
    const next = kind === "today"
      ? { dateFrom: today, dateTo: today }
      : kind === "seven"
        ? { dateFrom: beijingDateInput(-6), dateTo: today }
        : { dateFrom: monthStartDate(), dateTo: today };
    setDraft((current) => ({ ...current, ...next }));
  };

  const totalPages = Math.max(1, Math.ceil((details?.total ?? 0) / pageSize));
  const firstRow = details && details.total > 0 ? (details.page - 1) * details.pageSize + 1 : 0;
  const lastRow = details ? Math.min(details.total, details.page * details.pageSize) : 0;

  return (
    <div className="page-stack platform-revenue-page">
      <PageHeader
        eyebrow="PLATFORM REVENUE"
        title="平台收益"
        description="汇总大厅结算抽水、奖池中奖折扣、玩家消费、提现手续费和代理红利支出；仅超级管理员可查看。"
        actions={<Button variant="secondary" disabled={summaryLoading} onClick={refreshSummary}>{summaryLoading ? "刷新中" : "刷新汇总"}</Button>}
      />

      {summaryLoading && !summary ? <section className="panel"><LoadingBlock label="正在读取每日收益缓存" /></section> : summary && (
        <>
          <section className="revenue-period-grid">
            <RevenuePeriodCard period={summary.today} tone="today" />
            <RevenuePeriodCard period={summary.month} tone="month" />
            <RevenuePeriodCard period={summary.total} tone="total" />
          </section>

          <section className="panel revenue-composition-panel">
            <header>
              <div><span className="eyebrow">CURRENT COMPOSITION</span><h2>今日收益构成</h2><p>{summary.formula}</p></div>
              <div className={`revenue-sync-state ${summary.cache.historyComplete ? "is-complete" : "is-syncing"}`}><i />{summary.cache.historyComplete ? "历史已同步" : "历史同步中"}</div>
            </header>
            <RevenueComposition metrics={summary.today.metrics} />
            <footer><span>数据最早：{summary.cache.sourceFrom}</span><span>已同步：{summary.cache.syncedFrom} 至 {summary.cache.syncedTo}</span><span>最近刷新：{formatBeijingDateTime(summary.cache.refreshedAt)}</span></footer>
          </section>

          <section className="revenue-warning-panel">
            <span>!</span><div><strong>统计边界说明</strong>{summary.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          </section>
        </>
      )}

      <section className="panel revenue-query-panel">
        <header><div><span className="eyebrow">DATE RANGE QUERY</span><h2>指定时间段收益明细</h2><p>原始游戏流水仅在点击查询后读取；单次最多 31 天，最多一个收益查询同时执行。</p></div><span className="readonly-badge"><i />只读查询</span></header>
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <div className="revenue-preset-row"><span>快捷日期</span><button type="button" onClick={() => applyPreset("today")}>今日</button><button type="button" onClick={() => applyPreset("seven")}>近 7 天</button><button type="button" onClick={() => applyPreset("month")}>本月</button></div>
          <div className="revenue-filter-grid">
            <Field label="开始日期"><input type="date" max={today} value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></Field>
            <Field label="结束日期"><input type="date" max={today} value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} /></Field>
            <Field label="收益来源"><select value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value as RevenueSource }))}><option value="all">全部来源</option><option value="normal_water">普通结算抽水</option><option value="reward_discount">奖池中奖折扣</option><option value="reward_proxy">奖池代理红利</option><option value="player_consumption">玩家消费</option><option value="withdrawal_fee">提现手续费</option></select></Field>
            <Button type="submit" disabled={detailsLoading}>{detailsLoading ? "查询中" : "查询收益明细"}</Button>
          </div>
        </form>
      </section>

      {!applied && <section className="panel"><EmptyState title="请选择日期后查询" description="默认已选择今天；点击“查询收益明细”后才会访问原始游戏流水，避免页面打开时产生不必要的数据库压力。" /></section>}
      {detailsLoading && !details && <section className="panel"><LoadingBlock label="正在按日期索引读取收益明细" /></section>}

      {details && (
        <>
          <section className="revenue-range-summary">
            <RevenueMiniMetric label="时间段净收益" value={details.summary.netRevenue} tone="net" />
            <RevenueMiniMetric label="收入流入" value={details.summary.grossInflow} tone="in" />
            <RevenueMiniMetric label="代理红利支出" value={-details.summary.proxyPayout} tone="out" />
            <RevenueMiniMetric label="抽奖池转入" value={-details.summary.lotteryPoolTransfer} tone="pool" />
          </section>

          <section className="panel revenue-daily-panel">
            <div className="toolbar player-toolbar"><div><strong>每日收益汇总</strong><span>{details.dateFrom} 至 {details.dateTo} · 金额单位：元</span></div><span className="toolbar__count">{details.daily.length} 天</span></div>
            <div className="table-wrap"><table className="revenue-daily-table"><thead><tr><th>日期</th><th>普通抽水</th><th>中奖折扣</th><th>玩家消费</th><th>提现手续费</th><th>代理红利</th><th>抽奖池转入</th><th>净收益</th></tr></thead><tbody>{details.daily.map((item) => <tr key={item.date}><td><strong>{item.date}</strong></td><td>{formatMoney(item.metrics.normalWater)}</td><td>{formatMoney(item.metrics.rewardDiscount)}</td><td>{formatMoney(item.metrics.playerConsumption)}</td><td>{formatMoney(item.metrics.withdrawalFee ?? 0)}</td><td className="is-expense">{formatExpense(item.metrics.proxyPayout)}</td><td className="is-expense">{formatExpense(item.metrics.lotteryPoolTransfer)}</td><td><strong className={item.metrics.netRevenue >= 0 ? "is-positive" : "is-negative"}>{formatSignedMoney(item.metrics.netRevenue)}</strong></td></tr>)}</tbody></table></div>
          </section>

          <section className="panel revenue-ledger-panel">
            <div className="toolbar player-toolbar"><div><strong>收益来源明细</strong><span>普通抽水已按日期、房间、玩家、时间和抽水额去重</span></div><span className="toolbar__count">共 {details.total} 条</span></div>
            {details.items.length === 0 ? <EmptyState title="所选范围没有收益流水" description="可以更换收益来源或查询其他日期。" /> : (
              <>
                <div className={`table-wrap ${detailsLoading ? "is-loading" : ""}`}><table className="revenue-ledger-table"><thead><tr><th>时间（北京时间）</th><th>来源</th><th>玩家 / 房间</th><th>收入</th><th>代理支出</th><th>抽奖池转入</th><th>本条净收益</th><th>说明</th></tr></thead><tbody>{details.items.map((item) => <RevenueLedgerRow key={item.id} item={item} />)}</tbody></table></div>
                <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {details.total} 条</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || detailsLoading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || detailsLoading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function RevenuePeriodCard({ period, tone }: { period: RevenuePeriod; tone: string }) {
  return <article className={`revenue-period-card revenue-period-card--${tone}`}><header><span>{period.label}净收益</span><i>{period.complete ? "完整" : "同步中"}</i></header><strong>{formatSignedMoney(period.metrics.netRevenue)}</strong><p>{period.dateFrom === period.dateTo ? period.dateFrom : `${period.dateFrom} 至 ${period.dateTo}`}</p><div><span>收入流入<b>{formatMoney(period.metrics.grossInflow)}</b></span><span>支出合计<b>−{formatMoney(period.metrics.totalExpense)}</b></span></div></article>;
}

function RevenueComposition({ metrics }: { metrics: RevenueMetrics }) {
  return <div className="revenue-composition-grid">
    <CompositionItem label="普通结算抽水" value={metrics.normalWater} note={`${integer.format(metrics.normalEventCount)} 笔去重结算`} tone="water" />
    <CompositionItem label="奖池中奖折扣" value={metrics.rewardDiscount} note={`${integer.format(metrics.rewardDiscountCount)} 笔提留`} tone="reward" />
    <CompositionItem label="玩家消费" value={metrics.playerConsumption} note={`${integer.format(metrics.playerConsumptionCount)} 笔，已排除延长时间`} tone="consume" />
    <CompositionItem label="提现手续费" value={metrics.withdrawalFee ?? 0} note={`${integer.format(metrics.withdrawalFeeCount ?? 0)} 笔已完成 VIP 提现 · 费率 2%`} tone="withdrawal" />
    <CompositionItem label="普通代理红利" value={-metrics.normalProxyPayout} note="tax_number / 100" tone="expense" />
    <CompositionItem label="奖池代理红利" value={-metrics.rewardProxyPayout} note={`${integer.format(metrics.rewardProxyCount)} 笔实际支出`} tone="expense" />
    <CompositionItem label="抽奖池转入" value={-metrics.lotteryPoolTransfer} note={`代理奖池待分配 ${formatMoney(metrics.rewardProxyPool)} 元`} tone="pool" />
  </div>;
}

function CompositionItem({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className={`revenue-composition-item revenue-composition-item--${tone}`}><span>{label}</span><strong>{formatSignedMoney(value)}</strong><p>{note}</p></article>;
}

function RevenueMiniMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`revenue-mini-metric revenue-mini-metric--${tone}`}><span>{label}</span><strong>{formatSignedMoney(value)}</strong><small>元</small></article>;
}

function RevenueLedgerRow({ item }: { item: RevenueDetailItem }) {
  const room = item.roomId ? `房间 ${item.roomId}${item.round && item.round !== "0" ? ` · 第 ${item.round} 局` : ""}` : item.sourceType === "withdrawal_fee" ? "提现订单" : "大厅消费";
  return <tr><td><strong>{formatBeijingDateTime(item.occurredAt)}</strong></td><td><span className={`revenue-source-badge revenue-source-badge--${item.sourceType}`}>{sourceLabels[item.sourceType]}</span>{item.consumeType && <small className="cell-subtitle">{item.consumeType}</small>}</td><td><strong>{item.playerName || "未设置昵称"}</strong><small className="cell-subtitle">ID {item.playerId} · {room}</small></td><td className="is-income">+{formatMoney(item.inflow)}</td><td className="is-expense">{item.proxyPayout ? `−${formatMoney(item.proxyPayout)}` : "—"}</td><td className="is-expense">{item.lotteryPoolTransfer ? `−${formatMoney(item.lotteryPoolTransfer)}` : "—"}</td><td><strong className={item.netRevenue >= 0 ? "is-positive" : "is-negative"}>{formatSignedMoney(item.netRevenue)}</strong></td><td><span className="revenue-ledger-note">{item.note || "—"}{item.rewardProxyPool > 0 && <small>代理奖池待分配 {formatMoney(item.rewardProxyPool)} 元</small>}</span></td></tr>;
}

function formatMoney(value: number) { return money.format(Math.abs(value)); }
function formatSignedMoney(value: number) { return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMoney(value)}`; }
function formatExpense(value: number) { return value ? `−${formatMoney(value)}` : "0.00"; }
