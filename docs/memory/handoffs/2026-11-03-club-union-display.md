# 我的页与俱乐部列表显示联盟归属（未构建、未真机）

- 日期：2026-11-03
- 分支：`codex/club-ui`
- 目标：加入联盟后，在「我的 → 当前俱乐部」卡片显示联盟名称和联盟号；俱乐部列表卡片对联盟俱乐部显示左上角联盟徽记，名称改为 `俱乐部名(联盟名)`。

## 实现

- 「我的 → 当前俱乐部」标题行右侧新增 `联盟徽记` + `联盟信息`：有联盟时显示 `联盟名(联盟号)`，没有名称时显示 `联盟号 123456`；无联盟整行隐藏。
- 「俱乐部 → 俱乐部列表」条目模板新增左上角 `联盟徽记`（52×52，压住头像左上角），联盟俱乐部的 `俱乐部名称` 改为 `俱乐部名(联盟名)`，名称字号从 38 降到 32，避免 260 宽标题被压得过小。
- 新美术 `assets/ImagesLuck/联盟/union_badge.png`（128×128）：深蓝圆底、金色双环、金色盾冠徽记；`.meta` UUID 已写入 Prefab。
- 数据来源：
  - `查询_俱乐部_信息` 的 `union_id` / 兼容 `union_name`；
  - `ClubUnionQuota` 兼容 `union_name`；
  - `ClubMyUnion` 的 `union_id` / `union_name` / `members[].club_id`。
- 名称缺失时，俱乐部创建者会补查 `查询_我的_联盟`（10 秒节流，失败冷却 5 分钟）；普通成员不补查，只用俱乐部信息里的字段。
- 创建联盟成功时把输入框里的联盟名称直接写入本地缓存，避免首屏只显示联盟号。

## 验证

- `panelMain.ts`、`ClubManagementView.ts` 通过 `node --experimental-strip-types --check`。
- Prefab JSON 往返稳定；新节点父子关系、组件反向引用、`fileId`、徽章贴图引用检查通过。
- 用真实 Prefab 1:1 渲染列表与当前俱乐部卡片预览：徽记位置、联盟名称/号、老板牌互不重叠。预览见 `design-previews/待确认/2026-11-03-联盟入口/04-联盟归属-俱乐部列表.png`、`05-联盟归属-我的当前俱乐部.png`。
- `git diff --check` 通过。

## 未验证

- Creator 是否已重新导入 `union_badge.png` 与新 Prefab 节点；本次未操作 Creator，构建、真机均未执行。
- **服务端字段缺口**：最新 V2 文档只在 `ClubMyUnion` 明确返回 `union_name`，`查询_俱乐部_信息` 与 `ClubUnionQuota` 未列该字段；`查询_我的_联盟` 文档限总群主。盟主若被服务端拒绝补查，界面会退化为只显示联盟号。若要在盟主端稳定显示名称，需要服务端在 `查询_俱乐部_信息` 或 `ClubUnionQuota` 返回 `union_name`。
- 真实服务器回包（联盟名称/成员列表/错误码）、双账号入盟后的列表刷新未实测。

## 关键文件

- `assets/scripts/UI/panelMain.ts`
- `assets/scripts/UI/ClubManagementView.ts`
- `assets/resources/UI/panelMain.prefab`
- `assets/ImagesLuck/联盟/union_badge.png` + `.meta`
