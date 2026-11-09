import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { EmptyState, LoadingBlock, Modal } from "./ui";
import type {
  OwnerEarningsClubItem,
  OwnerEarningsDailyItem,
  OwnerEarningsDetailItem,
  OwnerEarningsKind,
  OwnerEarningsRateCount,
  OwnerEarningsResponse,
} from "../types";

const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("zh-CN");
const percentFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

const statusLabels: Record<string, string> = {
  used: "正常",
  init: "未启用",
  del: "已解散",
};

const sourceLabels: Record<string, string> = {
  pool: "池级",
  global: "全局",
  unavailable: "未读取",
  none: "未配置",
};

type RangePreset = "today" | "yesterday" | "7d" | "month" | "custom";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

function beijingToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

function formatMoney(value: number | null | undefined): string {
  return moneyFormatter.format(value ?? 0);
}

function formatPercent(value: number | null | undefined): string {
  return `${percentFormatter.format(value ?? 0)}%`;
}

function rateChips(rates: OwnerEarningsRateCount[]): string {
  if (!rates.length) return "—";
  return rates.map((rate) => `${formatPercent(rate.percent)} × ${integerFormatter.format(rate.agents)}`).join(" · ");
}

/**
 * 联盟/俱乐部收益对账。
 *
 * 暗抽：usr_income_info 的 uniondark/darkroot；
 * 奖池：usr_income_info2 的 unionroot/clubroot（与账号“红利2”一致）。
 * 收益归属以游戏服记录的 remark1 为准：已入盟俱乐部的暗抽/奖池归联盟大盟主。
 */
export default function OwnerEarningsModal({
  scope,
  unionId,
  clubId,
  notify,
  onClose,
}: {
  scope: "union" | "club";
  unionId?: string;
  clubId?: string;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
}) {
  const today = useMemo(() => beijingToday(), []);
  const [kind, setKind] = useState<OwnerEarningsKind>("dark");
  const [preset, setPreset] = useState<RangePreset>("today");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [clubFilter, setClubFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<OwnerEarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const applyPreset = (next: RangePreset) => {
    const base = beijingToday();
    let from = base;
    let to = base;
    if (next === "yesterday") {
      from = addDays(base, -1);
      to = from;
    } else if (next === "7d") {
      from = addDays(base, -6);
      to = base;
    } else if (next === "month") {
      from = monthStart(base);
      to = base;
    }
    setPreset(next);
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        kind,
        dateFrom,
        dateTo,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (clubFilter) params.set("clubId", clubFilter);
      const path = scope === "union"
        ? `/api/game/unions/${unionId}/earnings?${params.toString()}`
        : `/api/game/clubs/${clubId}/earnings?${params.toString()}`;
      const result = await api<OwnerEarningsResponse>(path);
      if (seq !== requestSeq.current) return;
      setData(result);
      const totalPages = Math.max(1, Math.ceil(result.details.total / pageSize));
      if (page > totalPages) setPage(totalPages);
    } catch (reason) {
      if (seq !== requestSeq.current) return;
      const message = errorMessage(reason, "收益数据加载失败");
      setError(message);
      notify(message, "error");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [clubFilter, clubId, dateFrom, dateTo, kind, notify, page, pageSize, scope, unionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedClubName = useMemo(() => {
    if (!clubFilter) return "";
    const club = data?.target.clubs.find((item) => item.clubId === clubFilter);
    return club?.clubName || `俱乐部 ${clubFilter}`;
  }, [clubFilter, data]);

  const clubRows = useMemo(() => {
    const rows = [...(data?.clubs ?? [])];
    rows.sort((left, right) => right.amountFen - left.amountFen);
    return rows;
  }, [data]);

  const totalPages = Math.max(1, Math.ceil((data?.details.total ?? 0) / pageSize));
  const firstRow = data?.details.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.details.total) : 0;
  const isDark = kind === "dark";
  const target = data?.target;
  const title = scope === "union"
    ? `收益对账 · ${target?.unionName || unionId || "联盟"}`
    : `收益对账 · ${target?.clubName || clubId || "俱乐部"}`;
  const clubOwnerDiffers = scope === "club" && target
    && target.ownerId !== "" && target.clubOwnerId !== "" && target.ownerId !== target.clubOwnerId;

  return (
    <Modal title={title} eyebrow={scope === "union" ? "UNION EARNINGS" : "CLUB EARNINGS"} onClose={onClose} xwide>
      {!data && loading ? (
        <LoadingBlock label="正在读取收益数据" />
      ) : !data ? (
        <div>
          <EmptyState title="收益数据无法显示" description={error || "请关闭后重试。"} />
          <div className="form-actions">
            <button type="button" className="button button--secondary" onClick={() => void load()}>重试</button>
          </div>
        </div>
      ) : (
        <div className="earnings-modal">
          <div className="earnings-target">
            <div>
              <span>收益归属</span>
              <strong>{target?.ownerName || target?.ownerId || "未找到"}</strong>
              <small>{target?.ownerRole || "—"} · ID {target?.ownerId || "—"}</small>
            </div>
            <div>
              <span>对账范围</span>
              <strong>{scope === "union" ? target?.unionName || target?.unionId : target?.clubName || target?.clubId}</strong>
              <small>
                {scope === "union"
                  ? `联盟 ${target?.unionId || "—"} · ${target?.clubs.length ?? 0} 个俱乐部`
                  : `俱乐部 ${target?.clubId || "—"}${target?.unionId ? ` · 联盟 ${target.unionName || target.unionId}` : " · 未入盟"}`}
              </small>
            </div>
            {clubOwnerDiffers && (
              <div>
                <span>俱乐部群主</span>
                <strong>{target?.clubOwnerName || target?.clubOwnerId}</strong>
                <small>收益归联盟大盟主</small>
              </div>
            )}
            <div>
              <span>当前筛选</span>
              <strong>{clubFilter ? selectedClubName : "全部俱乐部"}</strong>
              <small>{dateFrom} 至 {dateTo}</small>
            </div>
          </div>

          <div className="balance-action-tabs earnings-tabs" role="tablist" aria-label="收益类型">
            <button
              type="button"
              role="tab"
              aria-selected={isDark}
              className={isDark ? "is-active" : ""}
              onClick={() => {
                setKind("dark");
                setPage(1);
              }}
            >
              暗抽收益
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isDark}
              className={!isDark ? "is-active" : ""}
              onClick={() => {
                setKind("jackpot");
                setPage(1);
              }}
            >
              奖池收益
            </button>
          </div>

          <div className="earnings-filter">
            <div className="earnings-filter__presets">
              {([
                ["today", "今天"],
                ["yesterday", "昨天"],
                ["7d", "近 7 天"],
                ["month", "本月"],
              ] as [RangePreset, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={preset === value ? "is-active" : ""}
                  onClick={() => applyPreset(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              开始
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setPreset("custom");
                  setDateFrom(value);
                  if (value > dateTo) setDateTo(value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              结束
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setPreset("custom");
                  setDateTo(value);
                  if (value < dateFrom) setDateFrom(value);
                  setPage(1);
                }}
              />
            </label>
            {scope === "union" && (
              <label>
                俱乐部
                <select
                  value={clubFilter}
                  onChange={(event) => {
                    setClubFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部俱乐部</option>
                  {data.target.clubs.map((club) => (
                    <option key={club.clubId} value={club.clubId}>
                      {club.clubName || club.clubId}{club.status === "del" ? "（已解散）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="button button--secondary" disabled={loading} onClick={() => void load()}>
              {loading ? "读取中…" : "刷新"}
            </button>
            {clubFilter && (
              <button type="button" className="filter-reset" onClick={() => { setClubFilter(""); setPage(1); }}>
                清除俱乐部筛选
              </button>
            )}
          </div>

          {error && (
            <div className="form-error">
              <span>!</span>
              {error}
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="earnings-warnings">
              {data.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          <div className={`club-detail__summary earnings-summary ${loading ? "is-loading" : ""}`}>
            <div>
              <span>区间收益</span>
              <strong>{formatMoney(data.summary.amountYuan)} 元</strong>
              <small className="cell-subtitle">
                毛额 {formatMoney(data.summary.grossYuan)} 元
                {data.summary.bonusTaxFen > 0 ? ` · 已扣红利暗抽 ${formatMoney(data.summary.bonusTaxYuan)} 元` : ""}
              </small>
            </div>
            <div>
              <span>记录数</span>
              <strong>{integerFormatter.format(data.summary.count)} 笔</strong>
              <small className="cell-subtitle">单笔均额 {formatMoney(data.summary.averageYuan)} 元</small>
            </div>
            <div>
              <span>{isDark ? "基数 / 实际比例" : "奖池开关"}</span>
              <strong>
                {isDark
                  ? `${formatMoney(data.summary.baseYuan)} 元 / ${formatPercent(data.summary.ratioPercent)}`
                  : data.jackpot?.source === "unavailable"
                    ? "未读取"
                    : data.jackpot?.rewardOn ? "已开启" : "已关闭"}
              </strong>
              <small className="cell-subtitle">
                {isDark ? "实际比例 = 区间收益 ÷ 基数" : data.jackpot?.poolKey ? `池键 ${data.jackpot.poolKey}` : "未读取到池配置"}
              </small>
            </div>
            <div>
              <span>{isDark ? "单独设置暗抽" : "未计入本页"}</span>
              <strong>
                {isDark
                  ? data.dark ? `${integerFormatter.format(data.dark.configured)} 个代理` : "—"
                  : `${formatMoney(data.summary.unattributedYuan)} 元`}
              </strong>
              <small className="cell-subtitle">
                {isDark
                  ? data.dark ? `未单独设置 ${integerFormatter.format(data.dark.unset)} 个（按房间默认）` : "设置读取失败"
                  : `${integerFormatter.format(data.summary.unattributedCount)} 笔归属该账号但不在当前范围`}
              </small>
            </div>
          </div>

          <section className="earnings-section">
            <div className="earnings-section__head">
              <h3>按日收益</h3>
              <span>{isDark ? "每日暗抽与基数" : "每日奖池提留/派奖入账"}</span>
            </div>
            {data.daily.length === 0 ? (
              <div className="earnings-empty">该区间没有收益记录。</div>
            ) : (
              <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
                <table className="club-table earnings-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>收益（元）</th>
                      {isDark && <th>基数（元）</th>}
                      {isDark && <th>实际比例</th>}
                      <th>笔数</th>
                      <th>单笔均额（元）</th>
                      {data.summary.bonusTaxFen > 0 && <th>已扣红利暗抽</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((item: OwnerEarningsDailyItem) => (
                      <tr key={item.date}>
                        <td><strong>{item.date}</strong>{item.date === today ? <small className="cell-subtitle">实时累计</small> : null}</td>
                        <td><strong>{formatMoney(item.amountYuan)}</strong></td>
                        {isDark && <td>{formatMoney(item.baseYuan)}</td>}
                        {isDark && <td>{formatPercent(item.ratioPercent)}</td>}
                        <td>{integerFormatter.format(item.count)}</td>
                        <td>{formatMoney(item.averageYuan)}</td>
                        {data.summary.bonusTaxFen > 0 && <td>{formatMoney(item.bonusTaxYuan)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="earnings-section">
            <div className="earnings-section__head">
              <h3>按俱乐部汇总</h3>
              <span>收益按产生流水的俱乐部拆分，便于逐俱乐部对账</span>
            </div>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="club-table earnings-table">
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>状态</th>
                    <th>收益（元）</th>
                    {isDark && <th>基数（元）</th>}
                    {isDark && <th>实际比例</th>}
                    <th>笔数</th>
                    <th className="align-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {clubRows.length === 0 ? (
                    <tr><td colSpan={isDark ? 7 : 5}>该区间没有俱乐部收益记录。</td></tr>
                  ) : clubRows.map((item: OwnerEarningsClubItem) => (
                    <tr key={item.clubId || "unknown"}>
                      <td>
                        <strong>{item.clubName || "未关联俱乐部"}</strong>
                        {item.clubId && <small className="cell-subtitle">ID：{item.clubId}</small>}
                      </td>
                      <td>{statusLabels[item.status] ?? item.status ?? "—"}</td>
                      <td><strong>{formatMoney(item.amountYuan)}</strong></td>
                      {isDark && <td>{formatMoney(item.baseYuan)}</td>}
                      {isDark && <td>{formatPercent(item.ratioPercent)}</td>}
                      <td>{integerFormatter.format(item.count)}</td>
                      <td>
                        {scope === "union" && item.clubId && (
                          <div className="row-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setClubFilter(item.clubId === clubFilter ? "" : item.clubId);
                                setPage(1);
                              }}
                            >
                              {item.clubId === clubFilter ? "取消筛选" : "只看本俱乐部"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="earnings-section">
            <div className="earnings-section__head">
              <h3>逐笔明细</h3>
              <span>{isDark ? "每笔暗抽的实际执行值与房间水率" : "奖池提留/入账流水"}</span>
            </div>
            {data.details.items.length === 0 ? (
              <div className="earnings-empty">该区间没有明细。</div>
            ) : (
              <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
                <table className="club-table earnings-table earnings-table--details">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>俱乐部</th>
                      <th>房间</th>
                      {isDark ? <th>玩家</th> : <th>来源</th>}
                      {isDark && <th>基数（元）</th>}
                      {isDark && <th>暗抽值</th>}
                      {isDark && <th>实际比例</th>}
                      {!isDark && <th>类型</th>}
                      {!isDark && <th>层级</th>}
                      <th>收益（元）</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.details.items.map((item: OwnerEarningsDetailItem) => (
                      <tr key={item.id}>
                        <td><strong>{item.date}</strong><small className="cell-subtitle">{item.time}</small></td>
                        <td>{item.clubName || item.clubId || "—"}</td>
                        <td>{item.roomId || "—"}</td>
                        {isDark ? (
                          <td>
                            {item.playerName || "—"}
                            {item.playerId && <small className="cell-subtitle">ID：{item.playerId}</small>}
                          </td>
                        ) : (
                          <td>{item.playerName ? (item.playerName === "惩罚池" ? "惩罚池（奖池）" : item.playerName) : "奖池"}</td>
                        )}
                        {isDark && <td>{formatMoney(item.baseYuan)}</td>}
                        {isDark && <td>{item.ratePercent > 0 ? formatPercent(item.ratePercent) : "不抽"}</td>}
                        {isDark && <td>{formatPercent(item.actualPercent)}</td>}
                        {!isDark && <td>{item.typeLabel || "—"}</td>}
                        {!isDark && <td>{item.levelLabel || "—"}</td>}
                        <td>
                          <strong>{formatMoney(item.amountYuan)}</strong>
                          {item.bonusTaxYuan > 0 && <small className="cell-subtitle">已扣红利暗抽 {formatMoney(item.bonusTaxYuan)}</small>}
                        </td>
                        <td>{item.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.details.total > 0 && (
              <footer className="table-pagination">
                <span>显示 {firstRow}–{lastRow}，共 {data.details.total} 笔</span>
                <div>
                  <label>
                    每页
                    <select
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setPage(1);
                      }}
                    >
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </label>
                  <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
                    上一页
                  </button>
                  <strong>{page} / {totalPages}</strong>
                  <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>
                    下一页
                  </button>
                </div>
              </footer>
            )}
            {isDark && (
              <p className="earnings-note">
                「暗抽值」是本笔实际执行的暗抽比例；代理未单独设置时等于房间玩法默认值，因此未单独设置不等于不抽。
              </p>
            )}
          </section>

          {isDark && data.dark && (
            <section className="earnings-section">
              <div className="earnings-section__head">
                <h3>暗抽比例设置</h3>
                <span>当前快照；历史实际比例以逐笔明细为准</span>
              </div>
              <div className="earnings-config-summary">
                <div><span>已设置代理</span><strong>{integerFormatter.format(data.dark.configured)}</strong></div>
                <div><span>未单独设置</span><strong>{integerFormatter.format(data.dark.unset)}</strong></div>
                <div><span>区间实际比例</span><strong>{formatPercent(data.dark.effectivePercent)}</strong></div>
              </div>
              <div className="table-wrap">
                <table className="club-table earnings-table earnings-table--config">
                  <thead>
                    <tr>
                      <th>俱乐部</th>
                      <th>已设置</th>
                      <th>未单独设置</th>
                      <th>比例分布（比例 × 代理数）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dark.clubs.length === 0 ? (
                      <tr><td colSpan={4}>没有读取到代理暗抽设置。</td></tr>
                    ) : data.dark.clubs.map((club) => (
                      <tr key={club.clubId}>
                        <td>
                          <strong>{club.clubName || "未关联俱乐部"}</strong>
                          <small className="cell-subtitle">ID：{club.clubId}</small>
                        </td>
                        <td>{integerFormatter.format(club.configured)}</td>
                        <td>{integerFormatter.format(club.unset)}</td>
                        <td><span className="earnings-chip">{rateChips(club.rates)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="earnings-note">{data.dark.note}</p>
            </section>
          )}

          {!isDark && data.jackpot && (
            <section className="earnings-section">
              <div className="earnings-section__head">
                <h3>奖池提留与派奖比例</h3>
                <span>池级配置优先，未配置的键跟随全局</span>
              </div>
              <div className="earnings-config-summary">
                <div><span>池键</span><strong>{data.jackpot.poolKey || "—"}</strong></div>
                <div><span>池类型</span><strong>{data.jackpot.poolType === "union" ? "联盟共用池" : "独立俱乐部池"}</strong></div>
                <div><span>奖池开关</span><strong>{data.jackpot.source === "unavailable" ? "未读取" : data.jackpot.rewardOn ? "已开启" : "已关闭"}</strong></div>
              </div>
              <div className="earnings-config-grid">
                <div>
                  <h4>各底皮提留（元）</h4>
                  <div className="table-wrap">
                    <table className="club-table earnings-table earnings-table--config">
                      <thead><tr><th>底皮</th><th>提留</th><th>来源</th></tr></thead>
                      <tbody>
                        {data.jackpot.retention.map((item) => (
                          <tr key={item.key}>
                            <td>{item.label || item.key}</td>
                            <td>{item.yuan === null ? "—" : `${formatMoney(item.yuan)} 元`}</td>
                            <td>{sourceLabels[item.source] ?? item.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h4>派奖比例（%）</h4>
                  <div className="table-wrap">
                    <table className="club-table earnings-table earnings-table--config">
                      <thead><tr><th>牌型</th><th>比例</th><th>来源</th></tr></thead>
                      <tbody>
                        {data.jackpot.payouts.map((item) => (
                          <tr key={item.key}>
                            <td>{item.key}</td>
                            <td>{item.percent === null ? "—" : formatPercent(item.percent)}</td>
                            <td>{item.percent === null ? "跟随全局" : sourceLabels[item.source] ?? item.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              {!data.jackpot.rewardOn && (
                <p className="earnings-note">奖池关闭期间不产生新的提留；历史明细仍会显示关闭前的数据。</p>
              )}
              {data.jackpot.warnings.length > 0 && (
                <div className="earnings-warnings">
                  {data.jackpot.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
