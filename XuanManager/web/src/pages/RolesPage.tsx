import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader, StatusPill, submitGuard } from "../components/ui";
import type { PermissionItem, RoleItem } from "../types";

type RoleModal = { type: "create" } | { type: "edit"; role: RoleItem } | null;

export default function RolesPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [roles, setRoles] = useState<RoleItem[] | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [modal, setModal] = useState<RoleModal>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roleData, permissionData] = await Promise.all([
        api<{ items: RoleItem[] }>("/api/roles"),
        api<{ items: PermissionItem[] }>("/api/role-permissions"),
      ]);
      setRoles(roleData.items);
      setPermissions(permissionData.items);
      setSelectedId((current) => current && roleData.items.some((item) => item.id === current) ? current : roleData.items[0]?.id ?? null);
    } catch (reason) { notify(errorMessage(reason), "error"); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  const selected = roles?.find((role) => role.id === selectedId);
  useEffect(() => { setSelectedPermissions(selected?.permissionIds ?? []); }, [selected]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const permission of permissions) {
      const list = map.get(permission.moduleName) ?? [];
      list.push(permission); map.set(permission.moduleName, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  const toggle = (id: number) => setSelectedPermissions((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const savePermissions = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/roles/${selected.id}/permissions`, { method: "PUT", ...jsonBody({ permissionIds: selectedPermissions }) });
      notify("角色权限已保存，相关用户需要重新登录"); await load();
    } catch (reason) { notify(errorMessage(reason), "error"); } finally { setSaving(false); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="ROLE BASED ACCESS" title="角色与权限" description="为每个角色组合可见模块和允许执行的具体操作。" actions={can("role.create") ? <Button onClick={() => setModal({ type: "create" })}><span>＋</span>创建角色</Button> : undefined} />
      {!roles ? <LoadingBlock /> : roles.length === 0 ? <EmptyState title="暂无角色" description="创建首个业务角色后即可配置权限。" /> : (
        <section className="role-layout">
          <aside className="panel role-list">
            <header className="panel__header"><div><span className="eyebrow">ROLES</span><h2>角色列表</h2></div><span>{roles.length}</span></header>
            <div className="role-list__items">
              {roles.map((role) => <button key={role.id} className={role.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(role.id)}><span className="role-avatar">{role.name.slice(0, 1)}</span><div><strong>{role.name}</strong><small>{role.userCount} 个用户 · {role.permissionIds.length} 项权限</small></div><i>›</i></button>)}
            </div>
          </aside>
          {selected && <div className="panel permission-panel">
            <header className="permission-panel__header"><div><div className="permission-panel__title"><h2>{selected.name}</h2><StatusPill status={selected.status} superAdmin={selected.isSystem} /></div><p>{selected.description || "尚未填写角色说明"}</p><code>{selected.code}</code></div>{can("role.update") && !selected.isSystem && <Button variant="secondary" onClick={() => setModal({ type: "edit", role: selected })}>编辑角色</Button>}</header>
            <div className="permission-panel__bar"><div><strong>权限配置</strong><span>选中后，该角色的用户才能访问或执行对应功能。</span></div><span>{selected.isSystem ? permissions.length : selectedPermissions.length} / {permissions.length}</span></div>
            <div className="permission-groups">
              {groups.map(([moduleName, items]) => <section key={moduleName} className="permission-group"><header><span>{moduleName.slice(0, 1)}</span><div><strong>{moduleName}</strong><small>{items.length} 项操作权限</small></div></header><div className="permission-options">
                {items.map((permission) => { const checked = selected.isSystem || selectedPermissions.includes(permission.id); return <label key={permission.id} className={checked ? "is-checked" : ""}><input type="checkbox" checked={checked} disabled={selected.isSystem || !can("role.assign_permissions")} onChange={() => toggle(permission.id)} /><span className="fake-check">✓</span><div><strong>{permission.name}</strong><small>{permission.description || permission.code}</small></div></label>; })}
              </div></section>)}
            </div>
            {can("role.assign_permissions") && !selected.isSystem && <footer className="permission-panel__footer"><span>权限变更后，该角色用户的旧会话会退出。</span><Button onClick={() => void savePermissions()} disabled={saving}>{saving ? "正在保存…" : "保存权限配置"}</Button></footer>}
          </div>}
        </section>
      )}
      {modal && <RoleForm role={modal.type === "edit" ? modal.role : undefined} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
    </div>
  );
}

function RoleForm({ role, onClose, onSaved }: { role?: RoleItem; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(role?.code ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [status, setStatus] = useState(role?.status ?? "enabled");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const payload = { code, name, description, status };
      if (role) await api(`/api/roles/${role.id}`, { method: "PUT", ...jsonBody(payload) });
      else await api("/api/roles", { method: "POST", ...jsonBody(payload) });
      await onSaved(role ? "角色资料已更新" : "角色创建成功");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <Modal title={role ? "编辑角色" : "创建角色"} eyebrow="ROLE PROFILE" onClose={onClose}><form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>{error && <div className="form-error"><span>!</span>{error}</div>}<Field label="角色编码" hint="创建后不可修改，例如 finance_admin"><input disabled={Boolean(role)} value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="角色名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="角色说明"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="角色状态"><select value={status} onChange={(event) => setStatus(event.target.value as "enabled" | "disabled")}><option value="enabled">启用</option><option value="disabled">停用</option></select></Field><FormActions onCancel={onClose} busy={busy} submitText={role ? "保存修改" : "创建角色"} /></form></Modal>;
}

function errorMessage(reason: unknown) { return reason instanceof ApiError ? reason.message : "操作失败，请稍后重试"; }
