import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, LoadingBlock, PageHeader } from "../components/ui";

type SecuritySettings = {
  captchaEnabled: boolean;
  registrationDailyLimit: number;
  registrationTodayCount: number;
};

const minDailyLimit = 1;
const maxDailyLimit = 100000;

/**
 * 注册防护设置。
 *
 * 两个开关都存在 mgr_platform_setting，改完立即生效，不需要重启任何服务：
 * - 滑动验证：注册前必须先领一次性验证码并完成拖动校验；
 * - 全服日注册上限：当天成功注册数达到上限后，注册接口统一返回「注册异常，请联系管理员」。
 *
 * 日上限是唯一不依赖客户端上报字段的硬闸门（IP 在高防后面不可用、设备号可伪造），
 * 所以进度条要能让运营一眼看到今天还剩多少。
 */
export default function SecurityConfigurationPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [original, setOriginal] = useState<SecuritySettings | null>(null);
  const [draft, setDraft] = useState<SecuritySettings>({ captchaEnabled: false, registrationDailyLimit: 300, registrationTodayCount: 0 });
  const [limitInput, setLimitInput] = useState("300");
  const [busy, setBusy] = useState(false);

  const applyResult = useCallback((result: SecuritySettings) => {
    setOriginal(result);
    setDraft(result);
    setLimitInput(String(result.registrationDailyLimit));
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await api<SecuritySettings>("/api/configuration/security");
      applyResult(result);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "读取注册防护设置失败", "error");
    }
  }, [applyResult, notify]);

  useEffect(() => { void load(); }, [load]);

  const parsedLimit = Number(limitInput);
  const limitValid = Number.isInteger(parsedLimit) && parsedLimit >= minDailyLimit && parsedLimit <= maxDailyLimit;
  const dirty = original !== null && (
    original.captchaEnabled !== draft.captchaEnabled ||
    String(original.registrationDailyLimit) !== limitInput.trim()
  );

  const save = async () => {
    if (busy) return;
    if (!limitValid) {
      notify(`日注册上限必须是 ${minDailyLimit} 到 ${maxDailyLimit} 之间的整数`, "error");
      return;
    }
    setBusy(true);
    try {
      const result = await api<SecuritySettings>("/api/configuration/security", {
        method: "PUT",
        body: JSON.stringify({ captchaEnabled: draft.captchaEnabled, registrationDailyLimit: parsedLimit }),
      });
      applyResult(result);
      notify("注册防护设置已保存，立即生效", "success");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  };

  if (original === null) {
    return <LoadingBlock label="正在读取注册防护设置…" />;
  }

  const todayCount = draft.registrationTodayCount;
  const progressBase = limitValid ? parsedLimit : original.registrationDailyLimit;
  const percent = progressBase > 0 ? Math.min(100, Math.round((todayCount / progressBase) * 100)) : 0;
  const reached = todayCount >= progressBase;
  const remaining = Math.max(0, progressBase - todayCount);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SECURITY"
        title="注册防护"
        description="控制客户端注册时是否需要完成滑动验证，以及全服每天最多允许成功注册多少个账号。两项都改完立即生效。"
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
              onChange={(event) => setDraft({ ...draft, captchaEnabled: event.target.checked })}
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

      <section className="panel">
        <header className="configuration-card-heading">
          <div>
            <span className="eyebrow">DAILY REGISTRATION CAP</span>
            <h2>全服日注册上限</h2>
            <p>
              当天成功注册的账号数达到上限后，注册接口一律返回「注册异常，请联系管理员」。
              上限按自然日统计（北京时间 0 点清零），不依赖 IP 或设备号，脚本也绕不过。
            </p>
          </div>
          <div className="registration-quota__input">
            <input
              type="number"
              min={minDailyLimit}
              max={maxDailyLimit}
              step={1}
              value={limitInput}
              disabled={!can("configuration.security.update") || busy}
              onChange={(event) => setLimitInput(event.target.value)}
            />
            <span>个 / 天</span>
          </div>
        </header>

        <div className={`registration-quota ${reached ? "is-reached" : ""}`}>
          <div className="registration-quota__headline">
            <strong>今日已注册 {todayCount.toLocaleString("zh-CN")} 个</strong>
            <span>上限 {progressBase.toLocaleString("zh-CN")} 个 · {reached ? "已达上限，注册已关闭" : `剩余 ${remaining.toLocaleString("zh-CN")} 个`}</span>
          </div>
          <div className="registration-quota__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${percent}%` }} />
          </div>
          <small className="registration-quota__hint">
            {limitValid
              ? `当前设置每自然日最多 ${parsedLimit.toLocaleString("zh-CN")} 个；进度实时对应「注册事件」里今天成功的记录。`
              : `输入无效：请填 ${minDailyLimit} 到 ${maxDailyLimit} 之间的整数，保存后才会生效。`}
          </small>
        </div>

        <div className="activity-step">
          <header>
            <span>i</span>
            <div>
              <h3>超过上限会怎样</h3>
              <p>
                客户端会收到「注册异常，请联系管理员」，玩家端不展示具体配额细节。
                需要临时放宽时把数字改大并保存即可，无需重启服务；新玩家多的日子建议提前上调。
              </p>
            </div>
          </header>
        </div>
      </section>

      <section className="configuration-savebar">
        <div>
          <strong>{dirty ? "注册防护设置有未保存的改动" : "当前设置已生效"}</strong>
          <p>保存后立即生效，不需要重启服务；进度条为读取时的今日注册数，点「刷新进度」可重新拉取。</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          刷新进度
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || busy}
          onClick={() => { setDraft(original); setLimitInput(String(original.registrationDailyLimit)); }}
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
