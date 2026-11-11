import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import DarkSettingModal from "../components/DarkSettingModal";
import OwnerEarningsModal from "../components/OwnerEarningsModal";
import { Button, EmptyState, Field, LoadingBlock, Modal, PageHeader, submitGuard } from "../components/ui";
import type { UnionListItem, UnionListResponse, UnionQuotaAdjustmentResponse } from "../types";

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
 * 列出全部联盟与联盟信息；行内「加额度 / 减额度」调整联盟池，点击「详情」进入俱乐部管理，
 * 并按 unionId 过滤出该联盟下的俱乐部。
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
  const [adjustTarget, setAdjustTarget] = useState<{ union: UnionListItem; action: "add" | "subtract" } | null>(null);
  const [darkUnion, setDarkUnion] = useState<UnionListItem | null>(null);
  const [earningsUnion, setEarningsUnion] = useState<UnionListItem | null>(null);
  const canAdjust = can("game.union.quota_adjust");
  const canSetDark = can("game.union.dark_setting");

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
        description="联盟模式 V2：查看联盟总群主、联盟池与俱乐部数量；行内可给联盟池加/减额度，详情进入俱乐部管理查看该联盟下的全部俱乐部。"
        actions={
          <span className="readonly-badge">
            <i />
            {canAdjust ? "联盟池以游戏服为准，可加/减额度" : "只读：无联盟池调整权限"}
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
                    <th>暗抽</th>
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
                        <strong className={union.darkEnabled ? "club-quota-value" : "club-quota-missing"}>
                          {union.darkEnabled ? "开启" : "关闭"}
                        </strong>
                        <small className="cell-subtitle">总群主俱乐部</small>
                      </td>
                      <td>
                        <strong>{statusLabels[union.status] ?? union.status ?? "—"}</strong>
                        <small className="cell-subtitle">{union.createdAt || "—"}</small>
                      </td>
                      <td>
                        <div className="row-actions">
                          {canAdjust && (
                            <>
                              <button
                                type="button"
                                onClick={() => setAdjustTarget({ union, action: "add" })}
                                title="给该联盟的联盟池增加额度"
                              >
                                加额度
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => setAdjustTarget({ union, action: "subtract" })}
                                title="从该联盟的联盟池扣减额度"
                              >
                                减额度
                              </button>
                            </>
                          )}
                          <button type="button" onClick={() => setEarningsUnion(union)} title="按暗抽、奖池查看该联盟大盟主的每日收益与明细">
                            收益对账
                          </button>
                          <button
                            type="button"
                            onClick={() => setDarkUnion(union)}
                            disabled={!canSetDark}
                            title={
                              canSetDark
                                ? "开启或关闭联盟总群主俱乐部开房-游戏设置里的暗抽"
                                : "当前角色没有暗抽开关的权限"
                            }
                          >
                            暗抽设置
                          </button>
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

      {adjustTarget && (
        <UnionQuotaModal
          union={adjustTarget.union}
          action={adjustTarget.action}
          notify={notify}
          onClose={() => setAdjustTarget(null)}
          onDone={() => void load()}
        />
      )}

      {darkUnion && (
        <DarkSettingModal
          scope="union"
          targetId={darkUnion.unionId}
          targetName={darkUnion.name || darkUnion.unionId}
          ownerClubId={darkUnion.ownerClubId}
          currentEnabled={!!darkUnion.darkEnabled}
          canEdit={canSetDark}
          notify={notify}
          onClose={() => setDarkUnion(null)}
          onDone={() => void load()}
        />
      )}

      {earningsUnion && (
        <OwnerEarningsModal
          scope="union"
          unionId={earningsUnion.unionId}
          notify={notify}
          onClose={() => setEarningsUnion(null)}
        />
      )}
    </div>
  );
}

/**
 * 联盟池加/减额度。
 *
 * 联盟模式 V2 下平台调整的对象是联盟池（总群主可分配额度）：
 * 增加与扣减都走游戏服「增加_联盟_额度」，扣减按负数 quota_fen 传入。
 * 金额按「元」输入，提交换算成分，成功后回读联盟池。
 */
function UnionQuotaModal({
  union,
  action,
  notify,
  onClose,
  onDone,
}: {
  union: UnionListItem;
  action: "add" | "subtract";
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UnionQuotaAdjustmentResponse | null>(null);

  const isSubtract = action === "subtract";
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const deltaFen = valid ? Math.round(parsed * 100) : 0;
  const overdraw = isSubtract && deltaFen > union.poolQuotaFen;
  const projectedFen = isSubtract ? union.poolQuotaFen - deltaFen : union.poolQuotaFen + deltaFen;
  const canSubmit = valid && !overdraw && reason.trim().length >= 2 && confirmed && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await api<UnionQuotaAdjustmentResponse>(
        `/api/game/unions/${union.unionId}/quota-adjustments`,
        {
          method: "POST",
          ...jsonBody({
            action,
            amountYuan: parsed,
            reason: reason.trim(),
            expectedPoolQuotaYuan: union.poolQuotaFen / 100,
            confirm: true,
          }),
        },
      );
      setResult(outcome);
      notify(
        outcome.verified ? outcome.message : "额度变更已提交，但未回读校验，请刷新后确认",
        outcome.verified ? "success" : "error",
      );
      onDone();
    } catch (reason_) {
      setError(errorMessage(reason_, isSubtract ? "联盟池扣减失败" : "联盟池注资失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${isSubtract ? "扣减" : "增加"}「${union.name || union.unionId}」的联盟额度`}
      eyebrow={`UNION QUOTA · ${union.unionId}`}
      onClose={onClose}
    >
      <div className="quota-intro">
        <p>
          这里调整的是<strong>联盟池</strong>（联盟总群主可分配额度），单位<strong>分</strong>；
          界面输入<strong>元</strong>，提交后交给游戏服「增加_联盟_额度」
          {isSubtract ? "按负数扣减" : "注资"}，成功后会回读联盟池。
        </p>
        <ul>
          <li>扣减不能超过当前联盟池，扣减后额度不会小于 0。</li>
          <li>平台只调整联盟池，不直接改各俱乐部的额度。</li>
          <li>操作会记入后台审计，原因必填（2–120 字）。</li>
        </ul>
        <div className="union-quota-current">
          <div>
            <span>当前联盟池</span>
            <strong>{amountFormatter.format(union.poolQuotaFen / 100)} 元</strong>
          </div>
          <div>
            <span>操作后预计</span>
            <strong>{valid ? `${amountFormatter.format(projectedFen / 100)} 元` : "—"}</strong>
          </div>
        </div>
      </div>

      {result ? (
        <div className={`quota-result ${result.verified ? "is-ok" : "is-unverified"}`}>
          <strong>
            {result.verified
              ? result.action === "subtract"
                ? "联盟池已扣减并回读校验"
                : "联盟池已注资并回读校验"
              : "额度变更已提交，未回读校验"}
          </strong>
          <p>{result.message}</p>
          <dl>
            <div>
              <dt>{result.deltaFen < 0 ? "本次扣减" : "本次增加"}</dt>
              <dd>
                {result.deltaFen < 0 ? "−" : "+"}
                {amountFormatter.format(Math.abs(result.deltaFen) / 100)} 元
              </dd>
            </div>
            <div>
              <dt>变更后联盟池</dt>
              <dd>{amountFormatter.format(result.poolQuotaYuan)} 元</dd>
            </div>
          </dl>
          <div className="form-actions">
            <Button type="button" onClick={onClose}>
              完成
            </Button>
          </div>
        </div>
      ) : (
        <form className="form-grid form-grid--single" onSubmit={submitGuard(submit)}>
          {error && (
            <div className="form-error">
              <span>!</span>
              {error}
            </div>
          )}
          {overdraw && (
            <div className="form-error">
              <span>!</span>
              扣减金额不能超过当前联盟池
            </div>
          )}
          <Field
            label={isSubtract ? "扣减金额（元）" : "增加金额（元）"}
            hint={valid ? `提交为 ${isSubtract ? "-" : "+"}${deltaFen} 分` : "支持两位小数，单次不超过 100 万元"}
          >
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
            <span>
              {isSubtract
                ? "我确认本次操作会直接扣减联盟池额度，不直接改动各俱乐部额度"
                : "我确认本次操作只增加联盟池额度，不直接改变俱乐部额度"}
            </span>
          </label>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant={isSubtract ? "danger" : "primary"} disabled={!canSubmit}>
              {busy ? "提交中…" : isSubtract ? "确认扣减" : "确认注资"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
