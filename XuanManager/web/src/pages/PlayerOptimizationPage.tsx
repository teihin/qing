import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import { formatBeijingDateTime } from "../time";
import type { PlayerOptimizationHistoryResponse, PlayerOptimizationItem, PlayerOptimizationsResponse, PlayerOptimizationState } from "../types";

type StatusFilter = "active" | "done" | "stopped" | "all";

const STATUS_LABEL: Record<string, string> = { active: "进行中", done: "已达成", stopped: "已停止" };

export default function PlayerOptimizationPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<PlayerOptimizationsResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<PlayerOptimizationItem | true | null>(null);
  const [editing, setEditing] = useState<PlayerOptimizationItem | null>(null);
  const [stopping, setStopping] = useState<PlayerOptimizationItem | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), state: status });
      if (appliedKeyword) params.set("keyword", appliedKeyword);
      const result = await api<PlayerOptimizationsResponse>(`/api/game/player-optimization?${params.toString()}`);
      setData(result);
      const pages = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(errorMessage(cause, "玩家控制数据加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, notify, page, pageSize, queryRevision, status]);

  useEffect(() => { void load(); }, [load]);

  const search = () => {
    setAppliedKeyword(keyword.trim());
    setPage(1);
    refreshQuery();
  };

  const reset = () => {
    setKeyword("");
    setAppliedKeyword("");
    setStatus("active");
    setPage(1);
    refreshQuery();
  };

  const canView = can("game.player_optimization.view");
  const canCreate = can("game.player_optimization.create");
  const canUpdate = can("game.player_optimization.update");
  const canDelete = can("game.player_optimization.delete");
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;
  const filtersActive = Boolean(appliedKeyword || status !== "active");
  const done = async () => {
    setAdding(null);
    setEditing(null);
    setStopping(null);
    setHistoryRefreshVersion((value) => value + 1);
    await load();
  };

  return <div className="page-stack optimization-page">
    <PageHeader
      eyebrow="WIN TARGET CONTROL"
      title="玩家控制"
      description="与牌桌内「牌局胜率目标」同一套方案：设置输赢金额与触发概率，由游戏服按局推进，达成自动结束。"
      actions={<>
        <span className="configuration-status is-live"><i />游戏服实时目标</span>
        {canCreate && <Button type="button" onClick={() => setAdding(true)}>＋ 新增玩家控制</Button>}
      </>}
    />

    <section className="optimization-metrics">
      <article><span>进行中目标</span><strong>{data?.summary.activePlayers ?? "—"}</strong><p>状态为进行中的玩家数</p></article>
      <article><span>目标金额合计</span><strong>{data ? data.summary.totalTargetAmount.toLocaleString("zh-CN") : "—"}</strong><p>进行中目标绝对值合计</p></article>
      <article><span>平均触发概率</span><strong>{data ? `${data.summary.averageChance.toFixed(1)}%` : "—"}</strong><p>仅统计进行中目标</p></article>
      <article className="optimization-risk"><span>服务端方案</span><strong>胜率目标</strong><p>与牌桌内胜率目标共用同一套命令与数据</p></article>
    </section>

    <section className="panel optimization-filter-panel">
      <form onSubmit={submitGuard(async () => search())}>
        <div className="optimization-search-row">
          <label className="search-box search-box--wide"><span>⌕</span><input maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家 ID/靓号、昵称、登录账号或设置人" /><button type="submit">查询</button></label>
          <label><span>目标状态</span><select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}><option value="active">进行中</option><option value="done">已达成</option><option value="stopped">已停止</option><option value="all">全部</option></select></label>
          <Button type="submit">应用条件</Button>
          {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
        </div>
        <p>同一位玩家只会有一条进行中的目标；再次设置会覆盖旧目标并从 0 重新累计进度。牌桌内设置的进度、剩余金额和局数同样显示在下方列表。</p>
      </form>
    </section>

    <section className="panel optimization-list-panel">
      <header className="panel__header"><div><span className="eyebrow">PLAYER WIN TARGETS</span><h2>玩家控制目标</h2></div><span>{data?.total ?? 0}</span></header>
      {loading && !data ? <LoadingBlock label="正在读取玩家控制目标" /> : !data || data.items.length === 0 ? (
        <EmptyState title={filtersActive ? "没有匹配的玩家目标" : "当前没有进行中的玩家控制"} description={canCreate ? "可点击页面右上角「新增玩家控制」按玩家 ID 设置输赢金额与概率。" : "当前账号只有查看权限。"} />
      ) : <>
        <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
          <table className="optimization-table optimization-target-table"><thead><tr><th>玩家</th><th>状态</th><th>目标</th><th>概率</th><th>进度</th><th>局数</th><th>设置人</th><th>设置时间</th><th className="align-right">操作</th></tr></thead><tbody>
            {data.items.map((item) => {
              const hasAction = item.active ? canUpdate || canDelete : false;
              return <tr key={`${item.playerId}-${item.state}-${item.setAt}`}>
                <td><div className="user-cell"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId} · 账号：{item.loginName || "—"}</small></div></div></td>
                <td><span className={`optimization-status ${item.active ? "is-active" : ""}`}><i />{STATUS_LABEL[item.state] ?? "未设置"}</span>{item.active && <small className="cell-subtitle">{item.online ? (item.curCount > 0 ? "在线 · 本局已生效" : "在线 · 等待下一局") : "离线 · 进房后生效"}</small>}</td>
                <td><strong className={`optimization-target-value ${item.targetValue >= 0 ? "is-win" : "is-lose"}`}>{describeTarget(item.targetValue)}</strong><small className="cell-subtitle">{item.targetValue >= 0 ? "让玩家赢" : "让玩家输"}</small></td>
                <td><div className="optimization-chance"><strong>{Math.abs(item.chance)}%</strong><span><i style={{ width: `${clampPercent(Math.abs(item.chance))}%` }} /></span></div></td>
                <td><div className="optimization-chance"><strong>{describeProgress(item)}</strong><span><i style={{ width: `${progressPercent(item)}%` }} /></span></div></td>
                <td><strong className="optimization-number">{item.roundCount.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">累计 {item.peerCount.toLocaleString("zh-CN")} 局</small></td>
                <td>{item.manName ? <><strong>{item.manName}</strong><small className="cell-subtitle">账号 {item.man}</small></> : <span>—</span>}</td>
                <td>{formatOptimizationDate(item.setAt)}</td>
                <td><div className="row-actions row-actions--right">
                  {item.active && canUpdate && <button type="button" onClick={() => setEditing(item)}>调整</button>}
                  {item.active && canDelete && <button type="button" className="is-danger" onClick={() => setStopping(item)}>停止</button>}
                  {!hasAction && <span className="readonly-badge"><i />仅查看</span>}
                </div></td>
              </tr>;
            })}
          </tbody></table>
        </div>
        <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条目标</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
      </>}
    </section>

    {canView && <OptimizationHistoryPanel refreshVersion={historyRefreshVersion} notify={notify} />}

    {adding && <AddOptimizationModal initialItem={adding === true ? undefined : adding} notify={notify} onClose={() => setAdding(null)} onDone={done} />}
    {editing && <OptimizationModal item={editing} notify={notify} onClose={() => setEditing(null)} onDone={done} />}
    {stopping && <StopOptimizationModal item={stopping} notify={notify} onClose={() => setStopping(null)} onDone={done} />}
  </div>;
}

function OptimizationHistoryPanel({ refreshVersion, notify }: {
  refreshVersion: number;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<PlayerOptimizationHistoryResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [state, setState] = useState<"" | PlayerOptimizationState>("");
  const [applied, setApplied] = useState({ keyword: "", state: "" as "" | PlayerOptimizationState });
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
      if (applied.state) params.set("state", applied.state);
      const response = await api<PlayerOptimizationHistoryResponse>(`/api/game/player-optimization/history?${params.toString()}`);
      setData(response);
      const pages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(errorMessage(cause, "控制历史加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [applied, notify, page, pageSize, queryRevision]);

  useEffect(() => { void refreshVersion; void load(); }, [load, refreshVersion]);

  const search = () => {
    setApplied({ keyword: keyword.trim(), state });
    setPage(1);
    refreshQuery();
  };
  const reset = () => {
    setKeyword("");
    setState("");
    setApplied({ keyword: "", state: "" });
    setPage(1);
    refreshQuery();
  };
  const filtersActive = Boolean(applied.keyword || applied.state);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  return <section className="panel optimization-history-panel">
    <header className="optimization-history-header">
      <div><span>WIN TARGET HISTORY</span><h2>控制历史记录</h2><p>每次设置单独留档；牌桌内和后台设置的目标都会出现在这里。</p></div>
      <strong>{data?.total ?? "—"}<small>条记录</small></strong>
    </header>
    <form className="optimization-history-filters" onSubmit={submitGuard(async () => search())}>
      <label className="optimization-history-search"><span>⌕</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家ID/靓号、昵称、设置人或分组" /></label>
      <label><span>结束状态</span><select value={state} onChange={(event) => setState(event.target.value as "" | PlayerOptimizationState)}><option value="">全部状态</option><option value="active">进行中</option><option value="done">已达成</option><option value="stopped">已停止</option></select></label>
      <Button type="submit">查询记录</Button>
      {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
    </form>

    {loading && !data ? <LoadingBlock label="正在读取控制历史记录" /> : !data || data.items.length === 0 ? <EmptyState title={filtersActive ? "没有匹配的控制记录" : "暂无控制历史记录"} description={filtersActive ? "可以修改或重置查询条件。" : "设置、覆盖、停止或达标后，记录会显示在这里。"} /> : <>
      <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
        <table className="optimization-history-table"><thead><tr><th>设置时间（北京时间）</th><th>玩家</th><th>目标</th><th>概率</th><th>结果</th><th>局数</th><th>状态</th><th>结束时间</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
          <td><strong>{formatOptimizationDate(item.setAt)}</strong><small className="cell-subtitle">记录 #{item.id}</small></td>
          <td><div className="optimization-history-player"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId}</small><small>账号：{item.loginName || "—"}</small></div></div></td>
          <td><strong className={`optimization-target-value ${item.targetValue >= 0 ? "is-win" : "is-lose"}`}>{describeTarget(item.targetValue)}</strong></td>
          <td><strong>{Math.abs(item.chance)}%</strong></td>
          <td><div className="optimization-history-change"><span>进度 {signedAmount(item.progress)}</span><i>→</i><strong>{item.finishReason === "done" ? "已达成" : item.state === "active" ? "进行中" : "提前停止"}</strong></div></td>
          <td><strong className="optimization-number">{item.roundCount.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">参与 {item.peerCount.toLocaleString("zh-CN")} 局</small></td>
          <td><span className={`optimization-history-result ${item.state === "done" ? "is-success" : item.state === "active" ? "" : "is-failed"}`}><i />{STATUS_LABEL[item.state] ?? "未知"}</span>{item.groupName && <small className="cell-subtitle">分组：{item.groupName}</small>}</td>
          <td><strong>{item.finishAt ? formatBeijingDateTime(item.finishAt) : "—"}</strong><small className="cell-subtitle">{item.manName ? `设置人 ${item.manName}` : ""}</small></td>
        </tr>)}</tbody></table>
      </div>
      <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条历史记录</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </>}
  </section>;
}

function AddOptimizationModal({ initialItem, notify, onClose, onDone }: {
  initialItem?: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [playerId, setPlayerId] = useState(initialItem?.playerId ?? "");
  const [player, setPlayer] = useState<PlayerOptimizationItem | null>(initialItem ?? null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("3000");
  const [chance, setChance] = useState("30");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountValue = Number(amount);
  const chanceValue = Number(chance);
  const validId = /^\d{6}$/.test(playerId.trim());
  const validAmount = Number.isInteger(amountValue) && amountValue >= 1 && amountValue <= 100000000;
  const validChance = Number.isInteger(chanceValue) && chanceValue >= 1 && chanceValue <= 100;
  const valid = Boolean(player && !player.active) && validAmount && validChance;

  const lookup = async () => {
    if (!validId) { setError("玩家 ID 必须是 6 位数字"); return; }
    setLookingUp(true); setError(""); setPlayer(null); setConfirmed(false);
    try {
      const result = await api<PlayerOptimizationItem>(`/api/game/player-optimization/${encodeURIComponent(playerId.trim())}`);
      setPlayer(result);
      if (result.active) setError(`该玩家已有进行中的控制（${describeTarget(result.targetValue)}，概率 ${Math.abs(result.chance)}%），请到列表中使用「调整」或「停止」。`);
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
        ...jsonBody({
          playerId: player.playerId,
          targetValue: direction === 1 ? amountValue : -amountValue,
          chance: chanceValue,
          reason: reason.trim(),
          confirm: true,
        }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "新增玩家控制失败"));
      setBusy(false);
    }
  };

  return <Modal wide eyebrow="CREATE WIN TARGET" title="新增玩家控制" onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-lookup">
        <Field label="玩家 ID" hint="输入 6 位游戏玩家 ID 或靓号，先核对玩家与当前状态"><input inputMode="numeric" maxLength={6} value={playerId} disabled={busy || lookingUp} onChange={(event) => { setPlayerId(event.target.value.replace(/\D/g, "").slice(0, 6)); setPlayer(null); setConfirmed(false); setError(""); }} placeholder="请输入玩家 ID" /></Field>
        <Button type="button" variant="secondary" disabled={!validId || busy || lookingUp} onClick={() => void lookup()}>{lookingUp ? "正在查询…" : "查询玩家"}</Button>
      </div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      {player && <div className="optimization-player-summary"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><small>玩家 ID：{player.playerId} · 登录账号：{player.loginName || "—"}</small></div><em>{player.active ? `进行中：${describeTarget(player.targetValue)} / ${Math.abs(player.chance)}%` : "可以新增"}</em></div>}
      {player && !player.active && <>
        <div className="operation-warning"><strong>与牌桌内胜率目标同一套方案</strong><p>后台通过服务器本机游戏服接口「异步_设置_胜率目标」写入输赢金额与概率；游戏服每局按概率挂上控制，进度达标后自动结束并恢复原设置。玩家离线也可以设置，进房后生效。</p></div>
        <TargetForm direction={direction} onDirection={setDirection} amount={amount} onAmount={(value) => { setAmount(value); setConfirmed(false); }} chance={chance} onChance={(value) => { setChance(value); setConfirmed(false); }} reason={reason} onReason={(value) => { setReason(value); setConfirmed(false); }} disabled={busy} validAmount={validAmount} validChance={validChance} />
        <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家、输赢金额和触发概率，确认新增玩家控制</span></label>
      </>}
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>{player && !player.active && <Button type="submit" disabled={!valid || !confirmed || busy}>{busy ? "正在写入并回读校验…" : "确认新增控制"}</Button>}</div>
    </form>
  </Modal>;
}

function OptimizationModal({ item, notify, onClose, onDone }: {
  item: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [direction, setDirection] = useState<1 | -1>(item.targetValue >= 0 ? 1 : -1);
  const [amount, setAmount] = useState(String(Math.abs(item.targetValue)));
  const [chance, setChance] = useState(String(Math.abs(item.chance)));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountValue = Number(amount);
  const chanceValue = Number(chance);
  const validAmount = Number.isInteger(amountValue) && amountValue >= 1 && amountValue <= 100000000;
  const validChance = Number.isInteger(chanceValue) && chanceValue >= 1 && chanceValue <= 100;
  const targetValue = direction === 1 ? amountValue : -amountValue;
  const changed = targetValue !== item.targetValue || chanceValue !== Math.abs(item.chance);
  const valid = validAmount && validChance;
  const markChanged = () => { setConfirmed(false); setError(""); };

  const submit = async () => {
    if (!valid || !changed || !confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/game/player-optimization/${encodeURIComponent(item.playerId)}`, {
        method: "PUT",
        ...jsonBody({
          targetValue, chance: chanceValue, reason: reason.trim(), confirm: true,
          expectedTargetValue: item.targetValue, expectedChance: Math.abs(item.chance),
        }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "调整玩家控制失败"));
      setBusy(false);
    }
  };

  return <Modal wide eyebrow="UPDATE WIN TARGET" title={`调整玩家 ${item.playerId} 的控制`} onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>玩家 ID：{item.playerId} · 登录账号：{item.loginName || "—"}</small></div><em>当前 {describeTarget(item.targetValue)} / {Math.abs(item.chance)}%</em></div>
      <div className="operation-warning operation-warning--danger"><strong>调整会用新目标覆盖当前目标</strong><p>游戏服会把旧目标按「被替换」结束并恢复原设置，新目标的进度从 0 重新累计。当前进度 {signedAmount(item.progress)}，已累计 {item.roundCount} 局。</p></div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <TargetForm direction={direction} onDirection={(value) => { setDirection(value); markChanged(); }} amount={amount} onAmount={(value) => { setAmount(value); markChanged(); }} chance={chance} onChance={(value) => { setChance(value); markChanged(); }} reason={reason} onReason={(value) => { setReason(value); markChanged(); }} disabled={busy} validAmount={validAmount} validChance={validChance} />
      <div className="optimization-preview"><div><span>修改前</span><strong>{describeTarget(item.targetValue)} · {Math.abs(item.chance)}%</strong></div><i>→</i><div className="is-active"><span>修改后</span><strong>{validAmount ? describeTarget(targetValue) : "—"} · {validChance ? chanceValue : "—"}%</strong></div></div>
      <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || !changed || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家、输赢金额和触发概率，确认用新目标覆盖当前控制</span></label>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={!valid || !changed || !confirmed || busy}>{busy ? "正在写入并回读校验…" : "确认保存调整"}</Button></div>
    </form>
  </Modal>;
}

function StopOptimizationModal({ item, notify, onClose, onDone }: {
  item: PlayerOptimizationItem;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/game/player-optimization/${encodeURIComponent(item.playerId)}`, {
        method: "DELETE",
        ...jsonBody({
          confirm: true, reason: reason.trim(),
          expectedTargetValue: item.targetValue, expectedChance: Math.abs(item.chance),
        }),
      });
      notify(result.message);
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause, "停止玩家控制失败"));
      setBusy(false);
    }
  };

  return <Modal eyebrow="STOP WIN TARGET" title="停止玩家控制" onClose={busy ? () => undefined : onClose}>
    <form className="optimization-modal" onSubmit={submitGuard(submit)}>
      <div className="optimization-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>玩家 ID：{item.playerId} · 登录账号：{item.loginName || "—"}</small></div><em>{describeTarget(item.targetValue)} / {Math.abs(item.chance)}%</em></div>
      <div className="operation-warning operation-warning--danger"><strong>停止后立即结束目标</strong><p>游戏服会恢复设置前的控制参数，当前进度 {signedAmount(item.progress)}、累计 {item.roundCount} 局将作为记录留档，不可继续。</p></div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <Field label="停止原因（选填）" hint="2 到 120 个字符，会写进操作日志"><input maxLength={120} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：活动结束" /></Field>
      <label className={`confirm-check optimization-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家和目标，确认停止该玩家控制</span></label>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="danger" disabled={!confirmed || busy}>{busy ? "正在停止…" : "确认停止控制"}</Button></div>
    </form>
  </Modal>;
}

function TargetForm({ direction, onDirection, amount, onAmount, chance, onChance, reason, onReason, disabled, validAmount, validChance }: {
  direction: 1 | -1;
  onDirection: (value: 1 | -1) => void;
  amount: string;
  onAmount: (value: string) => void;
  chance: string;
  onChance: (value: string) => void;
  reason: string;
  onReason: (value: string) => void;
  disabled: boolean;
  validAmount: boolean;
  validChance: boolean;
}) {
  return <>
    <Field label="输赢方向" hint="赢=让玩家在这段时间内赢到该金额；输=让玩家输掉该金额" as="div">
      <div className="optimization-direction">
        <button type="button" className={direction === 1 ? "is-active is-win" : ""} disabled={disabled} onClick={() => onDirection(1)}>赢</button>
        <button type="button" className={direction === -1 ? "is-active is-lose" : ""} disabled={disabled} onClick={() => onDirection(-1)}>输</button>
      </div>
    </Field>
    <div className="optimization-form-grid">
      <Field label="目标金额" hint={validAmount ? "1 到 100,000,000 的整数，单位与牌局内一致" : "目标金额必须是 1 到 100,000,000 的整数"} error={validAmount ? undefined : "请输入 1 到 100,000,000 的整数"}>
        <input type="number" min={1} max={100000000} step={1} value={amount} disabled={disabled} onChange={(event) => onAmount(event.target.value)} />
      </Field>
      <Field label="触发概率（%）" hint={validChance ? "1 到 100 的整数；每局按该概率挂上控制" : "概率必须是 1 到 100 的整数"} error={validChance ? undefined : "请输入 1 到 100 的整数"}>
        <input type="number" min={1} max={100} step={1} value={chance} disabled={disabled} onChange={(event) => onChance(event.target.value)} />
      </Field>
      <Field label="操作原因（选填）" hint="2 到 120 个字符，会写进操作日志">
        <input maxLength={120} value={reason} disabled={disabled} onChange={(event) => onReason(event.target.value)} placeholder="例如：客服补偿调整" />
      </Field>
    </div>
  </>;
}

function describeTarget(targetValue: number) {
  if (!Number.isFinite(targetValue) || targetValue === 0) return "—";
  return `${targetValue > 0 ? "赢" : "输"} ${Math.abs(targetValue).toLocaleString("zh-CN")}`;
}

function describeProgress(item: PlayerOptimizationItem) {
  const progress = Number.isFinite(item.progress) ? item.progress : 0;
  const remain = Number.isFinite(item.remain) ? item.remain : Math.abs(item.targetValue) - Math.abs(progress);
  const prefix = progress > 0 ? "+" : "";
  const target = Math.abs(item.targetValue).toLocaleString("zh-CN");
  return `${prefix}${progress.toLocaleString("zh-CN")} / ${target}${item.active ? `（剩 ${Math.max(0, Math.abs(remain)).toLocaleString("zh-CN")}）` : ""}`;
}

function signedAmount(value: number) {
  const numeric = Number.isFinite(value) ? value : 0;
  return `${numeric > 0 ? "+" : numeric < 0 ? "-" : ""}${Math.abs(numeric).toLocaleString("zh-CN")}`;
}

function progressPercent(item: PlayerOptimizationItem) {
  const target = Math.abs(item.targetValue);
  if (!target) return 0;
  return clampPercent((Math.abs(item.progress) / target) * 100);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatOptimizationDate(value: string) {
  if (!value || value.startsWith("0 ")) return "—";
  return formatBeijingDateTime(value);
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}
