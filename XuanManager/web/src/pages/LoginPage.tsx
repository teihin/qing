import { useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, submitGuard } from "../components/ui";

export default function LoginPage({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", ...jsonBody({ username, password }) });
      await onSuccess();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

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
        <form className="login-card" onSubmit={submitGuard(submit)}>
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
        <p className="login-copyright">© 2026 XuanManager · Authorized access only</p>
      </section>
    </div>
  );
}
