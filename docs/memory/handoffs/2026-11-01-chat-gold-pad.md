# 私聊「上下分」入口与弹窗

日期：2026-11-01（同一任务三轮：初版 → 美术与布局重做 → 输入框/二次确认/美术字）
目录：`/Volumes/SSD/qing`
分支：`codex/club-ui`
状态：代码、Prefab、美术均已改完；**未在 Creator 导入预览、未构建、未真机验收**

## 目标

俱乐部 1 对 1 聊天页按操作者权限显示「上下分」入口，点击打开弹窗，对当前聊天玩家做俱乐部积分上分/下分。

- 权限：`owner` / `leader` 直接显示；`agent` 需 `查询_俱乐部_额度` 返回 `is_agent=1 && is_granted=1 && quota_fen>0`。普通成员、未授信、额度为 0 隐藏，最终由大厅服务端校验。
- 请求：上分/下分**统一走 `添加_俱乐部_成员_积分`**，`user_add_gold` 上分为正、下分为负；带 `club_id / user_id / user_pwd / context`，成功触发 `ClubGoldGiftChanged`。`修改_俱乐部_成员_积分` 服务端有问题，本弹窗不再使用。
- 未设置交易密码时引导初始化（`OpenInitTransactionPassword`）。

## 最终实现

### 入口 `panelMessageChat.ts/.prefab`

- `上下分` 节点保留原名字（脚本 `Tool.GetChild(this.node,"上下分")` 依赖），默认隐藏。
- 底部三按钮统一 Widget：拍照上传 `BOT|LEFT left=101`、发送图片 `BOT|CENTER`、上下分 `BOT|RIGHT right=101`，`bottom` 都是 76。
  之前上下分没有 Widget，留在设计坐标 `(220,-557)`，长屏会压到「发送」按钮上。

### 弹窗 `panelClubGoldPad.ts/.prefab`

- 面板 634×870，`bk` 用 `Widget(MID|CENTER)`，关闭按钮 `TOP|RIGHT`。分区：标题 → 玩家 → 数额 → 交易密码 → 快捷金额 3×3 → 上下分按钮。
- 脚本契约节点名保持不变：`bk/目标`、`bk/提示`、`bk/金额`、`bk/密码`、`上分`、`下分`、`关闭`、`金额_100…金额_50000`。
- **二次确认**：`Submit` 校验通过后进 `ConfirmThenSubmit`，弹 `panelMsgView`（`ShowPanelMode.Top`，`arrayEx[0]` 传回调即变确定/取消双按钮），文案「确认给「名字」上分 100 金币？」，确定后才 `DoSubmit` 发请求。回调里再判 `cc.isValid` 与 `pending`，防重复提交。
- 金额输入 `inputFlag=5`（DEFAULT）、交易密码 `inputFlag=0`（PASSWORD），`inputMode` 都是 2（NUMERIC）。

### 美术 `assets/ImagesLuck/上下分/` + `assets/ImagesLuck/聊天/上下分.png`

- 入口图标 128×128：**直接复用 `拍照上传.png` 的底框像素**（填掉中央相机后重画铜钱 + 上下双箭头），与同排图标逐像素同款。
- 弹窗素材 2× 出图：`gd_panel`(1268×1732)、`gd_input`、`gd_chip`、`gd_btn_gold`、`gd_btn_line`、`gd_close`、`gd_divider`、`gd_bar`、`gd_lock`、`gd_avatar_ring`。
- 美术字 2×：`gd_txt_title`(340×140)、`gd_txt_up`(158×93)、`gd_txt_down`(164×98)。Prefab 里「标题」「上分/下分 的文字」是 Sprite，节点尺寸 = 贴图 / 2。
- 体积：面板 98 KB（原 `give_pad_approved_panel.png` 1.2 MB），其余 0.2–5 KB，入口图标 10 KB（原 14.8 KB）。

### 工具（新增，可复现）

| 脚本 | 作用 |
|---|---|
| `tools/gen_chat_gold_pad_art.py` | 画全部 PNG（含 `.meta` 用的尺寸），纯几何绘制，不走 AI 生图 |
| `tools/apply_chat_gold_pad_layout.py` | 生成 `.meta`（`trimType:none`、固定 uuid）+ 重建 `panelClubGoldPad.prefab` + patch 聊天页三按钮 |
| `tools/preview_chat_gold_pad.py` | 读 prefab 离线渲染设计稿，出图到 `design-previews/待确认/2026-11-01-私聊上下分/` |

## 三轮演进与踩坑

| 轮次 | 现象 | 结论 |
|---|---|---|
| 初版 | 沿用 V7 赠送弹窗资源，弹窗 `bk` 里堆了 12 个孤儿节点（残留贴图、重复饰线、`名字垫底 copy`、头像、`V8确定赠送文字`） | 标题贴图与 Label 叠字、快捷金额与旧金额贴图重影、两个「确定发送」重合；`anchor(0,0.5)` 从面板中心向右排导致「操作玩家」「提示」溢出屏幕 |
| 初版 | 入口图标是 `小金币.png`(24×24) 拉到 108×108 | 糊成一团；背景透明，和「拍照上传/发送图片」的深蓝金框完全不同款 |
| 二轮 | 九宫格 + 2× 贴图 | **圆角被压扁**：引擎把 inset 同时当节点单位和纹理像素，`xScale=min(1,nodeW/(l+r))`。固定尺寸控件一律 SIMPLE + CUSTOM，2× 贴图等比缩到节点才对 |
| 二轮 | 手写 prefab 的 `fileId` | `base64(md5[:18])` 里 md5 只有 16 字节 → 变成 24 字符带 `==`；Cocos 要 24 字符无填充，改用 `sha1[:18]` |
| 三轮 | 输入框提示/输入文字跑到框外 | **Cocos EditBox 不排版 textLabel/placeholderLabel**（`_updateLabels` 只切 active）。必须挂 `Widget(45 全拉伸)` + `anchor(0,1)` + `left18/right8/top4/bottom4`，垂直居中靠 `Label.verticalAlign=CENTER` |
| 三轮 | 数额框输入后变 ●●● | `cc.EditBox.InputFlag` 是 **PASSWORD=0、DEFAULT=5**（顺序反直觉）。两个框都写 0 就会掩码 |
| 三轮 | 上分/下分点一下就发请求 | 资金操作要二次确认，见上文 |
| 三轮 | 标题/按钮文字太素 | PingFF 只有常规字重，用**同色 stroke 顶字重**（`bold` 参数）+ 金属渐变 + 顶部高光带 + 描边 + 投影；中文标题不走 imagegen（笔画会碎，已验证不可用） |

## 验证

- Prefab 引用完整性：`__id__` 越界 0、父子不一致 0、`fileId` 46 个唯一且 24 字符无 `=`。
- `panelClubGoldPad.ts` 走 TypeScript `transpileModule` 0 诊断。
- 静态核对：金额 `inputFlag=5` / 密码 `0`；两个 EditBox 子 Label 都有 `Widget(45)`；标题与按钮是 Sprite 且尺寸 = 贴图/2。
- `docs/memory/check_memory.py check` 0 错误（CURRENT.md 超建议预算属历史遗留）。

## 未完成 / 风险

- **未在 Cocos Creator 2.4.13 里打开**：新 PNG 需 Creator 导入、`library/` 需重建，prefab 是否被编辑器认可是首次打开才知道。
- 新 `.meta` 是脚本手写的（uuid 固定派生）。若被 Creator 覆盖，prefab 里的 spriteFrame uuid 会失效，重跑 `apply_chat_gold_pad_layout.py` 即可。
- 未构建、未热更、未真机。重点待验：键盘弹出时弹窗是否被顶出屏幕；`panelMsgView` 确认框会不会盖住或顶开上分弹窗；确认后金额与密码是否仍是当时的值；`bottom=76` 与 home indicator 的关系；小屏 750×1334 与长屏 750×1624 下三按钮行距。
- 弹窗没有头像（原 `give_pad_approved_avatar_ring` 已不用），玩家区只有「操作玩家 + 名字」两行；要加头像需另接头像接口。

## 第四轮：上下分成功的系统消息条

需求：上下分/下分成功后，在聊天列表插一行特殊底图的通报，形如
`2026-11-01 21:05:31` + `玩家 XXX 上分 100 成功，积分 1000 → 1100`。

### 实现

- **美术** `assets/ImagesLuck/聊天/系统消息底.png`（1240×208 = 620×104@2x）：深蓝渐变底 + 暗金描边 +
  左侧金色竖条，居中通栏，和左右聊天气泡（`消息左/右气泡`）明显区分。由
  `tools/gen_chat_gold_pad_art.py` 的 `system_notice()` 生成。
- **Prefab**：`panelMessageChat.prefab` 的 `列表/view/content` 下新增模板节点 `消息-系统`
  （620×104，默认 `active=false`），子节点 `时间`（fs20 金色）+ `内容`（fs24 白色居中）。
  由 `apply_chat_gold_pad_layout.py` 的 `ensure_system_template()` 幂等生成/更新。
- **脚本** `panelMessageChat.ts`：
  - 节点池扩成四类（`divider/left/right/system`），`BubbleUnit` 加 `systemTime/systemText`；
  - `Render()` 遇到 `messageType === "system"` 走独立分支：**不插「今天/昨天」分隔条**
    （通报条自带完整年月日时分秒），按自身 620 宽居中、**不跟整行拉伸**（否则底图变形），
    排布时上下各留 7px；
  - `OnClubGoldNotice()` 监听 `ClubGoldNotice` 事件，构造 `DirectMessage`（`messageType:"system"`，
    带 `systemTime`），push 后按 `IsNearBottom(120)` 决定是否跟到底部。
- **脚本** `panelClubGoldPad.ts`：成功时不再弹 `panelMsgView` 提示框，改为 fire `ClubGoldNotice`
  （带 `clubId/userName/action/amount/balance`）后关窗；`DoSubmit` 记录 `submitAmount` 供回包使用。

### 「积分从 X 变成 Y」的数据来源（重要）

客户端只有**成功回包**这一个来源：`BalanceFrom()` 兼容 `club_gold / user_gold / after_gold /
left_gold / gold / score / balance`（先看 `result` 再看顶层）。**拿不到就不拼这段**，
不会用本地计算值硬凑，避免显示错误的余额。

也就是说：如果服务端 `添加_俱乐部_成员_积分` 的成功回包不带变更后积分，系统消息只会显示
`玩家 XXX 上分 100 成功`。要稳定显示「从多少变成多少」，需要服务端在 `0x200/0x500` 的
`result` 里回 `club_gold`（或在客户端加一次 `查询_俱乐部_成员` 的前置查询）。

### 第五轮：改成真正的服务端消息（可持久化）

第一版只在本地 push 一条伪消息，重进聊天就没了。现在和文字/图片/语音一样走 `/api/direct`：

- **服务端** `ChatTool/server/internal/directchat`：原来 `MessageTypeSystem` 一律拒绝
  （`客户端不能发送系统消息`）。现在放开但加两道闸：
  `CanSendSystemNotice(role)`（只 owner/leader/agent）+ 正则 `systemNoticePattern`
  （`^玩家 .{1,40} (上分|下分) [1-9]\d{0,11} 成功(，积分 \d{1,15} → \d{1,15})?$`）。
  两道都过才写入，避免客户端拿它发任意“系统公告”。**数据库 `message_type` ENUM 早已含 `system`，无需迁移**。
- **客户端** `DirectChatManager.SendSystemNotice()`；聊天页 `OnClubGoldNotice` 里发，
  成功后服务端实时推送 → `AppendToTail` 重绘并自动跟到底部（和普通消息同一套滚动逻辑）。
- 服务端拒绝或断网时 `catch` 里降级成本地插入一条（`MakeLocalNotice`，id `sys-<时间戳>`），不落库。
- 时间显示：服务端只回 `createdAt`，`Render` 用 `DirectChatTime.FormatFull()` 兜底成
  `YYYY-MM-DD HH:MM:SS`；本地降级消息自带 `systemTime`。
- 服务端新增用例 `TestSystemNoticeRequiresManagerRoleAndFixedText`（leader 可发、自由文本拒绝、
  普通成员拒绝）；`go test ./...` 全绿。

## 服务端部署记录（system 消息）

- 构建：`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" ./cmd/chattool`，
  sha256 `9f048429e1cc63139a47efc29e62e0a0880cee3145d15bb11bebf32ee5c320ce`。
- 部署：`scp` 到 `/www/html/.chattool/bin/chattool.new-system-notice` → 备份当前
  `bin/chattool.previous-system-notice-20261101-2125`（`d20e5c64…`）→ `stop.sh` → `mv` → `start.sh`。
- 验证：`/proc/<pid>/exe` 与磁盘二进制哈希一致 `9f0484…`；`127.0.0.1:8893/api/health` 与
  公网 `http://154.37.155.17/chattool/api/health` 均 `{"service":"ChatTool","status":"ok"}`；
  进程 PID 19759 restarted 后 7 秒。
- **回滚**：`cp bin/chattool.previous-system-notice-20261101-2125 bin/chattool && deploy/centos7-user/stop.sh && start.sh`。
- 客户端（Cocos）**未构建、未热更**：`build/jsb-link` 与 `build/web-mobile` 仍是 2026-10-29 的旧产物。

## 第六轮：聊天页「赠送积分」入口

需求：代理但没有可用额度时，对普通玩家显示「赠送积分」，点开是赠送弹窗，赠送成功后同样留一条系统消息。

### 入口与权限

- `panelMessageChat.prefab` 底部改为**四按钮**：拍照上传 `BOT|LEFT left=64`、发送图片 `BOT|CENTER hcenter=-86`、
  赠送积分 `BOT|CENTER hcenter=85`、上下分 `BOT|RIGHT right=64`，`bottom` 都是 76，四列等距。
- 「赠送积分」由 `apply_chat_gold_pad_layout.py` **克隆「上下分」整套节点**生成（同尺寸、同 Button、同文字节点），
  只换图与文案，幂等（已存在就跳过）。
- 显示条件（`RefreshClubGoldButton`）：`role === "agent" && 无可用额度 && 对方可以收赠`，其中
  「无可用额度」= `!is_granted || quota_fen <= 0`，「对方可以收赠」= `peer.role` 为 `member`/`manager`/`agent`/空
  （2026-11-01 第四轮追加 `agent`：下级代理也要能收赠；群主 `owner`、盟主 `leader` 仍不显示）。
  owner/leader 和「有额度的代理」仍然只看到「上下分」，两者互斥。

### 弹窗 give 模式

`panelClubGoldPad` 加 `mode: "updown" | "give"`（聊天页通过 `strUserData.mode` 传）：

- 标题换 `标题-赠送`（`gd_txt_give.png`，美术字「赠送积分」），隐藏「上下分」标题；
- 按钮换成单个居中的「确认赠送」（`gd_txt_give_btn.png`），隐藏「上分 / 下分」；
- 提示改为「赠送消耗的是你自己的积分，请确认金额与交易密码」；
- 二次确认文案：「确认赠送给「X」100 金币？这会从你自己的积分里扣」。

**请求必须走赠送专用命令**（2026-11-01 修正）：
`{"header":"赠送_俱乐部_积分","club_id":..,"user_id":..,"user_add_gold":金额,"user_pwd":..,"context":..}`
—— 扣的是自己账户里的积分、不动额度，双方必须同一个授信代理下。原先复用上分的
`添加_俱乐部_成员_积分` 是错的：那条是代理按额度发筹码（后台也是直接加减目标积分、不扣操作者），
用它「赠送」等于白送，自己的积分不会被扣。两条命令的回包兜底匹配也已按 `action` 分开
（`expectedHeader = action === "give" ? GIFT_HEADER : SUBMIT_HEADER`），避免互相误判。

### 系统消息

`ClubGoldNotice.action` 增加 `"give"`，聊天页文案「玩家 X 赠送 N 成功」，余额段照旧（拿不到就省略）。
服务端正则同步放开 `(上分|下分|赠送)`。

### 服务端部署（第二次）

- 二进制 sha256 `f2c754dce92ecf24f907a47eac43e088904b98347ec3dcc11e0e40e0c4925671`，PID 22491，
  health 正常；备份 `bin/chattool.previous-give-notice-20261101-2145`（`9f048429…`）。
- 新增用例 `TestSystemNoticeAcceptsGiveVerb`；`go test ./internal/directchat/` 通过。

### 仍未做

- 客户端未构建/未热更，`build/*` 还是 2026-10-29 的产物。
- 赠送入口的显示依赖 `查询_俱乐部_额度` 的异步回包，回包未到之前两个按钮都不显示（和原来一致）。

## 第七轮：底部入口按实际显示数量自适应

问题：四个入口写死四列位置（left/center/right），只显示 2～3 个时中间留空洞。

改法：

- `panelMessageChat.prefab` 里四个入口（拍照上传/发送图片/赠送积分/上下分）的 Widget **只保留 BOTTOM**
  （`_alignFlags = 4`、`bottom = 76`），不再用 LEFT/CENTER/RIGHT 定水平位置；初始 x 按四列摆好
  （-256 / -85 / 86 / 257），保证脚本没跑时也不叠在一起。
- `panelMessageChat.ts` 新增 `LayoutBottomEntries()`：按**当前 active 的按钮数量**均分，
  宽度固定 108、间距固定 63、整体居中（`x = -total/2 + 54`），在 `onLoad` 与
  `RefreshClubGoldButton()` 里各调一次。
- 效果：2 个（普通成员）、3 个（群主/盟主或有额度代理）、4 个（无额度代理）都居中、间距一致、无空洞。
  示意见 `design-previews/待确认/2026-11-01-私聊上下分/10-底部入口自适应.png`。

注意：y 仍然交给 Widget 的 `bottom`，屏幕高度变化时不会跑位；只有 x 由脚本控制。

### 补充：额度未知态不猜

代理的额度靠 `查询_俱乐部_额度` 的异步 `GetClubQuota` 回包，之前用 `granted/fen` 的初值（false/0）参与判断，
等于"回包没到就当无额度"——有额度的代理会先闪一下「赠送积分」再跳成「上下分」。
现在加 `clubGoldQuotaKnown`：回包解析完才置 true，**未知期间两个入口都不显示**。
最终规则：

| 当前用户角色 | 对方是玩家 | 对方是代理 | 对方是群主/盟主 |
|---|---|---|---|
| owner / leader | 上下分 | 上下分 | 上下分 |
| agent 且有额度 | 上下分 | 上下分 | 上下分 |
| agent 无额度 | **只有赠送积分** | **只有赠送积分** | 都不显示 |
| member | 都不显示 | 都不显示 | 都不显示 |

> 2026-11-01 起「对方是代理」也显示赠送积分（原先只认玩家，导致下级代理聊天里没有入口）。
> 服务端 `赠送_俱乐部_积分` 只校验「两人带入时扣同一个授信代理的额度」，不按角色拦，给下级/同级代理赠送成立。
> 已知限制：客户端 `DirectPeer` 没有上下级字段，若对方恰好是自己的**上级代理**，按钮仍会显示，
> 点确认后才被服务端以「只能和同一个授信代理下的成员互相赠送」拒绝。要精确隐藏需服务端在 `peer` 里补上级字段。

## 消息列表排序：未读优先（已部署）

用户反馈「有新消息的会话没排到最前面」。根因在服务端 `Service.AllConversations` 的排序：

```go
// 原实现
if all[i].IsDefaultTarget != all[j].IsDefaultTarget {
    return all[i].IsDefaultTarget   // 固定上级代理入口无条件置顶
}
```

`IsDefaultTarget`（普通玩家的直属上级代理入口）被无条件排到第一条，所以别人刚发来消息、带未读红点的会话只能排它后面。

改为三级排序：**有未读的在前 → 固定上级入口次之 → `LastMessageAt` 倒序**。
固定入口仍能保证在前列（除非有未读会话压着），不会因为会话多而被挤出首页。

- 客户端 `panelMessage.ts` / `DirectChatManager` 不排序，直接吃服务端顺序，所以只改服务端。
- 新增用例 `TestAllConversationsPutsUnreadFirst`；`go test ./internal/directchat/` 全绿。
- 部署：`897cb0a5…1aa290d`，PID 24502，health ok；备份
  `bin/chattool.previous-sort-unread-20261101-2155`（`f2c754dc…`）。
