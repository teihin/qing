# MEMORY.md —— qing 项目长期约定（索引版，勿超 3 KiB）

> 项目状态/决策/进度在 `docs/memory/`（入口 `AGENTS.md`）。
> 本文件只放**跨任务高频**的操作约定；改图/抠图的详细踩坑记录已移到同目录 `ART-NOTES.md`，
> 更结构化的流程在技能 `art-text-swap` / `cocos-ui-element-reskin` / `art-asset-text-audit` / `cocos-touch-passthrough-fix`。

## 通用
- 图片处理用 `/Users/yy/.workbuddy/binaries/python/envs/default/bin/python`（numpy + Pillow 12）；系统 `/usr/bin/python3` 无 numpy。
- Seedream 4.5 显式像素尺寸下限 **≥ 3,686,400 px**（不是文档写的 1280×720）。
- **中间产物一律不留**：交付后立即删试错版/草稿/临时脚本/对比图，只留成品。过程要短，先出可用结果。
- 本机 shell 里 `grep`/`rg` 直接调不可靠，**查文本一律用 Grep 工具**。
- **`git push origin main` 偶尔走 22 端口被中断**（`Connection closed by ... port 22`）。
  绕过：`GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_github_qing -o IdentitiesOnly=yes -p 443"`
  配 `push ssh://git@ssh.github.com:443/teihin/qing.git main`；`ssh.github.com` 不在
  `~/.ssh/config` 里，必须显式 `-i`。走显式 URL 后本地 `origin/main` 不会自更新，用 `git update-ref` 对齐。
- 改完 Cocos 脚本想快速自检：本机无 `tsc`，用 managed node 调
  `~/.workbuddy/binaries/node/workspace/node_modules/typescript` 的
  `ts.transpileModule(src,{reportDiagnostics:true})` 只查语法（0 诊断即通过），别指望完整类型检查。
- **Android Studio 构建 `build/jsb-link/.../proj.android-studio` 的 Gradle project cache 必须在持久目录**
  （现为 `~/Library/Caches/qing-android-gradle-project-cache`）：工程内 `.gradle` 是软链接，`gradlew` 里另有
  `--project-cache-dir`，**两处必须指向同一路径** —— AS 不读 gradlew，它直接用 `<projectDir>/.gradle`。
  历史上指过 `/private/tmp`，重启被系统清空 → 软链接悬空 → `Cannot create directory .../.gradle/8.9/fileHashes`。
  该路径不受 git 跟踪（`git ls-files` 为空），改动零 git 影响。
- **同工程的 Gradle daemon 堆必须显式调大**（`gradle.properties` 的 `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m`）：
  默认只有 512m，release 打包（R8 + 资源压缩 + 双 ABI APK）会 OOM，而 AS 只报看不出所以然的
  `PackageAndroidArtifact$IncrementalSplitterRunnable`。**判别口诀：先看工程目录里有没有
  `java_pid<daemonPid>.hprof`** —— 配了 `+HeapDumpOnOutOfMemoryError`，只有真 OOM 才落堆转储，
  时间戳对上失败时刻即可定案（**这些 hprof 是 OOM 证据，别当垃圾先删**）。
- **`proj.android-studio` 是 Cocos 生成的**（模板 `cocos2d-x/templates/js-template-link/...`，系干净原版，
  那行 jvmargs 在模板里就是注释的 —— OOM 根子）。**在 Creator 里重新构建原生 Android 会覆盖本目录**，
  把 4G 堆配置、`.gradle` 软链接、`gradlew`/`build.gradle` 的 hack 全冲掉。
  要持久化就镜像到 `build-templates/<构建输出目录名>/`（约定：`build-templates/web-mobile/` ↔ `build/web-mobile`，
  故原生 link 用 `build-templates/jsb-link/...`）；**软链接没法靠模板复制**。
  日常的 1/2/3/4 号 `.command`（热更/上传）**不会**重建原生工程，所以平时碰不到这个口子。

## 代码排查（本项目特有）
- `GameDataManager.getAccount()` = `KBEngine.app.player()` = `entities[entity_id]`。
  **未登录/断线重连期间返回 undefined** —— `KBEngine.app.reset()` 会置 `entity_id=0; entities={}`。
  定时器/调度回调里用它必判空（2026-09-19 `DrhPlayerLogic.TryRecoverMissingSelfActionUI` 因此每 0.1s 抛异常刷屏）。
- 浏览器端报错行号来自 sourcemap：`console.error(s)` 包装层会把日志归到第 200 行，实际调用点在栈的第二帧。
- 网页版走 WSS 反代：`wss://154-37-155-17.nip.io/ws/<port>/`（`WEB_KB_WSS_PROXY_BASE_URL`，端口白名单见 `GameDef.ts`）。
  `GET /ws/20013/` 返回 **502 = 反代后端不通**；`404` = 该端口不在白名单。原生端仍直连 `154.37.155.17:20013`。
- 连通性自检：用 `node`（22.x 自带全局 `WebSocket`）连一下比看日志快。
- **动画飞行期间禁止直接改坐标**：`cc.moveTo/moveBy` 播放中若被外部 `node.position = …`，Creator 2.4 默认
  `ENABLE_STACKABLE_ACTIONS=true`，引擎会把这段位移累加进动作起点（`MoveBy.update` 的 `_previousPosition` 校准），
  收尾比目标位置多跑一截（实测 58 → 110）。统一写法：**先 `stopAllActions()` 再设坐标；动作实例每次新建不复用**。
  现成踩坑点：`DrhPlayerLogic` 的 `PlayerInfo/animateOut`（分/搓牌中/大跟敲休/丢），点「延时」后服务端补推消息撞进 0.3s 弹跳窗口。
- **UI 按钮点击无反应 → 先查 `panelMain.onButtonClick` 缺分支**：Prefab 里 Button 的 `clickEvents` 恒为空，
  事件由 `common/UIViewBase.onLoad` 用 `getComponentsInChildren(cc.Button)` 统一注册到各面板 `onButtonClick`。
  提示弹窗统一 `showPanel("panelMsgView",ShowPanelMode.Cover,"文本")`；客服界面 `panelKefu`（`start` 只认
  `客服`/`VIP充值`/`VIP充值2` 三种 `strUserData`，传别的值 `strUrl` 为空）。
- **界面点击穿透 = 该节点没有触摸监听**：Creator 2.4 触摸候选按 **z-order** 派发（与注册先后无关，非 active 的排最后），
  有监听的节点被 `swallowTouches` 吞掉，下层收不到；命中范围 = 监听节点自己的 `_contentSize`（与子节点无关），
  所以遮罩节点必须自己全屏。修法：在面板 `onLoad` 给该节点注册 `TOUCH_END`（既有写法见
  `panelGameView` 的「奖池面板」/「牌型提示」），不用等激活、不用动 prefab。详见技能 `cocos-touch-passthrough-fix`。

## Cocos Prefab / 贴图（硬约束，别忘）
- **`panelXxx` 面板一律是 `UIManager.showPanel` 用 `cc.loader.loadRes("UI/" + 名字)` + `cc.instantiate` 动态创建的**
  —— 要改面板外观/尺寸就改 `assets/resources/UI/panelXxx.prefab`（双击进 prefab 编辑模式）。
  改场景 `drh8.fire` 里的同名节点**对运行无效**（那只是编辑器里的残留实例，2026-09-19 提示节点踩过）。
- 改完 Prefab/贴图后 `library/` 需 Creator 重新导入；`assets/resources/project.manifest` 是构建产物，跑 `1生成热更新包.command` 重建，**不要手改**。
- **Creator 开着时覆盖 PNG，`.meta` 会被自动改写**（`trimType:"auto"` 重算 trim，使 `_sizeMode=0` 元素放大约 5%）。
  根治：按原 trim 矩形给新图四边补 `alpha=2` 边界像素；收尾 `git checkout HEAD -- <每个 .meta>`。判断是否在跑：`pgrep -fl CocosCreator`。
- **覆盖 PNG 后 Creator 不会自动重导**，两步必做：① `touch` 目标 PNG（`cp -p` 会带旧 mtime，Creator 判定"没变"）；
  ② `osascript -e 'tell application "CocosCreator" to activate'`（窗口不前台就不扫描资源；走 System Events 会被拒）。
  是否真导入只看 `library/imports/<uuid前2位>/<uuid>.png` 的 md5 与 mtime。
- **`cp -p` 还会带源文件的权限位**：从旧工程拷 PNG 过来常是 `755`，提交时会出现
  `mode change 100644 => 100755`。拷贝后收尾 `chmod 644 <文件>` 再提交。
- 放大贴图必须**同时改三处**：顶层 `width/height`、`subMetas.*.width/height`、`subMetas.*.rawWidth/rawHeight`。
- 换图只覆盖同名 PNG，`.meta` 只改必要数字 → UUID 不变，Creator 不用重挂引用。
- 改图脚本输入必须先 `git show HEAD:<path> > /tmp/原图.png` 导出，防二次处理。
- 读节点坐标读 **`_trs`**（`_position` 为 (0,0) 时整个字段被省略，读了会误判"没坐标"）。
- 查引用用 `grep -rl` 反查 `.meta` 的 `uuid` **和** `subMetas.*.uuid`。

## 改图路线（只记结论，细节见 ART-NOTES.md / 技能）
- 新内容必须 **AI 生成**（不许脚本画字）；**未改动的部分保留原图原始像素**，只把 AI 新内容贴回去。
- 硬约束：新图**体积不超同组原图**、尺寸与原图一致。压体积先试 `quantize(colors=256, FASTOCTREE)`。
- 「文字看不清但内容不能变」→ **先问主人想要什么效果**，别自选路线（"保字形提亮"已被否决）。
- 验收四步：尺寸/`.meta`/体积 → alpha 覆盖率 → 分块梯度能量 → OCR 复扫旧名。**小图必须按真机 px 1:1 看**。
- 同一素材被否 ≥3 次就**停下问方向**，不要自己一路迭代。
- 改界面上文字前先分清**贴图文字**还是 **DOM/引擎文字**（网页版 loading 是 `WebLoadingManager.ts` 注入的 HTML，不是图）。

## 音效素材（网上找；**禁止用 numpy 从零合成波形**，已被主人否决）
- 首选 **Mixkit**：直链 `https://assets.mixkit.co/active_storage/sfx/<id>/<id>-preview.mp3`，免费商用、preview 就是完整时长。
- 次选 free-sound-effects.net：页面 `data-download` 属性里直接给 mp3 直链，可 curl 批量取。
- Pixabay 反爬抓不到（curl 只回空壳）；freesound 只有低质预览、许可各异。
- 判据：欢呼＝中频 500-3k 占比 >85% 且质心≈1kHz；礼花＝低频强瞬态。
- **但注意**：报奖音效试过「合成」和「找素材混音」两条路，主人**都不满意**（2026-09-19）。
  再遇到音效需求，**先问清他想要什么**（要现成成品文件 / 还是给参考音），别自己先做。
