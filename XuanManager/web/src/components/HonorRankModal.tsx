import { useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, LoadingBlock, Modal, submitGuard } from "./ui";
import type { HonorRankState, HonorRankType } from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

type Boards = Record<HonorRankType, { on: boolean; rewards: string[] }>;

interface BoardSpec {
  type: HonorRankType;
  name: string;
  hint: string;
  dipis: string[];
}

const PLAY_DIPIS = ["1皮", "2皮", "5皮", "10皮", "20皮"];

const BOARD_SPECS: BoardSpec[] = [
  {
    type: "play",
    name: "玩家手数榜",
    hint: "按有效手数（局）排名；5 个档位共用这个开关，奖励按档位各配一份",
    dipis: PLAY_DIPIS,
  },
  { type: "score", name: "玩家赢分榜", hint: "按俱乐部积分排名，只显示赢分为正的成员", dipis: [""] },
  { type: "bonus", name: "代理红利榜", hint: "按代理红利（元）排名，代理查看按展示折扣缩放", dipis: [""] },
];

const EMPTY_BOARDS: Boards = {
  play: { on: false, rewards: PLAY_DIPIS.map(() => "") },
  score: { on: false, rewards: [""] },
  bonus: { on: false, rewards: [""] },
};

function boardsFrom(state: HonorRankState): Boards {
  const result: Boards = {
    play: { on: false, rewards: PLAY_DIPIS.map(() => "") },
    score: { on: false, rewards: [""] },
    bonus: { on: false, rewards: [""] },
  };
  for (const spec of BOARD_SPECS) {
    const summary = state.boards?.find((item) => item.rankType === spec.type);
    result[spec.type] = {
      on: !!summary?.on,
      rewards: spec.dipis.map((dipi) => {
        const row = state.rows?.find((item) => item.rankType === spec.type && item.dipi === dipi);
        return row ? row.rewards.join(",") : "";
      }),
    };
  }
  return result;
}

function latestUpdate(state: HonorRankState): string {
  let best = "";
  for (const row of state.rows || []) {
    if (!row.updateDate) continue;
    const stamp = `${row.updateDate} ${row.updateTime}`;
    if (stamp > best) best = stamp;
  }
  return best;
}

function mixedBoards(state: HonorRankState): string[] {
  return (state.boards || [])
    .filter((board) => board.mixed)
    .map((board) => BOARD_SPECS.find((spec) => spec.type === board.rankType)?.name || board.rankType);
}

/**
 * 俱乐部 / 联盟荣耀榜配置。
 *
 * 服务端按行存：一个 (scope, 榜, 手数档位) 一行，共 7 行，每行自带开关、起止时间和名次奖励，
 * 保存时整行覆盖。后台界面对运营只暴露「总开关 + 三榜开关 + 一组共用时间」，
 * 保存时展开成 7 行逐条写（见 服务器文档整理/俱乐部荣耀榜-客户端接口文档.md v2.6 §5）。
 */
export default function HonorRankModal({
  scope,
  targetId,
  targetName,
  canEdit,
  notify,
  onClose,
  onDone,
}: {
  scope: "club" | "union";
  targetId: string;
  targetName: string;
  canEdit: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<HonorRankState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityOn, setActivityOn] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [boards, setBoards] = useState<Boards>(EMPTY_BOARDS);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const endpoint = `/api/game/${scope === "union" ? "unions" : "clubs"}/${targetId}/honor-rank`;
  const noteLength = Array.from(note.trim()).length;
  const openedBoards = useMemo(
    () => BOARD_SPECS.filter((spec) => boards[spec.type].on).map((spec) => spec.name),
    [boards],
  );
  const mixed = useMemo(() => (state ? mixedBoards(state) : []), [state]);
  const lastUpdate = useMemo(() => (state ? latestUpdate(state) : ""), [state]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<HonorRankState>(endpoint)
      .then((data) => {
        if (!alive) return;
        setState(data);
        setActivityOn(data.activityOn);
        setStartDate(data.startDate || "");
        setStartTime((data.startTime || "").slice(0, 5));
        setEndDate(data.endDate || "");
        setEndTime((data.endTime || "").slice(0, 5));
        setBoards(boardsFrom(data));
      })
      .catch((reason) => {
        if (alive) setError(errorMessage(reason, "读取荣耀榜配置失败"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const scheduleReady = !!(startDate && startTime && endDate && endTime);
  const canSubmit = canEdit && !busy && !loading && confirmed && noteLength >= 2 && noteLength <= 120 &&
    (!activityOn || (scheduleReady && openedBoards.length > 0));

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
      const result = await api<HonorRankState>(endpoint, {
        method: "PUT",
        ...jsonBody({
          activityOn,
          // 关闭时也把时间带上：服务端允许关闭后保留，下次开启不用重填。
          startDate,
          startTime,
          endDate,
          endTime,
          boards: BOARD_SPECS.map((spec) => ({
            rankType: spec.type,
            on: boards[spec.type].on,
            rewards: spec.dipis.map((dipi, index) => ({ dipi, list: boards[spec.type].rewards[index] || "" })),
          })),
          note: note.trim(),
          confirm: true,
        }),
      });
      notify(result.message || "荣耀榜配置已保存", "success");
      onDone();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, "保存荣耀榜配置失败"));
    } finally {
      setBusy(false);
    }
  };

  const scopeName = scope === "union" ? "联盟" : "俱乐部";

  return (
    <Modal
      title={`${scopeName}「${targetName || targetId}」的排行榜`}
      eyebrow={`${scope === "union" ? "UNION" : "CLUB"} HONOR RANK · ${targetId}`}
      onClose={onClose}
      wide
    >
      <div className="quota-intro">
        <p>
          开启后，该{scopeName}的成员在大厅「排行榜」看到手数榜、赢分榜、红利榜。
          已入盟俱乐部的榜按整个联盟合并统计，所以只在联盟维度配置；独立俱乐部各自一份。
        </p>
        <ul>
          <li>总开关 + 三个榜开关 + 一组共用起止时间；手数榜 5 个档位共用同一个开关。</li>
          <li>服务端按「榜 + 档位」存 7 行，每行各自带开关与起止时间；本页保存会把 7 行统一写成同一套值。</li>
          <li>只有「总开关开 + 该榜开关开 + 当前时间已到开始时间」才出榜；关闭后时间与奖励保留。</li>
          <li>奖励只做展示，单位是元；不提供客户端领取，发奖仍走后台发放。</li>
        </ul>
        {state && (
          <div className="union-quota-current">
            <div>
              <span>当前状态</span>
              <strong>{state.activityOn ? (state.mixedOn ? "部分开启" : "已开启") : "已关闭"}</strong>
            </div>
            <div>
              <span>榜单范围</span>
              <strong>{state.scope === "union" ? `联盟 ${state.targetId}` : `俱乐部 ${state.targetId}`}</strong>
            </div>
            <div>
              <span>上次更新</span>
              <strong>{lastUpdate || "未配置"}</strong>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingBlock label="读取荣耀榜配置…" />
      ) : (
        <form className="form-grid" onSubmit={submitGuard(submit)}>
          {error && (
            <div className="form-error form-grid__full">
              <span>!</span>
              {error}
            </div>
          )}
          {!canEdit && (
            <div className="form-error form-grid__full">
              <span>!</span>
              当前角色没有荣耀榜的配置权限
            </div>
          )}
          {(mixed.length > 0 || state?.mixedSchedule || state?.mixedOn) && (
            <div className="form-error form-grid__full">
              <span>!</span>
              服务端 7 行配置不一致（{mixed.length > 0 ? `${mixed.join("、")} 开关不统一` : "开关不统一"}
              {state?.mixedSchedule ? "，起止时间也不一致" : ""}），保存后会统一成下面这套值。
            </div>
          )}

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
                  disabled={!activityOn}
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
                    hint="第 1 名起，逗号分隔（元），空=不发奖励"
                  >
                    <input
                      value={boards[spec.type].rewards[index] || ""}
                      disabled={!activityOn || !boards[spec.type].on}
                      placeholder="例如 100,50,20"
                      onChange={(event) => setBoardReward(spec.type, index, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ))}

          <div className="form-grid__full">
            <Field label="原因" hint={`${noteLength}/120，必填 2 字以上`}>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={activityOn ? "例如：运营给该联盟开周年庆排行榜" : "例如：活动结束，关闭排行榜"}
              />
            </Field>
          </div>

          <div className="form-grid__full">
            <label className="confirm-check">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>
                我确认本次会{activityOn ? `开启（${openedBoards.join("、") || "未选榜"}）` : "关闭"}该{scopeName}的排行榜，
                并覆盖服务端 7 行配置
              </span>
            </label>
          </div>

          <div className="form-actions form-grid__full">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant={activityOn ? "primary" : "danger"} disabled={!canSubmit}>
              {busy ? "保存中…" : activityOn ? "保存并开启" : "保存并关闭"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
