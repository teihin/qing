import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  Pagination,
  SeatBar,
  timeText,
  type AutomationClubItem,
  type AutomationGroupItem,
  type AutomationPageProps,
  type AutomationRoomItem,
} from "./shared";

interface ClubListResponse { items: AutomationClubItem[]; page: number; pageSize: number; total: number }
interface ClubDetailResponse { club: AutomationClubItem; rooms: AutomationRoomItem[]; groups: AutomationGroupItem[] }
interface ScopeUser { userId: number; username: string; displayName: string; roleName: string; isSuper: boolean; clubIds: string[] }
interface ScopeResponse { items: ScopeUser[]; clubs: { clubId: string; name: string }[] }

const pageSizes = [20, 50, 100];

export default function AutomationClubsPage({ can, notify }: AutomationPageProps) {
  const [data, setData] = useState<ClubListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<AutomationClubItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [refreshing, setRefreshing] = useState("");

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<ClubListResponse>(`/api/automation/clubs?page=${targetPage}&pageSize=${targetSize}&keyword=${encodeURIComponent(query)}&status=${status}`);
      setData(response);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "俱乐部接入列表加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, status, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);

  const refresh = async (club: AutomationClubItem) => {
    setRefreshing(club.clubId);
    try {
      const result = await api<{ message: string }>(`/api/automation/clubs/${club.clubId}/refresh`, { method: "POST" });
      notify(result.message);
      await load(page, pageSize, true);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "刷新房间池失败", "error");
    } finally {
      setRefreshing("");
    }
  };

  return <div className="page-stack">
    <PageHeader
      eyebrow="CLUB ONBOARDING"
      title="俱乐部接入"
      description="配置俱乐部机器人配额、占座比例和房间池；数据范围用于限制普通运营可见的俱乐部。"
      actions={<div className="automation-header-actions">
        {can("automation.scope.manage") && <Button variant="secondary" onClick={() => setScopeOpen(true)}>数据范围</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>俱乐部与房间均来自自动化演示快照；正式接入后由 Worker 定时回写真实房间池。</DemoNote>

    <section className="panel">
      <div className="toolbar automation-toolbar">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索俱乐部 ID 或名称" />
          <button>搜索</button>
        </form>
        <div className="automation-filter-row">
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select></label>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!data && loading ? <LoadingBlock label="正在读取俱乐部接入配置" /> : !data || data.items.length === 0 ? <EmptyState title="没有匹配的俱乐部" description="调整搜索条件，或先在数据库中完成俱乐部接入。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>俱乐部</th><th>模式 / 联盟</th><th>房间与座位</th><th>终端配额</th><th>占座比例</th><th>状态</th><th>最近更新</th><th>操作</th></tr></thead>
            <tbody>
              {data.items.map((club) => <tr key={club.clubId}>
                <td><strong>{club.name}</strong><small className="cell-subtitle">{club.clubId} · {club.memberCount} 名成员</small></td>
                <td>模式 {club.mode}<small className="cell-subtitle">{club.unionName || "无联盟"}</small></td>
                <td>{club.roomCount} 个房间<small className="cell-subtitle"><SeatBar seated={club.seated} maxSeats={club.capacity} /></small></td>
                <td><strong>{club.onlineCount} / {club.robotQuota}</strong><small className="cell-subtitle">在线 / 配额，共 {club.robotCount} 台</small></td>
                <td>{club.seatRatio}%<small className="cell-subtitle">机器人最多占座比例</small></td>
                <td><AutomationBadge value={club.status} /></td>
                <td>{timeText(club.updatedAt)}</td>
                <td><div className="row-actions">
                  <button type="button" onClick={() => setDetailId(club.clubId)}>详情</button>
                  {can("automation.club.update") && <button type="button" onClick={() => setEditing(club)}>配置</button>}
                  {can("automation.club.refresh") && <button type="button" disabled={refreshing === club.clubId} onClick={() => void refresh(club)}>{refreshing === club.clubId ? "刷新中…" : "刷新房间池"}</button>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>

    {editing && <ClubEditModal club={editing} onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); notify(message); void load(page, pageSize, true); }} />}
    {detailId && <ClubDetailModal clubId={detailId} canRefresh={can("automation.club.refresh")} notify={notify} onClose={() => setDetailId(null)} onRefresh={async () => { await load(page, pageSize, true); }} />}
    {scopeOpen && <ScopeModal onClose={() => setScopeOpen(false)} notify={notify} />}
  </div>;
}

function ClubEditModal({ club, onClose, onSaved }: { club: AutomationClubItem; onClose: () => void; onSaved: (message: string) => void }) {
  const [robotQuota, setRobotQuota] = useState(String(club.robotQuota));
  const [seatRatio, setSeatRatio] = useState(String(club.seatRatio));
  const [maxPerRoom, setMaxPerRoom] = useState(String(club.maxPerRoom ?? 2));
  const [inviteCode, setInviteCode] = useState(club.inviteCode ?? "");
  const [status, setStatus] = useState(club.status);
  const [notes, setNotes] = useState(club.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/clubs/${club.clubId}`, {
        method: "PUT",
        ...jsonBody({ robotQuota: Number(robotQuota), seatRatio: Number(seatRatio), maxPerRoom: Number(maxPerRoom), inviteCode: inviteCode.trim(), status, notes }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存俱乐部接入配置失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`配置 ${club.name}`} eyebrow={`${club.clubId} · CLUB AUTOMATION`} onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="机器人配额" hint="0–500，超过配额的终端不会自动进房"><input type="number" min={0} max={500} value={robotQuota} onChange={(event) => setRobotQuota(event.target.value)} /></Field>
      <Field label="占座比例（%）" hint="机器人最多占房间座位的比例，0–100"><input type="number" min={0} max={100} value={seatRatio} onChange={(event) => setSeatRatio(event.target.value)} /></Field>
      <Field label="每房最多机器人" hint="1–8 台，超过上限不能继续指派进同一房间"><input type="number" min={1} max={8} value={maxPerRoom} onChange={(event) => setMaxPerRoom(event.target.value)} /></Field>
      <Field label="邀请码" hint="6 位数字，机器人添加后自动加入俱乐部"><input value={inviteCode} maxLength={6} onChange={(event) => setInviteCode(event.target.value.replace(/\D/g, ""))} /></Field>
      <Field label="接入状态"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="enabled">已启用</option><option value="disabled">已停用</option></select></Field>
      <Field label="备注" hint="最多 120 个字符"><input value={notes} maxLength={120} onChange={(event) => setNotes(event.target.value)} /></Field>
      <div className="automation-form-note">配额和占座比例只约束后台调度，不会修改游戏内俱乐部的真实成员或房间设置。</div>
      <FormActions onCancel={onClose} busy={busy} submitText="保存接入配置" />
    </form>
  </Modal>;
}

function ClubDetailModal({ clubId, canRefresh, notify, onClose, onRefresh }: { clubId: string; canRefresh: boolean; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [data, setData] = useState<ClubDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setData(await api<ClubDetailResponse>(`/api/automation/clubs/${clubId}`));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "俱乐部详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await api<{ message: string }>(`/api/automation/clubs/${clubId}/refresh`, { method: "POST" });
      notify(result.message);
      await load();
      await onRefresh();
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "刷新房间池失败", "error");
    } finally {
      setRefreshing(false);
    }
  };

  return <Modal title={data ? `${data.club.name} · ${data.club.clubId}` : `俱乐部 ${clubId}`} eyebrow="CLUB DETAIL" onClose={onClose} wide>
    {loading ? <LoadingBlock label="正在读取俱乐部详情" /> : error ? <ErrorBanner message={error} /> : data && <>
      <div className="automation-detail-metrics">
        <div><span>房间</span><strong>{data.club.roomCount}</strong></div>
        <div><span>在座 / 容量</span><strong>{data.club.seated} / {data.club.capacity}</strong></div>
        <div><span>在线终端</span><strong>{data.club.onlineCount} / {data.club.robotQuota}</strong></div>
        <div><span>占座比例</span><strong>{data.club.seatRatio}%</strong></div>
      </div>
      {data.club.notes && <div className="automation-note-line">{data.club.notes}</div>}
      {canRefresh && <div className="automation-modal-actions"><Button variant="secondary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "正在刷新…" : "刷新房间池快照"}</Button></div>}

      <h3 className="automation-section-title">房间池 <span>{data.rooms.length}</span></h3>
      {data.rooms.length === 0 ? <EmptyState title="没有房间快照" description="执行一次房间池刷新后即可看到俱乐部房间。" /> : <div className="automation-room-grid">
        {data.rooms.map((room) => <article key={room.roomId} className="automation-room-card">
          <header><div><span>{room.roomId}</span><strong>{room.roomName || `房间 ${room.roomId}`}</strong></div><AutomationBadge value={room.status} label={room.status} /></header>
          <div><span>{room.tier} 档 · 底分 {room.baseScore}</span><SeatBar seated={room.seated} maxSeats={room.maxSeats} /></div>
          <footer><span>机器人 {room.robots} · 真人 {room.humans} · 观战 {room.observers}</span><em>剩余 {room.remainingMin} 分钟</em></footer>
        </article>)}
      </div>}

      <h3 className="automation-section-title">自动化组 <span>{data.groups.length}</span></h3>
      {data.groups.length === 0 ? <EmptyState title="还没有自动化组" description="在自动化组页面创建组并绑定策略后，组内机器人投放时会默认使用该策略。" /> : <div className="table-wrap">
        <table className="automation-table">
          <thead><tr><th>组名</th><th>策略</th><th>当前终端</th><th>在座</th><th>状态</th></tr></thead>
          <tbody>{data.groups.map((group) => <tr key={group.id}>
            <td><strong>{group.name}</strong><small className="cell-subtitle">{group.notes || "—"}</small></td>
            <td>{group.strategyName || "未绑定"}</td>
            <td>{group.robotCount}</td>
            <td>{group.seatedCount}</td>
            <td><AutomationBadge value={group.status} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
  </Modal>;
}

function ScopeModal({ onClose, notify }: { onClose: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<ScopeResponse | null>(null);
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    api<ScopeResponse>("/api/automation/scopes")
      .then((response) => {
        setData(response);
        setDraft(Object.fromEntries(response.items.map((item) => [item.userId, item.clubIds])));
      })
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : "数据范围加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (userId: number, clubId: string) => {
    setDraft((current) => {
      const selected = current[userId] ?? [];
      return { ...current, [userId]: selected.includes(clubId) ? selected.filter((item) => item !== clubId) : [...selected, clubId] };
    });
  };

  const save = async (user: ScopeUser) => {
    setSaving(user.userId); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/scopes/${user.userId}`, { method: "PUT", ...jsonBody({ clubIds: draft[user.userId] ?? [] }) });
      notify(`${user.displayName}：${result.message}`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存数据范围失败");
    } finally {
      setSaving(null);
    }
  };

  return <Modal title="俱乐部数据范围" eyebrow="DATA SCOPE" onClose={onClose} wide>
    <div className="operation-warning"><strong>只影响自动化页面可见的数据</strong><p>超级管理员和拥有「查看全部俱乐部」权限的角色不受限制；其他后台用户只有被勾选的俱乐部会在总览、房间、终端、告警等页面可见。</p></div>
    <ErrorBanner message={error} />
    {loading ? <LoadingBlock label="正在读取后台用户与数据范围" /> : data && <div className="automation-scope-list">
      {data.items.map((user) => <article key={user.userId}>
        <header><div><strong>{user.displayName}</strong><span>{user.username} · {user.roleName}</span></div>{user.isSuper ? <span className="automation-badge automation-badge--ok"><i />超级管理员不受限</span> : <Button variant="secondary" disabled={saving === user.userId} onClick={() => void save(user)}>{saving === user.userId ? "保存中…" : "保存"}</Button>}</header>
        {!user.isSuper && <div className="check-chip-list">
          {data.clubs.map((club) => <label key={club.clubId}><input type="checkbox" checked={(draft[user.userId] ?? []).includes(club.clubId)} onChange={() => toggle(user.userId, club.clubId)} /><span>{club.clubId} · {club.name}</span></label>)}
        </div>}
        {!user.isSuper && (draft[user.userId] ?? []).length === 0 && <p className="automation-inline-hint">未勾选任何俱乐部时，该用户看不到自动化业务数据。</p>}
      </article>)}
    </div>}
  </Modal>;
}
