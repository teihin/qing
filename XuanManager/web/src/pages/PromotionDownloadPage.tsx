import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import { formatBeijingDateTime } from "../time";
import type { PromotionDownloadURLState, PromotionSiteLinksState } from "../types";

/**
 * 游戏推广下载地址。
 *
 * 客户端登录进大厅时执行 `GetOneHashKey("下载url")`，把内容明文写进
 * ConfigManager.downloadurl；大厅「我的 → 推广二维码」和代理页「推广」打开的
 * 推广分享页，把「游戏下载地址」显示成这个值。
 *
 * 所以这里改的是游戏端哈希配置表 `kbedm.usr_hash_info` 的 `下载url` 一条，
 * 玩家重新登录进大厅（或重开推广页）才会看到新地址。
 *
 * 页面下半部分是推广落地站（/webhome/）的苹果/安卓跳转地址，存在
 * `mgr_platform_setting` 的 promotion.site.* 两条里，保存即生效：
 * 落地页每次打开都会请求 `/xuanmanager/api/public/promotion-links` 取最新值。
 */
export default function PromotionDownloadPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<PromotionDownloadURLState | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [links, setLinks] = useState<PromotionSiteLinksState | null>(null);
  const [iosValue, setIosValue] = useState("");
  const [androidValue, setAndroidValue] = useState("");
  const [linksConfirm, setLinksConfirm] = useState(false);
  const [linksBusy, setLinksBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, linkState] = await Promise.all([
        api<PromotionDownloadURLState>("/api/configuration/promotion-download"),
        api<PromotionSiteLinksState>("/api/configuration/promotion-site-links"),
      ]);
      setOriginal(result);
      setValue(result.downloadUrl);
      setConfirmed(false);
      setLinks(linkState);
      setIosValue(linkState.iosUrl);
      setAndroidValue(linkState.androidUrl);
      setLinksConfirm(false);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "推广下载地址加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const canUpdate = can("configuration.promotion_download.update");
  const dirty = Boolean(original && value !== original.downloadUrl);

  const save = async () => {
    if (!original) return;
    setBusy(true);
    try {
      const result = await api<PromotionDownloadURLState>("/api/configuration/promotion-download", {
        method: "PUT",
        ...jsonBody({ downloadUrl: value, confirm: confirmed }),
      });
      setOriginal(result);
      setValue(result.downloadUrl);
      setConfirmed(false);
      notify("推广下载地址已保存并回读校验，玩家重新进大厅后生效");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "推广下载地址保存失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const linksDirty = Boolean(links && (iosValue !== links.iosUrl || androidValue !== links.androidUrl));

  const saveLinks = async () => {
    if (!links) return;
    setLinksBusy(true);
    try {
      const result = await api<PromotionSiteLinksState>("/api/configuration/promotion-site-links", {
        method: "PUT",
        ...jsonBody({ iosUrl: iosValue, androidUrl: androidValue, confirm: linksConfirm }),
      });
      setLinks(result);
      setIosValue(result.iosUrl);
      setAndroidValue(result.androidUrl);
      setLinksConfirm(false);
      notify("落地站跳转地址已保存，玩家刷新落地页即生效");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "落地站跳转地址保存失败", "error");
    } finally {
      setLinksBusy(false);
    }
  };

  if (loading && !original) return <div className="panel"><LoadingBlock label="正在读取推广下载地址" /></div>;
  if (!original) return <EmptyState title="推广下载地址无法显示" description="请稍后刷新页面重试。" />;

  return <div className="page-stack">
    <PageHeader
      eyebrow="PROMOTION DOWNLOAD"
      title="游戏推广下载地址"
      description="玩家在「我的 → 推广二维码」或代理页「推广」里看到的「游戏下载地址」，复制和生成的二维码都指向这里。"
      actions={<Button variant="secondary" onClick={() => void load()}>重新读取</Button>}
    />

    <section className="configuration-summary-strip">
      <div><span>配置状态</span><strong>{original.configured ? "已下发" : "使用默认值"}</strong></div>
      <div><span>哈希键</span><strong>{original.storageKey}</strong></div>
      <div><span>上次修改</span><strong>{original.updatedBy || "—"}</strong></div>
      <div><span>修改时间</span><strong>{original.updatedAt ? formatBeijingDateTime(original.updatedAt, { includeSeconds: false }) : "—"}</strong></div>
    </section>

    {!original.configured && (
      <div className="form-error"><span>i</span>游戏端还没有「{original.storageKey}」这条配置，当前显示的是客户端内置默认值。保存一次后才会真正下发。</div>
    )}
    {original.duplicateRows > 0 && (
      <div className="form-error"><span>!</span>哈希表里有 {original.rowCount} 条同名记录，客户端只认第一条。保存会把它们统一成同一个地址，建议保存后确认这里的值正确。</div>
    )}

    <section className="panel">
      <div className="form-grid form-grid--single" style={{ padding: "18px" }}>
        <Field
          label="游戏下载地址"
          hint="必须是完整的 http:// 或 https:// 地址。玩家会原样看到并复制这段内容。"
        >
          <input
            value={value}
            placeholder="http://www.baidu.com"
            disabled={!canUpdate || busy}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <p style={{ color: "#71878c", fontSize: 13, margin: 0 }}>
          写入游戏端哈希配置 <code>usr_hash_info</code>（键：<code>{original.storageKey}</code>），
          客户端登录时按 <code>{original.clientContext}</code> 读取。已在线玩家需要重新登录进大厅（或重开推广页）才会刷新。
        </p>
      </div>
    </section>

    <section className={`configuration-savebar ${dirty ? "is-dirty" : ""}`}>
      <div>
        <strong>{dirty ? "下载地址已修改，尚未保存" : "当前内容与游戏配置一致"}</strong>
        <p>保存后写入哈希配置并回读校验。{original.updatedBy ? `上次修改：${original.updatedBy}` : ""}</p>
      </div>
      <label className="confirm-check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!dirty} />
        <span>我已核对这个下载地址</span>
      </label>
      <Button variant="secondary" disabled={!dirty || busy} onClick={() => { setValue(original.downloadUrl); setConfirmed(false); }}>放弃修改</Button>
      <Button disabled={!dirty || !confirmed || busy || !canUpdate} onClick={() => void save()}>
        {busy ? "正在保存并回读…" : "保存下载地址"}
      </Button>
    </section>

    <section className="panel">
      <div className="form-grid form-grid--single" style={{ padding: "18px" }}>
        <div>
          <strong style={{ fontSize: 15 }}>推广落地站跳转地址</strong>
          <p style={{ color: "#71878c", fontSize: 13, margin: "6px 0 0" }}>
            推广下载站（<code>/webhome/</code>）上「前往苹果安装页」「前往安卓下载页」两个按钮的去向。
            保存后玩家刷新落地页就生效，<strong>不需要重新上传网站或发版本</strong>。留空表示用网站自带的默认地址。
          </p>
        </div>
        <Field label="苹果安装地址" hint="必须是 https:// 开头的完整地址，落地页只接受 https。">
          <input
            value={iosValue}
            placeholder="https://example.com/ios"
            disabled={!canUpdate || linksBusy}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            onChange={(event) => setIosValue(event.target.value)}
          />
        </Field>
        <Field label="安卓下载地址" hint="必须是 https:// 开头的完整地址，落地页只接受 https。">
          <input
            value={androidValue}
            placeholder="https://example.com/android"
            disabled={!canUpdate || linksBusy}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            onChange={(event) => setAndroidValue(event.target.value)}
          />
        </Field>
        <p style={{ color: "#71878c", fontSize: 13, margin: 0 }}>
          存在 <code>mgr_platform_setting</code>（键：<code>promotion.site.ios_url</code> /
          <code> promotion.site.android_url</code>），落地页通过
          <code> /xuanmanager/api/public/promotion-links</code> 实时读取；接口不可达时回退到网站自带配置。
        </p>
      </div>
    </section>

    <section className={`configuration-savebar ${linksDirty ? "is-dirty" : ""}`}>
      <div>
        <strong>{linksDirty ? "跳转地址已修改，尚未保存" : "当前跳转地址与线上一致"}</strong>
        <p>保存后立即生效，玩家刷新落地页即可看到新的跳转去向。</p>
      </div>
      <label className="confirm-check">
        <input type="checkbox" checked={linksConfirm} onChange={(event) => setLinksConfirm(event.target.checked)} disabled={!linksDirty} />
        <span>我已核对这两个地址</span>
      </label>
      <Button variant="secondary" disabled={!linksDirty || linksBusy} onClick={() => { if (links) { setIosValue(links.iosUrl); setAndroidValue(links.androidUrl); } setLinksConfirm(false); }}>放弃修改</Button>
      <Button disabled={!linksDirty || !linksConfirm || linksBusy || !canUpdate} onClick={() => void saveLinks()}>
        {linksBusy ? "正在保存…" : "保存跳转地址"}
      </Button>
    </section>
  </div>;
}
