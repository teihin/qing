# 游戏使用美术：BY → BF 替换清单

更新时间：2026-11-02 　项目：`/Volumes/SSD/qing` 　分支：`codex/club-ui`

## 目标与边界

- 将**游戏实际使用的美术资源**中可见的 `BY` 替换为 `BF`。
- 保持原图的构图、尺寸、透明通道、材质、描边、光泽、阴影、颜色和整体风格；只改字母内容。
- 本清单是后续多对话并行制作与确认的分工依据。每个任务只能处理自己负责的 PNG，不能改动其他任务的正式资源。
- 默认不改 `.meta`、Prefab、Scene、TypeScript、JavaScript 和资源 UUID。替换图应保持原像素尺寸与透明边界，避免触发引用迁移。
- `build/`、`hot-update-output/` 属于生成/发布产物，本清单只列源资源；完成正式源资源后再按构建流程更新产物。

## 当前核对结论

共确认 **33 个正式运行 PNG** 需要替换。判定依据包括：当前 Prefab/Scene 的 UUID 引用、脚本动态资源路径、DragonBones 图集引用、当前热更资源清单，以及对图内文字的放大人工复核。

### A 组：大厅、登录、俱乐部、公告、代理和钱包界面

| 编号 | 正式运行资源 | 当前使用证据 | 图内 BY 位置 / 替换范围 | 状态 |
|---|---|---|---|---|
| A-01 | `assets/ImagesLuck/大厅/秦_发现按钮.png` | `assets/resources/UI/panelMain.prefab` | 发现入口中央盾牌 `BY` | 已替换（本轮） |
| A-02 | `assets/ImagesLuck/游戏内/LOGO.png` | `assets/Scenes/drh8.fire`、`assets/resources/UI/panelGameView.prefab` | 牌桌 Logo 中央 `BY` | 已确认（已有 BF 版本，跳过） |
| A-03 | `assets/V7/agent_v8_promotion_banner.png` | `assets/resources/UI/panelHongli.prefab` | 推广横幅左侧盾牌中的 `BY` | 已替换（本轮） |
| A-04 | `assets/V7/agent_v8_shield.png` | `assets/resources/UI/panelHongli.prefab` | 代理页盾牌中央及上下英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-05 | `assets/V7/announcement_detail_header_exact.png` | `assets/resources/UI/panelMain.prefab` | 公告详情底纹 Logo 的 `BY` | 已替换（本轮） |
| A-06 | `assets/V7/announcement_detail_latest_exact.png` | `assets/resources/UI/panelMain.prefab` | 最新公告底纹 Logo 的 `BY` | 已替换（本轮） |
| A-07 | `assets/V7/announcement_menu_long_exact.png` | `assets/resources/UI/panelMain.prefab` | 公告菜单盾牌及英文 `BY` | 已替换（本轮） |
| A-08 | `assets/V7/club_home_header_v8_exact.png` | `assets/resources/UI/panelMain.prefab` | 俱乐部页主标题盾牌中的 `BY` | 已确认（已有 BF 版本，跳过） |
| A-09 | `assets/V7/club_nav_bar_v8.png` | `assets/resources/UI/panelMain.prefab` | 底部导航中央徽标 `BY` | 已确认（已有 BF 版本，跳过） |
| A-10 | `assets/V7/leaderboard_v8_hero_title.png` | `assets/resources/Prefabs/排行榜.prefab` | “BY 荣耀榜”中的 `BY` | 已确认（已有 BF 版本，跳过） |
| A-11 | `assets/V7/leaderboard_v8_shield.png` | `assets/resources/Prefabs/排行榜.prefab` | 排行榜盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-12 | `assets/V7/lobby_shield_v8_exact.png` | `assets/resources/UI/panelMain.prefab` | 大厅盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-13 | `assets/V7/login_shield_exact.png` | `assets/resources/UI/panelLogin.prefab` | 登录盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-14 | `assets/V7/mine_hero_exact.png` | `assets/resources/UI/panelMain.prefab` | “我的”主视觉盾牌及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-15 | `assets/V7/money_v8_shield.png` | `assets/resources/UI/panelMain.prefab` | 金币页盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-16 | `assets/V7/record_hero_exact.png` | `assets/resources/UI/panelRecordList.prefab` | 战绩页盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-17 | `assets/V7/register_modal_panel_club_exact.png` | `assets/resources/UI/panelLogin.prefab` | 注册弹窗顶部小徽标和 `BY PRIVATE CLUB` | 已替换（本轮） |
| A-18 | `assets/V7/register_subtitle_exact.png` | `assets/resources/UI/panelLogin.prefab` | 注册副标题 `BY PRIVATE CLUB` | 已替换（本轮） |
| A-19 | `assets/V7/room_card_exact.png` | `assets/resources/UI/panelMain.prefab` | 房间卡盾牌中的 `BY` 及英文 | 已修正（本轮） |
| A-20 | `assets/V7/shield_hd.png` | `assets/resources/UI/panelMain.prefab`、`assets/resources/UI/panelUpdate.prefab` | 通用高清盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-21 | `assets/V7/shield_room_exact.png` | `assets/resources/UI/panelMain.prefab` | 房间盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-22 | `assets/V7/startup_scene_long_v8.png` | `assets/resources/UI/panelUpdate.prefab` | 更新/进入游戏长图中的盾牌与英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-23 | `assets/V7/wallet_v8_realname_shield.png` | `assets/resources/Prefabs/钱包.prefab` | 钱包实名页盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |
| A-24 | `assets/V7/游戏内/游戏就绪_434x145.png` | `assets/Scenes/drh8.fire`、`assets/resources/UI/panelGameView.prefab` | 牌桌“BY游戏已就绪”中的 `BY` | 已修正（2026-11-04，清除重叠后重新生成） |
| A-25 | `assets/resources/pk2/bigbig.png` | `assets/Scenes/drh8.fire`、`assets/resources/Prefabs/handbig.prefab`、`assets/resources/Prefabs/丢牌对象.prefab`、多个回顾 Prefab、`panelGameView.prefab` | 特殊牌背中央 `BY` | 已替换（本轮） |

### B 组：牌桌动态牌背与切牌动画

| 编号 | 正式运行资源 | 当前使用证据 | 图内 BY 位置 / 替换范围 | 状态 |
|---|---|---|---|---|
| B-01 | `assets/ImagesLuck/动画/切/hand_tex.png` | `hand_ske.json` / `hand_tex.json` 作为切牌 DragonBones 图集，引用于 `drh8.fire`、`panelGameView.prefab` | 图集内多张牌背中央 `BY` | 已替换（本轮） |
| B-02 | `assets/resources/zuotype/牌背0.png` | `Tool.GetCardBackIndex()` + `panelGameView.ts` 动态加载 `zuotype/牌背0` | 红色牌背中央 `BY` | 已替换（本轮） |
| B-03 | `assets/resources/zuotype/牌背1.png` | `Tool.GetCardBackIndex()` + `panelGameView.ts` 动态加载 `zuotype/牌背1` | 蓝色牌背中央 `BY` | 已替换（本轮） |
| B-04 | `assets/resources/zuotype/牌背2.png` | `Tool.GetCardBackIndex()` + `panelGameView.ts` 动态加载 `zuotype/牌背2` | 紫色牌背中央 `BY` | 已替换（本轮） |
| B-05 | `assets/resources/zuotype/搓背0.png` | `panelGameView.ts` 动态加载 `zuotype/搓背0` | 红色搓牌背面中央 `BY` | 已替换（本轮） |
| B-06 | `assets/resources/zuotype/搓背1.png` | `panelGameView.ts` 动态加载 `zuotype/搓背1` | 蓝色搓牌背面中央 `BY` | 已替换（本轮） |
| B-07 | `assets/resources/zuotype/搓背2.png` | `panelGameView.ts` 动态加载 `zuotype/搓背2` | 紫色搓牌背面中央 `BY` | 已替换（本轮） |

> `Tool.GetCardBackIndex()` 当前只接受 `0/1/2`。`牌背3.png`、`搓背3.png` 虽然仍在仓库和热更清单中，但当前逻辑不会选中它们，因此不列入正式替换范围。

### C 组：网页游戏启动图

| 编号 | 正式运行资源 | 当前使用证据 | 图内 BY 位置 / 替换范围 | 状态 |
|---|---|---|---|---|
| C-01 | `build-templates/web-mobile/splash.png` | Web Mobile 构建模板启动图 | 启动盾牌中央及英文 `BY` | 已确认（已有 BF 版本，跳过） |

## 并行制作分组

为后续多个对话同时处理，建议按下列互不重叠的分组分配：

- **任务 1：A-01～A-09**：入口、推广、公告、俱乐部资源。
- **任务 2：A-10～A-19**：排行榜、登录、我的、金币、战绩、注册资源。
- **任务 3：A-20～A-25**：通用盾牌、启动长图、就绪字样、特殊牌背。
- **任务 4：B-01～B-07**：切牌图集和 0/1/2 号牌背、搓背。
- **任务 5：C-01**：网页启动图。

每个并行任务完成后应回报：

1. 处理的编号和正式路径；
2. 输出 PNG 的尺寸、色彩模式、透明通道是否保持；
3. 图中所有目标字样是否已为 `BF`，是否误改了其它文字；
4. 是否保留原文件的透明边缘和构图；
5. 不修改 `.meta`、Prefab、Scene 和脚本。

## 明确排除项

以下内容不进入本次“BY→BF”正式运行资源清单：

- `art_sources/`、`design-previews/`、`design/`、`HisImg/`：源稿、设计稿、历史稿，不是当前游戏直接使用的正式资源。
- `WebHome/assets/by-*`、`ChatTool/web/`：推广站和客服站资源，不属于游戏客户端美术。
- `assets/V7/announcement_shield_v8_exact.png`、`assets/V7/register_modal_panel_exact.png` 等当前没有 Prefab/Scene 使用引用的旧/备用切图。
- `assets/resources/other/drh/room_ready_art.png`：当前牌桌实际引用的是 `assets/V7/游戏内/游戏就绪_434x145.png`。

- `assets/resources/zuotype/牌背3.png`、`assets/resources/zuotype/搓背3.png`：当前 `GetCardBackIndex()` 不会选中。
- 只含 `8L` 或 `BL`、不含当前 `BY` 的旧图：本次目标是 `BY→BF`，不在本清单中擅自扩大为旧品牌清理。

### A-24 后续修正（2026-11-04）

- `游戏就绪_434x145.png` 上一版把新的 `BF` 直接叠在原 `BY` 图层上，产生旧字母和底部装饰重影；已重新生成单层透明 PNG。
- 仍保持 434×145 画布、原文件名和 `.meta`/UUID/引用不变；仅完成静态图像检查，Creator 导入、构建和真机仍待验证。

## 替换后验证要求

- 静态：逐个确认正式 PNG 仍存在，尺寸、模式、alpha、文件名和 `.meta` UUID 不变。
- 图像：逐个确认目标区域显示 `BF`，没有残留 `BY`，没有把 `BY POKER` 误变成其它字样，其他中文/英文文案保持不变。
- 引用：重新检查上述 Prefab/Scene UUID 和动态路径；不改绑定关系。
- 编辑器：让 Creator 重新导入资源后确认编辑器可见。
- 网页/构建/真机：分别记录，未执行的验证不能写成已通过。

## 本轮处理记录（2026-11-03）

- 以正式资源当前内容逐项复核：已有 BF 且构图、尺寸和透明边界正常的资源保留并跳过；本轮只写入仍为 BY 的资源，以及 A-19 中已出现明显字样异常的资源。
- 本轮写入 A-01、A-03、A-05～A-07、A-17～A-19、A-24～A-25、B-01～B-07，共 17 张 PNG；均在原尺寸画布上保留原图背景/布局，仅替换目标美术区域。
- 所有正式 PNG 的 `.meta`、Prefab、Scene、TypeScript、JavaScript 和资源 UUID 均未改动。
- 已完成静态尺寸、色彩模式、透明通道和正式路径检查，并对整批图做放大人工复核；Creator 重新导入、网页预览/构建、真机验证尚未执行。
