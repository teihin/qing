# 默认对话只保留盟主 / 大盟主（2026-11-06）

## 目标

消息窗口（`panelMessage`，即「全部会话」）的默认对话，对玩家和合伙人只显示
BF客服（客户端置顶行）、盟主（未入盟显示群主）、大盟主；代理链条上的其他层级
（原「直属上级代理」入口）不再显示。

## 改动

- `ChatTool/server/internal/directchat/service.go`
  - `defaultTargets()`：删除 `me.SuperiorAgentGuuid` 分支，只保留 `club.OwnerGuuid`
    （本俱乐部老板，称号按 roleDisplayName 显示盟主/群主）与联盟 `union.OwnerGuuid`（大盟主）；
    大群主自身仍返回空。
  - `isFixedTarget()`：同步同一口径（老板 + 大盟主），删除 `isFixedSuperiorTarget()`。
    与直属上级合伙人的会话因此降为普通会话：标记 `isDefaultTarget=false`，
    管理角色可隐藏，玩家本身无删除权限这一条不变。
- `ChatTool/server/internal/directchat/service_test.go`
  - `TestAllConversationsIncludesClubSuperiorsWithoutHistory` → 改名
    `TestAllConversationsDefaultTargetsSkipSuperiorAgent`，期望 2 条（每俱乐部仅老板）。
  - `TestDefaultTargetsForMember`：玩家只剩 1 条老板入口。
  - `TestExistingSuperiorAgentConversationStaysFixed` → 改为
    `TestExistingSuperiorAgentConversationIsNotFixed`，断言不再是固定入口。
  - `TestAgentAlsoGetsClubSuperiorAsFixedConversation` → 改为
    `TestAgentDefaultTargetsSkipSuperiorAgent`，合伙人只见老板入口，且可隐藏与上级的会话。
  - `TestUnionOwnerAndClubOwnerAreFixedTargets`：期望 `{老板, 大盟主}`，并校验老板显示「盟主」。
  - 跨俱乐部排序两处断言改为只在真实会话之间比较（固定入口无消息仍排前面，属原设计）。
- `assets/scripts/UI/panelMessage.ts`：`LIST_CACHE_VERSION` 1→2（作废旧缓存里的上级入口行）、
  一处注释口径。逻辑不改，只认服务端下发的 `isDefaultTarget`。
- 文档：`服务器文档整理/1对1私聊消息-详细设计实施方案-v5.md`（默认对象、固定入口定义、删除限制）、
  `ChatTool/docs/api.md`、`ChatTool/docs/qa-checklist.md`、`docs/memory/CURRENT.md`。

## 验证

- `go vet ./...`、`go test ./...`、`go build ./...` 全绿；`panelMessage.ts` transpileModule 0 诊断。
- 部署（2026-11-06 22:28:42 +08）：`scp` 到 `/www/html/.chattool/bin/chattool.new-defaultchat-20261106-2228`
  → `deploy/centos7-user/stop.sh` → 原子 `mv` → `start.sh`。
  - 新二进制 SHA-256 `bce3b475b4afa92a0466ca8eb448d0989413e5b22fdd3b970cfb0d508474e049`
  - 回滚点 `/www/html/.chattool/bin/chattool.previous-defaultchat-20261106-2228`（旧 `c7f6cd15…`）
  - 守护 PID 7015→6662，子进程 6669 指向新文件；`chattool.log` 22:28:42 打出「客服服务已启动」，无 ERROR。
  - 本机 `127.0.0.1:8893/api/health` 与公网 `http://154.37.155.17/chattool/api/health` 均 `{"status":"ok"}`；
    直聊 `conversations`/`clubs`/`unread` 未登录 401。
- 本次无数据库迁移，未替换 `web/` 静态目录。

## 未完成 / 待确认

- 客户端未重新构建：`panelMessage.ts` 那两处改动尚未进热更包（不影响显示结果）。
- 真实账号联调未做：需在大厅消息页目视「只剩 BF客服 + 盟主 + 大盟主」，以及合伙人账号同款表现。
- 产品口径待主人确认：
  1. 未入盟俱乐部的「群主」入口保留（视作盟主同级）；若要严格只留「盟主」需再删一条。
  2. 普通玩家从此不能在消息页主动发起与上级合伙人的会话（只能等对方发起、或从成员列表入口）。
