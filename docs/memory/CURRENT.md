# qing 当前状态

更新时间：2026-10-26

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。历史验证不代表当前结果。

客服网页已部署，真机待验：[交接](handoffs/2026-09-24-chat-keyboard-visibility.md)。

## 2026-10-26 玩家设置跨级只读

- 成员列表第一层是操作者直属下级，可改；从「下级成员」再点开的人起只读，隐藏赠送/踢出/改比例/代理开关/备注，保留数值查看并显示「跨级查看，不能修改」。`settingsDepth` 拦截所有修改入口；关闭/切俱乐部/操作完成归零。Prefab 复用闲置文本节点，未新增节点/UUID。
- 创建者/管理员/代理都能打开玩家设置；代理对直属下级可设/调/取消代理、赠送、踢出，改积分仍限创建者/管理员；跨级只读不变。踢人因 Creator 未重编译（旧产物）不显示，已重编译；服务端未放开权限。见[踢人交接](handoffs/2026-10-26-club-agent-kick.md)。
- 转译、角色模拟、Prefab 引用、协议回归与 2× 渲染通过；Creator/构建/真机、真实回包未验。服务端仍按既有角色/上级校验。见[只读交接](handoffs/2026-10-26-club-downline-readonly.md)、[代理交接](handoffs/2026-10-26-club-agent-direct-manage.md)。

## 2026-10-26 俱乐部玩家设置弹窗重设计

- 按确认的深蓝金稿重做「俱乐部玩家设置」并直接换肤 `panelMain.prefab`，新增 9 张 `assets/V7/club_settings_*_v8`；业务节点名/事件/绑定与 `.meta` 保留，身份牌拆 Sprite+Label 并按字数定宽，页签改金/灰文字+下划线，加在线状态点。离线 2× 渲染与 Creator 导入通过；构建/真机/真实回包未验。见[交接](handoffs/2026-10-26-club-player-settings-reskin.md)。
- 「我的 → 当前俱乐部」身份牌只在老板/代理时显示；成员身份牌残留的 `_enabled:false` Sprite 已删（曾导致只剩底框），节点 1954 同类未改。Creator 重编译/真机未验。见同一交接。
- 备注/比例输入弹窗的确定、取消按普通弹窗规范重做：220×66、字号 24，取消蓝底金字、确定金底深蓝字；离线渲染通过，Creator/真机未验。见[交接](handoffs/2026-10-26-club-input-dialog-buttons.md)。
- 「设置备注」整行暂时隐藏（Prefab 四节点 `_active:false`，脚本切页签也不再激活），比例行上移到原备注位、代理行上移到原比例位，x 坐标保持。转译、双角色模拟与 2× 渲染通过；Creator/构建/真机/真实回包未验。见[交接](handoffs/2026-10-26-club-hide-remark-row.md)。

## 2026-10-26 俱乐部成员列表改为代理直属口径

- 按 §2.10 新口径：`user_id='ALL'` 只返回自己 + 直属下级（`count` 为直属人数），搜索也在直属范围内。客户端统计/空态改为「直属」，列表不再把直属人数当俱乐部总人数。
- `list()` 新增可选 `agent_id`；「玩家设置 → 下级成员」页签改为查询所选代理的直属成员并过滤其本人，复用现有界面，成员列表本身保持一层。代理可打开玩家设置，仅直属下级可操作。
- 转译与既有申请协议回归通过，另跑了直属/下钻/搜索/空列表临时协议用例；Creator 预览、构建、真机、真实回包未验。见[交接](handoffs/2026-10-26-club-member-direct-scope.md)。

## 2026-10-26 玩家设置弹窗加高与下级成员分页

- 弹窗面板改为 710×1240，下级列表 640×700 一屏 4 行；下级行模板换成成员列表同款九宫格与同结构子节点，内容由 `fillMemberRow()` 两处共用。
- 下级成员只在点「下级成员」页签时请求，过滤回包首行的被查代理本人；任意非本人行的头像点击都会把同一弹窗切到该成员资料（跨级只读见上条）。分页整组从「我的成员」复制（首页/上一页/页码/下一页/末页），仅下级页签显示。
- 服务端 `count` 含被查代理本人，故第 1 页显示 3 行、其余页最多 4 行；总页数仍按 `count/4` 计算。离线 2× 渲染与转译通过；Creator 导入、真实回包、构建、真机未验。见[交接](handoffs/2026-10-26-club-downline-paging.md)。

## 2026-09-29 俱乐部入口与三界面

- `codex/club-ui` 分支把大厅底栏「钱包」改为「俱乐部」，新增俱乐部首页、创建/加入弹窗并接大厅命令通道；俱乐部条目进入大厅查房，按账号记住最近选择。模拟检查通过，真实回包待验。
- 已按反馈修复继承金色导致的全页偏黄，底栏改完整导航图，消除钱包透出及错位。三页离线渲染与引用检查通过；Creator 已重新打开 Prefab，新增管理节点已确认导入；实际点击/回包/真机未验。已提交并推送 `ef9a0da`（origin/main）。见[交接](handoffs/2026-09-29-club-ui.md)。

- 我的页新增当前俱乐部信息、成员/申请列表、权限按钮、红点与确认弹窗；成员页改为全屏并随屏高伸缩。已绑定成员/申请/退出/解散/审批命令与申请红点；回包样例与真实联调待验，详见同一交接。

- 2026-10-21 入口按俱乐部关系定：无俱乐部直接进俱乐部页，有俱乐部进「发现」。见同一交接。

## 2026-09-20 桌内牌局设置 V8

- `panelGameView.prefab` 与 `drh8.fire` 的 `系统设置` 已按 `效果图V8-new/06-桌内界面/10-牌局设置.png` 组件化换肤：新增 31 张 `assets/V7/settings_v8_*` 透明 PNG 与 `.meta`，主框、预览、选中态与控制区均为独立 Sprite。
- Creator 已导入，短屏实测通过；隔离 `panelGameView` handler 的 15 个真实 Cocos 控件测试通过（五桌面、三牌背、三开关双态及关闭；storage/gameLogic 均为 mock）。未登录、未构建、未真机、未提交。见[交接](handoffs/2026-09-20-game-settings-v8.md)。

## 2026-09-20 桌内提醒与功能弹窗 V8

- 房间邀请按新确认蓝金稿实施，替代原通用样式；动态数据与交互保留，Prefab 与 9 张资源已核对 Creator 导入，真实回包与真机待验。见[交接](handoffs/2026-09-20-room-invite-approved.md)。
- 带入积分内“金币余额不足…请先充值”子弹窗统一为温馨提示风格，保留动态金额与关闭；实际点击待验，见[交接](handoffs/2026-09-20-insufficient-dialog-style.md)。
- **后续用户修正：恢复原版温馨提示风格。** `panelMsgView` 已退回本轮修改前版本；五个桌内提示与 VIP 购买确认复用原版整图，其余提示改用同款组件。该修正替代本批弹窗的新 V8 标题方案，系统设置另按已确认稿保留；见[最新交接](handoffs/2026-09-20-original-dialog-style.md)。
- 系统设置、扣费/解散/GPS/举报提醒、排队、通用消息、邀请、VIP、表情等面板已写入正式 Prefab/Scene，仅新增两张共享九宫格约 13KB；`panelGameView/提示` 保留原半透明效果。已修复旧 Sprite 与新 Label 竞争导致文字消失；Creator 重导入、长短屏、构建与真机未验。见[交接](handoffs/2026-09-20-ingame-dialogs-v8.md)。

## 2026-09-20 桌内赠送金币

- `panelGivePad` 已按确认稿换肤，保留动态信息与交互。正式文件直读引擎长短屏/输入及10项回归通过；最终Creator导入待完成，未真实交易/构建/提交。见[交接](handoffs/2026-09-20-give-pad-approved.md)。

## 2026-09-20 玩家信息弹窗 V8-new

- 正式 `panelUserInfo.prefab` 已按新稿组件化换肤，头像修成正圆；仅显示六个对应道具，其余四项仅隐藏。19张独立/九宫格PNG约272KB，RGBA约0.815MiB。动态数据、VIP权限及原道具协议保留，新增关闭/复制ID。
- Creator导入与本地引擎长短屏离线预览已查；未真实登录交互、未构建真机。已提交并推送 `f04a05b`。见[交接](handoffs/2026-09-20-player-info-v8.md)。

## 2026-09-19～20 XuanManager 时间口径修复 + 玩家列表拆列（正式已部署）

- 根因：正式服务器与 MySQL 的 `DATETIME` 本来就是北京时间，额外的 22 处 +8 导致列表时间偏移。后端已去除叠加时差并部署，`go vet`/`go test`、只读回读及健康检查通过；页面视觉未复核，源码未提交。见[时间口径交接](handoffs/2026-09-19-xuanmanager-timezone-fix.md)。
- 登录日期范围和「注册时间 / 最近登录」拆列均已部署正式 8891，页面点击与视觉未复核；详情及回滚点见[日期筛选交接](handoffs/2026-09-19-xuanmanager-player-login-range.md)、[拆列交接](handoffs/2026-09-20-xuanmanager-player-time-split.md)。

## 2026-09-19 大厅「发现」两个入口行为调整

- `panelMain.onButtonClick` 新增两个分支（原无分支、点击无响应）：`举报反馈` 直接 `showPanel("panelKefu",Cover)`，不传 `strUserData`，走默认客服 URL 与 `general` 渠道；`比赛场` 走 `panelMsgView` 弹「暂无比赛，敬请期待！」。
- 只改脚本，`panelMain.prefab` 未动（三个节点的 Button 与统一事件注册均已存在）。**未 Creator 编译、未构建、未真机**；需重新构建后生效。

## 2026-09-16 表情动画替换（hh-poker EMOJI）

- 表情动画换成 hh-poker 素材（VP9 240×240 无 Alpha webm），抠底保留原画黑描边，主体 100px 居中，按 30fps 压成 10 组 373 帧 / 3.69 MB。映射 1～10 → cold…hot；`表情2/<n>.prefab`、`panelTalk.prefab` 图标保留原 uuid 自动换图，表情存活时长改读剪辑时长。脚本 `tools/convert_hh_emoji_anim.py`、`tools/make_emoji_preview.py`，预览 `temp/emoji-preview.html`。**未 Creator 导入、未构建、未真机。**见[交接](handoffs/2026-09-16-emoji-anim-replace.md)。

## 2026-09-16 热更新"清单说有、磁盘没有"自愈

- 真机实测：下载中断留下 `.tmp` 但清单已记 md5 ⇒ 引擎回落旧图且不再补下。`panelUpdate.ts` 启动自检已端到端实测（0 误判、≈90ms）；未重建、未出包。证据与修法见[交接](handoffs/2026-09-16-hotupdate-incomplete-file.md)。

## 2026-09-16 大厅房间行：BY 卡面 + 独立图标

- 大厅→发现→房间列表每行改为「筹码+底皮 / 时钟+时长 / 人数 / 剩余时间」，字段取压缩数组 `[5]/[6]/[3][4]/[2]`；`ScrollItem.ts`、`panelMain.prefab` 已改，卡面重绘为只含 `BY` 盾牌的 1426×260 底框（直接缩放不抠图，UUID 未变），筹码/时钟/人数图标独立成 `assets/V7/room_icon_*.png`。见[交接](handoffs/2026-09-16-lobby-room-row-by.md)；未 Creator 导入、未构建。

## 2026-09-15 资源打包体积与 V7 移出 resources

- `assets/resources/` 会无条件整目录打包；原 `V7/` 已移到 `assets/V7/`（`.meta`/UUID 未变），重建后约减 60.9 MB。反查引用须扫 `.meta`，代码拼接路径的资源不能按“未引用”处理；未验项与证据见[交接](handoffs/2026-09-15-asset-bundle-audit.md)。

## 2026-09-08 效果图目录约定

- 已确认页面以 `design-previews/效果图V8-new/` 现存稿为准（09-14 核对 49 张，桌内 7 张已删除）；旧 V7、原 V8 及其它历史稿不作为并列母版；设计删除或确认均不代表正式 Prefab 已迁移。见[定稿入口](../../design-previews/README.md)。
- 09-08 已删除新版目录中的直接拷贝稿并重绘公告、钱包、登录、大厅及后续模块 29 张（中亮蓝青底、浅象牙金字、文字放大）；不得用旧图直拷或仅滤镜替代，也不得回退到旧 V8 深蓝黑色调。

## 本轮实时核对：记忆整理

- 当前目录 `/Volumes/SSD/qing`，Creator 2.4.13；进入新任务仍须重查分支与未提交修改。记忆体系（入口/状态/专题/归档/只读检查）迁移证据见[整理交接](handoffs/2026-09-05-memory-migration.md)；`build` 原生工程与 `runtime-src.zip` 均保留，不能当普通缓存删除。09-13 的提交推送授权见[提交交接](handoffs/2026-09-13-commit-all.md)。

## 2026-09-11 V8 全套实施

- 09-11 起按 `效果图V8-new` 全页换肤并兼容长短手机，逐页状态见[全套进度](handoffs/2026-09-11-v8-all-pages.md)；大厅/公告菜单为连续背景+独立装饰，[充值](handoffs/2026-09-13-wallet-recharge-v8.md)、[钱包与金币流向](handoffs/2026-09-13-wallet-pages-and-money-v8.md)已写入正式 Prefab。注册弹窗见[交接](handoffs/2026-09-11-register-v8-exact.md)；56 图全套未完成。
- 09-13～15 的[代理](handoffs/2026-09-13-agent-v8.md)、[推广](handoffs/2026-09-13-promotion-shared.md)、[密码](handoffs/2026-09-13-password-pages-v8.md)、[设置](handoffs/2026-09-13-settings-v8.md)、[钱包/实名](handoffs/2026-09-13-wallet-first-realname.md)、[提现](handoffs/2026-09-13-wallet-withdrawal-controls.md)、[我的档位](handoffs/2026-09-15-mine-stake-playcount.md)、[房卡底框](handoffs/2026-09-15-lobby-room-card-cutout.md)等均未构建发布。待确认稿：[回顾](handoffs/2026-09-14-ingame-review-design.md)、[实时战绩](handoffs/2026-09-14-realtime-record-design.md)、[带入积分](handoffs/2026-09-14-buyin-design.md)、[奖池](handoffs/2026-09-14-jackpot-popup-design.md)。
- 历史提交观察（`16275a8`、`2f614ba`、`db5b60f`）均已失效，提交与推送一律以 Git 实时状态为准。

## 2026-09-10 登录页重叠与背景衔接修复

- 用户否决首轮实现后重做正式 Prefab：关闭拉伸整稿的根 Sprite，独立背景、盾牌、输入框、链接与登录按钮同一等比居中坐标，原业务节点及事件保留；修复后布局尚未获得用户最终验收。本地提交 `63b9ef0` 已按用户要求 mixed reset 撤回（回到 `db5b60f`），未创建反向提交或丢弃文件。
- 上下延展背景不连续问题改为单张完整无控件底图，窗框连续、底部只保留一条桌沿，控件按轮廓保留原像素。Creator 导入与正式 PNG 一致，iPhone 6/X 网页显示、输入/清除及注册弹窗开关已查，四档静态布局通过；未构建、未真机、未真实登录注册。见[修复交接](handoffs/2026-09-10-login-overlap-fix.md)。

## 最近报告的 UI 状态

共同边界：以下为历史模块记录，登录页以 2026-09-10 修复状态为准；历史阶段未执行 Creator 构建，其他版本的构建成功不能计入 V7。

- 逐页“最近报告 / 保留的未完成验证 / 来源行号”完整表格已移至[归档](archive/2026-09-15/ui-status-table.md)；当前进度以[全套进度](handoffs/2026-09-11-v8-all-pages.md)为准。
- 高频未验证项：原生热更新下载与异常重试、启动/模板 Splash 停留态；登录动态输入与注册回包；大厅真实筛选与动态值；战绩/结算/回顾回包与回放；排行榜领奖；实名页提交与真实交易。

## V7 历史实施边界

V7 的详细实施经过已保留在[阶段快照](archive/2026-09-11/v7-implementation-before-full-reskin.md)。它用于核对业务节点、验证缺口和已否决方式；本次 V8 进度以上方全套任务清单为准，不能将旧视觉检查自动计入新稿。

## 待核实项与工作边界

1. 2026-09-05 已核对 `panelQianBao.ts`：“确认充值”仍显示“暂未开通，后续处理”并提前返回。本轮只修选择和美术，不代表充值业务恢复。
2. 旧概况第 35 行仅提 `runtime-src.zip`，而恢复记录第 24 行明确包括 `build` 内原生工程。原生开发/打包前须核实实际入口与保留范围；不能把全部 `build` 当可随意删除的缓存。
3. 旧活动路径 `/Volumes/CCCC/qing` 已由 SSD 恢复及本轮目录核对取代；旧路径、旧磁盘健康及旧部署结果仅作历史证据。
4. V7 只覆盖已确认并有模块实施记录的页面。牌桌、动画及其他未列入范围的设计不得因旧章节被归档就自动判废；具体任务按对应模块证据确认。
5. 下一次开发从用户指定页面/问题开始，先读对应专题和任务交接，再核实目标文件与未提交差异。表内待验证项是已知缺口，不构成执行交易、构建或发布的授权。

上述待核实项来源：[原文归档](archive/2026-09-05/AGENTS.original.md) 第 23–24、35、39、458、599 行。状态变更后改写本页相关条目，不在页尾持续堆叠过程日志。
