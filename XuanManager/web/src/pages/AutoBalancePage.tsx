import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import type {
  AutoBalanceCandidate,
  AutoBalanceCandidateResponse,
  AutoBalanceConfig,
  AutoBalanceEntry,
  AutoBalanceExecuteResponse,
  AutoBalanceGroup,
  AutoBalanceGroupsResponse,
  AutoBalanceImportResponse,
  AutoBalanceLimits,
  AutoBalanceMember,
  AutoBalanceOverview,
  AutoBalanceProtectConfig,
  AutoBalanceSuppressConfig,
  AutoBalanceTeam,
  AutoBalanceTeamsResponse,
  AutoBalanceTeamWriteResponse,
} from "../types";

type Tab = "config" | "candidates" | "teams";

const TAB_LABEL: Record<Tab, string> = {
  config: "配置与总览",
  candidates: "候选与执行",
  teams: "伙牌名单",
};

const MODE_LABEL: Record<string, string> = {
  observe: "只观察",
  advice: "人工确认",
  auto: "自动执行",
};

const ACTION_LABEL: Record<string, string> = {
  protect: "补偿",
  suppress: "压制",
  none: "不处理",
};

const DEFAULT_PROTECT: AutoBalanceProtectConfig = {
  min_loss_score: 1500,
  min_rounds: 10,
  min_minutes: 15,
  min_room_players: 3,
  max_per_room: 1,
  daily_max_times: 1,
  cooldown_sec: 3600,
  target_value: 600,
  chance: 35,
  min_today_loss: 0,
};

const DEFAULT_SUPPRESS: AutoBalanceSuppressConfig = {
  mode: "advice",
  min_win_score: 2000,
  min_rounds: 15,
  min_victims: 2,
  daily_max_times: 2,
  cooldown_sec: 7200,
  target_value: 1200,
  chance: 40,
  min_today_win: 0,
};

const DEFAULT_LIMITS: AutoBalanceLimits = {
  max_active_total: 50,
  max_set_per_tick: 5,
  max_set_per_day: 200,
  idle_stop_sec: 600,
};

// 生效玩法固定走游戏服默认值，界面不暴露这个字段。
const DEFAULT_ROOM_PLAY_MODE = "传销扯旋";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function signed(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value.toLocaleString("zh-CN")}` : value.toLocaleString("zh-CN");
}

function duration(seconds: number): string {
  if (!seconds) return "0 分";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
}

function cooldownText(seconds: number): string {
  if (seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

// 已有目标要按真实目标值（existingTargetValue）判方向，不能用候选建议值 targetValue。
function existingTargetText(item: AutoBalanceCandidate): string {
  const value = item.existingTargetValue;
  const direction = value > 0 ? `补偿 ${signed(value)}` : value < 0 ? `压制 ${signed(value)}` : "方向未知";
  const source = item.existingTargetMan === "auto_balance" ? " · 自动" : item.existingTargetMan ? " · 手工" : "";
  return `已有目标（${direction}${source}）`;
}

export default function AutoBalancePage({
  can,
  notify,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [tab, setTab] = useState<Tab>("config");
  const [overview, setOverview] = useState<AutoBalanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<AutoBalanceOverview>("/api/game/auto-balance/config");
      setOverview(result);
      setError("");
      return result;
    } catch (cause) {
      setError(errorMessage(cause, "自动平衡配置读取失败"));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const enabled = Boolean(overview?.config?.enabled);
  const mode = String(overview?.config?.mode ?? "observe");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="平衡策略"
        title="自动输赢平衡"
        description="按本周期净输赢自动补偿大输玩家、压制大赢玩家；执行层沿用玩家控制的胜率目标。"
        actions={
          <>
            <span className={`optimization-status ${enabled ? "is-active" : ""}`}>
              <i />
              {enabled ? "总开关已开启" : "总开关已关闭"}
            </span>
            <span className={`ab-mode-badge is-${mode}`} title="当前运行模式">
              <i />
              <span>当前模式</span>
              <strong>{MODE_LABEL[mode] ?? "未知模式"}</strong>
            </span>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadOverview()}>
              刷新
            </Button>
          </>
        }
      />

      <div className="ab-tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "is-active" : ""}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {error && tab === "config" && <div className="form-error"><span>!</span>{error}</div>}

      {tab === "config" &&
        (loading && !overview ? (
          <LoadingBlock label="正在读取平衡配置" />
        ) : overview ? (
          <ConfigPanel
            can={can}
            notify={notify}
            overview={overview}
            onReload={loadOverview}
          />
        ) : null)}

      {tab === "candidates" && (
        <CandidatePanel can={can} notify={notify} overview={overview} onReloadOverview={loadOverview} />
      )}

      {tab === "teams" && <TeamPanel can={can} notify={notify} />}
    </div>
  );
}

function ConfigPanel({
  can,
  notify,
  overview,
  onReload,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  overview: AutoBalanceOverview;
  onReload: () => Promise<AutoBalanceOverview | null>;
}) {
  const canConfig = can("game.auto_balance.config");
  const [form, setForm] = useState<AutoBalanceConfig>(() => normalizeConfig(overview.config));
  // 排除玩家用标签管理、按底皮覆盖用分组卡片，都不再让运营手写 JSON / 多行文本。
  const [exclude, setExclude] = useState<string[]>(() => overview.config?.protect_exclude_guuids ?? []);
  const [dipiGroups, setDipiGroups] = useState<DipiGroup[]>(() => dipiGroupsFrom(overview.config?.by_dipi));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [saveError, setSaveError] = useState("");
  const originalRef = useRef(normalizeConfig(overview.config));

  useEffect(() => {
    const normalized = normalizeConfig(overview.config);
    originalRef.current = normalized;
    setForm(normalized);
    setExclude(overview.config?.protect_exclude_guuids ?? []);
    setDipiGroups(dipiGroupsFrom(overview.config?.by_dipi));
  }, [overview]);

  const dirty = useMemo(
    () => JSON.stringify(buildPayload(form, dipiGroups, exclude)) !== JSON.stringify(buildPayload(originalRef.current, dipiGroupsFrom(originalRef.current.by_dipi), originalRef.current.protect_exclude_guuids ?? [])),
    [form, dipiGroups, exclude],
  );

  const updateGroup = <K extends "protect" | "suppress" | "limits">(group: K, key: string, value: number | string) => {
    setForm((current) => ({
      ...current,
      [group]: { ...(current[group] as unknown as Record<string, unknown>), [key]: value },
    }));
  };

  const submit = async (confirm: boolean) => {
    setBusy(true);
    setSaveError("");
    try {
      const payload = buildPayload(form, dipiGroups, exclude);
      await api<{ config: AutoBalanceConfig }>("/api/game/auto-balance/config", {
        method: "PUT",
        ...jsonBody({ patch: payload, reason: reason.trim(), confirm }),
      });
      notify("平衡配置已保存");
      setReason("");
      setConfirmAuto(false);
      await onReload();
    } catch (cause) {
      setSaveError(errorMessage(cause, "平衡配置保存失败"));
      setConfirmAuto(false);
    } finally {
      setBusy(false);
    }
  };

  const onClickSave = () => {
    setSaveError("");
    const named = dipiGroups.filter((group) => group.name.trim() !== "");
    if (dipiGroups.some((group) => group.name.trim() === "")) {
      setSaveError("按底皮覆盖里有没填名称的底皮，请补上或删除");
      return;
    }
    const names = named.map((group) => group.name.trim());
    if (new Set(names).size !== names.length) {
      setSaveError("按底皮覆盖里有重复的底皮名称");
      return;
    }
    if (named.some((group) => group.rows.some((row) => !row.field))) {
      setSaveError("按底皮覆盖里有没选覆盖项的条目");
      return;
    }
    if (form.mode === "auto" && !confirmAuto) {
      setConfirmAuto(true);
      return;
    }
    void submit(true);
  };

  return (
    <>
      <section className="optimization-metrics">
        <article>
          <span>今日已下发</span>
          <strong>{overview.today.setCount}</strong>
          <p>含已经结束的自动目标</p>
        </article>
        <article>
          <span>当前进行中</span>
          <strong>{overview.today.active}</strong>
          <p>状态为 active 的自动目标</p>
        </article>
        <article>
          <span>伙牌名单</span>
          <strong>{overview.team.members}</strong>
          <p>{overview.team.teams} 个团队 / {overview.team.members} 名成员</p>
        </article>
        <article className="optimization-risk">
          <span>最近一次计算</span>
          <strong>{overview.lastTick || "尚未运行"}</strong>
          <p>每 60 秒自动计算一次</p>
        </article>
      </section>

      <section className="panel">
        <div className="configuration-card-heading">
          <div>
            <h2>平衡规则</h2>
            <p>数值合法性由游戏服在调用时收敛；这里保存的是下发值，回显以游戏服返回为准。</p>
          </div>
        </div>

        <div className="configuration-section">
          <h3>总开关与模式</h3>
          <p>关闭总开关会停掉全部自动目标；运行模式优先级最高。</p>
          <div className="form-grid">
            <Field label="总开关" hint="关闭时不计算也不下发">
              <select
                value={form.enabled ? "1" : "0"}
                disabled={!canConfig || busy}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.value === "1" }))}
              >
                <option value="0">关闭</option>
                <option value="1">开启</option>
              </select>
            </Field>
            <Field label="运行模式" hint="auto 会在命中时自动干预发牌">
              <select
                value={String(form.mode ?? "observe")}
                disabled={!canConfig || busy}
                onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
              >
                <option value="observe">只观察 · 只看不动手</option>
                <option value="advice">人工确认 · 出建议后手动执行</option>
                <option value="auto">自动执行 · 命中后直接下发</option>
              </select>
            </Field>
            <Field label="仅俱乐部模式" hint="非俱乐部模式不工作">
              <select
                value={form.require_club_mode === false ? "0" : "1"}
                disabled={!canConfig || busy}
                onChange={(event) => setForm((current) => ({ ...current, require_club_mode: event.target.value === "1" }))}
              >
                <option value="1">是</option>
                <option value="0">否</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="configuration-section">
          <h3>补偿规则</h3>
          <p>本周期净输达到阈值时给一把补偿；净输阈值填 0 表示关闭补偿。</p>
          <div className="form-grid">
            <NumberField label="净输阈值" value={form.protect?.min_loss_score ?? DEFAULT_PROTECT.min_loss_score} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "min_loss_score", value)} />
            <NumberField label="最少局数" value={form.protect?.min_rounds ?? DEFAULT_PROTECT.min_rounds} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "min_rounds", value)} />
            <NumberField label="最少在座分钟" value={form.protect?.min_minutes ?? DEFAULT_PROTECT.min_minutes} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "min_minutes", value)} />
            <NumberField label="房间最少人数" value={form.protect?.min_room_players ?? DEFAULT_PROTECT.min_room_players} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "min_room_players", value)} />
            <NumberField label="每房名额" value={form.protect?.max_per_room ?? DEFAULT_PROTECT.max_per_room} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "max_per_room", value)} />
            <NumberField label="每日次数" value={form.protect?.daily_max_times ?? DEFAULT_PROTECT.daily_max_times} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "daily_max_times", value)} />
            <NumberField label="冷却秒数" value={form.protect?.cooldown_sec ?? DEFAULT_PROTECT.cooldown_sec} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "cooldown_sec", value)} />
            <NumberField label="目标分（正数）" value={form.protect?.target_value ?? DEFAULT_PROTECT.target_value} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "target_value", value)} />
            <NumberField label="命中概率 %" value={form.protect?.chance ?? DEFAULT_PROTECT.chance} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "chance", value)} />
            <NumberField label="今日至少净输" value={form.protect?.min_today_loss ?? DEFAULT_PROTECT.min_today_loss} disabled={!canConfig || busy} onChange={(value) => updateGroup("protect", "min_today_loss", value)} />
          </div>
        </div>

        <div className="configuration-section">
          <h3>压制规则</h3>
          <p>压制对象必须先在伙牌名单里；名单为空时这条规则不会命中任何玩家。</p>
          <div className="form-grid">
            <Field label="压制执行方式" hint="人工确认只出建议，自动执行命中即下发">
              <select value={String(form.suppress?.mode ?? DEFAULT_SUPPRESS.mode)} disabled={!canConfig || busy} onChange={(event) => updateGroup("suppress", "mode", event.target.value)}>
                <option value="advice">人工确认 · 只出建议</option>
                <option value="auto">自动执行 · 命中即下发</option>
              </select>
            </Field>
            <NumberField label="净赢阈值" value={form.suppress?.min_win_score ?? DEFAULT_SUPPRESS.min_win_score} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "min_win_score", value)} />
            <NumberField label="最少局数" value={form.suppress?.min_rounds ?? DEFAULT_SUPPRESS.min_rounds} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "min_rounds", value)} />
            <NumberField label="最少受害人数" value={form.suppress?.min_victims ?? DEFAULT_SUPPRESS.min_victims} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "min_victims", value)} />
            <NumberField label="每日次数" value={form.suppress?.daily_max_times ?? DEFAULT_SUPPRESS.daily_max_times} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "daily_max_times", value)} />
            <NumberField label="冷却秒数" value={form.suppress?.cooldown_sec ?? DEFAULT_SUPPRESS.cooldown_sec} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "cooldown_sec", value)} />
            <NumberField label="目标分（落库取负）" value={form.suppress?.target_value ?? DEFAULT_SUPPRESS.target_value} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "target_value", value)} />
            <NumberField label="命中概率 %" value={form.suppress?.chance ?? DEFAULT_SUPPRESS.chance} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "chance", value)} />
            <NumberField label="今日至少净赢" value={form.suppress?.min_today_win ?? DEFAULT_SUPPRESS.min_today_win} disabled={!canConfig || busy} onChange={(value) => updateGroup("suppress", "min_today_win", value)} />
          </div>
        </div>

        <div className="configuration-section">
          <h3>限额</h3>
          <p>全服并发、单次下发、每日下发与离房停止的硬约束，超出后自动跳过。</p>
          <div className="form-grid">
            <NumberField label="全服并发上限" value={form.limits?.max_active_total ?? DEFAULT_LIMITS.max_active_total} disabled={!canConfig || busy} onChange={(value) => updateGroup("limits", "max_active_total", value)} />
            <NumberField label="单次计算上限" value={form.limits?.max_set_per_tick ?? DEFAULT_LIMITS.max_set_per_tick} disabled={!canConfig || busy} onChange={(value) => updateGroup("limits", "max_set_per_tick", value)} />
            <NumberField label="每日下发上限" value={form.limits?.max_set_per_day ?? DEFAULT_LIMITS.max_set_per_day} disabled={!canConfig || busy} onChange={(value) => updateGroup("limits", "max_set_per_day", value)} />
            <NumberField label="离房停止秒数" value={form.limits?.idle_stop_sec ?? DEFAULT_LIMITS.idle_stop_sec} disabled={!canConfig || busy} onChange={(value) => updateGroup("limits", "idle_stop_sec", value)} />
          </div>
        </div>

        <div className="configuration-section">
          <h3>保护排除玩家</h3>
          <p>名单里的玩家不参与补偿，也不占用伙牌名单表。输入玩家 ID 后按回车即可加入。</p>
          <GuuidTagInput value={exclude} disabled={!canConfig || busy} onChange={setExclude} />
        </div>

        <div className="configuration-section">
          <h3>按底皮覆盖</h3>
          <p>给某个底皮单独配阈值，没配到的字段沿用上面的全局值；底皮名没匹配上时也回退全局值。</p>
          <DipiEditor
            groups={dipiGroups}
            options={overview.dipiOptions ?? []}
            disabled={!canConfig || busy}
            onChange={setDipiGroups}
          />
        </div>

        <div className="configuration-section">
          <h3>修改说明</h3>
          <p>可选，写入操作审计，便于事后对账。</p>
          <Field label="本次修改原因">
            <input value={reason} maxLength={200} disabled={!canConfig || busy} onChange={(event) => setReason(event.target.value)} placeholder="如：上调补偿阈值，配合周末活动" />
          </Field>
        </div>

        {saveError && <div className="form-error" style={{ margin: "0 23px 18px" }}><span>!</span>{saveError}</div>}

        <div className={`configuration-savebar ${dirty ? "is-dirty" : ""}`}>
          <div>
            <strong>{dirty ? "有未保存的改动" : "配置已与游戏服一致"}</strong>
            <p>保存只提交本页字段；游戏服会做数值收敛，回显以返回结果为准。</p>
          </div>
          <Button type="button" variant="secondary" disabled={!canConfig || busy || !dirty} onClick={() => { setForm(normalizeConfig(overview.config)); setExclude(overview.config?.protect_exclude_guuids ?? []); setDipiGroups(dipiGroupsFrom(overview.config?.by_dipi)); setSaveError(""); }}>
            还原
          </Button>
          <Button type="button" disabled={!canConfig || busy || !dirty} onClick={onClickSave}>
            {busy ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </section>

      {confirmAuto && (
        <Modal title="确认切换到自动模式" eyebrow="高风险操作" onClose={() => setConfirmAuto(false)}>
          <div className="info-banner">
            切换后，游戏服会在满足阈值时<strong>自动干预发牌</strong>，无需人工确认。请确认名单、阈值与限额已经核对过。
          </div>
          <div className="form-actions" style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <Button type="button" variant="secondary" onClick={() => setConfirmAuto(false)}>取消</Button>
            <Button type="button" variant="danger" onClick={() => void submit(true)} disabled={busy}>
              我确认，切到 auto
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(event) => onChange(Math.trunc(Number(event.target.value) || 0))}
      />
    </Field>
  );
}

function normalizeConfig(source?: AutoBalanceConfig): AutoBalanceConfig {
  return {
    enabled: Boolean(source?.enabled),
    mode: String(source?.mode ?? "observe"),
    // 生效玩法不对外开放修改：固定用游戏服默认值，界面也不再展示这个字段。
    room_play_mode: DEFAULT_ROOM_PLAY_MODE,
    require_club_mode: source?.require_club_mode !== false,
    protect_exclude_guuids: source?.protect_exclude_guuids ?? [],
    by_dipi: source?.by_dipi ?? {},
    protect: { ...DEFAULT_PROTECT, ...(source?.protect ?? {}) },
    suppress: { ...DEFAULT_SUPPRESS, ...(source?.suppress ?? {}) },
    limits: { ...DEFAULT_LIMITS, ...(source?.limits ?? {}) },
  };
}

function buildPayload(form: AutoBalanceConfig, dipiGroups: DipiGroup[], exclude: string[]): Record<string, unknown> {
  const byDipi: Record<string, Record<string, number>> = {};
  for (const group of dipiGroups) {
    const name = group.name.trim();
    if (!name) continue;
    const fields: Record<string, number> = {};
    for (const row of group.rows) {
      if (!row.field) continue;
      fields[row.field] = Math.trunc(Number(row.value) || 0);
    }
    byDipi[name] = fields;
  }
  return {
    enabled: Boolean(form.enabled),
    mode: String(form.mode ?? "observe"),
    room_play_mode: DEFAULT_ROOM_PLAY_MODE,
    require_club_mode: form.require_club_mode !== false,
    protect_exclude_guuids: exclude,
    by_dipi: byDipi,
    protect: { ...DEFAULT_PROTECT, ...(form.protect ?? {}) },
    suppress: { ...DEFAULT_SUPPRESS, ...(form.suppress ?? {}) },
    limits: { ...DEFAULT_LIMITS, ...(form.limits ?? {}) },
  };
}

type DipiRow = { field: string; value: number };
type DipiGroup = { name: string; rows: DipiRow[] };

// 底皮覆盖用的是扁平字段名（不是嵌套 protect/suppress），所以这里对所有可覆盖项去重列出。
const DIPI_FIELDS: { value: string; label: string }[] = [
  { value: "min_loss_score", label: "净输阈值（补偿）" },
  { value: "min_win_score", label: "净赢阈值（压制）" },
  { value: "min_rounds", label: "最少局数（补偿/压制）" },
  { value: "min_minutes", label: "最少在座分钟" },
  { value: "min_room_players", label: "房间最少人数" },
  { value: "min_victims", label: "最少受害人数" },
  { value: "max_per_room", label: "每房名额" },
  { value: "daily_max_times", label: "每日次数（补偿/压制）" },
  { value: "cooldown_sec", label: "冷却秒数（补偿/压制）" },
  { value: "target_value", label: "目标分（补偿/压制）" },
  { value: "chance", label: "命中概率 %" },
  { value: "min_today_loss", label: "今日至少净输" },
  { value: "min_today_win", label: "今日至少净赢" },
  { value: "max_active_total", label: "全服并发上限" },
  { value: "max_set_per_tick", label: "单次计算上限" },
  { value: "max_set_per_day", label: "每日下发上限" },
  { value: "idle_stop_sec", label: "离房停止秒数" },
];

function dipiGroupsFrom(byDipi?: Record<string, Record<string, number>>): DipiGroup[] {
  if (!byDipi) return [];
  return Object.entries(byDipi).map(([name, fields]) => ({
    name,
    rows: Object.entries(fields ?? {}).map(([field, value]) => ({ field, value: Number(value) || 0 })),
  }));
}

function DipiEditor({
  groups,
  options,
  disabled,
  onChange,
}: {
  groups: DipiGroup[];
  options: { key: string; label: string }[];
  disabled?: boolean;
  onChange: (groups: DipiGroup[]) => void;
}) {
  const patch = (index: number, next: Partial<DipiGroup>) => {
    onChange(groups.map((group, current) => (current === index ? { ...group, ...next } : group)));
  };

  const addGroup = () => {
    // 新增时自动挑一个还没用过的档位，避免让运营在空值上再选一次。
    const used = new Set(groups.map((group) => group.name));
    const next = options.find((option) => !used.has(option.key));
    onChange([...groups, { name: next?.key ?? "", rows: [] }]);
  };

  return (
    <div className="ab-dipi">
      {groups.length === 0 && (
        <p className="ab-dipi__empty">还没有底皮覆盖，所有底皮都按上面的全局阈值执行。</p>
      )}
      {groups.map((group, index) => (
        <div className="ab-dipi-card" key={`dipi-${index}`}>
          <div className="ab-dipi-card__head">
            <label>
              <span>底皮</span>
              <select
                value={group.name}
                disabled={disabled}
                onChange={(event) => patch(index, { name: event.target.value })}
              >
                <option value="">选择底皮档位…</option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>{option.key}</option>
                ))}
                {/* 历史配置里如果有不在标准档位的键，保留可选项，避免保存时被抹掉。 */}
                {group.name !== "" && !options.some((option) => option.key === group.name) && (
                  <option value={group.name}>{group.name}（非标准档位）</option>
                )}
              </select>
            </label>
            <button
              type="button"
              className="is-danger"
              disabled={disabled}
              onClick={() => onChange(groups.filter((_, current) => current !== index))}
            >
              删除该底皮
            </button>
          </div>
          <div className="ab-dipi-card__rows">
            {group.rows.length === 0 && <span className="ab-dipi__hint">还没有覆盖项，这个底皮会完全沿用全局值。</span>}
            {group.rows.map((row, rowIndex) => (
              <div className="ab-dipi-row" key={`row-${rowIndex}`}>
                <select
                  value={row.field}
                  disabled={disabled}
                  onChange={(event) => patch(index, {
                    rows: group.rows.map((item, current) => (current === rowIndex ? { ...item, field: event.target.value } : item)),
                  })}
                >
                  <option value="">选择覆盖项…</option>
                  {DIPI_FIELDS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={Number.isFinite(row.value) ? row.value : 0}
                  disabled={disabled}
                  onChange={(event) => patch(index, {
                    rows: group.rows.map((item, current) => (current === rowIndex ? { ...item, value: Math.trunc(Number(event.target.value) || 0) } : item)),
                  })}
                />
                <button
                  type="button"
                  className="is-danger"
                  disabled={disabled}
                  onClick={() => patch(index, { rows: group.rows.filter((_, current) => current !== rowIndex) })}
                >
                  移除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ab-dipi-add"
              disabled={disabled}
              onClick={() => patch(index, { rows: [...group.rows, { field: "", value: 0 }] })}
            >
              ＋ 添加覆盖项
            </button>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" disabled={disabled || options.length === 0} onClick={addGroup}>
        ＋ 添加底皮覆盖
      </Button>
    </div>
  );
}

function GuuidTagInput({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [lastAdded, setLastAdded] = useState("");

  const add = async () => {
    const tokens = draft.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
    if (!tokens.length || checking) return;
    const invalid = tokens.filter((token) => !/^\d{4,12}$/.test(token));
    if (invalid.length) {
      setError(`这些不是有效的玩家 ID：${invalid.slice(0, 5).join("、")}`);
      return;
    }
    const pending = tokens.filter((token) => !value.includes(token));
    if (!pending.length) {
      setError("这些玩家已经在名单里了");
      return;
    }
    setChecking(true);
    setError("");
    try {
      // 必须经后台核对玩家真实存在，不能只靠格式校验，避免把打错的 ID 存进游戏服。
      const results = await Promise.all(pending.map(async (guuid) => {
        try {
          const found = await api<{ guuid: string; name: string }>(`/api/game/auto-balance/player?guuid=${encodeURIComponent(guuid)}`);
          return { guuid, name: found.name, ok: true as const };
        } catch (cause) {
          return { guuid, ok: false as const, message: errorMessage(cause, "查询失败") };
        }
      }));
      const passed = results.filter((item) => item.ok);
      const failed = results.filter((item) => !item.ok);
      if (passed.length) {
        const next = [...value];
        const nameMap = { ...names };
        for (const item of passed) {
          if (!next.includes(item.guuid)) next.push(item.guuid);
          if (item.name) nameMap[item.guuid] = item.name;
        }
        setNames(nameMap);
        onChange(next);
        setDraft("");
        setLastAdded(passed.map((item) => `${item.guuid}${item.name ? `（${item.name}）` : ""}`).slice(0, 3).join("、"));
      }
      if (failed.length) {
        setError(failed.map((item) => `${item.guuid}：${item.message}`).slice(0, 5).join("；"));
      } else {
        setError("");
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="ab-tags">
      <div className="ab-tags__box">
        {value.map((guuid) => (
          <span className="ab-tag" key={guuid} title={names[guuid] ?? "已通过玩家校验"}>
            {guuid}
            <button type="button" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== guuid))} aria-label={`移除 ${guuid}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled || checking}
          placeholder={checking ? "正在核对玩家…" : value.length ? "继续添加玩家 ID" : "输入玩家 ID，回车添加（会核对玩家是否存在）"}
          onChange={(event) => { setDraft(event.target.value); setError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            }
            if (event.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => { if (draft.trim()) void add(); }}
        />
      </div>
      <div className="ab-tags__foot">
        <span>{value.length} 个玩家{lastAdded ? ` · 最近添加 ${lastAdded}` : ""}</span>
        <div>
          <Button type="button" variant="secondary" disabled={disabled || checking || !draft.trim()} onClick={() => void add()}>
            {checking ? "核对中…" : "添加"}
          </Button>
          {value.length > 0 && (
            <Button type="button" variant="secondary" disabled={disabled} onClick={() => onChange([])}>清空</Button>
          )}
        </div>
      </div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
    </div>
  );
}

function CandidatePanel({
  can,
  notify,
  overview,
  onReloadOverview,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  overview: AutoBalanceOverview | null;
  onReloadOverview: () => Promise<AutoBalanceOverview | null>;
}) {
  const canExecute = can("game.auto_balance.execute");
  const [roomId, setRoomId] = useState("");
  const [limit, setLimit] = useState("100");
  const [query, setQuery] = useState({ roomId: "", limit: "100" });
  const [items, setItems] = useState<AutoBalanceCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "protect" | "suppress" | "hit" | "miss">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<AutoBalanceExecuteResponse | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopRemark, setStopRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const mode = String(overview?.config?.mode ?? "observe");
  const enabled = Boolean(overview?.config?.enabled);
  const executeBlocked = !enabled || mode === "observe";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ roomId: query.roomId || "0", limit: query.limit });
      const data = await api<AutoBalanceCandidateResponse>(`/api/game/auto-balance/candidates?${params.toString()}`);
      setItems(data.items);
      setSelected((current) => current.filter((guuid) => data.items.some((item) => item.guuid === guuid)));
    } catch (cause) {
      notify(errorMessage(cause, "候选列表加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // 游戏服不推送候选，页面自己按 30 秒轮询（Tick 60 秒一次，没必要更快）。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "hit") return items.filter((item) => item.hit);
    // 未命中只看 hit=0，不按 action 判断，避免以后 action 语义变化。
    if (filter === "miss") return items.filter((item) => !item.hit);
    return items.filter((item) => item.action === filter);
  }, [items, filter]);

  const selectable = (item: AutoBalanceCandidate) => item.hit && !item.hasTarget && item.cooldownLeft <= 0 && item.action !== "none";

  const toggle = (guuid: string) => {
    setSelected((current) => (current.includes(guuid) ? current.filter((item) => item !== guuid) : [...current, guuid]));
  };

  const runGuuids = async (guuids: string[]) => {
    if (!guuids.length) return;
    setBusy(true);
    try {
      const data = await api<AutoBalanceExecuteResponse>("/api/game/auto-balance/execute", {
        method: "POST",
        ...jsonBody({ action: "run_guuids", guuids: guuids.join(","), remark: "", reason: "" }),
      });
      setResult(data);
      setSelected([]);
      notify(`已下发 ${data.ok.length} 个，失败 ${data.failed.length} 个`, data.failed.length ? "error" : "success");
      await load();
      await onReloadOverview();
    } catch (cause) {
      notify(errorMessage(cause, "执行失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const runTick = async () => {
    setBusy(true);
    try {
      const data = await api<AutoBalanceExecuteResponse>("/api/game/auto-balance/execute", {
        method: "POST",
        ...jsonBody({ action: "run", guuids: "", remark: "", reason: "" }),
      });
      setResult(data);
      notify(`本次计算下发 ${data.ok.length} 个`, "success");
      await load();
      await onReloadOverview();
    } catch (cause) {
      notify(errorMessage(cause, "执行失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async () => {
    setBusy(true);
    try {
      const data = await api<AutoBalanceExecuteResponse>("/api/game/auto-balance/execute", {
        method: "POST",
        ...jsonBody({ action: "stop_all", guuids: "", remark: stopRemark.trim(), reason: "" }),
      });
      setResult(data);
      setStopOpen(false);
      setStopRemark("");
      notify(`已停止 ${data.ok.length} 个目标`, "success");
      await load();
      await onReloadOverview();
    } catch (cause) {
      notify(errorMessage(cause, "一键全停失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#5e767c", fontWeight: 700 }}>
              房间号
              <input
                inputMode="numeric"
                value={roomId}
                onChange={(event) => setRoomId(event.target.value.replace(/\D/g, ""))}
                placeholder="0=全部"
                style={{ width: 130, height: 38, padding: "0 10px", border: "1px solid #dce7e8", borderRadius: 8, background: "#f9fbfb" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#5e767c", fontWeight: 700 }}>
              条数
              <select value={limit} onChange={(event) => setLimit(event.target.value)} style={{ height: 38, borderRadius: 8, border: "1px solid #dce7e8", padding: "0 8px" }}>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#5e767c", fontWeight: 700 }}>
              动作
              <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} style={{ height: 38, borderRadius: 8, border: "1px solid #dce7e8", padding: "0 8px" }}>
                <option value="all">全部</option>
                <option value="hit">仅命中</option>
                <option value="miss">未命中</option>
                <option value="protect">补偿</option>
                <option value="suppress">压制</option>
              </select>
            </label>
            <Button type="button" variant="secondary" onClick={() => { setQuery({ roomId, limit }); }} disabled={loading}>
              查询
            </Button>
            <span className="toolbar__count">{loading ? "读取中…" : `${visible.length} / ${items.length} 名玩家`}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canExecute && (
              <Button type="button" variant="secondary" disabled={busy || executeBlocked} onClick={() => void runTick()} title={executeBlocked ? "总开关没开，或是只观察模式" : "按当前模式算一次"}>
                立即跑一次
              </Button>
            )}
            {canExecute && (
              <Button type="button" variant="danger" disabled={busy} onClick={() => setStopOpen(true)}>
                一键全停
              </Button>
            )}
          </div>
        </div>

        {executeBlocked && (
          <div className="info-banner" style={{ margin: "14px 18px 0" }}>
            当前{enabled ? "是只观察模式" : "总开关没开"}，候选只能看、不会下发。要下发请到「配置与总览」切换模式。
          </div>
        )}
        <p style={{ padding: "12px 18px 0", color: "#758b90", fontSize: 12 }}>
          「今日累计」显示未开启，表示后台没开日累计查询，不是 0；候选数据每 60 秒随计算更新一次。
        </p>

        {selected.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" }}>
            <span style={{ fontSize: 13, color: "#29434b" }}>已选 {selected.length} 名玩家</span>
            <Button type="button" disabled={busy || executeBlocked} onClick={() => void runGuuids(selected)}>对所选执行</Button>
            <Button type="button" variant="secondary" onClick={() => setSelected([])}>清空选择</Button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <LoadingBlock label="正在读取候选玩家" />
        ) : visible.length === 0 ? (
          <EmptyState title="当前没有候选玩家" description="可能所有玩家都在阈值内，或当前房间没有符合条件的玩家。" />
        ) : (
          <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>玩家</th>
                  <th>房间</th>
                  <th>本周期净输赢</th>
                  <th>局数</th>
                  <th>在座</th>
                  <th>今日累计</th>
                  <th>团队</th>
                  <th>动作</th>
                  <th>目标 / 概率</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={`${item.guuid}-${item.roomId}`} style={item.hit ? undefined : { opacity: 0.55 }}>
                    <td>
                      <input type="checkbox" checked={selected.includes(item.guuid)} disabled={!canExecute || !selectable(item) || executeBlocked} onChange={() => toggle(item.guuid)} />
                    </td>
                    <td>
                      <div className="user-cell">
                        <span>{(item.nick || "玩").slice(0, 1)}</span>
                        <div>
                          <strong>{item.nick || "未设置昵称"}</strong>
                          <small>ID：{item.guuid}</small>
                        </div>
                      </div>
                    </td>
                    <td>{item.roomId || "—"}</td>
                    <td>
                      <strong style={{ color: item.periodNet > 0 ? "#c0392b" : item.periodNet < 0 ? "#1f8a5f" : undefined }}>
                        {signed(item.periodNet)}
                      </strong>
                      <small className="cell-subtitle">带入 {item.init}</small>
                    </td>
                    <td>{item.rounds}</td>
                    <td>{duration(item.seconds)}</td>
                    <td>{item.todayNet === null ? "未开启" : signed(item.todayNet)}</td>
                    <td>{item.teamName || "—"}</td>
                    <td>
                      <span className={`pill ${item.action === "protect" ? "pill--enabled" : item.action === "suppress" ? "pill--disabled" : ""}`}>
                        <i />
                        {ACTION_LABEL[item.action] ?? "未知"}
                      </span>
                      {!item.hit && <small className="cell-subtitle">未命中</small>}
                    </td>
                    <td>
                      {item.action === "none" ? "—" : <><strong>{signed(item.targetValue)}</strong><small className="cell-subtitle">{item.chance}%</small></>}
                    </td>
                    <td title={item.hasTarget && item.existingTargetTime ? `目标设置时间 ${item.existingTargetTime}` : undefined}>
                      {item.hasTarget
                        ? existingTargetText(item)
                        : item.cooldownLeft > 0
                          ? `冷却 ${cooldownText(item.cooldownLeft)}`
                          : item.hit
                            ? "可执行"
                            : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          disabled={!canExecute || busy || executeBlocked || !selectable(item)}
                          onClick={() => void runGuuids([item.guuid])}
                        >
                          执行
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {stopOpen && (
        <Modal title="确认停掉全部自动目标" eyebrow="高风险操作" onClose={() => setStopOpen(false)}>
          <div className="info-banner">
            会停止当前所有进行中的<strong>自动平衡</strong>目标；人工设置的胜率目标不受影响。停止后无法恢复进度。
          </div>
          <Field label="停止原因" hint="必填，写入操作审计">
            <input value={stopRemark} maxLength={250} onChange={(event) => setStopRemark(event.target.value)} placeholder="如：活动结束，一键全停" />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <Button type="button" variant="secondary" onClick={() => setStopOpen(false)}>取消</Button>
            <Button type="button" variant="danger" disabled={busy || !stopRemark.trim()} onClick={() => void stopAll()}>确认全停</Button>
          </div>
        </Modal>
      )}

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
    </>
  );
}

function ResultModal({ result, onClose }: { result: AutoBalanceExecuteResponse; onClose: () => void }) {
  return (
    <Modal title="执行结果" eyebrow="下发明细" onClose={onClose} wide>
      <EntryList title="成功" tone="ok" entries={result.ok} />
      <EntryList title="失败" tone="failed" entries={result.failed} />
      <EntryList title="已停止" tone="stopped" entries={result.stopped} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button type="button" onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  );
}

function EntryList({ title, tone, entries }: { title: string; tone: "ok" | "failed" | "stopped"; entries: AutoBalanceEntry[] }) {
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <strong style={{ fontSize: 14, color: tone === "failed" ? "#bf4655" : "#29434b" }}>{title}（{entries.length}）</strong>
      <div style={{ marginTop: 8, display: "grid", gap: 6, maxHeight: 220, overflow: "auto" }}>
        {entries.map((entry, index) => (
          <div key={`${entry.guuid}-${index}`} style={{ display: "flex", gap: 10, fontSize: 13, color: "#506a71", borderBottom: "1px solid #f0f4f4", paddingBottom: 6 }}>
            <strong style={{ color: "#29434b" }}>{entry.guuid}</strong>
            {entry.name && <span>{entry.name}</span>}
            {entry.action && <span>{ACTION_LABEL[entry.action] ?? "未知"}</span>}
            {typeof entry.target_value === "number" && <span>{signed(entry.target_value)} / {entry.chance ?? 0}%</span>}
            {entry.error && <span style={{ color: "#bf4655" }}>{entry.error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamPanel({
  can,
  notify,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const canTeam = can("game.auto_balance.team");
  const [teams, setTeams] = useState<AutoBalanceTeam[]>([]);
  const [members, setMembers] = useState<AutoBalanceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTeam, setActiveTeam] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ teamName: string; member?: AutoBalanceMember } | null>(null);
  const [result, setResult] = useState<AutoBalanceTeamWriteResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<AutoBalanceTeamsResponse>("/api/game/auto-balance/teams");
      setTeams(data.teams);
      setMembers(data.members);
      setActiveTeam((current) => (current && data.teams.some((team) => team.teamName === current) ? current : data.teams[0]?.teamName ?? ""));
    } catch (cause) {
      notify(errorMessage(cause, "伙牌名单加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamMembers = useMemo(
    () => members.filter((member) => member.teamName === activeTeam),
    [members, activeTeam],
  );

  const removeMembers = async (teamName: string, guuids: string) => {
    try {
      const data = await api<AutoBalanceTeamWriteResponse>("/api/game/auto-balance/teams/members", {
        method: "DELETE",
        ...jsonBody({ teamName, guuids, reason: "" }),
      });
      setResult(data);
      setRemoveTarget(null);
      notify(`已移除 ${data.ok.length} 人${data.stopped.length ? `，停止 ${data.stopped.length} 个目标` : ""}`, "success");
      await load();
    } catch (cause) {
      notify(errorMessage(cause, "移除失败"), "error");
    }
  };

  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <div>
            <strong style={{ display: "block", color: "#29434b", fontSize: 16 }}>伙牌名单</strong>
            <span style={{ display: "block", marginTop: 4, color: "#819499", fontSize: 12 }}>
              只有「生效」状态的成员参与压制；名单改动约 1 分钟内生效。
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>刷新</Button>
            {canTeam && <Button type="button" variant="secondary" onClick={() => setImportOpen(true)}>从分组导入</Button>}
            {canTeam && <Button type="button" onClick={() => setAddOpen(true)}>＋ 添加成员</Button>}
          </div>
        </div>

        {loading && teams.length === 0 ? (
          <LoadingBlock label="正在读取伙牌名单" />
        ) : teams.length === 0 ? (
          <EmptyState title="名单还是空的" description="可以手工添加玩家，或从俱乐部玩家分组批量导入。压制规则在名单为空时不会命中任何人。" />
        ) : (
          <div className="ab-team-layout">
            <aside className="ab-team-list">
              {teams.map((team) => (
                <button
                  key={team.teamName}
                  type="button"
                  className={team.teamName === activeTeam ? "is-active" : ""}
                  onClick={() => setActiveTeam(team.teamName)}
                >
                  <strong>{team.teamName}</strong>
                  <span>{team.memberCount} 人 · {team.updateDate || "—"}</span>
                </button>
              ))}
            </aside>
            <div className="ab-team-detail">
              <div className="ab-team-detail__head">
                <div>
                  <strong>{activeTeam}</strong>
                  <span>{teamMembers.length} 名成员</span>
                </div>
                {canTeam && (
                  <Button type="button" variant="danger" onClick={() => setRemoveTarget({ teamName: activeTeam })}>
                    整队移除
                  </Button>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>玩家</th>
                      <th>俱乐部</th>
                      <th>今日净输赢</th>
                      <th>今日局数</th>
                      <th>状态</th>
                      <th>备注</th>
                      <th>操作人</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map((member) => (
                      <tr key={member.guuid}>
                        <td>
                          <div className="user-cell">
                            <span>{(member.name || "玩").slice(0, 1)}</span>
                            <div>
                              <strong>{member.name || "未设置昵称"}</strong>
                              <small>ID：{member.guuid}</small>
                            </div>
                          </div>
                        </td>
                        <td>{member.clubId || "—"}</td>
                        <td>
                          <strong style={{ color: member.todayNet === null ? undefined : (member.todayNet ?? 0) > 0 ? "#c0392b" : (member.todayNet ?? 0) < 0 ? "#1f8a5f" : undefined }}>
                            {member.todayNet === null ? "未开启" : signed(member.todayNet)}
                          </strong>
                        </td>
                        <td>{member.todayRounds}</td>
                        <td>
                          <span className={`pill ${member.status === "used" ? "pill--enabled" : "pill--disabled"}`}>
                            <i />
                            {member.status === "used" ? "生效" : member.status === "deleted" ? "已移除" : "未知"}
                          </span>
                        </td>
                        <td>{member.remark || "—"}</td>
                        <td>{member.operator || "—"}</td>
                        <td>
                          <div className="row-actions">
                            {canTeam && member.status === "used" && (
                              <button type="button" className="is-danger" onClick={() => setRemoveTarget({ teamName: activeTeam, member })}>
                                移除
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      {addOpen && (
        <AddMembersModal
          teams={teams.map((team) => team.teamName)}
          defaultTeam={activeTeam}
          notify={notify}
          onClose={() => setAddOpen(false)}
          onDone={async () => { setAddOpen(false); await load(); }}
        />
      )}

      {importOpen && (
        <ImportModal
          notify={notify}
          onClose={() => setImportOpen(false)}
          onDone={async () => { setImportOpen(false); await load(); }}
        />
      )}

      {removeTarget && (
        <Modal
          title={removeTarget.member ? "移除成员" : "整队移除"}
          eyebrow="软删除"
          onClose={() => setRemoveTarget(null)}
        >
          <div className="info-banner">
            软删除，不会物理删除记录；<strong>重新导入分组不会复活</strong>被移除的成员。
            {removeTarget.member ? " 该成员的保护目标会被停止，压制目标保留。" : " 该团队所有成员会被移除。"}
          </div>
          <p style={{ marginTop: 12, color: "#506a71", fontSize: 13 }}>
            {removeTarget.member ? `玩家 ${removeTarget.member.guuid}（${removeTarget.member.name || "未设置昵称"}）` : `团队「${removeTarget.teamName}」`}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <Button type="button" variant="secondary" onClick={() => setRemoveTarget(null)}>取消</Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void removeMembers(removeTarget.teamName, removeTarget.member?.guuid ?? "")}
            >
              确认移除
            </Button>
          </div>
        </Modal>
      )}

      {result && <ResultModal result={{ action: "team", ok: result.ok, failed: result.failed, stopped: result.stopped }} onClose={() => setResult(null)} />}
    </>
  );
}

function AddMembersModal({
  teams,
  defaultTeam,
  notify,
  onClose,
  onDone,
}: {
  teams: string[];
  defaultTeam: string;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [teamName, setTeamName] = useState(defaultTeam);
  const [guuids, setGuuids] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AutoBalanceTeamWriteResponse | null>(null);

  const count = guuids.split(/[\s,，;；]+/).filter(Boolean).length;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<AutoBalanceTeamWriteResponse>("/api/game/auto-balance/teams/members", {
        method: "POST",
        ...jsonBody({ teamName: teamName.trim(), guuids: guuids.trim(), remark: remark.trim(), reason: "" }),
      });
      if (data.failed.length === 0) {
        notify(`已加入 ${data.ok.length} 人${data.stopped.length ? `，停止 ${data.stopped.length} 个保护目标` : ""}`, "success");
        await onDone();
        return;
      }
      setResult(data);
    } catch (cause) {
      setError(errorMessage(cause, "添加成员失败"));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="部分成员未加入" eyebrow="添加结果" onClose={() => void onDone()} wide>
        <EntryList title="成功" tone="ok" entries={result.ok} />
        <EntryList title="失败" tone="failed" entries={result.failed} />
        <EntryList title="已停保护目标" tone="stopped" entries={result.stopped} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button type="button" onClick={() => void onDone()}>知道了</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="添加伙牌成员" eyebrow="新增成员" onClose={busy ? () => undefined : onClose} wide>
      <form onSubmit={submitGuard(submit)}>
        <div className="form-grid">
          <Field label="团队名" hint="不存在则新建；同一分组请始终用同一个名字">
            <input list="ab-team-options" value={teamName} maxLength={60} disabled={busy} onChange={(event) => setTeamName(event.target.value)} placeholder="如：A组" />
            <datalist id="ab-team-options">
              {teams.map((team) => <option key={team} value={team} />)}
            </datalist>
          </Field>
          <Field label="备注" hint="可选，最长 250 字">
            <input value={remark} maxLength={250} disabled={busy} onChange={(event) => setRemark(event.target.value)} />
          </Field>
          <div className="form-grid__full">
            <Field label="玩家 ID" hint={`逗号或换行分隔，单次最多 200 个（当前 ${count} 个）`}>
              <textarea rows={6} value={guuids} disabled={busy} onChange={(event) => setGuuids(event.target.value)} placeholder={"496702\n718968"} />
            </Field>
          </div>
        </div>
        {error && <div className="form-error" style={{ marginTop: 14 }}><span>!</span>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" disabled={busy || !teamName.trim() || count === 0}>{busy ? "提交中…" : "加入名单"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({
  notify,
  onClose,
  onDone,
}: {
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [groups, setGroups] = useState<AutoBalanceGroup[]>([]);
  const [warning, setWarning] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [prefix, setPrefix] = useState("导入-");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AutoBalanceImportResponse | null>(null);
  const [imported, setImported] = useState<AutoBalanceImportResponse | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await api<AutoBalanceGroupsResponse>("/api/game/auto-balance/groups");
        if (!alive) return;
        setGroups(data.items);
        setWarning(data.warning ?? "");
      } catch (cause) {
        if (alive) setError(errorMessage(cause, "分组列表加载失败"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (id: number) => {
    setPreview(null);
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError("");
    try {
      const data = await api<AutoBalanceImportResponse>("/api/game/auto-balance/teams/import", {
        method: "POST",
        ...jsonBody({ groupIds: selected, teamPrefix: prefix.trim(), dryRun, reason: "" }),
      });
      if (dryRun) {
        setPreview(data);
      } else {
        setImported(data);
        notify(`导入完成：${data.teams} 个团队 ${data.members} 人`, "success");
        await onDone();
      }
    } catch (cause) {
      setError(errorMessage(cause, "导入失败"));
    } finally {
      setBusy(false);
    }
  };

  if (imported) {
    return (
      <Modal title="导入完成" eyebrow="导入结果" onClose={() => void onDone()} wide>
        <div className="info-banner">
          涉及 {imported.teams} 个团队、{imported.members} 名成员，影响 {imported.affected} 行；名单约 1 分钟内生效。
        </div>
        <EntryList title="已停保护目标" tone="stopped" entries={imported.stopped} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button type="button" onClick={() => void onDone()}>完成</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="从玩家分组导入" eyebrow="按分组导入" onClose={busy ? () => undefined : onClose} wide>
      <div className="info-banner">
        导入是一次性快照：<strong>只加不删</strong>，分组后续变动需要重新导入；已手工移除的成员不会被复活。
      </div>
      {warning && <div className="form-error" style={{ marginTop: 12 }}><span>!</span>{warning}</div>}
      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label="团队名前缀" hint="同一分组请始终用同一前缀，否则会产生重复团队">
          <input value={prefix} maxLength={40} disabled={busy} onChange={(event) => setPrefix(event.target.value)} />
        </Field>
        <Field label="已选分组">
          <input value={`${selected.length} 个分组`} disabled readOnly />
        </Field>
      </div>

      {loading ? (
        <LoadingBlock label="正在读取玩家分组" />
      ) : groups.length === 0 ? (
        <EmptyState title="没有可用分组" description="先在俱乐部或联盟里创建玩家分组并加入成员，再回来导入。" />
      ) : (
        <div className="ab-group-list">
          {groups.map((group) => (
            <label key={group.id} className={selected.includes(group.id) ? "is-active" : ""}>
              <input type="checkbox" checked={selected.includes(group.id)} disabled={busy} onChange={() => toggle(group.id)} />
              <div>
                <strong>{group.groupName}</strong>
                <span>
                  {group.scopeType === "union" ? "联盟" : "俱乐部"} {group.scopeId} · {group.memberCount} 人 · 更新 {group.updateDate || "—"}
                </span>
              </div>
            </label>
          ))}
        </div>
      )}

      {preview && (
        <div className="info-banner" style={{ marginTop: 14 }}>
          预估：将导入 {preview.teams} 个团队、{preview.members} 名成员（去重后）。
        </div>
      )}
      {error && <div className="form-error" style={{ marginTop: 12 }}><span>!</span>{error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
        <Button type="button" variant="secondary" disabled={busy || selected.length === 0} onClick={() => void run(true)}>
          只预估
        </Button>
        <Button type="button" disabled={busy || selected.length === 0} onClick={() => void run(false)}>
          {busy ? "导入中…" : "确认导入"}
        </Button>
      </div>
    </Modal>
  );
}
