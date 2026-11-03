import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { formatBeijingDateTime } from "../time";
import type { ClubRoomGroup, ClubRoomsResponse, CurrentRoomItem } from "../types";

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

type ClubRoomGroupWire = Omit<ClubRoomGroup, "rooms"> & { rooms?: CurrentRoomWireItem[] };
type ClubRoomsWireResponse = Omit<ClubRoomsResponse, "groups"> & { groups?: ClubRoomGroupWire[] };

const pageSizes = [20, 50, 100];

/**
 * 房间维护（只读）。
 *
 * 当前所有活跃房间都是俱乐部内部房间，页面按俱乐部聚合展示：
 * 一级是俱乐部，展开后二级是该俱乐部的房间。不提供解散、创建开关等任何房间操作。
 */
export default function RoomMaintenancePage({ notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<ClubRoomsResponse | null>(null);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async (targetPage: number, targetPageSize: number, targetKeyword: string, quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(targetPageSize) });
      if (targetKeyword) params.set("keyword", targetKeyword);
      const response = await api<ClubRoomsWireResponse>(`/api/game/room-maintenance/clubs?${params.toString()}`);
      setData({
        available: Boolean(response.available),
        groups: Array.isArray(response.groups) ? response.groups.map(normalizeClubRoomGroup) : [],
        page: response.page ?? targetPage,
        pageSize: response.pageSize ?? targetPageSize,
        totalClubs: response.totalClubs ?? 0,
        totalRooms: response.totalRooms ?? 0,
        playerCount: response.playerCount ?? 0,
        watcherCount: response.watcherCount ?? 0,
        inholdCount: response.inholdCount ?? 0,
        source: response.source ?? "",
        message: response.message ?? "",
        refreshedAt: response.refreshedAt ?? "",
      });
      if (response.pageSize && response.pageSize !== targetPageSize) setPageSize(response.pageSize);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "俱乐部房间列表加载失败";
      setData(null);
      setLoadError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load(page, pageSize, keyword);
  }, [load, page, pageSize, keyword]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = draftKeyword.trim();
    if (page === 1 && keyword === next) {
      void load(1, pageSize, next);
      return;
    }
    setExpanded({});
    setPage(1);
    setKeyword(next);
  };

  const resetSearch = () => {
    setDraftKeyword("");
    setExpanded({});
    if (page === 1 && keyword === "") {
      void load(1, pageSize, "");
      return;
    }
    setPage(1);
    setKeyword("");
  };

  const toggleClub = (clubId: string) => {
    setExpanded((current) => ({ ...current, [clubId]: !current[clubId] }));
  };

  const totalPages = Math.max(1, Math.ceil((data?.totalClubs ?? 0) / (data?.pageSize ?? pageSize)));

  return <div className="page-stack">
    <PageHeader
      eyebrow="CLUB ROOM DIRECTORY"
      title="房间维护"
      description="按俱乐部查看 KB 大厅当前活跃的俱乐部内部房间；本页只读，不提供解散房间或创建开关等操作。"
      actions={<div className="room-maintenance-header-actions">
        <span className="readonly-badge"><i />只读展示</span>
        <label><span>每页</span><select value={pageSize} disabled={loading} onChange={(event) => { const size = Number(event.target.value); setPageSize(size); setPage(1); }}>{pageSizes.map((size) => <option key={size} value={size}>{size} 个俱乐部</option>)}</select></label>
        <Button variant="secondary" onClick={() => void load(page, pageSize, keyword)} disabled={loading}>{loading ? "正在刷新…" : "刷新实时列表"}</Button>
      </div>}
    />

    <section className="room-maintenance-metrics">
      <article><span>活跃俱乐部</span><strong>{data?.totalClubs ?? "—"}</strong><p>{data ? `第 ${data.page} / ${totalPages} 页 · 本页 ${data.groups.length} 个` : "等待 KB 实时数据"}</p></article>
      <article><span>活跃房间</span><strong>{data?.totalRooms ?? "—"}</strong><p>{data ? `玩家 ${data.playerCount} · 观战 ${data.watcherCount} · 等待带入 ${data.inholdCount}` : "不使用账号历史房间字段"}</p></article>
      <article className="room-maintenance-live"><span>数据来源</span><strong>{data ? "KB 实时内存" : "连接异常"}</strong><p>{data ? `刷新于 ${formatBeijingDateTime(data.refreshedAt)}` : "列表异常时不展示缓存房间"}</p></article>
    </section>

    <section className="panel club-room-filter">
      <div className="club-room-filter__copy">
        <span>CLUB FILTER</span>
        <strong>按俱乐部筛选</strong>
        <p>支持俱乐部 ID、俱乐部名称、创建者 ID/名称和创建者邀请码。</p>
      </div>
      <form onSubmit={submitSearch}>
        <label><span>俱乐部 / 邀请码</span><input value={draftKeyword} onChange={(event) => setDraftKeyword(event.target.value)} placeholder="俱乐部 ID / 名称 / 创建者邀请码" autoComplete="off" /></label>
        <div className="club-room-filter__actions">
          <button type="button" onClick={resetSearch}>重置</button>
          <button type="submit">查询俱乐部</button>
        </div>
      </form>
    </section>

    <section className="panel club-room-panel">
      <header className="panel__header club-room-panel__header">
        <div><span className="eyebrow">ACTIVE CLUB ROOMS</span><h2>按俱乐部展示</h2></div>
        {data && <span>共 {data.totalClubs} 个俱乐部 · {data.totalRooms} 个房间</span>}
      </header>
      {loading && !data ? <LoadingBlock label="正在读取 KB 大厅实时房间" /> : loadError ? (
        <div className="room-maintenance-load-error"><div className="operation-warning operation-warning--danger"><strong>俱乐部房间列表读取失败</strong><p>{loadError}。当前页面不会回退显示账号历史房间或缓存数据。</p></div><Button variant="secondary" onClick={() => void load(page, pageSize, keyword)}>重新读取</Button></div>
      ) : !data || data.groups.length === 0 ? <EmptyState title="没有找到俱乐部房间" description="当前没有活跃的俱乐部内部房间，或筛选条件没有命中。" /> : (
        <>
          <div className={`club-room-group-list ${loading ? "is-loading" : ""}`}>
            {data.groups.map((group) => <ClubRoomGroupCard key={group.clubId} group={group} expanded={Boolean(expanded[group.clubId])} onToggle={() => toggleClub(group.clubId)} />)}
          </div>
          <footer className="table-pagination room-maintenance-pagination">
            <span>第 {data.page} 页，共 {totalPages} 页；本页 {data.groups.length} 个俱乐部</span>
            <div><button type="button" disabled={loading || data.page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{data.page} / {totalPages}</strong><button type="button" disabled={loading || data.page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
          </footer>
        </>
      )}
    </section>
  </div>;
}

function ClubRoomGroupCard({ group, expanded, onToggle }: { group: ClubRoomGroup; expanded: boolean; onToggle: () => void }) {
  return <article className={`club-room-group ${expanded ? "is-expanded" : ""}`}>
    <button type="button" className="club-room-group__header" aria-expanded={expanded} onClick={onToggle}>
      <span className="club-room-group__toggle">{expanded ? "−" : "+"}</span>
      <span className="club-room-group__title">
        <strong>{group.clubName || group.clubId}</strong>
        <small>俱乐部 ID：{group.clubId}{group.creatorName || group.creatorId ? ` · 创建者：${group.creatorName || group.creatorId}` : ""}{group.creatorId && group.creatorName ? `（${group.creatorId}）` : ""} · 邀请码：{group.creatorInviteCode || "—"}</small>
      </span>
      <span className="club-room-group__stats">
        <span><b>{group.roomCount}</b> 房间</span>
        <span><b>{group.playerCount}</b> 玩家</span>
        <span><b>{group.watcherCount}</b> 观战</span>
        <span><b>{group.inholdCount}</b> 等待带入</span>
      </span>
    </button>
    {expanded && <div className="club-room-group__rooms">
      <div className="table-wrap">
        <table className="club-room-table">
          <thead><tr><th>房间</th><th>状态</th><th>玩法 / 规则</th><th>局数</th><th>玩家 / 上限</th><th>观战</th><th>等待带入</th><th>创建时间（北京时间）</th><th>备注</th></tr></thead>
          <tbody>
            {group.rooms.map((room) => <tr key={room.roomId}>
              <td><strong className="room-list-id">{room.roomId}</strong><small className="cell-subtitle">{room.roomName || "未命名房间"}</small></td>
              <td><span className={`club-room-status ${roomStatusClass(room)}`}>{room.roomStatus || room.gameStatus || "未知状态"}</span>{room.gameStatus && room.gameStatus !== room.roomStatus && <small className="cell-subtitle">{room.gameStatus}</small>}</td>
              <td><strong>{room.playMode || "—"}</strong><small className="cell-subtitle">{room.specialRule.length > 0 ? room.specialRule.join(" / ") : "无特殊规则"}</small></td>
              <td>{room.roundCount} / {room.gameRound >= 99999 ? "不限" : room.gameRound}</td>
              <td>{room.playerCount} / {room.maxNumber || "—"}</td>
              <td>{room.watcherCount}</td>
              <td>{room.inholdCount}</td>
              <td>{formatBeijingDateTime(room.createDatetime)}</td>
              <td><span className="club-room-remark">{room.remark || "—"}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>}
  </article>;
}

function roomStatusClass(room: CurrentRoomItem): string {
  const status = `${room.roomStatus} ${room.gameStatus}`.toLowerCase();
  if (status.includes("解散") || status.includes("dissolv") || status.includes("closing")) return "is-dissolving";
  if (status.includes("游戏") || status.includes("playing")) return "is-playing";
  if (status.includes("等待") || status.includes("wait")) return "is-waiting";
  return "is-ready";
}

function normalizeClubRoomGroup(group: ClubRoomGroupWire): ClubRoomGroup {
  return {
    clubId: textValue(group.clubId),
    clubName: textValue(group.clubName),
    creatorId: textValue(group.creatorId),
    creatorName: textValue(group.creatorName),
    creatorInviteCode: textValue(group.creatorInviteCode),
    roomCount: numberValue(group.roomCount),
    playerCount: numberValue(group.playerCount),
    watcherCount: numberValue(group.watcherCount),
    inholdCount: numberValue(group.inholdCount),
    rooms: Array.isArray(group.rooms) ? group.rooms.map(normalizeCurrentRoomItem) : [],
  };
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
