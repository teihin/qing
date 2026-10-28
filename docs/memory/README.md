# qing 记忆索引

更新：2026-10-28。

从 [项目入口](../../AGENTS.md) 和 [当前状态](CURRENT.md) 开始。以下是按任务读取的专题；只读相关小节，缺少证据时再查归档。当前状态描述已观察的状态，不赋予新任务目标或外部操作权限。

| 任务范围 | 读取文档 | 检索关键词 |
|---|---|---|
| 方案、用户纠正、版本冲突 | [决策记录](DECISIONS.md) | 有效、被替代、已否决、待核实 |
| 当前美术定稿、唯一视觉依据 | [定稿入口](../../design-previews/README.md)、[定稿清理交接](handoffs/2026-09-10-art-final-and-push.md) | 效果图V8-new、56 张、历史设计删除、设计与实施分开 |
| 登录控件重叠、长屏背景接缝 | [登录修复交接](handoffs/2026-09-10-login-overlap-fix.md) | V8、完整背景、轮廓切图、输入、未提交 |
| V8 全套按序实施、当前任务进度 | [全套进度](handoffs/2026-09-11-v8-all-pages.md)、[注册实施](handoffs/2026-09-11-register-v8-exact.md) | 56 张、长短屏、静态原图、动态控件 |
| 俱乐部快速注册无邀请码 | [注册交接](handoffs/2026-10-24-club-registration.md) | `XUAN_GAME_MODE`、四行注册、空上级链、动态头像 |
| 已有 V7 实现、资源、长屏、钱包、公告、后续模块 | [V7 实施记录](topics/v7-ui.md) | Prefab、UUID、四档高度、历史实现；旧图不再作为设计依据 |
| 客户端房间、网络、排队、状态恢复、动态资源 | [客户端与协议](topics/client-game-network.md) | QueueMatchManager、onKicked、roomTransition |
| 运营后台、权限、接口、数据及部署 | [XuanManager](topics/xuanmanager.md) | RBAC、分页、北京时区、旧二进制 |
| 自动化后台（机器人=账号、投放、分组、Worker 路线、老客户端参考） | [自动化后台](topics/automation-console.md)、[落地交接](handoffs/2026-10-27-automation-console.md)、[限底皮+日志](handoffs/2026-10-28-automation-room-pi.md) | 机器人即账号、投放管理、邀请码、默认带入倍数、只进底皮、robot.room_pi |
| Worker 节点通道（注册/租约、命令、事件、在线状态、参考 agent） | [Worker 通道](topics/automation-worker-channel.md)、[在线状态交接](handoffs/2026-10-28-worker-realtime-online.md) | `/agent/v1`、X-Agent-Token、租约 20 秒、offline 上报、命令状态机、xuanagent、janitor |
| 真实游戏客户端（KBEngine 无头登录、俱乐部/进房协议、密码落库、agent-client 落地、xuanagent 启动与重编） | [真实客户端探查](topics/automation-real-client.md)、[落地交接](handoffs/2026-10-28-automation-real-client.md) | nip.io、kbengine.js、预坐/坐下、login_password、0x306、xuanagent.json、交叉编译 |
| 自动化策略（净分区间控制、出牌移植、GPS/IP、终端日志、当前牌局与观战） | [策略与身份](topics/automation-strategy.md)、[策略交接](handoffs/2026-10-28-automation-strategy-gps.md)、[牌桌交接](handoffs/2026-10-28-automation-table-snapshot.md) | 净分死区、netPending、today_net_date、争赢/争输、TerminalLog、gps、TableState、take_pai、全桌手牌、观战名单 |
| 客服、分配、在线状态、语音链路 | [客服与语音](topics/chattool-voice.md) | agent、ChatTool、AudioServer、WebRTC |
| 剩余问题汇总（未提交/未发布/未执行迁移/待真机验证、发布顺序） | [剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md) | 035 036 037、bin/xuanagent 重编、heartbeatSeconds、真机未验、边界未做 |
| 原生构建、热更新、资源审计、包体体积、磁盘和开发环境 | [构建与环境](topics/build-release-environment.md)、[资源打包交接](handoffs/2026-09-15-asset-bundle-audit.md) | runtime-src、build、Manifest、动态资源、resources 全量打包、SSD |
| 本次整理交接 | [记忆迁移记录](handoffs/2026-09-05-memory-migration.md) | 保存范围、检查、待验证 |
| 旧文全文和原章节 | [完整历史索引](archive/2026-09-05/README.md) | 原行号、历史日期、原记录命令 |
| 2026-09-10 定稿前的完整当前状态 | [快照说明](archive/2026-09-10/README.md) | V8 重绘经过、既有实现、原样保存 |

## 更新约定

- 稳定约束写项目入口/决策；模块细节写专题；当前阶段与未验证项写当前状态；过程与旧版本写归档。同一事实保持一个主要维护位置，其他位置链接引用。
- 专题中“原记录报告通过”是历史证据，不能升级为当前版本已重新测试。任务要求与实现状态分别处理。
- 新专题同时登记本索引和 [检查策略](memory-policy.json) 的 `active_docs`；新增任务交接可按需要登记检查，不能让所有旧交接永久进入启动读取列表。
- 全文归档与章节快照保持不变；后续历史按新日期保存。禁止重新执行原文中的命令来“补全记忆”。
- 收尾运行 `python3 docs/memory/check_memory.py check --root "/实际项目根目录"`。工具由全局通用版本复制到项目，随仓库可移植。它只验证基本结构，不写文件，不读取业务数据库，也不运行任何美术生成器。
