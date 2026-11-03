# 2026-11-04 我的页：当前俱乐部卡片新增「联盟红利」

## 目标

「我的」当前俱乐部卡片底部联盟区新增「联盟红利」按钮，仅联盟创建者（总群主）可见；点击复用「我的红利」界面，按 V2 联盟接口展示联盟抽成。

## 文档依据

`服务器文档整理/俱乐部俱乐部联盟模式V2方案-客户端接口文档.md` §10：

- `查询_联盟_红利_统计` → `ClubUnionBonusStats`（今日/昨日新增、累计提取、未提取）
- `查询_联盟_红利_明细` → `ClubUnionBonusList`（`club_id/bonus/room_id/player/date`）
- `提取_联盟_红利`（`extract_gold` 整数元）
- v2.11：`提取_联盟_红利` 流水为 `联盟红利提取`，与代理红利 `红利提取` 分开。

## 改动文件

- `assets/scripts/UI/panelMyHongli.ts`
  - 新增 `mode=union`：统计走 `查询_联盟_红利_统计`，明细走 `查询_联盟_红利_明细`，提取走 `提取_联盟_红利`。
  - 监听 `ClubUnionBonusStats` / `ClubUnionBonusList`；累计红利 = 未提取 + 累计提取。
  - 联盟明细的「类型」列显示来源俱乐部 ID，玩家列取 `player`。
  - 俱乐部模式逻辑不变。
- `assets/scripts/UI/ClubManagementView.ts`
  - 卡片新增「联盟红利」显隐，复用 `canReviewUnion`（仅当前俱乐部创建者且已入盟、未确认非总群主时不收）。
  - 总群主卡片高度 320 → 410，容纳第三行按钮；点击打开 `panelUnionHongli`。
- `assets/resources/UI/panelUnionHongli.prefab` + `.meta`（新增）
  - 从 `panelMyHongli.prefab` 复制，只改静态文字：标题「联盟红利」、表头「类型」→「来源俱乐部」，脚本仍复用 `panelMyHongli`，通过 `mode=union` 走联盟接口。
- `assets/resources/UI/panelMain.prefab`
  - 在当前俱乐部卡片下复制「盟友管理」按钮，新增「联盟红利」节点（292×48，位于联盟按钮下一行，Prefab 默认隐藏，运行时按身份显示），美术资源与联盟按钮一致。

## 验证结果

- `tsc -p tsconfig.json --noEmit`：改动脚本除项目通用的 `require` 声明报错外无新增类型错误。
- 新旧 Prefab JSON 解析、`__id__` 引用、根节点名、新 Prefab UUID 唯一性检查通过；`git diff --check` 通过。
- 正式服 01:12 KBE/8890 已恢复；后台只读调用统计/明细返回 `512 {}`（异步推送，无 client 时不回数据），真实客户端 payload 待在线总群主账号验证。
- **未验证**：Creator 重新导入、Prefab 视觉/点击、构建、真机；联盟红利真实回包与提取。

## 下一步

- Creator 导入新 Prefab 后检查：卡片第三行按钮位置、410 高度下底边距、按钮点击打开标题/表头正确的联盟面板。
- 用在线联盟创建者验证统计、明细、提取；非总群主确认按钮不出现且直调返回权限错误。
