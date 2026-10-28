import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  timeText,
  type AutomationPageProps,
  type AutomationStrategyConfig,
  type AutomationStrategyItem,
} from "./shared";

const tierOptions = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const styleLabels: Record<string, string> = { conservative: "保守", balanced: "均衡", aggressive: "激进" };

const emptyConfig: AutomationStrategyConfig = {
  followCap: 3,
  raiseRule: "仅在大牌或位置有利时加注",
  cheEnabled: false,
  maxLossPerRound: 2000,
  maxDrawdown: 20000,
  lossStreakPause: 3,
  maxRoundsPerDay: 200,
  restSeconds: 30,
  tiers: ["1", "2", "3"],
};

export default function AutomationStrategiesPage({ can, notify }: AutomationPageProps) {
  const [items, setItems] = useState<AutomationStrategyItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AutomationStrategyItem | null | undefined>(undefined);
  const [publishing, setPublishing] = useState<AutomationStrategyItem | null>(null);
  const [rollingBack, setRollingBack] = useState<AutomationStrategyItem | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: AutomationStrategyItem[] }>("/api/automation/strategies");
      setItems(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "策略列表加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="PLAY STRATEGY"
      title="策略中心"
      description="维护打牌策略草稿、发布灰度和全量版本，并支持回滚到上一版本。策略变更不会影响已经开始的牌局。"
      actions={<div className="automation-header-actions">
        {can("automation.strategy.create") && <Button onClick={() => setEditing(null)}>新建策略</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>策略参数为演示默认值，正式接入前需要和游戏客户端的历史策略对齐，并由运营确认灰度和回滚口径。</DemoNote>

    {error && <ErrorBanner message={error} />}
    {!items && loading ? <LoadingBlock label="正在读取策略" /> : !items || items.length === 0 ? <section className="panel"><EmptyState title="还没有策略" description="先创建一个策略草稿，再绑定到自动化组。" /></section> : <div className="automation-card-grid">
      {items.map((strategy) => <article key={strategy.id} className="automation-strategy-card">
        <header>
          <div><span>{strategy.code}</span><h2>{strategy.name}</h2></div>
          <AutomationBadge value={strategy.status} />
        </header>
        <div className="automation-strategy-meta">
          <span>v{strategy.version}</span>
          <span>{styleLabels[strategy.playStyle] ?? strategy.playStyle}</span>
          <span>{strategy.groupCount} 个组使用</span>
          {strategy.previousVersion > 0 && <span>上一版 v{strategy.previousVersion}</span>}
        </div>
        <dl className="automation-strategy-config">
          <div><dt>跟注上限</dt><dd>{strategy.config.followCap} 注</dd></div>
          <div><dt>单局止损</dt><dd>{strategy.config.maxLossPerRound}</dd></div>
          <div><dt>最大回撤</dt><dd>{strategy.config.maxDrawdown}</dd></div>
          <div><dt>日局数上限</dt><dd>{strategy.config.maxRoundsPerDay}</dd></div>
          <div><dt>连败暂停</dt><dd>{strategy.config.lossStreakPause} 局</dd></div>
          <div><dt>适用档位</dt><dd>{strategy.config.tiers.length > 0 ? strategy.config.tiers.join(", ") : "不限"}</dd></div>
        </dl>
        <p className="automation-strategy-rule">{strategy.config.raiseRule}</p>
        <footer>
          <span>{strategy.updatedBy || "系统"} · {timeText(strategy.updatedAt)}</span>
          <div className="row-actions">
            {can("automation.strategy.update") && <button type="button" onClick={() => setEditing(strategy)}>编辑</button>}
            {can("automation.strategy.publish") && strategy.status !== "enabled" && <button type="button" onClick={() => setPublishing(strategy)}>发布</button>}
            {strategy.previousVersion > 0 && can("automation.strategy.update") && <button type="button" onClick={() => setRollingBack(strategy)}>回滚</button>}
          </div>
        </footer>
      </article>)}
    </div>}

    {editing !== undefined && <StrategyFormModal strategy={editing} onClose={() => setEditing(undefined)} onSaved={(message) => { setEditing(undefined); notify(message); void load(true); }} />}
    {publishing && <PublishModal strategy={publishing} onClose={() => setPublishing(null)} onPublished={(message) => { setPublishing(null); notify(message); void load(true); }} />}
    {rollingBack && <RollbackModal strategy={rollingBack} onClose={() => setRollingBack(null)} onRolledBack={(message) => { setRollingBack(null); notify(message); void load(true); }} />}
  </div>;
}

function StrategyFormModal({ strategy, onClose, onSaved }: { strategy: AutomationStrategyItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const initial = strategy?.config ?? emptyConfig;
  const [name, setName] = useState(strategy?.name ?? "");
  const [code, setCode] = useState(strategy?.code ?? "");
  const [playStyle, setPlayStyle] = useState(strategy?.playStyle ?? "balanced");
  const [followCap, setFollowCap] = useState(String(initial.followCap));
  const [raiseRule, setRaiseRule] = useState(initial.raiseRule);
  const [cheEnabled, setCheEnabled] = useState(initial.cheEnabled);
  const [maxLossPerRound, setMaxLossPerRound] = useState(String(initial.maxLossPerRound));
  const [maxDrawdown, setMaxDrawdown] = useState(String(initial.maxDrawdown));
  const [lossStreakPause, setLossStreakPause] = useState(String(initial.lossStreakPause));
  const [maxRoundsPerDay, setMaxRoundsPerDay] = useState(String(initial.maxRoundsPerDay));
  const [restSeconds, setRestSeconds] = useState(String(initial.restSeconds));
  const [tiers, setTiers] = useState<string[]>(initial.tiers.length > 0 ? initial.tiers : ["1"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleTier = (tier: string) => setTiers((current) => current.includes(tier) ? current.filter((item) => item !== tier) : [...current, tier].sort());

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const config: AutomationStrategyConfig = {
        followCap: Number(followCap),
        raiseRule,
        cheEnabled,
        maxLossPerRound: Number(maxLossPerRound),
        maxDrawdown: Number(maxDrawdown),
        lossStreakPause: Number(lossStreakPause),
        maxRoundsPerDay: Number(maxRoundsPerDay),
        restSeconds: Number(restSeconds),
        tiers,
      };
      const result = await api<{ message: string }>(strategy ? `/api/automation/strategies/${strategy.id}` : "/api/automation/strategies", {
        method: strategy ? "PUT" : "POST",
        ...jsonBody({ name, code, playStyle, config }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存策略失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={strategy ? `编辑 ${strategy.name}` : "新建策略草稿"} eyebrow="STRATEGY DRAFT" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="策略名称" hint="最多 64 个字符"><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="策略编码" hint={strategy ? "创建后不可修改" : "3–64 位小写字母、数字、下划线或点"}><input value={code} disabled={Boolean(strategy)} onChange={(event) => setCode(event.target.value)} placeholder="club_balanced_v1" /></Field>
      <Field label="出牌风格"><select value={playStyle} onChange={(event) => setPlayStyle(event.target.value)}><option value="conservative">保守</option><option value="balanced">均衡</option><option value="aggressive">激进</option></select></Field>
      <Field label="跟注上限" hint="1–20 注"><input type="number" min={1} max={20} value={followCap} onChange={(event) => setFollowCap(event.target.value)} /></Field>
      <Field label="加注规则" hint="最多 60 个字符"><input value={raiseRule} maxLength={60} onChange={(event) => setRaiseRule(event.target.value)} /></Field>
      <Field label="单局止损" hint="0–1,000,000"><input type="number" min={0} max={1000000} value={maxLossPerRound} onChange={(event) => setMaxLossPerRound(event.target.value)} /></Field>
      <Field label="最大回撤" hint="0–10,000,000"><input type="number" min={0} max={10000000} value={maxDrawdown} onChange={(event) => setMaxDrawdown(event.target.value)} /></Field>
      <Field label="连败暂停" hint="1–20 局"><input type="number" min={1} max={20} value={lossStreakPause} onChange={(event) => setLossStreakPause(event.target.value)} /></Field>
      <Field label="日局数上限" hint="1–5,000"><input type="number" min={1} max={5000} value={maxRoundsPerDay} onChange={(event) => setMaxRoundsPerDay(event.target.value)} /></Field>
      <Field label="休息间隔（秒）" hint="0–3,600"><input type="number" min={0} max={3600} value={restSeconds} onChange={(event) => setRestSeconds(event.target.value)} /></Field>
      <label className="automation-check automation-check--card"><input type="checkbox" checked={cheEnabled} onChange={(event) => setCheEnabled(event.target.checked)} /><span>启用 CHE 记牌辅助</span></label>
      <div className="automation-form-note automation-form-note--wide">适用档位</div>
      <div className="check-chip-list automation-tier-list">
        {tierOptions.map((tier) => <label key={tier}><input type="checkbox" checked={tiers.includes(tier)} onChange={() => toggleTier(tier)} /><span>{tier} 档</span></label>)}
      </div>
      <div className="automation-form-note automation-form-note--wide">保存后会生成新的草稿版本；只有发布后新开局的终端才会使用新参数，已开始的牌局不受影响。</div>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText={strategy ? "保存新版本" : "创建草稿"} /></div>
    </form>
  </Modal>;
}

function PublishModal({ strategy, onClose, onPublished }: { strategy: AutomationStrategyItem; onClose: () => void; onPublished: (message: string) => void }) {
  const [scope, setScope] = useState("gray");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/strategies/${strategy.id}/publish`, { method: "POST", ...jsonBody({ scope }) });
      onPublished(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "发布策略失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`发布 ${strategy.name}`} eyebrow="PUBLISH STRATEGY" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-detail-metrics">
        <div><span>当前版本</span><strong>v{strategy.version}</strong></div>
        <div><span>使用组</span><strong>{strategy.groupCount}</strong></div>
        <div><span>当前状态</span><strong className="automation-detail-text"><AutomationBadge value={strategy.status} /></strong></div>
      </div>
      <Field label="发布范围">
        <select value={scope} onChange={(event) => setScope(event.target.value)}><option value="gray">灰度：只让部分组使用</option><option value="all">全量：所有绑定该策略的组使用</option></select>
      </Field>
      <div className="operation-warning"><strong>{scope === "all" ? "全量发布" : "灰度发布"}</strong><p>{scope === "all" ? "所有绑定该策略的自动化组会在下一次开新局时使用新版本。" : "策略标记为灰度中，便于先观察一组终端；确认稳定后再全量发布。"}</p></div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认发布" />
    </form>
  </Modal>;
}

function RollbackModal({ strategy, onClose, onRolledBack }: { strategy: AutomationStrategyItem; onClose: () => void; onRolledBack: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/strategies/${strategy.id}/rollback`, { method: "POST" });
      onRolledBack(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "回滚策略失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`回滚 ${strategy.name}`} eyebrow="ROLLBACK" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>将回滚到 v{strategy.previousVersion}</strong><p>当前 v{strategy.version} 会被保存为上一版本，回滚结果会标记为草稿，确认后需要重新发布才会生效。</p></div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认回滚" />
    </form>
  </Modal>;
}
