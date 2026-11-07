import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import type { GameCallLogEntry, GameCallLogState } from "../types";

const REFRESH_MS = 3000;

function timeText(value: string) {
  const stamp = value || "";
  return stamp.length >= 23 ? `${stamp.slice(11, 19)}.${stamp.slice(20, 23)}` : stamp.slice(11) || "—";
}

type Tone = "success" | "error" | "warn" | "info";

function statusOf(entry: GameCallLogEntry): { text: string; tone: Tone } {
  if (entry.kind === "error") return { text: "异常", tone: "error" };
  if (entry.kind === "call") return { text: "下发", tone: "info" };
  if (entry.retCode && entry.retCode !== "512") return { text: `ret ${entry.retCode}`, tone: "warn" };
  return { text: "成功", tone: "success" };
}

export default function GameCallLogsPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const [entries, setEntries] = useState<GameCallLogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const limitRef = useRef(300);

  const load = useCallback(async (silent: boolean) => {
    try {
      const state = await api<GameCallLogState>(`/api/system/game-logs?limit=${limitRef.current}`);
      setUpdatedAt(state.updatedAt);
      setEntries((current) => {
        const seen = new Set(current.map((item) => item.key));
        const fresh = state.entries.filter((item) => !seen.has(item.key)).reverse();
        if (!fresh.length) return current;
        return [...fresh, ...current].slice(0, 600);
      });
    } catch (reason) {
      if (!silent) notify(reason instanceof ApiError ? reason.message : "游戏接口日志加载失败", "error");
    } finally {
      setLoaded(true);
    }
  }, [notify]);

  useEffect(() => { void load(false); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      // 后台标签页不轮询，回到页面时由下一次 interval 补齐。
      if (!document.hidden) void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (onlyProblems) {
        const abnormal = entry.kind === "error" || (entry.retCode !== "" && entry.retCode !== "512");
        if (!abnormal) return false;
      }
      if (!query) return true;
      return [entry.command, entry.params, entry.result, entry.tag, entry.error]
        .some((value) => (value || "").toLowerCase().includes(query));
    });
  }, [entries, keyword, onlyProblems]);

  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GAME SERVICE LOGS"
        title="游戏接口日志"
        description="后台把命令下发到游戏服（8890 /hall/command）的实时流水：命令名、参数、ret_code 和耗时。前端调后台自己的请求不会出现在这里。"
      />
      <section className="panel">
        <div className="toolbar toolbar--wrap">
          <form className="search-box" onSubmit={(event) => { event.preventDefault(); void load(false); }}>
            <span>⌕</span>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="按命令名、玩家 ID 或参数内容筛选" />
            <button>刷新</button>
          </form>
          <div className="toolbar__options">
            <label className="checkbox">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              每 3 秒自动刷新
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} />
              只看异常
            </label>
            <button type="button" className="link-button" onClick={() => setEntries([])}>清屏</button>
            <span className="toolbar__count">
              {updatedAt ? `更新于 ${updatedAt} · ` : ""}窗口内 {visible.length} 条
            </span>
          </div>
        </div>
        {!loaded ? <LoadingBlock label="正在读取后端日志" /> : visible.length === 0 ? (
          <EmptyState title="窗口内没有游戏服调用记录" description="后台没有下发命令时这里是空的；操作一次页面（如保存奖池、发公告）后会立即出现。" />
        ) : (
          <div className="table-wrap">
            <table className="game-log-table">
              <thead>
                <tr><th>时间</th><th>方向</th><th>命令</th><th>状态</th><th>耗时</th><th>参数 / 返回</th></tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const status = statusOf(entry);
                  const open = Boolean(expanded[entry.key]);
                  const detail = entry.kind === "call" ? entry.params : (entry.result || entry.error || entry.params);
                  return (
                    <tr key={entry.key} className={open ? "is-open" : undefined} onClick={() => toggle(entry.key)}>
                      <td className="game-log-table__time">{timeText(entry.time)}</td>
                      <td><span className={`log-badge log-badge--${status.tone}`}>{status.text}</span></td>
                      <td><strong>{entry.command || entry.tag}</strong>{entry.httpStatus && entry.httpStatus !== "200" ? <small className="cell-subtitle">HTTP {entry.httpStatus}</small> : null}</td>
                      <td className="game-log-table__tag">{entry.tag}</td>
                      <td className="game-log-table__time">{entry.durationMs ? `${entry.durationMs}ms` : "—"}</td>
                      <td>
                        <div className={`game-log-table__detail ${open ? "" : "is-clamped"}`}>{detail || "—"}</div>
                        {entry.kind !== "call" && entry.params ? (
                          <small className="cell-subtitle">参数 {entry.params}</small>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
