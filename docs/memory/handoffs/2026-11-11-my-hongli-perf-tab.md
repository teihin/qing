# 我的红利：业绩股页签（2026-11-11）

## 目录 / 分支

- 工作目录：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 未提交修改：`assets/resources/UI/panelMyHongli.prefab`、`assets/scripts/UI/panelMyHongli.ts`、
  `tools/render_ui_prefab.py`（预览器索引扩到全 assets）、新增 `tools/apply_my_hongli_perf_tab.py`

## 目标

「我的」→ 当前俱乐部卡片 →「我的收益」打开的 `panelMyHongli` 改成两个页签：

1. **我的红利**：沿用原界面与 `查询_俱乐部_红利_统计/明细`、`提取_俱乐部_红利`。
2. **业绩股**（新）：输入下级代理 ID 添加业绩股成员；列表显示成员头像、昵称、ID、昨日占比；
   底部显示「业绩总比例：我 / 下放 / 剩」。竞品截图只作结构参考，配色沿用 V8 深蓝金框。

## 改动

### Prefab（正式文件，编辑器可见）

- 标题栏下新增 `页签`（460×56，Widget top=84），两个 200×56 页签：
  `页签_我的红利`（`gs_tab_on`）、`页签_业绩股`（`gs_tab_off`）；按钮沿用面板统一 `onButtonClick`。
- 红利内容整体下移 55：`统计 / 未领取底 / 未领取红利 / 提取红利 / 记录 / 列表面板 / 表头 / 列表`
  的 Widget `_top` +55；分页仍贴底（bottom=35.87，不变），列表靠上下拉伸吸收。
- 新增 `业绩股页`（全屏 Widget 45，默认隐藏）：
  - `输入区/代理ID输入`：复制上下分弹窗 EditBox 结构（`gd_input` 底、数字键盘、maxLength 12、
    占位「请输入下级代理ID」）；框内左侧 `ID文字`。
  - `确认添加业绩`：`hongli_v8_btn_extract` 220×80，深色文字。
  - `业绩表头`（下级代理 / 昨日占比）、`业绩列表`（ScrollView）、`记录行`（`agent_v8_row` 9 宫格，
    头像 = `player_info_v8_avatar_frame` + 圆形 Mask + 默认头像）、`业绩提示`、`业绩合计`。
  - 所有新增/挪动节点均带 `cc.Widget`（贴顶 / 上下拉伸 / 贴底），按 1334 设计稿写偏移。
- `提取红利面板` 移到根节点最后，保证确认弹窗仍盖住页签与业绩股页。
- 页签资源：`assets/V8/game_settings/gs_tab_on.png` / `gs_tab_off.png`。

### 脚本

- `panelMyHongli.ts`：
  - 页签切换；联盟模式（`mode=union`）隐藏整条页签，仍只显示联盟红利。
  - 业绩股接口按《俱乐部业绩-客户端与后台接口文档》（2026-11-11）：
    `异步_查询_俱乐部_业绩_信息`、`异步_查询_俱乐部_业绩_下发_列表`、`设置_俱乐部_业绩_授权`。
    `context` 用 `p@<ctx>`，回包兼容 `{"context","result"}` / `ret_result` / 裸 JSON。
  - 列表 10 条/页，复用底部 `分页`；页签切换时按当前页签路由翻页与页码。
  - 底部占比优先用服务端 `*_percent` 字符串，列表回包没有百分比时按次数/`all_count` 补算两位小数。
  - 添加：校验纯数字 → `enabled=1`；成功后提示、清空输入，0.8s 后刷新（服务端写库异步）。
  - `enabled=false` 时提示「你尚未开通业绩」，并挡住添加。

## 验证

- Prefab JSON 图检查：`__id__` 全部有效、父子/组件回指一致、无重复 `fileId`（0 错误）。
- TS：typescript 5.9 `transpileModule` 语法诊断 0。
- 离屏渲染（`tools/render_ui_prefab.py`，1334 / 1624）：
  - 我的红利：标题 → 页签 → 统计 → 未领取 → 列表 → 分页，无压叠；长屏列表增高。
  - 业绩股：输入区 / 按钮 / 表头 / 4 行样例 / 合计条 / 分页 无压叠；长屏列表增高。
  - 提取确认弹窗盖住页签（层级正确）。

## 未验证 / 下一步

- Creator 导入与构建、真机键盘与滚动、服务端联调均未做。
- 服务端 `club_performance.py` 4 个命令需重启 baseapp 生效；联调按接口文档 §九。
- 列表是服务端 frontier（与「下放」同集合）：A→B→C 且 B、C 都授权时，A 只看到 B；
  这是接口口径，不是漏人。
- 未做取消业绩股成员入口（接口 `enabled=0` 已支持，本次需求未要求）。

## 相关

- 接口：`服务器文档整理/俱乐部业绩-客户端与后台接口文档.md`
- 旧实现说明：`docs/memory/handoffs/2026-11-09-my-hongli-v8-restyle.md`
