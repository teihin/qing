# 2026-11-06 托管保留 + 上下分对账

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`6b9120b`（工作区含其他任务未提交修改；本次只改下列文件）

## 目标与口径

1. 游戏内取消聊天托管后，客服后台不删除记录；账号和会话仍显示但只读，不能继续代发/上下分；主管在右侧可手动永久删除该托管账号的聊天记录。
2. 客服后台新增独立「对账统计」页面（右上角入口），记录所有托管上下分；赠送/被赠送按用户确认**先只统计上下分**，暂显示 0。
3. 统计权限：主管看全部客服记录，普通客服只看自己的操作。

## 改动

### 托管保留

- `migrations/010_hosting_ledger.sql`：`chat_direct_hosting` 新增 `enabled`、`disabled_at`；新增 `chat_hosting_gold_ledger`。
- `directchat/store_hosting.go`：Hosting 增加 Enabled/DisabledAt；新增 DisableHosting、DeleteHostedOwnerData（永久删除直聊会话/消息/附件，返回媒体 key）。
- `directchat/service_hosting.go`：
  - `SetHosting(false)` 改为停用不删除；`HostingStatus`、`HostedGroups` 不再清理失效记录，只置停用并继续展示。
  - `requireHosted` 允许只读历史；新增 `requireHostedEnabled` 用于代发/上下分。停用账号的会话 `canSend=false`。
  - 新增 `DeleteHostedOwner`：只允许已停用/失效记录；开启中的托管要求先在游戏内关闭；删除 DB 记录后移除媒体文件。
- `api/hosting.go`、`server.go`：新增 `DELETE /api/agent/hosted/owners/{guuid}`，仅主管；审计 `direct.hosted.delete_owner`，推送 `hosted.deleted`。
- 客服站：托管账号显示「已取消」徽标；聊天输入/发送/上下分只读；右侧资料栏显示删除按钮（仅主管），删除前二次确认；其他客服通过 SSE 刷新列表。

### 上下分账本

- `api/hosting_ledger.go`：账本查询、汇总、盟主选项、pending 占位（`request_id` 唯一）与完成更新。
- `api/hosting_gold.go`：请求新增 `clientRequestId`；先写 pending 再调用 XuanManager；成功写余额并置 success，失败置 failed；重复编号成功返回 `duplicate=true`，处理中/失败返回 409。系统通知和原审计保留。余额改为操作前读一次、成功后 5 次×250ms 轮询游戏库，避免立即读到旧值；超时则按“操作前余额+变动”兜底。
- `api/server.go`：新增 `GET /api/agent/hosting/ledger`、`GET /api/agent/hosting/ledger/owners`、`GET /api/agent/hosting/ledger/agents`；主管全量并按 `agentId` 筛选，普通客服按 `agent_id` 过滤且客服选项只有自己。
- 客服站：右上角「对账统计」独立全屏页面 `HostingLedgerPage.tsx`；汇总卡（上分/下分/赠送/被赠送/笔数）、日期/盟主/客服/玩家筛选、逐笔表格（时间/类型/玩家ID/昵称/盟主/联盟俱乐部/操作人/数量/余额）、分页；赠送/被赠送暂显示 0 并标注未接入。

## 部署

- 服务端：`96754ef8…`（2026-11-06 00:46，含客服筛选+余额短轮询），回滚 `bin/chattool.previous-ledger-balance-20261106-004651`；迁移 010 已执行，`enabled`/`disabled_at` 与账本表已回读确认。
- 客服站：`index-D6a90DZI.js` / `index-DS6vYAb8.css`（2026-11-06 00:44），回滚 `web.previous-ledger-agent-20261106-004446`。
- 真实上分 111 的首笔账本行初次余额读成 0（游戏库写入延迟），已加前后余额短轮询，并把该测试行余额修正为 111；后续操作使用新逻辑。
- 健康、玩家端、客服端 200；未登录访问账本接口 401；已用只读 SQL 校验汇总/明细/盟主查询。
- 首次部署 010 因缺少 `-- +chattool Statement` 分隔标记导致迁移失败并自动回滚，修正迁移文件后重新构建部署成功；失败二进制未在运行。
- 共享工作区说明：该 ChatTool 二进制同时包含并行的直聊清除聊天改动；`009_clear_history.sql` 已于 23:53 随前一次部署执行。

### 托管列表层级换装

- 组头保留浅绿卡片；托管账号改为独立浅色卡片 + 左侧竖向引导线；会话行再缩进 24px，白底卡片、3px 青色左边线和 5px 行距，选中态分别高亮。
- 第三层会话行补上对方头像（与客户端一致），行内改为「头像 + 文字区」横向布局，文字区保留昵称/时间/俱乐部/预览。
- 已部署客服站 `index-BmpCdndK.js` / `index-Bh-vyTQB.css`（2026-11-06 01:03，回滚 `web.previous-hosted-conv-avatar-20261106-010254`）；登录态目视待验证。

### 后台玩家头像

- 客服工作台原来读取 `chat_player.avatar_url`，游戏端没有传该字段，导致显示字母/破图；改为用游戏库 `tbl_Account.sm_photo`（1~100，与客户端 `ImageManager` 规则一致）映射到客服站静态图 `avatars/avatarNN.png`。
- 服务端 `api/avatars.go` 提供头像序号归一化、URL 生成和游戏库批量读取；会话列表/详情、聊天消息、托管账号、托管会话的对方头像统一使用该 URL。
- 客户端头像图已复制并缩放为 128×128：`assets/resources/avatars/头像NN.png` → `ChatTool/web/public/avatars/avatarNN.png`（100 张，约 3.2MB），随客服站构建发布。
- 已部署服务端 `df2d8f8e…`（回滚 `chattool.previous-avatars-20261106-010014`）、客服站 `index-CWk14Xfs.js`（回滚 `web.previous-avatars-20261106-010039`）；`/chattool/avatars/avatar01.png` 等返回 200 image/png，h1=头像67、h2=头像31 已在游戏库核对。
- 未验证：登录态下会话列表/详情/聊天消息实际显示；`sm_photo` 为空或非法时的头像1兜底。

## 未验证

- 真实主管登录后打开对账页、筛选与分页。
- 真实取消托管后后台只读显示、主管删除及媒体文件删除。
- 真实上下分账本行、余额、重复提交/处理中/失败状态；赠送/被赠送仍为 0。
- 普通客服登录只能看到自己的记录（服务端 SQL 已按 agent_id 过滤，未用真实账号联调）。

## 下一步

1. 用真实盟主账号在游戏内开启再取消聊天托管，核对客服后台只读与主管删除。
2. 在托管会话执行上分/下分，核对对账页汇总、逐笔、余额和重复提交。
3. 如需赠送/被赠送，再明确赠送来源与游戏侧流水口径后接入。
