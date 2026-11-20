import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, LoadingBlock, PageHeader } from "../components/ui";

type SecuritySettings = { captchaEnabled: boolean };

/**
 * 注册防护设置。
 *
 * 只控制「注册接口是否要求滑动验证」：
 * - 关闭：注册照常提交，不要求验证码（默认值）；
 * - 打开：客户端必须先领验证码、拖动滑块，服务端校验通过后才受理注册。
 *
 * 开关存在 mgr_platform_setting，改完立即生效，不需要重启任何服务。
 */
export default function SecurityConfigurationPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [original, setOriginal] = useState<SecuritySettings | null>(null);
  const [draft, setDraft] = useState<SecuritySettings>({ captchaEnabled: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<SecuritySettings>("/api/configuration/security");
      setOriginal(result);
      setDraft(result);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "读取注册防护设置失败", "error");
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const dirty = original !== null && original.captchaEnabled !== draft.captchaEnabled;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<SecuritySettings>("/api/configuration/security", {
        method: "PUT",
        body: JSON.stringify({ captchaEnabled: draft.captchaEnabled }),
      });
      setOriginal(result);
      setDraft(result);
      notify(result.captchaEnabled ? "已开启注册滑动验证" : "已关闭注册滑动验证", "success");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  };

  if (original === null) {
    return <LoadingBlock label="正在读取注册防护设置…" />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SECURITY"
        title="注册防护"
        description="控制客户端注册时是否需要完成滑动验证。开启后能挡住批量脚本注册，但正常玩家要多操作一步。"
      />

      <section className="panel">
        <header className="configuration-card-heading">
          <div>
            <span className="eyebrow">REGISTRATION GUARD</span>
            <h2>注册滑动验证</h2>
            <p>
              开启后，注册接口会要求客户端先领取一次性验证码并完成拖动校验；
              关闭则完全不校验，保持现有注册流程。
            </p>
          </div>
          <label className="switch-control switch-control--large">
            <input
              type="checkbox"
              checked={draft.captchaEnabled}
              disabled={!can("configuration.security.update") || busy}
              onChange={(event) => setDraft({ captchaEnabled: event.target.checked })}
            />
            <span />
            <strong>{draft.captchaEnabled ? "已开启" : "已关闭"}</strong>
          </label>
        </header>

        <div className="activity-step">
          <header>
            <span>i</span>
            <div>
              <h3>当前状态说明</h3>
              <p>
                {draft.captchaEnabled
                  ? "注册必须通过滑动验证。验证码一次有效、2 分钟过期，未通过验证的请求不会占用注册配额。"
                  : "注册不需要验证，任何符合参数规则的请求都会被受理。建议在被批量刷号时再开启。"}
              </p>
            </div>
          </header>
        </div>
      </section>

      <section className="configuration-savebar">
        <div>
          <strong>{dirty ? "注册防护设置有未保存的改动" : "当前设置已生效"}</strong>
          <p>保存后立即生效，不需要重启服务；客户端在开关打开后才会发起验证码请求。</p>
        </div>
        <Button
          variant="secondary"
          disabled={!dirty || busy}
          onClick={() => setDraft(original)}
        >
          放弃修改
        </Button>
        <Button
          disabled={!dirty || busy || !can("configuration.security.update")}
          onClick={() => void save()}
        >
          {busy ? "正在保存…" : "保存设置"}
        </Button>
      </section>
    </div>
  );
}
