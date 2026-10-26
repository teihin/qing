import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import type { StoneConsumePriceItemState, StoneConsumePriceState } from "../types";

const cloneState = (value: StoneConsumePriceState) => structuredClone(value);

/**
 * 钻石消费价格。
 *
 * 这里改的是客户端「玩家_消费_命令」按 `money_type=stone` 扣多少钻石，
 * 配置落在游戏端哈希配置表 `usr_hash_info`（key=消费钻石价格），客户端进大厅时读取一次。
 * 保存后玩家需要重新进大厅（或重新登录）才能拿到新价格。
 */
export default function StoneConsumePricePage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<StoneConsumePriceState | null>(null);
  const [draft, setDraft] = useState<StoneConsumePriceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<StoneConsumePriceState>("/api/configuration/stone-consume");
      setOriginal(result);
      setDraft(cloneState(result));
      setConfirmed(false);
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "钻石消费价格加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const canUpdate = can("configuration.stone_consume.update");
  const dirty = Boolean(original && draft && JSON.stringify(original.items) !== JSON.stringify(draft.items));
  const changeCount = useMemo(() => countChanges(original, draft), [original, draft]);

  const updateItem = (code: string, value: string) => setDraft((current) => {
    if (!current) return current;
    const next = cloneState(current);
    const index = next.items.findIndex((item) => item.code === code);
    if (index < 0) return current;
    const parsed = Number(value);
    next.items[index] = { ...next.items[index], stone: Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0 };
    return next;
  });

  const resetToDefault = () => setDraft((current) => {
    if (!current) return current;
    const next = cloneState(current);
    next.items = next.items.map((item) => ({ ...item, stone: item.defaultStone }));
    return next;
  });

  const save = async () => {
    if (!draft || !original) return;
    setBusy(true);
    try {
      const result = await api<StoneConsumePriceState>("/api/configuration/stone-consume", {
        method: "PUT",
        ...jsonBody({ items: draft.items.map((item) => ({ code: item.code, stone: item.stone })), confirm: confirmed }),
      });
      setOriginal(result);
      setDraft(cloneState(result));
      setConfirmed(false);
      notify("钻石消费价格已保存并回读校验，玩家重新进大厅后生效");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "钻石消费价格保存失败", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !draft) return <div className="panel"><LoadingBlock label="正在读取钻石消费价格" /></div>;
  if (!draft || !original) return <EmptyState title="钻石消费价格无法显示" description="请稍后刷新页面重试。" />;

  const freeCount = draft.items.filter((item) => item.stone === 0).length;
  return <div className="page-stack">
    <PageHeader
      eyebrow="STONE CONSUMPTION"
      title="钻石消费价格"
      description="游戏内所有消费功能都改为扣钻石。这里配置每个功能扣多少钻石，保存后写入游戏端哈希配置，玩家重新进大厅生效。"
      actions={<Button variant="secondary" onClick={() => void load()}>重新读取</Button>}
    />
    <section className="configuration-summary-strip">
      <div><span>消费项</span><strong>{draft.items.length}</strong></div>
      <div><span>免费项</span><strong>{freeCount}</strong></div>
      <div><span>配置状态</span><strong>{draft.configured ? "已下发" : "使用默认值"}</strong></div>
      <div><span>待保存变更</span><strong>{changeCount}</strong></div>
    </section>

    {draft.parseError && <div className="form-error"><span>!</span>现有配置无法解析（{draft.parseError}）。下表显示的是默认值，保存会整体覆盖。</div>}
    {!draft.configured && !draft.parseError && draft.missingItems.length > 0 && (
      <div className="form-error"><span>i</span>游戏端还没有这份配置，下表为内置默认值。点「保存」后才会真正下发。</div>
    )}
    {draft.unknownItems.length > 0 && (
      <div className="form-error"><span>i</span>配置里还有本页不认识的消费项：{draft.unknownItems.join("、")}。保存只写本页这些项，这些项会被清掉，请确认它们已废弃。</div>
    )}

    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>消费项</th>
              <th>出现位置</th>
              <th>原金币价</th>
              <th>扣钻石（个）</th>
              <th>内置默认</th>
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item) => (
              <tr key={item.code}>
                <td><strong>{item.name}</strong><br /><small style={{ color: "#78909c" }}>{item.code}</small></td>
                <td>{item.scene}</td>
                <td>{formatLegacy(item)}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    value={item.stone}
                    disabled={!canUpdate || busy}
                    onChange={(event) => updateItem(item.code, event.target.value)}
                    style={{ width: 120 }}
                  />
                </td>
                <td>{item.defaultStone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#71878c", fontSize: 13, padding: "10px 18px 16px" }}>
        0 表示免费（不扣钻石、不写流水）。玩家钻石不足时服务端会扣到 0 为止并仍返回成功，客户端以属性刷新为准。
      </p>
    </section>

    <section className={`configuration-savebar ${dirty ? "is-dirty" : ""}`}>
      <div>
        <strong>{dirty ? `共有 ${changeCount} 个消费项发生变化` : "当前内容与游戏配置一致"}</strong>
        <p>保存后写入 usr_hash_info（key：{draft.storageKey}），并回读校验。{draft.updatedBy ? `上次修改：${draft.updatedBy}` : ""}</p>
      </div>
      <label className="confirm-check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!dirty} />
        <span>我已核对这些钻石数量</span>
      </label>
      <Button variant="secondary" disabled={!dirty || busy || !canUpdate} onClick={resetToDefault}>全部恢复默认</Button>
      <Button variant="secondary" disabled={!dirty || busy} onClick={() => { setDraft(cloneState(original)); setConfirmed(false); }}>放弃修改</Button>
      <Button disabled={!dirty || !confirmed || busy || !canUpdate} onClick={() => void save()}>
        {busy ? "正在保存并回读…" : "保存钻石消费价格"}
      </Button>
    </section>
  </div>;
}

function formatLegacy(item: StoneConsumePriceItemState) {
  if (!item.legacyMoney) return "—";
  if (item.legacyUnit === "分") return `${item.legacyMoney} 分（${(item.legacyMoney / 100).toFixed(2)} 元）`;
  return `${item.legacyMoney} ${item.legacyUnit}`;
}

function countChanges(before: StoneConsumePriceState | null, after: StoneConsumePriceState | null) {
  if (!before || !after) return 0;
  let count = 0;
  after.items.forEach((item, index) => {
    if (JSON.stringify(item) !== JSON.stringify(before.items[index])) count++;
  });
  return count;
}
