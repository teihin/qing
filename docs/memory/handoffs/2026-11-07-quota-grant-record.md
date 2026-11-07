# 2026-11-07 我的页新增「额度授权记录」

- 分支：`codex/club-ui`（工作区含其他任务未提交修改，本次只动下列文件）
- 状态：代码 / Prefab / 贴图已落盘；**未 Creator 导入、未构建、未连真实服务器验证**

## 目标

「我的」按钮区新增「额度授权记录」入口（第 5 行左列），点开弹出大盟主给各盟主授信/收回的额度流水。
弹窗结构与「钻石池消耗」完全一致（同底板、同表头、同分页、同行模板），只换标题、表头文字与数据源。

## 接口口径

- 联盟成员：`查询_我的_联盟` → 推送 `ClubMyUnion`（`members[].club_id / owner_guuid / owner_name`）。
- 额度流水：`查询_俱乐部_额度流水` → 推送 `ClubQuotaWater`，`club_id` + `user_id` + `count` + `page` + `context`。
- 落库事实（已直连线上 `kbedm.club_history_info` 只读核对，2026-11-06 数据）：
  - 一次授信写两行，`opt_type='额度联盟授信'`，同一秒；
  - 联盟池行：`user_guuid`=总群主、`club_guuid`=总群主俱乐部、`user_quota` 为负、`remark` = `联盟池A→B`；
  - 目标俱乐部行：`user_guuid`=盟主、`club_guuid`=目标俱乐部、`user_quota` 为正、`remark` = `A→B`、`opter_guuid`=总群主。
  - 平台注资是 `opt_type='额度联盟注资'`，同样记在总群主名下。
- 客户端取数：拿 `ClubMyUnion.members` → 逐个别家俱乐部串行查额度流水（`user_id` = 该俱乐部 `owner_guuid`）→
  只留授权类 `type`（含「授信 / 收回 / 授权」；V2 `额度联盟授信`、旧模型 `额度授信 / 额度收回` 都命中）→ 本地排序 + 本地分页。
  若成员侧一条都没有（权限被拒或联盟为空），回退查自己俱乐部 `user_id="ALL"`，展示联盟池侧扣减，
  对象列显示「联盟池」；回退路径额外纳入 `额度联盟注资 / 额度转入`（平台注资），避免页面全空。
- **单位**：`quota` 与 `remark` 都是分，展示前 ÷100 → 元，与现有「额度记录」页一致
  （`ClubManagementApi.quotaYuan / quotaBalance` 就是这么换算的）。
- **回包形态**：`ClubQuotaWater` / `ClubMyUnion` 推送可能是裸数组、裸对象、`result`/`ret_result` 包裹，
  也可能不带 `context`；同步回包 `0x200` 与 `0x500` 都算成功。实现用 `Unwrap` 摊平候选 + `pendingContext` 配对，
  与 `ClubManagementApi` 的串行车道口径一致；迟到的同步回包不会多推一次成员游标。

## 改动文件

新增：

- `assets/scripts/UI/panelQuotaGrantRecord.ts` + `.meta`
  - 串行状态机：`查询_我的_联盟` → 逐个成员俱乐部 `查询_俱乐部_额度流水`（最多 24 个、单请求 8s 超时）→ 汇总渲染；
  - 本地分页（10 条/页），翻页走 `ScrollViewEx.callBackFresh`（`UpdateList` 读顶层 `number` / `count`）；
  - 行映射：时间 `date`、盟主 = 成员 `owner_name`、授权额度 `quota`(分→元，正红负绿)、
    余额取 `remark`（纯数字或 `A→B` 的尾段，分→元）；只激活 `V8类型图标_quota`；
  - `Unwrap` 摊平多种回包、`MatchContext` 按在途 context 配对（推送无 context 时按串行配对），
    兼容 `(nCode, strMsg)` 双参数派发与 `0x500` 成功码。
- `assets/resources/UI/panelQuotaGrantRecord.prefab` + `.meta`（克隆自 `panelStonePoolCost.prefab`，根节点改名、根脚本换 `f76b6fNid5PpacAsNdXa2fG`、标题栏/表头换新图）
- `assets/resources/Prefabs/额度授权记录对象.prefab` + `.meta`（克隆自 `钻石兑换记录对象.prefab`，`V8类型图标_stone` 改名 `V8类型图标_quota` 并换新图标）
- `assets/V7/mine_quota_grant_exact.png` + `.meta`（443×138，60 KB < 原 62 KB）
- `assets/V7/money_v8_header_quota_grant.png` + `.meta`（941×90）
- `assets/V7/money_v8_table_quota_grant.png` + `.meta`（892×111，表头：时间 / 盟主 / 授权额度 / 余额）
- `assets/V7/row_quota_grant.png` + `.meta`（118×116，行图标，内容 118×80 居中）
- `design-previews/待确认/2026-11-07-额度授权记录/`（按钮 + 弹窗离屏预览）

修改：

- `assets/resources/UI/panelMain.prefab`
  - 「操作」下新增第 11 个子节点「额度授权记录」（克隆「钻石池消耗」，尺寸 332.84×101.17，贴图换新图，新 fileId）；
  - 按钮区高度 421.96 → **529.13**（Grid 第 5 行），widget `_bottom` 235.95 → 128.78、`_originalHeight` 同步；
  - 9 个已激活按钮的 `_trs` 坐标同步重排为 5 行（行中心 y = 213.98 / 106.81 / 0.04 / -106.31 / -213.07，
    左列 x=-168.62、右列 x=175.95），新按钮落在第 5 行左列，避免编辑器里与「钻石池消耗」重叠；
  - 「当前俱乐部」卡片 widget `_top` 433.96 → 541.13（= 529.13 + 12）。
- `assets/scripts/UI/panelMain.ts`
  - `RefreshClubFinanceMenuVisibility` 的路径表加入新按钮（无俱乐部时隐藏）；
  - `onButtonClick` 新增 `额度授权记录` 分支 → `showPanel("panelQuotaGrantRecord", Cover)`。
- `assets/scripts/UI/ClubManagementView.ts`
  - `syncProfileScroll` 有俱乐部时按钮区高度 421.96 → 529.13，注释同步。

## 美术做法

- 按钮 / 标题栏 / 表头都以**原图原始像素为底**：逐行左右插值抹掉旧图标与旧文字，再叠加新内容，底板渐变与原图一致。
- 新文字用项目自带 `assets/font/PingFF.ttf` 渲染（与原图同字体）：竖向米金渐变 + 深蓝黑描边 + 右下投影；
  字号按原图墨迹尺寸标定（按钮 39、标题 65、表头 30），标题额外加粗（MaxFilter 膨胀 1px × 0.6~1.0 混合）。
- 按钮图标用内置 imagegen 生成（参考「上下记录」的金币图标做 image-to-image），金币 + 向右箭头 = 额度划给盟主；
  白底 floodfill 抠图，缩到 89×60 贴在图标槽位（中心 x=97）。
- 文字左缘与「钻石池消耗」对齐（按钮 180、标题 114），表头四列沿用原列中心 116 / 399 / 574 / 775。

## 验证（静态）

- `node --experimental-strip-types --check`：`panelQuotaGrantRecord.ts`、`panelMain.ts`、`ClubManagementView.ts` 通过。
- `panelMain.prefab` 4260 个对象、`panelQuotaGrantRecord.prefab` 105、`额度授权记录对象.prefab` 43；所有 `__id__` 在范围内，
  新子树 `_parent` / `node` 引用正确，新 `fileId` 唯一。
- 三张新贴图 `.meta` 尺寸与 PNG 一致，uuid 全仓不重复；新 prefab 引用的贴图 uuid 均可解析（除引擎内置材质）。
- 离屏合成预览（`design-previews/待确认/2026-11-07-额度授权记录/`）确认标题栏、表头四列与数据列对齐、行不压表头；
  余额列已改为元值（50650 / 3928 / 3011 / 5515），与运行时一致。
- 表头下 7 个旧 Label / Sprite 子节点都是 `active=False`，不会和新表头贴图叠字；标题栏/关闭按钮坐标与原弹窗完全一致。
- `ScrollViewEx.UpdateList` 与 `PageEx` 已核对：`data.number` 设当前页、`data.count` 算总页数，本地分页链路成立。
- 贴图体积均不超过同组原图。

## 未验证 / 风险

1. **服务端是否把 `额度联盟授信` 行返回给 `查询_俱乐部_额度流水`** 未实测：§11.2 的 type 表列的是
   `额度授信 / 额度收回 / 额度转入 / 额度占用 / …`，没有 V2 的 `额度联盟授信 / 额度联盟注资`。
   偏乐观的证据：`ClubManagementApi.OnClubQuotaWater` 在客户端主动过滤「只留牌局相关行」，
   说明服务端返回的确实不止牌局类型；V2 文档第 686 行也明确该命令支持 `user_id="ALL"`。
   仍须实测：若列表为空，需服务端补 type 白名单或换查询命令。
2. 总群主查**别的俱乐部**的额度流水是否被权限拦住（§11.2 只写「自己 / 群主 / boss 可查任意账号」；
   V2 文档第 133 行显示总群主查属下俱乐部成员是放开的，但流水命令未明说）未知；
   被拦时自动回退到自己俱乐部的池侧记录（此时对象列显示「联盟池」，看不到盟主名）。
3. 推送常不带 `context`，串行查询期间若有别的页面触发同名 `ClubQuotaWater`，理论上可能把上一家的数据
   记到当前盟主名下；已用 `pendingContext` 过滤带 context 的串包，无 context 的仍需实测确认。
4. Creator 2.4.13 未导入：新贴图需 `touch` + 激活窗口才会重导；`panelMain.prefab` 改动需在编辑器里确认第 5 行按钮位置与卡片不重叠。
5. 真机未验证：长屏滚动、分页手感、金币图标在按钮上的实际清晰度。

## 后续变更：入口收窄到「大盟主 / 盟主」（2026-11-07 21:10）

用户要求「我的 → 额度授权记录」只给**大盟主、盟主**看，其他人不可见。

- `panelMain.RefreshClubFinanceMenuVisibility`：新入口从原来「有俱乐部就显示」的路径表里拆出来单独判定，
  `active = hasClub && CanViewQuotaGrantRecord(clubId)`。
- 新增 `panelMain.CanViewQuotaGrantRecord(clubId)`：先要 `IsClubOwner(clubId)`（俱乐部创建者，走
  `club_make` / `clubAgentInfo.is_creator`），再按联盟归属放行 —— 有 `union_id`（大盟主=联盟总群主，盟主=已入盟）
  直接放行；联盟归属未查回来时也对创建者放行，等 `查询_联盟_额度` 回包（`OnClubUnionQuota` → 末尾
  `RefreshClubFinanceMenuVisibility`）再纠正，避免查询失败把盟主入口永久藏住。确认「未入盟」（群主）则收起。
- `panelMain.onButtonClick` 的 `额度授权记录` 分支加同一道判定，热更残留状态/误点也进不去弹窗。
- `ClubManagementView.syncProfileScroll`：按钮区高度不再写死 `hasClub ? 529.13 : 314.05`，改成按「操作」
  下已激活子节点数算行数（两列 Grid）：≥5 行 529.13，4 行 421.96（其他成员看不到额度授权记录时的状态），
  无俱乐部沿用 314.05。卡片 `_top = opHeight + 12`、内容高度随动，不会因为少一个入口留白或压卡片。
- 静态验证：`panelMain.ts` / `ClubManagementView.ts` `ts.transpileModule` 0 诊断。
- 未验证：编辑器与真机没跑；群主（未入盟）在联盟状态未回包前会短暂看到入口，回包后自动收起。

## 下一步

1. Creator 打开项目，看「我的 → 额度授权记录」按钮与弹窗。
2. 用大盟主账号在测试服点开，核对是否拿到 `ClubQuotaWater` 的授信行；若为空，先确认服务端 type 白名单。
3. 真机跑一遍分页与滚动，再考虑提交。
