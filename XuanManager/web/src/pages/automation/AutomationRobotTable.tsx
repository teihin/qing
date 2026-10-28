import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { EmptyState, LoadingBlock } from "../../components/ui";
import { ErrorBanner, formatMoney, formatSigned, timeText } from "./shared";

export type AutomationTableCard = [number, number];

export type AutomationTableSeat = {
  seat: number;
  guuid: string;
  name: string;
  isSelf: boolean;
  isZhuang: boolean;
  isAction: boolean;
  overType: string;
  status: string;
  gold?: number;
  beiShu: number;
  xiaZhu: number;
  roundScore: number;
  totalScore: number;
  roundCount: number;
  hand: AutomationTableCard[];
  chedPai: AutomationTableCard[];
  handVisible: boolean;
};

export type AutomationTableSpectator = { id: string; name: string; photo: string };

export type AutomationRoom = {
  roomId: number;
  name: string;
  status: string;
  pi: string;
  playMode: string;
  maxSeats: number;
  minBuyin: number;
  minutes: number;
  seatedCount: number;
  spectatorCount: number;
  spectators: AutomationTableSpectator[];
};

export type AutomationTable = {
  roomId: number;
  round: number;
  phase: string;
  source: string;
  ownSeat: number;
  room?: AutomationRoom;
  seats: AutomationTableSeat[];
  nextOrderCount?: number;
  updatedAt?: number;
};

type TableResponse = { table: AutomationTable | null; receivedAt: string | null };

const SUIT_SYMBOLS: Record<number, string> = { 0: "♦", 1: "♣", 2: "♥", 3: "♠" };
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const PHASE_LABELS: Record<string, string> = { waiting: "等待开局", playing: "对局中", settled: "本局已结算" };
const STATE_LABELS: Record<string, string> = { running: "游戏中", ready: "已准备", init: "等待中", offline: "已离线", leave: "已离开" };

// RobotTablePanel 展示机器人当前牌桌：座位、自己的手牌和其他玩家已下发的手牌。
// 数据来自客户端上报的 TableState 事件，后台只读最新一条。
export function RobotTablePanel({ robotId }: { robotId: number }) {
  const [table, setTable] = useState<AutomationTable | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    try {
      const response = await api<TableResponse>(`/api/automation/robots/${robotId}/table`);
      setTable(response.table ?? null);
      setReceivedAt(response.receivedAt ?? null);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "牌桌快照加载失败");
    } finally {
      setLoaded(true);
    }
  }, [robotId]);

  useEffect(() => {
    setLoaded(false);
    setTable(null);
    setReceivedAt(null);
    void load();
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!loaded) return <LoadingBlock label="正在读取当前牌局" />;
  if (error && !table) return <ErrorBanner message={error} />;

  const seats = table?.seats ?? [];
  const phase = table?.phase ?? "waiting";
  const room = table?.room;
  const seatedCount = room?.seatedCount ?? seats.length;
  const spectatorCount = room?.spectatorCount ?? room?.spectators?.length ?? 0;
  const spectators = room?.spectators ?? [];

  return <div className="automation-table-panel">
    <ErrorBanner message={error} />
    <div className="automation-table-head">
      <div>
        <strong>{PHASE_LABELS[phase] ?? phase}</strong>
        <small>
          房间 {table?.roomId || room?.roomId || "—"}
          {room?.name ? ` · ${room.name}` : ""}
          {room?.pi ? ` · ${room.pi}` : ""}
          {` · ${seatedCount}${room?.maxSeats ? `/${room.maxSeats}` : ""} 人在座`}
          {` · ${spectatorCount} 人观战`}
          {table?.round ? ` · 第 ${table.round} 局` : ""}
          {typeof table?.nextOrderCount === "number" && table.nextOrderCount > 0 ? ` · 下一局 ${table.nextOrderCount} 张牌` : ""}
        </small>
      </div>
      <small>{receivedAt ? `快照 ${timeText(receivedAt)} · 每 5 秒刷新` : "每 5 秒刷新"}</small>
    </div>

    {room && <div className="automation-room-strip">
      <span className="automation-room-strip__label">观战 {spectatorCount} 人</span>
      {spectators.length > 0
        ? <div className="automation-room-strip__list">
          {spectators.map((one) => <span key={`${one.id}-${one.name}`} className="automation-room-chip" title={one.id || one.name}>{one.name || one.id}</span>)}
        </div>
        : <small>{spectatorCount > 0 ? "观战名单未下发" : "暂无观战"}</small>}
    </div>}

    {seats.length === 0
      ? (table
        ? <EmptyState title="房间内暂无其他玩家" description="机器人已在房间中等待；有人入座或发牌后，这里会显示座位、在线状态与手牌。" />
        : <EmptyState title="还没有牌桌快照" description="机器人进入房间后，这里会显示房间人数、观战者，以及自己在牌局里的手牌。" />)
      : <>
        {tableNote(table) && <p className="automation-table-note">{tableNote(table)}</p>}
        <div className="automation-table-board">
          {seats.map((seat) => <SeatPanel key={`${seat.seat}-${seat.guuid}`} seat={seat} phase={phase} />)}
        </div>
      </>}
  </div>;
}

function tableNote(table: AutomationTable | null): string {
  if (!table) return "";
  if (table.source === "own-hand") {
    return "当前快照只有自己的手牌：账号未开通房间信息查询，或全桌手牌还在下发。";
  }
  if (table.phase !== "waiting" && table.seats.some((seat) => !seat.isSelf && seat.hand.length === 0)) {
    return "部分玩家手牌暂未下发，下一次快照会补全。";
  }
  return "";
}

function SeatPanel({ seat, phase }: { seat: AutomationTableSeat; phase: string }) {
  const hiddenText = phase === "waiting" ? "等待发牌" : seat.isSelf ? "暂无手牌" : "手牌未下发";
  const stateText = STATE_LABELS[seat.overType] ?? STATE_LABELS[seat.status] ?? seat.overType ?? seat.status;
  return <article className={`automation-table-seat${seat.isSelf ? " is-self" : ""}${seat.isAction ? " is-action" : ""}`}>
    <header className="automation-table-seat__head">
      <div>
        <strong>{seat.seat ? `${seat.seat} 号座` : "座位未知"}</strong>
        {seat.isSelf && <span className="automation-table-tag">自己</span>}
        {seat.isZhuang && <span className="automation-table-tag is-zhuang">庄</span>}
        {seat.isAction && <span className="automation-table-tag is-action">行动中</span>}
      </div>
      <small>{seat.name || seat.guuid || "未知玩家"}</small>
    </header>

    <div className="automation-table-seat__cards">
      {seat.hand.length === 0
        ? <span className="automation-table-seat__empty">{hiddenText}</span>
        : seat.hand.map((card, index) => <PlayingCard key={`${card[0]}-${card[1]}-${index}`} card={card} />)}
    </div>

    {seat.chedPai.length > 0 && <div className="automation-table-seat__discard">
      <small>已扯牌</small>
      {seat.chedPai.map((card, index) => <PlayingCard key={`c-${card[0]}-${card[1]}-${index}`} card={card} small />)}
    </div>}

    <dl className="automation-table-seat__stats">
      <div><dt>本局</dt><dd className={seat.roundScore < 0 ? "automation-warn-text" : ""}>{formatSigned(seat.roundScore)}</dd></div>
      <div><dt>累计</dt><dd className={seat.totalScore < 0 ? "automation-warn-text" : ""}>{formatSigned(seat.totalScore)}</dd></div>
      <div><dt>下注</dt><dd>{seat.xiaZhu}</dd></div>
      <div><dt>倍</dt><dd>{seat.beiShu || "—"}</dd></div>
    </dl>

    <small className="automation-table-seat__meta">
      {stateText || "在座"}
      {seat.gold ? ` · 余额 ${formatMoney(seat.gold)}` : ""}
      {seat.roundCount ? ` · 第 ${seat.roundCount} 局` : ""}
    </small>
  </article>;
}

function PlayingCard({ card, small = false }: { card: AutomationTableCard; small?: boolean }) {
  const [type, num] = card;
  const joker = type === 4;
  const red = type === 0 || type === 2 || (joker && num === 1);
  const text = joker
    ? (num === 1 ? "大王" : "小王")
    : `${SUIT_SYMBOLS[type] ?? "?"}${RANKS[num] ?? num}`;
  return <span className={`automation-playing-card${red ? " is-red" : ""}${joker ? " is-joker" : ""}${small ? " is-small" : ""}`}>{text}</span>;
}
