import { useEffect, useRef, useState, type ReactNode } from "react";
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
  "transaction-blacklist": "禁",
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const roots = session.modules.filter((item) => item.parentId === null);
  const childrenOf = (id: number) => session.modules.filter((item) => item.parentId === id);

  useEffect(() => {
    setMobileMenuOpen(false);
    const frame = window.requestAnimationFrame(() => {
      const activeLink = Array.from(navigationRef.current?.querySelectorAll<HTMLButtonElement>("[data-route]") ?? [])
        .find((item) => item.dataset.route === route);
      activeLink?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const originalOverflow = document.body.style.overflow;
    const mobileViewport = window.matchMedia("(max-width: 620px)");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const closeOutsideMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    mobileViewport.addEventListener("change", closeOutsideMobile);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      mobileViewport.removeEventListener("change", closeOutsideMobile);
    };
  }, [mobileMenuOpen]);

  const navigate = (nextRoute: string) => {
    setMobileMenuOpen(false);
    onNavigate(nextRoute);
  };

  const renderLink = (item: ModuleItem) => item.route ? (
    <button
      key={item.id}
      type="button"
      className={`nav-link ${route === item.route ? "is-active" : ""}`}
      data-route={item.route}
      aria-current={route === item.route ? "page" : undefined}
      onClick={() => navigate(item.route)}
    >
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
        <nav className="navigation" ref={navigationRef} aria-label="主菜单">
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
        <button
          className={`mobile-menu-trigger ${mobileMenuOpen ? "is-open" : ""}`}
          type="button"
          aria-label="打开全部菜单"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-all-menu"
          onClick={() => setMobileMenuOpen(true)}
        >
          <span aria-hidden="true"><i /><i /><i /></span>
          <strong>全部</strong>
        </button>
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
      {mobileMenuOpen && (
        <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}>
          <section
            id="mobile-all-menu"
            className="mobile-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="全部功能菜单"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mobile-menu-sheet__header">
              <div>
                <span>功能导航</span>
                <strong>全部菜单</strong>
              </div>
              <button type="button" aria-label="关闭全部菜单" onClick={() => setMobileMenuOpen(false)}>×</button>
            </header>
            <div className="mobile-menu-sheet__content">
              {roots.map((root) => {
                const childModules = childrenOf(root.id);
                const items = childModules.length > 0 ? childModules : root.route ? [root] : [];
                if (items.length === 0) return null;
                return (
                  <section className="mobile-menu-section" key={root.id}>
                    <h3><span>{iconText[root.icon] ?? "◇"}</span>{childModules.length > 0 ? root.name : "常用功能"}</h3>
                    <div>
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={route === item.route ? "is-active" : ""}
                          aria-current={route === item.route ? "page" : undefined}
                          onClick={() => item.route && navigate(item.route)}
                        >
                          <span>{iconText[item.icon] ?? "·"}</span>
                          <strong>{item.name}</strong>
                          {route === item.route && <i>当前</i>}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="mobile-menu-sheet__safe-area" />
          </section>
        </div>
      )}
    </div>
  );
}
