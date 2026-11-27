# CURRENT 归档：2026-11-24 批次

> 按文档预算从 `docs/memory/CURRENT.md` 归档（2026-11-25），内容原样保留。

## 2026-11-24 用户端数据查询支持登录ID/昵称 + 代理链显示各级比例（已上测试服，详见[交接](handoffs/2026-11-24-userdata-lookup-and-chain-percent.md)）

- 后端新增 `GET /api/game/user-data/lookup?keyword=`（权限沿用 `game.user_data.view`）：游戏ID（含靓号）与登录ID（`sm_wxID` / `kbe_accountinfos.accountName`）精确、昵称 `sm_name` 模糊，精确优先，最多 20 条。
- 前端搜索框改成「先定位玩家」：命中 1 条直接进详情，多条先出候选表点选。代理链每级显示 `角色 · 比例 X%`（`club_agent_info.percent`，`0` 不显示）；本人若是创建者/代理也显示 `本人 · X%`（与「分成比例」同一判定，0 也显示）。
- 验证：`go build/vet/test`、`tsc/lint/build` 通过；测试服登录ID `1018888` → `981149`、昵称 `测试四` → `327553`；部署后 health 200、新 bundle `index-BJvnC5L-.js`、lookup 未登录 401。**未做登录态点测**，正式服未动，代码未提交。

## 2026-11-24 客服上分可同步增加盟主额度（已上测试服，详见[交接](handoffs/2026-11-24-cs-hosted-gold-sync-union-quota.md)）

- 客服「托管会话 → 上分」弹窗新增「同步增加盟主额度」勾选，**默认勾选**；上多少分同步给该俱乐部盟主加多少额度，下分不涉及。
- **没用用户点名的 `授信_联盟_额度`**：该命令按调用者自己的联盟判定，`/hall/command` 固定以 `Hall.boss` 执行，boss 无联盟，实测恒返回 769「该俱乐部不在你的联盟里」。改用后台专用命令 **`发放_盟主_奖励`**（池 → 盟主俱乐部，写库 `额度奖励`）。
- 上分成功后调该命令并回读 `club_guuid_info.union_quota`；第二步失败不回滚积分，原因经 `quotaSyncError` 回显客服，俱乐部未入盟给明确提示。
- 验证：`go vet/test`、`tsc+build` 通过；测试服端到端 +1 → 玩家积分 1337→1338、俱乐部额度 6123001→6123002、联盟池 40231999→40231998。
- 测试服已部署（前端 `index-CCJtSAUV.js`、ChatTool `ec68ba29…`、XuanManager `1cdd9f52…`），**正式服未动**，回滚点见交接。**代码未提交。**

