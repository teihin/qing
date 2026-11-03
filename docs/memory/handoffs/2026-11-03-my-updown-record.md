# 2026-11-03 我的页新增「上下分记录」

- 分支：`codex/club-ui`
- 状态：代码、Prefab、美术已落盘；**未构建、未 Creator 导入、未连真实服务器验证**。
- 目标：在「我的」按钮区增加「上下分记录」入口，弹窗复制金币流向下半部分的美术，标题改为「上下分记录」，调用俱乐部「添加积分」专用记录接口。

## 接口（2026-11-03 修正）

- `查询_俱乐部_成员_积分_添加_记录`，参数 `club_id`、`count:10`、`page`、`context`；**不支持 `user_id`**，查当前俱乐部整本记录。
- 列表由 **`AddMemberGoldList`** 异步推送；行字段 `guuid` / `name`（被加分的玩家）、`opter_name`（操作人）、`gold`（整数元，正数加分/负数减分）、`remark`（变动后余额）、`date`、`type`。
- 接口范围是「添加积分 + 积分受赠」两类；本页按 `type=添加积分` 过滤，只看上下分。分页总数仍由服务端 `count` 决定（封顶 100），过滤后某些页可能不满 10 条。
- 若要按玩家查，仍用 `查询_俱乐部_积分流水` 并传 `user_id`、`only_add=1`；本页按需求使用整本添加记录接口。

## 改动

### 新增

- `assets/scripts/UI/panelUpDownRecord.ts` + `.meta`
  - 解析当前俱乐部 `resolveRoomClubId`；无俱乐部提示「请先选择俱乐部」。
  - 监听 `AddMemberGoldList` / `onHallCommand`；按最近一次请求配对，10 秒超时、翻页丢弃旧页回包。
  - 行显示：玩家（第二行「操作:xxx」）、金额（正绿负红）、余额、时间；正数用 `V8类型图标_in`，负数用 `out`。
  - 分页交给 `ScrollViewEx` + `PageEx`，一页 10 条。
- `assets/resources/UI/panelUpDownRecord.prefab` + `.meta`
  - 从 `panelStoneWater.prefab` 克隆：标题栏 + 表头 + 列表 + 分页。
  - 根节点改名 `panelUpDownRecord`，根脚本 UUID 改为新脚本；标题栏贴图改为新图。
  - 表头改为 `money_v8_table_updown.png`（时间/玩家/金额/余额），行模板改为 `Prefabs/上下分记录对象`。
- `assets/resources/Prefabs/上下分记录对象.prefab` + `.meta`
  - 从 `资金明细对象.prefab` 克隆；`type` 标签改为字号 22、行高 24、允许换行，显示「玩家名 + 操作人」两行。
- `assets/V7/money_v8_table_updown.png` + `.meta`
  - 892×111，表头文字：时间 / 玩家 / 金额 / 余额；旧标签用逐行线性背景重建后重新渲染。
- `assets/V7/mine_updown_exact.png` + `.meta`
  - 2026-11-03 二次返工：原图直接用金币流向的「金币+上箭头」，与金币流向重复且第一列位置偏右；现改为 **ImageGen 生成的「金币 + 上下双箭头」3D 金色图标**（Seedream 额度耗尽不可用），底板由 `mine_gift_exact.png` 图标/文字区域用 5 次多项式重建，保证无残影。
  - 图标中心对齐第一列按钮（约 x=104/454、y=70/138），文字「上下分记录」PingFF 渲染，左缘 x≈184、垂直中心≈69.5，与赠送金币/兑换钻石/系统设置一致；454×138（与节点 332.84×101.17 比例一致），67 KB。
  - 设计预览：`design-previews/待确认/2026-11-03-上下分记录按钮/`。
- `assets/V7/money_v8_header_updown.png` + `.meta`
  - 由 `money_v8_header_exact.png` 重建文字区背景，标题改为「上下分记录」，保留返回箭头与右侧斜切装饰；941×90，77 KB（原图 84 KB）。

### 修改

- `assets/scripts/UI/panelMain.ts`
  - `RefreshClubFinanceMenuVisibility` 把「上下分记录」加入俱乐部专属入口，无俱乐部隐藏；切换后同步滚动区高度。
  - `onButtonClick` 新增「上下分记录」→ `UIManager.showPanel("panelUpDownRecord", Cover)`。
- `assets/scripts/UI/ClubManagementView.ts`
  - `syncProfileScroll` 按 `hasClub` 切换按钮区高度：314.05（3 行）/ 421.96（4 行；后续又加入「钻石池消耗」，第 4 行填满）；卡片、内容高度随之下移（非联盟 657.96、联盟 777.96）。
- `assets/resources/UI/panelMain.prefab`
  - 「操作」Grid 在「钻石流向」后插入「上下分记录」按钮（复用资金明细按钮结构，换新按钮图）。
  - 设计态按钮区高度 421.96、内容 778、卡片 widget top 433.96；运行时由 `syncProfileScroll` 再校正。
  - 克隆节点的 `PrefabInfo.fileId` 已重新生成，未复用原按钮的 fileId。

## 验证

- `node --experimental-strip-types --check`：`panelUpDownRecord.ts`、`panelMain.ts`、`ClubManagementView.ts` 通过。
- Prefab JSON：`panelMain.prefab` 4042 个对象、`panelUpDownRecord.prefab` 105 个对象、`上下分记录对象.prefab` 43 个对象，所有 `__id__` 引用均可解析；新节点父子/组件反向引用正确；新 PrefabInfo fileId 唯一。
- 新贴图 `.meta` 尺寸与 PNG 一致（454×138、941×90、892×111），UUID 全仓无重复；新图体积均小于原图。按钮 SpriteFrame UUID 未变，Prefab 引用无需重挂。
- 未验证：Creator 2.4.13 导入/重编译、网页构建、真机、真实 `AddMemberGoldList` 推送、`type=添加积分` 过滤后的分页、两行玩家/操作人显示、错误回包。

## 下一步

1. 用 Creator 打开项目确认新 Prefab 脚本挂载、按钮图/标题图/表头/两行行模板显示正常。
2. 真实俱乐部账号打开「我的 → 上下分记录」，核对 `AddMemberGoldList` 推送、`type=添加积分` 过滤与分页。
3. 确认玩家名 + 操作人两行文案和「金额/余额」列宽在真机可读。
