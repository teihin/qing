import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, formatDate, LoadingBlock, Modal, PageHeader } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import { formatBeijingDateTime } from "../time";
import type { ManageScopeName, ManageScopeOption, ManageScopeOptions, PlayerClubMembership, PlayerClubSubordinate, PlayerItem, PlayerManageScopeResult, PlayerPasswordResetResult, PlayerRoomHistoryItem, PlayerRoomHistoryResponse, PlayerSensitiveInfo, PlayerStoneGrantRecordsResponse, PlayerStoneGrantResult } from "../types";

interface PlayerResponse {
  items: PlayerItem[];
  total: number;
  page: number;
  pageSize: number;
  /** 后端按登录身份判定：管理员（super_admin 角色）为 true，此时 items 里才会带 loginPassword。 */
  canViewPassword?: boolean;
}

interface PlayerFilters {
  keyword: string;
  playerId: string;
  name: string;
  loginName: string;
  roomId: string;
  clientStatus: string;
  clientVersion: string;
  registeredFrom: string;
  registeredTo: string;
  loginFrom: string;
  loginTo: string;
  boss: string;
  ipCode: string;
}

const emptyFilters: PlayerFilters = {
  keyword: "",
  playerId: "",
  name: "",
  loginName: "",
  roomId: "",
  clientStatus: "",
  clientVersion: "",
  registeredFrom: "",
  registeredTo: "",
  loginFrom: "",
  loginTo: "",
  boss: "",
  ipCode: "",
};

function playerFiltersFromHash(): PlayerFilters {
  const query = window.location.hash.split("?")[1] || "";
  const playerId = (new URLSearchParams(query).get("playerId") || "").trim().slice(0, 64);
  return playerId ? { ...emptyFilters, playerId } : { ...emptyFilters };
}

function scopeDisplayNames(items: ManageScopeName[] | undefined, raw: string): string[] {
  if (items && items.length > 0) return items.map((item) => item.name || item.id);
  return parseScopeIDs(raw || "");
}

function scopeShortText(items: ManageScopeName[] | undefined, raw: string, limit = 3): string {
  const names = scopeDisplayNames(items, raw);
  if (names.length === 0) return "";
  const shown = names.slice(0, limit).join("、");
  return names.length > limit ? `${shown} 等${names.length}个` : shown;
}

function scopeRowSummary(player: PlayerItem): string {
  const unions = scopeShortText(player.unionManageNames, player.unionManage);
  const clubs = scopeShortText(player.clubManageNames, player.clubManage);
  return [unions ? `联盟 ${unions}` : "", clubs ? `俱乐部 ${clubs}` : ""].filter(Boolean).join(" · ");
}

function scopeFullText(player: PlayerItem): string {
  const unions = scopeDisplayNames(player.unionManageNames, player.unionManage);
  const clubs = scopeDisplayNames(player.clubManageNames, player.clubManage);
  return [
    unions.length ? `联盟 ${unions.join("、")}` : "",
    clubs.length ? `俱乐部 ${clubs.join("、")}` : "",
  ].filter(Boolean).join("；");
}

function scopeDetailText(items: ManageScopeName[] | undefined, raw: string): string {
  const names = scopeDisplayNames(items, raw);
  return names.length ? names.join("、") : "未配置";
}

const balanceFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clubModeLabels: Record<string, string> = { "1": "普通模式", "2": "茶楼模式", "3": "带分模式" };
const clubStatusLabels: Record<string, string> = { used: "正常", init: "未启用", del: "已解散" };

export default function PlayersPage({ can, canViewSensitive, notify }: { can: (permission: string) => boolean; canViewSensitive: boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<PlayerResponse | null>(null);
  const [draft, setDraft] = useState<PlayerFilters>(playerFiltersFromHash);
  const [applied, setApplied] = useState<PlayerFilters>(playerFiltersFromHash);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<PlayerItem | null>(null);
  const [resettingPassword, setResettingPassword] = useState<PlayerItem | null>(null);
  const [grantingStone, setGrantingStone] = useState<PlayerItem | null>(null);
  const [configuringScope, setConfiguringScope] = useState<PlayerItem | null>(null);
  const [showGrantRecords, setShowGrantRecords] = useState(false);
  const [queryRevision, refreshQuery] = useQueryRefresh();
  const canViewPassword = Boolean(data?.canViewPassword);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      setData(await api<PlayerResponse>(`/api/game/players?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "游戏玩家加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, queryRevision, notify]);
  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as unknown as PlayerFilters);
    setPage(1);
    refreshQuery();
  };
  const resetFilters = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
    refreshQuery();
  };
  const update = (key: keyof PlayerFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const activeFilterCount = Object.values(applied).filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GAME PLAYERS"
        title="玩家管理"
        description="查询玩家账号、钻石余额、所在俱乐部和客户端状态；按权限发放钻石、重置登录密码并追溯发放记录。"
        actions={<span className="readonly-badge"><i />敏感操作全程审计</span>}
      />

      <section className="panel player-filter-panel">
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <div className="player-filter-primary">
            <div className="search-box search-box--wide">
              <span>⌕</span>
              <input value={draft.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="输入玩家ID、登录账号或昵称" />
            </div>
            <Button type="submit">查询玩家</Button>
            <Button type="button" variant="secondary" onClick={() => setAdvanced((value) => !value)}>
              {advanced ? "收起条件" : "更多条件"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </Button>
            {activeFilterCount > 0 && <button className="filter-reset" type="button" onClick={resetFilters}>清空筛选</button>}
          </div>

          {advanced && (
            <div className="player-filter-advanced">
              <Field label="玩家ID"><input value={draft.playerId} onChange={(event) => update("playerId", event.target.value)} placeholder="精确匹配游戏ID" /></Field>
              <Field label="玩家昵称"><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="支持部分匹配" /></Field>
              <Field label="登录账号"><input value={draft.loginName} onChange={(event) => update("loginName", event.target.value)} placeholder="登录名或KBE账号" /></Field>
              <Field label="IP短码" hint="6 位字母数字，区分大小写；按数据库最近上报 IP 精确匹配"><input value={draft.ipCode} onChange={(event) => update("ipCode", event.target.value)} placeholder="如 43Ypq1" maxLength={6} /></Field>
              <Field label="大小BOSS" hint="筛选已配置可管理联盟或俱乐部（union_manage / club_manage）的账号"><select value={draft.boss} onChange={(event) => update("boss", event.target.value)}><option value="">全部玩家</option><option value="1">只看大小BOSS</option></select></Field>
              <Field label="当前房间ID"><input type="number" min="0" value={draft.roomId} onChange={(event) => update("roomId", event.target.value)} placeholder="0 表示未在房间" /></Field>
              <Field label="客户端状态"><input value={draft.clientStatus} onChange={(event) => update("clientStatus", event.target.value)} placeholder="精确匹配状态值" /></Field>
              <Field label="客户端版本"><input value={draft.clientVersion} onChange={(event) => update("clientVersion", event.target.value)} placeholder="精确匹配版本号" /></Field>
              <Field label="注册开始日期"><input type="date" value={draft.registeredFrom} onChange={(event) => update("registeredFrom", event.target.value)} /></Field>
              <Field label="注册结束日期"><input type="date" value={draft.registeredTo} onChange={(event) => update("registeredTo", event.target.value)} /></Field>
              <Field label="登录开始日期" hint="按北京时间当天 00:00 起算，从未登录过的玩家不会被筛选出来"><input type="date" value={draft.loginFrom} onChange={(event) => update("loginFrom", event.target.value)} /></Field>
              <Field label="登录结束日期" hint="含当天 23:59"><input type="date" value={draft.loginTo} onChange={(event) => update("loginTo", event.target.value)} /></Field>
              <div className="filter-actions"><Button type="submit">应用组合条件</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置</Button></div>
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div><strong>游戏玩家列表</strong><span>数据来自服务器本机 kbedm.tbl_Account</span></div>
          <div className="player-toolbar__actions">
            <span className="toolbar__count">共 {data?.total ?? 0} 名玩家</span>
            {can("game.player.grant_stone") && <Button type="button" variant="secondary" onClick={() => setShowGrantRecords(true)}>发放记录</Button>}
          </div>
        </div>
        {loading && !data ? <LoadingBlock label="正在读取游戏玩家" /> : !data || data.items.length === 0 ? (
          <EmptyState title="没有找到玩家" description="可以清空部分查询条件后重新搜索。" />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="player-table">
                <thead><tr><th>玩家</th><th>登录账号</th>{canViewPassword && <th title="玩家登录密码明文；只有管理员可见。历史账号游戏端只存 MD5 无法还原，未收录时显示「未收录」">用户密码</th>}<th>钻石余额</th><th>所在俱乐部</th><th>房间 / 客户端</th><th title="最近上报 IP 的 6 位短码，与游戏内 BOSS 玩家信息弹窗同一规则">IP短码</th><th>注册时间（北京时间）</th><th>最近登录（北京时间）</th><th className="align-right">操作</th></tr></thead>
                <tbody>{data.items.map((player) => (
                  <tr key={player.id} className={player.isBoss ? "player-row--boss" : undefined} title={player.isBoss ? `大小BOSS${scopeFullText(player) ? ` · ${scopeFullText(player)}` : ""}` : undefined}>
                    <td><div className="user-cell"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><small>ID：{player.playerId}</small>{player.isBoss && <small className="cell-subtitle scope-summary">大小BOSS · {scopeRowSummary(player)}</small>}</div></div></td>
                    <td><code>{player.loginName || "—"}</code>{player.accountName && player.accountName !== player.loginName && <small className="cell-subtitle">KBE：{player.accountName}</small>}</td>
                    {canViewPassword && <td><PlayerPasswordCell player={player} /></td>}
                    <td><strong className="stone-value">{player.stone.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">钻石</small></td>
                    <td>{player.clubs.length > 0 ? <div className="club-chip-list">{player.clubs.map((club) => <span className="club-chip" key={club.clubId} title={`俱乐部ID：${club.clubId}`}>{club.name || club.clubId}</span>)}</div> : <span className="muted">未加入俱乐部</span>}</td>
                    <td><strong>{player.roomId > 0 ? `房间 ${player.roomId}` : "未在房间"}</strong><small className="cell-subtitle">{player.clientStatus || "状态未上报"}{player.clientVersion ? ` · ${player.clientVersion}` : ""}</small></td>
                    <td><code>{player.ipCode || "—"}</code></td>
                    <td>{formatDate(player.registrationTime)}</td>
                    <td>{formatDate(player.lastLoginAt)}</td>
                    <td><div className="row-actions">{can("game.player.grant_stone") && <button className="success-link" onClick={() => setGrantingStone(player)}>发放钻石</button>}{can("game.player.manage_scope") && <button onClick={() => setConfiguringScope(player)}>设置管理员</button>}{can("game.player.reset_password") && <button onClick={() => setResettingPassword(player)}>重置密码</button>}<button onClick={() => setSelected(player)}>查看详情</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <footer className="table-pagination">
              <span>显示 {firstRow}–{lastRow}，共 {data.total} 条</span>
              <div>
                <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
                <strong>{page} / {totalPages}</strong>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
              </div>
            </footer>
          </>
        )}
      </section>

      {selected && <PlayerDetail player={selected} can={can} canViewSensitive={canViewSensitive} notify={notify} onClose={() => setSelected(null)} />}
      {resettingPassword && <ResetPlayerPasswordModal player={resettingPassword} onClose={() => setResettingPassword(null)} onDone={(result) => { setResettingPassword(null); notify(result.message); }} />}
      {grantingStone && <GrantPlayerStoneModal player={grantingStone} onClose={() => setGrantingStone(null)} onDone={async (message) => { setGrantingStone(null); notify(message); await load(); }} />}
      {configuringScope && <ManageScopeModal player={configuringScope} onClose={() => setConfiguringScope(null)} onDone={async (message) => { setConfiguringScope(null); notify(message); await load(); }} />}
      {showGrantRecords && <PlayerStoneGrantRecordsModal onClose={() => setShowGrantRecords(false)} notify={notify} />}
    </div>
  );
}

function PlayerPasswordCell({ player }: { player: PlayerItem }) {
  if (!player.passwordRecorded || !player.loginPassword) {
    return <span className="player-password is-missing" title="游戏端只保存 MD5 摘要，无法还原；本后台只收录过它亲历的注册/重置/自助改密，历史密码需要玩家重置一次后才有">未收录</span>;
  }
  return <code className="player-password" title="玩家登录密码明文">{player.loginPassword}</code>;
}

function ResetPlayerPasswordModal({ player, onClose, onDone }: { player: PlayerItem; onClose: () => void; onDone: (result: PlayerPasswordResetResult) => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordLength = Array.from(password).length;
  const invalid = passwordLength < 6 || passwordLength > 32 || password !== password.trim() || password !== confirmPassword || !confirmed;
  const submit = async () => {
    if (password !== confirmPassword) { setError("两次输入的新密码不一致"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<PlayerPasswordResetResult>(`/api/game/players/${encodeURIComponent(player.playerId)}/password`, {
        method: "POST", ...jsonBody({ password, reason, confirm: confirmed }),
      });
      onDone(result);
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiError ? reasonValue.message : "玩家密码重置失败");
    } finally { setBusy(false); }
  };
  return <Modal title={`重置玩家密码 · ${player.name || player.playerId}`} eyebrow="PLAYER LOGIN SECURITY" onClose={onClose}>
    <div className="password-reset-player"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID {player.playerId} · 登录账号 {player.loginName || "—"}</p></div></div>
    <div className="sensitive-operation-notice"><strong>这是游戏玩家的登录密码</strong><p>不会显示或读取原密码。重置后，玩家下次登录必须使用新密码；防盗号设备绑定不会自动解除。</p></div>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    <div className="form-grid form-grid--single">
      <Field label="新登录密码" hint="6～32个字符，不限制字符组合，首尾不能有空格"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入玩家的新密码" /></Field>
      <Field label="确认新密码"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" /></Field>
      <Field label="操作备注（选填）" hint="最多120个字符，只进入操作审计，不会发送给玩家"><input value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} placeholder="例如：玩家完成身份核验后申请重置" /></Field>
    </div>
    <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家ID和登录账号，并确认重置该玩家的登录密码</span></label>
    <div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={invalid || busy} onClick={() => void submit()}>{busy ? "正在重置并校验…" : "确认重置密码"}</Button></div>
  </Modal>;
}

function GrantPlayerStoneModal({ player, onClose, onDone }: { player: PlayerItem; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountValue = Number(amount);
  const amountValid = Number.isInteger(amountValue) && amountValue >= 1 && amountValue <= 1000000;
  const reasonLength = Array.from(reason.trim()).length;
  const reasonValid = reasonLength >= 2 && reasonLength <= 120;
  const invalid = !amountValid || !reasonValid || !confirmed;
  const submit = async () => {
    if (!amountValid) { setError("发放数量必须是 1 到 1,000,000 的整数"); return; }
    if (!reasonValid) { setError("发放原因必须填写 2 到 120 个字符"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<PlayerStoneGrantResult>(`/api/game/players/${encodeURIComponent(player.playerId)}/stone-grants`, {
        method: "POST", ...jsonBody({ amount: amountValue, reason, expectedStone: player.stone, confirm: confirmed }),
      });
      await onDone(result.verified ? result.message : `${result.message}（操作号 ${result.context}）`);
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiError ? reasonValue.message : "钻石发放失败");
    } finally { setBusy(false); }
  };
  return <Modal title={`发放钻石 · ${player.name || player.playerId}`} eyebrow="GRANT PLAYER DIAMONDS" onClose={onClose}>
    <div className="password-reset-player"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID {player.playerId} · 当前钻石 {player.stone.toLocaleString("zh-CN")}</p></div></div>
    <div className="sensitive-operation-notice"><strong>直接增加玩家钻石</strong><p>操作会调用游戏服立即写入玩家钻石余额并回读校验；发放记录会保存操作账号、数量、时间和原因。</p></div>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    <div className="form-grid form-grid--single">
      <Field label="发放数量" hint="整数钻石，单次 1 到 1,000,000"><input type="number" min="1" max="1000000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如：100" /></Field>
      <Field label="发放原因" hint="2～120个字符，只进入后台发放记录，不会发送给玩家"><input value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} placeholder="例如：活动奖励 / 客诉补偿 / 误扣纠正" /></Field>
    </div>
    <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家ID和发放数量，并确认给该玩家增加 {amountValid ? `${amountValue.toLocaleString("zh-CN")} 钻` : "钻石"}</span></label>
    <div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={invalid || busy} onClick={() => void submit()}>{busy ? "正在发放并校验…" : "确认发放钻石"}</Button></div>
  </Modal>;
}

function parseScopeIDs(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean)));
}

function ManageScopePicker({ title, hint, options, selected, onChange, emptyText }: {
  title: string;
  hint: string;
  options: ManageScopeOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  const [keyword, setKeyword] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const keywordText = keyword.trim().toLowerCase();
  const visible = useMemo(() => options.filter((option) => {
    if (!keywordText) return true;
    return option.id.includes(keywordText) || option.name.toLowerCase().includes(keywordText);
  }), [keywordText, options]);
  const unknown = selected.filter((id) => !options.some((option) => option.id === id));
  const toggle = (id: string) => onChange(selectedSet.has(id)
    ? selected.filter((value) => value !== id)
    : [...selected, id]);
  return <section className="scope-picker">
    <header><div><strong>{title}</strong><small>{hint}</small></div><span>已选 {selected.length}</span></header>
    <div className="scope-picker__search"><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称或编号" /></div>
    <div className="scope-picker__list">
      {unknown.map((id) => <label key={`unknown-${id}`} className="scope-picker__row is-unknown">
        <input type="checkbox" checked onChange={() => onChange(selected.filter((value) => value !== id))} />
        <span><strong>{id}</strong><small>当前已配置，但不在可选列表中（可能已入盟或已解散）</small></span>
      </label>)}
      {visible.map((option) => <label key={option.id} className="scope-picker__row">
        <input type="checkbox" checked={selectedSet.has(option.id)} onChange={() => toggle(option.id)} />
        <span>
          <strong>{option.name || option.id}</strong>
          <small>ID {option.id}{option.ownerName ? ` · 总群主 ${option.ownerName}` : ""}{option.clubCount !== undefined ? ` · ${option.clubCount} 家俱乐部` : ""}{option.memberCount !== undefined ? ` · ${option.memberCount} 人` : ""}</small>
        </span>
      </label>)}
      {visible.length === 0 && unknown.length === 0 && <p className="scope-picker__empty">{emptyText}</p>}
    </div>
  </section>;
}

function ManageScopeModal({ player, onClose, onDone }: { player: PlayerItem; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [options, setOptions] = useState<ManageScopeOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [unionIDs, setUnionIDs] = useState<string[]>(() => parseScopeIDs(player.unionManage || ""));
  const [clubIDs, setClubIDs] = useState<string[]>(() => parseScopeIDs(player.clubManage || ""));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError("");
    api<ManageScopeOptions>("/api/game/players/manage-scope/options")
      .then((data) => { if (!cancelled) setOptions(data); })
      .catch((reasonValue) => {
        if (!cancelled) setOptionsError(reasonValue instanceof ApiError ? reasonValue.message : "可选项加载失败");
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
    return () => { cancelled = true; };
  }, [optionsRevision]);

  const invalidID = [...unionIDs, ...clubIDs].find((id) => !/^\d{6}$/.test(id));
  const invalid = Boolean(invalidID) || !confirmed || optionsLoading;
  const submit = async () => {
    if (invalidID) { setError(`编号 ${invalidID} 不是 6 位数字`); return; }
    setBusy(true); setError("");
    try {
      const result = await api<PlayerManageScopeResult>(`/api/game/players/${encodeURIComponent(player.playerId)}/manage-scope`, {
        method: "POST",
        ...jsonBody({
          unionIds: unionIDs,
          clubIds: clubIDs,
          expectedUnionManage: player.unionManage || "",
          expectedClubManage: player.clubManage || "",
          confirm: confirmed,
        }),
      });
      await onDone(result.verified ? result.message : `${result.message}（操作号 ${result.context}）`);
    } catch (reasonValue) {
      setError(reasonValue instanceof ApiError ? reasonValue.message : "管理范围设置失败");
    } finally { setBusy(false); }
  };
  return <Modal wide title={`设置管理员 · ${player.name || player.playerId}`} eyebrow="PLAYER MANAGE SCOPE" onClose={onClose}>
    <div className="password-reset-player"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID {player.playerId} · {player.isBoss ? "当前是大小BOSS" : "当前未配置管理范围"}</p></div></div>
    <div className="sensitive-operation-notice"><strong>这两个属性决定游戏内的 BOSS 入口</strong><p>配置后，玩家登录游戏会看到「数据统计」和点击头像的 BOSS 面板；全部取消勾选表示清空。只覆盖可管理联盟/独立俱乐部，不影响玩家的俱乐部成员关系。</p></div>
    {error && <div className="form-error"><span>!</span>{error}</div>}
    {optionsError && <div className="form-error"><span>!</span>{optionsError}<button type="button" className="link-button" onClick={() => setOptionsRevision((value) => value + 1)}>重新加载</button></div>}
    {optionsLoading ? <LoadingBlock label="正在读取可管理的联盟和俱乐部" /> : <div className="scope-picker-grid">
      <ManageScopePicker
        title="可管理联盟"
        hint="选中后该联盟下全部俱乐部都可管理"
        options={options?.unions || []}
        selected={unionIDs}
        onChange={setUnionIDs}
        emptyText="暂无联盟"
      />
      <ManageScopePicker
        title="可管理独立俱乐部"
        hint="只列未加入联盟的俱乐部"
        options={options?.clubs || []}
        selected={clubIDs}
        onChange={setClubIDs}
        emptyText="暂未入盟的俱乐部为空"
      />
    </div>}
    <p className="field__hint">保存后覆盖为：联盟 {unionIDs.length} 个、独立俱乐部 {clubIDs.length} 个。已入盟的俱乐部请通过它所属的联盟授权。</p>
    <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家ID，并确认覆盖该玩家的可管理联盟和俱乐部</span></label>
    <div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={invalid || busy} onClick={() => void submit()}>{busy ? "正在写入并校验…" : "保存管理范围"}</Button></div>
  </Modal>;
}

function PlayerStoneGrantRecordsModal({ onClose, notify }: { onClose: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<PlayerStoneGrantRecordsResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ keyword: "", from: "", to: "" });
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
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      const response = await api<PlayerStoneGrantRecordsResponse>(`/api/game/players/stone-grants?${params.toString()}`);
      setData(response);
      const pages = Math.max(1, Math.ceil(response.total / pageSize));
      if (page > pages) setPage(pages);
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.message : "钻石发放记录加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [applied, notify, page, pageSize, queryRevision]);
  useEffect(() => { void load(); }, [load]);

  const search = () => {
    setApplied({ keyword: keyword.trim(), from, to });
    setPage(1);
    refreshQuery();
  };
  const reset = () => {
    setKeyword(""); setFrom(""); setTo("");
    setApplied({ keyword: "", from: "", to: "" });
    setPage(1);
    refreshQuery();
  };
  const filtersActive = Boolean(applied.keyword || applied.from || applied.to);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  return <Modal wide title="钻石发放记录" eyebrow="PLAYER DIAMOND GRANTS" onClose={onClose}>
    <header className="ban-history-header">
      <div><span>DIAMOND GRANT RECORDS</span><h2>钻石发放记录</h2><p>记录后台账号给哪个玩家发了多少钻石、发放时间和原因；只展示发放成功的记录。</p></div>
      <strong>{data?.total ?? "—"}<small>条记录</small></strong>
    </header>
    <form className="ban-history-filters" onSubmit={(event) => { event.preventDefault(); search(); }}>
      <label className="ban-history-search"><span>⌕</span><input value={keyword} maxLength={100} onChange={(event) => setKeyword(event.target.value)} placeholder="玩家ID、昵称、账号、操作人或原因" /></label>
      <label><span>开始日期</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>结束日期</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button type="submit">查询记录</Button>
      {filtersActive && <Button type="button" variant="secondary" onClick={reset}>重置</Button>}
    </form>
    {loading && !data ? <LoadingBlock label="正在读取钻石发放记录" /> : !data || data.items.length === 0 ? <EmptyState title={filtersActive ? "没有匹配的发放记录" : "暂无钻石发放记录"} description={filtersActive ? "可以修改或重置查询条件。" : "通过玩家管理发放钻石后，记录会显示在这里。"} /> : <>
      <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
        <table className="ban-history-table"><thead><tr><th>发放时间（北京时间）</th><th>操作账号</th><th>玩家</th><th>发放数量</th><th>钻石余额</th><th>发放原因</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
          <td><strong>{formatBeijingDateTime(item.createdAt)}</strong><small className="cell-subtitle">记录 #{item.id}</small></td>
          <td><strong>{item.operatorName || "未知账号"}</strong><small className="cell-subtitle">后台管理账号</small></td>
          <td><div className="ban-history-player"><span>{item.name.slice(0, 1) || "玩"}</span><div><strong>{item.name || "未设置昵称"}</strong><small>ID：{item.playerId}</small><small>账号：{item.loginName || item.accountName || "—"}</small></div></div></td>
          <td><strong className="stone-value">+{item.amount.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">钻石</small></td>
          <td><strong>{item.stoneAfter.toLocaleString("zh-CN")}</strong><small className="cell-subtitle">{item.stoneBefore.toLocaleString("zh-CN")} → {item.stoneAfter.toLocaleString("zh-CN")}</small></td>
          <td><strong className="ban-history-reason">{item.reason || "未记录原因"}</strong>{item.context && <small className="cell-subtitle">操作号 {item.context}</small>}</td>
        </tr>)}</tbody></table>
      </div>
      <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条发放记录</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </>}
  </Modal>;
}

type PlayerDetailTab = "profile" | "clubs" | "rooms";

function PlayerDetail({ player, can, canViewSensitive, notify, onClose }: { player: PlayerItem; can: (permission: string) => boolean; canViewSensitive: boolean; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void }) {
  const [tab, setTab] = useState<PlayerDetailTab>("profile");
  const [clubs, setClubs] = useState<PlayerClubMembership[] | null>(null);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [rooms, setRooms] = useState<PlayerRoomHistoryResponse | null>(null);
  const [roomPage, setRoomPage] = useState(1);
  const [roomLoading, setRoomLoading] = useState(false);
  const [sensitive, setSensitive] = useState<PlayerSensitiveInfo | null>(null);
  const [sensitiveLoading, setSensitiveLoading] = useState(canViewSensitive);
  const [sensitiveError, setSensitiveError] = useState("");
  const canViewRooms = can("game.room_record.view");

  const loadSensitive = useCallback(async () => {
    if (!canViewSensitive) return;
    setSensitiveLoading(true); setSensitiveError("");
    try {
      setSensitive(await api<PlayerSensitiveInfo>(`/api/game/players/${encodeURIComponent(player.playerId)}/sensitive`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "玩家IP和GPS加载失败";
      setSensitiveError(message);
      notify(message, "error");
    } finally { setSensitiveLoading(false); }
  }, [canViewSensitive, notify, player.playerId]);

  const loadClubs = useCallback(async () => {
    setClubsLoading(true);
    try {
      const result = await api<{ items: PlayerClubMembership[] }>(`/api/game/players/${encodeURIComponent(player.playerId)}/clubs`);
      setClubs(result.items);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家所在俱乐部加载失败", "error");
    } finally { setClubsLoading(false); }
  }, [notify, player.playerId]);

  const loadRooms = useCallback(async () => {
    if (!canViewRooms) return;
    setRoomLoading(true);
    try {
      setRooms(await api<PlayerRoomHistoryResponse>(`/api/game/players/${encodeURIComponent(player.playerId)}/rooms?page=${roomPage}&pageSize=10`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家房间战绩加载失败", "error");
    } finally { setRoomLoading(false); }
  }, [canViewRooms, notify, player.playerId, roomPage]);

  useEffect(() => { if (tab === "clubs") void loadClubs(); }, [loadClubs, tab]);
  useEffect(() => { if (tab === "rooms") void loadRooms(); }, [loadRooms, tab]);
  useEffect(() => { if (tab === "profile" && canViewSensitive && !sensitive && !sensitiveError) void loadSensitive(); }, [canViewSensitive, loadSensitive, sensitive, sensitiveError, tab]);

  return (
    <Modal wide title={player.name || `玩家 ${player.playerId}`} eyebrow="PLAYER PROFILE" onClose={onClose}>
      <div className="player-detail-heading">
        <span>{player.name.slice(0, 1) || "玩"}</span>
        <div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID：{player.playerId} · 登录账号：{player.loginName || "—"}</p></div>
        <em>只读</em>
      </div>
      <nav className="player-profile-tabs" aria-label="玩家详情分类">
        <button type="button" className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}><span>基本资料</span><small>账号、钻石与游戏状态</small></button>
        <button type="button" className={tab === "clubs" ? "is-active" : ""} onClick={() => setTab("clubs")}><span>所在俱乐部</span><small>角色、俱乐部金币与下级</small></button>
        <button type="button" className={tab === "rooms" ? "is-active" : ""} disabled={!canViewRooms} onClick={() => setTab("rooms")}><span>房间战绩</span><small>{canViewRooms ? "参战房间与输赢" : "当前角色无权限"}</small></button>
      </nav>
      {tab === "profile" && <PlayerProfileTab player={player} canViewSensitive={canViewSensitive} sensitive={sensitive} sensitiveLoading={sensitiveLoading} sensitiveError={sensitiveError} onRetrySensitive={() => void loadSensitive()} />}
      {tab === "clubs" && <PlayerClubsTab player={player} data={clubs} loading={clubsLoading} />}
      {tab === "rooms" && canViewRooms && <PlayerRoomsTab player={player} data={rooms} page={roomPage} loading={roomLoading} onPage={setRoomPage} />}
    </Modal>
  );
}

function PlayerProfileTab({ player, canViewSensitive, sensitive, sensitiveLoading, sensitiveError, onRetrySensitive }: { player: PlayerItem; canViewSensitive: boolean; sensitive: PlayerSensitiveInfo | null; sensitiveLoading: boolean; sensitiveError: string; onRetrySensitive: () => void }) {
  return <div className="player-profile-tab-content">
      <section className="player-detail-section">
        <h3>账号与游戏状态</h3>
        <div className="player-detail-grid">
          <Detail label="KBE账号" value={player.accountName} mono />
          <Detail label="性别" value={player.sex} />
          <Detail label="VIP / VIP等级" value={`${player.vip} / ${player.vipLevel}`} />
          <Detail label="客户端状态" value={player.clientStatus || "未上报"} />
          <Detail label="客户端版本" value={player.clientVersion} />
          <Detail label="当前房间" value={player.roomId > 0 ? `${player.roomId}（${player.roomType || "类型未记录"}）` : "未在房间"} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>管理范围（大小BOSS）</h3>
        <div className="player-detail-grid">
          <Detail label="可管理联盟" value={scopeDetailText(player.unionManageNames, player.unionManage)} mono />
          <Detail label="可管理俱乐部" value={scopeDetailText(player.clubManageNames, player.clubManage)} mono />
        </div>
        <p className="field__hint">由玩家列表的「设置管理员」配置；两个属性都为空时，游戏内不显示数据统计和 BOSS 头像面板。</p>
      </section>
      <section className="player-detail-section">
        <h3>钻石与战绩</h3>
        <div className="player-detail-grid">
          <Detail label="钻石余额" value={player.stone.toLocaleString("zh-CN")} highlight />
          <Detail label="累计局数" value={player.totalRounds} />
          <Detail label="累计总分" value={player.totalScore} />
          <Detail label="登录次数" value={player.loginCount} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>所在俱乐部</h3>
        {player.clubs.length > 0 ? <div className="club-chip-list">{player.clubs.map((club) => <span className="club-chip" key={club.clubId} title={`俱乐部ID：${club.clubId}`}>{club.name || club.clubId}</span>)}</div> : <p className="muted">该玩家还没有加入俱乐部</p>}
        <p className="field__hint">角色、俱乐部金币和下级玩家请在「所在俱乐部」页签查看。</p>
      </section>
      <section className="player-detail-section">
        <h3>注册与其他参数</h3>
        <div className="player-detail-grid">
          <Detail label="注册时间（北京时间）" value={formatDate(player.registrationTime)} />
          <Detail label="最近登录（北京时间）" value={formatDate(player.lastLoginAt)} />
          <Detail label="备注" value={player.remark} wide />
        </div>
      </section>
      {canViewSensitive && <PlayerSensitiveSection player={player} data={sensitive} loading={sensitiveLoading} error={sensitiveError} onRetry={onRetrySensitive} />}
    </div>;
}

function PlayerSensitiveSection({ player, data, loading, error, onRetry }: { player: PlayerItem; data: PlayerSensitiveInfo | null; loading: boolean; error: string; onRetry: () => void }) {
  const openMap = () => {
    if (!data?.locationAvailable || data.latitude === null || data.longitude === null) return;
    const url = new URL("https://uri.amap.com/marker");
    url.searchParams.set("position", `${data.longitude},${data.latitude}`);
    url.searchParams.set("name", `${player.name || "玩家"}（${player.playerId}）`);
    url.searchParams.set("src", "XuanManager");
    url.searchParams.set("coordinate", "wgs84");
    url.searchParams.set("callnative", "0");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };
  return <section className="player-detail-section player-sensitive-section">
    <div className="player-sensitive-heading"><div><span>SUPER ADMIN ONLY</span><h3>网络与GPS定位</h3><p>仅超级管理员可见；每次读取都会写入操作审计。</p></div>{data?.locationAvailable && <Button type="button" onClick={openMap}>在高德地图中定位</Button>}</div>
    {loading ? <LoadingBlock label="正在读取玩家IP和GPS" /> : error ? <div className="sensitive-load-error"><span>{error}</span><button type="button" onClick={onRetry}>重新读取</button></div> : <div className="player-detail-grid">
      <Detail label="最近上报 IP" value={data?.ip || "未上报"} mono />
      <Detail label="GPS 原始值（纬度,经度）" value={data?.gps || "未上报"} mono />
      <Detail label="纬度" value={data?.latitude === null || data?.latitude === undefined ? "—" : data.latitude.toFixed(6)} mono />
      <Detail label="经度" value={data?.longitude === null || data?.longitude === undefined ? "—" : data.longitude.toFixed(6)} mono />
      <Detail label="定位状态" value={data?.locationMessage || "玩家尚未上报有效坐标"} wide />
    </div>}
  </section>;
}

function PlayerClubsTab({ player, data, loading }: { player: PlayerItem; data: PlayerClubMembership[] | null; loading: boolean }) {
  if (loading && !data) return <LoadingBlock label="正在读取玩家所在俱乐部" />;
  if (!data) return <EmptyState title="俱乐部信息暂时无法显示" description="请稍后重新打开所在俱乐部页签。" />;
  if (data.length === 0) return <EmptyState title="该玩家还没有加入俱乐部" description="tbl_Account 中没有这个玩家的有效俱乐部关系。" />;
  return <div className="player-profile-tab-content">
    <section className="player-club-overview">
      <ProfileMetric label="所在俱乐部" value={`${data.length} 个`} note="仅显示未删除的俱乐部" />
      {data.slice(0, 3).map((membership) => <ProfileMetric key={membership.clubId} label={membership.clubName || membership.clubId} value={membership.roleLabel} note={`俱乐部ID ${membership.clubId}`} />)}
    </section>
    <div className="player-club-grid">
      {data.map((membership) => <PlayerClubCard key={membership.clubId} player={player} membership={membership} />)}
    </div>
  </div>;
}

function PlayerClubCard({ player, membership }: { player: PlayerItem; membership: PlayerClubMembership }) {
  const [subordinates, setSubordinates] = useState<PlayerClubSubordinate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadSubordinates = async () => {
    setLoading(true); setError("");
    try {
      const result = await api<{ items: PlayerClubSubordinate[]; total: number }>(`/api/game/players/${encodeURIComponent(player.playerId)}/clubs/${encodeURIComponent(membership.clubId)}/subordinates`);
      setSubordinates(result.items);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "读取俱乐部下级玩家失败");
    } finally { setLoading(false); }
  };
  return <section className="player-club-card">
    <header>
      <div>
        <span className="eyebrow">CLUB MEMBERSHIP</span>
        <h3>{membership.clubName || membership.clubId}</h3>
        <p>俱乐部ID {membership.clubId}{membership.clubStatus ? ` · 状态 ${clubStatusLabels[membership.clubStatus] || membership.clubStatus}` : ""}</p>
      </div>
      <span className="club-role-badge">{membership.roleLabel}</span>
    </header>
    <div className="player-club-meta">
      <div><span>俱乐部金币</span><strong>{membership.clubGold === null ? "未记录" : membership.clubGold.toLocaleString("zh-CN")}</strong></div>
      <div><span>上级</span><strong>{membership.upperName || membership.upperId || "无"}</strong></div>
      <div><span>上级ID</span><strong>{membership.upperId || "—"}</strong></div>
      <div><span>模式</span><strong>{clubModeLabels[membership.clubMode] || membership.clubMode || "—"}</strong></div>
    </div>
    <div className="player-club-subordinates">
      <div className="player-profile-section-title">
        <div><h3>俱乐部下级玩家</h3><p>按当前俱乐部的上下级关系列出该玩家的全部下级</p></div>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadSubordinates()}>{loading ? "正在读取…" : subordinates ? "刷新下级" : "查看下级玩家"}</Button>
      </div>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      {subordinates && (subordinates.length === 0 ? <EmptyState title="该玩家在这个俱乐部没有下级" description="当前俱乐部关系树中，这个玩家下面没有其他玩家。" /> : <>
        <div className="table-wrap"><table className="player-club-subordinate-table"><thead><tr><th>玩家</th><th>层级</th><th>角色</th><th>俱乐部金币</th><th>上级</th></tr></thead><tbody>{subordinates.map((item) => <tr key={`${item.playerId}-${item.depth}`}><td><strong>{item.name || "未设置昵称"}</strong><small className="cell-subtitle">ID：{item.playerId}</small></td><td><strong>第 {item.depth} 层</strong></td><td><span className="club-role-badge">{item.roleLabel}</span></td><td><strong>{item.clubGold === null ? "未记录" : item.clubGold.toLocaleString("zh-CN")}</strong></td><td>{item.upperName || item.upperId || "—"}{item.upperName && item.upperId && <small className="cell-subtitle">ID：{item.upperId}</small>}</td></tr>)}</tbody></table></div>
        <p className="field__hint">共 {total} 名下级玩家。</p>
      </>)}
    </div>
  </section>;
}

function PlayerRoomsTab({ player, data, page, loading, onPage }: { player: PlayerItem; data: PlayerRoomHistoryResponse | null; page: number; loading: boolean; onPage: (page: number) => void }) {
  if (loading && !data) return <LoadingBlock label="正在读取玩家参与过的房间" />;
  if (!data) return <EmptyState title="房间战绩暂时无法显示" description="请稍后重新打开房间战绩页签。" />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="player-profile-tab-content">
    <section className="player-fund-overview player-room-overview">
      <ProfileMetric label="参与房间" value={`${data.summary.roomCount} 个`} note={`共参与 ${data.summary.roundsPlayed} 局`} />
      <ProfileMetric label="房间胜负" value={`${data.summary.winRooms} 胜 / ${data.summary.lossRooms} 负`} note={`${data.summary.drawRooms} 个房间持平`} />
      <ProfileMetric label="累计带入 / 返还" value={`${balanceFormatter.format(data.summary.totalBuyIn)} / ${balanceFormatter.format(data.summary.totalSettlementReturn)}`} note="按房间结算流水统计" />
      <ProfileMetric label="房间总输赢" value={formatPlayerScore(data.summary.netScore)} note="结算返还减累计带入" tone={data.summary.netScore >= 0 ? "win" : "loss"} />
    </section>
    <section className="player-profile-data-section">
      <div className="player-profile-section-title"><div><h3>{player.name || player.playerId} 的房间对战</h3><p>点击房间可继续查看本房间全部玩家和逐局牌面</p></div><span>{data.total} 个房间</span></div>
      {data.items.length === 0 ? <EmptyState title="该玩家没有房间战绩" description="总战绩表中暂时没有这个玩家形成的房间记录。" /> : <div className="table-wrap"><table className="player-room-history-table"><thead><tr><th>房间</th><th>房间时间（北京时间）</th><th>座位 / 局数</th><th>累计带入 / 返还</th><th>最终输赢</th><th>操作</th></tr></thead><tbody>{data.items.map((item) => <PlayerRoomRow key={item.id} item={item} />)}</tbody></table></div>}
      <ProfilePagination page={page} totalPages={totalPages} total={data.total} loading={loading} onPage={onPage} unit="个房间" />
    </section>
  </div>;
}

function PlayerRoomRow({ item }: { item: PlayerRoomHistoryItem }) {
  return <tr><td><strong className="room-list-id">{item.roomId}</strong><small className="cell-subtitle">{item.roomName || item.playMode || "未记录房间名"}</small></td><td><span>{formatBeijingDateTime(item.startedAt || item.recordedAt)}</span><small className="cell-subtitle">至 {formatBeijingDateTime(item.endedAt || item.recordedAt)}</small></td><td><strong>{item.seat + 1} 号位 · {item.roundsPlayed} 局</strong><small className="cell-subtitle">房间共 {item.roomRoundCount} 局</small></td><td><strong>{balanceFormatter.format(item.totalBuyIn)} / {item.scoreSource === "settlement" ? balanceFormatter.format(item.settlementReturn) : "未记录"}</strong></td><td><strong className={`room-score room-score--${item.result}`}>{formatPlayerScore(item.score)}</strong>{item.scoreMismatch && <small className="room-score-warning">原战绩 {formatPlayerScore(item.recordedScore)}</small>}</td><td><button className="player-profile-link" type="button" onClick={() => { window.location.hash = `/game/room-records?roomId=${encodeURIComponent(item.roomId)}`; }}>查看房间战绩</button></td></tr>;
}

function ProfileMetric({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`player-profile-metric player-profile-metric--${tone}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function ProfilePagination({ page, totalPages, total, loading, onPage, unit }: { page: number; totalPages: number; total: number; loading: boolean; onPage: (page: number) => void; unit: string }) {
  return <footer className="table-pagination"><span>共 {total} {unit}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button></div></footer>;
}

function formatPlayerScore(value: number) {
  if (value > 0) return `+${balanceFormatter.format(value)}`;
  if (value < 0) return `−${balanceFormatter.format(Math.abs(value))}`;
  return balanceFormatter.format(0);
}

function Detail({ label, value, mono = false, highlight = false, wide = false }: { label: string; value: string | number; mono?: boolean; highlight?: boolean; wide?: boolean }) {
  const text = value === "" || value === null || value === undefined ? "—" : String(value);
  return <div className={`detail-item ${wide ? "detail-item--wide" : ""}`}><span>{label}</span><strong className={`${mono ? "is-mono" : ""} ${highlight ? "is-highlight" : ""}`}>{text}</strong></div>;
}
