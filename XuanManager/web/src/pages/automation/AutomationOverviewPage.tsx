import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../../components/ui";
import {
  AutomationBadge,
  DemoNote,
  ErrorBanner,
  LevelBadge,
  MetricCard,
  ProgressBar,
  formatMoney,
  formatSigned,
  statusLabel,
  categoryLabel,
  targetTypeLabel,
  timeText,
  type AutomationOverviewData,
  type AutomationPageProps,
} from "./shared";

const actionLabels: Record<string, string> = {
  "robot.batch_stop": "批量停止终端",
  "robot.batch_drain": "批量排空终端",
  "robot.delete": "删除终端",
  "strategy.publish": "发布策略",
};

export default function AutomationOverviewPage({ notify }: AutomationPageProps) {
  const [data, setData] = useState<AutomationOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await api<AutomationOverviewData>("/api/automation/overview"));
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : "自动化总览加载失败";
      setError(message);
      if (!quiet) notify(message, "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const metrics = data?.metrics;
  const openAlerts = data?.alerts.filter((item) => item.status === "open" || item.status === "ack") ?? [];
  const pendingApprovals = data?.approvals.filter((item) => item.status === "pending") ?? [];

  return <div className="page-stack">
    <PageHeader
      eyebrow="AUTOMATION CONTROL PLANE"
      title="自动化总览"
      description="汇总机器人终端、俱乐部房间池、Worker 节点和待处理告警；所有时间均为北京时间。"
      actions={<Button variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新总览"}</Button>}
    />

    {error && !data && <section className="panel"><div className="automation-panel-pad"><ErrorBanner message={error} /></div></section>}
    {!data && loading ? <section className="panel"><LoadingBlock label="正在汇总自动化运行状态" /></section> : data && <>
      <section className="metric-grid">
        <MetricCard tone="cyan" icon="机" label="在线终端 / 总量" value={`${metrics?.onlineRobots ?? 0} / ${metrics?.totalRobots ?? 0}`} note={`游戏中 ${metrics?.playingRobots ?? 0} · 在座 ${metrics?.seatedRobots ?? 0}`} />
        <MetricCard tone="blue" icon="座" label="机器人在座 / 在线" value={`${metrics?.seatedRobots ?? 0} / ${metrics?.onlineRobots ?? 0}`} note={`全场在座 ${metrics?.seatedTotal ?? 0} · 房间总容量 ${metrics?.capacity ?? 0} 座`} />
        <MetricCard tone="green" icon="局" label="今日完成局数" value={formatMoney(metrics?.todayRounds ?? 0)} note={`今日净分 ${formatSigned(metrics?.todayNet ?? 0)}`} />
        <MetricCard tone={(metrics?.faultedRobots ?? 0) > 0 ? "gold" : "slate"} icon="健" label="终端健康度" value={`${(metrics?.healthRate ?? 0).toFixed(1)}%`} note={`故障 ${metrics?.faultedRobots ?? 0} 台 · 告警 P0 ${metrics?.p0Alerts ?? 0} 条`} />
      </section>

      <section className="automation-overview-strip">
        <button type="button" className="automation-strip-card" onClick={() => { window.location.hash = "/automation/alerts"; }}>
          <span>待处理告警</span><strong>{metrics?.openAlerts ?? 0}</strong><em>{metrics?.p0Alerts ? `${metrics.p0Alerts} 条 P0 需要立即处理` : "当前没有 P0 告警"}</em>
        </button>
        <button type="button" className="automation-strip-card" onClick={() => { window.location.hash = "/automation/tasks"; }}>
          <span>待审批高风险操作</span><strong>{metrics?.pendingApprovals ?? 0}</strong><em>批量停止、删除和全量发布需审批</em>
        </button>
        <button type="button" className="automation-strip-card" onClick={() => { window.location.hash = "/automation/workers"; }}>
          <span>Worker 节点</span><strong>{data.workers.filter((item) => item.status === "online").length} / {data.workers.length}</strong><em>{data.workers.filter((item) => item.status !== "online").map((item) => item.nodeCode).join("、") || "全部在线"}</em>
        </button>
      </section>

      <DemoNote>当前为后台演示环境：操作直接写入演示数据，不会连接真实游戏账号或 Worker。数据生成于 {timeText(data.generatedAt)}。</DemoNote>

      <section className="automation-club-grid">
        {data.clubs.map((club) => <article className="automation-club-card" key={club.clubId}>
          <header>
            <div><span>{club.clubId} · 模式 {club.mode}</span><strong>{club.name}</strong></div>
            <AutomationBadge value={club.status} />
          </header>
          <div className="automation-club-card__stats">
            <div><span>房间</span><strong>{club.roomCount}</strong></div>
            <div><span>在座 / 容量</span><strong>{club.seated} / {club.capacity}</strong></div>
            <div><span>终端配额</span><strong>{club.onlineCount} / {club.robotQuota}</strong></div>
            <div><span>占座比例</span><strong>{club.seatRatio}%</strong></div>
          </div>
          <footer>
            <span>目标在座 {club.targetSeated} 台</span>
            <button type="button" onClick={() => { window.location.hash = "/automation/clubs"; }}>管理接入</button>
          </footer>
        </article>)}
      </section>

      <section className="automation-two-col">
        <div className="panel">
          <header className="panel__header"><div><span className="eyebrow">ALERT STREAM</span><h2>最新告警</h2></div><span>{openAlerts.length} 条未关闭</span></header>
          {openAlerts.length === 0 ? <EmptyState title="没有未关闭告警" description="终端、房间和任务均未触发需要处理的告警。" /> : <div className="automation-alert-list">
            {openAlerts.slice(0, 6).map((alert) => <article key={alert.id} className="automation-alert-item">
              <LevelBadge level={alert.level} />
              <div><strong>{alert.title}</strong><p>{alert.detail}</p><small>{categoryLabel(alert.category)} · {targetTypeLabel(alert.targetType)} #{alert.targetId} · {timeText(alert.lastSeen)}</small></div>
              <AutomationBadge value={alert.status} />
            </article>)}
          </div>}
          <footer className="automation-panel-footer"><button type="button" onClick={() => { window.location.hash = "/automation/alerts"; }}>进入告警中心</button></footer>
        </div>

        <div className="panel">
          <header className="panel__header"><div><span className="eyebrow">APPROVAL QUEUE</span><h2>待审批</h2></div><span>{pendingApprovals.length} 单</span></header>
          {pendingApprovals.length === 0 ? <EmptyState title="没有待审批操作" description="高风险操作会在这里排队等待其他管理员确认。" /> : <div className="automation-approval-list">
            {pendingApprovals.slice(0, 4).map((item) => <article key={item.id}>
              <div><strong>{actionLabels[item.action] ?? item.action}</strong><p>{item.reason || "未填写申请原因"}</p><small>{item.requesterName} · {timeText(item.createdAt)}</small></div>
              <span>#{item.id}</span>
            </article>)}
          </div>}
          <footer className="automation-panel-footer"><button type="button" onClick={() => { window.location.hash = "/automation/tasks"; }}>进入任务与审批</button></footer>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header"><div><span className="eyebrow">WORKER FLEET</span><h2>Worker 节点负载</h2></div><span>{data.workers.length} 个节点</span></header>
        <div className="automation-worker-grid">
          {data.workers.map((worker) => <article key={worker.id} className={`automation-worker-card is-${worker.status}`}>
            <header><div><span>{worker.host} · {worker.os}</span><strong>{worker.nodeCode}</strong></div><AutomationBadge value={worker.status} /></header>
            <div className="automation-worker-line"><span>承载终端</span><ProgressBar value={worker.robotCount} max={worker.maxRobots} /></div>
            <div className="automation-worker-line"><span>CPU</span><ProgressBar value={worker.cpuPct} max={100} danger={worker.cpuPct >= 90} /></div>
            <div className="automation-worker-line"><span>内存</span><ProgressBar value={worker.memPct} max={100} danger={worker.memPct >= 90} /></div>
            <footer><span>v{worker.version} · {worker.egressCidr || "未配置出口"}</span><em>{statusLabel(worker.status)} · {timeText(worker.lastHeartbeat)}</em></footer>
          </article>)}
        </div>
      </section>
    </>}
  </div>;
}
