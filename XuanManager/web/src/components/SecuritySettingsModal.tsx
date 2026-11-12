import { useCallback, useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { api, ApiError, jsonBody } from "../api";
import type { TOTPSetup, TOTPStatus } from "../types";
import { Button, Field, FormActions, LoadingBlock, Modal, submitGuard } from "./ui";

type Mode = "overview" | "bind-password" | "bind-scan" | "disable" | "regenerate" | "codes";

interface RecoveryCodesResult {
  message: string;
  recoveryCodes: string[];
}

export default function SecuritySettingsModal({ onClose, onChanged, notify }: {
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [status, setStatus] = useState<TOTPStatus | null>(null);
  const [mode, setMode] = useState<Mode>("overview");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TOTPSetup | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [codesHint, setCodesHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<TOTPStatus>("/api/auth/totp/status"));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (!setup) {
      setQrImage("");
      return;
    }
    const qr = qrcode(0, "M");
    qr.addData(setup.otpauthUri);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    setQrImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }, [setup]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword("");
    setCode("");
    setError("");
    if (next === "overview") setSetup(null);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const startBind = () => run(async () => {
    const result = await api<TOTPSetup>("/api/auth/totp/setup", { method: "POST", ...jsonBody({ password }) });
    setSetup(result);
    setPassword("");
    setMode("bind-scan");
  });

  const confirmBind = () => run(async () => {
    const result = await api<RecoveryCodesResult>("/api/auth/totp/confirm", { method: "POST", ...jsonBody({ code: code.trim() }) });
    setCodes(result.recoveryCodes);
    setCodesHint(result.message);
    setMode("codes");
    await loadStatus();
    await onChanged();
    window.dispatchEvent(new Event("xuan:totp-changed"));
  });

  const disable = () => run(async () => {
    await api("/api/auth/totp/disable", { method: "POST", ...jsonBody({ password, code: code.trim() }) });
    notify("谷歌验证已关闭");
    setPassword("");
    setCode("");
    await loadStatus();
    await onChanged();
    window.dispatchEvent(new Event("xuan:totp-changed"));
    setMode("overview");
  });

  const regenerate = () => run(async () => {
    const result = await api<RecoveryCodesResult>("/api/auth/totp/recovery", { method: "POST", ...jsonBody({ password, code: code.trim() }) });
    setCodes(result.recoveryCodes);
    setCodesHint(result.message);
    setMode("codes");
    setPassword("");
    setCode("");
    await loadStatus();
  });

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      notify("恢复码已复制到剪贴板");
    } catch {
      notify("复制失败，请手动选择文本", "error");
    }
  };

  const downloadCodes = () => {
    const content = [
      "XuanManager 谷歌验证恢复码",
      `生成时间：${new Date().toLocaleString("zh-CN")}`,
      "",
      ...codes,
      "",
      "每个恢复码只能使用一次，请离线保存。",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "XuanManager-恢复码.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title="账号安全" eyebrow="ACCOUNT SECURITY" onClose={onClose}>
      {mode === "overview" && (
        !status ? <LoadingBlock label="正在读取二次验证状态" /> : status.enabled ? (
          <div className="totp-panel">
            <div className="totp-state totp-state--on"><span>已开启</span><strong>谷歌验证（动态口令）</strong></div>
            <div className="totp-meta">
              <span>绑定时间：{formatMoment(status.confirmedAt)}</span>
              <span>剩余恢复码：{status.recoveryCodesLeft} 个</span>
            </div>
            {error && <div className="form-error"><span>!</span>{error}</div>}
            <p className="totp-note">重新生成恢复码或关闭验证，需要输入登录密码 + 当前动态码（也可用恢复码）。</p>
            <div className="totp-actions">
              <Button variant="secondary" onClick={() => switchMode("regenerate")}>重新生成恢复码</Button>
              <Button variant="danger" onClick={() => switchMode("disable")}>关闭谷歌验证</Button>
            </div>
          </div>
        ) : (
          <div className="totp-panel">
            <div className="totp-state"><span>未开启</span><strong>谷歌验证（动态口令）</strong></div>
            {error && <div className="form-error"><span>!</span>{error}</div>}
            <div className="info-banner">开启后，账号密码验证通过还需要输入验证器 App 的 6 位动态码。手机丢失时可使用恢复码或联系超级管理员重置。</div>
            <div className="totp-actions"><Button onClick={() => switchMode("bind-password")}>立即绑定</Button></div>
          </div>
        )
      )}

      {mode === "bind-password" && (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(startBind)}>
          {error && <div className="form-error"><span>!</span>{error}</div>}
          <div className="info-banner">先验证当前登录密码，再展示验证器二维码。</div>
          <Field label="当前登录密码"><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <FormActions onCancel={() => switchMode("overview")} busy={busy} submitText="下一步" disabled={!password} />
        </form>
      )}

      {mode === "bind-scan" && setup && (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(confirmBind)}>
          {error && <div className="form-error"><span>!</span>{error}</div>}
          <div className="totp-qr">{qrImage ? <img src={qrImage} alt="谷歌验证二维码" /> : <LoadingBlock label="正在生成二维码" />}</div>
          <div className="totp-secret">无法扫码时，在验证器中手动添加账号并输入密钥：<code>{setup.secret}</code></div>
          <Field label="验证器中的 6 位动态码" hint="打开 Google Authenticator / Microsoft Authenticator 等 App 输入当前动态码">
            <input className="totp-code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))} placeholder="000000" />
          </Field>
          <FormActions onCancel={() => switchMode("overview")} busy={busy} submitText="确认开启" disabled={code.length !== 6} />
        </form>
      )}

      {mode === "disable" && (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(disable)}>
          {error && <div className="form-error"><span>!</span>{error}</div>}
          <div className="info-banner">关闭后，登录将只校验账号密码。其他设备的登录会话会一起退出。</div>
          <Field label="当前登录密码"><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="动态码或恢复码"><input className="totp-code-input totp-code-input--text" autoComplete="one-time-code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="6 位动态码或 10 位恢复码" /></Field>
          <FormActions onCancel={() => switchMode("overview")} busy={busy} submitText="确认关闭" disabled={!password || code.trim().length < 6} />
        </form>
      )}

      {mode === "regenerate" && (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(regenerate)}>
          {error && <div className="form-error"><span>!</span>{error}</div>}
          <div className="info-banner">生成新一批恢复码后，旧恢复码全部失效。需要验证登录密码 + 当前动态码（也可用恢复码）。</div>
          <Field label="当前登录密码"><input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="动态码或恢复码"><input className="totp-code-input totp-code-input--text" autoComplete="one-time-code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="6 位动态码或 10 位恢复码" /></Field>
          <FormActions onCancel={() => switchMode("overview")} busy={busy} submitText="生成新恢复码" disabled={!password || code.trim().length < 6} />
        </form>
      )}

      {mode === "codes" && (
        <div className="form-grid form-grid--single">
          <div className="info-banner">{codesHint || "恢复码只显示这一次，请立即保存。"}</div>
          <div className="recovery-codes">{codes.map((item) => <code key={item}>{item}</code>)}</div>
          <div className="recovery-actions">
            <Button variant="secondary" onClick={() => void copyCodes()}>复制全部</Button>
            <Button variant="secondary" onClick={downloadCodes}>下载 TXT</Button>
          </div>
          <p className="totp-note">每个恢复码只能使用一次。手机丢失且没有恢复码时，需要管理员重置二次验证。</p>
          <div className="totp-actions"><Button onClick={() => { setCodes([]); setCodesHint(""); switchMode("overview"); }}>我已保存，完成</Button></div>
        </div>
      )}
    </Modal>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof ApiError ? reason.message : "操作失败，请稍后重试";
}

function formatMoment(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}
