# 我的页「创建联盟 / 加入联盟」入口（未构建、未真机）

- 日期：2026-11-03
- 分支：`codex/club-ui`
- 目标：当前俱乐部尚未加入/创建联盟时，在「我的 → 当前俱乐部」卡片显示「创建联盟」「加入联盟」；已入盟或非创建者不显示。
- 性质：接续上一模型已写好的部分联盟代码，补齐 Prefab 节点、美术、状态收起与少量联动；已随 `c77b7e5` 提交并推送到 `origin/codex/club-ui`。

## 已完成

- 「我的 → 当前俱乐部」卡片底部新增金色分割线与 `联盟操作` 行，两个 292×48 按钮：`创建联盟`、`加入联盟`。
- 新美术（ImageGen 生成，参考 `mine_gift_exact.png` 的金色材质）：
  - `assets/ImagesLuck/联盟/icon_create.png`：盾牌 + 王冠 + 加号。
  - `assets/ImagesLuck/联盟/icon_join.png`：两枚扣合圆环。
  - `assets/ImagesLuck/联盟/divider.png`：金色细线 + 中心菱形。
  - 三张均手写 `.meta`，`trimType=none`，UUID 已写入 Prefab。
- 按钮底板复用当前卡片同款 `agent_v8_button_base.png` 九宫格，文字为运行时 `cc.Label`（金色 255,238,197），与卡片内「俱乐部成员 / 我的收益 / 解散俱乐部」一致。
- `ClubManagementView`：
  - 仅 `role=owner && unionKnown && !hasUnion` 时显示分割线和整行按钮；`unionKnown` 未知时保持收起。
  - 无联盟入口时卡片回到 200 高、内容区 550；显示入口时卡片 320、内容区 660，避免空白和滚动区高度错误。
- `panelMain`（上一模型主体，本次补充）：
  - 复用「加入俱乐部」弹窗输入 6 位联盟号，标题/占位/确认文案按 `clubJoinDialogMode` 切换。
  - 复用「创建俱乐部」弹窗输入联盟名称，显示「创建联盟需消耗 10000 钻石（当前余额）」；成功后关闭弹窗并发送 `玩家_消费_命令_创建联盟`。
  - `查询_联盟_额度` 结果绑定最近一次查询的俱乐部，`ClubUnionQuota` / `ClubUnionCreate` 推送更新按钮状态。
  - 切到「我的」页和俱乐部关系变化时补查联盟状态；入盟审批没有推送，靠这次补查把入口收起。
- `ConfigManager` 新增 `CONSUME_CREATE_UNION = "创建联盟"`，默认 10000 钻。
- XuanManager 钻石消费价格目录新增「创建联盟」（默认 10000，无历史金币价），后台可配置。
- 2026-11-03 11:03 后台目录已部署（后端 `7289909…`）：线上「钻石消费价格」页会出现「创建联盟」，默认 10000，需管理员保存一次才会写入 `消费钻石价格` 哈希；客户端代码已随 `c77b7e5` 提交推送，仍未构建。

## 验证

- `node --experimental-strip-types --check` 检查 `panelMain.ts`、`ClubManagementView.ts` 通过。
- Creator 2.4.13 已重新导入：`library/imports/d0/d0921080-...json` 含 `联盟操作`、`创建联盟`、`加入联盟`、`联盟分割线` 及三张新图 UUID；`temp/quick-scripts` 已重新编译。
- Prefab 结构检查：新节点父子关系、组件 `node` 反向引用、`cc.PrefabInfo` 均正常；三张新图 `.meta` 尺寸与 PNG 一致，UUID 全仓唯一，Prefab 引用均可解析。
- 设计预览：`design-previews/待确认/2026-11-03-联盟入口/`（2x 整卡、1x 整卡、按钮放大），显示效果与现有卡片风格一致。

## 未验证

- 真实服务端 `查询_联盟_额度` 对「未入盟创建者」是否稳定返回「你还没有联盟」；若返回其它错误，入口会保持收起。
- 创建联盟后 `ClubUnionCreate` 推送与 `创建_联盟` 同步回包的先后顺序。
- 10000 钻扣费的真实回包、余额不足拦截、超时提示与「钻石流向」记录。
- 入盟申请提交后的按钮状态（目前仍显示，重复点击由服务端「已有申请在审核中」拦截）。
- 构建、真机、双账号建盟/入盟/审批全流程。

## 关键文件

- `assets/scripts/UI/panelMain.ts`
- `assets/scripts/UI/ClubManagementView.ts`
- `assets/scripts/logic/ConfigManager.ts`
- `assets/resources/UI/panelMain.prefab`
- `assets/ImagesLuck/联盟/{icon_create,icon_join,divider}.png` + `.meta`
- `XuanManager/server/internal/api/stone_consume_price.go`
