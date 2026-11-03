# 我的页「入盟申请」审批入口（未构建、未真机）

- 日期：2026-11-03
- 分支：`codex/club-ui`
- 目标：联盟总群主在「我的 → 当前俱乐部」联盟区域看到「入盟申请」，打开后列出全部待审俱乐部，可逐条同意/拒绝。
- 性质：接续同日「创建联盟 / 加入联盟」入口；已随 `c77b7e5` 提交并推送到 `origin/codex/club-ui`；未构建。

## 已完成

- 卡片：`联盟操作` 行新增 420×48 金色按钮 `入盟申请`；仅 `role=owner && unionKnown && hasUnion && unionIsOwner` 时显示，创建/加入按钮在有联盟后收起，卡片仍保持 320 高。
- 状态：`clubUnionStatus` 增加 `isOwner`，来源 `ClubUnionQuota.is_owner`；`ClubUnionCreate` 与创建受理按总群主处理。`ClubContext.unionIsOwner` 传给俱乐部视图。
- 弹窗：复用「俱乐部申请弹窗」并增加 `kind="union"` 模式：
  - 标题「入盟申请」、抬头「联盟号：xxxxxx」、统计「待审批 N 个俱乐部」；
  - 隐藏「返回成员」和分页，保留刷新；
  - 行沿用头像/姓名/ID/同意/拒绝模板，头像换成联盟徽记，第二行显示「俱乐部ID + 群主」；
  - 同意/拒绝先走现有确认弹窗，再发 `同意_加入_联盟` / `拒绝_加入_联盟`。
- 协议：`HallClubManagementApi` 新增 `unionApplications()`（`查询_联盟_加入申请`）与 `unionAct()`；注册 `ClubUnionApply` 推送，处理无 context、单条对象、`result`/同名 key/JSON 字符串等包裹。
- 美术：ImageGen 生成金卷轴+印章对勾图标 `assets/ImagesLuck/联盟/icon_apply.png`（128×128、透明、`.meta` 手写）；按钮图标与弹窗标题左侧「联盟徽记」、申请行徽记共用该图。
- 设计预览：`design-previews/待确认/2026-11-03-入盟申请/`（1x/2x 弹窗合成图）。
- 并行改动：同一 Prefab 里另有任务加入「当前俱乐部」标题行 `联盟信息/联盟徽记` 与俱乐部列表条目 `联盟徽记`（`union_badge.png`），本次未改其逻辑；两套节点名不冲突（卡片内路径 vs 弹窗内 `标题底/联盟徽记`）。

## 2026-11-03 补充修复（用户反馈后）

- 入盟申请按钮在已建盟账号上不显示：根因有两处——`ClubUnionQuota` 部分推送不带 `is_owner`，旧逻辑会把已确认的 `true` 覆盖成 `false`；并且 `ClubContext` 用 `!!` 把未知 `undefined` 映射成了 `false`。现在缺字段时保留旧结论、上下文保留 `undefined`，只有明确 `false` 才收起。
- 显示条件放宽为「俱乐部已入盟（`unionId`/`hasUnion`）且 `unionIsOwner !== false`」；同时用 `查询_我的_联盟` 成功作为总群主兜底（仅创建者可发），失败明确「非总群主」才落 `false`，其它失败 10 秒后重探。
- 卡片标题行：有联盟时隐藏「当前俱乐部」，联盟徽记放大到 40px，`联盟名(联盟号)` 放大到 26px 并占用左侧标题位；总群主身份牌显示「大群主」。
- 卡片高度从 320 收回到 270，显示联盟行时所有子节点整体上移 35（内容高度 620），标题仍贴卡片顶部，消除顶部大空白；入盟按钮从 420 缩到 292，运行时强制文案「入盟申请」（旧 Prefab 缓存若显示「加入联盟」也会被纠正）。
- 邀请码：卡片读取增加俱乐部信息 `invite_code` 回退；进入「我的」时代理信息缺失或邀请码为空则强制补查一次。若真实回包仍不带 `invite_code`，需要服务端确认创建者的代理信息字段。
- Creator 已重新导入 Prefab 并编译脚本（12:25–12:39），`library/imports` 与 `temp/quick-scripts` 均含 292 宽按钮、`unionIsOwner` 保留 `undefined`、强制探测、卡片 270/35 偏移、盟友按钮/列表与 `unionMembersPending` 改名。
- 游戏内实际效果仍待用户/真机确认。

## 2026-11-03 最新文档变化与「已建盟仍显示创建/加入」修复

- 最新 V2 文档（12:40，v2.1）新增：`查询_俱乐部_信息` 直接返回 `union_id` / `union_apply` / `union_quota`；`union_id` 空串=未入盟、非空=已入盟且**不会回到空**；`union_apply` 非空=审核中。入口规则：未申请→创建/加入；审核中→加入联盟置灰；已入盟→我的联盟。
- v2.1 另加联盟抽成：`设置_联盟_盟主_比例`、`查询_联盟_红利`、`查询_联盟_红利_明细`、`提取_联盟_红利`；`ClubUnionQuota` 对 `is_owner=0` 增 `union_percent`。本轮未做这些新入口。
- 问题根因：客户端仍让 `查询_联盟_额度` 的失败/竞态结果覆盖 `查询_俱乐部_信息.union_id`，已建盟俱乐部被改回未入盟，于是显示创建/加入。
- 修复：卡片与俱乐部列表都以 `info.union_id` 为权威（其次状态）；额度推送缺 union_id 时按「本次推送→俱乐部信息→上次确认」保留；`你还没有联盟` 错误不再清掉已知联盟；`club:info` 回包缺字段/给空串时保留已知 union_id；创建联盟立即写回 `clubDetails.union_id`。
- 新 `union_apply`：申请成功后本地写入并由卡片显示「审核中」的置灰加入按钮；`club:info` 未带该字段时保留本地值。
- 联盟名称：`ClubMyUnion` 推送即使缺 `union_id`，也用请求 context/待查询俱乐部反推绑定，避免整条名称推送被丢弃；名称写入内存并持久化到 localStorage（`unionName:<unionId>`），重启后不再退回联盟号。
- 卡片/弹窗抬头显示联盟名时不再拼 `(联盟号)`；只有名称完全未知时才回退显示联盟号。
- `ownerConfirmed`：创建成功或「查询_我的_联盟」成功确认的 owner 是账号级事实，单次额度推送 `is_owner=0` 或名称查询失败不再把 owner 身份清掉。
- Creator 12:54 已重新编译 `ClubManagementView.js` / `panelMain.js`。
- 若某俱乐部仍不显示入盟申请/盟友管理，说明服务端对该俱乐部返回 `is_owner=0`（盟主俱乐部）；文档入口规则为「我的联盟」，当前只给总群主显示管理入口，需切回创建联盟的那家俱乐部或等服务端补盟主入口。

## 2026-11-03 补充：盟友管理

- 联盟行新增 `盟友管理` 按钮，与 `入盟申请` 并排（各 292×48），仅总群主显示。
- 点击复用俱乐部申请弹窗，`kind="allies"`：标题「盟友管理」、抬头联盟名(号)、统计「共 N 个俱乐部」；行显示俱乐部名、俱乐部 ID、群主、联盟额度（`union_quota` 分→元），隐藏同意/拒绝；总群主自己那家标「（总群主）」，头像绑定群主头像。
- 协议：`查询_我的_联盟` → `ClubMyUnion.members`，适配器新增 `unionMembers()` 与 `OnUnionMembers` 解析（兼容 `ClubMyUnion`/`result`/JSON 字符串/平铺数组/单条对象）。
- 首次运行报 `this.api.unionMembers is not a function`：适配器待查询字段与公开方法同名 `unionMembers`，构造器把实例方法覆盖成了 `null`；已把待查询字段改为 `unionMembersPending`，公开方法保持不变。
- 行模板新增隐藏节点 `盟友额度`；Prefab 已加入 `盟友管理` 按钮与额度节点，Creator 12:33 已导入/编译（额度金色为 12:34 小改动，需再次导入）。
- 2026-11-03 追加：盟友弹窗面板加 **`cc.Widget`（上下各 60）** 按屏幕/父弹窗高度撑开，列表 view 也加 `cc.Widget`（上下 0）；面板高 = 可用高 - 120，列表高 = 面板高 - 200（1334 设计高约 5 行，短屏自动收缩）。顶部标题/关闭/联盟名按面板高定位，统计在盟友模式隐藏，刷新按钮固定在面板底部；关闭后其它模式禁用面板 Widget 并恢复 940/594。
- 每个盟友行把原同意/拒绝按钮改为「减少额度（蓝）/增加额度（金）」，额度行上移到 -12、20px；点击复用玩家设置输入弹窗输入元，发送 **`授信_联盟_额度`**（正数划拨、负数收回），成功后重查 `查询_我的_联盟` 刷新额度。
- 适配器新增 `unionQuotaAdjust(target,quotaFen)`（`kind="unionQuota"`）；输入校验大于 0、最多两位小数，元×100 转分。
- 额度口径（按 V2 文档）：总群主 `查询_联盟_额度` 的 `is_owner=1` 看的是**联盟池**；加盟俱乐部老板 `is_owner=0` 看的是**本俱乐部额度**。展示位置按用户 2026-11-03 反馈：发现页 Title/俱乐部列表行「额度」位统一显示**本俱乐部额度**；联盟池只在总群主自己的俱乐部列表行（俱乐部名字下面）和「我的」卡片俱乐部名字行显示；盟友弹窗抬头显示联盟池（仅总群主可打开），行内显示各俱乐部 `union_quota`。
- 卡片顶部（2026-11-03 最新）：去掉「当前俱乐部」标题；俱乐部名/邀请码整体上移并放大（名称 28/29、邀请码 22/24），身份牌和俱乐部徽记上移；俱乐部额度放在邀请码行右侧（21px）。下方联盟区只保留联盟徽记/联盟名（ID）/联盟池，联盟名字号 24，信息与按钮间距 19，卡片 320/内容 670。
- 卡片分区（2026-11-03 最新）：上方只放俱乐部信息（「当前俱乐部」/俱乐部名/邀请码/身份）；联盟徽记 + 联盟名（联盟号）+ 本俱乐部额度 + 总群主联盟池整体移到卡片**下方联盟区**，与入盟申请/盟友管理同一区。卡片 320 高、内容 670、子节点上移 60；本俱乐部额度移到上方邀请码行，下方联盟区只显示联盟徽记/联盟名（联盟号）/联盟池（联盟名 ID 字体 24），联盟信息与入盟/盟友按钮之间留 19px 间距；未入盟但有创建/加入入口时底部显示「尚未加入联盟」；非老板不显示额度。
- 注意：本机 Creator 自动导入/编译在 14:01/14:05 后未再刷新（源码 14:11 已更新，library/quick-scripts 仍是旧版），需要在 Creator 手动重新编译/重启预览或重新构建后生效。
- 玩家设置按钮权限（2026-11-03）：俱乐部创建者打开其他成员时同时显示「赠送」「上下分」；代理/管理员只显示「赠送」，不显示上下分。上下分不再依赖 `查询_俱乐部_额度`/myQuota（V2 代理无独立额度），`canUpDown = context.role === "owner"`；自己那行和老板行仍不显示上下分。
- 盟主行权限（2026-11-03 追加）：大群主在成员列表点盟主虚拟行（`role=盟主`）打开玩家设置时，收起「开通代理」开关行（`代理`/`代理底`/`代理开关文字`/`玩家设置代理开关`）和「赠送」；上下分保留（用户确认）。切换成员/下级成员页签后再次收起，赠送/代理开关回调也按 `isUnionLeaderPlayer()` 拦截。判定沿用身份牌口径 `memberIdentity === "盟主"`，自己那行排除。
- 盟主「下级成员」不下发请求（2026-11-03 追加）：根因是 `loadDownline()` 用 `isAgentPlayer()` 做前置门槛，盟主虚拟行 `is_agent=0` 被当成普通成员直接清空返回。现改为盟主也放行，并用 `item.clubId`（盟主自己的俱乐部）+ `agent_id=盟主ID` 发 `查询_俱乐部_成员`。
- 盟主俱乐部定位修正（2026-11-03 追加）：NumberList 每行（含盟主虚拟行）现在都带自己的 `club_id`，`loadDownline()` 统一用目标玩家的 `club_id` + `agent_id` 查询，不再用大群主当前俱乐部。`resolvePlayerClubId()` 优先取行内 `club_id`，缺失时查 `unionMemberClubs`（`查询_我的_联盟` 的 owner_guuid→club_id 缓存，盟友列表加载或推送时写入）；盟主仍取不到则不发请求并提示「未获取到盟主所在俱乐部」，代理/成员缺失才回退当前俱乐部。**风险**：协议文档规定 `agent_id` 只认调用者子树内代理，总群主跨俱乐部查询能否返回数据需真实回包确认。
- 盟主比例行（2026-11-03 追加）：盟主玩家设置隐藏「代理比例」整行和「开通代理」整行，在其下方（原开通代理位置 y=-120）新增独立「盟主比例」行：`盟主比例底`/`盟主比例`/`盟主比例值`/`玩家设置调整盟主比例`，默认隐藏、仅盟主成员页签显示；数值取行内 `percent`（`union_percent`）。点「调整」复用玩家设置输入弹窗（`inputMode="unionPercent"`，0-100 整数），确认后走 `ClubManagementApi.act(clubId,"setUnionPercent")` → `设置_联盟_盟主_比例`（`club_id`=盟主俱乐部、`percent`=输入值），仅总群主可调用；成功后本地刷新数值并重拉当前页。
- Prefab 行样式克隆自「比例」行：底为同一九宫格 `cf841cf4…`，按钮样式 `512636df…`，按钮子节点「文字=调整」；4 个节点默认 `_active=false`，新对象追加在数组末尾，未改动既有 `__id__`。**注意**：`panelMain.prefab` 在本轮前已被 Creator 重存（盟主行位置/钻石池节点顺序变化），手工追加节点后若 Creator 再次保存可能以编辑器内存版本覆盖，需在 Creator 中确认新行存在。
- 角色名（2026-11-03 用户确认）：联盟创建者=「大群主」；已入盟的俱乐部创建者=「盟主」；未入盟的俱乐部创建者=「老板」；所有代理统一「代理」。应用于「我的」当前俱乐部身份牌、俱乐部列表行、成员列表身份、玩家设置身份；`is_leader` 不再显示为盟主（仅保留其聊天权限含义）。盟友列表总群主那家标「（大群主）」。
- 额度展示位：发现页 Title「额度」/俱乐部列表行「额度」/我的卡片联盟标题行统一走 `UnionQuotaDisplay` 显示**本俱乐部额度**；发现页 Title 在总群主时**下面再加一行「联盟池」**，俱乐部列表行在总群主自己那家俱乐部的**名字下面**显示联盟池；盟友弹窗抬头显示联盟池（仅总群主）。非创建者隐藏。旧的 `查询_俱乐部_额度`/`clubQuotaInfo` 不再驱动这些展示位（旧方法保留未删）。
- 登录即显示：`RefreshDiscoveryClubFunds(true)` 发现 `clubDetails` 缺 `union_id/union_quota` 时主动 `查询_俱乐部_信息`（`RequestClubInfo`，5 秒节流），并继续 `查询_联盟_额度`；`club:info`/`ClubUnionQuota`/`ClubMyUnion` 回包都会刷新发现页。不再需要先进俱乐部页手动刷新。
- 总群主自己那家俱乐部额度初始为 0，需要用「增加额度」从联盟池划拨；各加盟俱乐部老板默认有本俱乐部额度账户，由总群主通过 `授信_联盟_额度` 分配。
- 设计预览：`design-previews/待确认/2026-11-03-盟友管理/05-联盟池与俱乐部额度-1x.jpg`；Creator 13:40 已重新编译 View/PanelMain/API（含 Widget 自适应、联盟池/俱乐部额度、额度调整）。

## 验证

- `node --experimental-strip-types --check` 通过 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.ts`。
- Prefab JSON 可解析；新按钮/徽记父子关系、组件 `node` 反向引用、`cc.PrefabInfo.fileId` 完整；全仓静态检查未新增悬空 SpriteFrame UUID。
- 新图 UUID 全仓唯一，PNG 128×128 RGBA，透明角；缩放后品红/深灰底自检无白边。
- `git diff --check` 通过。
- 11:46 聚焦 Creator 2.4.13 后已重新导入：`library/imports/d0/d0921080…` 含「入盟申请」「联盟徽记」，`library/imports/76/76ca5787…` 为 `icon_apply` SpriteFrame；`temp/quick-scripts` 已编译三个脚本并含联盟审批逻辑。

## 2026-11-03 成员列表无结果修复（V2 盟主虚拟行）

- 抓包：`查询_俱乐部_成员` 返回 `NumberList` 2 行、`count:"1"`；首行是其它俱乐部的盟主（`role=盟主`、`is_leader=1`、`club_id=875111`），第二行是本俱乐部老板。
- 盟主行视觉/比例：成员行模板新增「盟主底色」半透明绿色覆盖层（690×188、opacity 120、色 80/220/120），仅显示身份=盟主时启用；比例列对 盟主/大群主/代理 显示，盟主虚拟行 `is_agent=0` 也显示 `percent`（V2 的 union_percent，默认 100%）；额度仍只给大群主/盟主。
- 成员行额度：已解析 `NumberList.quota`（分）为 `clubQuotaFen`；只对**大盟主（俱乐部创建者）**和**盟主虚拟行（role=盟主 / is_leader=1 且 is_agent=0）**显示「额度/额度值」，代理和普通玩家隐藏。创建者直属代理 is_leader=1 但 is_agent=1，仍不显示。
- 文档 §1.5：总群主查自己第一页时，列表最前面多出 N 行盟主虚拟行，**不占 per_items，count 仍是本俱乐部成员数**，只在第一页出现。
- 旧适配器两个丢弃点：①`items.length > total` 被当格式错误；②用首行 `club_id`（盟主俱乐部）和请求 `club_id` 比对，带 context 也把整包过滤掉。
- 修复：成员列表允许 `items.length > total`；有 context 时不再用首行 club_id 过滤；统计显示「直属 N 人 · 盟主 M」。Creator 16:19 已编译 API/View。
- 待验证：翻页（第二页不应再出现盟主行）、无盟主行时 count/items 一致、真实成员列表交互。

## 2026-11-03 删除停用的「查询_俱乐部_额度」

- V2 已停用 `查询_俱乐部_额度`/`GetClubQuota`。成员列表额度改用 `NumberList.quota`（分），不再逐个代理行查询；玩家设置里的旧代理额度行（开通/增加/减少）不再激活；聊天上下分不再查个人额度——老板/盟主显示上下分，代理只显示赠送。
- 已删除：`ClubManagementApi.getQuota`/`GetClubQuota`/`OnQuota`；`ClubManagementView` 的 `requestQuotaForPlayer`/`applyQuota`/`refreshPlayerQuotaUi`/`ClubQuota` 及旧额度行激活；`panelMain` 的 `RequestClubQuota`/`OnClubQuota`/`clubQuotaInfo`/`CanShowClubQuota`/`FormatClubQuota`/`club:quota:` 分支；`panelMessageChat` 的 `RequestClubGoldQuota`/`OnClubGoldQuota`/`OnClubGoldQuotaCommand` 与 GetClubQuota 注册。
- 全仓 `assets/scripts` 已无 `查询_俱乐部_额度` / `GetClubQuota` 字符串；Creator 16:41 已重新编译四个脚本。
- 仍保留但未调用：`ClubManagementApi.act` 的 `grantQuota/increaseQuota/decreaseQuota`（`授信_俱乐部_额度`）和隐藏的旧额度输入分支；如需彻底删除可下一轮处理。

## 2026-11-03 推送驱动的实时刷新（本轮）

- 文档 §1.3/§4/§5/§8：联盟列表类数据都走推送（`ClubUnionApply` / `ClubMyUnion` / `ClubUnionQuota`）。此前客户端只在有在途查询时消费推送，推送迟到或无请求时直接丢弃，已打开的审批/盟友弹窗不会更新。
- `ClubManagementApi`：`OnUnionApply` / `OnUnionMembers` 不再要求存在在途请求；有请求时先完成 Promise，没有时通过新增的可选回调把解析好的整页数据交给界面。只接受明确的列表/成员报文，名称类 `ClubMyUnion`（只带 `union_name`/`union_quota`）不会把盟友列表清空；盟友推送按 `context` 与待查询 pairing，避免不同界面的同名推送互相结束请求。
- `ClubManagementView`：新增 `OnUnionApplicationsPushed` / `OnUnionMembersPushed` / `OnUnionQuotaPushed`；仅在对应弹窗打开且非加载中时原地替换列表，推送刷新不再强制滚回顶部；额度推送到达时，盟友管理重拉「我的联盟」，成员列表重拉当前页，刷新各俱乐部额度行。
- `panelMain`：构造 `HallClubManagementApi` 时接入两条推送回调；`OnClubUnionQuota` 额外通知盟友弹窗刷新。
- 验证：`ClubManagementApi.ts`、`ClubManagementView.ts`、`panelMain.ts` 通过 `node --experimental-strip-types --check`，`git diff --check` 通过。Creator 重新编译、真实推送与双账号联调待验证。

## 2026-11-03 发现页顶部盟主额度不显示

- 现象：盟主直接切到「发现」时，房间列表上方金币下的「额度」不显示；必须先点「俱乐部」再回来才出现。额度本身已在「我的 → 当前俱乐部」卡片显示，说明 `查询_俱乐部_信息` 的 `union_quota` 已拿到。
- 根因：`UnionQuotaDisplay` 先要求 `clubUnionStatus` 已 known+hasUnion（来自 `查询_联盟_额度`）才读取 `clubDetails.union_quota`；而 `OnClubUnionQuota` 收到推送后只刷新了俱乐部列表和「我的」卡片，没有刷新发现页顶部，所以额度要等下一次切页才出现。
- 修复：`UnionQuotaDisplay` 以 `查询_俱乐部_信息.union_id + union_quota` 为权威，`status` 只作回退；`OnClubUnionQuota` 末尾补 `RefreshDiscoveryClubFunds(false)`，额度推送到达即更新顶部「额度」/「联盟池」。
- 验证：`panelMain.ts` 语法与 `git diff --check` 通过；Creator 编译与真机待验证。

## 未验证 / 待办

- 文档入口表里「盟主（`union_id` 非空、`is_owner=0`）显示我的联盟」尚未做；客户端目前只给总群主显示入盟申请/盟友管理。
- v2.1 的 `设置_联盟_盟主_比例`、`查询_联盟_红利`、`查询_联盟_红利_明细`、`提取_联盟_红利` 与 `union_percent` 展示尚未接入。

- 真实服务端是否会在无查询时主动推 `ClubUnionApply` / `ClubUnionQuota`、推送是否携带 `context`，以及双账号审批/授信后的实时刷新手感。
- Creator 预览中的实际版式与点击交互（未登录游戏、无总群主测试数据）。
- 真实服务端 `ClubUnionApply` 包裹层级、查询 0x200/超时行为、`is_owner` 字段是否稳定下发。
- 同意/拒绝真实回包、审批后列表刷新、申请方入盟与联盟成员变化。
- 构建、真机、双账号建盟/申请/审批全流程。

## 关键文件

- `assets/scripts/UI/ClubManagementView.ts`
- `assets/scripts/UI/ClubManagementApi.ts`
- `assets/scripts/UI/panelMain.ts`
- `assets/resources/UI/panelMain.prefab`
- `assets/ImagesLuck/联盟/icon_apply.png` + `.meta`
- `design-previews/待确认/2026-11-03-入盟申请/`

## 入盟申请红点/提示音与申请中保留入口（2026-11-03 追加）

- `ClubUnionApply` 推送原来只刷新已打开的审批列表；现在先走 `SetUnionPendingCount()` 计入待审数：数量增加时播 `eff/申请提示`，`Refresh()` 点亮「联盟操作/入盟申请/红点」并合并到「Down/我的/红点」；数量不变/减少不响。
- `panelMain.prefab` 的「入盟申请」按钮下新增 `红点` 节点（cc.Label「●」28、红色、30×30、默认隐藏、x=142,y=20），由 `ClubManagementView` 控制显隐。
- 登录/切换俱乐部后，总群主身份确认时 `syncUnionBadge()` 补查一次 `查询_联盟_加入申请`（静默、最多重试一次），覆盖离线期间到达的申请；主动打开审批列表只同步数量，不播音。
- 取消「审核中只显示加入联盟」的旧口径：`canCreateJoin` 不再看 `union_apply`，审核通过前「创建联盟 / 加入联盟」两个按钮始终并排可点，可继续创建或申请其它联盟；`union_apply` 仅保留为状态数据。
- 验证：TS 语法、Prefab JSON/引用检查通过。未验证：真实 `ClubUnionApply` 推送的红点/声音、登录补查回包、Creator 导入/构建/真机。
