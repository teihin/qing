# 2026-11-25 自动输赢平衡：后台模块（完整版，已上正式服）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`；本次只改 `XuanManager/`，客户端与游戏服未动。
- **未提交、未推送**（工作区另有他人未提交的客户端改动，未触碰）。

## 目标

按 `服务器文档整理/自动输赢平衡-后台接口文档.md`（8 条命令：4 同步 + 4 异步）在后台做完整功能：
配置可读写、候选可看可执行、伙牌名单可增删并支持从玩家分组导入。用户要求「实现完整版，改完更新到正式服」。

## 决策

1. **独立模块** `/game/auto-balance`（`parent_id=20`、`sort_order=72`、icon `balance`），不塞进「玩家控制」：
   命令族不同（`*_自动平衡_*` vs `*_胜率目标`）、权限对象不同、数据源不交集。
2. **4 个权限**：`view` / `config`（改配置，高危）/ `execute`（下发、全停）/ `team`（名单增删导入）。`config` 与 `execute` 拆开。
3. **`mode=auto` 后端强制二次确认**：请求必须带 `confirm:true`，否则 400 `CONFIRM_REQUIRED`；前端另有红色确认弹窗。
4. **分组下拉只读 `kbedm.club_player_group_info`**：游戏服 `异步_查询_俱乐部_分组` 要按 club_id 逐个查，无法一次列全；
   SQL 用 `scope_type/scope_id`（该表没有 `club_id/union_id` 字段），成员数取 `club_player_group_member_info`。
5. `today_net` 用 `*int64`：`null` 原样传给前端显示「未开启」，不当 0。
6. 写操作串行锁 `autoBalanceWriteMu`，全部落 `mgr_audit_log`（`game.auto_balance.*`）。

## 改动文件

后端：
- `server/internal/api/auto_balance.go`（新增，~700 行）：9 条路由 + 命令封装 + 归一化 `ok/failed/stopped`。
- `server/internal/api/server.go`：注册 9 条路由。
- `server/migrations/075_auto_balance.sql`（新增）：模块（自增 id，不写死）+ 4 权限 + 角色继承（从 `game.player_optimization.*` 继承，role 1 兜底）。

前端：
- `web/src/pages/AutoBalancePage.tsx`（新增）：三 Tab —— 配置与总览 / 候选与执行 / 伙牌名单。
- `web/src/types.ts`：新增 `AutoBalance*` 类型。
- `web/src/App.tsx`：路由 `/game/auto-balance`。
- `web/src/components/Layout.tsx`：icon `balance: "衡"`。
- `web/src/styles.css`：`.ab-tabs` / `.ab-team-layout` / `.ab-group-list` / `.optimization-status.is-warn|is-danger`。

## 验证

- `go build ./...`、`go vet ./internal/api/` 通过；`go test ./internal/api/` 仅剩**既有失败** `TestGameRegistrationHoneypotRejectsAndBansIP`（`REGISTRATION_MOVED`，与本次无关）。
- `npx tsc --noEmit`、`npm run lint`、`npm run build` 通过；产物 `index-BCJmmVzT.js` / `index-BA_SliHk.css`。
- 正式服部署（15:36，`8.153.70.197:/www/.xuanmanager`）：
  - 二进制 sha256 `77f44df7…da7a7f`，`/proc/21732/exe` 与磁盘一致，单进程，启动 15:36:42；
  - `/api/health` 200；`/api/game/auto-balance/{config,teams,groups}` 未登录均 401（路由存在，非 404）；
  - 迁移 `075_auto_balance.sql` 已应用；模块 id 66；权限 5841-5844 enabled，授权 role 1；
  - Caddy（Host `72679781.tjkdplus.com.cname.hcnamedns.com:28800`）`/xuanmanager/` 200，引用新 bundle，JS 200。
  - 分组 SQL 直查通过：14 个 used 分组，成员数正确（如「金刚盟主撩家」6 人）。
  - 回滚点：`bin/xuanmanager.previous-autobalance-20261125-1541`、`web.previous-autobalance-20261125-1541/`。
- 测试服部署（15:43，`154.37.155.17:/www/html/.xuanmanager`）：
  - 同一二进制 `77f44df7…`，pid 23929、`/proc/*/exe` 一致，health 200，三条新路由 401，`/xuanmanager/` 与 `assets/index-BCJmmVzT.js` 均 200（旧 bundle `index-DXrkHR86.js` 保留）。
  - 迁移 075 已应用：模块 id 66、权限 5841-5844 enabled；**只授权 role 1**——测试服的 `game.player_optimization.*` 本来就只有 role 1 有，
    role 4（qqq/杀杀杀，84 权限）没有该权限所以也没继承。要用 role 4 测试需在「角色与权限」里手动勾选。
  - 回滚点：`bin/xuanmanager.previous-autobalance-20261125-1543`、`web.previous-autobalance-20261125-1543/`。

## 阻塞 / 未完成（重要）

1. **正式服游戏服没有这套实现**：`/data/release/stone_war_assets/scripts/server_common/` 下无 `auto_balance.py`，`Hall.py` 里没有 8 条命令，`kbedm.usr_partner_team_member` / `usr_auto_balance_log` 两张表**都不存在**。
   实测 `查询_自动平衡_配置` 返回 `{"ret_code":769,"ret_result":{}}`（未注册）；对照 `异步_查询_胜率目标_列表` 正常 512。
   → 后台页面现在打开会显示「游戏服命令 查询_自动平衡_配置 返回 769，接口未注册或暂未开放」。**需要游戏服侧部署（.py + Hall.py 注册 + 建表 + reload）后才可用**，属服务器侧改动，需单独授权（正式服 KBEngine 由另一方维护）。
2. 没有做真实登录态下的浏览器点测（无可用后台账号，且明确不使用他人账号扫码登录）。配置表单、执行、名单增删、导入只做了构建、路由与 SQL 验证。
3. `go test` 未新增单测（命令封装与归一化逻辑依赖游戏服回包形状，等正式服命令可用后再补）。

## 下一步

1. 游戏服侧部署 auto_balance 实现（测试服已有文件但未 reload；正式服需从零上传）。
2. 部署后用 `observe` 跑一轮核对：候选人数、`today_net` 口径、名单 Tick 生效时间。
3. 再决定是否放开 `mode=auto`（后台已强制二次确认，但真实干预发牌仍建议先在测试服验证）。

## 追加：16:46 配置页交互调整（只改前端，两台只换 web）

用户反馈：生效玩法不该给运营看；排除玩家和按底皮覆盖是纯文本框，容易输错。改动：

- **隐藏「生效玩法」**：`room_play_mode` 固定为常量 `DEFAULT_ROOM_PLAY_MODE = "传销扯旋"`（游戏服默认值），`normalizeConfig` 与 `buildPayload` 都强制用它，表单不再渲染，`dirty` 比较两边同源不会误报。
- **排除玩家改标签输入** `GuuidTagInput`：输入回车/失焦/点「添加」即入标签，支持一次粘贴多个（逗号、空格、换行、分号）；校验 `^\d{4,12}$`，非法项列出来不进列表；去重；单个 × 删除、Backspace 删末尾、可一键清空。
- **按底皮覆盖改卡片编辑** `DipiEditor`：每个底皮一张卡片（底皮名 input + 覆盖项行 + 删除该底皮），行内是「覆盖项下拉 + 数值 + 移除」；顶部「添加底皮覆盖」。覆盖项下拉复用扁平字段名（`min_loss_score` 等 17 项，带中文标签，同名项合并标注「补偿/压制」）。
- 保存前校验：底皮名不能空、不能重复、覆盖项必须选；`buildPayload` 把卡片结构还原成 `{底皮: {字段: 数值}}`。
- 新增样式：`.ab-tags*` / `.ab-tag` / `.ab-dipi*`（`styles.css` 末尾）。

验证：`npx tsc --noEmit`、`npm run lint`、`npm run build` 通过，产物 `index-CZS5LQb5.js` / `index-BRZBytis.css`。
两台只替换 `web` 静态文件（**不重启服务、二进制未动**）：正式服 16:46、测试服 16:46，`/xuanmanager/` 200、新 js/css 200、health 200。
回滚：还原各自 `web/index.html.previous-autouifix-20261125-1646`（旧 bundle `index-BCJmmVzT.js` 等仍在 assets 里）。
**没有真实登录态点测**（同前，不用他人账号登录），标签交互与底皮卡片只做了类型检查与构建。

## 追加：16:52 玩家校验 + 底皮改下拉（后端 + 前端，两台已重启）

用户反馈两点：① 排除名单里随便输 ID 也能加，等于没校验；② 按底皮覆盖的「底皮」是手输框，容易写成游戏服认不出的值。

后端：
- 新增 `GET /api/game/auto-balance/player?guuid=`（权限 `game.auto_balance.team`）：格式 `4-12 位数字` → 复用
  `readGamePlayerIdentity`（`kbedm.tbl_Account` + `kbe_accountinfos`）核对，不存在返回 404 `PLAYER_NOT_FOUND`，查到返回 `{guuid,name,loginName}`。
- `GET /api/game/auto-balance/config` 响应新增 `dipiOptions: [{key,label}]`，直接复用 `rewardPoolDefinitions`
  （与奖池同一份 9 档：`底皮0.1/0.3`…`底皮100/200`），保证后台下拉与游戏服哈希 key 完全一致。

前端：
- `GuuidTagInput` 添加时改为**异步校验**：格式 → 调新接口逐个核对（`Promise.all`，可一次粘贴多个）→ 通过的才进标签，
  失败的按 `ID：玩家不存在` 列出来；标签 `title` 显示昵称，底部显示「最近添加 xxx」；核对期间输入框禁用。
- `DipiEditor` 底皮名从 `<input>` 改 `<select>`，选项来自 `dipiOptions`；新增底皮时自动跳到下一个未用档位；
  历史里不在标准档位的键仍以「（非标准档位）」保留为可选项，避免保存时被抹掉。
- 名单加人弹窗（批量）**保持原样**：游戏服本身逐条返回 `failed: 玩家不存在`，批量语义下前置全阻断反而不好用。

验证：`go build ./...`、`go vet`、`npx tsc --noEmit`、`npm run lint`、`npm run build` 全通过；
产物 `index-Ch5Lh5mU.js` / `index-DMXw1ow2.css`，二进制 `e0744d9b8a0522b071a207783114190cc762bc2515985d8edf47b6f34ac8d36b`。
两台已重启（正式服 pid 29591 @16:51:29、测试服 pid 3397 @16:53:23），`/proc/*/exe` 与磁盘一致、health 200、
`/api/game/auto-balance/player` 未登录 401、页面引用新 bundle。
回滚点：`bin/xuanmanager.previous-autovalidate-20261125-1652` + `web.previous-autovalidate-20261125-1652/`（两台同名前缀）。

注意：测试服重启时 Caddy 日志显示有运营账号正在用后台（16:51-16:53，`/xuanmanager/api/auth/me` 200），会闪断几秒。

## 追加：17:01 界面文案全部中文化（只改前端，两台只换 web）

用户反馈「observe 这些看不懂」。自动平衡模块页面里所有面向运营的文案改成中文，代码里的枚举值不变：

- 模式：`observe/advice/auto` → **只观察 / 人工确认 / 自动执行**（顶部状态条、两个下拉、禁用提示同步）；
  下拉选项带说明：`只观察 · 只看不动手` / `人工确认 · 出建议后手动执行` / `自动执行 · 命中后直接下发`。
- 页头 eyebrow `AUTO BALANCE` → `平衡策略`；弹窗 eyebrow 全改中文（高风险操作 / 下发明细 / 新增成员 / 添加结果 / 导入结果 / 按分组导入 / 软删除）。
- 技术词：`Tick` → 计算（「最近一次计算」/「单次计算上限」/「每 60 秒自动计算一次」）；`today_net` → 今日累计；
  `status=used` → 生效；`auto_balance` → 自动平衡；`min_loss_score` → 净输阈值；去掉区块标题里的 `（protect）/（suppress）/（limits）`。
- 底皮下拉只显示 `底皮5/10` 这样的键，不再拼 `（5 / 10）` 造成重复。
- 未知值兜底不再回显英文：模式 → 未知模式、动作 → 未知、成员状态 → 未知。

验证：`npx tsc --noEmit`、`npm run lint`、`npm run build` 通过，产物 `index-BdgwDMWm.js`（css 未变 `index-DMXw1ow2.css`）。
两台只替换 web（**未重启服务**）：正式服 / 测试服 `/xuanmanager/` 引用新 bundle，js 200，health 200。
回滚：`web/index.html.previous-abcn-20261125-1701`（两台）。

## 追加：17:03 当前模式徽标放大（只改前端，两台只换 web）

顶部「当前模式」原来用普通状态标签（12px 灰字），运营看不清。改成独立徽标 `.ab-mode-badge`：
`当前模式`（12px 小字）+ 模式名（**19px / 800 字重**）+ 状态点，48px 高、带边框底色；三档配色区分——
只观察=灰绿、人工确认=琥珀、自动执行=红色（auto 额外加外发光，最显眼）。窄屏降到 16px/42px 高。
产物 `index-Ba1vfw-r.js` / `index-CS1fWXkD.css`，两台只替换 web 未重启；回滚 `web/index.html.previous-abmode-20261125-1703`。

## 追加：2026-11-26 名单命令回包多一层数组 + 候选状态列（两台已部署）

游戏服侧反馈：4 条异步名单命令的回包会被包成数组 `[{"teams":[]...}]`。实测确认
`异步_查询_伙牌名单` 返回 `{"ret_code":512,"ret_result":[{"teams":[],"members":[]}]}`；
`decodeGameObject` 只认对象，遇到数组直接得空 map → **伙牌名单页面永远是空的**（导入也回 0）。

改动：
- 后端 `auto_balance.go` 新增 `decodeAutoBalancePayload`，`callAutoBalance` 改用它：按
  「字符串外壳 → 数组取首元素 → `result` 包装」摊平到对象，最多 6 层；非数组/非字符串回包行为不变。
  4 条异步命令（导入/查询/设置/移除）共用这一处，全部覆盖。
- 候选结构补文档 §4.3 的 `existingTargetValue / existingTargetMan / existingTargetTime`（has_target 已存在）。
  前端「状态」列按文档改成 `已有目标（补偿 +800 · 手工）` / `已有目标（压制 -1,200 · 自动）` /
  值 0 或来源空 → `已有目标（方向未知）`；`existingTargetTime` 放 `title` 悬浮提示。
  勾选/执行禁用逻辑不变（仍按 `hasTarget`）。
- 候选页「动作」下拉按 §4.4 加「未命中」（`hit=0`，不按 action 判），顺序：全部/仅命中/未命中/补偿/压制。
- 新增单测 `internal/api/auto_balance_decode_test.go`：object / 字符串 object / array / 字符串 array /
  `result` 包数组 / 空数组 / 非法 JSON 七种形状。

验证：`go build`、`go test -run TestDecodeAutoBalancePayloadShapes` 通过；`npx tsc --noEmit`、`vite build` 通过。
测试服 `154.37.155.17` 已更新（**正式服未动**）：
- 二进制 sha256 `8877b0fa317e25f0fbf9dafdefdfa6312c460a6832450689f3f4e33ff333d6dc`（strip 构建，与线上原体积一致 11808952），
  单 supervise + 单 bin，health 200；回滚点 `bin/xuanmanager.20261126-1634-rollback`。
- 前端 `index-DmOggmZr.js` / `index-D0Wf5v9H.css`，脚本内已确认含「未命中」「方向未知」；
  回滚点 `web.previous-ab-balance-20261126/`。
- 未做登录态页面点测（无后台账号）：名单是否真出数据、状态列文案要主人登录确认。

### 16:43 正式服发布（8.153.70.197）

基线隔离：XuanManager 工作区仍有别人未提交的 `automation_*` / `xuanagent` / realtime 改动，**不能直接拿工作区编**。
用 `git worktree add --detach /tmp/xm-head-wt codex/club-ui`（HEAD `de99048f`）干净树，
先只拷上次那 6 个文件（`game_call_logs.go` `game_call_logs_test.go` `game_commands.go` `server.go` `service_gold.go` `service_gold_test.go`）
构建 → sha `b5cc11ee…` **与正式服在线二进制逐字节一致**，证明基线口径正确；再叠加本次 `auto_balance.go` 构建 → `5ceb18b1…`。

- 正式服：`/www/.xuanmanager`，二进制 `5ceb18b1…`（11706552 字节），单 supervise + 单 bin，health 200，
  `teams`/`candidates` 未登录 401；`/www/.xuanmanager/runtime.env` 未改。
  回滚点 `bin/xuanmanager.20261126-1643-rollback`、`web.previous-ab-balance-20261126/`。
- 前端两台同产物：`index-DmOggmZr.js` / `index-D0Wf5v9H.css`（CSS hash 与发布前相同，说明同事的 automation 前端改动此前已上线，
  本次 JS 只多出自动平衡改动；上线前已用 `EventSource`/`club-chips` 特征比对确认无别人未发布内容）。
- **正式服游戏服侧已可用**：`异步_查询_伙牌名单` 返回 512 + 数组 `[{"teams":[...8 个团队...],"members":[...]}]`，
  回包确实是数组包装，修复后页面才有数据。测试服当时名单为空，正式服有真实数据。
- 未做：登录态页面点测（无后台账号）。
