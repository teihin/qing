import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader, StatusPill, submitGuard } from "../components/ui";
import type { ModuleItem, PermissionItem } from "../types";

type Tab = "modules" | "permissions";
type EditModal = { type: "module"; item?: ModuleItem } | { type: "permission"; item?: PermissionItem } | null;

export default function ModulesPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [modules, setModules] = useState<ModuleItem[] | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [tab, setTab] = useState<Tab>("modules");
  const [modal, setModal] = useState<EditModal>(null);
  const load = useCallback(async () => {
    try {
      const [moduleData, permissionData] = await Promise.all([api<{ items: ModuleItem[] }>("/api/modules"), api<{ items: PermissionItem[] }>("/api/permissions")]);
      setModules(moduleData.items); setPermissions(permissionData.items);
    } catch (reason) { notify(errorMessage(reason), "error"); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const action = tab === "modules"
    ? can("module.create") && <Button onClick={() => setModal({ type: "module" })}><span>＋</span>创建模块</Button>
    : can("permission.create") && <Button onClick={() => setModal({ type: "permission" })}><span>＋</span>创建操作权限</Button>;

  return (
    <div className="page-stack">
      <PageHeader eyebrow="FUNCTION REGISTRY" title="模块与权限管理" description="模块决定界面入口，操作权限决定用户在界面中能做什么。" actions={action || undefined} />
      <div className="segmented"><button className={tab === "modules" ? "is-active" : ""} onClick={() => setTab("modules")}>功能模块 <span>{modules?.length ?? 0}</span></button><button className={tab === "permissions" ? "is-active" : ""} onClick={() => setTab("permissions")}>操作权限 <span>{permissions.length}</span></button></div>
      {!modules ? <LoadingBlock /> : tab === "modules" ? (
        <section className="panel">
          {modules.length === 0 ? <EmptyState title="暂无功能模块" description="创建模块后即可配置菜单和操作权限。" /> : <div className="table-wrap"><table><thead><tr><th>模块</th><th>编码</th><th>页面路径</th><th>层级</th><th>排序</th><th>显示</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>
            {modules.map((item) => { const parent = modules.find((candidate) => candidate.id === item.parentId); return <tr key={item.id}><td><div className="module-cell"><span>{item.icon ? item.icon.slice(0, 1).toUpperCase() : "模"}</span><strong>{item.name}</strong></div></td><td><code>{item.code}</code></td><td>{item.route || <span className="muted">目录节点</span>}</td><td>{parent?.name ?? "一级模块"}</td><td>{item.sortOrder}</td><td>{item.visible ? "显示" : "隐藏"}</td><td><StatusPill status={item.status} /></td><td><div className="row-actions">{can("module.update") && <button onClick={() => setModal({ type: "module", item })}>编辑</button>}</div></td></tr>; })}
          </tbody></table></div>}
        </section>
      ) : (
        <section className="panel">
          {permissions.length === 0 ? <EmptyState title="暂无操作权限" description="为功能模块创建查看、创建、编辑等操作权限。" /> : <div className="table-wrap"><table><thead><tr><th>权限名称</th><th>权限编码</th><th>所属模块</th><th>操作标识</th><th>说明</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>
            {permissions.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><code>{item.code}</code></td><td>{item.moduleName}</td><td><span className="action-tag">{item.action}</span></td><td className="max-cell">{item.description || "—"}</td><td><StatusPill status={item.status} /></td><td><div className="row-actions">{can("permission.update") && <button onClick={() => setModal({ type: "permission", item })}>编辑</button>}</div></td></tr>)}
          </tbody></table></div>}
        </section>
      )}
      {modal?.type === "module" && <ModuleForm modules={modules ?? []} item={modal.item} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
      {modal?.type === "permission" && <PermissionForm modules={modules ?? []} item={modal.item} onClose={() => setModal(null)} onSaved={async (message) => { setModal(null); notify(message); await load(); }} />}
    </div>
  );
}

function ModuleForm({ modules, item, onClose, onSaved }: { modules: ModuleItem[]; item?: ModuleItem; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [code, setCode] = useState(item?.code ?? ""); const [name, setName] = useState(item?.name ?? "");
  const [parentId, setParentId] = useState<number | "">(item?.parentId ?? ""); const [route, setRoute] = useState(item?.route ?? "");
  const [icon, setIcon] = useState(item?.icon ?? "module"); const [sortOrder, setSortOrder] = useState(item?.sortOrder ?? 10);
  const [visible, setVisible] = useState(item?.visible ?? true); const [status, setStatus] = useState(item?.status ?? "enabled");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async () => { setBusy(true); setError(""); try { const payload = { parentId: parentId || null, code, name, route, icon, sortOrder, visible, status }; if (item) await api(`/api/modules/${item.id}`, { method: "PUT", ...jsonBody(payload) }); else await api("/api/modules", { method: "POST", ...jsonBody(payload) }); await onSaved(item ? "模块已更新" : "模块创建成功"); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  return <Modal title={item ? "编辑功能模块" : "创建功能模块"} eyebrow="FUNCTION MODULE" onClose={onClose}><form className="form-grid" onSubmit={submitGuard(submit)}>{error && <div className="form-error form-grid__full"><span>!</span>{error}</div>}<Field label="模块编码" hint="创建后不可修改，例如 game.players"><input disabled={Boolean(item)} value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="模块名称"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="上级模块"><select value={parentId} onChange={(event) => setParentId(event.target.value ? Number(event.target.value) : "")}><option value="">一级模块</option>{modules.filter((module) => module.id !== item?.id).map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></Field><Field label="页面路径" hint="目录节点可以留空"><input value={route} onChange={(event) => setRoute(event.target.value)} placeholder="/game-players" /></Field><Field label="图标标识"><input value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="module" /></Field><Field label="显示顺序"><input type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} /></Field><Field label="菜单显示"><select value={visible ? "yes" : "no"} onChange={(event) => setVisible(event.target.value === "yes")}><option value="yes">显示</option><option value="no">隐藏</option></select></Field><Field label="模块状态"><select value={status} onChange={(event) => setStatus(event.target.value as "enabled" | "disabled")}><option value="enabled">启用</option><option value="disabled">停用</option></select></Field><div className="form-grid__full"><FormActions onCancel={onClose} busy={busy} submitText={item ? "保存修改" : "创建模块"} /></div></form></Modal>;
}

function PermissionForm({ modules, item, onClose, onSaved }: { modules: ModuleItem[]; item?: PermissionItem; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [moduleId, setModuleId] = useState(item?.moduleId ?? modules[0]?.id ?? 0); const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? ""); const [action, setAction] = useState(item?.action ?? "view");
  const [description, setDescription] = useState(item?.description ?? ""); const [status, setStatus] = useState(item?.status ?? "enabled");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async () => { setBusy(true); setError(""); try { const payload = { moduleId, code, name, action, description, status }; if (item) await api(`/api/permissions/${item.id}`, { method: "PUT", ...jsonBody(payload) }); else await api("/api/permissions", { method: "POST", ...jsonBody(payload) }); await onSaved(item ? "操作权限已更新" : "操作权限创建成功"); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  return <Modal title={item ? "编辑操作权限" : "创建操作权限"} eyebrow="ACTION PERMISSION" onClose={onClose}><form className="form-grid" onSubmit={submitGuard(submit)}>{error && <div className="form-error form-grid__full"><span>!</span>{error}</div>}<Field label="所属模块"><select value={moduleId} onChange={(event) => setModuleId(Number(event.target.value))}>{modules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></Field><Field label="权限名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 查看玩家" /></Field><Field label="权限编码" hint="创建后不可修改，例如 game.player.view"><input disabled={Boolean(item)} value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="操作标识"><input value={action} onChange={(event) => setAction(event.target.value)} placeholder="view" /></Field><Field label="权限状态"><select value={status} onChange={(event) => setStatus(event.target.value as "enabled" | "disabled")}><option value="enabled">启用</option><option value="disabled">停用</option></select></Field><Field label="权限说明"><input value={description} onChange={(event) => setDescription(event.target.value)} /></Field><div className="form-grid__full"><FormActions onCancel={onClose} busy={busy} submitText={item ? "保存修改" : "创建权限"} /></div></form></Modal>;
}

function errorMessage(reason: unknown) { return reason instanceof ApiError ? reason.message : "操作失败，请稍后重试"; }
