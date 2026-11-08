# 玩家信息弹窗 BOSS 扩展信息（当前IP / 最后登录）

- 日期：2026-11-08
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：`panelClubPlayerInfo`（「玩家信息」弹窗）在 BOSS 打开时，于成员设置行末尾追加「当前IP」「最后登录时间」两行。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `assets/resources/UI/panelClubPlayerInfo.prefab` | 「面板」下新增 6 个节点：`玩家IP底/玩家IP/玩家IP值`（y=-240）、`最后登录底/最后登录/最后登录值`（y=-360），全部 `_active=false`。底板复用 `club_settings_row_v8` 的 spriteFrame，标签 22 号字、左对齐，值框宽 280、x=156（与「备注值」左端 16.5 对齐）。 |
| `assets/scripts/UI/ClubManagementView.ts` | `layoutMemberSettingRows` 行序追加这两组（末尾）；新增字段 `extInfoVisible`、`SetPlayerExtInfo(ip,lastLogin,visible)`、`syncExtRows(panel)`；`showPlayerSettingsTab` 在统一重排前调 `syncExtRows`；`openPlayerSettings` 换人时先置 `extInfoVisible=false`。 |
| `assets/scripts/UI/panelClubPlayerInfo.ts` | 新增 `extContext`/`extTimer`/`extSerial`、`QueryExtInfo()`、`OnExtInfo()`；`OnMemberList` 末尾调用 `QueryExtInfo`；`onHallCommand` 先按 ext context 分流。 |

## 行为

1. `GameDataManager.IsBossAccount()` 为真（level≥99，或 role 含「董事长/总裁」）才发 `查询_玩家_扩展_信息`，请求带 `user_id`、可选 `club_id`、context `playerext:<ts>:<n>`。
2. 请求发出即先显示两行为「查询中…」，回包用 `ip` / `last_login_time`（服务端已按北京时间格式化）覆盖；`0x301` 或 8s 无回包显示「—」。
3. 非 BOSS 入口（大厅 `panelMain` 里的玩家设置卡、代理给下级看）完全不发请求、两行保持隐藏；`panelMain.prefab` 未加节点是有意为之。

## 验证

- `ts.transpileModule` 两个脚本均 0 诊断。
- Creator（2.4.13，正在运行）已重新导入 prefab：`library/imports/f2/f2c85223-….json` mtime 更新到 14:16，产物中可见 6 个新节点名。
- 用临时离屏渲染（读 prefab 真实坐标 + 九宫格贴图）按 BOSS 视角出图核对：5 行间距均匀，`221.236.103.129`（183px）/`2026-11-07 01:28:00`（229px）都在 280 宽框内不截断，两行落在原「合伙人」行下方的空白处。校验脚本与出图已删除。
- 未验证：Creator 构建、真机、真实回包（服务端脚本已上传测试服但**待重启 baseapp**）；Web 端 IP 会是 `127.0.0.1`（网关未透传 X-Forwarded-For），原生端正常。

## 下一步

1. 测试服重启 baseapp 后用 boss 号打开任意玩家信息，确认 IP / 登录时间出现且非「—」。
2. 用非 boss 号（普通俱乐部创建者）打开同一弹窗，确认两行不显示、无多余请求。
