# CURRENT.md 归档：2026-11-18 批次原文

来源：`docs/memory/CURRENT.md`（2026-11-22 精简，内容逐字保留）。

## 2026-11-18 下注位「芒N」残留保护性修复（发牌 + 每条消息双触发；脚本就绪，未构建/热更/真机）

- 现象：庄家下注位长期停在「芒12／芒15」，或该显示带分/下注额的位置空着。链路：投芒收尾时 `beicount` 仍为 0 → 走 `ShowMangPayCount(bKeepWhenNoBet)` 把「芒N」写进 `strKeepCoin` 且不设过期 → 庄家走带分、不触发 `东家_下注_事件`，`带分_结束_事件` 分支为空，该座位之后再收不到自己的消息，无人纠正。
- 修复分两层：① `DrhPlayerLogic.RepairBetShowAfterDeal()` 把显示对齐到 `beicount`——动画窗口外的「芒N」直接撤掉（连 `strKeepCoin` 一起清），下注位未激活/空/「0」/旧值一律用 `CheckSmallPlay(beicount)` 覆盖；② 触发点两处——`DrhLogicMgr.ThrowCard2Player` 两段发牌回调（落位玩家）+ `OnServerPlayEvent` 每条消息后经 `RepairBetShowGuards()` 扫**全部座位**（不限本条消息座位/庄家：任何座位都可能错过收尾那一次，比如四人里只有一人显示下注额）。
- 只在 `CanKeepBetShow()` 为真（发牌/带分/决策/看牌，非结算/准备）且 `bRoundSettled=false` 时生效，避免结算后把数字重新点亮。**副作用：`bKeepWhenNoBet` 的庄家芒数长期占位实际失效**——庄家本手真没有 `bei_shu` 时下注位留空，不再显示芒数。
- 只做 TypeScript 转译与 diff 检查，需 Creator 导入后按「庄家带分 + 投芒」多局复测。

## 2026-11-18 牌桌投芒动画收尾修复（脚本就绪，未构建/热更/真机）

- `DrhPlayerLogic` 不再把临时「芒X」写入真实下注缓存；有真实 `bei_shu` 时动画结束或 1.5 秒兜底切换成下注额，无下注的庄位保留本手芒数作为有效占位，其他无下注位隐藏。开局消息缺字段时清空上一手的 `mang_xiu_current` 和下注值，动画的两个回程 Action 改为独立实例。
- 保留动画期间的临时芒数，避免状态消息里的 `bei_shu=0` 提前收起；仅做 TypeScript 转译、`git diff --check` 和记忆结构检查，需 Creator 导入、四端多局复测及真实下注日志确认。
- 详见[交接](handoffs/2026-11-18-mang-animation-cleanup.md)。

## 2026-11-18 牌局结算界面按效果图重做（素材已换、Prefab 已改，未构建/未热更）

- 除背景图与顶部标题不变外，房间信息条 / 表头 / 列表行 / 返回大厅按钮 / 称号牌 / 三头像环全部换成新图（ImageGen 出图 → 抠黑底 → 按目标宽高比重排 → 量化压体积，均小于同组原图）。顶部标题区未动。
- 「战绩玩家对象」的卡片底一直没渲染，根因是根节点 Sprite `_enabled=false`；行高 100→84、列位与表头对齐、新增竖线与第一名皇冠。表头四个字原来画在 PNG 里，改成 Label 后可直接改文案。
- `settlement_row_exact.png`（924×2 分隔线）被 4 个 prefab 共用，**没有原地改**，行卡片另起 `settlement_card_row.png`；同理头像环另起「结算头像环」，不动被 15 处引用的 `公用/头像2.png`。
- **坑**：Widget 改了 `_trs` 不同步，编辑器/离屏渲染会看到旧位置；新建素材 `.meta` 若每次重新生成 uuid，Prefab 引用会全失效。
- 未构建、未热更、未真机验证。详见[交接](handoffs/2026-11-18-settlement-redesign.md)，对比图在 `design-previews/结算改版-20261118/`。

## 2026-11-18 俱乐部「我的成员」加整线积分 / 未提红利汇总条（未构建/未热更，服务端待联调）

- 成员弹窗搜索行与列表之间新增 690x100 汇总条：金币 +「整线积分」+ 数字 / 分隔线 / 钱袋(BF) +「未提红利」+ 数字，底框、两个图标、两处美术字五张图全部用图片技能出图后抠透明落到 `assets/V7/club_v8_summary_*.png`；数字用位图字体 `jackpot_v8_serif_digits`（42 号）。
- 复用废弃节点 `成员概况底板`（原本是压在俱乐部名上的一块 714x86 列表底色残留）：`y=364`、Widget 贴顶 253；列表让位 104（top 260→364、空状态 -12→-64）。位置尺寸按效果图元素包围盒反算，1334/1624 两档离屏渲染核对无压叠。
- 数据接 `查询_俱乐部_汇总`（服务端 2026-11-18 新增，文档状态"待重启 baseapp"）：进成员页查一次、失败或 `无权访问` 整条撤掉并把高度还给列表；只对创建者/管理员显示。`ClubSummary` 推送按 context 配对，无 context 时按 club_id 兜底。
- **坑**：位图字体里「—」是一根 499px 金条，占位文案写「—」会画成一条横贯屏幕的金线；占位必须空串。Creator 导入会重写 `.meta` 并换掉 sprite-frame 子 uuid，导入后要回读回填 Prefab。详见[交接](handoffs/2026-11-18-club-member-summary-bar.md)。
- **首次联调修了两处**：服务端 `ClubSummary` 是扁平下发（没有 `ClubSummary`/`result` 包装），`OnSummary` 必须兜底 `body=data`，否则推送被丢、界面等 1.5s 超时后撤条（表现为"闪一下就没"）；`club_id` 发成 `"undefined"` 时按未知值处理不参与配对。
- **服务端仍阻塞**：回包 `club_id="undefined"`、两个合计恒 `"0"`（`member_count=3` 却是对的），判定 `GetClubSummary` 组装回包用错变量，需服务端修完才能出真实数值。

- 2026-11-17 批次（搓牌扣钻、牌局优化管理员入口、排行榜名次区间、带入补分提示、直聊隐藏大盟主会话、后台玩家控制更名、我的 10 个按钮美术）见 [`archive/2026-11-18/current-nov17-batches.md`](archive/2026-11-18/current-nov17-batches.md)。

- 2026-11-16 批次（后台靓号反查、房间战绩逐局奖池/芒果/输赢/下注）见 [`archive/2026-11-18/current-nov16-batches.md`](archive/2026-11-18/current-nov16-batches.md)。

