import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import type { TransactionBlacklistItem, TransactionBlacklistState } from "../types";

type MutationResponse = { state: TransactionBlacklistState; message: string };

export default function TransactionBlacklistPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<TransactionBlacklistState | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [newPlayerId, setNewPlayerId] = useState("");
  const [addConfirmed, setAddConfirmed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TransactionBlacklistItem | null>(null);
  const [deleting, setDeleting] = useState<TransactionBlacklistItem | null>(null);
  const [statusTarget, setStatusTarget] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<TransactionBlacklistState>("/api/game/transaction-blacklist"));
    } catch (cause) {
      notify(errorMessage(cause, "交易黑名单加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return data?.items ?? [];
    return (data?.items ?? []).filter((item) => [item.playerId, item.name, item.loginName, item.agentId].some((value) => value.toLowerCase().includes(query)));
  }, [data, keyword]);

  const canCreate = can("game.transaction_blacklist.create");
  const canUpdate = can("game.transaction_blacklist.update");
  const canDelete = can("game.transaction_blacklist.delete");
  const writesBlocked = Boolean(data?.warnings.length);
  const normalizedId = newPlayerId.trim();
  const validId = /^\d{6}$/.test(normalizedId);

  const add = async () => {
    if (!data || !validId || !addConfirmed || writesBlocked) return;
    setAdding(true);
    try {
      const result = await api<MutationResponse>("/api/game/transaction-blacklist", {
        method: "POST",
        ...jsonBody({ playerId: normalizedId, revision: data.revision, confirm: true }),
      });
      setData(result.state);
      setNewPlayerId("");
      setAddConfirmed(false);
      notify(result.message);
    } catch (cause) {
      notify(errorMessage(cause, "加入交易黑名单失败"), "error");
      await load();
    } finally {
      setAdding(false);
    }
  };

  return <div className="page-stack transaction-blacklist-page">
    <PageHeader
      eyebrow="COIN TRANSFER CONTROL"
      title="交易黑名单"
      description="管理禁止赠送金币的游戏玩家；不会封禁登录，也不会限制进入房间。"
      actions={<span className={`configuration-status ${data?.enabled ? "is-enabled" : "is-empty"}`}><i />{data ? (data.enabled ? "名单已生效" : "名单未启用") : "正在读取"}</span>}
    />

    <section className={`transaction-blacklist-status ${data?.enabled ? "is-enabled" : ""}`}>
      <div className="transaction-blacklist-status__mark">{data?.enabled ? "启" : "停"}</div>
      <div className="transaction-blacklist-status__copy">
        <span>BLACKLIST MASTER SWITCH</span>
        <h2>{data?.enabled ? "交易黑名单当前生效" : "交易黑名单当前未启用"}</h2>
        <p>{data?.enabled ? `名单内 ${data.total} 名玩家不能向其他玩家赠送金币。` : `已保留 ${data?.total ?? 0} 名玩家，重新启用后才会限制赠送金币。`}</p>
      </div>
      <div className="transaction-blacklist-status__metric"><strong>{data?.total ?? "—"}</strong><span>名单玩家</span></div>
      {canUpdate ? <Button type="button" variant={data?.enabled ? "danger" : "primary"} disabled={!data || loading || writesBlocked} onClick={() => setStatusTarget(!data?.enabled)}>{data?.enabled ? "停用名单" : "启用名单"}</Button> : <span className="readonly-badge"><i />仅查看</span>}
    </section>

    {data?.warnings.length ? <div className="transaction-blacklist-warning"><strong>配置中存在无法识别的内容</strong><p>检测到：{data.warnings.join("、")}。为防止误删旧配置，后台已暂停全部写操作，请先人工核对游戏配置。</p></div> : null}

    <section className="panel transaction-blacklist-add">
      <div>
        <span className="eyebrow">ADD PLAYER</span>
        <h2>新增黑名单玩家</h2>
        <p>输入准确的 6 位游戏玩家 ID。后台会先核对玩家资料，再写入游戏配置并回读确认。</p>
      </div>
      {canCreate ? <form onSubmit={submitGuard(add)}>
        <label><span>游戏玩家 ID</span><input inputMode="numeric" maxLength={6} value={newPlayerId} disabled={adding || writesBlocked} onChange={(event) => { setNewPlayerId(event.target.value.replace(/\D/g, "").slice(0, 6)); setAddConfirmed(false); }} placeholder="例如 648425" /><small className={newPlayerId && !validId ? "is-error" : ""}>{newPlayerId && !validId ? "请输入完整的 6 位数字" : "精确匹配游戏玩家，不支持昵称"}</small></label>
        <label className={`transaction-blacklist-confirm ${addConfirmed ? "is-checked" : ""}`}><input type="checkbox" checked={addConfirmed} disabled={!validId || adding || writesBlocked} onChange={(event) => setAddConfirmed(event.target.checked)} /><span><strong>确认加入交易黑名单</strong><small>启用总开关时，该玩家将不能赠送金币。</small></span></label>
        <Button type="submit" disabled={!validId || !addConfirmed || adding || writesBlocked}>{adding ? "正在写入并校验…" : "＋ 加入黑名单"}</Button>
      </form> : <span className="readonly-badge"><i />当前角色无新增权限</span>}
    </section>

    <section className="panel transaction-blacklist-list">
      <header>
        <div><span className="eyebrow">BLOCKED PLAYERS</span><h2>黑名单用户</h2><p>可按玩家 ID、昵称、登录账号或代理 ID 快速筛选。</p></div>
        <label className="transaction-blacklist-search"><span>⌕</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索当前名单" />{keyword && <button type="button" onClick={() => setKeyword("")}>清空</button>}</label>
      </header>
      {loading && !data ? <LoadingBlock label="正在读取交易黑名单" /> : !data || data.items.length === 0 ? <EmptyState title="交易黑名单为空" description={canCreate ? "可在上方输入游戏玩家 ID 加入名单。" : "当前没有禁止赠送金币的玩家。"} /> : visibleItems.length === 0 ? <EmptyState title="没有匹配的黑名单玩家" description="换一个玩家 ID、昵称、登录账号或代理 ID 试试。" /> : <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
        <table className="transaction-blacklist-table"><thead><tr><th>玩家</th><th>登录账号</th><th>直属代理</th><th>当前状态</th><th className="align-right">操作</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.playerId}>
          <td><div className="user-cell"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || (item.exists ? "未设置昵称" : "账号记录已不存在")}</strong><small>ID：{item.playerId}</small></div></div></td>
          <td><code>{item.loginName || "—"}</code></td>
          <td>{item.agentId ? <><strong>{item.agentId}</strong><small className="cell-subtitle">直属代理 ID</small></> : "—"}</td>
          <td><span className={`transaction-blacklist-player-status ${data.enabled ? "is-blocked" : ""}`}><i />{data.enabled ? "禁止赠送金币" : "名单已保留"}</span>{item.roomId > 0 && <small className="cell-subtitle">当前记录房间：{item.roomId}</small>}{!item.exists && <small className="cell-subtitle is-error">游戏账号资料未找到</small>}</td>
          <td><div className="row-actions row-actions--right">{canUpdate && <button type="button" disabled={writesBlocked} onClick={() => setEditing(item)}>修改用户</button>}{canDelete && <button type="button" className="is-danger" disabled={writesBlocked} onClick={() => setDeleting(item)}>删除</button>}{!canUpdate && !canDelete && <span className="readonly-badge"><i />仅查看</span>}</div></td>
        </tr>)}</tbody></table>
      </div>}
      {data && data.items.length > 0 && <footer className="transaction-blacklist-footer"><span>当前显示 {visibleItems.length} / {data.total} 名玩家</span><span>修改配置后自动回读游戏服务，避免页面显示与实际配置不一致。</span></footer>}
    </section>

    {editing && data && <EditBlacklistPlayerModal item={editing} revision={data.revision} onClose={() => setEditing(null)} onDone={(result) => { setData(result.state); setEditing(null); notify(result.message); }} onReload={load} />}
    {deleting && data && <DeleteBlacklistPlayerModal item={deleting} revision={data.revision} onClose={() => setDeleting(null)} onDone={(result) => { setData(result.state); setDeleting(null); notify(result.message); }} onReload={load} />}
    {statusTarget !== null && data && <BlacklistStatusModal enabled={statusTarget} revision={data.revision} total={data.total} onClose={() => setStatusTarget(null)} onDone={(result) => { setData(result.state); setStatusTarget(null); notify(result.message); }} onReload={load} />}
  </div>;
}

function EditBlacklistPlayerModal({ item, revision, onClose, onDone, onReload }: {
  item: TransactionBlacklistItem;
  revision: string;
  onClose: () => void;
  onDone: (result: MutationResponse) => void;
  onReload: () => Promise<void>;
}) {
  const [playerId, setPlayerId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalized = playerId.trim();
  const valid = /^\d{6}$/.test(normalized) && normalized !== item.playerId;
  const submit = async () => {
    if (!valid || !confirmed) return;
    setBusy(true); setError("");
    try {
      onDone(await api<MutationResponse>(`/api/game/transaction-blacklist/${encodeURIComponent(item.playerId)}`, { method: "PUT", ...jsonBody({ newPlayerId: normalized, revision, confirm: true }) }));
    } catch (cause) {
      setError(errorMessage(cause, "修改黑名单用户失败"));
      await onReload();
      setBusy(false);
    }
  };
  return <Modal eyebrow="REPLACE BLACKLIST PLAYER" title="修改黑名单用户" onClose={busy ? () => undefined : onClose}><form className="transaction-blacklist-modal" onSubmit={submitGuard(submit)}>
    <div className="transaction-blacklist-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "当前黑名单玩家"}</strong><small>当前玩家 ID：{item.playerId}</small></div></div>
    <p className="transaction-blacklist-modal__note">修改会用新的玩家 ID 替换当前记录，不会同时保留两名玩家。后台会核对新玩家确实存在。</p>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    <label className="transaction-blacklist-modal__field"><span>新的游戏玩家 ID</span><input autoFocus inputMode="numeric" maxLength={6} value={playerId} disabled={busy} onChange={(event) => { setPlayerId(event.target.value.replace(/\D/g, "").slice(0, 6)); setConfirmed(false); setError(""); }} placeholder="请输入新的 6 位玩家 ID" /><small>{normalized === item.playerId ? "新玩家 ID 不能与原玩家相同" : "精确匹配 6 位游戏玩家 ID"}</small></label>
    <label className={`transaction-blacklist-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={!valid || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认替换黑名单用户</strong><small>{item.playerId} 将恢复资格，新玩家 {valid ? normalized : "—"} 将受到限制。</small></span></label>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={!valid || !confirmed || busy}>{busy ? "正在修改并校验…" : "确认修改"}</Button></div>
  </form></Modal>;
}

function DeleteBlacklistPlayerModal({ item, revision, onClose, onDone, onReload }: {
  item: TransactionBlacklistItem;
  revision: string;
  onClose: () => void;
  onDone: (result: MutationResponse) => void;
  onReload: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      onDone(await api<MutationResponse>(`/api/game/transaction-blacklist/${encodeURIComponent(item.playerId)}`, { method: "DELETE", ...jsonBody({ revision, confirm: true }) }));
    } catch (cause) {
      setError(errorMessage(cause, "删除黑名单用户失败"));
      await onReload();
      setBusy(false);
    }
  };
  return <Modal eyebrow="REMOVE BLACKLIST PLAYER" title="删除黑名单用户" onClose={busy ? () => undefined : onClose}><form className="transaction-blacklist-modal" onSubmit={submitGuard(submit)}>
    <div className="transaction-blacklist-player-summary"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "当前黑名单玩家"}</strong><small>玩家 ID：{item.playerId} · 登录账号：{item.loginName || "—"}</small></div></div>
    <div className="operation-warning operation-warning--danger"><strong>删除后恢复赠送金币资格</strong><p>若总开关已启用，该玩家会立即不再受交易黑名单限制；操作不会删除游戏账号。</p></div>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    <label className={`transaction-blacklist-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认从名单删除玩家 {item.playerId}</strong><small>我已核对玩家身份，了解删除后会恢复赠送金币资格。</small></span></label>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="danger" disabled={!confirmed || busy}>{busy ? "正在删除并校验…" : "确认删除"}</Button></div>
  </form></Modal>;
}

function BlacklistStatusModal({ enabled, revision, total, onClose, onDone, onReload }: {
  enabled: boolean;
  revision: string;
  total: number;
  onClose: () => void;
  onDone: (result: MutationResponse) => void;
  onReload: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      onDone(await api<MutationResponse>("/api/game/transaction-blacklist/status", { method: "PUT", ...jsonBody({ enabled, revision, confirm: true }) }));
    } catch (cause) {
      setError(errorMessage(cause, "修改交易黑名单开关失败"));
      await onReload();
      setBusy(false);
    }
  };
  return <Modal eyebrow="BLACKLIST MASTER SWITCH" title={enabled ? "启用交易黑名单" : "停用交易黑名单"} onClose={busy ? () => undefined : onClose}><form className="transaction-blacklist-modal" onSubmit={submitGuard(submit)}>
    <div className={`transaction-blacklist-switch-summary ${enabled ? "is-enabled" : ""}`}><span>{enabled ? "启" : "停"}</span><div><strong>{enabled ? `让 ${total} 名名单玩家受到限制` : `暂停全部 ${total} 名玩家的名单限制`}</strong><small>{enabled ? "名单玩家将不能赠送金币" : "名单内容仍会保留，可随时重新启用"}</small></div></div>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    <label className={`transaction-blacklist-confirm ${confirmed ? "is-checked" : ""}`}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>确认{enabled ? "启用" : "停用"}交易黑名单</strong><small>本操作只改变总开关，不增删名单中的玩家。</small></span></label>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant={enabled ? "primary" : "danger"} disabled={!confirmed || busy}>{busy ? "正在设置并校验…" : `确认${enabled ? "启用" : "停用"}`}</Button></div>
  </form></Modal>;
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiError ? cause.message : fallback;
}
