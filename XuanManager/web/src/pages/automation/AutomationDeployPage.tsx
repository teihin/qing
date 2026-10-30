import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import { RobotDeployConfigModal } from "./AutomationRobotModals";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  ProfitTargetFields,
  RoomPiPicker,
  Tabs,
  formatSigned,
  parseProfitSchedule,
  profitModeLabel,
  profitScheduleError,
  profitScheduleText,
  profitTargetText,
  roomPiText,
  statusLabel,
  timeText,
  useAutomationGroups,
  useAutomationStrategies,
  type AutomationPageProps,
  type AutomationRobotItem,
  type ProfitScheduleEntry,
} from "./shared";

interface DeployClubItem {
  clubId: string;
  name: string;
  inviteCode: string;
  status: string;
  robotQuota: number;
  maxPerRoom: number;
  robotCount: number;
  enabledCount: number;
  seatedCount: number;
  groupCount: number;
  joinedCount: number;
  pendingCount: number;
  failedCount: number;
  todayRounds: number;
  todayNet: number;
  since: string | null;
  workerAssigned: number;
  workerWaiting: number;
  workersOnline: number;
}

interface DeployGroupItem {
  id: number;
  name: string;
  strategyName: string;
  defaultIntelligence: number;
  profitMode: string;
  profitTarget: number;
  robotCount: number;
  seatedCount: number;
  todayRounds: number;
  todayNet: number;
}

interface DeployRobotItem {
  id: number;
  terminalNo: string;
  account: string;
  nickname: string;
  avatar: number;
  groupName: string;
  strategyName: string;
  intelligence: number;
  roomId: number | null;
  seatNo: number;
  status: string;
  enabled: boolean;
  joinStatus: string;
  inviteCode: string;
  joinedAt: string | null;
  lastError: string;
  todayRounds: number;
  todayNet: number;
  periodNet: number;
  buyin: number;
  roomPi: string;
  profitSchedule: string;
  scheduleState: string;
  workerId: number | null;
  workerName: string;
  dispatchNote: string;
}

interface DeployDetail {
  club: DeployClubItem;
  groups: DeployGroupItem[];
  robots: DeployRobotItem[];
  strategies: { id: string; name: string; robotCount: number }[];
  history: { sessions: number; rounds: number; net: number; since: string | null; lastActiveAt: string | null };
}

interface DeployLookup {
  clubId: string;
  name: string;
  inviteCode: string;
  status: string;
  robotQuota: number;
  robotCount: number;
  maxPerRoom: number;
  remaining: number;
}

export default function AutomationDeployPage({ can, notify }: AutomationPageProps) {
  const [detailClubId, setDetailClubId] = useState("");
  if (detailClubId) {
    return <DeployClubDetail clubId={detailClubId} can={can} notify={notify} onBack={() => setDetailClubId("")} onOpenClub={setDetailClubId} />;
  }
  return <DeployClubList can={can} notify={notify} onOpen={setDetailClubId} />;
}

function DeployClubList({ can, notify, onOpen }: { can: AutomationPageProps["can"]; notify: AutomationPageProps["notify"]; onOpen: (clubId: string) => void }) {
  const [items, setItems] = useState<DeployClubItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [deploying, setDeploying] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: DeployClubItem[] }>(`/api/automation/deploy/clubs?keyword=${encodeURIComponent(query)}`);
      setItems(response.items ?? []);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "已投放俱乐部加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, notify]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const list = items ?? [];
    return {
      clubs: list.length,
      robots: list.reduce((sum, item) => sum + item.robotCount, 0),
      seated: list.reduce((sum, item) => sum + item.seatedCount, 0),
      net: list.reduce((sum, item) => sum + item.todayNet, 0),
      pending: list.reduce((sum, item) => sum + item.pendingCount + item.failedCount, 0),
      waiting: list.reduce((sum, item) => sum + (item.workerWaiting ?? 0), 0),
    };
  }, [items]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="DEPLOY BY CLUB"
      title="投放管理"
      description="按俱乐部查看已投放的机器人：谁在这个俱乐部、属于哪个组、用什么策略、当前在哪个房间、投放以来的输赢。投放时用邀请码定位俱乐部。"
      actions={<div className="automation-header-actions">
        {can("automation.deploy.manage") && <Button onClick={() => setDeploying(true)}>投放机器人</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>列表只显示已经有机器人的俱乐部；点「查看」进入俱乐部详情。投放时输入俱乐部邀请码，系统会把选中的账号投放到该俱乐部并自动加入。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>已投放俱乐部</span><strong>{totals.clubs}</strong></div>
      <div><span>机器人 / 在房</span><strong>{totals.robots} / {totals.seated}</strong></div>
      <div><span>今日净分合计</span><strong className={totals.net < 0 ? "automation-warn-text" : ""}>{formatSigned(totals.net)}</strong></div>
      <div><span>待加入 / 加入失败</span><strong className={totals.pending > 0 ? "automation-warn-text" : ""}>{totals.pending}</strong></div>
      <div><span>等待分配 Worker</span><strong className={totals.waiting > 0 ? "automation-warn-text" : ""}>{totals.waiting}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索俱乐部 ID、名称或邀请码" />
          <button>搜索</button>
        </form>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!items && loading ? <LoadingBlock label="正在读取已投放俱乐部" /> : !items || items.length === 0 ? <EmptyState title="还没有俱乐部投放机器人" description="点击右上角「投放机器人」，输入俱乐部邀请码后从机器人池里选账号投放。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>俱乐部</th><th>邀请码</th><th>投放数量</th><th>机器人组</th><th>在房</th><th>加入状态</th><th>Worker</th><th>今日</th><th>投放起始</th><th>操作</th></tr></thead>
            <tbody>
              {items.map((club) => <tr key={club.clubId}>
                <td><strong>{club.name}</strong><small className="cell-subtitle">{club.clubId} · {club.status === "enabled" ? "已接入" : "已停用"}</small></td>
                <td>{club.inviteCode || <span className="automation-warn-text">未设置</span>}</td>
                <td>{club.robotCount} / {club.robotQuota || "不限"}<small className="cell-subtitle">启用 {club.enabledCount} 台 · 每房 {club.maxPerRoom} 台</small></td>
                <td>{club.groupCount} 个<small className="cell-subtitle">按组统计</small></td>
                <td>{club.seatedCount} 台<small className="cell-subtitle">共 {club.robotCount} 台</small></td>
                <td>
                  {club.failedCount > 0 ? <span className="automation-warn-text">失败 {club.failedCount}</span> : club.pendingCount > 0 ? <span className="automation-warn-text">待加入 {club.pendingCount}</span> : <span>已加入 {club.joinedCount}</span>}
                  <small className="cell-subtitle">邀请码 {club.inviteCode || "—"}</small>
                </td>
                <td>
                  {(club.workerWaiting ?? 0) > 0
                    ? <span className="automation-warn-text">待分配 {club.workerWaiting}</span>
                    : <span>已分配 {club.workerAssigned ?? 0}</span>}
                  <small className="cell-subtitle">在线节点 {club.workersOnline ?? 0} 个</small>
                </td>
                <td>{club.todayRounds} 局<small className={`cell-subtitle${club.todayNet < 0 ? " automation-warn-text" : ""}`}>{formatSigned(club.todayNet)}</small></td>
                <td>{club.since ? timeText(club.since) : "—"}</td>
                <td><div className="row-actions"><button type="button" onClick={() => onOpen(club.clubId)}>查看</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
    </section>

    {deploying && <DeployRobotModal notify={notify} onClose={() => setDeploying(false)} onDeployed={(message, clubId) => { setDeploying(false); notify(message); onOpen(clubId); void load(true); }} />}
  </div>;
}

function DeployClubDetail({ clubId, can, notify, onBack }: {
  clubId: string;
  can: AutomationPageProps["can"];
  notify: AutomationPageProps["notify"];
  onBack: () => void;
  onOpenClub: (clubId: string) => void;
}) {
  const [data, setData] = useState<DeployDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [releasing, setReleasing] = useState<DeployRobotItem | null>(null);
  const [configuring, setConfiguring] = useState<DeployRobotItem | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<DeployDetail>(`/api/automation/deploy/clubs/${clubId}`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "俱乐部投放详情加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clubId, notify]);

  useEffect(() => { void load(); }, [load]);

  const act = async (robot: DeployRobotItem, action: string) => {
    setBusyId(robot.id);
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/action`, { method: "POST", ...jsonBody({ action }) });
      notify(result.message);
      await load(true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "操作机器人失败", "error");
    } finally {
      setBusyId(null);
    }
  };

  const retryJoin = async (robot: DeployRobotItem) => {
    setBusyId(robot.id);
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/join`, { method: "POST", ...jsonBody({}) });
      notify(result.message);
      await load(true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "加入俱乐部失败", "error");
      await load(true);
    } finally {
      setBusyId(null);
    }
  };

  const dispatchWorkers = async () => {
    setDispatching(true);
    try {
      const result = await api<{ message: string; assigned: number; waiting: number; workersOnline: number }>(
        `/api/automation/deploy/clubs/${clubId}/dispatch`,
        { method: "POST", ...jsonBody({}) },
      );
      notify(result.message, result.waiting > 0 ? "error" : "success");
      await load(true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "分配 Worker 失败", "error");
    } finally {
      setDispatching(false);
    }
  };

  const club = data?.club;
  const canManage = can("automation.deploy.manage") || can("automation.robot.operate");
  const canEditRobot = can("automation.robot.update");

  return <div className="page-stack">
    <PageHeader
      eyebrow={`CLUB ${clubId}`}
      title={club ? `${club.name} · 投放详情` : "俱乐部投放详情"}
      description="这个俱乐部里有哪些机器人、属于哪个组、用什么策略、当前房间和状态，以及投放以来的输赢。"
      actions={<div className="automation-header-actions">
        <Button variant="secondary" onClick={onBack}>返回列表</Button>
        {canManage && club && <Button onClick={() => setDeploying(true)}>投放机器人</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    {error && !data && <section className="panel"><div className="automation-panel-pad"><ErrorBanner message={error} /></div></section>}
    {!data && loading ? <section className="panel"><LoadingBlock label="正在读取俱乐部投放详情" /></section> : data && club && <>
      <section className="automation-mini-stats">
        <div><span>机器人 / 上限</span><strong>{club.robotCount} / {club.robotQuota || "不限"}</strong></div>
        <div><span>启用 / 在房</span><strong>{club.enabledCount} / {club.seatedCount}</strong></div>
        <div><span>今日局数 / 净分</span><strong className={club.todayNet < 0 ? "automation-warn-text" : ""}>{club.todayRounds} / {formatSigned(club.todayNet)}</strong></div>
        <div><span>投放以来</span><strong className={data.history.net < 0 ? "automation-warn-text" : ""}>{data.history.rounds} 局 / {formatSigned(data.history.net)}</strong></div>
        <div><span>Worker 已分配 / 待分配</span><strong className={(club.workerWaiting ?? 0) > 0 ? "automation-warn-text" : ""}>{club.workerAssigned ?? 0} / {club.workerWaiting ?? 0}</strong></div>
      </section>

      {(club.workerWaiting ?? 0) > 0 && <section className="automation-notice">
        <div>
          <strong>还有 {club.workerWaiting} 台机器人没分配到 Worker</strong>
          <p>
            投放只负责把账号放进俱乐部；要真正跑起来还得挂到 Worker 节点上执行。
            {(club.workersOnline ?? 0) > 0
              ? `当前有 ${club.workersOnline} 个在线节点，但剩余容量不够，扩容节点或调低每节点上限后再重新分配。`
              : "当前没有任何在线 Worker 节点，这些机器人会一直停在「等待分配 Worker」。"}
          </p>
        </div>
        {canManage && <Button variant="secondary" disabled={dispatching} onClick={() => void dispatchWorkers()}>{dispatching ? "分配中…" : "重新分配"}</Button>}
      </section>}

      <section className="panel">
        <header className="panel__header"><div><span className="eyebrow">CLUB PROFILE</span><h2>俱乐部与投放配置</h2></div><span>邀请码 {club.inviteCode || "未设置"}</span></header>
        <div className="automation-detail-metrics">
          <div><span>俱乐部 ID</span><strong>{club.clubId}</strong></div>
          <div><span>状态</span><strong className="automation-detail-text"><AutomationBadge value={club.status} /></strong></div>
          <div><span>邀请码</span><strong>{club.inviteCode || "—"}</strong></div>
          <div><span>每房上限</span><strong>{club.maxPerRoom} 台</strong></div>
          <div><span>加入状态</span><strong>{club.failedCount > 0 ? `失败 ${club.failedCount}` : club.pendingCount > 0 ? `待加入 ${club.pendingCount}` : `已加入 ${club.joinedCount}`}</strong></div>
          <div><span>Worker 节点</span><strong className="automation-detail-text">{club.workersOnline} 个在线</strong></div>
          <div><span>首次投放</span><strong>{data.history.since ? timeText(data.history.since) : "—"}</strong></div>
        </div>
        <div className="automation-panel-pad">
          <small className="automation-inline-meta">投放数量、每房上限和邀请码在「俱乐部接入」里修改；这里只读展示。</small>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header"><div><span className="eyebrow">GROUPS &amp; STRATEGIES</span><h2>机器人组与策略</h2></div><span>{data.groups.length} 个组 · {data.strategies.length} 套策略</span></header>
        {data.groups.length === 0 ? <EmptyState title="还没有分组机器人" description="投放时选择分组，或给机器人设置分组后重新投放。" /> : <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>机器人组</th><th>策略</th><th>默认智力</th><th>默认输赢目标</th><th>机器人</th><th>在房</th><th>今日</th></tr></thead>
            <tbody>{data.groups.map((group) => <tr key={group.id}>
              <td><strong>{group.name}</strong><small className="cell-subtitle">#{group.id}</small></td>
              <td>{group.strategyName || "未绑定"}</td>
              <td>{group.defaultIntelligence}</td>
              <td>{profitModeLabel(group.profitMode)} · {profitTargetText(group.profitMode, group.profitTarget, null, null)}</td>
              <td>{group.robotCount} 台</td>
              <td>{group.seatedCount} 台</td>
              <td>{group.todayRounds} 局<small className={`cell-subtitle${group.todayNet < 0 ? " automation-warn-text" : ""}`}>{formatSigned(group.todayNet)}</small></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {data.strategies.length > 0 && <div className="automation-panel-pad"><div className="automation-strategy-chips">
          {data.strategies.map((strategy) => <span key={strategy.id}>{strategy.name} · {strategy.robotCount} 台</span>)}
        </div></div>}
      </section>

      <section className="panel">
        <header className="panel__header"><div><span className="eyebrow">DEPLOYED ROBOTS</span><h2>已投放机器人</h2></div><span>{data.robots.length} 台</span></header>
        {data.robots.length === 0 ? <EmptyState title="这个俱乐部还没有机器人" description="点击右上角「投放机器人」，用邀请码投放。" /> : <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>机器人</th><th>组 / 策略</th><th>智力</th><th>房间 / 座位</th><th>状态</th><th>加入</th><th>Worker</th><th>今日</th><th>周期净分</th><th>操作</th></tr></thead>
            <tbody>{data.robots.map((robot) => <tr key={robot.id}>
              <td><div className="robot-name-cell"><span className="robot-avatar-chip">{robot.avatar}</span><div><button type="button" className="link-button" onClick={() => setConfiguring(robot)}>{robot.nickname || robot.account}</button><small className="cell-subtitle">{robot.account} · {robot.terminalNo}</small></div></div></td>
              <td>{robot.groupName || "未分组"}<small className="cell-subtitle">{robot.strategyName || "未绑定策略"}</small>{robot.profitSchedule && <small className="automation-schedule-cell" title={profitScheduleText(parseProfitSchedule(robot.profitSchedule))}>按周 {profitScheduleText(parseProfitSchedule(robot.profitSchedule))}</small>}</td>
              <td>{robot.intelligence}</td>
              <td>{robot.roomId ?? "—"}<small className="cell-subtitle">{robot.seatNo > 0 ? `${robot.seatNo} 号座` : "未入座"}</small><small className="cell-subtitle">{roomPiText(robot.roomPi)}</small></td>
              <td><AutomationBadge value={robot.status} /> <AutomationBadge value={robot.enabled ? "enabled" : "disabled"} /></td>
              <td><AutomationBadge value={robot.joinStatus} />{robot.lastError && <small className="cell-subtitle automation-warn-text">{robot.lastError}</small>}</td>
              <td>
                {robot.workerName
                  ? <span>{robot.workerName}</span>
                  : <span className={robot.dispatchNote === "等待分配 Worker" ? "automation-warn-text" : ""}>{robot.dispatchNote}</span>}
                {robot.workerName && <small className="cell-subtitle">{robot.dispatchNote}</small>}
              </td>
              <td>{robot.todayRounds} 局<small className={`cell-subtitle${robot.todayNet < 0 ? " automation-warn-text" : ""}`}>{formatSigned(robot.todayNet)}</small></td>
              <td className={robot.periodNet < 0 ? "automation-warn-text" : ""}>{formatSigned(robot.periodNet)}</td>
              <td><div className="row-actions">
                <button type="button" onClick={() => setConfiguring(robot)}>配置 / 日志</button>
                {canManage && (robot.joinStatus !== "joined"
                  ? <button type="button" disabled={busyId === robot.id} onClick={() => void retryJoin(robot)}>{busyId === robot.id ? "加入中…" : "重试加入"}</button>
                  : <button type="button" disabled={busyId === robot.id || robot.roomId !== null} onClick={() => void act(robot, robot.enabled ? "disable" : "enable")}>{robot.enabled ? "停用" : "启用"}</button>)}
                {canManage && <button type="button" className="is-danger" disabled={busyId === robot.id} onClick={() => setReleasing(robot)}>撤回</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </>}

    {deploying && club && <DeployRobotModal fixedClubId={club.clubId} fixedInviteCode={club.inviteCode} notify={notify} onClose={() => setDeploying(false)} onDeployed={(message) => { setDeploying(false); notify(message); void load(true); }} />}
    {configuring && <RobotDeployConfigModal
      robotId={configuring.id}
      label={`${configuring.nickname || configuring.account} · 投放配置与日志`}
      canManage={canEditRobot}
      onClose={() => setConfiguring(null)}
      onSaved={(message) => { setConfiguring(null); notify(message); void load(true); }}
    />}
    {releasing && <ReleaseModal robot={releasing} onClose={() => setReleasing(null)} onDone={(message) => { setReleasing(null); notify(message); void load(true); }} />}
  </div>;
}

function DeployRobotModal({ notify, fixedClubId, fixedInviteCode, onClose, onDeployed }: {
  notify: AutomationPageProps["notify"];
  fixedClubId?: string;
  fixedInviteCode?: string;
  onClose: () => void;
  onDeployed: (message: string, clubId: string) => void;
}) {
  const [inviteCode, setInviteCode] = useState(fixedInviteCode ?? "");
  const [lookup, setLookup] = useState<DeployLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const [tab, setTab] = useState("robots");
  const [pool, setPool] = useState<AutomationRobotItem[] | null>(null);
  const [robotIds, setRobotIds] = useState<number[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [keyword, setKeyword] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [profitMode, setProfitMode] = useState("daily");
  const [profitTarget, setProfitTarget] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [profitSchedule, setProfitSchedule] = useState<ProfitScheduleEntry[]>([]);
  const [roomPi, setRoomPi] = useState("");
  const [configTouched, setConfigTouched] = useState(false);
  const { groups } = useAutomationGroups();
  const strategies = useAutomationStrategies();

  // 策略与输赢目标都是必选项：没手动选就默认用第一个策略 / 每日目标。
  useEffect(() => {
    if (configTouched || strategyId || strategies.length === 0) return;
    setStrategyId(String(strategies[0].id));
  }, [strategies, strategyId, configTouched]);

  // 选中内容只落在一个分组上时（按组选，或按机器人选且都来自同组），用组上的策略和输赢目标当默认值；
  // 用户手动改过之后就不再覆盖。
  const pickedGroup = useMemo(() => {
    const ids = new Set<number>();
    if (tab === "groups") {
      for (const id of groupIds) ids.add(id);
    } else {
      for (const item of pool ?? []) {
        if (item.groupId && robotIds.includes(item.id)) ids.add(item.groupId);
      }
    }
    return ids.size === 1 ? groups.find((group) => group.id === [...ids][0]) : undefined;
  }, [tab, groupIds, pool, robotIds, groups]);

  useEffect(() => {
    if (configTouched || !pickedGroup) return;
    setStrategyId(pickedGroup.strategyId ? String(pickedGroup.strategyId) : (strategies[0] ? String(strategies[0].id) : ""));
  }, [pickedGroup, configTouched, strategies]);

  useEffect(() => {
    if (configTouched || tab !== "groups" || !pickedGroup) return;
    setProfitMode(pickedGroup.profitMode || "daily");
    setProfitTarget(String(pickedGroup.profitTarget ?? 0));
    setPeriodStart(pickedGroup.periodStart ? pickedGroup.periodStart.slice(0, 10) : "");
    setPeriodEnd(pickedGroup.periodEnd ? pickedGroup.periodEnd.slice(0, 10) : "");
  }, [pickedGroup, configTouched, tab]);

  const patchConfig = (patch: { mode?: string; target?: string; periodStart?: string; periodEnd?: string; schedule?: ProfitScheduleEntry[] }) => {
    setConfigTouched(true);
    if (patch.mode !== undefined) setProfitMode(patch.mode);
    if (patch.target !== undefined) setProfitTarget(patch.target);
    if (patch.periodStart !== undefined) setPeriodStart(patch.periodStart);
    if (patch.periodEnd !== undefined) setPeriodEnd(patch.periodEnd);
    if (patch.schedule !== undefined) setProfitSchedule(patch.schedule);
  };

  useEffect(() => {
    const code = inviteCode.trim();
    if (!/^\d{6}$/.test(code)) { setLookup(null); setLookupError(""); return; }
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api<DeployLookup>(`/api/automation/deploy/lookup?inviteCode=${code}`);
        if (!cancelled) { setLookup(result); setLookupError(""); }
      } catch (reason) {
        if (!cancelled) {
          setLookup(null);
          setLookupError(reason instanceof ApiError ? reason.message : "邀请码查询失败");
        }
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [inviteCode]);

  useEffect(() => {
    if (!lookup) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await api<{ items: AutomationRobotItem[] }>("/api/automation/robots?page=1&pageSize=100&assigned=0&enabled=1");
        if (!cancelled) setPool(response.items ?? []);
      } catch {
        if (!cancelled) setPool([]);
      }
    })();
    return () => { cancelled = true; };
  }, [lookup]);

  const poolItems = useMemo(() => pool ?? [], [pool]);
  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return poolItems.filter((item) => {
      if (groupFilter && String(item.groupId ?? "") !== groupFilter) return false;
      if (!text) return true;
      return `${item.account} ${item.nickname} ${item.terminalNo}`.toLowerCase().includes(text);
    });
  }, [poolItems, keyword, groupFilter]);

  const groupPool = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of poolItems) {
      // 未激活的账号投不进去，分组可投放数量只算已经登录过的。
      if (item.groupId && item.activatedAt) counts.set(item.groupId, (counts.get(item.groupId) ?? 0) + 1);
    }
    return counts;
  }, [poolItems]);
  const activatedFiltered = useMemo(() => filtered.filter((item) => Boolean(item.activatedAt)), [filtered]);

  const remaining = lookup && lookup.robotQuota > 0 ? Math.max(0, lookup.robotQuota - lookup.robotCount) : null;
  const selectedCount = tab === "robots" ? robotIds.length : groupIds.reduce((total, id) => total + (groupPool.get(id) ?? 0), 0);
  const overQuota = remaining !== null && selectedCount > remaining;
  const targetClubId = lookup?.clubId ?? fixedClubId ?? "";

  const submit = async () => {
    if (!targetClubId) { setError("请先输入有效的 6 位邀请码"); return; }
    if (selectedCount === 0) { setError("请选择要投放的机器人或分组"); return; }
    if (!strategyId) { setError("请先选择一个策略，还没有策略就去「策略中心」创建"); return; }
    if (!profitMode) { setError("请选择输赢目标"); return; }
    const target = Math.round(Number(profitTarget) || 0);
    if (profitMode === "period" && (!periodStart || !periodEnd)) { setError("按周期设置输赢目标时必须选择开始和结束日期"); return; }
    if (profitMode === "schedule") {
      const scheduleMessage = profitScheduleError(profitSchedule);
      if (scheduleMessage) { setError(scheduleMessage); return; }
    }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string; clubId: string }>("/api/automation/deploy", {
        method: "POST",
        ...jsonBody({
          inviteCode: (lookup?.inviteCode ?? inviteCode).trim(),
          ...(tab === "robots" ? { robotIds } : { groupIds }),
          strategyId: Number(strategyId) || 0,
          profitMode,
          profitTarget: profitMode === "none" ? 0 : target,
          periodStart: profitMode === "period" ? periodStart : "",
          periodEnd: profitMode === "period" ? periodEnd : "",
          profitSchedule: profitMode === "schedule" ? profitSchedule : [],
          roomPi,
        }),
      });
      onDeployed(result.message, result.clubId ?? targetClubId);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "投放机器人失败");
      notify(reason instanceof ApiError ? reason.message : "投放机器人失败", "error");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="投放机器人" eyebrow="DEPLOY ROBOTS" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-form-note automation-form-note--wide">
        输入俱乐部的 6 位邀请码定位俱乐部，选中的机器人会投放到这个俱乐部并自动加入。
      </div>
      <Field label="俱乐部邀请码" hint={fixedInviteCode ? "从俱乐部详情进入时已锁定当前俱乐部" : "6 位数字，可在俱乐部接入里查看"}>
        <input value={inviteCode} maxLength={6} disabled={Boolean(fixedInviteCode)} placeholder="例如 880101" onChange={(event) => setInviteCode(event.target.value.replace(/\D/g, ""))} />
      </Field>

      {looking && <div className="automation-form-note automation-form-note--wide">正在按邀请码查询俱乐部…</div>}
      {lookupError && <div className="automation-form-note automation-form-note--wide automation-warn-text">{lookupError}</div>}
      {lookup && <div className="automation-form-note automation-form-note--wide">
        匹配到 <strong>{lookup.name}</strong>（{lookup.clubId}）：投放数量 {lookup.robotQuota || "不限"} 台，已投放 {lookup.robotCount} 台{remaining !== null ? `，还能投放 ${remaining} 台` : ""}，每房最多 {lookup.maxPerRoom} 台。
      </div>}

      {lookup && <>
        <Tabs value={tab} onChange={setTab} items={[
          { key: "robots", label: "按机器人选择", count: poolItems.length },
          { key: "groups", label: "按分组选择", count: groups.length },
        ]} />

        {tab === "robots" ? <>
          <div className="automation-filter-row">
            <label>分组<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">全部分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <label>搜索<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="账号、昵称或终端编号" /></label>
          </div>
          {pool === null ? <LoadingBlock label="正在读取可投放机器人" /> : filtered.length === 0 ? <EmptyState title="没有可投放的机器人" description="机器人池里没有启用且未投放的账号，请先到机器人管理里创建。" /> : <>
            <div className="automation-form-note automation-form-note--wide">
              <label className="confirm-check"><input type="checkbox" checked={activatedFiltered.length > 0 && activatedFiltered.every((item) => robotIds.includes(item.id))} onChange={() => {
                const all = activatedFiltered.every((item) => robotIds.includes(item.id));
                setRobotIds(all ? robotIds.filter((id) => !activatedFiltered.some((item) => item.id === id)) : [...new Set([...robotIds, ...activatedFiltered.map((item) => item.id)])]);
              }} /><span>全选当前筛选的 {activatedFiltered.length} 台已激活账号</span></label>
              {filtered.length > activatedFiltered.length && <small className="automation-inline-meta">另有 {filtered.length - activatedFiltered.length} 台未激活，等空闲 Worker 自动登录一次后才能投放。</small>}
            </div>
            <div className="table-wrap automation-picker-list">
              <table className="automation-table">
                <thead><tr><th>选择</th><th>账号</th><th>分组</th><th>智力</th><th>状态</th></tr></thead>
                <tbody>{filtered.map((robot) => <tr key={robot.id} className={robot.activatedAt ? undefined : "automation-row-inactive"}>
                  <td><input type="checkbox" disabled={!robot.activatedAt} checked={robotIds.includes(robot.id)} onChange={() => setRobotIds((current) => current.includes(robot.id) ? current.filter((id) => id !== robot.id) : [...current, robot.id])} aria-label={`选择 ${robot.account}`} /></td>
                  <td><strong>{robot.nickname || robot.account}</strong><small className="cell-subtitle">{robot.account} · {robot.terminalNo}</small></td>
                  <td>{robot.groupName || <span className="muted">未分组</span>}</td>
                  <td>{robot.intelligence > 0 ? robot.intelligence : "跟随分组"}</td>
                  <td><AutomationBadge value={robot.status} />{!robot.activatedAt && <small className="cell-subtitle automation-warn-text">未激活 · {robot.activationError || "等 Worker 登录一次"}</small>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <small className="automation-inline-meta">池中最多显示 100 台，可用搜索和分组缩小范围。已选 {robotIds.length} 台。</small>
          </>}
        </> : <>{
          groups.length === 0 ? <EmptyState title="还没有机器人分组" description="请先在机器人管理里给账号设置分组。" /> : <>
            <div className="table-wrap automation-picker-list">
              <table className="automation-table">
                <thead><tr><th>选择</th><th>分组</th><th>默认智力</th><th>可投放</th></tr></thead>
                <tbody>{groups.map((group) => {
                  const available = groupPool.get(group.id) ?? 0;
                  return <tr key={group.id}>
                    <td><input type="checkbox" disabled={available === 0} checked={groupIds.includes(group.id)} onChange={() => setGroupIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])} aria-label={`选择 ${group.name}`} /></td>
                    <td><strong>{group.name}</strong><small className="cell-subtitle">{group.strategyName || "未绑定策略"}</small></td>
                    <td>{group.defaultIntelligence}</td>
                    <td>{available} 台</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <small className="automation-inline-meta">只投放分组里已启用且未投放的账号，已选 {selectedCount} 台。</small>
          </>}
        </>}

        {overQuota && <div className="automation-form-note automation-form-note--wide automation-warn-text">本次选择 {selectedCount} 台，超过剩余投放数量 {remaining} 台，请减少选择。</div>}

        <h3 className="automation-section-title automation-form-note--wide">投放策略、输赢目标与底皮</h3>
        <div className="automation-form-note automation-form-note--wide">
          策略和输赢目标是投放必填项：这里选的会覆盖这批机器人原有的配置；底皮留空表示不限档位。
        </div>
        <div className="automation-form-note--wide">
          <Field label="机器人策略" hint={strategies.length === 0 ? "还没有策略，请先到「策略中心」创建并发布" : "必选；只选中一个分组时会默认带出组策略，可以换成别的"}>
            <select value={strategyId} onChange={(event) => { setConfigTouched(true); setStrategyId(event.target.value); }} disabled={strategies.length === 0}>
              {strategies.length === 0 && <option value="">还没有策略，请先到策略中心创建</option>}
              {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>
                {strategy.name}{strategy.status === "enabled" ? "" : `（${statusLabel(strategy.status)}）`}
              </option>)}
            </select>
          </Field>
        </div>
        <ProfitTargetFields mode={profitMode} target={profitTarget} periodStart={periodStart} periodEnd={periodEnd} schedule={profitSchedule} onChange={patchConfig} allowInherit={false} />
        <div className="automation-form-note--wide">
          <Field as="div" label="只进的底皮档位" hint="选中的机器人只进这些档位的房间；一个都不选表示什么底皮的房间都进">
            <RoomPiPicker value={roomPi} onChange={(next) => { setConfigTouched(true); setRoomPi(next); }} />
          </Field>
        </div>
        <div className="automation-form-note automation-form-note--wide">
          {strategyId
            ? <>本次投放会给机器人绑定策略 <strong>{strategies.find((item) => String(item.id) === strategyId)?.name ?? strategyId}</strong>。</>
            : <>还没有选择策略，请先去「策略中心」创建并发布。</>}
          {profitMode === ""
            ? " 输赢目标沿用原有设置。"
            : profitMode === "none"
              ? " 本次投放不限制输赢目标。"
              : profitMode === "schedule"
                ? ` 每个时段${profitTarget || 0}的目标，跑 ${profitSchedule.length} 段：${profitScheduleText(profitSchedule)}。`
                : ` ${profitModeLabel(profitMode)}目标 ${profitTarget || 0}${profitMode === "period" && periodStart && periodEnd ? `（${periodStart} ~ ${periodEnd}）` : ""}。`}
          {roomPi ? ` 这批机器人只进 ${roomPiText(roomPi)} 的房间。` : " 不限底皮。"}
        </div>

        <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText={`投放 ${selectedCount} 台`} disabled={overQuota || selectedCount === 0 || strategies.length === 0} /></div>
      </>}
    </form>
  </Modal>;
}

function ReleaseModal({ robot, onClose, onDone }: { robot: DeployRobotItem; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/action`, {
        method: "POST",
        ...jsonBody({ action: "release" }),
      });
      onDone(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "撤回投放失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`撤回 ${robot.account}`} eyebrow="RELEASE ROBOT" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>撤回后账号回到机器人池</strong><p>账号会从当前俱乐部移除并停止调度，历史对局和账号配置保留。机器人在房间内时需要先召回。</p></div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认撤回" />
    </form>
  </Modal>;
}
