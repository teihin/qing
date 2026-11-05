import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type {
  AgentContributionDisplayBatchResponse,
  AgentContributionDisplayData,
  AgentContributionMembersResponse,
  AgentContributionNode,
  AgentContributionRuleQueryResponse,
  AgentContributionRuleResponse,
  ClubListItem,
  ClubListResponse,
  UnionClubItem,
  UnionDetailResponse,
  UnionListItem,
  UnionListResponse,
} from "../types";

const ORPHAN_UNION_ID = "__none__";

type Metric = "contrib" | "score";
type Scope = "union" | "club" | "orphan";
type TreeNode = AgentContributionNode & { children?: TreeNode[]; loaded?: boolean; loading?: boolean };

const fenFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

function isMissing(raw: string | undefined | null): raw is undefined | null {
  return raw === undefined || raw === null || String(raw).trim() === "";
}

function numberValue(raw: string | undefined | null): number {
  const value = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function formatFen(raw: string | undefined | null): string {
  return isMissing(raw) ? "—" : `${fenFormatter.format(numberValue(raw) / 100)} 元`;
}

function formatScore(raw: string | undefined | null): string {
  return isMissing(raw) ? "—" : `${numberFormatter.format(numberValue(raw))} 分`;
}

function roleText(node: Pick<AgentContributionNode, "role" | "isAgent" | "isLeader" | "level">): string {
  if (node.role === "owner") return "群主";
  if (node.isLeader) return "盟主";
  if (node.role === "agent" || node.isAgent) return "合伙人";
  return node.level > 0 ? `代理 Lv.${node.level}` : "玩家";
}

function showPercentSourceTitle(node: Pick<AgentContributionNode, "showPercentSource">): string {
  if (node.showPercentSource === "self") return "该代理自己设置的比例";
  if (node.showPercentSource === "inherit") return "自己没有设置，按直属上级继承";
  if (node.showPercentSource === "default") return "自己及上级都没有设置，默认 100%";
  return "游戏服未返回设置来源";
}

function formatClubGold(raw: string | undefined | null): string {
  return isMissing(raw) ? "—" : numberFormatter.format(numberValue(raw));
}

function formatQuota(raw: string | undefined | null): string {
  // NumberList.quota 单位是分，客户端额度按元展示。
  return isMissing(raw) ? "—" : numberFormatter.format(numberValue(raw) / 100);
}

function formatPercent(raw: string | undefined | null): string {
  return isMissing(raw) ? "—" : `${numberFormatter.format(numberValue(raw))}%`;
}

/** 与客户端一致：正数红、负数绿、0 保持默认色。 */
function scoreColorClass(raw: string | undefined | null): string {
  if (isMissing(raw)) return "";
  const value = numberValue(raw);
  if (value > 0) return "is-win";
  if (value < 0) return "is-loss";
  return "";
}

function memberDisplayFieldValue(node: AgentContributionNode, field: string): string | undefined {
  switch (field) {
    case "today_contrib_fen": return node.todayContribDisplayFen;
    case "yesterday_contrib_fen": return node.yesterdayContribDisplayFen;
    case "total_contrib_fen": return node.totalContribDisplayFen;
    default: return undefined;
  }
}

function memberScoreDisplayFieldValue(node: AgentContributionNode, field: string): string | undefined {
  switch (field) {
    case "today_score": return node.todayScoreDisplay;
    case "yesterday_score": return node.yesterdayScoreDisplay;
    case "total_score": return node.totalScoreDisplay;
    default: return undefined;
  }
}

function formatMetric(raw: number, metric: Metric): string {
  return metric === "contrib" ? `${fenFormatter.format(raw / 100)} 元` : `${numberFormatter.format(raw)} 分`;
}

type DisplayTarget = { agentId: string; clubId: string };

/**
 * 展示数据接口只接受代理/群主；玩家行没有独立展示规则，展示值按上级继承。
 * clubId 必须用每行自己的：盟主虚拟行的 clubId 是盟主自己的俱乐部，不是父俱乐部。
 */
function displayTargets(nodes: TreeNode[], fallbackClubId: string): DisplayTarget[] {
  return nodes
    .filter((node) => node.isAgent || node.isLeader || node.role === "owner" || node.role === "agent")
    .map((node) => ({ agentId: node.playerId, clubId: node.clubId || fallbackClubId }))
    .filter((target) => target.agentId && target.clubId);
}

/**
 * 代理贡献管理。
 *
 * 后台按联盟 → 俱乐部 → 代理/玩家逐层展开；成员数据与客户端调用同一个接口，
 * KBE 根据调用者身份返回真实值或展示值，后台这里拿到的是真实值。
 * 规则只通过 KBE 命令下发，后台不做折扣计算。
 */
export default function AgentContributionsPage({
  can,
  notify,
}: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const canAdjust = can("game.agent_contribution.adjust");
  const [unions, setUnions] = useState<UnionListItem[]>([]);
  const [unionsLoading, setUnionsLoading] = useState(true);
  const [orphanClubs, setOrphanClubs] = useState<ClubListItem[]>([]);
  const [unionId, setUnionId] = useState("");
  const [clubs, setClubs] = useState<UnionClubItem[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubId, setClubId] = useState("");
  const [scope, setScope] = useState<Scope>("union");
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [displayData, setDisplayData] = useState<Record<string, AgentContributionDisplayData>>({});
  const [treeRevision, setTreeRevision] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<{ unions: UnionListItem[]; clubs: ClubListItem[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const requestedDisplay = useRef<Set<string>>(new Set());

  const unionOptions = useMemo(() => {
    const options = [...unions];
    if (orphanClubs.length > 0) {
      options.push({
        unionId: ORPHAN_UNION_ID,
        name: "普通俱乐部",
        ownerId: "",
        ownerName: "",
        ownerClubId: "",
        ownerClubName: "",
        poolQuotaFen: 0,
        totalClubQuotaFen: 0,
        memberCount: orphanClubs.length,
        status: "",
        createdAt: "",
      });
    }
    return options;
  }, [unions, orphanClubs]);
  const selectedUnion = useMemo(() => unionOptions.find((item) => item.unionId === unionId) ?? null, [unionOptions, unionId]);
  const selectedClub = useMemo(() => clubs.find((item) => item.clubId === clubId) ?? null, [clubs, clubId]);
  const unionQueryClubId = selectedUnion && selectedUnion.unionId !== ORPHAN_UNION_ID
    ? selectedUnion.ownerClubId || clubs[0]?.clubId || ""
    : "";
  const displayFallbackClubId = scope === "club" ? clubId : unionQueryClubId;

  useEffect(() => {
    let active = true;
    setUnionsLoading(true);
    api<UnionListResponse>("/api/game/unions?page=1&pageSize=100")
      .then((result) => { if (active) setUnions(result.items); })
      .catch((reason) => notify(errorMessage(reason, "联盟列表加载失败"), "error"))
      .finally(() => { if (active) setUnionsLoading(false); });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    let active = true;
    api<ClubListResponse>("/api/game/clubs?page=1&pageSize=100")
      .then((result) => { if (active) setOrphanClubs(result.items.filter((club) => !club.unionId)); })
      .catch(() => {
        // 未入盟俱乐部只是补充分组；读取失败不影响联盟树。
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const text = keyword.trim();
    if (!text) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      Promise.all([
        api<UnionListResponse>(`/api/game/unions?page=1&pageSize=100&keyword=${encodeURIComponent(text)}`).catch(() => null),
        api<ClubListResponse>(`/api/game/clubs?page=1&pageSize=100&keyword=${encodeURIComponent(text)}`).catch(() => null),
      ]).then(([unionResult, clubResult]) => {
        if (!active) return;
        setSearchResults({ unions: unionResult?.items || [], clubs: clubResult?.items || [] });
      }).finally(() => {
        if (active) setSearching(false);
      });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [keyword]);

  useEffect(() => {
    if (unionId || unionOptions.length === 0) return;
    const first = unionOptions[0];
    setUnionId(first.unionId);
    setScope(first.unionId === ORPHAN_UNION_ID ? "orphan" : "union");
  }, [unionId, unionOptions]);

  useEffect(() => {
    if (!unionId) {
      setClubs([]);
      setClubId("");
      return;
    }
    if (unionId === ORPHAN_UNION_ID) return;
    let active = true;
    setClubsLoading(true);
    setClubs([]);
    setRoots([]);
    setWarning("");
    api<UnionDetailResponse>(`/api/game/unions/${encodeURIComponent(unionId)}`)
      .then((result) => {
        if (!active) return;
        setClubs(result.clubs);
      })
      .catch((reason) => { if (active) notify(errorMessage(reason, "俱乐部列表加载失败"), "error"); })
      .finally(() => { if (active) setClubsLoading(false); });
    return () => { active = false; };
  }, [unionId, notify]);

  useEffect(() => {
    if (unionId !== ORPHAN_UNION_ID) return;
    const mapped: UnionClubItem[] = orphanClubs.map((club) => ({
      clubId: club.clubId,
      name: club.name,
      status: club.status,
      mode: club.mode,
      ownerId: club.ownerId,
      ownerName: club.ownerName,
      quotaFen: club.ownerQuotaFen ?? 0,
      memberCount: club.memberCount,
      tax: club.tax,
    }));
    setClubs(mapped);
    setRoots([]);
    setWarning("");
  }, [unionId, orphanClubs]);

  const loadDisplayData = useCallback(async (targetClubId: string, targets: DisplayTarget[]) => {
    const pending = new Map<string, DisplayTarget>();
    for (const target of targets) {
      if (!target.agentId || !target.clubId) continue;
      const key = `${target.clubId}:${target.agentId}`;
      if (requestedDisplay.current.has(key)) continue;
      pending.set(key, target);
    }
    if (pending.size === 0) return;
    const entries = Array.from(pending.entries());
    for (let start = 0; start < entries.length; start += 50) {
      const batch = entries.slice(start, start + 50);
      batch.forEach(([key]) => requestedDisplay.current.add(key));
      try {
        const result = await api<AgentContributionDisplayBatchResponse>(
          `/api/game/agent-contributions/clubs/${encodeURIComponent(targetClubId)}/display-data`,
          { method: "POST", ...jsonBody({ items: batch.map(([, target]) => target) }) },
        );
        setDisplayData((current) => ({ ...current, ...result.items }));
        const failed = Object.entries(result.items).filter(([, item]) => !item.available);
        if (failed.length > 0 || result.message) {
          console.error("[XuanManager API] 展示数据返回提示", {
            clubId: targetClubId,
            targets: batch.map(([, target]) => target),
            message: result.message,
            failed: failed.map(([agentId, item]) => ({ agentId, clubId: item.clubId, message: item.message })),
          });
        }
      } catch (reason) {
        batch.forEach(([key]) => requestedDisplay.current.delete(key));
        notify(errorMessage(reason, "展示数据加载失败"), "error");
      }
    }
  }, [notify]);

  const loadMembers = useCallback(async (
    targetClubId: string,
    showType: "union" | "member",
    scopeKind: "union" | "club",
  ) => {
    setTreeLoading(true);
    setExpanded({});
    setChildren({});
    setWarning("");
    requestedDisplay.current = new Set();
    setDisplayData({});
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "500", showType });
      if (scopeKind === "club") params.set("selfOnly", "1");
      const result = await api<AgentContributionMembersResponse>(
        `/api/game/agent-contributions/clubs/${encodeURIComponent(targetClubId)}/members?${params.toString()}`,
      );
      if (scopeKind === "union") {
        // 联盟级只返回盟主虚拟行，所有行平铺为一级，仍然可以继续展开。
        setRoots(result.items);
        setChildren({});
        setExpanded({});
        void loadDisplayData(targetClubId, displayTargets(result.items, targetClubId));
      } else {
        // 俱乐部级初始只查根节点（user_id=自己），默认折叠；展开时再查下一级。
        const self = result.items.find((item) => item.playerId === result.agentId)
          ?? result.items.find((item) => item.role === "owner")
          ?? result.items[0];
        if (!self) {
          setRoots([]);
          setChildren({});
          return;
        }
        setRoots([self]);
        setChildren({});
        setExpanded({});
        void loadDisplayData(targetClubId, displayTargets([self], targetClubId));
      }
      if (!result.rawAvailable) {
        console.error("[XuanManager API] 成员数据不可用", {
          clubId: targetClubId,
          agentId: result.agentId,
          showType,
          message: result.message,
        });
        setWarning(result.message || "游戏服成员数据暂不可用，仅显示俱乐部关系");
      } else if (result.truncated) {
        console.error("[XuanManager API] 成员数据被截断", { clubId: targetClubId, agentId: result.agentId, showType });
        setWarning("成员超过 500 条，当前只显示前 500 条");
      }
    } catch (reason) {
      const message = errorMessage(reason, "代理贡献数据加载失败");
      setRoots([]);
      setWarning(message);
      notify(message, "error");
    } finally {
      setTreeLoading(false);
    }
  }, [loadDisplayData, notify]);

  useEffect(() => {
    if (scope === "orphan") {
      setRoots([]);
      setChildren({});
      setExpanded({});
      setWarning("");
      return;
    }
    if (scope === "union") {
      if (!unionQueryClubId) {
        setRoots([]);
        setWarning("该联盟没有可用于查询的俱乐部");
        return;
      }
      void loadMembers(unionQueryClubId, "union", "union");
      return;
    }
    if (scope === "club" && clubId) {
      void loadMembers(clubId, "member", "club");
      return;
    }
    setRoots([]);
  }, [scope, clubId, unionQueryClubId, loadMembers, treeRevision]);

  const loadChildren = async (node: TreeNode) => {
    const targetClubId = node.clubId || unionQueryClubId || clubId;
    if (!targetClubId || loadingNodes[node.playerId]) return;
    setLoadingNodes((current) => ({ ...current, [node.playerId]: true }));
    try {
      const params = new URLSearchParams({
        agentId: node.playerId,
        page: "1",
        pageSize: "500",
        showType: "member",
      });
      const result = await api<AgentContributionMembersResponse>(
        `/api/game/agent-contributions/clubs/${encodeURIComponent(targetClubId)}/members?${params.toString()}`,
      );
      const items = result.items.filter((item) => item.playerId !== node.playerId);
      setChildren((current) => ({ ...current, [node.playerId]: items }));
      setExpanded((current) => ({ ...current, [node.playerId]: true }));
      void loadDisplayData(targetClubId, displayTargets([node, ...items], targetClubId));
      if (!result.rawAvailable) {
        console.error("[XuanManager API] 下级成员数据不可用", {
          clubId: targetClubId,
          agentId: result.agentId,
          message: result.message,
        });
        setWarning(result.message || "游戏服成员数据暂不可用，仅显示俱乐部关系");
      } else if (result.truncated) {
        console.error("[XuanManager API] 下级成员数据被截断", { clubId: targetClubId, agentId: result.agentId });
        setWarning("该代理的直属成员超过 500 条，当前只显示前 500 条");
      }
    } catch (reason) {
      const message = errorMessage(reason, "下级数据加载失败");
      setWarning(message);
      notify(message, "error");
    } finally {
      setLoadingNodes((current) => ({ ...current, [node.playerId]: false }));
    }
  };

  const toggleNode = (node: TreeNode) => {
    if (!(node.isAgent || node.isLeader || node.role === "owner" || node.role === "agent")) return;
    const isExpanded = Boolean(expanded[node.playerId]);
    if (isExpanded) {
      setExpanded((current) => ({ ...current, [node.playerId]: false }));
      return;
    }
    if (children[node.playerId]) {
      setExpanded((current) => ({ ...current, [node.playerId]: true }));
      return;
    }
    void loadChildren(node);
  };

  const updateNodeShowPercent = (playerId: string, percent: number) => {
    const patch = { showPercent: percent, ownShowPercent: percent, showPercentSource: "self" as const };
    setRoots((current) => current.map((node) => node.playerId === playerId ? { ...node, ...patch } : node));
    setChildren((current) => Object.fromEntries(
      Object.entries(current).map(([key, nodes]) => [
        key,
        nodes.map((node) => node.playerId === playerId ? { ...node, ...patch } : node),
      ]),
    ));
    setSelected((current) => current && current.playerId === playerId ? { ...current, ...patch } : current);
    if (!displayFallbackClubId) return;
    const findNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const item of nodes) {
        if (item.playerId === playerId) return item;
        const found = findNode(children[item.playerId] || []);
        if (found) return found;
      }
      return null;
    };
    const target = findNode(roots);
    if (!target) return;
    const targetClubId = target.clubId || displayFallbackClubId;
    const key = `${targetClubId}:${playerId}`;
    requestedDisplay.current.delete(key);
    setDisplayData((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
    void loadDisplayData(targetClubId, [{ agentId: playerId, clubId: targetClubId }]);
  };

  const teamDisplayValue = (node: TreeNode, metric: Metric, field: string): string => {
    const data = displayData[node.playerId];
    if (data?.available) {
      const value = data.teamDisplay?.[field];
      if (!isMissing(value)) return formatMetric(numberValue(value), metric);
    }
    const value = metric === "contrib"
      ? memberDisplayFieldValue(node, field)
      : memberScoreDisplayFieldValue(node, field);
    return isMissing(value) ? "—" : formatMetric(numberValue(value), metric);
  };

  const scoreDisplayRaw = (node: TreeNode, field: string): string | undefined => {
    const data = displayData[node.playerId];
    if (data?.available) {
      const value = data.teamDisplay?.[field];
      if (!isMissing(value)) return value;
    }
    return memberScoreDisplayFieldValue(node, field);
  };

  const renderRows = (nodes: TreeNode[], depth: number, parentName = ""): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (const node of nodes) {
      const upperText = node.upperName || node.upperId || (depth > 0 ? parentName : "—");
      const showPercent = node.showPercent ?? 100;
      const isExpanded = Boolean(expanded[node.playerId]);
      const childList = children[node.playerId];
      const canExpand = node.isAgent || node.isLeader || node.role === "owner" || node.role === "agent";
      const canRule = canExpand;
      const isOnline = node.status === "在线" || node.status === "online" || node.status === "1";
      rows.push(
        <tr key={node.playerId}>
          <td className="contribution-sticky-first">
            <div className="contribution-tree-name" style={{ paddingLeft: depth * 22 }}>
              {canExpand ? (
                <button type="button" className={`contribution-tree-toggle ${isExpanded ? "is-open" : ""}`}
                  onClick={() => toggleNode(node)} disabled={loadingNodes[node.playerId]}
                  aria-label={isExpanded ? "收起下级" : "展开下级"}>
                  {loadingNodes[node.playerId] ? "…" : "›"}
                </button>
              ) : <span className="contribution-tree-toggle is-placeholder" />}
              <span className="contribution-avatar">{(node.name || node.playerId || "?").slice(0, 1)}</span>
              <div>
                <strong>{node.name || node.playerId}</strong>
                <small>ID：{node.playerId}</small>
                {node.note && <small className="contribution-note-text">备注：{node.note}</small>}
              </div>
            </div>
          </td>
          <td>
            <strong>{node.clubName || node.clubId || "—"}</strong>
            {node.clubName && node.clubId && <small className="cell-subtitle">俱乐部ID：{node.clubId}</small>}
          </td>
          <td>
            <span className={`contribution-role ${node.isLeader ? "contribution-role--leader" : `contribution-role--${node.role}`}`}>
              {roleText(node)}
            </span>
            {node.level > 0 && <small className="cell-subtitle">等级 {node.level}</small>}
            <span className={`contribution-online ${isOnline ? "is-online" : "is-offline"}`}>
              <i />{node.status || "—"}
            </span>
          </td>
          <td>{upperText}</td>
          <td><strong>{node.teamCount || "—"}</strong><small className="cell-subtitle">整条下线</small></td>
          <td><strong>{formatClubGold(node.clubGold)}</strong></td>
          <td><strong>{formatPercent(node.percent)}</strong></td>
          <td><strong>{formatQuota(node.quota)}</strong></td>
          <td>
            <strong className={`contribution-score-value ${scoreColorClass(node.todayScore)}`}>{formatScore(node.todayScore)}</strong>
            <small className={`contribution-display-value contribution-score-display ${scoreColorClass(scoreDisplayRaw(node, "today_score"))}`}>
              展示 {teamDisplayValue(node, "score", "today_score")}
            </small>
          </td>
          <td>
            <strong className={`contribution-score-value ${scoreColorClass(node.yesterdayScore)}`}>{formatScore(node.yesterdayScore)}</strong>
            <small className={`contribution-display-value contribution-score-display ${scoreColorClass(scoreDisplayRaw(node, "yesterday_score"))}`}>
              展示 {teamDisplayValue(node, "score", "yesterday_score")}
            </small>
          </td>
          <td>
            <strong className={`contribution-score-value ${scoreColorClass(node.totalScore)}`}>{formatScore(node.totalScore)}</strong>
            <small className={`contribution-display-value contribution-score-display ${scoreColorClass(scoreDisplayRaw(node, "total_score"))}`}>
              展示 {teamDisplayValue(node, "score", "total_score")}
            </small>
          </td>
          <td>
            <strong>{formatFen(node.todayContribFen)}</strong>
            <small className="contribution-display-value">展示 {teamDisplayValue(node, "contrib", "today_contrib_fen")}</small>
          </td>
          <td>
            <strong>{formatFen(node.yesterdayContribFen)}</strong>
            <small className="contribution-display-value">展示 {teamDisplayValue(node, "contrib", "yesterday_contrib_fen")}</small>
          </td>
          <td>
            <strong>{formatFen(node.totalContribFen)}</strong>
            <small className="contribution-display-value">展示 {teamDisplayValue(node, "contrib", "total_contrib_fen")}</small>
          </td>
          <td>
            <div className="contribution-rules">
              <span className={`contribution-rule-chip ${node.showPercentSource === "self" ? "is-self" : "is-inherited"}`} title={showPercentSourceTitle(node)}>
                贡献 {showPercent}%{node.showPercentSource === "self" ? "（设置）" : ""}
              </span>
              <span className={`contribution-rule-chip ${node.showPercentSource === "self" ? "is-self" : "is-inherited"}`} title={showPercentSourceTitle(node)}>
                输赢 {showPercent}%{node.showPercentSource === "self" ? "（设置）" : ""}
              </span>
            </div>
          </td>
          <td className="contribution-sticky-last">
            {canRule ? (
              <button type="button" className="contribution-rule-button" onClick={() => setSelected(node)}>
                {canAdjust ? "展示调整" : "查看调整"}
              </button>
            ) : <span className="contribution-rule-empty">—</span>}
          </td>
        </tr>,
      );
      if (isExpanded) {
        if (childList && childList.length > 0) {
          rows.push(...renderRows(childList, depth + 1, node.name || node.playerId));
        } else if (childList) {
          rows.push(
            <tr key={`${node.playerId}-empty`}>
              <td colSpan={16} className="contribution-empty-child">没有直属下级成员</td>
            </tr>,
          );
        }
      }
    }
    return rows;
  };

  const pageTitle = scope === "club" && selectedClub
    ? `${selectedClub.name || selectedClub.clubId} · 代理树`
    : scope === "union" && selectedUnion
      ? `${selectedUnion.name || selectedUnion.unionId} · 联盟代理树`
      : "普通俱乐部";
  const pageSubtitle = scope === "club"
    ? `俱乐部：${selectedClub?.name || clubId || "—"}`
    : scope === "union"
      ? `联盟：${selectedUnion?.name || unionId || "—"}`
      : "普通俱乐部没有联盟级数据，请选择俱乐部";
  const canRefresh = scope === "club" ? Boolean(clubId) : scope === "union" ? Boolean(unionQueryClubId) : false;
  const selectedRuleClubId = selected ? selected.clubId || selectedClub?.clubId || "" : "";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AGENT CONTRIBUTION"
        title="代理贡献管理"
        description="按联盟、俱乐部逐层查看代理与玩家数据；展示规则按代理一份设置 0~100%，成员列表的贡献和输赢都按比例展示。"
        actions={<span className="readonly-badge"><i />后台读取真实值</span>}
      />

      <div className="contribution-layout">
        <aside className="panel contribution-sidebar">
          <div className="contribution-sidebar__head">
            <strong>联盟 / 俱乐部</strong>
            <small>点击联盟看联盟级，点击俱乐部看俱乐部成员；默认折叠，展开才查询下一级</small>
          </div>
          <div className="contribution-sidebar-search">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入联盟或俱乐部名称"
              aria-label="搜索联盟或俱乐部"
            />
            {keyword && (
              <button type="button" onClick={() => setKeyword("")}>清空</button>
            )}
          </div>
          {keyword.trim() ? (
            <div className="contribution-search-results">
              {searching && <small className="contribution-loading-text">搜索中…</small>}
              {!searching && searchResults && searchResults.unions.length === 0 && searchResults.clubs.length === 0 && (
                <small className="contribution-loading-text">没有匹配的联盟或俱乐部</small>
              )}
              {searchResults && searchResults.unions.length > 0 && (
                <div className="contribution-search-group">
                  <strong>联盟</strong>
                  {searchResults.unions.map((union) => (
                    <button
                      key={`u-${union.unionId}`}
                      type="button"
                      className={`contribution-search-item ${scope === "union" && unionId === union.unionId ? "is-active" : ""}`}
                      onClick={() => {
                        setUnionId(union.unionId);
                        setClubId("");
                        setScope("union");
                      }}
                    >
                      <strong>{union.name || union.unionId}</strong>
                      <small>{union.unionId} · {union.memberCount} 个俱乐部</small>
                    </button>
                  ))}
                </div>
              )}
              {searchResults && searchResults.clubs.length > 0 && (
                <div className="contribution-search-group">
                  <strong>俱乐部</strong>
                  {searchResults.clubs.map((club) => (
                    <button
                      key={`c-${club.clubId}`}
                      type="button"
                      className={`contribution-search-item ${scope === "club" && clubId === club.clubId ? "is-active" : ""}`}
                      onClick={() => {
                        setUnionId(club.unionId || ORPHAN_UNION_ID);
                        setClubId(club.clubId);
                        setScope("club");
                      }}
                    >
                      <strong>{club.name || club.clubId}</strong>
                      <small>{club.clubId} · {club.unionName || "普通俱乐部"}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : unionsLoading ? (
            <LoadingBlock label="正在读取联盟" />
          ) : unionOptions.length === 0 ? (
            <EmptyState title="没有联盟或俱乐部" description="先在游戏内创建联盟或俱乐部。" />
          ) : (
            <div className="contribution-union-list">
              {unionOptions.map((union) => (
                <div key={union.unionId} className="contribution-union">
                  <button
                    type="button"
                    className={`contribution-union__button ${
                      union.unionId === ORPHAN_UNION_ID
                        ? (scope === "orphan" ? "is-active" : "")
                        : (scope === "union" && unionId === union.unionId ? "is-active" : "")
                    }`}
                    onClick={() => {
                      setUnionId(union.unionId);
                      setClubId("");
                      setScope(union.unionId === ORPHAN_UNION_ID ? "orphan" : "union");
                    }}
                  >
                    <span>{union.unionId === ORPHAN_UNION_ID ? "普" : "盟"}</span>
                    <div>
                      <strong>{union.name || union.unionId}</strong>
                      <small>
                        {union.unionId === ORPHAN_UNION_ID
                          ? `${union.memberCount} 个俱乐部`
                          : `${union.unionId} · ${union.memberCount} 个俱乐部`}
                      </small>
                    </div>
                  </button>
                  {unionId === union.unionId && (
                    <div className="contribution-club-list">
                      {clubsLoading ? <small className="contribution-loading-text">正在读取俱乐部…</small> : clubs.length === 0 ? (
                        <small className="contribution-loading-text">该联盟下没有俱乐部</small>
                      ) : clubs.map((club) => (
                        <button
                          key={club.clubId}
                          type="button"
                          className={`contribution-club ${scope === "club" && clubId === club.clubId ? "is-active" : ""}`}
                          onClick={() => {
                            setClubId(club.clubId);
                            setScope("club");
                          }}
                        >
                          <strong>{club.name || club.clubId}</strong>
                          <small>{club.clubId} · 群主 {club.ownerName || club.ownerId || "—"}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="panel contribution-main">
          <div className="toolbar player-toolbar">
            <div>
              <strong>{pageTitle}</strong>
              <span>{pageSubtitle}</span>
            </div>
            <button type="button" className="contribution-refresh" disabled={!canRefresh || treeLoading}
              onClick={() => setTreeRevision((value) => value + 1)}>
              刷新
            </button>
          </div>

          {warning && <div className="chain-message chain-message--broken">{warning}</div>}
          {scope === "orphan" ? (
            <EmptyState title="请选择俱乐部" description="普通俱乐部没有联盟级数据，请从左侧选择具体俱乐部。" />
          ) : scope === "union" && !unionQueryClubId ? (
            <EmptyState title="该联盟没有可用于查询的俱乐部" description="请从左侧选择该联盟下的具体俱乐部。" />
          ) : scope === "club" && !clubId ? (
            <EmptyState title="请选择俱乐部" description="从左侧联盟下选择一个俱乐部，查看其代理与玩家。" />
          ) : treeLoading && roots.length === 0 ? (
            <LoadingBlock label="正在读取代理贡献数据" />
          ) : roots.length === 0 ? (
            <EmptyState title="没有成员数据" description="当前范围可能还没有成员，或游戏服暂未返回数据。" />
          ) : (
            <>
              <div className="contribution-note">
                后台显示真实值；贡献和输赢的“展示”值来自游戏服（`*_contrib_display_fen` / `*_score_display` / `team_display`）。展示规则按代理一份 0~100%：自己设置优先，未设置时继承直属上级，影响成员列表的贡献和输赢；成员列表以外的玩家输赢不缩放。默认只查当前节点，展开时才查询下一级。
              </div>
              <div className={`table-wrap contribution-table-wrap ${treeLoading ? "is-loading" : ""}`}>
                <table className="club-table contribution-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="contribution-sticky-first">代理 / 玩家</th>
                      <th rowSpan={2}>所属俱乐部</th>
                      <th rowSpan={2}>身份 / 在线</th>
                      <th rowSpan={2}>直属上级</th>
                      <th rowSpan={2}>团队人数</th>
                      <th rowSpan={2}>积分</th>
                      <th rowSpan={2}>比例</th>
                      <th rowSpan={2}>额度（元）</th>
                      <th colSpan={3} className="contribution-group-start contribution-group-end">输赢（真实 / 展示）</th>
                      <th colSpan={3} className="contribution-group-start contribution-group-end">贡献（真实 / 展示）</th>
                      <th rowSpan={2}>展示规则</th>
                      <th rowSpan={2} className="align-right contribution-sticky-last">操作</th>
                    </tr>
                    <tr>
                      <th className="contribution-group-start">今日</th>
                      <th>昨日</th>
                      <th className="contribution-group-end">总</th>
                      <th className="contribution-group-start">今日</th>
                      <th>昨日</th>
                      <th className="contribution-group-end">总</th>
                    </tr>
                  </thead>
                  <tbody>{renderRows(roots, 0)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {selected && selectedRuleClubId && (
        <AgentContributionRuleModal
          node={selected}
          clubId={selectedRuleClubId}
          display={displayData[selected.playerId]}
          canAdjust={canAdjust}
          notify={notify}
          onClose={() => setSelected(null)}
          onSaved={(percent) => updateNodeShowPercent(selected.playerId, percent)}
        />
      )}
    </div>
  );
}

function AgentContributionRuleModal({
  node,
  clubId,
  display,
  canAdjust,
  notify,
  onClose,
  onSaved,
}: {
  node: TreeNode;
  clubId: string;
  display?: AgentContributionDisplayData;
  canAdjust: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onSaved: (percent: number) => void;
}) {
  const [percent, setPercent] = useState(String(node.showPercent ?? 100));
  const [effective, setEffective] = useState<number>(node.showPercent ?? 100);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ruleBase = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/rule`;

  useEffect(() => {
    let active = true;
    api<AgentContributionRuleQueryResponse>(`${ruleBase}?metric=contrib`)
      .then((result) => {
        if (!active || !result.available) return;
        if (result.agentIncomeShowPercent !== undefined && result.agentIncomeShowPercent !== null) {
          setPercent(String(result.agentIncomeShowPercent));
        }
        if (result.effectiveShowPercent !== undefined && result.effectiveShowPercent !== null) {
          setEffective(result.effectiveShowPercent);
        }
      })
      .catch(() => {
        // 查询失败时保留成员列表里的生效比例
      });
    return () => { active = false; };
  }, [ruleBase]);

  const rawContrib = display?.teamRaw?.total_contrib_fen ?? node.totalContribFen;
  const currentPercent = Number(percent);
  const previewContrib = isMissing(rawContrib) || !Number.isFinite(currentPercent)
    ? "—"
    : formatFen(String(Math.floor(numberValue(rawContrib) * Math.max(0, Math.min(100, currentPercent)) / 100)));
  const rawScore = display?.teamRaw?.total_score ?? node.totalScore;
  const previewScore = isMissing(rawScore) || !Number.isFinite(currentPercent)
    ? "—"
    : (() => {
        const raw = numberValue(rawScore);
        const sign = raw < 0 ? -1 : 1;
        return formatScore(String(sign * Math.floor(Math.abs(raw) * Math.max(0, Math.min(100, currentPercent)) / 100)));
      })();

  const validate = (): string => {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 0 || value > 100) return "展示比例必须是 0 到 100 的整数";
    if (note.trim().length < 2) return "请填写至少 2 个字的调整原因";
    return "";
  };

  const save = async () => {
    if (!canAdjust) return;
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    const value = Math.trunc(Number(percent));
    setBusy(true);
    setError("");
    try {
      await api<AgentContributionRuleResponse>(`${ruleBase}?metric=contrib`, {
        method: "PUT",
        ...jsonBody({ mode: "percent", percent: value, note: note.trim() }),
      });
      setEffective(value);
      onSaved(value);
      notify("展示比例已保存");
      onClose();
    } catch (reason) {
      const message = errorMessage(reason, "保存失败");
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!canAdjust) return;
    setBusy(true);
    setError("");
    try {
      await api<AgentContributionRuleResponse>(`${ruleBase}?metric=contrib`, { method: "DELETE" });
      setPercent("100");
      setEffective(100);
      onSaved(100);
      notify("已恢复真实值（100%）");
    } catch (reason) {
      const message = errorMessage(reason, "恢复真实值失败");
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={`${node.name || node.playerId} · 展示规则`} eyebrow="AGENT DISPLAY RULE" onClose={onClose}>
      <div className="contribution-modal">
        <div className="contribution-modal__summary">
          <div>
            <span>真实总贡献</span>
            <strong>{formatFen(display?.teamRaw?.total_contrib_fen ?? node.totalContribFen)}</strong>
          </div>
          <div>
            <span>展示总贡献</span>
            <strong>{formatFen(display?.teamDisplay?.total_contrib_fen ?? node.totalContribDisplayFen)}</strong>
          </div>
          <div>
            <span>真实总输赢</span>
            <strong>{formatScore(display?.teamRaw?.total_score ?? node.totalScore)}</strong>
          </div>
          <div>
            <span>展示总输赢</span>
            <strong>{formatScore(display?.teamDisplay?.total_score ?? node.totalScoreDisplay)}</strong>
          </div>
          <div>
            <span>当前生效比例</span>
            <strong>{effective}%</strong>
          </div>
          <div>
            <span>自身设置</span>
            <strong>{Number.isFinite(Number(percent)) ? Math.trunc(Number(percent)) : 100}%</strong>
          </div>
          <div>
            <span>身份 / ID</span>
            <strong>{roleText(node)} · {node.playerId}</strong>
          </div>
        </div>

        {display && !display.available && (
          <div className="chain-message chain-message--broken">{display.message || "游戏服展示数据暂不可用"}</div>
        )}
        <div className="contribution-scope-note">
          代理自己设置的比例优先；自己未设置时沿直属上级就近继承，到根仍无则按 100%。比例影响成员列表的贡献和输赢；成员列表以外的玩家输赢不缩放；100% = 真实值。
        </div>
        {error && <div className="form-error"><span>!</span>{error}</div>}

        <div className="form-grid form-grid--single">
          <Field label="展示比例（%）" hint="0~100；100 = 真实值；保存的是该代理自己的设置">
            <input inputMode="numeric" value={percent} maxLength={3}
              onChange={(event) => { setPercent(event.target.value); setError(""); }}
              disabled={!canAdjust} placeholder="100" />
          </Field>
          <Field label="调整原因" hint="会写入后台审计，至少 2 个字">
            <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)}
              placeholder="例如：对外展示下调 20%" disabled={!canAdjust} />
          </Field>
        </div>

        <div className="contribution-preview">
          <span>展示贡献预览：</span><strong>{previewContrib}</strong>
          <span>展示输赢预览：</span><strong>{previewScore}</strong>
          <small>（最终以游戏服返回为准；仅成员列表内的输赢缩放）</small>
        </div>

        <div className="contribution-metric-actions">
          <Button type="button" onClick={() => void save()} disabled={!canAdjust || busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void reset()} disabled={!canAdjust || busy}>
            恢复真实值（100%）
          </Button>
          <span className="contribution-mode-hint">保存后该代理按此比例展示；下级未单独设置时继承该值。</span>
        </div>
      </div>
    </Modal>
  );
}
