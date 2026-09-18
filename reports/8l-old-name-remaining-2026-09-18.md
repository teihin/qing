# 游戏中仍含旧名 8L / BL 的图片清单

生成日期：2026-09-18　扫描范围：`assets/`（共 2357 张 PNG）

判定方式：对每张 PNG 做 macOS Vision OCR（两次：原尺寸 + 放大重扫），
再用 `.meta` 里的纹理 / spriteFrame UUID 反查 `*.prefab`、`*.fire`、`*.ts`、`*.js`、`*.json` 的引用，
并核对热更包清单 `assets/resources/project.manifest`。

**合计 58 张**：确定在用 22 张 · 很可能在用 5 张 · 疑似未接入 31 张

> 注：`build/`、`hot-update-output/` 是构建产物，不单独列；下次构建会由 `assets/` 重新生成。

## ① 确定在用（prefab / 场景 / 脚本直接引用） —— 22 张

| # | 路径 | 体积 | 命中 | 图内文字（OCR） |
|---|---|---|---|---|
| 1 | `assets/ImagesLuck/大厅/秦_发现按钮.png` | 21 KB | 8L | 8L ／ 发现 |
| 2 | `assets/ImagesLuck/游戏内/LOGO.png` | 9 KB | 8L | 8L |
| 3 | `assets/V7/agent_v8_promotion_banner.png` | 197 KB | 8L/BL POKER | BLPOKER ／ 8L ／ POKER GAME ／ 邀请好友，共享牌桌精彩 ／ 专属二维码•自动绑定推广关系 |
| 4 | `assets/V7/announcement_detail_header_exact.png` | 1352 KB | 8L/BL/BL POKER | 个公告 ／ 最新公告 ／ BL POKER ／ 8L ／ POKER GAME |
| 5 | `assets/V7/announcement_detail_latest_exact.png` | 1923 KB | 8L/BL/BL POKER | 个公告 ／ 最新公告 ／ BL POKER ／ 8L ／ POKER GAME |
| 6 | `assets/V7/announcement_menu_long_exact.png` | 2690 KB | 8L/BL/BL POKER | 公告 ／ CASINO ／ 公告 ／ ANNOUNCEMENT ／ 最新公告 ／ BL POKER ／ 8L ／ POK… |
| 7 | `assets/V7/leaderboard_v8_hero_title.png` | 31 KB | 8L | 8L荣耀榜 |
| 8 | `assets/V7/leaderboard_v8_shield.png` | 76 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 9 | `assets/V7/lobby_shield_v8_exact.png` | 184 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 10 | `assets/V7/money_v8_shield.png` | 151 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 11 | `assets/V7/record_hero_exact.png` | 203 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 12 | `assets/V7/register_modal_panel_exact.png` | 1422 KB | 8L | 8L ／ 新用户注册 ／ 8L PRIVATE CLUB•ACCOUNT CREATION ／ 点击选择头像 ／ 请输入… |
| 13 | `assets/V7/register_subtitle_exact.png` | 22 KB | 8L | 8L PRIVATE CLUB•ACCOUNT CREATION |
| 14 | `assets/V7/room_card_exact.png` | 258 KB | BL/BL POKER | BL POKER ／ BY ／ POKER GAME |
| 15 | `assets/V7/shield_hd.png` | 1901 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 16 | `assets/V7/shield_room_exact.png` | 26 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 17 | `assets/V7/wallet_v8_realname_shield.png` | 37 KB | 8L | RVRE ／ 8L ／ POKER GAME |
| 18 | `assets/resources/other/drh/room_ready_art.png` | 283 KB | 8L | 8L ／ 游戏已就绪 |
| 19 | `assets/resources/pk2/bigbig.png` | 44 KB | 8L | 8L |
| 20 | `assets/resources/zuotype/搓背1.png` | 293 KB | 8L | 8L |
| 21 | `assets/resources/zuotype/牌背1.png` | 293 KB | 8L | 8L |
| 22 | `assets/resources/zuotype/牌背3.png` | 41 KB | 8L | 8L |

## ② 很可能在用（无直接引用，但在热更包清单内） —— 5 张

| # | 路径 | 体积 | 命中 | 图内文字（OCR） |
|---|---|---|---|---|
| 1 | `assets/ImagesLuck/动画/奖池动画/ui_bigwin_tex.png` | 596 KB | 8L | 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ 大赢家 ／ … |
| 2 | `assets/resources/pk2/bigbi1.png` | 45 KB | 8L | 8L |
| 3 | `assets/resources/zuotype/搓背0.png` | 40 KB | 8L | 8L |
| 4 | `assets/resources/zuotype/搓背3.png` | 41 KB | 8L | 8L |
| 5 | `assets/resources/zuotype/牌背0.png` | 40 KB | 8L | 8L |

## ③ 疑似未接入（既无引用也不在热更包内） —— 31 张

| # | 路径 | 体积 | 命中 | 图内文字（OCR） |
|---|---|---|---|---|
| 1 | `assets/ImagesLuck/公用/皇冠框.png` | 29 KB | 8L | 8L |
| 2 | `assets/ImagesLuck/大厅/大图标.png` | 9 KB | 8L | 8L |
| 3 | `assets/ImagesLuck/大厅/秦_大厅主视觉.png` | 81 KB | 8L | 8L |
| 4 | `assets/ImagesLuck/战绩详情/筹码.png` | 4 KB | 8L | 8L |
| 5 | `assets/V7/announcement_detail_bg_long_exact.png` | 2223 KB | 8L/BL/BL POKER | 公告 ／ CASINO ／ 公告 ／ ANNOUNCEMENT ／ E ／ 最新公告 ／ BL POKER ／ 8L ／… |
| 6 | `assets/V7/announcement_menu_body_exact.png` | 2690 KB | 8L/BL/BL POKER | 公告 ／ CASINO ／ 公告 ／ ANNOUNCEMENT ／ 最新公告 ／ BL POKER ／ 8L ／ POK… |
| 7 | `assets/V7/followup_agent_home_master_long.png` | 1113 KB | 8L | -我的代理 ／ 红利余额 ／ 8L ／ 实时统计•可提取金额以服务器为准 ／ 累计总红利 ／ 累计总提取 ／ ◎代理管理… |
| 8 | `assets/V7/followup_agent_popup_add_agent_exact.png` | 52 KB | 8L | 取消 ／ 添加代理 ／ 8L ／ POKER GAVE ／ 确认添加 |
| 9 | `assets/V7/followup_agent_popup_delete_agent_exact.png` | 52 KB | 8L | 取消 ／ 删除授杈 ／ 8L ／ POKER GAVE ／ 确认删除 |
| 10 | `assets/V7/followup_agent_popup_leader_income_exact.png` | 43 KB | 8L | 盟主收益 ／ 8L ／ POKERCANE ／ 知道了 |
| 11 | `assets/V7/followup_agent_popup_pool_income_exact.png` | 52 KB | 8L | 取消 ／ 奖池收益 ／ 8L ／ POKER GAVE ／ 提取收益 |
| 12 | `assets/V7/followup_agent_popup_ratio_exact.png` | 51 KB | 8L | 取消 ／ 比例设置 ／ 8L ／ POKERCANE ／ 确认设置 |
| 13 | `assets/V7/followup_agent_popup_region_income_exact.png` | 43 KB | 8L | 大区收益 ／ 8L ／ POKERCANE ／ 知道了 |
| 14 | `assets/V7/followup_agent_popup_share_income_exact.png` | 51 KB | 8L | 取消 ／ 我的分红 ／ 8L ／ POKER GAVE ／ 提取分红 |
| 15 | `assets/V7/followup_agent_popup_withdraw_bonus_exact.png` | 51 KB | 8L | 取消 ／ 提取红利 ／ 8L ／ POKER GAVE ／ 确认提取 |
| 16 | `assets/V7/followup_agent_promo_master_long.png` | 1015 KB | 8L | 游戏推广 ／ 8L ／ 邀请好友，共享牌桌精彩 ／ 专属二维码•自动绑定推广关系 ／ 、专属推广二维码 ／ 推广链接 ／… |
| 17 | `assets/V7/followup_password_init_v8_full_exact.png` | 2321 KB | 8L/BL/BL POKER | 1 ／ 初始化交易密码 ／ 太 ／ BL POKER ／ 8L ／ POKER GAME ／ CASINO ／ 设置交易… |
| 18 | `assets/V7/followup_password_login_v8_full_exact.png` | 2300 KB | 8L/BL/BL POKER | 个 修改登录密码 ／ BL POKER ／ 8L ／ POKER GAME ／ 原登录密码 ／ 请输入原登录密码 ／ 新… |
| 19 | `assets/V7/followup_password_trade_v8_full_exact.png` | 2334 KB | 8L/BL/BL POKER | 个 修改交易密码 ／ BL POKER ／ 8L ／ POKER GAME ／ CASINO ／ 修改交易密码 ／ 为保… |
| 20 | `assets/V7/followup_ranking_bonus_master_long.png` | 1345 KB | 8L | ＜排行榜 ／ 8L ／ 8L荣耀榜 ／ 活动时间 ／ 我的排名与当前奖励 |
| 21 | `assets/V7/followup_ranking_hands_master_long.png` | 1345 KB | 8L | ＜排行榜 ／ 8L ／ 8L荣耀榜 ／ 活动时间 ／ 我的排名与当前奖励 |
| 22 | `assets/V7/followup_ranking_wins_master_long.png` | 1345 KB | 8L | ＜排行榜 ／ 8L ／ 8L荣耀榜 ／ 活动时间 ／ 我的排名与当前奖励 |
| 23 | `assets/V7/followup_reserved_v8_full_exact.png` | 2093 KB | 8L/BL/BL POKER | 令修改预留信息 ／ BL POKER ／ 8L ／ POKER GAME ／ 实名认证与提现预留信息 ／ 请确保姓名、银… |
| 24 | `assets/V7/followup_settings_master_long.png` | 1166 KB | 8L | 系统设置 ／ 8L ／ 游戏与账号安全设置 ／ 声音开关、设备保护与密码管理 ／ 游戏设置。 ／ 聊天语音 ／ 控制牌桌… |
| 25 | `assets/V7/followup_settings_v8_full_exact.png` | 2350 KB | 8L/BL/BL POKER | 个系统设置 ／ BL POKER ／ 8L ／ POKER GAME ／ 系统设置 ／ ¥ ／ 修改登录密码 ／ 保障账… |
| 26 | `assets/V7/lobby_hero_exact.png` | 1202 KB | 8L/BL/BL POKER | CASINO ／ BL POKER ／ 8L ／ POKER GAME ／ 全部 ／ 排行榜 ／ 小皮 ／ 比赛场 ／ … |
| 27 | `assets/V7/shield_nav.png` | 35 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 28 | `assets/V7/shield_room.png` | 55 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME |
| 29 | `assets/V7/startup_v8_clean_exact.png` | 1924 KB | 8L/BL/BL POKER | BL POKER ／ 8L ／ POKER GAME ／ 正在进入游戏 ／ SECURE CONNECTION• RES… |
| 30 | `assets/V7/v8_mine_footer.png` | 236 KB | 8L | 公告 ／ 客服 ／ 8L ／ 钱包 ／ 我的 |
| 31 | `assets/imagesKK/游戏大厅/图标.png` | 9 KB | 8L | 8L |

## 已改完并已确认在用（5 张，仅供参考）

| 路径 | 引用位置 |
|---|---|
| `assets/V7/login_shield_exact.png` | panelLogin.prefab |
| `assets/V7/mine_hero_exact.png` | panelMain.prefab |
| `assets/V7/nav_bar_exact.png` | panelMain.prefab |
| `assets/V7/announcement_shield_v8_exact.png` | panelMain.prefab |
| `assets/V7/agent_v8_shield.png` | panelHongli.prefab |

## 方法局限

- OCR 依赖模型识别，极小或高度艺术化的字形可能漏读；本清单已用「放大重扫」补偿一轮。
- 含 `8L` 字样的图已逐张人工看图确认（含 `皇冠框` / `筹码` / `大图标` / 牌背等高误报风险项）。
- ③ 类靠 UUID 反查判定，若某图是通过运行时 `cc.resources.load(路径)` 加载且路径写死在无法静态解析的位置，可能误判。
