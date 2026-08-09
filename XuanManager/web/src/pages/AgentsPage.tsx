import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type { AgentBonusResponse, AgentChildItem, AgentChildrenResponse, AgentItem, AgentRelationship, AgentSummary } from "../types";

interface AgentResponse {
  items: AgentItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: AgentSummary;
}

interface AgentFilters {
  keyword: string;
  type: string;
  parentId: string;
  parentName: string;
  level: string;
  minPercent: string;
  maxPercent: string;
  registeredFrom: string;
  registeredTo: string;
}

const emptyFilters: AgentFilters = {
  keyword: "", type: "all", parentId: "", parentName: "", level: "",
  minPercent: "", maxPercent: "", registeredFrom: "", registeredTo: "",
};

const typeLabels: Record<AgentItem["type"], string> = {
  boss: "BOSS", leader: "盟主", agent: "代理", partner: "合伙人", chief: "总裁", player: "玩家",
};

const chainLabels: Record<string, string> = {
  root: "BOSS 根节点", linked: "已有直属上级", healthy: "链路正常", broken: "链路断开",
  conflict: "数据冲突", cycle: "存在循环", depth_limit: "层级过深",
};

interface AgentBonusFilters {
  type: "all" | "income" | "withdrawal";
  sourcePlayerId: string;
  roomId: string;
  dateFrom: string;
  dateTo: string;
}

const emptyBonusFilters: AgentBonusFilters = { type: "all", sourcePlayerId: "", roomId: "", dateFrom: "", dateTo: "" };
const bonusFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AgentsPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<AgentResponse | null>(null);
  const [draft, setDraft] = useState<AgentFilters>(emptyFilters);
  const [applied, setApplied] = useState<AgentFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<AgentItem | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean && !(key === "type" && clean === "all")) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<AgentResponse>(`/api/game/agents?${queryString}`));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "代理数据加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, notify]);
  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as unknown as AgentFilters);
    setPage(1);
  };
  const resetFilters = () => { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); };
  const update = (key: keyof AgentFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const activeFilterCount = Object.entries(applied).filter(([key, value]) => Boolean(value) && !(key === "type" && value === "all")).length;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const summary = data?.summary;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AGENT NETWORK"
        title="代理管理"
        description="以 BOSS 为根节点，只读查询代理、盟主、上下级授权链路、下级玩家、分红比例和红利流水。"
        actions={<span className="readonly-badge"><i />只读关系数据</span>}
      />

      <section className="agent-metrics">
        <Metric tone="gold" mark="B" label="BOSS 根节点" value={summary?.bossCount ?? 0} note="所有正常代理链路的起点" />
        <Metric tone="cyan" mark="盟" label="盟主" value={summary?.leaderCount ?? 0} note="已具备盟主身份的账号" />
        <Metric tone="blue" mark="代" label="其他代理" value={summary?.agentCount ?? 0} note={`代理体系共 ${summary?.totalCount ?? 0} 个节点`} />
        <Metric tone="green" mark="链" label="已记录上级" value={summary?.linkedCount ?? 0} note="可继续查看是否完整回溯 BOSS" />
      </section>

      <section className="panel player-filter-panel agent-filter-panel">
        <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <div className="player-filter-primary">
            <div className="search-box search-box--wide">
              <span>⌕</span>
              <input value={draft.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="输入代理ID、登录账号、名字、上级ID或上级名字" />
            </div>
            <label className="agent-type-select">
              <span>类型</span>
              <select value={draft.type} onChange={(event) => update("type", event.target.value)}>
                <option value="all">全部节点</option><option value="boss">BOSS</option><option value="leader">盟主</option>
                <option value="agent">普通代理</option><option value="partner">合伙人</option><option value="chief">总裁</option>
              </select>
            </label>
            <Button type="submit">查询代理</Button>
            <Button type="button" variant="secondary" onClick={() => setAdvanced((value) => !value)}>
              {advanced ? "收起条件" : "更多条件"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </Button>
            {activeFilterCount > 0 && <button className="filter-reset" type="button" onClick={resetFilters}>清空筛选</button>}
          </div>
          {advanced && (
            <div className="player-filter-advanced">
              <Field label="直属上级ID"><input value={draft.parentId} onChange={(event) => update("parentId", event.target.value)} placeholder="精确匹配" /></Field>
              <Field label="直属上级名字"><input value={draft.parentName} onChange={(event) => update("parentName", event.target.value)} placeholder="支持部分匹配" /></Field>
              <Field label="游戏等级"><input type="number" min="0" value={draft.level} onChange={(event) => update("level", event.target.value)} placeholder="例如 98 / 99" /></Field>
              <Field label="最低盟主比例"><input type="number" min="0" max="100" value={draft.minPercent} onChange={(event) => update("minPercent", event.target.value)} placeholder="0–100" /></Field>
              <Field label="最高盟主比例"><input type="number" min="0" max="100" value={draft.maxPercent} onChange={(event) => update("maxPercent", event.target.value)} placeholder="0–100" /></Field>
              <Field label="成为代理开始日期"><input type="date" value={draft.registeredFrom} onChange={(event) => update("registeredFrom", event.target.value)} /></Field>
              <Field label="成为代理结束日期"><input type="date" value={draft.registeredTo} onChange={(event) => update("registeredTo", event.target.value)} /></Field>
              <div className="filter-actions"><Button type="submit">应用组合条件</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置</Button></div>
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div><strong>代理与盟主列表</strong><span>代理关系以 third_marketing_info 为主，游戏账号字段用于交叉校验</span></div>
          <span className="toolbar__count">当前筛选 {data?.total ?? 0} 个节点</span>
        </div>
        {loading && !data ? <LoadingBlock label="正在读取代理关系" /> : !data || data.items.length === 0 ? (
          <EmptyState title="没有找到代理" description="可以切换代理类型或清空部分查询条件后重新搜索。" />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="agent-table">
                <thead><tr><th>代理账号</th><th>身份 / 等级</th><th>直属上级</th><th>直属下级</th><th>分红比例</th><th>授权链状态</th><th>成为代理时间</th><th className="align-right">操作</th></tr></thead>
                <tbody>{data.items.map((agent) => (
                  <tr key={agent.id}>
                    <td><div className="user-cell"><span>{agent.isBoss ? "B" : agent.name.slice(0, 1) || "代"}</span><div><strong>{agent.name || "未设置名字"}</strong><small>ID：{agent.agentId} · {agent.loginName || "无登录名"}</small></div></div></td>
                    <td><TypeBadge type={agent.type} /><small className="cell-subtitle">等级 {agent.level} · {agent.role || "无角色标记"}</small></td>
                    <td>{agent.isBoss ? <strong className="boss-root-label">根节点</strong> : agent.parentId ? <><strong>{agent.parentName || "上级账号未找到"}</strong><small className="cell-subtitle">ID：{agent.parentId}</small></> : <span className="chain-warning">缺少直属上级</span>}</td>
                    <td><strong>{agent.directAgentCount} 个代理</strong><small className="cell-subtitle">{agent.directPlayerCount} 名玩家</small></td>
                    <td><strong className="percent-value">盟主 {agent.bigPercent}%</strong><small className="cell-subtitle">合伙人 {agent.superPercent}%</small></td>
                    <td><ChainBadge state={agent.chainState} /></td>
                    <td>{agent.registeredProxyAt || "—"}</td>
                    <td><div className="row-actions"><button onClick={() => setSelected(agent)}>查看详情</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <footer className="table-pagination">
              <span>显示 {firstRow}–{lastRow}，共 {data.total} 条</span>
              <div>
                <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
                <strong>{page} / {totalPages}</strong>
                <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
              </div>
            </footer>
          </>
        )}
      </section>

      {selected && <AgentRelationshipModal agent={selected} notify={notify} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Metric({ tone, mark, label, value, note }: { tone: string; mark: string; label: string; value: number; note: string }) {
  return <article className={`agent-metric agent-metric--${tone}`}><span>{mark}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

function TypeBadge({ type }: { type: AgentItem["type"] }) {
  return <span className={`agent-type agent-type--${type}`}>{typeLabels[type]}</span>;
}

function ChainBadge({ state }: { state: string }) {
  const good = state === "root" || state === "linked" || state === "healthy";
  return <span className={`chain-badge ${good ? "is-good" : "is-warning"}`}><i />{chainLabels[state] ?? state}</span>;
}

function AgentRelationshipModal({ agent, notify, onClose }: { agent: AgentItem; notify: (message: string, kind?: "success" | "error") => void; onClose: () => void }) {
  const [relationship, setRelationship] = useState<AgentRelationship | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [scope, setScope] = useState<"direct" | "all">("direct");
  const [childType, setChildType] = useState("all");
  const [childKeyword, setChildKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [children, setChildren] = useState<AgentChildrenResponse | null>(null);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    let active = true;
    setDetailLoading(true);
    api<AgentRelationship>(`/api/game/agents/${encodeURIComponent(agent.agentId)}/relationship`)
      .then((result) => { if (active) setRelationship(result); })
      .catch((reason) => notify(reason instanceof ApiError ? reason.message : "代理链路加载失败", "error"))
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [agent.agentId, notify]);

  const childrenQuery = useMemo(() => {
    const params = new URLSearchParams({ scope, type: childType, page: String(page), pageSize: String(pageSize) });
    if (appliedKeyword) params.set("keyword", appliedKeyword);
    return params.toString();
  }, [scope, childType, page, pageSize, appliedKeyword]);
  useEffect(() => {
    let active = true;
    setChildrenLoading(true);
    api<AgentChildrenResponse>(`/api/game/agents/${encodeURIComponent(agent.agentId)}/children?${childrenQuery}`)
      .then((result) => { if (active) setChildren(result); })
      .catch((reason) => notify(reason instanceof ApiError ? reason.message : "下级数据加载失败", "error"))
      .finally(() => { if (active) setChildrenLoading(false); });
    return () => { active = false; };
  }, [agent.agentId, childrenQuery, notify]);

  const childPages = Math.max(1, Math.ceil((children?.total ?? 0) / pageSize));
  const current = relationship?.agent ?? agent;

  return (
    <Modal wide title={`${current.name || "代理"} · 代理详情`} eyebrow="AGENT PROFILE" onClose={onClose}>
      {detailLoading && !relationship ? <LoadingBlock label="正在回溯 BOSS 授权链" /> : relationship && (
        <>
          <div className="agent-detail-heading">
            <span>{current.isBoss ? "B" : current.name.slice(0, 1) || "代"}</span>
            <div><strong>{current.name || "未设置名字"}</strong><p>游戏ID：{current.agentId} · 登录账号：{current.loginName || "—"}</p></div>
            <TypeBadge type={current.type} />
          </div>

          <section className="agent-detail-section">
            <div className="agent-section-title"><div><h3>BOSS 授权链路</h3><p>按直属上级逐级回溯，左侧必须从 BOSS 根节点开始。</p></div><ChainBadge state={relationship.chainState} /></div>
            <div className={`chain-message chain-message--${relationship.chainState}`}>{relationship.chainMessage}</div>
            <div className="agent-chain">
              {relationship.chain.map((node, index) => (
                <div className="agent-chain-step" key={`${node.agentId}-${index}`}>
                  {index > 0 && <span className="agent-chain-arrow">→</span>}
                  <article className={node.agentId === current.agentId ? "is-current" : ""}>
                    <header><TypeBadge type={node.type} /><small>第 {index + 1} 层</small></header>
                    <strong>{node.name || "未设置名字"}</strong><code>{node.agentId}</code>
                    <p>等级 {node.level} · 盟主比例 {node.bigPercent}%</p>
                  </article>
                </div>
              ))}
            </div>
          </section>

          <AgentBonusPanel agentId={current.agentId} notify={notify} />

          <section className="agent-detail-section">
            <div className="agent-section-title"><div><h3>身份与分红参数</h3><p>下级账号上的比例表示该下级从上级获授的比例，也是继续向下授权时的上限依据。</p></div></div>
            <div className="agent-detail-grid">
              <Detail label="直属上级" value={current.parentName ? `${current.parentName}（${current.parentId}）` : current.isBoss ? "BOSS 根节点" : current.parentId} />
              <Detail label="游戏等级 / 角色" value={`${current.level} / ${current.role || "无标记"}`} />
              <Detail label="盟主分红比例 / 授权上限" value={`${current.bigPercent}%`} highlight />
              <Detail label="合伙人分红比例" value={`${current.superPercent}%`} highlight />
              <Detail label="直属代理 / 玩家" value={`${current.directAgentCount} / ${current.directPlayerCount}`} />
              <Detail label="成为代理时间" value={current.registeredProxyAt} />
              <Detail label="账号注册时间" value={current.accountRegisteredAt} />
              <Detail label="今日新增下级（记录值）" value={current.todayLowerCount} />
            </div>
          </section>

          <section className="agent-detail-section">
            <div className="agent-section-title"><div><h3>数据库层级槽位</h3><p>对应关系表中的二级、三级、小盟主、大盟主、合伙人和总裁字段。</p></div></div>
            <div className="tier-grid">{relationship.tiers.map((tier) => (
              <div key={tier.key}><span>{tier.name}</span><strong>{tier.agentId ? `${tier.agentName || "未知账号"}（${tier.agentId}）` : "未记录"}</strong></div>
            ))}</div>
          </section>
        </>
      )}

      <section className="agent-detail-section agent-children-section">
        <div className="agent-section-title"><div><h3>下级代理与玩家</h3><p>可在直属下级和全部后代之间切换；“获授比例”读取自下级账号。</p></div></div>
        <div className="agent-child-controls">
          <div className="segmented agent-scope-switch">
            <button type="button" className={scope === "direct" ? "is-active" : ""} onClick={() => { setScope("direct"); setPage(1); }}>直属下级</button>
            <button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => { setScope("all"); setPage(1); }}>全部后代</button>
          </div>
          <label><span>显示</span><select value={childType} onChange={(event) => { setChildType(event.target.value); setPage(1); }}><option value="all">代理和玩家</option><option value="agents">仅代理</option><option value="leaders">仅盟主</option><option value="players">仅玩家</option></select></label>
          <form onSubmit={(event) => { event.preventDefault(); setAppliedKeyword(childKeyword.trim()); setPage(1); }}><input value={childKeyword} onChange={(event) => setChildKeyword(event.target.value)} placeholder="搜索下级ID、账号或名字" /><button type="submit">搜索</button></form>
        </div>
        {children?.truncated && <div className="chain-message chain-message--broken">下级超过 20,000 条，本次已停止继续展开，请缩小查询范围。</div>}
        <div className="child-summary"><span>代理 <strong>{children?.agentCount ?? 0}</strong></span><span>玩家 <strong>{children?.playerCount ?? 0}</strong></span><span>最深 <strong>{children?.maxDepth ?? 0}</strong> 层</span></div>
        {childrenLoading && !children ? <LoadingBlock label="正在读取下级关系" /> : !children || children.items.length === 0 ? (
          <EmptyState title="没有找到下级" description="当前范围内没有符合条件的子代理或玩家。" />
        ) : (
          <>
            <div className={`table-wrap agent-child-table-wrap ${childrenLoading ? "is-loading" : ""}`}>
              <table className="agent-child-table"><thead><tr><th>下级账号</th><th>身份</th><th>所属上级</th><th>关系深度</th><th>获授盟主比例</th><th>合伙人比例</th><th>绑定时间</th></tr></thead>
                <tbody>{children.items.map((child) => <ChildRow key={`${child.id}-${child.depth}`} child={child} />)}</tbody></table>
            </div>
            <footer className="table-pagination compact-pagination">
              <span>共 {children.total} 条</span><div>
                <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
                <button type="button" disabled={page <= 1 || childrenLoading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {childPages}</strong>
                <button type="button" disabled={page >= childPages || childrenLoading} onClick={() => setPage((value) => value + 1)}>下一页</button>
              </div>
            </footer>
          </>
        )}
      </section>
    </Modal>
  );
}

function AgentBonusPanel({ agentId, notify }: { agentId: string; notify: (message: string, kind?: "success" | "error") => void }) {
  const [draft, setDraft] = useState<AgentBonusFilters>(emptyBonusFilters);
  const [applied, setApplied] = useState<AgentBonusFilters>(emptyBonusFilters);
  const [data, setData] = useState<AgentBonusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(applied)) {
      const clean = value.trim();
      if (clean && !(key === "type" && clean === "all")) params.set(key, clean);
    }
    return params.toString();
  }, [applied, page, pageSize]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<AgentBonusResponse>(`/api/game/agents/${encodeURIComponent(agentId)}/bonuses?${query}`)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => notify(reason instanceof ApiError ? reason.message : "代理红利加载失败", "error"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentId, query, notify]);

  const applyFilters = () => {
    setApplied({ ...draft, sourcePlayerId: draft.sourcePlayerId.trim(), roomId: draft.roomId.trim() });
    setPage(1);
  };
  const resetFilters = () => { setDraft(emptyBonusFilters); setApplied(emptyBonusFilters); setPage(1); };
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const summary = data?.summary;

  return (
    <section className="agent-detail-section agent-bonus-section">
      <div className="agent-section-title"><div><h3>代理红利</h3><p>汇总以代理账户字段为准；收入流水逐笔关联产生红利的玩家、房间、计算基数和比例。</p></div><span className="readonly-badge"><i />只读红利数据</span></div>
      {loading && !data ? <LoadingBlock label="正在读取代理红利" /> : data && <>
        <div className="agent-bonus-overview">
          <BonusMetric label="累计总红利" value={data.summary.totalBonus} note="账户累计获得的代理红利" tone="gold" />
          <BonusMetric label="已提取红利" value={data.summary.withdrawnBonus} note="账户累计提取金额" tone="blue" />
          <BonusMetric label="剩余红利" value={data.summary.remainingBonus} note="当前可提取红利余额" tone="green" />
          <BonusMetric label="来源流水合计" value={data.summary.incomeSourceTotal} note={`${data.summary.incomeSourceCount} 笔对局来源`} tone="cyan" />
        </div>
        {!summary?.accountBalanceMatches && <div className="bonus-reconcile bonus-reconcile--warning">账户累计总红利不等于已提取加剩余红利，请联系技术人员核对游戏服务端数据。</div>}
        {!summary?.incomeSourcesMatchTotal && <div className="bonus-reconcile bonus-reconcile--warning">逐笔来源合计与账户累计总红利不一致，页面保留两套数值便于核查。</div>}
        {(summary?.unrecordedWithdrawal ?? 0) > 0 && <div className="bonus-reconcile">账户记录已提取 {bonusFormatter.format(summary?.withdrawnBonus ?? 0)}，其中 {bonusFormatter.format(summary?.unrecordedWithdrawal ?? 0)} 暂无逐笔提取明细；汇总仍以账户值为准。</div>}

        <form className="agent-bonus-filters" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
          <label><span>流水类型</span><select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value as AgentBonusFilters["type"] }))}><option value="all">全部流水</option><option value="income">红利收入</option><option value="withdrawal">红利提取</option></select></label>
          <label><span>来源玩家ID</span><input value={draft.sourcePlayerId} onChange={(event) => setDraft((value) => ({ ...value, sourcePlayerId: event.target.value }))} placeholder="精确查询来源玩家" /></label>
          <label><span>房间号</span><input inputMode="numeric" value={draft.roomId} onChange={(event) => setDraft((value) => ({ ...value, roomId: event.target.value }))} placeholder="查询产生红利的房间" /></label>
          <label><span>开始日期</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft((value) => ({ ...value, dateFrom: event.target.value }))} /></label>
          <label><span>结束日期</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft((value) => ({ ...value, dateTo: event.target.value }))} /></label>
          <div className="agent-bonus-filter-actions"><Button type="submit">查询流水</Button><Button type="button" variant="secondary" onClick={resetFilters}>重置</Button></div>
        </form>

        {data.items.length === 0 ? <EmptyState title="没有红利流水" description="当前代理在所选条件下没有红利收入或提取记录。" /> : <>
          <div className={`table-wrap agent-bonus-table-wrap ${loading ? "is-loading" : ""}`}>
            <table className="agent-bonus-table"><thead><tr><th>时间</th><th>类型</th><th>金额</th><th>红利来源</th><th>来源玩家</th><th>来源房间</th><th>计算依据</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
              <td>{item.occurredAt || "—"}</td>
              <td><span className={`bonus-flow-type bonus-flow-type--${item.type}`}>{item.type === "income" ? "红利收入" : "红利提取"}</span></td>
              <td><strong className={item.amount >= 0 ? "bonus-amount bonus-amount--income" : "bonus-amount bonus-amount--withdrawal"}>{item.amount >= 0 ? "+" : "−"}{bonusFormatter.format(Math.abs(item.amount))}</strong></td>
              <td><strong>{item.sourceType}</strong><small className="cell-subtitle">{item.sourceDescription || "—"}</small></td>
              <td>{item.sourcePlayerId ? <><strong>{item.sourcePlayerName || "未记录名字"}</strong><small className="cell-subtitle">ID：{item.sourcePlayerId}</small></> : "—"}</td>
              <td>{item.roomId ? <><strong>{item.roomName || `房间 ${item.roomId}`}</strong><small className="cell-subtitle">房间号：{item.roomId}</small></> : "—"}</td>
              <td>{item.type === "income" ? <><strong>{item.sourceBase > 0 ? `${bonusFormatter.format(item.sourceBase)} × ${item.rate}%` : "服务端结算"}</strong>{item.sourceLevel && <small className="cell-subtitle">收益层级：{item.sourceLevel}</small>}</> : "账户提取"}</td>
            </tr>)}</tbody></table>
          </div>
          <footer className="table-pagination compact-pagination">
            <span>共 {data.total} 条红利流水</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><strong>{page} / {pages}</strong><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
          </footer>
        </>}
      </>}
    </section>
  );
}

function BonusMetric({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <article className={`agent-bonus-metric agent-bonus-metric--${tone}`}><span>{label}</span><strong>{bonusFormatter.format(value)}</strong><p>{note}</p></article>;
}

function ChildRow({ child }: { child: AgentChildItem }) {
  return <tr><td><strong>{child.name || "未设置名字"}</strong><small className="cell-subtitle">ID：{child.playerId} · {child.loginName || "无登录名"}</small></td><td><TypeBadge type={child.type} /><small className="cell-subtitle">等级 {child.level}</small></td><td>{child.parentName || "未知上级"}<small className="cell-subtitle">ID：{child.parentId}</small></td><td>第 {child.depth} 层</td><td><strong className="percent-value">{child.bigPercent}%</strong></td><td>{child.superPercent}%</td><td>{child.registeredProxyAt || "—"}</td></tr>;
}

function Detail({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  const text = value === "" || value === null || value === undefined ? "—" : String(value);
  return <div className="detail-item"><span>{label}</span><strong className={highlight ? "is-highlight" : ""}>{text}</strong></div>;
}
