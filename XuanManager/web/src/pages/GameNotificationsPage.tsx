import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { GameNotificationHistoryItem } from "../types";

interface NotificationHistoryResponse { items: GameNotificationHistoryItem[] }

export default function GameNotificationsPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [history, setHistory] = useState<GameNotificationHistoryItem[] | null>(null);
  const [content, setContent] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<NotificationHistoryResponse>("/api/configuration/notifications?limit=20");
      setHistory(result.items);
    } catch (reason) {
      notify(errorMessage(reason, "通知记录加载失败"), "error");
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const normalized = content.trim().replaceAll(",", "，").replace(/\s+/g, " ");
  const length = Array.from(normalized).length;

  const send = async () => {
    if (!normalized) { notify("请输入通知内容", "error"); return; }
    if (length > 500) { notify("通知内容不能超过 500 个字符", "error"); return; }
    if (!confirmed) { notify("请先确认发送范围", "error"); return; }
    setSending(true);
    try {
      const result = await api<{ message: string }>("/api/configuration/notifications", {
        method: "POST",
        ...jsonBody({ content: normalized, confirm: true }),
      });
      notify(result.message);
      setContent("");
      setConfirmed(false);
      await load();
    } catch (reason) {
      notify(errorMessage(reason, "全服通知发送失败"), "error");
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="LIVE BROADCAST" title="游戏通知发送" description="向当前在线游戏玩家发送即时系统跑马灯通知。" actions={<span className="configuration-status is-live"><i />连接本机游戏服务</span>} />
      <section className="notification-compose panel">
        <div className="notification-compose__intro">
          <span className="notification-compose__mark">通</span>
          <div><span>全服在线玩家</span><h2>编辑即时通知</h2><p>发送后不能撤回。通知只推送给当前在线玩家，不会改动长期游戏公告。</p></div>
        </div>
        <div className="notification-compose__editor">
          <div className="notification-textarea-wrap">
            <textarea rows={6} maxLength={550} value={content} onChange={(event) => { setContent(event.target.value); setConfirmed(false); }} disabled={!can("configuration.notification.send")} placeholder="例如：服务器将于今晚 23:30 进行维护，请提前结束牌局。" />
            <span className={length > 500 ? "is-over" : ""}>{length} / 500</span>
          </div>
          <div className="notification-preview"><span>玩家端跑马灯预览</span><div><i>系统广播:</i>{normalized || "这里显示即将发送的通知内容"}</div></div>
          <label className={`notification-confirm ${confirmed ? "is-checked" : ""}`}>
            <input type="checkbox" checked={confirmed} disabled={!can("configuration.notification.send") || !normalized || length > 500 || sending} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><strong>确认发送给全部在线玩家</strong><small>我已检查通知内容，了解发送后无法撤回。</small></span>
          </label>
          <div className="notification-send-actions">
            <p>英文逗号会自动转换为中文逗号，避免旧客户端截断消息。</p>
            {can("configuration.notification.send") ? <Button type="button" disabled={!confirmed || !normalized || length > 500 || sending} onClick={() => void send()}><span>↗</span>{sending ? "正在提交…" : "立即发送全服通知"}</Button> : <span className="readonly-badge"><i />当前角色仅可查看记录</span>}
          </div>
        </div>
      </section>

      <section className="panel notification-history">
        <header className="configuration-panel-title"><div><span>SEND HISTORY</span><h2>最近发送记录</h2><p>记录发送内容、操作者、游戏服务接收结果和时间。</p></div><strong>{history?.length ?? 0} 条</strong></header>
        {!history ? <LoadingBlock label="正在读取通知记录" /> : history.length === 0 ? <EmptyState title="暂无通知记录" description="通过本页面发送第一条全服通知后会显示在这里。" /> : (
          <div className="table-wrap"><table className="notification-history-table"><thead><tr><th>发送时间</th><th>通知内容</th><th>操作者</th><th>状态</th><th>结果说明</th></tr></thead><tbody>
            {history.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td><strong className="notification-history-content">{item.content || "—"}</strong></td><td>{item.operatorName || "系统"}</td><td><NotificationStatus status={item.status} /></td><td>{item.resultMessage || "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}

function NotificationStatus({ status }: { status: GameNotificationHistoryItem["status"] }) {
  const labels = { sent: "已处理", accepted: "处理中", failed: "发送失败" };
  return <span className={`notification-state notification-state--${status}`}><i />{labels[status]}</span>;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback;
}
