# 2026-11-07 后台代理贡献展示规则拆两项（归档自 CURRENT.md）

- 输赢改 `score_percent`（0~100，只调少）、贡献改 `contrib_add`（分，只调增），两项各自继承；`show_percent` 只留红利/抽水/业绩；清空用 `-1`，发 `100` 会阻断继承。
- 后台 Go/Web 已同步（弹窗两个输入、列表输赢 % + 贡献 +¥），go test/tsc/vite build 通过；未部署、未联调。接口文档已更新。
- 暗抽比例列 + 调整入口原文见 [2026-11-08 归档](current-nov07-agent-bonus-dark.md)（已部署）。
