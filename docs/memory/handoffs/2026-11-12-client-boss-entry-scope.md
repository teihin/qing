# 交接：客户端两个 BOSS 入口改为按管理范围

日期：2026-11-12
目录：`/Volumes/SSD/qing`　分支：`codex/club-ui`

## 目标

游戏内「我的 → 数据统计」和「牌桌点头像进 BOSS 面板」两个入口，不再看 `level >= 99` / 董事长 / 总裁，只看账号是否配置了 `union_manage` 或 `club_manage`。

## 改动文件

- `assets/scripts/GameDataManager.ts`
  - 新增 `HasManageScope()`：`club_manage` 或 `union_manage` 任一非空。
  - 新增 `GetManageClubIds()` / `GetManageUnionIds()` / `SplitIdList()`。
  - `IsBossAccount()` 保留给平台级能力（战绩、扩展信息、牌局优化等）。
- `assets/scripts/kbe_scripts/kbengine.js`
  - 新增 `set_union_manage` 事件，属性变化后重算入口。
- `assets/scripts/UI/panelMain.ts`
  - 「我的/数据统计」显隐与点击二次校验改用 `HasManageScope()`。
  - 注册 `set_union_manage`，`OnClubMembershipChanged` 时刷新按钮。
- `assets/scripts/UI/panelGameView.ts`
  - 牌桌点头像：`HasManageScope()` 才打开 `panelBossPlayerInfo`，否则走普通资料卡。
- `assets/scripts/UI/panelBossPlayerInfo.ts`
  - 「玩家列表 / 代理列表」默认**不带 `club_id`**，查询该账号管理的全部俱乐部；只有手动选择「一级过滤：俱乐部」时才带。
  - 不改变当前俱乐部，不反查联盟，不替用户选择默认俱乐部。
  - **代理链 `club_id` 修复**：`ApplyTarget(userId, name, clubId)` 新增目标俱乐部参数；玩家列表行、玩家信息行、分组成员行点「代理链」时都传**被查玩家自己的俱乐部**，不再沿用当前房间俱乐部。
  - 按 ID / 按昵称搜索拿不到俱乐部时仍回落到当前 `userClubId`。

## 验收口径

- 未配置两个属性的账号：两个入口都不显示；点头像走普通资料卡。
- 配置了管理范围的账号：入口显示；玩家列表/代理列表默认请求不带 `club_id`，返回全部可管理俱乐部；手动选俱乐部时才带 `club_id`。
- 玩家信息/代理链仍按当前俱乐部查询，范围外由服务端拒绝。
- 平台 boss 配置范围后：原有平台级能力不受影响。

## 验证

- 已做：4 个改动 TS 文件 `ts.transpileModule` 语法检查 0 诊断。
- 未做：Creator 重编译/构建、热更新生成/上传、真机/网页实操。

## 部署前提

- **服务端依赖**：`查询_俱乐部_所有_玩家` / `查询_俱乐部_所有_代理` 对配置了管理范围的账号，不传 `club_id` 时应按 `union_manage` / `club_manage` 并集返回；若仍返回「请指定俱乐部」，需要服务端同步调整。客户端已按此口径先发。
- 当前 `build/jsb-link` 仍是 2026-11-12 01:21 的旧产物（热更新 6.0.6 之前），不包含本次改动。
- Creator 2.4.13 正在运行（项目路径 `/Volumes/SSD/qing`）；未另开 CLI 构建实例，避免冲突和丢失未保存编辑。
- 需要在 Creator 里重新编译/构建 Native（`build/jsb-link`），确认 `temp/quick-scripts` 或构建产物时间更新后再生成热更新包。
