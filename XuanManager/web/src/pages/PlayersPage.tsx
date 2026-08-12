import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, formatDate, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type { PlayerBalanceAdjustmentResult, PlayerItem, PlayerPasswordResetResult, PlayerRoomHistoryItem, PlayerRoomHistoryResponse, PlayerSensitiveInfo, TransactionItem, TransactionResponse } from "../types";

interface PlayerResponse {
  items: PlayerItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface PlayerFilters {
  keyword: string;
  playerId: string;
  name: string;
  loginName: string;
  agentId: string;
  agentName: string;
  level: string;
  roomId: string;
  role: string;
  clientStatus: string;
  clientVersion: string;
  minBalance: string;
  maxBalance: string;
  registeredFrom: string;
  registeredTo: string;
}

const emptyFilters: PlayerFilters = {
  keyword: "",
  playerId: "",
  name: "",
  loginName: "",
  agentId: "",
  agentName: "",
  level: "",
  roomId: "",
  role: "",
  clientStatus: "",
  clientVersion: "",
  minBalance: "",
  maxBalance: "",
  registeredFrom: "",
  registeredTo: "",
};

function playerFiltersFromHash(): PlayerFilters {
  const query = window.location.hash.split("?")[1] || "";
  const playerId = (new URLSearchParams(query).get("playerId") || "").trim().slice(0, 64);
  return playerId ? { ...emptyFilters, playerId } : { ...emptyFilters };
}

const balanceFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PlayersPage({ can, isSuper, notify }: { can: (permission: string) => boolean; isSuper: boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<PlayerResponse | null>(null);
  const [draft, setDraft] = useState<PlayerFilters>(playerFiltersFromHash);
  const [applied, setApplied] = useState<PlayerFilters>(playerFiltersFromHash);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<PlayerItem | null>(null);
  const [adjusting, setAdjusting] = useState<PlayerItem | null>(null);
  const [resettingPassword, setResettingPassword] = useState<PlayerItem | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<PlayerResponse>(`/api/game/players?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "游戏玩家加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, notify]);
  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as unknown as PlayerFilters);
    setPage(1);
  };
  const resetFilters = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
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
        description="查询玩家账号、余额、代理关系和客户端状态；按权限执行加减分和登录密码重置。"
        actions={<span className="readonly-badge"><i />敏感操作全程审计</span>}
      />

      <section className="panel player-filter-panel">
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <div className="player-filter-primary">
            <div className="search-box search-box--wide">
              <span>⌕</span>
              <input value={draft.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="输入玩家ID、登录账号、昵称、代理ID或代理名字" />
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
              <Field label="直属代理ID"><input value={draft.agentId} onChange={(event) => update("agentId", event.target.value)} placeholder="精确匹配代理ID" /></Field>
              <Field label="直属代理名字"><input value={draft.agentName} onChange={(event) => update("agentName", event.target.value)} placeholder="支持部分匹配" /></Field>
              <Field label="玩家等级"><input type="number" min="0" value={draft.level} onChange={(event) => update("level", event.target.value)} placeholder="例如 98" /></Field>
              <Field label="角色标记"><input value={draft.role} onChange={(event) => update("role", event.target.value)} placeholder="游戏内角色标签" /></Field>
              <Field label="当前房间ID"><input type="number" min="0" value={draft.roomId} onChange={(event) => update("roomId", event.target.value)} placeholder="0 表示未在房间" /></Field>
              <Field label="客户端状态"><input value={draft.clientStatus} onChange={(event) => update("clientStatus", event.target.value)} placeholder="精确匹配状态值" /></Field>
              <Field label="客户端版本"><input value={draft.clientVersion} onChange={(event) => update("clientVersion", event.target.value)} placeholder="精确匹配版本号" /></Field>
              <Field label="最低余额"><input type="number" step="0.01" value={draft.minBalance} onChange={(event) => update("minBalance", event.target.value)} /></Field>
              <Field label="最高余额"><input type="number" step="0.01" value={draft.maxBalance} onChange={(event) => update("maxBalance", event.target.value)} /></Field>
              <Field label="注册开始日期"><input type="date" value={draft.registeredFrom} onChange={(event) => update("registeredFrom", event.target.value)} /></Field>
              <Field label="注册结束日期"><input type="date" value={draft.registeredTo} onChange={(event) => update("registeredTo", event.target.value)} /></Field>
              <div className="filter-actions"><Button type="submit">应用组合条件</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置</Button></div>
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div><strong>游戏玩家列表</strong><span>数据来自服务器本机 kbedm.tbl_Account</span></div>
          <span className="toolbar__count">共 {data?.total ?? 0} 名玩家</span>
        </div>
        {loading && !data ? <LoadingBlock label="正在读取游戏玩家" /> : !data || data.items.length === 0 ? (
          <EmptyState title="没有找到玩家" description="可以清空部分查询条件后重新搜索。" />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="player-table">
                <thead><tr><th>玩家</th><th>登录账号</th><th>现金余额</th><th>等级 / 角色</th><th>直属代理</th><th>房间 / 客户端</th><th>注册 / 登录</th><th className="align-right">操作</th></tr></thead>
                <tbody>{data.items.map((player) => (
                  <tr key={player.id}>
                    <td><div className="user-cell"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><small>ID：{player.playerId}</small></div></div></td>
                    <td><code>{player.loginName || "—"}</code>{player.accountName && player.accountName !== player.loginName && <small className="cell-subtitle">KBE：{player.accountName}</small>}</td>
                    <td><strong className="money-value">{balanceFormatter.format(player.balance)}</strong><small className="cell-subtitle">游戏金币</small></td>
                    <td><strong>等级 {player.level}</strong><small className="cell-subtitle">{player.role || "无角色标记"}</small></td>
                    <td>{player.agentId ? <><strong>{player.agentName || "未知代理"}</strong><small className="cell-subtitle">ID：{player.agentId}</small></> : <span className="muted">无直属代理</span>}</td>
                    <td><strong>{player.roomId > 0 ? `房间 ${player.roomId}` : "未在房间"}</strong><small className="cell-subtitle">{player.clientStatus || "状态未上报"}{player.clientVersion ? ` · ${player.clientVersion}` : ""}</small></td>
                    <td>{formatDate(player.registrationTime)}<small className="cell-subtitle">最近：{formatDate(player.lastLoginAt)}</small></td>
                    <td><div className="row-actions">{can("game.player.balance_adjust") && <button className="success-link" onClick={() => setAdjusting(player)}>加减分</button>}{can("game.player.reset_password") && <button onClick={() => setResettingPassword(player)}>重置密码</button>}<button onClick={() => setSelected(player)}>查看详情</button></div></td>
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

      {selected && <PlayerDetail player={selected} can={can} isSuper={isSuper} notify={notify} onClose={() => setSelected(null)} />}
      {adjusting && <BalanceAdjustmentModal player={adjusting} onClose={() => setAdjusting(null)} onDone={(result) => { setAdjusting(null); notify(result.message); void load(); }} />}
      {resettingPassword && <ResetPlayerPasswordModal player={resettingPassword} onClose={() => setResettingPassword(null)} onDone={(result) => { setResettingPassword(null); notify(result.message); }} />}
    </div>
  );
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

function BalanceAdjustmentModal({ player, onClose, onDone }: { player: PlayerItem; onClose: () => void; onDone: (result: PlayerBalanceAdjustmentResult) => void }) {
  const [action, setAction] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const numericAmount = Number(amount);
  const targetBalance = player.balance + (action === "add" ? numericAmount || 0 : -(numericAmount || 0));
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<PlayerBalanceAdjustmentResult>(`/api/game/players/${encodeURIComponent(player.playerId)}/balance-adjustments`, { method: "POST", ...jsonBody({ action, amount: numericAmount, reason, expectedBalance: player.balance, confirm: confirmed }) });
      onDone(result);
    } catch (reasonValue) { setError(reasonValue instanceof ApiError ? reasonValue.message : "玩家加减分失败"); } finally { setBusy(false); }
  };
  const invalid = !Number.isInteger(numericAmount) || numericAmount < 1 || numericAmount > 1000000 || reason.trim().length < 2 || !confirmed || (action === "subtract" && numericAmount > player.balance);
  return <Modal title={`玩家加减分 · ${player.name || player.playerId}`} eyebrow="CUSTOMER SERVICE ADJUSTMENT" onClose={onClose}><div className="balance-adjust-player"><span>{player.name.slice(0, 1) || "玩"}</span><div><strong>{player.name || "未设置昵称"}</strong><p>ID {player.playerId} · 当前金币 {balanceFormatter.format(player.balance)}</p></div>{player.roomId > 0 && <em>房间 {player.roomId}</em>}</div>{player.roomId > 0 && <div className="operation-warning"><strong>玩家当前正在房间中，仍可加减分</strong><p>本次调整的是玩家账号金币，不直接修改当前牌桌已经带入的积分；提交后后台会回读账号余额并记录资金流水。</p></div>}{error && <div className="form-error"><span>!</span>{error}</div>}<div className="balance-action-tabs"><button type="button" className={action === "add" ? "is-active" : ""} onClick={() => setAction("add")}>增加金币</button><button type="button" className={action === "subtract" ? "is-active is-danger" : ""} onClick={() => setAction("subtract")}>扣减金币</button></div><div className="form-grid form-grid--single"><Field label="本次金币数量" hint="只支持整数金币；单次 1 到 1,000,000"><input type="number" min="1" max="1000000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="请输入数量" /></Field><Field label="客服维护原因" hint="原因会显示在玩家资金情况和交易记录中，并同时进入操作审计"><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：客服工单补偿，核对编号……" /></Field></div><div className={`balance-change-preview ${action === "subtract" ? "is-subtract" : ""}`}><div><span>操作前</span><strong>{balanceFormatter.format(player.balance)}</strong></div><i>→</i><div><span>预计操作后</span><strong>{balanceFormatter.format(targetBalance)}</strong></div></div><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已核对玩家ID、操作方向、金币数量和维护原因{player.roomId > 0 ? "，并知悉桌面已带入积分不会直接改变" : ""}</span></label><div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button variant={action === "subtract" ? "danger" : "primary"} disabled={invalid || busy} onClick={() => void submit()}>{busy ? "正在提交并回读…" : action === "add" ? "确认增加金币" : "确认扣减金币"}</Button></div></Modal>;
}

type PlayerDetailTab = "profile" | "finance" | "rooms";

function PlayerDetail({ player, can, isSuper, notify, onClose }: { player: PlayerItem; can: (permission: string) => boolean; isSuper: boolean; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void }) {
  const [tab, setTab] = useState<PlayerDetailTab>("profile");
  const [finance, setFinance] = useState<TransactionResponse | null>(null);
  const [financePage, setFinancePage] = useState(1);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [rooms, setRooms] = useState<PlayerRoomHistoryResponse | null>(null);
  const [roomPage, setRoomPage] = useState(1);
  const [roomLoading, setRoomLoading] = useState(false);
  const [sensitive, setSensitive] = useState<PlayerSensitiveInfo | null>(null);
  const [sensitiveLoading, setSensitiveLoading] = useState(isSuper);
  const [sensitiveError, setSensitiveError] = useState("");
  const canViewFinance = can("game.transaction.view");
  const canViewRooms = can("game.room_record.view");

  const loadSensitive = useCallback(async () => {
    if (!isSuper) return;
    setSensitiveLoading(true); setSensitiveError("");
    try {
      setSensitive(await api<PlayerSensitiveInfo>(`/api/game/players/${encodeURIComponent(player.playerId)}/sensitive`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "玩家IP和GPS加载失败";
      setSensitiveError(message);
      notify(message, "error");
    } finally { setSensitiveLoading(false); }
  }, [isSuper, notify, player.playerId]);

  const loadFinance = useCallback(async () => {
    if (!canViewFinance) return;
    setFinanceLoading(true);
    try {
      setFinance(await api<TransactionResponse>(`/api/game/transactions?playerId=${encodeURIComponent(player.playerId)}&page=${financePage}&pageSize=10`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家资金情况加载失败", "error");
    } finally { setFinanceLoading(false); }
  }, [canViewFinance, financePage, notify, player.playerId]);

  const loadRooms = useCallback(async () => {
    if (!canViewRooms) return;
    setRoomLoading(true);
    try {
      setRooms(await api<PlayerRoomHistoryResponse>(`/api/game/players/${encodeURIComponent(player.playerId)}/rooms?page=${roomPage}&pageSize=10`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "玩家房间战绩加载失败", "error");
    } finally { setRoomLoading(false); }
  }, [canViewRooms, notify, player.playerId, roomPage]);

  useEffect(() => { if (tab === "finance") void loadFinance(); }, [loadFinance, tab]);
  useEffect(() => { if (tab === "rooms") void loadRooms(); }, [loadRooms, tab]);
  useEffect(() => { if (tab === "profile" && isSuper && !sensitive && !sensitiveError) void loadSensitive(); }, [isSuper, loadSensitive, sensitive, sensitiveError, tab]);

  return (
    <Modal wide title={player.name || `玩家 ${player.playerId}`} eyebrow="PLAYER PROFILE" onClose={onClose}>
      <div className="player-detail-heading">
        <span>{player.name.slice(0, 1) || "玩"}</span>
        <div><strong>{player.name || "未设置昵称"}</strong><p>游戏ID：{player.playerId} · 登录账号：{player.loginName || "—"}</p></div>
        <em>只读</em>
      </div>
      <nav className="player-profile-tabs" aria-label="玩家详情分类">
        <button type="button" className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}><span>基本资料</span><small>账号、资产与代理</small></button>
        <button type="button" className={tab === "finance" ? "is-active" : ""} disabled={!canViewFinance} onClick={() => setTab("finance")}><span>资金情况</span><small>{canViewFinance ? "完整金币流水" : "当前角色无权限"}</small></button>
        <button type="button" className={tab === "rooms" ? "is-active" : ""} disabled={!canViewRooms} onClick={() => setTab("rooms")}><span>房间战绩</span><small>{canViewRooms ? "参战房间与输赢" : "当前角色无权限"}</small></button>
      </nav>
      {tab === "profile" && <PlayerProfileTab player={player} isSuper={isSuper} sensitive={sensitive} sensitiveLoading={sensitiveLoading} sensitiveError={sensitiveError} onRetrySensitive={() => void loadSensitive()} />}
      {tab === "finance" && canViewFinance && <PlayerFinanceTab player={player} data={finance} page={financePage} loading={financeLoading} onPage={setFinancePage} />}
      {tab === "rooms" && canViewRooms && <PlayerRoomsTab player={player} data={rooms} page={roomPage} loading={roomLoading} onPage={setRoomPage} />}
    </Modal>
  );
}

function PlayerProfileTab({ player, isSuper, sensitive, sensitiveLoading, sensitiveError, onRetrySensitive }: { player: PlayerItem; isSuper: boolean; sensitive: PlayerSensitiveInfo | null; sensitiveLoading: boolean; sensitiveError: string; onRetrySensitive: () => void }) {
  return <div className="player-profile-tab-content">
      <section className="player-detail-section">
        <h3>账号与游戏状态</h3>
        <div className="player-detail-grid">
          <Detail label="KBE账号" value={player.accountName} mono />
          <Detail label="性别" value={player.sex} />
          <Detail label="角色标记" value={player.role} />
          <Detail label="玩家等级" value={player.level} />
          <Detail label="VIP / VIP等级" value={`${player.vip} / ${player.vipLevel}`} />
          <Detail label="客户端状态" value={player.clientStatus || "未上报"} />
          <Detail label="客户端版本" value={player.clientVersion} />
          <Detail label="当前房间" value={player.roomId > 0 ? `${player.roomId}（${player.roomType || "类型未记录"}）` : "未在房间"} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>资产与战绩</h3>
        <div className="player-detail-grid">
          <Detail label="现金余额" value={balanceFormatter.format(player.balance)} highlight />
          <Detail label="金币整数 / 小数" value={`${player.gold} / ${player.gold2}`} />
          <Detail label="累计局数" value={player.totalRounds} />
          <Detail label="累计总分" value={player.totalScore} />
          <Detail label="登录次数" value={player.loginCount} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>代理关系</h3>
        <div className="player-detail-grid">
          <Detail label="直属代理" value={player.agentName ? `${player.agentName}（${player.agentId}）` : player.agentId} />
        </div>
      </section>
      <section className="player-detail-section">
        <h3>注册与其他参数</h3>
        <div className="player-detail-grid">
          <Detail label="注册时间" value={formatDate(player.registrationTime)} />
          <Detail label="最近登录" value={formatDate(player.lastLoginAt)} />
          <Detail label="备注" value={player.remark} wide />
        </div>
      </section>
      {isSuper && <PlayerSensitiveSection player={player} data={sensitive} loading={sensitiveLoading} error={sensitiveError} onRetry={onRetrySensitive} />}
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

function PlayerFinanceTab({ player, data, page, loading, onPage }: { player: PlayerItem; data: TransactionResponse | null; page: number; loading: boolean; onPage: (page: number) => void }) {
  if (loading && !data) return <LoadingBlock label="正在读取玩家完整资金情况" />;
  if (!data) return <EmptyState title="资金情况暂时无法显示" description="请稍后重新打开资金情况页签。" />;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="player-profile-tab-content">
    <section className="player-fund-overview">
      <ProfileMetric label="当前金币" value={balanceFormatter.format(data.player.currentBalance)} note={`${data.player.totalRecords} 条历史流水`} />
      <ProfileMetric label="历史总流入" value={`+${balanceFormatter.format(data.summary.totalIn)}`} note={`最早记录 ${data.summary.firstAt || "—"}`} tone="win" />
      <ProfileMetric label="历史总流出" value={`−${balanceFormatter.format(data.summary.totalOut)}`} note={`道具支出 ${balanceFormatter.format(data.summary.itemSpend)}`} tone="loss" />
      <ProfileMetric label="金币净变化" value={formatPlayerScore(data.summary.netChange)} note={`游戏相关 ${formatPlayerScore(data.summary.gameNet)}`} tone={data.summary.netChange >= 0 ? "win" : "loss"} />
    </section>
    <section className="player-profile-data-section">
      <div className="player-profile-section-title"><div><h3>全部金币流水</h3><p>显示每笔金币变更前后余额、实际增减、关联内容和客服维护原因</p></div><button type="button" onClick={() => { window.location.hash = `/game/transactions?playerId=${encodeURIComponent(player.playerId)}`; }}>进入交易记录模块</button></div>
      {data.items.length === 0 ? <EmptyState title="该玩家没有金币流水" description="服务器主金币流水中暂时没有这个玩家的记录。" /> : <div className="table-wrap"><table className="player-finance-table"><thead><tr><th>时间</th><th>业务类型</th><th>实际变化</th><th>变更前 → 变更后</th><th>关联内容</th></tr></thead><tbody>{data.items.map((item) => <PlayerFinanceRow key={item.id} item={item} />)}</tbody></table></div>}
      <ProfilePagination page={page} totalPages={totalPages} total={data.total} loading={loading} onPage={onPage} unit="条流水" />
    </section>
  </div>;
}

function PlayerFinanceRow({ item }: { item: TransactionItem }) {
  const roomContext = [item.remark1 ? `房间 ${item.remark1}` : "", item.remark3 && item.remark3 !== "0" ? `第 ${item.remark3} 局` : "", item.remark4].filter(Boolean).join(" · ");
  const context = item.maintenanceReason ? `维护原因：${item.maintenanceReason}${item.maintenanceOperator ? ` · 操作人：${item.maintenanceOperator}` : ""}` : roomContext;
  return <tr><td><strong>{item.date}</strong><small className="cell-subtitle">{item.time}</small></td><td><strong>{item.optionType}</strong><small className="cell-subtitle">{financeCategoryLabel(item.category)}</small></td><td><strong className={`room-score room-score--${item.change > 0 ? "win" : item.change < 0 ? "loss" : "draw"}`}>{formatPlayerScore(item.change)}</strong></td><td><span className="balance-route">{balanceFormatter.format(item.oldBalance)}<i>→</i><strong>{balanceFormatter.format(item.newBalance)}</strong></span></td><td><span className={`player-history-context ${item.maintenanceReason ? "is-maintenance" : ""}`} title={context || undefined}>{context || "无关联说明"}</span></td></tr>;
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
      {data.items.length === 0 ? <EmptyState title="该玩家没有房间战绩" description="总战绩表中暂时没有这个玩家形成的房间记录。" /> : <div className="table-wrap"><table className="player-room-history-table"><thead><tr><th>房间</th><th>房间时间</th><th>座位 / 局数</th><th>累计带入 / 返还</th><th>最终输赢</th><th>操作</th></tr></thead><tbody>{data.items.map((item) => <PlayerRoomRow key={item.id} item={item} />)}</tbody></table></div>}
      <ProfilePagination page={page} totalPages={totalPages} total={data.total} loading={loading} onPage={onPage} unit="个房间" />
    </section>
  </div>;
}

function PlayerRoomRow({ item }: { item: PlayerRoomHistoryItem }) {
  return <tr><td><strong className="room-list-id">{item.roomId}</strong><small className="cell-subtitle">{item.roomName || item.playMode || "未记录房间名"}</small></td><td><span>{item.startedAt || item.recordedAt || "—"}</span><small className="cell-subtitle">至 {item.endedAt || item.recordedAt || "—"}</small></td><td><strong>{item.seat + 1} 号位 · {item.roundsPlayed} 局</strong><small className="cell-subtitle">房间共 {item.roomRoundCount} 局</small></td><td><strong>{balanceFormatter.format(item.totalBuyIn)} / {item.scoreSource === "settlement" ? balanceFormatter.format(item.settlementReturn) : "未记录"}</strong></td><td><strong className={`room-score room-score--${item.result}`}>{formatPlayerScore(item.score)}</strong>{item.scoreMismatch && <small className="room-score-warning">原战绩 {formatPlayerScore(item.recordedScore)}</small>}</td><td><button className="player-profile-link" type="button" onClick={() => { window.location.hash = `/game/room-records?roomId=${encodeURIComponent(item.roomId)}`; }}>查看房间战绩</button></td></tr>;
}

function ProfileMetric({ label, value, note, tone = "default" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`player-profile-metric player-profile-metric--${tone}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function ProfilePagination({ page, totalPages, total, loading, onPage, unit }: { page: number; totalPages: number; total: number; loading: boolean; onPage: (page: number) => void; unit: string }) {
  return <footer className="table-pagination"><span>共 {total} {unit}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button></div></footer>;
}

function financeCategoryLabel(category: TransactionItem["category"]) {
  return { game: "游戏输赢", item: "道具消费", consumption: "其他消费", adjustment: "人工调整", other: "其他变化" }[category];
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
