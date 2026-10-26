# 钻石消费价格配置（0928 迁移 + 线上部署）

日期：2026-10-26
分支：`codex/club-ui`（改动未提交，工作区）
部署：已上线（XuanManager 正式 8891，20:02 首发 / 20:11 二发含 VIP 下线）

## 目标

1. 游戏内 6 个有效 `玩家_消费_命令` 调用点全部改为扣**钻石**（`money_type=stone`，`money`=钻石个数）。
   VIP 三档原也改过，后经用户确认「现在没有 VIP 消费」，已整体下线（见下）。
2. 钻石单价不再写死，改为后台可配置，改价不用发客户端。

## 改动文件

**客户端（Cocos）**

- `assets/scripts/logic/ConfigManager.ts`：新增 `CONSUME_*` 消费项常量、`CONSUME_PRICE_HASH_KEY`、
  内置默认价表、`GetConsumeStone()`、`BuildConsumeStoneParam()`、`ParseConsumeStonePrice()`；
  `UpdateDefConfig()` 增加拉取「消费钻石价格」；收到后 `KBEngine.Event.fire("ConsumeStonePriceUpdated")`。
- `assets/scripts/UI/panelMain.ts`：换头像改钻石（删 `AVATAR_CHANGE_COST`）、大厅「查看数据」改钻石、
  确认框文案动态化；**成功提示也改为按实际扣费拼「已扣除N钻石」**（新增 `pendingPaidAvatarCost`，
  发送前记录、回包后使用；原来写死的「已收取10元」是脚本字符串，不在 prefab 里）。
- `assets/scripts/UI/panelUserInfo.ts`：玩家资料「看一下」(reqHallCommand)、「道具」(reqGameCommand) 改钻石。
- `assets/scripts/UI/panelGameView.ts`：强制秀牌、看下一张牌、切牌、举报改钻石（前三条走 reqGameCommand）；
  举报两处文案与校验同步。
- `assets/scripts/UI/panelVipInfo.ts`：**VIP 购买整体停用**（2026-10-26 用户确认「现在没有 VIP 消费」）。
  三档按钮文案统一改成「月卡/半年卡/年卡 + 暂未开放」，`onButtonClick` 里 VIP1/VIP2/VIP3/确认购买VIP
  只 `showPanel("panelMsgView", …, "VIP 购买暂未开放！")`，不再发 `玩家_购买_VIP`、也不再发 `玩家_消费_命令`；
  面板只保留战绩信息展示，以后恢复 VIP 时在 `onButtonClick` 接回协议即可。
- `assets/resources/UI/panelMain.prefab`：3 处「更换头像…10元」文案改为「…消耗钻石」（仅文本，未动结构/UUID）。

**后台（XuanManager）**

- `server/migrations/028_stone_consume_price.sql`：模块 38 `configuration.stone_consume`（route `/configuration/stone-consume`，
  parent 30，sort 55）+ 权限 3801/3802 + 授予超管角色。
- `server/internal/api/stone_consume_price.go`（新）：`GET/PUT /api/configuration/stone-consume`，
  读写 `kbedm.usr_hash_info` 的 `hash_key='消费钻石价格'`；写前快照 → 写 → 回读解码校验 → 失败按原行恢复；写审计。
  catalog 目前 7 项，另有 `stoneConsumePriceRetired`（VIP 三档）做停用白名单。
- `server/internal/api/stone_consume_price_test.go`（新）：6 个用例（补齐缺项/非法拒绝/忽略已停用项/目录不含已停用项/回读比对/目录无重复）。
- `server/internal/api/server.go`：注册两条路由。
- `web/src/pages/StoneConsumePricePage.tsx`（新）、`web/src/App.tsx` 路由、`web/src/types.ts` 类型。
- 文档：`服务器文档整理/俱乐部金币与钻石-客户端接口文档.md` 新增 §6（配置格式/生效时机/服务端待办）、
  `XuanManager/新后台管理系统接口文档.md` 新增 §13.3.2。

## 价格约定

消费项 code 三端必须一致（客户端常量 / 后台页面 / 服务端 consume_type）：
`换头像、看数据、道具、强制秀牌、看下一张牌、切牌、举报`。

内置默认（后台未配置时兜底，1 钻≈1 元口径）：10 / 1 / 1 / 5 / 1 / 1 / 50。

`购买VIP月卡/半年卡/年卡` 三项已进入 `stoneConsumePriceRetired` 名单：
不出现在后台页面、不写回配置；老页面若带上这三项，后端 `validate` 里 `continue` 静默忽略，
不阻断保存。数据库里若还残留旧键，`query` 统计 unknown 时也排除它们。

配置值 = `btoa(encodeURIComponent(JSON))`，如 `{"看数据":1,...}`，客户端 `Tool.Base64Decode` 解。
客户端在**进大厅**时读一次（`panelMain.start → UpdateDefConfig`），牌桌内不刷新 → 改价需重进大厅。

## 验证结果

- 客户端 5 个 TS 文件 `ts.transpileModule` 0 诊断；`panelMain.prefab` JSON 可解析、3 处文案已替换。
- 后台 `go vet ./...` + `go test ./...` 全过；`eslint src` + `tsc -b` + `vite build` 通过。
- 部署（第一次，20:02）：二进制 sha256 `ae11014e…2abf0ff` 上传前后一致；备份 `backups/xuanmanager.20261026-2002-rollback`；
  重启后 `/api/health` 200、迁移 `028_stone_consume_price.sql` 于 20:02:24 执行、菜单与 2 条权限入库并授超管；
  `/api/configuration/stone-consume` 由 404 → **401**；前端切到 `index-BdazyoDN.js`（499028B，与本地一致，标签命中 1），
  旧目录保留 `web.previous-stoneconsume-20261026` 可回滚。
- 部署（第二次，20:11，VIP 下线）：`go vet` 通过、`gofmt -l` 无输出、`go test -run StoneConsume` 6/6 PASS；
  二进制 sha256 `1a016a66…08f7c60`（8634552B）上传前后一致，回滚件 `backups/xuanmanager.20261026-2010-vipretire-rollback`；
  `stop.sh → 替换 bin → start.sh` 后 `/api/health` 200，`/proc/<pid>/exe` 哈希 = 新二进制；
  本机 `stone-consume` **401**，公网 `http://154.37.155.17/xuanmanager/` 200、接口 401。
  **本次只换后端二进制**：前端页面按接口 `items` 渲染，catalog 少三项页面自动少三行，无需重新构建 web。
- 客户端 `panelVipInfo.ts` / `ConfigManager.ts` 改动后 `ts.transpileModule` 0 诊断。

## 消费点文案 / 价签复查（2026-10-26 20:30）

改造后专门回头扫了一遍「哪里还写着金币或元」，避免出现「扣钻石、提示写元」这类文不对账。
扫描口径：全部 `assets/resources/UI/*.prefab` + `assets/Scenes/*.fire`，抽取所有 Label 的
`_string`/`_N$string`，筛含「金币/钻石/元」的文本，外加「按钮子树里的纯数字标签」。

| 消费点 | 位置 | 发现 | 处理 |
| --- | --- | --- | --- |
| 换头像 | `panelMain.onHallCommand` 回包 | 成功提示写死「已收取10元」 | 改按本次实发钻石数拼「已扣除N钻石」 |
| 强秀 / 看剩余牌 / 切牌 | `drh8.fire` 按钮子节点 `label`、`label copy` | 价签写死「5」「0.1」「1」，是原金币元价 | 新增 `panelGameView.RefreshConsumePriceLabels()`，进桌与配置更新时按 `GetConsumeStone` 刷；场景静态值顺手改成默认 1/5/1 |
| 道具 ×10 | `panelUserInfo.prefab` `数据/道具/*/label copy` | 每个道具都写死「0.1」元 | `panelUserInfo.start()` 里统一刷成 `CONSUME_PROP`；prefab 静态改 1 |
| VIP 三档 | `panelVipInfo.prefab` | 「月卡\n30金币」等 | 改「月卡\n暂未开放」 |
| 看数据（大厅 / 玩家资料） | — | 只有「钻石不足」提示，无金额文案 | 无需改 |
| 举报 | `panelGameView` | 提示已动态拼 `nReportCost`，无静态价签 | 无需改 |
| 兑换钻石 | `panelExchangeStone` | 金币换钻石，比例与文案一致 | 无需改（不属消费） |
| 延时 | `panelGameView` | 仍走 `延长时间_命令`；已按文档 v1.2 §3.7 改发 `money_type=stone` | 已改（见下节） |

注：牌桌 `panelGameView` 跑的是 `drh8.fire` 里的序列化副本，所以价签必须靠运行时刷；
prefab 与场景两处静态数字都改成了默认值，防止脚本失效时显示旧的元价。

## 延时切钻石（最终版，2026-10-26 21:00）

接口文档已更新到 v1.2，新增 §3.6（牌桌通道支持 `money_type='stone'`）与 §3.7（`延长时间_命令` 的钻石档位），
客户端按新文档调整完毕。**注意中途改过一次方案**：20:40 曾把 `延时` 做成后台可配项，21:00 按 v1.2 撤下——
加时价格由服务端固定档位决定，后台配了不生效，留着会误导运营。

| 本局第几次 | 金币路径（不变） | 钻石路径（v1.2 新增） |
| --- | --- | --- |
| 第 1 次 | 免费 +20 秒 | 免费 +20 秒 |
| 第 2 次 | 2 金币 +20 秒 | **200 钻 +15 秒** |
| 第 3 次 | 4 金币 +20 秒 | **400 钻 +10 秒** |
| 第 4 次起 | 8/16/32 金币 | **拒绝（0x301）** |

- 客户端 `panelGameView`：新增 `GetDelayTier()`（按服务端下发的 `count_times`/`round_counttimes_money`
  判档，同时兼容金币口径 `0/2/4/8` 与钻石口径 `0/200/400`）和 `SendDelayCommand()`；
  发命令带 `"money_type":"stone"`、不传 `money`；第 4 次起客户端直接拦「本局加时次数已用完！」；
  钻石不足 → 「钻石不足 N，无法延时！」。**仍不发 `玩家_消费_命令`**，扣费全在服务端命令内完成。
- 客户端 `ConfigManager`：20:40 加的 `CONSUME_DELAY` 与默认价已删除（价格不由客户端决定）。
- 后台 `stone_consume_price.go`：`延时` 从 catalog 撤下并放进 `stoneConsumePriceRetired`
  （老页面缓存里带着也不会报「未知消费项」）；重新部署 8891，sha `f5364dba…d59f5c1c`，
  回滚件 `backups/xuanmanager.20261026-2100-delayfixed-rollback`，`grep '延时 20 秒'` = 0 证明确实撤下。
- 牌桌通道 §3.6：客户端原本就发 `money_type=stone`，**无需改动**。

### 服务端通道核查（历史记录，供对账）

改文档前翻过 `/server_common/pm_bipai_chuanxiaoxuan_game.py`（可读；`/home/release` 无权限），
发现旧代码：牌桌通道 `玩家_消费_命令`（约 5126 行）不读 `money_type`、按「分」扣金币；
`延长时间_命令`（约 5068 行）写死 `2 ** total_counttimes` 金币。
`/server_common` 里那份仍是 9-22 的旧文件，v1.2 的服务端改动不在其中，故按文档为准、不做代码核实。
实测证据：`usr_cash_water` 牌桌消费 `remark5` 为「用X角-余Y分」、`add_money` 为元（如 `道具 -0.10`）。

## 未完成 / 风险

1. **服务端未改造**：`玩家_消费_命令` 仍按客户端传的 `money` 扣，改包可把钻石消耗改成 0。
   需服务端按 `consume_type` 查同一份配置表并忽略客户端传值。
2. ~~VIP 双扣未验~~ **风险已消除**：VIP 购买入口已停用，`玩家_购买_VIP` 不再由客户端发出，
   不存在与钻石消费叠加。以后恢复 VIP 时需重新验证这条。
3. **客户端未发版**：6 处消费改动 + `延时` + VIP 下线都没进热更包，线上玩家仍走旧的金币逻辑。
4. **配置未落库**：`usr_hash_info` 里 `消费钻石价格` 尚无记录，后台页面显示内置默认值，
   需要有人在页面上点一次「保存」（或等客户端上线前统一配一次）。
   页面现在应显示 8 行（VIP 三行消失、`延时` 新增），这条要人肉看一眼才能算验收闭环。
5. **`延时` 依赖服务端 v1.2**：客户端已按 §3.7 发 `money_type=stone` 并按档位提示；服务端没重启生效前，
   玩家会被按老逻辑扣金币。文档写明「已部署，待重启生效」，重启时间待确认。
6. **牌桌通道四项（道具/强秀/看牌/切牌）依赖服务端 v1.2**：客户端发的是 `money_type=stone`，
   旧服务端会把它当「分」扣金币。服务端重启后即按钻石扣（§3.6）。
7. 「看数据」原有两个金币价（大厅 50 分 / 玩家资料 20 分）已合并为一项 `看数据`。
8. `docs/memory/CURRENT.md` 现 16350 字节，贴着 16384 硬上限，超 AGENTS 的 8 KiB 目标；本次只做等长改写，未整体精简。
