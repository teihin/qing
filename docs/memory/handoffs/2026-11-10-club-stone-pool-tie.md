# 「我的」俱乐部卡片钻石池取错同秒最新行

- 日期：2026-11-10
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：客户端代码已改（未构建、未真机）；后台无需改动

## 现象

- 「我的」俱乐部卡片显示「钻石池：10」，库里 `club_agent_info.stone` 实际为 8（俱乐部 `775447`，群主 `718968`）。
- 同一秒（2026-11-10 21:11:40）连续产生三条开房扣费流水：
  - `id=1974` `9→8`
  - `id=1973` `10→9`
  - `id=1972` `11→10`

## 根因

- 卡片数值不是直接读余额字段，而是 `查询_俱乐部_钻石流水`（`club_id`、`count=100`、`page=0`）→ 服务端推 `ClubStoneWater` → 客户端按 `date` 取最新一条，读 `remark` 箭头后的池子数量。
- 服务端按最新在前返回。`panelMain.OnClubStoneWater` 用 `time >= latestTime` 更新，三条同秒行会依次命中，最后取到数组里较旧的一条（`11→10`），显示 10。
- 换成严格 `>` 后，同秒只保留第一条（数组第一条 = `9→8`），显示 8。

## 改动

- `assets/scripts/UI/panelMain.ts` `OnClubStoneWater`：`time >= latestTime` → `time > latestTime`，并补注释说明同秒多条扣费的取值口径。
- 卡片渲染仍在 `assets/scripts/UI/ClubManagementView.ts:451`，数据入口不变。

## 验证

- 用三条同秒流水做本地模拟：旧逻辑取到 10，新逻辑取到 8。
- 客户端 TypeScript 单文件检查：无新增类型错误（仅原有 `require` 声明缺失）。
- 未做 Creator 构建/真机；线上客户端仍是旧逻辑。

## 下一步

- 下次客户端构建/热更后，进「我的」页确认同秒连续扣费后池余额与 `club_agent_info.stone` 一致；页面 30 秒轮询一次。
- 若后续服务端在 `ClubStoneWater` 增加行 id 或余额字段，可改为直接读余额，彻底避免从 `remark` 反推。
