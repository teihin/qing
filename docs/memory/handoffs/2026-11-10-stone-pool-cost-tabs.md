# 2026-11-10 钻石池消耗：拆成「钻石池兑换 / 开房消耗」两个页签

- 日期：2026-11-10
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：代码、Prefab、资源已落盘；**未 Creator 导入、未构建、未真机、未连服务端联调**

## 目标

「我的 → 钻石池消耗」弹窗内部拆成两个页签：

1. **钻石池兑换**：沿用 `查询_俱乐部_钻石兑换_记录` / `ClubStoneExchangeList`，列不变。
2. **开房消耗**：改用 `查询_俱乐部_钻石流水` / `ClubStoneWater`，只显示房间扣费行，
   列改成 时间 / 房间号 / 消耗钻石 / 扣除后余额。

## 改动

- `assets/scripts/UI/panelStonePoolCost.ts`
  - 新增页签状态与两个页签的点击/高亮；切页签清空列表、重置分页、切换 `callBackFresh`。
  - 开房消耗请求：`{"header":"查询_俱乐部_钻石流水","club_id":...,"count":100,"page":0}`；
    收到 `ClubStoneWater` 后按 `type` 含「房间」或 `room_id` 非空且 `stone<0` 过滤。
  - 服务端总条数 100 封顶，所以一次取回后在客户端按 10 条/页分页；页码标签手动回写。
  - 行字段：`date`、`room_id`、`stone`（负数，绿色 `-n`）、`remark` 箭头后的余额。
  - 同步回包只匹配各自的 context；`0x200` 且带 `ClubStoneWater` 时也兼容处理。
- `assets/resources/UI/panelStonePoolCost.prefab`
  - 标题栏下新增 `页签` 容器（top=132，702×56），两个页签 200×56，复用
    `assets/V8/game_settings/gs_tab_on/off.png`；激活金底深字、非激活深底浅字。
  - 原 `表头`/`列表` 下移 64（top 199 / 265.95），列表 bottom 不变；`表头2` 同位置新增、默认隐藏。
  - 所有新增节点带 `cc.Widget`（页签贴顶、水平居中；表头/列表沿用原 Widget），1334/1624 两档不压叠。
- `assets/V7/money_v8_table_room_cost.png` + `.meta`
  - 892×111，复用 `money_v8_table_stone_pool.png` 底图；文字从现有表头美术拼字，保持和「时间」同一套
    3D 描边/金色渐变：房间号取自 `money_v8_table_my_hongli.png`，消耗/钻石取自
    `money_v8_table_stone_pool.png`，余额取自 `money_v8_table_updown.png`。
- `assets/resources/Prefabs/开房消耗记录对象.prefab` + `.meta`
  - 从 `钻石兑换记录对象.prefab` 克隆；`type` 改名 `room` 并居中到第二列，隐藏 `小金币` 与类型图标。

## 验证

- `node --experimental-strip-types --check assets/scripts/UI/panelStonePoolCost.ts` 通过。
- Prefab `__id__` 全部可解析；新增子树 `fileId` 唯一；新贴图 `.meta` 尺寸与 PNG 一致；全仓 UUID 无重复。
- `tools/render_ui_prefab.py` 离屏渲染：1334 / 1624 两档页签、表头、列表、分页不压叠；
  第二个表头与房间行样例列位置对齐。
- 未做：Creator 2.4.13 导入/重编译、构建、网页与真机、真实 `ClubStoneWater` 推送。

## 待确认 / 注意

- **房间号来源**：服务端已在 `ClubStoneWater` 行补 `room_id`；客户端优先读 `room_id`，
  兼容 `roomid`/`roomId`/`room_no`/`room_number`/`room`。截图里显示 `—` 说明当时推送还是空值
  （或旧包），若更新后仍为空，请抓一条推送核对实际字段名。
- 扣费方式（开房 / 周期）不在流水行里，当前页签不展示；若服务端在 `ClubStoneWater`
  行补 `reason`，会拼在房间号后面显示（`123456 开房`）。
- 服务端总条数 100 封顶，开房消耗一次只取最近 100 条；更早记录需要服务端加筛选/分页能力。
