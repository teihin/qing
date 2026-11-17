# 2026-11-17 牌局优化入口口径改成「当前俱乐部的管理员」

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`；未提交、未构建、未热更、未真机。
- 目标：牌桌内电量连点 3 下打开「牌局优化」的条件，从「BOSS（`level>=99` / 董事长 / 总裁）」改成「本账号是当前俱乐部的管理员」。

## 改动文件

- `assets/scripts/GameDataManager.ts`：新增 `IsCurrentClubAdmin()`，并 import `./logic/RoomClubContext` 的 `resolveRoomSettingClubId` / `resolveMyRoomClubId` / `resolveRoomSettingUnionId`。
  - 口径：**`club_manage` 或 `union_manage` 任一非空**（与后台「设置管理员」/ `isBoss` 同一套大小BOSS 定义），再看范围能不能比对：`roomSetting.club_id` 命中 `club_manage` → 放行；联盟共享房 `roomSetting.union_id` 非空 → 只认管理该联盟的账号。
  - 兜底：普通俱乐部房的 `roomSetting` 没有 `union_id`，客户端也查不到「本俱乐部属于哪个联盟」，无法精确比对联盟范围 → 按「已配置管理范围」放行，服务端按 club_id 复核。
  - **2026-11-17 首版只判 `club_manage`，把联盟小BOSS 挡在外面**（后台「设置管理员」选联盟写的是 `sm_union_manage`，`club_manage` 为空）。真机日志 `电量三连击：非俱乐部管理员 level=0 role=新玩家 club_manage=` 即此因。
  - `IsBossAccount()` 保留不动，仍供战绩、玩家扩展信息、面板用户信息等平台级能力使用。
- `assets/scripts/UI/panelGameView.ts`：`InitBossBatteryEntry()`（`BK/电量` 兜底监听）与 `OnBossBatteryTap()`（`RoomFrame/完成` 隐形热区，实际吃到点击的是它）两处门禁都换成 `IsCurrentClubAdmin()`；日志补 `club_manage=` / `union_manage=` / `roomSetting=`。非管理员保持原行为：单点即时发 `关闭检查_命令`；管理员单/双击延迟 900ms 补发，三连击不发。
- `assets/scripts/UI/panelGameOptimize.ts`：`start()` 门禁同步换成 `IsCurrentClubAdmin()`，否则管理员开面板会被自己的客户端踢掉。

## 验证

- `ts.transpileModule` + `parseDiagnostics`：三个文件均 0 诊断（本机无 `tsc`）。
- 未做：Creator 导入、构建/热更、真机连点、真实管理员账号实操。

## 阻塞项（重要）

- 服务端 4 条胜率目标命令（`异步_设置/查询/停止_胜率目标`、`查询_胜率目标_日志`）仍只认 `d_users.config["account"]["boss"]` 名单（`opt_target_ctrl.IsBossOnly`，见 `服务器文档整理/胜率目标控制-客户端与后台接口文档.md` §1.2），**不含 `club_manage`**。
- 因此仅改客户端时，管理员能打开面板，但设置/停止会回 `{"error":"无权限"}`。要真正放开，需在服务端把前置换成「boss 名单 ∪ 该 club 的 club_manage」，并按 `club_id` 限定只能操作本俱乐部（`game_mode='club'` 校验保持）。
- 服务端脚本不在本仓库，改动需在服务器侧进行。
