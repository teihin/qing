import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  JsonPreview,
  Pagination,
  Tabs,
  statusLabel,
  timeText,
  useClubOptions,
  type AutomationApprovalItem,
  type AutomationClubItem,
  type AutomationGroupItem,
  type AutomationPageProps,
  type AutomationRobotItem,
  type AutomationTaskItem,
} from "./shared";

interface TaskListResponse { items: AutomationTaskItem[]; page: number; pageSize: number; total: number }

const taskTypes: { value: string; label: string; hint: string }[] = [
  { value: "enter_room", label: "进房", hint: "让目标终端进入指定房间，可选座位 0 表示自动。" },
  { value: "fill_seat", label: "补位", hint: "按自动化组目标在座补足空座。" },
  { value: "play_rounds", label: "打指定局数", hint: "执行指定局数后自动休息或离桌。" },
  { value: "leave_room", label: "离房", hint: "结束当前对局并释放座位。" },
  { value: "switch_room", label: "换房", hint: "按档位或局时偏好切换到其他房间。" },
  { value: "restart", label: "重启终端", hint: "重启客户端连接并恢复调度。" },
  { value: "snapshot", label: "刷新房间快照", hint: "触发一次房间池快照刷新。" },
];

const targetTypeLabels: Record<string, string> = { robot: "终端", group: "自动化组", club: "俱乐部", room: "房间", strategy: "策略", worker: "Worker", credential: "账号", approval: "审批单" };

function progressNote(task: AutomationTaskItem): string {
  if (task.failed > 0) return `失败 ${task.failed}`;
  if (task.status === "cancelled") return "已取消";
  if (task.status === "queued") return "尚未开始";
  if (task.status === "running") return "执行中";
  return "全部成功";
}

const approvalActionLabels: Record<string, string> = {
  "robot.batch_stop": "批量停止终端",
  "robot.batch_drain": "批量排空终端",
  "robot.delete": "批量删除终端",
  "strategy.publish": "发布策略",
};

const typeLabels: Record<string, string> = Object.fromEntries(taskTypes.map((item) => [item.value, item.label]));

export default function AutomationTasksPage({ can, notify }: AutomationPageProps) {
  const [tab, setTab] = useState("tasks");
  const [tasks, setTasks] = useState<TaskListResponse | null>(null);
  const [approvals, setApprovals] = useState<AutomationApprovalItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<AutomationApprovalItem | null>(null);

  const loadTasks = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setTasks(await api<TaskListResponse>(`/api/automation/tasks?page=${page}&pageSize=${pageSize}&status=${status}&type=${type}`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "任务列表加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [page, pageSize, status, type, notify]);

  const loadApprovals = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: AutomationApprovalItem[] }>("/api/automation/approvals");
      setApprovals(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "审批单加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (tab === "tasks") void loadTasks();
    else void loadApprovals();
  }, [tab, loadTasks, loadApprovals]);

  useEffect(() => {
    if (can("automation.approval.view")) void loadApprovals(true);
  }, [can, loadApprovals]);

  const act = async (task: AutomationTaskItem, action: "cancel" | "retry") => {
    try {
      const result = await api<{ message: string }>(`/api/automation/tasks/${task.id}/${action}`, { method: "POST" });
      notify(result.message);
      await loadTasks(true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "任务操作失败", "error");
    }
  };

  return <div className="page-stack">    <PageHeader
      eyebrow="TASK & APPROVAL"
      title="任务中心"
      description="下发进房、补位、打局和重启任务，并处理批量停台等高风险操作的审批。"
      actions={<div className="automation-header-actions">
        {tab === "tasks" && can("automation.task.create") && <Button onClick={() => setCreating(true)}>新建任务</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void (tab === "tasks" ? loadTasks() : loadApprovals())}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>演示环境下任务会立即标记完成或失败，不会真正驱动 Worker；正式环境会进入队列并由 Worker 领取执行。</DemoNote>

    <section className="panel">
      <div className="automation-panel-head">
        <Tabs value={tab} onChange={(value) => { setTab(value); setError(""); }} items={[
          { key: "tasks", label: "任务", count: tasks?.total },
          ...(can("automation.approval.view") ? [{ key: "approvals", label: "审批单", count: approvals?.length }] : []),
        ]} />
        {tab === "tasks" && <div className="automation-filter-row">
          <label>类型<select value={type} onChange={(event) => { setPage(1); setType(event.target.value); }}><option value="">全部类型</option>{taskTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部状态</option>{["queued", "running", "success", "failed", "cancelled"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>}
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}

      {tab === "tasks" && (!tasks && loading ? <LoadingBlock label="正在读取任务" /> : !tasks || tasks.items.length === 0 ? <EmptyState title="还没有任务" description="新建一个进房或补位任务，观察任务状态和覆盖终端数。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>任务</th><th>类型</th><th>目标</th><th>状态</th><th>进度</th><th>创建人</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>{tasks.items.map((task) => <tr key={task.id}>
              <td><strong>{task.taskNo}</strong><small className="cell-subtitle">#{task.id} · 优先级 {task.priority}</small></td>
              <td>{typeLabels[task.type] ?? task.type}<small className="cell-subtitle"><JsonPreview value={task.params} /></small></td>
              <td>{targetTypeLabels[task.targetType] ?? task.targetType}<small className="cell-subtitle">#{task.targetId}</small></td>
              <td><AutomationBadge value={task.status} /></td>
              <td>{task.succeeded} / {task.total}<small className={`cell-subtitle ${task.failed > 0 ? "automation-warn-text" : ""}`}>{progressNote(task)}</small></td>
              <td>{task.createdBy || "系统"}</td>
              <td>{timeText(task.createdAt)}<small className="cell-subtitle">{task.finishedAt ? `完成于 ${timeText(task.finishedAt)}` : task.startedAt ? `开始于 ${timeText(task.startedAt)}` : "尚未开始"}</small></td>
              <td><div className="row-actions">
                {(task.status === "queued" || task.status === "running") && can("automation.task.cancel") && <button type="button" className="is-danger" onClick={() => void act(task, "cancel")}>取消</button>}
                {(task.status === "failed" || task.status === "cancelled") && can("automation.task.create") && <button type="button" onClick={() => void act(task, "retry")}>重试</button>}
                {!["queued", "running", "failed", "cancelled"].includes(task.status) && <span className="muted">—</span>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination page={tasks.page} pageSize={tasks.pageSize} total={tasks.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>)}

      {tab === "approvals" && (!approvals && loading ? <LoadingBlock label="正在读取审批单" /> : !approvals || approvals.length === 0 ? <EmptyState title="没有审批单" description="批量停止或排空超过 10 台终端时，会自动生成审批单。" /> : <div className="table-wrap">
        <table className="automation-table automation-table--approvals">
          <thead><tr><th>审批单</th><th>操作</th><th>目标</th><th>参数</th><th>发起人</th><th>状态</th><th>发起时间</th><th>操作</th></tr></thead>
          <tbody>{approvals.map((item) => <tr key={item.id}>
            <td><strong>#{item.id}</strong><small className="cell-subtitle">{item.reason || "无说明"}</small></td>
            <td>{approvalActionLabels[item.action] ?? item.action}</td>
            <td>{targetTypeLabels[item.targetType] ?? item.targetType}<small className="cell-subtitle">#{item.targetId}</small></td>
            <td><JsonPreview value={item.params} /></td>
            <td>{item.requesterName || "—"}</td>
            <td><AutomationBadge value={item.status} />{item.approverName && <small className="cell-subtitle">审批人 {item.approverName}</small>}</td>
            <td>{timeText(item.createdAt)}</td>
            <td><div className="row-actions">
              {item.status === "pending" && can("automation.approval.decide") && <button type="button" onClick={() => setDeciding(item)}>审批</button>}
              {item.status !== "pending" && <span className="muted">{item.decidedAt ? timeText(item.decidedAt) : "—"}</span>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>)}
    </section>

    {creating && <CreateTaskModal notify={notify} onClose={() => setCreating(false)} onCreated={(message) => { setCreating(false); notify(message); void loadTasks(true); }} />}
    {deciding && <DecideApprovalModal approval={deciding} onClose={() => setDeciding(null)} onDecided={(message) => { setDeciding(null); notify(message); void loadApprovals(true); }} />}
  </div>;
}

function CreateTaskModal({ notify, onClose, onCreated }: { notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onCreated: (message: string) => void }) {
  const clubs = useClubOptions();
  const [robots, setRobots] = useState<AutomationRobotItem[]>([]);
  const [groups, setGroups] = useState<AutomationGroupItem[]>([]);
  const [type, setType] = useState("enter_room");
  const [targetType, setTargetType] = useState("robot");
  const [targetId, setTargetId] = useState("");
  const [priority, setPriority] = useState("5");
  const [params, setParams] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ items: AutomationRobotItem[] }>("/api/automation/robots?page=1&pageSize=100").then((response) => setRobots(response.items)).catch(() => setRobots([]));
    void api<{ items: AutomationGroupItem[] }>("/api/automation/groups").then((response) => setGroups(response.items)).catch(() => setGroups([]));
  }, []);

  const changeType = (value: string) => {
    setType(value);
    const defaults: Record<string, string> = {
      enter_room: "{}",
      fill_seat: "{}",
      play_rounds: '{\n  "rounds": 20\n}',
      leave_room: "{}",
      switch_room: '{\n  "tier": "2"\n}',
      restart: "{}",
      snapshot: "{}",
    };
    setParams(defaults[value] ?? "{}");
  };

  const submit = async () => {
    if (!targetId) { setError("请选择任务目标"); return; }
    let parsed: unknown = {};
    try {
      parsed = params.trim() ? JSON.parse(params) : {};
    } catch {
      setError("任务参数不是合法 JSON");
      return;
    }
    const payload = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    if (type === "enter_room" && !(Number(payload.roomId) > 0)) {
      setError("进房任务需要在参数里填写 roomId，座位号 0 表示自动选座");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/automation/tasks", {
        method: "POST",
        ...jsonBody({ type, targetType, targetId, priority: Number(priority), params: parsed }),
      });
      onCreated(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "创建任务失败");
    } finally {
      setBusy(false);
    }
  };

  const selectedType = taskTypes.find((item) => item.value === type);

  return <Modal title="新建自动化任务" eyebrow="NEW TASK" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="任务类型"><select value={type} onChange={(event) => changeType(event.target.value)}>{taskTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      <Field label="优先级" hint="1–9，数字越大越优先"><input type="number" min={1} max={9} value={priority} onChange={(event) => setPriority(event.target.value)} /></Field>
      <Field label="目标类型"><select value={targetType} onChange={(event) => { setTargetType(event.target.value); setTargetId(""); }}><option value="robot">机器人终端</option><option value="group">自动化组</option><option value="club">整个俱乐部</option></select></Field>
      <Field label="目标">
        {targetType === "robot" && <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">请选择终端</option>{robots.map((robot) => <option key={robot.id} value={robot.id}>{robot.terminalNo} · {robot.nickname}（{statusLabel(robot.status)}）</option>)}</select>}
        {targetType === "group" && <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">请选择自动化组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.clubName}</option>)}</select>}
        {targetType === "club" && <select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">请选择俱乐部</option>{clubs.map((club: AutomationClubItem) => <option key={club.clubId} value={club.clubId}>{club.clubId} · {club.name}</option>)}</select>}
      </Field>
      <div className="automation-form-note automation-form-note--wide">{selectedType?.hint}</div>
      <Field label="任务参数（JSON）" hint="留空表示使用默认参数；房间、档位等字段由 Worker 解释"><textarea rows={6} value={params} onChange={(event) => setParams(event.target.value)} placeholder={type === "enter_room" ? '例如 {"roomId": 851724, "seatNo": 0}' : undefined} /></Field>
      <div className="automation-task-preview">
        <h4>将下发给</h4>
        <p>{targetType === "robot" ? "单台终端" : targetType === "group" ? "组内全部终端" : "俱乐部全部终端"}</p>
        <span>演示环境会立即返回覆盖终端数，不会真正执行游戏动作。</span>
        <button type="button" className="link-button" onClick={() => notify("任务创建后可到任务列表查看状态和覆盖终端数", "success")}>查看说明</button>
      </div>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText="下发任务" /></div>
    </form>
  </Modal>;
}

function DecideApprovalModal({ approval, onClose, onDecided }: { approval: AutomationApprovalItem; onClose: () => void; onDecided: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "">("");
  const [error, setError] = useState("");

  const decide = async (approve: boolean) => {
    setBusy(approve ? "approve" : "reject"); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/approvals/${approval.id}/decide`, { method: "POST", ...jsonBody({ approve, reason }) });
      onDecided(result.message);
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiError ? reasonValue.message : "审批失败");
    } finally {
      setBusy("");
    }
  };

  return <Modal title={`审批 #${approval.id}`} eyebrow="APPROVAL" onClose={onClose} wide>
    <div className="automation-approval-summary">
      <div><span>操作</span><strong>{approvalActionLabels[approval.action] ?? approval.action}</strong></div>
      <div><span>目标</span><strong>{targetTypeLabels[approval.targetType] ?? approval.targetType} #{approval.targetId}</strong></div>
      <div><span>发起人</span><strong>{approval.requesterName || "—"}</strong></div>
      <div><span>发起时间</span><strong>{timeText(approval.createdAt)}</strong></div>
    </div>
    {approval.reason && <div className="automation-note-line">{approval.reason}</div>}
    <h3 className="automation-section-title">操作参数</h3>
    <pre className="automation-json-block">{formatJson(approval.params)}</pre>
    <ErrorBanner message={error} />
    <Field label="审批备注" hint="通过或驳回都会追加到审批单，最多 100 个字符"><textarea rows={3} value={reason} maxLength={100} onChange={(event) => setReason(event.target.value)} /></Field>
    <div className="automation-modal-actions">
      <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void decide(false)}>{busy === "reject" ? "正在驳回…" : "驳回"}</Button>
      <Button disabled={Boolean(busy)} onClick={() => void decide(true)}>{busy === "approve" ? "正在通过…" : "通过并执行"}</Button>
    </div>
  </Modal>;
}

function formatJson(value: string): string {
  try {
    return prettyJson(JSON.parse(value));
  } catch {
    return value || "{}";
  }
}

function prettyJson(value: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object")) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    return `[\n${value.map((item) => inner + prettyJson(item, depth + 1)).join(",\n")}\n${pad}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${prettyJson(item, depth + 1)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}
