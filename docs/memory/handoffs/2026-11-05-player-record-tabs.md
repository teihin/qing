# 2026-11-05 玩家信息弹窗：页签换装 + 额度记录

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`7e27148`（工作区含其他任务未提交修改，本次只改下列文件）

## 目标

1. 玩家信息弹窗（俱乐部成员列表点开）顶部「成员设置 / 下级成员」改成游戏设置同款胶囊页签。
2. 新增「额度记录」页签，内含「上下分流水」「牌局流水」两个子页签，按俱乐部 + 玩家查询。
3. 我的成员列表搜索框支持中文/英文昵称（原来只能输数字）。

## 改动文件

- `assets/scripts/UI/ClubManagementView.ts`
  - `settingsTab` 增加 `records`；新增 `recordKind/recordRows/recordLoading/recordError/recordPage/recordTotal/recordToken`。
  - 新增 `selectRecordKind()`、`loadRecords()`、`renderRecords()`、`fillRecordRow()`；翻页 20 条/页，列表可滚动。
  - 打开玩家/切页签/上下分成功后的刷新都带旧请求作废（token + 玩家 ID + kind 校验）。
  - 页签按钮白名单增加：`额度记录`、`额度记录激活`、`记录_上下分(激活)`、`记录_牌局(激活)`、`记录上一页`、`记录下一页`。
- `assets/scripts/UI/ClubManagementApi.ts`
  - `ClubManagementApi` 增加 `records(clubId, userId, kind, page, count)`。
  - 注册 `ClubGoldWater`；单条在途 + 队列，避免两个子页签快速切换时无 context 的推送互相顶替。
  - 推送/同步回包按 `guuid`、`context`（如带）和 kind 过滤。
- `assets/resources/UI/panelMain.prefab`
  - 「成员设置 / 成员设置非激活 / 下级成员 / 下级成员激活」改为 196×56 胶囊，复用 `assets/V8/game_settings/gs_tab_on.png` / `gs_tab_off.png`（UUID 不变）。
  - 新增「额度记录 / 额度记录激活」第三页签。
  - 新增「玩家设置额度记录」容器：两个子页签、表头、滚动列表、行模板、空状态、上一页/下一页。
  - 旧的下划线/菱形节点保留但隐藏，避免旧引用失效。
  - 成员搜索输入 `cc.EditBox._N$inputMode` 由 `2`（NUMERIC）改为 `6`（SINGLE_LINE）。
- `tools/apply_player_quota_records.py`
  - 本次 Prefab 生成脚本，可重复执行前先确认「玩家设置额度记录」不存在。

## 接口口径（按 `服务器文档整理/俱乐部积分与额度方案-客户端接口文档.md` §11.1）

- 上下分流水：`查询_俱乐部_积分流水`，`club_id` + `user_id` + `only_add=1`，只显示服务端已命名的 `上分` / `下分`（过滤掉 `积分赠送`）。
- 牌局流水：同一命令 `only_add=0`，客户端只保留 `带入` / `结算`，展示房间号；`gold` 为本次变动（元），`remark` 为变动后余额。
- 列表统一走 `ClubGoldWater` 异步推送；行字段 `date/type/gold/remark/room_id/opter_name/guuid/name/number/count`。
- 权限由服务端校验：自己 / 群主 / boss 可查任意账号；代理只能查自己子树，越权回包会显示服务端错误文案。
- 盟主行使用其所属俱乐部 `club_id` 查询；缺 `club_id` 时提示刷新盟友管理，不兜底当前俱乐部。
- 若后续服务端提供「玩家参与的牌局」专用推送，可只替换 `records()` 的 header/route 与行映射，页面结构不变。

## 2026-11-05 追加修正（页签选中态 / 间距 / 记录翻页）

- 页签底板：`成员设置`、`成员设置非激活`、`下级成员激活` 三个节点的 Sprite 组件 `_enabled=false`，导致选中态没有金色底；已打开，六个页签底板全部可见。
- 页签位置：六个页签节点 y 271 → 251，页签顶边 279，与积分胶囊底边 296 留 17px；页签底边 223，与内容卡顶边 200 留 23px。
- 额度记录翻页：改用 `assets/V7/agent_v8_page_first/prev/next/last.png`（与下级成员同一套 64×64 箭头），位置按页面容器 `(0,-150)` 换算到面板 y=-547，与下级成员翻页同一行；页签内新增 `记录第一页`、`记录最后一页` 节点（无 Widget，绝对定位）。
- 脚本：`HandleButton` 白名单与分支增加 `记录第一页` / `记录最后一页`；`renderRecords` 的四个翻页键可用态改为在 `玩家设置额度记录` 容器内查找（原来按面板查找会取不到节点）。

## 2026-11-05 额度记录列与牌局过滤

- 上下分流水最后一列由「操作人」改为「增加对象」，显示服务端 `ClubGoldWater` 行的 `name`（无值回退 `guuid`）；余额仍取 `remark`。
- 牌局流水不再按类型过滤（原只留「带入/结算」），`only_add=0` 回包原样展示；牌局行有 `room_id` 时说明列仍显示「房间 xxx」，没有房间号时显示对象名。
- 上下分流水保留「上分/下分」过滤（`only_add=1` 还可能带积分赠送）。
- 改 `ClubManagementView.ts`（`ClubRecord` 增加 `userId/userName`、`fillRecordRow`、表头）与 `ClubManagementApi.ts`（去掉 game 过滤、映射 `guuid/name`）。语法/定向 tsc 通过，真实回包待验证。

## 2026-11-05 盟主「下级成员」为空

- 现象：大盟主打开盟主（另一家俱乐部创建者）→「下级成员」，回包 `NumberList` 有一行，界面却显示「暂无直属成员」。
- 原因：`loadDownline` 会过滤掉「被查节点本人」这一首行；当回包只有本人一行时列表为空。
- 用户口径（2026-11-05）：查下属一律同时传「目标人 ID（`agent_id`）+ 俱乐部 ID」，盟主不特殊处理；`NumberList` 直接按服务端结果渲染，不再过滤首行。
- 处理：`ClubManagementView.ts` `loadDownline` 恢复固定传 `playerId` 作 `agent_id`，`selectedDownline` 直接取 `result.items`。
- 身份：显示服务端首行后，盟主行因 `is_agent=1` 被 `memberIdentity` 判成合伙人；已改为创建者角色（`role=老板`）优先于 `is_agent`，且当行的 `club_id` 与当前俱乐部不同（大盟主看属下俱乐部）时显示「盟主」，同俱乐部仍显示「群主」。
- 待验证：真实回包在真机上的展示（首行为被查节点本人，且身份为盟主）。

## 验证

- Prefab JSON 可解析，`__id__` 无越界；新增 4210 个对象（原 4048 左右）引用完整。
- 新增节点父子关系、ScrollView `content` 引用、Mask 组件、页签 SpriteFrame 均静态核对通过。
- 离屏预览 `/tmp/player-settings-records-preview.png`：三页签、两个子页签、表头、示例流水行、分页位置正常。
- 定向 TypeScript 检查（`ChatTool/web/node_modules/.bin/tsc` 编译 `ClubManagementView.ts` / `ClubManagementApi.ts`）只剩项目既有错误（`require` 声明、旧 `Widget.alignFlags`、旧输入模式联合类型），本次新增代码无新增错误。
- 追加修正后：Prefab 对象 4218 个，`__id__` 无越界，新增节点父子关系/贴图/按钮静态核对通过；按 Prefab 离屏渲染三个页签（`/tmp/settings_member.png`、`/tmp/settings_records.png`、`/tmp/settings_downline.png`）确认选中态金底、页签与积分胶囊分离、两处翻页同一行；`node --experimental-strip-types --check` 语法通过，定向 tsc 仍只剩上述既有错误。

## 未完成 / 待验证

- Creator 导入后页签九宫格拉伸、长屏适配、滚动列表在真机上的手感。
- 构建、真机、真实俱乐部/玩家回包（尤其 `ClubGoldWater` 是否按 `user_id` 过滤、`only_add=1` 的 type 文案）。
- 服务端若对 `查询_俱乐部_积分流水` 的 `user_id` 仍做旧权限校验，需要真实账号验证代理/群主/盟主三种身份。
- 成员搜索框已改成单行文本，但真实中文输入法在安卓/iOS 上的候选词行为需真机确认。
