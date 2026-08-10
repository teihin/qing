import type { ReactNode } from "react";
import type { ModuleItem, SessionData } from "../types";

const iconText: Record<string, string> = {
  dashboard: "◈",
  users: "人",
  roles: "权",
  modules: "模",
  audit: "录",
  system: "◇",
  game: "游",
  players: "玩",
  agents: "代",
  transactions: "账",
  "room-records": "绩",
  bans: "封",
  "anti-theft": "盾",
  "room-maintenance": "房",
  "player-optimization": "优",
  configuration: "配",
  announcement: "公",
  notifications: "通",
  "reward-pools": "池",
  payments: "支",
  activities: "活",
};

export default function Layout({ session, route, onNavigate, onChangePassword, onLogout, children }: {
  session: SessionData;
  route: string;
  onNavigate: (route: string) => void;
  onChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const roots = session.modules.filter((item) => item.parentId === null);
  const childrenOf = (id: number) => session.modules.filter((item) => item.parentId === id);
  const renderLink = (item: ModuleItem) => item.route ? (
    <button key={item.id} className={`nav-link ${route === item.route ? "is-active" : ""}`} onClick={() => onNavigate(item.route)}>
      <span className="nav-link__icon">{iconText[item.icon] ?? "·"}</span>
      <span>{item.name}</span>
      {route === item.route && <i className="nav-link__indicator" />}
    </button>
  ) : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark"><i>X</i></span>
          <div><strong>XuanManager</strong><small>运营管理中枢</small></div>
        </div>
        <div className="sidebar__line" />
        <nav className="navigation" aria-label="主菜单">
          {roots.map((root) => {
            const children = childrenOf(root.id);
            if (children.length === 0) return renderLink(root);
            return (
              <section className="nav-group" key={root.id}>
                <p><span>{iconText[root.icon] ?? "◇"}</span>{root.name}</p>
                {children.map(renderLink)}
              </section>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <span className="security-dot" />
          <div><strong>安全连接</strong><small>权限实时校验中</small></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar__breadcrumb"><span>XuanManager</span><i>/</i><strong>{session.modules.find((item) => item.route === route)?.name ?? "工作台"}</strong></div>
          <div className="account-menu">
            <span className="account-menu__avatar">{session.user.displayName.slice(0, 1) || "管"}</span>
            <div><strong>{session.user.displayName}</strong><small>{session.user.roleName}</small></div>
            <button type="button" onClick={onChangePassword}>改密</button>
            <button type="button" onClick={onLogout}>退出</button>
          </div>
        </header>
        <div className="content-area">{children}</div>
      </main>
    </div>
  );
}
