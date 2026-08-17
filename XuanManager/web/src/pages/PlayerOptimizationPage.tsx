import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import { formatBeijingDateTime } from "../time";
import type { PlayerOptimizationHistoryItem, PlayerOptimizationHistoryResponse, PlayerOptimizationItem, PlayerOptimizationsResponse } from "../types";

type OptimizationStatus = "active" | "inactive" | "all";

export default function PlayerOptimizationPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<PlayerOptimizationsResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [status, setStatus] = useState<OptimizationStatus>("active");
  const [minChance, setMinChance] = useState("");
  const [maxChance, setMaxChance] = useState("");
  const [appliedRange, setAppliedRange] = useState({ min: "", max: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<PlayerOptimizationItem | true | null>(null);
  const [editing, setEditing] = useState<PlayerOptimizationItem | null>(null);
  const [deleting, setDeleting] = useState<PlayerOptimizationItem | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
      if (appliedKeyword) params.set("keyword", appliedKeyword);
      if (appliedRange.min) params.set("minChance", appliedRange.min);
      if (appliedRange.max) params.set("maxChance", appliedRange.max);
      const result = await api<PlayerOptimizationsResponse>(`/api/game/player-optimization?${params.toString()}`);
      setData(result);
      const pages = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(errorMessage(cause, "发牌优化参数加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, appliedRange, notify, page, pageSize, queryRevision, status]);

  useEffect(() => { void load(); }, [load]);

  const search = () => {
    const minimum = minChance.trim();
    const maximum = maxChance.trim();
    if ((minimum && (Number(minimum) < 0 || Number(minimum) > 100)) || (maximum && (Number(maximum) < 0 || Number(maximum) > 100))) {
      notify("概率筛选必须是 0 到 100", "error");
      return;
    }
    if (minimum && maximum && Number(minimum) > Number(maximum)) {
      notify("最低概率不能大于最高概率", "error");
      return;
    }
    setAppliedKeyword(keyword.trim());
    setAppliedRange({ min: minimum, max: maximum });
    setPage(1);
    refreshQuery();
  };

  const reset = () => {
    setKeyword("");
    setAppliedKeyword("");
    setStatus("active");
    setMinChance("");
    setMaxChance("");
    setAppliedRange({ min: "", max: "" });
    setPage(1);
    refreshQuery();
  };

  const canCreate = can("game.player_optimization.create");
  const canUpdate = can("game.player_optimization.update");
  const canDelete = can("game.player_optimization.delete");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;
  const filtersActive = Boolean(appliedKeyword || appliedRange.min || appliedRange.max || status !== "active");
  const done = async () => {
    setAdding(null);
    setEditing(null);
    setDeleting(null);
    setHistoryRefreshVersion((value) => value + 1);
    await load();
  };

  return <div className="page-stack optimization-page">
    <PageHeader eyebrow="DEAL OPTIMIZATION CONTROL" title="玩家优化" description="新增、调整或删除玩家发牌优化；本游戏不使用优化2或胡牌优化。" actions={<><span className="configuration-status is-live"><i />游戏账号实时参数</span>{canCreate && <Button type="button" onClick={() => setAdding(true)}>＋ 新增发牌优化</Button>}</>} />

    <section className="optimization-metrics">
      <article><span>当前启用玩家</span><strong>{data?.summary.activePlayers ?? "—"}</strong><p>剩余次数大于 0</p></article>
      <article><span>剩余优化总次数</span><strong>{data?.summary.totalRemaining.toLocaleString("zh-CN") ?? "—"}</strong><p>所有启用玩家合计</p></article>
      <article><span>平均触发概率</span><strong>{data ? `${data.summary.averageChance.toFixed(1)}%` : "—"}</strong><p>仅统计当前启用玩家</p></article>
      <article className="optimization-risk"><span>操作权限</span><strong>按角色授权</strong><p>新增、调整、删除可分别配置权限</p></article>
    </section>

    <section className="panel optimization-filter-panel">
      <form onSubmit={submitGuard(async () => search())}>
        <div className="optimization-search-row">
          <label className="search-box search-box--wide"><span>⌕</span><input maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家、后台设置账号或历史游戏设置人" /><button type="submit">查询</button></label>
          <label><span>优化状态</span><select value={status} onChange={(event) => { setStatus(event.target.value as OptimizationStatus); setPage(1); }}><option value="active">当前启用</option><option value="inactive">未启用</option><option value="all">全部玩家</option></select></label>
          <label><span>概率范围</span><div><input type="number" min={0} max={100} value={minChance} onChange={(event) => setMinChance(event.target.value)} placeholder="最低" /><i>—</i><input type="number" min={0} max={100} value={maxChance} onChange={(event) => setMaxChance(event.target.value)} placeholder="最高" /></div></label>
          <Button type="submit">应用条件</Button>
          {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
        </div>
        <p>“新增发牌优化”按玩家 ID 查找未启用玩家；已启用玩家可在列表中调整参数或删除优化。</p>
      </form>
    </section>

    <section className="panel optimization-list-panel">
      <header className="panel__header"><div><span className="eyebrow">PLAYER DEAL SETTINGS</span><h2>发牌优化参数</h2></div><span>{data?.total ?? 0}</span></header>
      {loading && !data ? <LoadingBlock label="正在读取玩家发牌优化参数" /> : !data || data.items.length === 0 ? (
        <EmptyState title={filtersActive ? "没有匹配的玩家" : "当前没有启用发牌优化的玩家"} description={canCreate ? "可点击页面右上角“新增发牌优化”按玩家 ID 添加。" : "当前账号只有查看权限。"} />
      ) : <>
        <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
          <table className="optimization-table"><thead><tr><th>玩家</th><th>状态</th><th>剩余次数</th><th>触发概率</th><th>设置账号</th><th>最近配置</th><th className="align-right">操作</th></tr></thead><tbody>
            {data.items.map((item) => {
              const hasAction = item.active ? canUpdate || canDelete : canCreate;
              return <tr key={item.playerId}>
                <td><div className="user-cell"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId} · 账号：{item.loginName || "—"}</small></div></div></td>
                <td><span className={`optimization-status ${item.active ? "is-active" : ""}`}><i />{item.active ? "已启用" : "未启用"}</span></td>
                <td><strong className="optimization-number">{item.remainingCount.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">次</small></td>
                <td><div className="optimization-chance"><strong>{item.chance}%</strong><span><i style={{ width: `${Math.max(0, Math.min(100, item.chance))}%` }} /></span></div></td>
                <td>{item.configuredSource === "hidden" ? <span>—</span> : item.configuredSource === "admin" ? <><strong>{item.configuredBy}</strong><small className="cell-subtitle">后台账号</small></> : item.managerId ? <><strong>{item.managerName || "游戏历史设置"}</strong><small className="cell-subtitle">历史游戏ID：{item.managerId}</small></> : <span>—</span>}</td>
                <td>{formatOptimizationDate(item.lastConfiguredAt)}</td>
                <td><div className="row-actions row-actions--right">
                  {!item.active && canCreate && <button type="button" onClick={() => setAdding(item)}>新增优化</button>}
                  {item.active && canUpdate && <button type="button" onClick={() => setEditing(item)}>调整参数</button>}
                  {item.active && canDelete && <button type="button" className="is-danger" onClick={() => setDeleting(item)}>删除优化</button>}
                  {!hasAction && <span className="readonly-badge"><i />仅查看</span>}
                </div></td>
              </tr>;
            })}
          </tbody></table>
        </div>
        <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 名玩家</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </>}
    </section>

    <OptimizationHistoryPanel refreshVersion={historyRefreshVersion} notify={notify} />

    {adding && <AddOptimizationModal initialItem={adding === true ? undefined : adding} notify={notify} onClose={() => setAdding(null)} onDone={done} />}
    {editing && <OptimizationModal item={editing} notify={notify} onClose={() => setEditing(null)} onDone={done} />}
    {deleting && <DeleteOptimizationModal item={deleting} notify={notify} onClose={() => setDeleting(null)} onDone={done} />}
  </div>;
}

function OptimizationHistoryPanel({ refreshVersion, notify }: {
  refreshVersion: number;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<PlayerOptimizationHistoryResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [operation, setOperation] = useState("all");
  const [result, setResult] = useState("all");
  const [applied, setApplied] = useState({ keyword: "", operation: "all", result: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (applied.keyword) params.set("keyword", applied.keyword);
      if (applied.operation !== "all") params.set("operation", applied.operation);
      if (applied.result !== "all") params.set("result", applied.result);
      const response = await api<PlayerOptimizationHistoryResponse>(`/api/game/player-optimization/history?${params.toString()}`);
      setData(response);
      const pages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(errorMessage(cause, "发牌优化历史加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [applied, notify, page, pageSize, queryRevision]);

  useEffect(() => { void refreshVersion; void load(); }, [load, refreshVersion]);

  const search = () => {
    setApplied({ keyword: keyword.trim(), operation, result });
    setPage(1);
    refreshQuery();
  };
  const reset = () => {
    setKeyword("");
    setOperation("all");
    setResult("all");
    setApplied({ keyword: "", operation: "all", result: "all" });
    setPage(1);
    refreshQuery();
  };
  const filtersActive = Boolean(applied.keyword || applied.operation !== "all" || applied.result !== "all");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  return <section className="panel optimization-history-panel">
    <header className="optimization-history-header">
      <div><span>DEAL OPTIMIZATION HISTORY</span><h2>发牌优化历史记录</h2><p>保留新增、调整和删除记录；列表已按当前账号的安全可见范围过滤。</p></div>
      <strong>{data?.total ?? "—"}<small>条记录</small></strong>
    </header>
    <form className="optimization-history-filters" onSubmit={submitGuard(async () => search())}>
      <label className="optimization-history-search"><span>⌕</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家ID、昵称、登录账号或操作人" /></label>
      <label><span>操作类型</span><select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="all">全部操作</option><option value="create">新增</option><option value="update">调整</option><option value="delete">删除</option></select></label>
      <label><span>操作结果</span><select value={result} onChange={(event) => setResult(event.target.value)}><option value="all">全部结果</option><option value="success">成功</option><option value="failed">失败</option></select></label>
      <Button type="submit">查询记录</Button>
      {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
    </form>

    {loading && !data ? <LoadingBlock label="正在读取发牌优化历史记录" /> : !data || data.items.length === 0 ? <EmptyState title={filtersActive ? "没有匹配的发牌优化记录" : "暂无发牌优化历史记录"} description={filtersActive ? "可以修改或重置查询条件。" : "通过本后台新增、调整或删除发牌优化后，记录会显示在这里。"} /> : <>
      <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
        <table className="optimization-history-table"><thead><tr><th>操作时间（北京时间）</th><th>玩家</th><th>操作</th><th>参数变化</th><th>操作人</th><th>结果</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
          <td><strong>{formatBeijingDateTime(item.createdAt)}</strong><small className="cell-subtitle">记录 #{item.id}</small></td>
          <td><div className="optimization-history-player"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId}</small><small>账号：{item.loginName || "—"}</small></div></div></td>
          <td><span className={`optimization-history-operation is-${item.operation}`}><i />{optimizationOperationLabel(item.operation)}</span></td>
          <td><OptimizationHistoryChange item={item} /></td>
          <td><strong>{item.operatorName || "系统 / 未知"}</strong><small className="cell-subtitle">后台管理账号</small></td>
          <td><span className={`optimization-history-result ${item.success ? "is-success" : "is-failed"}`}><i />{item.success ? "操作成功" : "操作失败"}</span><small className="cell-subtitle">{item.resultMessage || (item.success ? "参数已写入并回读" : `错误码 ${item.resultCode}`)}</small></td>
        </tr>)}</tbody></table>
      </div>
      <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条历史记录</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </>}
  </section>;
}

function OptimizationHistoryChange({ item }: { item: PlayerOptimizationHistoryItem }) {
  const before = item.hasBefore && item.beforeRemainingCount > 0 ? `${item.beforeRemainingCount.toLocaleString("zh-CN")} 次 · ${item.beforeChance}%` : "未启用";
  const after = item.hasAfter && item.afterRemainingCount > 0 ? `${item.afterRemainingCount.toLocaleString("zh-CN")} 次 · ${item.afterChance}%` : item.success ? "已停用" : "操作未完成";
  return <div className="optimization-history-change"><span>{before}</span><i>→</i><strong>{after}</strong>{item.reason && <small>备注：{item.reason}</small>}</div>;
}

function optimizationOperationLabel(operation: PlayerOptimizationHistoryItem["operation"]) {
  if (operation === "create") return "新增优化";
  if (operation === "delete") return "删除优化";
  return "调整参数";
}

function AddOptimizationModal({ initialItem, notify, onClose, onDone }: {
  initialItem?: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [playerId, setPlayerId] = useState(initialItem?.playerId ?? "");
  const [player, setPlayer] = useState<PlayerOptimizationItem | null>(initialItem ?? null);
  const [remainingCount, setRemainingCount] = useState("10");
  const [chance, setChance] = useState("100");
  const [confirmed, setConfirmed] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const countValue = Number(remainingCount);
  const chanceValue = Number(chance);
  const validId = /^\d{6}$/.test(playerId.trim());
  const valid = Boolean(player && !player.active) && Number.isInteger(countValue) && countValue >= 1 && countValue <= 1000000 && Number.isInteger(chanceValue) && chanceValue >= 1 && chanceValue <= 100;

  const lookup = async () => {
    if (!validId) { setError("玩家 ID 必须是 6 位数字"); return; }
    setLookingUp(true); setError(""); setPlayer(null); setConfirmed(false);
    try {
      const result = await api<PlayerOptimizationItem>(`/api/game/player-optimization/${encodeURIComponent(playerId.trim())}`);
      setPlayer(result);
      if (result.active) setError("该玩家已经启用发牌优化，请到列表中使用“调整参数”或“删除优化”。");
    } catch (cause) {
      setError(errorMessage(cause, "玩家查询失败"));
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async () => {
    if (!valid || !confirmed || !player) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/game/player-optimization", {
        method: "POST",
        ...jsonBody({ playerId: player.playerId, remainingCount: countValue, chance: chanceValue, confirm: true }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "新增发牌优化失败"));
      setBusy(false);
    }
  };

  return <Modal wide eyebrow="CREATE DEAL OPTIMIZATION" title="新增发牌优化" onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-lookup">
        <Field label="玩家 ID" hint="输入 6 位游戏玩家 ID，先核对玩家与当前状态"><input inputMode="numeric" maxLength={6} value={playerId} disabled={busy || lookingUp} onChange={(event) => { setPlayerId(event.target.value.replace(/\D/g, "").slice(0, 6)); setPlayer(null); setConfirmed(false); setError(""); }} placeholder="请输入玩家 ID" /></Field>
        <Button type="button" variant="secondary" disabled={!validId || busy || lookingUp} onClick={() => void lookup()}>{lookingUp ? "正在查询…" : "查询玩家"}</Button>
      </div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      {player && <div className="optimization-player-summary"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><small>玩家 ID：{player.playerId} · 登录账号：{player.loginName || "—"}</small></div><em>{player.active ? `已启用 ${player.remainingCount} 次 / ${player.chance}%` : "可以新增"}</em></div>}
      {player && !player.active && <>
        <div className="operation-warning"><strong>离线玩家也可以直接配置</strong><p>后台会在服务器本机通过数据库事务一次写入设置人、剩余次数和触发概率；提交时锁定该玩家记录并核对当前值，不依赖玩家登录状态。</p></div>
        <div className="optimization-form-grid">
          <Field label="剩余优化次数" hint="填写 1 到 1,000,000 的整数"><input type="number" min={1} max={1000000} step={1} value={remainingCount} disabled={busy} onChange={(event) => { setRemainingCount(event.target.value); setConfirmed(false); }} /></Field>
          <Field label="触发概率（%）" hint="填写 1 到 100 的整数"><input type="number" min={1} max={100} step={1} value={chance} disabled={busy} onChange={(event) => { setChance(event.target.value); setConfirmed(false); }} /></Field>
        </div>
        <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家、剩余次数和触发概率，确认新增发牌优化</span></label>
      </>}
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>{player && !player.active && <Button type="submit" disabled={!valid || !confirmed || busy}>{busy ? "正在新增并回读校验…" : "确认新增优化"}</Button>}</div>
    </form>
  </Modal>;
}

function OptimizationModal({ item, notify, onClose, onDone }: {
  item: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [remainingCount, setRemainingCount] = useState(String(item.remainingCount));
  const [chance, setChance] = useState(String(item.chance));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const countValue = Number(remainingCount);
  const chanceValue = Number(chance);
  const valid = Number.isInteger(countValue) && countValue >= 1 && countValue <= 1000000 && Number.isInteger(chanceValue) && chanceValue >= 1 && chanceValue <= 100;
  const changed = countValue !== item.remainingCount || chanceValue !== item.chance;
  const markChanged = () => { setConfirmed(false); setError(""); };

  const submit = async () => {
    if (!valid || !changed || !confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/game/player-optimization/${encodeURIComponent(item.playerId)}`, {
        method: "PUT",
        ...jsonBody({ remainingCount: countValue, chance: chanceValue, confirm: true, expectedManager: item.managerId, expectedCount: item.remainingCount, expectedChance: item.chance }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "调整发牌优化失败"));
      setBusy(false);
    }
  };

  return <Modal wide eyebrow="UPDATE DEAL OPTIMIZATION" title={`调整玩家 ${item.playerId} 的发牌优化`} onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>玩家 ID：{item.playerId} · 登录账号：{item.loginName || "—"}</small></div><em>当前剩余 {item.remainingCount} 次 / {item.chance}%</em></div>
      <div className="operation-warning operation-warning--danger"><strong>这里只调整已存在的优化</strong><p>如需停用请关闭弹窗，在玩家行中点击“删除优化”。后台会在数据库事务内校验页面基准并一次完成修改，不依赖玩家是否在线。</p></div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <div className="optimization-form-grid">
        <Field label="剩余优化次数" hint="填写 1 到 1,000,000 的整数"><input type="number" min={1} max={1000000} step={1} value={remainingCount} disabled={busy} onChange={(event) => { setRemainingCount(event.target.value); markChanged(); }} /></Field>
        <Field label="触发概率（%）" hint="填写 1 到 100 的整数"><input type="number" min={1} max={100} step={1} value={chance} disabled={busy} onChange={(event) => { setChance(event.target.value); markChanged(); }} /></Field>
      </div>
      <div className="optimization-preview"><div><span>修改前</span><strong>{item.remainingCount} 次 · {item.chance}%</strong></div><i>→</i><div className="is-active"><span>修改后</span><strong>{Number.isFinite(countValue) ? countValue : 0} 次 · {Number.isFinite(chanceValue) ? chanceValue : 0}%</strong></div></div>
      <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || !changed || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家、剩余次数和触发概率，确认修改发牌优化参数</span></label>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={!valid || !changed || !confirmed || busy}>{busy ? "正在写入并回读校验…" : "确认保存调整"}</Button></div>
    </form>
  </Modal>;
}

function DeleteOptimizationModal({ item, notify, onClose, onDone }: {
  item: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/game/player-optimization/${encodeURIComponent(item.playerId)}`, {
        method: "DELETE",
        ...jsonBody({ confirm: true, expectedManager: item.managerId, expectedCount: item.remainingCount, expectedChance: item.chance }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "删除发牌优化失败"));
      setBusy(false);
    }
  };

  return <Modal eyebrow="DELETE DEAL OPTIMIZATION" title="删除发牌优化" onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>玩家 ID：{item.playerId} · 登录账号：{item.loginName || "—"}</small></div><em>{item.remainingCount} 次 / {item.chance}%</em></div>
      <div className="operation-warning operation-warning--danger"><strong>删除后停止该玩家的发牌优化</strong><p>系统会在数据库事务中把发牌优化设置人、剩余次数和触发概率一次清空，并记录删除前后的完整审计；玩家离线时也可操作。</p></div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家和当前参数，确认删除并清空该玩家的发牌优化</span></label>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="danger" disabled={!confirmed || busy}>{busy ? "正在删除并回读校验…" : "确认删除优化"}</Button></div>
    </form>
  </Modal>;
}

function formatOptimizationDate(value: string) {
  if (!value || value.startsWith("0 ")) return "—";
  return formatBeijingDateTime(value);
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}
