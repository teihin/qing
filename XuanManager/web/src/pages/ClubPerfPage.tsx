import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
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

type GrantResponse = {
  scope?: string;
  clubIds?: string[];
  message?: string;
};

type PerfCandidate = {
  playerId: string;
  name: string;
  role: string;
  clubId: string;
  clubName: string;
  unionId: string;
  unionName: string;
  isLeader: boolean;
  enabled: boolean;
};

function num(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

// 默认只展开联盟根：盟主这一层可见，更深的代理手动展开。
function initialExpanded(nodes: PerfNode[]): Set<string> {
  return nodes.length > 0 && nodes[0].children.length > 0
    ? new Set([nodes[0].key])
    : new Set();
}

function flatten(nodes: PerfNode[], expanded: Set<string>, depth = 0, rows: Array<{ node: PerfNode; depth: number }> = []) {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children.length > 0 && expanded.has(node.key)) flatten(node.children, expanded, depth + 1, rows);
  }
  return rows;
}

export default function ClubPerfPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [unions, setUnions] = useState<UnionOption[]>([]);
  const [unionsLoading, setUnionsLoading] = useState(true);
  const [unionId, setUnionId] = useState("");
  const [date, setDate] = useState(() => beijingDateInput(-1));
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revision, setRevision] = useState(0);
  const [grantOpen, setGrantOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setUnionsLoading(true);
    api<{ items: UnionOption[] }>("/api/game/club-perf/unions")
      .then((result) => {
        if (!alive) return;
        setUnions(result.items);
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

  const selectedUnion = unions.find((item) => item.unionId === unionId);

  const backToUnions = () => {
    setUnionId("");
    setData(null);
    setError("");
    setExpanded(new Set());
  };

  const handleGranted = (result: GrantResponse) => {
    setGrantOpen(false);
    notify(result.message || "已授权业绩股成员");
    // 授权写库是异步的，稍后两次刷新名单。
    setTimeout(() => setRevision((value) => value + 1), 1200);
    setTimeout(() => setRevision((value) => value + 1), 2400);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="CLUB PERFORMANCE SHARES"
        title="业绩股"
        description={unionId
          ? "查看该联盟全部代理的业绩股开通状态、上级下级关系与业绩比例。"
          : "先选择一个联盟，再进入查看该联盟的完整代理树与业绩股情况。"}
        actions={unionId ? (
          <>
            <Button variant="secondary" onClick={backToUnions}>返回联盟列表</Button>
            {can("game.club_perf.grant") && (
              <Button onClick={() => setGrantOpen(true)}>＋ 新增开通人员</Button>
            )}
          </>
        ) : undefined}
      />

      {!unionId ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>联盟列表</h2>
              <p>以联盟为单位查看业绩股；每个联盟包含其全部俱乐部的代理。</p>
            </div>
            <span className="reward-muted">共 {unions.length} 个联盟</span>
          </div>
          {error && <div className="form-error"><span>!</span>{error}</div>}
          {unionsLoading ? (
            <LoadingBlock label="正在读取联盟列表" />
          ) : unions.length === 0 ? (
            <EmptyState title="暂无联盟" description="游戏里还没有联盟，或当前账号没有可查看的联盟。" />
          ) : (
            <div className="table-wrap">
              <table className="club-perf-table">
                <thead>
                  <tr>
                    <th>联盟</th>
                    <th>联盟码</th>
                    <th>总群主</th>
                    <th className="reward-num">俱乐部</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {unions.map((item) => (
                    <tr key={item.unionId}>
                      <td><strong>{item.unionName || item.unionId}</strong></td>
                      <td>{item.unionId}</td>
                      <td>{item.ownerName || item.ownerId || "—"}</td>
                      <td className="reward-num">{item.clubCount}</td>
                      <td>
                        <Button variant="secondary" onClick={() => setUnionId(item.unionId)}>进入</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="club-perf-current">
            <div>
              <span>当前联盟</span>
              <strong>{selectedUnion?.unionName || data?.union.unionName || unionId}</strong>
              <small>联盟码 {unionId} · 总群主：{selectedUnion?.ownerName || selectedUnion?.ownerId || "—"}</small>
            </div>
            <div className="club-perf-filters">
              <Field label="统计日期（北京时间）">
                <input type="date" value={date} max={beijingDateInput()} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
                {loading ? "正在读取…" : "刷新"}
              </Button>
            </div>
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
                <span>已开通人员</span>
                <strong>{data.enabledCount} 人</strong>
                <small>只列已授权业绩股的人员</small>
              </div>
            </div>
          )}

          {loading && !data ? (
            <LoadingBlock label="正在读取业绩股" />
          ) : !data ? (
            <EmptyState title="暂无数据" description="请调整统计日期后刷新。" />
          ) : (
            <div className={`table-wrap${loading ? " is-loading" : ""}`}>
              <table className="club-perf-table">
                <thead>
                  <tr>
                    <th>代理</th>
                    <th>身份</th>
                    <th>俱乐部</th>
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
                      <tr key={node.key}>
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
                        <td className="reward-num">{num(node.my)}</td>
                        <td className="reward-num">{num(node.granted)}</td>
                        <td className="reward-num">{num(node.left)}</td>
                        <td className="reward-num">{node.percent}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <p className="club-perf-note">
              只列出已授权业绩股的人员；未授权人员不显示。未授权盟主的已授权下级会挂到最近的已授权上级。联盟根默认开通，其「我/下放/剩」是联盟树口径。
            </p>
          )}
        </section>
      )}

      {grantOpen && unionId && (
        <GrantMemberModal
          unionId={unionId}
          unionName={selectedUnion?.unionName || data?.union.unionName || unionId}
          onClose={() => setGrantOpen(false)}
          onGranted={handleGranted}
        />
      )}
    </div>
  );
}

function GrantMemberModal({ unionId, unionName, onClose, onGranted }: {
  unionId: string;
  unionName: string;
  onClose: () => void;
  onGranted: (result: GrantResponse) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<PerfCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PerfCandidate | null>(null);

  useEffect(() => {
    let alive = true;
    setCandidatesLoading(true);
    api<{ items: PerfCandidate[] }>(`/api/game/club-perf/candidates?union_id=${encodeURIComponent(unionId)}`)
      .then((result) => {
        if (!alive) return;
        setCandidates(result.items);
        setCandidatesError("");
      })
      .catch((reason: unknown) => {
        if (alive) setCandidatesError(reason instanceof Error ? reason.message : "读取联盟成员失败");
      })
      .finally(() => {
        if (alive) setCandidatesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [unionId]);

  const available = candidates.filter((item) => !item.enabled);
  const keyword = search.trim().toLowerCase();
  const filtered = keyword === ""
    ? available
    : available.filter((item) =>
        item.playerId.includes(keyword) || (item.name || "").toLowerCase().includes(keyword));

  const submit = async () => {
    if (!selected || selected.enabled || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<GrantResponse>("/api/game/club-perf/grant", {
        method: "POST",
        ...jsonBody({ union_id: unionId, player_id: selected.playerId }),
      });
      onGranted(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "授权失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="新增开通人员" eyebrow="GRANT PERFORMANCE SHARES" onClose={() => { if (!saving) onClose(); }}>
      <p className="club-perf-grant-note">
        为「{unionName}」开通业绩股。只能选择当前联盟内的成员，不支持跨联盟添加。
      </p>
      <Field label="搜索玩家">
        <input
          value={search}
          disabled={saving}
          placeholder="输入玩家ID或昵称"
          onChange={(event) => {
            setSearch(event.target.value);
            setSelected(null);
            setError("");
          }}
        />
      </Field>
      {candidatesLoading ? (
        <LoadingBlock label="正在读取联盟成员" />
      ) : candidatesError ? (
        <div className="form-error"><span>!</span>{candidatesError}</div>
      ) : (
        <>
          <div className="club-perf-candidate-head">
            <span>玩家</span>
            <span>俱乐部</span>
            <span>身份</span>
          </div>
          <div className="club-perf-candidate-list">
            {filtered.length === 0 ? (
              <p className="club-perf-candidate-empty">
                {available.length === 0 ? "当前联盟没有可添加的代理" : "没有匹配的未开通代理"}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.playerId}
                  type="button"
                  className={`club-perf-candidate${selected?.playerId === item.playerId ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelected(item);
                    setError("");
                  }}
                  disabled={saving}
                >
                  <span className="club-perf-candidate__name">
                    <strong>{item.name || `ID ${item.playerId}`}</strong>
                    <small>ID {item.playerId}</small>
                  </span>
                  <span>{item.clubName || item.clubId || "—"}</span>
                  <span>{item.role || "—"}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
      {selected && (
        <div className="club-perf-verify">
          <strong>{selected.name || `ID ${selected.playerId}`}（{selected.playerId}）</strong>
          <p>{selected.clubName || selected.clubId || "—"} · {selected.role || "—"}</p>
        </div>
      )}
      {error && <div className="form-error"><span>!</span>{error}</div>}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>取消</Button>
        <Button type="button" onClick={() => void submit()} disabled={!selected || saving}>
          {saving ? "正在授权…" : "确认开通"}
        </Button>
      </div>
    </Modal>
  );
}
