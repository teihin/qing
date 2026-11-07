import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type {
  AgentContributionBonusDarkResponse,
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

function ruleSourceTitle(source: string | undefined, kind: "score" | "contrib"): string {
  if (source === "self") return kind === "score" ? "该代理自己设置的输赢比例" : "该代理自己设置的贡献增加额";
  if (source === "inherit") return "自己没有设置，按直属上级继承";
  if (source === "default") {
    return kind === "score" ? "自己及上级都没有设置，默认 100%" : "自己及上级都没有设置，默认不增加";
  }
  return "游戏服未返回设置来源";
}

/** 贡献增加额单位是分，按元展示，正数带 + 号。 */
function formatContribAdd(raw: number | null | undefined): string {
  if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) return "—";
  const value = Number(raw);
  return `${value > 0 ? "+" : ""}${fenFormatter.format(value / 100)} 元`;
}

/** 分转成输入框用的元字符串，去掉多余的 0。 */
function formatYuanInput(fen: number | null | undefined): string {
  const value = Number(fen ?? 0);
  if (!Number.isFinite(value)) return "0";
  const text = (value / 100).toFixed(2);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
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

/**
 * 红利暗抽比例：优先用展示数据接口的顶层 bonus_dark_percent（按 club_id 一代理一份），
 * 拿不到时退回成员行里的行级值；-1 表示该俱乐部代理树未加载，显示 “—” 让用户重试。
 */
function bonusDarkDisplay(
  node: AgentContributionNode,
  display: AgentContributionDisplayData | undefined,
): { text: string; title: string } {
  const fromDisplay = display?.available ? display.bonusDarkPercent : undefined;
  const raw = fromDisplay ?? (isMissing(node.bonusDarkPercent) ? undefined : Number(node.bonusDarkPercent));
  if (raw === undefined || raw === null || !Number.isFinite(raw)) {
    return { text: "—", title: "游戏服未返回红利暗抽比例" };
  }
  if (raw < 0) {
    return { text: "—", title: "该俱乐部代理树未加载，刷新后重试" };
  }
  return { text: `${numberFormatter.format(raw)}%`, title: raw === 0 ? "红利暗抽 0% = 不暗抽" : "红利暗抽比例" };
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
  const [bonusDarkTarget, setBonusDarkTarget] = useState<TreeNode | null>(null);
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

  const updateNodeRule = (playerId: string, scorePercent: number, contribAdd: number) => {
    const patch = {
      scorePercent,
      contribAdd,
      ownScorePercent: scorePercent,
      ownContribAdd: contribAdd,
      scorePercentSource: "self" as const,
      contribAddSource: "self" as const,
    };
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

  const updateNodeBonusDarkPercent = (playerId: string, percent: number) => {
    const patch = { bonusDarkPercent: String(percent) };
    setRoots((current) => current.map((node) => node.playerId === playerId ? { ...node, ...patch } : node));
    setChildren((current) => Object.fromEntries(
      Object.entries(current).map(([key, nodes]) => [
        key,
        nodes.map((node) => node.playerId === playerId ? { ...node, ...patch } : node),
      ]),
    ));
    setSelected((current) => current && current.playerId === playerId ? { ...current, ...patch } : current);
    setBonusDarkTarget((current) => current && current.playerId === playerId ? { ...current, ...patch } : current);
    setDisplayData((current) => current[playerId]
      ? { ...current, [playerId]: { ...current[playerId], bonusDarkPercent: percent } }
      : current);
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
      const scorePercent = node.scorePercent ?? 100;
      const contribAdd = node.contribAdd ?? 0;
      const isExpanded = Boolean(expanded[node.playerId]);
      const childList = children[node.playerId];
      const canExpand = node.isAgent || node.isLeader || node.role === "owner" || node.role === "agent";
      const canRule = canExpand;
      const isOnline = node.status === "在线" || node.status === "online" || node.status === "1";
      const bonusDark = bonusDarkDisplay(node, displayData[node.playerId]);
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
            <strong title={bonusDark.title} className="contribution-bonus-dark">{bonusDark.text}</strong>
            <small className="cell-subtitle">红利暗抽</small>
          </td>
          <td>
            <div className="contribution-rules">
              <span className={`contribution-rule-chip ${node.scorePercentSource === "self" ? "is-self" : "is-inherited"}`} title={ruleSourceTitle(node.scorePercentSource, "score")}>
                输赢 {scorePercent}%{node.scorePercentSource === "self" ? "（设置）" : ""}
              </span>
              <span className={`contribution-rule-chip ${node.contribAddSource === "self" ? "is-self" : "is-inherited"}`} title={ruleSourceTitle(node.contribAddSource, "contrib")}>
                贡献 {formatContribAdd(contribAdd)}{node.contribAddSource === "self" ? "（设置）" : ""}
              </span>
            </div>
          </td>
          <td className="contribution-sticky-last">
            {canRule ? (
              <div className="contribution-row-actions">
                <button type="button" className="contribution-rule-button" onClick={() => setSelected(node)}>
                  {canAdjust ? "展示调整" : "查看调整"}
                </button>
                <button type="button" className="contribution-rule-button contribution-rule-button--dark"
                  onClick={() => setBonusDarkTarget(node)}>
                  {canAdjust ? "暗抽比例调整" : "查看暗抽"}
                </button>
              </div>
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
              <td colSpan={17} className="contribution-empty-child">没有直属下级成员</td>
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
  const bonusDarkClubId = bonusDarkTarget
    ? bonusDarkTarget.clubId || selectedClub?.clubId || clubId || unionQueryClubId
    : "";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AGENT CONTRIBUTION"
        title="代理贡献管理"
        description="按联盟、俱乐部逐层查看代理与玩家数据；展示规则按代理拆成输赢比例（只调少）和贡献增加额（只调多），成员列表的输赢与贡献分别按各自口径展示。"
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
                后台显示真实值；贡献和输赢的“展示”值来自游戏服（`*_contrib_display_fen` / `*_score_display` / `team_display`）。展示规则拆两项：输赢按比例调少（`score_percent`，0~100%），贡献按金额调增加（`contrib_add`，单位分），两项各自继承——自己设置优先，未设置时沿直属上级就近继承，默认 100% / 0；只影响成员列表，成员列表以外的玩家输赢不缩放。「暗抽比例」是该代理的红利暗抽（`bonus_dark_percent`，0~100%，不参与展示缩放），可用「暗抽比例调整」逐个设置。默认只查当前节点，展开时才查询下一级。
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
                      <th rowSpan={2}>暗抽比例</th>
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
          onSaved={(scorePercent, contribAdd) => updateNodeRule(selected.playerId, scorePercent, contribAdd)}
        />
      )}

      {bonusDarkTarget && bonusDarkClubId && (
        <AgentBonusDarkModal
          node={bonusDarkTarget}
          clubId={bonusDarkClubId}
          display={displayData[bonusDarkTarget.playerId]}
          canAdjust={canAdjust}
          notify={notify}
          onClose={() => setBonusDarkTarget(null)}
          onSaved={(percent) => updateNodeBonusDarkPercent(bonusDarkTarget.playerId, percent)}
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
  onSaved: (scorePercent: number, contribAdd: number) => void;
}) {
  const [scorePercent, setScorePercent] = useState(String(node.ownScorePercent ?? node.scorePercent ?? 100));
  const [contribAddYuan, setContribAddYuan] = useState(formatYuanInput(node.ownContribAdd ?? node.contribAdd ?? 0));
  const [effectiveScore, setEffectiveScore] = useState<number>(node.scorePercent ?? 100);
  const [effectiveAdd, setEffectiveAdd] = useState<number>(node.contribAdd ?? 0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ruleBase = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/rule`;

  useEffect(() => {
    let active = true;
    api<AgentContributionRuleQueryResponse>(`${ruleBase}?metric=contrib`)
      .then((result) => {
        if (!active || !result.available) return;
        if (result.scorePercent !== undefined && result.scorePercent !== null) {
          setScorePercent(String(result.scorePercent));
        }
        if (result.contribAdd !== undefined && result.contribAdd !== null) {
          setContribAddYuan(formatYuanInput(result.contribAdd));
        }
        if (result.effectiveScorePercent !== undefined && result.effectiveScorePercent !== null) {
          setEffectiveScore(result.effectiveScorePercent);
        }
        if (result.effectiveContribAdd !== undefined && result.effectiveContribAdd !== null) {
          setEffectiveAdd(result.effectiveContribAdd);
        }
      })
      .catch(() => {
        // 查询失败时保留成员列表里的生效值
      });
    return () => { active = false; };
  }, [ruleBase]);

  const rawContrib = display?.teamRaw?.total_contrib_fen ?? node.totalContribFen;
  const rawScore = display?.teamRaw?.total_score ?? node.totalScore;
  const currentScorePercent = Number(scorePercent);
  const currentAddFen = Math.round((Number(contribAddYuan) || 0) * 100);
  const previewContrib = isMissing(rawContrib) || !Number.isFinite(currentAddFen)
    ? "—"
    : formatFen(String(numberValue(rawContrib) + currentAddFen));
  const previewScore = isMissing(rawScore) || !Number.isFinite(currentScorePercent)
    ? "—"
    : (() => {
        const raw = numberValue(rawScore);
        const sign = raw < 0 ? -1 : 1;
        return formatScore(String(sign * Math.floor(Math.abs(raw) * Math.max(0, Math.min(100, currentScorePercent)) / 100)));
      })();

  const validate = (): string => {
    const scoreValue = Number(scorePercent);
    if (!Number.isInteger(scoreValue) || scoreValue < 0 || scoreValue > 100) return "输赢比例必须是 0 到 100 的整数";
    const addValue = Number(contribAddYuan);
    if (!Number.isFinite(addValue) || addValue < 0 || addValue > 1000000) return "贡献增加额必须在 0 到 1000000 元之间";
    if (Math.abs(addValue * 100 - Math.round(addValue * 100)) > 1e-6) return "贡献增加额最多两位小数";
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
    const scoreValue = Math.trunc(Number(scorePercent));
    const addFen = Math.round(Number(contribAddYuan) * 100);
    setBusy(true);
    setError("");
    try {
      const result = await api<AgentContributionRuleResponse>(`${ruleBase}?metric=contrib`, {
        method: "PUT",
        ...jsonBody({ scorePercent: scoreValue, contribAdd: addFen, note: note.trim() }),
      });
      const appliedScore = result.rule?.scorePercent ?? scoreValue;
      const appliedAdd = result.rule?.contribAdd ?? addFen;
      setEffectiveScore(appliedScore);
      setEffectiveAdd(appliedAdd);
      onSaved(appliedScore, appliedAdd);
      notify("展示规则已保存");
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
      const result = await api<AgentContributionRuleResponse>(`${ruleBase}?metric=contrib`, { method: "DELETE" });
      // 清空自有设置后生效值可能来自上级，按后端回查结果回填。
      const appliedScore = result.rule?.scorePercent ?? 100;
      const appliedAdd = result.rule?.contribAdd ?? 0;
      setScorePercent(String(appliedScore));
      setContribAddYuan(formatYuanInput(appliedAdd));
      setEffectiveScore(appliedScore);
      setEffectiveAdd(appliedAdd);
      onSaved(appliedScore, appliedAdd);
      notify("已清空自有设置，回到上级继承");
    } catch (reason) {
      const message = errorMessage(reason, "清空自有设置失败");
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
            <span>生效输赢比例</span>
            <strong>{effectiveScore}%</strong>
          </div>
          <div>
            <span>生效贡献增加</span>
            <strong>{formatContribAdd(effectiveAdd)}</strong>
          </div>
          <div>
            <span>自身设置</span>
            <strong>输赢 {Number.isFinite(Number(scorePercent)) ? Math.trunc(Number(scorePercent)) : 100}% · 贡献 {formatContribAdd(currentAddFen)}</strong>
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
          输赢和贡献是两套独立口径：输赢按比例调少（score_percent），贡献按金额调增加（contrib_add）；两项都自己设置优先、未设置沿直属上级就近继承，默认分别为 100% 和 0。红利、抽水、业绩等其他收益仍按 show_percent，不在这里设置。
        </div>
        {error && <div className="form-error"><span>!</span>{error}</div>}

        <div className="form-grid form-grid--single">
          <Field label="输赢比例（%）" hint="0~100；100 = 真实值；只影响成员列表的今日/昨日/累计输赢">
            <input inputMode="numeric" value={scorePercent} maxLength={3}
              onChange={(event) => { setScorePercent(event.target.value); setError(""); }}
              disabled={!canAdjust} placeholder="100" />
          </Field>
          <Field label="贡献增加额（元）" hint="只调多，最多两位小数；0 = 不增加；上限 1000000 元">
            <input inputMode="decimal" value={contribAddYuan} maxLength={12}
              onChange={(event) => { setContribAddYuan(event.target.value); setError(""); }}
              disabled={!canAdjust} placeholder="0" />
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
            清空自有设置（继承上级）
          </Button>
          <span className="contribution-mode-hint">保存后该代理按此口径展示；下级未单独设置时按字段继承。</span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 红利暗抽比例调整。
 *
 * 数据源是游戏服 `设置_俱乐部_代理_红利暗抽`：不带比例时只回显当前值，带比例才写库，
 * 所以弹窗打开时先读一次，避免用列表里的旧值回填。比例按 club + agent 一份。
 */
function AgentBonusDarkModal({
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
  const listValue = display?.available && typeof display.bonusDarkPercent === "number" && display.bonusDarkPercent >= 0
    ? display.bonusDarkPercent
    : (isMissing(node.bonusDarkPercent) ? 0 : Math.max(0, numberValue(node.bonusDarkPercent)));
  const [current, setCurrent] = useState<number>(listValue);
  const [percent, setPercent] = useState(String(listValue));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const base = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/bonus-dark`;

  useEffect(() => {
    let active = true;
    api<AgentContributionBonusDarkResponse>(base)
      .then((result) => {
        if (!active) return;
        if (!result.available) {
          setWarning(result.message || "游戏服红利暗抽查询暂不可用");
          return;
        }
        const value = typeof result.bonusDarkPercent === "number" && result.bonusDarkPercent >= 0
          ? result.bonusDarkPercent
          : 0;
        setCurrent(value);
        setPercent(String(value));
      })
      .catch((reason) => {
        if (active) setWarning(errorMessage(reason, "读取红利暗抽比例失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [base]);

  const submit = async (value: number, noteText: string) => {
    if (!canAdjust) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<AgentContributionBonusDarkResponse>(base, {
        method: "PUT",
        ...jsonBody({ percent: value, note: noteText }),
      });
      const applied = typeof result.bonusDarkPercent === "number" && result.bonusDarkPercent >= 0
        ? result.bonusDarkPercent
        : value;
      setCurrent(applied);
      setPercent(String(applied));
      onSaved(applied);
      notify(`红利暗抽比例已设为 ${applied}%`);
      onClose();
    } catch (reason) {
      const message = errorMessage(reason, "保存失败");
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      setError("暗抽比例必须是 0 到 100 的整数");
      return;
    }
    const reason = note.trim();
    if (Array.from(reason).length < 2) {
      setError("请填写至少 2 个字的调整原因");
      return;
    }
    void submit(value, reason);
  };

  const clear = () => {
    const reason = note.trim() || "恢复默认不暗抽";
    void submit(0, reason);
  };

  return (
    <Modal wide title={`${node.name || node.playerId} · 暗抽比例`} eyebrow="AGENT BONUS DARK" onClose={onClose}>
      <div className="contribution-modal">
        <div className="contribution-modal__summary">
          <div>
            <span>当前暗抽比例</span>
            <strong>{loading ? "读取中…" : `${current}%`}</strong>
          </div>
          <div>
            <span>身份 / ID</span>
            <strong>{roleText(node)} · {node.playerId}</strong>
          </div>
          <div>
            <span>所属俱乐部</span>
            <strong>{node.clubName || clubId}</strong>
          </div>
        </div>

        {warning && <div className="chain-message chain-message--broken">{warning}</div>}
        <div className="contribution-scope-note">
          红利暗抽按代理一份设置，只影响该代理实际到账的红利，不参与展示比例（show_percent）缩放；0% = 不暗抽，100% = 红利全额被暗抽。成员列表的「暗抽比例」列展示的就是这里的值。
        </div>
        {error && <div className="form-error"><span>!</span>{error}</div>}

        <div className="form-grid form-grid--single">
          <Field label="暗抽比例（%）" hint="0~100 的整数；0 = 明确不暗抽">
            <input inputMode="numeric" value={percent} maxLength={3}
              onChange={(event) => { setPercent(event.target.value); setError(""); }}
              disabled={!canAdjust || loading || busy} placeholder="0" />
          </Field>
          <Field label="调整原因" hint="会写入后台审计，至少 2 个字">
            <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)}
              placeholder="例如：下调红利暗抽到 5%" disabled={!canAdjust || busy} />
          </Field>
        </div>

        <div className="contribution-metric-actions">
          <Button type="button" onClick={save} disabled={!canAdjust || busy || loading}>
            {busy ? "保存中…" : "保存"}
          </Button>
          <Button type="button" variant="secondary" onClick={clear} disabled={!canAdjust || busy || loading}>
            设为不暗抽（0%）
          </Button>
          <span className="contribution-mode-hint">保存后对该代理后续结算的红利生效，已结算部分不追溯。</span>
        </div>
      </div>
    </Modal>
  );
}
