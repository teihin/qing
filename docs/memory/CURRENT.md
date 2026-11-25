# qing 当前状态

更新时间：2026-11-25

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-25 客户端「额度授权记录」按身份区分 club_id（未构建热更、未真机，详见[交接](handoffs/2026-11-25-quota-grant-record-union-owner.md)）

- 口径：`查询_联盟_授信_记录` 大盟主（当前俱乐部所在联盟的总群主）看全联盟 → **只带 `union_id`、不传 `club_id`**；盟主只看自己名下俱乐部 → `club_id` + `union_id` 都带。
- 实现：`panelMain` 打开面板时透传 `is_union_owner = IsUnionOwnerOfClub(clubId)`（只认服务端结论、不落盘）；`panelQuotaGrantRecord.ReadEntry/GetRecords` 按该标记决定发不发 `club_id`，**大盟主但 `union_id` 为空时仍退回带 `club_id`** 兜底。
- 仅语法自检 0 诊断；待 Creator 编译后实机抓报文确认。

## 2026-11-25 自动输赢平衡：后台完整版（已上正式服；游戏服命令未部署，功能暂不可用，详见[交接](handoffs/2026-11-25-auto-balance-admin.md)）

- 新增独立模块「自动输赢平衡」`/game/auto-balance`（`parent_id=20`、`sort_order=72`、icon `balance`），配置 / 候选 / 名单三个 Tab；迁移 `075_auto_balance.sql`（模块 id 66、权限 5841-5844 授权 role 1）。
- 后端 `auto_balance.go` 9 条路由，全走 8890 `/hall/command`；4 权限 `view/config/execute/team`；`mode=auto` 强制 `confirm:true`；写操作串行锁 + 审计；分组下拉只读 `club_player_group_info`。
- 两台已部署（15:36/15:43），二进制 `77f44df7…`、health 200、新路由 401；回滚点见交接。测试服仅 role 1 有玩家控制权限，故只授权 role 1。
- 16:46–17:01 前端调整：隐藏「生效玩法」；排除玩家标签输入 + 后台核对玩家存在（新接口 `GET /auto-balance/player`）；底皮只能下拉选 9 档；文案全中文化。二进制 `e0744d9b…`。
- **阻塞**：正式服游戏服没这套实现 —— 无 `auto_balance.py`、`Hall.py` 无 8 条命令、两张表都不存在，`查询_自动平衡_配置` 实测 769。页面打开显示「接口未注册」，需游戏服部署 + reload。代码已提交推送（`codex/club-ui`）。

## 2026-11-24 用户端数据查询支持登录ID/昵称 + 代理链显示各级比例（已上测试服，详见[交接](handoffs/2026-11-24-userdata-lookup-and-chain-percent.md)）

- 后端新增 `GET /api/game/user-data/lookup?keyword=`（权限沿用 `game.user_data.view`）：游戏ID（含靓号）与登录ID（`sm_wxID` / `kbe_accountinfos.accountName`）精确、昵称 `sm_name` 模糊，精确优先，最多 20 条。
- 前端搜索框改成「先定位玩家」：命中 1 条直接进详情，多条先出候选表点选。代理链每级显示 `角色 · 比例 X%`（`club_agent_info.percent`，`0` 不显示）；本人若是创建者/代理也显示 `本人 · X%`（与「分成比例」同一判定，0 也显示）。
- 验证：`go build/vet/test`、`tsc/lint/build` 通过；测试服登录ID `1018888` → `981149`、昵称 `测试四` → `327553`；部署后 health 200、新 bundle `index-BJvnC5L-.js`、lookup 未登录 401。**未做登录态点测**，正式服未动，代码未提交。

## 2026-11-24 客服上分可同步增加盟主额度（已上测试服，详见[交接](handoffs/2026-11-24-cs-hosted-gold-sync-union-quota.md)）

- 客服「托管会话 → 上分」弹窗新增「同步增加盟主额度」勾选，**默认勾选**；上多少分同步给该俱乐部盟主加多少额度，下分不涉及。
- **没用用户点名的 `授信_联盟_额度`**：该命令按调用者自己的联盟判定，`/hall/command` 固定以 `Hall.boss` 执行，boss 无联盟，实测恒返回 769「该俱乐部不在你的联盟里」。改用后台专用命令 **`发放_盟主_奖励`**（池 → 盟主俱乐部，写库 `额度奖励`）。
- 上分成功后调该命令并回读 `club_guuid_info.union_quota`；第二步失败不回滚积分，原因经 `quotaSyncError` 回显客服，俱乐部未入盟给明确提示。
- 验证：`go vet/test`、`tsc+build` 通过；测试服端到端 +1 → 玩家积分 1337→1338、俱乐部额度 6123001→6123002、联盟池 40231999→40231998。
- 测试服已部署（前端 `index-CCJtSAUV.js`、ChatTool `ec68ba29…`、XuanManager `1cdd9f52…`），**正式服未动**，回滚点见交接。**代码未提交。**

## 2026-11-22 后台「关联账号」去掉同公网 IP 维度（两台已部署）

- 原因：服务器已接入高防，玩家出口 IP 被统一改写，同 IP 关联出来的都是假关联。用户要求只去掉 IP 这一路。
- 后端 `XuanManager/server/internal/api/relations.go`：删掉 `usr_login_ip_info` 两段查询、`relationAllowedIPs` 与 IP 共享阈值，评分只留同设备 100 分（90 天）/ 同 GPS 网格 60 分（7 天）；`types` 只返回 `device` / `gps`。
- 前端 `PlayersPage.tsx` 去掉「同公网IP」标签、说明与空状态文案、弱强度档；`styles.css` 删 `.relation-tag--ip`、`.relation-strength.is-weak`；`types.ts` 注释同步；接口文档 §4.5.6 同步。
- **玩家列表「IP短码」列和详情「最近上报 IP」保留**：只砍关联判定，不动 IP 展示。
- 部署：同一二进制 sha256 `65bbe034…`（15,925,958 B）+ 前端 `index-CstP5xGn.js` / `index-BZMncE-w.css` 已上测试服 16:45、正式服 16:46；两台 health 200、页面与资源 200、关联接口未登录 401、产物 md5 与本地一致。
- 回滚点：测试服 `bin/xuanmanager.previous-iprel-20261122-1645` + `backups/web.previous-iprel-20261122-1645/`；正式服 `bin/xuanmanager.previous-iprel-20261122-1646` + `backups/web.previous-iprel-20261122-1646/`。回滚 = stop.sh → 还原两处 → start.sh。**代码未提交。**
- **2026-11-22 16:53/16:54 追加兜底**（用户要求只改后台、不动库和游戏服）：`relations.go` 的 `add()` 增加 `isNumericPlayerID`，非纯数字 guuid 一律不参与关联。起因是库里存在 `user_guuid='ID???' / user_name='匿名'` 的脏行（游戏服上报设备/登录 IP 时账号未就绪，把界面占位文字写进了库，测试服 5 台设备各 1 条，与真实玩家共设备），导致关联列表多出「匿名 ID：ID???·同设备·强」。
- 本次只换二进制（sha256 `7214aaf7…`），**web、配置、数据库均未改**；备份 `bin/xuanmanager.previous-anonfilter-20261122-1653`（测试服）/ `…-1654`（正式服）。两台 health 200、首页 200、关联接口未登录 401。
- **遗留（用户明确暂不处理）**：脏行没清、游戏服写入侧没改（`/home/release/kbe` 需 release 权限），新脏行仍会写库，只是后台不再展示。

## 2026-11-22 推广站跳转地址改由后台配置（正式服已上线）

- 后台「系统配置 → 游戏推广下载地址」页下半部分可改苹果/安卓跳转地址，存 `mgr_platform_setting`（`promotion.site.ios_url` / `promotion.site.android_url`），保存即时生效，不用重传网站。
- 落地页每次打开请求同目录 `links.json`（Caddy 改写到后台只读接口，**页面里不出现 `/xuanmanager`**；no-store，只接受 https），取不到回退 `site-config.json` → 内置默认值。
- 后端新增 `promotion_site_links.go` 三条路由，沿用 `configuration.promotion_download.*` 权限，无迁移；正式服 bin `67942c12…`、前端 `index-SozfhwRq.js`；回滚点 `bin/xuanmanager.previous-hidelinks-20261122-112901`、Caddy `Caddyfile.bak.weblinks-20261122-112831`。**代码未提交。**

## 2026-11-22 推广站改为按平台跳转（正式服已发布，测试服未动，详见[交接](handoffs/2026-11-22-promotion-site-redirect.md)）

- 不再站内发 APK/描述文件：iOS 和安卓都是**点主按钮才跳**（`https://dgwsd.yycdzx.com/UMuGWv` / `https://www.gulubase.com/bf888`，不做自动跳，避免落地页一闪而过），桌面给两个入口；iOS 安装弹层/浏览器引导/描述文件下载整段删除。
- `site-config.json` 改 `iosInstallUrl`/`androidInstallUrl`；`downloads/BF.mobileconfig` 与生成脚本留档不再引用。`upload_promotion_site.py` 变跳转模式（无 APK 配置就不打包/不校验，ZIP 1.43 MB），新增 `--public-url`；新增 `9-4上传推广网站-正式服.command`。
- 正式服 `8.153.70.197:/www/html/webhome` 已发布（7 文件，index sha `6eb9c977…`；已清掉公网 `downloads/` 与测试服域名，app.js 只接受 https 目标），`:28800` 默认 `root /www/html` 直接可用；公网转发域名 200。**测试服 `154.37.155.17` 仍是旧下载页，双击 `4上传推广网站.command` 才同步（会替换掉服务器上的旧 APK）。** 未真机验证。

## 2026-11-22 客服站两步验证 404（正式服已修，详见[交接](handoffs/2026-11-22-chattool-totp-path.md)）

## 2026-11-21 大厅排行榜入口按俱乐部/联盟开关（客户端 + 后台就绪，未构建/未部署/未真机）

- 大厅「发现」页「排行榜」按钮原来一直显示。现在后台按俱乐部放行：独立俱乐部自己设，已入盟由联盟统一设，玩家切俱乐部后按新归属重判。
- 存储沿用哈希表，**不改游戏服命令**：`kbedm.usr_hash_info` 的 `排行榜_俱乐部_<clubId>` / `排行榜_联盟_<unionId>`（1=显示）。客户端读 `查询_哈希_信息`；后台后端直接读写并回读校验。
- 客户端（`panelMain.ts`）：`union_id` 非空读联盟 key、确认未入盟读俱乐部 key、归属未知先隐藏并补查 `查询_俱乐部_信息`；进大厅/进发现页/切俱乐部/入盟推送/关系变化都会重算；5 秒超时按隐藏，同 key 10 秒节流，迟到回包按 key 丢弃。只切 `Main/发现/排行榜` 的 `active`，未改 Prefab。
- 后台：新增 `PUT /api/game/{clubs|unions}/{id}/leaderboard-entry` + 权限迁移 074；俱乐部/联盟列表回 `leaderboardEnabled`；行内加「排行榜」按钮与状态列，**旧「荣耀榜」按钮已去掉**（配置仍走独立模块「排行榜」，`HonorRankModal.tsx` 已删）。
- 验证：`go build`、`go vet`、排行榜/暗抽相关测试、`npx tsc --noEmit` 全通过；`go test ./internal/api/` 仅剩既有失败 `TestGameRegistrationHoneypotRejectsAndBansIP`（`REGISTRATION_MOVED`，与本次无关）。客户端只做语法转译。详见[交接](handoffs/2026-11-21-lobby-leaderboard-entry.md)。
- 后台**两台都已部署**：测试服 22:15（`154.37.155.17:/www/html/.xuanmanager`，权限角色 1/4）、正式服 22:17（`8.153.70.197:/www/.xuanmanager`，只有 super_admin）。同一二进制 `9c76aa1d…`，health 200，迁移 074 均已应用，新路由 401、页面已换 `index-BD8zmkfA.js`。回滚点：测试服 `backups/20261121-2218-rollback/`，正式服 `bin/xuanmanager.previous-leaderboardentry-20261121-2220` + `web.previous-leaderboardentry-20261121-2220/`。
- 待办：默认全隐藏，需运营逐个放开；客户端构建后测三种情况（独立俱乐部开/关、入盟跟随联盟、切俱乐部切换）。

## 2026-11-21 iOS 未签名包（BF 品牌，热更基线 7.0.6，含声音修复；待企业签名/真机）

- 三次出包都在 `build/ios-unsigned/`，均在 Creator 构建 jsb-link + 「1生成热更新包」之后直接 archive（不重复构建，44–50s）：`unsigned-20261121.ipa`（20:22，基线 7.0.4，**缺声音修复**）、`qing-unsigned-20261121-2322.ipa`（7.0.6）、`qing-unsigned-20261121-2325.ipa`（7.0.6 + 声音修复，**交付这版**，SHA-256 `eb3fa9e8…`）。忽略 2322 中间版，只发 2325。
- 共同核验：136 MB、`CODE_SIGNING_ALLOWED=NO` 且 `codesign -dv` = not signed at all（无 `_CodeSignature`/描述文件）、arm64、`CFBundleDisplayName=BF`/`com.fireball.qing`/1.0.0(1)/最低 iOS 12.0、包内 `index.jsc` 与 build 同哈希、`unzip -t` 通过、无 AppleDouble。
- 声音修复只改 `build-templates/.../proj.ios_mac/ios/QingVoiceBridge.{h,mm}`（22:03/22:43，出房间静音 + 切后台回前台 `end()`/`lazyInit()` 重建引擎 + 1.2s 补恢复），Creator 23:18 构建已自动同步（两侧 diff 一致），archive 日志确认 `QingVoiceBridge.mm`/`AppController.mm` 重新 CompileC。**判据：二进制 `RestoreGameAudio` 旧包 count=0、新包 count=1**（Objective-C 方法名在 `__objc_methname` 段，strip 不掉；二进制大小差 104 字节、中文字符串零差异都不可当判据）。
- 线上 `/up` 仍 6.0.26，7.0.6 未上传；dSYMs 为空（该配置不产，企业签名不依赖）。真机未验。

## 2026-11-19 实时战绩头像框：环不再缩在头像里（Prefab 就绪，未导入/构建/热更/真机）

- 根因：`record_avatar_ring.png` 92×92 四周留了透明边距，环外径只占画布 0.659；节点按 64/46 绘制后可见环径仅 42/30，而头像 62/44，框被"跑进"照片里。
- 改动只有两个节点的 `_contentSize`：`观战对象.prefab` 的 `V8头像框` 64→**100**，`带入记录.prefab` 的 `ring` 46→**72**；PNG/`.meta`/UUID 未动，`tools/apply_realtime_record_v2.py` 常量同步。
- 离屏与合成图核对见 `vibe_images/2026-11-19-avatar-ring/`；Creator 导入、构建、热更、真机未做。详见[交接](handoffs/2026-11-19-realtime-avatar-ring-size.md)。

## 更早批次

- 2026-11-18 的「游戏设置入口按当前联盟判身份」「排行榜数字等宽等基线」原文见 [`archive/2026-11-25/current-2026-11-18-union-leaderboard.md`](archive/2026-11-25/current-2026-11-18-union-leaderboard.md)。

- 2026-11-18 的实时战绩按新效果图重做、牌局结算行底两篇原文见 [`archive/2026-11-24/current-nov18-client-ui.md`](archive/2026-11-24/current-nov18-client-ui.md)。

- 2026-11-18 的「下注位芒N残留」「投芒动画收尾」「结算界面重做」「俱乐部成员汇总条」原文见 [`archive/2026-11-22/current-2026-11-18-batches.md`](archive/2026-11-22/current-2026-11-18-batches.md)。

- 2026-11-15 批次（业绩股全局折算、逃跑惩罚统计、玩家优化接胜率目标、排行榜独立模块、代理链、俱乐部荣耀榜、BF 聊天默认关闭）见 [`archive/2026-11-18/current-nov15-batches.md`](archive/2026-11-18/current-nov15-batches.md)。
- 2026-11-14 批次（后台靓号、BF 消息规则、玩家关联账号/IP 短码、客户端 BOSS IP 短码）见 [`archive/2026-11-17/current-nov14-batches.md`](archive/2026-11-17/current-nov14-batches.md)。
- 2026-11-13 批次（BF 聊天开关移交后台、业绩核心共享三阶段发放、额度授权记录类型、后台用户端数据查询）见 [`archive/2026-11-15/current-nov13-batches.md`](archive/2026-11-15/current-nov13-batches.md)。
- 2026-11-03～11-09 的历史客户端、额度、牌局和后台批次见 [`docs/memory/archive/`](archive/2026-11-15/)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
