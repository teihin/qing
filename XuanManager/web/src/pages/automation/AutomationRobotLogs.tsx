import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { EmptyState, LoadingBlock, Modal } from "../../components/ui";
import {
  ErrorBanner,
  JsonPreview,
  timeText,
  workerEventLabel,
  workerEventSummary,
  workerEventTone,
  type AutomationWorkerEvent,
} from "./shared";

// RobotLogList 是机器人的运行日志：数据来自节点上报的事件流，按 robot_id 过滤。
// 投放详情、机器人详情、节点详情三处共用同一个接口和同一个列表。
export function RobotLogList({ robotId, limit = 200, live = true }: { robotId: number; limit?: number; live?: boolean }) {
  const [items, setItems] = useState<AutomationWorkerEvent[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError("");
    try {
      const response = await api<{ items: AutomationWorkerEvent[] }>(`/api/automation/robots/${robotId}/events?limit=${limit}`);
      setItems(response.items ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "机器人日志加载失败");
      setItems((current) => current ?? []);
    }
  }, [robotId, limit]);

  useEffect(() => {
    void load();
    if (!live) return;
    const timer = window.setInterval(() => { void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [load, live]);

  if (items === null) return error ? <ErrorBanner message={error} /> : <LoadingBlock label="正在读取机器人日志" />;
  if (items.length === 0) return <EmptyState title="还没有运行日志" description="机器人在节点上登录、进房、开局、结算都会记在这里；刚投放的机器人可能还没被节点拉起。" />;
  return <>
    <ErrorBanner message={error} />
    <div className="automation-detail-list">
      {items.map((event) => <RobotLogRow key={event.id} event={event} />)}
    </div>
    <small className="automation-inline-meta">最近 {items.length} 条{live ? "，每 5 秒自动刷新" : ""}。</small>
  </>;
}

function RobotLogRow({ event }: { event: AutomationWorkerEvent }) {
  const summary = workerEventSummary(event.payload);
  return <article className="automation-detail-row">
    <div>
      <strong>{workerEventLabel(event.eventType)}</strong>
      <small>{event.eventType}{event.commandNo ? ` · ${event.commandNo}` : ""}</small>
    </div>
    <div>
      <span className={`automation-tone is-${workerEventTone(event.eventType)}`}>{event.sequence > 0 ? `seq ${event.sequence}` : "系统"}</span>
    </div>
    <div>
      <small>房间 {event.roomId ?? "—"}{event.roundId ? ` · 局 ${event.roundId}` : ""}</small>
      <small>{event.terminalNo || (event.robotId ?? "—")}</small>
    </div>
    <div>
      <small>{timeText(event.occurredAt ?? event.receivedAt)}</small>
      {summary ? <small>{summary}</small> : event.payload && event.payload !== "{}" ? <JsonPreview value={event.payload} /> : null}
    </div>
  </article>;
}

export function RobotLogModal({ robotId, title, eyebrow = "ROBOT LOG", onClose }: {
  robotId: number;
  title: string;
  eyebrow?: string;
  onClose: () => void;
}) {
  return <Modal title={title} eyebrow={eyebrow} onClose={onClose} wide>
    <RobotLogList robotId={robotId} />
  </Modal>;
}
