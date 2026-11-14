import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";

type PrettyKind = "uid" | "invite";
type PrettyStatus = "init" | "used" | "disabled";

interface PrettyNumberItem {
  id?: number;
  prettyNo: string;
  kind: PrettyKind | string;
  status: PrettyStatus | string;
  userId: string;
  userName: string;
  clubId: string;
  clubName: string;
  bindDate: string;
  opName: string;
  remark: string;
}

interface PrettyNumberListResponse {
  items: PrettyNumberItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface PrettyNumberMutationResult {
  result: number;
  kind: string;
  prettyNo: string;
  status?: string;
  userId?: string;
  userName?: string;
  clubId?: string;
  oldInviteCode?: string;
  oldUserId?: string;
  newInviteCode?: string;
  context?: string;
}

interface PrettyNumberCandidate {
  prettyNo: string;
}

interface PrettyNumberCandidatesResponse {
  items: PrettyNumberCandidate[];
}

const statusLabels: Record<string, string> = { init: "可绑定", used: "已绑定", disabled: "已停用" };

// 两类靓号仍是两个独立号池、各管各的，但只有一个菜单入口：进来后用页签切换。
const kindConfig: Record<PrettyKind, { title: string; hint: string; poolName: string }> = {
  uid: { title: "账号ID靓号", hint: "玩家个人ID", poolName: "账号ID靓号池" },
  invite: { title: "俱乐部邀请码靓号", hint: "代理邀请码", poolName: "邀请码靓号池" },
};

function digitsOnly(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, length);
}

function statusClass(status: string): string {
  if (status === "init") return "pill--init";
  if (status === "used") return "pill--used";
  return "pill--disabled";
}

function prettyStatusLabel(status: string): string {
  return statusLabels[status] || status || "—";
}

export default function PrettyNumbersPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const available = (["uid", "invite"] as PrettyKind[]).filter((item) => can(`game.pretty_no.${item}.view`));
  const [kind, setKind] = useState<PrettyKind>(available[0] ?? "uid");

  if (available.length === 0) {
    return <div className="page-stack">
      <PageHeader eyebrow="PRETTY NUMBERS" title="靓号管理" description="当前角色没有靓号查看权限。" />
      <section className="panel"><EmptyState title="没有可用权限" description="请联系管理员授予账号ID靓号或俱乐部邀请码靓号的查看权限。" /></section>
    </div>;
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="PRETTY NUMBERS"
      title="靓号管理"
      description="把 6 位号码加入靓号池并绑定到账号或俱乐部邀请码；两类号池分开管理，解绑后号码永久停用、不再回收。"
      actions={<span className="readonly-badge"><i />所有号码操作全程审计</span>}
    />
    {available.length > 1 ? (
      <nav className="segmented" aria-label="靓号类型">
        {available.map((item) => (
          <button key={item} type="button" className={kind === item ? "is-active" : ""} aria-current={kind === item ? "page" : undefined} onClick={() => setKind(item)}>
            {kindConfig[item].title}<span>{kindConfig[item].hint}</span>
          </button>
        ))}
      </nav>
    ) : null}
    <PrettyKindPanel key={kind} kind={kind} can={can} notify={notify} />
  </div>;
}

function PrettyKindPanel({ kind, can, notify }: { kind: PrettyKind; can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const config = kindConfig[kind];
  const [applied, setApplied] = useState({ status: "", keyword: "" });
  const [draft, setDraft] = useState(applied);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<PrettyNumberListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [binding, setBinding] = useState<PrettyNumberItem | null>(null);
  const canManage = can(`game.pretty_no.${kind}.manage`);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      if (value.trim()) params.set(key, value.trim());
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<PrettyNumberListResponse>(`/api/game/pretty-numbers/${kind}?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : `${config.poolName}加载失败`, "error");
    } finally {
      setLoading(false);
    }
  }, [kind, queryString, notify, config.poolName]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setApplied({ status: draft.status, keyword: draft.keyword.trim() });
    setPage(1);
  };
  const resetFilters = () => {
    const empty = { status: "", keyword: "" };
    setDraft(empty);
    setApplied(empty);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return <>
    <section className="panel">
      <form className="pretty-filter" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <label><span>状态</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="">全部状态</option><option value="init">可绑定</option><option value="used">已绑定</option><option value="disabled">已停用</option></select></label>
        <label className="pretty-filter__wide"><span>关键字</span><input value={draft.keyword} maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, keyword: event.target.value }))} placeholder={kind === "invite" ? "靓号码、绑定账号ID、昵称或俱乐部" : "靓号码、绑定账号ID或昵称"} /></label>
        <div className="pretty-filter__actions">
          <Button type="submit">查询</Button>
          <Button type="button" variant="secondary" onClick={resetFilters}>重置</Button>
          {canManage && <Button type="button" onClick={() => setAdding(true)}>号码入池</Button>}
        </div>
      </form>
    </section>

    <section className="panel">
      <div className="toolbar pretty-toolbar">
        <div><strong>{config.poolName}</strong><span>号码与绑定关系由游戏服维护；停用号码不可再绑定，已绑定号码不可解绑</span></div>
        <span className="toolbar__count">共 {data?.total ?? 0} 个号码</span>
      </div>
      {loading && !data ? <LoadingBlock label={`正在读取${config.poolName}`} /> : !data || data.items.length === 0 ? (
        <EmptyState title="没有找到靓号" description="可以调整筛选条件，或先把候选号码加入号池。" />
      ) : (
        <>
          <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
            <table className="pretty-table">
              <thead><tr><th>靓号</th><th>状态</th><th>{kind === "invite" ? "绑定代理" : "绑定账号"}</th>{kind === "invite" && <th>归属俱乐部</th>}<th>绑定时间</th><th>操作人</th><th>备注</th><th className="align-right">操作</th></tr></thead>
              <tbody>{data.items.map((item) => <tr key={item.prettyNo}>
                <td><code className="pretty-number">{item.prettyNo}</code></td>
                <td><span className={`pill ${statusClass(item.status)}`}><i />{prettyStatusLabel(item.status)}</span></td>
                <td>{item.userId ? <div className="user-cell"><span>{item.userName.slice(0, 1) || "玩"}</span><div><strong>{item.userName || "未设置昵称"}</strong><small>ID：{item.userId}</small></div></div> : <span className="muted">未绑定</span>}</td>
                {kind === "invite" && <td>{item.clubId ? <><strong>{item.clubName || item.clubId}</strong><small className="cell-subtitle">ID：{item.clubId}</small></> : <span className="muted">—</span>}</td>}
                <td>{item.bindDate || "—"}</td>
                <td>{item.opName || "—"}</td>
                <td className="pretty-remark">{item.remark || "—"}</td>
                <td><div className="row-actions row-actions--right">
                  {canManage && item.status === "init" && <Button type="button" variant="secondary" onClick={() => setBinding(item)}>{kind === "invite" ? "绑定邀请码" : "绑定用户"}</Button>}
                  {item.status === "used" && <span className="muted">已绑定不可解绑</span>}
                  {!canManage && <span className="muted">仅查看</span>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <footer className="table-pagination">
            <span>显示 {firstRow}–{lastRow}，共 {data.total} 个靓号</span>
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

    {adding && <AddPrettyNumberModal kind={kind} notify={notify} onClose={() => setAdding(false)} onDone={load} />}
    {binding && <BindPrettyNumberModal kind={kind} item={binding} notify={notify} onClose={() => setBinding(null)} onDone={load} />}
  </>;
}

function AddPrettyNumberModal({ kind, notify, onClose, onDone }: { kind: PrettyKind; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onDone: () => void }) {
  const invite = kind === "invite";
  const [mode, setMode] = useState("prefix");
  const [digits, setDigits] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [prettyNo, setPrettyNo] = useState("");
  const [remark, setRemark] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (!/^\d{1,6}$/.test(digits)) {
      setError("候选号请输入 1 到 6 位数字");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode, digits, limit: "60" });
      const result = await api<PrettyNumberCandidatesResponse>(`/api/game/pretty-numbers/${kind}/candidates?${params.toString()}`);
      setCandidates(result.items.map((item) => item.prettyNo));
      if (result.items.length === 0) setError(invite ? "邀请码码池里没有匹配的候选号码，换一组数字试试" : "原号池里没有匹配的候选号码，换一组数字试试");
    } catch (reason) {
      setCandidates([]);
      setError(reason instanceof ApiError ? reason.message : "候选号查询失败");
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!/^\d{6}$/.test(prettyNo)) { setError("请选择或输入完整的 6 位号码"); return; }
    if (!confirmed) { setError("请先确认号码入池后不可逆"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await api<PrettyNumberMutationResult>(`/api/game/pretty-numbers/${kind}`, {
        method: "POST",
        ...jsonBody({ prettyNo, remark }),
      });
      notify(`${result.prettyNo || prettyNo} 已加入${invite ? "邀请码" : "账号ID"}靓号池，状态：${prettyStatusLabel(result.status || "init")}`);
      onDone();
      onClose();
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "号码入池失败";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return <Modal wide title={`${invite ? "邀请码" : "账号ID"}号码入池`} eyebrow="ADD PRETTY NUMBER" onClose={busy ? () => undefined : onClose}>
    <form onSubmit={submitGuard(submit)}>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <div className="pretty-notice">
        本页只能入池<strong>{invite ? "俱乐部邀请码靓号" : "账号ID靓号"}</strong>。{invite
          ? "号码会从俱乐部邀请码码池里预留，以后不会再随机发给代理。"
          : "号码会从玩家 ID 待分配池里摘掉，以后新注册不会再抽到它。"}
      </div>
      <div className="form-grid">
        <Field label="靓号码" hint="服务端只接受 6 位数字；入池后会从原号池锁定">
          <input inputMode="numeric" maxLength={6} value={prettyNo} disabled={busy} onChange={(event) => { setPrettyNo(digitsOnly(event.target.value, 6)); setConfirmed(false); }} placeholder="如 888888" />
        </Field>
        <Field label="匹配方式">
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="prefix">前缀匹配</option>
            <option value="suffix">尾号匹配</option>
            <option value="contains">包含匹配</option>
          </select>
        </Field>
        <Field label="候选数字" hint={invite ? "从邀请码码池里查还没发出的号码" : "从游戏服原号池里查还没发出的号码"} as="div">
          <div className="pretty-search-row">
            <input inputMode="numeric" maxLength={6} value={digits} disabled={busy} onChange={(event) => setDigits(digitsOnly(event.target.value, 6))} placeholder="如 888" />
            <Button type="button" variant="secondary" disabled={busy || searching} onClick={() => void search()}>{searching ? "查询中…" : "查候选号"}</Button>
          </div>
        </Field>
        <div className="form-grid__full">
          {candidates.length > 0 && <div className="pretty-candidate-list">{candidates.map((number) => <button key={number} type="button" className={`pretty-candidate ${prettyNo === number ? "is-selected" : ""}`} onClick={() => { setPrettyNo(number); setConfirmed(false); }}>{number}</button>)}</div>}
        </div>
        <Field label="备注" as="div">
          <input value={remark} maxLength={200} disabled={busy} onChange={(event) => setRemark(event.target.value)} placeholder="如：客户购买 / 2026-11-14 入池" />
        </Field>
      </div>
      <label className={`confirm-check ${confirmed ? "is-checked" : ""}`}>
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我已核对号码，了解入池后该号码会从原号池移除，不能再作为普通号发出。</span>
      </label>
      <div className="form-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={busy || !confirmed}>{busy ? "正在入池…" : "确认入池"}</Button>
      </div>
    </form>
  </Modal>;
}

function BindPrettyNumberModal({ kind, item, notify, onClose, onDone }: { kind: PrettyKind; item: PrettyNumberItem; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void; onDone: () => void }) {
  const invite = kind === "invite";
  const [userId, setUserId] = useState("");
  // 邀请码靓号只填原始邀请码：代理和俱乐部由后台反查，运营不用记 ID。
  const [inviteCode, setInviteCode] = useState("");
  const [remark, setRemark] = useState(item.remark || "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (invite) {
      if (!/^\d{6}$/.test(inviteCode)) { setError("请输入要替换的原始邀请码（6 位数字）"); return; }
      if (inviteCode === item.prettyNo) { setError("原始邀请码不能和要绑定的靓号相同"); return; }
    } else if (!/^\d{6}$/.test(userId)) {
      setError("请输入玩家的用户ID（6 位数字，不是靓号）");
      return;
    }
    if (!confirmed) { setError(invite ? "请先确认原始邀请码无误" : "请先确认用户ID无误"); return; }
    setBusy(true);
    setError("");
    try {
      const body = invite ? { inviteCode, remark } : { userId, remark };
      const result = await api<PrettyNumberMutationResult>(`/api/game/pretty-numbers/${kind}/${encodeURIComponent(item.prettyNo)}/bind`, {
        method: "POST",
        ...jsonBody(body),
      });
      const target = result.userName || result.userId || "";
      const oldCode = result.oldInviteCode ? `，原邀请码 ${result.oldInviteCode} 已作废` : "";
      notify(invite
        ? `${target || "该代理"} 的邀请码已替换为 ${item.prettyNo}${oldCode}`
        : `${target || result.userId || ""} 的账号ID已改为 ${item.prettyNo}`);
      onDone();
      onClose();
    } catch (reason) {
      let message = reason instanceof ApiError ? reason.message : "靓号绑定失败";
      if (message.includes("不是本俱乐部代理")) {
        message += "。请先在游戏内或俱乐部管理里把该玩家设为代理，再回来绑定。";
      }
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return <Modal wide
    title={invite ? `绑定邀请码靓号 ${item.prettyNo}` : `绑定账号ID靓号 ${item.prettyNo}`}
    eyebrow={invite ? "BIND INVITE CODE" : "BIND ACCOUNT ID"}
    onClose={busy ? () => undefined : onClose}>
    <form onSubmit={submitGuard(submit)}>
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <div className="pretty-summary">
        <span className="pretty-number">{item.prettyNo}</span>
        <div><strong>{invite ? "俱乐部邀请码靓号" : "账号ID靓号"}</strong><small>{prettyStatusLabel(item.status)} · 入池操作人 {item.opName || "—"}</small></div>
      </div>
      {invite ? (
        <div className="pretty-notice">
          填这位代理<strong>现在正在用的邀请码</strong>，后台自动带出代理和所属俱乐部；确认后 <strong>{item.prettyNo}</strong> 会替换它，原邀请码作废。
        </div>
      ) : (
        <div className="pretty-notice">
          这个号码会变成<strong>该玩家在游戏里的账号ID</strong>；后台查询、上下级关系和流水仍按真实用户ID走，不受影响。
        </div>
      )}
      <div className="form-grid">
        {invite ? (
          <Field label="原始邀请码" hint="填这位代理当前用的 6 位邀请码，后台自动识别代理和俱乐部" as="div">
            <input inputMode="numeric" maxLength={6} value={inviteCode} disabled={busy} onChange={(event) => { setInviteCode(digitsOnly(event.target.value, 6)); setConfirmed(false); }} placeholder="如 482913" />
          </Field>
        ) : (
          <Field label="用户ID" hint="填要绑定这个靓号的玩家用户ID，6 位数字；这里不填靓号" as="div">
            <input inputMode="numeric" maxLength={6} value={userId} disabled={busy} onChange={(event) => { setUserId(digitsOnly(event.target.value, 6)); setConfirmed(false); }} placeholder="玩家的用户ID，如 580629" />
          </Field>
        )}
        <Field label="备注" as="div">
          <input value={remark} maxLength={200} disabled={busy} onChange={(event) => setRemark(event.target.value)} placeholder={invite ? "如：代理换好码 / 客户购买" : "如：客户购买 / 老玩家补偿"} />
        </Field>
      </div>
      <label className={`confirm-check ${confirmed ? "is-checked" : ""}`}>
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>{invite ? "我已核对原始邀请码，替换后该码作废。" : "我已核对用户ID，绑定后玩家端会立即显示新的账号ID。"}</span>
      </label>
      <div className="form-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={busy || !confirmed}>{busy ? "正在绑定…" : (invite ? "确认替换邀请码" : "确认绑定用户")}</Button>
      </div>
    </form>
  </Modal>;
}
