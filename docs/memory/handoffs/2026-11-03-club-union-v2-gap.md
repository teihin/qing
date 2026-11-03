# 俱乐部联盟模式 V2：与当前客户端的差异及改造清单

- 日期：2026-11-03
- 依据：`服务器文档整理/` 下 2026-11-03 更新的 5 份接口文档 + 新补入的《俱乐部代理开通与取消推送方案》，核心为《俱乐部俱乐部联盟模式V2方案-客户端接口文档》
- 代码基线：`codex/club-ui` 分支，HEAD `ac96064`
- 性质：**只做差异分析，未修改任何代码、Prefab 或后台**

---

## 0. 结论摘要

服务端已从「俱乐部 + 代理各自持额度」切换为「平台 → 联盟（总群主）→ 俱乐部（盟主）→ 代理 → 玩家」，额度只在**总群主与盟主俱乐部之间**存在，代理只保留分成比例，抽水转为代理红利。当前客户端仍完整按旧模型实现，直接上线会出现 4 类问题：

| 级别 | 问题 | 后果 |
| --- | --- | --- |
| P0 | 客户端仍在调用已停用的 `查询_俱乐部_额度` / `授信_俱乐部_额度` / `增加_俱乐部_额度` | 返回「命令不存在」，额度展示、授信、上下分入口全部失效 |
| P0 | 创建俱乐部仍是「服务端创建 + 客户端再发一次 `玩家_消费_命令`」 | V2 服务端已在 `创建_俱乐部` 内扣钻，客户端会**重复扣费** |
| P0 | 「盟主」仍按 `is_leader` 判定 | 身份标签、权限入口、私聊角色名全部错位 |
| P1 | 联盟相关 9 个命令、6 条推送、代理红利 3 个命令客户端零实现 | 无法建盟、入盟、审批、授信、看联盟额度、查/提红利 |
| P1 | 「我的红利」仍走 `查询_俱乐部_代理_收益` + `提取_玩家_红利` | 俱乐部口径收益与提取链路和 V2 不一致 |
| P1 | XuanManager 俱乐部额度调整仍调停用命令 | 后台额度调整功能失效 |
| P2 | `ClubAgentInfo` 已由服务端在开通/改比例/取消代理后主动推送 | 客户端已有解析；聊天页与私聊角色缓存不会随推送刷新，可能短时停留在旧身份 |

---

## 1. 新旧模式差异总览

| 维度 | 当前客户端/旧模型 | V2 新模型 | 客户端影响 |
| --- | --- | --- | --- |
| 组织层级 | 俱乐部（群主）→ 代理 → 玩家；联盟是俱乐部之间的双向链接 | 平台 boss → 联盟（总群主）→ 俱乐部（盟主）→ 代理 → 玩家 | 新增联盟实体与页面，旧联盟入口不存在，无需迁移 |
| 「盟主」定义 | 创建者的直属代理（`is_leader=1`） | **俱乐部创建者本人**；`is_leader` 不再作为盟主判定 | 所有「盟主」标签、权限、私聊角色名都要改 |
| 额度归属 | 代理各自有额度账户（`club_agent_info.quota`） | 只有俱乐部额度 `club_guuid_info.union_quota`（分）；代理无额度账户 | 删除所有代理维度额度 UI、查询、授信 |
| 额度来源 | 群主/上级代理逐级授信 | 平台给联盟池注资 → 总群主给盟主俱乐部授信 | 授信对象从「代理」变为「俱乐部」，入口只在联盟页 |
| 平台注资 | `增加_俱乐部_额度`（客户端不可见） | `增加_联盟_额度`（仅 boss，客户端不要做入口） | 后台需改命令 |
| 抽水 | 记代理收益，部分回补额度 | 按 `percent` 逐层累加到 `club_agent_info.bonus`（分），**不再回补额度** | 「我的红利」改为俱乐部红利口径 |
| 带入扣款 | 扣「最近已授信代理」的额度 | 扣**所在俱乐部**的 `union_quota`；未入盟额度恒 0 | 失败文案与排查口径变化 |
| 结算回补 | 回补到代理额度 | 回补到**同一俱乐部**额度池 | 客户端只展示，无协议改动 |
| 管理员追加带入 | 不回补 | 不回补（与旧一致） | 无 |
| 玩家间赠送 | 要求两人属于同一授信代理 | 同俱乐部即放行，只校验双方都在俱乐部 | 客户端可去掉「同一授信代理」提示与限制 |
| 创建俱乐部 | 客户端创建成功后再发 `玩家_消费_命令` 扣钻 | 服务端在 `创建_俱乐部` 内扣 `d_halls.create_club_stone`，失败自动退回 | 删除客户端二次扣费 |
| 上下分资金来源 | 已授信代理扣额度；未授信代理/普通成员扣自己积分 | **代理**扣俱乐部额度（带入时才真正出钱）；**非代理**扣自己积分 | 入口判定从「已授信」改为「是否代理」 |
| 联盟加入 | 旧联盟双向链接（已整体下线） | 6 位联盟码申请 → 总群主审批 | 全新页面与流程 |
| 代理收益查询 | `查询_俱乐部_代理_收益` → `ClubAgentIncomeInfo` | `查询_俱乐部_红利` → `ClubBonus`；明细 → `ClubBonusList` | 红利页重写 |
| 红利提取 | `提取_玩家_红利`（平台红利账户） | `提取_俱乐部_红利`，整数元，转成俱乐部积分 | 提取入口与校验重写 |

---

## 2. 协议变化清单

### 2.1 新增命令与推送

| 命令 | 权限 | 推送路由 | 客户端用途 |
| --- | --- | --- | --- |
| `创建_联盟` | 俱乐部创建者 | `ClubUnionCreate` → `{union_id}` | 建盟，展示 6 位联盟码 |
| `查询_我的_联盟` | 总群主 | `ClubMyUnion` → `{ClubMyUnion:{union_id,union_name,union_quota,members[]}}` | 我的联盟页：池余额、盟主俱乐部列表 |
| `申请_加入_联盟` | 俱乐部创建者 | 无（等审批） | 输入 6 位联盟码申请 |
| `查询_联盟_加入申请` | 总群主 | `ClubUnionApply` → `{ClubUnionApply:[...]}` | 待审列表 |
| `同意_加入_联盟` / `拒绝_加入_联盟` | 总群主 | 无 | 审批按钮 |
| `授信_联盟_额度` | 总群主 | 无 | 给盟主俱乐部授信/收回，`quota_fen` 正负 |
| `增加_联盟_额度` | 平台 boss | 无 | **客户端不做入口** |
| `查询_联盟_额度` | 总群主 / 盟主 | `ClubUnionQuota` → `{union_id,union_quota,is_owner}` | 联盟池或本俱乐部额度展示 |
| `查询_俱乐部_红利` | 代理自己 / 群主 / boss / 代理查子树 | `ClubBonus` → `{bonus_fen,bonus}` | 代理红利余额 |
| `查询_俱乐部_红利_明细` | 群主看全俱乐部，代理看自己 | `ClubBonusList` | 红利明细分页 |
| `提取_俱乐部_红利` | 代理自己 | 无 | 整数元提取为俱乐部积分 |

### 2.2 同名替换

| 命令 | 变化 |
| --- | --- |
| `申请_加入_联盟` | 名字保留，参数从旧联盟 ID 改为 6 位联盟码，语义完全换新 |
| `查询_联盟_加入申请` | 名字保留，走新联盟实现 |

当前客户端没有这两条命令的调用，不存在兼容包袱。

### 2.3 停用命令与客户端调用点

| 停用命令 | 当前客户端调用点 | 现状后果 | 替代 |
| --- | --- | --- | --- |
| `查询_俱乐部_额度` | [panelMain.ts:3740](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3740) | 俱乐部列表额度永远不显示 | `查询_联盟_额度` |
| `查询_俱乐部_额度` | [ClubManagementApi.ts:216](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementApi.ts#L216) | 成员设置卡额度查询失败 | 改为俱乐部额度或删除 |
| `查询_俱乐部_额度` | [panelMessageChat.ts:1301](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L1301) | 聊天页上下分入口因「查不到额度」被隐藏 | 改为按身份判定 |
| `授信_俱乐部_额度` | [ClubManagementApi.ts:185](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementApi.ts#L185) | 成员设置里的「开通/增加/减少额度」全部失败 | `授信_联盟_额度`（联盟页） |
| `增加_俱乐部_额度` | [XuanManager/server/internal/api/clubs.go:945](file:///Volumes/SSD/qing/XuanManager/server/internal/api/clubs.go#L945) | 后台额度调整失效 | `增加_联盟_额度` 或新后台方案 |
| `查询_俱乐部_额度` | [XuanManager/server/internal/api/clubs.go:1019](file:///Volumes/SSD/qing/XuanManager/server/internal/api/clubs.go#L1019) | 后台回读校验失效 | `查询_联盟_额度` |
| `添加_联盟_成员` / `删除_联盟_成员` / `删除_联盟_加入申请` / `查询_俱乐部_联盟` | 客户端无调用 | 无直接影响 | 新联盟命令 |

### 2.4 代理开通/取消主动推送（新增文档）

来源：《俱乐部代理开通与取消推送方案》（2026-10-25 实施，2026-11-03 补入本目录）。

| 项 | 内容 |
| --- | --- |
| 触发 | `设置_俱乐部_代理`、`修改_俱乐部_代理_比例`、`取消_俱乐部_代理` 成功并完成邀请码分配后 |
| 路由 | `ClubAgentInfo`（**不是新路由**，与 `查询_俱乐部_代理_信息` 回包结构完全一致） |
| 报文 | `{"number":0,"count":1,"result":{club_id,user_id,user_name,is_creator,is_agent,invite_code,percent,upper_guuid,upper_name,downline_count,downline}}` |
| 客户端要求 | 收到即更新本人代理信息缓存并刷新界面；**判定「是不是代理」必须用 `is_agent`**，不能用 `upper_guuid` 是否为空（取消代理后 `upper_guuid` 仍保留） |
| 部署状态 | 文档写「已实施并上传测试服，待重启生效」；线上是否已生效需向服务端确认 |
| 对 V2 的影响 | 无协议冲突。V2 下代理身份变化会直接影响上下分/红利入口，因此这条推送比旧模型更关键 |

客户端现状：`panelMain.ts` 与 `panelExchangeStone.ts` 都已注册并解析 `ClubAgentInfo`，且都用 `is_agent` 判定代理，基础能力已具备（详见 §3.5）。

---

## 3. 客户端代码影响清单

### 3.1 panelMain.ts（大厅/俱乐部列表/创建）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [L230](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L230) | 注册 `GetClubQuota` 异步事件 | 保留事件名无意义；改注册 `ClubUnionQuota` / `ClubBonus` / `ClubMyUnion` 等新路由 |
| [L266-L269](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L266) | `role` 为 owner/manager/agent/member；`isLeader = agent.is_leader` | 保留 owner/manager/agent/member；**删除 isLeader 的盟主含义**，owner 即盟主 |
| [L3665-L3675](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3665) | 俱乐部卡片显示「额度：X」并按权限查询 | 代理不再有额度：卡片额度改为联盟额度（仅 owner 可见）或改为红利/留空 |
| [L3712-L3738](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3712) | `CanShowClubQuota` 依赖 `is_agent && is_granted`；`FormatClubQuota` 分转元 | 判定改为「是否总群主/盟主」，数据源改 `ClubUnionQuota` |
| [L3740-L3791](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3740) | `RequestClubQuota` / `OnClubQuota` 解析 `GetClubQuota` | 改为 `查询_联盟_额度` + `ClubUnionQuota`，注意 `is_owner` 区分池/俱乐部 |
| [L3845-L3852](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3845) | 列表行额度显示 | 同上 |
| [L3874](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3874) | 身份标签：老板 / `is_leader`→盟主 / 代理 | 改为：创建者→盟主（或产品确定叫「老板」）、其余代理→代理；不再看 `is_leader` |
| [L3918-L3942](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3918) | 创建费用提示读客户端 `ConfigManager` 价格 | 保留提示，但价格源需与服务端 `d_halls.create_club_stone` 对齐 |
| [L3944-L3995](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3944) | 创建成功后 `ChargeClubCreateFee()` 再发 `玩家_消费_命令` | **删除二次扣费**，只发 `创建_俱乐部`；保留余额预拦截 |
| [L4109-L4145](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L4109) | 处理消费回包、超时、退款 | 随二次扣费一起删除 |
| [L4007](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L4007) | `申请_加入_俱乐部` 用 6 位邀请码 | 不变（这是俱乐部邀请码，不是联盟码） |

### 3.2 ClubManagementApi.ts / ClubManagementView.ts（成员与代理管理）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [Api L185-L186](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementApi.ts#L185) | `grantQuota/increaseQuota/decreaseQuota` 全映射 `授信_俱乐部_额度` | 从成员维度移除；授信迁移到联盟页，对象是俱乐部 |
| [Api L216-L270](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementApi.ts#L216) | `getQuota` → `查询_俱乐部_额度`，解析 `GetClubQuota` | 删除或改造为 `查询_联盟_额度`；成员卡不再显示个人额度 |
| [Api L368](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementApi.ts#L368) | 成员行解析 `isLeader` | 字段可保留展示历史，但**不能再用它渲染「盟主」** |
| [View L199](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L199) | 我的卡片身份：老板 / isLeader→盟主 / 代理 | 创建者=盟主；其余代理=代理 |
| [View L214](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L214) | 「管理收益」仅 owner 可见 | 需新增代理入口；收益页改为红利口径 |
| [View L350-L354](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L350) | 打开 `panelMyHongli({club_id})` | 保留入口，页面内部改协议；代理也要能给入口 |
| [View L518](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L518) | 玩家设置卡按人查额度 | 删除个人额度展示与查询 |
| [View L548-L590](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L548) | `canUpDown` 依赖 `is_agent && is_granted` | 改为「操作者是否代理」；群主/盟主是否可上下分按服务端权限确认 |
| [View L708](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L708) | 行内身份：创建者 / 管理员 / isLeader→盟主 / 代理 | 同 L199 |
| [View L1133](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L1133) | `quota` / `quotaIncrease` / `quotaDecrease` 三种输入 | 从成员设置弹窗删除（Prefab 按钮同步下线） |
| [View L1246-L1248](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L1246) | 授信成功后重查额度 | 随授信功能一起删除 |

### 3.3 panelMessageChat.ts / panelClubGoldPad.ts（聊天页上下分与赠送）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [Chat L207-L208](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L207) | 注册 `GetClubQuota` | 改为新额度事件或删除 |
| [Chat L1243-L1297](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L1243) | 群主/盟主显示上下分；代理需 `quota_fen>0`；没额度显示「赠送」 | V2 下代理没有个人额度：改为「代理即显示上下分」，删除「无额度回退赠送」逻辑 |
| [Chat L1301-L1325](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L1301) | `RequestClubGoldQuota` 查个人额度 | 删除；如仍需展示俱乐部额度，改 `查询_联盟_额度` |
| [Chat L1327-L1395](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L1327) | 解析 `GetClubQuota` | 随查询一起删除或改路由 |
| [GoldPad L1-L20](file:///Volumes/SSD/qing/assets/scripts/UI/panelClubGoldPad.ts#L1) | 上下分走 `添加_俱乐部_成员_积分`，赠送走 `赠送_俱乐部_积分` | 协议本身仍有效；只需确认代理上下分不再依赖个人额度 |
| [GoldPad L190-L215](file:///Volumes/SSD/qing/assets/scripts/UI/panelClubGoldPad.ts#L190) | `give` / `up` / `down` 三种动作 | 保留；「赠送」可作为通用入口，不再作为「代理无额度」的兜底 |

### 3.4 panelMyHongli.ts / panelHongli.ts（红利）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [MyHongli L197-L204](file:///Volumes/SSD/qing/assets/scripts/UI/panelMyHongli.ts#L197) | 今日/昨日/明细走 `查询_俱乐部_代理_收益` | 改为 `查询_俱乐部_红利` / `查询_俱乐部_红利_明细` |
| [MyHongli L289-L309](file:///Volumes/SSD/qing/assets/scripts/UI/panelMyHongli.ts#L289) | 配对 `ClubAgentIncomeInfo` 串行推送 | 删除串行链；按 `ClubBonus` / `ClubBonusList` 重写 |
| [MyHongli L469-L470](file:///Volumes/SSD/qing/assets/scripts/UI/panelMyHongli.ts#L469) | 提取走 `提取_玩家_红利` | 改为 `提取_俱乐部_红利`，传 `extract_gold` 整数元 |
| [MyHongli 全文](file:///Volumes/SSD/qing/assets/scripts/UI/panelMyHongli.ts) | 顶部注释、字段、兜底逻辑都基于旧收益接口 | 重写俱乐部模式；平台模式（无 club_id）是否保留需产品确认 |
| [panelHongli.ts:429](file:///Volumes/SSD/qing/assets/scripts/UI/panelHongli.ts#L429) | 平台红利页跳 `panelMyHongli` | 若保留平台红利，需与俱乐部红利明确区分入口 |

### 3.5 ClubAgentInfo 主动推送（代理开通/改比例/取消）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [panelMain.ts:229](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L229) | 已注册 `ClubAgentInfo` 推送 | 无需改路由 |
| [panelMain.ts:3528-L3582](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3528) | 推送后刷新俱乐部列表、发现页资金、管理页、红点、推广邀请码；`is_agent=0` 时还会补查两次 | 逻辑可复用；V2 下需确认补查的 `查询_俱乐部_代理_信息` 仍有效（未列入停用） |
| [panelMain.ts:3509-L3525](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3509) | 代理判定优先 `is_agent`，缺失才退回邀请码 | 符合推送文档要求，保留 |
| [panelExchangeStone.ts:68](file:///Volumes/SSD/qing/assets/scripts/UI/panelExchangeStone.ts#L68) | 兑换页已注册该推送 | 无需改 |
| [panelExchangeStone.ts:381-L405](file:///Volumes/SSD/qing/assets/scripts/UI/panelExchangeStone.ts#L381) | 收到后更新 `agentInfo` 并刷新角色/上级 | 无需改 |
| [ClubManagementView.ts:437](file:///Volumes/SSD/qing/assets/scripts/UI/ClubManagementView.ts#L437) | 成员行优先用 `is_agent` | 符合要求，保留 |
| [panelMessageChat.ts:329](file:///Volumes/SSD/qing/assets/scripts/UI/panelMessageChat.ts#L329) | 聊天页角色来自打开时的 `strUserData`，没有监听 `ClubAgentInfo` | 若玩家在聊天中被告知开通/取消代理，上下分/赠送入口会停留在旧状态；建议监听推送并重算按钮，或退出重进 |
| DirectChat 会话角色 | 角色存在会话快照里 | 推送后可能短时显示旧身份；至少要在打开会话时按最新 `is_agent` 重算 |

### 3.6 角色名与私聊

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [DirectChatManager.ts:161-L169](file:///Volumes/SSD/qing/assets/scripts/logic/DirectChatManager.ts#L161) | role: owner→群主、leader→盟主、agent→代理 | 按 V2：owner→盟主（或群主，产品定名）、代理→代理；删除 leader 的盟主含义 |
| [DirectChatManager.ts:176-L180](file:///Volumes/SSD/qing/assets/scripts/logic/DirectChatManager.ts#L176) | 群主/盟主/代理可删除（隐藏）会话 | 角色集合按新命名调整，权限本身是否保留需服务端确认 |

### 3.7 panelGameView.ts（带入失败文案）

| 位置 | 现状 | 需要做什么 |
| --- | --- | --- |
| [L2029-L2030](file:///Volumes/SSD/qing/assets/scripts/UI/panelGameView.ts#L2029) | 识别「俱乐部额度不足」「该俱乐部额度不足」 | 保留；可补「或联系总群主加入联盟」 |
| [L2212](file:///Volumes/SSD/qing/assets/scripts/UI/panelGameView.ts#L2212) | 统一提示「俱乐部金币不足或额度不足！」 | 按 V2 客户端改造清单第 12 条，补一句未入盟提示 |

### 3.8 Prefab

- 成员设置弹窗需删除「开通额度 / 增加额度 / 减少额度」相关按钮与数值控件（运行时代码已按名字绑定，见 ClubManagementView L254-L261）。
- 俱乐部管理页需新增「创建联盟 / 加入联盟 / 我的联盟 / 入盟审批」入口；具体排版需按 `design-previews/效果图V8-new/` 定稿另行设计，不能运行时批量造节点。
- 俱乐部列表卡片额度行是否保留、改显示什么，需产品确认后改 Prefab，而不是仅靠脚本隐藏。

---

## 4. 需要新增的界面/入口

| # | 页面/入口 | 可见角色 | 命令/推送 | 关键点 |
| --- | --- | --- | --- | --- |
| 1 | 创建联盟 | 俱乐部创建者 | `创建_联盟` → `ClubUnionCreate` | 弹名字输入；成功后展示 6 位联盟码；一个账号只能建一个联盟 |
| 2 | 加入联盟 | 俱乐部创建者 | `申请_加入_联盟` | 输入 6 位联盟码；已申请/已有联盟时置灰；错误文案按 §14 |
| 3 | 我的联盟 | 总群主 | `查询_我的_联盟` → `ClubMyUnion` | 联盟名、联盟码、池余额（分→元）、成员俱乐部及各自额度 |
| 4 | 入盟审批 | 总群主 | `查询_联盟_加入申请` → `ClubUnionApply`；`同意/拒绝_加入_联盟` | 列表 + 同意/拒绝两个按钮 |
| 5 | 联盟授信 | 总群主 | `授信_联盟_额度` | 输入**元**，前端 ×100 传 `quota_fen`；支持负数收回；可授信给自己俱乐部 |
| 6 | 联盟额度展示 | 总群主 / 盟主 | `查询_联盟_额度` → `ClubUnionQuota` | `is_owner=1` 看池，`0` 看本俱乐部；分→元 |
| 7 | 代理红利 | 代理 / 群主 | `查询_俱乐部_红利` → `ClubBonus`；`查询_俱乐部_红利_明细` → `ClubBonusList` | 余额 + 明细分页；`bonus` 为分 |
| 8 | 提取红利 | 代理自己 | `提取_俱乐部_红利` | 整数元、≥1；不足 1 元留在账上；提取后进俱乐部积分 |

**推送报文形状注意**：

- `ClubUnionCreate`、`ClubUnionQuota`、`ClubBonus` 是扁平对象；
- `ClubMyUnion`、`ClubUnionApply`、`ClubBonusList` 外包一层同名 key；
- 现有客户端已有兼容「同名包装 / result 包装 / JSON 字符串」的解析习惯，新代码应沿用，避免环境差异。

---

## 5. 需要修改的现有流程

### 5.1 创建俱乐部

1. 保留余额预拦截与「消耗 N 钻」提示。
2. **删除**创建成功后的 `玩家_消费_命令`（[panelMain.ts:3979](file:///Volumes/SSD/qing/assets/scripts/UI/panelMain.ts#L3979)），否则重复扣费。
3. 创建失败（取号/落库）服务端自动退回，流水 `创建俱乐部-退回`；客户端刷新 `stone` 即可。
4. 价格源确认：客户端 `ConfigManager` 的「创建俱乐部」价格必须与服务端 `d_halls.create_club_stone` 一致；否则提示金额会骗玩家。

### 5.2 俱乐部列表卡片

- 代理不再有个人额度，卡片上的「额度：X」对代理无意义，应删除或改显示俱乐部联盟额度。
- 只有总群主/盟主能看 `ClubUnionQuota`；普通代理/成员不应发额度查询。
- 授权状态（`is_granted`）概念消失，相关文案全部删除。

### 5.3 成员设置（玩家资料卡）

- 删除「开通额度 / 增加额度 / 减少额度」三个操作与个人额度数值。
- 保留设代理、比例、备注、踢人、赠送、上下分。
- 上下分入口：从「已授信代理」改为「代理」；普通成员仍可用自己的积分赠送/上分（按服务端权限）。
- 群主/盟主给成员上下分时，资金来源是俱乐部额度；客户端可在确认框文案中体现「从俱乐部额度出」。

### 5.4 聊天页

- 群主/盟主：保留上下分入口。
- 代理：不再查个人额度，直接显示上下分；删除「无额度回退赠送」。
- 赠送入口：可对所有同俱乐部成员开放（服务端已恒放行），是否继续屏蔽群主/盟主由产品决定。
- 交易密码流程不变。
- 身份变化：收到 `ClubAgentInfo` 推送后要重算上下分/赠送入口；目前聊天页只在打开时读一次角色，需补推送监听或重新进入。

### 5.5 我的红利

- 俱乐部模式改为代理红利三命令；提取改为整数元、进俱乐部积分。
- 今日/昨日统计在 V2 文档中没有直接对应字段；`ClubBonusList` 可按日期聚合，或由服务端补 summary（待确认）。
- 平台红利（无 `club_id`）是否继续保留，需要产品确认；若保留，与俱乐部红利要有清晰入口区分。

---

## 6. 后台 XuanManager 影响

| 位置 | 现状 | 影响 |
| --- | --- | --- |
| [clubs.go:945](file:///Volumes/SSD/qing/XuanManager/server/internal/api/clubs.go#L945) | 调 `增加_俱乐部_额度` 调整俱乐部额度 | 命令停用，功能失效 |
| [clubs.go:1019](file:///Volumes/SSD/qing/XuanManager/server/internal/api/clubs.go#L1019) | 调 `查询_俱乐部_额度` 回读校验 | 命令停用，回读失败 |
| [README.md:31](file:///Volumes/SSD/qing/XuanManager/README.md#L31) | 文档写「按 `club_agent_info.quota` 调整」 | 模型已变，需改文档与代码 |

**能力缺口**：V2 只给 boss 开放 `增加_联盟_额度`（给联盟池注资），没有「boss 直接给某个俱乐部加额度」的命令；给俱乐部授信需要总群主身份调 `授信_联盟_额度`。后台若仍要按俱乐部调额度，需要服务端补 boss 通道，或后台改为「给该俱乐部所属联盟注资 + 以总群主身份授信」两步操作。这是本次最需要产品/服务端拍板的点之一。

---

## 7. 文档冲突与待确认问题

### 7.1 文档内部冲突

1. **上下分权限表未更新**：《俱乐部积分与额度方案》§8 仍写「群主用自己额度、已授信代理用额度、未授信代理用自己积分」，而 V2 §11 写「代理上分不扣自己积分（钱从俱乐部额度出）；非代理上分扣自己积分」。该文档 2026-11-03 新增的头部已声明「额度授信/额度回补/抽水回补段落仅作历史参考」，但正文未改，实施仍以 V2 §11 为准；需确认 V2 下是否**所有代理**都按俱乐部额度上分。
2. **赠送限制未更新**：§8.3 仍要求「同一授信代理」，V2 §11 写 `CanGiveClubGold` 恒放行。该节同属文档头部声明的历史段落，客户端应按 V2 执行，但需服务端确认线上实现已切换。
3. **盟主文档正文与头部矛盾**：头部声明「盟主=创建者，`is_leader` 不再判定」，正文仍按 `is_leader` 描述盟主权限与可见范围。实施前需服务端确认最终口径。
4. **旧联盟文档正文仍完整**：《俱乐部与联盟功能》头部声明旧联盟下线，但 §3 仍保留旧联盟接口描述，容易被后续开发者误接。建议标注或删除正文。
5. **旧收益接口状态不明**：`查询_俱乐部_代理_收益` / `ClubAgentIncomeInfo` 未列入停用清单，V2 也不再提；需确认是否继续维护。
6. **额度流水是否仍适用**：`查询_俱乐部_额度流水` / `ClubQuotaWater` 在旧模型下是代理额度流水；V2 后联盟池/俱乐部额度流水的查询入口未在 V2 文档中说明。
7. **代理推送文档的生效状态**：《俱乐部代理开通与取消推送方案》写于 2026-10-25，状态为「已上传测试服，待重启生效」；本次补入目录不代表线上已重启生效，需服务端确认测试服/正式服实际状态。
8. **邀请码文档的命令名更正**：把误写的 `添加_俱乐部_玩家_积分` 改为 `添加_俱乐部_成员_积分`，属文档笔误修正，对客户端无影响。

### 7.2 协议/产品缺口

1. **没有退盟/解散联盟/踢出俱乐部/取消入盟申请/转让总群主**命令；入盟后如何退出未定义。
2. **一个账号拥有多个俱乐部时**，`创建_联盟` 的 `club_id` 用哪一家、联盟与账号还是与俱乐部绑定，文档只写「一个账号只能建一个联盟」。
3. **总群主自己的俱乐部额度**：建盟后自动绑定且额度为 0，需自己给自己授信；客户端「我的联盟」是否要突出这个操作。
4. **代理红利提取到哪个俱乐部积分**：`club_id` 指定，但代理在多个俱乐部时入口归属需明确。
5. **联盟码与俱乐部邀请码都是 6 位**：UI 文案必须区分，避免玩家把邀请码当联盟码输入。
6. **带入失败原因不透明**：服务端日志区分「未入盟」与「额度不足」，客户端文案统一；是否需要在俱乐部页给出「未入盟」状态提示。
7. **代理红利的今日/昨日统计**：`ClubBonusList` 有 `date`，可本地聚合，但分页/时区口径需确认。
8. **`ClubMyUnion.members` 只含俱乐部层级**，不含代理与红利；若「我的联盟」要展示代理数/总红利，需要服务端补字段。

---

## 8. 建议实施顺序

### P0：先修硬故障（不依赖新 UI）

1. 删除创建俱乐部二次扣费，保留预拦截（panelMain）。
2. 全量替换/删除 3 个停用额度命令的调用点（panelMain / ClubManagementApi / ClubManagementView / panelMessageChat）。
3. 上下分入口判定从「已授信代理」改为「代理」；删除个人额度查询与展示。
4. 盟主标签改为创建者；`is_leader` 不再渲染「盟主」；私聊角色名同步。
5. 后台 XuanManager 切换命令或临时下线额度调整入口。

### P1：联盟主链路

6. 俱乐部管理页新增「创建联盟 / 加入联盟」入口。
7. 创建联盟、联盟码展示。
8. 加入联盟（6 位码）与已申请置灰。
9. 我的联盟（池余额、成员俱乐部额度）。
10. 入盟审批（列表、同意、拒绝）。
11. 联盟授信（元→分，正负）与联盟额度查询。

### P2：代理红利与文案

12. 代理红利余额、明细分页、整数元提取。
13. 带入失败提示补「未入盟」引导。
14. 清理旧额度文案、`is_granted`、`is_leader=盟主` 等残留。
15. `ClubAgentInfo` 推送联动：聊天页/私聊角色随开通、改比例、取消代理即时刷新；确认判定只用 `is_agent`。

### P3：验收与后台

15. XuanManager 额度调整改版（依赖服务端 boss 通道决策）。
16. 全链路联调与文档回写。

---

## 9. 验收清单

- [ ] 全局搜索不再出现 `查询_俱乐部_额度` / `授信_俱乐部_额度` / `增加_俱乐部_额度`（客户端与后台）。
- [ ] 创建俱乐部只扣一次钻；失败自动退回后余额正确。
- [ ] 建盟 → 拿到联盟码 → 另一俱乐部申请 → 总群主同意 → 双方额度可见。
- [ ] 总群主授信正数/负数，池与俱乐部额度同步变化；余额不足时整笔失败。
- [ ] 盟主/总群主看到的额度单位正确（分→元）。
- [ ] 未入盟俱乐部带入被拒，提示包含「或联系总群主加入联盟」。
- [ ] 代理上下分不再依赖个人额度；无额度显示不再出现。
- [ ] 代理红利余额、明细、提取正确；不足 1 元不可提。
- [ ] 身份标签：创建者显示为盟主/老板（按最终产品定名），直属代理不再显示盟主。
- [ ] 私聊角色名与身份标签一致。
- [ ] XuanManager 额度调整可用，或明确下线并给运营替代流程。
- [ ] 所有新推送路由在断线重连、切号、切俱乐部后不串数据。
- [ ] 开通/改比例/取消代理后，目标玩家立即收到 `ClubAgentInfo`；`is_agent=0` 时入口收起，`upper_guuid` 残留不影响判定。
- [ ] 玩家停在聊天页时被开通/取消代理，上下分/赠送入口能即时更新（或明确要求重进生效）。

---

## 10. 本次未做的事

- 未修改任何客户端代码、Prefab、场景或后台代码。
- 未执行构建、未部署、未做真机/线上验证。
- 新增联盟页面的视觉稿未开始，需按 `design-previews/效果图V8-new/` 另行设计。
