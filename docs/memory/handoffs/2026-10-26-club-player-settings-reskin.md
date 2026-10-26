# 2026-10-26 俱乐部「玩家设置」弹窗重设计落地

## 目标与范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；配置：Cocos Creator 2.4.13。
- 需求：按用户确认的推荐版（深蓝金）效果图，重做「俱乐部玩家设置」弹窗美术并直接写入正式 Prefab。
- 效果图：`design-previews/待确认/2026-10-26-俱乐部玩家设置/01b-推荐版-750x1334实际尺寸.png`（主依据）、`01-推荐-深蓝金版.png`、`03-对比-现状vs重设计.png`。
- 保留：全部业务节点名、事件绑定、动态文本绑定、`.meta`/UUID；本轮未提交、未推送。

## 改动

### `assets/resources/UI/panelMain.prefab`

- 面板底板换为新素材 `club_settings_panel_v8`（674×820，九宫格 border 32），标题分隔线 + 菱形改由「标题」「下级成员底」两个旧节点改名承担（`标题分隔线` / `标题菱形`），无脚本引用这两个名字。
- 头像区、姓名、ID、复制 ID、身份徽章、状态、积分、两个右侧操作按钮、两个页签、三行设置项、下级成员列表全部按效果图重排；面板高度保持 820（原节点尺寸），纵向间距压缩。
- 身份牌拆成两个兄弟节点：`身份底`（Sprite，九宫格 badge，排在前面）承载徽章底，`玩家身份` 只留 Label（原同节点 Sprite 保留但 `_enabled:false`），以满足「一个节点只挂一个渲染组件」。
- `玩家状态` 下新增子节点 `状态点`（14×14 圆点），在线时显示。
- 页签只保留文字与选中下划线：四个页签节点的 Sprite 置为 `_enabled:false` / `_spriteFrame:null`，切换仍由原节点开关完成。
- `玩家设置踢出俱乐部` 的 Sprite 由九宫格改为 SIMPLE：素材 240×76 圆角半径大于 border 24，九宫格在 170×58 下会把两端压成尖角。
- 下级成员行模板的「姓名」由 x=-190 移到 -160，避免文字贴住行卡左边缘。
- 节点/组件数核对（相对换肤前备份）：Node +4、Sprite +5、LabelOutline +2；Label 301、Button 163、EditBox 19、Toggle 9 均未变。

### `assets/scripts/UI/ClubManagementView.ts`

- `openPlayerSettings()` 中按状态设置「玩家状态」颜色并切换「状态点」：在线为绿色 (155,255,109)，其余为 (201,216,228)。
- 第二轮（运行反馈）：身份牌改由 `roleText()` 归一化为 老板/管理员/代理/成员；`layoutRole()` 按字数把 `身份底` + `玩家身份` 一起定宽（60/80/104），左边界固定 -150，并把 `玩家状态` 同步右移，避免三字身份压住状态点。
- `showPlayerSettingsTab()` 增加 `成员设置选中菱形` / `下级成员选中菱形` 的显隐。

### 新增素材 `assets/V7/club_settings_*_v8.png` + `.meta`

- `panel`（674×820）、`row`（584×64）、`list`（584×300）、`pill`（250×56）、`badge`（60×28）、`outline_btn`（240×76）、`rowbtn`（120×48）、`diamond`（20×20）、`dot`（16×16）。
- 均为独立 UUID、`trimType:"none"`、alpha 覆盖整张画布；大图 `packable:false`。
- 复用且未改动的既有素材：赠送金币按钮（`original_dialog_button_gold`）、关闭按钮、头像框、代理开关（`开/关`，与 `panelGameView` 共用）。

## 验证

- 已通过：Prefab JSON 解析；节点/组件数量对比；`git diff --check`；离线 2× 渲染（自行模拟 SIMPLE/九宫格与 Label）与效果图逐区比对，修正了九宫格 insets 视为 2× 像素导致的假性错位、踢出按钮尖角、行模板贴边。
- Creator 已在 12:50 导入 9 张新素材；二轮改动后 Prefab 末次写入 13:10:55，Creator 于 13:12:21 重新导入（`library/imports/d0/d0921080-*.json` 可查到 `身份底`、两个菱形、ID fs25、金色选中线），说明编辑器已接受新增节点。
- 离线渲染图：`/tmp/qing_gen/render_popup.png`（成员设置页）、`/tmp/qing_gen/render_sub.png`（下级成员页）。

## 第二轮：按运行截图修正（2026-10-26）

用户反馈：名字颜色不对、ID 偏小、身份牌不显示、页签按钮与文字颜色不一致。实测对照后处理：

- **身份牌整块不显示**：原实现把徽章 Sprite 和身份 Label 挂在同一个 `玩家身份` 节点上。Cocos 2.x 一个节点只保留一个渲染组件（`node._renderComponent` 后写覆盖），且运行包里该 SpriteFrame 若未取到会连 Label 一起不渲染——实测运行截图里两者都没有。已拆成两个兄弟节点：`身份底`（Sprite，九宫格 badge）排在 `玩家身份`（纯 Label）之前，原 Sprite 保留但 `_enabled:false`，`.meta`/UUID 未动。
- **名字颜色**：由纯白改为效果图取样到的暖白 (255,250,236)，并给 `玩家姓名` / `玩家ID` 加 `cc.LabelOutline`（宽 2、深蓝 (8,26,46,190)），对齐效果图的描边观感（panelMain 原本就有 119 处 LabelOutline，属既有做法）。
- **ID 放大**：`玩家ID` 字号 22→25、行高 32、节点高 38、颜色 (255,252,244)；文字右端变长，`玩家设置复制ID` x 从 -19 移到 0 避免压字。
- **页签颜色/下划线**：选中文字 (255,236,166)、未选中 (228,224,218)；选中线由白色 1px 文本占位改为金色 (255,212,138)、140×4；新增 20×20 金菱形 `成员设置选中菱形` / `下级成员选中菱形`（复用 `club_settings_diamond_v8`），随页签一起切换，对齐效果图的「金线 + 中心菱形」。
- 离线复检：`/tmp/qing_gen/render_popup.png`、`/tmp/qing_gen/render_sub.png` 两个页签状态均正常；`check_memory.py` 见下。

## 第三轮：俱乐部首页身份牌对成员留空（2026-10-26）

用户反馈「玩家是成员时身份牌位置是空的」。定位到不是玩家设置弹窗（弹窗内 `roleText()` 对 `member` 恒返回「成员」，且 `身份底`/`玩家身份` 已拆分），而是「我的 → 当前俱乐部」卡片：`ClubManagementView.Refresh()` 里 `showIdentity = !!next.id && next.role !== "member"` 会把纯成员的身份文字和底图一起隐藏，右侧身份位因此留空。

- `assets/scripts/UI/ClubManagementView.ts` L146-149：改为只要在俱乐部里就显示，纯成员写「成员」，老板/管理员/代理映射不变（`身份底` 同步显示）。
- 离线渲染 `/tmp/qing_gen/card_member.png`（成员态）：皇冠身份牌 + 「成员」居中显示，与管理员/代理同款底板，未压到左侧名称或右侧按钮。

## 第四轮：「我的」身份牌只保留老板/代理（2026-10-26，替代第三轮）

用户要求：当前俱乐部的角色标签若为成员，右侧不显示标签和文字，只有代理和老板才显示。

- `ClubManagementView.Refresh()`：`showIdentity = !!next.id && (next.role === "owner" || next.role === "agent")`；`身份` 文本仅在这两种角色时写「老板」/「代理」，`身份底` 同步隐藏。
- 按「只有代理和老板」的口径，管理员也不显示；若后续需要管理员显示，在条件里补 `role === "manager"` 并恢复「管理员」文案即可。
- 未做：Creator 重编译、运行/真机验证。

## 第五轮：成员身份牌偶发只剩底框（2026-10-26）

用户反馈：玩家信息弹窗里目标是普通玩家时，身份牌有时候只有空的背景框、有时候正常。第一轮拆分时把「原 Sprite 保留但 `_enabled:false`」当作兼容做法，实际正是残留原因。

根因（引擎代码可查，`2.4.13`）：

1. `RenderComponent.__preload()` 对 `_enabled:false` 的组件同样执行（`node-activator.js` 只对 `onEnable` 判 `_enabled`），其中 `_resetAssembler → setVertsDirty → markForRender(true) → markForValidate()` 会把这个禁用 Sprite 登记进 `RenderFlow` 的校验表；徽章贴图异步加载完成后 `Sprite._applySpriteSize()` 的 `setVertsDirty()` 还会再登记一次。
2. `RenderFlow.validateRenderers()` 对 `enabledInHierarchy === false` 的已登记组件直接 `disableRender()`；它清的是 `this.node._renderFlag`，与同节点的 Label 共用。
3. `Label._validateRender()` 在字符串非空、材质存在时**直接 return**，不会重新置位渲染标志。
4. 因此底框（另一个节点 `身份底`）照常绘制，Label 却停止绘制。之后再无 dirty：成员目标的 `玩家身份` 字符串与节点尺寸本就等于序列化默认值（「成员」/60×28），`text()` 和 `setContentSize()` 都走 no-op；代理/管理员/老板会改文字或宽度，触发 `setVertsDirty` 自动恢复——与「只有玩家（成员）偶发」完全吻合。开关弹窗会走 Label `onEnable → _forceUpdateRenderData` 重新置位，所以表现为「有时候又正常」。

修法：删除 `玩家身份` 节点上残留的 `cc.Sprite`（原对象 3689），该节点恢复为单渲染组件；`身份底`（Sprite）继续承载徽章底图。删除后按序列化顺序整体重排 `__id__`（3834 → 3833 个对象），脚本内断言：全量 `__id__` 无越界、1714 条 node→component 链接指向自身节点、`玩家身份` 只剩 Label、`身份底` 顺序在 Label 之前。

验证：JSON 往返结构检查通过；`STATE=member` / `STATE=readonly_member` 离线 2× 渲染正常（身份牌文字居中显示）。另外用无头 Chrome + 2.4.13 引擎写了探针（`/tmp/qing_gen/badge_test/index5.html`）：对 `_enabled:false` 的 Sprite 调 `setVertsDirty()` 后 `_inValidateList` 变 `true`，接着调 `RenderFlow.validateRenderers()` 会走非启用分支 `disableRender()`；该探针页缺内建材质，Label 自身也会被 `_validateRender` 关掉，所以只用于验证「登记 + 清理」这两步，不能当作完整复现。**未做**：Creator 重新导入、场景内实际打开弹窗复现、构建、真机、真实回包。另：`panelMain.prefab` 节点 1954 `V8个人信息标题` 仍是 Sprite 启用 + Label 禁用，属同一类隐患（禁用 Label 同样会被登记并 `disableRender()`），本次未改，需要时按同法清理。

## 未验证 / 注意

- 后续修正：备注/比例输入弹窗的确定/取消按钮改为 220×66、字号 24，确定文字改深蓝，取消保持蓝底金字；见[输入弹窗按钮交接](2026-10-26-club-input-dialog-buttons.md)。
- Creator 已重新导入 Prefab；未做 Creator 场景预览、构建、真机。
- 代理开关沿用项目现有金环蓝色轨道美术，与效果图的灰色关闭态不同；因与 `panelGameView` 共用未改。
- 本轮时期面板高度为 820（效果图约 970）；后续已在[下级分页交接](2026-10-26-club-downline-paging.md)中按用户要求加高到 1240。
- 真实玩家数据（头像、积分、在线状态）未联调。

## 下一步

1. 在 Creator 中打开 `panelMain.prefab`，检查面板与两个页签的实际显示。
2. 真机/模拟器核对在线状态颜色与状态点在长昵称、代理身份下的表现。
3. 如需完全贴合效果图，再评估面板加高与代理开关独立美术。
