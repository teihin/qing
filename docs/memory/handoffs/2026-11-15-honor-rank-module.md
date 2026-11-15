# 排行榜独立模块（活动列表 + 创建 + 实时排名）

日期：2026-11-15
目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`
状态：**已部署 8891（2026-11-15 18:26），登录态实操待验收**

## 目标

把「按联盟 / 独立俱乐部开排行榜」从俱乐部/联盟行内弹窗提升为独立模块：

1. 一个列表放历史上**所有**排行榜活动；
2. 「创建活动」= 原来的配置项（总开关 + 三榜开关 + 共用起止时间 + 各档位名次奖励）+ 多一步选联盟/独立俱乐部；
3. 点开任意活动能看**实时排名**，内容对齐游戏客户端排行榜（三榜 + 手数 5 档位、名次、数值、奖励）。

## 关键设计

- 游戏服只有「每个 scope 一份当前配置」（`club_honor_rank_reward` 7 行），没有活动概念，改配置/关榜后旧时间窗就查不到了。所以**后台自建留档表** `mgr_honor_rank_activity`，每次创建写一条；游戏服照旧由后台展开成 7 行下发（复用 `club_honor_rank.go`）。
- **排名不走游戏服**：`查询_俱乐部_活动_*` 是客户端命令，靠在线玩家 entity 收推送；实测后台 `curl /hall/command` 直调返回 `ret_code=1280`（无玩家上下文）。改为按服务端文档 v2.6 §4 口径**直读游戏库**计算，并且用「活动自己的时间窗」，所以历史活动也能回看最终排名。
- 旧入口（俱乐部管理 / 联盟管理行内「排行榜」）保留，保存时也留档：**开启=新增一条活动，关闭=把该范围最新一条标成已结束**，列表因此能覆盖所有入口产生的活动。
- 活动可改：弹窗里直接改开关/时间/三榜/奖励并保存，走 `PUT`——**同一条留档就地更新**（不新增一场），并重新整行下发游戏服 7 行。
  - 每次下发都带 `reward_list + activity_on + 四个时间`，不做"只改金额"的部分更新（服务端 `异步_设置_俱乐部_活动_奖励` 是整行覆盖，漏传开关/时间会把活动关掉）。
  - 已被该范围更新的活动取代时（`superseded`）只读，拒绝修改，否则会把新活动的配置覆盖回去。

## 后端

新增 `XuanManager/server/internal/api/honor_rank_activity.go`：

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/game/honor-rank/activities` | `game.honor_rank.view` | 分页列表，支持 scopeType / phase / keyword |
| `GET /api/game/honor-rank/activities/{id}` | 同上 | 活动 + 游戏服当前配置 + 是否仍同步 |
| `POST /api/game/honor-rank/activities` | `game.honor_rank.manage` | 创建：下发 7 行 + 留档 + 审计 |
| `PUT /api/game/honor-rank/activities/{id}` | `game.honor_rank.manage` | 修改已有活动：范围固定、其余覆盖，重新下发 7 行并更新同一条留档（不新增） |
| `GET /api/game/honor-rank/activities/{id}/ranking` | `game.honor_rank.view` | 实时排名（直读游戏库） |
| `POST /api/game/honor-rank/activities/{id}/close` | `game.honor_rank.manage` | 结束活动（7 行置 0，保留时间与奖励） |
| `GET /api/game/honor-rank/scopes` | `game.honor_rank.view` | 创建弹窗选联盟/独立俱乐部（不依赖俱乐部/联盟菜单权限） |

排名口径（`queryHonorRanking`）：

- 手数：`usr_activity_info`（`activity_type='手数'`，`remark2`=档位）按 `user_guuid` 求和，单位局；成员用 `tbl_Account.sm_club_join/join2` 的 `FIND_IN_SET` 判定，排除 `sm_level>=99`。
- 赢分：`club_member_score_info.score` 按 `club_guuid IN (scope 俱乐部)` 求和，只取正数，单位积分。
- 红利：`usr_income_info` 按 `proxy_guuid IN ('club-<id>')` 过滤、`remark1` 聚合 `tax_number - bonus_tax_number`，排除 `remark5='clubtotal'`，分→元。
- 未结束的活动按「现在」截断时间窗，与客户端一致；单次最多 2000 行并在响应里标 `truncated`。

迁移 `068_honor_rank_activity.sql`：建 `mgr_honor_rank_activity`、新增模块 `game.honor_rank`（parent 20，route `/game/honor-rank`，icon `rank`，sort 24）、权限 view/manage，并按 `game.club_honor_rank.*` / `game.club.view` / `game.club.dark_setting` 给已有角色授权 + role 1 兜底。

`club_honor_rank.go` 仅在写完 7 行后加一行 `recordHonorRankActivityFromScopeEdit`，其它逻辑未动。

## 客户端：榜单数字字体补减号（`assets/V7/leaderboard_v8_digits.*`）

- 现象：赢分榜第 2 名显示 `150`，实际是 `-150`，减号完全不显示。
- 根因：位图字体 `leaderboard_v8_digits.fnt` 里 `-`(45)、`—`(8212)、`−`(8722) 三个字形**声明了矩形但图集里像素全透明**
  （`35x3` 的空块，alpha 全 0），所以渲染时什么都不画。`+` 有像素，所以 `+91` 正常。
- 修法：在图集 x=589 / 630 / 671 三处补 `34x8` 白色实心横线（笔画粗细对齐数字的 8px 竖笔），
  同时把 fnt 三个字形的 `height 3→8`、`yoffset 30→29`，让减号垂直中心与数字一致（29+4≈33 ≈ 数字 3+30.5）。
- 该字体被名次、赢分、奖励、我的指标等多处复用，改一次全部受益。
- `.meta` 的 `trimType` 是 `none`，不会因补像素重算 trim；改完 `touch` + 激活 Creator，`library` 已重新导入
  （png 18:57、fnt json 18:57，`fontDefDictionary` 里 45/8212/8722 已是 34x8/yOffset 29）。
- **口径差异（未改）**：后台排名接口按接口文档 §4.2 只列 `SUM(score) > 0` 的成员，而客户端会显示负分成员，
  所以同一个活动两边人数可能不同。要对齐需明确口径后改后台 SQL。

## 客户端：只显示开着的榜（`panelPaihangbang.ts`）

- **已接入服务端 v2.10 的 `查询_俱乐部_活动_状态`**（推送 `ClubActivityStatus`，回 7 行
  `rank_type/dipi/status/activity_on/起止时间`）：
  `status` 0 未开启 / 1 未开始 / 2 进行中 / 3 已结束 —— **只有 0 隐藏 tab**，已结束仍可看最终榜。
  手数 5 档按文档聚合：任一档非 0 就显示手数榜（只开 2皮 时不会把整榜藏掉）。
- 兜底：命令不可用（未部署/`GC_FAILED`）或 1.2 秒没回包 → 回落到下面的逐榜探测，功能不至于全丢。
  探测仍保留：手数 5 档 + 赢分 + 红利各发一次 `count=1`，只把明确回 `活动没有开启` 的榜当关闭。
- 当前选中的榜被隐藏会自动切到第一个可见榜；三个都关时显示"本次活动还没有开启任何榜单"。
- 大厅模式（`mode=hall` 回落）恢复三个 tab 全显示。
- 未做：`选择手数` 的 5 个档位按钮没跟着隐藏。

## 客户端：进面板「掉一堆重复接口」的修复（`panelPaihangbang.ts`）

- 现象：切到排行榜面板，控制台刷出大量重复的 `查询_俱乐部_活动_玩家手数` 和 `活动没有开启`。
- 链式原因：
  1. `查询_俱乐部_活动_状态` 在当前环境返回失败（`onHallCommand(3811 …)`，命令大概率还没部署到这台），
     客户端按设计回落逐榜探测；
  2. **服务端回包会把 `context` 覆盖成 `header` 名**（日志里 `context` 变成 `查询_俱乐部_活动_玩家手数`），
     所以按 `probe_` 前缀识别探测回包全部失效；
  3. 探测回包于是走进正常失败分支，`param.indexOf(headerOf(...))` 命中了**在飞的正常请求**，
     把它的 `pending` 删掉再重发 → 循环，越拖越多。
- 修法：
  - 探测/状态接口在飞期间**不发正常列表请求**（`queryList` 直接 return），两类回包不再串台；
  - 探测回包按 `header` 认（兼容 context 被覆盖），只在该榜探测在飞时吞掉；
  - `send()` 同键同页在飞不重发；`receive` / `onHallCommand` 的重发都加 `!pending[key]`；
  - 兜底探测从 7 个请求降到 **2 个**（只探赢分/红利）；手数 5 档共用同一个 header、回包不带档位，
    无法区分，改成**不隐藏**（宁可多显示空榜）；
  - 探测期间用户手动点 tab 会清空列表但请求被挡下，`applyBoardVisibility` 末尾补一次加载。
- 前置条件：状态接口部署后客户端只发 1 个请求，上述兜底基本不触发。

### 补记：`requestStatus is not a function`

- 19:16 客户端报 `TypeError: this.requestStatus is not a function at panelPaihangbang.onEnable`。
- 原因：上一轮用脚本按区间替换 `beginProbe` 时，区间终点落在「状态推送」注释上，
  把夹在中间的 `requestStatus()` 定义整段删掉了，只剩两处调用（`transpileModule` 只查语法，查不出缺方法）。
- 已补回 `requestStatus()`，并用项目 `tsc --noEmit` 复核该文件：另查出两处 `recordStatus(..., boolean)`
  与 `string` 参数不符，一并修正。现在 `panelPaihangbang.ts` / `LeaderboardScrollView.ts` 在 tsc 下无错误
  （项目里既有的 `Cannot find name 'require'` 除外）。
- **教训**：改这类文件不要用「按 index 区间替换」，容易把区间内的方法一起切掉；改完必须跑 `tsc --noEmit` 看类型，
  只跑 `transpileModule` 不够。

## 客户端：三个榜的无限滚动核对（`LeaderboardScrollView.ts`）

- 三个榜（手数/赢分/红利）共用同一个 `LeaderboardScrollView`，`content` 是垂直 Layout + `resize=CONTAINER`，
  高度随行数增长，具备无限滚动条件。
- **修了一个真 bug**：`checkNearEnd` 里算「距底还剩多少」写反了 ——
  `getMaxScrollOffset().y - getScrollOffset().y`（Cocos 的 offset 是负值：顶部 0、底部等于 maxOffset），
  结果在顶部就得到负数、恒判定"已到底"，**一进列表就把所有页连续拉完**（人多的榜会连发 N 个请求）。
  改成 `getScrollOffset().y - getMaxScrollOffset().y`，只有真正接近底部（≤360px 或 0.75 屏）才加载下一页。
- 终止条件按服务端 `count`（榜内总人数，受 `max_item_count` 截断）：`nextPage * 30 < count`，
  到最后一页自动停；`seen` 去重防止排名变化造成的重复行。
- 失败处理：首页失败显示"加载失败，请滑动重试"，翻页中途失败静默停住（`failed` 挡住自动重试，滑动可重试）。
- **行数少时不能滚属正常**：内容不足一屏时 `maxOffset=0`，没有可滚空间（`elastic` 默认开着，只能拖出回弹）。
- 未验证：真实 >30 人的榜（本地无测试环境），上线后建议用一个 30 人以上的榜滚到底确认。

## 客户端：赢分负数被显示成「未上榜」（`panelPaihangbang.ts`）

- 现象：赢分榜里自己 `-150`，界面显示"我的排名 未上榜"。
- 根因：`showSelf` 用 `Number(activity_num) > 0` 判断有没有排名，**负数被当成没上榜**；
  文档 §3.5 明确「0 分/负分有榜时正常显示名次」，只看 `user_no` 即可。
- 修法：改为 `/^\d+$/.test(user_no) && > 0`；`无排位`/空 → 未上榜。
- 另加防御：`GameDataManager.IsSelfPlayerId` 校验 self 包的 `user_guuid`，对不上就用
  `LeaderboardScrollView.findRow` 在已加载榜单里找自己那行兜底（服务端该包实测回过榜单第一名）。


- **现状**：客户端没有"查活动开关"的接口。只有 `查询_俱乐部_活动_玩家手数/玩家输赢/代理红利` 三条榜单命令，
  未开启时服务端回 `活动没有开启`；后台那条 `异步_查询_俱乐部_活动_奖励` 客户端调不了（后台权限 + 无玩家上下文）。
- 做法：面板 `onEnable` 先探测再进榜 —— 手数 5 个档位 + 赢分 + 红利各发一次 `count=1` 的最小查询
  （`context=probe_<rankType>[_<档位>]`），按回包把明确返回 `活动没有开启` 的榜隐藏。
- 手数榜**按档位合并判断**：后台是按 (榜, 档位) 分别开关的，只开了 `2皮` 时若只探 `1皮` 会把整个手数榜误藏。
- 容错：`活动未开始` / `无权查看` / 网络失败一律按"开着"处理，只隐藏明确关掉的；1 秒没回包也按全开继续
  （断线时不能一直空白）。当前选中的榜被隐藏会切到第一个开着的榜；三个都关时显示"本次活动还没有开启任何榜单"。
- 大厅模式（`mode=hall`，含命令不可用回落）恢复三个 tab 全显示，逻辑不变。
- 未做：`选择手数` 的 5 个档位按钮没跟着隐藏（探测已拿到数据，可后续按同样规则隐藏）。
- 如需零探测，建议服务端加一条客户端命令（如 `查询_俱乐部_活动_状态`）一次返回三榜 + 五档位的 `activity_on`，
  客户端改成一次请求即可；该命令不在本仓库，需服务端配合。

## 前端

- 新增 `web/src/pages/HonorRankPage.tsx`：活动列表（范围/状态筛选、关键字、分页），行内「查看排名」。
- 新增 `web/src/components/HonorRankActivityModal.tsx`：新建（选范围 + 原配置表单）与查看（只读配置 + 实时排名页签，含手数档位与分页、结束活动按钮）。
- `App.tsx` 加 `/game/honor-rank` 路由，`Layout.tsx` 加 `rank: "榜"` 图标，`types.ts` 加活动/排名类型，`styles.css` 追加 `.honor-rank-*`。

## 验证

- `go build ./...`、`go vet ./...`、`go test ./internal/api/ -count=1` 通过（新增 5 个纯函数单测：阶段推导、标题回退、名次奖励取值、成员条件、游戏服同步判定）。
- `tsc -b`、`eslint src`、`vite build` 通过。
- 三榜 SQL 在正式库只读跑通（用俱乐部 885399 的 11-01~11-15 数据验证，手数/赢分/红利均返回合理行）。
- 前端用 mock 接口 + 本地 `dist` 在 Chrome 里渲染过一遍：列表、创建弹窗（选联盟 + 完整表单）、详情（信息卡 + 只读配置）、实时排名（榜页签 + 手数档位 + 表格 + 分页）均正常，无 console 报错；顺手修了通用 `.balance-action-tabs`（两列 grid）在筛选/档位上换行的问题。
- 未做：登录态页面验收、真实创建活动、部署。

## 奖励金额校验（2026-11-15 20:24 已部署 8891）

- 运营反馈：名次奖励是逗号串，容易打错；空着也能建活动。
- 前端 `HonorRankActivityModal`：
  - 逐项即时校验（中文逗号/顿号/分号、空项、非整数、小数、≤0、>1,000,000），错误显示在输入框下方红字；
  - **必填按榜判断**：`活动开启 + 该榜开关打开` 时整榜至少要有一档金额，否则底部红字列出缺的榜名并禁用提交；
    手数榜允许只给部分档位配奖（运营可能只开 1皮）。
  - `Field` 组件新增 `error` 属性（有值时红字替代 hint）。
- 后端 `normalizeRewardList` 同步收紧：中文标点、小数、`<=0` 都直接报错；
  `buildHonorRankWrites` 对开着的榜做整榜必填校验（关榜不要求）。旧入口（俱乐部/联盟行内）同样生效。
- 测试：`TestNormalizeRewardListRejectsBadInput`、`TestBuildHonorRankWritesRequiresRewards`（只配一档允许 / 整榜为空拒绝）。
- 部署：二进制 `b6094314…`、前端 `index-DwMnfzsS.js` + `index-jrUFkdYE.css`，health ok、未登录 401。回滚点
  `bin/xuanmanager.previous-honorrank-validate-20261115-2030`、`web.previous-honorrank-validate-20261115-2030`。

## 排名：含负分 + 靓号显示（2026-11-15 21:07 已部署 8891）

- 赢分榜去掉 `HAVING SUM(score) > 0`：负分 / 0 分玩家也进榜（对齐文档 v2.9「显示所有有结算玩家」）。
  排序仍是 `SUM(score) DESC`，负分自然排后面。
- 三条 SQL 都带上 `acc.sm_custom_id`（**字段名是 sm_custom_id，不是 custom_id**），
  界面按 `496702（333444）` 显示；靓号等于 ID 时不重复展示。
- `GROUP BY` 同步补了 `acc.sm_custom_id`，否则 ONLY_FULL_GROUP_BY 会报错。
- `.honor-rank-player small` 加 `white-space: nowrap`，带靓号的长 ID 不折行。
- 真库验证：三榜 SQL 均跑通，赢分榜已出现 `a3 / -150`，靓号列有值（496702→333444）。
- 部署：二进制 `4d866bbe…`、前端 `index-C1nOp7Xj.js` + `index-MXHtzGPg.css`；回滚点
  `bin/xuanmanager.previous-honorrank-rank-20261115-2112`、`web.previous-honorrank-rank-20261115-2112`。

## 遗留 / 下一步

1. 登录态点一遍：列表 → 创建（选联盟）→ 详情里改配置并保存 → 查看排名 → 结束活动；旧入口（俱乐部/联盟行内）保存一次，确认也进活动列表。
2. 排名口径是按服务端文档复刻的，建议与游戏客户端同一活动对照一次数字；若偏差，先查 `club_member_score_info` 是当日累计还是逐局累加、以及红利 `remark1` 归属。
3. 权限只自动继承给了「超级管理员」「杀杀杀」两个角色（目前也只有它们有 `game.club.view`）；后续新建运营角色要单独勾 `game.honor_rank.view/manage`。
4. 旧入口（俱乐部/联盟行内弹窗）未移除，两处入口并存；若确定只保留新模块，再单独提「移除旧入口」。

## 部署记录（2026-11-15 18:26 CST，8891 已切换）

- 二进制 sha256 `9366de94528546509014fa15826def722ecf437e2a87a0eb8c4ca10ff3c1b111`，`/proc/32544/exe` 同哈希；进程 18:26:45 启动。
- 前端 `index-DXcZOhkg.js` + `index-D8neILzi.css`，公网 `http://154.37.155.17/xuanmanager/` 已换新资源，登录页渲染正常（`pageerror` 为空）。
- 迁移 068 随启动自动执行：`mgr_schema_migration` 有 `068_honor_rank_activity.sql`；`mgr_module` 新增 `game.honor_rank`（id 64，route `/game/honor-rank`）；权限 view/manage 落库并授给 role 1、4；活动表已建（0 行）。
- `health` 返回 ok；未登录 `GET /api/game/honor-rank/activities` 与 `/scopes` 均 401。
- 回滚点：`bin/xuanmanager.previous-honorrank-20261115-1830`、`web.previous-honorrank-20261115-1830`；脚本 `/www/html/.xuanmanager/deploy-honorrank-20261115-1830.sh`。

## 部署记录 2：活动支持修改（2026-11-15 18:50 CST，8891 已切换）

- 新增 `PUT /api/game/honor-rank/activities/{id}`；前端弹窗去掉"历史只读"，改为可编辑 + 「保存修改」；被取代的活动仍只读。
- 顺手修：按钮区原本在 `fieldset` 内，只读时连「关闭」都被禁用 → 按钮移到 fieldset 外。
- 未取代活动详情不再误报"与本次配置一致"（被取代时游戏服配置属于新活动）。
- 二进制 sha256 `9a34fd94c36d7961167ab855efb1468b6aaa9c0479abf79428af3fd3284588ff`，`/proc/4501/exe` 同哈希，18:50:00 启动；前端 `index-BcwSx34z.js` + `index-D8neILzi.css`。
- `health` ok；未登录 `GET /activities`、`PUT /activities/1` 均 401。本次无迁移。
- mock 渲染验证：可编辑活动按钮可用、勾选后发出 `PUT`；被取代活动表单置灰且「关闭」可点，无 console 错误。
- 回滚点：`bin/xuanmanager.previous-honorrank-edit-20261115-1855`、`web.previous-honorrank-edit-20261115-1855`；脚本 `/www/html/.xuanmanager/deploy-honorrank-edit-20261115-1855.sh`。
