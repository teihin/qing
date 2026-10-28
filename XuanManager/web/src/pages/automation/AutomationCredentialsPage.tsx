import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  ClubSelect,
  DemoNote,
  ErrorBanner,
  Tabs,
  ProgressBar,
  timeText,
  useClubOptions,
  type AutomationCredentialItem,
  type AutomationIPItem,
  type AutomationPageProps,
} from "./shared";

export default function AutomationCredentialsPage({ can, notify }: AutomationPageProps) {
  const clubs = useClubOptions();
  const [tab, setTab] = useState("credentials");
  const [credentials, setCredentials] = useState<AutomationCredentialItem[] | null>(null);
  const [ips, setIps] = useState<AutomationIPItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AutomationCredentialItem | null>(null);
  const [resetting, setResetting] = useState<AutomationCredentialItem | null>(null);
  const [ipForm, setIpForm] = useState<AutomationIPItem | null | undefined>(undefined);

  const loadCredentials = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: AutomationCredentialItem[] }>(`/api/automation/credentials?keyword=${encodeURIComponent(query)}&status=${status}`);
      setCredentials(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "凭据加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, status, notify]);

  const loadIps = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api<{ items: AutomationIPItem[] }>("/api/automation/ip-pool");
      setIps(response.items);
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "IP 池加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (tab === "credentials") void loadCredentials();
    else void loadIps();
  }, [tab, loadCredentials, loadIps]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="CREDENTIAL & EGRESS"
      title="账号与 IP"
      description="维护游戏账号凭据状态和出口 IP 池；密码只用于导入或重置，后台不会保存明文，也不会在接口中回显。"
      actions={<div className="automation-header-actions">
        {tab === "credentials" && can("automation.credential.manage") && <Button onClick={() => setCreating(true)}>导入凭据</Button>}
        {tab === "ips" && can("automation.credential.manage") && <Button onClick={() => setIpForm(null)}>新增出口 IP</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void (tab === "credentials" ? loadCredentials() : loadIps())}>{loading ? "正在刷新…" : "刷新"}</Button>
      </div>}
    />

    <DemoNote>演示环境只记录凭据状态和密码是否已配置，不会保存真实密码；正式环境由独立密钥服务托管。</DemoNote>

    <section className="panel">
      <div className="automation-panel-head">
        <Tabs value={tab} onChange={(value) => { setTab(value); setError(""); }} items={[
          { key: "credentials", label: "游戏凭据", count: credentials?.length },
          { key: "ips", label: "出口 IP 池", count: ips?.length },
        ]} />
        {tab === "credentials" && <div className="automation-filter-row">
          <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(keyword.trim()); }}>
            <span>⌕</span>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索游戏账号" />
            <button>搜索</button>
          </form>
          <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="configured">已配置</option><option value="missing">未配置</option><option value="locked">已锁定</option><option value="disabled">已停用</option></select></label>
        </div>}
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}

      {tab === "credentials" && (!credentials && loading ? <LoadingBlock label="正在读取游戏凭据" /> : !credentials || credentials.length === 0 ? <EmptyState title="没有匹配的凭据" description="导入游戏账号后，机器人才能登录并进房。" /> : <div className="table-wrap">
        <table className="automation-table">
          <thead><tr><th>游戏账号</th><th>俱乐部</th><th>状态</th><th>密码</th><th>最近登录</th><th>失败次数</th><th>备注</th><th>更新</th><th>操作</th></tr></thead>
          <tbody>{credentials.map((item) => <tr key={item.id}>
            <td><strong>{item.account}</strong><small className="cell-subtitle">#{item.id}</small></td>
            <td>{item.clubName || "—"}<small className="cell-subtitle">{item.clubId}</small></td>
            <td><AutomationBadge value={item.status} /></td>
            <td>{item.secretConfigured ? "已配置" : "缺失"}</td>
            <td>{timeText(item.lastLogin)}</td>
            <td><span className={item.failCount >= 3 ? "automation-warn-text" : ""}>{item.failCount}</span></td>
            <td>{item.remark || "—"}</td>
            <td>{timeText(item.updatedAt)}</td>
            <td><div className="row-actions">
              {can("automation.credential.manage") && <button type="button" onClick={() => setEditing(item)}>编辑</button>}
              {can("automation.credential.manage") && <button type="button" onClick={() => setResetting(item)}>重置密码</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>)}

      {tab === "ips" && (!ips && loading ? <LoadingBlock label="正在读取出口 IP 池" /> : !ips || ips.length === 0 ? <EmptyState title="还没有出口 IP" description="加入出口 IP 后，终端可以绑定固定出口，降低同 IP 风控。" /> : <div className="table-wrap">
        <table className="automation-table">
          <thead><tr><th>出口 IP</th><th>地区</th><th>绑定情况</th><th>健康状态</th><th>封禁次数</th><th>备注</th><th>更新</th><th>操作</th></tr></thead>
          <tbody>{ips.map((item) => <tr key={item.id}>
            <td><strong>{item.ip}</strong><small className="cell-subtitle">#{item.id}</small></td>
            <td>{item.region || "—"}</td>
            <td><ProgressBar value={item.boundCount} max={Math.max(item.maxCount, 1)} danger={item.boundCount >= item.maxCount} hideValue /><small className="cell-subtitle">{item.boundCount} / {item.maxCount} 台终端</small></td>
            <td><AutomationBadge value={item.health} /></td>
            <td className={item.bannedCount > 0 ? "automation-warn-text" : ""}>{item.bannedCount}</td>
            <td>{item.remark || "—"}</td>
            <td>{timeText(item.updatedAt)}</td>
            <td><div className="row-actions">{can("automation.credential.manage") && <button type="button" onClick={() => setIpForm(item)}>配置</button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>)}
    </section>

    {creating && <CredentialCreateModal clubs={clubs} onClose={() => setCreating(false)} onSaved={(message) => { setCreating(false); notify(message); void loadCredentials(true); }} />}
    {editing && <CredentialEditModal item={editing} clubs={clubs} onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); notify(message); void loadCredentials(true); }} />}
    {resetting && <CredentialResetModal item={resetting} onClose={() => setResetting(null)} onSaved={(message) => { setResetting(null); notify(message); void loadCredentials(true); }} />}
    {ipForm !== undefined && <IPFormModal item={ipForm} onClose={() => setIpForm(undefined)} onSaved={(message) => { setIpForm(undefined); notify(message); void loadIps(true); }} />}
  </div>;
}

function CredentialCreateModal({ clubs, onClose, onSaved }: { clubs: ReturnType<typeof useClubOptions>; onClose: () => void; onSaved: (message: string) => void }) {
  const [account, setAccount] = useState("");
  const [clubId, setClubId] = useState("");
  const [password, setPassword] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/automation/credentials", { method: "POST", ...jsonBody({ account, clubId, password, remark }) });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "导入凭据失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="导入游戏凭据" eyebrow="NEW CREDENTIAL" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="游戏账号" hint="4–64 个字符，同一账号只能导入一次"><input value={account} onChange={(event) => setAccount(event.target.value)} /></Field>
      <Field label="所属俱乐部"><ClubSelect clubs={clubs} value={clubId} includeAll={false} onChange={setClubId} /></Field>
      <Field label="初始密码" hint="4–64 个字符；提交后立即丢弃，不会保存或回显"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <Field label="备注" hint="最多 120 个字符"><input value={remark} maxLength={120} onChange={(event) => setRemark(event.target.value)} /></Field>
      <div className="automation-form-note">正式环境应由凭据服务加密保存；后台审计只记录账号和俱乐部，不记录密码。</div>
      <FormActions onCancel={onClose} busy={busy} submitText="导入凭据" />
    </form>
  </Modal>;
}

function CredentialEditModal({ item, clubs, onClose, onSaved }: { item: AutomationCredentialItem; clubs: ReturnType<typeof useClubOptions>; onClose: () => void; onSaved: (message: string) => void }) {
  const [clubId, setClubId] = useState(item.clubId);
  const [status, setStatus] = useState(item.status);
  const [remark, setRemark] = useState(item.remark);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/credentials/${item.id}`, { method: "PUT", ...jsonBody({ clubId, status, remark }) });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存凭据失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`编辑 ${item.account}`} eyebrow="CREDENTIAL" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="所属俱乐部"><ClubSelect clubs={clubs} value={clubId} includeAll={false} onChange={setClubId} /></Field>
      <Field label="凭据状态"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="configured">已配置</option><option value="missing">未配置</option><option value="locked">已锁定</option><option value="disabled">已停用</option></select></Field>
      <Field label="备注"><input value={remark} maxLength={120} onChange={(event) => setRemark(event.target.value)} /></Field>
      <FormActions onCancel={onClose} busy={busy} submitText="保存凭据资料" />
    </form>
  </Modal>;
}

function CredentialResetModal({ item, onClose, onSaved }: { item: AutomationCredentialItem; onClose: () => void; onSaved: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/credentials/${item.id}/reset`, { method: "POST", ...jsonBody({ password }) });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "重置密码失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`重置 ${item.account}`} eyebrow="RESET CREDENTIAL" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <div className="operation-warning"><strong>重置后账号立即可重新登录</strong><p>密码只在本次请求中使用，后台不会保存或回显。演示环境只会把凭据状态恢复为已配置并清零失败次数。</p></div>
      <Field label="新密码" hint="4–64 个字符"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <FormActions onCancel={onClose} busy={busy} submitText="确认重置" />
    </form>
  </Modal>;
}

function IPFormModal({ item, onClose, onSaved }: { item: AutomationIPItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [ip, setIp] = useState(item?.ip ?? "");
  const [region, setRegion] = useState(item?.region ?? "");
  const [maxCount, setMaxCount] = useState(String(item?.maxCount ?? 4));
  const [health, setHealth] = useState(item?.health ?? "healthy");
  const [remark, setRemark] = useState(item?.remark ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(item ? `/api/automation/ip-pool/${item.id}` : "/api/automation/ip-pool", {
        method: item ? "PUT" : "POST",
        ...jsonBody(item ? { region, maxCount: Number(maxCount), health, remark } : { ip, region, maxCount: Number(maxCount), remark }),
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "保存出口 IP 失败");
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={item ? `配置 ${item.ip}` : "新增出口 IP"} eyebrow="EGRESS IP" onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="出口 IP" hint={item ? "IP 创建后不可修改" : "IPv4 或 IPv6 地址"}><input value={ip} disabled={Boolean(item)} onChange={(event) => setIp(event.target.value)} placeholder="58.20.11.34" /></Field>
      <Field label="地区" hint="例如 长沙电信"><input value={region} onChange={(event) => setRegion(event.target.value)} /></Field>
      <Field label="单 IP 终端上限" hint="1–64"><input type="number" min={1} max={64} value={maxCount} onChange={(event) => setMaxCount(event.target.value)} /></Field>
      {item && <Field label="健康状态"><select value={health} onChange={(event) => setHealth(event.target.value)}><option value="healthy">正常</option><option value="risk">风险</option><option value="banned">已停用</option></select></Field>}
      <Field label="备注"><input value={remark} maxLength={120} onChange={(event) => setRemark(event.target.value)} /></Field>
      <div className="automation-form-note">同一 IP 绑定的终端越多，越容易触发游戏侧同 IP 限制；建议保留余量并定期轮换。</div>
      <FormActions onCancel={onClose} busy={busy} submitText={item ? "保存 IP 配置" : "加入 IP 池"} />
    </form>
  </Modal>;
}
