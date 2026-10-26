# 「我的」页下半部分改为可滚动（短屏适配）

- 目录 / 分支：`/Volumes/SSD/qing`，`codex/club-ui`。
- 目标：矮屏手机上「我的」页底部（按钮区 + 当前俱乐部卡片）被切掉，把这两块装进 ScrollView，短屏可滚动看全；高屏保持原样。

## 改动

### Prefab `assets/resources/UI/panelMain.prefab`

新增三级节点，挂在 `Main/我的` 下、排在最后（绘制顺序不变）：

```
Main/我的/滚动区        750×665.38  cc.ScrollView(v) + cc.Widget(TBLR, top=668.62, bottom=0)
  └ view                750×665.38  cc.Mask(RECT) + cc.Widget(TBLR 0)
    └ content           750×656     cc.Widget(TOP|CENTER, top=0, 启用)
      ├ 操作            （原样搬入，Widget top 668.62 → 0）
      └ 当前俱乐部       （原样搬入，Widget top 1100.45 → 431.78）
```

- `操作` / `当前俱乐部` 只改 `_parent` 和 Widget 的 `_top`，节点名、UUID、子节点、坐标记录都没动；`我的._children` 里对应两项换成 `滚动区`。
- 滚动区用 TBLR 对齐而不是写死尺寸：页面上部（Title / 信息 / 数据）都是 TOP 对齐，所以「信息卡底边到滚动区顶边」的 11px 间隙在任何屏高下都恒定。
- 新增 3 个 `cc.PrefabInfo`（fileId 随机 24 位 hex，不与既有冲突）。对象数 3856 → 3867，节点数 1066 → 1069。
- 落盘时按 Creator 的 JS 数字格式还原（<1e-6 用指数、指数不带前导零、其余走十进制），所以 `git diff` 只有 8 行删除，全是本次真实改动，没有浮点写法噪声。

### 脚本

- `assets/scripts/UI/panelMain.ts`
  - 新增 `SyncMyPageScroll()`：切到「我的」时延后一帧，依次对 `我的 → 滚动区 → view` 手动 `Widget.updateAlignment()`，再把 `content` 高度补到 `max(656, view.height)` 并 `scrollToTop(0)`。656 = 按钮区 419.76 + 间距 12 + 俱乐部 200 + 底部留白 24（设计分辨率）。
  - `switchTabSel()` 末尾 `if(strName === "我的") this.SyncMyPageScroll();`。
  - `RefreshAgentMenuVisibility()` 的路径 `Main/我的/操作` → `Main/我的/滚动区/view/content/操作`。
- `assets/scripts/UI/ClubManagementView.ts`：`Refresh()` 取卡片路径 `Main/我的/当前俱乐部` → `Main/我的/滚动区/view/content/当前俱乐部`。其余相对 `card` 的路径不变。

## 验证

- 两个 TS 文件 `ts.transpileModule` 0 诊断。
- Prefab JSON 可解析；无越界 `__id__`；全部节点 `_parent` 与父节点 `_children` 双向一致；三个新 fileId 不与既有重复。
- 几何模拟（按 Widget ALWAYS 规则）：屏高 1334 时滚动区视高 665.4 > 内容 631.78，不需要滚动、底部留白 33.6，**与改动前逐像素一致**；1200 需滚 100、1080 需滚 220、900 需滚 400；1624 长屏 content 撑到 955.4，内容贴顶、下方留白。信息卡底到滚动区顶恒为 11px。
- **Creator 实际接管过一次**：改完后 Creator（开着该工程）检测到外部修改，重载并把 `panelMain.prefab` 重写落盘 —— 新增的 11 个对象被它重排进 `我的` 子树内部（后面所有 `__id__` 整体 +11），并按当时编辑器视口（1218.62）把 Widget 全部对齐了一遍：`滚动区` 750×550 @(0,-277)、`content` 750×656 @(0,275)=550/2、`操作` @(0,-209.88)、`当前俱乐部` @(0,-531.78)。这些数字与手算完全一致，等于 Creator 端把「三块 Widget 链」跑通了一遍。
- 重写后复检：对象 3867、节点 1069、越界 `__id__` 0、父子双向一致 0 处不符、`我的._children` 仍是 `[背景, Title, 信息, 数据, 滚动区]`。因此 prefab 的 diff 从 386 行涨到 12008 行是 Creator 重排索引造成的，语义未变。

## 未验证

- 未做网页/原生真机运行、矮屏实际滚动与点击穿透验证。真机上要重点看：滚动区内的按钮点击是否正常、滑动是否误触按钮、俱乐部卡片里的「管理成员/退出/解散/收益」是否仍能点。
- 构建与热更包：00:42 已构建 `build/jsb-link`（`assets/main/index.jsc`、`import/d0` 均含本次改动，后者可搜到 `滚动区`），版本 `5.0.30 → 5.0.31`，5639 条 manifest 条目与 `hot-update-output/5.0.31` 逐条对拍一致；远端 `http://154.37.155.17/up/project.manifest` 的 MD5 与本地一致，即 5.0.31 已上传。
