# CURRENT 归档：批量建号自动编号 + 策略进等待房开关（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 批量创建机器人：账号自动编号（worker 开头）

- 弹窗只填「创建数量 + 密码（含确认）+ 分组」，账号由后台自动分配：前缀固定 `worker`，
  序号取现有最大编号 +1（`mgr_automation_robot.account` 与 `kbedm.third_marketing_info.player_wxid`
  两边都查，避免历史账号冲突）。当前库内最大是 worker002，下一次从 **worker003** 开始。
- 接口 `POST /api/automation/robots/bulk` 的 `prefix/startNo` 变成可选：不传即自动；
  响应新增 `accounts` 数组，前端创建成功的提示里带上首尾账号。
- 部署：后端 `f05559c7…`、前端 `index-DaCsJcKF.js`；回滚 `web.previous-autoname-20261126`。**正式服未动**。
- 未验证：登录态下点「创建」的真实开户（会写游戏库，没敢用无授权的方式造号）。


