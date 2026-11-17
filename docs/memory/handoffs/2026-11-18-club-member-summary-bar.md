# 2026-11-18 俱乐部「我的成员」上半区新增整线积分 / 未提红利汇总条

目录 /Volumes/SSD/qing，分支 codex/club-ui。

## 目标

在俱乐部「我的成员」弹窗的上半部分（搜索行与成员列表之间）新增一条汇总条，1:1 还原用户给的效果图：左侧金币 +「整线积分」+ 数字，中间细分隔线，右侧钱袋（BF）+「未提红利」+ 数字。数据取 `查询_俱乐部_汇总`（服务端 2026-11-18 新增，待重启 baseapp 联调）。

## 改动

### 资源（均用图片技能生成，无脚本绘制）

| 文件 | 尺寸 | 说明 |
| --- | --- | --- |
| `assets/V7/club_v8_summary_bar.png` | 1380x200（=690x100 @2x） | 胶囊底框：细金边 + 深蓝渐变 + 底部青白辉光；纯洋红底出图后抠图，三段拉伸到 690:100 |
| `assets/V7/club_v8_summary_coin.png` | 132x120 | 金币两摞（前 3 后 5，币面浮雕） |
| `assets/V7/club_v8_summary_bag.png` | 128x140 | 金色钱袋，正面 BF 浮雕徽记 |
| `assets/V7/club_v8_summary_t1.png` | 227x60 | 美术字「整线积分」（白字 + 深蓝描边） |
| `assets/V7/club_v8_summary_t2.png` | 228x60 | 美术字「未提红利」 |

- 五张图都是纯洋红底出图后色相比值抠图 + 去洋红溢出 + 去孤点，四角透明。
- **底框的洞要用 alpha 闭运算补 + 洞内横向中值补色**：直接补 alpha 会留下小黑点，三段拉伸后变成横条。
- `.meta` 由脚本先写，Creator 导入后会重写成自己的格式并**换掉 sprite-frame 子 uuid**；导入后必须回读 meta 再回填 Prefab 的 `_spriteFrame.__uuid__`，否则引用悬空（本次底框就踩了）。

### Prefab `assets/resources/UI/panelMain.prefab`

- 复用历史遗留节点 `俱乐部成员弹窗/面板/成员概况底板`（原来是一块 714x86 的列表底色残留在抬头处，一直压着俱乐部名），改成新的汇总条：690x100、`y=364`、Widget `flags=1 top=253`（贴顶固定，长屏跟随）。
- 子节点：`积分图标(-280,8 93x80)`、`积分标题(-136,22 88x23)`、`积分数值(-122,-17)`、`分隔线(8,0 2x80)`、`红利图标(107,1 65x71)`、`红利标题(234,22 88x23)`、`红利数值(240,-17)`。位置/尺寸全部按效果图元素包围盒反算（效果图 150px 条高 ↔ 设计 100）。
- 数字用位图字体 `assets/V7/jackpot_v8_serif_digits.fnt`（金色渐变衬线，与效果图同一家族），`fontSize=42`、`overflow=NONE`、节点 240x60。**不要用 `overflow=SHRINK`**，位图字体下实际字号会跟着节点尺寸变，量不准。
- 成员列表让位 104：`成员列表底板` top 260→364、`列表` top 260.5→364.5、`空状态` `y` -12→-64（高 959→855，仍 4 行半）。
- `成员概况底板` 默认 `active=true` 便于编辑器看稿；运行时由脚本按身份显隐。

### 客户端脚本

- `ClubManagementView.ts`
  - 新增 `ClubSummary` 接口与 `summaryVersion/summaryLoading` 字段、`grouped()`（千分位）、`canSeeSummary()`、`applySummaryLayout()`、`writeSummary()`、`loadSummary()`。
  - `open("members")` 后查一次汇总；进入申请/联盟等其它页签时作废并撤条。**不随翻页/轮询调用**（接口是全表扫）。
  - 失败或无权（`无权访问`）时整条撤掉、把 104 高度还给列表，**不显示假的 0**。
  - 换俱乐部/换账号在 `Refresh()` 里 `++summaryVersion` 并撤条，避免旧数字残留。
  - **占位文案必须是空串**：位图字体里「—」是一根 499px 长的金条，画出来像一条横线横贯屏幕（本次踩过）。`grouped()` 对非有限值也返回空串。
- `ClubManagementApi.ts`
  - 注册 `ClubSummary` 推送；新增 `summary(club)` → `查询_俱乐部_汇总`；`OnCommand` 用 context 配对 `ClubSummary` 推送，没等到推送时留 1.5s 短窗口再判失败；无 context 的回包/推送按 club_id 兜底配对。
  - 服务端字段全是字符串，客户端只 `Number()`，不套比例/折扣。

## 数值口径（照抄接口文档）

- 整线积分 = `total_club_gold`，全体成员在本俱乐部的 `club_gold` 合计，整数，可为负。
- 未提红利 = `total_unclaimed_bonus_fen`（分）÷100 展示，含创建者 + 全部代理 + 已取消代理残留，不套 `show_percent`。
- 只对创建者/管理员显示（`role=owner|manager`）。代理/普通成员不请求、不显示，避免泄露全俱乐部红利。

## 已验证

- 语法：`ts.transpileModule` 对两个 ts 文件 0 诊断。
- Prefab：`tools/render_ui_prefab.py` 同源渲染脚本按 750x1334 与 750x1624 两档离屏渲染，汇总条/搜索行/列表/分页无压叠；注入示例值 `128,600 / 36,850` 后与效果图同尺度对比，图标、标题、数字、分隔线位置一致。
- 资源：五张 PNG 四角透明、Creator 已导入（`library/imports/<uuid>` 有本次产物，mtime 01:26），Prefab 的五个 `_spriteFrame` uuid 已与导入后的 meta 对齐。
- 数字尺寸按效果图反算：数值高 30 单位、宽 141 单位；实际渲染 42 号字 ≈ 34x130（字体比效果图略窄，视觉可接受）。

## 待验证

- **服务端未联调**：接口文档状态是"已上传测试服，待重启 baseapp"。`ClubSummary` 推送名/字段、`无权访问` 分支都要真机确认一次。
- 未构建、未热更、未真机；网页实际点击「我的成员」看显隐与列表高度未验。
- 数字字体比效果图窄约 8%，若要完全一致需要美术出一套更宽的金色数字位图图集。
- `assets/V7/club_v8_summary_bar.png` 是纯洋红底重出的一张（第一版底部中心有灰斑），三段拉伸后中间段横向拉长 2.1 倍，放大看能看出光带略平；游戏内 100px 高下不可辨。

## 2026-11-18 首次联调：条闪 1 秒消失 + 数字为空

- 现象：进「我的成员」，汇总条显示约 1 秒后整条消失，数字始终为空。
- 根因（客户端）：服务端 `ClubSummary` 是**扁平**下发（`收到onMessage<ClubSummary> {club_id,member_count,total_club_gold,...,context}`，没有包一层 `ClubSummary`/`result`），`OnSummary` 只认 `data.ClubSummary || data.result`，取不到 body 直接 return → 推送被丢 → `OnCommand` 等 1.5s 判"汇总数据未返回" → 界面 catch 里撤条。**看起来就像闪一下**。
- 修法：`OnSummary` 增加 `body === undefined → body = data`，并加"至少要有一个汇总字段"的校验；`club_id` 为 `"undefined"/"null"/"0"/空` 时按未知处理，不参与 context 配对（context 已匹配时就够）。`summary()` 发请求前清掉上一次的迟到推送。
- 验证：用 `ts.transpileModule` 把 `ClubManagementApi.ts` 编成 CommonJS，桩掉 `kbengine`/`GameDataManager` 实跑三条路径——① 真实扁平推送 + 0x200 ⇒ resolve `{memberCount:3,totalGold:0,unclaimedBonusFen:0}`；② 无推送 ⇒ 1512ms 后 `汇总数据未返回`；③ `0x301 无权访问` ⇒ 立即失败。与线上报错链路一致。

## 待服务端修（阻塞真实数值）

- 客户端请求报文已确认正确：`{"header":"查询_俱乐部_汇总","club_id":"267403","context":"clubmg:…"}`。
- 服务端回包：`club_id="undefined"`、`member_count="3"`、`total_club_gold="0"`、`total_unclaimed_bonus_fen="0"`。成员数和 club_id 自相矛盾（成员数算对了、id 丢成字符串 "undefined"），两个合计恒为 0 —— 判定为 `GetClubSummary` 组装回包时用错变量（回显的 club_id 和两条合计取自未赋值的字段），**客户端无需再改**。
