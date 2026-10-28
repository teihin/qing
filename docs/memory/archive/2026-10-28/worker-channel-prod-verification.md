# Worker 通道上线验证记录（2026-10-28 00:30～00:52）

从[Worker 通道专题](../../topics/automation-worker-channel.md) §9 移出的线上实测证据，只在当时那一版后端/前端上成立；
换版本后不代表仍然有效。当前未发布的改动见[在线状态实时化交接](../../handoffs/2026-10-28-worker-realtime-online.md)。

- 后端 00:30 版运行中（`readlink /proc/<pid>/exe` 的 sha = `a2dd7c00…`），health 200；`DELETE /api/automation/agent-token` 回 401 而非 404（新路由已注册）。
- 生产令牌已清空（开放模式）；mac agent 在空目录里**不带令牌、不改配置**直接跑通：自动生成 `xuanagent.json` → 注册成功 `workerId=1 status=online` → `mgr_automation_worker` 落一行 `mac-mini-2-local / darwin / arm64`。`-server`/`-code`/`-capacity` 覆盖已实测生效。
- 前端 00:31 发布到 `/www/html/.xuanmanager/web`，外网 `index.html` 已引用新 `index-C12AUAlM.js`。
- janitor 实测（旧 90 秒租约/30 秒巡检口径）：agent `-once` 退出后不到 2 分钟，该节点由 `online` 变 `offline` 且 `lease_expires_at` 清成 NULL。
- **00:52 自动分配 + 全量日志实测**（后端 `24b08e87…`，回滚 `backups/xuanmanager.20261028-0045-rollback`；
  前端 `index-C9680II9.js`）：插入一台 `join_status='joined' / worker_id=NULL` 的测试机器人 → 起一个临时节点
  `zz-verify-node` → **注册后 0.4 秒就写出 `RobotAssigned`**，1.2 秒后终端拉起并依次回
  `TerminalStarted`/`LoginStarted`/`LoginSucceeded`/`Waiting`/`RoomJoined`…；SIGTERM 后补
  `LogoutSucceeded`/`TerminalStopped`；`上报事件失败` 计数 0。同节点连跑两次，`TerminalStarted` 落 2 条
  （runID 前缀生效，重启不再被去重）。验证数据（机器人/临时节点/事件）已全清，worker 1 恢复 `online`。
- 前端渲染用 mock 截图确认：系统事件灰底标「系统」、登录失败红、登录成功绿、等待黄、分配账号蓝。
