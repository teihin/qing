import { useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, Modal, submitGuard } from "./ui";
import type { LeaderboardEntryState } from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/**
 * 大厅「发现」页排行榜入口开关。
 *
 * 开关存在游戏端哈希表 kbedm.usr_hash_info：
 * - 独立俱乐部：排行榜_俱乐部_<clubId>
 * - 已入盟俱乐部：排行榜_联盟_<unionId>（联盟统一设置，成员俱乐部跟随）
 * 客户端用「查询_哈希_信息」读取后决定按钮显隐；后台不能通过 /hall/command 调 Account 命令，
 * 所以后端直接读写哈希表。保存成功后关闭弹窗并刷新列表。
 */
export default function LeaderboardEntryModal({
  scope,
  targetId,
  targetName,
  currentEnabled,
  canEdit,
  notify,
  onClose,
  onDone,
}: {
  scope: "club" | "union";
  targetId: string;
  targetName: string;
  currentEnabled: boolean;
  canEdit: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const noteLength = Array.from(note.trim()).length;
  const changed = enabled !== currentEnabled;
  const isUnion = scope === "union";
  const canSubmit = canEdit && changed && noteLength >= 2 && noteLength <= 120 && confirmed && !busy;
  const endpoint = isUnion
    ? `/api/game/unions/${targetId}/leaderboard-entry`
    : `/api/game/clubs/${targetId}/leaderboard-entry`;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<LeaderboardEntryState>(endpoint, {
        method: "PUT",
        ...jsonBody({
          enabled,
          expectedEnabled: currentEnabled,
          note: note.trim(),
          confirm: true,
        }),
      });
      notify(result.message || (enabled ? "排行榜入口已开启" : "排行榜入口已关闭"), "success");
      onDone();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, enabled ? "开启排行榜入口失败" : "关闭排行榜入口失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${isUnion ? "联盟" : "俱乐部"}「${targetName || targetId}」的排行榜入口`}
      eyebrow={`${isUnion ? "UNION" : "CLUB"} LEADERBOARD ENTRY · ${targetId}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          开关控制大厅「发现」页的<b>排行榜</b>按钮是否显示。关闭时该范围内玩家的按钮整项隐藏；
          玩家切换俱乐部后，按新俱乐部（或新俱乐部所属联盟）的开关重新判定。
        </p>
        <ul>
          <li>默认关闭：没有配置过就一律隐藏。</li>
          {isUnion ? (
            <li>联盟开关写「排行榜_联盟_&lt;联盟ID&gt;」，联盟下所有俱乐部一起生效。</li>
          ) : (
            <>
              <li>独立俱乐部写「排行榜_俱乐部_&lt;俱乐部ID&gt;」。</li>
              <li>已入盟的俱乐部只能在联盟管理里设置，联盟下的俱乐部统一跟随联盟开关。</li>
            </>
          )}
          <li>客户端用「查询_哈希_信息」读取该 key，取值为 1 才显示入口。</li>
          <li>操作会记入后台审计，原因必填（2–120 字）。</li>
        </ul>
        <div className="union-quota-current">
          <div>
            <span>当前状态</span>
            <strong>{currentEnabled ? "已开启" : "已关闭"}</strong>
          </div>
          <div>
            <span>保存后</span>
            <strong>{enabled ? "开启" : "关闭"}</strong>
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
            当前角色没有{isUnion ? "联盟" : "俱乐部"}排行榜入口的权限
          </div>
        )}
        <div className="balance-action-tabs">
          <button type="button" className={!enabled ? "is-active" : ""} onClick={() => setEnabled(false)}>
            关闭入口
          </button>
          <button type="button" className={enabled ? "is-active" : ""} onClick={() => setEnabled(true)}>
            开启入口
          </button>
        </div>
        <Field label="原因" hint={`${noteLength}/120，必填 2 字以上`}>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={enabled ? "例如：运营给该俱乐部开放排行榜" : "例如：暂停该俱乐部排行榜入口"}
          />
        </Field>
        <label className="confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>
            我确认本次操作会{enabled ? "开启" : "关闭"}该{isUnion ? "联盟下所有俱乐部" : "俱乐部"}的大厅排行榜入口
          </span>
        </label>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant={enabled ? "primary" : "danger"} disabled={!canSubmit}>
            {busy ? "保存中…" : enabled ? "确认开启" : "确认关闭"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
