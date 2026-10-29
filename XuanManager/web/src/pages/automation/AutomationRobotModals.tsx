import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, Field, FormActions, LoadingBlock, Modal } from "../../components/ui";
import { RobotLogList } from "./AutomationRobotLogs";
import { RobotTablePanel } from "./AutomationRobotTable";
import {
  AutomationBadge,
  ErrorBanner,
  ProfitTargetFields,
  RoomPiPicker,
  Tabs,
  formatSigned,
  parseProfitSchedule,
  profitScheduleError,
  profitScheduleText,
  roomPiText,
  useAutomationStrategies,
  type AutomationGroupItem,
  type AutomationRobotItem,
  type ProfitScheduleEntry,
} from "./shared";

interface RobotAddModalProps {
  groups: AutomationGroupItem[];
  canCreateGroup: boolean;
  onGroupCreated: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}

// GroupPicker：分组下拉 + 就地新建分组。新建成功后自动选中，机器人创建/保存时一并带上 groupId。
function GroupPicker({ value, onChange, groups, canCreate, onGroupCreated, hint }: {
  value: string;
  onChange: (groupId: string) => void;
  groups: AutomationGroupItem[];
  canCreate: boolean;
  onGroupCreated: () => void;
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const strategies = useAutomationStrategies();

  const create = async () => {
    const groupName = name.trim();
    if (!groupName) { setError("请填写组名称"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ id: number; message: string }>("/api/automation/groups", {
        method: "POST",
        ...jsonBody({
          name: groupName,
          strategyId: Number(strategyId) || 0,
          // 在座目标/终端上限不参与调度，组里只需要名称和策略。
          targetSeated: 0,
          maxRobots: 0,
          tierPref: "",
          durationPref: "",
          buyinRatio: 0,
          // 组不设输赢目标；none 表示无目标，之后可在自动化组页调整其他参数。
          profitMode: "none",
          profitTarget: 0,
          status: "enabled",
          notes: "",
        }),
      });
      onChange(String(result.id));
      setOpen(false); setName(""); setStrategyId(""); setError("");
      onGroupCreated();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "创建自动化组失败");
    } finally {
      setBusy(false);
    }
  };

  return <div className="group-picker">
    <div className="group-picker__row">
      <Field label="机器人分组" hint={hint}>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">不分组</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </Field>
      {canCreate && <Button type="button" variant="secondary" onClick={() => { setOpen(!open); setError(""); }}>{open ? "收起新建" : "＋ 新建分组"}</Button>}
    </div>
    {open && <div className="automation-form-note" onKeyDown={(event) => {
      // 内联表单在机器人表单里，回车不能冒泡去提交整个机器人表单。
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); void create(); }
    }}>
      <div className="form-grid form-grid--two">
        <Field label="组名称" hint="最多 64 个字符"><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="例如 早班补位组" /></Field>
        <Field label="绑定策略" hint="组内机器人默认用这套策略，投放时可以换"><select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}><option value="">不绑定</option>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}{strategy.status === "enabled" ? "" : strategy.status === "gray" ? "（灰度）" : "（草稿）"}</option>)}</select></Field>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setError(""); }}>取消</Button>
        <Button type="button" disabled={busy} onClick={() => void create()}>{busy ? "创建中…" : "创建并选中"}</Button>
      </div>
    </div>}
  </div>;
}

export function RobotAddModal({ groups, canCreateGroup, onGroupCreated, onClose, onSaved }: RobotAddModalProps) {
  const [prefix, setPrefix] = useState("");
  const [count, setCount] = useState("5");
  const [startNo, setStartNo] = useState("1");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const countValue = Math.max(1, Math.min(50, Number(count) || 1));
  const startValue = Math.max(1, Math.min(999, Number(startNo) || 1));
  const firstAccount = prefix ? `${prefix}${String(startValue).padStart(3, "0")}` : "";
  const lastAccount = prefix ? `${prefix}${String(Math.min(999, startValue + countValue - 1)).padStart(3, "0")}` : "";

  const submit = async () => {
    if (!/^[A-Za-z0-9]{3,13}$/.test(prefix)) { setError("账号前缀必须为 3 到 13 位英文字母或数字"); return; }
    if (password.length < 6 || password.length > 32) { setError("登录密码必须为 6 到 32 个字符"); return; }
    if (password !== passwordConfirm) { setError("两次输入的登录密码不一致"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/automation/robots/bulk", {
        method: "POST",
        ...jsonBody({
          prefix, count: countValue, startNo: startValue, password,
          groupId: Number(groupId) || 0,
          // 智力、带入倍数、启用状态都不在创建时设置：创建即可被调度，具体跑法由策略决定。
          intelligence: 0,
          buyinMultiple: 1,
          enabled: true,
        }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "批量创建机器人失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="批量创建机器人" eyebrow="CREATE ROBOTS" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-form-note automation-form-note--wide">
        会在游戏服真实创建 <strong>{countValue}</strong> 个游戏账号：登录名为「账号前缀 + 三位序号」，昵称和头像随机生成。密码以<strong>密文</strong>保存在后台（游戏服只存 MD5），Worker 拉起客户端时由后台解密后下发。
      </div>
      <Field label="账号前缀" hint="3–13 位英文字母或数字，生成后的登录名为 6–16 位"><input value={prefix} onChange={(event) => setPrefix(event.target.value.trim())} placeholder="例如 star" /></Field>
      <Field label="批量数量" hint="1–50 个"><input type="number" min={1} max={50} value={count} onChange={(event) => setCount(event.target.value)} /></Field>
      <Field label="起始序号" hint="账号会生成 前缀 + 三位序号"><input type="number" min={1} max={999} value={startNo} onChange={(event) => setStartNo(event.target.value)} /></Field>
      <Field label="登录密码" hint="6–32 个字符，密文保存在后台"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <Field label="确认密码"><input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></Field>
      <GroupPicker value={groupId} onChange={setGroupId} groups={groups} canCreate={canCreateGroup} onGroupCreated={onGroupCreated} hint="创建后会加入这个分组，也可以稍后修改" />
      <div className="automation-form-note automation-form-note--wide">
        {firstAccount ? <>将创建 <strong>{firstAccount}</strong>{countValue > 1 ? <> 到 <strong>{lastAccount}</strong></> : null} 共 {countValue} 个账号，创建后到 <strong>投放管理</strong> 选择投放。</> : "填写账号前缀后会显示将创建的登录名。"}
      </div>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText={`创建 ${countValue} 个机器人`} /></div>
    </form>
  </Modal>;
}

interface RobotEditModalProps {
  robot: AutomationRobotItem;
  groups: AutomationGroupItem[];
  canCreateGroup: boolean;
  onGroupCreated: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function RobotEditModal({ robot, groups, canCreateGroup, onGroupCreated, onClose, onSaved }: RobotEditModalProps) {
  const [groupId, setGroupId] = useState(robot.groupId ? String(robot.groupId) : "");
  const [strategyId, setStrategyId] = useState(robot.strategyId ? String(robot.strategyId) : "");
  const [roomPi, setRoomPi] = useState(robot.roomPi ?? "");
  const [egressIp, setEgressIp] = useState(robot.egressIp);
  const [loginPassword, setLoginPassword] = useState("");
  const [enabled, setEnabled] = useState(robot.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const strategies = useAutomationStrategies();

  const submit = async () => {
    setBusy(true); setError("");
    try {
      // 输赢目标不在这里改，原样回传；只有「周期」缺日期时才退回继承，免得后端校验不过。
      const periodStart = robot.periodStart ? robot.periodStart.slice(0, 10) : "";
      const periodEnd = robot.periodEnd ? robot.periodEnd.slice(0, 10) : "";
      const keepProfitMode = robot.profitMode === "period" && (!periodStart || !periodEnd) ? "" : robot.profitMode;
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}`, {
        method: "PUT",
        ...jsonBody({
          nickname: robot.nickname,
          groupId: Number(groupId) || 0,
          strategyId: Number(strategyId) || 0,
          workerId: robot.workerId ?? 0,
          egressIp,
          // 智力和带入倍数不在界面上改，原样回传避免被清零（真正跑法由绑定的策略决定）。
          buyinMultiple: robot.buyinMultiple,
          roomPi,
          intelligence: robot.intelligence,
          profitMode: keepProfitMode,
          profitTarget: robot.profitTarget,
          periodStart,
          periodEnd,
          enabled,
          loginPassword,
        }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存机器人配置失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`编辑 ${robot.account}`} eyebrow={robot.terminalNo} onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="游戏账号" hint="账号绑定后不可修改"><input value={robot.account} disabled /></Field>
      <Field label="游戏昵称" hint="创建时随机生成，与游戏内昵称保持一致"><input value={robot.nickname} disabled /></Field>
      <Field label="游戏头像编号"><input value={`头像 ${robot.avatar}`} disabled /></Field>
      <Field label="当前投放" hint="投放和撤回请到投放管理操作">
        <input value={robot.clubId ? `${robot.clubName || robot.clubId}（${robot.inviteCode || "无邀请码"}）` : "未投放"} disabled />
      </Field>
      <GroupPicker value={groupId} onChange={setGroupId} groups={groups} canCreate={canCreateGroup} onGroupCreated={onGroupCreated} hint="保存后按新分组调度，可随时改回不分组" />
      <Field label="绑定策略" hint="策略里的运行参数会覆盖机器人自身配置；不绑定就用自己的设置">
        <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
          <option value="">不绑定策略</option>
          {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}{strategy.status === "enabled" ? "" : strategy.status === "gray" ? "（灰度）" : "（草稿）"}</option>)}
        </select>
      </Field>
      <div className="automation-form-note--wide">
        <Field as="div" label="只进的底皮档位" hint="不选表示什么底皮的房间都进；修改后需要重新拉起终端才生效">
          <RoomPiPicker value={roomPi} onChange={setRoomPi} />
        </Field>
      </div>
      <Field label="登录密码" hint={robot.passwordSet ? "已保存；留空表示不修改，填写会同时重置游戏登录密码" : "这台账号还没有保存登录密码，填写后 Worker 才能登录"}>
        <input type="password" autoComplete="new-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder={robot.passwordSet ? "留空不修改" : "6–32 位"} />
      </Field>
      <Field label="出口 IP" hint="留空表示由 Worker 自动分配"><input value={egressIp} onChange={(event) => setEgressIp(event.target.value)} /></Field>
      <Field label="启用状态" hint={robot.roomId !== null ? "机器人在房间内时不能停用" : undefined}>
        <label className="confirm-check"><input type="checkbox" checked={enabled} disabled={robot.roomId !== null} onChange={(event) => setEnabled(event.target.checked)} /><span>启用后投放的账号可参与调度</span></label>
      </Field>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText="保存配置" /></div>
    </form>
  </Modal>;
}

export function RobotDeleteModal({ robot, onClose, onDeleted }: { robot: AutomationRobotItem; onClose: () => void; onDeleted: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}`, { method: "DELETE", ...jsonBody({ confirm }) });
      onDeleted(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "删除机器人账号失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`删除 ${robot.account}`} eyebrow="DELETE ROBOT" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>只删除后台机器人记录</strong><p>{robot.clubId ? "该机器人当前已投放，删除后会同时从俱乐部移除。" : "该机器人尚未投放。"}如果正在房间内，会先结束当前对局并释放座位；历史对局和审计记录会保留。游戏账号本身仍保留在游戏服，需要另行处理。</p></div>
      <label className="confirm-check"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /><span>我确认删除机器人 {robot.account}（{robot.terminalNo}）</span></label>
      <FormActions onCancel={onClose} busy={busy} submitText="删除机器人" />
    </form>
  </Modal>;
}

export function RobotReleaseModal({ robot, onClose, onReleased }: { robot: AutomationRobotItem; onClose: () => void; onReleased: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}/action`, {
        method: "POST",
        ...jsonBody({ action: "release" }),
      });
      onReleased(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "撤回投放失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`撤回 ${robot.account}`} eyebrow="RELEASE ROBOT" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>撤回后账号保留在机器人池</strong><p>账号会从俱乐部 {robot.clubName || robot.clubId} 移除并停止调度，历史对局和账号配置不受影响。机器人在房间内时需要先召回。</p></div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认撤回" />
    </form>
  </Modal>;
}

export function RobotQuickToggle({ robot, busy, onToggle }: { robot: AutomationRobotItem; busy: boolean; onToggle: () => void }) {
  if (robot.enabled) {
    return <Button variant="secondary" disabled={busy || robot.roomId !== null} onClick={onToggle}>{busy ? "处理中…" : "停用"}</Button>;
  }
  return <Button variant="secondary" disabled={busy} onClick={onToggle}>{busy ? "处理中…" : "启用"}</Button>;
}

// RobotDeployConfigModal 是投放之后改机器人的入口：只动「输赢目标 + 只进底皮」，
// 其余账号资料原样回传，避免保存时把分组、密码等配置清掉；右边标签页直接看这台机器人的运行日志。
export function RobotDeployConfigModal({ robotId, label, canManage, onClose, onSaved }: {
  robotId: number;
  label: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [robot, setRobot] = useState<AutomationRobotItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("config");
  const [profitMode, setProfitMode] = useState("");
  const [profitTarget, setProfitTarget] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [profitSchedule, setProfitSchedule] = useState<ProfitScheduleEntry[]>([]);
  const [roomPi, setRoomPi] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api<{ robot: AutomationRobotItem }>(`/api/automation/robots/${robotId}`);
      const next = response.robot;
      setRobot(next);
      setProfitMode(next.profitMode ?? "");
      setProfitTarget(String(next.profitTarget ?? 0));
      setPeriodStart(next.periodStart ? next.periodStart.slice(0, 10) : "");
      setPeriodEnd(next.periodEnd ? next.periodEnd.slice(0, 10) : "");
      setProfitSchedule(parseProfitSchedule(next.profitSchedule));
      setRoomPi(next.roomPi ?? "");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "读取投放配置失败");
    } finally {
      setLoading(false);
    }
  }, [robotId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!robot) return;
    if (profitMode === "period" && (!periodStart || !periodEnd)) { setError("按周期设置输赢目标时必须选择开始和结束日期"); return; }
    if (profitMode === "schedule") {
      const scheduleMessage = profitScheduleError(profitSchedule);
      if (scheduleMessage) { setError(scheduleMessage); return; }
    }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/robots/${robot.id}`, {
        method: "PUT",
        ...jsonBody({
          nickname: robot.nickname,
          groupId: robot.groupId ?? 0,
          strategyId: robot.strategyId ?? 0,
          workerId: robot.workerId ?? 0,
          egressIp: robot.egressIp,
          buyinMultiple: robot.buyinMultiple,
          roomPi,
          intelligence: robot.intelligence,
          profitMode,
          profitTarget: profitMode === "none" ? 0 : Math.round(Number(profitTarget) || 0),
          periodStart: profitMode === "period" ? periodStart : "",
          periodEnd: profitMode === "period" ? periodEnd : "",
          profitSchedule: profitMode === "schedule" ? profitSchedule : [],
          enabled: robot.enabled,
          // 留空表示不改登录密码。
          loginPassword: "",
        }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存投放配置失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={label} eyebrow="ROBOT DEPLOY" onClose={onClose} wide>
    <Tabs value={tab} onChange={setTab} items={[{ key: "config", label: "投放配置" }, { key: "table", label: "当前牌局" }, { key: "logs", label: "运行日志" }]} />
    {tab === "table" ? <RobotTablePanel robotId={robotId} /> : tab === "logs" ? <div className="automation-worker-stream"><RobotLogList robotId={robotId} /></div> : <>
      {loading ? <LoadingBlock label="正在读取投放配置" /> : !robot ? <ErrorBanner message={error} /> : <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <ErrorBanner message={error} />
        <Field label="机器人">
          <div className="automation-detail-text"><AutomationBadge value={robot.status} /> {robot.nickname || robot.account} · {robot.terminalNo}</div>
        </Field>
        <Field label="当前俱乐部" hint={robot.roomId !== null ? `正在房间 ${robot.roomId}${robot.seatNo > 0 ? ` · ${robot.seatNo} 号座` : ""}` : undefined}>
          <input value={robot.clubId ? `${robot.clubName || robot.clubId}（${robot.inviteCode || "无邀请码"}）` : "未投放"} disabled />
        </Field>
        <ProfitTargetFields mode={profitMode} target={profitTarget} periodStart={periodStart} periodEnd={periodEnd} schedule={profitSchedule} onChange={(patch) => {
          if (patch.mode !== undefined) setProfitMode(patch.mode);
          if (patch.target !== undefined) setProfitTarget(patch.target);
          if (patch.periodStart !== undefined) setPeriodStart(patch.periodStart);
          if (patch.periodEnd !== undefined) setPeriodEnd(patch.periodEnd);
          if (patch.schedule !== undefined) setProfitSchedule(patch.schedule);
        }} />
        <div className="automation-form-note--wide">
          <Field as="div" label="只进的底皮档位" hint={`现在是 ${roomPiText(roomPi)}；改完要从节点详情重新拉起这台终端才生效`}>
            <RoomPiPicker value={roomPi} onChange={setRoomPi} disabled={!canManage} />
          </Field>
        </div>
        {profitMode === "schedule" && <div className="automation-form-note automation-form-note--wide">
          本时段已累计 <strong>{formatSigned(robot.windowNet)}</strong>；换时段会清零重算。
          {robot.scheduleState === "released" ? " 当前不在时段内，已让出 Worker，到点自动上机。" : ""}
          {robot.profitSchedule ? ` 现在保存的是：${profitScheduleText(parseProfitSchedule(robot.profitSchedule))}。` : ""}
        </div>}
        <div className="automation-form-note automation-form-note--wide">
          输赢目标不选周期表示沿用机器人或分组上已有的设置；底皮一个都不选表示什么档位的房间都进。
        </div>
        <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText="保存投放配置" disabled={!canManage} /></div>
      </form>}
    </>}
  </Modal>;
}
