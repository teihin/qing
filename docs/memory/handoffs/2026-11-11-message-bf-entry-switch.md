# 消息页 BF 聊天显示开关（2026-11-11）

## 目标与口径

- 消息列表置顶的「官方客服（BF）」入口默认显示；俱乐部创建者在消息页顶部新增「BF 聊天 / 已显示」开关。
- 开关只对俱乐部创建者显示：大盟主、已入盟盟主、未入盟群主；普通代理/成员看不到开关。
- 关闭后，该创建者所在俱乐部的所有层级代理和玩家都看不到置顶 BF 行；创建者自己也隐藏。
- 开关按创建者账号持久化；不同俱乐部创建者互不影响。没有历史记录按开启处理（升级后行为不变）。
- 会员同时属于多个俱乐部时（非创建者），任一所属俱乐部创建者关闭即隐藏；创建者本人按自己的开关显示；无俱乐部账号保持默认显示。

## 改动

- 服务端 `ChatTool/server`：
  - 迁移 `migrations/013_direct_bf_entry.sql`：`chat_direct_bf_entry(guuid, enabled, updated_at)`。
  - `internal/directchat/store_bf_entry.go`、`service_bf_entry.go`：读取/保存开关，按 `ListMyClubs` 判定创建者和归属俱乐部。
  - `handlers.go`：`GET/POST /api/direct/bf-entry`；`model.go`：新增 `DIRECT_BF_ENTRY_FORBIDDEN`。
  - `docs/api.md` 补充接口说明；`service_bf_entry_test.go` 覆盖创建者/成员/其他俱乐部/重新开启。
- 客户端：
  - `assets/scripts/logic/DirectChatManager.ts`：`BFEntryStatus` / `SetBFEntry` / `DirectBFEntryInfo`。
  - `assets/scripts/UI/panelMessage.ts`：顶部开关绑定、二次确认、置顶行显隐、列表顶部偏移和动态内容高度重排。
  - `assets/resources/UI/panelMessage.prefab`：新增 `BF开关` 行（复用聊天托管胶囊底板和开关图，带顶部 Widget），默认隐藏。

## 验证

- `go build ./...`、`go test ./internal/directchat/` 通过（含新增 `TestBFEntryVisibility`）。
- `tsc --noEmit` 仅剩项目缺少 `cc`/`require` 全局声明的既有环境错误，无语法错误。
- prefab JSON 引用、组件回指、PrefabInfo fileId 唯一性检查通过；1334/1624 两档反渲染显示开关位于聊天托管下方，未压住置顶 BF 行。
- 2026-11-12 已部署 ChatTool 正式机：新二进制 sha256 `fc2884e4…`（8,736,952 字节），旧二进制备份 `bin/chattool.previous-bf-entry-20261112-000309`；迁移 `013_direct_bf_entry.sql` 于 00:03:48 执行，`chat_direct_bf_entry` 表存在；health 200，`/api/direct/bf-entry` 本机与公网未登录均 401。
- Creator 未导入/构建，真机未验收，接口未用真实账号联调。

## 下一步

1. 用创建者、其下属同学、其他俱乐部账号各开一次消息页，确认 `eligible/visible` 与置顶 BF 行一致；重点看关闭后创建者自己也隐藏。
2. Creator 导入 `panelMessage.prefab`（网页 Recompile 不等于已导入），构建后按 1334/1624 真机核对：创建者两个开关、普通玩家无开关、关闭后创建者与下属 BF 行同时消失、列表顶部无空白带。
