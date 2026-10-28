import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../../api";
import { Button, EmptyState, Field, FormActions, LoadingBlock, Modal, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  LevelBadge,
  Pagination,
  timeText,
  type AutomationAlertItem,
  type AutomationPageProps,
} from "./shared";

interface AlertListResponse { items: AutomationAlertItem[]; page: number; pageSize: number; total: number }

const categoryLabels: Record<string, string> = {
  worker_offline: "节点离线",
  ip_conflict: "IP 冲突",
  low_balance: "余额不足",
  room_expiring: "房间将结束",
  task_backlog: "任务积压",
  strategy_stop_loss: "策略止损",
  heartbeat: "心跳异常",
  login_failed: "登录失败",
  seat_shortage: "在座不足",
  loss_streak: "连续亏损",
  version: "版本检查",
};

const targetTypeLabels: Record<string, string> = { robot: "终端", worker: "节点", credential: "账号", club: "俱乐部", room: "房间", task: "任务", strategy: "策略", group: "自动化组" };

export default function AutomationAlertsPage({ can, notify }: AutomationPageProps) {
  const [data, setData] = useState<AlertListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [handling, setHandling] = useState<AutomationAlertItem | null>(null);
  const [viewing, setViewing] = useState<AutomationAlertItem | null>(null);

  const load = useCallback(async (targetPage: number, targetSize: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<AlertListResponse>(`/api/automation/alerts?page=${targetPage}&pageSize=${targetSize}&keyword=${encodeURIComponent(query)}&level=${level}&status=${status}`));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "告警加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, level, status, notify]);

  useEffect(() => { void load(page, pageSize); }, [load, page, pageSize]);

  const stats = useMemo(() => {
    const items = data?.items ?? [];
    return {
      p0: items.filter((item) => item.level === "P0" && ["open", "ack"].includes(item.status)).length,
      open: items.filter((item) => item.status === "open").length,
      ack: items.filter((item) => item.status === "ack").length,
      resolved: items.filter((item) => item.status === "resolved").length,
    };
  }, [data]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="ALERT CENTER"
      title="告警中心"
      description="聚合账号、设备、房间、策略和 Worker 告警；P0 告警应优先认领和解决，所有处理都会写入审计。"
      actions={<Button variant="secondary" disabled={loading} onClick={() => void load(page, pageSize)}>{loading ? "正在刷新…" : "刷新"}</Button>}
    />

    <DemoNote>演示告警由种子数据生成，处理动作直接写入演示库；正式环境由规则引擎和 Worker 心跳自动产生。</DemoNote>

    <section className="automation-mini-stats">
      <div><span>P0 待处理</span><strong className={stats.p0 > 0 ? "automation-danger-text" : ""}>{stats.p0}</strong></div>
      <div><span>待处理</span><strong>{stats.open}</strong></div>
      <div><span>已认领</span><strong>{stats.ack}</strong></div>
      <div><span>本页已解决</span><strong>{stats.resolved}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar automation-toolbar automation-toolbar--wrap">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(keyword.trim()); }}>
          <span>⌕</span>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、详情或目标 ID" />
          <button>搜索</button>
        </form>
        <div className="automation-filter-row">
          <label>等级<select value={level} onChange={(event) => { setPage(1); setLevel(event.target.value); }}><option value="">全部等级</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select></label>
          <label>状态<select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">全部状态</option><option value="open">待处理</option><option value="ack">已认领</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></label>
          <label>每页<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="automation-panel-pad"><ErrorBanner message={error} /></div>}
      {!data && loading ? <LoadingBlock label="正在读取告警" /> : !data || data.items.length === 0 ? <EmptyState title="没有匹配的告警" description="调整筛选条件，或等待规则引擎产生新告警。" /> : <>
        <div className="table-wrap">
          <table className="automation-table">
            <thead><tr><th>等级</th><th>告警</th><th>分类</th><th>目标</th><th>状态</th><th>处理人</th><th>最近发生</th><th>操作</th></tr></thead>
            <tbody>{data.items.map((alert) => <tr key={alert.id} className={alert.level === "P0" ? "is-risk" : ""}>
              <td><LevelBadge level={alert.level} /></td>
              <td><button type="button" className="link-button" onClick={() => setViewing(alert)}>{alert.title}</button><small className="cell-subtitle">{alert.detail}</small></td>
              <td>{categoryLabels[alert.category] ?? alert.category}</td>
              <td>{targetTypeLabels[alert.targetType] ?? alert.targetType}<small className="cell-subtitle">#{alert.targetId}</small></td>
              <td><AutomationBadge value={alert.status} />{alert.note && <small className="cell-subtitle">{alert.note}</small>}</td>
              <td>{alert.assignee || "—"}</td>
              <td>{timeText(alert.lastSeen)}<small className="cell-subtitle">首次 {timeText(alert.firstSeen)}</small></td>
              <td><div className="row-actions">
                <button type="button" onClick={() => setViewing(alert)}>查看</button>
                {can("automation.alert.handle") && ["open", "ack"].includes(alert.status) && <button type="button" onClick={() => setHandling(alert)}>处理</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onPage={setPage} onPageSize={(size) => { setPage(1); setPageSize(size); }} />
      </>}
    </section>

    {viewing && <AlertDetailModal alert={viewing} canHandle={can("automation.alert.handle")} onClose={() => setViewing(null)} onHandle={() => { setHandling(viewing); setViewing(null); }} />}
    {handling && <AlertHandleModal alert={handling} onClose={() => setHandling(null)} onDone={(message) => { setHandling(null); notify(message); void load(page, pageSize, true); }} />}
  </div>;
}

function AlertDetailModal({ alert, canHandle, onClose, onHandle }: { alert: AutomationAlertItem; canHandle: boolean; onClose: () => void; onHandle: () => void }) {
  return <Modal title={alert.title} eyebrow={`${alert.level} · ${categoryLabels[alert.category] ?? alert.category}`} onClose={onClose} wide>
    <div className="automation-detail-metrics">
      <div><span>状态</span><strong className="automation-detail-text"><AutomationBadge value={alert.status} /></strong></div>
      <div><span>目标</span><strong>{targetTypeLabels[alert.targetType] ?? alert.targetType} #{alert.targetId}</strong></div>
      <div><span>处理人</span><strong>{alert.assignee || "未认领"}</strong></div>
      <div><span>首次发生</span><strong>{timeText(alert.firstSeen)}</strong></div>
      <div><span>最近发生</span><strong>{timeText(alert.lastSeen)}</strong></div>
    </div>
    <h3 className="automation-section-title">告警详情</h3>
    <p className="automation-alert-detail">{alert.detail || "没有更多详情。"}</p>
    {alert.note && <><h3 className="automation-section-title">处理备注</h3><p className="automation-alert-detail">{alert.note}</p></>}
    {alert.resolvedAt && <p className="automation-inline-hint">解决于 {timeText(alert.resolvedAt)}</p>}
    <div className="automation-modal-actions">
      <Button variant="secondary" onClick={onClose}>关闭</Button>
      {canHandle && ["open", "ack"].includes(alert.status) && <Button onClick={onHandle}>处理告警</Button>}
    </div>
  </Modal>;
}

function AlertHandleModal({ alert, onClose, onDone }: { alert: AutomationAlertItem; onClose: () => void; onDone: (message: string) => void }) {
  const [action, setAction] = useState(alert.status === "open" ? "ack" : "resolve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/automation/alerts/${alert.id}/handle`, { method: "POST", ...jsonBody({ action, note }) });
      onDone(result.message);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "处理告警失败");
    } finally {
      setBusy(false);
    }
  };

  const submitText = action === "ack" ? "确认认领" : action === "resolve" ? "确认解决" : "确认忽略";

  return <Modal title={`处理：${alert.title}`} eyebrow={`${alert.level} · ${alert.id}`} onClose={onClose}>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <ErrorBanner message={error} />
      <Field label="处理动作"><select value={action} onChange={(event) => setAction(event.target.value)}><option value="ack">认领（我来处理）</option><option value="resolve">解决</option><option value="ignore">忽略</option></select></Field>
      <Field label="处理备注" hint="最多 300 个字符，会追加到告警记录"><textarea rows={4} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="automation-form-note">{action === "ack" ? "认领后告警仍保持打开状态，便于同组同事知道已有人接手。" : action === "resolve" ? "解决后告警会记录解决时间，不再出现在待处理列表。" : "忽略适合已知的误报；建议填写原因，后续可追溯。"}</div>
      <FormActions onCancel={onClose} busy={busy} submitText={submitText} />
    </form>
  </Modal>;
}
