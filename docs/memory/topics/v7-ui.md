# V7 已确认页面与实施入口

更新时间：2026-09-05

本文是 V7 专题索引，适用于已有确认稿和实施记录的页面。牌桌、动画或未列入范围的页面不得仅因本文存在就套用 V7 或废弃其原设计。当前状态见 [CURRENT.md](../CURRENT.md)，旧新取舍见 [DECISIONS.md](../DECISIONS.md)。

证据来源：[原始记忆归档](../archive/2026-09-05/AGENTS.original.md)；下文引用“原文第 N 行”均指该文件。2026-09-05 本轮只核对所列主要目录/文件存在，未运行生成器、校验器、Creator 或账号测试。所有“已实施”“已通过”均是原文对应日期的报告，不是本轮重复验收。

## 视觉依据和实现契约

- 六页主目录：`design-previews/2026-09-04-V7确认风格六页统一版/`；大厅最终风格来源为 `design-previews/2026-09-04-上一版蓝色与美术字校色/大厅-美术字-参考图边框-顺滑盾牌-v7.png`。六页保持 V7 的蓝色、纹理层次、蓝灰低浮雕边框、美术字和顺滑盾牌；不同稿件像素尺寸不相同，不能把截图像素当成所有 Prefab 的设计尺寸。来源：原文第 59 行。
- 必须把视觉写入正式 Prefab/Scene，并引用 `assets/resources/V7/` 等正式资源；源母版在 `art_sources/v7/` 等对应目录。运行脚本只负责业务、交互和真实动态值，不为换肤批量造美术节点或覆盖布局。来源：第 58 行。
- 通用伸缩约束：页面容器四边拉伸；顶部标题/主视觉 Top 固定，底栏/返回 Bottom 固定，列表 Top+Bottom 伸缩。新增屏幕高度只进入中间区。原文常用 750×1334 基准，并检查高度 1334/1500/1624/1778；具体页固定区尺寸以专题和最新 Prefab 为准。
- 可拉伸底板用九宫格；盾牌、Logo、图标、美术字独立高清、保持比例。固定 750×1800 长母版 Top 固定、禁止整图九切。公告内框可采用专门九切底框；不能把“长母版禁九切”误解成禁用所有九宫格。来源：第 45、47、50、58 行。
- 原交互、动态字段、头像加载和用户保护的节点继续保留；确认稿的示例数字不代表真实账号。不得因换肤改变服务端业务语义或为缺失功能造数据。来源：第 41、45、52、55、57–58 行。

## 页面索引

以下 Prefab 路径和工具均相对于项目根。表中“工具”是检索/审阅入口，**不是应整批执行的命令列表**；提取/生成/应用/修复工具可能写入正式资产，运行前检查范围及未提交差异。

| 页面 | 确认稿/正式 Prefab | 专用工具与原文来源 |
|---|---|---|
| 登录、大厅 | 六页目录；`assets/resources/UI/panelLogin.prefab`、`assets/resources/UI/panelMain.prefab` | 大厅精修：`tools/extract_v7_lobby_exact_assets.py`、`tools/apply_v7_lobby_exact.py`。第 56、58–59 行 |
| 我的 | 六页目录 `03-我的.png`；`assets/resources/UI/panelMain.prefab` | `tools/extract_v7_mine_exact_assets.py`、`tools/apply_v7_mine_exact.py`。第 57 行 |
| 战绩 | 六页目录 `04-战绩.png`；`assets/resources/UI/panelRecordList.prefab`、`assets/resources/Prefabs/战绩对象.prefab` | `tools/extract_v7_record_exact_assets.py`、`tools/apply_v7_record_exact.py`。第 53 行 |
| 赠送 | 六页目录 `05-赠送.png`；`assets/resources/UI/panelMain.prefab`、`assets/resources/Prefabs/赠送记录对象.prefab` | `tools/extract_v7_gift_exact_assets.py`、`tools/apply_v7_gift_exact.py`。第 54–55 行 |
| 结算 | 六页目录 `06-结算.png`；`assets/resources/UI/panelRecordInfo.prefab`、`assets/resources/Prefabs/战绩玩家对象.prefab` | `tools/extract_v7_settlement_exact_assets.py`、`tools/apply_v7_settlement_exact.py`。第 52 行 |
| 钱包充值/提现/记录 | `design-previews/2026-09-05-V7钱包三页效果图-v1/`；`assets/resources/Prefabs/钱包.prefab`、`assets/resources/Prefabs/交易查询对象.prefab` | `tools/extract_v7_wallet_exact_assets.py`、`tools/apply_v7_wallet_exact.py`。第 39 行 |
| 公告菜单 | `design-previews/2026-09-04-V7公告菜单高清效果图-v1/`；`assets/resources/UI/panelMain.prefab` | 正式长图 `assets/resources/V7/announcement_menu_long_exact.png`；对应约束由响应式工具维护。第 50 行 |
| 公告四个详情 | `design-previews/2026-09-04-V7公告详情四页效果图-v2/`；`assets/resources/UI/panelMain.prefab` 内 `公告1/2/5/6` | `tools/apply_v7_announcement_detail_exact.py`；最新公告框为 `tools/extract_v7_announcement_detail_latest_panel.py`。第 47 行 |
| 公告和提示弹窗 | `design-previews/2026-09-04-V7弹窗效果图-v2/`；`assets/resources/UI/panelNotifyView.prefab`、`panelNotifyViewCZ.prefab`、`panelNotifyViewHD.prefab`、`panelMsgView.prefab`（后三项同目录） | 按原文查对应 Prefab 与 `panelMsgView.ts` 的业务分支，未指定新生成器。第 51 行 |
| 后续模块 V3 | `design-previews/2026-09-05-V7后续模块全套效果图-v3/`；主页面/代理/排行榜/预留信息，见下节 | `tools/extract_v7_followup_exact_assets.py` 及对应页面应用工具。第 45 行 |

`tools/apply_v7_prefab_skin.py`、`tools/generate_v7_runtime_skin.py` 是原文第 58 行的早期 V7 实施入口；同段及后续记录已有页面专用精修。不得因为文件名含 V7 就默认重跑全套并覆盖精修。

## 后续模块以 V3 为准

2026-09-05 V3 报告已落入正式 Prefab：推广、金币流向、系统设置及密码页在 `assets/resources/UI/panelMain.prefab`；代理首页、列表、推广和确认层在 `assets/resources/UI/panelHongli.prefab` 及其五类代理行 Prefab；排行榜为 `assets/resources/Prefabs/排行榜.prefab`、`assets/resources/Prefabs/排行榜对象.prefab`；预留信息为 `assets/resources/UI/修改预留信息.prefab`。原文第 45 行；第 41/43 行 V1/V2“仅生成效果图”只保留历史，不再代表当前报告状态。

应用入口分别为 `tools/apply_v7_followup_main_exact.py`、`tools/apply_v7_followup_agent_exact.py`、`tools/apply_v7_followup_ranking_exact.py`、`tools/apply_v7_followup_reserved_exact.py`。750×1800 母版固定 Top，顶部和底部分页不能进入 ScrollView，列表承接新增高度；分页复用赠送页五键美术，弹层遮罩全屏。

“修改预留信息”早期稿的姓名/银行卡流程已纠正，必须遵守既有 `panelYLinfo.ts` 协议：账号、两次中文预留信息、验证码。V3 不代表已实现新的银行卡业务。真实数据、按钮回包、滚动手感仍待登录态联调；原记录未执行 Creator 构建。

## 容易回退的页面细节

### 大厅、我的

- 大厅底栏顺序为“公告、客服、8L、钱包、我的”，独立留底部安全区；房间值来自真实服务端数组映射，不把确认图数字写成运行数据。`ScrollItem.ts` 承担字段映射，不承担换肤布局。大厅“排行榜、比赛场、举报反馈”等入口与业务实现状态分别判断。来源：第 56、58 行。
- 2026-09-05 大厅筛选栏“有空位”选中勾修正：`filter_bar_exact.png` 内置方框中心约为素材 x=587.5；其父节点“空位条件”位于 x=295，因此 `有空位/Background` 与 `有空位/checkmark` 均固定为 x=-60、y=0、32×32。应用工具和响应式校验保持同一约束，不能回退到导致勾向右偏 16px 的 x=-44；业务 Toggle 与筛选逻辑不变。详见[本轮交接](../handoffs/2026-09-05-lobby-free-seat-checkbox.md)。
- 我的资料卡保留真实头像、昵称、ID、金币和五项统计；五档底皮手数原记录仍为静态 0。复制 ID 使用独立透明 Button 和真实返回结果。Prefab 默认非代理五入口，真实代理账号恢复六入口，不能为统一静态截图删除该差异。来源：第 57 行。

### 战绩、结算

- 战绩日期协议 `0=今日、-1=昨日、-2=前日`，默认今日；每页 6 条，尾页请求为 `nTotlePage-1`。字段为房间号、底注、带入、输赢；确认稿未画分页，原记录按用户要求复用赠送五键分页。来源：第 53 行。
- 结算荣誉语义为“土豪=最高带入、MVP=最高输赢、大鱼=最低输赢”，不能改成亚军/季军。保留原 `排行/排队` Button、`排行/排队/pd` Spine 和业务显隐；历史战绩打开结算时按原逻辑隐藏。来源：第 52 行。
- 头像和金属框应分层，源稿人像孔先清为统一深蓝，再提取抗锯齿框，避免残留参考人像。原记录发现人物根/前景框旧缩放分别为 0.84/1.15 导致错位，应用工具已显式恢复相关节点为 1.0；不能仅凭静态合成判断真实 Prefab 正确。来源：第 52 行。

### 赠送、钱包

- 赠送直接读取页内 ID、金额、交易密码并沿用原提交协议，已取消二次密码弹窗；成功后刷新记录并清空三项，失败保留输入。真实转账成功/失败回包未验证，不能从静态断言推导资金流程通过。来源：第 54 行。
- 赠送真实记录的头像继续使用既有 `ImageManager`；原预览记录为空，有数据列表仍待验。钱包记录每页 5 条，与战绩每页 6 条不同。来源：第 39、53、55 行。
- 2026-09-05 赠送页视觉修正：用户否定顶部两只写实手部，并指出列表背景擦除不净。`gift_hero_exact.png` 已改为无人物、无手部的冷蓝筹码/金币流光主视觉；`gift_list_panel_exact.png` 不再从三条样例记录中擦除，而由连续 V7 蓝色材质重建，禁止保留横向样例分层。正式 UUID、Prefab 节点、输入区、动态记录行和头像逻辑不变，详见[本轮交接](../handoffs/2026-09-05-gift-visual-cleanup.md)。
- 钱包充值渠道/金额组按 Top 固定，页面四边拉伸，中部承接新增高度；嵌入大厅时隐藏共享 `Down`，返回恢复发现页及底栏；独立钱包按原方式关闭。第 39 行是换肤记录，不能据此把第 458 行旧充值临时拦截认定已解除。
- 2026-09-05 通道修复：`Background` 使用正式 V7 卡片，`checkMark` 使用共用透明金框和勾角标，禁止选中层再烘焙固定图标/文字。Sprite 始终启用，由 Toggle 控制节点显隐，选中层最后绘制。原通道 1/3、2/4 同位置会遮挡，已迁入“根/通道视口/充值渠道”的原生两列 Grid 和纵向 ScrollView；首次/重入选首项后滚回顶部。TS 保留服务端图标映射，四个 `payment*Icon` 绑定 V7；应用与布局工具同步规则，详见[本轮交接](../handoffs/2026-09-05-wallet-channel-selection.md)。钱包记录面板和记录行仍只用无示例数据的干净底板。

### 推广、金币流向、列表和分页

- 游戏推广与代理推广的二维码及“推广链接”必须使用同一个运行时真实注册地址；Prefab 预制动态 Label，脚本只写入真实值，不在运行时创建美术布局。不能把效果图示例域名烘焙为业务地址。
- 2026-09-05 游戏推广广告页方向修正：用户否定偏暖黄、传统赌场海报感和金色大框，确认 `design-previews/2026-09-05-V7游戏推广冷蓝广告页效果图-v5/` 的冷深蓝方案，并要求顶部与其他 V7 页面统一。实机截图又暴露图标错位、信息区拥挤、长屏下方空白过大和地址过小；因此正式 `followup_promo_master_long.png` 只保留无字冷蓝舞台/地面，统一标题栏、`shield_hd.png`、主标题、二维码框、信息卡、复制按钮和双操作按钮均为独立高清资源及 Prefab 节点。说明、二维码、信息卡、ID/地址和按钮组使用屏幕垂直中心 Widget，1334、1500、1624、1778 四档高度随屏幕整体下移并保留段间距；ID 字号 26、地址字号 22，二者右侧按钮复制运行时真实值。不能回退到暖黄，也不能把示例二维码、ID、链接或操作图标烘焙进背景。
- 金币流向当前确认结构不显示“收入、支出、当前余额”汇总卡，也不显示收入/支出/时间等条件切换；保留“金币明细”表头、真实记录和翻页。时间列使用单行 `SHRINK`，避免中文日期时间被从中间换行切断。
- 所有 V7 数据列表的外框和表项须分别使用干净底板：外框不得含样例行，单行卡片不得含样例文字、图标或多余分隔线。带分页的页面沿用赠送页五键语义与材质，可按页面宽度等比收紧，但不能混用旧白色箭头或不协调底栏。
- 750×1800 页面不得用窄条镜像或多段图片拼成长背景。保留上部赌场构图，过渡区渐隐到一张完整的长桌面纹理；这样短屏裁切、长屏显示都不会出现接缝、重复条带或下半段色块。

### 公告、弹窗

- 公告菜单被否决的两种方案：整图九切拉长盾牌/牌/筹码；上下图片拼接产生色块、重复纹理、接缝。最终保留确认稿上部构图，只在下方桌面延展成一张 750×1800 图；旧补底节点不参与渲染。来源：第 50 行。
- 固定公告页的原文、数字、花色和几何必须保持。公告详情 V2 的静态正文直接来自确认稿；不能 OCR 后重输或美化成新业务文案。来源：第 47、68 行。
- 最新公告使用 `announcement_detail_latest_exact.png` 固定框和标题，正文单独在内层视口滚动；原约束为左右 65、上 130、下 55，正文宽 570、字号 24、行高 38；内容高度取真实排版高度与内框高度的较大者。旧 3000 像素空框已否决。来源：第 47 行。
- 公告弹窗隐藏右侧滚动条图形，保留触控滚动；右上“关闭”和底部“确定”均有透明热区。公告初始化设置正文后必须退出普通单双按钮排版，否则会查找不存在节点造成空引用，使关闭看似失效。来源：第 51 行。
- 公告弹窗正文承载区必须是一块连续生成的蓝色面，不得采用横向复制、逐条擦除或修补带示例文字的旧图；后者会留下密集横条并在不同高度下放大。标题、双层金边和按钮仍保持独立固定区域，动态正文只在内层 ScrollView 中滚动。

## 检查与工具风险

- `tools/validate_v7_responsive_layout.py` 在第 58 行明确记录为只读检查，覆盖四档高度、Prefab 内部引用、V7 SpriteFrame 和显示状态；后续第 39、47、51–57 行添加页面约束。**本轮只核对路径存在，未读取当前全部实现或运行它**；以后执行前仍应核对当时版本的副作用。
- `tools/repair_v7_responsive_layout.py` 会写入布局，不是只读检查；页面精修应同步其对应规则，避免后续修复把页面退回旧尺寸。提取、生成、应用工具也不是只读。
- **旧 `tools/validate_qin_drh8_skin.py` 不是只读校验。**原文第 560 行明确：它执行两轮完整换肤生成器、改写 141 张运行资源和预览图。存在用户手调桌布、牌背或未提交美术时禁止直接运行；不能把它作为本专题的默认验收。
- 旧全量 `generate_8l_full_skin.py`、秦风生成器和 `style_record_info_8l.py` 的历史“必跑/权威”说法不覆盖本专题页面专用 V7 入口。未进入 V7 的牌桌或动画，仍需单独审阅对应历史与当前文件，不能全局删除旧工具。
- 外部修改 Prefab 后，Creator 必须重新读取资源；单点网页 Recompile 可能继续使用旧 Prefab。若预览异常跳过登录，原第 58 行报告过已移除的 QA 代码仍留在 `library/imports/` 与 `temp/quick-scripts/`，应核实导入缓存并按当前授权刷新，不能修改正常登录逻辑去绕过。

## 验证记录如何续写

原文最近记录分别报告过 Prefab/UUID 检查、四档布局断言、Python 语法、`git diff --check`、Creator 资源导入/快速编译，以及部分 iPhone 6/iPhone X 网页预览；没有因此证明真实交易、后台回包、全部动态数据和真机通过，也没有证明已构建或发布 V7。

本轮整理新增的验证仅为文档/路径核对。下一次相关任务只更新该页面的：日期、修改范围、实际执行的检查、结果、未验证项及最终确认稿；当前摘要写入 [CURRENT.md](../CURRENT.md)，过程进入任务交接。构建、账号交互或发布是否执行，以当前请求和已有明确授权为准。
