import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, formatDate } from "../components/ui";
import type { CurrentRoomItem, CurrentRoomsResponse } from "../types";

type DissolveTarget = { roomId: number | null; all: boolean; mode: "force" | "friendly" };

type DissolveResponse = {
  status: "dissolved" | "pending" | "verification_unavailable" | "no_active_rooms";
  message: string;
  commandSent: boolean;
  verified: boolean;
  roomExists: boolean;
  roomStatus?: string;
  targetCount?: number;
  acceptedCount?: number;
  remainingCount?: number;
  failedCount?: number;
};

type RoomCreationControlState = {
  allowed: boolean;
  status: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string | null;
};

type CurrentRoomWireItem = Partial<CurrentRoomItem> & {
  room_id?: number;
  room_type?: string;
  room_name?: string;
  room_status?: string;
  game_status?: string;
  play_mode?: string;
  special_rule?: string[];
  round_count?: number;
  game_round?: number;
  player_count?: number;
  watcher_count?: number;
  player_and_watcher_count?: number;
  inhold_count?: number;
  max_number?: number;
  club_id?: string;
  club_name?: string;
  creator_guuid?: string;
  creator_name?: string;
  create_datetime?: string;
};

type CurrentRoomsWireResponse = Omit<CurrentRoomsResponse, "items"> & { items?: CurrentRoomWireItem[] };

const pageSizes = [20, 50, 100, 200];

export default function RoomMaintenancePage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<CurrentRoomsResponse | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [roomId, setRoomId] = useState("");
  const [roomIdError, setRoomIdError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<DissolveTarget | null>(null);
  const [creationControl, setCreationControl] = useState<RoomCreationControlState | null>(null);
  const [creationControlError, setCreationControlError] = useState("");
  const [creationControlLoading, setCreationControlLoading] = useState(true);
  const [creationControlTarget, setCreationControlTarget] = useState<boolean | null>(null);

  const load = useCallback(async (targetPage: number, targetPageSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const response = await api<CurrentRoomsWireResponse>(`/api/admin/hall/rooms?page=${targetPage}&page_size=${targetPageSize}`);
      setData({ ...response, items: Array.isArray(response.items) ? response.items.map(normalizeCurrentRoomItem) : [] });
      setPageSize(response.pageSize);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "大厅实时房间列表加载失败";
      setData(null);
      setLoadError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  const loadCreationControl = useCallback(async (quiet = false) => {
    if (!quiet) setCreationControlLoading(true);
    setCreationControlError("");
    try {
      setCreationControl(await api<RoomCreationControlState>("/api/game/room-maintenance/creation-control"));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "服务器创建房间开关读取失败";
      setCreationControl(null);
      setCreationControlError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setCreationControlLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(1, 50); void loadCreationControl(); }, [load, loadCreationControl]);

  const refresh = useCallback(async () => {
    await Promise.all([load(data?.page ?? 1, data?.pageSize ?? pageSize), loadCreationControl(true)]);
  }, [data, load, loadCreationControl, pageSize]);
  const openSingleDissolve = (mode: "force" | "friendly", selectedRoomId?: number) => {
    const normalized = selectedRoomId ? String(selectedRoomId) : roomId.trim();
    if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
      setRoomIdError("请输入有效的当前房间号");
      return;
    }
    setRoomIdError("");
    setTarget({ roomId: Number(normalized), all: false, mode });
  };

  const canDissolve = can("game.room_maintenance.dissolve");
  const canDissolveAll = can("game.room_maintenance.dissolve_all");
  const canControlRoomCreation = can("game.room_maintenance.creation_control");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? pageSize)));
  const pagePeople = data ? data.playerCount + data.watcherCount : 0;

  return <div className="page-stack">
    <PageHeader
      eyebrow="LIVE ROOM CONTROL"
      title="房间维护"
      description="从 KB 大厅实时内存读取所有活跃房间，查看状态、玩法、规则和人数，并按权限执行房间维护。"
      actions={<div className="room-maintenance-header-actions">
        <label><span>每页</span><select value={pageSize} disabled={loading} onChange={(event) => { const size = Number(event.target.value); setPageSize(size); void load(1, size); }}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "正在刷新…" : "刷新实时列表"}</Button>
      </div>}
    />

    <section className="room-maintenance-metrics">
      <article><span>当前活跃房间</span><strong>{data?.total ?? "—"}</strong><p>{data ? `第 ${data.page} / ${totalPages} 页` : "等待 KB 实时数据"}</p></article>
      <article><span>本页玩家与观战</span><strong>{data ? pagePeople : "—"}</strong><p>{data ? `玩家 ${data.playerCount} · 观战 ${data.watcherCount} · 等待带入 ${data.inholdCount}` : "不使用账号历史房间字段"}</p></article>
      <article className="room-maintenance-live"><span>数据来源</span><strong>{data ? "KB 实时内存" : "连接异常"}</strong><p>{data ? `刷新于 ${formatDate(data.refreshedAt)}` : "列表异常时不展示缓存房间"}</p></article>
    </section>

    <section className={`panel room-creation-control ${creationControl?.allowed === false ? "is-blocked" : ""}`}>
      <div className="room-creation-control__copy">
        <span className="eyebrow">GLOBAL ROOM CREATION</span>
        <div><h2>服务器创建新房间</h2>{creationControl && <em className={creationControl.allowed ? "is-allowed" : "is-blocked"}>{creationControl.status}</em>}</div>
        {creationControlLoading ? <p>正在读取大厅配置 <code>can_all_create_room</code>…</p> : creationControlError ? <p className="is-error">{creationControlError}。当前状态未知，不允许提交修改。</p> : creationControl ? <p>{creationControl.allowed ? "玩家手动创建、BOSS 创建和系统自动补房当前均被允许。" : "已全局禁止玩家手动创建、BOSS 创建和系统自动补房；现有房间不会因此自动解散。"}{creationControl.lastUpdatedBy ? ` 最近由 ${creationControl.lastUpdatedBy} 修改${creationControl.lastUpdatedAt ? `（${formatDate(creationControl.lastUpdatedAt)}）` : ""}。` : ""}</p> : null}
      </div>
      <div className="room-creation-control__actions">
        {creationControlError && <Button variant="secondary" onClick={() => void loadCreationControl()} disabled={creationControlLoading}>重新读取</Button>}
        {creationControl && canControlRoomCreation && <Button variant={creationControl.allowed ? "danger" : "primary"} onClick={() => setCreationControlTarget(!creationControl.allowed)}>{creationControl.allowed ? "禁止创建新房间" : "恢复允许创建"}</Button>}
        {creationControl && !canControlRoomCreation && <span>当前角色仅可查看</span>}
      </div>
    </section>

    <section className="panel room-maintenance-list-panel">
      <header className="panel__header room-maintenance-list-header">
        <div><span className="eyebrow">ACTIVE ROOMS</span><h2>大厅所有房间</h2></div>
        {data && <span>共 {data.total} 个 · 本页 {data.items.length} 个</span>}
      </header>
      {loading && !data ? <LoadingBlock label="正在读取 KB 大厅实时房间" /> : loadError ? (
        <div className="room-maintenance-load-error"><div className="operation-warning operation-warning--danger"><strong>实时房间列表读取失败</strong><p>{loadError}。当前页面不会回退显示玩家账号中的历史残留房间。</p></div><Button variant="secondary" onClick={() => void load(1, pageSize)}>重新读取</Button></div>
      ) : data && data.items.length === 0 ? <EmptyState title="当前没有活跃房间" description="KB 大厅实时内存返回空列表，可稍后手动刷新。" /> : data ? (
        <>
          <div className={`current-room-list ${loading ? "is-loading" : ""}`}>
            {data.items.map((room) => <CurrentRoomCard key={room.roomId} room={room} canDissolve={canDissolve} onDissolve={openSingleDissolve} />)}
          </div>
          <footer className="table-pagination room-maintenance-pagination">
            <span>第 {data.page} 页，共 {totalPages} 页；当前显示 {data.items.length} 个房间</span>
            <div><button type="button" disabled={loading || data.page <= 1} onClick={() => void load(data.page - 1, data.pageSize)}>上一页</button><strong>{data.page} / {totalPages}</strong><button type="button" disabled={loading || data.page >= totalPages} onClick={() => void load(data.page + 1, data.pageSize)}>下一页</button></div>
          </footer>
        </>
      ) : null}
    </section>

    {(canDissolve || canDissolveAll) && <section className="panel room-maintenance-actions-panel">
      {canDissolve && <div className="room-maintenance-manual">
        <div><h3>按房间号维护</h3><p>列表中的房间可直接操作；也可以在这里输入 KB 当前存在的房间号。</p></div>
        <Field label="当前房间号" hint="只接受正整数房间号">
          <input inputMode="numeric" value={roomId} onChange={(event) => { setRoomId(event.target.value.replace(/\D/g, "")); setRoomIdError(""); }} placeholder="例如：851724" />
        </Field>
        {roomIdError && <div className="form-error"><span>!</span>{roomIdError}</div>}
        <div className="room-bulk-actions"><Button variant="secondary" onClick={() => openSingleDissolve("friendly")}>友好解散指定房间</Button><Button variant="danger" onClick={() => openSingleDissolve("force")}>强制解散指定房间</Button></div>
      </div>}
      {canDissolveAll && <div className="room-maintenance-all">
        <div><strong>全部房间操作</strong><p>由游戏服务处理全部当前房间，仅超级管理员可执行，并要求输入 ALL_ROOMS。</p></div>
        <div className="room-bulk-actions"><Button variant="secondary" onClick={() => setTarget({ roomId: null, all: true, mode: "friendly" })}>友好解散全部</Button><Button variant="danger" onClick={() => setTarget({ roomId: null, all: true, mode: "force" })}>强制解散全部</Button></div>
      </div>}
    </section>}

    {target && <DissolveModal target={target} onClose={() => setTarget(null)} onDone={(result) => { setTarget(null); notify(result.message, result.verified ? "success" : "error"); window.setTimeout(() => void refresh(), 300); }} />}
    {creationControl && creationControlTarget !== null && <RoomCreationControlModal current={creationControl} targetAllowed={creationControlTarget} onClose={() => setCreationControlTarget(null)} onDone={(state, message) => { setCreationControl(state); setCreationControlTarget(null); notify(message); }} />}
  </div>;
}

function CurrentRoomCard({ room, canDissolve, onDissolve }: { room: CurrentRoomItem; canDissolve: boolean; onDissolve: (mode: "force" | "friendly", roomId: number) => void }) {
  const status = room.roomStatus || "未知状态";
  const normalizedStatus = `${room.roomStatus} ${room.gameStatus}`.toLowerCase();
  const statusClass = normalizedStatus.includes("解散") || normalizedStatus.includes("dissolv") || normalizedStatus.includes("closing")
    ? "is-dissolving"
    : normalizedStatus.includes("游戏") || normalizedStatus.includes("playing")
      ? "is-playing"
      : normalizedStatus.includes("等待") || normalizedStatus.includes("wait")
        ? "is-waiting"
        : "is-ready";
  const roundTarget = room.gameRound >= 99999 ? "不限" : room.gameRound;
  return <article className={`current-room-card ${statusClass}`}>
    <header><div><span>房间号</span><strong>{room.roomId}</strong><small>{room.roomName || `房间 ${room.roomId}`}</small></div><em className={statusClass}>{status}</em></header>
    <div className="current-room-card__content">
      <div className="current-room-stats"><div><span>局数</span><strong>{room.roundCount} / {roundTarget}</strong></div><div><span>玩家</span><strong>{room.playerCount} / {room.maxNumber || "—"}</strong></div><div><span>观战</span><strong>{room.watcherCount}</strong></div><div><span>等待带入</span><strong>{room.inholdCount}</strong></div></div>
      <dl className="current-room-meta"><div><dt>创建时间</dt><dd>{room.createDatetime || "—"}</dd></div><div><dt>备注</dt><dd>{room.remark || "—"}</dd></div></dl>
    </div>
    {canDissolve && <footer><Button variant="secondary" onClick={() => onDissolve("friendly", room.roomId)}>友好解散</Button><Button variant="danger" onClick={() => onDissolve("force", room.roomId)}>强制解散</Button></footer>}
  </article>;
}

export function normalizeCurrentRoomItem(room: CurrentRoomWireItem): CurrentRoomItem {
  return {
    roomId: numberValue(room.roomId ?? room.room_id),
    roomType: textValue(room.roomType ?? room.room_type),
    roomName: textValue(room.roomName ?? room.room_name),
    roomStatus: textValue(room.roomStatus ?? room.room_status),
    gameStatus: textValue(room.gameStatus ?? room.game_status),
    playMode: textValue(room.playMode ?? room.play_mode),
    specialRule: Array.isArray(room.specialRule) ? room.specialRule : Array.isArray(room.special_rule) ? room.special_rule : [],
    roundCount: numberValue(room.roundCount ?? room.round_count),
    gameRound: numberValue(room.gameRound ?? room.game_round),
    playerCount: numberValue(room.playerCount ?? room.player_count),
    watcherCount: numberValue(room.watcherCount ?? room.watcher_count),
    playerAndWatcherCount: numberValue(room.playerAndWatcherCount ?? room.player_and_watcher_count),
    inholdCount: numberValue(room.inholdCount ?? room.inhold_count),
    maxNumber: numberValue(room.maxNumber ?? room.max_number),
    clubId: textValue(room.clubId ?? room.club_id),
    clubName: textValue(room.clubName ?? room.club_name),
    creatorGuuid: textValue(room.creatorGuuid ?? room.creator_guuid),
    creatorName: textValue(room.creatorName ?? room.creator_name),
    createDatetime: textValue(room.createDatetime ?? room.create_datetime),
    remark: textValue(room.remark),
  };
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function DissolveModal({ target, onClose, onDone }: { target: DissolveTarget; onClose: () => void; onDone: (result: DissolveResponse) => void }) {
  const [checked, setChecked] = useState(false);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const friendly = target.mode === "friendly";
  const title = `${friendly ? "友好" : "强制"}解散${target.all ? "全部房间" : `房间 ${target.roomId}`}`;
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const endpoint = target.all ? "/api/game/room-maintenance/dissolve-all" : `/api/game/room-maintenance/${target.roomId}/dissolve`;
      const result = await api<DissolveResponse>(endpoint, { method: "POST", ...jsonBody({ mode: target.mode, confirm: checked, confirmScope: target.all ? scope : "" }) });
      onDone(result);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "房间解散命令提交失败"); } finally { setBusy(false); }
  };
  const disabled = !checked || (target.all && scope !== "ALL_ROOMS");
  return <Modal title={title} eyebrow="HIGH RISK OPERATION" onClose={onClose}><div className={`operation-warning ${friendly ? "" : "operation-warning--danger"}`}><strong>{friendly ? "给牌局正常收尾机会" : "立即中断房间牌局"}</strong><p>{friendly ? "后台会发送申请解散命令，并以 KB 实时房间列表复查结果作为成功依据。" : "强制解散可能打断正在进行的牌局；后台只有在实时列表确认房间消失或关闭后才会提示成功。"}</p></div>{error && <div className="form-error"><span>!</span>{error}</div>}{target.all && <Field label="范围确认" hint="请输入 ALL_ROOMS，防止误操作全部在线房间"><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="ALL_ROOMS" /></Field>}<label className="confirm-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>我已核对实时房间范围，并确认执行{friendly ? "友好" : "强制"}解散</span></label><div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button variant={friendly ? "primary" : "danger"} disabled={disabled || busy} onClick={() => void submit()}>{busy ? "正在执行并复查…" : "确认解散"}</Button></div></Modal>;
}

function RoomCreationControlModal({ current, targetAllowed, onClose, onDone }: { current: RoomCreationControlState; targetAllowed: boolean; onClose: () => void; onDone: (state: RoomCreationControlState, message: string) => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ state: RoomCreationControlState; message: string }>("/api/game/room-maintenance/creation-control", {
        method: "PUT",
        ...jsonBody({ allowed: targetAllowed, expectedAllowed: current.allowed, confirm: checked }),
      });
      onDone(result.state, result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "服务器创建房间开关修改失败");
    } finally {
      setBusy(false);
    }
  };
  const title = targetAllowed ? "恢复允许创建新房间" : "全局禁止创建新房间";
  return <Modal title={title} eyebrow="GLOBAL SERVER CONTROL" onClose={onClose}><div className={`operation-warning ${targetAllowed ? "" : "operation-warning--danger"}`}><strong>{targetAllowed ? "重新开放全部创建入口" : "关闭全部新房间创建入口"}</strong><p>{targetAllowed ? "保存后，玩家手动创建、BOSS 创建和系统自动补房将重新被允许。" : "保存后，玩家手动创建、BOSS 创建和系统自动补房都会被禁止；当前已经存在的房间不会被自动解散。"}</p></div>{error && <div className="form-error"><span>!</span>{error}</div>}<label className="confirm-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>我已了解该开关影响全部房间创建入口，并确认{targetAllowed ? "恢复允许" : "全局禁止"}创建新房间</span></label><div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button variant={targetAllowed ? "primary" : "danger"} disabled={!checked || busy} onClick={() => void submit()}>{busy ? "正在保存并回读…" : "确认修改"}</Button></div></Modal>;
}
