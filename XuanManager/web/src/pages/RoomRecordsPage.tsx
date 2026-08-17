import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { EmptyState, LoadingBlock, Modal, PageHeader } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import { formatBeijingDateTime, formatBeijingTime } from "../time";
import type { RoomRecordAction, RoomRecordCard, RoomRecordListItem, RoomRecordListResponse, RoomRecordResponse, RoomRecordRound, RoomRecordRoundPlayer, RoomRecordRoundResponse } from "../types";

const scoreFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const roundsPerPage = 15;

export default function RoomRecordsPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const initialRoomId = useMemo(() => {
    const value = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("roomId")?.trim() ?? "";
    return /^\d+$/.test(value) && value !== "0" ? value : "";
  }, []);
  const [view, setView] = useState<"list" | "detail">(initialRoomId ? "detail" : "list");
  const [list, setList] = useState<RoomRecordListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState({ keyword: "", dateFrom: "", dateTo: "" });
  const [filters, setFilters] = useState({ keyword: "", dateFrom: "", dateTo: "" });
  const [roomId, setRoomId] = useState(initialRoomId);
  const [data, setData] = useState<RoomRecordResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [roundQuery, setRoundQuery] = useState("");
  const [roundPage, setRoundPage] = useState(1);
  const [roundDetail, setRoundDetail] = useState<RoomRecordRoundResponse | null>(null);
  const [roundDetailLoading, setRoundDetailLoading] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [listQueryRevision, refreshListQuery] = useQueryRefresh();

  const loadList = useCallback(async () => {
    void listQueryRevision;
    setListLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (filters.keyword) params.set("keyword", filters.keyword);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    try {
      setList(await api<RoomRecordListResponse>(`/api/game/room-records?${params.toString()}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "房间列表加载失败", "error");
    } finally { setListLoading(false); }
  }, [filters, listQueryRevision, notify, page]);

  useEffect(() => { void loadList(); }, [loadList]);

  const openRoom = useCallback(async (nextRoomId: string) => {
    setRoomId(nextRoomId); setData(null); setView("detail"); setDetailLoading(true);
    setRoundPage(1); setRoundQuery(""); setRoundDetail(null); setSelectedRound(null);
    window.history.replaceState(null, "", `#/game/room-records?roomId=${encodeURIComponent(nextRoomId)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      setData(await api<RoomRecordResponse>(`/api/game/room-records?roomId=${encodeURIComponent(nextRoomId)}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "房间战绩加载失败", "error");
      setView("list");
      window.history.replaceState(null, "", "#/game/room-records");
    } finally { setDetailLoading(false); }
  }, [notify]);

  useEffect(() => { if (initialRoomId) void openRoom(initialRoomId); }, [initialRoomId, openRoom]);

  const backToList = () => {
    setView("list"); setData(null); setSelectedRound(null); setRoundDetail(null);
    window.history.replaceState(null, "", "#/game/room-records");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filteredRounds = useMemo(() => {
    if (!data) return [];
    const clean = roundQuery.trim();
    if (!clean) return data.rounds;
    return data.rounds.filter((item) => String(item.round) === clean);
  }, [data, roundQuery]);
  const totalRoundPages = Math.max(1, Math.ceil(filteredRounds.length / roundsPerPage));
  const visibleRounds = filteredRounds.slice((roundPage - 1) * roundsPerPage, roundPage * roundsPerPage);

  const openRound = async (round: number) => {
    setSelectedRound(round); setRoundDetail(null); setRoundDetailLoading(true);
    try {
      setRoundDetail(await api<RoomRecordRoundResponse>(`/api/game/room-records/${encodeURIComponent(roomId)}/rounds/${round}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "本局牌面加载失败", "error");
      setSelectedRound(null);
    } finally { setRoundDetailLoading(false); }
  };

  if (view === "list") {
    const totalPages = Math.max(1, Math.ceil((list?.total ?? 0) / (list?.pageSize ?? 20)));
    const submitFilters = () => {
      setPage(1);
      setFilters({
        keyword: draftFilters.keyword.trim(),
        dateFrom: draftFilters.dateFrom,
        dateTo: draftFilters.dateTo,
      });
      refreshListQuery();
    };
    const resetFilters = () => {
      const empty = { keyword: "", dateFrom: "", dateTo: "" };
      setDraftFilters(empty); setFilters(empty); setPage(1);
      refreshListQuery();
    };
    return (
      <div className="page-stack">
        <PageHeader eyebrow="ROOM GAME ARCHIVE" title="房间战绩" description="先从已结算房间列表中筛选房间，再进入查看整房战绩、逐局牌面和操作过程。" actions={<span className="readonly-badge"><i />战绩只读</span>} />
        <section className="panel room-list-filter">
          <div className="room-list-filter__copy"><span>ROOM DIRECTORY</span><strong>筛选已结算房间</strong><p>支持房间号、房间名和参与玩家，默认按最新战绩排序。</p></div>
          <form onSubmit={(event) => { event.preventDefault(); submitFilters(); }}>
            <label className="room-list-keyword"><span>房间或玩家</span><input value={draftFilters.keyword} onChange={(event) => setDraftFilters((value) => ({ ...value, keyword: event.target.value }))} placeholder="房间号 / 房间名 / 玩家" autoComplete="off" /></label>
            <label><span>开始日期</span><input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
            <label><span>结束日期</span><input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((value) => ({ ...value, dateTo: event.target.value }))} /></label>
            <div className="room-list-filter__actions"><button type="button" onClick={resetFilters}>重置</button><button type="submit">查询房间</button></div>
          </form>
        </section>
        <section className="panel room-list-panel">
          <div className="toolbar"><div><strong>房间战绩列表</strong><span>点击任意房间进入总战绩和逐局明细</span></div><span className="toolbar__count">共 {list?.total ?? 0} 个房间</span></div>
          {listLoading ? <LoadingBlock label="正在读取房间列表" /> : !list || list.items.length === 0 ? <EmptyState title="没有找到房间战绩" description="请调整房间、玩家或日期条件后重新查询。" /> : <RoomRecordList items={list.items} onOpen={openRoom} />}
          <footer className="table-pagination"><span>第 {page} / {totalPages} 页，每页最多 20 个房间</span><div><button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || listLoading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ROOM GAME ARCHIVE / DETAIL" title={`房间 ${roomId} 战绩`} description="查看本房间玩家总输赢、每局牌面、下注过程和结算结果。" actions={<div className="room-record-header-actions"><button type="button" onClick={backToList}>← 返回房间列表</button><span className="readonly-badge"><i />战绩只读</span></div>} />
      {detailLoading && <section className="panel"><LoadingBlock label="正在读取房间战绩" /></section>}

      {data && <>
        <RoomOverview data={data} />
        <PlayerStandings data={data} />
        <section className="panel room-round-panel">
          <div className="toolbar room-round-toolbar"><div><strong>逐局牌局记录</strong><span>点击任意一局查看玩家牌面、庄闲身份、输赢和每轮操作</span></div><div className="room-round-search"><span>第</span><input inputMode="numeric" value={roundQuery} onChange={(event) => { setRoundQuery(event.target.value.replace(/\D/g, "")); setRoundPage(1); }} placeholder="局数" /><span>局</span><button type="button" onClick={() => { setRoundQuery(""); setRoundPage(1); }}>全部</button></div></div>
          {visibleRounds.length === 0 ? <EmptyState title="没有找到该局记录" description="请检查局数，或点击“全部”恢复完整列表。" /> : <div className="room-round-list">{visibleRounds.map((round) => <RoundRow key={round.round} round={round} onOpen={() => void openRound(round.round)} />)}</div>}
          <footer className="table-pagination"><span>共 {filteredRounds.length} 局，当前第 {roundPage} / {totalRoundPages} 页</span><div><button type="button" disabled={roundPage <= 1} onClick={() => setRoundPage((value) => value - 1)}>上一页</button><strong>{roundPage} / {totalRoundPages}</strong><button type="button" disabled={roundPage >= totalRoundPages} onClick={() => setRoundPage((value) => value + 1)}>下一页</button></div></footer>
        </section>
      </>}

      {selectedRound !== null && <Modal wide title={`房间 ${roomId} · 第 ${selectedRound} 局`} eyebrow="ROUND CARDS & ACTIONS" onClose={() => { setSelectedRound(null); setRoundDetail(null); }}>
        {roundDetailLoading && <LoadingBlock label="正在读取本局牌面和操作记录" />}
        {roundDetail && <RoundDetail detail={roundDetail} />}
      </Modal>}
    </div>
  );
}

function RoomRecordList({ items, onOpen }: { items: RoomRecordListItem[]; onOpen: (roomId: string) => void }) {
  return <div className="table-wrap"><table className="room-record-list-table"><thead><tr><th>房间</th><th>地九王</th><th>参与玩家</th><th>局数 / 人数</th><th>累计带入</th><th>房间时间（北京时间）</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.roomId} className="room-record-list-row" tabIndex={0} onClick={() => onOpen(item.roomId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item.roomId); } }} aria-label={`查看房间 ${item.roomId} 战绩`}><td><strong className="room-list-id">{item.roomId}</strong><small className="cell-subtitle">{item.roomName || "未记录房间名"}</small></td><td>{item.isDijiuKing ? <DijiuKingBadge /> : null}</td><td><span className="room-list-participants">{item.participants.slice(0, 3).join("、") || "未记录"}</span>{item.participants.length > 3 && <small className="cell-subtitle">另有 {item.participants.length - 3} 名玩家</small>}</td><td><strong>{item.roundCount} 局</strong><small className="cell-subtitle">{item.playerCount} 名玩家</small></td><td><strong>{scoreFormatter.format(item.totalBuyIn)}</strong></td><td><span>{formatBeijingDateTime(item.startedAt || item.recordedAt)}</span><small className="cell-subtitle">至 {formatBeijingDateTime(item.endedAt || item.recordedAt)}</small></td><td><span className="room-list-status"><i />已结算</span></td><td><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(item.roomId); }}>查看战绩</button></td></tr>)}</tbody></table></div>;
}

function RoomOverview({ data }: { data: RoomRecordResponse }) {
  const room = data.room;
  const rules = [room.baseRule, room.mangoRule, room.durationRule].filter(Boolean);
  return <>
    <section className="room-record-hero"><div className="room-record-hero__mark">{room.roomName || `1-${room.roomId}`}</div><div><span className="eyebrow">ROOM SUMMARY</span><h2>房间 {room.roomId}</h2>{room.isDijiuKing && <p><DijiuKingBadge /></p>}<div className="room-rule-tags">{rules.map((rule) => <span key={rule}>{rule}</span>)}</div></div><div className="room-record-period"><small>房间时间（北京时间）</small><strong>{formatBeijingDateTime(room.startedAt)}</strong><i>至</i><strong>{formatBeijingDateTime(room.endedAt)}</strong></div></section>
    <section className="room-record-metrics"><RoomMetric label="实际牌局" value={`${room.roundCount} 局`} note={`${room.playerCount} 名玩家形成总战绩`} /><RoomMetric label="房间累计带入" value={scoreFormatter.format(room.totalBuyIn)} note="所有玩家累计带入合计" /><RoomMetric label="玩家总赢分" value={`+${scoreFormatter.format(room.totalWin)}`} note={`总输分 ${scoreFormatter.format(room.totalLoss)}`} tone="win" /><RoomMetric label="战绩总差额" value={formatScore(room.scoreBalance)} note="包含芒果、玩法扣分等差额" tone={room.scoreBalance >= 0 ? "win" : "loss"} /></section>
  </>;
}

function DijiuKingBadge() {
  return <span className="dijiu-king-badge is-enabled"><i />地九王</span>;
}

function RoomMetric({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`room-record-metric room-record-metric--${tone}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function PlayerStandings({ data }: { data: RoomRecordResponse }) {
  return <section className="panel"><div className="toolbar player-toolbar"><div><strong>玩家总战绩排名</strong><span>优先按实际结算返还减累计带入计算最终输赢，并标记原战绩表异常</span></div><span className="toolbar__count">{data.players.length} 名玩家</span></div><div className="table-wrap"><table className="room-player-table"><thead><tr><th>排名</th><th>玩家</th><th>座位</th><th>参与局数</th><th>累计带入 / 返还</th><th>最终输赢</th><th>进入 / 离开时间（北京时间）</th></tr></thead><tbody>{data.players.map((player, index) => <tr key={player.id}><td><span className={`room-rank room-rank--${index + 1}`}>{index + 1}</span></td><td><strong>{player.playerName || "未设置昵称"}</strong><small className="cell-subtitle">ID {player.playerId}</small></td><td>{player.seat + 1} 号位</td><td>{player.roundsPlayed} 局</td><td><strong>{scoreFormatter.format(player.totalBuyIn)} / {player.scoreSource === "settlement" ? scoreFormatter.format(player.settlementReturn) : "未记录"}</strong><small className="cell-subtitle">带入 / 结算返还</small></td><td><strong className={`room-score room-score--${player.result}`}>{formatScore(player.score)}</strong>{player.scoreMismatch && <small className="room-score-warning">原战绩表 {formatScore(player.recordedScore)}</small>}</td><td><span>{formatBeijingDateTime(player.joinedAt)}</span><small className="cell-subtitle">至 {formatBeijingDateTime(player.leftAt)}</small></td></tr>)}</tbody></table></div></section>;
}

function RoundRow({ round, onOpen }: { round: RoomRecordRound; onOpen: () => void }) {
  return <article className="room-round-row"><div className="room-round-number"><span>ROUND</span><strong>{round.round}</strong></div><div className="room-round-time"><strong>第 {round.round} 局</strong><span>{formatBeijingDateTime(round.playedAt)}</span></div><div className="room-round-stat room-round-stat--win"><span>本局赢分</span><strong>+{scoreFormatter.format(round.totalWin)}</strong></div><div className="room-round-stat room-round-stat--loss"><span>本局输分</span><strong>−{scoreFormatter.format(round.totalLoss)}</strong></div><div className="room-round-stat"><span>参与 / 操作</span><strong>{round.playerCount} 人 · {round.actionCount} 次</strong></div><div className="room-round-net"><span>差额</span><strong className={`room-score room-score--${round.netScore > 0 ? "win" : round.netScore < 0 ? "loss" : "draw"}`}>{formatScore(round.netScore)}</strong></div><button type="button" onClick={onOpen}>查看牌面与过程</button></article>;
}

function RoundDetail({ detail }: { detail: RoomRecordRoundResponse }) {
  const stages = useMemo(() => groupActions(detail.actions), [detail.actions]);
  return <div className="room-round-detail"><section className="room-round-detail__summary"><span>第 {detail.round} 局</span><strong>{detail.players.length} 名玩家有战绩</strong><p>逐局分数取自服务器结算记录，牌面按结算顺序展示为两组两张牌。</p></section><section className="room-round-player-grid">{detail.players.map((player) => <RoundPlayerCard key={player.id} player={player} />)}</section><section className="player-detail-section"><div className="room-action-title"><div><h3>本局操作牌谱</h3><p>按服务器记录的操作轮次和时间顺序排列</p></div><span>{detail.actions.length} 次操作</span></div>{stages.length === 0 ? <EmptyState title="本局没有操作牌谱" description="服务器没有保存这一局的下注操作日志。" /> : <div className="room-action-stages">{stages.map(([stage, actions]) => <div className="room-action-stage" key={stage}><div><span>第 {stage} 轮操作</span><strong>{actions.length} 条</strong></div><div>{actions.map((action) => <ActionItem key={action.id} action={action} />)}</div></div>)}</div>}</section></div>;
}

function RoundPlayerCard({ player }: { player: RoomRecordRoundPlayer }) {
  const arranged = player.cards.length > 0 ? player.cards : player.dealtCards;
  const dealtDiffers = player.dealtCards.length > 0 && cardKey(player.dealtCards) !== cardKey(arranged);
  return <article className={`round-player-card round-player-card--${player.result}`}><header><div><span className="round-player-seat">{player.seat + 1} 号位</span><strong>{player.playerName || "未设置昵称"}</strong><small>ID {player.playerId}</small></div><div><span className="round-player-role">{player.role || "未记录身份"}</span><strong className={`room-score room-score--${player.result}`}>{formatScore(player.score)}</strong></div></header><div className="round-player-state"><span>{player.state || "未记录结果"}</span><span>下注 {scoreFormatter.format(player.betScore)}</span><span>芒果 {formatScore(player.mangoScore)}</span>{player.remainingMango !== 0 && <span>剩余芒果 {player.remainingMango}</span>}</div><CardGroups cards={arranged} label={arranged.length === 4 ? "结算牌组" : "已记录牌面"} />{dealtDiffers && <CardGroups cards={player.dealtCards} label="完整发牌" compact />}</article>;
}

function CardGroups({ cards, label, compact = false }: { cards: RoomRecordCard[]; label: string; compact?: boolean }) {
  if (cards.length === 0) return <div className="room-card-empty">没有保存牌面</div>;
  const groups = cards.length === 4 ? [cards.slice(0, 2), cards.slice(2, 4)] : [cards];
  return <div className={`room-card-groups ${compact ? "is-compact" : ""}`}><small>{label}</small><div>{groups.map((group, index) => <div className="room-card-pair" key={index}>{group.map((card, cardIndex) => <PlayingCard card={card} key={`${card.suit}-${card.rank}-${cardIndex}`} />)}</div>)}</div></div>;
}

function PlayingCard({ card }: { card: RoomRecordCard }) {
  const suits = [{ symbol: "♦", name: "方块", red: true }, { symbol: "♣", name: "梅花", red: false }, { symbol: "♥", name: "红桃", red: true }, { symbol: "♠", name: "黑桃", red: false }, { symbol: "★", name: "大王", red: true }];
  const suit = suits[card.suit] ?? { symbol: "?", name: "未知", red: false };
  const rank = card.suit === 4 ? "王" : card.rank === 1 ? "A" : card.rank === 11 ? "J" : card.rank === 12 ? "Q" : card.rank === 13 ? "K" : String(card.rank);
  return <span className={`playing-card ${suit.red ? "is-red" : ""}`} title={`${suit.name}${rank}`}><strong>{rank}</strong><b>{suit.symbol}</b></span>;
}

function ActionItem({ action }: { action: RoomRecordAction }) {
  return <div className="room-action-item"><time title={`${formatBeijingDateTime(action.occurredAt)}（北京时间）`}>{formatBeijingTime(action.occurredAt)}</time><span className="room-action-player">{action.playerName}<small>ID {action.playerId} · {action.seat + 1}号位</small></span><strong className={`room-action-type room-action-type--${action.action}`}>{action.action}</strong><span>操作分 <b>{action.actionScore}</b></span><span>操作后剩余 <b>{action.remainingScore}</b></span></div>;
}

function groupActions(actions: RoomRecordAction[]) {
  const grouped = new Map<number, RoomRecordAction[]>();
  for (const action of actions) grouped.set(action.stage, [...(grouped.get(action.stage) ?? []), action]);
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
}

function cardKey(cards: RoomRecordCard[]) { return cards.map((card) => `${card.suit}-${card.rank}`).join("|"); }

function formatScore(value: number) {
  if (value > 0) return `+${scoreFormatter.format(value)}`;
  if (value < 0) return `−${scoreFormatter.format(Math.abs(value))}`;
  return "0";
}
