# 交接：打包体积排查与 V7 移出 resources（2026-09-15）

## 目录与分支

- 项目根 `/Volumes/SSD/qing`，分支 `main`，Cocos Creator 2.4.13。排查期间 Creator 实例处于打开状态。
- 相关提交：`5249135`「转移 V7切图位置」（用户执行）。

## 目标

用户反馈打包后资源接近 200 MB，怀疑未使用的图片也被打包，要求检查。

## 结论

1. Cocos 对 `assets/resources/` **整目录无条件打包**：构建器不分析 `cc.loader.loadRes(拼接路径)` 的目标，未引用资源同样进包。它是唯一这样的目录。
2. 实测对照：`assets/ImagesLuck`（非 resources）588 张只打进 356 张，其中 355 张落在 `resources/native`。说明非 resources 资源只打包被引用的部分，且被 `resources` 内 Prefab 引用者会经依赖闭包归入 `resources` 包 —— **移出 resources 不会丧失热更新能力**。
3. `assets/resources/V7/` 原有 658 张 PNG（114.16 MB），其中 **169 张（60.88 MB）无任何引用**，命名以设计母版/整幅效果图为主（`*_exact`、`*_master_long`、`*_v8_full_exact`、`*_clean_exact`）。
4. 处置：用户把整个 `V7/` 移到 `assets/V7/`，只有被引用的 481 张 + 8 张 BMFont 贴图进包。

## 判定方法（可复用）

- 从每个资源的 `.meta`（含 `subMetas` 的 sprite-frame / font 子资源 UUID）建 UUID → 资源索引，再在 `assets/` 全部非图片文件中反查。
- **必须把 `.meta` 纳入扫描范围**：BMFont/LabelAtlas 的贴图只通过同目录 `.fnt.meta` / `.labelatlas.meta` 关联。首轮漏掉这条链，误把 8 张在用字体贴图判为“未引用”（`agent_v8_digits`、`buyin_v8_digits`、`buyin_v8_large_digits`、`ingame_jackpot_cells_v8`、`jackpot_v8_digits`、`jackpot_v8_serif_digits`、`leaderboard_v8_digits`、`v8_record_digits`），已移回。
- `manifest` 类全量清单（`assets/resources/project.manifest`、`version.manifest`）要单独排除，否则所有资源都会被误判为已引用。
- 只有“仅经 Prefab UUID 引用、无代码路径加载”的目录才可静态判定。`avatars`、`pk2`、`zuotype`、`Audio`、`道具`、`表情声音`、`other`、`UI/*.prefab`、`Prefabs/*.prefab` 由 `cc.loader.loadRes` 拼接路径加载，**不得按“未引用”处理**。

## 实测结果（19:23 重建的 build/jsb-link）

| 项目 | 数量 | 体积 |
|---|---:|---:|
| `assets/V7/` 总数 | 658 | 114.16 MB |
| 进包（481 张被引用 + 8 张字体贴图） | 489 | 53.28 MB |
| 未进包 | 169 | 60.88 MB |

- PNG 在构建中原样复制（进包部分源 53.29 MB ↔ 产物 53.28 MB）。
- `build/jsb-link/assets/resources` 现为 108.60 MB；若 V7 仍在 resources 下全量打包约 169.5 MB，**净减约 60.9 MB**。
- `build/jsb-link/assets/main` 728 KB、`internal` 72 KB。

## 改动文件

- 提交 `5249135`：`assets/resources/V7/` → `assets/V7/`，1333 个文件全部 R100（100% rename），0 增 0 删；文件内容、`.meta`、UUID 未变。
- `assets/V7/` 复查：658 PNG + 666 meta + 8 个 `.fnt/.labelatlas`，无缺 meta、无孤儿 meta；`assets/resources/` 无 V7 残留。
- 全项目 `prefab/fire/anim` 共 12479 处 `__uuid__`，仅 16 类无法在 `assets/` 解析，且均只出现在 `library/` 中，属引擎内置资源（如 `eca5d2f2-…`），与 V7 无关。
- 未提交修改：`assets/resources/project.manifest`、`assets/resources/version.manifest`（仅版本号 `5.0.4 → 5.0.5`）。
- 遗留空目录：`art_sources/v7-unreferenced-20260915/`（可删）。

## 未完成 / 待验证

1. Creator 重新导入后的界面复核（移出 resources 不改 UUID，预期无影响，但未做视觉确认）。
2. 热更新清单是否与本次构建一致：manifest 只改了版本号，需确认是基于新构建重新生成，否则可能仍列旧路径；未跑完整的热更包生成/上传验证。
3. 网页版 `build/web-mobile` 仍是 09-14 产物，未反映本次变更。
4. 真机与线上发布未验证。
5. 未进包的 169 张仍保留在 `assets/V7/`，是否彻底清理另行决定。

## 风险提醒

- `tools/apply_v7_*.py`、`generate_v7_*.py`、`prepare_v8_visual_repairs.py` 等以 `assets/resources/V7` 为**输出目录**，重跑会写到已不存在的旧路径或重新生成图片；按 `AGENTS.md` 这些属历史实现线索，不应再运行。
- 后续在编辑器外移动资源前，先关闭 Creator 或让其完成刷新。本次操作期间 Creator 自动重存过 `Prefabs/排行榜.prefab`、`UI/panelHongli.prefab`（`__id__` 重排等序列化规范化，`__uuid__` 引用等价）。
- 进一步压体积方向：V7 进包的 489 张中仍有 12 张单张 >1 MB 的整幅长图（合计约 26 MB），可考虑压缩或切片。
