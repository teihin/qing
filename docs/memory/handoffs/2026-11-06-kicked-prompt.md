# 踢线提示区分顶号与服务器重启（2026-11-06）

## 目标

账号被其他设备登录时明确提示「该账号已被其他设备登录」；服务器重启/停机导致的 kick 保持原有中性提示「当前登录连接已失效，请重新登录」。

## 目录 / 分支

- `/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 本次只改客户端脚本，未动 Prefab/场景，未改服务端（服务器上游戏服属 root，`client_update` 读不到）。

## 改动文件

- `assets/scripts/GameDataManager.ts`
  - `onKicked(failedcode)`：先停心跳/自动重连并把玩家送回 login，再判定原因；`finishKick` 统一推送文案，带 `failedcode` 日志。
  - `IsAnotherDeviceKick`：服务端若为顶号定义了错误码（错误名含 `ANOTHER_PLACE`/`OTHER_DEVICE`/`LOGIN_ANOTHER` 等，或描述含「其他设备/异地登录」），直接判顶号，不探测。
  - `IsAdministrativeKick`：错误名含 `BAN`/`FORBID`/`FREEZE`/`BLOCK`/`ADMIN`/`GM_` 判为封禁/后台踢人，仍用中性文案。
  - `ProbeKickReason` + `GetKickProbeProxyAddr`：服务端没给专属错误码时，用「登录服是否还能握手」区分——服务器整体停/重启时两个入口都失败（中性文案）；能握手说明服务端在跑，是业务层顶号。探测只做 WebSocket 握手即关闭，不发登录包，不产生在线会话；超时 1500ms。
  - 新增 `_forcedLogoutReasonPending` / `_forcedLogoutListeners` 与 `IsForcedLogoutReasonPending`、`AddForcedLogoutListener`、`RemoveForcedLogoutListener`；`onLoginSuccessfully` 清残留。
- `assets/scripts/UI/panelLogin.ts`
  - onLoad 取提示：有消息直接弹；判定中则注册回调，结果到达再弹，避免先弹中性文案再改口。
  - 新增 `onDestroy`（摘监听 + `super.onDestroy()`，基类负责注销 KBEngine 事件与定时器）。

## 判据与已实测

- 直连 `ws://154.37.155.17:20013` 握手响应带 `WebSocket-Protocol: WebManagerSocket`（node 客户端会拒），公网反代 `wss://154-37-155-17.nip.io/ws/20013/` 握手成功（node 实测 OPEN）。
  → 因此原生端同时尝试「直连 + 公网 WSS 反代」两个入口，任一成功即判服务端在线。
- 探测成败与 socket 清理逻辑用 6 个模拟用例验证（全部失败 / 单个成功 / 超时挂起 / 同步抛错 / open 后紧跟 close），结果符合预期。
- 两个脚本 `ts.transpileModule` 0 诊断。

## 未完成 / 风险

- 未做真机与双设备实测：顶号、服务端重启、弱网、原生端 WSS 兜底四项仍需联调。
- 若运维只重启 baseapp 而 loginapp 仍在线，kick 可能被误判为顶号（只重启 baseapp 时客户端多为 onDisconnected，概率低）。
- 若调用方在踢线判定期间手动登录成功，迟到结果已用 `_automaticReconnectStoppedByKick` 拦掉。
- 更准确的做法是服务端在顶号 kick 时带专属错误码（客户端已按错误名兼容），需要能改服务端时再补。
