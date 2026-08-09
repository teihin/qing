import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { EmptyState, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { AuditItem } from "../types";

interface DashboardData {
  userCount: number;
  enabledUserCount: number;
  roleCount: number;
  moduleCount: number;
  todayAuditCount: number;
  recentAudits: AuditItem[];
}

const actionNames: Record<string, string> = {
  "auth.login": "登录后台",
  "auth.logout": "退出后台",
  "auth.login.failed": "登录失败",
  "user.create": "创建后台用户",
  "user.update": "编辑后台用户",
  "user.status": "修改用户状态",
  "user.reset_password": "重置用户密码",
  "role.create": "创建角色",
  "role.update": "编辑角色",
  "role.assign_permissions": "配置角色权限",
  "module.create": "创建功能模块",
  "module.update": "编辑功能模块",
  "permission.create": "创建操作权限",
  "permission.update": "编辑操作权限",
  "game.announcement.update": "修改游戏公告",
  "game.notification.send": "发送全服通知",
  "game.reward_pool.update": "修改各皮池奖池",
};

export default function DashboardPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api<DashboardData>("/api/dashboard/summary")
      .then(setData)
      .catch((reason) => notify(reason instanceof ApiError ? reason.message : "工作台加载失败", "error"));
  }, [notify]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="OVERVIEW" title="运营工作台" description="后台用户、角色和权限体系的实时概览。" />
      {!data ? <LoadingBlock /> : (
        <>
          <section className="metric-grid">
            <Metric icon="人" label="后台用户" value={data.userCount} note={`${data.enabledUserCount} 个账号正常启用`} tone="cyan" />
            <Metric icon="权" label="有效角色" value={data.roleCount} note="角色权限由服务端实时校验" tone="blue" />
            <Metric icon="模" label="功能模块" value={data.moduleCount} note="菜单与操作权限独立控制" tone="green" />
            <Metric icon="录" label="今日操作" value={data.todayAuditCount} note="关键管理行为完整留痕" tone="gold" />
          </section>
          <section className="dashboard-grid">
            <div className="panel panel--large">
              <header className="panel__header"><div><span className="eyebrow">ACTIVITY</span><h2>最近操作</h2></div><span className="live-label"><i />实时记录</span></header>
              {data.recentAudits.length === 0 ? <EmptyState title="暂无操作记录" description="完成首个管理操作后，审计记录会显示在这里。" /> : (
                <div className="activity-list">
                  {data.recentAudits.map((item) => (
                    <article key={item.id} className="activity-item">
                      <span className={`activity-item__mark ${item.resultCode === 0 ? "is-success" : "is-error"}`}>{item.resultCode === 0 ? "✓" : "!"}</span>
                      <div><strong>{actionNames[item.action] ?? item.action}</strong><p>{item.operatorName || "系统"} · {item.resultMessage || "操作完成"}</p></div>
                      <time>{formatDate(item.createdAt)}</time>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <aside className="panel security-panel">
              <span className="security-panel__halo">◇</span>
              <span className="eyebrow">SECURITY STATUS</span>
              <h2>权限系统运行正常</h2>
              <p>前端菜单只负责减少干扰，所有真实数据和操作仍由后端重新鉴权。</p>
              <div className="security-list">
                <span><i>✓</i>密码使用强摘要存储</span>
                <span><i>✓</i>会话与跨站请求双校验</span>
                <span><i>✓</i>超级管理员防降权保护</span>
              </div>
            </aside>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: string; label: string; value: number; note: string; tone: string }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top"><span className="metric-card__icon">{icon}</span><i className="metric-card__trend">↗</i></div>
      <p>{label}</p><strong>{value.toLocaleString("zh-CN")}</strong><small>{note}</small>
    </article>
  );
}
