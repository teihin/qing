# “我的”五档底皮手数绑定（2026-09-15）

- 目录/分支：`/Volumes/SSD/qing`，`main`，起点 `e2940da`；本轮改动未提交。
- 目标：用户指出“我的”界面 1~20 皮手数可与 `Account.playcount_count`（示例 `0#0#44#0#0#0#0#0`，其中 44 为 1 皮手数）对接，要求按该属性显示，替换原先的静态占位。

## 改动

- 文件：`assets/scripts/UI/panelMain.ts`
  - `onLoad()` 注册 `set_playcount_count` 事件，服务端属性变化时刷新。
  - `initUserInfo()` 增加一次 `this.set_playcount_count()`，面板创建时按当前属性渲染。
  - 新增 `set_playcount_count()`：读取 `GameDataManager.getAccount().playcount_count`，按“#”拆分，填入 `Main/我的/数据/V81皮手数`、`V82皮手数`、`V85皮手数`、`V810皮手数`、`V820皮手数` 的 `cc.Label`；字段缺失或为空时保留占位“—”。
- Prefab 未改：五个 Label 节点由 `tools/apply_v8_mine.py` 生成，路径与组件保持原样。

## 档位映射（依据）

- 用户给定值 `0#0#44#0#0#0#0#0` 共 8 段，且明确第 3 段（下标 2）为 1 皮手数。
- 项目内底皮档位升序为：0.1/0.3、0.2/0.5、1/3、2/5、5/10、10/20、20/40、50/100（见 `XuanManager/server/internal/api/reward_pools.go`），共 8 档，与 8 段一一对应。
- 因此 1、2、5、10、20 皮对应下标 2~6；该对应关系作为假设记录，如服务端实际顺序不同需改 `arrayIndex`，且 `arrayStake` 与 `arrayIndex` 必须成对维护。

## 验证与未验证

- 已做：`read_lints` 对 `panelMain.ts` 无新增诊断。
- 未做：未操作 Creator 导入/脚本重编译、未构建、未出热更包、未真机；未取得登录态真实 `playcount_count` 回包，实际渲染与档位顺序仍待用户登录态核对。
- 未改内容：`数据` 区其余统计（总局数/总手数/总胜率等）仍由既有 `remark` 与“查看数据”链路驱动，本轮不动。

## 下一步

- 登录态确认五个数字与服务器底皮档位一致；若发现错位，仅调整 `arrayIndex`。
