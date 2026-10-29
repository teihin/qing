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

const emptyConfig: AutomationStrategyConfig = {
  // 跑法节奏
  buyinMultiple: 1,
  stayBuyinTimes: 2,
  roomAvoidMs: 600000,
  sitTimeoutMs: 12000,
  reinstateDelayMs: 3000,
  roomRetryMs: 15000,
  // 出牌节奏
  actionDelayMinMs: 1200,
  actionDelayMaxMs: 2500,
  decideTimeoutMs: 6000,
  // 三档安全线
  tiers: {
    "1": { minG: 8, safeGen: 50, noAddGenMin: 3 },
    "2": { minG: 15, safeGen: 100, noAddGenMin: 5 },
    "5": { minG: 22, safeGen: 150, noAddGenMin: 10 },
  },
  // 牌力
  bigPairFen: 9,
  weakLowFen: 7,
  protectPairFen: 10,
  protectBothFen: 8,
  // 输赢控制
  winStreakPause: 3,
  deadbandRatio: 0.2,
  addMoreChance: 0.34,
};

const tierFieldLabels: Array<{ field: keyof AutomationStrategyTier; text: string }> = [
  { field: "minG", text: "最低跟注线" },
  { field: "safeGen", text: "安全线" },
  { field: "noAddGenMin", text: "便宜跟注线" },
];

const tierLabels: Array<{ key: string; label: string }> = [
  { key: "1", label: "底皮 1/3" },
  { key: "2", label: "底皮 2/5" },
  { key: "5", label: "底皮 5/10" },
];

function normalizeConfig(input?: AutomationStrategyConfig | null): AutomationStrategyConfig {
  if (!input) return emptyConfig;
  const tiers = input.tiers ?? {};
  return {
    ...emptyConfig,
    ...input,
    tiers: {
      "1": { ...emptyConfig.tiers["1"], ...(tiers["1"] ?? {}) },
      "2": { ...emptyConfig.tiers["2"], ...(tiers["2"] ?? {}) },
      "5": { ...emptyConfig.tiers["5"], ...(tiers["5"] ?? {}) },
    },
  };
}


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

    <DemoNote>策略绑定到机器人后随心跳下发；草稿不会生效，发布后下一次心跳才用新参数。运行中的终端走热更新，带入倍数要等下一次带入。</DemoNote>

    {error && <ErrorBanner message={error} />}
    {!items && loading ? <LoadingBlock label="正在读取策略" /> : !items || items.length === 0 ? <section className="panel"><EmptyState title="还没有策略" description="先创建一个策略草稿，再绑定到自动化组。" /></section> : <div className="automation-card-grid">
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
  const [name, setName] = useState(strategy?.name ?? "");
  const [config, setConfig] = useState<AutomationStrategyConfig>(() => normalizeConfig(strategy?.config));
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

  return <Modal title={strategy ? `编辑 ${strategy.name}` : "新建策略草稿"} eyebrow="STRATEGY DRAFT" onClose={onClose} wide>
    <form className="form-grid form-grid--two" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="automation-form-note--wide">
        <Field label="策略名称" hint="最多 64 个字符；编码由系统自动生成"><input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="例如：保守跑量 / 激进冲量" /></Field>
      </div>

      <div className="automation-form-note automation-form-note--wide">跑法 · 0 或留空表示沿用机器人自身配置</div>
      <Field label="带入倍数" hint="1–10 倍最小带入">{numberInput(config.buyinMultiple, (value) => patch({ buyinMultiple: value }), { min: 0, max: 10 })}</Field>
      <Field label="原房连续带入次数" hint="超目标时留在原房继续输几次，0 表示结算就走">{numberInput(config.stayBuyinTimes, (value) => patch({ stayBuyinTimes: value }), { min: 0, max: 20 })}</Field>
      <Field label="换房避让（分钟）" hint="离开的房间这段时间内不再进">{numberInput(Math.round(config.roomAvoidMs / 60000), (value) => patch({ roomAvoidMs: value * 60000 }), { min: 0, max: 1440 })}</Field>
      <Field label="找房间隔（毫秒）" hint="1,000–600,000">{numberInput(config.roomRetryMs, (value) => patch({ roomRetryMs: value }), { min: 0, step: 1000 })}</Field>
      <Field label="带入确认超时（毫秒）" hint="发出带入后等这么久还没坐上，就重新找座">{numberInput(config.sitTimeoutMs, (value) => patch({ sitTimeoutMs: value }), { min: 0, step: 1000 })}</Field>
      <Field label="丢座后重坐延迟（毫秒）" hint="座位被收回后等这么久再抢座，避开座位表刷新">{numberInput(config.reinstateDelayMs, (value) => patch({ reinstateDelayMs: value }), { min: 0, step: 1000 })}</Field>

      <div className="automation-form-note automation-form-note--wide">出牌节奏 · 替代客户端里写死的 1200–2500ms 与 6 秒</div>
      <Field label="最短间隔（毫秒）" hint="500–10,000">{numberInput(config.actionDelayMinMs, (value) => patch({ actionDelayMinMs: value }), { min: 0, step: 100 })}</Field>
      <Field label="最长间隔（毫秒）" hint="500–10,000">{numberInput(config.actionDelayMaxMs, (value) => patch({ actionDelayMaxMs: value }), { min: 0, step: 100 })}</Field>
      <Field label="决策超时（毫秒）" hint="超过这个时间没出牌就放弃本轮">{numberInput(config.decideTimeoutMs, (value) => patch({ decideTimeoutMs: value }), { min: 0, step: 500 })}</Field>

      <div className="automation-form-note automation-form-note--wide">
        风控安全线 · 只在「本轮该输」时生效：桌面余额低于最低跟注线就敲出局；这一手要跟的注差超过安全线就丢；
        跟注不超过便宜跟注线算便宜，可以跟或休
      </div>
      {tierLabels.map(({ key, label }) => <Field key={key} label={label} hint="最低跟注线 / 安全线 / 便宜跟注线">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {tierFieldLabels.map(({ field, text }) => <label key={field} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <span>{text}</span>
            <input type="number" min={0} value={config.tiers[key][field]} onChange={(event) => patchTier(key, field, Number(event.target.value) || 0)} />
          </label>)}
        </div>
      </Field>)}

      <div className="automation-form-note automation-form-note--wide">牌力判断</div>
      <Field label="大牌线" hint="牌型分 ≥ 该值算够大，1–21">{numberInput(config.bigPairFen, (value) => patch({ bigPairFen: value }), { min: 1, max: 21 })}</Field>
      <Field label="小门改扯线" hint="小门 ≤ 该值时改扯大大，1–21">{numberInput(config.weakLowFen, (value) => patch({ weakLowFen: value }), { min: 1, max: 21 })}</Field>
      <Field label="单门保护线" hint="最后一圈任一门达标就不硬丢">{numberInput(config.protectPairFen, (value) => patch({ protectPairFen: value }), { min: 1, max: 21 })}</Field>
      <Field label="双门保护线" hint="两门都达标也不硬丢">{numberInput(config.protectBothFen, (value) => patch({ protectBothFen: value }), { min: 1, max: 21 })}</Field>

      <div className="automation-form-note automation-form-note--wide">输赢控制</div>
      <Field label="连赢降级局数" hint="连赢这么多局后本局不主动争赢">{numberInput(config.winStreakPause, (value) => patch({ winStreakPause: value }), { min: 0, max: 20 })}</Field>
      <Field label="目标死区比例" hint="0–1，例如 0.2 表示目标上下 20% 内算达标">{numberInput(config.deadbandRatio, (value) => patch({ deadbandRatio: value }), { min: 0, max: 1, step: 0.05 })}</Field>
      <Field label="超目标加注概率" hint="0–1，超目标时主动加注加快回落">{numberInput(config.addMoreChance, (value) => patch({ addMoreChance: value }), { min: 0, max: 1, step: 0.01 })}</Field>

      <div className="automation-form-note automation-form-note--wide">保存后生成新草稿；发布后下一次心跳即下发，运行中的终端走热更新（带入倍数等启动项要等下次拉起）。</div>
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
