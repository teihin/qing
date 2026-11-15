# 逃跑惩罚统计（客户端）

日期：2026-11-15 ｜ 分支：`codex/club-ui` ｜ 状态：代码 + prefab 就绪，**未构建、未真机、未联调**

## 目标

大盟主（联盟总群主）在「我的」界面中间直接看到「逃跑惩罚统计」入口，按钮上显示今日扣除总额；
点开能看到当日每笔罚款的玩家 / 金额 / 逃跑时间 / 所属联盟（分盟）/ 牌桌。

## 接口

《俱乐部逃跑惩罚统计-客户端接口文档》（`服务器文档整理/`）：

- Hall 命令 `查询_逃跑_惩罚_统计`，参数 `context` / `date`(YYYY-MM-DD，空=今天) / `count` / `page` / `user_id`。
- 先回 `GC_OK`，列表经路由 **`ClubUnionChengfaStats`** 推送。回包**列表键是 `result`**，`count` 是当日总条数，
  另有 `income_gold`（今日实际到账）/ `total`（今日应扣，元）/ `total_fen` / `player_count` / `union_name`。
- 行：`time`(HH:mm:ss) / `user_name` / `user_guuid` / `bad_fen` / `bad_money` / `club_name` / `union_name` /
  `room_name` / `settle_batch`（空 = 未出账，待结转）。

## 改动文件

| 文件 | 说明 |
| --- | --- |
| `assets/scripts/UI/panelEscapePenalty.ts`(+meta) | 新面板脚本，走 `ScrollViewEx` + 服务端分页 |
| `assets/resources/UI/panelEscapePenalty.prefab`(+meta) | 由 `panelUpDownRecord.prefab` 复制改造 |
| `assets/resources/Prefabs/逃跑惩罚记录对象.prefab`(+meta) | 由 `上下分记录对象.prefab` 复制改造，5 列 |
| `assets/resources/UI/panelMain.prefab` | 「操作」下新增「逃跑惩罚统计」按钮（底图 = `money_v8_summary_panel` 九宫格 + 金币图标 + Label） |
| `assets/scripts/UI/panelMain.ts` | 注册 `ClubUnionChengfaStats`、按钮可见性/点击、今日总额请求与刷新 |
| `assets/scripts/UI/ClubManagementView.ts` | `syncProfileScroll` 行高按实际行数算 |
| `assets/V7/mine_chengfa_exact.png`(+meta) | 新按钮美术（AI 图生图改字，443×138，与额度授权记录同款） |
| `assets/V7/money_v8_table_chengfa.png`(+meta) | 新表头美术（5 列，892×111） |

## 关键实现点

1. **两张新美术都是 AI 图生图改字出来**（imagegen，参考图分别是 `mine_quota_grant_exact.png` 与
   `money_v8_table_updown.png`）：
   - 按钮：`mine_chengfa_exact.png`，字数核对无误；生成图右下角带「AI生成」水印，用左下角 90×60 镜像覆盖。
   - 表头：`money_v8_table_chengfa.png`，第一版「时间」「玩家」之间多出一条竖线，按左右列插值抹掉；
     水印用右侧逐行参考色填充。两图都做了 6bit 量化压体积（48.5KB / 43.5KB，均小于同组原图）。
   - **行对象的列坐标是按表头图的文字块实测重排的**（亮度分组求 5 个标题中心，再换算行内 x）：
     `time -263.8 / name -132.7 / money -6.0 / club 121.2 / room 253.9`，分隔线取相邻中心中点；
     表头与行数据不重新测就会整体错位 10~15px。
2. **面板标题/汇总仍是 Label**：标题「逃跑惩罚统计」与汇总行用 PingFF Label（Widget top 定位），
   关闭按钮换成 `back.png`（原先是透明底 + 隐藏子节点）。表头图位置 top=124，底部 10px 压在列表上（与原页一致）。
3. **今日总额**：`panelMain.RequestUnionChengfaToday()` 在按钮可见时请求（60 秒节流，`我的` 页 30 秒轮询里也调一次），
   回包写进按钮的「今日」Label（`-X 元`，绿色 = 扣减）。
4. **分页**：`ScrollViewEx.UpdateList(payload,"result","逃跑惩罚记录对象",10,…)`，页码由回包 `number/count` 驱动。
5. **行高**：「操作」是两列 Grid，入口从 9 个增到 10 个 → 仍是 5 行；`syncProfileScroll` 原来写死 529.13（5 行）、
   421.96（4 行），现在按 `行数 × 107.17` 算，第 6 行也不会被 content 裁掉。

## 验证记录

- `ts.transpileModule` 三个 ts 全 0 诊断（仅语法，非类型检查）。
- prefab JSON 引用完整性脚本校验通过（3 个文件 0 坏引用）。
- `tools/render_ui_prefab.py` 离屏渲染面板与行对象：标题/汇总/5 列表头/列表/分页无重叠，
  行 5 列与表头对齐（该工具忽略 Widget，新节点已写入按 750×1334 算好的 `_trs` 坐标）。

## 未完成 / 待验证

- Creator 尚未导入新 prefab（library 未生成），编辑器内未目视；**没构建、没上真机**。
- 接口未联调：`ClubUnionChengfaStats` 的真实回包结构（是否真把列表放在 `result`、是否带 `context`）待确认。
- 行点击下钻（按 `user_id` 看单个玩家流水）、以及文档 §5 提的「积分流水」跳转都没做，需求待确认。
- 按钮上不再显示今日金额（客户要求去掉），总额只在面板汇总行显示。
