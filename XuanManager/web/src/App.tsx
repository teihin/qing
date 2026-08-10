import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import Layout from "./components/Layout";
import { Field, FormActions, LoadingBlock, Modal, submitGuard, Toast } from "./components/ui";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import ModulesPage from "./pages/ModulesPage";
import AgentsPage from "./pages/AgentsPage";
import PlayersPage from "./pages/PlayersPage";
import TransactionsPage from "./pages/TransactionsPage";
import RoomRecordsPage from "./pages/RoomRecordsPage";
import GameAnnouncementPage from "./pages/GameAnnouncementPage";
import GameNotificationsPage from "./pages/GameNotificationsPage";
import RewardPoolsPage from "./pages/RewardPoolsPage";
import BansPage from "./pages/BansPage";
import RoomMaintenancePage from "./pages/RoomMaintenancePage";
import PaymentConfigurationPage from "./pages/PaymentConfigurationPage";
import ActivityConfigurationPage from "./pages/ActivityConfigurationPage";
import PlayerOptimizationPage from "./pages/PlayerOptimizationPage";
import RolesPage from "./pages/RolesPage";
import UsersPage from "./pages/UsersPage";
import type { SessionData } from "./types";

type Notice = { message: string; kind: "success" | "error" } | null;

function routeFromHash() {
  const route = window.location.hash.replace(/^#/, "").split("?")[0];
  return route.startsWith("/") ? route : "/dashboard";
}

export default function App() {
  const [session, setSession] = useState<SessionData | null | undefined>(undefined);
  const [route, setRoute] = useState(routeFromHash);
  const [notice, setNotice] = useState<Notice>(null);
  const [changePassword, setChangePassword] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api<SessionData>("/api/auth/me"));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setSession(null);
      else setSession(null);
    }
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!session) return;
    const allowed = session.modules.some((item) => item.route === route);
    if (!allowed) {
      const fallback = session.modules.find((item) => item.route)?.route;
      if (fallback) {
        window.location.hash = fallback;
        setRoute(fallback);
      }
    }
  }, [session, route]);

  const can = useCallback((permission: string) => Boolean(session?.user.isSuper || session?.permissions.includes(permission)), [session]);
  const notify = useCallback((message: string, kind: "success" | "error" = "success") => setNotice({ message, kind }), []);
  const navigate = (next: string) => {
    window.location.hash = next;
    setRoute(next);
  };
  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* session is cleared locally regardless */ }
    setSession(null);
  };

  const page = useMemo(() => {
    const props = { can, notify };
    if (route === "/game/players" && can("game.player.view")) return <PlayersPage can={can} notify={notify} />;
    if (route === "/game/agents" && can("game.agent.view")) return <AgentsPage notify={notify} />;
    if (route === "/game/transactions" && can("game.transaction.view")) return <TransactionsPage notify={notify} />;
    if (route === "/game/room-records" && can("game.room_record.view")) return <RoomRecordsPage notify={notify} />;
    if (route === "/game/bans" && can("game.ban.view")) return <BansPage can={can} notify={notify} />;
    if (route === "/game/room-maintenance" && can("game.room_maintenance.view")) return <RoomMaintenancePage can={can} notify={notify} />;
    if (route === "/game/player-optimization" && can("game.player_optimization.view")) return <PlayerOptimizationPage can={can} isSuper={Boolean(session?.user.isSuper)} notify={notify} />;
    if (route === "/configuration/announcement" && can("configuration.announcement.view")) return <GameAnnouncementPage can={can} notify={notify} />;
    if (route === "/configuration/notifications" && can("configuration.notification.view")) return <GameNotificationsPage can={can} notify={notify} />;
    if (route === "/configuration/reward-pools" && can("configuration.reward_pool.view")) return <RewardPoolsPage can={can} notify={notify} />;
    if (route === "/configuration/payments" && can("configuration.payment.view")) return <PaymentConfigurationPage can={can} notify={notify} />;
    if (route === "/configuration/activities" && can("configuration.activity.view")) return <ActivityConfigurationPage can={can} notify={notify} />;
    if (route === "/users" && can("user.view")) return <UsersPage {...props} />;
    if (route === "/roles" && can("role.view")) return <RolesPage {...props} />;
    if (route === "/modules" && can("module.view")) return <ModulesPage {...props} />;
    if (route === "/audit" && can("audit.view")) return <AuditPage notify={notify} />;
    if (can("dashboard.view")) return <DashboardPage notify={notify} />;
    return <div className="panel"><LoadingBlock label="当前角色没有可访问的功能模块" /></div>;
  }, [route, can, notify, session]);

  if (session === undefined) return <div className="boot-screen"><span className="brand__mark brand__mark--large"><i>X</i></span><LoadingBlock label="正在建立安全会话" /></div>;
  if (session === null) return <LoginPage onSuccess={refreshSession} />;

  return (
    <>
      <Layout session={session} route={route} onNavigate={navigate} onChangePassword={() => setChangePassword(true)} onLogout={logout}>{page}</Layout>
      {changePassword && <ChangePasswordModal onClose={() => setChangePassword(false)} onSaved={(message) => { setChangePassword(false); notify(message); }} />}
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </>
  );
}

function ChangePasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (newPassword !== confirmPassword) { setError("两次输入的新密码不一致"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>("/api/auth/password", { method: "PUT", ...jsonBody({ currentPassword, newPassword }) });
      onSaved(result.message);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "修改密码失败"); } finally { setBusy(false); }
  };
  return <Modal title="修改登录密码" eyebrow="ACCOUNT SECURITY" onClose={onClose}><form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>{error && <div className="form-error"><span>!</span>{error}</div>}<Field label="当前密码"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field label="新密码" hint="至少 8 位，包含数字、特殊字符，并建议包含字母"><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field><Field label="确认新密码"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field><FormActions onCancel={onClose} busy={busy} submitText="修改密码" /></form></Modal>;
}
