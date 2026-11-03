# 2026-11-04 我的红利：改为俱乐部 V2 统计与明细

## 目标

「我的红利」不再读取账号 `hongli`/`all_hongli`，全部按当前俱乐部 V2 接口显示。

## 文档依据

- `服务器文档整理/俱乐部俱乐部联盟模式V2方案-客户端接口文档.md` §9（2026-11-04 00:54 更新）：
  - `查询_俱乐部_红利_统计` → `ClubBonusStats`
  - `查询_俱乐部_红利_明细` → `ClubBonusList`
  - `提取_俱乐部_红利`（`extract_gold` 整数元）
- 新旧差异清单明确 `查询_俱乐部_代理_收益`、`提取_玩家_红利` 不能作为 V2 客户端入口。

## 改动文件

- `assets/scripts/UI/panelMyHongli.ts`
  - 顶部统计：`ClubBonusStats` 的 `today_income_fen`、`yesterday_income_fen`、`unclaimed_fen`、`total_extract_fen`；
    `累计红利 = 未提取 + 累计提取`。
  - 明细：`ClubBonusList`，玩家 `name/guuid`、类型按 `level`（clubroot=创建者，club2=2级代理…）、金额 `bonus` 分转元、时间 `date`。
  - 提取：`提取_俱乐部_红利`，按 `floor(未提取分/100)` 全部整数元提取；不足 1 元提示不可提取。
  - 删除账号 `set_hongli` 等监听、`查询_俱乐部_代理_收益` 串行链、`异步_查询_红利_信息` 兜底和 `HongliList` 提取记录。
  - 没有 `club_id` 时只提示“当前没有俱乐部”，不回落账号红利。
- `assets/scripts/UI/panelHongli.ts`：平台代理页打开「我的红利」时改传 `resolveRoomClubId(account)`，不再无参打开。
- `assets/scripts/UI/ClubManagementView.ts`：仅更新注释（文件内其他差异是任务外未提交改动，未触碰）。

## 验证结果

- 临时 `tsc -p tsconfig.json --noEmit`：改动文件除项目通用的 `require` 声明报错外无新增类型错误。
- `git diff --check` 通过。
- **未验证**：真实回包与页面交互。2026-11-04 00:57 检查正式机 KBE 进程和 8890 均不在线，`查询_俱乐部_红利_统计` 无法探测；Creator 导入/构建/真机未执行。
- 待游戏服恢复后确认：`ClubBonusStats` 推送字段、`ClubBonusList` 的 `number/count` 分页、提取成功回包与刷新。

## 2026-11-04 数据不刷新修复

- 实机日志：`查询_俱乐部_红利_统计` / `查询_俱乐部_红利_明细` 的同步 `0x200 {"result":{}}` 先到，`ClubBonusStats` / `ClubBonusList` 推送后到。
- 原代码在 `0x200` 分支清 `statsPending` / `listPending`，导致随后的推送被当成过期消息丢弃，界面一直停在加载/空值。
- 修复：`0x200` 只视为受理回包，不清 pending；仅非 `0x200` 失败时清 pending 并提示。推送到达后再清 pending 并渲染。
- 当前俱乐部 `775447` 的统计字段全为 0、明细为空，修复后应显示 0 和“暂无红利明细”，不是账号历史的 60。
- 生产库核对：`usr_income_info` 0 行、`club_agent_info.bonus` 全 0、`club_union_info.owner_bonus` 为 0，因此当前俱乐部与联盟红利统计为 0、明细为空属于真实数据；旧的 60 来自 `usr_activity_info_sub_hongli` 账号级历史红利，新接口不读该表。

