# 2026-11-09 XuanManager 防盗号「客服解绑」报「接口不存在」

## 现象

后台「玩家管理 → 防盗号管理」点「客服解绑」提交后，页面提示 **接口不存在**。主人描述为「解除防盗绑定点击报错」。

## 证据链

1. `POST /xuanmanager/api/game/anti-theft//unbind` → `404 {"code":"NOT_FOUND","message":"接口不存在"}`（Caddy `update-access.log` 抓到 2026-11-08T16:27:20Z / 北京时间 00:27:20，UA Edge，Referer 后台首页，搜索词 `111111`）。
2. 路径里 `anti-theft` 和 `unbind` 之间是 **空路径段** —— 前端把空的 `playerId` 插进了模板字符串。
3. 对应数据：`kbedm.third_marketing_info` id=54，`player_wxid=111111`、`player_wxname=测试盟主`、`anti_theft_on=1`、`device_platform=android`，但 **`player_guuid` 为空**。`kbedm.tbl_Account` 里 `sm_wxid=111111` → `sm_guuid=529749`（2026-11-02 19:46:43 注册，营销行早 10 秒）。
4. 即：先微信登录写营销表、后注册游戏账号，注册流程没回写 `player_guuid`。全库这类缺 guuid 的行 37 条，其中开了防盗号的只有这 1 条。
5. 后端路由本身没问题：182 条路由逐条探测线上全部存在，`POST /api/game/anti-theft/12345/unbind` 返回 401（未登录），只有空段才落到 404。

## 修法

- 后端 `server/internal/api/anti_theft.go`：列表返回前新增 `fillAntiTheftPlayerIDs`，对 `playerId` 为空的行按 `loginName`(=sm_wxid) 批量回查 `kbedm.tbl_Account` 取 `sm_guuid` 补上；查不到就保持空。
- 前端 `web/src/pages/AntiTheftPage.tsx`：`playerId` 为空时不给「客服解绑」按钮，显示「缺少玩家 ID」并带 title 说明；弹窗提交前再拦一次，提示「该账号缺少游戏玩家 ID，无法提交解绑」。
- 修完好，「测试盟主」那行会显示玩家 ID 529749，可正常解绑。

### 第二轮：能点进去了，但报「没有找到这个游戏玩家 ID 对应的注册账号」

- 第一轮只把玩家 ID 在**内存里补出来**给前端用，库里的 `player_guuid` 仍然是空。
  `readAntiTheftAccount` 按 `WHERE m.player_guuid = ?` 查，照样捞不到这行，于是 404「没有找到…」。
- 第二轮把 `readAntiTheftAccount` 拆成 `readAntiTheftAccount` + `queryAntiTheftAccount(where, arg)`：
  先按 guuid 查，`ErrNoRows` 再按 `COALESCE(m.player_guuid,'')='' AND m.player_wxid = (SELECT sm_wxid FROM tbl_Account WHERE sm_guuid=? AND COALESCE(sm_wxid,'')<>'')` 兜底。
  子查询带 `sm_wxid<>''` 是防「空微信 ID 匹配到一堆空行」误解绑别人。
- `waitForAntiTheftUnbound` 走同一个函数，回读校验也自动兜底，不会出现「解绑已提交但回读失败」。
- 只读验证：用该 SQL 在库里跑，命中 id=54（111111 / on=1 / android / 2026-11-08 02:57:32）。

### 第三轮：报「KB 服务未接受解绑操作」= 游戏服 ret_code 769

- 日志：`异步_解除_玩家_防盗号绑定` 参数 `{"login_name":"111111","player_guuid":"529749",...}`，游戏服 `ret_code=769 (0x301)`、`ret_result={}`，耗时 5–7ms（命令进了游戏服，被拒）。
- 原因：KB 侧解绑 SQL 是 `UPDATE … WHERE player_guuid = ? AND player_wxid = ? LIMIT 1`（见 `防盗号功能-KB服务端改动说明.md` 第 9 节）。
  这一行 `player_guuid` 本来是空的，怎么都匹配不到，必然影响 0 行 → 失败。
  XuanManager 侧的兜底查询只能"读得到"，改不了游戏服那条 UPDATE。
- 处理：数据回填 `UPDATE kbedm.third_marketing_info SET player_guuid='529749' WHERE id=54 AND player_wxid='111111' AND COALESCE(player_guuid,'')=''`，
  affected=1。回读：id=54 / 529749 / 111111 / on=1 / android / 绑定 2026-11-08 02:57:32。
  改前整行已备份到 `/www/html/.xuanmanager/backups/third_marketing_info-id54-20261109-0057.sql`（`SELECT *` 单行 TSV）。

### 第四轮：降级改库成功，但先弹报错、界面不刷

- 现象：点解绑 → 先报「KB 服务未接受解绑操作」→ 库里其实已经改成 `anti_theft_on=0`、设备清空、`binding_revision=2` → 列表不动。
- 原因（我自己写错的）：上一轮改 `handleUnbindAntiTheftAccount` 时，`new_string` 里误留了一段旧的
  `if commandErr != nil { … 502 … return }`，降级成功后又命中它，直接返回 502。
  日志同一秒先 `unbind anti theft via direct write`(WARN)、紧接着 `unbind anti theft account … ret_code 769`(ERROR) 就是证据。
- 修法：删掉重复的 502 分支；前端 `AntiTheftUnbindModal` 增加 `onRefresh`，catch 里也刷一次列表
  （后端可能已改库、只是回读/提示环节失败，界面不能停在「已开启」）。
- 部署：后端 sha256 `7d40a674…016b7a`（01:08）、前端 `index-CSRwjPuy.js`（835,229 B，01:09）。
  回滚点 `backups/xuanmanager.20261109-0107-rollback`、`web.previous-anti-theft-refresh-20261109-010831`。
- 结论：`测试盟主`(54) 现已解绑（on=0 / revision=2）。再点会回 409「该玩家当前没有开启防盗号」，是正常结果。
  验证成功路径要另找还开着防盗号的号（库里还有 10 个：182605 / 472661 / 200760 / 718968 / 440554 / 319317 / 289503 / 534810 / 589272 / 628099）。

## 已上线（2026-11-09，主人明确要求）

- 第一轮 00:37：后端 sha256 `c0496722…12ad95`；前端 `index-DHrYUkju.js`（835,201 B，与本地 dist 一致，含「缺少玩家 ID」文案），`/www/html/.xuanmanager/web`。
- 第二轮 00:48：后端 sha256 `4315da79…d27cdbd`（10,092,728 B），health 200。
- 回滚点：`backups/xuanmanager.20261109-0037-rollback`、`backups/xuanmanager.20261109-0047-rollback`、`web.previous-anti-theft-playerid-20261109-0037`。

## 未完成 / 后续

- 登录态页面视觉复核（列表里玩家 ID 是否补出、解绑是否真的成功回读）要主人实测——部署机无管理员凭据。
- 根子在注册流程没回写 `third_marketing_info.player_guuid`，KB 服务端属另一仓库，未处理；只要还会产生缺 guuid 的已绑定行，就会继续出现「缺少玩家 ID」的行（现在至少不会报「接口不存在」）。
- 代码改动未提交 git（本次只做了线上部署）。
