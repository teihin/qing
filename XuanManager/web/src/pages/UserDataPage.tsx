import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { beijingDateInput, dateInputDayCount, formatBeijingDateTime } from "../time";

type Kind = "club" | "gift" | "gold" | "stone" | "bonus" | "quota";

type ChainNode = { playerId: string; name: string; role: string; clubId: string; clubName: string; percent: number };

type ClubRef = {
  clubId: string;
  clubName: string;
  role: string;
  unionId: string;
  unionName: string;
  upperId: string;
  upperName: string;
  percent: number;
  quotaFen: number;
  isCreator: boolean;
  isAgent: boolean;
  chain: ChainNode[];
};

type Profile = {
  playerId: string;
  loginName: string;
  name: string;
  role: string;
  regTime: string;
  clientVersion: string;
  manageUnions: string;
  manageClubs: string;
  gold: number;
  stone: number;
  unclaimedBonus: number;
  quotaVisible: boolean;
  clubs: ClubRef[];
};

type RecordItem = {
  id: number;
  kind: Kind;
  occurredAt: string;
  type: string;
  typeLabel: string;
  amount: number;
  before: number;
  balance: number;
  unit: string;
  playerId: string;
  playerName: string;
  counterparty: string;
  counterpartyId: string;
  clubId: string;
  clubName: string;
  roomId: string;
  level: string;
  levelLabel: string;
  contrib: number;
  bonus: number;
  remark: string;
  remark1: string;
  remark2: string;
  remark3: string;
  remark4: string;
  remark5: string;
};

type Summary = {
  count: number;
  totalIn: number;
  totalOut: number;
  net: number;
  contribTotal: number;
  bonusTotal: number;
  todayBonus: number;
  yesterdayBonus: number;
  extractedBonus: number;
  unclaimedBonus: number;
};

type RecordsResponse = {
  items: RecordItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: Summary;
};

const tabs: Array<{ key: Kind; label: string; hint: string }> = [
  { key: "club", label: "上下分记录", hint: "俱乐部添加积分（上分 / 下分）" },
  { key: "gift", label: "赠送金币", hint: "俱乐部积分赠送与受赠" },
  { key: "gold", label: "金币流向", hint: "usr_cash_water 金币流水" },
  { key: "stone", label: "钻石流向", hint: "usr_cash_water 钻石流水" },
  { key: "bonus", label: "收益红利", hint: "代理分成入账与提取" },
  { key: "quota", label: "额度变化记录", hint: "俱乐部 / 联盟额度变动（大盟主、盟主）" },
];

const moneyFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stoneFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function signed(value: number, digits = 2): string {
  const formatter = digits === 0 ? stoneFormatter : moneyFormatter;
  if (value > 0) return `+${formatter.format(value)}`;
  if (value < 0) return `−${formatter.format(Math.abs(value))}`;
  return formatter.format(0);
}

function roleTone(role: string): string {
  switch (role) {
    case "大盟主": return "root";
    case "盟主": return "leader";
    case "群主": return "owner";
    case "管理员": return "manager";
    case "合伙人": return "agent";
    default: return "member";
  }
}

export default function UserDataPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const initialPlayerId = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("playerId")?.trim() ?? "", []);
  const [playerIdDraft, setPlayerIdDraft] = useState(initialPlayerId);
  const [playerId, setPlayerId] = useState(initialPlayerId);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [kind, setKind] = useState<Kind>("club");
  const [dateFrom, setDateFrom] = useState(() => beijingDateInput(-6));
  const [dateTo, setDateTo] = useState(() => beijingDateInput());
  const [dateDraft, setDateDraft] = useState(() => ({ from: beijingDateInput(-6), to: beijingDateInput() }));
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!playerId) {
      setProfile(null);
      return;
    }
    let alive = true;
    setProfileLoading(true);
    api<Profile>(`/api/game/user-data/profile?playerId=${encodeURIComponent(playerId)}`)
      .then((result) => { if (alive) setProfile(result); })
      .catch((reason: unknown) => {
        if (!alive) return;
        setProfile(null);
        notify(reason instanceof ApiError ? reason.message : "读取玩家信息失败", "error");
      })
      .finally(() => { if (alive) setProfileLoading(false); });
    return () => { alive = false; };
  }, [playerId, notify]);

  const load = useCallback(async () => {
    if (!playerId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        playerId, kind, dateFrom, dateTo, page: String(page), pageSize: String(pageSize),
      });
      if (keyword) params.set("keyword", keyword);
      setData(await api<RecordsResponse>(`/api/game/user-data/records?${params.toString()}`));
    } catch (reason) {
      setData(null);
      notify(reason instanceof ApiError ? reason.message : "读取用户端明细失败", "error");
    } finally {
      setLoading(false);
    }
  }, [playerId, kind, dateFrom, dateTo, page, pageSize, keyword, notify]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const visibleTabs = useMemo(
    () => tabs.filter((item) => item.key !== "quota" || profile?.quotaVisible === true),
    [profile],
  );

  useEffect(() => {
    if (profile && kind === "quota" && !profile.quotaVisible) setKind("club");
  }, [profile, kind]);

  const searchPlayer = () => {
    const clean = playerIdDraft.trim();
    if (!clean) { notify("请输入游戏用户ID", "error"); return; }
    setPlayerId(clean);
    setPlayerIdDraft(clean);
    setProfile(null);
    setData(null);
    setKind("club");
    setPage(1);
  };

  const applyRange = () => {
    const days = dateInputDayCount(dateDraft.from, dateDraft.to);
    if (!Number.isFinite(days)) { notify("请选择完整的开始和结束日期", "error"); return; }
    if (days < 1) { notify("结束日期不能早于开始日期", "error"); return; }
    if (days > 31) { notify("单次最多查询 31 天，请缩短日期范围", "error"); return; }
    setDateFrom(dateDraft.from);
    setDateTo(dateDraft.to);
    setKeyword(keywordDraft.trim());
    setPage(1);
    setReloadKey((value) => value + 1);
  };

  const switchKind = (next: Kind) => {
    if (next === kind) return;
    setKind(next);
    setPage(1);
    setData(null);
  };

  const resetRange = () => {
    const from = beijingDateInput(-6);
    const to = beijingDateInput();
    setDateDraft({ from, to });
    setDateFrom(from);
    setDateTo(to);
    setKeywordDraft("");
    setKeyword("");
    setPage(1);
    setReloadKey((value) => value + 1);
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const activeTab = visibleTabs.find((item) => item.key === kind) ?? visibleTabs[0];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="USER LEDGER"
        title="用户端数据查询"
        description="输入游戏用户ID，查看账号基本信息、所在俱乐部与代理链，并按客户端「我的」页面口径查询上下分、赠送、金币、钻石、收益红利和额度变化明细。默认最近 7 天，单次最多 31 天。"
        actions={<span className="readonly-badge"><i />只读查询</span>}
      />

      <section className="panel user-data-search">
        <div>
          <span className="eyebrow">STEP 01</span>
          <strong>输入游戏用户ID</strong>
          <p>精确查询该玩家的客户端明细，不接受昵称代替用户ID。</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); searchPlayer(); }}>
          <div className="search-box search-box--wide">
            <span>ID</span>
            <input value={playerIdDraft} onChange={(event) => setPlayerIdDraft(event.target.value)} placeholder="例如 292989" autoComplete="off" />
            <button type="submit">查询用户明细</button>
          </div>
        </form>
      </section>

      {!playerId && (
        <section className="panel transaction-welcome">
          <div className="transaction-welcome__mark">查</div>
          <span className="eyebrow">ALL CLIENT RECORDS</span>
          <h2>一个入口查完玩家在客户端看到的全部明细</h2>
          <p>账号资料、俱乐部身份、代理链，以及上下分、赠送金币、金币流向、钻石流向、收益红利和额度变化都在同一页切换，数据按当前日期范围统计。</p>
          <div><span>基本信息</span><span>上下分</span><span>赠送金币</span><span>金币流向</span><span>钻石流向</span><span>收益红利</span><span>额度变化</span></div>
        </section>
      )}

      {playerId && profileLoading && !profile && <section className="panel"><LoadingBlock label="正在读取玩家信息" /></section>}

      {profile && (
        <>
          <section className="transaction-player-card">
            <div className="transaction-player-avatar">{profile.name.slice(0, 1) || "玩"}</div>
            <div>
              <span className="eyebrow">PLAYER ACCOUNT</span>
              <h2>{profile.name || "未设置昵称"}</h2>
              <p>游戏ID：<code>{profile.playerId}</code> · 登录账号：{profile.loginName || "—"}</p>
            </div>
            <div className="transaction-current-balance">
              <small>当前金币 / 钻石</small>
              <strong>{moneyFormatter.format(profile.gold)} <em>/</em> {stoneFormatter.format(profile.stone)}</strong>
              <span>未提取红利 {moneyFormatter.format(profile.unclaimedBonus)} 元</span>
            </div>
          </section>

          <UserDataIdentity profile={profile} />

          <section className={`user-data-tabs user-data-tabs--${kind}`}>
            {visibleTabs.map((item) => (
              <button key={item.key} type="button" className={item.key === kind ? "is-active" : ""} onClick={() => switchKind(item.key)}>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </button>
            ))}
          </section>

          <section className="panel">
            <form className="user-data-filter" onSubmit={(event) => { event.preventDefault(); applyRange(); }}>
              <label>开始日期<input type="date" value={dateDraft.from} onChange={(event) => setDateDraft((current) => ({ ...current, from: event.target.value }))} /></label>
              <label>结束日期<input type="date" value={dateDraft.to} onChange={(event) => setDateDraft((current) => ({ ...current, to: event.target.value }))} /></label>
              <label className="user-data-filter__keyword">关键字<input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="类型、房间号、操作人、备注" /></label>
              <div className="user-data-filter__actions">
                <Button type="submit">应用筛选</Button>
                <Button type="button" variant="secondary" onClick={resetRange}>重置</Button>
              </div>
            </form>

            {data && <UserDataSummaryStrip kind={kind} summary={data.summary} profile={profile} />}

            <div className="toolbar player-toolbar">
              <div><strong>{activeTab.label}</strong><span>{activeTab.hint} · 日期 {dateFrom} 至 {dateTo}</span></div>
              <span className="toolbar__count">{data ? `共 ${data.total} 条` : "尚未查询"}</span>
            </div>

            {loading && !data && <LoadingBlock label="正在读取明细" />}
            {data && data.items.length === 0 && <EmptyState title="没有符合条件的记录" description="可以更换页签、放宽日期范围或清空关键字后再试。" />}
            {data && data.items.length > 0 && (
              <>
                <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
                  <UserDataTable kind={kind} items={data.items} />
                </div>
                <footer className="table-pagination">
                  <span>显示 {firstRow}–{lastRow}，共 {data.total} 条</span>
                  <div>
                    <label>每页
                      <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                        <option value="20">20</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                      </select>
                    </label>
                    <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
                    <strong>{page} / {totalPages}</strong>
                    <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function UserDataIdentity({ profile }: { profile: Profile }) {
  const manageParts: string[] = [];
  if (profile.manageUnions) manageParts.push(`联盟 ${profile.manageUnions}`);
  if (profile.manageClubs) manageParts.push(`俱乐部 ${profile.manageClubs}`);
  return (
    <section className="panel user-data-identity">
      <header className="user-data-identity__head">
        <div>
          <span className="eyebrow">BASIC PROFILE</span>
          <h3>基本信息与代理链</h3>
          <p>账号资料、所在俱乐部身份，以及从直属上级到俱乐部创建者 / 大盟主的代理链。</p>
        </div>
        <span className="toolbar__count">{profile.clubs.length} 个俱乐部</span>
      </header>
      <div className="user-data-facts">
        <div><span>注册时间</span><strong>{profile.regTime || "—"}</strong></div>
        <div><span>账号角色</span><strong>{profile.role || "—"}</strong></div>
        <div><span>客户端版本</span><strong>{profile.clientVersion || "—"}</strong></div>
        <div><span>大小 BOSS 管理范围</span><strong>{manageParts.length > 0 ? manageParts.join(" · ") : "—"}</strong></div>
        <div><span>当前金币 / 钻石</span><strong>{moneyFormatter.format(profile.gold)} 元 / {stoneFormatter.format(profile.stone)} 钻</strong></div>
        <div><span>未提取红利</span><strong>{moneyFormatter.format(profile.unclaimedBonus)} 元</strong></div>
      </div>

      {profile.clubs.length === 0 ? (
        <EmptyState title="未加入俱乐部" description="该玩家当前不在任何俱乐部中，没有可展示的身份与代理链。" />
      ) : (
        <div className="user-data-club-grid">
          {profile.clubs.map((club) => (
            <article key={club.clubId} className="user-data-club">
              <header>
                <div>
                  <strong>{club.clubName || club.clubId}</strong>
                  <small>俱乐部 {club.clubId}</small>
                </div>
                <span className={`user-data-role user-data-role--${roleTone(club.role)}`}>{club.role}</span>
              </header>
              <dl>
                <div>
                  <dt>所属联盟</dt>
                  <dd>{club.unionName || club.unionId ? `${club.unionName || "—"}（${club.unionId}）` : "未入盟"}</dd>
                </div>
                <div>
                  <dt>直属上级</dt>
                  <dd>{club.upperName || club.upperId ? `${club.upperName || "—"}（${club.upperId}）` : (club.isCreator ? "创建者本人" : "无")}</dd>
                </div>
                <div>
                  <dt>分成比例</dt>
                  <dd>{club.isCreator || club.isAgent ? `${club.percent}%` : "—"}</dd>
                </div>
                <div>
                  <dt>当前额度</dt>
                  <dd>{club.role === "大盟主" || club.role === "盟主" ? `${moneyFormatter.format(club.quotaFen / 100)} 元` : "—"}</dd>
                </div>
              </dl>
              <div className="user-data-chain">
                <span className="user-data-chain__label">代理链</span>
                <div className="user-data-chain__track">
                  <span className="user-data-chain__self">本人</span>
                  {club.chain.map((node) => (
                    <Fragment key={`${club.clubId}-${node.playerId}`}>
                      <i>→</i>
                      <span className="user-data-chain__node">{node.name || node.playerId}<small>{node.role}</small></span>
                    </Fragment>
                  ))}
                  {club.chain.length === 0 && <><i>→</i><span className="user-data-chain__empty">无上级</span></>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UserDataSummaryStrip({ kind, summary, profile }: { kind: Kind; summary: Summary; profile: Profile }) {
  if (kind === "bonus") {
    return (
      <div className="transaction-metrics user-data-metrics">
        <article className="gold-metric gold-metric--balance"><span>未提取红利</span><strong>{moneyFormatter.format(profile.unclaimedBonus)}</strong><p>账号当前未提取余额（元）</p></article>
        <article className="gold-metric gold-metric--in"><span>今日新增</span><strong>{moneyFormatter.format(summary.todayBonus)}</strong><p>昨日 {moneyFormatter.format(summary.yesterdayBonus)} 元</p></article>
        <article className="gold-metric gold-metric--net"><span>累计提取</span><strong>{moneyFormatter.format(summary.extractedBonus)}</strong><p>已提取到俱乐部积分（元）</p></article>
        <article className="gold-metric gold-metric--out"><span>筛选范围净入账</span><strong>{moneyFormatter.format(summary.bonusTotal)}</strong><p>毛贡献 {moneyFormatter.format(summary.contribTotal)} 元 · {summary.count} 条</p></article>
      </div>
    );
  }
  const unit = kind === "stone" ? "钻" : "元";
  return (
    <div className="transaction-metrics user-data-metrics">
      <article className="gold-metric gold-metric--balance"><span>记录数</span><strong>{summary.count}</strong><p>{unit === "钻" ? "钻石变动" : "金额变动"}明细条数</p></article>
      <article className="gold-metric gold-metric--in"><span>流入</span><strong>+{unit === "钻" ? stoneFormatter.format(summary.totalIn) : moneyFormatter.format(summary.totalIn)}</strong><p>筛选范围内的增加</p></article>
      <article className="gold-metric gold-metric--out"><span>流出</span><strong>−{unit === "钻" ? stoneFormatter.format(summary.totalOut) : moneyFormatter.format(summary.totalOut)}</strong><p>筛选范围内的减少</p></article>
      <article className={`gold-metric ${summary.net >= 0 ? "gold-metric--in" : "gold-metric--out"}`}><span>净变化</span><strong>{unit === "钻" ? signed(summary.net, 0) : signed(summary.net)} {unit}</strong><p>流入减流出</p></article>
    </div>
  );
}

function UserDataTable({ kind, items }: { kind: Kind; items: RecordItem[] }) {
  if (kind === "bonus") {
    return (
      <table className="user-data-table user-data-table--bonus">
        <thead><tr><th>时间</th><th>层级</th><th>毛贡献</th><th>净入账</th><th>来源玩家</th><th>房间</th><th>俱乐部</th><th>说明</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td><strong>{formatBeijingDateTime(item.occurredAt)}</strong></td>
            <td><span className="user-data-tag">{item.levelLabel}</span>{item.level && <small className="cell-subtitle">{item.level}</small>}</td>
            <td>{moneyFormatter.format(item.contrib)}</td>
            <td><strong className="gold-change gold-change--in">{moneyFormatter.format(item.bonus)}</strong></td>
            <td>{item.counterparty || "—"}{item.counterpartyId && <small className="cell-subtitle">{item.counterpartyId}</small>}</td>
            <td>{item.roomId || "—"}</td>
            <td>{item.clubName || item.clubId || "—"}</td>
            <td><span className="user-data-remark">{item.remark || "—"}</span></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (kind === "gold" || kind === "stone") {
    return (
      <table className="user-data-table">
        <thead><tr><th>时间</th><th>业务类型</th><th>实际变化</th><th>变更前 → 变更后</th><th>房间</th><th>说明</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td><strong>{formatBeijingDateTime(item.occurredAt)}</strong></td>
            <td><strong>{item.typeLabel}</strong>{item.typeLabel !== item.type && <small className="cell-subtitle">{item.type}</small>}</td>
            <td><strong className={`gold-change gold-change--${item.amount >= 0 ? "in" : "out"}`}>{kind === "stone" ? `${signed(item.amount, 0)} 钻` : `${signed(item.amount)} 元`}</strong></td>
            <td><span className="balance-route">{kind === "stone" ? stoneFormatter.format(item.before) : moneyFormatter.format(item.before)}<i>→</i><strong>{kind === "stone" ? stoneFormatter.format(item.balance) : moneyFormatter.format(item.balance)}</strong></span></td>
            <td>{item.roomId || "—"}</td>
            <td><span className="user-data-remark">{item.remark || "—"}</span></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (kind === "quota") {
    return (
      <table className="user-data-table">
        <thead><tr><th>时间</th><th>类型</th><th>额度变化</th><th>变化后余额</th><th>操作人</th><th>俱乐部</th><th>房间</th><th>说明</th></tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td><strong>{formatBeijingDateTime(item.occurredAt)}</strong></td>
            <td><span className={`user-data-tag ${item.amount < 0 ? "is-out" : "is-in"}`}>{item.typeLabel}</span><small className="cell-subtitle">{item.type}</small></td>
            <td><strong className={`gold-change gold-change--${item.amount >= 0 ? "in" : "out"}`}>{signed(item.amount)} 元</strong></td>
            <td>{moneyFormatter.format(item.balance)}</td>
            <td>{item.counterparty || "—"}{item.counterpartyId && <small className="cell-subtitle">{item.counterpartyId}</small>}</td>
            <td>{item.clubName || item.clubId || "—"}</td>
            <td>{item.roomId || "—"}</td>
            <td><span className="user-data-remark">{item.remark || "—"}</span></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  return (
    <table className="user-data-table">
      <thead><tr><th>时间</th><th>类型</th><th>变动金额</th><th>变动后余额</th><th>操作人 / 对方</th><th>俱乐部</th><th>房间</th><th>说明</th></tr></thead>
      <tbody>{items.map((item) => (
        <tr key={item.id}>
          <td><strong>{formatBeijingDateTime(item.occurredAt)}</strong></td>
          <td><span className={`user-data-tag ${item.amount < 0 ? "is-out" : "is-in"}`}>{item.typeLabel}</span><small className="cell-subtitle">{item.type}</small></td>
          <td><strong className={`gold-change gold-change--${item.amount >= 0 ? "in" : "out"}`}>{signed(item.amount)} 元</strong></td>
          <td>{moneyFormatter.format(item.balance)}</td>
          <td>{item.counterparty || "—"}{item.counterpartyId && <small className="cell-subtitle">{item.counterpartyId}</small>}</td>
          <td>{item.clubName || item.clubId || "—"}</td>
          <td>{item.roomId || "—"}</td>
          <td><span className="user-data-remark">{item.remark || "—"}</span></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
