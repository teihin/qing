# 玩家信息弹窗 V8-new 实施

- 工作区 `/Volumes/SSD/qing`，分支 `main`；未提交、未推送。
- 唯一设计 `design-previews/效果图V8-new/04-登录与弹窗/05-玩家信息弹窗.png`；用户明确修正参考图中的椭圆头像为正圆。
- 正式修改 `assets/resources/UI/panelUserInfo.prefab`、`assets/scripts/UI/panelUserInfo.ts`；新增 `assets/V7/player_info_v8_*` 19 张 PNG 与 meta。
- 面板、按钮、统计底框、道具格使用紧凑九宫格；标题/装饰/关闭/复制/麦克风/头像框/开关/道具独立。19 张 PNG 共272,168字节、213,771像素，未压缩RGBA约0.815 MiB；六格共用一张80×96底框，底板为128×384。
- 显示抓鸡、炸弹、机枪、鲨鱼、大拇指、屎，3列2行；亲嘴、干杯、Nice、钓鱼仅隐藏，原节点与资源保留。头像mask为118×118 ELLIPSE，框为132×132，独立图均保持比例。
- 玩家数据/九项统计仍由原脚本赋值，VIP星号遮挡规则不变；语音、赠送/本人充值、道具消费及发送协议保留。脚本只新增右上关闭和复制ID分支，复用MobileManager复制实现。
- 工具：`tools/extract_v8_player_info_assets.py` 负责按源图提取与压缩；`tools/migrate_v8_player_info.py` 只负责Prefab序列化。资源说明和contact sheet在 `art_sources/player_info_v8/README.md`、`art_sources/player_info_v8_preview.png`。

## 验证与边界

- 原有66个节点/58个去重路径均保留；当前79个节点。18个原Button/Toggle及原clickEvents保留，新增关闭/复制按钮；Prefab UUID未变，引用有效。
- 迁移工具从HEAD旧Prefab在临时目录执行成功，二次运行幂等；`git diff --check`通过。
- 已通过运行中的Creator 2.4.13 AssetDB刷新正式Prefab，导入缓存中无旧临时UUID。网页Recompile不能替代此步骤。
- 本地7456真实Cocos引擎离线渲染：375×812与375×667尺寸均完整显示，九项统计及caption、3×2道具、头像正圆、长昵称边界已检查。预览使用样例数据并禁用联网生命周期，未发送道具、未进行交易；不等于真实登录业务验收。
- 未构建、未真机、未部署；真实玩家头像/语音/赠送/充值和原生复制交互仍需业务状态验收。
- 项目文档检查有6个既存失效链接（用户已删除的design-previews/待确认目录）和2个既存文件大小警告；未恢复用户删除文件。

## 可复用注意项

- Creator2.4节点位置使用`_trs`，不能仅写`_position`；Label要使用正式序列化字段并激活原隐藏caption。
- 新节点PrefabInfo.asset必须引用正式Prefab UUID；修生成函数之后，还要修已经写入的历史节点。
- 分割线放在列间而非列中心，九宫格底板不烘焙网格；深色炸弹不能与蓝底一起按宽泛颜色阈值抠除。
