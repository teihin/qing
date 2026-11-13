import { useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Modal, submitGuard } from "./ui";
import type { BFChatState } from "../types";

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/**
 * 俱乐部 BF 聊天（官方客服）入口开关。
 *
 * 开关存在 ChatTool 的 chat_direct_bf_club 表；客户端消息页只读入口可见性。
 * 关闭后该俱乐部所有层级的代理和玩家都看不到置顶的 BF 聊天，默认开启。
 * 保存成功后关闭弹窗并刷新列表。
 */
export default function BFChatModal({
  clubId,
  clubName,
  currentEnabled,
  canEdit,
  notify,
  onClose,
  onDone,
}: {
  clubId: string;
  clubName: string;
  currentEnabled: boolean;
  canEdit: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const changed = enabled !== currentEnabled;
  const canSubmit = canEdit && changed && confirmed && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<BFChatState>(`/api/game/clubs/${clubId}/bf-chat`, {
        method: "PUT",
        ...jsonBody({
          enabled,
          expectedEnabled: currentEnabled,
          confirm: true,
        }),
      });
      notify(result.message || (enabled ? "BF 聊天已开启" : "BF 聊天已关闭"), "success");
      onDone();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, enabled ? "开启 BF 聊天失败" : "关闭 BF 聊天失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`俱乐部「${clubName || clubId}」的 BF 聊天入口`}
      eyebrow={`CLUB BF CHAT · ${clubId}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          控制消息页置顶的「BF 聊天（官方客服）」入口。关闭后，该俱乐部所有层级的代理和玩家
          在消息列表都看不到这个入口；重新开启即恢复。
        </p>
        <ul>
          <li>按俱乐部单独生效，不影响其他俱乐部；新建俱乐部默认开启。</li>
          <li>游戏内盟主/群主不再提供该开关，统一由后台设置。</li>
          <li>操作会记入后台审计，保存后客户端重新进入消息页生效。</li>
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
            当前角色没有 BF 聊天开关的权限
          </div>
        )}
        <div className="balance-action-tabs">
          <button type="button" className={!enabled ? "is-active" : ""} onClick={() => setEnabled(false)}>
            关闭 BF 聊天
          </button>
          <button type="button" className={enabled ? "is-active" : ""} onClick={() => setEnabled(true)}>
            开启 BF 聊天
          </button>
        </div>
        <label className="confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我确认本次操作会{enabled ? "开启" : "关闭"}该俱乐部的 BF 聊天入口</span>
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
