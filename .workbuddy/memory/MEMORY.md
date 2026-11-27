# MEMORY.md —— qing 项目跨任务约定（索引版，目标 ≤5 KiB）

> 项目状态/决策/进度在 `docs/memory/`（入口 `AGENTS.md`）。
> 本文件只放**跨任务高频**约定；细节已拆到同目录 `SERVER-NOTES.md`（服务器/原生构建）、
> `ART-NOTES.md`（改图/抠图/Prefab 贴图/音效），结构化流程在技能
> `art-text-swap` / `cocos-ui-element-reskin` / `cocos-touch-passthrough-fix` / `art-asset-text-audit`。

## 通用
- **`main`=平台版、`codex/club-ui`=俱乐部版**，两条产品线互不推。后台 XuanManager 与自动化都在 club-ui
  （main 停在 2026-10-24，缺 honor-rank / club-perf 等路由，别把 main 的构建发上去）。
- 图片处理用 `/Users/yy/.workbuddy/binaries/python/envs/default/bin/python`；系统 `/usr/bin/python3` 无 numpy。
- **中间产物一律不留**：交付后删试错版/草稿/临时脚本/对比图；过程要短，先出可用结果。
- **查文本一律用 Grep 工具**（本机 shell 的 `grep`/`rg` 不可靠）。
- TS 语法自检：managed node 里 `typescript` 的 `ts.transpileModule`（本机无 tsc，别指望完整类型检查）。
- 记录类列表金额配色一律「**红加绿减**」（`cc.Color(255,65,52)` 加、`(167,231,29)` 减）。
- 推送被 22 端口掐断：`GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_github_qing -o IdentitiesOnly=yes -p 443"` +
  `ssh://git@ssh.github.com:443/teihin/qing.git <branch>`；任何分支同理，之后 `git update-ref` 对齐本地 origin。

## 服务器（细节见 `SERVER-NOTES.md`）
- **测试服 `154.37.155.17`** = `/www/html/.xuanmanager`（本地 MySQL，有 mysql/mysqldump）；
  **正式服 `8.153.70.197`** = `/www/.xuanmanager`（Caddy `:28800`，MySQL 远程 `172.22.161.126`，本机无 mysql 客户端 → pymysql，
  env 值要先剥引号）。**说「线上/正式服」先确认 IP。**
- 登录统一 `ssh -p 2233 -i ~/.ssh/id_ed25519_newserver client_update@<ip>`；多行 ssh 脚本会被掐断，写脚本传上去再执行。
- `webcm_user` 无 `LOCK TABLES`：mysqldump 导入前 `sed` 去掉 `LOCK TABLES`/`UNLOCK TABLES` 行，遇错即停要整份重跑。
- 原生构建：Gradle 堆 `-Xmx4096m`、`.gradle` 缓存放持久目录；Creator 重建原生会覆盖 `proj.*` →
  已镜像到 `build-templates/jsb-link/...`，iOS 异常先跑 `tools/ios/check_ios_native.py`。

## 代码排查
- `GameDataManager.getAccount()` 未登录/断线重连期间返回 **undefined**（`app.reset()` 清 entities）→ 定时回调必判空。
- **动画飞行期间禁止直接改坐标**：先 `stopAllActions()` 再设位置，动作实例每次新建（2.4 的 stackable actions 会累加位移）。
- **UI 按钮点击无反应** → 先查 `panelMain.onButtonClick` 缺分支（prefab 的 `clickEvents` 恒为空，由 `UIViewBase.onLoad`
  统一注册）；提示弹窗统一 `showPanel("panelMsgView",…,"文本")`。
- **点击穿透 = 该节点没有触摸监听**；命中范围 = 监听节点自己的 `_contentSize`，遮罩必须自己全屏。
  动态列表按钮抢点击 → 给弹窗父节点设递增 zIndex（`ClubManagementView.raisePopups()`），光加遮罩无效。
- 网页 WSS 反代 `wss://154-37-155-17.nip.io/ws/<port>/`：**502 = 反代后端不通，404 = 端口不在白名单**。
- 浏览器报错行号来自 sourcemap，`console.error(s)` 包装会把日志归到固定行，真调用点在栈第二帧。
- **Node 内置 `WebSocket`（undici）连不上 KBEngine**：服务器会回一个未请求的
  `Sec-WebSocket-Protocol: WebManagerSocket`，undici 按 RFC 判失败（日志 `onerror_before_onopen`），
  浏览器与 Cocos 原生都容忍。机器人客户端因此自带 `agent-client/wsclient.js`，**别把 `global.WebSocket` 改回去**。

## Cocos Prefab / 贴图（细节见 `ART-NOTES.md`）
- **所有 UI 改动按可变画布做**：新增/挪动节点一律加 `cc.Widget`（贴顶 `_top` / 贴底 `_bottom` / 拉伸 top+bottom）；
  夹在两块 Widget 之间的条状区（排序栏/分页栏）也要自带 Widget。实机画布约 **750×1624**（不是 1334），改完按两档核压叠。
- `panelXxx` 由 `UIManager.showPanel` 动态 instantiate prefab；**唯一例外 `panelGameView`** 跑的是 `drh8.fire` 里那份
  序列化副本，改 prefab 对运行无效，必须同步改场景（`PrefabInfo.fileId` 两边要一致）。
- 改 `cc.Label` 文案要改 `_string` + `_N$string`（原生端读后者）；`cc.Toggle.checkMark` 必须指 `cc.Sprite`。
- 覆盖 PNG 后要 `touch` + 激活 Creator 才重导；`cp -p` 会带 755 权限位，收尾 `chmod 644`。
- 改图结论：**新内容 AI 生成**（不许脚本画字）、未改动区域保留原图像素、新图体积不超原图；验收四步（尺寸/.meta/体积 →
  alpha 覆盖率 → 分块梯度 → OCR 复扫旧名），小图按真机 px 1:1 看；**同一素材被否 ≥3 次就停下问方向**。
- **美术出图只用内置 imagegen 技能，禁用 Seedream/seedream-image**（用户 2026-10-31 明确）；会耗独立额度，先告知。
  imagegen 生成中文美术字笔画会碎，中文标题仍让美术出图或用 Label+描边。

## 音效
- 网上找素材（Mixkit / free-sound-effects.net），**禁止 numpy 从零合成**；报奖音效「合成」与「混音」都被否决过，
  再接音效需求先问要成品文件还是参考音。
