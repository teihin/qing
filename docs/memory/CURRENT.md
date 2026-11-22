# qing 当前状态

更新时间：2026-11-22

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

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

## 更早批次

- 2026-11-18 的「下注位芒N残留」「投芒动画收尾」「结算界面重做」「俱乐部成员汇总条」原文见 [`archive/2026-11-22/current-2026-11-18-batches.md`](archive/2026-11-22/current-2026-11-18-batches.md)。

- 2026-11-15 批次（业绩股全局折算、逃跑惩罚统计、玩家优化接胜率目标、排行榜独立模块、代理链、俱乐部荣耀榜、BF 聊天默认关闭）见 [`archive/2026-11-18/current-nov15-batches.md`](archive/2026-11-18/current-nov15-batches.md)。
- 2026-11-14 批次（后台靓号、BF 消息规则、玩家关联账号/IP 短码、客户端 BOSS IP 短码）见 [`archive/2026-11-17/current-nov14-batches.md`](archive/2026-11-17/current-nov14-batches.md)。
- 2026-11-13 批次（BF 聊天开关移交后台、业绩核心共享三阶段发放、额度授权记录类型、后台用户端数据查询）见 [`archive/2026-11-15/current-nov13-batches.md`](archive/2026-11-15/current-nov13-batches.md)。
- 2026-11-03～11-09 的历史客户端、额度、牌局和后台批次见 [`docs/memory/archive/`](archive/2026-11-15/)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
