import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { EmptyState, LoadingBlock, PageHeader, formatDate } from "../../components/ui";
import { DemoNote, ErrorBanner, Pagination, targetTypeLabel, type AutomationPageProps } from "./shared";
import type { AuditItem } from "../../types";

interface AuditResponse { items: AuditItem[]; page: number; pageSize: number; total: number }

export default function AutomationAuditPage({ notify }: AutomationPageProps) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<AuditResponse>(`/api/automation/audit?keyword=${encodeURIComponent(query)}&page=${targetPage}&pageSize=${targetSize}`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "自动化审计加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="AUTOMATION AUDIT"
      title="自动化审计"
      description="查看自动化域的后台操作记录，包括终端启停、批量操作、策略发布、审批和凭据维护。"
      actions={<button type="button" className="button button--secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新"}</button>}
    />

    <DemoNote>审计记录来自后台操作日志，只展示 automation 相关动作；密码等敏感字段不会进入审计内容。</DemoNote>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索操作者、动作或目标 ID" />
          <button>搜索</button>
        </form>
        <div className="automation-filter-row">
          <span className="toolbar__count">共 {data?.total ?? 0} 条记录</span>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!data && loading ? <LoadingBlock label="正在读取自动化审计" /> : !data || data.items.length === 0 ? <EmptyState title="没有匹配记录" description="可以调整关键词后重新搜索。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>时间（北京时间）</th><th>操作者</th><th>操作</th><th>目标</th><th>结果</th><th>来源 IP</th></tr></thead>
            <tbody>{data.items.map((item) => <tr key={item.id}>
              <td>{formatDate(item.createdAt)}</td>
              <td><strong>{item.operatorName || "系统"}</strong></td>
              <td><code>{item.action}</code></td>
              <td>{targetTypeLabel(item.targetType)}<small className="cell-subtitle">#{item.targetId || "—"}{item.targetName && item.targetName !== item.targetId ? ` ${item.targetName}` : ""}</small></td>
              <td><span className={`result-text ${item.resultCode === 0 ? "is-success" : "is-error"}`}>{item.resultCode === 0 ? "成功" : "失败"}</span><small className="cell-subtitle">{item.resultMessage}</small></td>
              <td>{item.ip || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>
  </div>;
}
