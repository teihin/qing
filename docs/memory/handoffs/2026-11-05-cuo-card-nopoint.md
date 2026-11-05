# 2026-11-05 搓牌：没点牌面过渡 + 过半自动揭开

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`3f262ad`（工作区含其他任务未提交修改，本次只改下列文件）

## 目标

1. 搓牌窗口在「搓开」之前不再露出左上/右下角标：改用一套没有角标的牌面，揭开后再切回现有点数牌面。
2. 遮罩拖动超过牌面水平或垂直一半时，只把窗口牌面换成真实有点牌面；搓牌不结束，仍由松手按原流程结束。

## 改动文件

- `assets/scripts/logic/DrhPlayerLogic.ts`
  - 新增 `GetCuoCardResPath(nPos, bRealFace)`：没点图走 `pk2np/<类型>_<点数>d`，有点图走原 `pk2/...`。
  - 新增 `PrepareCuoCardFace(nPos, onReady)`：先加载没点图并回填 `搓牌窗口/牌`，同时预加载有点图；加载完成后再显示窗口。
  - `DelayShowCuo`、`AnimateMoveOneCard` 最后一张牌的窗口初始化改用 `PrepareCuoCardFace`。
  - 新增 `ShowCuoRealFace()`：把窗口牌面切回有点图。
- `assets/scripts/UI/panelGameView.ts`
  - 遮罩 `TOUCH_START` 记录起始位置；`TOUCH_MOVE` 中水平/垂直位移达到牌面一半时，只调用 `ShowCuoRealFace()` 换成真实牌面，遮罩继续跟随拖动，`bBeginCuo` 保持为真。
  - `TOUCH_END` 仍按原逻辑调用 `DelayShowCuoInfo`（开头会再切一次真实牌面，随后沿用「0.3s 撤遮罩 → 1s 关窗并翻手牌」节奏）。
- `assets/resources/pk2np/`（新增）
  - 54 张没点牌面 + 54 份 `.meta` + 文件夹 `.meta`，命名与 `pk2` 的 `d` 图一一对应；尺寸逐张对齐 `pk2` 同名有点图（4 花色 13 点 + 大小王）。
  - 源图：`~/Desktop/扑克牌3_大牌没点`。按 alpha 预乘 Lanczos 放大到 472×680（大小王 4_2d 为 154×198），再轻微锐化；新增约 5.8 MB。
- `tools/import_pk2_nopoint.py`（新增）
  - 可重复执行的导入脚本；已有图片默认跳过，可 `--force` 覆盖；只为缺失的图片补 `.meta`（UUID 随机、已核对全仓唯一）。

## 关键口径

- 揭开门限：`|遮罩位移| >= 牌节点宽/2` 或 `|遮罩位移| >= 牌节点高/2`（牌节点 482×730，即 241 / 365）；命中只换真实牌面，不结束搓牌。
- 结束时机不变：仍是松手（`TOUCH_END`）触发原揭开流程；过半后拖回或继续拖动也不会关闭窗口，且真实牌面不会退回没点图。
- 未改服务端命令：仍然在揭开流程里发 `玩家_搓牌_事件`，调用 `PlayCoverOneCard(3)`。
- 没点图只用于搓牌窗口；手牌、牌局回顾、其他牌面仍用 `pk2` 有点图。
- 搓牌窗口的 `手1/手2`（指纹图）保持原有 `opacity=0`，本次未改 Prefab/Scene。

## 验证

- 已做：两处 TS 文件语法检查通过；新增 54 张 PNG 尺寸与 `pk2` 同名图一致、alpha 全画布、`.meta` 的 width/height/trim 自洽；新增 UUID 全仓唯一。
- 待验证：Creator 导入新资源、网页/真机实际拖动（过半只换真实牌面且搓牌继续、松手结束、牌面切换无跳变）、构建与热更体积。

## 备注

- `outputs/搓牌角标遮挡/` 是此前「用封印图挡住角标」的设计稿，本次未采用，也未写入资源。
