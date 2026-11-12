## 2026-11-10 后台发牌优化：改用游戏服 `异步_设置_玩家_属性`（已部署，未真实写入验收）

- 新增/调整/删除不再直连游戏库写 `tbl_Account`，改为调用服务器本机 8890 的 `异步_设置_玩家_属性` 写 `optimize01_chance`、`optimize01_count`（删除写 0），写后 16×300ms 回读数据库校验；第二字段失败或回读失败时把两个字段恢复为操作前值。
- `optimize01_man` 是可选标记、不参与判定，后台不再查询/要求唯一 BOSS，原「无法唯一确定游戏 BOSS」报错消失。历史 `man` 值保留，不再覆盖。
- 概率支持 `1～100`（正优化）与 `-100～-1`（负优化），`0` 不允许；后端校验、范围筛选和前端输入同步放开。
- 已部署正式 8891：二进制 `347a37e0…`（回滚 `backups/xuanmanager.20261110-0026-rollback`），前端 `index-BU2OmBcu.js`（CSS 保持 `index-DCd0vLpS.css`；回滚目录 `web.previous-player-optimization-20261110-0026`）。health 200、发牌优化路由未登录 401、旧 BOSS 报错串为 0；8890 只读查询 `718968` 返回 chance/count 均为 0。未在页面实操新增/调整/删除，未做真实玩家写入验收。详见[交接](../../handoffs/2026-11-10-player-optimization-game-command.md)。
