# 2026-11-06 私聊详情 V2 皮肤 + 单方清除聊天

## 目录 / 分支

- `/Volumes/SSD/qing`，分支 `codex/club-ui`
- 本次只改私聊详情（`panelMessageChat`）与 ChatTool 直聊/玩家端接口，未动消息列表页。

## 目标

1. 私聊详情按 2026-11-05 效果图（`design-previews/待确认/2026-11-05-消息与私聊重设计/02-私聊详情.png`）重做视觉。
2. 底部所有会话新增「清除聊天」：只清自己这一侧，服务端保留记录，对方/客服仍可见，之后本人不再拉取清除前内容。

## 改动文件

客户端：

- `assets/ImagesLuck/聊天/消息左气泡.png`、`消息右气泡.png`、`系统消息底.png`、`输入框.png`、`发送按钮.png`、`删除图标.png`：原地替换，尺寸与 `.meta`/UUID 保持不变；两张气泡 `.meta` 九宫格边界由 30 改为 18。
- `assets/ImagesLuck/聊天/返回圆钮.png` + `.meta`：新增 96×96 圆形返回钮（`返回箭头.png` 与消息列表页共用，保持原样未替换）。
- `assets/ImagesLuck/聊天/清除聊天.png` + `.meta`：新增图标（spriteFrame `e88f0fa6-3e87-4c8c-bbf7-95153a91c47b`）；返回圆钮 spriteFrame `3728e48f-0140-4b4d-bd5e-472a66deac33`。
- `assets/resources/UI/panelMessageChat.prefab`：头部 76 圆钮、标题线、时间分隔线、气泡模板 64/68、输入区 88 高、底部五入口（含「清除聊天」）、发送文字改深色。
- `assets/scripts/UI/panelMessageChat.ts`：气泡留白 26/头像间距 14/单行高 68、消息间距 22（与效果图一致，每条都带头像）、清除聊天确认与执行、客服会话底部重新居中。
- `assets/scripts/logic/DirectChatManager.ts`：`ClearConversation()` → `POST /conversations/{id}/clear`。
- `assets/scripts/logic/OfficialKefuManager.ts`：`Clear()` → `POST /api/player/clear`。
- `tools/gen_chat_detail_v2_art.py`、`tools/apply_chat_detail_v2_prefab.py`：可重跑的美术/Prefab 生成脚本（旧图备份在 `design-previews/待确认/2026-11-05-消息与私聊重设计/旧图备份/`）。

服务端（ChatTool）：

- `ChatTool/server/migrations/009_clear_history.sql`：`chat_direct_participant.cleared_at`、`chat_conversation.player_cleared_at`。
- `internal/directchat/{model,store,service,handlers}.go`：新增 `POST /api/direct/conversations/{id}/clear`；消息分页、会话预览、未读按 `cleared_at` 过滤，消息行保留。
- `internal/api/{messages,player,server}.go`：玩家端 `POST /api/player/clear`，玩家消息按 `player_cleared_at` 过滤；客服工作台查询不变。
- `ChatTool/docs/api.md`、`服务器文档整理/1对1私聊消息-详细设计实施方案-v5.md`：补接口与语义。

## 验证结果

- Prefab JSON 解析、`__id__` 引用、节点父子/组件归属检查通过；Prefab 内 spriteFrame UUID 全部能在 `assets/**/*.meta` 找到（仅 `a23235d1…` 为原有「游戏内遮罩」内置帧，改动前即不在资源 meta 中）。
- 造型合成检查：用新 PNG 按 108×68 九宫格、底部 88 高等真实尺寸渲染预览，气泡/系统条/输入/发送/五入口外观符合效果图。
- `go test ./...`（ChatTool server）通过；新增 `TestClearChatIsPerUserAndKeepsMessages` 覆盖：清除后本人 0 条、对方仍 3 条、列表预览/未读清零、清除后的新消息仍可见。
- 定向 `tsc` 语法检查（TS1xxx）无错误；项目无本地 `cc` 类型声明，未做完整类型检查。
- ChatTool 服务端已部署（2026-11-06 00:08:57 +08）：migration `009_clear_history.sql` 已执行，`chat_direct_participant.cleared_at`、`chat_conversation.player_cleared_at` 均为 `datetime(6)`；`/api/health` 本机与公网 200；两处 clear 路由未登录均 401。新二进制 SHA-256 `b163889df3b100d29af8d614b5a1ec4fbc0e08239c087a32b3bd30c7f0d1bae0`，回滚 `bin/chattool.previous-clear-chat-20261106-000856`（旧 `7db76dcb…`）；未替换 `web/` 静态目录。

## 未验证 / 下一步

- Creator 导入、编译、网页/真机实际点击与视觉核对（气泡九宫格、头像分组、底部五入口、客服会话单入口）。
- 真实会话联调：清除后重进不拉取、客服工作台仍可见、新消息重新出现（需要已登录的客户端或有效票据）。
- 清除后页面顶部提示固定为「聊天记录已清除」，滚动后会回到「没有更多消息」，如需专属空态文案再定稿。
- 官方客服的空会话（尚未创建 conversation）调用清除返回 204，属预期。
