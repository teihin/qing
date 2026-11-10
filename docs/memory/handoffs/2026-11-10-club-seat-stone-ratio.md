# 俱乐部「同步带入钻石」开关 + 后台兑换比例

- 日期：2026-11-10
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：客户端代码与正式 prefab 已改（未构建、未真机）；后台 Go/Web 已改并部署正式 8891（2026-11-10 21:00）

## 目标

按《俱乐部钻石收费-客户端与后台接口文档》§11：

1. 创建俱乐部规则时新增「是否同步带入钻石」开关，默认关闭；打开后房间 `special_rule` 带 `入座扣钻`，服务端在俱乐部金币输赢之外同步扣退玩家钻石。
2. 后台新增「房间带入扣除钻石的兑换比例」配置，读写 `usr_hash_info['俱乐部积分对应钻石输赢比']`（纯小数，默认 1:1，0=不扣）。

## 改动

### 客户端

- `assets/scripts/logic/ConfigManager.ts`
  - 新增 `CLUB_SEAT_STONE_RATIO_HASH_KEY = "俱乐部积分对应钻石输赢比"`、默认值 1、`GetClubSeatStoneRatio()`。
  - 登录 `UpdateDefConfig` 和 `RefreshConsumePrice`（60 秒节流）都会补拉该 key；解析后触发 `ClubSeatStoneRatioUpdated`。
  - 兼容纯小数、base64/URL 误存；非法值保留旧值。
- `assets/scripts/UI/panelGameSettings.ts`
  - 创建规则弹窗新增 `createSeatStone`（默认 false）与「同步带入钻石开关」处理；`refreshSeatStoneRow` 同步开/关贴图与比例文案（0 时红字“开启后不扣钻石”）。
  - `submitCreate` 仅在开关打开时给 `创建_俱乐部_玩法` 加 `special_rule = "入座扣钻"`；关闭不传该字段。
  - `normalizeRules` 保留 `ClubPlayList.special_rule`；规则行底部右侧按 token 显示「带入钻石」（28px、暖金色带描边），删除确认弹窗同步显示。
  - 带入窗口（`BuyinDisplay`）新增「钻石余额」行：房间 `roomSetting.special_rule` 含 `入座扣钻` 时显示 `account.stone`，否则整行隐藏；位于金币余额下方，提示文字下移 16px。
  - 监听 `ClubSeatStoneRatioUpdated`，弹窗打开时实时刷新比例文案。
- `assets/resources/UI/panelGameSettings.prefab`
  - 创建规则弹窗新增「同步带入钻石行」（654×76，位于暗抽提示与自动信息之间，开关默认关）；面板高度 1020→1080，下方自动信息/创建提示/房费提示/按钮整体下移，1334 与 1624 两档离屏预览无压叠。
  - **修正**：克隆行的标题 Label 只改了运行时 `_string`，序列化字段 `_N$string` 仍是「地九王」，Creator 显示旧名；已把两者统一为「同步带入钻石」。
  - 规则行模板新增底部右侧「带入钻石」Label（190×36，锚点右对齐，位置 254,-64），默认隐藏，`fillRuleRow` 按 `special_rule` 显隐；类型 Label 保持原 120 宽。
- `assets/resources/UI/panelGameView.prefab`
  - 带入窗口新增「钻石余额」Label（460×32，位置 0,-214，26px 暖金色+阴影，默认隐藏），序列化到 `BuyinDisplay.stoneRow/stone`；`V8_hint` 从 -236.57 下移到 -252 避让。
- `assets/Scenes/drh8.fire`
  - **实际房间场景**：带入窗口是 `panelGameView.prefab` 的序列化实例，prefab 新增子节点不会自动同步。已在场景内补同样的「钻石余额」节点（位置 0,-214，默认隐藏，fileId 与 prefab 新节点一致）、移动 `V8_hint` 到 -252，并把场景内 `BuyinDisplay` 组件（id 3082）的 `stoneRow/stone` 指向新节点。
  - 2026-11-10 22:55 实测原场景无此节点，即使脚本已输出 `[BUYIN] seatStone=true` 也不显示；补场景后才生效。
- `assets/scripts/common/BuyinDisplay.ts`
  - 新增 `stoneRow` / `stone` 属性与 `setStoneBalance(value, visible)`；`panelGameView.RefreshBuyinBalance` 用 `roomSetting.indexOf("入座扣钻") >= 0` 判断显隐，余额取 `account.stone`。
  - `setRoomInfo` 末尾若带入窗口已打开会补刷一次，避免房间模板晚于弹窗到达；`RefreshBuyinBalance` 临时打 `[BUYIN] seatStone=… stone=…`，确认新代码/条件后可删。
  - **注意**：`tools/build_game_settings_prefab.py` 当前生成结果与正式 prefab 不同步（会生成 5 个页签等差异），本次未整体重跑；prefab 按现有 JSON 最小增补。生成脚本已同步加入新行与位移，供后续修好生成器时参考。

- `tools/preview_game_settings_prefab.py`
  - 文本改读序列化字段 `_N$string`（回退 `_string`），避免再出现「预览正确、Creator 显示旧文案」的假通过。

### 后台（XuanManager）

- `server/internal/api/club_seat_stone_ratio.go`（新增）
  - `GET/PUT /api/configuration/club-seat-stone-ratio`，复用 `configuration.stone_consume.view/update` 权限。
  - 读写 `kbedm.usr_hash_info` 的 `俱乐部积分对应钻石输赢比`：纯小数字符串；缺行/空/非法按 1.0；0 合法；最多 4 位小数；范围 0~1000。
  - 保存前快照、写后回读校验，失败按原行恢复；MyISAM 不用事务。多行时统一写同一值，不删行。
  - 审计 `configuration.club_seat_stone_ratio.update`。
- `server/internal/api/server.go`：注册两条路由。
- `server/internal/api/club_seat_stone_ratio_test.go`（新增）：校验/解析/格式化。
- `web/src/types.ts`：`ClubSeatStoneRatioState`。
- `web/src/pages/StoneConsumePricePage.tsx`：在「钻石消费价格」页新增「房间带入钻石兑换比例」区（当前值、键名、0~1000 输入、确认勾选、保存并回读）。
  - 2026-11-10 23:26 按运营要求改为**同一张表**：删除「原金币价」列，比例作为普通行放在列表末尾；表头「扣钻石（个）」改「配置值」；一个确认勾选、一个「保存配置」按钮同时保存价格与比例。
  - 前端已部署：`index-D0v-JYHS.js` / `index-CFM-KCyg.css`（回滚 `web.previous-20261110-2326`）；线上 JS 867,763 B，`原金币价` 0 次、`房间带入钻石兑换比例` 1 次；health 200、比例路由 401。

### 文档

- `服务器文档整理/俱乐部钻石收费-客户端与后台接口文档.md` §11.1/§11.2 补充本仓库客户端命令与后台入口；顶部状态注明本地已改。

## 验证

- `cd XuanManager/server && go test ./...`：全部通过。
- `cd XuanManager/web && node node_modules/typescript/bin/tsc -b`：通过。
- 客户端改动文件用后台 tsc 单文件检查：仅原有 `require` 类型缺失，无新增类型错误。
- `PREVIEW_SHOW=创建规则弹窗` 离屏预览：1334、1624 两档布局通过，开关默认关、比例文案单行。
- prefab 引用校验：无悬空 `__id__`、节点父子一致、279 个 `fileId` 唯一。
- 2026-11-10 22:32 文档更新后已对齐：建房 token 由 `入座收费` 改为 `入座扣钻`；`ClubPlayList.special_rule` 保留并在规则行/删除弹窗显示「· 带入钻石」。
- 2026-11-10 21:00 已部署正式 8891：
  - 后端二进制 `123e56f5c12465513e20e9e647603ad72c6a21f25eda8b456bdcc41ef8edcd56`（10,256,568 B，`-trimpath -ldflags="-s -w"`），回滚 `backups/xuanmanager.20261110-2058-rollback`（旧 `8696b41e…`）。
  - 前端 `index-BofmGCvE.js` / `index-CFM-KCyg.css`，线上 JS 869,497 B 与本地一致；回滚 `web.previous-20261110-2058`。
  - 部署后 `health 200`、`/api/configuration/club-seat-stone-ratio` 未登录 401（路由已注册）、进程正常、日志无新错误。

## 待验证 / 注意

- **服务端状态（按 2026-11-10 22:32 更新文档）**：`club_room_play_info.special_rule` 列已执行 DDL，play_id=24 已回填 `入座扣钻`；服务端代码已上传测试服，**待重启**。21:38 的请求当时被旧逻辑忽略，不能作为当前结论。
  - 重启后，旧玩法仍需删除重建或后台补值；已有房间 400696 不会自动补规则，需关闭后等新补房。
  - 建房/自动补房时 `BuildClubPlayRoomSetting` 把该字符串追加到房间模板；带入/结算写 `usr_consume_info`。
- 客户端规则列表已按 `ClubPlayList.special_rule` 显示「· 带入钻石」，但需客户端构建/热更后才可见。
- 后台已部署但未登录页面保存验收；管理员登录后打开「钻石消费价格」页确认新区块、保存一次比例并回读。
- 客户端未 Creator 导入/构建/真机。
- 服务端比例缓存 10 秒，老房不变、新房生效；后台保存后需新建规则验证。
- 工作区还有其它未提交改动（`panelUserInfo`、奖池小数等），不要一并提交。
