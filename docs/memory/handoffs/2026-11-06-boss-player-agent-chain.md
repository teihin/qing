# 2026-11-06 BOSS 玩家数据面板 · 代理链页签

## 目标

牌桌内点击玩家头像时，若当前登录账号是 BOSS（客户端口径 `level>=99` 或旧平台角色
董事长/总裁），打开全屏「玩家数据」面板；首个页签「代理链」按最新接口文档
`服务器文档整理/俱乐部成员代理链路查询-客户端接口文档.md` 展示被点玩家到总群主的
每一级统计。面板做成独立 Prefab，其它页面可按用户 ID + 俱乐部 ID 直接复用。

## 目录 / 分支

`/Volumes/SSD/qing`，分支 `codex/club-ui`。本次未提交。

## 改动文件

- 新增 `assets/resources/UI/panelBossPlayerInfo.prefab`（+ `.meta`）
  - 全屏：根节点 Widget 拉伸，标题栏/玩家抬头/页签/表头改为顶部锚点，列表面板与说明改上下锚点，
    长屏也铺满；背景改为 130 透明度的深色遮罩，可看到桌面牌，列表底板 70 透明度。
  - 顶部标题用新生成的美术字 `assets/V7/boss_player_data_v8_title.png`（imagegen 纯品红底生成后按颜色抠图，840x214，透明底）。
  - 根节点加 `cc.BlockInputEvents`、`zIndex=200`（脚本内设置）避免牌桌按钮抢触摸。
  - 页签：代理链（已实现）/ 输赢详情 / 牌局详情（占位）。
  - 行模板由 `panelMain.prefab` 的俱乐部成员行复制后重排：头像、姓名、ID、身份、
    总输赢、总贡献、总红利；列表区用 Widget 自适应长屏。
  - 表头、空态、加载、错误/重试、统计口径说明。
  - 多链分块：`链标题`（俱乐部名，690x56）与 `链空` 模板，运行时按 `chains[]` 克隆。
- 新增 `assets/scripts/UI/panelBossPlayerInfo.ts`（+ `.meta`）
  - 入参兼容 `arrayEx[0]=DrhPlayerLogic` 或 `strUserData` JSON
    `{userId, clubId, name, role, photo}`；静态 `Open(userId, clubId, name, role)` 供其它页面复用。
  - 抬头按 `玩家资料/头像|玩家姓名|玩家ID` 取值：头像用 `strPhoto` 走 `GetImageByName`，
    昵称/ID 直接取 PlayerInfo；被点玩家无 `req_club_id` 时用房间俱乐部兜底。
  - 发送 `查询_俱乐部_成员_代理链路`，监听 `ClubMemberAgentChain`；context 配对、
    12 秒超时、「代理数据加载中」自动重试一次；兼容旧服顶层 `chain`。
  - **全面板只发这一条命令**（2026-11-06 17:15 用户定稿要求：绝不在面板里二次调
    `查询_俱乐部_成员`）。此前两版（逐行补查 → 去重补查）都已全部删除：`NumberList` 不再监听，
    `reqHallCommand` 全文只剩 1 处。
  - **每行 9 个统计字段全部来自本命令**（2026-11-06 17:25，服务端已按新文档实现并上传）：
    `today/yesterday/total_score`、`today/yesterday/total_contrib_fen`、
    `today/yesterday/total_bonus_fen`，一一对应文档 §3.2。`ParseRow` 解析后 `FillRow` 直接渲染，
    缺字段回退 `—`。原先准备的 `team_count`/`gold`/`club_gold`/`percent`/`dark_percent`/
    `status`/`role` 服务端最终没有下发，相关列（团队人数、金币、比例、状态）整行隐藏。
  - 行内布局（行高 220）：左栏头像 + 姓名 / ID / 身份；右侧 **3 列 × 3 行**——
    列 = 输赢 / 贡献 / 红利，行 = 今日 / 昨日 / 累计。标签左右对齐网格：
    列1 标签 `x=-120`、值 `x=-42`；列2 `38` / `116`；列3 `196` / `274`（值宽 70）。
    今日红利/昨日红利两行由原先隐藏的 `团队人数(值)`、`余额(积分值)` 节点改名复用，未新增节点。
  - 新接口按 `chains[]` 分块：每块用 `club_name` 标俱乐部，行内按 `is_creator` /
    `is_union_owner` 区分身份；多链时每条链末尾重复的总群主行只渲染一次（末尾“总群主（全联盟汇总）”块）。
  - 顶层零命中 `count="0"`、`chains=[]` 按“无上级代理/不在本俱乐部”展示，不当错误。
  - 贡献/红利按分 ÷100 展示；输赢正红负绿；同一 guuid 多角色不去重。
- 修改 `assets/scripts/GameDataManager.ts`
  - 新增 `IsBossAccount()`：`level>=99`，兼容旧角色「董事长/总裁」。
- 修改 `assets/scripts/UI/panelGameView.ts`
  - 牌桌头像点击：BOSS 打开 `panelBossPlayerInfo`，其它账号仍打开 `panelUserInfo`；
    原有 `提交_玩家_信息` 保持。
- 新增 `tools/build_boss_player_prefab.py`
  - 可重复生成 Prefab（行模板/贴图 uuid 从现有资源读取），只做结构与文案，不新增贴图。

## 验证

- Prefab JSON 可解析，`__id__` 无越界，父子关系一致；新节点引用 13 个贴图 uuid 全部能在
  `.meta` / `subMetas` 找到。
- 新 prefab / ts 的 uuid 在 `assets/` 内唯一；`git diff --check` 通过。
- Creator 的 Prefab 资源库在 15:34 后不再自动重导；已用源 Prefab 手动同步
  `library/imports/b4/b43f860d-….json`（含 `链标题`/`链空` 等 256 个对象），脚本 js 由 Creator 正常编译。
- 三个改动 TS 用 `ts.transpileModule` 语法检查均 0 诊断。
- 定稿后复检：`panelBossPlayerInfo.ts` **1 处 `reqHallCommand`**（仅链路），无
  `查询_俱乐部_成员` 字符串、无 `NumberList` 监听、无重复方法定义，`ts.transpileModule` 0 诊断。
- 行模板重排（2026-11-06 17:05，用户反馈「团队人数和 ID 错位」）：
  行高 204→240；左栏统一左对齐（`left=-258`）：姓名 94 / ID 60 / 身份·状态 26 / 团队人数 -8 /
  金币 -42；右栏两列四行（y=92/44/-4/-52）：左列今日/昨日/总输赢 + 比例，右列今日/昨日/总贡献 + 总红利；
  竖线移到 `x=-50`。复用了成员行遗留的隐藏节点 `余额`/`积分值`/`额度`/`额度值`/`比例`/`比例值`
  （`余额` 文案改「金币」），未新增任何节点/贴图。
  数学校验（按 prefab 尺寸+字号算矩形）：**0 重叠、0 越界、0 压竖线**。
  坑：`头像`/`玩家ID` 在顶部抬头与行模板内**重名**，按名字全局查找会改错到抬头节点，必须按行模板子树查找。
- 高屏（750x1500）离屏合成预览 `/tmp/boss-panel-tall-preview.png`：全屏铺满、桌面牌可见、
  标题美术字/抬头/页签/表头/三行链路对齐正常；激活页签深色字可读。
- 新增标题美术字 PNG 尺寸 840x214，meta 顶层/raw/trim 均为 840x214，uuid 全仓唯一；品红底抠图后无棋盘格毛刺。

## 未完成 / 待验证

- Creator 编辑器内实际打开、九宫格拉伸与长屏适配（17:07 已确认 `library/imports/b4/b43f860d-….json`
  重导成功，行高 240、含「金币」「比例」文案）。
- 行高 220 后列表一屏约 4.1 行，代理链超过 4 行要滚动（属预期）。
- 服务端文档 17:20 覆盖更新（字段统一为每行 9 个统计字段，新增今日/昨日红利；总群主行按全联盟
  当前成员 + 联盟日收益），我方此前在该文档加的 §3.2.1「可选扩展字段」已被服务端版本替换，
  以服务端文档为准。
- Creator 17:23 后未再自动扫描（prefab 源 17:23:51 新于 library），已按历史做法直接把源 prefab
  同步覆盖 `library/imports/b4/b43f860d-….json`，确认库内行高 220、含「今日红利/昨日红利」。
- 构建、网页/真机点击头像的实际触摸与 zIndex 表现。
- 真实服务端回包：`ClubMemberAgentChain` 的 `chains[]` 多链、`club_name`、零命中空数组、
  兼任多角色两行同 guuid、总群主行去重、「代理数据加载中」重试、非 BOSS 的 `无权访问`。
- BOSS 身份口径目前用客户端 `level>=99`（服务端仍以 `d_users` boss/bigboss 名单鉴权）。
  若线上 BOSS 账号没有 99 级，需要服务端下发显式标记后再改 `IsBossAccount()`。
- 其它页面复用入口（俱乐部成员列表/排行榜）本次未接入，仅提供 Prefab + `Open()`。

## 追加：行内「查看」+ 玩家信息弹窗独立 Prefab（2026-11-06 17:50）

- 行模板加「查看」按钮（复用隐藏的 `设置` 节点改名，118x34，左栏身份下方）。
  行是运行时克隆的，`UIViewBase.onLoad` 那次 `getComponentsInChildren(cc.Button)` 扫不到，
  所以在 `BindViewButton` 里手动挂 TOUCH_START/MOVE/END，滑动 >20px 不算点击。
- 新增 `assets/resources/UI/panelClubPlayerInfo.prefab`：由 `tools/extract_club_player_info.py`
  从 `panelMain.prefab` 的「俱乐部玩家设置弹窗」整棵子树提取（163 节点 / 533 对象），
  **结构、贴图 uuid、九宫格、Button、EditBox、ScrollView 全部原样**，只删了 4 个废弃节点
  （`玩家资料卡` 旧底图、行内被代码强制隐藏的 `成员删除`/`成员赠予`/`设置`）。
  根节点 `panelClubPlayerInfo`（Widget 全屏 + BlockInputEvents），下一层保留原名
  `俱乐部玩家设置弹窗`，所以 `ClubManagementView` 的 138 处 `at()` 路径一处没改。
- `ClubManagementView` 新增 `public OpenPlayerCard(item, context)`，并把
  `ClubPlayer` / `ClubContext` 改成 export，供独立面板复用同一套渲染与按钮逻辑
  （上下分/赠送/备注/盟主比例/暗扣/下级成员/额度记录 全部沿用）。
- `panelClubPlayerInfo.ts`：按 `{userId, clubId}` 查一次 `查询_俱乐部_成员`(count=1) →
  映射成 `ClubPlayer` → `OpenPlayerCard`；遮罩与 `玩家设置关闭` 关闭面板，其余按钮转发
  `ClubManagementView.HandleButton`。`context.role` 给 `owner`（平台 boss 全权，服务端另鉴权）。
- 踩坑：抽取脚本里 `b.node()` 返回 `__id__` 整数；`EditBox._N$textLabel/_N$placeholderLabel`
  指向**组件**索引，需要单独的 `comp_map` 才能 remap，否则留下越界 `__id__`。
- 未验证：Creator 里实际渲染、`下级成员` / `额度记录` 两个页签（要 `ClubManagementApi`，
  本次没注入，点了可能空/报错）。成员列表 prefab 化未做。

## 追加：面板通用化——标题/页签上移 + 代理链搜索（2026-11-06 18:25）

- 标题 `玩家数据` → `数据统计`：删掉 imagegen 美术字节点（`标题美术字`），改成 `标题文字`
  （Label 40 号 + LabelOutline 3 号描边，金色）。顺带清掉 prefab 里的孤立对象（279→276）。
- 版式自上而下：标题栏 631 → **页签 555**（Widget top 84）→ **搜索区 489**（Widget top 178）
  → 玩家抬头 397（top 218）→ 列表面板/列表 y=-120、高 910/880（top 332/347，bottom 92/107）。
  Widget 只在运行时生效，`_trs`/`_contentSize` 同步改过，编辑器里也是对的。
- 搜索区：`搜索输入`（430x60，从 panelMain 的「成员搜索输入」整节点克隆，EditBox+文字+提示，
  去掉 cc.Widget 避免被拉伸）+ `搜索查询`（120x60，克隆「管理查询成员」）。占位文字
  「输入玩家ID或昵称查询代理链」。
- 搜索逻辑（`panelBossPlayerInfo`）：纯数字直接当 ID 查链路；非数字走
  `查询_俱乐部_成员` + `search_name_id`（count=20），回包走 `NumberList`（context 前缀
  `bosssearch:` 过滤），挑昵称命中的第一条取 guuid 再查链路。昵称搜索需要俱乐部上下文，
  没有 club_id 时提示直接输 ID。
- 通用入口：`panelBossPlayerInfo.Open()` 空参进入 → `ShowGuide()` 引导「输入玩家ID或昵称」；
  `Open(userId, clubId)` 直接查。牌桌点头像仍是 `Open(guuid, club_id, name)` 自动查。
- 坑：`EditBox._N$textLabel/_N$placeholderLabel` 是**组件**索引，克隆后必须按 comp_map 重指，
  否则留越界 `__id__`（本次在 3308/3311 踩到，按子节点「文字」「提示」的 Label 组件修回）。
- Creator 18:23 后又不自动重导，已按历史做法把源 prefab 复制到 `library/imports/…`（276 对象）。
- 未验证：真机/网页实际交互（输入框输入、搜索按钮、昵称命中多条时的取第一条）。
