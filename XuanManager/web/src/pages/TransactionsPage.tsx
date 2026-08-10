import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type { TransactionItem, TransactionResponse } from "../types";

interface TransactionFilters {
  keyword: string;
  category: string;
  direction: string;
  optionType: string;
  startDate: string;
  endDate: string;
}

interface ReadableTransactionField {
  label: string;
  value: string;
}

const emptyFilters: TransactionFilters = {
  keyword: "", category: "all", direction: "all", optionType: "", startDate: "", endDate: "",
};

const categoryLabels: Record<TransactionItem["category"], string> = {
  game: "游戏输赢", item: "道具消费", consumption: "其他消费", adjustment: "人工调整", other: "其他变化",
};

const goldFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TransactionsPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const initialPlayerId = useMemo(() => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("playerId")?.trim() ?? "", []);
  const [playerIdDraft, setPlayerIdDraft] = useState(initialPlayerId);
  const [playerId, setPlayerId] = useState(initialPlayerId);
  const [requestVersion, setRequestVersion] = useState(0);
  const [data, setData] = useState<TransactionResponse | null>(null);
  const [draft, setDraft] = useState<TransactionFilters>(emptyFilters);
  const [applied, setApplied] = useState<TransactionFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TransactionItem | null>(null);

  const queryString = useMemo(() => {
    if (!playerId) return "";
    const params = new URLSearchParams({ playerId, page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean && clean !== "all") params.set(key, clean);
    }
    params.set("requestVersion", String(requestVersion));
    return params.toString();
  }, [playerId, applied, page, pageSize, requestVersion]);

  const load = useCallback(async () => {
    if (!queryString) return;
    setLoading(true);
    try {
      setData(await api<TransactionResponse>(`/api/game/transactions?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "金币交易记录加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, notify]);
  useEffect(() => { void load(); }, [load]);

  const searchPlayer = () => {
    const clean = playerIdDraft.trim();
    if (!clean) { notify("请输入游戏用户ID", "error"); return; }
    setPlayerId(clean);
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
    setData(null);
    setRequestVersion((value) => value + 1);
  };
  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as unknown as TransactionFilters);
    setPage(1);
  };
  const resetFilters = () => { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); };
  const update = (key: keyof TransactionFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const activeFilterCount = Object.values(applied).filter((value) => Boolean(value) && value !== "all").length;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="GOLD LEDGER"
        title="交易记录"
        description="按游戏用户ID查询全部金币变化，包括游戏输赢、消费和道具记录；本游戏不使用钻石。"
        actions={<span className="readonly-badge"><i />金币只读流水</span>}
      />

      <section className="panel transaction-player-search">
        <div className="transaction-search-copy"><span>STEP 01</span><strong>输入游戏用户ID</strong><p>精确查询该玩家全部金币变化记录，不接受昵称代替用户ID。</p></div>
        <form onSubmit={(event) => { event.preventDefault(); searchPlayer(); }}>
          <div className="search-box transaction-id-input"><span>ID</span><input value={playerIdDraft} onChange={(event) => setPlayerIdDraft(event.target.value)} placeholder="例如 292989" autoComplete="off" /><button type="submit">查询金币记录</button></div>
        </form>
      </section>

      {!playerId && (
        <section className="panel transaction-welcome">
          <div className="transaction-welcome__mark">账</div><span className="eyebrow">PLAYER GOLD HISTORY</span><h2>查询某个玩家的完整金币账本</h2>
          <p>输入游戏用户ID后，可以看到每一笔金币变更前余额、实际增减、变更后余额、业务类型和关联参数。</p>
          <div><span>游戏输赢</span><span>金币消费</span><span>道具记录</span><span>人工调整</span></div>
        </section>
      )}

      {loading && !data && playerId && <section className="panel"><LoadingBlock label="正在读取玩家金币账本" /></section>}

      {data && (
        <>
          <section className="transaction-player-card">
            <div className="transaction-player-avatar">{data.player.name.slice(0, 1) || "玩"}</div>
            <div><span className="eyebrow">PLAYER ACCOUNT</span><h2>{data.player.name || "未设置昵称"}</h2><p>游戏ID：<code>{data.player.playerId}</code> · 登录账号：{data.player.loginName || "—"}</p></div>
            <div className="transaction-current-balance"><small>当前金币余额</small><strong>{goldFormatter.format(data.player.currentBalance)}</strong><span>共 {data.player.totalRecords} 条历史流水</span></div>
          </section>

          <section className="transaction-metrics">
            <GoldMetric tone="balance" label="当前金币" value={data.player.currentBalance} note="玩家账号当前余额" />
            <GoldMetric tone="in" label="筛选范围流入" value={data.summary.totalIn} prefix="+" note={`${data.summary.recordCount} 条符合条件的记录`} />
            <GoldMetric tone="out" label="筛选范围流出" value={data.summary.totalOut} prefix="−" note={`其中道具消费 ${goldFormatter.format(data.summary.itemSpend)}`} />
            <GoldMetric tone={data.summary.netChange >= 0 ? "net" : "out"} label="筛选范围净变化" value={Math.abs(data.summary.netChange)} prefix={data.summary.netChange > 0 ? "+" : data.summary.netChange < 0 ? "−" : ""} note={`游戏相关净变化 ${formatSigned(data.summary.gameNet)}`} />
          </section>

          <section className="panel transaction-filter-panel">
            <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
              <div className="transaction-filter-grid">
                <Field label="交易分类"><select value={draft.category} onChange={(event) => update("category", event.target.value)}><option value="all">全部分类</option><option value="game">游戏输赢</option><option value="item">道具消费</option><option value="consumption">其他消费</option><option value="adjustment">人工调整</option><option value="other">其他变化</option></select></Field>
                <Field label="金币方向"><select value={draft.direction} onChange={(event) => update("direction", event.target.value)}><option value="all">全部方向</option><option value="in">金币增加</option><option value="out">金币减少</option><option value="unchanged">余额未变</option></select></Field>
                <Field label="原始业务类型"><select value={draft.optionType} onChange={(event) => update("optionType", event.target.value)}><option value="">全部业务类型</option>{data.optionTypes.map((item) => <option key={item.name} value={item.name}>{item.name}（{item.count}）</option>)}</select></Field>
                <Field label="关联参数"><input value={draft.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="房间号、局号、道具说明等" /></Field>
                <Field label="开始日期"><input type="date" value={draft.startDate} onChange={(event) => update("startDate", event.target.value)} /></Field>
                <Field label="结束日期"><input type="date" value={draft.endDate} onChange={(event) => update("endDate", event.target.value)} /></Field>
                <div className="transaction-filter-actions"><Button type="submit">应用筛选{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置条件</Button></div>
              </div>
            </form>
          </section>

          <section className="transaction-rule-note"><span>i</span><div><strong>实际金币变化计算规则</strong><p>金币变化 = 变更后余额 − 变更前余额。原始“业务金额”可能使用玩法内部符号，仅作为核对字段，不直接当作金币增减。</p></div></section>

          <section className="panel">
            <div className="toolbar player-toolbar"><div><strong>{data.player.name || data.player.playerId} 的金币流水</strong><span>数据来自服务器主金币流水 usr_cash_water，不重复合并辅助分项表</span></div><span className="toolbar__count">筛选结果 {data.total} 条</span></div>
            {data.items.length === 0 ? <EmptyState title="没有符合条件的金币记录" description="可以重置筛选条件，或更换查询日期后再试。" /> : (
              <>
                <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
                  <table className="transaction-table"><thead><tr><th>时间</th><th>分类 / 类型</th><th>实际金币变化</th><th>变更前 → 变更后</th><th>业务金额</th><th>关联说明</th><th className="align-right">操作</th></tr></thead>
                    <tbody>{data.items.map((item) => <TransactionRow key={item.id} item={item} onSelect={() => setSelected(item)} />)}</tbody></table>
                </div>
                <footer className="table-pagination"><span>显示 {firstRow}–{lastRow}，共 {data.total} 条</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {totalPages}</strong><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
              </>
            )}
          </section>
        </>
      )}

      {selected && <TransactionDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function GoldMetric({ tone, label, value, prefix = "", note }: { tone: string; label: string; value: number; prefix?: string; note: string }) {
  return <article className={`gold-metric gold-metric--${tone}`}><span>{label}</span><strong>{prefix}{goldFormatter.format(value)}</strong><p>{note}</p></article>;
}

function CategoryBadge({ category }: { category: TransactionItem["category"] }) {
  return <span className={`transaction-category transaction-category--${category}`}>{categoryLabels[category]}</span>;
}

function TransactionRow({ item, onSelect }: { item: TransactionItem; onSelect: () => void }) {
  return <tr><td><strong>{item.date}</strong><small className="cell-subtitle">{item.time}</small></td><td><CategoryBadge category={item.category} /><small className="cell-subtitle">{item.optionType}</small></td><td><strong className={`gold-change gold-change--${item.direction}`}>{formatSigned(item.change)}</strong></td><td><span className="balance-route">{goldFormatter.format(item.oldBalance)}<i>→</i><strong>{goldFormatter.format(item.newBalance)}</strong></span></td><td>{formatSigned(item.businessAmount)}</td><td><TransactionDescription item={item} /></td><td><div className="row-actions"><button onClick={onSelect}>查看明细</button></div></td></tr>;
}

function TransactionDescription({ item }: { item: TransactionItem }) {
  const fields = readableTransactionFields(item, false);
  if (fields.length === 0) return <span className="transaction-description transaction-description--empty">无关联信息</span>;
  return <span className="transaction-description">{fields.map((field, index) => <span className={`transaction-description__item ${field.label === "维护原因" ? "is-maintenance" : ""}`} key={`${field.label}-${index}`}><small>{field.label}</small><strong>{field.value}</strong></span>)}</span>;
}

function TransactionDetail({ item, onClose }: { item: TransactionItem; onClose: () => void }) {
  const fields = readableTransactionFields(item, true);
  return <Modal wide title={`${item.optionType} · 金币明细`} eyebrow="GOLD CHANGE DETAIL" onClose={onClose}>
    <div className="transaction-detail-heading"><CategoryBadge category={item.category} /><div><strong className={`gold-change gold-change--${item.direction}`}>{formatSigned(item.change)} 金币</strong><p>{item.occurredAt} · 流水ID {item.id}</p></div></div>
    <section className="player-detail-section"><h3>金币余额变化</h3><div className="transaction-balance-flow"><div><span>变更前</span><strong>{goldFormatter.format(item.oldBalance)}</strong></div><i>→</i><div className="is-final"><span>变更后</span><strong>{goldFormatter.format(item.newBalance)}</strong></div><div><span>原始业务金额</span><strong>{formatSigned(item.businessAmount)}</strong></div></div></section>
    <section className="player-detail-section"><h3>业务信息</h3><div className="player-detail-grid"><Detail label="玩家" value={`${item.playerName || "未设置昵称"}（${item.playerId}）`} /><Detail label="交易分类" value={categoryLabels[item.category]} /><Detail label="原始业务类型" value={item.optionType} /><Detail label="实际方向" value={item.direction === "in" ? "金币增加" : item.direction === "out" ? "金币减少" : "余额未变化"} /></div></section>
    {item.maintenanceReason && <section className="player-detail-section transaction-maintenance-section"><h3>客服维护信息</h3><div className="transaction-maintenance-reason"><span>维护原因</span><strong>{item.maintenanceReason}</strong></div><div className="player-detail-grid"><Detail label="后台操作人" value={item.maintenanceOperator || "—"} /><Detail label="维护工单号" value={item.maintenanceWorkOrder || "—"} /></div></section>}
    <section className="player-detail-section"><h3>业务关联信息</h3><div className="transaction-remarks">{fields.length > 0 ? fields.map((field, index) => <div key={`${field.label}-${index}`}><span>{field.label}</span><strong>{field.value}</strong></div>) : <div><span>关联信息</span><strong>无</strong></div>}</div><p className="transaction-detail-note">后台已根据交易类型解释服务器参数；结算场景同时保留原始码，便于运营核对。</p></section>
  </Modal>;
}

function readableTransactionFields(item: TransactionItem, detailed: boolean): ReadableTransactionField[] {
  const fields: ReadableTransactionField[] = [];
  const roomId = item.remark1.trim();
  const roomName = item.remark2.trim();
  const round = item.remark3.trim();
  const businessDetail = item.remark4.trim();
  const extraDetail = item.remark5.trim();
  const add = (label: string, value: string) => { if (value) fields.push({ label, value }); };


  if (!detailed) add("维护原因", item.maintenanceReason);

  const isRoomTransaction = ["带入", "打局", "芒皮", "揍芒", "休芒", "结算"].includes(item.optionType);
  if (isRoomTransaction) {
    add("房间", roomId);
    if (detailed) add("房间名称", roomName);
    if (round && round !== "0") add("牌局", `第 ${round} 局`);
    if (item.optionType === "结算" && (!round || round === "0")) add("牌局", "未产生有效牌局");
  }

  switch (item.optionType) {
    case "带入":
      add("累计带入", readableGoldValue(businessDetail));
      add("本次带入", readableGoldValue(extraDetail));
      break;
    case "打局":
      add("累计带入", readableGoldValue(businessDetail));
      break;
    case "芒皮":
    case "揍芒":
    case "休芒":
      add("操作后牌桌余额", readableGoldValue(businessDetail));
      break;
    case "结算":
      add("累计带入", readableGoldValue(businessDetail));
      add("结算类型", readableSettlementType(extraDetail, detailed));
      break;
    case "消费":
      add("消费项目", businessDetail);
      add("消费说明", readableConsumptionNote(extraDetail));
      break;
    case "补分":
    case "扣分":
    case "退款":
      add("服务记录金额", readableGoldValue(roomId));
      if (detailed) add("服务记录余额", readableGoldValue(roomName));
      break;
    default:
      add("业务说明", businessDetail);
      add("补充说明", extraDetail);
      break;
  }
  return fields;
}

function readableSettlementType(code: string, includeRawCode: boolean) {
  const label = code === "13" ? "有效牌局正常结算" : code === "12" ? "未产生有效牌局的结算" : "其他结算场景";
  return includeRawCode && code ? `${label}（原始码 ${code}）` : label;
}

function readableConsumptionNote(value: string) {
  const match = /^用([\d.]+)角-余([\d.]+)分$/.exec(value);
  return match ? `使用 ${match[1]} 角，剩余 ${match[2]} 分` : value;
}

function readableGoldValue(value: string) {
  return value ? `${value} 金币` : "";
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return <div className="detail-item"><span>{label}</span><strong>{value === "" ? "—" : value}</strong></div>;
}

function formatSigned(value: number) {
  if (value > 0) return `+${goldFormatter.format(value)}`;
  if (value < 0) return `−${goldFormatter.format(Math.abs(value))}`;
  return goldFormatter.format(0);
}
