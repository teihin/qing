# qing 当前状态 · 2026-11-17 批次（归档）

## 2026-11-17 搓牌开关：标价 `20 钻/次` + 每次搓牌扣钻（后台已部署，客户端未构建/热更）

- 「记录」抽屉的搓牌开关右侧加价签 `20 钻/次`（金色小字，状态行上移 `y=9` 与其成两行；开关下方只有 15px，放不下第三行）。金额实时取后台「钻石消费价格」的 `搓牌` 项，配 0 显示「免费」。
- 扣费点＝搓牌窗口**松手揭开**那一刻（`DelayShowCuoInfo` 开头）发 `玩家_消费_命令`（`consume_type=搓牌`、`money_type=stone`）；按 `round_count` 去重，同一手牌只扣一次，直接点「看牌」不扣。
- 开关是付费开关：余额 < 单价时提示并复位，不下发 `player_setting=True`。
- 后台 catalog 新增 `搓牌`（默认 20，`stone_consume_price.go`），后台页动态渲染无需改前端。**2026-11-17 22:10 已部署 8891**（二进制 `91c44480…`，备份 `xuanmanager.20261117-2210-rollback`，health 200），后台「钻石消费价格」页需保存一次才写进 `usr_hash_info`。服务端是否对 `consume_type` 有白名单待确认。详见[交接](handoffs/2026-11-17-cuo-squeeze-stone-charge.md)。

## 2026-11-17 牌局优化入口改成「当前俱乐部的管理员」（脚本就绪，未构建/热更）

- 电量连点 3 下开「牌局优化」的门禁由 `IsBossAccount()`（level≥99 / 董事长 / 总裁）换成新增的 `GameDataManager.IsCurrentClubAdmin()`：`club_manage` 或 `union_manage` 任一非空（= 后台「设置管理员」的大小BOSS），再按 `roomSetting.club_id` / `union_id` 尽量比对范围。`panelGameView`（电量兜底 + `RoomFrame/完成` 热区）与 `panelGameOptimize.start()` 三处同步。
- 首版只判 `club_manage`，**联盟小BOSS（写的是 `union_manage`）被挡**——真机日志 `club_manage=` 为空即此因，已修正。
- **服务端仍是阻塞**：4 条胜率目标命令只认 `boss` 名单（`opt_target_ctrl.IsBossOnly`），管理员能开面板但设置/停止会回「无权限」，需服务端放行 `club_manage` 并按 `club_id` 限定。详见[交接](handoffs/2026-11-17-game-optimize-club-admin-entry.md)。

## 2026-11-17 后台排行榜名次奖励改成「名次区间 + 奖励」列表（已部署，仅前端）

- 名次奖励从「逗号分隔一整串」改成行列表（最高名次/最低名次/奖励/删除，可新增区间），相邻同额自动合并、改最低名次时下一行顺延。**协议不变**：提交前展开回「第 1 名起、逗号分隔」原串，后端零改动；空洞/重叠/超限红字拦住。
- 活动弹窗与行内配置两处共用 `RankRewardTiers.tsx`；前端 `index-BMTdl6pi.js`（备份 `web.previous-honorrank-tiers-20261117-1320`）。详见[交接](handoffs/2026-11-17-honor-rank-reward-tiers.md)。

## 2026-11-17 带入弹窗：在座补分积分不足也要弹提示（脚本就绪，未构建/热更）

- 根因两条：`BuyinDisplay` 在余额不够最低带入时把「确认带入」置灰（点击无事件）；`坐下_事件1` 在座补分被拒时只刷新弹窗、不弹任何提示。
- 现在「确定」恒可点，余额不足/金额非法/区间不符统一走模态提示（俱乐部房弹「俱乐部金币不足，请联系合伙人上分！」），余额不足不再发无效请求；在座补分被服务端拒绝时刷新金额 + 0.6s 中性兜底提示（服务端 PromptInfo 先到则让位），兜底弹出时**同步关掉带入窗口**。面板内红字与弹窗共用 `GetBuyinShortageText` 一套文案。
- `node tools/tests/buyin_v8_regression.js` 14 条功能用例 PASS（新增 2 条）；prefab 基线对比为既有漂移。未启动 Creator 构建，热更 manifest 仍 6.0.13。详见[交接](handoffs/2026-11-17-buyin-insufficient-prompt.md)。

## 2026-11-17 直聊：隐藏普通成员的历史大盟主会话（服务端已部署）

- 根因：旧实现只隐藏 BF 关闭后的大盟主默认入口，已有真实会话仍返回；生产只读统计有 24 条活跃大盟主会话，分布在 11 个俱乐部。
- 服务端已按 BF 关闭规则过滤会话列表、创建/恢复和消息详情，部署二进制 `a6ecd8b2…`，health 200。客户端缓存版本 `4→5`，首屏等待服务端结果，源码未构建热更；真实账号/真机待验收。详见[交接](handoffs/2026-11-17-direct-chat-union-owner-history-filter.md)。

## 2026-11-17 后台「玩家优化」更名「玩家控制」（已部署 8891）

- 只改显示文案：页面 30 处中文（标题/按钮/空态/校验/消息）、菜单图标字 `优`→`控`、服务端返回消息与游戏服操作备注 31 处、迁移 `071_player_control_rename.sql` 改菜单名与 4 条权限名/描述。模块 code、路由、权限 code、接口路径不变，角色授权不受影响。
- 文案里指向牌桌内的「运维优化」改为「牌桌内胜率目标」——客户端那个面板实际叫「牌局优化」，旧文案本就指错。`go vet`/`tsc -b`/`go test` 通过；**2026-11-17 22:10 已随搓牌价目项一起部署 8891**，迁移 071 启动时执行完毕（回读 `mgr_module.name=玩家控制`、4 条权限名已改）。前端线上包 `index-BMTdl6pi.js` 与 HEAD 构建同名同大小，无需重发。详见[交接](handoffs/2026-11-17-player-control-rename.md)。

## 2026-11-17 客户端「我的」10 个操作按钮统一美术（已替换资源，待导入/构建/真机）

- 用户确认新版效果后，将 `assets/V7/` 下 10 张正式按钮 PNG 按确认预览统一替换：上下记录、钻石池消耗、赠送金币、金币流向、兑换钻石、钻石流向、我的战绩、系统设置、额度授权记录、逃跑惩罚统计。
- 新稿统一深蓝玻璃底、金色描边、立体金色图标、字体和文字阴影；保留原 `.meta`、UUID、Prefab 节点、Button 事件和动态权限显隐，因此未改 `panelMain.prefab` 或业务脚本。
- 静态核对通过：10 个 Prefab SpriteFrame 仍指向对应正式资源 UUID，PNG 尺寸与原 `.meta` 一致，四角透明；全量 `validate_v7_responsive_layout.py` 在既有 `panelLogin.prefab/登录LOGO` alignFlags=18 与预期17处失败，未归因于本轮按钮资源。Creator 导入、网页实际预览、构建、真机和真实账号交互仍待验证。详见[交接](handoffs/2026-11-17-my-buttons-v9.md)。

