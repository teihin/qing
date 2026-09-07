# 2026-09-06 V7 启动加载换肤交接

## 范围与约束

- 工作目录：`/Volumes/SSD/qing`；分支：`main`。
- 目标：把启动加载统一到 2026-09-04 V7 冷蓝金体系，并同时覆盖网页构建模板、网页进入后的登录资源加载、原生热更新和通用加载遮罩。
- 用户纠正：本游戏不是俱乐部模式，因此启动页不得出现“私人俱乐部”或 `PRIVATE CLUB`。
- 本轮不构建、不提交、不推送；保留其他未提交修改。

## 实施

- `assets/resources/UI/panelUpdate.prefab`
  - 根旧秦风背景已停用，第一渲染层改为 750×1800 完整 V7 冷蓝赌场长图，Top 固定，不做整图拉伸或拼接。
  - 8L 盾牌、中文标题“正在进入游戏”、英文安全加载副标题、装饰分隔、底部提示均为独立正式资源。
  - 原 `文件进度/大小进度`、百分比、状态、版本和 `panelUpdate.ts` 序列化绑定均保留；可见进度轨道/填充换为 V7 蓝金资源。
  - 网络异常层改为 V7 连接提示面板及“重新连接”按钮，原重试 Button 和逻辑不变。
- `assets/resources/UI/panelLoading.prefab`
  - 旧灰色方块 loading 替换为小型蓝金卡、旋转分段环和“加载中…”文字；原 Animation 和面板生命周期保留。
- `build-templates/web-mobile/splash.png`
  - 替换为透明底高清 8L 盾牌，供网页版 Cocos 首屏加载阶段使用。
- 正式资源：`assets/resources/V7/startup_*_exact.png`；生成、应用、只读检查入口分别为：
  - `tools/generate_v7_startup_loading_assets.py`
  - `tools/apply_v7_startup_loading.py`
  - `tools/validate_v7_startup_loading.py`
- 静态效果预览：`design-previews/2026-09-06-V7启动加载界面效果图-v1/01-启动加载-750x1334.png`。

## 验证

- `python3.13 tools/validate_v7_startup_loading.py`：通过；核对正式图片尺寸/Meta、Prefab SpriteFrame、长背景层级、进度组件绑定、通用加载卡和网页 Splash。
- Python 语法检查、`git diff --check`：通过。
- 按用户约定只重启当前 Creator 2.4.13 实例完成导入；启动日志未出现本轮资源导入错误。
- 现有网页预览实际重载：Apple iPhone 6 与 Apple iPhone X 均显示 V7 背景、独立盾牌、非俱乐部标题和真实递增进度；比例未随长屏拉伸。

## 未验证

- 未执行 Creator 构建。
- 原生热更新包的真实下载、校验、断线重试和真机显示未验证；网页极慢网络下模板 Splash 的完整停留过程也未单独录制。
