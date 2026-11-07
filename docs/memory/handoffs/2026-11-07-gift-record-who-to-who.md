# 2026-11-07 赠送记录改成「谁 → 谁」

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`（工作区含其它任务未提交修改，本次只动下列文件）。

## 需求

「我的 → 赠送」的记录行原来只显示一方，且俱乐部模式下显示的是自己。改为显示「发起人 → 接收人」，两边都带名字 + ID，并调整表头与列。

## 改动文件

### `assets/resources/Prefabs/赠送记录对象.prefab`（行模板）

- 新增 `头像2`（收礼人头像，克隆原 `头像` 子树，两个头像统一缩到 58×58.7）、`id2`（收礼人名字+ID）、`arrow`（`→`）。
- 节点名沿用脚本契约：`id` = 送礼人、`id2` = 收礼人、`头像` = 送礼人头像、`头像2` = 收礼人头像、`count` / `type` / `time` 不变。
- 列位：头像 -320、发起人 -287（左对齐，宽 160）、箭头 -114（18 宽、24 号，距两侧各 6px / 4px）、接收人头像 -70、接收人 -37（宽 160）、金额 (170, +22)、类型 (170, -22)、时间 283。
- 行高保持 90.06，`content` 的 Layout 无需改。

### `assets/resources/UI/panelMain.prefab`（赠送页表头）

- 原表头图 `gift_history_header_exact.png` 自带「类型 / 目标玩家 / 金额 / 时间」美术字，与新列不符。
- 处理：关掉「标题」自身的 Sprite，新增 `表头裁切`（cc.Mask RECT，706×49）只露上半的「赠送记录」标题；`表头底条` 复用行背景图铺文字区；4 个 `列名_发起人 / 列名_接收人 / 列名_金额 / 列名_时间` Label（发起人/接收人左对齐到行内名字起点 -287 / -37，金额/时间居中 170 / 283）。**没有生成或修改任何美术字**。

### `assets/scripts/UI/panelMain.ts`

- `setClubGiftRecordItemInfo`：按流水方向拆出 sender / receiver。
  - `积分赠送`（gold<0）= 我送对方；`积分受赠`（gold>0）= 对方送我；`上分/下分/添加积分` = 操作人 → 本人。
  - 旧数据 `opter_name == name`（2026-11-02 前）按「对方缺失」处理，显示 `—`。
- `setExchangeItemInfo`（大厅 ExchangeInfo）也走同一套「谁 → 谁」渲染。
- 新增 `FillGiftRecordRow` / `FillGiftRecordAvatar` / `EnsureClubGiftMemberMap` / `OnClubGiftMemberList` / `ClubGiftMemberId`。
- 注册 `NumberList`，用 `查询_俱乐部_成员`（user_id=ALL, count=200, page=0）建「名字 → ID」映射：积分流水的 `ClubGoldWater` 行只有 `opter_name`，没有对方 ID，靠成员表补；成员表回包前先渲染，回包后重放一次。
- 金额配色沿用客户口径（红加绿减）。

## 接口口径

- 数据源仍是 `查询_俱乐部_积分流水` + `only_add=1`（`ClubGoldWater` 推送），未切换到 `查询_俱乐部_赠送_记录`（`ClubGiveList`），因为无法核实该命令当前线上是否已部署。
- 对方 ID 正规解法是服务端在 `积分赠送 / 积分受赠` 行补 `opter_guuid`；客户端已按 `opter_guuid / actor_guuid / target_guuid` 优先读取，服务端补了字段就直接生效。

## 验证

- 两个 Prefab JSON 可解析、`__id__` 无越界；克隆子树 `node` 引用自检通过。
- `panelMain.ts` `ts.transpileModule` 0 诊断。
- 用 `PingFF.ttf` 实测字宽核对列宽（`ID:659348` = 104px、5 字名 132px、时间 138px），并按实际贴图（行背景 + 头像环）离屏合成预览确认无重叠。
- Creator 已重新导入（`library/imports/51/…`、`d0/…` 16:44:26，产物含新节点）。

## 未完成 / 待验证

- 未在 Creator 编辑器内、网页和真机上实际打开该页看换行与截断。
- 成员表按名字匹配补 ID：重名或成员数超 200 时对方 ID 会显示 `—`；普通玩家查成员表可能只返回直属成员。
- 页签/翻页、`ClubGoldAddRecord` 老数据路径未走真实回包。
