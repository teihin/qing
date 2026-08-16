import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { GameRewardPoolControlState, GameRewardPoolState, RewardPoolControlItem, RewardPoolControlValues } from "../types";

const maxSafePoolValue = 1_000_000_000_000;
const maxPlatformRetentionYuan = 1_000_000_000;

interface RewardControlDraft {
  globalNoRewardRate: string;
  rewardRates: Record<string, string>;
  tierNoRewardRates: Record<string, string>;
  platformRetentionYuan: Record<string, string>;
}

const emptyControlDraft: RewardControlDraft = {
  globalNoRewardRate: "",
  rewardRates: {},
  tierNoRewardRates: {},
  platformRetentionYuan: {},
};

export default function RewardPoolsPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<GameRewardPoolState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [controlData, setControlData] = useState<GameRewardPoolControlState | null>(null);
  const [controlDraft, setControlDraft] = useState<RewardControlDraft>(emptyControlDraft);
  const [confirmed, setConfirmed] = useState(false);
  const [controlConfirmed, setControlConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingControls, setSavingControls] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const applyState = useCallback((state: GameRewardPoolState) => {
    setData(state);
    setDraft(Object.fromEntries(state.items.map((item) => [item.key, formatFenForInput(item.value)])));
    setConfirmed(false);
  }, []);

  const applyControlState = useCallback((state: GameRewardPoolControlState) => {
    setControlData(state);
    setControlDraft(controlStateToDraft(state));
    setControlConfirmed(false);
  }, []);

  const load = useCallback(async (showState = false) => {
    if (showState) setRefreshing(true);
    try {
      const [poolState, controlState] = await Promise.all([
        api<GameRewardPoolState>("/api/configuration/reward-pools"),
        api<GameRewardPoolControlState>("/api/configuration/reward-pools/controls"),
      ]);
      applyState(poolState);
      applyControlState(controlState);
      if (showState) notify("已重新读取奖池金额、放奖概率和平台提留");
    } catch (reason) {
      notify(errorMessage(reason, "奖池数据加载失败"), "error");
    } finally {
      if (showState) setRefreshing(false);
    }
  }, [applyControlState, applyState, notify]);

  useEffect(() => { void load(); }, [load]);

  const parsed = useMemo(() => parseDraft(data, draft), [data, draft]);
  const changedItems = useMemo(() => data && parsed.values ? data.items.filter((item) => parsed.values?.[item.key] !== item.value) : [], [data, parsed.values]);
  const parsedControls = useMemo(() => parseControlDraft(controlData, controlDraft), [controlData, controlDraft]);
  const changedControlCount = useMemo(() => controlData ? (parsedControls.values ? countControlChanges(controlData, parsedControls.values) : countControlDraftChanges(controlData, controlDraft)) : 0, [controlData, controlDraft, parsedControls.values]);
  const nextTotal = parsed.values ? Object.values(parsed.values).reduce((sum, value) => sum + value, 0) : null;
  const blockedBySchema = Boolean(data?.unexpectedKeys.length);
  const canUpdate = can("configuration.reward_pool.update");

  const updateValue = (key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
  };

  const updateControlValue = (group: keyof Omit<RewardControlDraft, "globalNoRewardRate">, key: string, value: string) => {
    setControlDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
    setControlConfirmed(false);
  };

  const updateGlobalNoRewardRate = (value: string) => {
    setControlDraft((current) => ({ ...current, globalNoRewardRate: value }));
    setControlConfirmed(false);
  };

  const restore = () => {
    if (!data) return;
    setDraft(Object.fromEntries(data.items.map((item) => [item.key, formatFenForInput(item.value)])));
    setConfirmed(false);
  };

  const restoreControls = () => {
    if (!controlData) return;
    setControlDraft(controlStateToDraft(controlData));
    setControlConfirmed(false);
  };

  const refresh = () => {
    if ((changedItems.length > 0 || changedControlCount > 0) && !window.confirm("当前有未保存的奖池修改，确定放弃并重新读取吗？")) return;
    void load(true);
  };

  const save = async () => {
    if (!data || !parsed.values) {
      notify(parsed.error || "请检查全部皮池金额", "error");
      return;
    }
    if (!confirmed) {
      notify("请先确认本次操作将修改游戏各皮池奖池", "error");
      return;
    }
    setSaving(true);
    try {
      const expected = Object.fromEntries(data.items.map((item) => [item.key, item.value]));
      const result = await api<{ state: GameRewardPoolState; message: string }>("/api/configuration/reward-pools", {
        method: "PUT",
        ...jsonBody({ rewards: parsed.values, expected, confirm: true }),
      });
      applyState(result.state);
      notify(result.message);
    } catch (reason) {
      notify(errorMessage(reason, "奖池保存失败"), "error");
      if (reason instanceof ApiError && reason.status === 409) await load();
    } finally {
      setSaving(false);
    }
  };

  const saveControls = async () => {
    if (!controlData || !parsedControls.values) {
      notify(parsedControls.error || "请检查全部奖池概率和平台提留", "error");
      return;
    }
    if (!controlConfirmed) {
      notify("请先确认本次操作将修改奖池放奖概率和平台提留", "error");
      return;
    }
    setSavingControls(true);
    try {
      const result = await api<{ state: GameRewardPoolControlState; message: string }>("/api/configuration/reward-pools/controls", {
        method: "PUT",
        ...jsonBody({ values: parsedControls.values, expected: controlStateToValues(controlData), confirm: true }),
      });
      applyControlState(result.state);
      notify(result.message);
    } catch (reason) {
      notify(errorMessage(reason, "奖池概率和平台提留保存失败"), "error");
      if (reason instanceof ApiError && reason.status === 409) await load();
    } finally {
      setSavingControls(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="REWARD POOL CONTROL" title="奖池设置" description="统一管理奖池金额、各底皮放奖概率、拦截概率和平台固定提留。" actions={
        <span className="configuration-status is-live"><i />游戏服务实时数据</span>
      } />

      {!data || !controlData ? <section className="panel"><LoadingBlock label="正在读取奖池金额和概率配置" /></section> : <>
        <section className="reward-pool-summary">
          <article className="panel reward-pool-summary__primary"><span>当前奖池总额</span><strong>{formatFenAsYuan(data.total)}</strong><small>元 · 9 个皮池合计</small></article>
          <article className="panel"><span>修改后总额</span><strong>{nextTotal === null ? "—" : formatFenAsYuan(nextTotal)}</strong><small className={nextTotal !== data.total ? "is-changed" : ""}>{nextTotal === null ? "请检查输入" : amountDelta(nextTotal - data.total)}</small></article>
          <article className="panel"><span>已修改皮池</span><strong>{changedItems.length}</strong><small>保存时一次提交并回读全部金额</small></article>
          <article className="panel"><span>最近后台修改</span><strong className="is-date">{data.lastUpdatedAt ? formatDate(data.lastUpdatedAt) : "尚无记录"}</strong><small>{data.lastUpdatedBy || "游戏服务当前值"}</small></article>
        </section>

        <div className="configuration-warning reward-pool-unit-note"><span>¥</span><p><strong>页面金额单位为“元”</strong><br />旧游戏服务按“分”保存，系统提交时自动乘以 100。示例：999.99 元会保存为 99999 分。</p></div>

        {blockedBySchema && <div className="configuration-warning"><span>!</span><p>游戏服务返回了尚未识别的皮池：{data.unexpectedKeys.join("、")}。为避免覆盖新配置，后台已禁止保存，请先升级字段定义。</p></div>}

        <section className="panel reward-pool-editor">
          <header className="configuration-panel-title">
            <div><span>POOL MATRIX</span><h2>各皮池奖池金额（元）</h2><p>最多填写两位小数；未修改的皮池也会参与保存前后的完整一致性校验。</p></div>
            <Button type="button" variant="secondary" disabled={refreshing || saving} onClick={refresh}>{refreshing ? "正在读取…" : "刷新当前值"}</Button>
          </header>
          <div className="reward-pool-grid">
            {data.items.map((item, index) => {
              const value = parsed.values?.[item.key];
              const changed = value !== undefined && value !== item.value;
              return <label className={`reward-pool-card ${changed ? "is-changed" : ""}`} key={item.key}>
                <span className="reward-pool-card__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="reward-pool-card__title"><small>底皮</small><strong>{item.label}</strong></span>
                <span className="reward-pool-card__input"><input type="text" inputMode="decimal" value={draft[item.key] ?? ""} disabled={!canUpdate || saving || blockedBySchema} onChange={(event) => updateValue(item.key, event.target.value)} aria-label={`${item.label} 奖池金额，单位元`} /><i>元</i></span>
                <span className="reward-pool-card__meta">当前 {formatFenAsYuan(item.value)} 元{changed && value !== undefined ? <b>{amountDelta(value - item.value)}</b> : <em>未修改</em>}</span>
              </label>;
            })}
          </div>
          {parsed.error && <div className="reward-pool-error"><span>!</span>{parsed.error}</div>}
          <div className="reward-pool-safety">
            <div><span>i</span><p><strong>按元操作，按分保存并自动回读</strong><small>系统会精确换算为分；如果游戏服务回读金额不一致，后台会尝试恢复修改前的全部奖池金额并记录审计。</small></p></div>
            <label className={`notification-confirm ${confirmed ? "is-checked" : ""}`}>
              <input type="checkbox" checked={confirmed} disabled={!canUpdate || changedItems.length === 0 || Boolean(parsed.error) || blockedBySchema || saving} onChange={(event) => setConfirmed(event.target.checked)} />
              <span><strong>确认修改游戏各皮池奖池</strong><small>我已逐项核对金额，了解保存会立即影响游戏奖池数据。</small></span>
            </label>
          </div>
          <footer className="reward-pool-actions">
            <p>{canUpdate ? `本次将修改 ${changedItems.length} 个皮池，操作前后金额和操作者都会写入审计。` : "当前角色只有查看奖池权限。"}</p>
            <div><Button type="button" variant="secondary" disabled={changedItems.length === 0 || saving} onClick={restore}>恢复当前值</Button>{canUpdate && <Button type="button" disabled={!confirmed || changedItems.length === 0 || Boolean(parsed.error) || blockedBySchema || saving} onClick={() => void save()}>{saving ? "正在保存并校验…" : "保存奖池设置"}</Button>}</div>
          </footer>
        </section>

        <div className="configuration-warning reward-control-formula-note"><span>%</span><p><strong>预计实际放奖概率不是只看 reward_rate</strong><br />预计实际放奖 = 基础放奖 ×（1－全局不发奖）×（1－本档不发奖）。例如 100%、0%、70% 时，预计实际放奖约为 30%。</p></div>

        <section className="panel reward-control-editor">
          <header className="configuration-panel-title">
            <div><span>REWARD PROBABILITY</span><h2>奖池爆奖概率与平台提留</h2><p>概率均为 0～100 的整数；平台提留按元设置，是该底皮奖池发生累积时平台先固定留下的金额。</p></div>
            <span className="reward-control-last-update">最近修改<br /><strong>{controlData.lastUpdatedAt ? formatDate(controlData.lastUpdatedAt) : "尚无记录"}</strong><small>{controlData.lastUpdatedBy || "游戏服务当前值"}</small></span>
          </header>

          <div className={`reward-control-global ${controlDraft.globalNoRewardRate !== String(controlData.globalNoRewardRate) ? "is-changed" : ""}`}>
            <div><span>GLOBAL GATE</span><strong>全局不发奖概率</strong><p>命中后所有底皮都不发奖；0 表示全局不拦截，100 表示全部拦截。</p></div>
            <label><input type="text" inputMode="numeric" value={controlDraft.globalNoRewardRate} disabled={!canUpdate || savingControls} onChange={(event) => updateGlobalNoRewardRate(event.target.value)} aria-label="全局不发奖概率" /><i>%</i></label>
          </div>

          <div className="reward-control-grid">
            {controlData.items.map((item, index) => {
              const currentValues = parsedControls.values;
              const baseRate = currentValues?.rewardRates[item.key];
              const tierNoRewardRate = currentValues?.tierNoRewardRates[item.key];
              const estimated = baseRate === undefined || tierNoRewardRate === undefined || !currentValues
                ? null
                : calculateEstimatedRewardRate(baseRate, currentValues.globalNoRewardRate, tierNoRewardRate);
              const changed = isControlItemChanged(item, currentValues);
              return <article className={`reward-control-card ${changed ? "is-changed" : ""}`} key={item.key}>
                <header><span>{String(index + 1).padStart(2, "0")}</span><div><small>底皮</small><strong>{item.label}</strong></div></header>
                <div className="reward-control-card__fields">
                  <RewardControlField label="基础放奖" unit="%" unavailable={item.baseRewardRate === null} value={controlDraft.rewardRates[item.key] ?? ""} disabled={!canUpdate || savingControls} onChange={(value) => updateControlValue("rewardRates", item.key, value)} />
                  <RewardControlField label="本档不发奖" unit="%" value={controlDraft.tierNoRewardRates[item.key] ?? ""} disabled={!canUpdate || savingControls} onChange={(value) => updateControlValue("tierNoRewardRates", item.key, value)} />
                  <div className="reward-control-computed"><span>预计实际放奖</span><strong>{estimated === null ? "—" : `${formatPercent(estimated)}%`}</strong><small>{estimated === null ? "服务端未配置基础值" : "按三层概率顺序估算"}</small></div>
                  <RewardControlField label="平台固定提留" unit="元" unavailable={item.platformRetentionYuan === null} value={controlDraft.platformRetentionYuan[item.key] ?? ""} disabled={!canUpdate || savingControls} onChange={(value) => updateControlValue("platformRetentionYuan", item.key, value)} />
                </div>
              </article>;
            })}
          </div>

          <div className="reward-control-legend">
            <p><b>基础放奖</b>：奖池牌型出现后，先按 reward_rate 判断是否准备放给玩家。</p>
            <p><b>本档不发奖</b>：基础判断通过后，再按 reward_nopai_dipi 拦截对应底皮。</p>
            <p><b>平台固定提留</b>：reward_modify，单位元；先从本次进入奖池的钱中提留，剩余金额才累积进奖池。</p>
            <p><b>100 / 200 档</b>：正式配置目前只为该档提供本档不发奖概率，后台不会伪造缺失的基础放奖和平台提留值。</p>
          </div>

          {parsedControls.error && <div className="reward-pool-error"><span>!</span>{parsedControls.error}</div>}
          <div className="reward-pool-safety reward-control-safety">
            <div><span>i</span><p><strong>四项配置独立写入并整体回读</strong><small>保存前会核对页面基准；任一字段写入或回读失败时，后台会尝试恢复四项修改前配置并记录审计。</small></p></div>
            <label className={`notification-confirm ${controlConfirmed ? "is-checked" : ""}`}>
              <input type="checkbox" checked={controlConfirmed} disabled={!canUpdate || changedControlCount === 0 || Boolean(parsedControls.error) || savingControls} onChange={(event) => setControlConfirmed(event.target.checked)} />
              <span><strong>确认修改奖池概率与平台提留</strong><small>我已核对各底皮配置，了解保存后会立即影响游戏发奖和奖池累积。</small></span>
            </label>
          </div>
          <footer className="reward-pool-actions">
            <p>{canUpdate ? `本次共有 ${changedControlCount} 项配置变化；概率按百分比，平台提留按整数元保存。` : "当前角色只有查看奖池权限。"}</p>
            <div><Button type="button" variant="secondary" disabled={changedControlCount === 0 || savingControls} onClick={restoreControls}>恢复当前值</Button>{canUpdate && <Button type="button" disabled={!controlConfirmed || changedControlCount === 0 || Boolean(parsedControls.error) || savingControls} onClick={() => void saveControls()}>{savingControls ? "正在保存并校验…" : "保存概率与提留"}</Button>}</div>
          </footer>
        </section>
      </>}
    </div>
  );
}

function RewardControlField({ label, unit, value, unavailable = false, disabled, onChange }: {
  label: string;
  unit: string;
  value: string;
  unavailable?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (unavailable) return <div className="reward-control-unavailable"><span>{label}</span><strong>—</strong><small>服务端未配置</small></div>;
  return <label className="reward-control-field"><span>{label}</span><div><input type="text" inputMode="numeric" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /><i>{unit}</i></div></label>;
}

function parseDraft(data: GameRewardPoolState | null, draft: Record<string, string>): { values: Record<string, number> | null; error: string } {
  if (!data) return { values: null, error: "" };
  const values: Record<string, number> = {};
  for (const item of data.items) {
    const raw = (draft[item.key] ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return { values: null, error: `${item.key} 奖池必须填写不小于 0 的金额，最多两位小数` };
    const [yuanText, fenText = ""] = raw.split(".");
    const yuan = Number(yuanText);
    const fen = Number(fenText.padEnd(2, "0"));
    const valueInFen = yuan * 100 + fen;
    if (!Number.isSafeInteger(yuan) || !Number.isSafeInteger(valueInFen) || valueInFen > maxSafePoolValue) return { values: null, error: `${item.key} 奖池金额超出安全范围` };
    values[item.key] = valueInFen;
  }
  return { values, error: "" };
}

function controlStateToValues(state: GameRewardPoolControlState): RewardPoolControlValues {
  const values: RewardPoolControlValues = {
    rewardRates: {},
    globalNoRewardRate: state.globalNoRewardRate,
    tierNoRewardRates: {},
    platformRetentionYuan: {},
  };
  for (const item of state.items) {
    values.tierNoRewardRates[item.key] = item.tierNoRewardRate;
    if (item.baseRewardRate !== null) values.rewardRates[item.key] = item.baseRewardRate;
    if (item.platformRetentionYuan !== null) values.platformRetentionYuan[item.key] = item.platformRetentionYuan;
  }
  return values;
}

function controlStateToDraft(state: GameRewardPoolControlState): RewardControlDraft {
  const draft: RewardControlDraft = {
    globalNoRewardRate: String(state.globalNoRewardRate),
    rewardRates: {},
    tierNoRewardRates: {},
    platformRetentionYuan: {},
  };
  for (const item of state.items) {
    draft.tierNoRewardRates[item.key] = String(item.tierNoRewardRate);
    if (item.baseRewardRate !== null) draft.rewardRates[item.key] = String(item.baseRewardRate);
    if (item.platformRetentionYuan !== null) draft.platformRetentionYuan[item.key] = String(item.platformRetentionYuan);
  }
  return draft;
}

function parseControlDraft(data: GameRewardPoolControlState | null, draft: RewardControlDraft): { values: RewardPoolControlValues | null; error: string } {
  if (!data) return { values: null, error: "" };
  const globalNoRewardRate = parseWholeNumber(draft.globalNoRewardRate, 100);
  if (globalNoRewardRate === null) return { values: null, error: "全局不发奖概率必须填写 0 到 100 的整数" };
  const values: RewardPoolControlValues = {
    rewardRates: {},
    globalNoRewardRate,
    tierNoRewardRates: {},
    platformRetentionYuan: {},
  };
  for (const item of data.items) {
    const tierNoRewardRate = parseWholeNumber(draft.tierNoRewardRates[item.key] ?? "", 100);
    if (tierNoRewardRate === null) return { values: null, error: `${item.key} 本档不发奖概率必须填写 0 到 100 的整数` };
    values.tierNoRewardRates[item.key] = tierNoRewardRate;
    if (item.baseRewardRate !== null) {
      const baseRewardRate = parseWholeNumber(draft.rewardRates[item.key] ?? "", 100);
      if (baseRewardRate === null) return { values: null, error: `${item.key} 基础放奖概率必须填写 0 到 100 的整数` };
      values.rewardRates[item.key] = baseRewardRate;
    }
    if (item.platformRetentionYuan !== null) {
      const retention = parseWholeNumber(draft.platformRetentionYuan[item.key] ?? "", maxPlatformRetentionYuan);
      if (retention === null) return { values: null, error: `${item.key} 平台固定提留必须填写 0 到 ${maxPlatformRetentionYuan} 的整数元` };
      values.platformRetentionYuan[item.key] = retention;
    }
  }
  return { values, error: "" };
}

function parseWholeNumber(raw: string, maximum: number): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function countControlChanges(state: GameRewardPoolControlState, values: RewardPoolControlValues): number {
  let count = values.globalNoRewardRate === state.globalNoRewardRate ? 0 : 1;
  for (const item of state.items) {
    if (values.tierNoRewardRates[item.key] !== item.tierNoRewardRate) count++;
    if (item.baseRewardRate !== null && values.rewardRates[item.key] !== item.baseRewardRate) count++;
    if (item.platformRetentionYuan !== null && values.platformRetentionYuan[item.key] !== item.platformRetentionYuan) count++;
  }
  return count;
}

function countControlDraftChanges(state: GameRewardPoolControlState, draft: RewardControlDraft): number {
  let count = draft.globalNoRewardRate.trim() === String(state.globalNoRewardRate) ? 0 : 1;
  for (const item of state.items) {
    if ((draft.tierNoRewardRates[item.key] ?? "").trim() !== String(item.tierNoRewardRate)) count++;
    if (item.baseRewardRate !== null && (draft.rewardRates[item.key] ?? "").trim() !== String(item.baseRewardRate)) count++;
    if (item.platformRetentionYuan !== null && (draft.platformRetentionYuan[item.key] ?? "").trim() !== String(item.platformRetentionYuan)) count++;
  }
  return count;
}

function isControlItemChanged(item: RewardPoolControlItem, values: RewardPoolControlValues | null): boolean {
  if (!values || values.tierNoRewardRates[item.key] !== item.tierNoRewardRate) return Boolean(values);
  if (item.baseRewardRate !== null && values.rewardRates[item.key] !== item.baseRewardRate) return true;
  return item.platformRetentionYuan !== null && values.platformRetentionYuan[item.key] !== item.platformRetentionYuan;
}

function calculateEstimatedRewardRate(baseRate: number, globalNoRewardRate: number, tierNoRewardRate: number): number {
  return Math.round((baseRate * (100 - globalNoRewardRate) * (100 - tierNoRewardRate) / 10_000) * 100) / 100;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatFenForInput(valueInFen: number) {
  const yuan = Math.floor(valueInFen / 100);
  const fen = valueInFen % 100;
  return fen === 0 ? String(yuan) : `${yuan}.${String(fen).padStart(2, "0")}`;
}

function formatFenAsYuan(valueInFen: number) {
  const absolute = Math.abs(valueInFen);
  const yuan = Math.floor(absolute / 100);
  const fen = absolute % 100;
  const formattedYuan = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(yuan);
  const amount = fen === 0 ? formattedYuan : `${formattedYuan}.${String(fen).padStart(2, "0")}`;
  return valueInFen < 0 ? `-${amount}` : amount;
}

function amountDelta(value: number) {
  if (value === 0) return "与当前一致";
  return `${value > 0 ? "+" : ""}${formatFenAsYuan(value)} 元`;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback;
}
