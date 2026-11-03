import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import { useQueryRefresh } from "../queryRefresh";
import type {
  ClubDetailResponse,
  ClubListItem,
  ClubListResponse,
  ClubMemberNode,
  ClubMemberTree,
  UnionDetailResponse,
  UnionListItem,
  UnionQuotaAdjustmentResponse,
} from "../types";

const roleLabels: Record<ClubMemberNode["role"], string> = {
  owner: "群主",
  agent: "代理",
  manager: "管理员",
  member: "成员",
};

const statusLabels: Record<string, string> = {
  used: "正常",
  init: "未启用",
  del: "已解散",
};

const modeLabels: Record<string, string> = {
  "1": "普通模式",
  "2": "茶楼模式",
  "3": "带分模式",
};

const amountFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("zh-CN");

function labelOf(table: Record<string, string>, value: string): string {
  return table[value] ?? value ?? "";
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

/** 俱乐部积分是整数元；null 表示服务端明确「无该俱乐部数据」（-99），不能当 0。 */
function clubGoldText(value: number | null): string {
  return value === null ? "暂无数据" : integerFormatter.format(value);
}

/**
 * 俱乐部额度存在 club_agent_info.quota，单位是**分**，界面换算成元显示。
 * null 表示还没被授信 —— 此时整段额度不渲染，不能显示成 0。
 */
function quotaText(fen: number | null): string {
  if (fen === null || fen === undefined) return "";
  return `${amountFormatter.format(fen / 100)} 元`;
}

/** 查询维度：俱乐部维度直接筛俱乐部；玩家维度反查「这个人所在的俱乐部」。 */
type ClubQueryMode = "club" | "player";

interface ClubFilters {
  mode: ClubQueryMode;
  keyword: string;
  clubId: string;
  name: string;
  ownerId: string;
  status: string;
  clubMode: string;
  taxMin: string;
  taxMax: string;
  minMembers: string;
  maxMembers: string;
  playerId: string;
  playerName: string;
  /** 从联盟管理「详情」跳转过来时带的联盟过滤；空表示查看全部俱乐部。 */
  unionId: string;
}

const emptyClubFilters: ClubFilters = {
  mode: "club",
  keyword: "", clubId: "", name: "", ownerId: "",
  status: "", clubMode: "", taxMin: "", taxMax: "",
  minMembers: "", maxMembers: "", playerId: "", playerName: "",
  unionId: "",
};

/** 联盟页跳转格式：#/game/clubs?unionId=123456&unionName=XX联盟 */
function unionFromHash(): { unionId: string; unionName: string } {
  const query = window.location.hash.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  return {
    unionId: params.get("unionId")?.trim() ?? "",
    unionName: params.get("unionName")?.trim() ?? "",
  };
}

function filtersWithUnion(filters: ClubFilters, unionId: string): ClubFilters {
  return filters.unionId === unionId ? filters : { ...filters, unionId };
}

/** 只统计当前维度下真正生效的条件数，用于「更多条件」角标。 */
function activeFilterCount(filters: ClubFilters): number {
  const common = [filters.status, filters.clubMode, filters.taxMin, filters.taxMax,
    filters.minMembers, filters.maxMembers];
  if (filters.mode === "player") {
    return common.concat([filters.playerId, filters.playerName]).filter((value) => value.trim() !== "").length;
  }
  return common.concat([filters.clubId, filters.name, filters.ownerId])
    .filter((value) => value.trim() !== "").length;
}

/**
 * 俱乐部管理。
 *
 * 列出所有俱乐部、点进某个俱乐部看成员代理树；列表行可对所属联盟做「调整群主额度」。
 *
 * 联盟模式 V2：俱乐部额度挂在 club_guuid_info.union_quota，由联盟总群主在游戏内授信；
 * 平台后台只能给联盟池注资（增加_联盟_额度），保存后回读联盟池并写审计。
 * 俱乐部未加入联盟时没有可注资的联盟池，按钮禁用。
 */
export default function ClubsPage({
  can,
  notify,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<ClubListResponse | null>(null);
  const [draft, setDraft] = useState<ClubFilters>(() => ({ ...emptyClubFilters, unionId: unionFromHash().unionId }));
  const [applied, setApplied] = useState<ClubFilters>(() => ({ ...emptyClubFilters, unionId: unionFromHash().unionId }));
  const [unionName, setUnionName] = useState(() => unionFromHash().unionName);
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClubListItem | null>(null);
  const [quotaClub, setQuotaClub] = useState<ClubListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      for (const [key, value] of Object.entries(applied)) {
        if (value.trim() !== "") params.set(key, value.trim());
      }
      const result = await api<ClubListResponse>(`/api/game/clubs?${params.toString()}`);
      setData(result);
      if (result.total > 0 && page > Math.ceil(result.total / pageSize)) {
        setPage(Math.max(1, Math.ceil(result.total / pageSize)));
      }
    } catch (reason) {
      notify(errorMessage(reason, "俱乐部列表加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [applied, notify, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // 从联盟管理页跳过来时页签不变，只换了 hash 查询串；这里同步联盟过滤条件。
  useEffect(() => {
    const onHashChange = () => {
      const next = unionFromHash();
      setUnionName(next.unionName);
      setDraft((current) => filtersWithUnion(current, next.unionId));
      setApplied((current) => filtersWithUnion(current, next.unionId));
      setPage(1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const clearUnionFilter = () => {
    if (window.location.hash.includes("unionId=")) {
      window.history.replaceState(null, "", "#/game/clubs");
    }
    setUnionName("");
    setDraft((current) => ({ ...current, unionId: "" }));
    setApplied((current) => ({ ...current, unionId: "" }));
    setPage(1);
  };

  const resetFilters = () => {
    if (window.location.hash.includes("unionId=")) {
      window.history.replaceState(null, "", "#/game/clubs");
    }
    setUnionName("");
    setDraft(emptyClubFilters);
    setApplied(emptyClubFilters);
    setPage(1);
  };

  const update = (key: keyof ClubFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const firstRow = data?.total ? (page - 1) * pageSize + 1 : 0;
  const lastRow = data ? Math.min(page * pageSize, data.total) : 0;
  const canAdjustQuota = can("game.union.quota_adjust");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CLUB OPERATIONS"
        title="俱乐部管理"
        description="按俱乐部查看成员与代理树；「调整群主额度」给所属联盟池注资。联盟池与俱乐部额度的唯一真相都在游戏服。"
        actions={<span className="readonly-badge"><i />额度以游戏服为准</span>}
      />

      <section className="panel">
        <div className="toolbar player-toolbar">
          <div>
            <strong>全部俱乐部</strong>
            <span>
              {applied.mode === "player"
                ? "按玩家反查：他在哪些俱乐部里担任群主、代理或成员"
                : "群主取自账号的 club_make，代理数取自有效邀请码"}
            </span>
          </div>
          <span className="toolbar__count">当前筛选 {data?.total ?? 0} 个俱乐部</span>
        </div>

        {applied.unionId && (
          <div className="union-filter-banner">
            <div>
              <span>当前只显示该联盟下的俱乐部</span>
              <strong>{unionName || applied.unionId}</strong>
              <small>联盟码：{applied.unionId}</small>
            </div>
            <Button type="button" variant="secondary" onClick={clearUnionFilter}>
              查看全部俱乐部
            </Button>
          </div>
        )}

        <form
          className="club-filter-panel"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(draft);
            setPage(1);
          }}
        >
          <div className="club-filter-primary">
            <label className="club-filter-mode">
              <span>查询维度</span>
              <select
                value={draft.mode}
                onChange={(event) => {
                  const mode = event.target.value as ClubQueryMode;
                  // 切维度时清掉另一维度专属条件，避免切过去还带着上一个维度的残留筛选。
                  setDraft((current) => ({
                    ...current,
                    mode,
                    keyword: "", playerId: "", playerName: "",
                    clubId: mode === "player" ? current.clubId : "",
                    name: "", ownerId: "",
                  }));
                }}
              >
                <option value="club">俱乐部维度</option>
                <option value="player">玩家维度</option>
              </select>
            </label>

            {draft.mode === "player" ? (
              <>
                <div className="search-box search-box--wide">
                  <span>⌕</span>
                  <input
                    value={draft.playerId}
                    onChange={(event) => update("playerId", event.target.value)}
                    placeholder="玩家游戏 ID（精确）"
                    aria-label="玩家游戏 ID"
                  />
                </div>
                <div className="search-box search-box--wide">
                  <span>⌕</span>
                  <input
                    value={draft.playerName}
                    onChange={(event) => update("playerName", event.target.value)}
                    placeholder="玩家名字（模糊）"
                    aria-label="玩家名字"
                  />
                </div>
              </>
            ) : (
              <div className="search-box search-box--wide">
                <span>⌕</span>
                <input
                  value={draft.keyword}
                  onChange={(event) => update("keyword", event.target.value)}
                  placeholder="俱乐部 ID 或名称"
                  aria-label="俱乐部 ID 或名称"
                />
              </div>
            )}

            <Button type="submit">查询</Button>
            <Button type="button" variant="secondary" onClick={() => setAdvanced((value) => !value)}>
              {advanced ? "收起条件" : "更多条件"}
              {activeFilterCount(draft) > 0 && <b>{activeFilterCount(draft)}</b>}
            </Button>
            {activeFilterCount(applied) > 0 || applied.mode !== "club" ? (
              <button
                className="filter-reset"
                type="button"
                onClick={resetFilters}
              >
                清空筛选
              </button>
            ) : null}
          </div>

          {advanced && (
            <div className="club-filter-advanced">
              {draft.mode === "club" ? (
                <>
                  <Field label="俱乐部 ID"><input value={draft.clubId} onChange={(event) => update("clubId", event.target.value)} placeholder="精确匹配，6 位" /></Field>
                  <Field label="俱乐部名称"><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="支持部分匹配" /></Field>
                  <Field label="群主 ID"><input value={draft.ownerId} onChange={(event) => update("ownerId", event.target.value)} placeholder="按创建者反查" /></Field>
                </>
              ) : (
                <Field label="同时限定俱乐部" hint="留空则查该玩家所在的全部俱乐部">
                  <input value={draft.clubId} onChange={(event) => update("clubId", event.target.value)} placeholder="俱乐部 ID（可选）" />
                </Field>
              )}
              <Field label="俱乐部状态">
                <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
                  <option value="">全部（不含未启用/已解散）</option>
                  <option value="used">正常</option>
                  <option value="del">已解散</option>
                </select>
              </Field>
              <Field label="俱乐部模式">
                <select value={draft.clubMode} onChange={(event) => update("clubMode", event.target.value)}>
                  <option value="">全部模式</option>
                  <option value="1">普通模式</option>
                  <option value="2">茶楼模式</option>
                  <option value="3">带分模式</option>
                </select>
              </Field>
              <Field label="抽成范围（%）">
                <div className="club-range">
                  <input type="number" min="0" max="100" value={draft.taxMin} onChange={(event) => update("taxMin", event.target.value)} placeholder="最低" />
                  <span>–</span>
                  <input type="number" min="0" max="100" value={draft.taxMax} onChange={(event) => update("taxMax", event.target.value)} placeholder="最高" />
                </div>
              </Field>
              <Field label="成员数范围">
                <div className="club-range">
                  <input type="number" min="0" value={draft.minMembers} onChange={(event) => update("minMembers", event.target.value)} placeholder="最少" />
                  <span>–</span>
                  <input type="number" min="0" value={draft.maxMembers} onChange={(event) => update("maxMembers", event.target.value)} placeholder="最多" />
                </div>
              </Field>
              <div className="filter-actions">
                <Button type="submit">应用组合条件</Button>
                <Button type="button" variant="secondary" onClick={resetFilters}>重置</Button>
              </div>
            </div>
          )}
        </form>

        {loading && !data ? (
          <LoadingBlock label="正在读取俱乐部列表" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="没有找到俱乐部"
            description="可以改用俱乐部 ID 精确查询，或清空关键字后重新加载。"
          />
        ) : (
          <>
            <div className={`table-wrap ${loading ? "is-loading" : ""}`}>
              <table className="club-table">
                <thead>
                  <tr>
                    <th>俱乐部</th>
                    <th>状态 / 模式</th>
                    <th>群主</th>
                    <th>联盟</th>
                    <th>人数</th>
                    <th>代理</th>
                    <th>群主额度</th>
                    <th>抽成</th>
                    <th className="align-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((club) => (
                    <tr key={club.clubId}>
                      <td>
                        <div className="user-cell">
                          <span>俱</span>
                          <div>
                            <strong>{club.name || club.clubId}</strong>
                            <small>ID：{club.clubId}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{labelOf(statusLabels, club.status)}</strong>
                        <small className="cell-subtitle">{labelOf(modeLabels, club.mode) || "未知模式"}</small>
                      </td>
                      <td>
                        {club.ownerId ? (
                          <>
                            <strong>{club.ownerName || "群主账号未找到"}</strong>
                            <small className="cell-subtitle">ID：{club.ownerId}</small>
                          </>
                        ) : (
                          <span className="club-warning">未找到群主</span>
                        )}
                      </td>
                      <td>
                        {club.unionId ? (
                          <>
                            <strong>{club.unionName || club.unionId}</strong>
                            <small className="cell-subtitle">
                              联盟池 {amountFormatter.format((club.unionPoolQuotaFen ?? 0) / 100)} 元
                            </small>
                          </>
                        ) : (
                          <span className="club-quota-missing">未加入联盟</span>
                        )}
                      </td>
                      <td>{integerFormatter.format(club.memberCount)}</td>
                      <td>{integerFormatter.format(club.agentCount)}</td>
                      <td>
                        {!club.unionId ? (
                          <span className="club-quota-missing" title="俱乐部未加入联盟，没有联盟额度">—</span>
                        ) : club.ownerQuotaFen === null || club.ownerQuotaFen === undefined ? (
                          <span className="club-quota-missing" title="游戏服暂未返回俱乐部额度">未确认</span>
                        ) : (
                          <strong className="club-quota-value">{amountFormatter.format(club.ownerQuotaFen / 100)} 元</strong>
                        )}
                      </td>
                      <td>{club.tax || "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => setSelected(club)}>
                            查看成员
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuotaClub(club)}
                            disabled={!club.unionId || !canAdjustQuota}
                            title={
                              !club.unionId
                                ? "该俱乐部未加入联盟，无法调整联盟池"
                                : canAdjustQuota
                                  ? "平台给该俱乐部所属联盟的联盟池注资（总群主额度）"
                                  : "当前角色没有调整联盟池额度的权限"
                            }
                          >
                            调整群主额度
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
                显示 {firstRow}–{lastRow}，共 {data.total} 个俱乐部
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

      {selected && (
        <ClubDetailModal
          club={selected}
          canAdjust={can("game.union.quota_adjust")}
          notify={notify}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}

      {quotaClub && (
        <UnionQuotaModal
          club={quotaClub}
          canAdjust={can("game.union.quota_adjust")}
          notify={notify}
          onClose={() => setQuotaClub(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}

function ClubDetailModal({
  club,
  canAdjust,
  notify,
  onClose,
  onChanged,
}: {
  club: ClubListItem;
  canAdjust: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ClubDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [queryRevision, refreshQuery] = useQueryRefresh();

  const load = useCallback(async () => {
    void queryRevision;
    setLoading(true);
    try {
      setDetail(await api<ClubDetailResponse>(`/api/game/clubs/${club.clubId}`));
    } catch (reason) {
      notify(errorMessage(reason, "俱乐部成员加载失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [club.clubId, notify, queryRevision]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    if (!detail) return null;
    return {
      total: detail.members.length,
      agents: detail.members.filter((member) => member.isAgent).length,
      leaders: detail.members.filter((member) => member.isLeader).length,
    };
  }, [detail]);

  return (
    <Modal title={`${club.name || club.clubId} · 成员与代理树`} eyebrow={`CLUB ${club.clubId}`} onClose={onClose} wide>
      {loading && !detail ? (
        <LoadingBlock label="正在读取俱乐部成员" />
      ) : !detail ? (
        <EmptyState title="成员数据无法显示" description="请关闭后重试，或确认该俱乐部是否仍然存在。" />
      ) : (
        <div className="club-detail">
          <div className="club-detail__summary">
            <div>
              <span>成员</span>
              <strong>{summary?.total ?? 0}</strong>
            </div>
            <div>
              <span>代理</span>
              <strong>{summary?.agents ?? 0}</strong>
            </div>
            <div>
              <span>盟主</span>
              <strong>{summary?.leaders ?? 0}</strong>
            </div>
            <div>
              <span>群主</span>
              <strong>{detail.club.ownerName || detail.club.ownerId || "未找到"}</strong>
            </div>
          </div>

          {detail.warnings.length > 0 && (
            <div className="club-detail__warnings">
              <strong>代理关系需要核对（{detail.warnings.length}）</strong>
              <ul>
                {detail.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="club-tree">
            {detail.roots.length === 0 ? (
              <EmptyState title="没有可展示的成员" description="该俱乐部可能还没有成员，或成员数据尚未落库。" />
            ) : (
              detail.roots.map((root) => (
                <ClubTreeNode
                  key={root.playerId}
                  node={root}
                  canAdjust={canAdjust}
                  hasUnion={Boolean(detail.club.unionId)}
                  onAdjust={() => setQuotaOpen(true)}
                />
              ))
            )}
          </div>

          {detail.orphan.length > 0 && (
            <section className="club-orphan">
              <h4>关系异常的成员（{detail.orphan.length}）</h4>
              <p>这些成员的直属上级不在本俱乐部、指向自己或形成环，未挂进上面的树。</p>
              <ul>
                {detail.orphan.map((member) => (
                  <li key={member.playerId}>
                    <span>{member.name || member.playerId}</span>
                    <small>
                      ID：{member.playerId} · {labelOf(roleLabels, member.role)}
                      {member.upperId ? ` · 上级 ${member.upperId}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {quotaOpen && (
        <UnionQuotaModal
          club={detail?.club ?? club}
          canAdjust={canAdjust}
          notify={notify}
          onClose={() => setQuotaOpen(false)}
          onDone={() => {
            refreshQuery();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

function ClubTreeNode({
  node,
  canAdjust,
  hasUnion,
  onAdjust,
}: {
  node: ClubMemberTree;
  canAdjust: boolean;
  hasUnion: boolean;
  onAdjust: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  return (
    <div className="club-tree__node">
      <div className={`club-tree__row club-tree__row--${node.role}`}>
        <button
          type="button"
          className={`club-tree__toggle${hasChildren ? "" : " is-leaf"}`}
          onClick={() => setCollapsed((value) => !value)}
          disabled={!hasChildren}
          aria-label={hasChildren ? (collapsed ? "展开下级" : "收起下级") : "没有下级"}
        >
          {hasChildren ? (collapsed ? "+" : "−") : "·"}
        </button>
        <span className={`club-role club-role--${node.role}`}>{labelOf(roleLabels, node.role)}</span>
        <span className="club-tree__name">
          {node.name || node.playerId}
          {node.isLeader && <b className="club-leader">盟主</b>}
          <small>ID：{node.playerId}</small>
        </span>
        <span className="club-tree__gold">积分 {clubGoldText(node.clubGold)}</span>
        {node.quotaFen !== null && node.quotaFen !== undefined && (
          <span className="club-tree__quota">额度 {quotaText(node.quotaFen)}</span>
        )}
        {node.inviteCode && <span className="club-tree__meta">邀请码 {node.inviteCode}</span>}
        {node.note && <span className="club-tree__meta">{node.note}</span>}
        {canAdjust && hasUnion && node.role === "owner" && (
          <div className="row-actions">
            <button type="button" onClick={onAdjust}>
              调整群主额度
            </button>
          </div>
        )}
      </div>
      {hasChildren && !collapsed && (
        <div className="club-tree__children">
          {node.children.map((child) => (
            <ClubTreeNode key={child.playerId} node={child} canAdjust={canAdjust} hasUnion={hasUnion} onAdjust={onAdjust} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 联盟池注资（即「调整群主额度」）。
 *
 * 联盟模式 V2 下平台只能增加联盟池（总群主额度），不能直接改某个俱乐部的额度：
 * 俱乐部额度由总群主在游戏内用「授信_联盟_额度」分配。
 * 金额按「元」输入，提交换算成分，交给游戏服「增加_联盟_额度」并回读校验。
 */
function UnionQuotaModal({
  club,
  canAdjust,
  notify,
  onClose,
  onDone,
}: {
  club: ClubListItem;
  canAdjust: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [union, setUnion] = useState<UnionListItem | null>(null);
  const [loadError, setLoadError] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UnionQuotaAdjustmentResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!club.unionId) {
      setLoadError("该俱乐部未加入联盟，没有可注资的联盟池");
      return undefined;
    }
    api<UnionDetailResponse>(`/api/game/unions/${club.unionId}`)
      .then((response) => {
        if (!cancelled) setUnion(response.union);
      })
      .catch((reason_) => {
        if (!cancelled) setLoadError(errorMessage(reason_, "读取联盟额度失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [club.unionId]);

  const poolFen = union?.poolQuotaFen ?? club.unionPoolQuotaFen ?? null;
  const unionLabel = union?.name || club.unionName || club.unionId;
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const deltaFen = valid ? Math.round(parsed * 100) : 0;
  const canSubmit = canAdjust && Boolean(club.unionId) && Boolean(union) && valid &&
    reason.trim().length >= 2 && confirmed && !busy && !loadError;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await api<UnionQuotaAdjustmentResponse>(
        `/api/game/unions/${club.unionId}/quota-adjustments`,
        {
          method: "POST",
          ...jsonBody({
            action: "add",
            amountYuan: parsed,
            reason: reason.trim(),
            expectedPoolQuotaYuan: poolFen === null ? undefined : poolFen / 100,
            confirm: true,
          }),
        },
      );
      setResult(outcome);
      notify(outcome.verified ? outcome.message : "注资已提交，但未回读校验，请刷新后确认", outcome.verified ? "success" : "error");
      onDone();
    } catch (reason_) {
      setError(errorMessage(reason_, "联盟池注资失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`调整「${unionLabel}」的群主额度`}
      eyebrow={`UNION QUOTA · ${club.unionId || "NO UNION"}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          这里调整的是<strong>联盟池</strong>（联盟总群主额度），单位<strong>分</strong>；
          界面输入<strong>元</strong>，提交后交给游戏服「增加_联盟_额度」，成功后会回读联盟池。
        </p>
        <ul>
          <li>平台只能增加联盟池额度，不会直接改单个俱乐部的额度。</li>
          <li>俱乐部额度由联盟总群主在游戏内「授信_联盟_额度」分配。</li>
          <li>操作会记入后台审计，原因必填（2–120 字）。</li>
        </ul>
        <div className="union-quota-current">
          <div>
            <span>当前联盟池</span>
            <strong>{poolFen === null ? "读取中…" : `${amountFormatter.format(poolFen / 100)} 元`}</strong>
          </div>
          <div>
            <span>本俱乐部额度</span>
            <strong>
              {club.ownerQuotaFen === null || club.ownerQuotaFen === undefined
                ? "未确认"
                : `${amountFormatter.format(club.ownerQuotaFen / 100)} 元`}
            </strong>
          </div>
        </div>
      </div>

      {result ? (
        <div className={`quota-result ${result.verified ? "is-ok" : "is-unverified"}`}>
          <strong>{result.verified ? "联盟池已注资并回读校验" : "注资已提交，未回读校验"}</strong>
          <p>{result.message}</p>
          <dl>
            <div>
              <dt>本次注资</dt>
              <dd>+{amountFormatter.format(result.deltaFen / 100)} 元</dd>
            </div>
            <div>
              <dt>注资后联盟池</dt>
              <dd>{amountFormatter.format(result.poolQuotaYuan)} 元</dd>
            </div>
          </dl>
        </div>
      ) : (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>
          {(error || loadError) && (
            <div className="form-error">
              <span>!</span>
              {error || loadError}
            </div>
          )}
          {!canAdjust && (
            <div className="form-error">
              <span>!</span>
              当前角色没有调整联盟池额度的权限
            </div>
          )}
          <Field label="注资金额（元）" hint={valid ? `提交为 ${deltaFen} 分` : "只能增加，支持两位小数，单次不超过 100 万元"}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="例如 1000"
            />
          </Field>
          <Field label="原因" hint={`${Array.from(reason.trim()).length}/120，必填 2 字以上`}>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：平台季度注资" />
          </Field>
          <label className="confirm-check">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我确认本次注资只增加联盟池额度，不直接改变俱乐部额度</span>
          </label>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "提交中…" : "确认注资"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
