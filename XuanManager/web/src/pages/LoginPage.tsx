import { useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, submitGuard } from "../components/ui";

type LoginResult = { totpRequired?: boolean; challengeToken?: string; expiresIn?: number; message?: string };

export default function LoginPage({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [step, setStep] = useState<"password" | "totp">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step !== "totp" || !expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [step, expiresAt]);

  const backToPassword = () => {
    setStep("password");
    setChallengeToken("");
    setCode("");
    setUseRecovery(false);
    setError("");
  };

  const submitPassword = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<LoginResult>("/api/auth/login", { method: "POST", ...jsonBody({ username, password }) });
      if (result.totpRequired && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        setExpiresAt(Date.now() + (result.expiresIn ?? 300) * 1000);
        setPassword("");
        setCode("");
        setStep("totp");
        return;
      }
      await onSuccess();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login/totp", { method: "POST", ...jsonBody({ challengeToken, code: code.trim() }) });
      await onSuccess();
    } catch (reason) {
      if (reason instanceof ApiError) {
        setError(reason.message);
        if (reason.code === "CHALLENGE_EXPIRED" || reason.code === "ACCOUNT_LOCKED" || reason.code === "ACCOUNT_DISABLED") {
          setStep("password");
          setChallengeToken("");
          setCode("");
        }
      } else {
        setError("登录失败，请稍后重试");
      }
    } finally {
      setBusy(false);
    }
  };

  const normalizedCode = useRecovery ? code.replace(/[\s-]/g, "") : code;
  const codeReady = useRecovery ? normalizedCode.length === 10 : /^\d{6}$/.test(code);

  return (
    <div className="login-page">
      <div className="login-ambient login-ambient--one" />
      <div className="login-ambient login-ambient--two" />
      <section className="login-story">
        <div className="login-brand"><span className="brand__mark brand__mark--large"><i>X</i></span><strong>XuanManager</strong></div>
        <div className="login-story__copy">
          <span className="eyebrow eyebrow--light">SECURE OPERATIONS CENTER</span>
          <h1>把复杂的运营权限，<br /><em>收进一个清晰的中枢。</em></h1>
          <p>用户、角色、模块与操作权限彼此独立又精确关联。每一次访问和变更，都在服务端完成鉴权与留痕。</p>
        </div>
        <div className="login-story__features">
          <span><i>01</i>分级角色权限</span>
          <span><i>02</i>操作全程审计</span>
          <span><i>03</i>敏感数据隔离</span>
        </div>
      </section>
      <section className="login-panel">
        {step === "password" ? (
          <form className="login-card" onSubmit={submitGuard(submitPassword)}>
            <div className="login-card__heading">
              <span className="eyebrow">WELCOME BACK</span>
              <h2>登录管理后台</h2>
              <p>请输入 XuanManager 后台账号</p>
            </div>
            {error && <div className="form-error"><span>!</span>{error}</div>}
            <Field label="后台账号">
              <div className="input-wrap"><span>人</span><input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入后台账号" /></div>
            </Field>
            <Field label="登录密码">
              <div className="input-wrap"><span>密</span><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入登录密码" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div>
            </Field>
            <Button className="login-submit" type="submit" disabled={busy || !username || !password}>{busy ? "正在安全验证…" : "进入管理后台"}<span>→</span></Button>
            <div className="login-card__security"><span className="security-dot" />后台账号仅保留最近一次登录，旧设备会自动退出</div>
          </form>
        ) : (
          <form className="login-card" onSubmit={submitGuard(submitCode)}>
            <div className="login-card__heading">
              <span className="eyebrow">TWO-STEP VERIFICATION</span>
              <h2>输入谷歌验证码</h2>
              <p>账号 {username} 已开启两步验证</p>
            </div>
            {error && <div className="form-error"><span>!</span>{error}</div>}
            {useRecovery ? (
              <Field label="恢复码" hint="输入绑定验证器时保存的 10 位恢复码，每个只能使用一次">
                <input className="totp-code-input totp-code-input--text" autoFocus autoComplete="one-time-code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 ABCD-EFGH-JK" />
              </Field>
            ) : (
              <Field label="6 位动态码" hint="打开手机上的验证器 App，输入当前显示的 6 位数字">
                <input className="totp-code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))} placeholder="000000" />
              </Field>
            )}
            <div className="login-card__switch">
              <span>{secondsLeft > 0 ? `本次验证剩余 ${secondsLeft} 秒` : "验证已过期，请返回重新登录"}</span>
              <button type="button" onClick={() => { setUseRecovery((value) => !value); setCode(""); setError(""); }}>{useRecovery ? "使用动态码" : "使用恢复码"}</button>
            </div>
            <Button className="login-submit" type="submit" disabled={busy || !codeReady || secondsLeft <= 0}>{busy ? "正在校验…" : "验证并进入"}<span>→</span></Button>
            <div className="login-card__switch login-card__switch--back"><button type="button" onClick={backToPassword}>← 返回重新输入账号密码</button></div>
          </form>
        )}
        <p className="login-copyright">© 2026 XuanManager · Authorized access only</p>
      </section>
    </div>
  );
}
