import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import { GroupManagerModal } from "./AutomationGroupModals";
import { RobotAddModal, RobotDeleteModal, RobotEditModal, RobotQuickToggle } from "./AutomationRobotModals";
import { RobotLogList } from "./AutomationRobotLogs";
import { RobotTablePanel } from "./AutomationRobotTable";
import {
  AutomationBadge,
  ClubSelect,
  DemoNote,
  ErrorBanner,
  Pagination,
  Tabs,
  effectiveIntelligence,
  endReasonLabel,
  formatMoney,
  formatSigned,
  roomPiText,
  statusLabel,
  timeText,
  useAutomationGroups,
  useClubOptions,
  type AutomationNotify,
  type AutomationPageProps,
  type AutomationRobotItem,
  type AutomationSessionItem,
} from "./shared";

interface RobotListResponse { items: AutomationRobotItem[]; page: number; pageSize: number; total: number }
interface RobotDetailResponse {
  robot: AutomationRobotItem;
  strategyConfig: string;
  sessions: AutomationSessionItem[];
  logs: { action: string; message: string; operator: string; createdAt: string }[];
}

const robotStatuses = ["created", "idle", "entering", "seated", "playing", "paused", "draining", "stopped", "faulted", "offline"];

// 点开机器人先看当前牌局，其他信息在标签里切换。
const runningStatuses = ["entering", "seated", "playing"];

const actionLabels: Record<string, string> = {
  start: "启动",
  pause: "暂停",
  drain: "排空",
  stop: "停止",
  restart: "重启",
  enable: "启用",
  disable: "停用",
};

interface BatchActionOption {
  value: string;
  label: string;
  hint: string;
}

const batchActions: BatchActionOption[] = [
  { value: "enable", label: "批量启用", hint: "启用后投放过的账号可以继续参与调度。" },
  { value: "disable", label: "批量停用", hint: "停用会先把在房机器人送出房间，再退出调度。" },
  { value: "drain", label: "批量排空", hint: "打完当前一局再离座离房，避免中途退局。" },
  { value: "stop", label: "批量停止", hint: "立即结束对局并停止终端，会中断正在进行的一局。" },
  { value: "restart", label: "批量重启", hint: "只重启连接，不改变配置和房间归属。" },
];

interface BatchItemResult { id: number; terminalNo: string; ok: boolean; message: string }
interface BatchResponse {
  results?: BatchItemResult[];
  succeeded?: number;
  failed?: number;
  approvalRequired?: boolean;
  approvalId?: number;
  message?: string;
}

interface BatchImpact { count: number; inRoom: number; disabled: number; clubs: number }

function desiredStatusLabel(value: string): string {
  const labels: Record<string, string> = { running: "运行中", paused: "已暂停", stopped: "已停止" };
  return labels[value] ?? statusLabel(value);
}

function availableActions(robot: AutomationRobotItem): string[] {
  const actions: string[] = [];
  if (!robot.enabled) return actions;
  if (["created", "idle", "stopped", "offline", "faulted", "paused"].includes(robot.status)) actions.push("start");
  if (["entering", "seated", "playing", "idle"].includes(robot.status)) actions.push("pause");
  if (robot.roomId !== null) actions.push("drain");
  if (robot.status !== "stopped") actions.push("stop");
  actions.push("restart");
  return actions;
}

export default function AutomationRobotsPage({ can, notify }: AutomationPageProps) {
  const clubs = useClubOptions();
  const [data, setData] = useState<RobotListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [clubId, setClubId] = useState("");
  const { groups, reload: reloadGroups } = useAutomationGroups();
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [assigned, setAssigned] = useState("");
  const [enabled, setEnabled] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AutomationRobotItem | null>(null);
  const [deleting, setDeleting] = useState<AutomationRobotItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState<BatchActionOption | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResponse | null>(null);
  const [managingGroups, setManagingGroups] = useState(false);

  const canCreate = can("automation.robot.create");
  const canUpdate = can("automation.robot.update");
  const canDelete = can("automation.robot.delete");
  const canOperate = can("automation.robot.operate");

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(targetSize), keyword: query, clubId, status, enabled, assigned });
      if (groupId) params.set("groupId", groupId);
      const response = await api<RobotListResponse>(`/api/automation/robots?${params.toString()}`);
      setData(response);
      const visible = new Set(response.items.map((item) => item.id));
      setSelectedIds((current) => current.filter((id) => visible.has(id)));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "机器人加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, clubId, groupId, status, enabled, assigned, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);

  // 分组被删掉后，筛选条件还指着它会让列表一直空；分组列表还在时清掉这个筛选。
  useEffect(() => {
    if (!groupId || groups.length === 0) return;
    if (!groups.some((group) => String(group.id) === groupId)) setGroupId("");
  }, [groups, groupId]);

  const pageItems = useMemo(() => data?.items ?? [], [data]);
  const stats = useMemo(() => ({
    unassigned: pageItems.filter((item) => !item.clubId).length,
    seated: pageItems.filter((item) => item.roomId !== null).length,
    assigned: pageItems.filter((item) => Boolean(item.clubId)).length,
    faulted: pageItems.filter((item) => item.status === "faulted").length,
  }), [pageItems]);

  const openDetail = (robot: AutomationRobotItem) => {
    setDetailId(robot.id);
    setDetailTab("table");
  };

  const toggleRobot = async (robot: AutomationRobotItem) => {
    setTogglingId(robot.id); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/action`, {
        method: "POST",
        ...jsonBody({ action: robot.enabled ? "disable" : "enable" }),
      });
      notify(result.message);
      await load(page, pageSize, true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "操作机器人失败", "error");
    } finally {
      setTogglingId(null);
    }
  };

  const activateRobot = async (robot: AutomationRobotItem) => {
    setActivatingId(robot.id); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/action`, {
        method: "POST",
        ...jsonBody({ action: "activate" }),
      });
      notify(result.message);
      await load(page, pageSize, true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "排队激活失败", "error");
    } finally {
      setActivatingId(null);
    }
  };

  const selectedRobots = useMemo(() => pageItems.filter((item) => selectedIds.includes(item.id)), [pageItems, selectedIds]);
  const impact = useMemo<BatchImpact>(() => ({
    count: selectedRobots.length,
    inRoom: selectedRobots.filter((item) => item.roomId !== null).length,
    disabled: selectedRobots.filter((item) => !item.enabled).length,
    clubs: new Set(selectedRobots.map((item) => item.clubId).filter(Boolean)).size,
  }), [selectedRobots]);
  const allSelected = pageItems.length > 0 && pageItems.every((item) => selectedIds.includes(item.id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : pageItems.map((item) => item.id));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const runBatch = async (action: BatchActionOption, reason: string) => {
    const result = await api<BatchResponse>("/api/automation/robots/batch", {
      method: "POST",
      ...jsonBody({ ids: selectedIds, action: action.value, reason }),
    });
    setBatchAction(null);
    setBatchResult(result);
    if (!result.approvalRequired) {
      setSelectedIds([]);
      await load(page, pageSize, true);
    }
  };

  return <div className="page-stack">
    <PageHeader
      eyebrow="ROBOT FLEET"
      title="机器人管理"
      description="机器人就是游戏账号：在这里批量创建、改智力、分组、停用和删除；投放和撤回请到投放管理操作。"
      actions={<div className="automation-header-actions">
        {canCreate && <Button onClick={() => setAdding(true)}>批量创建机器人</Button>}
        {can("automation.group.view") && <Button variant="secondary" onClick={() => setManagingGroups(true)}>分组管理</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>批量创建会在游戏服真实开户，昵称和头像随机生成，密码只交给游戏服保存；智力 0 表示跟随分组默认值，创建后可以单独修改。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>总机器人</span><strong>{data?.total ?? 0}</strong></div>
      <div><span>本页未投放</span><strong>{stats.unassigned}</strong></div>
      <div><span>本页在房</span><strong>{stats.seated}</strong></div>
      <div><span>本页已投放 / 故障</span><strong>{stats.assigned} / {stats.faulted}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索账号、昵称、终端编号或房间号" />
          <button>搜索</button>
        </form>
        <div className="automation-filter-row">
          <label>俱乐部<ClubSelect clubs={clubs} value={clubId} onChange={(value) => { setPage(1); setClubId(value); }} /></label>
          <label>分组<select value={groupId} onChange={(event) => { setPage(1); setGroupId(event.target.value); }}><option value="">全部分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label>投放<select value={assigned} onChange={(event) => { setPage(1); setAssigned(event.target.value); }}><option value="">全部</option><option value="0">未投放</option><option value="1">已投放</option></select></label>
          <label>启用<select value={enabled} onChange={(event) => { setPage(1); setEnabled(event.target.value); }}><option value="">全部</option><option value="1">已启用</option><option value="0">已停用</option></select></label>
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部状态</option>{robotStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {canOperate && selectedIds.length > 0 && <div className="automation-batch-bar">
        <strong>已选 {impact.count} 台</strong>
        <span>在房 {impact.inRoom} 台 · 已停用 {impact.disabled} 台 · 涉及 {impact.clubs} 个俱乐部</span>
        <div>
          {batchActions.map((action) => <button key={action.value} type="button" className="button button--secondary button--sm" onClick={() => setBatchAction(action)}>{action.label.replace("批量", "")}</button>)}
          <button type="button" className="button button--ghost button--sm" onClick={() => setSelectedIds([])}>清空选择</button>
        </div>
      </div>}
      {!data && loading ? <LoadingBlock label="正在读取机器人" /> : !data || pageItems.length === 0 ? <EmptyState title="没有匹配的机器人" description="调整筛选条件，或点击右上角「批量创建机器人」在游戏服开户。" /> : <>
        <div className="table-wrap">
          <table className="automation-table automation-table--robots">
            <thead><tr>
              {canOperate && <th className="automation-select-cell"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="全选本页机器人" /></th>}
              <th>机器人</th><th>俱乐部 / 分组</th><th>智力</th><th>加入状态</th><th>状态 / 启用</th><th>房间 / 今日</th><th>心跳</th><th>操作</th>
            </tr></thead>
            <tbody>
              {pageItems.map((robot) => <tr key={robot.id} className={[robot.riskFlag ? "is-risk" : "", robot.activatedAt ? "" : "automation-row-inactive"].filter(Boolean).join(" ")}>
                {canOperate && <td className="automation-select-cell"><input type="checkbox" checked={selectedIds.includes(robot.id)} onChange={() => toggleSelect(robot.id)} aria-label={`选择 ${robot.account}`} /></td>}
                <td><div className="robot-name-cell"><span className="robot-avatar-chip">{robot.avatar}</span><div><button type="button" className="link-button" onClick={() => openDetail(robot)}>{robot.nickname || robot.account}</button><small className="cell-subtitle">{robot.account} · {robot.terminalNo}</small></div></div></td>
                <td>{robot.clubName || robot.clubId}<small className="cell-subtitle">{robot.groupName || "未分组"}</small></td>
                <td>{effectiveIntelligence(robot)}<small className="cell-subtitle">{robot.intelligence > 0 ? "单独设置" : "跟随分组"}</small></td>
                <td><AutomationBadge value={robot.joinStatus} /><small className="cell-subtitle">邀请码 {robot.inviteCode || "—"}</small></td>
                <td><AutomationBadge value={robot.status} /> <AutomationBadge value={robot.enabled ? "enabled" : "disabled"} />{!robot.activatedAt && <AutomationBadge value="pending" label="未激活" />}{robot.riskFlag && <small className="automation-risk-text">风控标记</small>}{!robot.activatedAt && <small className="cell-subtitle automation-warn-text">{robot.activationError || "账号还没登录过，等空闲 Worker 自动激活"}</small>}</td>
                <td>{robot.roomId ?? "—"}<small className="cell-subtitle">{robot.seatNo > 0 ? `${robot.seatNo} 号座` : "未入座"} · {robot.todayRounds} 局 / {formatSigned(robot.todayNet)}</small></td>
                <td>{timeText(robot.lastHeartbeat)}{robot.lastError && <small className="cell-subtitle automation-warn-text">{robot.lastError}</small>}</td>
                <td><div className="row-actions">
                  <button type="button" onClick={() => openDetail(robot)}>{runningStatuses.includes(robot.status) ? "牌局" : "详情"}</button>
                  {canUpdate && <button type="button" onClick={() => setEditing(robot)}>编辑</button>}
                  {canOperate && robot.enabled && !robot.activatedAt && <button type="button" disabled={activatingId === robot.id} onClick={() => void activateRobot(robot)}>{activatingId === robot.id ? "排队中…" : "激活"}</button>}
                  {canOperate && <RobotQuickToggle robot={robot} busy={togglingId === robot.id} onToggle={() => void toggleRobot(robot)} />}
                  {canDelete && <button type="button" className="is-danger" onClick={() => setDeleting(robot)}>删除</button>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>

    {batchAction && <BatchConfirmModal action={batchAction} impact={impact} onClose={() => setBatchAction(null)} onSubmit={runBatch} />}
    {batchResult && <BatchResultModal result={batchResult} onClose={() => setBatchResult(null)} />}
    {detailId !== null && <RobotDetailModal robotId={detailId} initialTab={detailTab} canOperate={canOperate} notify={notify} onClose={() => setDetailId(null)} onChanged={() => load(page, pageSize, true)} />}
    {adding && <RobotAddModal groups={groups} canCreateGroup={can("automation.group.create")} onGroupCreated={reloadGroups} onClose={() => setAdding(false)} onSaved={(message) => { setAdding(false); notify(message); void load(page, pageSize, true); }} />}
    {managingGroups && <GroupManagerModal
      groups={groups}
      canCreate={can("automation.group.create")}
      canUpdate={can("automation.group.update")}
      canDelete={can("automation.group.delete")}
      notify={notify}
      onClose={() => setManagingGroups(false)}
      onChanged={() => { reloadGroups(); void load(page, pageSize, true); }}
    />}
    {editing && <RobotEditModal robot={editing} groups={groups} canCreateGroup={can("automation.group.create")} onGroupCreated={reloadGroups} onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); notify(message); void load(page, pageSize, true); }} />}
    {deleting && <RobotDeleteModal robot={deleting} onClose={() => setDeleting(null)} onDeleted={(message) => { setDeleting(null); notify(message); void load(page, pageSize, true); }} />}
  </div>;
}

function RobotDetailModal({ robotId, initialTab, canOperate, notify, onClose, onChanged }: {
  robotId: number;
  initialTab: string;
  canOperate: boolean;
  notify: AutomationNotify;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<RobotDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setData(await api<RobotDetailResponse>(`/api/automation/robots/${robotId}`));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "机器人详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [robotId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: string) => {
    setBusy(action); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robotId}/action`, { method: "POST", ...jsonBody({ action }) });
      notify(result.message);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "机器人操作失败");
    } finally {
      setBusy("");
    }
  };

  const robot = data?.robot;

  return <Modal title={robot ? `${robot.nickname || robot.account} · ${robot.terminalNo}` : `机器人 #${robotId}`} eyebrow="ROBOT DETAIL" onClose={onClose} wide>
    {loading ? <LoadingBlock label="正在读取机器人详情" /> : error && !robot ? <ErrorBanner message={error} /> : robot && <>
      <ErrorBanner message={error} />
      <div className="automation-detail-metrics">
        <div><span>状态</span><strong className="automation-detail-text"><AutomationBadge value={robot.status} /></strong></div>
        <div><span>启用</span><strong className="automation-detail-text"><AutomationBadge value={robot.enabled ? "enabled" : "disabled"} /></strong></div>
        <div><span>智力</span><strong>{effectiveIntelligence(robot)}</strong></div>
        <div><span>今日净分</span><strong className={robot.todayNet < 0 ? "automation-warn-text" : ""}>{formatSigned(robot.todayNet)}</strong></div>
        <div><span>房间 / 座位</span><strong>{robot.roomId ?? "—"} / {robot.seatNo || "—"}</strong></div>
      </div>

      {canOperate && <div className="automation-detail-actions">
        <Button variant={robot.enabled ? "secondary" : "primary"} disabled={Boolean(busy) || (!robot.enabled && robot.joinStatus !== "joined") || (robot.enabled && robot.roomId !== null)} onClick={() => void act(robot.enabled ? "disable" : "enable")}>{robot.enabled ? "停用" : "启用"}</Button>
        {robot.enabled && !robot.activatedAt && <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void act("activate")}>{busy === "activate" ? "排队中…" : "激活账号"}</Button>}
        {availableActions(robot).map((action) => <Button key={action} variant={action === "stop" ? "danger" : action === "drain" ? "secondary" : "primary"} disabled={Boolean(busy)} onClick={() => void act(action)}>{busy === action ? "执行中…" : actionLabels[action]}</Button>)}
      </div>}

      <Tabs value={tab} onChange={setTab} items={[
        { key: "table", label: "当前牌局" },
        { key: "overview", label: "机器人信息" },
        { key: "runtime", label: "运行日志" },
        { key: "sessions", label: "对局记录", count: data?.sessions.length },
        { key: "logs", label: "操作日志", count: data?.logs.length },
      ]} />

      {tab === "table" && <RobotTablePanel robotId={robotId} />}

      {tab === "overview" && <div className="automation-detail-grid">
        <dl>
          <div><dt>游戏账号</dt><dd>{robot.account}</dd></div>
          <div><dt>终端编号</dt><dd>{robot.terminalNo}</dd></div>
          <div><dt>游戏头像</dt><dd>头像 {robot.avatar}</dd></div>
          <div><dt>俱乐部</dt><dd>{robot.clubName || robot.clubId}</dd></div>
          <div><dt>分组</dt><dd>{robot.groupName || "未分组"}</dd></div>
          <div><dt>加入状态</dt><dd>{statusLabel(robot.joinStatus)} · {robot.inviteCode || "—"}</dd></div>
          <div><dt>加入时间</dt><dd>{timeText(robot.joinedAt)}</dd></div>
          <div><dt>账号激活</dt><dd className={robot.activatedAt ? "" : "automation-warn-text"}>{robot.activatedAt ? timeText(robot.activatedAt) : robot.activationError || "未激活，等空闲 Worker 自动登录一次"}</dd></div>
          <div><dt>智力</dt><dd>{effectiveIntelligence(robot)}（{robot.intelligence > 0 ? "单独设置" : "跟随分组"}）</dd></div>
          <div><dt>周期净分</dt><dd className={robot.periodNet < 0 ? "automation-warn-text" : ""}>{formatSigned(robot.periodNet)}</dd></div>
          <div><dt>默认带入</dt><dd>{robot.buyinMultiple} 倍房间最低带入</dd></div>
          <div><dt>只进底皮</dt><dd>{roomPiText(robot.roomPi)}</dd></div>
          <div><dt>上报 GPS</dt><dd>{robot.gps || "未生成"}</dd></div>
          <div><dt>公网 IP</dt><dd>{robot.publicIp ? `${robot.publicIp} · ${timeText(robot.ipSeenAt)}` : "尚未上报"}</dd></div>
          <div><dt>登记出口 IP</dt><dd>{robot.egressIp || "未指定"}</dd></div>
          <div><dt>登录密码</dt><dd>{robot.passwordSet ? `已配置 · ${timeText(robot.passwordUpdatedAt)}` : "未配置（Worker 无法登录）"}</dd></div>
          <div><dt>当前带入 / 余额</dt><dd>{formatMoney(robot.buyin)} / {formatMoney(robot.balance)}</dd></div>
          <div><dt>期望状态</dt><dd>{desiredStatusLabel(robot.desiredStatus)}</dd></div>
          <div><dt>最近心跳</dt><dd>{timeText(robot.lastHeartbeat)}</dd></div>
          <div><dt>最近错误</dt><dd className={robot.lastError ? "automation-warn-text" : ""}>{robot.lastError || "—"}</dd></div>
          <div><dt>风控标记</dt><dd>{robot.riskFlag ? "是" : "否"}</dd></div>
        </dl>
        <div className="automation-config-card">
          <h4>当前策略参数</h4>
          <pre>{formatConfig(data?.strategyConfig)}</pre>
        </div>
      </div>}

      {tab === "runtime" && <div className="automation-worker-stream"><RobotLogList robotId={robotId} /></div>}

      {tab === "sessions" && (data?.sessions.length === 0 ? <EmptyState title="还没有对局记录" description="机器人进房并开局后，这里会显示每次会话的局数、带入和净分。" /> : <div className="table-wrap">
        <table className="automation-table">
          <thead><tr><th>开始</th><th>结束</th><th>房间 / 座位</th><th>局数</th><th>带入</th><th>净分</th><th>结束原因</th></tr></thead>
          <tbody>{data?.sessions.map((session) => <tr key={session.id}>
            <td>{timeText(session.startedAt)}</td>
            <td>{session.endedAt ? timeText(session.endedAt) : <span className="automation-badge automation-badge--ok"><i />进行中</span>}</td>
            <td>{session.roomId} / {session.seatNo}</td>
            <td>{session.rounds}</td>
            <td>{formatMoney(session.buyin)}</td>
            <td className={session.netWin < 0 ? "automation-warn-text" : ""}>{formatSigned(session.netWin)}</td>
            <td>{session.endReason ? endReasonLabel(session.endReason) : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>)}

      {tab === "logs" && (data?.logs.length === 0 ? <EmptyState title="还没有操作日志" description="对机器人的创建、编辑、启停和进房都会记录在审计日志中。" /> : <ol className="automation-timeline">
        {data?.logs.map((log, index) => <li key={`${log.createdAt}-${index}`}>
          <span className="automation-timeline__dot" />
          <div><strong>{log.message || log.action}</strong><p><code>{log.action}</code> · {log.operator || "系统"} · {timeText(log.createdAt)}</p></div>
        </li>)}
      </ol>)}
    </>}
  </Modal>;
}

function formatConfig(value?: string): string {
  if (!value) return "该机器人未绑定策略。";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function BatchConfirmModal({ action, impact, onClose, onSubmit }: {
  action: BatchActionOption;
  impact: BatchImpact;
  onClose: () => void;
  onSubmit: (action: BatchActionOption, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsReason = (action.value === "stop" || action.value === "drain") && impact.count > 10;

  const submit = async () => {
    if (needsReason && reason.trim() === "") {
      setError("批量停止或排空超过 10 台需要填写操作原因，审批人需要了解处理背景");
      return;
    }
    setBusy(true); setError("");
    try {
      await onSubmit(action, reason.trim());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : `${action.label}失败`);
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={action.label} eyebrow="BATCH OPERATION" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-form-note automation-form-note--wide">{action.hint}</div>
      <div className="automation-detail-metrics">
        <div><span>影响终端</span><strong>{impact.count} 台</strong></div>
        <div><span>在房终端</span><strong>{impact.inRoom} 台</strong></div>
        <div><span>已停用</span><strong>{impact.disabled} 台</strong></div>
        <div><span>涉及俱乐部</span><strong>{impact.clubs} 个</strong></div>
      </div>
      {impact.inRoom > 0 && <div className="operation-warning"><strong>有 {impact.inRoom} 台终端在房间内</strong><p>排空会打完当前一局再离座；停止和停用会立即结束对局并释放座位，可能留下未结算的一局。</p></div>}
      {needsReason && <div className="automation-form-note automation-form-note--wide automation-warn-text">本次批量操作超过 10 台，需要填写原因并转审批单，由另一名管理员批准后才会执行。</div>}
      <Field label={needsReason ? "操作原因（必填）" : "操作原因（选填）"} hint="会写入操作审计，便于事后追查">
        <textarea value={reason} maxLength={200} rows={3} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <FormActions onCancel={onClose} busy={busy} submitText={needsReason ? "提交审批" : `确认${action.label.replace("批量", "")}`} disabled={impact.count === 0} />
    </form>
  </Modal>;
}

function BatchResultModal({ result, onClose }: { result: BatchResponse; onClose: () => void }) {
  const items = result.results ?? [];
  return <Modal title="批量操作结果" eyebrow="BATCH RESULT" onClose={onClose} wide>
    {result.approvalRequired ? <div className="operation-warning">
      <strong>已转为审批单 #{result.approvalId}</strong>
      <p>{result.message || "批量操作超过 10 台，需要第二名管理员在任务中心审批后才会执行。"}</p>
    </div> : <>
      <div className="automation-detail-metrics">
        <div><span>成功</span><strong>{result.succeeded ?? 0} 台</strong></div>
        <div><span>失败</span><strong className={(result.failed ?? 0) > 0 ? "automation-warn-text" : ""}>{result.failed ?? 0} 台</strong></div>
        <div><span>合计</span><strong>{items.length} 台</strong></div>
      </div>
      <div className="table-wrap automation-picker-list">
        <table className="automation-table">
          <thead><tr><th>终端</th><th>结果</th><th>说明</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td>{item.terminalNo || `#${item.id}`}</td>
            <td>{item.ok ? <span className="automation-badge automation-badge--ok"><i />成功</span> : <span className="automation-badge automation-badge--warn"><i />失败</span>}</td>
            <td>{item.message || "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <div className="automation-panel-footer"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
  </Modal>;
}

