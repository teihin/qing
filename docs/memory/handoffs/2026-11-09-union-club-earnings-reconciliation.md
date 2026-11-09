# 2026-11-09 联盟/俱乐部收益对账：暗抽、奖池两个分栏

- 分支：`codex/club-ui`（工作区含其他任务未提交修改；本次只动下列文件）
- 状态：代码、`go build/test/vet`、`tsc/eslint/vite build` 通过；**未部署 8891、未登录联调、未在浏览器里点开页面**

## 目标

后台「联盟管理」每个大盟主、「俱乐部管理」每个群主后面增加「收益对账」入口，弹窗内分「暗抽收益 / 奖池收益」两个分栏，显示区间与每日收益、分成比例、按俱乐部汇总和逐笔明细，方便按联盟/俱乐部每天对账。后期外部俱乐部可能独立分成，因此不能只做全平台汇总。

## 数据口径（2026-11-09 直连线上 `kbedm` 只读核对）

- 暗抽：`usr_income_info`
  - `remark5='uniondark'`（联盟暗抽）/ `darkroot`（独立俱乐部创建者暗抽）；
  - `remark1` = 收益归属账号，`proxy_guuid='club-<俱乐部号>'` = 产生收益的俱乐部；
  - `remark3` = 分成基数（元），`remark4` = 本笔实际执行的暗抽值，`remark2='<房间水率>-<房间号>'`；
  - 到账 `tax_number`，平台再扣的红利暗抽 `bonus_tax_number`；净额 = `tax_number - IFNULL(bonus_tax_number,0)`。
  - 实测：联盟 947486 在 11-05～11-09 共 42 笔、净 214.35 元、基数 295.64 元。
- 奖池：`usr_income_info2`
  - `remark1` = 收益归属账号，`proxy_guuid='club-<俱乐部号>'`；
  - 同时含 `unionroot`（联盟层级）与 `clubroot`（创建者层级）；与账号红利流水 `usr_activity_info_sub_hongli.activity_type='红利2'` **逐笔一致**；
  - `winner_guuid='badpool'` / `winner_name='惩罚池'` 为派奖分成，其余为提留；
  - 实测：同一联盟 11-05～11-09 共 78 笔、1206.00 元；`红利2` 同期合计完全一致（11-04 另有 183.00 元，不在该区间）。
- 奖池配置：`usr_hash_info` 的 `club_reward_cfg|<pool_key>`；联盟池 `pool_key=union_id`，独立俱乐部 `club-<club_id>`；同 key 多行取最新 id。`reward_on` 缺键 = 关闭；`reward_modify` 缺键回落全局命令 `获取_大厅_配置数据`；`reward_card_bili` 缺键时尝试读全局对象，读不到显示「跟随全局」。
- 收益归属：已入盟俱乐部的暗抽/奖池归联盟大盟主，独立俱乐部归群主；接口按 `remark1` 取当前归属，同时按 `proxy_guuid` 拆到俱乐部。
- 关键坑：`usr_income_info` 里的 `unionroot` 是**联盟抽水上缴**，不是奖池；奖池只读 `usr_income_info2`，不要混用。

## 改动文件

后端（新增）：

- `XuanManager/server/internal/api/owner_earnings.go`
  - `GET /api/game/unions/{unionId}/earnings`
  - `GET /api/game/clubs/{clubId}/earnings`
  - 权限复用 `game.union.view` / `game.club.view`；只读；日期默认北京时间今天、最多 31 天；联盟维度可再加 `clubId`。
  - 返回 target / summary / daily / clubs / details / dark 或 jackpot / warnings。
- `XuanManager/server/internal/api/owner_earnings_test.go`
  - 日期与类型校验、比例换算（分÷元）、俱乐部键解析、水率解析、SQL 条件拼接、奖池 JSON 解析。

后端（修改）：

- `XuanManager/server/internal/api/server.go`：只新增两条 GET 路由。

前端（新增）：

- `XuanManager/web/src/components/OwnerEarningsModal.tsx`
  - 两个分栏、今天/昨天/近 7 天/本月快捷、日期区间、联盟维度按俱乐部筛选；
  - 区间汇总、按日表、按俱乐部表（含 0 收益俱乐部）、逐笔明细分页；
  - 暗抽：当前设置快照、区间实际比例、每笔「暗抽值 / 实际比例 / 房间水率」；
  - 奖池：池键/类型/开关、各底皮提留、5 档派奖比例、提留/派奖分成类型。

前端（修改）：

- `XuanManager/web/src/pages/UnionsPage.tsx`：联盟行新增「收益对账」。
- `XuanManager/web/src/pages/ClubsPage.tsx`：俱乐部行新增「收益对账」；无群主且未入盟时禁用。
- `XuanManager/web/src/components/ui.tsx`：`Modal` 增加 `xwide`（1180px）。
- `XuanManager/web/src/types.ts`：收益对账响应类型。
- `XuanManager/web/src/styles.css`：`.earnings-*` 样式。
- `XuanManager/新后台管理系统接口文档.md`：新增 §10.4。

## 验证

已做：

- `go build ./...`、`go vet ./...`、`go test ./...` 通过。
- `tsc -b`、`eslint src`、`vite build` 通过；产物 `dist/assets/index-BSpc5oDf.js`（每次构建哈希会变）。
- 线上只读 SQL 抽查：
  - 暗抽按日/按俱乐部/明细查询与接口 SQL 完全一致；
  - 奖池汇总 120600 分 = 1206.00 元，与 `红利2` 对账一致；
  - 暗抽配置查询只返回 `COALESCE(dark_percent,-1)=-1`（该联盟代理均未单独设置），页面已注明「未单独设置按房间默认，不等于不抽」。
- `git diff --check` 通过（本次涉及文件）。

## 未验证 / 风险

1. **未部署**：8891 仍是旧二进制/旧前端；新路由未在线上提供，未登录实测。
2. **未在浏览器打开弹窗**：本机开发代理指向正式后台，但没有可用后台登录态；只做了类型/构建/接口 SQL 校验。
3. **全局奖池配置读取**：`获取_大厅_配置数据` 的 `reward_card_bili` 对象格式按「JSON 对象或 JSON 字符串包裹对象」兼容；若游戏服实际是 CSV，会显示「跟随全局」，不影响收益明细。`reward_modify` 沿用后台已有 CSV 口径。
4. **历史归属变化**：收益归属按游戏服当前 `remark1` 取；俱乐部入盟/离盟前后的历史归属切换未做双归属合并，页面已提示「以游戏服当前记录为准」。
5. **未做导出**：本期只有页面查看；如财务需要每日 CSV，可后续加。
6. **权限**：复用联盟/俱乐部查看权限，没有新增模块或迁移；没有权限的账号直接调接口仍会被后端拒绝。

## 下一步

1. 部署到候选 8892，登录后台，用联盟 947486（大盟主 895742）和俱乐部 260673 核对：暗抽 11-05～11-09 应为 42 笔 / 214.35 元；奖池应为 78 笔 / 1206.00 元。
2. 用联盟 291261（配置只有 `reward_on`）确认全局提留回落和派奖比例显示。
3. 造一个独立俱乐部（`union_id=''`）验证 `darkroot` / `clubroot` 与 `club-<id>` 池配置。
4. 页面目视检查 xwide 弹窗在 1366/1920 宽度下的表格滚动与分页，再决定是否发布正式 8891。
