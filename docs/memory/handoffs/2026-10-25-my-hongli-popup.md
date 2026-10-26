# 我的红利弹窗 V8-new 交接

日期：2026-10-25

## 目标

为代理入口增加独立的“我的红利”弹窗，展示今日、昨日、累计红利，显示未领取红利，提供提取确认、提取记录和分页。

## 本次改动

- 新增 `assets/resources/UI/panelMyHongli.prefab` 及 `.meta`。
- 新增 `assets/scripts/UI/panelMyHongli.ts` 及 `.meta`。
- `panelHongli.ts` 的“提取红利”按钮改为打开 `panelMyHongli`。
- 新增 `assets/V7/agent_v8_header_my_hongli.png` 及 `.meta`。
- “未领取红利”行使用 `agent_v8_table_base.png` 九宫格底板，和 `panelHongli` 的列表、表头、按钮、确认弹窗保持同一套 V8-new 视觉资源。
- 保留 V4 效果图与生成脚本在 `art_sources/v8-repairs/bonus-popup/`。
- “我的”页当前俱乐部的“我的收益”按钮改为打开 `panelMyHongli`。
- 当前俱乐部卡片移除俱乐部 ID，邀请码读取与俱乐部列表相同的 `clubAgentInfo[id].invite_code`；切换到“我的”时补请求 `查询_俱乐部_代理_信息`。
- 当前俱乐部卡片的角色文本与列表统一使用“老板/代理”等口径，并复用列表角色徽标提取出的 `assets/V7/club_role_badge_v8_exact.png`。

## 接口与数据

- 红利统计：`异步_查询_红利_信息`。
- 提取：`提取_玩家_红利`，金额沿用账号字段除以 100 的显示规则。
- 提取记录：`查询_玩家_红利提取_记录`，使用 `HongliList`，行字段优先读取 `player_guuid/user_id`、`type`、`hongli_number`、`date/time`；服务端未返回的玩家和类型不补造业务数据。

## 验证

- Prefab JSON、节点路径、按钮节点、脚本压缩 UUID 和资源 UUID 静态检查通过。
- Cocos Creator 2.4.13 刷新资源后已生成 `library/imports/7d/7d0489ed-9451-41a1-afb6-c9314ec524a7.json` 与 `library/imports/4b/4bfac4ba-e708-4ef6-baa8-7f4d37b0ac73.js`。
- `python3 docs/memory/check_memory.py check --root "/Volumes/SSD/qing"` 通过；仅有既有文档大小警告。
- 当前未执行真实账号接口、Creator 运行时点击提取、构建、真机或线上验收。
- 已确认预览能打开登录页，但当前没有登录态，因此尚未完成登录后点击“我的收益”及邀请码/角色的运行时验收。

## 响应式布局修正

- `panelMyHongli` 根节点 Widget 改为不锁定 750×1334，提取确认层和遮罩同步跟随父容器伸缩，避免长屏设备上下留空。
- 列表外框扩为 700 宽，表头 692 宽，记录行 684 宽，四列等宽排列。
- 预览：`art_sources/v8-repairs/qa/my-hongli-v5-responsive.png`；Cocos Creator 已重新导入更新后的 Prefab。

## 顶部统一与文字放大

- `panelMyHongli` 顶部改用其他 V8 页面共用的 `personal_info2_header_bg_v8` 标题底图、返回箭头和标题描边结构，移除原红利页赌场背景头图的使用，标题仍由节点文字动态显示“我的红利”。
- 表头字号调整为 24，记录行调整为 20，暂无记录提示调整为 24，页码调整为 26；提取确认层的说明和金额文字同步放大。
- 预览脚本已同步更新：`art_sources/v8-repairs/bonus-popup/render_preview_v5_responsive.py`；输出仍为 `art_sources/v8-repairs/bonus-popup/qa/my-hongli-v5-responsive.png`。
- Prefab 已由 Cocos Creator 2.4.13 刷新导入，当前导入对象数为 294，引用检查无错误。

## 长屏 Widget 适配

- 为统计区、未领取红利行、提取/记录按钮、表头增加顶部 Widget，保持长屏下的顶部节奏。
- 列表外框和列表内容增加左右、上下 Widget，列表在顶部信息区与底部分页之间伸缩，左右边距保持一致。
- 暂无记录提示与分页增加底部 Widget，分页随屏幕底部对齐；提取确认层和遮罩继续使用全屏 Widget，弹窗内容相对父层中心显示。
- Cocos Creator 已打开并保存当前 Prefab，源文件与 `library/imports/7d/7d0489ed-9451-41a1-afb6-c9314ec524a7.json` 均为 294 个对象。

## 提取按钮统一

- “提取红利”和“提取记录”统一使用 `agent_v8_button_base.png` 底板，按钮文字改为 Prefab 内的 V8 Label 和阴影节点，字号与间距一致。
- 两个按钮仍保留原节点名和 Button 组件，`panelMyHongli.ts` 的点击分流不变；当前 Prefab 对象数为 302。

## 改为俱乐部模式口径（2026-10-25 晚）

`panelHongli` 保持平台代理不变，只改 `panelMyHongli` 与本面板的数据通道。

- `ClubManagementView` 的「管理收益」打开面板时通过 `strUserData` 传 `{club_id, club_name}`；`panelMyHongli` 在 `start()` 解析（`onLoad/onEnable` 早于 `UIManager.setPanelInfo` 赋值，读不到）。
- 今日/昨日：`查询_俱乐部_代理_收益`（`club_id`+`date`，count=1），路由 `ClubAgentIncomeInfo`，取 `summary.total_fen` ÷100。文档 §1.7 单位为分。
- 收益明细列表：同接口 `result`（`ClubAgentIncome`），列映射 `winner_name` / `percent%` / `amount_fen` / `time`，分页用推送的 `number`/`count`。
- 累计红利、未领取红利、提取仍是账号属性 `all_hongli`/`hongli` 与既有命令 `提取_玩家_红利`（文档 §6 时序、§7-10 俱乐部免门槛，客户端不加门槛提示）。
- 该路由推送**不带 context**，今日→昨日→列表改为串行，`pendingKind` 配对；`requestRecords` 在串行未完成时不插队。
- 每个请求都在 param 里显式带 `context`：服务端 0x301 异常回包只回 context，不带的旧写法配不上回调（`提取_玩家_红利` 原来因此既不提示也不刷新）。
- 服务端未上线 4.6 时的处理：收到 0x301 或 3 秒无推送（仅今日/昨日）自动退回平台口径（`异步_查询_红利_信息` + 提取流水）。
- 修正提取流水：数据由 `onMessage` 路由 `HongliList` 推送，原来只注册 `onHallCommand` 导致永远“暂无记录”；服务端这条 SQL 只有 `limit count`、无 offset，改成按 `(page+1)*PAGE_SIZE` 取回后本地切页。
- 未登录/断线时账号为空不再直接取属性，改为占位符，避免 `onLoad` 抛异常。

未验证：没有登录态跑真实回包；`查询_俱乐部_代理_收益` 与路由 `ClubAgentIncomeInfo` 是否已在服务端上线未确认（`/base/Hall.py` 注册表里查不到该命令，文档标注“服务端未实施”）。


## 列表改为可滚动（2026-10-26 晚）

- 原实现是 Prefab 里 8 行静态 `记录行1..8`，无 Mask 无 ScrollView；运行期 `列表` 的 Widget（父 `列表面板` 918 高，top 362/bottom 136）把高度压到 420，600px 的行量直接溢出底板。
- 结构改为 `列表`(cc.ScrollView) → `视口`(cc.Mask `_type=0` + Widget 四边 0) → `内容`(anchor 0.5/1) → `记录行`（模板，active=false）；`记录行2..8` 已删除。Prefab 对象数 302 → 205。
- `panelMyHongli.ts`：新增 `initList/rowAt/layoutList/renderRows`，行按需克隆复用，按 `行数 × 75` 撑内容高度后 `scrollToTop`；`PAGE_SIZE` 8 → 15。
- 未验证：无登录态，运行时滚动、翻页与长屏适配未实测；Creator 内视觉未复核。
