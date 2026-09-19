# qing 当前状态

更新时间：2026-09-20

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。历史验证不代表当前结果。

## 2026-09-20 玩家信息弹窗 V8-new

- 正式 `panelUserInfo.prefab` 已按新稿组件化换肤，头像修成正圆；仅显示六个对应道具，其余四项仅隐藏。19张独立/九宫格PNG约272KB，RGBA约0.815MiB。动态数据、VIP权限及原道具协议保留，新增关闭/复制ID。
- Creator导入与本地引擎长短屏离线预览已查；未真实登录交互、未构建真机、未提交推送。见[交接](handoffs/2026-09-20-player-info-v8.md)。

## 2026-09-19 XuanManager 时间口径修复（正式已部署）

- 玩家管理「最近登录」等页面时间多 8 小时、16:00 后跨到次日。根因：误判「MySQL 存的是 UTC」，而实测正式服务器系统与 MySQL 会话时区都是 `Asia/Shanghai`（`@@time_zone = SYSTEM`），`NOW()`/`CURRENT_TIMESTAMP`/`FROM_UNIXTIME()` 与全部 `DATETIME` 列**本来就是北京时间**，那层 `DATE_ADD(…, INTERVAL 8 HOUR)` 成了第二次 +8。
- 已删除后端全部 22 处 +8 包装（玩家/封禁/防盗号/后台用户/审计/公告/发牌优化/交易筛选/平台收益），工作台今日审计日界改按北京时间，数据库连接 `Loc` 固定 `Asia/Shanghai`。前端无需改动（线上产物即本地 `web/dist`，`Asia/Shanghai` 口径正确）。
- 验证：`go vet`/`go test` 全过；新二进制 `INTERVAL 8 HOUR` 计数 0；部署前用同源比对确认本地源码 = 线上二进制；重启后 `/api/health` 200，只读回读时间与北京时间一致。**未登录页面做视觉复核；改动未提交。**见[交接](handoffs/2026-09-19-xuanmanager-timezone-fix.md)。
- 同批新增「玩家管理 → 更多条件 → 登录日期范围」（`loginFrom`/`loginTo`）：按北京时间日界用 `UNIX_TIMESTAMP` 换算后比 `kbe_accountinfos.lasttime`，未登录账号不落范围；后端单测 + 前端 lint/tsc/build 通过，只读 SQL 与 `FROM_UNIXTIME` 参照口径一致，后端与前端已一同部署正式 8891（回滚点 `backups/xuanmanager.20260919-2331-loginrange-rollback`、`web.previous-login-range-20260919`）。**未登录页面点击验收；改动未提交。**见[交接](handoffs/2026-09-19-xuanmanager-player-login-range.md)。

## 2026-09-19 大厅「发现」两个入口行为调整

- `panelMain.onButtonClick` 新增两个分支（原无分支、点击无响应）：`举报反馈` 直接 `showPanel("panelKefu",Cover)`，不传 `strUserData`，走默认客服 URL 与 `general` 渠道；`比赛场` 走 `panelMsgView` 弹「暂无比赛，敬请期待！」。
- 只改脚本，`panelMain.prefab` 未动（三个节点的 Button 与统一事件注册均已存在）。**未 Creator 编译、未构建、未真机**；需重新构建后生效。

## 2026-09-16 表情动画替换（hh-poker EMOJI）

- 点头像→表情面板→选择后播的表情动画换成 hh-poker 素材（VP9 240×240 **纯黑底无 Alpha** webm）。抠底＝阈值＋膨胀 6px＋从画布边界洪泛暗区，与边界连通的暗区判为背景，**还原原画自带黑描边**（描边与背景同色，无法按颜色切）。主体统一 100px（原 99×101）且按**主体中心**对齐，特效长出来时表情仍在头像正中；全帧同画布＋`.meta` 写 `trimType: none`，防逐帧自动裁剪抖动。按真实 30fps 时间轴压帧，10 组 373 帧 / 3.69 MB。
- 映射 1 冰冷→cold、2 发怒→enraged、3 囧→explode、4 困→no、5 大笑→joy、6 微笑→beaming、7 感动→cry1、8 拇指→biceps、9 拜拜→devil、10 色心→hot（未用顶边被裁平的 `hahaha`；`locoff/lost` 是定位图标不是表情）。面板图标同步换新静帧。
- `表情2/<n>.prefab`、`panelTalk.prefab` 图标靠**保留原 uuid** 自动换图未改；`DrhPlayerLogic.ts` 表情存活时长由固定 2s 改读剪辑时长。脚本 `tools/convert_hh_emoji_anim.py`、`tools/make_emoji_preview.py`，预览 `temp/emoji-preview.html`。**未 Creator 导入、未构建、未真机。**见[交接](handoffs/2026-09-16-emoji-anim-replace.md)。

## 2026-09-16 热更新"清单说有、磁盘没有"自愈

- 根因（真机实测）：`Remote/…/native/5e/5e7fa6f0-….png` 只下到 53% 留了 `.tmp`，本地清单却已记新图 md5 ⇒ 引擎回落安装包旧图且永不再补下。差异对比用 `<storage>/project.manifest`；`AssetsManagerEx::update()` 无 `UP_TO_DATE` 分支，不能用"发现坏了直接 `update()`"修。
- 修法：`panelUpdate.ts` 纯新增 160 行启动自检（`.tmp`/落地文件大小核对 ⇒ 剔除记录、删坏文件、版本降末位、复位 `tempver`，`try/catch` 兜底）；真机只读验证 0 误判、正例精确抓出、≈90ms，触发机制已端到端实测。**未重建、未出包上传。**详见[交接](handoffs/2026-09-16-hotupdate-incomplete-file.md)。

## 2026-09-16 大厅房间行：BY 卡面 + 独立图标

- 大厅→发现→房间列表每行改为「筹码+底皮值 / 时钟+时长 / 人数+人数 / 剩余时间 12:12」，字段取压缩数组 `[5]/[6]/[3][4]/[2]`；`ScrollItem.ts`、`panelMain.prefab` 房间行已改，卡面重绘为只含 `BY` 盾牌的 1426×260 底框（直接缩放不抠图，UUID 未变），筹码/时钟/人数三个图标独立成 `assets/V7/room_icon_*.png`。见[交接](handoffs/2026-09-16-lobby-room-row-by.md)；未 Creator 导入、未构建。

## 2026-09-15 资源打包体积与 V7 移出 resources

- `assets/resources/` 是 Cocos 唯一“整目录无条件打包”的目录，构建器不分析 `cc.loader.loadRes` 的拼接路径，未引用资源同样进包。对照实测 `assets/ImagesLuck`（非 resources）588 张只打进 356 张，被 `resources` 内 Prefab 引用者仍归入 `resources` 包。
- `assets/resources/V7/` 原有 658 张 PNG（114.16 MB），其中 169 张（60.88 MB）无任何引用也被打包。用户已将整个 `V7/` 移到 `assets/V7/`（提交 `5249135`，1333 文件全 R100、`.meta`/UUID 未变、引用完整）。
- 19:23 重建 jsb-link 实测：489 张（53.28 MB）进包、169 张不再进包，`assets/resources` 由约 169.5 MB 降至 108.60 MB，净减约 60.9 MB；此后新增的未引用图也不再自动进包。
- 判定要点：反查引用必须把 `.meta` 纳入扫描（BMFont 贴图只经 `.fnt.meta` 关联，曾误判 8 张在用字体贴图）；`manifest` 全量清单单独排除；`avatars`/`pk2`/`zuotype`/`Audio`/`道具`/`other`/`UI`/`Prefabs` 等由代码拼接路径加载，不得按“未引用”处理。
- 未验：Creator 重新导入复核、热更新清单一致性、网页版体积。详见[交接](handoffs/2026-09-15-asset-bundle-audit.md)。

## 2026-09-08 效果图目录约定

- 已确认页面以 `design-previews/效果图V8-new/` 现存稿为准（09-14 核对 49 张，桌内 7 张已删除）；旧 V7、原 V8 及其它历史稿不作为并列母版；设计删除或确认均不代表正式 Prefab 已迁移。见[定稿入口](../../design-previews/README.md)。
- 09-08 已删除新版目录中的直接拷贝稿并重绘公告、钱包、登录、大厅及后续模块 29 张（中亮蓝青底、浅象牙金字、文字放大）；不得用旧图直拷或仅滤镜替代，也不得回退到旧 V8 深蓝黑色调。

## 本轮实时核对：记忆整理

- 当前目录 `/Volumes/SSD/qing`，Creator 配置版本 2.4.13；进入新任务仍须重查分支与未提交修改。09-13 用户已明确要求提交并推送全部改动，见[提交交接](handoffs/2026-09-13-commit-all.md)。
- 精简入口、当前状态、专题、完整原文归档及只读检查已安装；迁移证据见[整理交接](handoffs/2026-09-05-memory-migration.md)。`build` 原生工程与 `runtime-src.zip` 均保留，不能当普通缓存删除。

## 2026-09-11 V8 全套实施

- 09-15 “我的”五档底皮手数改读 `Account.playcount_count`（“#”分隔，1~20 皮取下标 2~6），缺失才用“—”，见[交接](handoffs/2026-09-15-mine-stake-playcount.md)；大厅房间底框用 Seedream 重绘并压平噪纹（886×136），UUID/Prefab 未变，见[交接](handoffs/2026-09-15-lobby-room-card-cutout.md)。两者 Creator 导入/构建未做。
- 待确认未实施：[桌内回顾](handoffs/2026-09-14-ingame-review-design.md)、[实时战绩](handoffs/2026-09-14-realtime-record-design.md)、[带入积分无 Logo 稿](handoffs/2026-09-14-buyin-design.md)、[奖池弹窗三 Tab 稿](handoffs/2026-09-14-jackpot-popup-design.md)。09-14 空位/奖池条已实施；安卓退房闪烁已定位修复（未出包复验）：[修复](handoffs/2026-09-14-exit-room-flicker-fix.md)。
- 09-13 [代理 18 视图](handoffs/2026-09-13-agent-v8.md)组件化、质感/数字/补位已修正；[推广](handoffs/2026-09-13-promotion-shared.md)按最新要求共用“我的”同一页；[密码三页](handoffs/2026-09-13-password-pages-v8.md)共用大厅背景并修正 8 输入；[设置](handoffs/2026-09-13-settings-v8.md)组件化、去图标横杠并停用修改预留信息。
- 09-13 钱包：[首次实名恢复](handoffs/2026-09-13-wallet-first-realname.md)、[返回与金额状态](handoffs/2026-09-13-wallet-return-and-amount-state.md)、[提现三开关与 USDT 汇率](handoffs/2026-09-13-wallet-withdrawal-controls.md)与[正式后台部署](handoffs/2026-09-13-xuanmanager-withdrawal-deploy.md)、[金币流向纠错](handoffs/2026-09-13-money-corners-and-totals.md)、[20 个 EditBox 对齐](handoffs/2026-09-13-wallet-editbox-alignment.md)。均未构建发布。
- 09-11 起按 `效果图V8-new` 顺序完成全页换肤并兼容长短手机，逐页状态见[全套进度](handoffs/2026-09-11-v8-all-pages.md)。大厅/公告菜单改用一张连续图像背景、装饰拆为独立 Sprite；[充值](handoffs/2026-09-13-wallet-recharge-v8.md)按否决重做并写入正式 Prefab；[钱包与金币流向](handoffs/2026-09-13-wallet-pages-and-money-v8.md)组件化换肤。56 图全套未完成。
- 注册弹窗已用定稿直切底图，五项输入、密码隐藏、动态头像与防盗号保留，13 张资源及正式 Prefab 已确认 Creator 导入，见[注册交接](handoffs/2026-09-11-register-v8-exact.md)。
- 历史提交观察（`16275a8`、`2f614ba`、`db5b60f`）均已失效，提交与推送一律以 Git 实时状态为准。

## 2026-09-10 登录页重叠与背景衔接修复

- 用户否决首轮实现后重做正式 Prefab：关闭拉伸整稿的根 Sprite，独立背景、盾牌、输入框、链接与登录按钮同一等比居中坐标，原业务节点及事件保留；修复后布局尚未获得用户最终验收。本地提交 `63b9ef0` 已按用户要求 mixed reset 撤回（回到 `db5b60f`），未创建反向提交或丢弃文件。
- 上下延展背景不连续问题改为单张完整无控件底图，窗框连续、底部只保留一条桌沿，控件按轮廓保留原像素。Creator 导入与正式 PNG 一致，iPhone 6/X 网页显示、输入/清除及注册弹窗开关已查，四档静态布局通过；未构建、未真机、未真实登录注册。见[修复交接](handoffs/2026-09-10-login-overlap-fix.md)。

## 最近报告的 UI 状态

共同边界：以下为历史模块记录，登录页已由上方 2026-09-10 修复状态替代；历史阶段未执行 Creator 构建，不能把其他版本的构建成功算到 V7 上。

- 逐页“最近报告 / 保留的未完成验证 / 来源行号”完整表格已移至[归档](archive/2026-09-15/ui-status-table.md)；当前进度以[全套进度](handoffs/2026-09-11-v8-all-pages.md)为准。
- 高频未验证项：原生热更新下载与异常重试、启动与模板 Splash 停留态；登录动态输入与快速注册回包；大厅真实筛选/权限/动态值；战绩、结算与回顾回包及回放；排行榜排行领奖；实名页登录态提交与真实交易。

## V7 历史实施边界

V7 的详细实施经过已保留在[阶段快照](archive/2026-09-11/v7-implementation-before-full-reskin.md)。它用于核对业务节点、验证缺口和已否决方式；本次 V8 进度以上方全套任务清单为准，不能将旧视觉检查自动计入新稿。

## 待核实项与工作边界

1. 2026-09-05 已核对 `panelQianBao.ts`：“确认充值”仍显示“暂未开通，后续处理”并提前返回。本轮只修选择和美术，不代表充值业务恢复。
2. 旧概况第 35 行仅提 `runtime-src.zip`，而恢复记录第 24 行明确包括 `build` 内原生工程。原生开发/打包前须核实实际入口与保留范围；不能把全部 `build` 当可随意删除的缓存。
3. 旧活动路径 `/Volumes/CCCC/qing` 已由 SSD 恢复及本轮目录核对取代；旧路径、旧磁盘健康及旧部署结果仅作历史证据。
4. V7 只覆盖已确认并有模块实施记录的页面。牌桌、动画及其他未列入范围的设计不得因旧章节被归档就自动判废；具体任务按对应模块证据确认。
5. 下一次开发从用户指定页面/问题开始，先读对应专题和任务交接，再核实目标文件与未提交差异。表内待验证项是已知缺口，不构成执行交易、构建或发布的授权。

上述待核实项来源：[原文归档](archive/2026-09-05/AGENTS.original.md) 第 23–24、35、39、458、599 行。状态变更后改写本页相关条目，不在页尾持续堆叠过程日志。
