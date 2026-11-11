# 玩家信息：输赢统计卡片重排（未构建、未真机）

日期：2026-11-11
分支：`codex/club-ui`（改动未提交）
目录：`/Volumes/SSD/qing`
配置：Cocos Creator 2.4.13

## 目标

牌桌点击玩家头像打开的 `panelUserInfo` 统计区参考用户提供的蓝色玩家信息图，改成两排三列，名称在上、数字在下并居中；上排为「总手数 / 总胜率 / 摊牌率」，下排为「胜利 / 平局 / 失败」。

## 改动

- `assets/resources/UI/panelUserInfo.prefab`
  - 统计框调整为 609×346，新增 6 张 `player_info_v8_prop_card` 蓝色渐变卡片，三列居中排列。
  - 名称使用浅色小字号，数字统一 36 号金色字并加轻微 `cc.LabelShadow`。
  - 外框扩展到 686×1126，道具区下移；标题位置因外框扩展同步校正。
  - 新增卡片、统计布局、外框、标题和道具区均带居中 `cc.Widget`；原「查看」按钮继续使用底部 Widget。
- `assets/scripts/UI/panelUserInfo.ts`
  - 第三项显示文案从「失败率」改为「摊牌率」。
  - 摊牌率继续使用原 `player.info.remark` 的 `arrayParam[3] / 总手数` 口径；胜利、平局、失败和付费查看流程不变。

## 验证

- `node --experimental-strip-types --check assets/scripts/UI/panelUserInfo.ts` 通过。
- Prefab JSON 可解析，引用检查 0 个坏引用，新增 6 张卡片各有有效 Sprite 和 Widget。
- `tools/render_ui_prefab.py` 已按 1334 和 1624 高度离屏渲染；统计区、标题、道具区无明显压叠。
- `git diff --check` 通过。

## 未验证 / 风险

- 未操作 Cocos Creator 导入、网页预览、构建、真机或服务端真实数据联调。
- 「摊牌率」沿用旧面板的 `remark[3]` 字段；非本人玩家的服务端字段是否始终下发，需要真实牌桌验收。
- 工作区原有其他未提交修改已保留，未提交、未推送。
