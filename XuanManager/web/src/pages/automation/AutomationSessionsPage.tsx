import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { EmptyState, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  ClubSelect,
  DemoNote,
  endReasonLabel,
  ErrorBanner,
  Pagination,
  formatMoney,
  formatSigned,
  timeText,
  useClubOptions,
  type AutomationPageProps,
  type AutomationRobotItem,
  type AutomationSessionItem,
} from "./shared";

interface SessionListResponse { items: AutomationSessionItem[]; page: number; pageSize: number }
interface SessionEvent { at: string; type: string; detail: string }
interface SessionDetailResponse { session: AutomationSessionItem; events: SessionEvent[] }

const eventLabels: Record<string, string> = {
  enter_room: "进入房间",
  seated: "入座",
  seat: "入座",
  buyin: "带入",
  start: "开始对局",
  round: "完成一局",
  leave: "离开房间",
  left: "离开房间",
  recall: "后台召回",
  stop: "停止",
  drain: "排空",
  fault: "异常",
};

export default function AutomationSessionsPage({ notify }: AutomationPageProps) {
  const clubs = useClubOptions();
  const [data, setData] = useState<SessionListResponse | null>(null);
  const [robots, setRobots] = useState<AutomationRobotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clubId, setClubId] = useState("");
  const [robotId, setRobotId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<SessionListResponse>(`/api/automation/sessions?page=${targetPage}&pageSize=${targetSize}&clubId=${clubId}&robotId=${robotId}&status=${status}`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "对局记录加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clubId, robotId, status, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);
  useEffect(() => {
    void api<{ items: AutomationRobotItem[] }>("/api/automation/robots?page=1&pageSize=100").then((response) => setRobots(response.items)).catch(() => setRobots([]));
  }, []);

  const items = data?.items ?? [];
  const totalNet = items.reduce((sum, item) => sum + item.netWin, 0);
  const totalRounds = items.reduce((sum, item) => sum + item.rounds, 0);

  return <div className="page-stack">
    <PageHeader
      eyebrow="SESSION TIMELINE"
      title="对局记录"
      description="查看机器人每次进房的会话、局数、带入与净分，并追踪进房、入座和离桌的时间线。"
      actions={<button type="button" className="button button--secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新"}</button>}
    />

    <DemoNote>对局记录为演示数据，正式环境由 Worker 在离桌后回写；服务端按俱乐部数据范围过滤。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>本页会话</span><strong>{items.length}</strong></div>
      <div><span>累计局数</span><strong>{totalRounds}</strong></div>
      <div><span>累计净分</span><strong className={totalNet < 0 ? "automation-warn-text" : ""}>{formatSigned(totalNet)}</strong></div>
      <div><span>进行中</span><strong>{items.filter((item) => item.endedAt === null).length}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <div className="automation-filter-row">
          <label>俱乐部<ClubSelect clubs={clubs} value={clubId} onChange={(value) => { setPage(1); setClubId(value); }} /></label>
          <label>终端<select value={robotId} onChange={(event) => { setPage(1); setRobotId(event.target.value); }}><option value="">全部终端</option>{robots.map((robot) => <option key={robot.id} value={robot.id}>{robot.terminalNo} · {robot.nickname}</option>)}</select></label>
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部</option><option value="active">进行中</option><option value="ended">已结束</option></select></label>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!data && loading ? <LoadingBlock label="正在读取对局记录" /> : !data || items.length === 0 ? <EmptyState title="没有匹配的对局记录" description="调整筛选条件，或等待终端进房后产生会话。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>终端</th><th>俱乐部</th><th>房间 / 座位</th><th>开始</th><th>结束</th><th>局数</th><th>带入</th><th>净分</th><th>结束原因</th><th>操作</th></tr></thead>
            <tbody>{items.map((session) => <tr key={session.id}>
              <td><strong>{session.terminalNo || `#${session.robotId}`}</strong><small className="cell-subtitle">{session.nickname || "—"}</small></td>
              <td>{session.clubName || "—"}<small className="cell-subtitle">{session.clubId}</small></td>
              <td>{session.roomId}<small className="cell-subtitle">{session.seatNo > 0 ? `${session.seatNo} 号座` : "未入座"}</small></td>
              <td>{timeText(session.startedAt)}</td>
              <td>{session.endedAt ? timeText(session.endedAt) : <AutomationBadge value="playing" label="进行中" />}</td>
              <td>{session.rounds}</td>
              <td>{formatMoney(session.buyin)}</td>
              <td className={session.netWin < 0 ? "automation-warn-text" : ""}>{formatSigned(session.netWin)}</td>
              <td>{session.endReason ? endReasonLabel(session.endReason) : "—"}</td>
              <td><div className="row-actions"><button type="button" onClick={() => setDetailId(session.id)}>时间线</button></div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} loading={loading} hasMore={items.length >= data.pageSize} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>

    {detailId !== null && <SessionDetailModal sessionId={detailId} onClose={() => setDetailId(null)} />}
  </div>;
}

function SessionDetailModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SessionDetailResponse>(`/api/automation/sessions/${sessionId}`)
      .then(setData)
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : "会话详情加载失败"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return <Modal title={`会话 #${sessionId}`} eyebrow="SESSION TIMELINE" onClose={onClose} wide>
    {loading ? <LoadingBlock label="正在读取会话时间线" /> : error ? <ErrorBanner message={error} /> : data && <>
      <div className="automation-detail-metrics">
        <div><span>终端</span><strong>{data.session.terminalNo || `#${data.session.robotId}`}</strong></div>
        <div><span>房间 / 座位</span><strong>{data.session.roomId} / {data.session.seatNo || "—"}</strong></div>
        <div><span>局数</span><strong>{data.session.rounds}</strong></div>
        <div><span>带入</span><strong>{formatMoney(data.session.buyin)}</strong></div>
        <div><span>净分</span><strong className={data.session.netWin < 0 ? "automation-warn-text" : ""}>{formatSigned(data.session.netWin)}</strong></div>
      </div>
      <div className="automation-session-meta">
        <span>开始 {timeText(data.session.startedAt)}</span>
        <span>{data.session.endedAt ? `结束 ${timeText(data.session.endedAt)}` : "进行中"}</span>
        {data.session.endedAt && <span>{data.session.endReason ? endReasonLabel(data.session.endReason) : "未填写结束原因"}</span>}
      </div>
      {data.events.length === 0 ? <EmptyState title="没有事件记录" description="会话创建后，进房、入座和离桌事件会显示在这里。" /> : <ol className="automation-timeline">
        {data.events.map((event, index) => <li key={`${event.at}-${index}`}>
          <span className="automation-timeline__dot" />
          <div>
            <strong>{eventLabels[event.type] ?? event.type}</strong>
            <p>{event.detail || "—"}</p>
            <small>{timeText(event.at)}</small>
          </div>
        </li>)}
      </ol>}
    </>}
  </Modal>;
}
