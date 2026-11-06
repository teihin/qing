# 2026-11-06 「我的」当前俱乐部卡片：合伙人补上我的红利入口

## 目标

「我的」→ 当前俱乐部卡片里的「我的收益」按钮（点开是「我的红利」`panelMyHongli`）原来只对俱乐部创建者显示，
合伙人（代理）看不到。要求合伙人也显示。

## 依据

- `服务器文档整理/俱乐部俱乐部联盟模式V2方案-客户端接口文档.md` §1.2 权限表：
  `查询_俱乐部_红利_统计`/`查询_俱乐部_红利_明细` 是「代理自己 / 群主」，`提取_俱乐部_红利` 是「代理自己」。
  合伙人本来就该有自己的红利入口，客户端隐藏属于漏配。
- §9.4：`user_id` 留空 = 查自己，所以合伙人带 `club_id` 打开面板查的就是自己的分红，不需要额外参数。

## 改动

- `assets/scripts/UI/ClubManagementView.ts`
  - `操作/管理收益` 的可见条件从 `role === "owner"` 改为 `owner || isAgent === true`。
  - `ClubContext` 新增可选 `isAgent`：`role` 的取值顺序是 owner→manager→agent，
    代理同时被设为管理员时 `role` 是 `manager`，只看 `role` 会让红利入口再次消失。
  - 打开 `panelMyHongli` 的守卫同步改为 `owner || isAgent`。
  - 新增 `syncOperationLayout()`：`操作` 行是横向 `cc.Layout`（608 宽 = 3 个 192 按钮），
    可见按钮数随身份变化（创建者 3 / 合伙人 2 / 其它 1），原来不重排会沿用旧槽位导致按钮偏左。
    先 `layout.updateLayout()`，再按实际宽度手动居中兜底（部分 2.x 版本 CONTAINER 不收缩行宽）。
- `assets/scripts/UI/panelMain.ts`
  - 构造 `ClubContext` 时补 `isAgent: !owns && this.IsClubAgent(agent)`。

## 位置数值（手算，未截图核对）

- 3 个按钮：总宽 608，位置 -208 / 0 / 208，与 Prefab 原值一致，创建者视觉不变。
- 2 个按钮：总宽 400，位置 -104 / 104。

## 验证

- 两个 TS 文件 `ts.transpileModule` 语法检查 0 诊断。
- **未验证**：Creator 导入与运行、网页/真机实际点击、合伙人真实回包（`ClubBonusStats` 是否按自己返回）、
  2 个按钮的实际视觉位置。
- 按钮文案仍是「我的收益」（面板标题才是「我的红利」），本次未改文案。
