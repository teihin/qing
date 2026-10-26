# 2026-10-26 代理也可踢出直属成员

## 范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Creator 2.4.13（运行中，`--path /Volumes/SSD/qing`）。
- 用户反馈：代理打开「玩家信息（俱乐部玩家设置）」弹窗看不到踢出按钮；口径确认——代理与老板一样，可踢自己的玩家。
- 保留工作区其他未提交修改；未提交、未推送。

## 结论：源码已放开，之前是运行时跑的旧脚本

- `assets/scripts/UI/ClubManagementView.ts` 工作区已为 `canKick = !readOnly && (manager() || canManageAgent())`（老板/管理员/代理），`confirm("remove")` 同样走 `canKick`；跨级（`settingsDepth > 0`）由 `blockReadOnlyPlayer()` + `readOnly` 一并收起按钮。
- 但 `temp/quick-scripts/dst/assets/scripts/UI/ClubManagementView.js`（Creator 预览实际加载的编译产物）在 15:17 那次编译里还是 `canMember = !readOnly && this.manager()`，即代理被隐藏。源码 15:34 改完，Creator 未重编译（窗口未前台时脚本不被扫描，与贴图同一类问题）。
- 本次只补注释说明并强制重编译：`osascript -e 'tell application "CocosCreator" to activate'` 后 15:40 重新产出，`grep canKick` 5 处，确认 `canKick` / `remove` 两处都在。**以后改完 .ts 要核对 `temp/quick-scripts/dst/...js` 是否已含新逻辑，不能只看 .ts 和 Creator 窗口。**

## 权限矩阵（当前客户端口径）

| 操作 | 创建者 | 管理员 | 代理（直属） | 代理（跨级） |
| --- | --- | --- | --- | --- |
| 踢出俱乐部 | 是 | 是 | 是 | 否（只读） |
| 改积分 | 是 | 是 | 否 | 否 |
| 设/调/取消代理 | 是 | 否 | 是 | 否 |
| 赠送金币 | 是 | 是 | 是 | 否 |

## 未解决 / 风险

- **服务端口径仍是「盟主或管理员或本人」**：`服务器文档整理/俱乐部与联盟功能-客户端接口文档.md` §2.9 `删除_俱乐部_玩家` 权限列只到盟主/管理员/本人。代理点踢出现在能发命令，但会被服务端拒（客户端只透传 error 文本）。要真正生效需服务端把该命令扩展到「直属上级代理」，并限定目标必须是其直属下级。
- 同一文档里有 `该成员还有下级代理，不能退出` 的报错口径（代理文档 §4.7/§4.8），踢带下级代理的人会被拒，属预期。
- 未做：Creator 实际点击验证、构建、真机、真实服务端回包。

## 下一步

1. 用代理账号在 Creator 预览里点直属成员头像 → 应看到「踢出俱乐部」，确认弹窗文案为「确认将「X」移出俱乐部？」。
2. 服务端放开权限后再做真实踢人回包验证；在此之前该按钮点击会是权限错误。
