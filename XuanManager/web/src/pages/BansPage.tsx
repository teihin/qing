import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, formatDate, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import type { BannedPlayerItem, BannedPlayersResponse, PlayerBanHistoryResponse } from "../types";

const defaultReason = "你的账号已被暂停使用！";

export default function BansPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<BannedPlayersResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [reason, setReason] = useState(defaultReason);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unbanTarget, setUnbanTarget] = useState<BannedPlayerItem | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (appliedKeyword) params.set("keyword", appliedKeyword);
      const result = await api<BannedPlayersResponse>(`/api/game/bans?${params.toString()}`);
      setData(result);
      if (result.total > 0 && page > Math.ceil(result.total / pageSize)) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
    } catch (cause) {
      notify(errorMessage(cause, "已封账号列表加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, notify, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const normalizedPlayerId = playerId.trim();
  const playerIdValid = /^\d{6}$/.test(normalizedPlayerId);
  const normalizedReason = reason.trim();
  const reasonLength = Array.from(normalizedReason).length;
  const canCreate = can("game.ban.create");
  const canRemove = can("game.ban.remove");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  const submitBan = async () => {
    if (!playerIdValid) { notify("请输入准确的 6 位游戏玩家 ID", "error"); return; }
    if (reasonLength > 120) { notify("封号提示不能超过 120 个字符", "error"); return; }
    if (!confirmed) { notify("请先确认封号影响", "error"); return; }
    setSubmitting(true);
    try {
      const result = await api<{ message: string }>("/api/game/bans", {
        method: "POST",
        ...jsonBody({ playerId: normalizedPlayerId, reason: normalizedReason, confirm: true }),
      });
      notify(result.message);
      setPlayerId("");
      setReason(defaultReason);
      setConfirmed(false);
      setAppliedKeyword("");
      setKeyword("");
      setPage(1);
      setHistoryRefreshVersion((value) => value + 1);
      await load();
    } catch (cause) {
      notify(errorMessage(cause, "封号失败"), "error");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const search = () => {
    setAppliedKeyword(keyword.trim());
    setPage(1);
  };

  const resetSearch = () => {
    setKeyword("");
    setAppliedKeyword("");
    setPage(1);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ACCOUNT ACCESS CONTROL" title="封号管理" description="按游戏玩家 ID 封禁账号，查看当前封号，并追溯每次封号与解封记录。" actions={<span className="configuration-status is-live"><i />游戏账号实时状态</span>} />

      <section className="panel ban-create-panel">
        <div className="ban-create-intro">
          <span className="ban-create-intro__mark">封</span>
          <div><span>GAME ACCOUNT BAN</span><h2>封禁指定游戏账号</h2><p>这里只操作游戏玩家，不会影响 XuanManager 后台用户。封号后，玩家端会显示下方封号提示。</p></div>
        </div>
        <form className="ban-create-form" onSubmit={submitGuard(submitBan)}>
          <label className="ban-field"><span>游戏玩家 ID</span><input inputMode="numeric" maxLength={6} autoComplete="off" value={playerId} disabled={!canCreate || submitting} onChange={(event) => { setPlayerId(event.target.value.replace(/\D/g, "").slice(0, 6)); setConfirmed(false); }} placeholder="请输入 6 位玩家 ID" /><small className={playerId && !playerIdValid ? "is-error" : ""}>{playerId && !playerIdValid ? "还需输入完整的 6 位数字" : "精确匹配，不支持昵称或登录账号"}</small></label>
          <label className="ban-field ban-field--reason"><span>玩家端封号提示</span><textarea rows={3} maxLength={121} value={reason} disabled={!canCreate || submitting} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /><small className={reasonLength > 120 ? "is-error" : ""}>{reasonLength} / 120 字；留空时使用默认提示</small></label>
          <label className={`ban-confirm ${confirmed ? "is-checked" : ""}`}>
            <input type="checkbox" checked={confirmed} disabled={!canCreate || !playerIdValid || reasonLength > 120 || submitting} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><strong>确认封禁玩家 {playerIdValid ? normalizedPlayerId : "账号"}</strong><small>我已核对玩家 ID；操作会立即写入游戏账号状态并记录审计。</small></span>
          </label>
          <div className="ban-create-actions">
            <p>{canCreate ? "服务端写入后会自动回读校验，未确认成功时会明确提示人工核对。" : "当前角色只有查看已封账号的权限。"}</p>
            {canCreate && <Button type="submit" variant="danger" disabled={!playerIdValid || !confirmed || reasonLength > 120 || submitting}>{submitting ? "正在封号并校验…" : "确认封号"}</Button>}
          </div>
        </form>
      </section>

      <section className="panel ban-list-panel">
        <header className="ban-list-toolbar">
          <div><span>BANNED ACCOUNTS</span><h2>全部已封账号</h2><p>列表直接读取游戏账号当前状态；历史或其他工具执行的封号也会显示。</p></div>
          <form onSubmit={submitGuard(async () => search())}>
            <input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家ID、昵称、账号或封号原因" />
            <Button type="submit">查询</Button>
            {appliedKeyword && <Button type="button" variant="secondary" onClick={resetSearch}>清空</Button>}
          </form>
        </header>

        {loading && !data ? <LoadingBlock label="正在读取全部已封账号" /> : !data || data.items.length === 0 ? (
          <EmptyState title={appliedKeyword ? "没有匹配的已封账号" : "暂无已封账号"} description={appliedKeyword ? "可以清空查询条件后查看全部封号。" : "当前游戏账号中没有被封禁的玩家。"} />
        ) : <>
          <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
            <table className="ban-table"><thead><tr><th>玩家</th><th>登录账号</th><th>封号提示</th><th>游戏状态</th><th>封号记录</th><th className="align-right">操作</th></tr></thead><tbody>
              {data.items.map((item) => <BanRow key={item.playerId} item={item} canRemove={canRemove} onUnban={setUnbanTarget} />)}
            </tbody></table>
          </div>
          <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 个已封账号</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
        </>}
      </section>

      <BanHistoryPanel refreshVersion={historyRefreshVersion} notify={notify} />

      {unbanTarget && <UnbanModal item={unbanTarget} notify={notify} onClose={() => setUnbanTarget(null)} onDone={async () => { setUnbanTarget(null); setHistoryRefreshVersion((value) => value + 1); await load(); }} />}
    </div>
  );
}

function BanRow({ item, canRemove, onUnban }: { item: BannedPlayerItem; canRemove: boolean; onUnban: (item: BannedPlayerItem) => void }) {
  return <tr><td><div className="user-cell"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId}</small></div></div></td><td><code>{item.loginName || "—"}</code>{item.accountName && item.accountName !== item.loginName && <small className="cell-subtitle">KBE：{item.accountName}</small>}</td><td><strong className="ban-reason">{item.reason}</strong></td><td><span>{item.roomId > 0 ? `房间 ${item.roomId}` : "未在房间"}</span><small className="cell-subtitle">{item.agentId ? `代理 ${item.agentId}` : "无直属代理"}{item.clientVersion ? ` · ${item.clientVersion}` : ""}</small></td><td>{item.bannedAt ? <><strong>{formatDate(item.bannedAt)}</strong><small className="cell-subtitle">操作者：{item.bannedBy || "后台"}</small></> : <><span>历史 / 外部操作</span><small className="cell-subtitle">最近登录：{formatDate(item.lastLoginAt)}</small></>}</td><td><div className="row-actions row-actions--right">{canRemove ? <button className="ban-unban-button" type="button" onClick={() => onUnban(item)}>解除封号</button> : <span className="readonly-badge"><i />仅查看</span>}</div></td></tr>;
}

function BanHistoryPanel({ refreshVersion, notify }: {
  refreshVersion: number;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<PlayerBanHistoryResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [operation, setOperation] = useState("all");
  const [result, setResult] = useState("all");
  const [applied, setApplied] = useState({ keyword: "", operation: "all", result: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (applied.keyword) params.set("keyword", applied.keyword);
      if (applied.operation !== "all") params.set("operation", applied.operation);
      if (applied.result !== "all") params.set("result", applied.result);
      const response = await api<PlayerBanHistoryResponse>(`/api/game/bans/history?${params.toString()}`);
      setData(response);
      const pages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(errorMessage(cause, "封号历史加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [applied, notify, page, pageSize]);

  useEffect(() => { void refreshVersion; void load(); }, [load, refreshVersion]);

  const search = () => {
    setApplied({ keyword: keyword.trim(), operation, result });
    setPage(1);
  };
  const reset = () => {
    setKeyword("");
    setOperation("all");
    setResult("all");
    setApplied({ keyword: "", operation: "all", result: "all" });
    setPage(1);
  };
  const filtersActive = Boolean(applied.keyword || applied.operation !== "all" || applied.result !== "all");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  return <section className="panel ban-history-panel">
    <header className="ban-history-header">
      <div><span>BAN OPERATION HISTORY</span><h2>封号历史记录</h2><p>记录后台执行的封号和解封操作；失败记录也会保留，便于核查。</p></div>
      <strong>{data?.total ?? "—"}<small>条记录</small></strong>
    </header>
    <form className="ban-history-filters" onSubmit={submitGuard(async () => search())}>
      <label className="ban-history-search"><span>⌕</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家ID、昵称、账号、原因或操作人" /></label>
      <label><span>操作类型</span><select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="all">全部操作</option><option value="ban">封号</option><option value="unban">解封</option></select></label>
      <label><span>操作结果</span><select value={result} onChange={(event) => setResult(event.target.value)}><option value="all">全部结果</option><option value="success">成功</option><option value="failed">失败</option></select></label>
      <Button type="submit">查询记录</Button>
      {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
    </form>

    {loading && !data ? <LoadingBlock label="正在读取封号历史记录" /> : !data || data.items.length === 0 ? <EmptyState title={filtersActive ? "没有匹配的封号记录" : "暂无封号历史记录"} description={filtersActive ? "可以修改或重置查询条件。" : "通过本后台执行封号或解封后，记录会显示在这里。"} /> : <>
      <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
        <table className="ban-history-table"><thead><tr><th>操作时间</th><th>玩家</th><th>操作</th><th>当时封号原因</th><th>操作人</th><th>结果</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
          <td><strong>{formatBanHistoryDate(item.createdAt)}</strong><small className="cell-subtitle">记录 #{item.id}</small></td>
          <td><div className="ban-history-player"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId}</small><small>账号：{item.loginName || item.accountName || "—"}</small></div></div></td>
          <td><span className={`ban-history-operation is-${item.operation}`}><i />{item.operation === "ban" ? "封号" : "解除封号"}</span></td>
          <td><strong className="ban-history-reason">{item.reason || "未记录原因"}</strong></td>
          <td><strong>{item.operatorName || "系统 / 未知"}</strong><small className="cell-subtitle">后台管理账号</small></td>
          <td><span className={`ban-history-result ${item.success ? "is-success" : "is-failed"}`}><i />{item.success ? "操作成功" : "操作失败"}</span><small className="cell-subtitle">{item.resultMessage || (item.success ? "已完成状态回读" : `错误码 ${item.resultCode}`)}</small></td>
        </tr>)}</tbody></table>
      </div>
      <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条历史记录</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </>}
  </section>;
}

function UnbanModal({ item, notify, onClose, onDone }: { item: BannedPlayerItem; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onDone: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => item.name ? `${item.name}（${item.playerId}）` : item.playerId, [item]);
  const unban = async () => {
    if (!confirmed) { notify("请先确认解除封号", "error"); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>(`/api/game/bans/${encodeURIComponent(item.playerId)}/unban`, { method: "POST", ...jsonBody({ confirm: true }) });
      notify(result.message);
      await onDone();
    } catch (cause) {
      notify(errorMessage(cause, "解封失败"), "error");
      setBusy(false);
    }
  };
  return <Modal eyebrow="RESTORE ACCOUNT ACCESS" title="确认解除封号" onClose={busy ? () => undefined : onClose}><form className="unban-form" onSubmit={submitGuard(unban)}><div className="unban-summary"><span>解</span><div><strong>{summary}</strong><small>当前提示：{item.reason}</small></div></div><p className="unban-notice">解封后会清空该玩家的 <code>client_status</code>，玩家可恢复正常登录和使用游戏。</p><label className={`ban-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认解除玩家 {item.playerId} 的封号</strong><small>我已核对玩家身份，了解解封会立即生效并写入操作审计。</small></span></label><div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={!confirmed || busy}>{busy ? "正在解封并校验…" : "确认解封"}</Button></div></form></Modal>;
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}

function formatBanHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
