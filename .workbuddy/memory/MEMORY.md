# MEMORY.md —— qing 项目长期约定（索引版，勿超 3 KiB）

> 项目状态/决策/进度在 `docs/memory/`（入口 `AGENTS.md`）。
> 本文件只放**跨任务高频**的操作约定；改图/抠图的详细踩坑记录已移到同目录 `ART-NOTES.md`，
> 更结构化的流程在技能 `art-text-swap` / `cocos-ui-element-reskin` / `art-asset-text-audit`。

## 通用
- 图片处理用 `/Users/yy/.workbuddy/binaries/python/envs/default/bin/python`（numpy + Pillow 12）；系统 `/usr/bin/python3` 无 numpy。
- Seedream 4.5 显式像素尺寸下限 **≥ 3,686,400 px**（不是文档写的 1280×720）。
- **中间产物一律不留**：交付后立即删试错版/草稿/临时脚本/对比图，只留成品。过程要短，先出可用结果。
- 本机 shell 里 `grep`/`rg` 直接调不可靠，**查文本一律用 Grep 工具**。
- 改完 Cocos 脚本想快速自检：本机无 `tsc`，用 managed node 调
  `~/.workbuddy/binaries/node/workspace/node_modules/typescript` 的
  `ts.transpileModule(src,{reportDiagnostics:true})` 只查语法（0 诊断即通过），别指望完整类型检查。

## 代码排查（本项目特有）
- `GameDataManager.getAccount()` = `KBEngine.app.player()` = `entities[entity_id]`。
  **未登录/断线重连期间返回 undefined** —— `KBEngine.app.reset()` 会置 `entity_id=0; entities={}`。
  定时器/调度回调里用它必判空（2026-09-19 `DrhPlayerLogic.TryRecoverMissingSelfActionUI` 因此每 0.1s 抛异常刷屏）。
- 浏览器端报错行号来自 sourcemap：`console.error(s)` 包装层会把日志归到第 200 行，实际调用点在栈的第二帧。
- 网页版走 WSS 反代：`wss://154-37-155-17.nip.io/ws/<port>/`（`WEB_KB_WSS_PROXY_BASE_URL`，端口白名单见 `GameDef.ts`）。
  `GET /ws/20013/` 返回 **502 = 反代后端不通**；`404` = 该端口不在白名单。原生端仍直连 `154.37.155.17:20013`。
- 连通性自检：用 `node`（22.x 自带全局 `WebSocket`）连一下比看日志快。
- **UI 按钮点击无反应 → 先查 `panelMain.onButtonClick` 缺分支**：Prefab 里 Button 的 `clickEvents` 恒为空，
  事件由 `common/UIViewBase.onLoad` 用 `getComponentsInChildren(cc.Button)` 统一注册到各面板 `onButtonClick`。
  提示弹窗统一 `showPanel("panelMsgView",ShowPanelMode.Cover,"文本")`；客服界面 `panelKefu`（`start` 只认
  `客服`/`VIP充值`/`VIP充值2` 三种 `strUserData`，传别的值 `strUrl` 为空）。

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
