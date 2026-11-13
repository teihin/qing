# BOSS 玩家信息弹窗 IP 改短码

- 日期：2026-11-14
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：BOSS 打开的「玩家信息」弹窗不再显示明文 IP，改为可逆短码；后台后续按同一规则还原。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `assets/scripts/UI/panelClubPlayerInfo.ts` | `OnExtInfo` 上屏前调用新增的 `EncodeIp`；IPv4 → 6 位 Base62 短码，非 IPv4 返回空串由界面显示「—」。 |
| `assets/resources/UI/panelClubPlayerInfo.prefab` | 「玩家IP值」宽 280→180、x 156→106（左端仍 16）；「面板」下新增 `玩家IP复制`（88×44，x=250）及子节点 `文字`，默认隐藏，复用行按钮贴图与文字样式。 |
| `assets/scripts/UI/ClubManagementView.ts` | `HandleButton` 白名单与分支新增 `玩家IP复制`：读 `玩家IP值` 文案，空/「—」/「查询中…」提示，否则 `MobileManager.CopyToPhone` 并提示成功/失败；`syncExtRows` 与 `layoutMemberSettingRows` 纳入新按钮。 |
| `服务器文档整理/玩家扩展信息查询-客户端接口文档.md` | 新增 §8：短码字母表、编码/解码规则与示例。 |

## 短码规则

- 字母表（区分大小写）：`0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`。
- IPv4 四段拼 uint32 → Base62 固定 6 位（左补 0）；`62^6=568 亿 > 2^32`，无损可逆，不需要映射表。
- 示例：`221.236.103.129` → `43Ypq1`，`127.0.0.1` → `2kce4N`，`0.0.0.0` → `000000`。

## 行为与边界

- 本次只做客户端展示层遮挡；服务端回包 `ip` 仍是明文，未改 KBE，未重启 baseapp。
- 解码入口不在客户端；后台/运维后续按文档 §8 实现。
- 若后续要求客户端完全拿不到明文，需服务端新增 `ip_code` 并停止下发 `ip`，另行决策。

## 验证

- `ts.transpileModule`（本地 TypeScript，ES5）两个脚本均 0 诊断。
- Node 脚本按同一实现做编码/解码往返：`221.236.103.129`、`127.0.0.1`、`0.0.0.0`、`255.255.255.255`、`192.168.1.20`、`36.110.1.2` 均还原一致且固定 6 位；非法输入返回空。
- Prefab JSON 校验：引用全部在范围内、节点从根可达、`玩家IP复制` 已挂到「面板」children、面板下节点名无重复、`fileId` 171 个全唯一。

## 未完成

- 未运行 Creator 重新导入/编译/构建/热更，未真机验证；需在 Creator 中确认新按钮显示与点击复制，以及 6 位短码在值框内不截断。
