# qing 当前状态

更新时间：2026-11-19

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-19 实时战绩头像框：环不再缩在头像里（Prefab 就绪，未导入/构建/热更/真机）

- 根因：`record_avatar_ring.png` 92×92 四周留了透明边距，环外径只占画布 0.659；节点按 64/46 绘制后可见环径仅 42/30，而头像 62/44，框被"跑进"照片里。
- 改动只有两个节点的 `_contentSize`：`观战对象.prefab` 的 `V8头像框` 64→**100**，`带入记录.prefab` 的 `ring` 46→**72**；PNG/`.meta`/UUID 未动，`tools/apply_realtime_record_v2.py` 常量同步。
- 离屏与合成图核对见 `vibe_images/2026-11-19-avatar-ring/`；Creator 导入、构建、热更、真机未做。详见[交接](handoffs/2026-11-19-realtime-avatar-ring-size.md)。

## 2026-11-18 游戏设置入口：按「当前俱乐部所属联盟」判身份（脚本就绪，未构建/热更/真机）

- A3 有两家俱乐部（一家盟主、一家大盟主），当前在盟主那家；首次进大厅入口正确隐藏，点过「我的」回大厅后入口又冒出来。
- 根因：入口用**账号级**扫描——`clubUnionStatus` 里任意一家 `isOwner===true` 就亮，跟当前俱乐部无关；`start()` 里 `schedule(...,1)` 每秒轮询，另一家（大盟主）的 `is_owner=1` 被「我的」页补查回来之后，1 秒内就翻上去了。
- 修正（`panelMain.ts` `RefreshGameSettingsEntry`）：改用既有 `IsUnionOwnerOfClub(clubId)`（只看当前俱乐部所属联盟），口径与「上下分记录/钻石池消耗」一致；可见 = `unionKnown && (当前联盟的总群主 || (确认未入盟 && 当前俱乐部创建者))`，联盟未知时藏并按 30 秒节流补查。同日另修 `OnClubMyUnion` 不再写 `isOwner`。
- TS 转译 0 诊断；入口判定 6 例（盟主/大盟主/未入盟创建者/非创建者/状态未知）跑真实方法切片全部符合预期。未构建/热更/真机。详见[交接](handoffs/2026-11-18-game-settings-entry-union-gate.md)。

## 2026-11-18 排行榜数字等宽等基线 + 列右对齐（就绪，未导入/构建/热更）

- 根因：`leaderboard_v8_digits.fnt` 的 `xadvance` 33~40 连字宽、基线差 3px，数字宽窄不一且上下抖。
- `tools/apply_leaderboard_tabular_digits.py`：17 字形统一 56px 高、基线 59、数字 `xadvance=43`；贴图尺寸/UUID/`.meta` 不变，原图备份 `art_sources/v8-repairs/leaderboard/digits-tabular-before/`。
- `tools/apply_leaderboard_number_align.py`：`played_count`/`user_reward` 改右对齐（40 个 Label），右边缘落在列分隔线右内 8px，框宽 200/160 防裁 `−18,630`；`render_ui_prefab.py` 预览补对齐。
- 1334/1624 离屏：手数右边缘 559、奖励 713 全齐（改前 515/500/501）；未构建/热更/真机。详见[交接](handoffs/2026-11-18-leaderboard-tabular-digits.md)。

## 2026-11-18 实时战绩按新效果图重做（场景 + Prefab 同步，未导入/未构建/未真机）

- 场景 `drh8.fire` 与 `panelGameView.prefab` 内的「实时战绩」子树同步改写：新 `战绩标题`、`表头`、`战绩列表`、`围观底板`、`title2`、`围观列表`、`搓牌字/线/开关`；旧汇总区（`bk`、`V8战绩底板`、`V8围观底板`、总带入/总得分、奖池、V8概况/表头、旧 title）整组隐藏未删。
- 二轮美术按参考图重生成后，面板改为居中且不再顶满：`bg` 594×1262、Widget TOP+BOT+LEFT（l=78/t=36/b=36），`_opacity=170` 让牌桌透出来；标题 TOP 68、表头 TOP 212、列表 TOP 292/BOT 352、围观框 BOT 150、搓牌行 BOT 76，全部 Widget 定位。
- 第四轮按真机反馈收版：围观 76×35、搓牌 76×33（同 x=-199），金线素材改 512×5 通栏细线（围观线 322×5@x=12、搓牌线 204×5@x=-47），`title2` 高 35；围观列表 content 顶部对齐、Layout 改 GRID 152×80（`_resize=1`）、左右 padding 16、Mask 启用，三列成行、纵向可滚；围观模板 `name` 移到 x=32/w=74，根下旧 92×92 头像框不再参与渲染。
- 脚本：滑块随开关移动、战绩行补头像加载、结算行切 `V8结算底`、提示行隐藏头像与底。
- 静态核对 0 坏引用，场景/Prefab 节点与 15 个 SpriteFrame 引用一致；1334/1624 两档模拟排版图见 `vibe_images/2026-11-18-realtime-record/`。Creator 导入、构建、热更、真机均未做。详见[交接](handoffs/2026-11-18-realtime-record-v2.md)。

## 2026-11-18 牌局结算行底：正分金卡、非正分普通蓝底（脚本就绪，未构建/热更/真机）

- `settlement_card_row.png`（金卡）与 `settlement_card_row_normal.png`（普通，sprite-frame `33f21cbe…`）均 1400×168、RGBA 未量化；内部改为逐行中值重建的平滑渐变并强制不透明——原图内部的半透明条纹就是实机“褶皱”来源。金卡保留原金边/外发光，同名同 UUID，共用 prefab 引用不变。
- `战绩玩家对象.prefab` 新增首个子节点「底_普通」（700×100、默认隐藏）；`panelRecordInfo.setRecordItemInfo` 按 `nScore > 0` 切换根 Sprite 与普通底。
- Creator 已导入（prefab 22:02、普通图 22:13、金卡 22:20）；未构建/热更/真机。详见[交接](handoffs/2026-11-18-settlement-row-normal-card.md)。

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

## 更早批次

- 2026-11-15 批次（业绩股全局折算、逃跑惩罚统计、玩家优化接胜率目标、排行榜独立模块、代理链、俱乐部荣耀榜、BF 聊天默认关闭）见 [`archive/2026-11-18/current-nov15-batches.md`](archive/2026-11-18/current-nov15-batches.md)。
- 2026-11-14 批次（后台靓号、BF 消息规则、玩家关联账号/IP 短码、客户端 BOSS IP 短码）见 [`archive/2026-11-17/current-nov14-batches.md`](archive/2026-11-17/current-nov14-batches.md)。
- 2026-11-13 批次（BF 聊天开关移交后台、业绩核心共享三阶段发放、额度授权记录类型、后台用户端数据查询）见 [`archive/2026-11-15/current-nov13-batches.md`](archive/2026-11-15/current-nov13-batches.md)。
- 2026-11-03～11-09 的历史客户端、额度、牌局和后台批次见 [`docs/memory/archive/`](archive/2026-11-15/)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
