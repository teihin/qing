# 历史原文摘录：记忆维护规则

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 7–25 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## 记忆维护规则

- 用户已要求持续维护本文件。以后每次处理本项目的需求、问题排查、代码修改或运行验证后，都应在任务结束前把新增的可复用信息（包括成功经验和踩坑教训）自动整理到本文件，无需再次询问。
- 优先记录：问题现象、根因、解决方案、涉及文件、验证结果、仍未解决的风险、关键技术决定和可复用操作经验。
- 已验证事实与推测必须分开；没有运行或联调验证的内容要明确标注为“待验证”。
- 新结论改变旧结论时，直接修正原条目并更新日期，避免不断追加互相冲突或重复的记录。
- 保持内容精炼、可检索；临时终端输出、一次性进度和无长期价值的细节不写入。
- 不记录密钥、密码、Token、验证码、签名信息、身份证、银行卡、手机号或其他敏感数据；只记录其所在模块、风险和处理状态。
- 每次实际更新本文件时，同步修改顶部“最后更新”日期，并在最终回复中简要说明新增了哪些记忆。
- 关机指令仅对用户明确提出该要求的当次任务生效，不跨任务延续；后续任务完成后不得沿用旧指令自动关机，只有用户在当前任务中再次明确要求时才能执行关机。
- 后续所有 Git 提交的标题和正文必须使用中文，并详细说明改动范围、关键行为、数据或权限影响以及验证结果；禁止只写英文标题或无法反映实际改动的简短描述。
- 本机 `git push` 若报 `Connection closed by 198.18.0.11 port 22`：这是本机代理把 github.com 解析为 Fake-IP（198.18.0.11），SSH 认证其实已成功、数据也已上传，只是代理在传输收尾清理连接时中断；`ssh -T git@github.com` 认证正常不能排除该问题，普通重试也可能继续报同样错误。改用 `GIT_SSH_COMMAND='ssh -o IPQoS=throughput -o ServerAliveInterval=15' git push origin main` 即可稳定推送，随后用 `git fetch origin main` 复核远端已包含该提交。此为本机开发环境经验，与仓库内容无关。
- 2026-08-16 排查“QWEN3 VL-8B 调用不了（选择该模型后发图片没反应）”结论：不是模型、API、网络或 DSH 配置问题。已实测硅基流动 key 有效（`/models` 200）、`Qwen/Qwen3-VL-8B-Instruct` 文本与图片（`data:image/png;base64` data URL）调用均 200 且能正确识别图色；`settings.yaml` 的 `llm-pi-ai.providers.siliconflow`（api: openai-completions、baseURL、apiKeyEnv、input:[text,image]）完全符合 DSH schema，当前 GUI 进程也已加载 settings 与 credentials。真正根因：DSH Web GUI（0.1.0-rc.6，npm latest/next 同版本）**前端没有实现图片附件上传**——全量搜索无文件选择 input、无拖放处理、无附件添加逻辑，`dsh-client-ui-attachment` 只有展示组件（MessageImage/ImageLightbox 等），`dsh-client-web` 仅把它列入 PLATFORM_MODULES 共享模块表。会话记录（`~/.dsh/sessions/*/session.jsonl.zstd`，zstd 解压后为 JSONL）证实用户发图时消息 `content` 只有 `[{"type":"text",...}]`，图片根本没进入消息流，模型收到的是纯文字，故表现为“没反应”。排查方法可复用：先解压会话 JSONL 看用户消息 content 是否含 image、再查 request/header 确认模型路由是否发出。临时方案：把图片放到工作区后让支持图像的 agent 模型（如 Qwen3-VL-8B）用 `read_image` 工具读取；GUI 内直接贴图发图需等 DSH 后续版本支持附件上传（本机 `~/.npm/_cacache` 有 root 遗留文件导致 npm/npx 报 EPERM，查包版本需用 `npm_config_cache=/tmp/xxx` 隔离缓存）。
- 2026-09-03 排查 VS Code 源代码管理“提交后卡住”：仓库没有产生新提交，暂存区为空；`.git/index.lock` 为零字节且无进程持有，是首次 Git 写索引中断留下的僵尸锁，后续 `git add -A -- .` 均明确报 `Unable to create .../.git/index.lock: File exists`。同时 VS Code 1.136.0 内置 `vscode.git` 扩展激活失败，根因是用户扩展 `voorjaar.windicss-intellisense 0.21.6` 劫持 Node 模块编译后把 Git 扩展的 ESM `export` 当 CommonJS 解析，日志报 `SyntaxError: Unexpected token 'export'`；因此界面持续显示“正在扫描 Git 存储库”，`git.showOutput` 命令也不存在。现已完全退出 VS Code、确认旧锁无进程持有后清理 `.git/index.lock`，并禁用 WindiCSS IntelliSense；重新启动后 Git 面板恢复正常，未自动提交或推送。
- 同日进一步确认 Git 卡顿还叠加了 CCCC 外置盘连接层故障：macOS 对 RTL9210 NVMe 连续记录 USB timeout/reset、SCSI 读写 I/O error，APFS 操作曾卡住37～88秒；不是普通 Git 扫描慢。仅换线后曾短暂恢复但又对同一 LBA 反复失败；改用另一根线并直连 Mac mini 机身后，`AGENTS.md`、此前必卡目录和约16MB图片均可立即读取，不写索引的完整`git status`用时0.04秒，观察期内没有新增 CCCC 错误。WindiCSS IntelliSense现已禁用，旧锁已清理，VS Code Git面板已恢复。当前结果支持原线/转接链路是重要诱因，但RTL9210不透传SMART，仍不能完全排除硬盘盒或NVMe本体；应尽快备份，若错误复现先换硬盘盒，连接不稳定时不要运行磁盘急救。
- 2026-09-03 旧硬盘盒在换线直连后仍于约4分钟后复现：VS Code、Git与资源扫描进程进入不可中断`U`态，内核再次记录USB timeout和NVMe读取I/O error，且故障LBA由`0x2afab38`变为`0x20f3358`，随后设备连接丢失和APFS非正常卸载，故已排除单一Git文件及单一坏读请求。将同一NVMe换入另一只`RTL9210B-CG`硬盘盒后，短时读取曾恢复，但持续读取约1～2分钟即再次出现USB timeout、自动重置与多LBA读取错误，其中`0x20f3358`在两个硬盘盒中重复失败；因此旧盒并非唯一根因，当前高度怀疑NVMe本体故障或受热后失效。该盘不能继续承担开发工作，不应在未完成数据救援前运行磁盘急救。
- 2026-09-03 CCCC故障盘项目已恢复到健康外接盘`/Volumes/SSD/qing`：远程`main`重新克隆并完整展开7281个工作区文件，HEAD与`origin/main`同为`79011a2c03edc5a9158cd4d41738ac30f04a6cb5`，`git fsck --full`和`git diff --check`通过；再从分批救援目录`/Volumes/SSD/qing-本地抢救`覆盖本地独有的`AGENTS.md`修改、7个`design-previews`文件、`settings`、`.hot-update-config.json`、`.hot-update-upload-config.json`、`runtime-src.zip`、`qing.keystore`和`.vscode`。签名文件、原生包和项目记忆与救援副本哈希一致，最终Git状态精确为`M AGENTS.md`及`?? design-previews/`。进一步核验：`assets`有3718个文件，四个正式/备用场景及254个脚本文件齐全；根`native`目录的Android/iOS桥接共9个源码文件齐全；63MB的`runtime-src.zip`通过全量ZIP校验并包含Android Studio、iOS/macOS Xcode及Win32工程。
- 用户进一步明确`build`内原生工程也必须保留后，已从CCCC补齐：`build/jsb-link`有4030个文件、约1.43GB，其中`frameworks/runtime-src`含Android、iOS/macOS、Win32、OpenHarmony与Classes；`build/ios-unsigned`有17511个文件、约638MB，`build/web-mobile`有1737个文件、约66MB。另恢复`packages`、`local`、`packVersion`、`hot-update-output`约6.55GB及`跨平台生成历史参考`约2.34GB，最终`/Volumes/SSD/qing`约12GB。`library`、`temp`、各级`node_modules`和`.codex-xcode-derived`按用户口径作为可重建缓存省略，因此目录已恢复为可开发、可构建状态，但不是与故障盘逐字节完全一致。

