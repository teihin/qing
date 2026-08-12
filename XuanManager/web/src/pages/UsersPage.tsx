import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, FormActions, formatDate, LoadingBlock, Modal, PageHeader, StatusPill, submitGuard } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import type { RoleItem, UserItem } from "../types";

interface UserResponse { items: UserItem[]; total: number; page: number; pageSize: number }
type ModalState = { type: "create" } | { type: "edit"; user: UserItem } | { type: "password"; user: UserItem } | null;

export default function UsersPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<UserResponse | null>(null);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    try {
      const [users, roleData] = await Promise.all([
        api<UserResponse>(`/api/users?keyword=${encodeURIComponent(query)}&page=1&pageSize=50`),
        api<{ items: RoleItem[] }>("/api/users/role-options"),
      ]);
      setData(users);
      setRoles(roleData.items);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "用户列表加载失败", "error");
    }
  }, [query, queryRevision, notify]);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (user: UserItem) => {
    const next = user.status === "enabled" ? "disabled" : "enabled";
    if (next === "disabled" && !window.confirm(`确定停用后台用户“${user.displayName}”吗？其登录会话会立即失效。`)) return;
    try {
      await api(`/api/users/${user.id}/status`, { method: "PUT", ...jsonBody({ status: next }) });
      notify(next === "enabled" ? "用户已启用" : "用户已停用");
      await load();
    } catch (reason) { notify(errorMessage(reason), "error"); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ADMIN ACCOUNTS" title="后台用户管理" description="这些账号只用于 XuanManager，不是游戏玩家账号。" actions={can("user.create") ? <Button onClick={() => setModal({ type: "create" })}><span>＋</span>创建用户</Button> : undefined} />
      <section className="panel">
        <div className="toolbar">
          <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(keyword.trim()); refreshQuery(); }}><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索后台账号或显示名称" /><button>搜索</button></form>
          <span className="toolbar__count">共 {data?.total ?? 0} 个后台用户</span>
        </div>
        {!data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="没有找到后台用户" description="调整搜索条件，或创建一个新的后台账号。" /> : (
          <div className="table-wrap"><table><thead><tr><th>用户</th><th>账号</th><th>角色</th><th>状态</th><th>最近登录</th><th>创建时间</th><th className="align-right">操作</th></tr></thead><tbody>
            {data.items.map((user) => (
              <tr key={user.id}>
                <td><div className="user-cell"><span>{user.displayName.slice(0, 1) || "管"}</span><div><strong>{user.displayName}</strong>{user.isSuper && <small>系统最高权限账号</small>}</div></div></td>
                <td><code>{user.username}</code></td><td>{user.roleName}</td><td><StatusPill status={user.status} superAdmin={user.isSuper} /></td><td>{formatDate(user.lastLoginAt)}</td><td>{formatDate(user.createdAt)}</td>
                <td><div className="row-actions">
                  {can("user.update") && <button onClick={() => setModal({ type: "edit", user })}>编辑</button>}
                  {can("user.reset_password") && !user.isSuper && <button onClick={() => setModal({ type: "password", user })}>重置密码</button>}
                  {can("user.status") && !user.isSuper && <button className={user.status === "enabled" ? "danger-link" : "success-link"} onClick={() => void setStatus(user)}>{user.status === "enabled" ? "停用" : "启用"}</button>}
                </div></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
      {modal?.type === "create" && <UserForm roles={roles} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
      {modal?.type === "edit" && <UserForm roles={roles} user={modal.user} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
      {modal?.type === "password" && <PasswordForm user={modal.user} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
    </div>
  );
}

function UserForm({ roles, user, onClose, onSaved }: { roles: RoleItem[]; user?: UserItem; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(user?.roleId ?? roles.find((role) => role.status === "enabled" && !role.isSystem)?.id ?? roles[0]?.id ?? 0);
  const [status, setStatus] = useState<"enabled" | "disabled">("enabled");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (user) await api(`/api/users/${user.id}`, { method: "PUT", ...jsonBody({ displayName, roleId }) });
      else await api("/api/users", { method: "POST", ...jsonBody({ username, displayName, password, roleId, status }) });
      await onSaved(user ? "用户资料已更新" : "后台用户创建成功");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return (
    <Modal title={user ? "编辑后台用户" : "创建后台用户"} eyebrow="ADMIN ACCOUNT" onClose={onClose}>
      <form className="form-grid" onSubmit={submitGuard(submit)}>
        {error && <div className="form-error form-grid__full"><span>!</span>{error}</div>}
        <Field label="后台账号" hint={user ? "账号创建后不可修改" : "4-32 位字母、数字、点、下划线或短横线"}><input disabled={Boolean(user)} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如 ops_manager" /></Field>
        <Field label="显示名称"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 运营管理员" /></Field>
        {!user && <Field label="初始密码" hint="至少 6 位，不限制字符组合"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="设置初始密码" /></Field>}
        <Field label="所属角色"><select value={roleId} onChange={(event) => setRoleId(Number(event.target.value))}>{roles.filter((role) => role.status === "enabled").map((role) => <option key={role.id} value={role.id}>{role.name}{role.isSystem ? "（系统）" : ""}</option>)}</select></Field>
        {!user && <Field label="账号状态"><select value={status} onChange={(event) => setStatus(event.target.value as "enabled" | "disabled")}><option value="enabled">立即启用</option><option value="disabled">暂不启用</option></select></Field>}
        <div className="form-grid__full"><FormActions onCancel={onClose} busy={busy} submitText={user ? "保存修改" : "创建用户"} /></div>
      </form>
    </Modal>
  );
}

function PasswordForm({ user, onClose, onSaved }: { user: UserItem; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/users/${user.id}/password`, { method: "PUT", ...jsonBody({ password }) });
      await onSaved("密码已重置，用户旧会话已全部退出");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`重置 ${user.displayName} 的密码`} eyebrow="RESET PASSWORD" onClose={onClose}>
      <form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>
        {error && <div className="form-error"><span>!</span>{error}</div>}
        <div className="info-banner">重置后，该用户当前的所有登录会话会立即失效。</div>
        <Field label="新密码" hint="至少 6 位，不限制字符组合"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <Field label="确认新密码"><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
        <FormActions onCancel={onClose} busy={busy} submitText="确认重置" />
      </form>
    </Modal>
  );
}

function errorMessage(reason: unknown) { return reason instanceof ApiError ? reason.message : "操作失败，请稍后重试"; }
