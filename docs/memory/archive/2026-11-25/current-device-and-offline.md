# CURRENT 归档：机器人设备绑定 + Worker 离线转移（2026-11-25）

> 按文档预算归档，原文保留。

## 2026-11-25 机器人账号绑定设备：只能由 Worker 登录（测试服已部署并验证）

- 规则：机器人账号 `anti_theft_on=1` + 预绑 **worker 集群统一设备码** `xuanagent-worker-fleet-v1`
  （原先按账号 sha1，改成统一值：任何 worker 在任何机器上都能登录任何机器人），platform `web`、version `1`。
  Worker 侧 `client.js` 提交同一套算法算出的设备码 → 任何节点/任何机器登录都匹配；
  手机/PC 客户端是随机设备码 → 游戏服防盗号直接拒。
- 实现：`api/automation_robot_device.go`（`robotDeviceFleetID` 常量 + `syncRobotDeviceBindings`，5 分钟节流，
  只补「没开防盗号/没绑/绑错」的行，挂进 janitor）；建号 INSERT 直接写绑定值。
  `client.js` 设备码本就按账号生成，另补 2563 → 「设备校验未通过，只能由 Worker 登录」的中文提示。
- 验证（测试服 robot worker002）：默认（集群设备码）登录 **LoginSucceeded**；
  换 `XUAN_DEVICE_ID=someone-else-device-1234` 再登 → **LoginFailed code=2563**。
  库里 `device_id=xuanagent-worker-fleet-v1`、`binding_revision=2`。
- 顺手修 `stop.sh`（只杀 pid 文件那只 supervisor → 留孤儿抢 8891）：现在按部署目录杀所有 `supervise.sh`，
  再启动就只有一个实例。后端 `0f5c72c8…`。
- 未验证：游戏服对「换设备登录」的提示文案（2563 是引擎码，具体提示由服务端下发）。

## 2026-11-25 Worker 离线即时下线/转移 + 列表只显示在线（测试服已部署）

- 节点侧：接 `SIGHUP`（关终端窗口）→ 先调 `/agent/v1/offline` 再退出；`signal.Ignore(SIGPIPE)` 防止窗口没了写日志被杀。
- 后台：长连接断开后 6 秒宽限（期间无重连且 8 秒内无心跳）即判离线，不再等 20 秒租约；
  判离线（含巡检、正常退出）时**立刻把该节点名下的机器人收回等待池并重新分配**，机器人 10 秒级转到其他在线节点。
- Worker 列表默认只返回在线节点（排空中也算在线），离线行不再堆在列表里；状态筛"离线"仍可查历史。
- 顺手修掉测试服后台**两个 supervisor 抢 8891**（`stop.sh` 只杀 pid 文件里那个），详见 `SERVER-NOTES.md`，
  这是 Worker 侧那串 `心跳/拉命令 502` 的来源。
- 验证：手动释放 robot3 后 12 秒内被在线节点 `mac-mini-763` 接走；后端 `068f9b4e…`、前端 `index-CAS_2F_T.js`。
  未实测：真关窗口（SIGHUP）到别的节点接手的全链路；断链 6 秒补判。

- 2026-11-25 机器人管理三项小改（用户ID/俱乐部金币、设备码按账号固定、余额不足报警等待、投放俱乐部可选可输）原文见 [`archive/2026-11-26/current-2026-11-25-robot-batches.md`](archive/2026-11-26/current-2026-11-25-robot-batches.md)。
