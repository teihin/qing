# qing 记忆索引

更新：2026-09-10。

从 [项目入口](../../AGENTS.md) 和 [当前状态](CURRENT.md) 开始。以下是按任务读取的专题；只读相关小节，缺少证据时再查归档。当前状态描述已观察的状态，不赋予新任务目标或外部操作权限。

| 任务范围 | 读取文档 | 检索关键词 |
|---|---|---|
| 方案、用户纠正、版本冲突 | [决策记录](DECISIONS.md) | 有效、被替代、已否决、待核实 |
| 当前美术定稿、唯一视觉依据 | [定稿入口](../../design-previews/README.md)、[定稿清理交接](handoffs/2026-09-10-art-final-and-push.md) | 效果图V8-new、56 张、历史设计删除、设计与实施分开 |
| 已有 V7 实现、资源、长屏、钱包、公告、后续模块 | [V7 实施记录](topics/v7-ui.md) | Prefab、UUID、四档高度、历史实现；旧图不再作为设计依据 |
| 客户端房间、网络、排队、状态恢复、动态资源 | [客户端与协议](topics/client-game-network.md) | QueueMatchManager、onKicked、roomTransition |
| 运营后台、权限、接口、数据及部署 | [XuanManager](topics/xuanmanager.md) | RBAC、分页、北京时区、旧二进制 |
| 客服、分配、在线状态、语音链路 | [客服与语音](topics/chattool-voice.md) | agent、ChatTool、AudioServer、WebRTC |
| 原生构建、热更新、资源审计、磁盘和开发环境 | [构建与环境](topics/build-release-environment.md) | runtime-src、build、Manifest、动态资源、SSD |
| 本次整理交接 | [记忆迁移记录](handoffs/2026-09-05-memory-migration.md) | 保存范围、检查、待验证 |
| 旧文全文和原章节 | [完整历史索引](archive/2026-09-05/README.md) | 原行号、历史日期、原记录命令 |
| 2026-09-10 定稿前的完整当前状态 | [快照说明](archive/2026-09-10/README.md) | V8 重绘经过、既有实现、原样保存 |

## 更新约定

- 稳定约束写项目入口/决策；模块细节写专题；当前阶段与未验证项写当前状态；过程与旧版本写归档。同一事实保持一个主要维护位置，其他位置链接引用。
- 专题中“原记录报告通过”是历史证据，不能升级为当前版本已重新测试。任务要求与实现状态分别处理。
- 新专题同时登记本索引和 [检查策略](memory-policy.json) 的 `active_docs`；新增任务交接可按需要登记检查，不能让所有旧交接永久进入启动读取列表。
- 全文归档与章节快照保持不变；后续历史按新日期保存。禁止重新执行原文中的命令来“补全记忆”。
- 收尾运行 `python3 docs/memory/check_memory.py check --root "/实际项目根目录"`。工具由全局通用版本复制到项目，随仓库可移植。它只验证基本结构，不写文件，不读取业务数据库，也不运行任何美术生成器。
