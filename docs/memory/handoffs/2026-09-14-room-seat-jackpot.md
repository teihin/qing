# 2026-09-14 房间空位与顶部奖池

## 工作区与目标

- 检出 `/Volumes/SSD/qing`，分支 `main`；开始时存在排行榜及共享文档的未提交改动，全部保留。本次未提交/推送。
- 用户最新截图取代本两处的旧视觉：八个空位改为简洁座椅图片、不要文字；奖池仿竞品逐位分格，数字居中不跨格。其它页面仍按 V8-new。

## 实施

- `assets/resources/UI/panelGameView.prefab` 与 `assets/Scenes/drh8.fire`：八座位引用 `ingame_empty_seat_clean_v8.png`，原节点、96×96 大小、坐标、显隐、UUID 和 Button 契约保留。
- 顶部 `奖池条` 统一为 268×64，顶部 10px、水平居中；`num` 左右上下各 8px，252×48 居中 Label。奖池热区覆盖底框，原点击节点/目标不变。
- `ingame_jackpot_cells_v8.png/.fnt` 将每个格子与浅金数字绑定为同一个 72×96 位图字形（DIN Alternate Bold）；独立可拉伸框为 `ingame_jackpot_frame_v8.png`。取消旧“奖池”文字和左右分区。
- `DrhLogicMgr.UpdateCurJiangChi` 仍接收原两个服务器更新入口，仅补七位前导零；按 3:4 的完整格宽计算字号，不做 Number 转换或截断。7→8→9→15→7 位均保持原金额和恢复字号。
- 实际发现 Cocos 2.4.13 的位图 SHRINK 用字形中心判定，8 位时漏缩小而越框；已以完整字格宽预计算字号规避。不能只恢复原 SHRINK 配置。
- 图源、提示词、截图与数据位于 `art_sources/v8-repairs/room-seat-jackpot/`；工具为 `tools/apply_v8_room_seat_jackpot.py`、隔离样例 `tools/preview_v8_room_seat_jackpot.js`。旧 V7 桌内应用工具不可用于回写本次视觉。

## 验证

- Prefab/Scene 结构及按钮比较通过：对象数量、节点父子关系、名称、组件绑定、激活状态、座位几何和 Button 内容保留。
- Creator 2.4.13 当前实例已导入两份序列化资源；三张 PNG 与 `library/imports` 哈希一致，字体引用与正式文件一致。
- 最新逻辑 TypeScript 转译与 8 次数据变更检查通过；未运行全仓类型检查。
- 独立 localhost 页面实例化正式 Prefab，关闭游戏/网络组件后检查 iPhone 6 (375×667) 和 X (375×812)；空位透明、无文字，奖池无顶部按钮重叠。
- 实际渲染器顶点核对 0、1、460357、3001800、12345678、987654321、123456789012345 及恢复 3001800，全部字格均在内框内。原样字符串精度保留。
- 两个控件的运行时 active/interactable、触摸监听及中心 `_hitTest` 均通过。独立样例中的浏览器模拟点击未收到 click 回调，因此不记为实际点击交互通过；真实入座/奖池入口仍待登录态复核。
- 无真实房间业务操作，无 Creator 构建、真机、发布；截图均为本地样例，不代表服务器数据。
- `check_memory.py check`：0 错误，当前状态/专题各有一项既有文档体积建议警告；本次新增条目已缩短至硬上限内。`git diff --check` 通过。

## 下一步

用户在真实房间刷新客户端后复核视觉和原入口交互；根据最终视觉反馈局部调整。未取得新的提交授权前保持未提交。
