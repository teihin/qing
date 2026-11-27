import { Field } from "../../components/ui";
import type { AutomationStrategyConfig, AutomationStrategyTier } from "./shared";

/** 策略参数的默认值：新建策略、单机自定义都以它为底。 */
export const emptyStrategyConfig: AutomationStrategyConfig = {
  // 跑法节奏
  buyinMultiple: 1,
  stayBuyinTimes: 2,
  roomAvoidMs: 600000,
  sitTimeoutMs: 12000,
  reinstateDelayMs: 3000,
  roomRetryMs: 15000,
  // 默认只进已经开局的房间：等待/准备中的房不进（进去也是空等）
  allowWaitingRoom: false,
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

/** 补全缺省字段（老策略可能没有新加的项，比如 allowWaitingRoom）。 */
export function normalizeStrategyConfig(input?: Partial<AutomationStrategyConfig> | null): AutomationStrategyConfig {
  if (!input) return emptyStrategyConfig;
  const tiers = (input.tiers ?? {}) as Record<string, Partial<AutomationStrategyTier>>;
  return {
    ...emptyStrategyConfig,
    ...input,
    tiers: {
      "1": { ...emptyStrategyConfig.tiers["1"], ...(tiers["1"] ?? {}) },
      "2": { ...emptyStrategyConfig.tiers["2"], ...(tiers["2"] ?? {}) },
      "5": { ...emptyStrategyConfig.tiers["5"], ...(tiers["5"] ?? {}) },
    },
  };
}

/**
 * 策略参数表单：策略编辑页和「机器人投放配置 → 自定义」共用同一套字段，
 * 保证能自定义的项与策略里能改的项完全一致。
 */
export function StrategyConfigForm({ config, onChange, disabled = false }: {
  config: AutomationStrategyConfig;
  onChange: (next: AutomationStrategyConfig) => void;
  disabled?: boolean;
}) {
  const patch = (next: Partial<AutomationStrategyConfig>) => onChange({ ...config, ...next });
  const patchTier = (key: string, field: keyof AutomationStrategyTier, value: number) => onChange({
    ...config,
    tiers: { ...config.tiers, [key]: { ...config.tiers[key], [field]: value } },
  });
  const numberInput = (value: number, onChangeValue: (next: number) => void, extra: { min?: number; max?: number; step?: number } = {}) =>
    <input type="number" disabled={disabled} min={extra.min} max={extra.max} step={extra.step} value={value}
      onChange={(event) => onChangeValue(Number(event.target.value) || 0)} />;

  return <>
    <div className="automation-form-note automation-form-note--wide">跑法 · 0 或留空表示沿用机器人自身配置</div>
    <Field label="带入倍数" hint="1–10 倍最小带入">{numberInput(config.buyinMultiple, (value) => patch({ buyinMultiple: value }), { min: 0, max: 10 })}</Field>
    <Field label="原房连续带入次数" hint="超目标时留在原房继续输几次，0 表示结算就走">{numberInput(config.stayBuyinTimes, (value) => patch({ stayBuyinTimes: value }), { min: 0, max: 20 })}</Field>
    <Field label="进等待中的房间" hint="关闭时只进已经开局的房间；开启才允许进等待/准备中的房间">
      <label className="confirm-check">
        <input type="checkbox" disabled={disabled} checked={config.allowWaitingRoom ?? false} onChange={(event) => patch({ allowWaitingRoom: event.target.checked })} />
        <span>允许进入等待中 / 准备中的房间</span>
      </label>
    </Field>
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
          <input type="number" min={0} disabled={disabled} value={config.tiers[key]?.[field] ?? 0} onChange={(event) => patchTier(key, field, Number(event.target.value) || 0)} />
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
  </>;
}
