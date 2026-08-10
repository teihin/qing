import { useCallback, useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "../api";
import { Button, Field, LoadingBlock, Modal, PageHeader } from "../components/ui";
import type { CurrentRoomsResponse } from "../types";

type DissolveTarget = { roomId: number | null; all: boolean; mode: "force" | "friendly" };

export default function RoomMaintenancePage({ can, notify }: { can: (permission: string) => boolean; notify: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<CurrentRoomsResponse | null>(null);
  const [roomId, setRoomId] = useState("");
  const [roomIdError, setRoomIdError] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<DissolveTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<CurrentRoomsResponse>("/api/game/room-maintenance"));
    } catch (reason) {
      notify(reason instanceof ApiError ? reason.message : "房间维护状态加载失败", "error");
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const openSingleDissolve = (mode: "force" | "friendly") => {
    const normalized = roomId.trim();
    if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
      setRoomIdError("请输入客户端当前显示的有效房间号");
      return;
    }
    setRoomIdError("");
    setTarget({ roomId: Number(normalized), all: false, mode });
  };

  const canDissolve = can("game.room_maintenance.dissolve");
  const canDissolveAll = can("game.room_maintenance.dissolve_all");
  return <div className="page-stack">
    <PageHeader eyebrow="LIVE ROOM CONTROL" title="房间维护" description="按客户端当前房间号提交友好或强制解散；后台不再把玩家历史房间记录冒充实时房间。" actions={<Button variant="secondary" onClick={() => void load()} disabled={loading}>{loading ? "检查中…" : "检查数据源"}</Button>} />
    <section className="room-maintenance-metrics">
      <article><span>实时房间列表</span><strong>{data?.available ? data.total : "—"}</strong><p>{data?.available ? "来自游戏服务实时接口" : "游戏服务暂未提供列表接口"}</p></article>
      <article><span>错误历史数据</span><strong>已停用</strong><p>不再读取 tbl_Account.sm_roomID</p></article>
      <article className="room-maintenance-safety"><span>操作保护</span><strong>二次确认</strong><p>全部房间仅超级管理员可执行</p></article>
    </section>
    <section className="panel">
      {loading && !data ? <LoadingBlock label="正在检查实时房间数据源" /> : <div className="room-maintenance-unavailable">
        <div className="operation-warning operation-warning--danger">
          <strong>实时房间列表暂不可用，已停止显示错误房间</strong>
          <p>{data?.message || "游戏服务没有可供后台读取的实时房间列表接口。玩家账号里的房间号可能在房间解散后继续残留，不能作为当前房间依据。"}</p>
        </div>
        <div className="room-maintenance-manual">
          <div>
            <h3>按房间号维护</h3>
            <p>请从游戏客户端当前大厅复制房间号。命令提交成功仅表示游戏服务已接收，请回客户端确认房间已消失。</p>
          </div>
          <Field label="当前房间号" hint="输入客户端当前能看到的房间号；不要使用本页之前显示的旧房间号">
            <input inputMode="numeric" value={roomId} onChange={(event) => { setRoomId(event.target.value.replace(/\D/g, "")); setRoomIdError(""); }} placeholder="例如：642550" />
          </Field>
          {roomIdError && <div className="form-error"><span>!</span>{roomIdError}</div>}
          {canDissolve ? <div className="room-bulk-actions">
            <Button variant="secondary" onClick={() => openSingleDissolve("friendly")}>友好解散指定房间</Button>
            <Button variant="danger" onClick={() => openSingleDissolve("force")}>强制解散指定房间</Button>
          </div> : <p className="muted">当前后台角色没有房间解散权限。</p>}
        </div>
        {canDissolveAll && <div className="room-maintenance-all">
          <div><strong>全部房间操作</strong><p>无需依赖房间列表，由游戏服务直接处理全部当前房间。此操作仅限超级管理员。</p></div>
          <div className="room-bulk-actions">
            <Button variant="secondary" onClick={() => setTarget({ roomId: null, all: true, mode: "friendly" })}>友好解散全部</Button>
            <Button variant="danger" onClick={() => setTarget({ roomId: null, all: true, mode: "force" })}>强制解散全部</Button>
          </div>
        </div>}
      </div>}
    </section>
    {target && <DissolveModal target={target} onClose={() => setTarget(null)} onDone={(message) => { setTarget(null); notify(message); }} />}
  </div>;
}

function DissolveModal({ target, onClose, onDone }: { target: DissolveTarget; onClose: () => void; onDone: (message: string) => void }) {
  const [checked, setChecked] = useState(false);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const friendly = target.mode === "friendly";
  const title = `${friendly ? "友好" : "强制"}解散${target.all ? "全部房间" : `房间 ${target.roomId}`}`;
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const endpoint = target.all ? "/api/game/room-maintenance/dissolve-all" : `/api/game/room-maintenance/${target.roomId}/dissolve`;
      const result = await api<{ message: string }>(endpoint, { method: "POST", ...jsonBody({ mode: target.mode, confirm: checked, confirmScope: target.all ? scope : "" }) });
      onDone(result.message);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "房间解散命令提交失败"); } finally { setBusy(false); }
  };
  const disabled = !checked || (target.all && scope !== "ALL_ROOMS");
  return <Modal title={title} eyebrow="HIGH RISK OPERATION" onClose={onClose}><div className={`operation-warning ${friendly ? "" : "operation-warning--danger"}`}><strong>{friendly ? "给牌局正常收尾机会" : "立即中断房间牌局"}</strong><p>{friendly ? "友好解散由游戏服务按非强制模式处理。后台无法回读实时房间状态，提交后请回客户端确认。" : "强制解散可能打断正在进行的牌局。后台无法回读实时房间状态，请先核对客户端房间号与影响范围。"}</p></div>{error && <div className="form-error"><span>!</span>{error}</div>}{target.all && <Field label="范围确认" hint="请输入 ALL_ROOMS，防止误操作全部在线房间"><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="ALL_ROOMS" /></Field>}<label className="confirm-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>我已从客户端核对房间范围，并确认执行{friendly ? "友好" : "强制"}解散</span></label><div className="form-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button variant={friendly ? "primary" : "danger"} disabled={disabled || busy} onClick={() => void submit()}>{busy ? "正在提交…" : "确认解散"}</Button></div></Modal>;
}
