import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, formatDate, LoadingBlock, PageHeader } from "../components/ui";
import type { GameNotificationCarousel, GameNotificationHistoryItem } from "../types";

interface NotificationHistoryResponse { items: GameNotificationHistoryItem[] }
interface CarouselDraftItem { key: string; content: string }

let carouselDraftSequence = 0;
const nextCarouselKey = () => `carousel-${Date.now()}-${carouselDraftSequence++}`;

export default function GameNotificationsPage({ can, notify }: {
  can: (permission: string) => boolean;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [history, setHistory] = useState<GameNotificationHistoryItem[] | null>(null);
  const [content, setContent] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [carousel, setCarousel] = useState<GameNotificationCarousel | null>(null);
  const [carouselItems, setCarouselItems] = useState<CarouselDraftItem[]>([]);
  const [carouselEnabled, setCarouselEnabled] = useState(false);
  const [carouselInterval, setCarouselInterval] = useState(60);
  const [carouselStartAt, setCarouselStartAt] = useState("");
  const [carouselLoopCount, setCarouselLoopCount] = useState(0);
  const [carouselConfirmed, setCarouselConfirmed] = useState(false);
  const [savingCarousel, setSavingCarousel] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const result = await api<NotificationHistoryResponse>("/api/configuration/notifications?limit=20");
      setHistory(result.items);
    } catch (reason) {
      notify(errorMessage(reason, "通知记录加载失败"), "error");
    }
  }, [notify]);

  const loadCarousel = useCallback(async () => {
    try {
      const result = await api<GameNotificationCarousel>("/api/configuration/notification-carousel");
      setCarousel(result);
      setCarouselEnabled(result.enabled);
      setCarouselInterval(result.intervalSeconds);
      setCarouselStartAt(result.startAt ? toDateTimeLocal(result.startAt) : defaultCarouselStart());
      setCarouselLoopCount(result.loopCount);
      setCarouselItems(result.items.length > 0 ? result.items.map((item) => ({ key: nextCarouselKey(), content: item.content })) : [{ key: nextCarouselKey(), content: "" }]);
      setCarouselConfirmed(false);
    } catch (reason) {
      notify(errorMessage(reason, "轮播公告加载失败"), "error");
    }
  }, [notify]);

  useEffect(() => { void loadHistory(); void loadCarousel(); }, [loadCarousel, loadHistory]);

  const normalized = content.trim().replaceAll(",", "，").replace(/\s+/g, " ");
  const length = Array.from(normalized).length;

  const send = async () => {
    if (!normalized) { notify("请输入通知内容", "error"); return; }
    if (length > 500) { notify("通知内容不能超过 500 个字符", "error"); return; }
    if (!confirmed) { notify("请先确认发送范围", "error"); return; }
    setSending(true);
    try {
      const result = await api<{ message: string }>("/api/configuration/notifications", {
        method: "POST",
        ...jsonBody({ content: normalized, confirm: true }),
      });
      notify(result.message);
      setContent("");
      setConfirmed(false);
      await loadHistory();
    } catch (reason) {
      notify(errorMessage(reason, "全服通知发送失败"), "error");
      await loadHistory();
    } finally {
      setSending(false);
    }
  };

  const normalizedCarouselItems = carouselItems.map((item) => normalizeNotification(item.content));
  const carouselHasEmpty = normalizedCarouselItems.some((item) => !item);
  const carouselHasLongItem = normalizedCarouselItems.some((item) => Array.from(item).length > 500);
  const carouselIntervalValid = Number.isInteger(carouselInterval) && carouselInterval >= 10 && carouselInterval <= 86400;
  const carouselLoopCountValid = Number.isInteger(carouselLoopCount) && carouselLoopCount >= 0 && carouselLoopCount <= 999;
  const carouselStartValid = !carouselEnabled || Boolean(carouselStartAt && !Number.isNaN(new Date(carouselStartAt).getTime()));
  const canUpdateCarousel = can("configuration.notification.carousel.update");

  const changeCarouselItem = (key: string, value: string) => {
    setCarouselItems((current) => current.map((item) => item.key === key ? { ...item, content: value } : item));
    setCarouselConfirmed(false);
  };

  const moveCarouselItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= carouselItems.length) return;
    setCarouselItems((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setCarouselConfirmed(false);
  };

  const removeCarouselItem = (key: string) => {
    setCarouselItems((current) => current.length === 1 ? [{ key: nextCarouselKey(), content: "" }] : current.filter((item) => item.key !== key));
    setCarouselConfirmed(false);
  };

  const saveCarousel = async () => {
    if (!carouselIntervalValid) { notify("轮播间隔必须为10秒到24小时", "error"); return; }
    if (!carouselLoopCountValid) { notify("循环次数必须为0到999，0表示持续循环", "error"); return; }
    if (!carouselStartValid) { notify("请设置有效的轮播开始时间", "error"); return; }
    if (carouselHasEmpty) { notify("请填写或删除空白的轮播公告", "error"); return; }
    if (carouselHasLongItem) { notify("每条轮播公告不能超过500个字符", "error"); return; }
    if (carouselEnabled && !carouselConfirmed) { notify("请先确认启用轮播范围", "error"); return; }
    setSavingCarousel(true);
    try {
      const result = await api<GameNotificationCarousel>("/api/configuration/notification-carousel", {
        method: "PUT",
        ...jsonBody({ enabled: carouselEnabled, intervalSeconds: carouselInterval, startAt: carouselStartAt ? new Date(carouselStartAt).toISOString() : "", loopCount: carouselLoopCount, items: normalizedCarouselItems.map((item) => ({ content: item })), confirm: carouselEnabled }),
      });
      setCarousel(result);
      setCarouselItems(result.items.length > 0 ? result.items.map((item) => ({ key: nextCarouselKey(), content: item.content })) : [{ key: nextCarouselKey(), content: "" }]);
      setCarouselStartAt(result.startAt ? toDateTimeLocal(result.startAt) : defaultCarouselStart());
      setCarouselLoopCount(result.loopCount);
      setCarouselConfirmed(false);
      notify(result.enabled ? "轮播公告已保存，将按开始时间执行" : "轮播公告配置已保存，当前未启用");
    } catch (reason) {
      notify(errorMessage(reason, "轮播公告保存失败"), "error");
    } finally {
      setSavingCarousel(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="LIVE BROADCAST" title="游戏通知发送" description="向当前在线游戏玩家发送即时系统跑马灯通知。" actions={<span className="configuration-status is-live"><i />连接本机游戏服务</span>} />
      <section className="panel notification-carousel">
        <header className="configuration-panel-title">
          <div><span>CAROUSEL BROADCAST</span><h2>游戏轮播公告</h2><p>配置多条内容后，由正式后台服务按顺序向全部在线玩家循环播放。</p></div>
          <span className={`configuration-status ${carousel?.enabled ? "is-enabled" : "is-empty"}`}><i />{carousel?.enabled ? "轮播中" : "未启用"}</span>
        </header>
        {!carousel ? <LoadingBlock label="正在读取轮播公告" /> : <div className="notification-carousel__body">
          <div className="notification-carousel__settings">
            <label className="notification-carousel-switch"><input type="checkbox" checked={carouselEnabled} disabled={!canUpdateCarousel || savingCarousel} onChange={(event) => { setCarouselEnabled(event.target.checked); setCarouselConfirmed(false); }} /><span><strong>启用自动轮播</strong><small>关闭后保留内容，但停止自动发送。</small></span></label>
            <label className="notification-carousel-interval"><span>播放间隔</span><div><input type="number" min={10} max={86400} step={1} value={carouselInterval} disabled={!canUpdateCarousel || savingCarousel} onChange={(event) => { setCarouselInterval(Number(event.target.value)); setCarouselConfirmed(false); }} /><em>秒</em></div><small>{carouselIntervalValid ? `约 ${formatInterval(carouselInterval)} 播放下一条` : "允许10秒到24小时"}</small></label>
            <label className="notification-carousel-start"><span>开始时间</span><input type="datetime-local" value={carouselStartAt} disabled={!canUpdateCarousel || savingCarousel} onChange={(event) => { setCarouselStartAt(event.target.value); setCarouselConfirmed(false); }} /><small>时间已过则保存后尽快开始</small></label>
            <label className="notification-carousel-loops"><span>循环次数</span><div><input type="number" min={0} max={999} step={1} value={carouselLoopCount} disabled={!canUpdateCarousel || savingCarousel} onChange={(event) => { setCarouselLoopCount(Number(event.target.value)); setCarouselConfirmed(false); }} /><em>轮</em></div><small>0 表示持续循环；一轮会播放全部内容</small></label>
            <div className="notification-carousel-presets"><span>常用间隔</span>{[15, 30, 60, 120, 300, 600].map((seconds) => <button key={seconds} type="button" className={carouselInterval === seconds ? "is-active" : ""} disabled={!canUpdateCarousel || savingCarousel} onClick={() => { setCarouselInterval(seconds); setCarouselConfirmed(false); }}>{formatInterval(seconds)}</button>)}</div>
          </div>
          <div className="notification-carousel-list">
            <div className="notification-carousel-list__heading"><div><strong>轮播内容</strong><span>当前 {carouselItems.length} 条，按照从上到下的顺序循环。</span></div>{canUpdateCarousel && <Button variant="secondary" type="button" disabled={carouselItems.length >= 50 || savingCarousel} onClick={() => { setCarouselItems((current) => [...current, { key: nextCarouselKey(), content: "" }]); setCarouselConfirmed(false); }}>＋ 新增一条</Button>}</div>
            {carouselItems.map((item, index) => {
              const itemLength = Array.from(normalizeNotification(item.content)).length;
              return <article className="notification-carousel-item" key={item.key}>
                <div className="notification-carousel-item__order"><strong>{String(index + 1).padStart(2, "0")}</strong><span>第 {index + 1} 条</span></div>
                <div className="notification-carousel-item__content"><textarea rows={3} maxLength={550} value={item.content} disabled={!canUpdateCarousel || savingCarousel} onChange={(event) => changeCarouselItem(item.key, event.target.value)} placeholder="填写游戏内需要原样显示的轮播公告……" /><div><span className={itemLength > 500 ? "is-over" : ""}>{itemLength} / 500</span><p>游戏内将直接显示以上内容，不添加“系统广播”等前缀。</p></div></div>
                {canUpdateCarousel && <div className="notification-carousel-item__actions"><button type="button" title="上移" disabled={index === 0 || savingCarousel} onClick={() => moveCarouselItem(index, -1)}>↑</button><button type="button" title="下移" disabled={index === carouselItems.length - 1 || savingCarousel} onClick={() => moveCarouselItem(index, 1)}>↓</button><button className="is-delete" type="button" title="删除" disabled={savingCarousel} onClick={() => removeCarouselItem(item.key)}>删</button></div>}
              </article>;
            })}
          </div>
          <div className="notification-carousel-preview"><span>播放顺序预览</span><div>{normalizedCarouselItems.filter(Boolean).map((item, index) => <p key={`${item}-${index}`}><i>{index + 1}</i><strong>{item}</strong><em>{index === normalizedCarouselItems.filter(Boolean).length - 1 ? "回到第1条" : `等待 ${formatInterval(carouselIntervalValid ? carouselInterval : 0)}`}</em></p>)}</div></div>
          {carouselEnabled && <label className={`notification-confirm ${carouselConfirmed ? "is-checked" : ""}`}><input type="checkbox" checked={carouselConfirmed} disabled={!canUpdateCarousel || carouselHasEmpty || carouselHasLongItem || !carouselIntervalValid || !carouselLoopCountValid || !carouselStartValid || savingCarousel} onChange={(event) => setCarouselConfirmed(event.target.checked)} /><span><strong>确认启用全服自动轮播</strong><small>将在 {carouselStartAt ? new Date(carouselStartAt).toLocaleString("zh-CN", { hour12: false }) : "设定时间"} 开始，每 {formatInterval(carouselIntervalValid ? carouselInterval : 0)} 播放一条，{carouselLoopCount === 0 ? "持续循环" : `播放 ${carouselLoopCount} 轮后自动停止`}。</small></span></label>}
          <div className="notification-carousel-footer"><div><span>最近播放</span><strong>{carousel.lastSentAt ? formatDate(carousel.lastSentAt) : "尚未自动播放"}</strong><small>{carousel.lastMessage || `当前已完成 ${carousel.completedLoops} 轮`}</small></div>{canUpdateCarousel ? <Button type="button" disabled={savingCarousel || carouselHasEmpty || carouselHasLongItem || !carouselIntervalValid || !carouselLoopCountValid || !carouselStartValid || (carouselEnabled && !carouselConfirmed)} onClick={() => void saveCarousel()}>{savingCarousel ? "正在保存…" : carouselEnabled ? "保存并启用轮播" : "保存轮播配置"}</Button> : <span className="readonly-badge"><i />当前角色仅可查看</span>}</div>
        </div>}
      </section>
      <section className="notification-compose panel">
        <div className="notification-compose__intro">
          <span className="notification-compose__mark">通</span>
          <div><span>全服在线玩家</span><h2>编辑即时通知</h2><p>发送后不能撤回。通知只推送给当前在线玩家，不会改动长期游戏公告。</p></div>
        </div>
        <div className="notification-compose__editor">
          <div className="notification-textarea-wrap">
            <textarea rows={6} maxLength={550} value={content} onChange={(event) => { setContent(event.target.value); setConfirmed(false); }} disabled={!can("configuration.notification.send")} placeholder="例如：服务器将于今晚 23:30 进行维护，请提前结束牌局。" />
            <span className={length > 500 ? "is-over" : ""}>{length} / 500</span>
          </div>
          <div className="notification-preview"><span>玩家端跑马灯预览</span><div>{normalized || "这里显示即将发送的通知内容"}</div></div>
          <label className={`notification-confirm ${confirmed ? "is-checked" : ""}`}>
            <input type="checkbox" checked={confirmed} disabled={!can("configuration.notification.send") || !normalized || length > 500 || sending} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><strong>确认发送给全部在线玩家</strong><small>我已检查通知内容，了解发送后无法撤回。</small></span>
          </label>
          <div className="notification-send-actions">
            <p>填写什么，游戏里就显示什么；英文逗号会自动转换为中文逗号，避免旧客户端截断消息。</p>
            {can("configuration.notification.send") ? <Button type="button" disabled={!confirmed || !normalized || length > 500 || sending} onClick={() => void send()}><span>↗</span>{sending ? "正在提交…" : "立即发送全服通知"}</Button> : <span className="readonly-badge"><i />当前角色仅可查看记录</span>}
          </div>
        </div>
      </section>

      <section className="panel notification-history">
        <header className="configuration-panel-title"><div><span>SEND HISTORY</span><h2>最近发送记录</h2><p>记录发送内容、操作者、游戏服务接收结果和时间。</p></div><strong>{history?.length ?? 0} 条</strong></header>
        {!history ? <LoadingBlock label="正在读取通知记录" /> : history.length === 0 ? <EmptyState title="暂无通知记录" description="通过本页面发送第一条全服通知后会显示在这里。" /> : (
          <div className="table-wrap"><table className="notification-history-table"><thead><tr><th>发送时间</th><th>通知内容</th><th>操作者</th><th>状态</th><th>结果说明</th></tr></thead><tbody>
            {history.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td><strong className="notification-history-content">{item.content || "—"}</strong></td><td>{item.operatorName || "系统"}</td><td><NotificationStatus status={item.status} /></td><td>{item.resultMessage || "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}

function NotificationStatus({ status }: { status: GameNotificationHistoryItem["status"] }) {
  const labels = { sent: "已处理", accepted: "处理中", failed: "发送失败" };
  return <span className={`notification-state notification-state--${status}`}><i />{labels[status]}</span>;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback;
}

function normalizeNotification(value: string) {
  return value.trim().replaceAll(",", "，").replace(/\s+/g, " ");
}

function formatInterval(seconds: number) {
  if (!seconds) return "—";
  if (seconds % 3600 === 0) return `${seconds / 3600}小时`;
  if (seconds % 60 === 0) return `${seconds / 60}分钟`;
  return `${seconds}秒`;
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultCarouselStart() {
  return toDateTimeLocal(new Date(Date.now() + 5 * 60_000).toISOString());
}
