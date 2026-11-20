import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import type {
  PayChannel, PayLinkResponse, PayOrderResponse, PayProvider, PayProvidersResponse, PayStatBucket, PayStatsResponse,
} from "../types";

/**
 * 网页支付。
 *
 * 客服在这里生成一条带签名的付款链接发给玩家，玩家自己在网页里选金额付款；
 * 到账由支付服务商的异步回调落库，「网页支付」里看到的就是这些订单。
 * 钱不进游戏服务器，加币仍然走客服原来的上下分流程，所以这里只做「发链接 + 记账 + 对账」。
 */

const statusTone: Record<string, string> = {
  paid: "ok",
  pending: "wait",
  failed: "fail",
  closed: "mute",
};

function money(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** 金额档位/上下限在后台一律按整数展示，服务端仍按两位小数落库（验签要对齐）。 */
function amountText(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  return money(value);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  }
}

export default function PayWebPage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [tab, setTab] = useState<"orders" | "providers">("orders");
  const [providers, setProviders] = useState<PayProvider[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);

  const loadProviders = useCallback(async () => {
    try {
      const result = await api<PayProvidersResponse>("/api/pay/providers");
      setProviders(result.items);
      setBaseUrl(result.baseUrl);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "支付商读取失败", "error");
    }
  }, [notify]);

  useEffect(() => {
    void (async () => { await loadProviders(); setLoading(false); })();
  }, [loadProviders]);

  if (loading && providers.length === 0) return <div className="panel"><LoadingBlock label="正在读取网页支付配置" /></div>;

  return <div className="page-stack">
    <PageHeader
      eyebrow="WEB CHECKOUT"
      title="网页支付"
      description="给玩家发一条付款链接，玩家在网页里自行选金额付款；这里看订单、对账、配通道。钱不经过游戏服务器，加币仍由客服在上下分里处理。"
      actions={<div className="pay-tabs">
        <button className={tab === "orders" ? "is-active" : ""} onClick={() => setTab("orders")}>付款订单</button>
        <button className={tab === "providers" ? "is-active" : ""} onClick={() => setTab("providers")}>支付商与通道</button>
      </div>}
    />
    {tab === "orders"
      ? <OrdersTab can={can} providers={providers} baseUrl={baseUrl} notify={notify} />
      : <ProvidersTab can={can} providers={providers} baseUrl={baseUrl} reload={loadProviders} notify={notify} />}
  </div>;
}

// ---------------------------------------------------------------- 订单

function OrdersTab({ can, providers, baseUrl, notify }: {
  can: (permission: string) => boolean;
  providers: PayProvider[];
  baseUrl: string;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [link, setLink] = useState<PayLinkResponse | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [draftProvider, setDraftProvider] = useState("");
  const [draftPlayerId, setDraftPlayerId] = useState("");
  const [draftPlayerName, setDraftPlayerName] = useState("");
  const [draftRemark, setDraftRemark] = useState("");
  const [draftHours, setDraftHours] = useState("1");

  const [stats, setStats] = useState<PayStatsResponse | null>(null);
  const [data, setData] = useState<PayOrderResponse | null>(null);
  const [filters, setFilters] = useState({ providerId: "", channel: "", status: "", keyword: "", startDate: "", endDate: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busy, setBusy] = useState(false);
  // 条件没变时 query 字符串也一样，光 setApplied 不会触发重新请求，
  // 所以「查询/重置」要显式抬一次 revision。
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const usable = useMemo(() => providers.filter((item) => item.enabled), [providers]);
  useEffect(() => {
    if (!draftProvider && usable.length > 0) setDraftProvider(String(usable[0].id));
  }, [usable, draftProvider]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    void queryRevision;
    setBusy(true);
    try {
      const [orders, stat] = await Promise.all([
        api<PayOrderResponse>(`/api/pay/orders?${query}`),
        api<PayStatsResponse>(`/api/pay/stats?${query}`),
      ]);
      setData(orders);
      setStats(stat);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "付款订单读取失败", "error");
    } finally {
      setBusy(false);
    }
  }, [query, queryRevision, notify]);
  useEffect(() => { void load(); }, [load]);

  const createLink = async () => {
    if (!draftProvider) { notify("请先选择支付商", "error"); return; }
    setLinkBusy(true);
    try {
      const result = await api<PayLinkResponse>("/api/pay/links", {
        method: "POST",
        ...jsonBody({
          providerId: Number(draftProvider),
          playerId: draftPlayerId.trim(),
          playerName: draftPlayerName.trim(),
          remark: draftRemark.trim(),
          expiresHours: Number(draftHours) || 1,
        }),
      });
      setLink(result);
      const copied = await copyText(result.url);
      notify(copied ? "付款链接已生成并复制，直接粘贴发给玩家" : "付款链接已生成，请点右下角复制按钮");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "生成付款链接失败", "error");
    } finally {
      setLinkBusy(false);
    }
  };

  const syncOrder = async (orderNo: string) => {
    try {
      const result = await api<{ status: string; providerStatus: string }>(`/api/pay/orders/${encodeURIComponent(orderNo)}/sync`, { method: "POST" });
      notify(result.status ? `已同步，当前状态：${result.status}` : `服务商返回状态 ${result.providerStatus}，本地未变化`);
      void load();
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "同步订单失败", "error");
    }
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const canLink = can("game.pay_web.link");

  return <>
    <section className="panel">
      <div className="toolbar">
        <div><strong>生成付款链接</strong><span>生成的链接可以直接发给玩家，链接里带着支付商和客服信息，改一个字符就失效。</span></div>
        <span className="toolbar__count">对外域名 {baseUrl}</span>
      </div>
      <div className="pay-link-grid">
        <Field label="支付商">
          <select value={draftProvider} onChange={(event) => setDraftProvider(event.target.value)} disabled={!canLink}>
            {usable.length === 0 && <option value="">没有可用的支付商</option>}
            {usable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="玩家 ID（选填）">
          <input value={draftPlayerId} onChange={(event) => setDraftPlayerId(event.target.value)} placeholder="292989" autoComplete="off" disabled={!canLink} />
        </Field>
        <Field label="玩家昵称（选填）">
          <input value={draftPlayerName} onChange={(event) => setDraftPlayerName(event.target.value)} placeholder="付款页会显示「你好，昵称」" autoComplete="off" disabled={!canLink} />
        </Field>
        <Field label="有效期">
          <select value={draftHours} onChange={(event) => setDraftHours(event.target.value)} disabled={!canLink}>
            <option value="1">1 小时</option>
            <option value="2">2 小时</option>
            <option value="6">6 小时</option>
            <option value="12">12 小时</option>
            <option value="24">1 天</option>
            <option value="72">3 天</option>
            <option value="168">7 天</option>
          </select>
        </Field>
        <Field label="备注（选填）">
          <input value={draftRemark} onChange={(event) => setDraftRemark(event.target.value)} placeholder="客服内部备注，玩家看不到" autoComplete="off" disabled={!canLink} />
        </Field>
        <div className="pay-link-actions">
          <Button disabled={!canLink || linkBusy || usable.length === 0} onClick={() => void createLink()}>
            {linkBusy ? "正在生成…" : "生成并复制链接"}
          </Button>
        </div>
      </div>
      {link && <div className="pay-link-result">
        <div>
          <span className="pay-link-result__label">付款链接</span>
          <code>{link.url}</code>
          <small>有效期至 {link.expiresAt}</small>
        </div>
        <div className="pay-link-result__actions">
          <Button variant="secondary" onClick={() => void openLink(link.url)}>预览</Button>
          <Button variant="secondary" onClick={async () => notify(await copyText(link.url) ? "已复制" : "复制失败，请手动选中复制", "success")}>复制</Button>
        </div>
      </div>}
      {!canLink && <div className="form-error" style={{ margin: "0 18px 16px" }}><span>i</span>当前角色没有「生成付款链接」权限，只能查看订单。</div>}
    </section>

    {stats && <section className="configuration-summary-strip pay-stat-strip">
      <StatCard label="今日已收" bucket={stats.today} hint={`${stats.today.paidOrders} / ${stats.today.orders} 单成功`} />
      <StatCard label="昨日已收" bucket={stats.yesterday} hint={`${stats.yesterday.paidOrders} / ${stats.yesterday.orders} 单成功`} />
      <StatCard label="近 7 天" bucket={stats.week} hint={`${stats.week.paidOrders} / ${stats.week.orders} 单成功`} />
      <StatCard label="本月" bucket={stats.month} hint={`${stats.month.paidOrders} / ${stats.month.orders} 单成功`} />
      <div>
        <span>待支付订单</span>
        <strong>{stats.pending}</strong>
        <small>累计 {stats.total.orders} 单 · 成功 {stats.total.paidOrders} 单</small>
      </div>
    </section>}

    {stats && stats.channels.length > 0 && <section className="panel">
      <div className="toolbar"><div><strong>按付款方式汇总</strong><span>当前筛选范围内的分布，用来判断哪个通道更好用</span></div></div>
      <div className="table-wrap">
        <table className="pay-table">
          <thead><tr><th>付款方式</th><th>订单数</th><th>成功单数</th><th>成功金额</th><th>成功率</th></tr></thead>
          <tbody>{stats.channels.map((item) => <tr key={item.channelCode}>
            <td><strong>{item.channelName || item.channelCode}</strong><small className="cell-subtitle">{item.channelCode}</small></td>
            <td>{item.orders}</td>
            <td>{item.paidOrders}</td>
            <td>¥ {money(item.paidAmount)}</td>
            <td>{percent(item.paidOrders, item.orders)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    <section className="panel">
      <div className="toolbar">
        <div><strong>付款订单</strong><span>时间按北京时间；金额是玩家实际支付的金额</span></div>
        <span className="toolbar__count">共 {data?.total ?? 0} 单</span>
      </div>
      <div className="pay-filter-grid">
        <Field label="支付商"><select value={filters.providerId} onChange={(event) => setFilters({ ...filters, providerId: event.target.value })}>
          <option value="">全部</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></Field>
        <Field label="付款方式"><select value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })}>
          <option value="">全部</option>{channelOptions(providers).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></Field>
        <Field label="状态"><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">全部</option><option value="pending">待支付</option><option value="paid">已支付</option>
          <option value="failed">支付失败</option><option value="closed">已关闭</option>
        </select></Field>
        <Field label="关键词"><input value={filters.keyword} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} placeholder="订单号 / 玩家ID / 昵称" /></Field>
        <Field label="开始日期"><input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></Field>
        <Field label="结束日期"><input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></Field>
        <div className="pay-filter-actions">
          <Button onClick={() => { setApplied(filters); setPage(1); refreshQuery(); }}>查询</Button>
          <Button variant="secondary" onClick={() => { const empty = { providerId: "", channel: "", status: "", keyword: "", startDate: "", endDate: "" }; setFilters(empty); setApplied(empty); setPage(1); refreshQuery(); }}>重置</Button>
        </div>
      </div>

      {!data || data.items.length === 0
        ? <EmptyState title="还没有付款订单" description="生成一条付款链接发给玩家，玩家付款后订单会出现在这里。" />
        : <>
          <div className={`table-wrap ${busy ? "is-loading" : ""}`}>
            <table className="pay-table">
              <thead><tr><th>时间</th><th>订单号</th><th>玩家</th><th>付款方式</th><th>金额</th><th>状态</th><th className="align-right">操作</th></tr></thead>
              <tbody>{data.items.map((item) => <tr key={item.id}>
                <td><strong>{item.createdAt}</strong>{item.paidAt && <small className="cell-subtitle">支付 {item.paidAt}</small>}</td>
                <td><code className="pay-order-no">{item.orderNo}</code>{item.gamerOrderId && <small className="cell-subtitle">{item.gamerOrderId}</small>}</td>
                <td>{item.playerName || "—"}<small className="cell-subtitle">{item.playerId || "无"}{item.operatorName ? ` · ${item.operatorName}` : ""}</small></td>
                <td>{item.channelName}<small className="cell-subtitle">{item.providerName}</small></td>
                <td className="align-right"><strong>¥ {money(item.amount)}</strong></td>
                <td><span className={`pay-status pay-status--${statusTone[item.status] || "mute"}`}><i />{item.statusLabel}</span></td>
                <td><div className="row-actions">
                  {item.payUrl && <button onClick={() => void openLink(item.payUrl)}>收银台</button>}
                  {item.status === "pending" && <button onClick={() => void syncOrder(item.orderNo)}>同步状态</button>}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <footer className="table-pagination">
            <span>显示 {(data.page - 1) * data.pageSize + 1}–{Math.min(data.total, data.page * data.pageSize)}，共 {data.total} 条</span>
            <div>
              <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                <option value="20">20</option><option value="50">50</option><option value="100">100</option>
              </select></label>
              <button type="button" disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>上一页</button>
              <strong>{page} / {totalPages}</strong>
              <button type="button" disabled={page >= totalPages || busy} onClick={() => setPage((value) => value + 1)}>下一页</button>
            </div>
          </footer>
        </>}
    </section>
  </>;
}

function StatCard({ label, bucket, hint }: { label: string; bucket: PayStatBucket; hint: string }) {
  return <div>
    <span>{label}</span>
    <strong>¥ {money(bucket.paidAmount)}</strong>
    <small>{hint} · 成功率 {bucket.successPct}%</small>
  </div>;
}

function percent(part: number, total: number) {
  if (!total) return "—";
  return `${((part * 100) / total).toFixed(1)}%`;
}

function channelOptions(providers: PayProvider[]) {
  const seen = new Map<string, string>();
  for (const provider of providers) {
    for (const channel of provider.channels) {
      if (!seen.has(channel.code)) seen.set(channel.code, channel.name);
    }
  }
  return Array.from(seen, ([code, name]) => ({ code, name }));
}

function openLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------- 支付商

function ProvidersTab({ can, providers, baseUrl, reload, notify }: {
  can: (permission: string) => boolean;
  providers: PayProvider[];
  baseUrl: string;
  reload: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [editing, setEditing] = useState<PayProvider | "new" | null>(null);
  const [channelEditing, setChannelEditing] = useState<PayProvider | null>(null);
  const canConfig = can("game.pay_web.config");

  return <>
    <section className="panel">
      <div className="toolbar">
        <div><strong>付款链接域名</strong><span>玩家拿到的链接用这个域名开头。后台在 /xuanmanager 子路径下时，一般填成 https://你的域名/xuanmanager</span></div>
      </div>
      <BaseURLForm baseUrl={baseUrl} canConfig={canConfig} reload={reload} notify={notify} />
    </section>

    <section className="panel">
      <div className="toolbar">
        <div><strong>支付商</strong><span>目前只有雷马一家；后续新增按同样的字段再建一条即可，付款页会自动按启用的支付商和通道出选项</span></div>
        {canConfig && <Button onClick={() => setEditing("new")}>新增支付商</Button>}
      </div>
      {providers.length === 0
        ? <EmptyState title="还没有支付商" description="新增一个支付商，填上网关地址、商户号和加密金钥后就能发付款链接。" />
        : <div className="pay-provider-list">{providers.map((provider) => <article key={provider.id} className="pay-provider-card">
          <header>
            <div>
              <strong>{provider.name}</strong>
              <span className={`pill pill--${provider.enabled ? "enabled" : "disabled"}`}><i />{provider.enabled ? "已启用" : "已停用"}</span>
              {!provider.hasSecureKey && <span className="pay-status pay-status--fail"><i />未配置金钥</span>}
            </div>
            <small>{provider.code} · {provider.kind}</small>
          </header>
          <dl>
            <div><dt>网关地址</dt><dd>{provider.gatewayBase}/{provider.requestPrefix}</dd></div>
            <div><dt>商户号</dt><dd>{provider.merchantCode}</dd></div>
            <div><dt>回调源 IP</dt><dd>{provider.callbackIp || "—"}</dd></div>
            <div><dt>加密金钥</dt><dd>{provider.hasSecureKey ? "已配置（加密保存）" : "未配置"}</dd></div>
            <div><dt>单笔范围</dt><dd>¥ {money(provider.minAmount)} ~ {money(provider.maxAmount)}</dd></div>
            <div><dt>开放通道</dt><dd>{provider.channels.filter((item) => item.enabled).length} / {provider.channels.length}</dd></div>
          </dl>
          {provider.remark && <p className="pay-provider-remark">{provider.remark}</p>}
          <footer>
            <div className="pay-channel-chips">{provider.channels.map((channel) =>
              <span key={channel.code} className={channel.enabled ? "is-on" : ""}>{channel.name}</span>)}</div>
            {canConfig && <div className="row-actions">
              <button onClick={() => setEditing(provider)}>编辑</button>
              <button onClick={() => setChannelEditing(provider)}>配置通道</button>
            </div>}
          </footer>
        </article>)}</div>}
    </section>

    {editing && <ProviderModal provider={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={async (message) => { setEditing(null); await reload(); notify(message); }} notify={notify} />}
    {channelEditing && <ChannelsModal provider={channelEditing} onClose={() => setChannelEditing(null)}
      onSaved={async (message) => { setChannelEditing(null); await reload(); notify(message); }} notify={notify} />}
  </>;
}

function BaseURLForm({ baseUrl, canConfig, reload, notify }: {
  baseUrl: string;
  canConfig: boolean;
  reload: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [value, setValue] = useState(baseUrl);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(baseUrl); }, [baseUrl]);
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/pay/settings", { method: "PUT", ...jsonBody({ baseUrl: value.trim() }) });
      await reload();
      notify("付款链接域名已保存");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  };
  return <div className="pay-link-grid pay-link-grid--narrow">
    <Field label="对外域名" hint="留空则用后台当前访问的域名。玩家点开的链接是「域名 + /pay?t=…」。">
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://admin.example.com/xuanmanager" disabled={!canConfig} spellCheck={false} />
    </Field>
    <div className="pay-link-actions">
      <Button disabled={!canConfig || busy || value.trim() === baseUrl} onClick={() => void save()}>{busy ? "保存中…" : "保存域名"}</Button>
    </div>
  </div>;
}

function ProviderModal({ provider, onClose, onSaved, notify }: {
  provider: PayProvider | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [form, setForm] = useState({
    code: provider?.code ?? "",
    name: provider?.name ?? "",
    kind: provider?.kind ?? "sdmpay",
    gatewayBase: provider?.gatewayBase ?? "https://payment.sdmpay.xyz",
    requestPrefix: provider?.requestPrefix ?? "",
    merchantCode: provider?.merchantCode ?? "",
    secureKey: "",
    callbackIp: provider?.callbackIp ?? "",
    remark: provider?.remark ?? "",
    minAmount: amountText(provider?.minAmount) || "1",
    maxAmount: amountText(provider?.maxAmount) || "50000",
    enabled: provider?.enabled ?? true,
    sortOrder: String(provider?.sortOrder ?? 10),
  });
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setBusy(true);
    try {
      await api(provider ? `/api/pay/providers/${provider.id}` : "/api/pay/providers", {
        method: provider ? "PUT" : "POST",
        ...jsonBody({ ...form, sortOrder: Number(form.sortOrder) || 0 }),
      });
      await onSaved(provider ? "支付商已保存" : "支付商已新增");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "保存失败", "error");
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={provider ? `编辑支付商 · ${provider.name}` : "新增支付商"} eyebrow="PAYMENT PROVIDER" onClose={onClose} wide>
    <div className="form-grid">
      <Field label="内部标识" hint="小写字母、数字、下划线，保存后别乱改"><input value={form.code} onChange={(event) => update("code", event.target.value)} placeholder="sdmpay_bf" disabled={Boolean(provider)} /></Field>
      <Field label="展示名称"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="雷马支付（BF）" /></Field>
      <Field label="网关地址" hint="API 文档里的正式环境根地址"><input value={form.gatewayBase} onChange={(event) => update("gatewayBase", event.target.value)} placeholder="https://payment.sdmpay.xyz" spellCheck={false} /></Field>
      <Field label="商户请求位址" hint="拼在网关地址后面那一段"><input value={form.requestPrefix} onChange={(event) => update("requestPrefix", event.target.value)} placeholder="BF" spellCheck={false} /></Field>
      <Field label="商户号"><input value={form.merchantCode} onChange={(event) => update("merchantCode", event.target.value)} placeholder="MPVUY4S0JY" spellCheck={false} /></Field>
      <Field label="加密金钥" hint={provider?.hasSecureKey ? "已配置，留空表示不修改" : "对接文档里的 Secure key，保存后加密存储，不会再显示"}>
        <input value={form.secureKey} onChange={(event) => update("secureKey", event.target.value)} placeholder={provider?.hasSecureKey ? "••••••••（留空不修改）" : "填入 Secure key"} type="password" autoComplete="new-password" spellCheck={false} />
      </Field>
      <Field label="回调源 IP" hint="服务商推回调用的固定 IP，只作核对参考"><input value={form.callbackIp} onChange={(event) => update("callbackIp", event.target.value)} placeholder="34.146.6.47" spellCheck={false} /></Field>
      <Field label="单笔最小金额"><input value={form.minAmount} onChange={(event) => update("minAmount", event.target.value)} inputMode="decimal" /></Field>
      <Field label="单笔最大金额"><input value={form.maxAmount} onChange={(event) => update("maxAmount", event.target.value)} inputMode="decimal" /></Field>
      <Field label="排序"><input value={form.sortOrder} onChange={(event) => update("sortOrder", event.target.value)} inputMode="numeric" /></Field>
      <Field label="启用状态" as="div">
        <label className="confirm-check"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span>启用这家支付商（停用后无法再生成链接）</span></label>
      </Field>
      <Field label="备注" as="div"><input value={form.remark} onChange={(event) => update("remark", event.target.value)} placeholder="内部说明，例如后台地址、对接人" /></Field>
    </div>
    <div className="form-actions">
      <Button variant="secondary" onClick={onClose}>取消</Button>
      <Button disabled={busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存支付商"}</Button>
    </div>
  </Modal>;
}

function ChannelsModal({ provider, onClose, onSaved, notify }: {
  provider: PayProvider;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [items, setItems] = useState<PayChannel[]>(() => provider.channels.map((item) => ({
    ...item,
    // 后台统一按整数展示：接口返回的是 "500.00"，这里只动显示，保存时服务端再归一成两位小数。
    presetAmounts: item.presetAmounts.map((value) => amountText(value)),
    minAmount: amountText(item.minAmount),
    maxAmount: amountText(item.maxAmount),
  })));
  const [busy, setBusy] = useState(false);
  const patch = (index: number, changes: Partial<PayChannel>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...changes } : item));
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/pay/providers/${provider.id}/channels`, { method: "PUT", ...jsonBody({ channels: items }) });
      await onSaved("付款通道已保存，玩家下次打开链接就按新配置显示");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "保存通道失败", "error");
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={`配置通道 · ${provider.name}`} eyebrow="CHECKOUT CHANNELS" onClose={onClose} xwide>
    <p className="pay-modal-hint">玩家付款页上的每个 Tab 就是这里的一条通道；关掉就看不到，档位决定页面上那排金额按钮。金额直接填整数，例如 <code>500,1000,2000,5000</code>。</p>
    <div className="table-wrap">
      <table className="pay-table pay-channel-table">
        <thead><tr><th>启用</th><th>通道代码</th><th>显示名称</th><th>金额档位</th><th>最小</th><th>最大</th><th>需填姓名</th></tr></thead>
        <tbody>{items.map((item, index) => <tr key={item.code}>
          <td><input type="checkbox" checked={item.enabled} onChange={(event) => patch(index, { enabled: event.target.checked })} /></td>
          <td><code>{item.code}</code></td>
          <td><input value={item.name} onChange={(event) => patch(index, { name: event.target.value })} /></td>
          <td><input className="pay-amounts-input" value={item.presetAmounts.join(",")} onChange={(event) => patch(index, {
            presetAmounts: event.target.value.split(",").map((part) => part.trim()).filter(Boolean),
          })} placeholder="500,1000,2000" /></td>
          <td><input className="pay-small-input" value={item.minAmount} onChange={(event) => patch(index, { minAmount: event.target.value })} /></td>
          <td><input className="pay-small-input" value={item.maxAmount} onChange={(event) => patch(index, { maxAmount: event.target.value })} /></td>
          <td><input type="checkbox" checked={item.requirePayer || item.payerLocked} disabled={item.payerLocked}
            title={item.payerLocked ? "该通道在服务商侧必须带付款人姓名，不能关闭" : "打开后玩家必须填写付款人姓名"}
            onChange={(event) => patch(index, { requirePayer: event.target.checked })} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="pay-modal-hint">「需填姓名」用于网关实名制/小额/转账这类必须核对付款人的通道：<strong>网关实名制、小额、包司抗投、转账、固码通道由系统锁定为必填</strong>（灰色勾选框），关掉会导致建单被服务商拒绝；其他通道可以自己开关。</p>
    <div className="form-actions">
      <Button variant="secondary" onClick={onClose}>取消</Button>
      <Button disabled={busy} onClick={() => void submit()}>{busy ? "保存中…" : "保存通道"}</Button>
    </div>
  </Modal>;
}
