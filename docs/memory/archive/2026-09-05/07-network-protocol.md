# 历史原文摘录：网络与牌局协议

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 317–327 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## 网络与牌局协议

- 网络层使用 KBEngine/WebSocket 和全局字符串事件总线。
- `PlayerList` 是房间/玩家全量快照；`状态鸡` 是逐座位增量状态。
- 大量协议以手拼 JSON、中文命令字符串及 `reqHallCommand`、`reqGameCommand` 等接口传递。
- 2026-08-11 当前游戏内玩家“赠送金币”不是HTTP接口：`panelGivePad.ts` 通过Account实体RPC `reqAccountCommand(param, content)` 发送，`param` 是 `header=调用_方法_Exchange2`、`target_guuid`、`money_value`、`money_type=gold`、`user_pwd`、`client_version=2022032201` 组成的JSON字符串，`content` 固定为 `P@调用_方法_Exchange2`。金额在客户端不做乘除100或精度转换，直接以输入字符串传给KB服务端；赠送前用 `reqHallCommand` 的 `查询_用户_名字` 命令核对目标ID，结果由 `onExChange`/`onExChange2` 事件返回。
- 2026-08-12 游戏内所有调用 `调用_方法_Exchange2` 的赠送金币入口已统一为正整数金额：`panelMain` 的大厅赠送页、`panelGivePad` 最终确认弹窗和旧 `panelManager` 赠送页的金额 EditBox 均改用 `PHONE_NUMBER` 输入模式，Prefab 占位提示为“请输入整数”；提交前使用相同规则拒绝小数、负数、0、科学计数法、空格和其他非数字内容，并以“赠送金额只能输入大于0的整数！”弹窗提示，不向KB发送非法请求。大厅金额仍可留空后在最终确认弹窗输入；旧管理页“扣除”模式先校验用户输入的正整数，再沿用原逻辑添加负号。Prefab JSON、目标输入框路径、11组金额规则用例和 `git diff --check` 已通过，Creator真机软键盘与真实赠送回包仍待联调。
- 修改事件名、字段名、动作编码或中文命令前，必须同时核对服务端协议；本仓库不包含完整服务端实现。
- 下注动作中可见的特殊编码包括：跟 `-1`、敲 `-3`、休 `-5`、滚 `-6`、丢 `-7`。
- 房间外层状态大致为 `init -> ready -> running -> end`。

