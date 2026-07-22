# 项目记忆（Codex 自动读取）

最后更新：2026-07-22

本文件保存跨对话需要持续使用的项目事实与工作约束。涉及服务端行为、线上配置或原生包状态时，仍应在当前环境重新验证。

## 记忆维护规则

- 用户已要求持续维护本文件。以后每次处理本项目的需求、问题排查、代码修改或运行验证后，都应在任务结束前把新增的可复用信息整理到本文件，无需再次询问。
- 优先记录：问题现象、根因、解决方案、涉及文件、验证结果、仍未解决的风险、关键技术决定和可复用操作经验。
- 已验证事实与推测必须分开；没有运行或联调验证的内容要明确标注为“待验证”。
- 新结论改变旧结论时，直接修正原条目并更新日期，避免不断追加互相冲突或重复的记录。
- 保持内容精炼、可检索；临时终端输出、一次性进度和无长期价值的细节不写入。
- 不记录密钥、密码、Token、验证码、签名信息、身份证、银行卡、手机号或其他敏感数据；只记录其所在模块、风险和处理状态。
- 每次实际更新本文件时，同步修改顶部“最后更新”日期，并在最终回复中简要说明新增了哪些记忆。

## 项目概况

- Cocos Creator 版本：`2.4.13`。
- 客户端类型：8 座牌九类游戏，四张牌分成两组进行比较。
- 架构：服务端权威。客户端主要展示房间/玩家状态、发送操作指令和播放动画；胜负、牌型结算、下注合法性不能只依赖客户端。
- 设计分辨率：`960 x 640`，`fitHeight = true`。
- 正常启动场景是 `assets/Scenes/login.fire`；主要牌桌场景是 `assets/Scenes/drh8.fire`。
- `settings/project.json` 的启动场景是 `login`，但 `settings/builder.json` 当前指向 `drh8`。修改或打包前必须先确认目标，不能直接假定二者应相同。
- `assets/Scenes/login - 001.fire` 属于测试/备用场景。
- Android/iOS 原生工程目前封装在根目录 `runtime-src.zip`，不是普通活动源码目录。不要未经确认就解压覆盖或假定 Creator 构建会自动使用它。

## 启动与业务链路

```text
login.fire
  -> StartGameManager
  -> GameDataManager（持久化单例、KBE、心跳、重连、移动 SDK）
  -> panelUpdate（Web 跳过热更，Native 使用 AssetsManager）
  -> panelLogin
  -> panelMain（大厅）
  -> drh8.fire（牌桌）
```

- `assets/scripts/StartGameManager.ts`：启动入口。
- `assets/scripts/GameDataManager.ts`：全局会话、网络、登录状态、重连和场景跳转中心。
- `assets/scripts/common/UIManager.ts`：把 `assets/resources/UI/<面板名>.prefab` 动态加载到 `Canvas/Normal` 或 `Canvas/Top`。
- `assets/scripts/common/GameDef.ts`：服务器、状态、数据结构及公共常量。
- `assets/scripts/UI/panelMain.ts`：大厅、房间列表、钱包、个人中心和管理入口。
- `assets/scripts/UI/panelGameView.ts`：牌桌 UI 与玩家交互。
- `assets/scripts/logic/DrhLogicMgr.ts`：房间和牌局总状态。
- `assets/scripts/logic/DrhPlayerLogic.ts`：单座位状态、发牌、操作和结算表现。
- `assets/scripts/logic/DrhNameManager.ts`：牌型名称与点数。
- `assets/scripts/kbe_scripts/kbengine.js`：定制 KBEngine WebSocket 客户端。
- `assets/scripts/kbe_scripts/Account.js`：业务 RPC 包装及服务端事件转发。
- `assets/scripts/mobile/MobileManager.ts`：微信、语音、统计、GPS、图片和原生桥接。
- `assets/scripts/UI/panelUpdate.ts`：当前实际使用的热更新逻辑；`logic/UpdateManager.ts` 基本未使用。

## 网络与牌局协议

- 网络层使用 KBEngine/WebSocket 和全局字符串事件总线。
- `PlayerList` 是房间/玩家全量快照；`状态鸡` 是逐座位增量状态。
- 大量协议以手拼 JSON、中文命令字符串及 `reqHallCommand`、`reqGameCommand` 等接口传递。
- 修改事件名、字段名、动作编码或中文命令前，必须同时核对服务端协议；本仓库不包含完整服务端实现。
- 下注动作中可见的特殊编码包括：跟 `-1`、敲 `-3`、休 `-5`、滚 `-6`、丢 `-7`。
- 房间外层状态大致为 `init -> ready -> running -> end`。

## 已确认的高优先级问题

以下来自 2026-07-22 的静态审查，尚未全部经过真实服务器和原生包运行验证。

### 安全与更新

- 热更新清单使用 HTTP，`panelUpdate.ts` 的资源校验回调无条件返回 `true`；更新包包含可执行脚本。优先改为可信 TLS、签名清单及真实完整性校验。
- 客户端源码中存在第三方服务凭据，微信换取 Token 也在客户端完成；不得在文档、日志或回复中复述具体值。应视为已暴露并安排轮换。
- 登录密码明文写入 `localStorage`。
- 钱包部分接口通过 HTTP 传递姓名、银行卡、手机号、身份证等敏感信息。
- Git 中存在签名文件，旧原生配置中还有明文签名信息。不要输出具体值；修复时不仅要删当前文件，还要评估轮换及清理历史。
- 当前 KBE 配置可见明文 WebSocket；支付、登录、更新和业务接口均需确认线上是否已统一使用 TLS。

### 确定性功能缺陷

- 以下活跃调用没有对应的 `assets/resources/UI/<名称>.prefab`，触发时会加载失败：
  - `panelCreateRoom`
  - `panelJiangli`
  - `修改预留信息`
  - `panelSJB`
  - `panelSJBWeb`
  - `panelTalkMsg`
  - `panelDrhClubEnd`
- `UIManager.showPanel()` 加载失败时不清理加载中标记，同名面板后续可能一直无法再次加载；并发加载也只共用一个字符串标记。
- 解散投票使用 `map[id] = value` 写入，却用 `Map.has/get` 读取，恢复投票状态失败。
- 玩家/座位映射更新前未完整清理，断线状态可能落到旧座位或被稀疏键判断漏掉。
- `DrhPlayerLogic` 在读取当前消息的 `is_action` 前先处理 `role`，部分操作界面可能使用上一条消息状态。
- 观战者刷新隐藏牌时索引未递增，会反复更新第 0 张牌。
- 牌型点数兜底会直接修改传入牌对象，存在污染真实手牌数据的风险。
- VIP 数据界面会把 `bIsVip` 强制设为 `true`；开通 VIP 与扣款又是两条独立请求，服务端必须保证权限、幂等和原子性。
- Android 首次申请定位权限存在 `locationManager` 空指针路径。
- Android Manifest 的微信回调 Activity 包名与实际 Java 类包名不一致。
- JS 调用的录音播放方法名是 `PlayRecord`，Android/iOS 实现的是 `PlayFile`。

### 构建与原生配置

- `settings/builder.json` 是横屏，但归档原生配置中存在竖屏设置，打包前需确定唯一基准。
- 旧 Android 配置为 SDK 28、仅 `armeabi-v7a`，并包含动态依赖、HTTP Maven、过宽或废弃权限。
- iOS 配置包含旧 SDK 路径、任意网络加载和占位 Universal Link；发布前需重新核查。
- `runtime-src.zip` 内包含构建缓存和旧工程文件，不能直接当作干净、当前可发布的原生模板。

## 已知未完成界面需求

根目录 `问题.txt` 记录了已有缺口，包括提取奖励按钮、经理页面分享文字/比例按钮、牌局实时统计、牌型提示、切牌动画、牌桌图片和奖池数字等。实施前应再次确认哪些仍是当前需求。

## 修改项目时的约束

- 当前工作区在 2026-07-22 已存在大量用户未提交修改。每次只检查和修改目标文件，不做全仓格式化，不清理或覆盖无关变化。
- `library/`、`temp/`、`local/` 等为 Creator 生成内容，除非任务明确要求，不把它们当源代码修改。
- 保留 `.meta` 文件和 UUID；移动、替换资源时必须同步核对场景/Prefab 序列化引用。
- 大型核心文件是既有“上帝类”，改动时优先小范围修复并验证状态恢复、重连、切场景和异步回调，不要顺手进行大面积重构。
- 金币、VIP、支付、提现、短信、后台管理、付费看牌等客户端校验均不可信；相关修改必须要求服务端重复校验并保证原子性。
- 不在提交、日志、测试输出或对话中暴露密钥、密码、签名信息、Token、身份证、银行卡或手机号。
- 目前没有完整自动化测试和本仓库内服务端。静态检查通过不等于功能已验证；高风险改动至少需要 Creator 2.4.13 运行、真实协议联调和对应平台原生测试。

## GitHub 与 SSH

- 2026-07-22 已在本机创建 GitHub Ed25519 密钥，文件名为 `~/.ssh/id_ed25519_github_qing`，并配置为本机访问 `github.com` 所有仓库的默认密钥；私钥不得提交、复制到项目或对外发送。
- GitHub SSH 已验证成功，身份为 `teihin`；远程仓库地址为 `git@github.com:teihin/qing.git`，页面可访问且 `git ls-remote` 成功。当前远程没有引用，属于尚无提交的空仓库。
- 当前 `/Volumes/CB/qing` 已初始化为 Git 仓库，默认分支为 `main`，远程 `origin` 为 `git@github.com:teihin/qing.git`。
- 公开仓库提交前已将 `Tool.ts` 的短信平台账号字段和 `MobileManager.ts` 的微信、语音及统计平台配置字段置空；恢复这些功能时必须改用服务端或不入库的安全配置，不得再次硬编码真实凭据。
- `.gitignore` 已排除根目录签名文件、`runtime-src.zip`、macOS 元数据以及既有 Creator 缓存目录，避免敏感文件和生成内容进入仓库。

## 审查范围说明

2026-07-22 已完成项目脚本、场景/Prefab 绑定、构建配置、热更新、KBE 网络及 `runtime-src.zip` 的静态通读；未完成真实后端联调、线上配置确认、Android/iOS 完整打包和真机回归。
