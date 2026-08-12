import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { EmptyState, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import type { AuditItem } from "../types";

interface AuditResponse { items: AuditItem[]; total: number; page: number; pageSize: number }

export default function AuditPage({ notify }: { notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(() => {
    void queryRevision;
    api<AuditResponse>(`/api/audit?keyword=${encodeURIComponent(query)}&page=1&pageSize=50`)
      .then(setData)
      .catch((reason) => notify(reason instanceof ApiError ? reason.message : "审计记录加载失败", "error"));
  }, [query, queryRevision, notify]);
  useEffect(load, [load]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="AUDIT TRAIL" title="操作审计" description="查看后台用户的重要操作、结果和来源地址。" />
      <section className="panel">
        <div className="toolbar">
          <form className="search-box" onSubmit={(event) => { event.preventDefault(); setQuery(keyword.trim()); refreshQuery(); }}><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索操作者、动作或目标 ID" /><button>搜索</button></form>
          <span className="toolbar__count">共 {data?.total ?? 0} 条记录</span>
        </div>
        {!data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="没有匹配记录" description="可以调整关键词后重新搜索。" /> : (
          <div className="table-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>目标</th><th>结果</th><th>来源 IP</th></tr></thead><tbody>
            {data.items.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td><strong>{item.operatorName || "系统"}</strong></td><td><code>{item.action}</code></td><td>{item.targetType}<small className="cell-subtitle">#{item.targetId || "—"}</small></td><td><span className={`result-text ${item.resultCode === 0 ? "is-success" : "is-error"}`}>{item.resultCode === 0 ? "成功" : "失败"}</span><small className="cell-subtitle">{item.resultMessage}</small></td><td>{item.ip || "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
