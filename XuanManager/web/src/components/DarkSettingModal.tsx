import { useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, Modal, submitGuard } from "./ui";
import type { DarkSettingState } from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/**
 * 俱乐部/联盟暗抽开关。
 *
 * 开关存在游戏端哈希表 kbedm.usr_hash_info：
 * - 俱乐部：暗抽_俱乐部_<clubId>
 * - 联盟：写联盟总群主俱乐部的同一个 key
 * 客户端用「查询_哈希_信息」读取；后台不能通过 /hall/command 调 Account 命令，
 * 所以后端直接读写哈希表。保存成功后关闭弹窗并刷新列表。
 */
export default function DarkSettingModal({
  scope,
  targetId,
  targetName,
  ownerClubId,
  currentEnabled,
  canEdit,
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
  const missingOwnerClub = isUnion && !ownerClubId;
  const canSubmit = canEdit && !missingOwnerClub && changed &&
    noteLength >= 2 && noteLength <= 120 && confirmed && !busy;
  const endpoint = isUnion
    ? `/api/game/unions/${targetId}/dark-setting`
    : `/api/game/clubs/${targetId}/dark-setting`;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<DarkSettingState>(endpoint, {
        method: "PUT",
        ...jsonBody({
          enabled,
          expectedEnabled: currentEnabled,
          note: note.trim(),
          confirm: true,
        }),
      });
      notify(result.message || (enabled ? "暗抽已开启" : "暗抽已关闭"), "success");
      onDone();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, enabled ? "开启暗抽失败" : "关闭暗抽失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${isUnion ? "联盟" : "俱乐部"}「${targetName || targetId}」的暗抽开关`}
      eyebrow={`${isUnion ? "UNION" : "CLUB"} DARK SETTING · ${targetId}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          开关控制大厅「开房 → 游戏设置 → 创建规则」里的暗抽是否显示。
          关闭时客户端整项隐藏；开启后由运营按俱乐部/联盟单独放行。
        </p>
        <ul>
          <li>存储为游戏端哈希 <code>usr_hash_info</code> 的「暗抽_俱乐部_&lt;ID&gt;」，客户端用「查询_哈希_信息」读取。</li>
          {isUnion ? (
            <li>联盟开关写联盟总群主俱乐部的 key：{ownerClubId || "未找到总群主俱乐部"}。</li>
          ) : (
            <li>只影响当前俱乐部；已入盟俱乐部的开房玩法仍由联盟总群主俱乐部配置。</li>
          )}
          <li>关闭后不再显示暗抽设置；已有规则的生效口径由服务端读取同一开关决定。</li>
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
            当前角色没有{isUnion ? "联盟" : "俱乐部"}暗抽开关的权限
          </div>
        )}
        {missingOwnerClub && (
          <div className="form-error">
            <span>!</span>
            该联盟没有总群主俱乐部，无法设置暗抽
          </div>
        )}
        <div className="balance-action-tabs">
          <button type="button" className={!enabled ? "is-active" : ""} onClick={() => setEnabled(false)}>
            关闭暗抽
          </button>
          <button type="button" className={enabled ? "is-active" : ""} onClick={() => setEnabled(true)}>
            开启暗抽
          </button>
        </div>
        <Field label="原因" hint={`${noteLength}/120，必填 2 字以上`}>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={enabled ? "例如：运营给该俱乐部开放暗抽" : "例如：暂停该俱乐部暗抽"}
          />
        </Field>
        <label className="confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>
            我确认本次操作会{enabled ? "开启" : "关闭"}该{isUnion ? "联盟" : "俱乐部"}的开房暗抽
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
