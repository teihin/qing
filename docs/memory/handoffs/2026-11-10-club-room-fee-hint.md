# 俱乐部实时房房费提示（客户端红字 + 后台价目项）

- 日期：2026-11-10
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：客户端代码已改（未构建、未真机）；后台已部署正式 8891

## 目标

按《俱乐部钻石收费-客户端与后台接口文档》收窄范围：

1. 客户端只在「游戏规则 → 创建规则」弹窗用红字提示房费扣除规则；
2. 后台「钻石消费价格」增加 `俱乐部实时房间时长费` 配置项；
3. 建房/补房/扣费全部由服务端控制，客户端不发扣费命令。

## 改动

- `assets/scripts/logic/ConfigManager.ts`
  - 新增 `CONSUME_CLUB_ROOM_FEE = "俱乐部实时房间时长费"`，默认值固定 0（后台未配 = 未开启）。
  - 新增 `GetClubRoomFee()` 与 `RefreshConsumePrice()`（60 秒节流）。
  - 价目表解码兼容 `base64 + URL 编码 / 纯 URL 编码 / 明文`，避免服务端编码方式变动时整份价格读不到。
- `assets/scripts/UI/panelGameSettings.ts`
  - 创建规则弹窗新增红字 `房费提示`：`房费：开房扣 X 钻；首局开始后每 30 分钟再扣 X 钻；自动补房同扣`；价格为 0 显示灰字「房费未开启」。
  - 打开弹窗时补拉一次价目表；监听 `ConsumeStonePriceUpdated` 实时刷新红字。
- `assets/scripts/UI/panelGameView.ts`
  - 收到 `PromptInfo` 的「联盟/俱乐部钻石池余额不足，房间解散」时，改为打开置顶 `panelMsgView` 模态框（zIndex 900），不再是牌桌内嵌小字；先关闭同名旧提示框，保证文案刷新。
- `assets/resources/UI/panelGameSettings.prefab`
  - 创建规则弹窗 `面板/房费提示`：18px、红色 `(255,92,84)`、深色描边，位于创建提示与按钮之间。
  - `tools/build_game_settings_prefab.py` 同步生成该节点。
- `XuanManager/server/internal/api/stone_consume_price.go`
  - 价目表 catalog 新增 `俱乐部实时房间时长费`（默认 0，场景：俱乐部 · 游戏规则 · 创建规则/自动补房）。
  - 该页是 catalog 驱动，保存时会带上该项；未加 catalog 时保存会把未知项清掉。
- `XuanManager/server/internal/api/stone_consume_price_test.go`
  - 新增 catalog 包含该项且默认值为 0 的测试。

## 验证

- `go test ./internal/api` 通过。
- `tools/preview_game_settings_prefab.py` 以 `PREVIEW_SHOW=创建规则弹窗` 离屏预览：红字位于创建提示下方，单行不溢出。
- 后台已部署正式 8891：二进制 `8696b41e…`，回滚 `backups/xuanmanager.20261110-1731-rollback`（旧 `347a37e0…`）；health 200，部署后二进制 `grep -ac 俱乐部实时房间时长费 = 1`；8890/8891/8893 监听正常。
- 未做：Creator 导入/构建、网页与真机实机、后台页面登录后保存、游戏服联调。

## 待验证 / 注意

- 牌桌 `PromptInfo` 解散模态框未实机验证；局中会一直显示到玩家点确定，非局中若立即关房切场景，提示框会随旧场景销毁，当前未做跨场景保留。
- 线上旧二进制不是 HEAD 可复现（00:26 构建，含发放钻石、不含收益对账）。按用户确认，本次部署 HEAD 后端，一并上线「收益对账/业绩占比」接口；对应前端页面未部署，未登录验收。
- 需在后台把该项从 0 改为正式单价后，客户端打开创建规则弹窗 10 秒内应显示新价。
- 红字周期按现有玩法页口径写死 30 分钟；若服务端 `realtime_play_seconds` 可配，需要服务端下发周期字段。
- 后台价目页单值上限仍为 100000（`stoneConsumePriceMax`），文档写 1000000；本次未改全局上限。
- 工作区还有 `panelUserInfo.*`、奖池小数等其它未提交改动，不要一并提交。