import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody, SESSION_EXPIRED_EVENT } from "./api";
import Layout from "./components/Layout";
import SecuritySettingsModal from "./components/SecuritySettingsModal";
import { Button, Field, FormActions, LoadingBlock, Modal, submitGuard, Toast } from "./components/ui";
import AuditPage from "./pages/AuditPage";
import GameCallLogsPage from "./pages/GameCallLogsPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import ModulesPage from "./pages/ModulesPage";
import JackpotPerformancePage from "./pages/JackpotPerformancePage";
import ClubPerfPage from "./pages/ClubPerfPage";
import AgentRewardsPage from "./pages/AgentRewardsPage";
import AgentsPage from "./pages/AgentsPage";
import ClubsPage from "./pages/ClubsPage";
import UnionsPage from "./pages/UnionsPage";
import AgentContributionsPage from "./pages/AgentContributionsPage";
import PlayersPage from "./pages/PlayersPage";
import TransactionsPage from "./pages/TransactionsPage";
import PlatformRevenuePage from "./pages/PlatformRevenuePage";
import TransactionBlacklistPage from "./pages/TransactionBlacklistPage";
import RoomRecordsPage from "./pages/RoomRecordsPage";
import GameAnnouncementPage from "./pages/GameAnnouncementPage";
import GameNotificationsPage from "./pages/GameNotificationsPage";
import RewardPoolsPage from "./pages/RewardPoolsPage";
import BansPage from "./pages/BansPage";
import AntiTheftPage from "./pages/AntiTheftPage";
import RoomMaintenancePage from "./pages/RoomMaintenancePage";
import PaymentConfigurationPage from "./pages/PaymentConfigurationPage";
import ActivityConfigurationPage from "./pages/ActivityConfigurationPage";
import StoneConsumePricePage from "./pages/StoneConsumePricePage";
import PromotionDownloadPage from "./pages/PromotionDownloadPage";
import PlayerOptimizationPage from "./pages/PlayerOptimizationPage";
import RolesPage from "./pages/RolesPage";
import UsersPage from "./pages/UsersPage";
import AutomationOverviewPage from "./pages/automation/AutomationOverviewPage";
import AutomationDeployPage from "./pages/automation/AutomationDeployPage";
import AutomationClubsPage from "./pages/automation/AutomationClubsPage";
import AutomationRoomsPage from "./pages/automation/AutomationRoomsPage";
import AutomationRobotsPage from "./pages/automation/AutomationRobotsPage";
import AutomationGroupsPage from "./pages/automation/AutomationGroupsPage";
import AutomationTasksPage from "./pages/automation/AutomationTasksPage";
import AutomationStrategiesPage from "./pages/automation/AutomationStrategiesPage";
import AutomationSessionsPage from "./pages/automation/AutomationSessionsPage";
import AutomationWorkersPage from "./pages/automation/AutomationWorkersPage";
import AutomationCredentialsPage from "./pages/automation/AutomationCredentialsPage";
import AutomationAlertsPage from "./pages/automation/AutomationAlertsPage";
import AutomationAuditPage from "./pages/automation/AutomationAuditPage";
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
  const [securityOpen, setSecurityOpen] = useState(false);
  const [totpPrompt, setTotpPrompt] = useState(false);

  const refreshSession = useCallback(async (): Promise<SessionData | null> => {
    try {
      const data = await api<SessionData>("/api/auth/me");
      setSession(data);
      return data;
    } catch {
      setSession(null);
      return null;
    }
  }, []);

  // 每次用账号密码完成登录后提醒一次；未绑定时不阻塞使用，可稍后再绑。
  const handleLoginSuccess = useCallback(async () => {
    const data = await refreshSession();
    if (data && !data.user.totpEnabled) setTotpPrompt(true);
  }, [refreshSession]);

  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    const expireSession = () => setSession(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
  }, []);
  useEffect(() => {
    if (!session) return;
    const verifySession = () => {
      void api<SessionData>("/api/auth/me").then(setSession).catch(() => {
        // A 401 response already emits SESSION_EXPIRED_EVENT. Transient network
        // failures must not sign an operator out of an otherwise valid session.
      });
    };
    window.addEventListener("focus", verifySession);
    const timer = window.setInterval(verifySession, 60_000);
    return () => {
      window.removeEventListener("focus", verifySession);
      window.clearInterval(timer);
    };
  }, [session]);
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
  const navigate = useCallback((next: string) => {
    window.location.hash = next;
    setRoute(next.split("?")[0]);
  }, []);
  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* session is cleared locally regardless */ }
    setSession(null);
  };

  const page = useMemo(() => {
    const props = { can, notify };
    if (route === "/game/players" && can("game.player.view")) return <PlayersPage can={can} canViewSensitive={Boolean(session?.user.isProtectedRoot && session.user.username === "admin999")} notify={notify} />;
    if (route === "/game/jackpot" && can("game.jackpot.view")) return <JackpotPerformancePage can={can} notify={notify} />;
    if (route === "/game/club-perf" && can("game.club_perf.view")) return <ClubPerfPage can={can} notify={notify} />;
    if (route === "/game/agent-rewards" && can("game.agent_reward.view")) return <AgentRewardsPage can={can} notify={notify} />;
    if (route === "/game/agents" && can("game.agent.view")) return <AgentsPage notify={notify} />;
    if (route === "/game/unions" && can("game.union.view")) return <UnionsPage can={can} notify={notify} onNavigate={navigate} />;
    if (route === "/game/clubs" && can("game.club.view")) return <ClubsPage can={can} notify={notify} />;
    if (route === "/game/agent-contributions" && can("game.agent_contribution.view")) return <AgentContributionsPage can={can} notify={notify} />;
    if (route === "/game/transactions" && can("game.transaction.view")) return <TransactionsPage notify={notify} />;
    if ((route === "/configuration/platform-revenue" || route === "/game/platform-revenue") && session?.user.isSuper) return <PlatformRevenuePage notify={notify} />;
    if (route === "/game/transaction-blacklist" && can("game.transaction_blacklist.view")) return <TransactionBlacklistPage can={can} notify={notify} />;
    if (route === "/game/room-records" && can("game.room_record.view")) return <RoomRecordsPage notify={notify} />;
    if (route === "/game/bans" && can("game.ban.view")) return <BansPage can={can} notify={notify} />;
    if (route === "/game/anti-theft" && can("game.anti_theft.view")) return <AntiTheftPage can={can} notify={notify} />;
    if (route === "/game/room-maintenance" && session?.user.isSuper) return <RoomMaintenancePage can={can} notify={notify} />;
    if (route === "/game/player-optimization" && can("game.player_optimization.view")) return <PlayerOptimizationPage can={can} notify={notify} />;
    if (route === "/configuration/announcement" && can("configuration.announcement.view")) return <GameAnnouncementPage can={can} notify={notify} />;
    if (route === "/configuration/notifications" && can("configuration.notification.view")) return <GameNotificationsPage can={can} notify={notify} />;
    if (route === "/configuration/reward-pools" && can("configuration.reward_pool.view")) return <RewardPoolsPage can={can} notify={notify} />;
    if (route === "/configuration/payments" && can("configuration.payment.view")) return <PaymentConfigurationPage can={can} notify={notify} />;
    if (route === "/configuration/activities" && can("configuration.activity.view")) return <ActivityConfigurationPage can={can} notify={notify} />;
    if (route === "/configuration/stone-consume" && can("configuration.stone_consume.view")) return <StoneConsumePricePage can={can} notify={notify} />;
    if (route === "/configuration/promotion-download" && can("configuration.promotion_download.view")) return <PromotionDownloadPage can={can} notify={notify} />;
    if (route === "/automation/deploy" && can("automation.deploy.view")) return <AutomationDeployPage can={can} notify={notify} />;
    if (route === "/automation/overview" && can("automation.overview.view")) return <AutomationOverviewPage can={can} notify={notify} />;
    if (route === "/automation/clubs" && can("automation.club.view")) return <AutomationClubsPage can={can} notify={notify} />;
    if (route === "/automation/rooms" && can("automation.room.view")) return <AutomationRoomsPage can={can} notify={notify} />;
    if (route === "/automation/robots" && can("automation.robot.view")) return <AutomationRobotsPage can={can} notify={notify} />;
    if (route === "/automation/groups" && can("automation.group.view")) return <AutomationGroupsPage can={can} notify={notify} />;
    if (route === "/automation/tasks" && can("automation.task.view")) return <AutomationTasksPage can={can} notify={notify} />;
    if (route === "/automation/strategies" && can("automation.strategy.view")) return <AutomationStrategiesPage can={can} notify={notify} />;
    if (route === "/automation/sessions" && can("automation.session.view")) return <AutomationSessionsPage can={can} notify={notify} />;
    if (route === "/automation/workers" && can("automation.worker.view")) return <AutomationWorkersPage can={can} notify={notify} />;
    if (route === "/automation/credentials" && can("automation.credential.view")) return <AutomationCredentialsPage can={can} notify={notify} />;
    if (route === "/automation/alerts" && can("automation.alert.view")) return <AutomationAlertsPage can={can} notify={notify} />;
    if (route === "/automation/audit" && can("automation.audit.view")) return <AutomationAuditPage can={can} notify={notify} />;
    if (route === "/users" && can("user.view")) return <UsersPage {...props} />;
    if (route === "/roles" && can("role.view")) return <RolesPage {...props} />;
    if (route === "/modules" && can("module.view")) return <ModulesPage {...props} />;
    if (route === "/audit" && can("audit.view")) return <AuditPage notify={notify} />;
    if (route === "/system/game-logs" && can("system.game_log.view")) return <GameCallLogsPage notify={notify} />;
    if (can("dashboard.view")) return <DashboardPage notify={notify} />;
    return <div className="panel"><LoadingBlock label="当前角色没有可访问的功能模块" /></div>;
  }, [route, can, notify, navigate, session?.user.isSuper, session?.user.isProtectedRoot, session?.user.username]);

  if (session === undefined) return <div className="boot-screen"><span className="brand__mark brand__mark--large"><i>X</i></span><LoadingBlock label="正在建立安全会话" /></div>;
  if (session === null) return <LoginPage onSuccess={handleLoginSuccess} />;

  return (
    <>
      <Layout session={session} route={route} onNavigate={navigate} onChangePassword={() => setChangePassword(true)} onSecurity={() => setSecurityOpen(true)} onLogout={logout}>{page}</Layout>
      {changePassword && <ChangePasswordModal onClose={() => setChangePassword(false)} onSaved={(message) => { setChangePassword(false); notify(message); }} />}
      {securityOpen && <SecuritySettingsModal onClose={() => setSecurityOpen(false)} onChanged={() => { void refreshSession(); }} notify={notify} />}
      {totpPrompt && !session.user.totpEnabled && (
        <TOTPBindPrompt
          onClose={() => setTotpPrompt(false)}
          onBind={() => { setTotpPrompt(false); setSecurityOpen(true); }}
        />
      )}
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </>
  );
}

function TOTPBindPrompt({ onClose, onBind }: { onClose: () => void; onBind: () => void }) {
  return (
    <Modal title="建议开启谷歌验证" eyebrow="ACCOUNT SECURITY" onClose={onClose}>
      <div className="totp-panel">
        <div className="totp-state"><span>当前状态</span><strong>仅使用账号密码登录</strong></div>
        <div className="info-banner">开启后，每次登录还需要输入验证器 App 的 6 位动态码。即使密码泄露，没有你的手机也无法登录。</div>
        <p className="totp-note">绑定约需 1 分钟，完成后会生成 10 个一次性恢复码，请离线保存。</p>
        <div className="totp-actions">
          <Button variant="secondary" onClick={onClose}>稍后再说</Button>
          <Button onClick={onBind}>立即绑定</Button>
        </div>
      </div>
    </Modal>
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
  return <Modal title="修改登录密码" eyebrow="ACCOUNT SECURITY" onClose={onClose}><form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>{error && <div className="form-error"><span>!</span>{error}</div>}<Field label="当前密码"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field label="新密码" hint="至少 6 位，不限制字符组合"><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field><Field label="确认新密码"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field><FormActions onCancel={onClose} busy={busy} submitText="修改密码" /></form></Modal>;
}
