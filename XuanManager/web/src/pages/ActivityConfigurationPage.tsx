import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import type { ActivityConfigurationState, ActivityItemState, ActivityPowerState } from "../types";

const cloneState = (value: ActivityConfigurationState) => structuredClone(value);

export default function ActivityConfigurationPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<ActivityConfigurationState | null>(null);
  const [draft, setDraft] = useState<ActivityConfigurationState | null>(null);
  const [selectedCode, setSelectedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<ActivityConfigurationState>("/api/configuration/activities");
      setOriginal(result); setDraft(cloneState(result)); setSelectedCode((current) => current || result.activities[0]?.code || ""); setConfirmed(false);
    } catch (reason) { notify(reason instanceof ApiError ? reason.message : "活动配置加载失败", "error"); } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  const selectedIndex = draft?.activities.findIndex((item) => item.code === selectedCode) ?? -1;
  const selected = selectedIndex >= 0 ? draft?.activities[selectedIndex] : undefined;
  const dirty = Boolean(original && draft && JSON.stringify(stripActivityMeta(original)) !== JSON.stringify(stripActivityMeta(draft)));
  const changes = useMemo(() => countActivityChanges(original, draft), [original, draft]);
  const updateActivity = (patch: Partial<ActivityItemState>) => setDraft((current) => {
    if (!current) return current;
    const next = cloneState(current); const index = next.activities.findIndex((item) => item.code === selectedCode);
    if (index >= 0) next.activities[index] = { ...next.activities[index], ...patch };
    return next;
  });
  const updatePower = (key: keyof ActivityPowerState, value: string) => setDraft((current) => current ? { ...current, handRankPower: { ...current.handRankPower, [key]: value } } : current);
  const save = async () => {
    if (!draft || !original) return;
    setBusy(true);
    try {
      const result = await api<ActivityConfigurationState>("/api/configuration/activities", { method: "PUT", ...jsonBody({ ...stripActivityMeta(draft), revision: original.revision, confirm: confirmed }) });
      setOriginal(result); setDraft(cloneState(result)); setConfirmed(false); notify("活动开关和配置已保存并完成游戏服务回读校验");
    } catch (reason) { notify(reason instanceof ApiError ? reason.message : "活动配置保存失败", "error"); } finally { setBusy(false); }
  };
  if (loading && !draft) return <div className="panel"><LoadingBlock label="正在读取活动配置" /></div>;
  if (!draft || !original) return <EmptyState title="活动配置无法显示" description="请稍后刷新页面重试。" />;
  const activeCount = draft.activities.filter((item) => item.enabled).length;
  return <div className="page-stack activity-page">
    <PageHeader eyebrow="LIVE OPS CAMPAIGNS" title="活动管理" description="用可读的时间、奖励和展示规则管理客户端排行榜活动，后台自动映射旧版内部配置字段。" actions={<Button variant="secondary" onClick={() => void load()}>重新读取</Button>} />
    <section className={`activity-master-switch ${draft.enabled ? "is-on" : ""}`}><div><span className="activity-master-icon">活</span><div><strong>游戏活动总开关</strong><p>{draft.enabled ? `活动入口已开放，当前发布 ${activeCount} 个活动` : "所有活动入口已关闭；单项配置可继续编辑，开启总开关后生效"}</p></div></div><label className="switch-control switch-control--large"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span /><strong>{draft.enabled ? "已开启" : "已关闭"}</strong></label></section>
    <section className="activity-workspace">
      <aside className="panel activity-list-nav"><header><h2>活动列表</h2><p>选择活动后在右侧完成配置</p></header>{draft.activities.map((activity) => <button type="button" key={activity.code} className={selectedCode === activity.code ? "is-active" : ""} onClick={() => setSelectedCode(activity.code)}><span>{activity.name.slice(0, 1)}</span><div><strong>{activity.name}</strong><small>{activity.enabled ? `${activity.startDate || "待定"} 至 ${activity.endDate || "待定"}` : "未发布"}</small></div><i className={activity.enabled ? "is-on" : ""} /></button>)}</aside>
      {selected && <div className="activity-editor-stack"><section className="panel activity-editor"><header className="configuration-card-heading"><div><span className="eyebrow">CAMPAIGN SETTINGS</span><h2>{selected.name}</h2><p>按顺序填写发布状态、活动时间、榜单奖励和玩家说明。</p></div><label className="switch-control"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateActivity({ enabled: event.target.checked })} /><span /><strong>{selected.enabled ? "发布此活动" : "暂不发布"}</strong></label></header><div className="activity-step"><header><span>1</span><div><h3>活动时间</h3><p>启用单项活动时，开始和结束日期时间必须完整且结束晚于开始。</p></div></header><div className="activity-time-grid"><Field label="开始日期"><input type="date" value={selected.startDate} onChange={(event) => updateActivity({ startDate: event.target.value })} /></Field><Field label="开始时间"><input type="time" value={normalizeTimeInput(selected.startTime)} onChange={(event) => updateActivity({ startTime: event.target.value })} /></Field><Field label="结束日期"><input type="date" value={selected.endDate} onChange={(event) => updateActivity({ endDate: event.target.value })} /></Field><Field label="结束时间"><input type="time" value={normalizeTimeInput(selected.endTime)} onChange={(event) => updateActivity({ endTime: event.target.value })} /></Field></div></div><div className="activity-step"><header><span>2</span><div><h3>榜单与奖励</h3><p>奖励规则仍按当前游戏服务格式保存；展示名次决定客户端拉取和显示范围。</p></div></header><div className="two-column-fields"><Field label="展示名次"><input type="number" min="1" max="10000" value={selected.rankLimit} onChange={(event) => updateActivity({ rankLimit: Number(event.target.value) })} /></Field><label className="switch-row compact"><div><strong>允许玩家领取</strong><small>关闭后客户端只能查看榜单</small></div><input type="checkbox" checked={selected.allowClaim} onChange={(event) => updateActivity({ allowClaim: event.target.checked })} /></label></div><Field label="奖励规则" hint="保持与现有游戏活动奖励格式一致"><textarea rows={5} value={selected.rewardRule} onChange={(event) => updateActivity({ rewardRule: event.target.value })} placeholder="填写各名次对应奖励" /></Field></div><div className="activity-step"><header><span>3</span><div><h3>玩家端说明</h3><p>这是玩家打开该活动时直接看到的说明，建议写清活动条件、结算时间和领取方式。</p></div></header><Field label="活动说明"><textarea rows={8} value={selected.playerText} onChange={(event) => updateActivity({ playerText: event.target.value })} placeholder="请输入清晰易懂的活动说明" /></Field><div className="player-copy-preview"><span>玩家端预览</span><strong>{selected.name}</strong><p>{selected.playerText || "尚未填写活动说明"}</p><small>{selected.enabled ? `${selected.startDate} ${selected.startTime} 至 ${selected.endDate} ${selected.endTime}` : "该活动暂未发布"}</small></div></div></section>
        {selected.code === "hand-rank" && <section className="panel activity-power-panel"><header className="configuration-card-heading"><div><span className="eyebrow">ROOM MULTIPLIER</span><h2>不同底皮房间手数倍率</h2><p>用于玩家手数榜换算，按客户端固定 1P、2P、5P、10P、20P 顺序保存。</p></div></header><div className="activity-power-grid"><Field label="1P 倍率"><input type="number" min="0" step="0.01" value={draft.handRankPower.one} onChange={(event) => updatePower("one", event.target.value)} /></Field><Field label="2P 倍率"><input type="number" min="0" step="0.01" value={draft.handRankPower.two} onChange={(event) => updatePower("two", event.target.value)} /></Field><Field label="5P 倍率"><input type="number" min="0" step="0.01" value={draft.handRankPower.five} onChange={(event) => updatePower("five", event.target.value)} /></Field><Field label="10P 倍率"><input type="number" min="0" step="0.01" value={draft.handRankPower.ten} onChange={(event) => updatePower("ten", event.target.value)} /></Field><Field label="20P 倍率"><input type="number" min="0" step="0.01" value={draft.handRankPower.twenty} onChange={(event) => updatePower("twenty", event.target.value)} /></Field></div></section>}
      </div>}
    </section>
    <section className={`configuration-savebar ${dirty ? "is-dirty" : ""}`}><div><strong>{dirty ? `共有 ${changes} 个配置区域发生变化` : "当前内容与游戏配置一致"}</strong><p>保存时会逐项写入旧游戏服务；任何一步失败都会尝试恢复已修改参数。</p></div><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!dirty} /><span>我已核对总开关、时间、奖励与玩家说明</span></label><Button variant="secondary" disabled={!dirty || busy} onClick={() => { setDraft(cloneState(original)); setConfirmed(false); }}>放弃修改</Button><Button disabled={!dirty || !confirmed || busy || !can("configuration.activity.update")} onClick={() => void save()}>{busy ? "正在保存并回读…" : "保存全部活动配置"}</Button></section>
  </div>;
}

function normalizeTimeInput(value: string) { return value.length >= 5 ? value.slice(0, 5) : value; }
function stripActivityMeta(state: ActivityConfigurationState) { return { enabled: state.enabled, activities: state.activities, handRankPower: state.handRankPower }; }
function countActivityChanges(before: ActivityConfigurationState | null, after: ActivityConfigurationState | null) {
  if (!before || !after) return 0;
  let count = before.enabled === after.enabled ? 0 : 1;
  after.activities.forEach((item, index) => { if (JSON.stringify(item) !== JSON.stringify(before.activities[index])) count++; });
  if (JSON.stringify(before.handRankPower) !== JSON.stringify(after.handRankPower)) count++;
  return count;
}
