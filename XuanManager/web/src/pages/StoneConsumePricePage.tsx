import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import type { ClubSeatStoneRatioState, StoneConsumePriceState } from "../types";

const cloneState = (value: StoneConsumePriceState) => structuredClone(value);

/**
 * 钻石消费价格 + 俱乐部带入钻石兑换比例。
 *
 * 价格改的是客户端「玩家_消费_命令」按 `money_type=stone` 扣多少钻石，
 * 配置落在游戏端哈希配置表 `usr_hash_info`（key=消费钻石价格），客户端进大厅时读取一次。
 * 兑换比例是另一条 key（俱乐部积分对应钻石输赢比，纯小数），建房时快照，0 = 不扣钻石。
 * 保存后玩家需要重新进大厅（或至少等 10 秒）才能拿到新配置。
 */
export default function StoneConsumePricePage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [original, setOriginal] = useState<StoneConsumePriceState | null>(null);
  const [draft, setDraft] = useState<StoneConsumePriceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [ratioOriginal, setRatioOriginal] = useState<ClubSeatStoneRatioState | null>(null);
  const [ratioDraft, setRatioDraft] = useState("");

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
    try {
      const ratio = await api<ClubSeatStoneRatioState>("/api/configuration/club-seat-stone-ratio");
      setRatioOriginal(ratio);
      setRatioDraft(String(ratio.ratio));
    } catch (reason) {
      setRatioOriginal(null);
      setRatioDraft("");
      notify(reason instanceof ApiError ? reason.message : "带入钻石兑换比例加载失败", "error");
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const canUpdate = can("configuration.stone_consume.update");
  const dirty = Boolean(original && draft && JSON.stringify(original.items) !== JSON.stringify(draft.items));
  const ratioValue = Number(ratioDraft);
  const ratioValid = ratioDraft.trim() !== "" && Number.isFinite(ratioValue) && ratioValue >= 0 && ratioValue <= 1000;
  const ratioDirty = Boolean(ratioOriginal && ratioValid && ratioValue !== ratioOriginal.ratio);
  const priceChangeCount = useMemo(() => countChanges(original, draft), [original, draft]);
  const changeCount = priceChangeCount + (ratioDirty ? 1 : 0);
  const anyDirty = dirty || ratioDirty;

  const updateItem = (code: string, value: string) => setDraft((current) => {
    if (!current) return current;
    const next = cloneState(current);
    const index = next.items.findIndex((item) => item.code === code);
    if (index < 0) return current;
    const parsed = Number(value);
    next.items[index] = { ...next.items[index], stone: Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0 };
    return next;
  });

  const resetToDefault = () => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneState(current);
      next.items = next.items.map((item) => ({ ...item, stone: item.defaultStone }));
      return next;
    });
    if (ratioOriginal) setRatioDraft(String(ratioOriginal.defaultRatio));
    setConfirmed(false);
  };

  const save = async () => {
    if (!draft || !original || !anyDirty) return;
    if (ratioOriginal && !ratioValid) {
      notify("兑换比例必须是 0~1000 之间的数字", "error");
      return;
    }
    setBusy(true);
    try {
      if (dirty) {
        const result = await api<StoneConsumePriceState>("/api/configuration/stone-consume", {
          method: "PUT",
          ...jsonBody({ items: draft.items.map((item) => ({ code: item.code, stone: item.stone })), confirm: confirmed }),
        });
        setOriginal(result);
        setDraft(cloneState(result));
      }
      if (ratioDirty && ratioOriginal) {
        const result = await api<ClubSeatStoneRatioState>("/api/configuration/club-seat-stone-ratio", {
          method: "PUT",
          ...jsonBody({ ratio: ratioValue, confirm: confirmed }),
        });
        setRatioOriginal(result);
        setRatioDraft(String(result.ratio));
      }
      setConfirmed(false);
      notify("配置已保存并回读校验，玩家重新进大厅后生效");
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "配置保存失败", "error");
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
      description="游戏内消费功能与俱乐部带入钻石兑换比例统一在这里配置，保存后写入游戏端哈希配置，玩家重新进大厅生效。"
      actions={<Button variant="secondary" onClick={() => void load()}>重新读取</Button>}
    />
    <section className="configuration-summary-strip">
      <div><span>消费项</span><strong>{draft.items.length}</strong></div>
      <div><span>免费项</span><strong>{freeCount}</strong></div>
      <div><span>配置状态</span><strong>{draft.configured ? "已下发" : "使用默认值"}</strong></div>
      <div><span>待保存变更</span><strong>{changeCount}</strong></div>
    </section>

    {ratioOriginal?.parseError && <div className="form-error"><span>!</span>带入钻石比例无法解析（{ratioOriginal.parseError}），保存会整体覆盖。</div>}
    {ratioOriginal && ratioOriginal.duplicateRows > 0 && (
      <div className="form-error"><span>!</span>带入钻石比例有 {ratioOriginal.rowCount} 条同名哈希记录，保存会把它们统一成同一个值。</div>
    )}

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
              <th>配置值</th>
              <th>内置默认</th>
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item) => (
              <tr key={item.code}>
                <td><strong>{item.name}</strong><br /><small style={{ color: "#78909c" }}>{item.code}</small></td>
                <td>{item.scene}</td>
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
            <tr>
              <td><strong>房间带入钻石兑换比例</strong><br /><small style={{ color: "#78909c" }}>俱乐部积分对应钻石输赢比</small></td>
              <td>俱乐部 · 游戏规则 · 开启「入座扣钻」</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={0.0001}
                  value={ratioDraft}
                  disabled={!canUpdate || busy || !ratioOriginal}
                  onChange={(event) => { setRatioDraft(event.target.value); setConfirmed(false); }}
                  style={{ width: 120 }}
                />
              </td>
              <td>{ratioOriginal ? ratioOriginal.defaultRatio : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ color: "#71878c", fontSize: 13, padding: "10px 18px 16px" }}>
        钻石消费项 0 表示免费（不扣钻石、不写流水）；兑换比例 0 表示不扣钻石，默认 1:1。玩家钻石不足时服务端会扣到 0 为止并仍返回成功。
      </p>
    </section>

    <section className={`configuration-savebar ${anyDirty ? "is-dirty" : ""}`}>
      <div>
        <strong>{anyDirty ? `共有 ${changeCount} 项配置发生变化` : "当前内容与游戏配置一致"}</strong>
        <p>保存后写入 usr_hash_info 并回读校验。{draft.updatedBy ? `消费价上次修改：${draft.updatedBy}` : ""}{ratioOriginal?.updatedBy ? ` 比例上次修改：${ratioOriginal.updatedBy}` : ""}</p>
      </div>
      <label className="confirm-check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!anyDirty} />
        <span>我已核对这些配置</span>
      </label>
      <Button variant="secondary" disabled={!anyDirty || busy || !canUpdate} onClick={resetToDefault}>全部恢复默认</Button>
      <Button variant="secondary" disabled={!anyDirty || busy} onClick={() => {
        setDraft(cloneState(original));
        if (ratioOriginal) setRatioDraft(String(ratioOriginal.ratio));
        setConfirmed(false);
      }}>放弃修改</Button>
      <Button disabled={!anyDirty || !confirmed || busy || !canUpdate || (!!ratioOriginal && !ratioValid)} onClick={() => void save()}>
        {busy ? "正在保存并回读…" : "保存配置"}
      </Button>
    </section>
  </div>;
}


function countChanges(before: StoneConsumePriceState | null, after: StoneConsumePriceState | null) {
  if (!before || !after) return 0;
  let count = 0;
  after.items.forEach((item, index) => {
    if (JSON.stringify(item) !== JSON.stringify(before.items[index])) count++;
  });
  return count;
}
