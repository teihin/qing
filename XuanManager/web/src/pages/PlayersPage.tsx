import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, Field, formatDate, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type { PlayerItem, PlayerRoomHistoryItem, PlayerRoomHistoryResponse, TransactionItem, TransactionResponse } from "../types";

interface PlayerResponse {
  items: PlayerItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface PlayerFilters {
  keyword: string;
  playerId: string;
  name: string;
  loginName: string;
  agentId: string;
  agentName: string;
  level: string;
  roomId: string;
  role: string;
  clientStatus: string;
  clientVersion: string;
  minBalance: string;
  maxBalance: string;
  registeredFrom: string;
  registeredTo: string;
}

const emptyFilters: PlayerFilters = {
  keyword: "",
  playerId: "",
  name: "",
  loginName: "",
  agentId: "",
  agentName: "",
  level: "",
  roomId: "",
  role: "",
  clientStatus: "",
  clientVersion: "",
  minBalance: "",
  maxBalance: "",
  registeredFrom: "",
  registeredTo: "",
};

const balanceFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PlayersPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<PlayerResponse | null>(null);
  const [draft, setDraft] = useState<PlayerFilters>(emptyFilters);
  const [applied, setApplied] = useState<PlayerFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<PlayerItem | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<PlayerResponse>(`/api/game/players?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "游戏玩家加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, notify]);
  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as unknown as PlayerFilters);
    setPage(1);
  };
  const resetFilters = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  };
  const update = (key: keyof PlayerFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const activeFilterCount = Object.values(applied).filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GAME PLAYERS"
        title="玩家管理"
        description="从游戏数据库只读查询玩家账号、余额、代理关系和客户端状态。"
        actions={<span className="readonly-badge"><i />只读数据</span>}
      />

      <section className="panel player-filter-panel">
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <div className="player-filter-primary">
            <div className="search-box search-box--wide">
              <span>⌕</span>
              <input value={draft.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="输入玩家ID、登录账号、昵称、代理ID或代理名字" />
            </div>
            <Button type="submit">查询玩家</Button>
            <Button type="button" variant="secondary" onClick={() => setAdvanced((value) => !value)}>
              {advanced ? "收起条件" : "更多条件"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </Button>
            {activeFilterCount > 0 && <button className="filter-reset" type="button" onClick={resetFilters}>清空筛选</button>}
          </div>

          {advanced && (
            <div className="player-filter-advanced">
              <Field label="玩家ID"><input value={draft.playerId} onChange={(event) => update("playerId", event.target.value)} placeholder="精确匹配游戏ID" /></Field>
              <Field label="玩家昵称"><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="支持部分匹配" /></Field>
              <Field label="登录账号"><input value={draft.loginName} onChange={(event) => update("loginName", event.target.value)} placeholder="登录名或KBE账号" /></Field>
              <Field label="直属代理ID"><input value={draft.agentId} onChange={(event) => update("agentId", event.target.value)} placeholder="精确匹配代理ID" /></Field>
              <Field label="直属代理名字"><input value={draft.agentName} onChange={(event) => update("agentName", event.target.value)} placeholder="支持部分匹配" /></Field>
              <Field label="玩家等级"><input type="number" min="0" value={draft.level} onChange={(event) => update("level", event.target.value)} placeholder="例如 98" /></Field>
              <Field label="角色标记"><input value={draft.role} onChange={(event) => update("role", event.target.value)} placeholder="游戏内角色标签" /></Field>
              <Field label="当前房间ID"><input type="number" min="0" value={draft.roomId} onChange={(event) => update("roomId", event.target.value)} placeholder="0 表示未在房间" /></Field>
              <Field label="客户端状态"><input value={draft.clientStatus} onChange={(event) => update("clientStatus", event.target.value)} placeholder="精确匹配状态值" /></Field>
              <Field label="客户端版本"><input value={draft.clientVersion} onChange={(event) => update("clientVersion", event.target.value)} placeholder="精确匹配版本号" /></Field>
              <Field label="最低余额"><input type="number" step="0.01" value={draft.minBalance} onChange={(event) => update("minBalance", event.target.value)} /></Field>
              <Field label="最高余额"><input type="number" step="0.01" value={draft.maxBalance} onChange={(event) => update("maxBalance", event.target.value)} /></Field>
              <Field label="注册开始日期"><input type="date" value={draft.registeredFrom} onChange={(event) => update("registeredFrom", event.target.value)} /></Field>
              <Field label="注册结束日期"><input type="date" value={draft.registeredTo} onChange={(event) => update("registeredTo", event.target.value)} /></Field>
              <div className="filter-actions"><Button type="submit">应用组合条件</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置</Button></div>
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div><strong>游戏玩家列表</strong><span>数据来自服务器本机 kbedm.tbl_Account</span></div>
          <span className="toolbar__count">共 {data?.total ?? 0} 名玩家</span>
        </div>
        {loading && !data ? <LoadingBlock label="正在读取游戏玩家" /> : !data || data.items.length === 0 ? (
          <EmptyState title="没有找到玩家" description="可以清空部分查询条件后重新搜索。" />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="player-table">
                <thead><tr><th>玩家</th><th>登录账号</th><th>现金余额</th><th>等级 / 角色</th><th>直属代理</th><th>房间 / 客户端</th><th>注册 / 登录</th><th className="align-right">操作</th></tr></thead>
                <tbody>{data.items.map((player) => (
                  <tr key={player.id}>
                    <td><div className="user-cell"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><small>ID：{player.playerId}</small></div></div></td>
                    <td><code>{player.loginName || "—"}</code>{player.accountName && player.accountName !== player.loginName && <small className="cell-subtitle">KBE：{player.accountName}</small>}</td>
                    <td><strong className="money-value">{balanceFormatter.format(player.balance)}</strong><small className="cell-subtitle">游戏金币</small></td>
                    <td><strong>等级 {player.level}</strong><small className="cell-subtitle">{player.role || "无角色标记"}</small></td>
                    <td>{player.agentId ? <><strong>{player.agentName || "未知代理"}</strong><small className="cell-subtitle">ID：{player.agentId}</small></> : <span className="muted">无直属代理</span>}</td>
                    <td><strong>{player.roomId > 0 ? `房间 ${player.roomId}` : "未在房间"}</strong><small className="cell-subtitle">{player.clientStatus || "状态未上报"}{player.clientVersion ? ` · ${player.clientVersion}` : ""}</small></td>
                    <td>{formatDate(player.registrationTime)}<small className="cell-subtitle">最近：{formatDate(player.lastLoginAt)}</small></td>
                    <td><div className="row-actions"><button onClick={() => setSelected(player)}>查看详情</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <footer className="table-pagination">
              <span>显示 {firstRow}–{lastRow}，共 {data.total} 条</span>
              <div>
                <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
                <strong>{page} / {totalPages}</strong>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
              </div>
            </footer>
          </>
        )}
      </section>

      {selected && <PlayerDetail player={selected} can={can} notify={notify} onClose={() => setSelected(null)} />}
    </div>
  );
}

type PlayerDetailTab = "profile" | "finance" | "rooms";

function PlayerDetail({ player, can, notify, onClose }: { player: PlayerItem; can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void }) {
  const [tab, setTab] = useState<PlayerDetailTab>("profile");
  const [finance, setFinance] = useState<TransactionResponse | null>(null);
  const [financePage, setFinancePage] = useState(1);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [rooms, setRooms] = useState<PlayerRoomHistoryResponse | null>(null);
  const [roomPage, setRoomPage] = useState(1);
  const [roomLoading, setRoomLoading] = useState(false);
  const canViewFinance = can("game.transaction.view");
  const canViewRooms = can("game.room_record.view");

  const loadFinance = useCallback(async () => {
    if (!canViewFinance) return;
    setFinanceLoading(true);
    try {
      setFinance(await api<TransactionResponse>(`/api/game/transactions?playerId=${encodeURIComponent(player.playerId)}&page=${financePage}&pageSize=10`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家资金情况加载失败", "error");
    } finally { setFinanceLoading(false); }
  }, [canViewFinance, financePage, notify, player.playerId]);

  const loadRooms = useCallback(async () => {
    if (!canViewRooms) return;
    setRoomLoading(true);
    try {
      setRooms(await api<PlayerRoomHistoryResponse>(`/api/game/players/${encodeURIComponent(player.playerId)}/rooms?page=${roomPage}&pageSize=10`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家房间战绩加载失败", "error");
    } finally { setRoomLoading(false); }
  }, [canViewRooms, notify, player.playerId, roomPage]);

  useEffect(() => { if (tab === "finance") void loadFinance(); }, [loadFinance, tab]);
  useEffect(() => { if (tab === "rooms") void loadRooms(); }, [loadRooms, tab]);

  return (
    <Modal wide title={player.name || `玩家 ${player.playerId}`} eyebrow="PLAYER PROFILE" onClose={onClose}>
      <div className="player-detail-heading">
        <span>{player.name.slice(0, 1) || "玩"}</span>
        <div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID：{player.playerId} · 登录账号：{player.loginName || "—"}</p></div>
        <em>只读</em>
      </div>
      <nav className="player-profile-tabs" aria-label="玩家详情分类">
        <button type="button" className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}><span>基本资料</span><small>账号、资产与代理</small></button>
        <button type="button" className={tab === "finance" ? "is-active" : ""} disabled={!canViewFinance} onClick={() => setTab("finance")}><span>资金情况</span><small>{canViewFinance ? "完整金币流水" : "当前角色无权限"}</small></button>
        <button type="button" className={tab === "rooms" ? "is-active" : ""} disabled={!canViewRooms} onClick={() => setTab("rooms")}><span>房间战绩</span><small>{canViewRooms ? "参战房间与输赢" : "当前角色无权限"}</small></button>
      </nav>
      {tab === "profile" && <PlayerProfileTab player={player} />}
      {tab === "finance" && canViewFinance && <PlayerFinanceTab player={player} data={finance} page={financePage} loading={financeLoading} onPage={setFinancePage} />}
      {tab === "rooms" && canViewRooms && <PlayerRoomsTab player={player} data={rooms} page={roomPage} loading={roomLoading} onPage={setRoomPage} />}
    </Modal>
  );
}

function PlayerProfileTab({ player }: { player: PlayerItem }) {
  return <div className="player-profile-tab-content">
      <section className="player-detail-section">
        <h3>账号与游戏状态</h3>
        <div className="player-detail-grid">
          <Detail label="KBE账号" value={player.accountName} mono />
          <Detail label="性别" value={player.sex} />
          <Detail label="角色标记" value={player.role} />
          <Detail label="玩家等级" value={player.level} />
          <Detail label="VIP / VIP等级" value={`${player.vip} / ${player.vipLevel}`} />
          <Detail label="客户端状态" value={player.clientStatus || "未上报"} />
          <Detail label="客户端版本" value={player.clientVersion} />
          <Detail label="当前房间" value={player.roomId > 0 ? `${player.roomId}（${player.roomType || "类型未记录"}）` : "未在房间"} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>资产与战绩</h3>
        <div className="player-detail-grid">
          <Detail label="现金余额" value={balanceFormatter.format(player.balance)} highlight />
          <Detail label="金币整数 / 小数" value={`${player.gold} / ${player.gold2}`} />
          <Detail label="累计局数" value={player.totalRounds} />
          <Detail label="累计总分" value={player.totalScore} />
          <Detail label="登录次数" value={player.loginCount} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>代理关系</h3>
        <div className="player-detail-grid">
          <Detail label="直属代理" value={player.agentName ? `${player.agentName}（${player.agentId}）` : player.agentId} />
          <Detail label="大代理ID" value={player.bigAgentId} mono />
          <Detail label="合伙人ID" value={player.partnerAgentId} mono />
          <Detail label="总裁ID" value={player.chiefAgentId} mono />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>注册与其他参数</h3>
        <div className="player-detail-grid">
          <Detail label="注册时间" value={formatDate(player.registrationTime)} />
          <Detail label="最近登录" value={formatDate(player.lastLoginAt)} />
          <Detail label="优化1 次数 / 概率" value={`${player.optimizeOneCount} / ${player.optimizeOneChance}%`} />
          <Detail label="优化2 次数 / 概率" value={`${player.optimizeTwoCount} / ${player.optimizeTwoChance}%`} />
          <Detail label="备注" value={player.remark} wide />
        </div>
      </section>
    </div>;
}

function PlayerFinanceTab({ player, data, page, loading, onPage }: { player: PlayerItem; data: TransactionResponse | null; page: number; loading: boolean; onPage: (page: number) => void }) {
  if (loading && !data) return <LoadingBlock label="正在读取玩家完整资金情况" />;
  if (!data) return <EmptyState title="资金情况暂时无法显示" description="请稍后重新打开资金情况页签。" />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="player-profile-tab-content">
    <section className="player-fund-overview">
      <ProfileMetric label="当前金币" value={balanceFormatter.format(data.player.currentBalance)} note={`${data.player.totalRecords} 条历史流水`} />
      <ProfileMetric label="历史总流入" value={`+${balanceFormatter.format(data.summary.totalIn)}`} note={`最早记录 ${data.summary.firstAt || "—"}`} tone="win" />
      <ProfileMetric label="历史总流出" value={`−${balanceFormatter.format(data.summary.totalOut)}`} note={`道具支出 ${balanceFormatter.format(data.summary.itemSpend)}`} tone="loss" />
      <ProfileMetric label="金币净变化" value={formatPlayerScore(data.summary.netChange)} note={`游戏相关 ${formatPlayerScore(data.summary.gameNet)}`} tone={data.summary.netChange >= 0 ? "win" : "loss"} />
    </section>
    <section className="player-profile-data-section">
      <div className="player-profile-section-title"><div><h3>全部金币流水</h3><p>显示每笔金币变更前后余额、实际增减和关联房间</p></div><button type="button" onClick={() => { window.location.hash = `/game/transactions?playerId=${encodeURIComponent(player.playerId)}`; }}>进入交易记录模块</button></div>
      {data.items.length === 0 ? <EmptyState title="该玩家没有金币流水" description="服务器主金币流水中暂时没有这个玩家的记录。" /> : <div className="table-wrap"><table className="player-finance-table"><thead><tr><th>时间</th><th>业务类型</th><th>实际变化</th><th>变更前 → 变更后</th><th>关联内容</th></tr></thead><tbody>{data.items.map((item) => <PlayerFinanceRow key={item.id} item={item} />)}</tbody></table></div>}
      <ProfilePagination page={page} totalPages={totalPages} total={data.total} loading={loading} onPage={onPage} unit="条流水" />
    </section>
  </div>;
}

function PlayerFinanceRow({ item }: { item: TransactionItem }) {
  const context = [item.remark1 ? `房间 ${item.remark1}` : "", item.remark3 && item.remark3 !== "0" ? `第 ${item.remark3} 局` : "", item.remark4].filter(Boolean).join(" · ");
  return <tr><td><strong>{item.date}</strong><small className="cell-subtitle">{item.time}</small></td><td><strong>{item.optionType}</strong><small className="cell-subtitle">{financeCategoryLabel(item.category)}</small></td><td><strong className={`room-score room-score--${item.change > 0 ? "win" : item.change < 0 ? "loss" : "draw"}`}>{formatPlayerScore(item.change)}</strong></td><td><span className="balance-route">{balanceFormatter.format(item.oldBalance)}<i>→</i><strong>{balanceFormatter.format(item.newBalance)}</strong></span></td><td><span className="player-history-context">{context || "无关联说明"}</span></td></tr>;
}

function PlayerRoomsTab({ player, data, page, loading, onPage }: { player: PlayerItem; data: PlayerRoomHistoryResponse | null; page: number; loading: boolean; onPage: (page: number) => void }) {
  if (loading && !data) return <LoadingBlock label="正在读取玩家参与过的房间" />;
  if (!data) return <EmptyState title="房间战绩暂时无法显示" description="请稍后重新打开房间战绩页签。" />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="player-profile-tab-content">
    <section className="player-fund-overview player-room-overview">
      <ProfileMetric label="参与房间" value={`${data.summary.roomCount} 个`} note={`共参与 ${data.summary.roundsPlayed} 局`} />
      <ProfileMetric label="房间胜负" value={`${data.summary.winRooms} 胜 / ${data.summary.lossRooms} 负`} note={`${data.summary.drawRooms} 个房间持平`} />
      <ProfileMetric label="累计带入 / 返还" value={`${balanceFormatter.format(data.summary.totalBuyIn)} / ${balanceFormatter.format(data.summary.totalSettlementReturn)}`} note="按房间结算流水统计" />
      <ProfileMetric label="房间总输赢" value={formatPlayerScore(data.summary.netScore)} note="结算返还减累计带入" tone={data.summary.netScore >= 0 ? "win" : "loss"} />
    </section>
    <section className="player-profile-data-section">
      <div className="player-profile-section-title"><div><h3>{player.name || player.playerId} 的房间对战</h3><p>点击房间可继续查看本房间全部玩家和逐局牌面</p></div><span>{data.total} 个房间</span></div>
      {data.items.length === 0 ? <EmptyState title="该玩家没有房间战绩" description="总战绩表中暂时没有这个玩家形成的房间记录。" /> : <div className="table-wrap"><table className="player-room-history-table"><thead><tr><th>房间</th><th>房间时间</th><th>座位 / 局数</th><th>累计带入 / 返还</th><th>最终输赢</th><th>操作</th></tr></thead><tbody>{data.items.map((item) => <PlayerRoomRow key={item.id} item={item} />)}</tbody></table></div>}
      <ProfilePagination page={page} totalPages={totalPages} total={data.total} loading={loading} onPage={onPage} unit="个房间" />
    </section>
  </div>;
}

function PlayerRoomRow({ item }: { item: PlayerRoomHistoryItem }) {
  return <tr><td><strong className="room-list-id">{item.roomId}</strong><small className="cell-subtitle">{item.roomName || item.playMode || "未记录房间名"}</small></td><td><span>{item.startedAt || item.recordedAt || "—"}</span><small className="cell-subtitle">至 {item.endedAt || item.recordedAt || "—"}</small></td><td><strong>{item.seat + 1} 号位 · {item.roundsPlayed} 局</strong><small className="cell-subtitle">房间共 {item.roomRoundCount} 局</small></td><td><strong>{balanceFormatter.format(item.totalBuyIn)} / {item.scoreSource === "settlement" ? balanceFormatter.format(item.settlementReturn) : "未记录"}</strong></td><td><strong className={`room-score room-score--${item.result}`}>{formatPlayerScore(item.score)}</strong>{item.scoreMismatch && <small className="room-score-warning">原战绩 {formatPlayerScore(item.recordedScore)}</small>}</td><td><button className="player-profile-link" type="button" onClick={() => { window.location.hash = `/game/room-records?roomId=${encodeURIComponent(item.roomId)}`; }}>查看房间战绩</button></td></tr>;
}

function ProfileMetric({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`player-profile-metric player-profile-metric--${tone}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function ProfilePagination({ page, totalPages, total, loading, onPage, unit }: { page: number; totalPages: number; total: number; loading: boolean; onPage: (page: number) => void; unit: string }) {
  return <footer className="table-pagination"><span>共 {total} {unit}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button></div></footer>;
}

function financeCategoryLabel(category: TransactionItem["category"]) {
  return { game: "游戏输赢", item: "道具消费", consumption: "其他消费", adjustment: "人工调整", other: "其他变化" }[category];
}

function formatPlayerScore(value: number) {
  if (value > 0) return `+${balanceFormatter.format(value)}`;
  if (value < 0) return `−${balanceFormatter.format(Math.abs(value))}`;
  return balanceFormatter.format(0);
}

function Detail({ label, value, mono = false, highlight = false, wide = false }: { label: string; value: string | number; mono?: boolean; highlight?: boolean; wide?: boolean }) {
  const text = value === "" || value === null || value === undefined ? "—" : String(value);
  return <div className={`detail-item ${wide ? "detail-item--wide" : ""}`}><span>{label}</span><strong className={`${mono ? "is-mono" : ""} ${highlight ? "is-highlight" : ""}`}>{text}</strong></div>;
}
