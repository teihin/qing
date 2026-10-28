import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  ClubSelect,
  DemoNote,
  ErrorBanner,
  ProgressBar,
  timeText,
  useClubOptions,
  type AutomationGroupItem,
  type AutomationPageProps,
  type AutomationStrategyItem,
} from "./shared";

export default function AutomationGroupsPage({ can, notify }: AutomationPageProps) {
  const clubs = useClubOptions();
  const [items, setItems] = useState<AutomationGroupItem[] | null>(null);
  const [strategies, setStrategies] = useState<AutomationStrategyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clubId, setClubId] = useState("");
  const [editing, setEditing] = useState<AutomationGroupItem | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<AutomationGroupItem | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: AutomationGroupItem[] }>(`/api/automation/groups${clubId ? `?clubId=${clubId}` : ""}`);
      setItems(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "自动化组加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clubId, notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api<{ items: AutomationStrategyItem[] }>("/api/automation/strategies").then((response) => setStrategies(response.items)).catch(() => setStrategies([]));
  }, []);

  const stats = useMemo(() => {
    const list = items ?? [];
    return {
      groups: list.length,
      enabled: list.filter((item) => item.status === "enabled").length,
      target: list.reduce((sum, item) => sum + item.targetSeated, 0),
      seated: list.reduce((sum, item) => sum + item.seatedCount, 0),
      robots: list.reduce((sum, item) => sum + item.robotCount, 0),
    };
  }, [items]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="AUTOMATION GROUP"
      title="自动化组"
      description="按俱乐部把终端编成组，设置目标在座、终端上限、策略和房间偏好，调度器会按组自动补位。"
      actions={<div className="automation-header-actions">
        {can("automation.group.create") && <Button onClick={() => setEditing(null)}>新建自动化组</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>组只约束后台调度，不会修改游戏内俱乐部设置；删除前必须先把组内终端移到其他组或取消分组。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>自动化组</span><strong>{stats.groups} <em>/ {stats.enabled} 启用</em></strong></div>
      <div><span>目标在座</span><strong>{stats.target}</strong></div>
      <div><span>当前在座</span><strong>{stats.seated}</strong></div>
      <div><span>组内终端</span><strong>{stats.robots}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <div className="automation-filter-row">
          <label>俱乐部<ClubSelect clubs={clubs} value={clubId} onChange={setClubId} /></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!items && loading ? <LoadingBlock label="正在读取自动化组" /> : !items || items.length === 0 ? <EmptyState title="还没有自动化组" description="创建组并绑定策略后，组内终端会按目标在座自动补位。" /> : <div className="table-wrap">
        <table className="automation-table">
          <thead><tr><th>组名</th><th>俱乐部</th><th>策略</th><th>目标 / 上限</th><th>终端与在座</th><th>房间偏好</th><th>带入比例</th><th>状态</th><th>更新</th><th>操作</th></tr></thead>
          <tbody>{items.map((group) => <tr key={group.id}>
            <td><strong>{group.name}</strong><small className="cell-subtitle">#{group.id} · {group.notes || "无备注"}</small></td>
            <td>{group.clubName || "—"}<small className="cell-subtitle">{group.clubId}</small></td>
            <td>{group.strategyName || <span className="muted">未绑定</span>}</td>
            <td>{group.targetSeated} / {group.maxRobots}<small className="cell-subtitle">目标在座 / 终端上限</small></td>
            <td><ProgressBar value={group.robotCount} max={Math.max(group.maxRobots, group.robotCount, 1)} /><small className="cell-subtitle">在座 {group.seatedCount} 台</small></td>
            <td>{group.tierPref ? `${group.tierPref} 档` : "不限档位"}<small className="cell-subtitle">{group.durationPref || "不限局时"}</small></td>
            <td>{group.buyinRatio}%<small className="cell-subtitle">{group.buyinRatio > 0 ? "终端带入比例上限" : "不限制"}</small></td>
            <td><AutomationBadge value={group.status} /></td>
            <td>{timeText(group.updatedAt)}</td>
            <td><div className="row-actions">
              {can("automation.group.update") && <button type="button" onClick={() => setEditing(group)}>编辑</button>}
              {can("automation.group.delete") && <button type="button" className="is-danger" onClick={() => setDeleting(group)}>删除</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    {editing !== undefined && <GroupFormModal group={editing} clubs={clubs} strategies={strategies} onClose={() => setEditing(undefined)} onSaved={(message) => { setEditing(undefined); notify(message); void load(true); }} />}
    {deleting && <DeleteGroupModal group={deleting} onClose={() => setDeleting(null)} onDeleted={(message) => { setDeleting(null); notify(message); void load(true); }} />}
  </div>;
}

function GroupFormModal({ group, clubs, strategies, onClose, onSaved }: {
  group: AutomationGroupItem | null;
  clubs: ReturnType<typeof useClubOptions>;
  strategies: AutomationStrategyItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [clubId, setClubId] = useState(group?.clubId ?? "");
  const [strategyId, setStrategyId] = useState(group?.strategyId ? String(group.strategyId) : "");
  const [targetSeated, setTargetSeated] = useState(String(group?.targetSeated ?? 4));
  const [maxRobots, setMaxRobots] = useState(String(group?.maxRobots ?? 6));
  const [tierPref, setTierPref] = useState(group?.tierPref ?? "");
  const [durationPref, setDurationPref] = useState(group?.durationPref ?? "");
  const [buyinRatio, setBuyinRatio] = useState(String(group?.buyinRatio ?? 0));
  const [status, setStatus] = useState(group?.status ?? "enabled");
  const [notes, setNotes] = useState(group?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(group ? `/api/automation/groups/${group.id}` : "/api/automation/groups", {
        method: group ? "PUT" : "POST",
        ...jsonBody({
          name,
          clubId,
          strategyId: Number(strategyId) || 0,
          targetSeated: Number(targetSeated),
          maxRobots: Number(maxRobots),
          tierPref: tierPref.trim(),
          durationPref: durationPref.trim(),
          buyinRatio: Number(buyinRatio),
          status,
          notes,
        }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存自动化组失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={group ? `编辑 ${group.name}` : "新建自动化组"} eyebrow="AUTOMATION GROUP" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="组名称" hint="最多 64 个字符"><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="所属俱乐部"><ClubSelect clubs={clubs} value={clubId} includeAll={false} onChange={(value) => { setClubId(value); }} /></Field>
      <Field label="绑定策略"><select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}><option value="">不绑定</option>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name} · v{strategy.version}</option>)}</select></Field>
      <Field label="组状态"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="enabled">已启用</option><option value="disabled">已停用</option></select></Field>
      <Field label="目标在座" hint="0–500，调度器维持的在座终端数"><input type="number" min={0} max={500} value={targetSeated} onChange={(event) => setTargetSeated(event.target.value)} /></Field>
      <Field label="终端上限" hint="0–500，组内最多分配的终端数"><input type="number" min={0} max={500} value={maxRobots} onChange={(event) => setMaxRobots(event.target.value)} /></Field>
      <Field label="档位偏好" hint="例如 1,2,3；留空表示不限"><input value={tierPref} onChange={(event) => setTierPref(event.target.value)} placeholder="1,2,3" /></Field>
      <Field label="局时偏好" hint="例如 15,30；留空表示不限"><input value={durationPref} onChange={(event) => setDurationPref(event.target.value)} placeholder="15,30" /></Field>
      <Field label="带入比例（%）" hint="0–100，按终端带入控制上限，0 表示不限制"><input type="number" min={0} max={100} value={buyinRatio} onChange={(event) => setBuyinRatio(event.target.value)} /></Field>
      <Field label="备注" hint="最多 120 个字符"><input value={notes} maxLength={120} onChange={(event) => setNotes(event.target.value)} /></Field>
      <div className="automation-form-note automation-form-note--wide">终端只能绑定与自己俱乐部一致的组；修改目标在座后，调度器会按新目标补位或排空。</div>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText={group ? "保存自动化组" : "创建自动化组"} /></div>
    </form>
  </Modal>;
}

function DeleteGroupModal({ group, onClose, onDeleted }: { group: AutomationGroupItem; onClose: () => void; onDeleted: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/groups/${group.id}`, { method: "DELETE" });
      onDeleted(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "删除自动化组失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`删除 ${group.name}`} eyebrow="DELETE GROUP" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>组内还有 {group.robotCount} 台终端</strong><p>如果组内仍有终端，服务端会拒绝删除。请先在终端页面把这些终端移到其他组或改为不分组。</p></div>
      <div className="automation-detail-metrics">
        <div><span>目标在座</span><strong>{group.targetSeated}</strong></div>
        <div><span>终端上限</span><strong>{group.maxRobots}</strong></div>
        <div><span>带入比例</span><strong>{group.buyinRatio}%</strong></div>
      </div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认删除" />
    </form>
  </Modal>;
}
