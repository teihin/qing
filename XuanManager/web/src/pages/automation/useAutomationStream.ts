import { useEffect, useRef, useState } from "react";

export type AutomationStreamChange = {
  scope: string;
  workerId?: number;
  robotId?: number;
  commandNo?: string;
  at?: number;
};

/**
 * 订阅后台实时通道（SSE：GET /api/automation/stream）。
 *
 * 服务端只推「哪类数据变了」，不推业务数据：页面收到后仍走原来的 REST 接口重拉，
 * 权限、数据范围、分页口径都跟轮询时完全一致。
 *
 * 300ms 防抖：一次上报会带来一批事件 + 一批回执，合并成一次重拉，避免连续刷接口。
 * 连不上时事件不会来，调用方的轮询继续生效 —— 实时通道只加速，不影响可用性。
 */
export function useAutomationStream(onChange: (change: AutomationStreamChange) => void): boolean {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    let source: EventSource | null = null;
    let reopenTimer: number | undefined;
    let pending: AutomationStreamChange | null = null;
    let flushTimer: number | undefined;
    let disposed = false;

    const flush = () => {
      flushTimer = undefined;
      if (!pending) return;
      const change = pending;
      pending = null;
      handlerRef.current(change);
    };

    const open = () => {
      if (disposed) return;
      source = new EventSource(`${base}/api/automation/stream`, { withCredentials: true });
      source.addEventListener("ready", () => setConnected(true));
      source.addEventListener("change", (event) => {
        let parsed: AutomationStreamChange;
        try {
          parsed = JSON.parse((event as MessageEvent<string>).data) as AutomationStreamChange;
        } catch {
          return;
        }
        // 后到的通知覆盖前一条：只关心「有变化」，具体数据重拉时统一取。
        pending = parsed;
        if (flushTimer === undefined) {
          flushTimer = window.setTimeout(flush, 300);
        }
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        source = null;
        if (!disposed) {
          // EventSource 自带重连，但反向代理把流截断时它可能不再重试，这里兜底。
          reopenTimer = window.setTimeout(open, 5000);
        }
      };
    };

    open();
    return () => {
      disposed = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      if (reopenTimer !== undefined) window.clearTimeout(reopenTimer);
      source?.close();
    };
  }, []);

  return connected;
}
