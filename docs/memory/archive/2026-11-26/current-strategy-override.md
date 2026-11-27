# CURRENT 归档：投放配置支持换策略 + 单机自定义（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 投放配置弹窗支持换策略 + 单机自定义参数

- 弹窗（点机器人名字 → 投放配置）新增两块：
  1. **绑定策略**下拉（`strategy_id`）：换策略下一次心跳生效，留空=跟随分组；
  2. **自定义参数**（勾选后生效）：**策略里的全部参数都能改**——跑法 7 项、出牌节奏 3 项、
     三档安全线 9 个数值、牌力 4 项、输赢控制 3 项；与策略编辑页共用同一个表单组件 `StrategyConfigForm`，
     以后策略加字段这里自动跟着有。
- 存储：迁移 `077_robot_strategy_override.sql` 给 `mgr_automation_robot` 加 `strategy_override_json`，
  勾自定义时存**整份参数**（等于这台机器人自己的策略副本）；后端 `mergeRobotStrategyOverride` 在下发时把它
  合并进 `strategyConfig`（覆盖优先），客户端无感。PUT 接口 `normalizeRobotStrategyOverride` 做键白名单 +
  `tiers` 结构校验，并保留 0–1 的比例小数（死区/加注概率）。
- 注意：策略必须**发布**（gray/enabled）才会下发给节点，草稿状态在下拉里标「（草稿）」但不生效。
  当前测试服只有一条 `正常策略` 且是 draft。
- 部署：后端已迁移（列已存在）、前端 `index-5NFzRm9z.js`（回滚 `web.previous-strategy-20261126`）。正式服未动。
- 未验证：登录态下点保存 + 心跳下发的实际效果。


