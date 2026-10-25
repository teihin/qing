# 2026-10-24/25 俱乐部成员页 V8-new 重设计

## 范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；配置：Cocos Creator 2.4.13。
- 依据：`design-previews/效果图V8-new/` 的蓝金视觉语言，以及用户提供的竞品“我的成员”和“玩家信息”布局。
- 本轮保留工作区已有未提交修改；没有提交或推送。

## 已完成

- `assets/resources/UI/panelMain.prefab`
  - 成员页改为 V8-new 蓝金卡片布局，保留顶部右侧唯一的“入会申请”入口。
  - 卡片内移除赠予、设置、删除等旧操作按钮；头像是唯一的玩家设置入口。
  - 增加搜索、查询/重置、首页/上一页/下一页/尾页和 V8 分页图标。
  - 增加正式的“俱乐部玩家设置弹窗”，使用 V8 面板、标题、关闭、头像框、统计底板、按钮和开关资源。

- `assets/scripts/UI/ClubManagementView.ts`
  - 读取竞品布局对应的团队人数、积分余额、在线状态、今日/昨日/累计输赢和贡献字段。
  - 点击头像打开玩家设置；支持文档已定义的踢出、积分调整、设置/修改/取消代理操作。
  - 备注、禁止游戏、禁止账号保留视觉占位但置为不可用，因为当前接口文档没有对应命令。
  - 代理比例修改入口按当前成员管理视角限制为创建者，管理员仍可做成员管理。

- `assets/scripts/UI/ClubManagementApi.ts`
  - 对接 `NumberList` 新增字段：`team_count`、`today_score`、`yesterday_score`、`total_score`、`today_contrib_fen`、`yesterday_contrib_fen`、`total_contrib_fen`。
  - 使用 `club_gold` 作为当前俱乐部积分余额；贡献分字段展示时除以 100；搜索传 `search_name_id`。
  - 接入 `修改_俱乐部_成员_积分`、`设置_俱乐部_代理`、`修改_俱乐部_代理_比例`、`取消_俱乐部_代理`，数值参数按协议发送为数字。

## 预览与验证

- 预览：
  - `temp/club-management/members-v8-preview.png`
  - `temp/club-management/player-settings-v8-preview.png`
- 已通过：目标 TypeScript 转译（`ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.ts`）、成员协议回归脚本、Python 脚本编译、Prefab 子树 `PrefabInfo.fileId` 唯一性、V8 资源引用检查、离线预览渲染和 `git diff --check`。
- 离线预览未发现未解析 Sprite、未支持组件或缺图；预览不是 Creator 运行时验收。

## 未验证边界

- 尚未在当前回合打开 Cocos Creator 做导入刷新，也未做 Creator 场景预览、构建、真机或真实创建者账号联调。
- 真实 `NumberList` 回包中的头像加载、代理比例字段是否随成员行下发，仍需真实服务器验证；未下发的比例会显示 `—`，不会伪造数据。
