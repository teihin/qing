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
  type AutomationStrategyTier,
} from "./shared";
import { StrategyConfigForm, emptyStrategyConfig, normalizeStrategyConfig } from "./StrategyConfigForm";

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
      eyebrow="RUN STRATEGY"
      title="策略中心"
      description="策略只描述机器人「怎么跑、怎么打」：换房节奏、出牌快慢、安全线与牌力判断。进哪些房间、输赢目标在投放时配置。"
      actions={<div className="automation-header-actions">
        {can("automation.strategy.create") && <Button onClick={() => setEditing(null)}>新建策略</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>策略保存即生效：绑定它的机器人下一次心跳（≤5 秒）就按新参数跑，运行中的终端走热更新；带入倍数要等下一次带入才用上。</DemoNote>

    {error && <ErrorBanner message={error} />}
    {!items && loading ? <LoadingBlock label="正在读取策略" /> : !items || items.length === 0 ? <section className="panel"><EmptyState title="还没有策略" description="直接创建一个策略，创建即生效，绑定到机器人或分组后下一次心跳就按它跑。" /></section> : <div className="automation-card-grid">
      {items.map((strategy) => <article key={strategy.id} className="automation-strategy-card">
        <header>
          <div><span>{strategy.code}</span><h2>{strategy.name}</h2></div>
          <AutomationBadge value={strategy.status} />
        </header>
        <div className="automation-strategy-meta">
          <span>v{strategy.version}</span>
          <span>{strategy.robotCount ?? 0} 台机器人 · {strategy.groupCount} 个组使用</span>
          {strategy.previousVersion > 0 && <span>上一版 v{strategy.previousVersion}</span>}
        </div>
        <dl className="automation-strategy-config">
          <div><dt>带入倍数</dt><dd>{strategy.config.buyinMultiple ? `${strategy.config.buyinMultiple} 倍` : "沿用"}</dd></div>
          <div><dt>原房连输</dt><dd>{strategy.config.stayBuyinTimes ?? 0} 次</dd></div>
          <div><dt>换房避让</dt><dd>{strategy.config.roomAvoidMs ? `${Math.round(strategy.config.roomAvoidMs / 60000)} 分钟` : "不避让"}</dd></div>
          <div><dt>出牌延迟</dt><dd>{strategy.config.actionDelayMinMs}–{strategy.config.actionDelayMaxMs}ms</dd></div>
          <div><dt>安全线</dt><dd>{(strategy.config.tiers?.["1"]?.safeGen ?? 0)}/{(strategy.config.tiers?.["2"]?.safeGen ?? 0)}/{(strategy.config.tiers?.["5"]?.safeGen ?? 0)}</dd></div>
        </dl>
        <footer>
          <span>{strategy.updatedBy || "系统"} · {timeText(strategy.updatedAt)}</span>
          <div className="row-actions">
            {can("automation.strategy.update") && <button type="button" onClick={() => setEditing(strategy)}>编辑</button>}
            {can("automation.strategy.publish") && strategy.status === "draft" && <button type="button" onClick={() => setPublishing(strategy)}>发布</button>}
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
  const [name, setName] = useState(strategy?.name ?? "");
  const [config, setConfig] = useState<AutomationStrategyConfig>(() => normalizeStrategyConfig(strategy?.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const patch = (next: Partial<AutomationStrategyConfig>) => setConfig((current) => ({ ...current, ...next }));
  const patchTier = (key: string, field: keyof AutomationStrategyTier, value: number) => setConfig((current) => ({
    ...current,
    tiers: { ...current.tiers, [key]: { ...current.tiers[key], [field]: value } },
  }));
  const numberInput = (value: number, onChange: (next: number) => void, extra: { min?: number; max?: number; step?: number } = {}) =>
    <input type="number" min={extra.min} max={extra.max} step={extra.step} value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} />;

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(strategy ? `/api/automation/strategies/${strategy.id}` : "/api/automation/strategies", {
        method: strategy ? "PUT" : "POST",
        ...jsonBody({ name, config }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存策略失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={strategy ? `编辑 ${strategy.name}` : "新建策略"} eyebrow="STRATEGY" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-form-note--wide">
        <Field label="策略名称" hint="最多 64 个字符；编码由系统自动生成"><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="例如：保守跑量 / 激进冲量" /></Field>
      </div>

      <StrategyConfigForm config={config} onChange={setConfig} />
      <div className="automation-form-note automation-form-note--wide">保存即生效：绑定它的机器人下一次心跳就按新参数跑，运行中的终端走热更新（带入倍数等启动项要等下次带入/拉起）。</div>
      <div className="automation-form-actions-wide"><FormActions onCancel={onClose} busy={busy} submitText={strategy ? "保存并生效" : "创建并生效"} /></div>
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
      <div className="operation-warning"><strong>将回滚到 v{strategy.previousVersion}</strong><p>当前 v{strategy.version} 会被保存为上一版本；回滚立即生效，绑定它的机器人下一次心跳就按旧版本跑。</p></div>
      <FormActions onCancel={onClose} busy={busy} submitText="确认回滚" />
    </form>
  </Modal>;
}
