import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, LoadingBlock, Modal, submitGuard } from "./ui";
import { beijingDateInput } from "../time";
import type {
  HonorRankActivity,
  HonorRankActivityDetail,
  HonorRankRankingResponse,
  HonorRankScopeOption,
  HonorRankType,
} from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

const PLAY_DIPIS = ["1皮", "2皮", "5皮", "10皮", "20皮"];

interface BoardSpec {
  type: HonorRankType;
  name: string;
  hint: string;
  dipis: string[];
}

const BOARD_SPECS: BoardSpec[] = [
  { type: "play", name: "玩家手数榜", hint: "按有效手数（局）排名；5 个档位共用这个开关，奖励按档位各配一份", dipis: PLAY_DIPIS },
  { type: "score", name: "玩家赢分榜", hint: "按俱乐部积分排名，只显示赢分为正的成员", dipis: [""] },
  { type: "bonus", name: "代理红利榜", hint: "按代理红利（元）排名，代理查看按展示折扣缩放", dipis: [""] },
];

const PHASE_LABELS: Record<HonorRankActivity["phase"], string> = {
  pending: "未开始",
  running: "进行中",
  finished: "已结束",
  closed: "已关闭",
};

type Boards = Record<HonorRankType, { on: boolean; rewards: string[] }>;
function emptyBoards(): Boards {
  return {
    play: { on: false, rewards: PLAY_DIPIS.map(() => "") },
    score: { on: false, rewards: [""] },
    bonus: { on: false, rewards: [""] },
  };
}

function boardsFromActivity(activity: HonorRankActivity): Boards {
  const result = emptyBoards();
  for (const spec of BOARD_SPECS) {
    const board = (activity.boards || []).find((item) => item.rankType === spec.type);
    result[spec.type] = {
      on: !!board?.on,
      rewards: spec.dipis.map((dipi) => {
        const row = board?.rewards?.find((item) => item.dipi === dipi);
        return row?.list || "";
      }),
    };
  }
  return result;
}

function toSubmitBoards(boards: Boards) {
  return BOARD_SPECS.map((spec) => ({
    rankType: spec.type,
    on: boards[spec.type].on,
    rewards: spec.dipis.map((dipi, index) => ({ dipi, list: boards[spec.type].rewards[index] || "" })),
  }));
}

/** 名次奖励输入校验：空返回 ""，由调用方按"启用的榜必填"决定要不要拦。 */
export function rewardListError(text: string): string {
  const raw = (text || "").trim();
  if (raw === "") return "";
  if (/[，、；;]/.test(raw)) return "请用英文逗号分隔，例如 100,50,20";
  const parts = raw.split(",");
  if (parts.length > 100) return "名次奖励最多 100 项";
  for (const part of parts) {
    const value = part.trim();
    if (value === "") return "有空的项，检查是不是多打了逗号";
    if (!/^\d+$/.test(value)) return `「${value}」只能填整数金额`;
    const amount = Number(value);
    if (amount <= 0) return "金额必须大于 0";
    if (amount > 1_000_000) return "金额不能超过 1,000,000";
  }
  return "";
}

function splitClock(value: string): string {
  return (value || "").slice(0, 5);
}

/**
 * 排行榜活动弹窗：新建（可选联盟 / 独立俱乐部）与查看（配置 + 实时排名）。
 *
 * 配置项与俱乐部/联盟行内的「排行榜」完全一致：总开关 + 三榜开关 + 一组共用起止时间 +
 * 每个榜每个手数档位的名次奖励。保存时后台把「总开关 + 三榜 + 共用时间」展开成 7 行下发游戏服，
 * 同时在后台留档一条活动记录，历史活动才能在列表里回看。
 */
export default function HonorRankActivityModal({
  activityId,
  canEdit,
  notify,
  onClose,
  onSaved,
}: {
  activityId: number | null;
  canEdit: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const creating = activityId === null;
  const [detail, setDetail] = useState<HonorRankActivityDetail | null>(null);
  const [loading, setLoading] = useState(!creating);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"config" | "ranking">("config");

  const [scopeType, setScopeType] = useState<"union" | "club">("union");
  const [scopeId, setScopeId] = useState("");
  const [scopeKeyword, setScopeKeyword] = useState("");
  const [scopeOptions, setScopeOptions] = useState<HonorRankScopeOption[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);

  const [activityOn, setActivityOn] = useState(true);
  const [startDate, setStartDate] = useState(() => beijingDateInput());
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState(() => beijingDateInput(7));
  const [endTime, setEndTime] = useState("23:59");
  const [boards, setBoards] = useState<Boards>(emptyBoards);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (creating) return;
    let alive = true;
    setLoading(true);
    api<HonorRankActivityDetail>(`/api/game/honor-rank/activities/${activityId}`)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        setError("");
        const activity = data.activity;
        setScopeType(activity.scopeType);
        setScopeId(activity.scopeId);
        setActivityOn(activity.activityOn);
        setStartDate(activity.startDate);
        setStartTime(splitClock(activity.startTime));
        setEndDate(activity.endDate);
        setEndTime(splitClock(activity.endTime));
        setBoards(boardsFromActivity(activity));
        setNote(activity.note || "");
      })
      .catch((reason) => {
        if (alive) setError(errorMessage(reason, "读取排行榜活动失败"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activityId, creating]);

  // 新建时才需要选范围；关键字搜索走后台的 scope 接口，不依赖俱乐部/联盟菜单权限。
  useEffect(() => {
    if (!creating) return;
    let alive = true;
    setScopeLoading(true);
    const query = new URLSearchParams({ scopeType, keyword: scopeKeyword.trim() });
    api<{ items: HonorRankScopeOption[] }>(`/api/game/honor-rank/scopes?${query}`)
      .then((data) => {
        if (alive) setScopeOptions(data.items || []);
      })
      .catch(() => {
        if (alive) setScopeOptions([]);
      })
      .finally(() => {
        if (alive) setScopeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [creating, scopeType, scopeKeyword]);

  const activity = detail?.activity || null;
  // 已有活动可直接改（重新下发游戏服配置并更新这条留档）；已被后续活动取代的只读。
  const editable = canEdit && (creating || !!detail?.canEdit);
  const noteLength = Array.from(note.trim()).length;
  const openedBoards = useMemo(
    () => BOARD_SPECS.filter((spec) => boards[spec.type].on).map((spec) => spec.name),
    [boards],
  );
  const scheduleReady = !!(startDate && startTime && endDate && endTime);
  // 只有"活动开启 + 该榜开关打开"才要求金额；空=必填，填了但不合法=格式错误。
  const rewardState = useMemo(() => {
    const format: Record<string, string[]> = {};
    const missing: string[] = [];
    BOARD_SPECS.forEach(spec => {
      const enabled = activityOn && boards[spec.type].on;
      const texts = boards[spec.type].rewards;
      // 逐项只报格式错误；"必填"按榜判断——手数榜允许只给部分档位配奖。
      format[spec.type] = spec.dipis.map((dipi, index) => rewardListError(texts[index] || ""));
      if (enabled && !texts.some(text => (text || "").trim() !== "")) missing.push(spec.name);
    });
    return { format, missing };
  }, [boards, activityOn]);
  const hasRewardFormatError = Object.keys(rewardState.format).some(type => rewardState.format[type].some(Boolean));
  const hasScope = creating ? scopeId.trim() !== "" : true;
  const canSubmit = editable && !busy && !loading && hasScope && confirmed && noteLength >= 2 && noteLength <= 120 &&
    (!activityOn || (scheduleReady && openedBoards.length > 0 && rewardState.missing.length === 0 && !hasRewardFormatError));

  const setBoard = (type: HonorRankType, patch: Partial<{ on: boolean; rewards: string[] }>) =>
    setBoards((current) => ({ ...current, [type]: { ...current[type], ...patch } }));

  const setBoardReward = (type: HonorRankType, index: number, value: string) =>
    setBoards((current) => {
      const rewards = current[type].rewards.slice();
      rewards[index] = value;
      return { ...current, [type]: { ...current[type], rewards } };
    });

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        scopeType,
        scopeId: scopeId.trim(),
        activityOn,
        startDate,
        startTime,
        endDate,
        endTime,
        boards: toSubmitBoards(boards),
        note: note.trim(),
        confirm: true,
      };
      const result = creating
        ? await api<HonorRankActivityDetail>("/api/game/honor-rank/activities", {
            method: "POST",
            ...jsonBody(payload),
          })
        : await api<HonorRankActivityDetail>(`/api/game/honor-rank/activities/${activityId}`, {
            method: "PUT",
            ...jsonBody(payload),
          });
      notify(result.message || (creating ? "排行榜活动已创建" : "排行榜活动已更新"), "success");
      onSaved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, creating ? "保存排行榜活动失败" : "修改排行榜活动失败"));
    } finally {
      setBusy(false);
    }
  };

  const closeActivity = async () => {
    if (!activity || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>(`/api/game/honor-rank/activities/${activity.id}/close`, {
        method: "POST",
      });
      notify(result.message || "活动已结束", "success");
      onSaved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, "结束活动失败"));
    } finally {
      setBusy(false);
    }
  };

  const title = creating
    ? "创建排行榜活动"
    : `${activity?.scopeType === "club" ? "俱乐部" : "联盟"}·${activity?.scopeName || activity?.scopeId || ""} 排行榜`;

  return (
    <Modal title={title} eyebrow={creating ? "NEW HONOR RANK ACTIVITY" : `ACTIVITY #${activityId}`} onClose={onClose} xwide>
      {!creating && activity && (
        <div className="honor-rank-activity-head">
          <div>
            <span>活动状态</span>
            <strong className={`honor-rank-phase honor-rank-phase--${activity.phase}`}>{PHASE_LABELS[activity.phase]}</strong>
          </div>
          <div>
            <span>活动时间</span>
            <strong>
              {activity.startDate} {splitClock(activity.startTime)} ~ {activity.endDate} {splitClock(activity.endTime)}
            </strong>
          </div>
          <div>
            <span>游戏服同步</span>
            <strong>{detail?.inSync ? "与本次配置一致" : (detail?.message || "已被后续修改")}</strong>
          </div>
          <div>
            <span>创建</span>
            <strong>{activity.createdBy || "—"} · {activity.createdAt}</strong>
          </div>
          {activity.superseded && (
            <div className="honor-rank-activity-head__warn">
              该范围已有更新的活动，这里只做为历史记录查看（改配置或结束请到最新活动操作）。
            </div>
          )}
        </div>
      )}

      {!creating && (
        <div className="balance-action-tabs honor-rank-activity-tabs">
          <button type="button" className={tab === "config" ? "is-active" : ""} onClick={() => setTab("config")}>
            活动配置
          </button>
          <button type="button" className={tab === "ranking" ? "is-active" : ""} onClick={() => setTab("ranking")}>
            实时排名
          </button>
        </div>
      )}

      {loading ? (
        <LoadingBlock label="读取排行榜活动…" />
      ) : tab === "ranking" && !creating ? (
        <RankingPanel activity={activity} />
      ) : (
        <form className="form-grid" onSubmit={submitGuard(submit)}>
          {error && (
            <div className="form-error form-grid__full">
              <span>!</span>
              {error}
            </div>
          )}

          {creating ? (
            <>
              <div className="form-grid__full">
                <div className="balance-action-tabs">
                  <button
                    type="button"
                    className={scopeType === "union" ? "is-active" : ""}
                    onClick={() => {
                      setScopeType("union");
                      setScopeId("");
                    }}
                  >
                    面向联盟
                  </button>
                  <button
                    type="button"
                    className={scopeType === "club" ? "is-active" : ""}
                    onClick={() => {
                      setScopeType("club");
                      setScopeId("");
                    }}
                  >
                    面向独立俱乐部
                  </button>
                </div>
                <p className="field__hint">
                  已加入联盟的俱乐部按整个联盟合并统计，只能开联盟榜；独立俱乐部各自一份。
                </p>
              </div>

              <div className="form-grid__full">
                <Field
                  label={scopeType === "union" ? "选择联盟" : "选择俱乐部"}
                  hint="按名称或 ID 搜索，最多列 50 条"
                >
                  <input
                    value={scopeKeyword}
                    placeholder={scopeType === "union" ? "输入联盟名称或联盟码" : "输入俱乐部名称或 ID"}
                    onChange={(event) => setScopeKeyword(event.target.value)}
                  />
                </Field>
                <div className="honor-rank-scope-list">
                  {scopeLoading ? (
                    <span className="reward-muted">正在读取…</span>
                  ) : scopeOptions.length === 0 ? (
                    <span className="reward-muted">
                      {scopeType === "union" ? "没有匹配的联盟" : "没有匹配的独立俱乐部"}
                    </span>
                  ) : (
                    scopeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`honor-rank-scope-item${scopeId === option.id ? " is-active" : ""}`}
                        onClick={() => {
                          setScopeId(option.id);
                          setNote((current) => current || `${option.name || option.id} 排行榜活动`);
                        }}
                      >
                        <strong>{option.name || option.id}</strong>
                        <small>{option.id}{option.note ? ` · ${option.note}` : ""}</small>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="form-grid__full">
              <Field label="活动范围" hint="范围创建后不可更改；要换范围请新建一个活动">
                <input value={`${activity?.scopeType === "club" ? "俱乐部" : "联盟"} ${activity?.scopeName || ""}（${activity?.scopeId || ""}）`} readOnly />
              </Field>
            </div>
          )}

          {creating && !canEdit && (
            <div className="form-error form-grid__full">
              <span>!</span>
              当前角色没有创建排行榜活动的权限
            </div>
          )}
          {!creating && !editable && (
            <div className="form-error form-grid__full">
              <span>!</span>
              {detail?.canEdit === false
                ? "该活动已被这个范围的更新活动取代，只能查看；要调整请打开最新的那场活动。"
                : "当前角色没有修改排行榜活动的权限"}
            </div>
          )}
          {!creating && editable && (
            <div className="info-banner form-grid__full">
              修改会直接覆盖游戏服该范围的当前配置，并更新这条活动记录（不会新增一场）。活动排名按修改后的时间重新统计。
            </div>
          )}

          <fieldset className="form-grid form-grid__full honor-rank-fieldset" disabled={!editable}>
            <div className="form-grid__full">
              <div className="balance-action-tabs">
                <button type="button" className={!activityOn ? "is-active is-danger" : ""} onClick={() => setActivityOn(false)}>
                  关闭排行榜
                </button>
                <button type="button" className={activityOn ? "is-active" : ""} onClick={() => setActivityOn(true)}>
                  开启排行榜
                </button>
              </div>
            </div>

            <Field label="开始日期" hint="按服务器本地时间（GMT+8）">
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label="开始时间">
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </Field>
            <Field label="结束日期" hint="结束时间不能早于开始时间">
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </Field>
            <Field label="结束时间">
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </Field>

            {BOARD_SPECS.map((spec) => (
              <div className="form-grid__full" key={spec.type}>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={boards[spec.type].on}
                    disabled={!activityOn || !editable}
                    onChange={(event) => setBoard(spec.type, { on: event.target.checked })}
                  />
                  <span>
                    <strong>{spec.name}</strong> · {spec.hint}
                  </span>
                </label>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  {spec.dipis.map((dipi, index) => (
                    <Field
                      key={dipi || "single"}
                      label={dipi ? `${dipi} · 名次奖励` : "名次奖励"}
                      hint="第 1 名起，英文逗号分隔（元），开了榜必填"
                      error={rewardState.format[spec.type][index] || ""}
                    >
                      <input
                        value={boards[spec.type].rewards[index] || ""}
                        disabled={!activityOn || !boards[spec.type].on || !editable}
                        placeholder="例如 100,50,20"
                        onChange={(event) => setBoardReward(spec.type, index, event.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}

            <div className="form-grid__full">
              <Field label="备注" hint={`${noteLength}/120，必填 2 字以上`}>
                <input
                  value={note}
                  disabled={!editable}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={activityOn ? "例如：联盟周年庆手数榜" : "例如：活动结束，关闭排行榜"}
                />
              </Field>
            </div>

            <div className="form-grid__full">
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!editable}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  我确认{activityOn ? `为该${scopeType === "union" ? "联盟" : "俱乐部"}开启（${openedBoards.join("、") || "未选榜"}）` : "关闭"}排行榜，
                  并覆盖游戏服该范围的 7 行配置
                </span>
              </label>
            </div>
          </fieldset>

          {activityOn && rewardState.missing.length > 0 && (
            <div className="form-error form-grid__full">
              <span>!</span>
              这些榜还没填名次奖励：{rewardState.missing.join("、")}（至少要有一档金额）
            </div>
          )}
          {hasRewardFormatError && (
            <div className="form-error form-grid__full">
              <span>!</span>
              名次奖励格式有误，按输入框下的提示改正后才能提交
            </div>
          )}

          {/* 按钮放在 fieldset 外：只读时 fieldset 会禁用内部所有控件，连「关闭」都点不动。 */}
          <div className="form-actions form-grid__full">
            <Button type="button" variant="secondary" onClick={onClose}>
              {creating ? "取消" : "关闭"}
            </Button>
            {!creating && canEdit && !activity?.superseded && activity?.state !== "closed" && (
              <Button type="button" variant="danger" onClick={() => void closeActivity()} disabled={busy}>
                {busy ? "处理中…" : "结束该活动"}
              </Button>
            )}
            <Button type="submit" variant={activityOn ? "primary" : "danger"} disabled={!canSubmit}>
              {busy ? "保存中…" : creating ? "创建并下发" : activityOn ? "保存并开启" : "保存并关闭"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function formatNumber(value: number, unit: string): string {
  if (unit === "元") return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString("zh-CN");
}

/** 类似游戏客户端排行榜的实时榜单：三个榜页签 + 手数档位，按活动自己的时间窗统计。 */
function RankingPanel({ activity }: { activity: HonorRankActivity | null }) {
  const available = useMemo(() => {
    if (!activity) return [] as BoardSpec[];
    const opened = BOARD_SPECS.filter((spec) => activity.boards?.some((board) => board.rankType === spec.type && board.on));
    return opened.length > 0 ? opened : BOARD_SPECS;
  }, [activity]);
  const [rankType, setRankType] = useState<HonorRankType>(available[0]?.type ?? "play");
  const [dipi, setDipi] = useState(PLAY_DIPIS[0]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HonorRankRankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!activity) return;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ rankType, page: String(page), pageSize: "30" });
    if (rankType === "play") query.set("dipi", dipi);
    try {
      const result = await api<HonorRankRankingResponse>(`/api/game/honor-rank/activities/${activity.id}/ranking?${query}`);
      setData(result);
    } catch (reason) {
      setError(errorMessage(reason, "读取实时排名失败"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activity, rankType, dipi, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // 活动只开了部分榜时，默认切到第一个可看的榜，避免停留在一个没配置的榜上。
  useEffect(() => {
    if (available.length === 0) return;
    if (!available.some((spec) => spec.type === rankType)) {
      setRankType(available[0].type);
      setPage(1);
    }
  }, [available, rankType]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="honor-rank-ranking">
      <div className="balance-action-tabs">
        {available.map((spec) => (
          <button
            key={spec.type}
            type="button"
            className={rankType === spec.type ? "is-active" : ""}
            onClick={() => {
              setRankType(spec.type);
              setPage(1);
            }}
          >
            {spec.name}
          </button>
        ))}
      </div>

      {rankType === "play" && (
        <div className="balance-action-tabs honor-rank-dipi-tabs">
          {PLAY_DIPIS.map((option) => (
            <button
              key={option}
              type="button"
              className={dipi === option ? "is-active" : ""}
              onClick={() => {
                setDipi(option);
                setPage(1);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="honor-rank-ranking__meta">
        <span>
          统计区间 {data?.startDate || "—"} ~ {data?.endDate || "—"}（按活动时间窗实时统计，单位：{data?.unit || "—"}）
        </span>
        <div>
          <span className="reward-muted">共 {data?.total ?? 0} 人{data?.truncated ? "（已截断到前 2000 名）" : ""}</span>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "读取中…" : "刷新"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="form-error">
          <span>!</span>
          {error}
        </div>
      )}

      {loading && !data ? (
        <LoadingBlock label="正在统计排名…" />
      ) : !data || data.items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__mark">◇</span>
          <strong>暂无排行数据</strong>
          <p>活动还没开始，或该榜在统计区间内没有产生数据。</p>
        </div>
      ) : (
        <>
          <div className={`table-wrap${loading ? " is-loading" : ""}`}>
            <table className="honor-rank-table">
              <thead>
                <tr>
                  <th>名次</th>
                  <th>玩家</th>
                  <th className="reward-num">{rankType === "play" ? "有效手数" : rankType === "score" ? "赢分" : "代理红利"}</th>
                  <th>备注</th>
                  <th className="reward-num">名次奖励（元）</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={`${row.rank}-${row.playerId}`}>
                    <td><strong>{row.rank}</strong></td>
                    <td>
                      <div className="honor-rank-player">
                        <strong>{row.name || "—"}</strong>
                        <small>{row.playerId}</small>
                      </div>
                    </td>
                    <td className="reward-num">{formatNumber(row.value, data.unit)}</td>
                    <td>{row.remark || "—"}</td>
                    <td className="reward-num">{row.reward ? Number(row.reward).toLocaleString("zh-CN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-pagination">
            <span>第 {data.page} / {totalPages} 页</span>
            <div>
              <button type="button" onClick={() => setPage(1)} disabled={page <= 1 || loading}>首页</button>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>上一页</button>
              <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>下一页</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
