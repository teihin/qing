## 俱乐部模式快速注册

涉及：

- `assets/resources/UI/panelLogin.prefab`
- `assets/scripts/UI/panelLogin.ts`
- `XuanManager/server/internal/api/registrations.go`
- `XuanManager/server/internal/config/config.go`

结论：

- 俱乐部模式由 `XUAN_GAME_MODE=club` 表示，快速注册不采集邀请码；带邀请码的旧客户端仍兼容代理绑定。
- `standard` 模式继续要求有效的 6 位邀请码。
- 注册弹窗的四个输入行、状态、按钮和安全提示必须同步上移；动态头像使用 180×180 填满背景圆框。
- 俱乐部注册没有上级链时，后台直接写入空的 `upper_guuid/upper2_guuid/upper3_guuid`，不能调用邀请码关系查询。

## 审批成功回包

涉及：

- `assets/scripts/UI/ClubManagementApi.ts`
- `tools/test_club_joiner_protocol.js`

结论：

- 更新后的接口文档明确：`0x500` 只是服务端内部异步标记，不会下发给客户端；审批最终通过同一 `context` 的 `onHallCommand` 返回 `0x200/0x301`。
- `0x200` 已表示审批完成，客户端不能再等待 `NumberList` 来确认；成员列表推送缺失时也不能阻塞确认弹窗或误报超时。
