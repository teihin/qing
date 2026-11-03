import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import type { UnionListItem, UnionListResponse } from "../types";

const amountFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("zh-CN");

const statusLabels: Record<string, string> = {
  used: "正常",
  init: "未启用",
  del: "已解散",
};

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/**
 * 联盟管理（联盟模式 V2）。
 *
 * 列出全部联盟与联盟信息；点击「详情」进入俱乐部管理，并按 unionId 过滤出该联盟下的俱乐部。
 * 额度只展示：联盟池在 club_union_info.union_quota，俱乐部额度在 club_guuid_info.union_quota。
 */
export default function UnionsPage({
  can,
  notify,
  onNavigate,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onNavigate: (route: string) => void;
}) {
  const [data, setData] = useState<UnionListResponse | null>(null);
  const [draftKeyword, setDraftKeyword] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (keyword.trim() !== "") params.set("keyword", keyword.trim());
      const result = await api<UnionListResponse>(`/api/game/unions?${params.toString()}`);
      setData(result);
      if (result.total > 0 && page > Math.ceil(result.total / pageSize)) {
        setPage(Math.max(1, Math.ceil(result.total / pageSize)));
      }
    } catch (reason) {
      notify(errorMessage(reason, "联盟列表加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [keyword, notify, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const openClubs = (union: UnionListItem) => {
    const params = new URLSearchParams({ unionId: union.unionId, unionName: union.name });
    onNavigate(`/game/clubs?${params.toString()}`);
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="UNION OPERATIONS"
        title="联盟管理"
        description="联盟模式 V2：查看联盟总群主、联盟池与俱乐部数量；详情进入俱乐部管理查看该联盟下的全部俱乐部。"
        actions={
          <span className="readonly-badge">
            <i />
            {can("game.union.quota_adjust") ? "联盟池以游戏服为准" : "只读：无联盟池注资权限"}
          </span>
        }
      />

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div>
            <strong>全部联盟</strong>
            <span>联盟池额度由平台注资，俱乐部额度由总群主在游戏内授信</span>
          </div>
          <span className="toolbar__count">当前筛选 {data?.total ?? 0} 个联盟</span>
        </div>

        <form
          className="club-filter-panel"
          onSubmit={(event) => {
            event.preventDefault();
            setKeyword(draftKeyword);
            setPage(1);
          }}
        >
          <div className="club-filter-primary">
            <div className="search-box search-box--wide">
              <span>⌕</span>
              <input
                value={draftKeyword}
                onChange={(event) => setDraftKeyword(event.target.value)}
                placeholder="联盟 ID 或联盟名称"
                aria-label="联盟 ID 或联盟名称"
              />
            </div>
            <Button type="submit">查询</Button>
            {keyword.trim() !== "" && (
              <button
                className="filter-reset"
                type="button"
                onClick={() => {
                  setDraftKeyword("");
                  setKeyword("");
                  setPage(1);
                }}
              >
                清空筛选
              </button>
            )}
          </div>
        </form>

        {loading && !data ? (
          <LoadingBlock label="正在读取联盟列表" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="没有找到联盟"
            description="可以按联盟 ID 或名称查询；还没有联盟时，先由俱乐部创建者在游戏内创建。"
          />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="club-table union-table">
                <thead>
                  <tr>
                    <th>联盟</th>
                    <th>总群主</th>
                    <th>俱乐部</th>
                    <th>联盟池</th>
                    <th>已分配</th>
                    <th>状态 / 创建时间</th>
                    <th className="align-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((union) => (
                    <tr key={union.unionId}>
                      <td>
                        <div className="user-cell">
                          <span>盟</span>
                          <div>
                            <strong>{union.name || union.unionId}</strong>
                            <small>联盟码：{union.unionId}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {union.ownerId ? (
                          <>
                            <strong>{union.ownerName || union.ownerId}</strong>
                            <small className="cell-subtitle">
                              总群主 ID：{union.ownerId}
                              {union.ownerClubId ? ` · 俱乐部 ${union.ownerClubName || union.ownerClubId}` : ""}
                            </small>
                          </>
                        ) : (
                          <span className="club-warning">未找到总群主</span>
                        )}
                      </td>
                      <td>
                        <strong>{integerFormatter.format(union.memberCount)} 个</strong>
                        <small className="cell-subtitle">含总群主自己的俱乐部</small>
                      </td>
                      <td>
                        <strong className="club-quota-value">{amountFormatter.format(union.poolQuotaFen / 100)} 元</strong>
                        <small className="cell-subtitle">平台可注资</small>
                      </td>
                      <td>
                        <strong>{amountFormatter.format(union.totalClubQuotaFen / 100)} 元</strong>
                        <small className="cell-subtitle">各俱乐部额度合计</small>
                      </td>
                      <td>
                        <strong>{statusLabels[union.status] ?? union.status ?? "—"}</strong>
                        <small className="cell-subtitle">{union.createdAt || "—"}</small>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => openClubs(union)} title="进入俱乐部管理查看该联盟下的俱乐部">
                            详情
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="table-pagination">
              <span>
                显示 {firstRow}–{lastRow}，共 {data.total} 个联盟
              </span>
              <div>
                <label>
                  每页
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
                  上一页
                </button>
                <strong>
                  {page} / {totalPages}
                </strong>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
