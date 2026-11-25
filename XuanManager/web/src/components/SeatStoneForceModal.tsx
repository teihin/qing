import { useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, Modal, submitGuard } from "./ui";
import type { ClubSeatStoneRatioState, SeatStoneForceState } from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/** 与客户端 FormatRatio 一致：最多 4 位小数，去掉结尾 0。 */
function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "1";
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

/**
 * 俱乐部/联盟「强制带入钻石」开关。
 *
 * 开启后该俱乐部（联盟写总群主俱乐部）创建房间规则时，「同步带入钻石」自动打开且用户不能关闭。
 * 存储：游戏端哈希表 kbedm.usr_hash_info 的「强制入座扣钻_俱乐部_<clubId>」= 1/0，缺行即关闭。
 * 客户端用「查询_哈希_信息」读取并把开关锁死；游戏服在创建玩法与建房两处做强校验。
 *
 * 真正扣不扣钻由「俱乐部积分对应钻石输赢比」决定：比例为 0 时强制开启也不会扣钻石，
 * 这里只提示、不阻止保存（比例在「钻石消费价格」页维护，允许先开开关后配比例）。
 */
export default function SeatStoneForceModal({
  scope,
  targetId,
  targetName,
  ownerClubId,
  currentEnabled,
  canEdit,
  canViewRatio,
  notify,
  onClose,
  onDone,
}: {
  scope: "club" | "union";
  targetId: string;
  targetName: string;
  ownerClubId?: string;
  currentEnabled: boolean;
  canEdit: boolean;
  canViewRatio: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ratio, setRatio] = useState<number | null>(null);
  const [ratioError, setRatioError] = useState("");

  const noteLength = Array.from(note.trim()).length;
  const changed = enabled !== currentEnabled;
  const isUnion = scope === "union";
  const missingOwnerClub = isUnion && !ownerClubId;
  const canSubmit = canEdit && !missingOwnerClub && changed &&
    noteLength >= 2 && noteLength <= 120 && confirmed && !busy;
  const endpoint = isUnion
    ? `/api/game/unions/${targetId}/seat-stone-force`
    : `/api/game/clubs/${targetId}/seat-stone-force`;

  useEffect(() => {
    if (!canViewRatio) return;
    let alive = true;
    api<ClubSeatStoneRatioState>("/api/configuration/club-seat-stone-ratio")
      .then((state) => {
        if (alive) setRatio(state.ratio);
      })
      .catch((reason) => {
        if (alive) setRatioError(errorMessage(reason, "读取兑换比例失败"));
      });
    return () => {
      alive = false;
    };
  }, [canViewRatio]);

  const ratioUnknown = canViewRatio && ratio === null && ratioError === "";
  const ratioIsZero = ratio !== null && ratio === 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<SeatStoneForceState>(endpoint, {
        method: "PUT",
        ...jsonBody({
          enabled,
          expectedEnabled: currentEnabled,
          note: note.trim(),
          confirm: true,
        }),
      });
      notify(result.message || (enabled ? "已开启强制开房带钻石" : "已关闭强制开房带钻石"), "success");
      onDone();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, enabled ? "开启强制开房带钻石失败" : "关闭强制开房带钻石失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${isUnion ? "联盟" : "俱乐部"}「${targetName || targetId}」的强制开房带钻石`}
      eyebrow={`${isUnion ? "UNION" : "CLUB"} SEAT STONE FORCE · ${targetId}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          开启后，该{isUnion ? "联盟" : "俱乐部"}在「开房 → 游戏设置 → 创建规则」里，
          「同步带入钻石」会自动打开且<strong>不能手动关闭</strong>；默认关闭。
        </p>
        <ul>
          <li>存储为游戏端哈希 <code>usr_hash_info</code> 的「强制入座扣钻_俱乐部_&lt;ID&gt;」= 1/0，缺行即关闭。</li>
          {isUnion ? (
            <li>联盟开关写联盟总群主俱乐部的 key：{ownerClubId || "未找到总群主俱乐部"}。</li>
          ) : (
            <li>只影响当前俱乐部；已入盟俱乐部的开房规则由联盟总群主俱乐部统一配置。</li>
          )}
          <li>作用于创建规则与建房：已有规则新开出的房间也会自动带上，不用逐条重建。</li>
          <li>
            实际扣钻由「俱乐部积分对应钻石输赢比」（「钻石消费价格」页）决定：
            {!canViewRatio ? (
              <span className="club-warning"> 当前角色无权查看比例，请让有权限的同事确认比例不为 0</span>
            ) : ratioIsZero ? (
              <span className="club-warning"> 当前比例为 0，强制开启不会实际扣钻石</span>
            ) : ratio === null ? (
              <span className="club-warning">
                {" "}{ratioUnknown ? "正在读取…" : `读取失败（${ratioError}）`}
              </span>
            ) : (
              <span> 当前 1 积分 = {formatRatio(ratio)} 钻</span>
            )}
          </li>
          <li>关闭开关后，已有规则里的「入座扣钻」不会自动摘除，需重建规则才会去掉。</li>
          <li>操作会记入后台审计，原因必填（2–120 字）。</li>
        </ul>
        <div className="union-quota-current">
          <div>
            <span>当前状态</span>
            <strong>{currentEnabled ? "强制开启" : "未强制"}</strong>
          </div>
          <div>
            <span>保存后</span>
            <strong>{enabled ? "强制开启" : "未强制"}</strong>
          </div>
        </div>
      </div>

      <form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>
        {error && (
          <div className="form-error">
            <span>!</span>
            {error}
          </div>
        )}
        {!canEdit && (
          <div className="form-error">
            <span>!</span>
            当前角色没有{isUnion ? "联盟" : "俱乐部"}强制开房带钻石的权限
          </div>
        )}
        {missingOwnerClub && (
          <div className="form-error">
            <span>!</span>
            该联盟没有总群主俱乐部，无法设置强制开房带钻石
          </div>
        )}
        <div className="balance-action-tabs">
          <button type="button" className={!enabled ? "is-active" : ""} onClick={() => setEnabled(false)}>
            取消强制
          </button>
          <button type="button" className={enabled ? "is-active" : ""} onClick={() => setEnabled(true)}>
            强制开启
          </button>
        </div>
        <Field label="原因" hint={`${noteLength}/120，必填 2 字以上`}>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={enabled ? "例如：运营要求该俱乐部房间全部带钻" : "例如：该俱乐部恢复自主选择"}
          />
        </Field>
        <label className="confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>
            我确认本次操作会{enabled ? "开启" : "取消"}该{isUnion ? "联盟" : "俱乐部"}
            的强制开房带钻石{enabled ? "，玩家将无法关闭" : ""}
          </span>
        </label>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant={enabled ? "primary" : "danger"} disabled={!canSubmit}>
            {busy ? "保存中…" : enabled ? "确认强制" : "确认取消"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
