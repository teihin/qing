# 2026-10-30 俱乐部新申请提示音

## 目标与范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Creator 2.4.13。
- 需求：有新的俱乐部入会申请时播放提示音，触发口径与红点一致——红点亮起就有声音。
- 只加声音，不改红点数据源、申请范围与审批权限。

## 改动

- `assets/scripts/UI/ClubManagementView.ts:90` `SetPendingCount`：记录上一值，**待审数增加**（含 0→N）时调用 `notify`；数量不变或减少不响。红点数据源仍只有这一处（`ClubReqInfo` 推送、`RefreshBadges` 轮询、申请列表载入）。
- `assets/scripts/UI/ClubManagementView.ts:55` 构造函数新增可选 `notify` 回调，UI 控制器不直接持有音频。
- `assets/scripts/UI/panelMain.ts:242` 构造时传入 `()=>this.PlayAudio("eff/申请提示")`，复用 `UIViewBase.PlayAudio`，走 `AudioEff` 音量配置。
- 音效为本地合成的新素材 `assets/resources/Audio/eff/申请提示.wav`（1.0s、44.1kHz 单声道、峰值 -6dBFS），配套 `.meta`（`audio-clip`、uuid `77f2ae8a-d3f2-4ef4-9edc-ae6b1b5dd4b0`），不引用游戏内既有音效。
  - 听感：C6→E6 两音上行、玻璃铃音色，慢衰减 + 轻混响，友好不刺耳。
  - 候选试听：`design-previews/音效预览/A-轻铃上行.wav`（已采用）、`B-门铃下行.wav`（经典叮咚）、`C-木琴双击.wav`（短促木琴）。换成 B/C 只需复制到 `assets/resources/Audio/eff/申请提示.wav`，代码不用改。

## 触发口径

- 新申请使 `req_count` 变大：响一次。
- 同样的数量被推送/轮询重复下发：不响。
- 同意/拒绝后数量减少：不响。
- 角色范围沿用服务端推送口径（创建者/盟主/持码代理），普通成员没有红点也不会有提示音。

## 验证

- 静态核对：构造函数唯一调用点在 `panelMain`，参数已同步；音频路径存在；未运行 Creator 编译与真机试听。

## 下一步

- Creator 预览：用另一账号发起申请，确认弹一次提示音、红点同时亮；刷新/等待轮询不重复响；审批完成后不再响。
- 若试听后更喜欢 B/C，直接覆盖 `assets/resources/Audio/eff/申请提示.wav` 即可，`.meta` 与代码都不用动；替换后需确认时长仍是 1.0s（B 为 1.1s），如不同步请更新 `.meta` 的 `duration`。
- 三个候选由 `/tmp/gen_club_chime.py` 合成；需要调整音高/间隔/混响可改参数重出。
