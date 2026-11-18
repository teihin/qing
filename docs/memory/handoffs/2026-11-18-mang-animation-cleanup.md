# 2026-11-18 投芒动画收尾修复

## 目录与范围

- 分支：`codex/club-ui`
- 主要文件：`assets/scripts/logic/DrhPlayerLogic.ts`
- 目标：投芒动画结束后清理临时「芒X」，按本手真实下注额显示下注位，庄位无下注时不残留芒数。

## 已完成

- `ShowMangPayCount()` 只更新动画期间的临时显示，不再把「芒X」写入 `strKeepCoin` 下注缓存。
- `UpdateFenAnimate()` 增加 `bMangPayShowing`，投芒动画停留期间不会被 `bei_shu=0` 的状态刷新提前收掉。
- 临时芒数有 1.6 秒有效窗口，动画被打断后不会永久拦截真实下注刷新；同一座位重复收到开局推送时不再清掉下注缓存或叠加第二套动画，动画结束后的短冷却也会忽略迟到重复推送，并用序号让旧兜底失效。
- 动画起飞时清除临时芒数，动画结束和 1.5 秒兜底统一按最新 `info.beicount` 收尾。无下注时隐藏，已有真实下注缓存时恢复下注额。
- 动画回程使用两个独立的 `cc.moveTo` 实例，避免同一个 Action 在一个 Sequence 中重复使用。
- 新一手开局消息缺少 `mang_xiu_current` 或 `bei_shu` 时清掉上一手缓存，避免旧芒数或旧下注额串手。

## 验证

- TypeScript 转译：通过 `DrhPlayerLogic.ts`、`GameDef.ts`。
- `git diff --check`：通过。
- `python3 docs/memory/check_memory.py check --root "/Volumes/SSD/qing"`：0 个错误，5 个既有预算警告。

## 待验证

- 未启动 Cocos Creator 导入、构建、热更新或真机联调。
- 需要四端同桌连续多局复测，重点观察庄位无下注、其他玩家有下注、重复状态推送和切后台/恢复场景。
- 若仍出现庄位重复播放，应在 `玩家_开局_事件` 和 `ThrowGold2Mang()` 增加事件序号日志，确认服务端是否重复推送同一开局事件。
