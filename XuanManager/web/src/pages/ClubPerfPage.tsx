import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Button, EmptyState, Field, LoadingBlock, PageHeader } from "../components/ui";
import { beijingDateInput } from "../time";

type UnionOption = {
  unionId: string;
  unionName: string;
  ownerId: string;
  ownerName: string;
  clubCount: number;
};

type PerfNode = {
  key: string;
  playerId: string;
  name: string;
  role: string;
  clubId: string;
  clubName: string;
  unionId: string;
  unionName: string;
  parentId: string;
  enabled: boolean;
  isLeader: boolean;
  isUnionOwner: boolean;
  my: number;
  granted: number;
  left: number;
  percent: string;
  children: PerfNode[];
};

type Overview = {
  union: UnionOption;
  date: string;
  allCount: number;
  totalCount: number;
  enabledCount: number;
  tree: PerfNode[];
};

function num(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

function initialExpanded(nodes: PerfNode[], depth = 0, result = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (depth <= 1) result.add(node.key);
    if (depth <= 1 && node.children.length > 0) initialExpanded(node.children, depth + 1, result);
  }
  return result;
}

function flatten(nodes: PerfNode[], expanded: Set<string>, depth = 0, rows: Array<{ node: PerfNode; depth: number }> = []) {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children.length > 0 && expanded.has(node.key)) flatten(node.children, expanded, depth + 1, rows);
  }
  return rows;
}

export default function ClubPerfPage() {
  const [unions, setUnions] = useState<UnionOption[]>([]);
  const [unionsLoading, setUnionsLoading] = useState(true);
  const [unionId, setUnionId] = useState("");
  const [date, setDate] = useState(() => beijingDateInput(-1));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    setUnionsLoading(true);
    api<{ items: UnionOption[] }>("/api/game/club-perf/unions")
      .then((result) => {
        if (!alive) return;
        setUnions(result.items);
        setUnionId((current) => current || result.items[0]?.unionId || "");
        setError("");
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : "读取联盟列表失败");
      })
      .finally(() => {
        if (alive) setUnionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!unionId) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ union_id: unionId, date });
    api<Overview>(`/api/game/club-perf/overview?${query}`)
      .then((result) => {
        if (!alive) return;
        setData(result);
        setExpanded(initialExpanded(result.tree));
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "读取业绩股数据失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [unionId, date, revision]);

  const rows = useMemo(() => (data ? flatten(data.tree, expanded) : []), [data, expanded]);

  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CLUB PERFORMANCE SHARES"
        title="业绩股"
        description="按联盟查看整个代理树的业绩股开通状态、上级下级关系与昨日业绩比例。"
      />
      <section className="panel">
        <div className="club-perf-filters">
          <Field label="联盟">
            <select value={unionId} disabled={unionsLoading} onChange={(event) => setUnionId(event.target.value)}>
              {unions.length === 0 && <option value="">{unionsLoading ? "正在读取联盟…" : "暂无联盟"}</option>}
              {unions.map((item) => (
                <option key={item.unionId} value={item.unionId}>
                  {item.unionName || item.unionId}（{item.unionId}）
                </option>
              ))}
            </select>
          </Field>
          <Field label="统计日期（北京时间）">
            <input type="date" value={date} max={beijingDateInput()} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Button type="button" onClick={() => setRevision((value) => value + 1)} disabled={!unionId || loading}>
            {loading ? "正在读取…" : "刷新"}
          </Button>
        </div>

        {error && <div className="form-error"><span>!</span>{error}</div>}

        {data && (
          <div className="club-perf-stats">
            <div>
              <span>联盟</span>
              <strong>{data.union.unionName || data.union.unionId}</strong>
              <small>总群主：{data.union.ownerName || data.union.ownerId || "—"}</small>
            </div>
            <div>
              <span>统计日期</span>
              <strong>{data.date}</strong>
              <small>业绩股按北京时间自然日统计</small>
            </div>
            <div>
              <span>联盟总次数</span>
              <strong>{num(data.allCount)}</strong>
              <small>业绩占比的分母</small>
            </div>
            <div>
              <span>已开通 / 节点</span>
              <strong>{data.enabledCount} / {data.totalCount}</strong>
              <small>含联盟根与盟主</small>
            </div>
          </div>
        )}

        {unionsLoading || (loading && !data) ? (
          <LoadingBlock label="正在读取业绩股" />
        ) : !unionId ? (
          <EmptyState title="暂无联盟" description="游戏里还没有联盟，或当前账号没有可查看的联盟。" />
        ) : !data ? (
          <EmptyState title="暂无数据" description="请选择联盟和统计日期后刷新。" />
        ) : (
          <div className={`table-wrap${loading ? " is-loading" : ""}`}>
            <table className="club-perf-table">
              <thead>
                <tr>
                  <th>代理</th>
                  <th>身份</th>
                  <th>俱乐部</th>
                  <th>业绩股</th>
                  <th className="reward-num">我(毛次)</th>
                  <th className="reward-num">下放</th>
                  <th className="reward-num">剩(净)</th>
                  <th className="reward-num">业绩占比</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, depth }) => {
                  const hasChildren = node.children.length > 0;
                  const isOpen = expanded.has(node.key);
                  return (
                    <tr key={node.key} className={node.enabled ? "" : "is-off"}>
                      <td>
                        <div className="club-perf-name" style={{ paddingLeft: depth * 18 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className="club-perf-toggle"
                              onClick={() => toggle(node.key)}
                              aria-label={isOpen ? "收起下级" : "展开下级"}
                            >
                              {isOpen ? "▾" : "▸"}
                            </button>
                          ) : (
                            <span className="club-perf-toggle is-empty" />
                          )}
                          <strong>{node.name || `ID ${node.playerId}`}</strong>
                          <small>ID {node.playerId || "—"}</small>
                          {node.isUnionOwner && <span className="perf-badge is-root">联盟根</span>}
                          {node.isLeader && !node.isUnionOwner && <span className="perf-badge is-leader">盟主</span>}
                        </div>
                      </td>
                      <td>{node.role || "—"}</td>
                      <td>{node.clubName || "—"}</td>
                      <td>
                        <span className={`perf-badge ${node.enabled ? "is-on" : "is-off"}`}>
                          {node.enabled ? "已开通" : "未开通"}
                        </span>
                      </td>
                      <td className="reward-num">{node.enabled ? num(node.my) : "—"}</td>
                      <td className="reward-num">{node.enabled ? num(node.granted) : "—"}</td>
                      <td className="reward-num">{node.enabled ? num(node.left) : "—"}</td>
                      <td className="reward-num">{node.enabled ? `${node.percent}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <p className="club-perf-note">
            「未开通」表示没有显式授权行；未授权盟主的下级按各自授权行生效，不级联。联盟根默认开通，其「我/下放/剩」是联盟树口径。
          </p>
        )}
      </section>
    </div>
  );
}
