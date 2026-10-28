import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, formatDate } from "../../components/ui";
import { RobotLogList } from "./AutomationRobotLogs";
import {
  AutomationBadge,
  ErrorBanner,
  JsonPreview,
  ProgressBar,
  Tabs,
  statusLabel,
  timeText,
  type AutomationAgentTokenState,
  type AutomationPageProps,
  type AutomationWorkerCommand,
  type AutomationWorkerDetail,
  type AutomationWorkerEvent,
  type AutomationWorkerRobot,
  type AutomationWorkerRow,
  workerCommandLabel,
  workerCommandTypes,
  workerEventLabel,
  workerEventSummary,
  workerEventTone,
} from "./shared";

const workerStatuses = ["online", "offline", "draining", "disabled"];

export default function AutomationWorkersPage({ can, notify }: AutomationPageProps) {
  const [items, setItems] = useState<AutomationWorkerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pending, setPending] = useState<{ worker: AutomationWorkerRow; action: WorkerAction } | null>(null);
  const canManage = can("automation.worker.manage");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams();
      if (query) search.set("keyword", query);
      if (status) search.set("status", status);
      const suffix = search.toString();
      const response = await api<{ items: AutomationWorkerRow[] }>(`/api/automation/workers${suffix ? `?${suffix}` : ""}`);
      setItems(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "Worker 节点加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify, query, status]);

  useEffect(() => { void load(); }, [load]);

  // 节点可能随时退出或被关掉，列表跟着自动刷新，不用手动点「刷新」。
  useEffect(() => {
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => {
    const list = items ?? [];
    return {
      online: list.filter((item) => item.status === "online" && item.leased).length,
      total: list.length,
      robots: list.reduce((sum, item) => sum + item.robotCount, 0),
      capacity: list.reduce((sum, item) => sum + item.maxRobots, 0),
      pending: list.reduce((sum, item) => sum + item.pendingCommands, 0),
      faulted: list.reduce((sum, item) => sum + item.faultedRobots, 0),
    };
  }, [items]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="WORKER NODES"
      title="Worker 节点"
      description="无头节点通过接入令牌注册后领取命令、上报事件；这里看节点健康、下发命令、处理异常终端。"
      actions={<div className="row-actions">
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    {canManage && <AgentTokenCard notify={notify} />}

    <section className="automation-mini-stats">
      <div><span>在线节点</span><strong>{summary.online} <em>/ {summary.total}</em></strong></div>
      <div><span>终端承载</span><strong>{summary.robots} <em>/ {summary.capacity}</em></strong></div>
      <div><span>待执行命令</span><strong>{summary.pending}</strong></div>
      <div><span>异常终端</span><strong>{summary.faulted}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索节点编号、IP 或标签" />
          <button>搜索</button>
        </form>
        <div className="automation-filter-row">
          <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{workerStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!items && loading ? <LoadingBlock label="正在读取 Worker 节点" /> : !items || items.length === 0 ? <EmptyState title="还没有 Worker 节点" description="在节点上启动 xuanagent 并填入接入令牌，节点会自动注册到这里。" /> : <>
        <div className="table-wrap">
          <table className="automation-table automation-table--workers">
            <thead><tr>
              <th>节点</th><th>状态</th><th>租约</th><th>承载终端</th><th>负载</th><th>命令</th><th>心跳</th><th>操作</th>
            </tr></thead>
            <tbody>
              {items.map((worker) => <tr key={worker.id} className={worker.faultedRobots > 0 || !worker.leased ? "is-risk" : ""}>
                <td>
                  <strong>{worker.nodeCode}</strong>
                  <small className="cell-subtitle">{worker.host || "—"}{worker.labels ? ` · ${worker.labels}` : ""}</small>
                </td>
                <td><AutomationBadge value={worker.status} /><small className="cell-subtitle">{worker.platform || worker.os || "—"}{worker.arch ? `/${worker.arch}` : ""} · v{worker.version || "—"}</small></td>
                <td>{worker.leased ? <span className="automation-ok-text">有效</span> : <span className="automation-warn-text">已过期</span>}<small className="cell-subtitle">注册 {timeText(worker.enrolledAt)}</small></td>
                <td>{worker.robotCount} / {worker.maxRobots}<ProgressBar value={worker.robotCount} max={Math.max(worker.maxRobots, 1)} danger={worker.robotCount >= worker.maxRobots} hideValue /><small className="cell-subtitle">{worker.faultedRobots > 0 ? `${worker.faultedRobots} 台异常` : "全部正常"}</small></td>
                <td>CPU {worker.cpuPct}%<small className="cell-subtitle">内存 {worker.memPct}%</small></td>
                <td>待执行 {worker.pendingCommands}<small className="cell-subtitle">执行中 {worker.runningCommands}</small></td>
                <td>{timeText(worker.lastHeartbeat)}<small className="cell-subtitle">seq {worker.lastEventSeq}</small></td>
                <td><div className="row-actions">
                  <button type="button" onClick={() => setDetailId(worker.id)}>详情</button>
                  {canManage && worker.status !== "draining" && worker.status !== "disabled" && <button type="button" onClick={() => setPending({ worker, action: "drain" })}>排空</button>}
                  {canManage && (worker.status === "draining" || worker.status === "disabled") && <button type="button" onClick={() => setPending({ worker, action: "enable" })}>恢复</button>}
                  {canManage && worker.status !== "disabled" && <button type="button" onClick={() => setPending({ worker, action: "restart" })}>重启</button>}
                  {canManage && worker.status !== "disabled" && <button type="button" className="is-danger" onClick={() => setPending({ worker, action: "disable" })}>停用</button>}
                  {canManage && worker.status === "disabled" && <button type="button" className="is-danger" onClick={() => setPending({ worker, action: "delete" })}>删除</button>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
    </section>

    {detailId !== null && <WorkerDetailModal workerId={detailId} canManage={canManage} notify={notify} onClose={() => setDetailId(null)} onChanged={() => load(true)} />}
    {pending && <WorkerActionModal worker={pending.worker} action={pending.action} onClose={() => setPending(null)} onDone={(message) => { setPending(null); notify(message); void load(true); }} />}
  </div>;
}

type WorkerAction = "enable" | "drain" | "disable" | "restart" | "delete";

const actionMeta: Record<WorkerAction, { title: string; note: string; danger?: boolean }> = {
  enable: { title: "恢复节点调度", note: "恢复后节点重新接收新终端，并收到一条对账命令把本地终端拉回后台期望状态。" },
  drain: { title: "排空节点", note: "不再给这个节点分配新终端，已有终端打完当前牌局后离座，随后可以安全下线。" },
  restart: { title: "重启节点终端", note: "下发对账命令，节点会重新拉起终端进程；正在进行的一局会中断。" },
  disable: { title: "停用节点", note: "立刻作废租约并踢下线，节点所有命令接口返回 403，必须重置接入令牌重新注册才能回来。", danger: true },
  delete: { title: "删除节点", note: "节点上的机器人会解绑并回到「等待分配」，记录从列表移除。此操作不可恢复。", danger: true },
};

function AgentTokenCard({ notify }: { notify: AutomationPageProps["notify"] }) {
  const [state, setState] = useState<AutomationAgentTokenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [issued, setIssued] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setState(await api<AutomationAgentTokenState>("/api/automation/agent-token"));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "读取接入令牌失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rotate = async () => {
    setBusy("rotate"); setError("");
    try {
      const result = await api<{ token: string; message: string }>("/api/automation/agent-token/rotate", { method: "POST" });
      setIssued(result.token);
      notify(result.message);
      await load();
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "生成接入令牌失败";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const clear = async () => {
    setBusy("clear"); setError("");
    try {
      const result = await api<{ message: string }>("/api/automation/agent-token", { method: "DELETE" });
      setIssued("");
      notify(result.message);
      await load();
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "关闭令牌校验失败";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const baseURL = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
  const configSample = `{
  "server": "${baseURL}",
  "code": "node-hk-01",
  "token": "${issued}",
  "capacity": 20
}`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制到剪贴板");
    } catch {
      notify("浏览器拒绝了剪贴板访问，请手动选中复制", "error");
    }
  };

  return <section className="panel automation-panel-pad">
    <div className="automation-token-head">
      <div>
        <h3>节点接入令牌（可选）</h3>
        <p>{loading ? "正在读取…" : state?.configured
          ? <>已启用校验 · {state.updatedBy ? `由 ${state.updatedBy} 于 ` : ""}{state.updatedAt ? formatDate(state.updatedAt) : "—"} 生成。令牌只存哈希，服务端读不回明文，节点配置文件里必须写同一个。</>
          : "当前是开放注册：任何能访问后台的机器都能注册节点，方便先跑通链路。要收紧就在这里生成令牌。"}</p>
      </div>
      <div className="row-actions">
        {state?.configured && <Button variant="ghost" disabled={busy !== ""} onClick={() => void clear()}>{busy === "clear" ? "关闭中…" : "关闭校验"}</Button>}
        <Button variant={state?.configured ? "secondary" : "primary"} disabled={busy !== "" || loading} onClick={() => void rotate()}>
          {busy === "rotate" ? "生成中…" : state?.configured ? "重置令牌" : "生成令牌"}
        </Button>
      </div>
    </div>
    {error && <ErrorBanner message={error} />}
    {state?.configured && !issued && <p className="automation-token-hint">重置令牌会让旧令牌立刻失效，所有节点要用新令牌重新注册；不想管令牌就点「关闭校验」。</p>}
    {issued && <div className="automation-token-issued">
      <div className="automation-token-head">
        <strong>令牌已生成，只显示这一次</strong>
        <div className="row-actions"><button type="button" onClick={() => void copy(issued)}>复制令牌</button></div>
      </div>
      <code className="automation-token-value">{issued}</code>
      <p className="automation-token-hint">放到节点程序同目录的 <code>xuanagent.json</code> 里（token 字段），节点启动时自动读取：</p>
      <pre className="automation-code">{configSample}</pre>
      <div className="row-actions"><button type="button" onClick={() => void copy(configSample)}>复制配置文件</button><button type="button" onClick={() => setIssued("")}>我已保存，隐藏</button></div>
    </div>}
    {!issued && !loading && <p className="automation-token-hint">
      节点只需在程序同目录放一个 <code>xuanagent.json</code>，把 <code>server</code> 填成 <code>{baseURL}</code> 后直接运行程序即可；
      也可以临时用 <code>-server</code> 传地址覆盖。<code>-print-config</code> 可查看当前生效配置。
    </p>}
  </section>;
}

function WorkerActionModal({ worker, action, onClose, onDone }: {
  worker: AutomationWorkerRow;
  action: WorkerAction;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const meta = actionMeta[action];

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/workers/${worker.id}/action`, { method: "POST", ...jsonBody({ action }) });
      onDone(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "节点操作失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`${meta.title} · ${worker.nodeCode}`} eyebrow="WORKER ACTION" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-worker-summary">
        <div><span>节点</span><strong>{worker.nodeCode}</strong></div>
        <div><span>当前状态</span><strong className="automation-detail-text"><AutomationBadge value={worker.status} /></strong></div>
        <div><span>承载终端</span><strong>{worker.robotCount} / {worker.maxRobots}</strong></div>
      </div>
      <div className="operation-warning"><strong>{meta.title}</strong><p>{meta.note}</p></div>
      <div className="automation-modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        <Button type="submit" variant={meta.danger ? "danger" : "primary"} disabled={busy}>{busy ? "执行中…" : "确认执行"}</Button>
      </div>
    </form>
  </Modal>;
}

function WorkerDetailModal({ workerId, canManage, notify, onClose, onChanged }: {
  workerId: number;
  canManage: boolean;
  notify: AutomationPageProps["notify"];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<AutomationWorkerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("robots");
  const [logRobot, setLogRobot] = useState<AutomationWorkerRobot | null>(null);
  const [commanding, setCommanding] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<AutomationWorkerDetail>(`/api/automation/workers/${workerId}`));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "节点详情加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(true); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const worker = data?.worker;
  const robots = data?.robots ?? [];
  const commands = data?.commands ?? [];
  const events = data?.events ?? [];

  return <Modal title={worker ? `${worker.nodeCode} · 节点详情` : `节点 #${workerId}`} eyebrow="WORKER DETAIL" onClose={onClose} wide>
    {loading ? <LoadingBlock label="正在读取节点详情" /> : error && !worker ? <ErrorBanner message={error} /> : worker && <>
      <ErrorBanner message={error} />
      <div className="automation-detail-metrics">
        <div><span>状态</span><strong className="automation-detail-text"><AutomationBadge value={worker.status} /></strong></div>
        <div><span>租约</span><strong className={worker.leased ? "automation-ok-text" : "automation-warn-text"}>{worker.leased ? "有效" : "已过期"}</strong></div>
        <div><span>承载终端</span><strong>{worker.robotCount} / {worker.maxRobots}</strong></div>
        <div><span>待执行命令</span><strong>{worker.pendingCommands}</strong></div>
        <div><span>异常终端</span><strong className={worker.faultedRobots > 0 ? "automation-warn-text" : ""}>{worker.faultedRobots}</strong></div>
      </div>

      <div className="automation-detail-actions">
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>刷新</Button>
        {canManage && worker.status !== "disabled" && <Button onClick={() => setCommanding(true)}>下发命令</Button>}
      </div>

      <dl className="automation-worker-facts">
        <div><dt>节点编号</dt><dd>{worker.nodeCode}</dd></div>
        <div><dt>上报 IP</dt><dd>{worker.host || "—"}</dd></div>
        <div><dt>平台 / 架构</dt><dd>{worker.platform || worker.os || "—"}{worker.arch ? ` / ${worker.arch}` : ""}</dd></div>
        <div><dt>版本</dt><dd>{worker.version || "—"}</dd></div>
        <div><dt>标签</dt><dd>{worker.labels || "—"}</dd></div>
        <div><dt>出口网段</dt><dd>{worker.egressCidr || "—"}</dd></div>
        <div><dt>注册时间</dt><dd>{formatDate(worker.enrolledAt)}</dd></div>
        <div><dt>最后心跳</dt><dd>{formatDate(worker.lastHeartbeat)}</dd></div>
        <div><dt>最后事件</dt><dd>{worker.lastEventAt ? `${formatDate(worker.lastEventAt)} · seq ${worker.lastEventSeq}` : "—"}</dd></div>
        <div><dt>CPU / 内存</dt><dd>{worker.cpuPct}% / {worker.memPct}%</dd></div>
      </dl>

      <div className="automation-worker-stream">
        <Tabs
          items={[
            { key: "robots", label: "终端", count: robots.length },
            { key: "commands", label: "命令", count: commands.length },
            { key: "events", label: "事件", count: events.length },
            ...(logRobot ? [{ key: "robotLog", label: "机器人日志" }] : []),
          ]}
          value={tab}
          onChange={(next) => { if (next !== "robotLog") setLogRobot(null); setTab(next); }}
        />
        {tab === "robotLog" && logRobot ? <div>
          <div className="automation-robot-log-head">
            <button type="button" className="link-button" onClick={() => { setLogRobot(null); setTab("robots"); }}>← 返回终端列表</button>
            <strong>{logRobot.nickname || logRobot.account}</strong>
            <small>{logRobot.terminalNo} · {logRobot.account}</small>
          </div>
          <RobotLogList robotId={logRobot.id} />
        </div> : <div className="automation-detail-list">
          {tab === "robots" && (robots.length === 0 ? <p className="automation-empty-text">这个节点还没有分到终端。去「投放」页把机器人分配到本节点。</p> : robots.map((robot) => <RobotRow key={robot.id} robot={robot} onOpen={() => { setLogRobot(robot); setTab("robotLog"); }} />))}
          {tab === "commands" && (commands.length === 0 ? <p className="automation-empty-text">还没有下发过命令。</p> : commands.map((command) => <CommandRow key={command.id} command={command} />))}
          {tab === "events" && (events.length === 0 ? <p className="automation-empty-text">还没有日志。节点上线、分配账号、登录、进房、等待、结算都会记在这里（后台动作标「系统」）。</p> : events.map((event) => <EventRow key={event.id} event={event} />))}
        </div>}
      </div>
    </>}
    {commanding && worker && <WorkerCommandModal worker={worker} robots={robots} onClose={() => setCommanding(false)} onDone={(message) => { setCommanding(false); notify(message); void load(true); void onChanged(); }} />}
  </Modal>;
}

function RobotRow({ robot, onOpen }: { robot: AutomationWorkerRobot; onOpen: () => void }) {
  return <article
    className="automation-detail-row is-clickable"
    role="button"
    tabIndex={0}
    title="查看这台机器人的运行日志"
    onClick={onOpen}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
  >
    <div>
      <strong>{robot.nickname || robot.account}</strong>
      <small>{robot.terminalNo} · {robot.account}</small>
    </div>
    <div><AutomationBadge value={robot.status} /></div>
    <div><small>{robot.clubName || robot.clubId || "未投放"}{robot.groupName ? ` · ${robot.groupName}` : ""}</small>{robot.lastError && <small className="automation-warn-text">{robot.lastError}</small>}</div>
    <div><small>房间 {robot.roomId ?? "—"}{robot.seatNo > 0 ? ` · ${robot.seatNo} 号座` : ""}</small></div>
  </article>;
}

const commandTone: Record<string, string> = {
  PENDING: "waiting", DELIVERED: "waiting", ACCEPTED: "running", RUNNING: "running",
  COMPLETED: "ok", REJECTED: "fault", EXPIRED: "fault", CANCELLED: "off",
};

function CommandRow({ command }: { command: AutomationWorkerCommand }) {
  return <article className="automation-detail-row">
    <div>
      <strong>{command.label || workerCommandLabel(command.type)}</strong>
      <small>{command.commandNo}</small>
    </div>
    <div><span className={`automation-tone is-${commandTone[command.status] ?? "off"}`}>{commandStatusLabel(command.status)}</span></div>
    <div><small>{command.robotName || command.terminalNo || "整节点"}</small><small>{command.createdBy || "系统"} · {timeText(command.createdAt)}</small></div>
    <div>
      {command.errorMessage && <small className="automation-warn-text">{command.errorMessage}</small>}
      {!command.errorMessage && command.result && <JsonPreview value={command.result} />}
      {!command.errorMessage && !command.result && <small>{command.finishedAt ? `完成于 ${timeText(command.finishedAt)}` : "等待节点回报"}</small>}
    </div>
  </article>;
}

function EventRow({ event }: { event: AutomationWorkerEvent }) {
  const system = event.eventId.startsWith("sys-");
  const summary = workerEventSummary(event.payload);
  return <article className="automation-detail-row">
    <div>
      <strong>{workerEventLabel(event.eventType)}</strong>
      <small>{system ? "后台动作" : event.eventType}</small>
    </div>
    <div><span className={`automation-tone is-${workerEventTone(event.eventType)}`}>{system ? "系统" : `seq ${event.sequence}`}</span></div>
    <div><small>{event.terminalNo || (event.robotId ?? "—")}</small><small>房间 {event.roomId ?? "—"}{event.roundId ? ` · 局 ${event.roundId}` : ""}</small></div>
    <div>
      <small>{timeText(event.occurredAt ?? event.receivedAt)}</small>
      {summary ? <small>{summary}</small> : event.payload && event.payload !== "{}" ? <JsonPreview value={event.payload} /> : null}
    </div>
  </article>;
}

function commandStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    PENDING: "待领取", DELIVERED: "已下发", ACCEPTED: "已接受", RUNNING: "执行中",
    COMPLETED: "已完成", REJECTED: "被拒绝", EXPIRED: "已过期", CANCELLED: "已取消",
  };
  return labels[value] ?? value;
}

function WorkerCommandModal({ worker, robots, onClose, onDone }: {
  worker: AutomationWorkerRow;
  robots: AutomationWorkerRobot[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [commandType, setCommandType] = useState("RECONCILE_STATE");
  const [robotId, setRobotId] = useState("");
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = workerCommandTypes.find((item) => item.value === commandType);

  const submit = async () => {
    setBusy(true); setError("");
    let parsed: unknown = undefined;
    if (params.trim()) {
      try {
        parsed = JSON.parse(params);
      } catch {
        setBusy(false);
        setError("参数必须是合法 JSON，例如 {\"reason\":\"manual\"}");
        return;
      }
    }
    try {
      const result = await api<{ message: string; commandNo: string }>(`/api/automation/workers/${worker.id}/commands`, {
        method: "POST",
        ...jsonBody({ commandType, robotId: robotId ? Number(robotId) : 0, params: parsed ?? {} }),
      });
      onDone(`${result.message}（${result.commandNo}）`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "下发命令失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`下发命令 · ${worker.nodeCode}`} eyebrow="MANUAL COMMAND" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="命令类型" hint={selected?.hint}>
        <select value={commandType} onChange={(event) => setCommandType(event.target.value)}>
          {workerCommandTypes.map((item) => <option key={item.value} value={item.value}>{item.label}（{item.value}）</option>)}
        </select>
      </Field>
      <Field label="作用终端" hint="留空表示对整节点生效（例如对账）。">
        <select value={robotId} onChange={(event) => setRobotId(event.target.value)}>
          <option value="">整节点</option>
          {robots.map((robot) => <option key={robot.id} value={robot.id}>{robot.terminalNo} · {robot.nickname || robot.account}</option>)}
        </select>
      </Field>
      <div className="automation-form-note--wide">
        <Field label="命令参数（JSON，可留空）">
          <textarea rows={4} value={params} onChange={(event) => setParams(event.target.value)} placeholder='{"reason":"manual","strategyVersion":3}' />
        </Field>
      </div>
      <p className="automation-token-hint automation-form-note--wide">命令 10 分钟内有效；节点未领取会自动重投最多 3 次，之后标记过期。</p>
      <div className="automation-modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={busy}>{busy ? "下发中…" : "确认下发"}</Button>
      </div>
    </form>
  </Modal>;
}
