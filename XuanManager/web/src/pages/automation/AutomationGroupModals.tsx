import { useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, Modal } from "../../components/ui";
import {
  AutomationBadge,
  ErrorBanner,
  useAutomationStrategies,
  type AutomationGroupItem,
  type AutomationNotify,
  type AutomationStrategyItem,
} from "./shared";

// 分组在机器人管理里就地维护：分组本身只承载「名称 + 默认策略 + 成员归属」，
// 在座目标、终端上限、房间偏好这些字段不参与调度，编辑时原样带回避免被清掉。
function groupPayload(group: AutomationGroupItem | null, name: string, strategyId: string) {
  const profitMode = group && ["daily", "period"].includes(group.profitMode)
    && (group.profitMode !== "period" || (group.periodStart && group.periodEnd))
    ? group.profitMode
    : "none";
  return {
    name: name.trim(),
    clubId: group?.clubId ?? "",
    strategyId: Number(strategyId) || 0,
    targetSeated: group?.targetSeated ?? 0,
    maxRobots: group?.maxRobots ?? 0,
    tierPref: group?.tierPref ?? "",
    durationPref: group?.durationPref ?? "",
    buyinRatio: group?.buyinRatio ?? 0,
    defaultIntelligence: group?.defaultIntelligence ?? 0,
    profitMode,
    profitTarget: profitMode === "none" ? 0 : group?.profitTarget ?? 0,
    periodStart: profitMode === "period" && group?.periodStart ? group.periodStart.slice(0, 10) : "",
    periodEnd: profitMode === "period" && group?.periodEnd ? group.periodEnd.slice(0, 10) : "",
    status: group?.status ?? "enabled",
    notes: group?.notes ?? "",
  };
}

function strategyLabel(strategy: AutomationStrategyItem) {
  if (strategy.status === "enabled") return strategy.name;
  return `${strategy.name}（${strategy.status === "gray" ? "灰度" : "草稿"}）`;
}

function GroupEditor({ group, strategies, onCancel, onSaved }: {
  group: AutomationGroupItem | null;
  strategies: AutomationStrategyItem[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [strategyId, setStrategyId] = useState(group?.strategyId ? String(group.strategyId) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim()) { setError("请填写组名称"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(group ? `/api/automation/groups/${group.id}` : "/api/automation/groups", {
        method: group ? "PUT" : "POST",
        ...jsonBody(groupPayload(group, name, strategyId)),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存分组失败");
    } finally {
      setBusy(false);
    }
  };

  return <form className="group-manager__editor form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <ErrorBanner message={error} />
    <Field label="组名称" hint="最多 64 个字符"><input value={name} maxLength={64} autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如 早班补位组" /></Field>
    <Field label="绑定策略" hint="组内机器人默认用这套策略，投放时可以换">
      <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
        <option value="">不绑定</option>
        {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategyLabel(strategy)}</option>)}
      </select>
    </Field>
    <div className="automation-form-actions-wide"><FormActions onCancel={onCancel} busy={busy} submitText={group ? "保存分组" : "创建分组"} /></div>
  </form>;
}

function GroupDeletePanel({ group, groups, onCancel, onDeleted }: {
  group: AutomationGroupItem;
  groups: AutomationGroupItem[];
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const [moveTo, setMoveTo] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = groups.filter((item) => item.id !== group.id);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const query = group.robotCount > 0 ? `?moveToGroupId=${Number(moveTo) || 0}` : "";
      const result = await api<{ message: string }>(`/api/automation/groups/${group.id}${query}`, { method: "DELETE" });
      onDeleted(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "删除分组失败");
    } finally {
      setBusy(false);
    }
  };

  return <form className="group-manager__editor form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <ErrorBanner message={error} />
    {group.robotCount > 0
      ? <div className="operation-warning"><strong>「{group.name}」里还有 {group.robotCount} 台机器人</strong><p>删除前先给它们找个去处：可以移到其他分组，或改成不分组。搬完后这个组就空了，随即删除。</p></div>
      : <div className="operation-warning"><strong>删除「{group.name}」</strong><p>组内没有机器人，删除后不可恢复；机器人本身、投放和战绩都不受影响。</p></div>}
    {group.robotCount > 0 && <Field label="组内机器人移到" hint={others.length === 0 ? "没有其他分组，只能改为不分组" : "搬完后这个组就空了，随即删除"}>
      <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
        <option value="0">不分组</option>
        {others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </Field>}
    <FormActions onCancel={onCancel} busy={busy} submitText={group.robotCount > 0 ? "移动并删除" : "确认删除"} />
  </form>;
}

export function GroupManagerModal({ groups, canCreate, canUpdate, canDelete, notify, onClose, onChanged }: {
  groups: AutomationGroupItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  notify: AutomationNotify;
  onClose: () => void;
  onChanged: () => void;
}) {
  const strategies = useAutomationStrategies();
  const [draft, setDraft] = useState<{ group: AutomationGroupItem | null } | null>(null);
  const [deleting, setDeleting] = useState<AutomationGroupItem | null>(null);

  const saved = (message: string) => {
    setDraft(null);
    setDeleting(null);
    notify(message);
    onChanged();
  };

  return <Modal title="分组管理" eyebrow="ROBOT GROUPS" onClose={onClose} wide>
    <div className="group-manager">
      <div className="group-manager__bar">
        <p className="automation-form-note">分组决定机器人归属和默认策略：组内机器人投放时默认用组策略，投放时还能换；删除分组前要把组内机器人移到其他组或不分组。</p>
        {canCreate && !draft && <Button onClick={() => { setDeleting(null); setDraft({ group: null }); }}>新建分组</Button>}
      </div>

      {draft && <GroupEditor group={draft.group} strategies={strategies} onCancel={() => setDraft(null)} onSaved={saved} />}
      {deleting && <GroupDeletePanel group={deleting} groups={groups} onCancel={() => setDeleting(null)} onDeleted={saved} />}

      {groups.length === 0
        ? <EmptyState title="还没有分组" description="分组用来把机器人编在一起并共用一套默认策略；不建组也能正常投放。" />
        : <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>分组</th><th>默认策略</th><th>机器人</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{groups.map((group) => <tr key={group.id}>
              <td><strong>{group.name}</strong><small className="cell-subtitle">#{group.id}</small></td>
              <td>{group.strategyName || <span className="muted">未绑定</span>}</td>
              <td>{group.robotCount} 台<small className="cell-subtitle">在座 {group.seatedCount} 台</small></td>
              <td><AutomationBadge value={group.status} /></td>
              <td><div className="row-actions">
                {canUpdate && <button type="button" onClick={() => { setDeleting(null); setDraft({ group }); }}>编辑</button>}
                {canDelete && <button type="button" className="is-danger" onClick={() => { setDraft(null); setDeleting(group); }}>删除</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
  </Modal>;
}
