# 2026-10-29 赢分离开二次确认

## 目录 / 分支

- `/Volumes/SSD/qing`，分支 `codex/club-ui`。改动未提交。

## 目标

本人在赢分状态（当前盈亏 > 0）时点「站起围观」或「退出房间」，先弹双按钮确认框：
「赢分离开或站起会扣除30%赢分，是否继续？」。确定才发原协议，取消什么都不做。

## 改动

`assets/scripts/UI/panelGameView.ts`

- `退出房间` 分支：能正常退房的路径改走 `ConfirmLeaveWhileWinning(()=>DoExitRoom())`；原来「已经开局不能退出！」的判断顺序不变，被拦的情况不弹新框。
- `站起围观` 分支：改走同一确认入口，确认后才发 `起立_事件` 并关 `ConfigMain`。
- 新增 `DoExitRoom()`（原退房请求 + panelLoading + 语音退房事件）。
- 新增 `ConfirmLeaveWhileWinning(action)`：赢分时用 `panelMsgView` 的 `arrayEx[0]` 函数入参切双按钮版（`panelMsgView.ts:31-41` 的既有机制）。
- 新增 `IsSelfWinning()`：以 `PlayerList` 的 `total_score` 判定；该字段是服务端口径的当前盈亏（`money_score + boji_score - init_money`，见 `服务器文档整理/俱乐部实时结算-客户端接口文档.md`）。字段缺失时回退 `nGoldNum - begin_score > 0`。

## 验证

- `tsc -p tsconfig.json --noEmit` 过滤 `assets/scripts/UI/panelGameView.ts` 只剩既有的 `require` 报错（第 25 行），无新增诊断。
- **未在 Creator 预览 / 未构建 / 未真机**；服务端扣除 30% 赢分的规则不在本仓，客户端只负责提示和放行。

## 未完成 / 下一步

1. 真机验证：赢分、输分、持平三种状态下站起/退出各点一次，确认「取消」不关菜单（站起）且不发协议。
2. 确认 `普通房间` 是否也该弹这条提示；目前按房间无关实现，只要本人盈亏 > 0 就弹。
3. 牌桌内「战绩面板关闭」也会走离房协议（`panelRecordInfo.ts:86-101` → `HandleRecordInfoClose`），本次未接确认框，需要时再补。
