# 2026-11-05 游戏内俱乐部角色称谓统一

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`7e27148`（工作区含其他任务未提交修改）

## 决策（已写入 DECISIONS.md D09）

| 角色 | 界面显示 |
| --- | --- |
| 联盟创始人 / 总群主 | 大盟主 |
| 已加入联盟的俱乐部创始人 | 盟主 |
| 未加入联盟的俱乐部创始人 | 群主 |
| 俱乐部内设置的代理 / leader / agent | 合伙人 |
| 管理员 | 管理员 |
| 普通成员 | 成员 |

只改显示文案；服务端命令名、`role` 内部值、节点名、按钮事件和权限判断全部保持原样。

## 改动文件

### 主俱乐部流程

- `assets/scripts/UI/ClubManagementView.ts`
  - `creatorRole()`：联盟总群主返回「大盟主」。
  - 「我的」俱乐部卡片身份：代理显示「合伙人」。
  - 成员列表/下级成员/玩家信息身份：新增 `roleDisplay()`，`agent/leader/代理/合伙人` 统一「合伙人」，`union_owner/大盟主` 统一「大盟主」，`owner/老板/创建者/群主` 统一「群主」。
  - 盟友行自己俱乐部后缀「（大盟主）」；入盟申请/盟友行「群主：」改「盟主：」。
  - 装备 `大盟主` 判断、额度/比例行、提示文案同步更新（“只有联盟大盟主…”“合伙人比例…”“开通合伙人/取消合伙人资格”等）。
- `assets/scripts/UI/panelMain.ts`
  - 俱乐部列表身份：`大盟主 / 盟主 / 群主 / 合伙人`。
  - 创建联盟说明「创建后您将成为大盟主」；入盟提交提示等待「大盟主」审批；旧代理入口错误文案改「合伙人」。
- `assets/scripts/logic/DirectChatManager.ts`
  - `RoleName()`：`union_owner`→大盟主，`leader/agent/代理/合伙人`→合伙人，`盟主`→盟主，`owner/老板/群主`→群主，`manager`→管理员。
  - 聊天列表/聊天详情/成员列表共用该映射。
- `assets/scripts/UI/panelExchangeStone.ts`
  - 兑换弹窗角色：未入盟俱乐部创始人→群主，俱乐部代理→合伙人；积分不足提示“联系合伙人上分”。
- `assets/scripts/UI/panelGameView.ts`
  - 房间内“联系代理上分”改“联系合伙人上分”；联盟额度提示改“联系大盟主”。

### 旧面板 / 静态文案

- `assets/scripts/UI/panelMyHongli.ts`：「N级代理」→「N级合伙人」。
- `assets/scripts/UI/panelHongli.ts`：下级代理/有效代理/添加代理/取消等显示文案改合伙人；`type` 标签改「合伙人」；`info/1` 改「合伙人:」。
- `assets/scripts/UI/panelGameSettings.ts` / `panelGameSettings.prefab`：暗抽“仅群主”改“仅创建者”；说明里的“代理分账/代理单独覆盖”改合伙人。
- `assets/resources/UI/panelMain.prefab`
  - 玩家设置代理行静态文字「开通代理」→「合伙人」。
  - 旧代理搜索占位「请输入代理ID」→「请输入合伙人ID」。
- `assets/resources/UI/panelManager.prefab`：「代理红利榜」标签文字→「合伙人红利榜」（节点名仍是 `代理红利榜`，代码/协议键不变）。
- `assets/resources/UI/panelHongli.prefab`：二级/三级/下级代理标签→合伙人；“代理权限”说明→合伙人权限。
- `assets/resources/Prefabs/玩家对象.prefab`：「添加代理」→「添加合伙人」。
- `assets/resources/Prefabs/玩家奖池贡献明细对象.prefab`：静态占位「代理60%:24」→「合伙人60%:24」。
- `assets/resources/Prefabs/排行榜.prefab`：「代理ID」→「合伙人ID」。

## 未入盟俱乐部额度

- 「我的 → 当前俱乐部」的「俱乐部额度」只在俱乐部已加入联盟、且当前账号是创建者时显示；未入盟俱乐部即使回包带 `clubQuotaFen` 也隐藏。逻辑在 `ClubManagementView.Refresh()`。

## 验证

- 所有改动 Prefab JSON 可解析、`__id__` 无越界（panelMain 4210 个对象）。
- 静态节点名保留：`panelManager` 的 `代理红利榜` 节点名未改；`panelMain` 的 `代理` 节点名未改；服务端命令 `查询_俱乐部_代理_*`、`设置_俱乐部_代理` 等未改。
- 定向 TypeScript 检查仅剩项目既有错误（`require` 声明、`Widget.alignFlags`、旧输入联合类型、`cc.RawAsset` 等），本次角色改动未新增类型错误。

## 未完成 / 待验证

- Creator 重新导入、构建、真机、真实账号三种角色（大盟主/盟主/合伙人/群主）显示未实测。
- 旧 `panelHongli`/`panelJiangli` 若仍以图片字显示“代理”，需要美术字替换，本次只改可序列化文字。
- 聊天里已入盟俱乐部创始人如果服务端只下发 `role=owner`、没有联盟标记，客户端仍显示「老板」；要显示「盟主」需要服务端在 chat peer 上补联盟/角色字段。
