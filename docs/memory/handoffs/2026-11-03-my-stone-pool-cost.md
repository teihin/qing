# 2026-11-03 我的页新增「钻石池消耗」

- 分支：`codex/club-ui`
- 状态：代码、Prefab、美术已落盘；**未构建、未 Creator 导入、未连真实服务器验证**。
- 目标：在「我的」按钮区增加「钻石池消耗」入口，弹窗沿用金币流向下半部分结构，标题/表头文字改为钻石池兑换记录，列表返回俱乐部钻石池的兑换明细。

## 接口

- `查询_俱乐部_钻石兑换_记录`，参数 `club_id`、`user_id:""`、`count:10`、`page`、`context`。
- 同步回包只有空壳，列表由 **`ClubStoneExchangeList`** 异步推送。
- 行字段：`guuid` / `name`（兑换玩家）、`cost_gold`（消耗俱乐部积分，元）、`stone`（得到钻石，个）、`date`。
- 权限：群主/boss 留空可查全俱乐部；代理和普通玩家由服务端强制只看自己。

## 改动

### 新增

- `assets/scripts/UI/panelStonePoolCost.ts` + `.meta`
  - 解析当前俱乐部 `resolveRoomClubId`；无俱乐部提示「请先选择俱乐部」。
  - 监听 `ClubStoneExchangeList` / `onHallCommand`；按最近一次请求配对，10 秒超时、翻页丢弃旧页回包。
  - 行映射：时间 `date`、玩家 `name`（回退 `guuid`）、消耗积分 `cost_gold`（红色 `-n`）、获得钻石 `stone`（绿色 `+n`），图标固定 `V8类型图标_stone`。
- `assets/resources/UI/panelStonePoolCost.prefab` + `.meta`
  - 从 `panelUpDownRecord.prefab` 克隆；根节点改名、根脚本换成新脚本。
  - 标题栏使用 `money_v8_header_stone_pool.png`；表头使用 `money_v8_table_stone_pool.png`（时间 / 玩家 / 消耗积分 / 获得钻石）。
- `assets/resources/Prefabs/钻石兑换记录对象.prefab` + `.meta`
  - 从 `资金明细对象.prefab` 克隆；`V8类型图标_gift` 改名为 `V8类型图标_stone`，贴图换成透明钻石图标。
- `assets/V7/mine_stone_pool_cost_exact.png` + `.meta`
  - 第二列按钮版式 443×138：图标中心约 x=114/443、y=69/138；文字「钻石池消耗」PingFF 渲染，左缘 x=195，与金币流向/钻石流向/我的战绩一致。
  - 图标为 ImageGen 生成的「钻石 + 向下箭头」3D 淡金图标（Seedream 额度耗尽），与钻石流向的「钻石 + 上箭头」区分；底板由 `mine_money_exact.png` 图标/文字区域用 5 次多项式重建。
- `assets/V7/money_v8_header_stone_pool.png` + `.meta`
  - 941×90，标题「钻石池消耗」，保留返回箭头与右侧斜切装饰。
- `assets/V7/money_v8_table_stone_pool.png` + `.meta`
  - 892×111，表头文字：时间 / 玩家 / 消耗积分 / 获得钻石；旧标签用逐行线性背景重建后重新渲染。
- `assets/V7/row_stone_exchange.png` + `.meta`
  - 118×116 透明钻石行图标，取自 `mine_exchange_exact.png` 的钻石，供行模板 59×58 节点使用。
- 设计预览：`design-previews/待确认/2026-11-03-钻石池消耗/`（按钮第二列对比、第 4 行并排、标题/表头 2x、弹窗 mock）。

### 修改

- `assets/scripts/UI/panelMain.ts`
  - 「钻石池消耗」加入俱乐部专属入口（无俱乐部隐藏）。
  - 点击 → `UIManager.showPanel("panelStonePoolCost", Cover)`。
- `assets/scripts/UI/ClubManagementView.ts`
  - `syncProfileScroll` 注释改为「上下分记录 / 钻石池消耗」两个入口；有俱乐部 4 行高度由 421.23 调到 **421.96**（第 4 行多了 101.17 高的新按钮），无俱乐部仍 314.05。
- `assets/resources/UI/panelMain.prefab`
  - 在「系统设置」后插入「钻石池消耗」按钮（第 4 行右列，填补原来空位；第二列版式，复用资金明细按钮结构，换新按钮图）；原有按钮位置不变，8 个俱乐部入口正好 4 行 × 2 列。
  - 新节点的 `PrefabInfo.fileId` 已重新生成；按钮区设计高度 421.96、卡片 widget top 433.96。

## 验证

- `node --experimental-strip-types --check`：`panelStonePoolCost.ts`、`panelMain.ts`、`ClubManagementView.ts` 通过。
- Prefab JSON：`panelMain.prefab` 4042 个对象、`panelStonePoolCost.prefab` 105 个对象、`钻石兑换记录对象.prefab` 43 个对象；所有 `__id__` 与节点/组件反向引用可解析；新子树 fileId 唯一。
- 新贴图 `.meta` 尺寸与 PNG 一致（443×138、941×90、892×111、118×116），UUID 全仓无重复；按钮/标题/表头/行图标 SpriteFrame 引用均已解析。
- 未验证：Creator 2.4.13 导入/重编译、网页构建、真机、真实 `ClubStoneExchangeList` 推送、分页翻页、群主/普通玩家的数据范围、错误回包。

## 下一步

1. Creator 打开项目确认新按钮、弹窗脚本、标题/表头/行图标显示正常。
2. 用俱乐部群主和普通玩家分别打开「我的 → 钻石池消耗」，核对推送行字段与权限范围。
3. 构建/真机验收后再考虑提交。
