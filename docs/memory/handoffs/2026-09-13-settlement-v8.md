# 牌局结算 V8-new 换肤

日期：2026-09-13；目录 `/Volumes/SSD/qing`；分支 `main`。进入时工作区干净；本次未提交、未推送、未构建或发布。

## 用户要求与实现

- 唯一视觉依据：`design-previews/效果图V8-new/01-主页面/06-结算.png`（1024×1536）。背景按用户指定复用大厅 `lobby_scene_long_v8.png`。用户再次明确称号保留“土豪、MVP、大鱼”，不使用源图“亚军、季军”。
- `assets/resources/UI/panelRecordInfo.prefab`：停用旧场景/地面延展和整张荣誉区图片；左上标题、三个透明荣誉框、称号底牌、信息栏、表头、列表及返回按钮独立序列化。原图头像和昵称不再烘焙到荣誉图中，真实头像和昵称仍由原脚本更新。
- `排行/排队` 仍在原节点路径；Button、`pd` Spine 数据及业务显隐保留，位置改到“牌局回顾”左边。没有改申请、取消、查询、退出旧房或切房逻辑。
- `assets/resources/Prefabs/战绩玩家对象.prefab`：按原图列位置、两行玩家信息和细分隔线调整；保留真实昵称、ID、带入、手数、输赢及条件惩罚节点。源图没有额外名次列，因此只关闭 `idx/idx2` 的 Label 渲染，业务仍可更新原节点。
- 固定顶部和底部，中部列表伸缩并保留 ScrollView。专用 `settlement_v8_list_panel.png` 采用原图边缘、连续二维蓝色材质及 25px 九宫格边距，替代单行采样放大；`settlement_v8_summary.png` 使用宽区域平滑材料，清除原图样例值。旧共享 `settlement_list_panel_exact.png` 与 `settlement_summary_exact.png` 已恢复原样，避免影响回顾页。
- 作者工具：`tools/apply_v8_settlement.py`；裁切记录和检查图：`art_sources/v8-repairs/settlement/`；`tools/v8_settlement_crops.json` 改为准备好的组件切图，避免通用提取再次恢复原图头像或竖纹。

## 用户对照截图后的可读性修正

- 三个称号下的昵称由 23 放大到 28，文字框同步增高，使用不透明深蓝 2px 描边，增强在大厅灯光前的对比。
- 房间号、底皮、总奖池、时间由 21 放大到 26，统一项目字体和浅金色 `#FFF2D8`。移除 `panelRecordInfo.ts` 每次刷新奖池时覆盖成暗橙色的旧代码。
- 行内昵称、带入、手数、输赢由 21 放大到 26，ID 由 17 放大到 21；两行文字重新留出间距。正负输赢仍使用原来的红/黄绿语义，调整为更亮的 `#FF6959` / `#CBE137`，零值使用统一浅金色。
- 行分隔线保留原图横线，平滑提亮并将显示高度由约 1.46 调为 3 个设计像素；未改变行高、列位置或中部伸缩结构。修正同步保存在作者工具的 `apply_readability()`，可独立执行，不重建其他布局。

## 已完成验证

- `python3 tools/validate_v8_settlement.py`：11 张组件资源的源图哈希/尺寸/透明头像孔、原节点名与 Button 事件/Spine 绑定、1125（原图比例）及 1334/1624/1778/1860 五档几何通过。拉伸后的列表内部横向二阶差分不超过 2 个 RGB 灰阶，结合静态图检查未见窄带竖纹。
- `node tools/tests/settlement_v8_regression.js`：21 项生产脚本回归通过，包括历史战绩隐藏排队、可排队入口、已排队查看、不可申请提示、匹配阶段关闭结算、原土豪/MVP/大鱼评选、动态字段/正负零值颜色、回顾查询及返回；新增正/零/负奖池刷新后仍保留正式 Prefab 颜色的检查。
- `panelRecordInfo.ts` 仅移除奖池固定色覆盖并提亮三种输赢状态颜色；`QueueMatchManager.ts`、`panelGameView.ts` 和大厅背景 PNG 未改。两份 Prefab 没有新增重复 fileId；结算 Prefab 原有 9 组重复 fileId 与 HEAD 相同，未在本轮扩展修复。
- 中间版本在现有 Creator 2.4.13 / `localhost:7456` 的 iPhone X 中已加载；实际历史记录曾展示新节点和真实头像。发现网页旧 UUID 表未注册新资源后刷新了页面，登录态已回到登录页。随后使用仅内存的样例加载正式 Prefab，确认荣誉框不重影、排队位置/动画和布局；样例不发送业务请求，不写入 assets。该次网页检查早于最后专用底框和文字/分隔线调整，不能算最终版本验收。

- 本次已在现有 Creator 2.4.13 通过 `Editor.assetdb.refresh` 定向导入 11 张组件图、两份 Prefab 和脚本，全部取得成功回执。`python3 tools/validate_v8_settlement.py --imports` 核对可见预乘像素及完整 Prefab 数据一致（仅忽略 Creator 对资源顶层 `_name` 的补名）。上一阶段最后两个底框未导入的问题已解决。
- 最终正式 Prefab 在现有网页的 iPhone X（750×1624）及 iPhone 6（750×1334）进行真实引擎样例渲染：昵称 28、信息栏/行主字 26、ID 21，无自动缩字；信息栏四项字体一致，横线高度 3，短长屏未见文字挤压或窄带竖纹。样例只在内存中填入源图值、保留默认头像，禁用页面业务初始化，未发送排队或资金请求。
- 导入脚本时预览自动刷新回登录页；最终临时 `__settlement_readability_qa` 节点已移除并销毁，设备恢复 Apple iPhone X。本次截图样例不代表新的真实牌局数据验收。

## 待验证

- 真实牌局结束后排队申请/取消/匹配切房、真机与构建仍待验；本轮离线桩不会发起真实排队或资金行为。
