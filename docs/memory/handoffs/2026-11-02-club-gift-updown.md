# 2026-11-02 玩家设置「赠送」改口径 + 新增「上下分」（复用私聊上下分弹窗）

分支：`codex/club-ui`（俱乐部线，勿合 main）。状态：代码与 Prefab 已落盘；**未构建、未真机、未连真实服务器验证**。

## 目标

1. 成员设置弹窗的「赠送」之前走的是 `添加_俱乐部_成员_积分`（代理按授信额度发筹码的“上下分”口径），等于白送不扣自己 → 要求改走真正的赠送接口。
2. 「赠送」下面再加一个「上下分」按钮，美术与赠送一致。
3. 上下分按钮只给**有额度的代理**看。
4. 赠送/上下分成功后要弹提示，并刷新弹窗里的积分与成员列表（原来完全不刷新）。
5. （第二轮补充）点「上下分」**直接弹出私聊里的上下分界面并复用**，不另做弹窗。

## 改动

### `assets/scripts/UI/panelClubGoldPad.ts`（私聊上下分弹窗，被复用）

- 新增 `entry:"chat"|"settings"`（从 `strUserData.entry` 读，缺省 `chat`）。
- `entry=settings` 时成功后：关闭弹窗 + `panelMsgView` 弹「上分/下分成功！积分已更新」，**不**发 `ClubGoldNotice`（不往聊天会话插系统通报条）；`chat` 行为完全不变。
- `ClubGoldGiftChanged` 补上被操作人：`(clubId, userId)`，让大厅能定位到要刷新的成员。

### `assets/scripts/UI/panelGivePad.ts`

- 俱乐部分支固定走 **`赠送_俱乐部_积分`**（原先错用 `添加_俱乐部_成员_积分`）；context 改 `givepad:give:<clubId>:<userId>:<ts>`（不带 `club:` 前缀，避免被 `panelMain.HandleClubHallCommand` / 聊天页的 context 排除逻辑误吃）。
- 回包优先按 context 配对，旧服不带 context 时退回命令名；成功弹「赠送成功！积分已更新」并 `ClubGoldGiftChanged(clubId, userId)`。
- 无 `clubId` 的旧路径（无俱乐部时的大厅通用转账）不变。

### `assets/scripts/UI/ClubManagementView.ts`

- `gift` 回调签名扩成 `(player, mode:"give"|"updown")`。
- 新增 `canUpDown()` / `requestMyQuota()` / `syncUpDownButton()`：查自己 `查询_俱乐部_额度`，`is_agent && is_granted` 才显示「玩家设置上下分」；20s TTL 缓存，换俱乐部/换账号时清空。
- 新增 `OnPlayerGoldChanged(userId)`：列表或设置卡任一打开时重取当前页（`load`），用新数据就地更新设置卡的积分/备注/比例并重查该玩家额度；1.5s 后再补一次，避免服务端记账晚于回包。
- `render()` 保存 `this.items`，供上面就地刷新使用。
- **自己那一行可点开**：去掉 `openPlayerSettings` 里的 self 早退；`canManageTarget = !isSelf` 收起「调整比例/代理开关」，`refreshPlayerQuotaUi` 对 self 不显示「开通额度」，`syncSelfActions()` 在页签切换后统一再收一次（`settingsMemberNodes` 会把它们重新激活）。老板那一行不开上下分。
- **点击热区**：`playerHotzone(row)` 取行内透明节点「玩家热区」，取不到退回「头像」；`render()` 与 `renderDownline()` 都改绑它，self 行不再跳过绑定。

### `assets/scripts/UI/panelMain.ts`

- 成员设置回调按 mode 分流：`give` → `panelGivePad`（Cover）；`updown` → **`panelClubGoldPad`（Top）**，参数 `{clubId,userId,userName,mode:"updown",entry:"settings"}`。
- `OnClubGoldGiftChanged(clubId, userId?)` 追加：`set_gold(0)`、`RefreshDiscoveryClubFunds(true)`（顺带重查自己的额度）、`clubManagement.OnPlayerGoldChanged(userId)`。

### `assets/resources/UI/panelMain.prefab`

- `/俱乐部玩家设置弹窗/面板` 下新增节点 `玩家设置上下分`（3925），位置 (206, 366)，尺寸 170×58，`_active:false`，Sprite 复用 `assets/V7/original_dialog_button_gold.png`（`d2c5f3e1-1e18-4d4f-a2d0-2d0013d20402`），子节点 `文字` 为 Label「上下分」。
- 该槽位原来是常驻隐藏的 `玩家设置踢出俱乐部`（代码恒 `active=false`），两者永不共存。
- 两个行模板各追加透明点击层 `玩家热区`（3932 / 3935，各带一个 `cc.Button`，`transition=0`、无 Sprite、`_N$target=null`），都是**最后一个子节点**（触摸优先命中），且右边界（110 / 100）与「对话」按钮（左边缘 185 / 153）不重叠；工程里已有 141 个「只有 Button 没有 Sprite」的节点，属既有可用写法。
- 手改要点：**只拼文本块插到数组尾部再改 `_children` 引用**。整文件 `json.dump(indent=2)` 会把 JS 的 `1e-7` 写成 `1e-07` 等 8 处浮点格式，产生 14 万行 diff。
- `library/imports/d0/d0921080-...json` 已随 Creator 重新导入更新。

## 已验证

- 四个脚本 `ts.transpileModule` 0 诊断；带 `creator.d.ts` 的定向 `tsc` 检查，目标文件仅剩既有的 `require` / `cc.RawAsset` / `QRCode` 环境报错，无新增。
- Prefab：JSON 可解析、`__id__` 引用完整、父子关系正确、`fileId` 无新增重复（原本已有 31 组重复）。
- Creator 已重编译（`temp/quick-scripts/.../UI/*.js` 2026-11-02 21:23）并重新导入 prefab，产物含 `entry` 与新分支。

## 待验证 / 遗留

- 真实服务器：`赠送_俱乐部_积分` 与 `添加_俱乐部_成员_积分` 的 0x200/0x500 语义、`查询_俱乐部_额度` 查自己（传自己 `user_id`）的回包字段、上下分下分（负数）的额度校验。
- 成员列表刷新时机：若 0x500 只是“受理”，依赖 1.5s 的补偿刷新。
- 未构建、未真机。
