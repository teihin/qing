import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type {
  AgentContributionMembersResponse,
  AgentContributionNode,
  AgentContributionRuleQueryResponse,
  AgentContributionRuleResponse,
  AgentDisplayRule,
  ClubListItem,
  ClubListResponse,
  UnionClubItem,
  UnionDetailResponse,
  UnionListItem,
  UnionListResponse,
} from "../types";

const ORPHAN_UNION_ID = "__none__";

type Metric = "contrib" | "score";
type RuleMode = "inherit" | "percent" | "fixed";
type MetricForm = { mode: RuleMode; percent: string; delta: string };
type TreeNode = AgentContributionNode & { children?: TreeNode[]; loaded?: boolean; loading?: boolean };

const fenFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

function isMissing(raw: string | undefined | null): boolean {
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

function roleText(node: Pick<AgentContributionNode, "role" | "isAgent" | "level">): string {
  if (node.role === "owner") return "群主";
  if (node.role === "agent" || node.isAgent) return "合伙人";
  return node.level > 0 ? `代理 Lv.${node.level}` : "玩家";
}

function metricTitle(metric: Metric): string {
  return metric === "contrib" ? "总贡献" : "总输赢";
}

function metricRaw(node: AgentContributionNode, metric: Metric): string {
  return metric === "contrib" ? node.totalContribFen : node.totalScore;
}

function formatMetric(raw: number, metric: Metric): string {
  return metric === "contrib" ? `${fenFormatter.format(raw / 100)} 元` : `${numberFormatter.format(raw)} 分`;
}

function ruleSummary(rule: AgentDisplayRule | undefined, metric: Metric): string {
  if (!rule || rule.mode === "none") return "真实值";
  if (rule.mode === "unknown") return "已设置";
  if (rule.mode === "percent") return `展示比例 ${rule.percent ?? "—"}%`;
  if (rule.mode === "fixed") {
    const delta = Number(rule.delta ?? 0);
    if (metric === "contrib") {
      return `展示固定${delta > 0 ? "调低" : "调高"} ${fenFormatter.format(Math.abs(delta) / 100)} 元`;
    }
    return `展示固定${delta > 0 ? "调低" : "调高"} ${numberFormatter.format(Math.abs(delta))} 分`;
  }
  return "已设置";
}

function ruleSource(rule: AgentDisplayRule | undefined): string {
  if (!rule || rule.mode === "none") return "";
  if (rule.source === "self") return "本级设置";
  if (rule.sourceAgentName) return `继承自 ${rule.sourceAgentName}`;
  if (rule.sourceAgentId) return `继承自 ${rule.sourceAgentId}`;
  if (rule.source === "inherit") return "继承上级";
  return "";
}

/** 后台预览用：按当前生效规则估算展示值；最终展示以 KBE 返回为准。 */
function displayMetric(rule: AgentDisplayRule | undefined, rawText: string, metric: Metric): string {
  if (isMissing(rawText)) return "—";
  if (!rule || rule.mode === "none") return formatMetric(numberValue(rawText), metric);
  if (rule.mode === "unknown") return "—";
  const raw = numberValue(rawText);
  if (rule.mode === "percent") {
    const percent = Number(rule.percent);
    if (!Number.isFinite(percent)) return "—";
    const sign = raw < 0 ? -1 : 1;
    return formatMetric(sign * Math.floor(Math.abs(raw) * percent / 100), metric);
  }
  const delta = Number(rule.delta);
  if (!Number.isFinite(delta)) return "—";
  return formatMetric(metric === "contrib" ? Math.max(0, raw - delta) : raw - delta, metric);
}

function ruleIsSim(rule: AgentDisplayRule | undefined): boolean {
  if (!rule || rule.mode === "none" || rule.mode === "unknown") return false;
  if (rule.sim !== undefined) return Boolean(rule.sim);
  if (rule.mode === "percent") return rule.percent !== undefined && rule.percent !== null && Number(rule.percent) !== 100;
  if (rule.mode === "fixed") return rule.delta !== undefined && rule.delta !== null && Number(rule.delta) !== 0;
  return true;
}

function formFromRule(rule: AgentDisplayRule | undefined, metric: Metric): MetricForm {
  // KBE 若在行上下发的是“最终生效规则”，继承规则不能当成该节点自己的设置。
  if (rule && rule.mode !== "none" && rule.source !== "self" &&
    (rule.source === "inherit" || Boolean(rule.sourceAgentName))) {
    return { mode: "inherit", percent: "80", delta: "" };
  }
  if (rule?.mode === "percent") {
    return { mode: "percent", percent: String(rule.percent ?? 80), delta: "" };
  }
  if (rule?.mode === "fixed") {
    const delta = Number(rule.delta ?? 0);
    return { mode: "fixed", percent: "", delta: String(metric === "contrib" ? delta / 100 : delta) };
  }
  return { mode: "inherit", percent: "80", delta: "" };
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
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [treeRevision, setTreeRevision] = useState(0);

  const unionOptions = useMemo(() => {
    const options = [...unions];
    if (orphanClubs.length > 0) {
      options.push({
        unionId: ORPHAN_UNION_ID,
        name: "未入盟俱乐部",
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
    if (unionId || unionOptions.length === 0) return;
    setUnionId(unionOptions[0].unionId);
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
    setClubId("");
    setRoots([]);
    setWarning("");
    api<UnionDetailResponse>(`/api/game/unions/${encodeURIComponent(unionId)}`)
      .then((result) => {
        if (!active) return;
        setClubs(result.clubs);
        if (result.clubs.length > 0) setClubId(result.clubs[0].clubId);
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
    setClubId(mapped[0]?.clubId ?? "");
    setRoots([]);
    setWarning("");
  }, [unionId, orphanClubs]);

  const loadMembers = useCallback(async (targetClubId: string) => {
    setTreeLoading(true);
    setExpanded({});
    setChildren({});
    setWarning("");
    try {
      const result = await api<AgentContributionMembersResponse>(
        `/api/game/agent-contributions/clubs/${encodeURIComponent(targetClubId)}/members?page=1&pageSize=200`,
      );
      const self = result.items.find((item) => item.playerId === result.agentId)
        ?? result.items.find((item) => item.role === "owner")
        ?? result.items[0];
      if (!self) {
        setRoots([]);
        setChildren({});
        return;
      }
      const directMembers = result.items.filter((item) => item.playerId !== self.playerId);
      setRoots([self]);
      setChildren(directMembers.length > 0 ? { [self.playerId]: directMembers } : {});
      setExpanded({ [self.playerId]: true });
      if (!result.rawAvailable) {
        setWarning(result.message || "游戏服成员数据暂不可用，仅显示俱乐部关系");
      } else if (result.truncated) {
        setWarning("直属成员超过 200 条，当前只显示前 200 条");
      }
    } catch (reason) {
      const message = errorMessage(reason, "代理贡献数据加载失败");
      setRoots([]);
      setWarning(message);
      notify(message, "error");
    } finally {
      setTreeLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!clubId) {
      setRoots([]);
      return;
    }
    void loadMembers(clubId);
  }, [clubId, loadMembers, treeRevision]);

  const loadChildren = async (node: TreeNode) => {
    if (!clubId || loadingNodes[node.playerId]) return;
    setLoadingNodes((current) => ({ ...current, [node.playerId]: true }));
    try {
      const result = await api<AgentContributionMembersResponse>(
        `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/members?agentId=${encodeURIComponent(node.playerId)}&page=1&pageSize=200`,
      );
      const items = result.items.filter((item) => item.playerId !== node.playerId);
      setChildren((current) => ({ ...current, [node.playerId]: items }));
      setExpanded((current) => ({ ...current, [node.playerId]: true }));
      if (!result.rawAvailable) {
        setWarning(result.message || "游戏服成员数据暂不可用，仅显示俱乐部关系");
      } else if (result.truncated) {
        setWarning("该代理的直属成员超过 200 条，当前只显示前 200 条");
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
    if (!(node.isAgent || node.role === "owner" || node.role === "agent")) return;
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

  const updateNodeRule = (playerId: string, metric: Metric, rule: AgentDisplayRule) => {
    const patch = metric === "contrib" ? { contribRule: rule } : { scoreRule: rule };
    setRoots((current) => current.map((node) => node.playerId === playerId ? { ...node, ...patch } : node));
    setChildren((current) => Object.fromEntries(
      Object.entries(current).map(([key, nodes]) => [
        key,
        nodes.map((node) => node.playerId === playerId ? { ...node, ...patch } : node),
      ]),
    ));
    setSelected((current) => current && current.playerId === playerId ? { ...current, ...patch } : current);
  };

  const ownRule = (rule: AgentDisplayRule | undefined): AgentDisplayRule | undefined =>
    rule && (rule.mode === "percent" || rule.mode === "fixed" || rule.mode === "unknown") ? rule : undefined;

  const renderRows = (
    nodes: TreeNode[],
    depth: number,
    parentName = "",
    inherited: { contrib?: AgentDisplayRule; score?: AgentDisplayRule } = {},
  ): ReactNode[] => {
    const rows: ReactNode[] = [];
    for (const node of nodes) {
      const upperText = node.upperName || node.upperId || (depth > 0 ? parentName : "—");
      const ownContrib = ownRule(node.contribRule);
      const ownScore = ownRule(node.scoreRule);
      const effectiveContrib = ownContrib ?? inherited.contrib;
      const effectiveScore = ownScore ?? inherited.score;
      const contribSource = ownContrib
        ? ruleSource(ownContrib)
        : inherited.contrib ? `继承自 ${parentName || "上级"}` : "";
      const scoreSource = ownScore
        ? ruleSource(ownScore)
        : inherited.score ? `继承自 ${parentName || "上级"}` : "";
      const isExpanded = Boolean(expanded[node.playerId]);
      const childList = children[node.playerId];
      const canExpand = node.isAgent || node.role === "owner" || node.role === "agent";
      rows.push(
        <tr key={node.playerId}>
          <td>
            <div className="contribution-tree-name" style={{ paddingLeft: depth * 22 }}>
              {canExpand ? (
                <button type="button" className={`contribution-tree-toggle ${isExpanded ? "is-open" : ""}`}
                  onClick={() => toggleNode(node)} disabled={loadingNodes[node.playerId]}
                  aria-label={isExpanded ? "收起下级" : "展开下级"}>
                  {loadingNodes[node.playerId] ? "…" : "›"}
                </button>
              ) : <span className="contribution-tree-toggle is-placeholder" />}
              <div>
                <strong>{node.name || node.playerId}</strong>
                <small>ID：{node.playerId}</small>
              </div>
            </div>
          </td>
          <td>
            <span className={`contribution-role contribution-role--${node.role}`}>{roleText(node)}</span>
            {node.level > 0 && <small className="cell-subtitle">等级 {node.level}</small>}
            {node.percent && node.percent !== "0" && (
              <small className="cell-subtitle">分成比例 {node.percent}%</small>
            )}
          </td>
          <td>{upperText}</td>
          <td><strong>{node.teamCount || "—"}</strong><small className="cell-subtitle">整条下线</small></td>
          <td>
            <strong>{formatFen(node.totalContribFen)}</strong>
            <small className="cell-subtitle">真实值</small>
            <small className="contribution-display-value">
              展示 {displayMetric(effectiveContrib, node.totalContribFen, "contrib")}
            </small>
          </td>
          <td>
            <strong>{formatScore(node.totalScore)}</strong>
            <small className="cell-subtitle">真实值</small>
            <small className="contribution-display-value">
              展示 {displayMetric(effectiveScore, node.totalScore, "score")}
            </small>
          </td>
          <td>
            <div className="contribution-rules">
              <span className={`contribution-rule-chip ${ruleIsSim(effectiveContrib) ? "is-sim" : ""}`}>
                贡献 · {ruleSummary(effectiveContrib, "contrib")}
                {contribSource && <em>{contribSource}</em>}
              </span>
              <span className={`contribution-rule-chip ${ruleIsSim(effectiveScore) ? "is-sim" : ""}`}>
                输赢 · {ruleSummary(effectiveScore, "score")}
                {scoreSource && <em>{scoreSource}</em>}
              </span>
            </div>
          </td>
          <td>
            <button type="button" className="contribution-rule-button" onClick={() => setSelected(node)}>
              {canAdjust ? "设置规则" : "查看规则"}
            </button>
          </td>
        </tr>,
      );
      if (isExpanded) {
        if (childList && childList.length > 0) {
          rows.push(...renderRows(childList, depth + 1, node.name || node.playerId, {
            contrib: ownContrib ?? inherited.contrib,
            score: ownScore ?? inherited.score,
          }));
        } else if (childList) {
          rows.push(
            <tr key={`${node.playerId}-empty`}>
              <td colSpan={8} className="contribution-empty-child">没有直属下级成员</td>
            </tr>,
          );
        }
      }
    }
    return rows;
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AGENT CONTRIBUTION"
        title="代理贡献管理"
        description="按联盟、俱乐部逐层查看代理与玩家的真实贡献和输赢，并设置该级或其本人的展示比例/固定差额。"
        actions={<span className="readonly-badge"><i />后台读取真实值</span>}
      />

      <div className="contribution-layout">
        <aside className="panel contribution-sidebar">
          <div className="contribution-sidebar__head">
            <strong>联盟 / 俱乐部</strong>
            <small>选择俱乐部后逐层展开代理树</small>
          </div>
          {unionsLoading ? <LoadingBlock label="正在读取联盟" /> : unionOptions.length === 0 ? (
            <EmptyState title="没有联盟或俱乐部" description="先在游戏内创建联盟或俱乐部。" />
          ) : (
            <div className="contribution-union-list">
              {unionOptions.map((union) => (
                <div key={union.unionId} className="contribution-union">
                  <button
                    type="button"
                    className={`contribution-union__button ${unionId === union.unionId ? "is-active" : ""}`}
                    onClick={() => setUnionId(union.unionId)}
                  >
                    <span>盟</span>
                    <div>
                      <strong>{union.name || union.unionId}</strong>
                      <small>{union.unionId} · {union.memberCount} 个俱乐部</small>
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
                          className={`contribution-club ${clubId === club.clubId ? "is-active" : ""}`}
                          onClick={() => setClubId(club.clubId)}
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
              <strong>{selectedClub ? `${selectedClub.name || selectedClub.clubId} · 代理树` : "请选择俱乐部"}</strong>
              <span>{selectedUnion ? `联盟：${selectedUnion.name || selectedUnion.unionId}` : "按联盟层级查看"}</span>
            </div>
            <button type="button" className="contribution-refresh" disabled={!clubId || treeLoading}
              onClick={() => setTreeRevision((value) => value + 1)}>
              刷新
            </button>
          </div>

          {warning && <div className="chain-message chain-message--broken">{warning}</div>}
          {!clubId ? (
            <EmptyState title="请选择俱乐部" description="从左侧联盟下选择一个俱乐部，查看其代理与玩家。" />
          ) : treeLoading && roots.length === 0 ? (
            <LoadingBlock label="正在读取代理贡献数据" />
          ) : roots.length === 0 ? (
            <EmptyState title="没有成员数据" description="该俱乐部可能还没有成员，或游戏服暂未返回数据。" />
          ) : (
            <>
              <div className="contribution-note">
                后台显示的是真实值；“展示”为按当前规则估算的预览，最终以 KBE 返回为准。客户端会标注模拟数据，下级单独设置优先于上级。
              </div>
              <div className={`table-wrap contribution-table-wrap ${treeLoading ? "is-loading" : ""}`}>
                <table className="club-table contribution-table">
                  <thead>
                    <tr>
                      <th>代理 / 玩家</th>
                      <th>身份</th>
                      <th>直属上级</th>
                      <th>团队人数</th>
                      <th>总贡献（真实）</th>
                      <th>总输赢（真实）</th>
                      <th>展示规则</th>
                      <th className="align-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>{renderRows(roots, 0)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {selected && selectedClub && (
        <AgentContributionRuleModal
          node={selected}
          clubId={selectedClub.clubId}
          canAdjust={canAdjust}
          notify={notify}
          onClose={() => setSelected(null)}
          onSaved={(metric, rule) => updateNodeRule(selected.playerId, metric, rule)}
        />
      )}
    </div>
  );
}

function AgentContributionRuleModal({
  node,
  clubId,
  canAdjust,
  notify,
  onClose,
  onSaved,
}: {
  node: TreeNode;
  clubId: string;
  canAdjust: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onSaved: (metric: Metric, rule: AgentDisplayRule) => void;
}) {
  const [forms, setForms] = useState<Record<Metric, MetricForm>>(() => ({
    contrib: formFromRule(node.contribRule, "contrib"),
    score: formFromRule(node.scoreRule, "score"),
  }));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Metric | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const base = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/rule`;
    const needsRule = (rule: AgentDisplayRule | undefined) => !rule || rule.mode === "none" || rule.mode === "unknown";
    const needContrib = needsRule(node.contribRule);
    const needScore = needsRule(node.scoreRule);
    if (!needContrib && !needScore) return () => { active = false; };
    Promise.all([
      needContrib ? api<AgentContributionRuleQueryResponse>(`${base}?metric=contrib`).catch(() => null) : Promise.resolve(null),
      needScore ? api<AgentContributionRuleQueryResponse>(`${base}?metric=score`).catch(() => null) : Promise.resolve(null),
    ]).then(([contrib, score]) => {
      if (!active) return;
      if (contrib?.available) setForms((current) => ({ ...current, contrib: formFromRule(contrib.rule, "contrib") }));
      if (score?.available) setForms((current) => ({ ...current, score: formFromRule(score.rule, "score") }));
    });
    return () => { active = false; };
  }, [clubId, node.playerId, node.contribRule, node.scoreRule]);

  const updateForm = (metric: Metric, patch: Partial<MetricForm>) => {
    setForms((current) => ({ ...current, [metric]: { ...current[metric], ...patch } }));
    setError("");
  };

  const validate = (metric: Metric): string => {
    const form = forms[metric];
    if (form.mode === "inherit") return "";
    if (note.trim().length < 2) return "请填写至少 2 个字的调整原因";
    if (form.mode === "percent") {
      const percent = Number(form.percent);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) return "比例必须是 0 到 100 的整数";
    }
    if (form.mode === "fixed") {
      const delta = Number(form.delta);
      if (!Number.isFinite(delta) || delta === 0) return "固定差额不能为 0";
    }
    return "";
  };

  const preview = (metric: Metric): string => {
    const form = forms[metric];
    const rawText = metricRaw(node, metric);
    if (isMissing(rawText)) return "游戏服未返回真实值";
    const raw = numberValue(rawText);
    if (form.mode === "inherit") return "按上级规则（以游戏服返回为准）";
    if (form.mode === "percent") {
      const percent = Number(form.percent);
      if (!Number.isFinite(percent)) return "—";
      const sign = raw < 0 ? -1 : 1;
      const value = sign * Math.floor(Math.abs(raw) * percent / 100);
      return formatMetric(value, metric);
    }
    const delta = Number(form.delta);
    if (!Number.isFinite(delta)) return "—";
    const rawDelta = metric === "contrib" ? delta * 100 : delta;
    const value = metric === "contrib" ? Math.max(0, raw - rawDelta) : raw - rawDelta;
    return formatMetric(value, metric);
  };

  const save = async (metric: Metric) => {
    if (!canAdjust) return;
    const message = validate(metric);
    if (message) {
      setError(message);
      return;
    }
    const form = forms[metric];
    const base = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/rule`;
    setBusy(metric);
    setError("");
    try {
      if (form.mode === "inherit") {
        const result = await api<AgentContributionRuleResponse>(`${base}?metric=${metric}`, { method: "DELETE" });
        onSaved(metric, result.rule);
        notify(`${metricTitle(metric)}已恢复上级规则`);
      } else {
        const payload: Record<string, unknown> = { metric, mode: form.mode, note: note.trim() };
        if (form.mode === "percent") {
          payload.percent = Math.trunc(Number(form.percent));
        } else {
          const delta = Number(form.delta);
          payload.delta = metric === "contrib" ? Math.round(delta * 100) : Math.round(delta);
        }
        const result = await api<AgentContributionRuleResponse>(base, { method: "PUT", ...jsonBody(payload) });
        onSaved(metric, result.rule);
        notify(`${metricTitle(metric)}规则已保存`);
      }
    } catch (reason) {
      const message = errorMessage(reason, "保存失败");
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const reset = async (metric: Metric) => {
    if (!canAdjust) return;
    const base = `/api/game/agent-contributions/clubs/${encodeURIComponent(clubId)}/agents/${encodeURIComponent(node.playerId)}/rule`;
    setBusy(metric);
    setError("");
    try {
      const result = await api<AgentContributionRuleResponse>(`${base}?metric=${metric}`, { method: "DELETE" });
      setForms((current) => ({ ...current, [metric]: { mode: "inherit", percent: "80", delta: "" } }));
      onSaved(metric, result.rule);
      notify(`${metricTitle(metric)}已恢复上级规则`);
    } catch (reason) {
      const message = errorMessage(reason, "恢复继承失败");
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const scopeText = node.isAgent || node.role === "owner" || node.role === "agent"
    ? "保存后对当前代理及其整条下级线生效；下级已有单独设置的，以下级自己的设置为准。"
    : "保存后只影响该玩家本人。";

  return (
    <Modal wide title={`${node.name || node.playerId} · 展示规则`} eyebrow="AGENT DISPLAY RULE" onClose={onClose}>
      <div className="contribution-modal">
        <div className="contribution-modal__summary">
          <div>
            <span>真实总贡献</span>
            <strong>{formatFen(node.totalContribFen)}</strong>
          </div>
          <div>
            <span>真实总输赢</span>
            <strong>{formatScore(node.totalScore)}</strong>
          </div>
          <div>
            <span>身份 / ID</span>
            <strong>{roleText(node)} · {node.playerId}</strong>
          </div>
        </div>

        <div className="contribution-scope-note">{scopeText}</div>
        {error && <div className="form-error"><span>!</span>{error}</div>}

        <div className="form-grid form-grid--single">
          <Field label="调整原因" hint="会写入后台审计，至少 2 个字">
            <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)}
              placeholder="例如：对外展示下调 20%" disabled={!canAdjust} />
          </Field>
        </div>

        {(["contrib", "score"] as Metric[]).map((metric) => (
          <section key={metric} className="contribution-metric-card">
            <div className="contribution-metric-card__head">
              <div>
                <h3>{metricTitle(metric)}</h3>
                <p>
                  当前：{ruleSummary(metric === "contrib" ? node.contribRule : node.scoreRule, metric)}
                  {ruleSource(metric === "contrib" ? node.contribRule : node.scoreRule)
                    ? ` · ${ruleSource(metric === "contrib" ? node.contribRule : node.scoreRule)}`
                    : ""}
                </p>
              </div>
              <strong className="contribution-preview-value">{preview(metric)}</strong>
            </div>
            <div className="segmented contribution-mode-switch">
              <button type="button" className={forms[metric].mode === "inherit" ? "is-active" : ""}
                onClick={() => updateForm(metric, { mode: "inherit" })} disabled={!canAdjust}>继承上级</button>
              <button type="button" className={forms[metric].mode === "percent" ? "is-active" : ""}
                onClick={() => updateForm(metric, { mode: "percent" })} disabled={!canAdjust}>按比例</button>
              <button type="button" className={forms[metric].mode === "fixed" ? "is-active" : ""}
                onClick={() => updateForm(metric, { mode: "fixed" })} disabled={!canAdjust}>按固定差额</button>
            </div>

            {forms[metric].mode === "percent" && (
              <div className="contribution-mode-fields">
                <Field label="展示比例（%）" hint="80 表示真实值的 80%，0 表示全部显示 0">
                  <input inputMode="numeric" value={forms[metric].percent}
                    onChange={(event) => updateForm(metric, { percent: event.target.value })}
                    disabled={!canAdjust} placeholder="80" />
                </Field>
              </div>
            )}
            {forms[metric].mode === "fixed" && (
              <div className="contribution-mode-fields">
                <Field
                  label={metric === "contrib" ? "调低金额（元）" : "调低积分"}
                  hint={metric === "contrib" ? "填 20000 表示展示值比真实值少 2 万元；负数表示调高" : "填 20000 表示展示值比真实值少 2 万积分；负数表示调高"}
                >
                  <input inputMode="decimal" value={forms[metric].delta}
                    onChange={(event) => updateForm(metric, { delta: event.target.value })}
                    disabled={!canAdjust} placeholder="0" />
                </Field>
              </div>
            )}

            <div className="contribution-metric-actions">
              <Button type="button" onClick={() => void save(metric)} disabled={!canAdjust || busy !== ""}>
                {busy === metric ? "保存中…" : "保存"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void reset(metric)}
                disabled={!canAdjust || busy !== ""}>恢复继承</Button>
              {forms[metric].mode === "inherit" && (
                <span className="contribution-mode-hint">也可选择“继承上级”后点保存，取消本级设置。</span>
              )}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
