# 客服、房间语音与跨端桥接

整理日期：2026-09-05。以下来自 2026-07-28～08-14 历史记录，本轮未重新联调、查询正式会话、上传媒体或部署。旧“已通过/已发布”仅表示对应日期证据，不是当前端到端状态。历史待办不构成新的外部写入授权。

## ChatTool 入口与身份边界

- 根目录 `ChatTool/`，Go、React/Vite 双端、MySQL 5.7；自有数据为 webcm 的 chat_ 表，媒体在独立受控目录，数据库只存元数据。历史正式 127.0.0.1:8893、候选 8894，公开路由 /chattool/player 与 /chattool/agent，实际域名/状态读取当前配置。
- Cocos 入口 `assets/scripts/UI/panelKefu.ts`、`ConfigManager.kefuUrl` 和服务端“客服2”动态配置；普通客服通道 general，VIP 充值通道 vip_recharge。
- 游戏资料的 AES 轻量加密只隐藏 URL 明文，不是服务端认证。不得把客户端可构造资料宣称权威身份。历史取消 KB 一次性授权链路；新链接时间戳有时限，旧无时间戳兼容仅是历史分支，移除前需核查客户端覆盖率。
- 客服账号独立鉴权，密码 bcrypt、随机会话摘要、Cookie/CSRF/同源/RBAC/媒体鉴权持续保留。不能因内嵌流程而整体放宽客服或普通 Cookie API。

来源：[原记忆](../archive/2026-09-05/AGENTS.original.md)第 204–214 行。

## 客服最终会话规则（以 2026-08-14 为历史截止）

- **首条玩家消息成功写入才入队**，打开页面只建内部会话，不自动派单、不写欢迎消息、不计数/占容量/可接入；第一条文字或媒体成功落库重置真实入队时间。
- 无本通道有效在线客服禁止发送；前端禁用不足够，服务端文字/媒体事务再次检查启用、在线、心跳及登录会话有效性，NO_AGENT_ONLINE 时不留消息或文件。SSE 团队事件与轮询负责恢复状态。
- 通道隔离覆盖队列、派单、转接、主管全部会话、媒体、输入状态和实时事件。客服有活动会话时不能跨通道改归属，同一玩家不同通道会话不能串用。
- 派单按同通道负载/最久未分配等规则只给一人；实时负载用最近 90 秒玩家心跳，但最大容量仍看全部活动会话。自动均衡只移动玩家仍在线、当前派单后未获客服回复、且最新派单为系统自动/均衡的会话。人工接入、人工转接或已回复不搬动。
- 严格单点登录由账号行锁、旧会话删除、新会话插入和 agent_id 唯一索引保证；新登录不把客服设离线或重排既有会话。旧页面以 session.replaced/401 退出。
- 同一浏览器配置文件各窗口共享客服 Cookie，不能拿多窗口当多账号测试。每窗口预期 ID + X-Agent-Expected-ID/SSE 参数校验身份，账号切换应明确退出旧窗口。
- 文本与媒体幂等键不能空串；纯 HTTP 环境 randomUUID 可能不存在，消息 ID 回退不是安全令牌。系统消息同样生成非空幂等 ID，派单失败要可观测。
- 聊天默认 48 小时清理，媒体随对应记录清理；保留会话状态、派单/评价/审计和仅客服可见备忘。清空记录为显式动作，不因记忆整理或 QA 执行历史清空要求。

来源：原记忆第 215–225、231–235 行。旧“打开页面即排队”与不设发送门禁规则已被替代。

## 内嵌 WebView 与布局

- 游戏内使用 embed=game、透明背景，只中间消息区滚动，顶部/状态/输入区固定；独立网页能力仍保留。尺寸按实际 CSS 视口分级，不用高 DPR 或单个 max-width:1280px 判断手机字号。
- 内嵌随机会话令牌仅在 sessionStorage，通过 X-Player-Embedded-Token 请求头认证；媒体换取限定会话/媒体的短票据，不把完整会话放进媒体 URL。内嵌 2 秒轮询替代不能带头的 EventSource；独立网页继续 Cookie/SSE。
- 内嵌 Bearer 认证不依赖 Cookie-CSRF；普通 Cookie 路径仍强制 CSRF。轮询返回未携带 CSRF 时不能把已存值清空，避免再次 BAD_CSRF。
- 只允许 /player 被嵌入，/agent 和 API 继续防嵌入。首次打开须先绑定 loaded/error/message 再导航；chattool:player-ready 校验来源域名和 iframe 窗口，超时仅有界重试。
- 原生文件选择依赖 `native` 中 `QingChatWebViewBridge` 和 `tools/sync_android_chat_webview.py`、`tools/sync_ios_chat_webview.py`；旧 APK 缺桥不能靠网页/热更新补齐。不要恢复旧全局文件访问、混合内容和禁缓存等宽泛 WebView 改动。
- 2026-08-14 浏览器客服与语音已有 HTTPS 分支；早期“只有纯 HTTP”不再能概括所有平台。Native 动态入口与网页强制 HTTPS 分开核查。

来源：原记忆第 76、226–230、233–235、446 行。历史完成网页布局/构建与部分真机排错；Android/iPhone 文件选择、视频上传/播放和牌桌透出仍需按最新包复核。

## 房间语音协议与实现入口

- 保留 Cocos StartRecord/StopRecord/DownLoadRecord、`reqSay("@@语音@@"+voiceId)` 和房间串行播放队列。AudioServer 返回文件名，KB 只广播文件名；用户明确采用无语音令牌流程，不自行新增 KB 签发/AudioToken。
- Web：`WebVoiceRecorder.ts`、`WebVoiceClient.ts`；优先 AudioWorklet，回退 ScriptProcessor，16kHz 单声道 PCM16LE，WS 流式上传，失败用保留 PCM 和同一 requestId 有界 HTTP 补传。
- Native：`native/android/voice/QingVoiceBridge.java` 与 `native/ios/voice/QingVoiceBridge.h/.mm`。Android AudioRecord/MediaPlayer，iOS AVAudioEngine/AVAudioPlayer；高频 PCM 与上传留在原生层，JSB 只传控制/文件名/完成事件，不能指望 Native 提供浏览器录音 API。
- `tools/sync_android_voice.py`、`tools/sync_ios_voice.py` 把项目主源码同步到 Creator 生成工程，补权限及生命周期；重生成工程后需核查并重新同步，不能只改 build 副本。
- `AudioServer/` 为独立 Go 服务；PCM 流进 FFmpeg、临时 .m4a.part 原子完成、分片文件和 JSON 元数据，历史默认留存 7 天。多实例需共享索引/存储，不能把单实例文件方案直接扩容。

来源：原记忆第 387–413 行。录音/权限/端点的最新分支优先于较早历史叙述。

## 语音异步与平台差异不能丢

- 每条录音独立会话、PCM、requestId 和响应状态；重复按松去重、低于 300ms 丢弃，9.6 秒自动停/9.8 秒硬上限、全零 PCM 拒传。普通松手留约 50ms 尾音；上一条补传不能覆盖下一条。
- WS 未清理就 HTTP 补传可触发 409：先 cancel/等待/关闭旧 WS，再同 requestId 有界重试。切房清理旧上传/播放并使迟到回调失效，禁止广播到新房。
- 预下载/最多 20 条缓存服务串行播放，完成与真实失败均推进队列。气泡出现不证明听到声音，需分别检查采集、上传/编码、KB 广播、下载、播放许可和音频信号。
- **苹果网页以 2026-08-14 规则覆盖通用预热**：进房不申请麦克风，按住才采集，松手/取消/切房释放轨道，已录 PCM 留给上传。首次权限弹窗中断按压时，已停止会话的特定取消错误静默；授权后重新按住，不隐藏真正权限/网络错误。
- 苹果网页复用同一个持久 HTMLAudioElement 完成手势解锁和播放；NotAllowedError 保留当前语音最多 30 秒并用现有确认提示在用户手势重试，不立即关气泡推进队列。Native、Android 网页、桌面网页保持原分支。
- 浏览器必须可信 HTTPS + HTTPS/WSS；浏览器端忽略旧本地明文覆盖，不因证书失败降级或信任无效证书。Native 历史允许 HTTP 和有效证书 HTTPS，接续时核查真实配置。
- Android `unexpected end of stream` 可能是上传 HTTP 连接提前关闭，不是 KB 牌局协议错误；根据发生时间联合设备和代理/AudioServer 日志，不能凭一张截图定根因。

来源：原记忆第 76–77、94–95、394–412 行。

## 接续验证

历史 Android 语音有 2026-07-28 用户测试通过报告，但机型/传输矩阵不全；iOS Native 有无签名构建与探针，无真实 iPhone完整验收；苹果 Web Clip 后续播放/释放麦克风修复有独立 Web 构建报告，不等同已上线或真机通过。

先读对应项目 README/部署文档、当前源码及授权范围；验证时区分 Go test/race/vet、前端构建、Creator、原生编译、签名安装、真实双端/多客服/三端语音与正式回读。测试账号登录可能触发派单，测试消息会写生产，不能把只读检查变成隐式收发。精确部署版本按当前文件/服务确认，旧哈希和临时测试数据仅去归档检索。
