import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { formatDate, Field } from "../../components/ui";

export type AutomationNotify = (message: string, kind?: "success" | "error") => void;

export interface AutomationPageProps {
  can: (permission: string) => boolean;
  notify: AutomationNotify;
}

export interface AutomationClubItem {
  clubId: string;
  name: string;
  mode: number;
  memberCount: number;
  unionName: string;
  robotQuota: number;
  seatRatio: number;
  maxPerRoom: number;
  inviteCode: string;
  status: string;
  notes: string;
  roomCount: number;
  capacity: number;
  seated: number;
  robotCount: number;
  enabledCount: number;
  robotSeated: number;
  onlineCount: number;
  targetSeated: number;
  updatedAt: string;
}

export interface AutomationRoomItem {
  roomId: number;
  clubId: string;
  clubName: string;
  roomName: string;
  tier: string;
  baseScore: number;
  durationMin: number;
  status: string;
  seated: number;
  maxSeats: number;
  observers: number;
  remainingMin: number;
  robots: number;
  humans: number;
  capturedAt: string;
}

export interface AutomationGroupItem {
  id: number;
  name: string;
  clubId: string;
  clubName: string;
  strategyId: number | null;
  strategyName: string;
  targetSeated: number;
  maxRobots: number;
  tierPref: string;
  durationPref: string;
  buyinRatio: number;
  defaultIntelligence: number;
  profitMode: string;
  profitTarget: number;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  notes: string;
  robotCount: number;
  seatedCount: number;
  updatedAt: string;
}

export interface AutomationRobotItem {
  id: number;
  terminalNo: string;
  account: string;
  nickname: string;
  avatar: number;
  clubId: string;
  clubName: string;
  groupId: number | null;
  /** 周计划时段（JSON 字符串），非空表示这台机器人按周时段跑。 */
  profitSchedule: string;
  /** released 表示当前在时段外，已经把 Worker 位置让出来了。 */
  scheduleState: string;
  /** 本时段累计净分，换时段清零。 */
  windowNet: number;
  groupName: string;
  strategyId: number | null;
  strategyName: string;
  workerId: number | null;
  workerName: string;
  egressIp: string;
  status: string;
  desiredStatus: string;
  roomId: number | null;
  seatNo: number;
  buyin: number;
  buyinMultiple: number;
  roomPi: string;
  gps: string;
  publicIp: string;
  ipSeenAt: string | null;
  passwordSet: boolean;
  passwordUpdatedAt: string | null;
  intelligence: number;
  groupIntelligence: number;
  profitMode: string;
  profitTarget: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodNet: number;
  enabled: boolean;
  inviteCode: string;
  joinStatus: string;
  joinedAt: string | null;
  /** 首次真实登录（账号激活）时间；为空表示还没登录过，不能投放。 */
  activatedAt: string | null;
  activationError: string;
  groupProfitMode: string;
  groupProfitTarget: number;
  groupPeriodStart: string | null;
  groupPeriodEnd: string | null;
  balance: number;
  todayRounds: number;
  todayNet: number;
  lastHeartbeat: string | null;
  lastError: string;
  riskFlag: boolean;
  isDemo: boolean;
  updatedAt: string;
}

export interface AutomationStrategyTier {
  minG: number;
  safeGen: number;
  noAddGenMin: number;
}

/** 策略 = 机器人的「动作与智力」：怎么跑、怎么出牌。进房与输赢目标归投放，不在这里。 */
export interface AutomationStrategyConfig {
  // 跑法节奏
  buyinMultiple: number;
  stayBuyinTimes: number;
  roomAvoidMs: number;
  sitTimeoutMs: number;
  reinstateDelayMs: number;
  roomRetryMs: number;
  // 出牌节奏
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  decideTimeoutMs: number;
  // 三档安全线（键为 "1" / "2" / "5"）
  tiers: Record<string, AutomationStrategyTier>;
  // 牌力
  bigPairFen: number;
  weakLowFen: number;
  protectPairFen: number;
  protectBothFen: number;
  // 输赢控制
  winStreakPause: number;
  deadbandRatio: number;
  addMoreChance: number;
}

export interface AutomationStrategyItem {
  id: number;
  name: string;
  code: string;
  version: number;
  playStyle: string;
  status: string;
  config: AutomationStrategyConfig;
  previousVersion: number;
  updatedBy: string;
  updatedAt: string;
  groupCount: number;
  robotCount?: number;
}

export interface AutomationTaskItem {
  id: number;
  taskNo: string;
  type: string;
  targetType: string;
  targetId: string;
  params: string;
  status: string;
  priority: number;
  total: number;
  succeeded: number;
  failed: number;
  createdBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AutomationApprovalItem {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  params: string;
  reason: string;
  status: string;
  requesterName: string;
  approverName: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface AutomationSessionItem {
  id: number;
  robotId: number;
  terminalNo: string;
  nickname: string;
  clubId: string;
  clubName: string;
  roomId: number;
  seatNo: number;
  startedAt: string;
  endedAt: string | null;
  rounds: number;
  buyin: number;
  netWin: number;
  endReason: string;
}

export interface AutomationWorkerItem {
  id: number;
  nodeCode: string;
  host: string;
  os: string;
  version: string;
  status: string;
  robotCount: number;
  maxRobots: number;
  cpuPct: number;
  memPct: number;
  egressCidr: string;
  lastHeartbeat: string | null;
  isDemo: boolean;
}

/** Worker 节点列表行：在总览那份精简字段之上，补 Worker 通道的租约、命令与事件信息。 */
export interface AutomationWorkerRow extends AutomationWorkerItem {
  platform: string;
  arch: string;
  labels: string;
  enrolledAt: string | null;
  lastEventAt: string | null;
  lastEventSeq: number;
  notes: string;
  leased: boolean;
  pendingCommands: number;
  runningCommands: number;
  faultedRobots: number;
}

export interface AutomationWorkerRobot {
  id: number;
  terminalNo: string;
  account: string;
  nickname: string;
  clubId: string;
  clubName: string;
  groupName: string;
  status: string;
  roomId: number | null;
  seatNo: number;
  lastError: string;
}

export interface AutomationWorkerCommand {
  id: number;
  commandNo: string;
  type: string;
  label: string;
  status: string;
  robotId: number | null;
  terminalNo: string;
  robotName: string;
  params: string;
  errorCode: string;
  errorMessage: string;
  result: string;
  attempts: number;
  createdBy: string;
  createdAt: string;
  deliveredAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
}

export interface AutomationWorkerEvent {
  id: number;
  eventId: string;
  eventType: string;
  robotId: number | null;
  terminalNo: string;
  sequence: number;
  roomId: number | null;
  roundId: string;
  commandNo: string;
  payload: string;
  occurredAt: string | null;
  receivedAt: string;
}

export interface AutomationWorkerDetail {
  worker: AutomationWorkerRow;
  robots: AutomationWorkerRobot[];
  commands: AutomationWorkerCommand[];
  events: AutomationWorkerEvent[];
}

export interface AutomationAgentTokenState {
  configured: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

/** 命令枚举，与后端 agentCommandTypes 保持一致，顺序即下拉顺序。 */
export const workerCommandTypes: { value: string; label: string; hint: string }[] = [
  { value: "START_TERMINAL", label: "启动终端", hint: "让节点拉起这个终端并登录进游戏。" },
  { value: "PAUSE_TERMINAL", label: "暂停终端", hint: "暂停决策，玩家掉线但占座保留。" },
  { value: "DRAIN_TERMINAL", label: "排空终端", hint: "打完当前一局再离座离房。" },
  { value: "STOP_TERMINAL", label: "停止终端", hint: "立即离桌并退出终端进程。" },
  { value: "START_TASK", label: "启动任务", hint: "按指派开始执行自动化任务。" },
  { value: "PAUSE_TASK", label: "暂停任务", hint: "任务保留，暂停动作。" },
  { value: "CANCEL_TASK", label: "取消任务", hint: "放弃任务，节点回到空闲。" },
  { value: "APPLY_STRATEGY", label: "应用策略", hint: "让节点按 params 里的策略重新加载。" },
  { value: "RECONCILE_STATE", label: "对账状态", hint: "把节点本地终端收敛到后台期望状态。" },
];

export const workerEventTypes: { value: string; label: string; hint?: string }[] = [
  { value: "WorkerOnline", label: "节点上线", hint: "后台" },
  { value: "WorkerOffline", label: "节点离线", hint: "后台" },
  { value: "RobotAssigned", label: "分配账号", hint: "后台" },
  { value: "RobotReleased", label: "收回账号", hint: "后台" },
  { value: "TerminalStarted", label: "拉起终端" },
  { value: "LoginStarted", label: "开始登录" },
  { value: "LoginSucceeded", label: "登录成功" },
  { value: "LoginFailed", label: "登录失败" },
  { value: "Waiting", label: "等待" },
  { value: "RoomCreated", label: "创建房间" },
  { value: "RoomJoined", label: "进入房间" },
  { value: "PlayerSeated", label: "入座" },
  { value: "GameReady", label: "准备开局" },
  { value: "GameStarted", label: "开局" },
  { value: "TurnStarted", label: "轮到行动" },
  { value: "ActionSubmitted", label: "提交动作" },
  { value: "ActionAccepted", label: "动作通过" },
  { value: "ActionRejected", label: "动作被拒" },
  { value: "GameSettled", label: "本局结算" },
  { value: "TableState", label: "牌桌快照" },
  { value: "TerminalLog", label: "终端日志" },
  { value: "RoomLeft", label: "离开房间" },
  { value: "RoomClosed", label: "房间关闭" },
  { value: "LogoutSucceeded", label: "退出账号" },
  { value: "TerminalStopped", label: "终端停止" },
  { value: "TaskCompleted", label: "任务完成" },
  { value: "TaskFailed", label: "任务失败" },
];

export function workerCommandLabel(value: string): string {
  return workerCommandTypes.find((item) => item.value === value)?.label ?? value;
}

export function workerEventLabel(value: string): string {
  return workerEventTypes.find((item) => item.value === value)?.label ?? value;
}

// workerEventSummary 把事件 payload 里的关键信息抽成一句人话，
// 让节点日志一眼能看出「分配了哪个账号 / 登录为什么失败 / 在等什么」。
export function workerEventSummary(payload: string): string {
  const text = (payload ?? "").trim();
  if (!text || text === "{}") return "";
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return "";
  }
  const textField = (key: string) => (typeof data[key] === "string" ? String(data[key]).trim() : "");
  const numberField = (key: string) => (typeof data[key] === "number" ? Number(data[key]) : 0);
  const parts: string[] = [];
  const message = textField("message");
  if (message) parts.push(message);
  // message 里已经写过的信息就不重复堆一遍。
  const missing = (part: string) => part !== "" && !message.includes(part);
  const account = textField("account");
  if (account && missing(account)) parts.push(`账号 ${account}`);
  const club = textField("clubName") || (textField("clubId") ? `俱乐部 ${textField("clubId")}` : "");
  if (club && missing(club)) parts.push(club);
  const reason = textField("reason");
  if (reason && missing(reason)) parts.push(`原因 ${reason}`);
  const room = numberField("roomId");
  const seat = numberField("seatNo");
  if (room > 0 && missing(String(room))) parts.push(`房间 ${room}${seat > 0 ? ` · ${seat} 号座` : ""}`);
  const delta = numberField("delta");
  if (delta !== 0) parts.push(`输赢 ${delta > 0 ? "+" : ""}${delta}`);
  const retry = numberField("retryInSeconds");
  if (retry > 0) parts.push(`${retry} 秒后重试`);
  return parts.join(" · ");
}

// workerEventTone 决定事件在列表里的颜色：失败红、成功绿、等待黄、进行蓝。
export function workerEventTone(eventType: string): string {
  switch (eventType) {
    case "LoginFailed":
    case "TaskFailed":
    case "WorkerOffline":
      return "fault";
    case "LoginSucceeded":
    case "WorkerOnline":
    case "GameSettled":
      return "ok";
    case "Waiting":
    case "RobotReleased":
      return "waiting";
    case "RobotAssigned":
    case "TerminalStarted":
    case "LoginStarted":
    case "RoomJoined":
    case "PlayerSeated":
      return "running";
    default:
      return "off";
  }
}

export interface AutomationCredentialItem {
  id: number;
  account: string;
  clubId: string;
  clubName: string;
  status: string;
  secretConfigured: boolean;
  lastLogin: string | null;
  failCount: number;
  remark: string;
  updatedAt: string;
}

export interface AutomationIPItem {
  id: number;
  ip: string;
  region: string;
  boundCount: number;
  maxCount: number;
  health: string;
  bannedCount: number;
  remark: string;
  updatedAt: string;
}

export interface AutomationAlertItem {
  id: number;
  level: string;
  category: string;
  targetType: string;
  targetId: string;
  title: string;
  detail: string;
  status: string;
  assignee: string;
  note: string;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
}

export interface AutomationOverviewMetrics {
  totalRobots: number;
  onlineRobots: number;
  seatedRobots: number;
  playingRobots: number;
  faultedRobots: number;
  capacity: number;
  seatedTotal: number;
  targetSeated: number;
  todayRounds: number;
  todayNet: number;
  openAlerts: number;
  p0Alerts: number;
  pendingApprovals: number;
  healthRate: number;
}

export interface AutomationClubCard {
  clubId: string;
  name: string;
  mode: number;
  robotQuota: number;
  seatRatio: number;
  status: string;
  roomCount: number;
  capacity: number;
  seated: number;
  robotCount: number;
  onlineCount: number;
  targetSeated: number;
}

export interface AutomationOverviewData {
  metrics: AutomationOverviewMetrics;
  clubs: AutomationClubCard[];
  alerts: AutomationAlertItem[];
  approvals: AutomationApprovalItem[];
  workers: AutomationWorkerItem[];
  generatedAt: string;
  demo: boolean;
}

export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, value === true ? "1" : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const statusLabels: Record<string, string> = {
  enabled: "已启用",
  disabled: "已停用",
  draft: "草稿",
  gray: "灰度中",
  online: "在线",
  offline: "离线",
  draining: "排空中",
  created: "待启动",
  idle: "空闲",
  entering: "进房中",
  seated: "已入座",
  playing: "游戏中",
  paused: "已暂停",
  stopped: "已停止",
  faulted: "故障",
  queued: "排队中",
  running: "执行中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  open: "待处理",
  ack: "已认领",
  resolved: "已解决",
  ignored: "已忽略",
  configured: "已配置",
  missing: "未配置",
  locked: "已锁定",
  joined: "已加入",
  unassigned: "未投放",
  healthy: "正常",
  risk: "风险",
  banned: "已停用",
  conservative: "保守",
  balanced: "均衡",
  aggressive: "激进",
};

const categoryLabels: Record<string, string> = {
  worker_offline: "节点离线",
  ip_conflict: "IP 冲突",
  low_balance: "余额不足",
  room_expiring: "房间将结束",
  task_backlog: "任务积压",
  strategy_stop_loss: "策略止损",
  heartbeat: "心跳异常",
  login_failed: "登录失败",
  seat_shortage: "在座不足",
  loss_streak: "连续亏损",
  version: "版本检查",
};

const targetTypeLabels: Record<string, string> = {
  robot: "终端", worker: "节点", credential: "账号", club: "俱乐部", room: "房间", task: "任务", strategy: "策略", group: "自动化组", approval: "审批单",
  automation_robot: "终端", automation_worker: "节点", automation_credential: "账号", automation_club: "俱乐部", automation_room: "房间",
  automation_task: "任务", automation_strategy: "策略", automation_group: "自动化组", automation_approval: "审批单", automation_alert: "告警",
  automation_ip: "出口 IP", mgr_user: "后台用户",
};

export function categoryLabel(value: string): string {
  return categoryLabels[value] ?? value ?? "—";
}

export function targetTypeLabel(value: string): string {
  return targetTypeLabels[value] ?? value ?? "—";
}

const endReasonLabels: Record<string, string> = {
  drain: "排空",
  stop: "停止",
  approval: "审批后停止",
  delete: "终端删除",
  recall: "人工召回",
  disable: "终端停用",
  fault: "终端异常",
  disconnected: "连接断开",
};

export function endReasonLabel(value: string): string {
  return endReasonLabels[value] ?? value ?? "—";
}

const profitModeLabels: Record<string, string> = {
  daily: "每日总输赢",
  period: "周期总输赢",
  schedule: "按周时段",
  none: "不限制",
};

export function profitModeLabel(value: string): string {
  return profitModeLabels[value] ?? (value ? value : "跟随分组");
}

export function profitTargetText(mode: string, target: number, start?: string | null, end?: string | null): string {
  if (!mode) return "跟随分组";
  if (mode === "none") return "不限制";
  const amount = `${target > 0 ? "赢 " : target < 0 ? "输 " : ""}${formatMoney(Math.abs(target))}`;
  if (mode === "period" && start && end) return `${start} ~ ${end} · ${amount}`;
  return amount;
}

/** 底皮档位，顺序与游戏内服务端 playcount_count 下发顺序一致；空串表示不限。 */
export const ROOM_PI_LEVELS = ["0.1/0.3", "0.2/0.5", "1/3", "2/5", "5/10", "10/20", "20/40", "50/100"];

export function roomPiLevels(value?: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim().replace(/^底皮/, "")).filter(Boolean);
}

export function roomPiText(value?: string | null): string {
  const levels = roomPiLevels(value);
  return levels.length === 0 ? "不限底皮" : levels.map((level) => `底皮${level}`).join("、");
}

/** 底皮多选：按游戏里的档位挑要进的房间，一个都不选表示不限。 */
export function RoomPiPicker({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const selected = roomPiLevels(value);
  const toggle = (level: string) => {
    const next = selected.includes(level) ? selected.filter((item) => item !== level) : [...selected, level];
    onChange(next.map((item) => `底皮${item}`).join(","));
  };
  return <div className={`automation-pi-picker${disabled ? " is-disabled" : ""}`}>
    {ROOM_PI_LEVELS.map((level) => <button key={level} type="button" disabled={disabled} aria-pressed={selected.includes(level)} className={selected.includes(level) ? "is-active" : ""} onClick={() => toggle(level)}>{level}</button>)}
  </div>;
}

export function effectiveIntelligence(robot: { intelligence: number; groupIntelligence: number }): number {
  return robot.intelligence > 0 ? robot.intelligence : robot.groupIntelligence;
}

export function statusLabel(value: string): string {
  return statusLabels[value] ?? value ?? "—";
}

export function statusTone(value: string): string {
  if (["enabled", "online", "playing", "seated", "success", "approved", "resolved", "healthy", "configured", "running"].includes(value)) return "ok";
  if (["gray", "draining", "paused", "entering", "pending", "ack", "queued", "risk", "missing", "draft"].includes(value)) return "warn";
  if (["faulted", "offline", "failed", "locked", "banned", "rejected", "open"].includes(value)) return "danger";
  return "muted";
}

export function AutomationBadge({ value, label }: { value: string; label?: string }) {
  return <span className={`automation-badge automation-badge--${statusTone(value)}`}><i />{label ?? statusLabel(value)}</span>;
}

export function LevelBadge({ level }: { level: string }) {
  const tone = level === "P0" ? "danger" : level === "P1" ? "warn" : "muted";
  return <span className={`automation-badge automation-badge--${tone}`}><i />{level}</span>;
}

export function MetricCard({ label, value, note, tone = "cyan", icon }: { label: string; value: ReactNode; note?: ReactNode; tone?: "cyan" | "blue" | "green" | "gold" | "slate"; icon?: string }) {
  return <article className={`metric-card metric-card--${tone}`}>
    <div className="metric-card__top"><span className="metric-card__icon">{icon ?? "◈"}</span></div>
    <p>{label}</p>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </article>;
}

export function Pagination({ page, pageSize, total, hasMore, loading, onPage, onPageSize }: {
  page: number;
  pageSize: number;
  total?: number;
  hasMore?: boolean;
  loading?: boolean;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const totalPages = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  const nextDisabled = loading || (totalPages !== undefined ? page >= totalPages : hasMore === false);
  return <footer className="table-pagination">
    <span>{total === undefined ? `第 ${page} 页 · 每页 ${pageSize} 条` : `共 ${total} 条 · 第 ${page} / ${totalPages} 页`}</span>
    <div>
      {onPageSize && <label>每页<select value={pageSize} disabled={loading} onChange={(event) => onPageSize(Number(event.target.value))}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}
      <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <strong>{totalPages === undefined ? page : `${page} / ${totalPages}`}</strong>
      <button type="button" disabled={nextDisabled} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  </footer>;
}

export function Tabs({ items, value, onChange }: { items: { key: string; label: string; count?: number }[]; value: string; onChange: (key: string) => void }) {
  return <div className="automation-tabs" role="tablist">
    {items.map((item) => <button key={item.key} role="tab" aria-selected={value === item.key} className={value === item.key ? "is-active" : ""} type="button" onClick={() => onChange(item.key)}>{item.label}{item.count !== undefined && <b>{item.count}</b>}</button>)}
  </div>;
}

export function SeatBar({ seated, maxSeats }: { seated: number; maxSeats: number }) {
  const ratio = maxSeats > 0 ? Math.min(100, Math.round((seated / maxSeats) * 100)) : 0;
  return <span className={`automation-seatbar ${ratio >= 100 ? "is-full" : ratio >= 80 ? "is-busy" : ""}`} title={`${seated} / ${maxSeats}`}>
    <i style={{ width: `${ratio}%` }} />
    <em>{seated}/{maxSeats}</em>
  </span>;
}

export function ProgressBar({ value, max, danger, hideValue }: { value: number; max: number; danger?: boolean; hideValue?: boolean }) {
  const ratio = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <span className={`automation-usage ${danger ? "is-danger" : ratio >= 80 ? "is-warn" : ""}`}><span className="automation-usage__track"><i style={{ width: `${ratio}%` }} /></span>{!hideValue && <em>{value}/{max}</em>}</span>;
}

export function useClubOptions() {
  const [clubs, setClubs] = useState<AutomationClubItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ items: AutomationClubItem[] }>("/api/automation/clubs?page=1&pageSize=100")
      .then((data) => { if (!cancelled) setClubs(data.items ?? []); })
      .catch(() => { if (!cancelled) setClubs([]); });
    return () => { cancelled = true; };
  }, []);
  return clubs;
}

export function useAutomationGroups() {
  const [groups, setGroups] = useState<AutomationGroupItem[]>([]);
  const reload = useCallback(() => {
    void api<{ items: AutomationGroupItem[] }>("/api/automation/groups")
      .then((response) => setGroups(response.items ?? []))
      .catch(() => setGroups([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { groups, reload };
}

/** 投放时挑策略用：已发布的排前面，草稿也列出来但会标注状态。 */
export function useAutomationStrategies() {
  const [strategies, setStrategies] = useState<AutomationStrategyItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ items: AutomationStrategyItem[] }>("/api/automation/strategies")
      .then((response) => {
        if (cancelled) return;
        const items = [...(response.items ?? [])].sort((left, right) => {
          const rank = (status: string) => (status === "enabled" ? 0 : status === "gray" ? 1 : status === "disabled" ? 2 : 3);
          return rank(left.status) - rank(right.status) || left.name.localeCompare(right.name, "zh-CN");
        });
        setStrategies(items);
      })
      .catch(() => { if (!cancelled) setStrategies([]); });
    return () => { cancelled = true; };
  }, []);
  return strategies;
}

/** 周计划的一段：weekday 1=周一…7=周日；结束时间不晚于开始时间表示跨到次日。 */
export interface ProfitScheduleEntry {
  weekday: number;
  start: string;
  end: string;
}

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 服务端最多接受 28 段，编辑时提前卡住，免得填完才被拒。 */
const MAX_PROFIT_WINDOWS = 28;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? `周${weekday}`;
}

function clockValid(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** 解析服务端存的 [{weekday,start,end}]；坏了就当没设过，让用户重新勾。 */
export function parseProfitSchedule(raw?: string | null): ProfitScheduleEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const entry = item as Partial<ProfitScheduleEntry>;
      const weekday = Number(entry.weekday);
      const start = String(entry.start ?? "").slice(0, 5);
      const end = String(entry.end ?? "").slice(0, 5);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !clockValid(start) || !clockValid(end)) return [];
      return [{ weekday, start, end }];
    });
  } catch {
    return [];
  }
}

export function profitScheduleText(schedule: ProfitScheduleEntry[]): string {
  if (schedule.length === 0) return "未设置时段";
  return [...schedule]
    .sort((left, right) => left.weekday - right.weekday || left.start.localeCompare(right.start))
    .map((entry) => `${weekdayName(entry.weekday)} ${entry.start}–${entry.end < entry.start ? "次日" : ""}${entry.end}`)
    .join("；");
}

/** 服务端同样的规则先过一遍，返回错误文案；空串表示通过。 */
export function profitScheduleError(schedule: ProfitScheduleEntry[]): string {
  if (schedule.length === 0) return "按周时段跑至少要勾选一个时段";
  if (schedule.length > MAX_PROFIT_WINDOWS) return `周时段最多 ${MAX_PROFIT_WINDOWS} 段，请合并一下`;
  for (const entry of schedule) {
    if (!clockValid(entry.start) || !clockValid(entry.end)) return `${weekdayName(entry.weekday)}有一个时段的时间没填完`;
    if (entry.start === entry.end) return `${weekdayName(entry.weekday)}有一个时段的开始和结束时间相同`;
  }
  return "";
}

/** 周一至周日的时段编辑器：勾选哪天就填哪天的时段，一天可以有多段。 */
export function ProfitScheduleFields({ value, onChange, disabled }: {
  value: ProfitScheduleEntry[];
  onChange: (next: ProfitScheduleEntry[]) => void;
  disabled?: boolean;
}) {
  const setDay = (weekday: number, entries: ProfitScheduleEntry[]) => {
    const rest = value.filter((item) => item.weekday !== weekday);
    onChange([...rest, ...entries].sort((left, right) => left.weekday - right.weekday || left.start.localeCompare(right.start)));
  };
  const updateEntry = (weekday: number, index: number, patch: Partial<ProfitScheduleEntry>) => {
    setDay(weekday, value.filter((item) => item.weekday === weekday).map((entry, position) => position === index ? { ...entry, ...patch } : entry));
  };
  const removeEntry = (weekday: number, index: number) => {
    setDay(weekday, value.filter((item) => item.weekday === weekday).filter((_, position) => position !== index));
  };
  const addEntry = (weekday: number) => {
    const entries = value.filter((item) => item.weekday === weekday);
    const last = entries[entries.length - 1];
    setDay(weekday, [...entries, { weekday, start: last?.start ?? "12:00", end: last?.end ?? "18:00" }]);
  };
  return <div className={`profit-schedule${disabled ? " is-disabled" : ""}`}>
    {WEEKDAY_NAMES.map((name, index) => {
      const weekday = index + 1;
      const entries = value.filter((item) => item.weekday === weekday);
      return <div className={`profit-schedule__day${entries.length > 0 ? " is-on" : ""}`} key={weekday}>
        <label className="profit-schedule__toggle">
          <input type="checkbox" checked={entries.length > 0} disabled={disabled}
            onChange={(event) => setDay(weekday, event.target.checked ? [{ weekday, start: "12:00", end: "18:00" }] : [])} />
          <span>{name}</span>
        </label>
        {entries.length === 0
          ? <small className="profit-schedule__empty">不跑</small>
          : <div className="profit-schedule__rows">
            {entries.map((entry, position) => <div className="profit-schedule__row" key={position}>
              <input type="time" value={entry.start} disabled={disabled} aria-label={`${name}第 ${position + 1} 段开始时间`}
                onChange={(event) => updateEntry(weekday, position, { start: event.target.value })} />
              <span className="profit-schedule__sep">至</span>
              <input type="time" value={entry.end} disabled={disabled} aria-label={`${name}第 ${position + 1} 段结束时间`}
                onChange={(event) => updateEntry(weekday, position, { end: event.target.value })} />
              {entry.end !== "" && entry.start !== "" && entry.end < entry.start && <em className="profit-schedule__cross">次日</em>}
              <button type="button" className="profit-schedule__remove" disabled={disabled} onClick={() => removeEntry(weekday, position)}>删除</button>
            </div>)}
            <button type="button" className="profit-schedule__add" disabled={disabled || value.length >= MAX_PROFIT_WINDOWS} onClick={() => addEntry(weekday)}>+ 加一段</button>
          </div>}
      </div>;
    })}
  </div>;
}

/** 投放/编辑共用的输赢目标输入：周期 + 目标金额（+ 周期日期 / 周计划时段）。 */
export function ProfitTargetFields({ mode, target, periodStart, periodEnd, schedule, onChange, allowInherit = true }: {
  mode: string;
  target: string;
  periodStart: string;
  periodEnd: string;
  schedule: ProfitScheduleEntry[];
  onChange: (patch: { mode?: string; target?: string; periodStart?: string; periodEnd?: string; schedule?: ProfitScheduleEntry[] }) => void;
  allowInherit?: boolean;
}) {
  return <>
    <Field label="输赢目标周期" hint={allowInherit ? "留空表示沿用机器人或分组上已有的设置" : undefined}>
      <select value={mode} onChange={(event) => onChange({ mode: event.target.value })}>
        {allowInherit && <option value="">沿用原有设置</option>}
        <option value="daily">每日总输赢</option>
        <option value="period">周期总输赢</option>
        <option value="schedule">按周时段（周一到周日）</option>
        <option value="none">不限制</option>
      </select>
    </Field>
    <Field label="输赢目标金额" hint={mode === "schedule" ? "每个时段单独累计：时段开始清零，到点或达标就收手" : "正数表示目标盈利，负数表示允许亏损"}>
      <input type="number" disabled={mode === "" || mode === "none"} value={target} onChange={(event) => onChange({ target: event.target.value })} />
    </Field>
    {mode === "period" && <>
      <Field label="周期开始"><input type="date" value={periodStart} onChange={(event) => onChange({ periodStart: event.target.value })} /></Field>
      <Field label="周期结束"><input type="date" value={periodEnd} onChange={(event) => onChange({ periodEnd: event.target.value })} /></Field>
    </>}
    {mode === "schedule" && <div className="automation-form-note--wide">
      <Field as="div" label="每周跑哪些时段" hint="勾选周几再填当天时段，一天可以多段；结束时间早于开始时间表示跨到次日（算在开始那天）。不在时段内会打完手里这一局再让出 Worker。">
        <ProfitScheduleFields value={schedule} onChange={(next) => onChange({ schedule: next })} />
      </Field>
    </div>}
  </>;
}

export function ClubSelect({ clubs, value, onChange, includeAll = true, disabled }: {
  clubs: AutomationClubItem[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  disabled?: boolean;
}) {
  useEffect(() => {
    if (!includeAll && !value && clubs.length > 0) onChange(clubs[0].clubId);
  }, [clubs, includeAll, value, onChange]);
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    {includeAll && <option value="">全部俱乐部</option>}
    {clubs.map((club) => <option key={club.clubId} value={club.clubId}>{club.clubId} · {club.name}</option>)}
  </select>;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

export function timeText(value?: string | null): string {
  return value ? formatDate(value) : "—";
}

export function JsonPreview({ value }: { value: string }) {
  const text = value?.trim();
  if (!text || text === "{}") return <span className="muted">—</span>;
  return <code className="automation-json" title={text}>{text.length > 90 ? `${text.slice(0, 90)}…` : text}</code>;
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <div className="automation-demo-note"><span>DEMO</span><p>{children}</p></div>;
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="form-error"><span>!</span>{message}</div>;
}
