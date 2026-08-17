import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";
import { formatBeijingDateTime } from "../time";

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗">×</button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function FormActions({ onCancel, busy, submitText = "保存" }: { onCancel: () => void; busy?: boolean; submitText?: string }) {
  return (
    <div className="form-actions">
      <Button type="button" variant="secondary" onClick={onCancel}>取消</Button>
      <Button type="submit" disabled={busy}>{busy ? "正在保存…" : submitText}</Button>
    </div>
  );
}

export function StatusPill({ status, superAdmin = false }: { status: string; superAdmin?: boolean }) {
  if (superAdmin) return <span className="pill pill--super"><i />超级管理员</span>;
  return <span className={`pill pill--${status}`}><i />{status === "enabled" ? "已启用" : "已停用"}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark">◇</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function LoadingBlock({ label = "正在读取数据" }: { label?: string }) {
  return <div className="loading-block"><span className="spinner" />{label}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Toast({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error"; onClose: () => void }) {
  return (
    <div className={`toast toast--${kind}`} role="status">
      <span>{kind === "success" ? "✓" : "!"}</span>
      <p>{message}</p>
      <button onClick={onClose} aria-label="关闭提示">×</button>
    </div>
  );
}

export function submitGuard(handler: () => Promise<void>) {
  return (event: FormEvent) => {
    event.preventDefault();
    void handler();
  };
}

export function formatDate(value?: string | null): string {
  return formatBeijingDateTime(value, { includeYear: false, includeSeconds: false });
}
