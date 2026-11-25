# 2026-11-18 批次（归档自 CURRENT.md，2026-11-25）

## 2026-11-18 游戏设置入口：按「当前俱乐部所属联盟」判身份（脚本就绪，未构建/热更/真机）

- A3 有两家俱乐部（一家盟主、一家大盟主），当前在盟主那家；首次进大厅入口正确隐藏，点过「我的」回大厅后入口又冒出来。
- 根因：入口用**账号级**扫描——`clubUnionStatus` 里任意一家 `isOwner===true` 就亮，跟当前俱乐部无关；`start()` 里 `schedule(...,1)` 每秒轮询，另一家（大盟主）的 `is_owner=1` 被「我的」页补查回来之后，1 秒内就翻上去了。
- 修正（`panelMain.ts` `RefreshGameSettingsEntry`）：改用既有 `IsUnionOwnerOfClub(clubId)`（只看当前俱乐部所属联盟），口径与「上下分记录/钻石池消耗」一致；可见 = `unionKnown && (当前联盟的总群主 || (确认未入盟 && 当前俱乐部创建者))`，联盟未知时藏并按 30 秒节流补查。同日另修 `OnClubMyUnion` 不再写 `isOwner`。
- TS 转译 0 诊断；入口判定 6 例（盟主/大盟主/未入盟创建者/非创建者/状态未知）跑真实方法切片全部符合预期。未构建/热更/真机。详见[交接](../../handoffs/2026-11-18-game-settings-entry-union-gate.md)。

## 2026-11-18 排行榜数字等宽等基线 + 列右对齐（就绪，未导入/构建/热更）

- 根因：`leaderboard_v8_digits.fnt` 的 `xadvance` 33~40 连字宽、基线差 3px，数字宽窄不一且上下抖。
- `tools/apply_leaderboard_tabular_digits.py`：17 字形统一 56px 高、基线 59、数字 `xadvance=43`；贴图尺寸/UUID/`.meta` 不变，原图备份 `art_sources/v8-repairs/leaderboard/digits-tabular-before/`。
- `tools/apply_leaderboard_number_align.py`：`played_count`/`user_reward` 改右对齐（40 个 Label），右边缘落在列分隔线右内 8px，框宽 200/160 防裁 `−18,630`；`render_ui_prefab.py` 预览补对齐。
- 1334/1624 离屏：手数右边缘 559、奖励 713 全齐（改前 515/500/501）；未构建/热更/真机。详见[交接](../../handoffs/2026-11-18-leaderboard-tabular-digits.md)。
