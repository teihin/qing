import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  ClubSelect,
  DemoNote,
  ErrorBanner,
  Pagination,
  SeatBar,
  formatSigned,
  statusLabel,
  timeText,
  useClubOptions,
  type AutomationNotify,
  type AutomationPageProps,
  type AutomationRobotItem,
  type AutomationRoomItem,
} from "./shared";

interface RoomListResponse { items: AutomationRoomItem[]; page: number; pageSize: number; total: number }

const roomStatuses = ["准备", "游戏中", "参与过"];

export default function AutomationRoomsPage({ can, notify }: AutomationPageProps) {
  const clubs = useClubOptions();
  const [data, setData] = useState<RoomListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clubId, setClubId] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [hasSeat, setHasSeat] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<RoomListResponse>(`/api/automation/rooms?page=${targetPage}&pageSize=${targetSize}&clubId=${clubId}&tier=${tier}&status=${encodeURIComponent(status)}${hasSeat ? "&hasSeat=1" : ""}`);
      setData(response);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "房间池加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clubId, tier, status, hasSeat, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);

  const selected = useMemo(() => data?.items.find((room) => room.roomId === selectedId) ?? null, [data, selectedId]);

  const totals = useMemo(() => {
    const items = data?.items ?? [];
    return {
      rooms: items.length,
      seated: items.reduce((sum, item) => sum + item.seated, 0),
      capacity: items.reduce((sum, item) => sum + item.maxSeats, 0),
      robots: items.reduce((sum, item) => sum + item.robots, 0),
      human: items.reduce((sum, item) => sum + item.humans, 0),
    };
  }, [data]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="ROOM POOL"
      title="房间监控"
      description="查看各俱乐部房间池的座位占用、真人/机器人分布和剩余时间，并直接指派或召回机器人。"
      actions={<Button variant="secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新房间池"}</Button>}
    />

    <DemoNote>房间快照为演示数据，按俱乐部归属；服务端只允许机器人和房间在同一俱乐部内配对。同 IP 冲突会在终端侧记录为 0x306 故障。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>本页房间</span><strong>{totals.rooms}</strong></div>
      <div><span>在座 / 容量</span><strong>{totals.seated} / {totals.capacity}</strong></div>
      <div><span>机器人 / 真人</span><strong>{totals.robots} / {totals.human}</strong></div>
      <div><span>筛选结果</span><strong>{data?.total ?? 0}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <div className="automation-filter-row">
          <label>俱乐部<ClubSelect clubs={clubs} value={clubId} onChange={(value) => { setPage(1); setClubId(value); }} /></label>
          <label>档位<select value={tier} onChange={(event) => { setPage(1); setTier(event.target.value); }}><option value="">全部档位</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => <option key={value} value={value}>{value} 档</option>)}</select></label>
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部状态</option>{roomStatuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="automation-check"><input type="checkbox" checked={hasSeat} onChange={(event) => { setPage(1); setHasSeat(event.target.checked); }} />只看有空座</label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!data && loading ? <LoadingBlock label="正在读取俱乐部房间池" /> : !data || data.items.length === 0 ? <EmptyState title="没有匹配的房间" description="调整筛选条件，或到俱乐部接入页刷新房间池快照。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>房间</th><th>俱乐部</th><th>档位 / 底分</th><th>状态</th><th>座位</th><th>真人 / 机器人</th><th>观战</th><th>剩余</th><th>快照时间</th><th>操作</th></tr></thead>
            <tbody>
              {data.items.map((room) => <tr key={room.roomId}>
                <td><strong>{room.roomId}</strong><small className="cell-subtitle">{room.roomName || "—"} · {room.durationMin} 分钟局</small></td>
                <td>{room.clubName || "—"}<small className="cell-subtitle">{room.clubId}</small></td>
                <td>{room.tier} 档<small className="cell-subtitle">底分 {room.baseScore}</small></td>
                <td><AutomationBadge value={room.status} label={room.status} /></td>
                <td><SeatBar seated={room.seated} maxSeats={room.maxSeats} /></td>
                <td>{room.humans} / {room.robots}<small className="cell-subtitle">{room.seated - room.robots < 0 ? "统计异常" : "按终端统计"}</small></td>
                <td>{room.observers}</td>
                <td className={room.remainingMin <= 10 ? "automation-warn-text" : ""}>{room.remainingMin} 分钟</td>
                <td>{timeText(room.capturedAt)}</td>
                <td><div className="row-actions"><button type="button" onClick={() => setSelectedId(room.roomId)}>{can("automation.room.assign") ? "座位与召回" : "查看座位"}</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>

    {selected && <RoomSeatModal room={selected} canAssign={can("automation.room.assign")} notify={notify} onClose={() => setSelectedId(null)} onChanged={async () => { await load(page, pageSize, true); }} />}
  </div>;
}

function RoomSeatModal({ room, canAssign, notify, onClose, onChanged }: {
  room: AutomationRoomItem;
  canAssign: boolean;
  notify: AutomationNotify;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [robots, setRobots] = useState<AutomationRobotItem[]>([]);
  const [available, setAvailable] = useState<AutomationRobotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seatNo, setSeatNo] = useState(0);
  const [robotId, setRobotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRecall, setConfirmRecall] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [inRoom, clubRobots] = await Promise.all([
        api<{ items: AutomationRobotItem[] }>(`/api/automation/robots?page=1&pageSize=100&keyword=${room.roomId}`),
        api<{ items: AutomationRobotItem[] }>(`/api/automation/robots?page=1&pageSize=100&clubId=${room.clubId}`),
      ]);
      setRobots(inRoom.items.filter((item) => item.roomId === room.roomId));
      setAvailable(clubRobots.items.filter((item) => item.roomId === null && ["idle", "paused", "stopped", "created"].includes(item.status)));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "座位数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [room.roomId, room.clubId]);

  useEffect(() => { void load(); }, [load]);

  const assign = async () => {
    if (!robotId) { setError("请选择要指派的终端"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/rooms/${room.roomId}/assign`, { method: "POST", ...jsonBody({ robotId: Number(robotId), seatNo }) });
      notify(result.message);
      setRobotId(""); setSeatNo(0);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "指派终端失败");
    } finally {
      setBusy(false);
    }
  };

  const recall = async (robot: AutomationRobotItem) => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/rooms/${room.roomId}/recall`, { method: "POST", ...jsonBody({ robotId: robot.id }) });
      notify(result.message);
      setConfirmRecall(null);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "召回终端失败");
    } finally {
      setBusy(false);
    }
  };

  const seats = Array.from({ length: room.maxSeats }, (_, index) => index + 1);
  const occupiedBySeat = new Map(robots.filter((item) => item.seatNo > 0).map((item) => [item.seatNo, item]));

  return <Modal title={`${room.roomName || `房间 ${room.roomId}`} · ${room.clubName}`} eyebrow={`${room.roomId} · SEATS`} onClose={onClose} wide>
    <div className="automation-detail-metrics">
      <div><span>状态</span><strong className="automation-detail-text"><AutomationBadge value={room.status} label={room.status} /></strong></div>
      <div><span>座位</span><strong>{room.seated} / {room.maxSeats}</strong></div>
      <div><span>真人 / 机器人</span><strong>{room.humans} / {room.robots}</strong></div>
      <div><span>观战</span><strong>{room.observers}</strong></div>
      <div><span>剩余</span><strong>{room.remainingMin} 分钟</strong></div>
    </div>
    <ErrorBanner message={error} />
    {loading ? <LoadingBlock label="正在读取座位与终端" /> : <>
      <div className="automation-seat-grid">
        {seats.map((seat) => {
          const robot = occupiedBySeat.get(seat);
          return <article key={seat} className={robot ? "is-occupied" : "is-empty"}>
            <header><span>{seat} 号座</span>{robot ? <AutomationBadge value={robot.status} /> : <em>空座</em>}</header>
            {robot ? <>
              <strong>{robot.nickname || robot.terminalNo}</strong>
              <p>{robot.terminalNo} · {robot.account}</p>
              <small>带入 {robot.buyin} · 今日 {robot.todayRounds} 局 · 净分 {formatSigned(robot.todayNet)}</small>
              {canAssign && (confirmRecall === robot.id
                ? <div className="automation-inline-confirm"><button type="button" disabled={busy} onClick={() => void recall(robot)}>确认召回</button><button type="button" onClick={() => setConfirmRecall(null)}>取消</button></div>
                : <button type="button" className="automation-seat-action" onClick={() => setConfirmRecall(robot.id)}>召回终端</button>)}
            </> : <>
              {canAssign ? <button type="button" className="automation-seat-action" onClick={() => setSeatNo(seat)}>{seatNo === seat ? "已选择此座位" : "指派到此座"}</button> : <p>当前角色只可查看</p>}
            </>}
          </article>;
        })}
      </div>

      {canAssign && <div className="automation-assign-panel">
        <div><h3>指派机器人进房</h3><p>只列出同俱乐部、当前不在房间且状态允许指派的终端；选 0 号座时由后台自动寻找空座。</p></div>
        <form className="automation-assign-form" onSubmit={(event) => { event.preventDefault(); void assign(); }}>
          <Field label="目标座位"><input type="number" min={0} max={room.maxSeats} value={seatNo} onChange={(event) => setSeatNo(Number(event.target.value))} /></Field>
          <Field label="机器人终端"><select value={robotId} onChange={(event) => setRobotId(event.target.value)}><option value="">请选择终端</option>{available.map((robot) => <option key={robot.id} value={robot.id}>{robot.terminalNo} · {robot.nickname}（{statusLabel(robot.status)}）</option>)}</select></Field>
          <FormActions onCancel={() => { setRobotId(""); setSeatNo(0); }} busy={busy} submitText="确认指派" />
        </form>
        {available.length === 0 && <p className="automation-inline-hint">该俱乐部当前没有可指派的空闲终端。</p>}
      </div>}
    </>}
  </Modal>;
}
