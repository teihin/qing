# 2026-11-13 客户端「额度授权记录」增加类型显示

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改客户端「我的 → 额度授权记录」列表；未构建热更、未真机验证。

## 目标

服务端 `ClubUnionGrantList` 已返回 `type`（授信 / 收回 / 注资 / 注资扣减 / 额度奖励），客户端原来只用它判断是否注资，没有显示。现在在每行「盟主」名字下方增加一行「类型：xxx」。

## 改动

- `assets/resources/Prefabs/额度授权记录对象.prefab`
  - 在行模板根节点新增 `typelabel` Label（font 17、lineHeight 20、暖金色、居中），位置在盟主名字下方 `y=-28`，宽度 150。
  - 行模板根高度不变，列表分页/行距不受影响。
- `assets/scripts/UI/panelQuotaGrantRecord.ts`
  - `SetRowInfo` 读取 `jItem["type"]`，写入 `typelabel`：空值显示「类型：—」，否则「类型：授信/收回/注资/注资扣减/额度奖励」。
  - 原有 `type` 节点继续显示额度归属（盟主名/联盟池），行为不变。

## 验证

- 预 Fab JSON 结构校验：47 个对象、所有 `__id__` 引用有效、PrefabInfo fileId 唯一。
- 未运行 Cocos Creator 导入/编译/构建；`.meta` 与 UUID 未改。

## 下一步

- 在 Creator 中重新导入 `额度授权记录对象.prefab`，编译 `panelQuotaGrantRecord.ts`，构建并热更后实机确认两行文字不重叠、长类型「注资扣减/额度奖励」不截断。
