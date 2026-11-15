import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import HonorRankActivityModal from "../components/HonorRankActivityModal";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import type { HonorRankActivity, HonorRankActivityListResponse } from "../types";

type ScopeFilter = "" | "union" | "club";
type PhaseFilter = "" | "pending" | "running" | "finished" | "closed";

const PHASE_LABELS: Record<HonorRankActivity["phase"], string> = {
  pending: "未开始",
  running: "进行中",
  finished: "已结束",
  closed: "已关闭",
};

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

function splitClock(value: string): string {
  return (value || "").slice(0, 5);
}

/**
 * 排行榜：一个列表放历史上所有排行榜活动，创建/查看走弹窗。
 *
 * 活动和游戏服的对应关系：创建时后台把配置下发游戏服（该范围只有一份「当前配置」），
 * 同时留档一条活动；点开活动可以按它自己的时间窗看实时排名（类似客户端排行榜看到的内容），
 * 所以活动结束、甚至被后面的活动覆盖之后，历史排名仍然能回看。
 */
export default function HonorRankPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [scopeType, setScopeType] = useState<ScopeFilter>("");
  const [phase, setPhase] = useState<PhaseFilter>("");
  const [keyword, setKeyword] = useState("");
  const [draftKeyword, setDraftKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [data, setData] = useState<HonorRankActivityListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalId, setModalId] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (scopeType) query.set("scopeType", scopeType);
    if (phase) query.set("phase", phase);
    if (keyword.trim()) query.set("keyword", keyword.trim());
    try {
      const result = await api<HonorRankActivityListResponse>(`/api/game/honor-rank/activities?${query}`);
      setData(result);
      const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > totalPages) setPage(totalPages);
    } catch (reason) {
      setError(errorMessage(reason, "读取排行榜活动失败"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, scopeType, phase, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyKeyword = () => {
    setKeyword(draftKeyword);
    setPage(1);
  };

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canManage = can("game.honor_rank.manage");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="HONOR RANK CAMPAIGNS"
        title="排行榜"
        description="按联盟或独立俱乐部开排行榜活动，创建时下发游戏服，同时留档成历史活动；点开任意活动可看当前实时排名。"
        actions={canManage ? <Button onClick={() => setModalId(null)}>＋ 创建活动</Button> : undefined}
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>历史活动</h2>
            <p>列表按创建时间倒序；状态由活动时间与开关推导，游戏服只保留每个范围最新的一次配置。</p>
          </div>
          <span className="reward-muted">共 {data?.total ?? 0} 场活动</span>
        </div>

        <div className="honor-rank-filters">
          <div className="balance-action-tabs">
            <button type="button" className={scopeType === "" ? "is-active" : ""} onClick={() => { setScopeType(""); setPage(1); }}>
              全部
            </button>
            <button type="button" className={scopeType === "union" ? "is-active" : ""} onClick={() => { setScopeType("union"); setPage(1); }}>
              联盟
            </button>
            <button type="button" className={scopeType === "club" ? "is-active" : ""} onClick={() => { setScopeType("club"); setPage(1); }}>
              独立俱乐部
            </button>
          </div>
          <div className="honor-rank-filters__right">
            <select value={phase} onChange={(event) => { setPhase(event.target.value as PhaseFilter); setPage(1); }}>
              <option value="">全部状态</option>
              <option value="running">进行中</option>
              <option value="pending">未开始</option>
              <option value="finished">已结束</option>
              <option value="closed">已关闭</option>
            </select>
            <input
              value={draftKeyword}
              placeholder="活动名 / 联盟或俱乐部 / 备注"
              onChange={(event) => setDraftKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyKeyword();
              }}
            />
            <Button type="button" variant="secondary" onClick={applyKeyword}>查询</Button>
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? "刷新中…" : "刷新"}
            </Button>
          </div>
        </div>

        {error && <div className="form-error"><span>!</span>{error}</div>}

        {loading && !data ? (
          <LoadingBlock label="正在读取排行榜活动" />
        ) : items.length === 0 ? (
          <EmptyState
            title="还没有排行榜活动"
            description={canManage ? "点右上角「创建活动」，选联盟或独立俱乐部后按原来的方式配榜即可。" : "当前筛选条件下没有活动。"}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? " is-loading" : ""}`}>
              <table className="honor-rank-activity-table">
                <thead>
                  <tr>
                    <th>活动</th>
                    <th>范围</th>
                    <th>活动时间</th>
                    <th>榜单</th>
                    <th>状态</th>
                    <th>创建</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="honor-rank-player">
                          <strong>{item.title || `活动 #${item.id}`}</strong>
                          <small>{item.note || "—"}</small>
                        </div>
                      </td>
                      <td>
                        <div className="honor-rank-player">
                          <strong>{item.scopeName || item.scopeId}</strong>
                          <small>
                            {item.scopeType === "union" ? "联盟" : "独立俱乐部"} · {item.scopeId}
                          </small>
                        </div>
                      </td>
                      <td className="honor-rank-nowrap">
                        {item.startDate} {splitClock(item.startTime)}
                        <br />
                        至 {item.endDate} {splitClock(item.endTime)}
                      </td>
                      <td>
                        <div className="honor-rank-tags">
                          {(item.ranks || []).filter((rank) => rank.on).map((rank) => (
                            <span key={rank.rankType}>{rank.name.replace("玩家", "").replace("代理", "")}</span>
                          ))}
                          {(item.ranks || []).every((rank) => !rank.on) && <span className="is-off">未开榜</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`honor-rank-phase honor-rank-phase--${item.phase}`}>
                          {PHASE_LABELS[item.phase]}
                        </span>
                        {item.superseded && <div className="reward-muted">已被新活动取代</div>}
                      </td>
                      <td className="honor-rank-nowrap">
                        {item.createdBy || "—"}
                        <br />
                        <span className="reward-muted">{item.createdAt}</span>
                      </td>
                      <td>
                        <Button variant="secondary" onClick={() => setModalId(item.id)}>详情 / 修改</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>第 {data?.page ?? page} / {totalPages} 页 · 每页 {pageSize} 条</span>
              <div>
                <button type="button" onClick={() => setPage(1)} disabled={page <= 1 || loading}>首页</button>
                <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
                  上一页
                </button>
                <strong>{page}</strong>
                <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>
                  下一页
                </button>
                <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading}>末页</button>
              </div>
            </div>
          </>
        )}
      </section>

      {modalId !== undefined && (
        <HonorRankActivityModal
          activityId={modalId}
          canEdit={canManage}
          notify={notify}
          onClose={() => setModalId(undefined)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
