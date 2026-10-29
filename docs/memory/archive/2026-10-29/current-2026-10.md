# 2026-10-26 俱乐部与钻石消费（当前状态归档）

2026-10-29 从 [当前状态](../../CURRENT.md) 移出的前一批条目，原文保留；CURRENT 只留状态摘要。链接相对本文件改写。

## 2026-10-26 消费全切钻石 + 价格后台可配（后台已上线，VIP 已下线）

- 客户端 6 处 `玩家_消费_命令` 改 `money_type=stone`，价格由后台「钻石消费价格」下发；**配置尚未落库、客户端未发版**；VIP 三档停用，延时档位定死。
- 待服务端重启：牌桌通道与 `延长时间_命令` 钻石档位；服务端仍不按配置校验价格。见[交接](../../handoffs/2026-10-26-stone-consume-price.md)。

## 2026-10-26 俱乐部：跨级只读、弹窗重设计、直属口径、分页

- 成员列表只返回直属下级，更深一层起只读；踢人已重编译，服务端未放开权限。见[只读](../../handoffs/2026-10-26-club-downline-readonly.md)、[踢人](../../handoffs/2026-10-26-club-agent-kick.md)、[代理](../../handoffs/2026-10-26-club-agent-direct-manage.md)。
- `panelMain.prefab` 按深蓝金稿换肤（节点/事件/`.meta` 保留）；弹窗 710×1240；构建/真机/回包未验。见[换肤](../../handoffs/2026-10-26-club-player-settings-reskin.md)、[按钮](../../handoffs/2026-10-26-club-input-dialog-buttons.md)、[分页](../../handoffs/2026-10-26-club-downline-paging.md)、[直属](../../handoffs/2026-10-26-club-member-direct-scope.md)。

## 2026-10-27～28 自动化（2026-10-29 从 CURRENT 移出，原文保留）

### 机器人即账号（后端已发布，前端未发）

- 机器人=游戏账号，在「机器人管理」真实建号（随机昵称/头像），默认带入=最低带入×`buyin_multiple`；投放按俱乐部调 `添加_俱乐部_玩家`，`release` 回池；投放后须挂 Worker，分不到显示「等待分配 Worker」。
- 030/031/032 已执行；批量 >10 台转审批，未真实登录冒烟。详见[专题](../../topics/automation-console.md)、[交接](../../handoffs/2026-10-27-automation-console.md)。

### Worker 通道（已上线，令牌可选）

- `/agent/v1/*`：注册（可选令牌→租约）、心跳回权威指派、拉命令、回执、事件批量（幂等）；命令 9 种带幂等键/过期/状态机，自动分配在三处完成。
- 033 已执行；后端三次发布（最新 `24b08e87`，回滚 `backups/xuanmanager.20261028-0045-rollback`），生产已关令牌校验。参考 agent `server/cmd/xuanagent`。见[专题](../../topics/automation-worker-channel.md)。

### Worker 在线状态实时化（未提交，后端已发、前端未发）

- 节点退出即离线：agent 停止前调 `POST /agent/v1/offline`，强杀靠**租约 20 秒 + 巡检 5 秒**兜底；心跳 5 秒，重新注册把 `offline` 终端放回 `idle`。后端已发，本机 `bin/xuanagent` 已重编。见[交接](../../handoffs/2026-10-28-worker-realtime-online.md)。

### 真实客户端已接入（后端已发布，前端未发）

- 密码落库：034 加 `login_password`（AES-256-GCM），明文只在带租约心跳指派里下发；密钥未配走 DB 密码派生，**轮换 DB 密码会让密文失效**（2026-10-29 起新数据改存明文）。
- `agent-client/` 一进程一账号，登录/重连/查房/进房/预坐/坐下/离房/心跳/事件/按策略出牌齐备；Go 终端默认 `client:"real"`，本机 worker 在 `server/bin/`（gitignore），入会走 `直接_加入_俱乐部` 免审批，**真实进房/开局未验**。见[交接](../../handoffs/2026-10-28-automation-real-client.md)。

### 投放限底皮 + 机器人日志（未提交，后端已发、前端未发）

- 035 加 `room_pi`（逗号分隔 `底皮X/Y`，空=不限），投放/配置/编辑三处可改，`PUT` 全量覆盖须回传；心跳下发 `XUAN_ROOM_PI`，**改底皮要重新拉起终端**。日志 `GET /robots/{id}/events` 5 秒轮询，三处共用。035 已执行、后端已发；前端未发；底皮过滤仅 mock 验证。见[交接](../../handoffs/2026-10-28-automation-room-pi.md)。

### 净分区间控制 + GPS/IP + 策略移植（未提交，035–037 已执行、后端已发）

- 输赢按**时间范围累计净分**控制：目标来自投放（每日/周期/不控制，组配置兜底）；心跳净分是权威基线，`netPending` 只累计未入账差值；`|目标-净分| ≤ max(20%, 最低带入)` 常规打，超出才争赢/争输。跨天/新周期由心跳懒重置（037）；出牌按老客户端移植。
- **GPS/IP**：036 加 `gps/public_ip/ip_seen_at`；GPS 建号时按老客户端经纬度范围生成，每 60 秒 `reqSetProperty`；IP 由心跳连接地址写入。
- 验证：构建与 lint 全过；**未真机开局**。见[专题](../../topics/automation-strategy.md)、[交接](../../handoffs/2026-10-28-automation-strategy-gps.md)。

### 机器人当前牌局（未提交，后端已发、前端未发）

- 机器人「牌局」页签 5 秒轮询 `GET /robots/{id}/table`（在座/观战/四座手牌，无事件 20 秒补发、内容不变不落库）；**未真实开局、观战未验**。见[专题](../../topics/automation-strategy.md)、[交接](../../handoffs/2026-10-28-automation-table-snapshot.md)。
