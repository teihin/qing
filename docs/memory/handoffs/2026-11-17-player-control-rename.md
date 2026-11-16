# 后台「玩家优化」更名「玩家控制」

- 日期：2026-11-17
- 目录/分支：`/Volumes/SSD/qing` / `main`
- 状态：代码与迁移就绪，**未部署 8891**

## 目标（用户原话）

「后台系统中 玩家优化模块 名字改成玩家控制，里面所有显示优化的地方都改成控制。」

## 范围与改动

只改**显示文案**。模块 code `game.player_optimization`、路由 `/game/player-optimization`、菜单图标 key `player-optimization`、4 个权限 code、后端接口路径 `/api/game/player-optimization/*` 全部保持不变，角色授权与已有书签不受影响。

| 文件 | 改动 |
| --- | --- |
| `XuanManager/web/src/pages/PlayerOptimizationPage.tsx` | 30 处中文「优化」→「控制」：页面标题、新增按钮、指标区、列表标题/空态/加载文案、查询与确认提示、三个弹窗标题与按钮、错误提示 |
| `XuanManager/web/src/components/Layout.tsx` | 菜单图标字 `优` → `控` |
| `XuanManager/server/internal/api/player_optimization.go` | 31 处「优化」→「控制」：返回前端的成功/错误消息、`errorText` 兜底、写进游戏服的操作备注（`后台设置控制` / `后台停止控制`） |
| `XuanManager/server/migrations/071_player_control_rename.sql` | 新增。`mgr_module.name` → `玩家控制`；4 条 `mgr_permission` 名称改「查看/新增/调整/删除发牌控制」，描述同步 |

### 文案里指向客户端面板的三处

原文写「与牌桌内运维优化同一套方案」。实际上客户端那个面板叫「牌局优化」（`panelGameOptimize.prefab`），后台旧文案本就指错。改名时统一改成「牌桌内胜率目标」，既不再出现「优化」字样，也不会指向不存在的客户端功能。

## 未改

- 数据库历史迁移 011/012/015 里的旧名保持原样（迁移只跑一次，改了不会重跑）。全新部署时 011 先插旧名、071 再更新为新名，顺序正确。
- `player_optimization_test.go` 里 `" 停止  优化 "` 是测试数据，不影响显示。
- `README.md` / `部署说明.md` / `新后台管理系统接口文档.md` 里提到「玩家优化模块」的文字未改（属文档，不在本次界面范围内）。

## 验证

- `go vet ./internal/api/` 通过；`node node_modules/typescript/bin/tsc -b`（web）通过。
- 未做：构建、部署、登录态实操。

## 下一步

1. 下次部署 8891 时迁移 071 会自动执行，菜单与权限名随之更新；**不重启则菜单仍显示「玩家优化」**。
2. 部署后核对：侧边栏菜单名与图标字、权限管理页 4 条权限名、页面内全部文案、牌桌内设置的记录仍能正常显示。
