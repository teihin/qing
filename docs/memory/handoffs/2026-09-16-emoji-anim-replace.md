# 表情动画替换为 hh-poker EMOJI 素材（2026-09-16）

- 目录/分支：`/Volumes/SSD/qing`，`main`，基线 `47cf629`；本轮改动未提交。
- 素材来源：`/Users/yy/CodeBuddy/20260915173634/hh-poker-assets`（线上站点镜像，采集 2026-09-16）。
  表情动效为 `video-fx/emoji/*.webm`（VP9、`yuv420p`、240×240、30fps、**纯黑底无 Alpha**），
  静帧为 `images/emoji/*.webp`（96×96 RGBA，带透明）。
- 目标：替换「点头像 → 表情面板 → 选择」后在玩家头像上播放的表情动画。原实现为
  `DrhPlayerLogic.OnChartMsg` 收到 `@BQ<n>` → `cc.loader.loadRes("表情2/"+n)` → 实例化 `资源/表情2/<n>.prefab`
  （`cc.Animation` + 序列帧 `anim`），节点名 `表情`，挂在玩家节点下。

## 槽位映射（面板按钮名 = 服务器 `@BQ` 标识，未改动）

| 槽位 | 目录 | 新动效 | 帧数 | 时长 | 画布 |
|---|---|---|---|---|---|
| 1 | 冰冷 | cold | 44 | 1.50s | 109×117 |
| 2 | 发怒 | enraged | 38 | 2.33s | 119×134 |
| 3 | 囧 | explode | 36 | 2.00s | 119×138 |
| 4 | 困 | no | 37 | 3.73s | 115×102 |
| 5 | 大笑 | joy | 30 | 2.00s | 109×99 |
| 6 | 微笑 | beaming | 35 | 2.83s | 114×97 |
| 7 | 感动 | cry1 | 40 | 2.87s | 100×109 |
| 8 | 拇指 | biceps | 35 | 2.23s | 105×94 |
| 9 | 拜拜 | devil | 42 | 3.67s | 119×130 |
| 10 | 色心 | hot | 26 | 3.20s | 107×102 |

- 语义最贴的优先（cold/enraged/joy/beaming/cry1/biceps/hot）；新素材没有「挥手拜拜」，9 号取 `devil`（坏笑）。
- 未采用 `hahaha`：源视频里那张大嘴的粉色图形**被 240×240 画布顶边裁平**（50 帧中 35 帧触顶），
  直接搬会看到平口断面。`locoff`/`lost` 是定位图标不是表情；`fire`/`knife` 不适配牌桌场景。

## 实现

- 生成脚本 `tools/convert_hh_emoji_anim.py`（会写工程美术，不是只读检查）：ffmpeg 抽帧 → 抠底 → 统一裁剪与缩放 →
  压帧 → 写 PNG/`.meta`/`.anim`。`--check` 只统计不写。
- 抠底：源画布黑底与**原画自带的黑色描边同色**，无法按颜色区分。做法是
  `阈值(亮度>45) → 膨胀 6px → 从画布边界洪泛暗区`，把与边界连通的暗区判为背景，其余（含被描边围住的眼睛/嘴/内部黑）保留为剪影。
  240 画布下描边约 6px，膨胀半径与之匹配，描边得以完整还原。
- 尺寸：按「最大连通块」估算主体直径（中位数），统一缩放到 **100px**（原表情内容 99×101），
  且裁剪框以**主体中心**对齐而不是整段包围盒中心，保证特效长出来时表情仍在头像正中。
- 逐帧稳定：所有帧共用同一裁剪框与画布，`.meta` 写 `trimType: "none"`（全画布），
  画布外围再加 1px `alpha=3` 像素兜底，避免 Creator 按帧自动裁剪导致逐帧尺寸跳动。
- 画质/体积：`median 3×3`（只作用于 RGB，保留原 alpha 边缘）+ RGB 量化到 4 的倍数，
  去掉源视频压缩噪点；373 个 PNG 共 3.69 MB（平均 ~10KB/帧）。
- 压帧：按「帧间差异（只在表情覆盖区域内统计）」去重，关键帧保留**原始 30fps 时间轴**上的真实时刻，
  上限 45 帧；等效 8~16fps，动作大的（cold）保留更多帧。
- 引用链：`<prefix>_0.png`（面板图标，内容换成新静帧，**保留原 uuid**）、`<prefix>_1..N.png`（新动画帧）、
  `<中文名>.anim`（**保留原 uuid**，`wrapMode: 2 = Loop`，`_duration` = 源时长，关键帧为秒）。
  `assets/resources/表情2/<n>.prefab` 未改，`panelTalk.prefab` 1~10 号按钮图标未改，靠保留 uuid 自动跟着换图。
- 播放时长：`assets/scripts/logic/DrhPlayerLogic.ts` 原为固定 `scheduleOnce(..., 2)`，
  改为读 `cc.Animation.defaultClip.duration`（读不到时回退 2s），保证时长 2.3~3.7s 的动效播完整一轮。

## 结果与验证

- 预览：`temp/emoji-preview.html`（已被 `.gitignore` 忽略），`python3 -m http.server` 起本地服务查看；
  按剪辑真实关键帧时间轴回放 10 组动效，并显示面板图标实际贴图。生成脚本 `tools/make_emoji_preview.py`。
- 已做（只读核对）：`资源/表情2/<n>.prefab → <中文名>.anim → spriteFrame uuid` 全部可解析、0 缺帧；
  `panelTalk.prefab` 10 个图标 uuid 与现有 `*_0.png.meta` 一一对应；新动画时长/帧数/画布如上表。
- **未做**：Creator 未打开（贴图尺寸与 `trimType` 变更需回 Creator 触发导入，否则运行时仍读 `library/` 旧图）；
  未构建、未出热更包、未真机、未在真实牌桌上按头像实际观看。
- 遗留：`assets/ImagesLuck/表情/` 下 `流汗/疑问/痛苦/石化/轻视` 5 个目录本轮未动（本就没有 `.anim`，属历史残留）；
  `assets/Images/表情/1..10/`、`assets/resources/表情/`、`表情---/` 是旧的骨骼/另一套实现，未涉及。
- 回滚：`git checkout -- "assets/ImagesLuck/表情" "assets/scripts/logic/DrhPlayerLogic.ts"`（`tools/` 下两个新脚本可保留）。
