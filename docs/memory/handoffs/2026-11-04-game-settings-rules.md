# 交接：游戏设置「游戏规则」Tab（2026-11-04）

## 目录 / 分支

- 工作目录：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 本轮只改游戏设置相关文件；未提交、未构建、未发布。

## 目标

按服务端《俱乐部房间玩法配置-客户端接口文档》和《俱乐部暗抽-客户端接口文档》（2026-11-04 版），
在大厅「游戏设置」里新增首个 Tab「游戏规则」：列表展示俱乐部玩法，支持创建、删除；打开设置默认进入该 Tab。

## 改动文件

- `assets/resources/UI/panelGameSettings.prefab`
  - 页签改为 5 个：游戏规则 / 奖池设置 / 牌桌设置 / 提示音设置 / 其他设置；前两个可切换，后三个仍提示“该设置暂未开放”。
  - 新增 `规则卡片`（汇总、滚动列表、空提示、创建按钮）、`创建规则弹窗`、`删除规则弹窗`。
  - 规则行模板 `规则卡片/滚动/view/content/规则行` 由脚本克隆；创建/删除面板挂 `cc.BlockInputEvents`，避免点面板空白穿透到遮罩关闭；两个面板都加居中 Widget，避免不同分辨率错位。
- 规则卡片的标题/说明/图标/汇总改为顶部 Widget 锚定；长屏下卡片被拉高时，头部仍贴顶，不再出现大段空白（预览见 `design-previews/待确认/2026-11-04-游戏规则/06-长屏规则卡片-顶部适配.png`）。
- `assets/V7/settlement_v8_list_panel.png`、`assets/V8/game_settings/gs_chip/gs_tab_on/gs_tab_off/gs_btn_gold`：重绘为高倍超采样、柔边圆角，去掉旧切图的硬边/亮线锯齿；沿用原 UUID、尺寸和九宫格 border。行底板同时被奖池行、规则行、自动信息栏和其他页面复用。
- `assets/scripts/UI/panelGameSettings.ts`
  - 页签切换、规则列表查询/创建/删除、`ClubPlayList`/`ClubPlayResult` 推送处理、加载/失败/空态、创建弹窗校验和删除确认。
- `tools/build_game_settings_prefab.py`
  - 正式 Prefab 生成器同步加入新 UI；新增按节点路径复用既有 `fileId` 的逻辑，避免重建时全量换身份。
- `tools/preview_game_settings_prefab.py`
  - 支持 `PREVIEW_SHOW` / `PREVIEW_RULE_ROW` / `PREVIEW_OUT`，可离屏预览规则卡片与弹窗。
- 设计稿：`design-previews/待确认/2026-11-04-游戏规则/`（用户 2026-11-04 确认按该效果实现；后按追加要求改为 5 档底皮）。

## 协议口径

- 查询：`查询_俱乐部_玩法列表` + `club_id`，同步 0x200 空壳，数据走 `ClubPlayList` 推送。
- 创建：`创建_俱乐部_玩法` + `club_id` / `dipi_key` / `dijiuwang` / `water_rate` / `dark_percent`；同步 0x200 只是受理，等 `ClubPlayList` 再关弹窗。
- 删除：`删除_俱乐部_玩法` + `club_id` / `play_id`；删除后当前局结算再关房。
- 异步失败：`ClubPlayResult` 的 `error` 回填到弹窗提示；同步错误走 0x301。
- 创建/删除提交时和收到 `ClubPlayList` 时各触发一次 `RefreshClubRoomList`，`panelMain` 合并后延迟 1.5s 强制 `getAllRooms(0,true)`，清掉历史房间并补上新房。
- 创建/删除 6 秒未收到推送只提示“结果未确认”，不重复提交；查询 3 秒超时提示重试。

## 本轮产品口径

- 创建只提供 `1/3`、`2/5`、`5/10`、`10/20`、`20/40` 五档；`0.1/0.3`、`0.2/0.5`、`50/100` 不在创建入口出现。
- **同一底皮允许创建多条**，客户端不做组合唯一校验；这与当前服务端文档的 `(club_id,dipi_key,dijiuwang)` 唯一限制冲突，需要服务端确认/放开，否则会返回“该底皮+地九王玩法已存在”。
- 创建默认 `water_rate=5`、`dark_percent=0`、地九王开；暗抽上限跟随抽水，0=不暗抽。
- 列表展示服务端返回的任意底皮（包括历史 0.1/0.2/50/100 规则）；房间数只按 `room_ids` 计数，不展示“可加入/进行中”（文档不返回房间状态，需另取房间列表交叉）。
- 服务端没有修改接口，列表只提供删除；要改规则需删除重建。
- `dark_percent` 仅群主/owner 可见；本页入口本身只对联盟盟主或未入盟俱乐部老板开放。

## 验证

- Prefab：JSON 解析、全部 `__id__` 引用、父子/组件回指、fileId 唯一性、Prefab UUID 与 meta 一致，均通过。
- 既有 154 个节点/子树对比：除 5 个页签的宽度/位置/文案外无差异。
- TS：使用本机 TypeScript 对 `panelGameSettings.ts` 做 ES5 transpile，无语法错误；脚本内静态节点路径与 Prefab 路径核对通过。
- 离屏预览：规则卡片、创建弹窗、删除弹窗、奖池页均已渲染检查；创建默认显示地九王开、抽水 5%、暗抽 0；规则列表顶部对齐正常。
- **未做**：Creator 导入/Recompile、构建、真机、真实服务端回包、点击/滚动验收。

## 下一步

1. Creator 重新导入改过的 PNG 并打开 `panelGameSettings.prefab` 确认布局（重点：游戏规则为第一个页签、规则滚动区、两个弹窗居中、底板边缘是否还有锯齿）。
2. 与服务端确认“同底皮多条”是否已放开；未放开时创建会返回唯一性错误。
3. 真机验收创建/删除/补房/暗抽可见性，并核对 `ClubPlayList` 实际字段与推送时机。
