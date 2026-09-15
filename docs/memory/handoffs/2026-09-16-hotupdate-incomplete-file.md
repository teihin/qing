# 热更新"清单说已下载、磁盘上却没有"自愈（2026-09-16）

- 目录/分支：`/Volumes/SSD/qing`，`main`。
- 目标：解决"启动背景图改完后手机热更成功、但一直是 8L 老图"，并保证不再复发。

## 根因（真机实测）

- 设备（安卓，9527 调试口读）：`/data/user/0/com.fireball.qing/files/Remote/assets/resources/native/5e/5e7fa6f0-….png` **不存在**，只有一个下到 **1,190,036 / 2,233,549 字节**的 `.tmp`；而本地清单已把该文件记成新图 md5 `09683e82…`。
- 结果：引擎解析该资源回落到安装包里的旧图（APK 内 2,729,392 字节）；后续每次更新对比清单都认为"已下载"，**永久不再补下**。
- 为什么只有这张：加新图片是新 uuid（安装包内没有，只能走热更目录），改脚本会被工具拦住强制重建，只有"替换同名大图"会走到这条死锁。

## 引擎语义（Creator 2.4.13 自带 cocos2d-x 源码）

- 差异对比用 `<storage>/project.manifest`（`AssetsManagerEx::_cacheManifestPath`），不是 `assets/resources/native/25/….manifest` 副本；真机实验证实改副本无效、改它有效。
- `AssetsManagerEx::update()` 的 `switch(_updateState)` **没有 `UP_TO_DATE` 分支**：该状态下调 `update()` 不下载，且 `_updateEntry` 卡在 `DO_UPDATE`，后续 check/update 全被拒 ⇒ 不能用"发现坏了就直接 `update()`"来修。
- `loadLocalManifest` 中若安装包清单版本高于缓存清单，会 `removeDirectory(_storagePath)` 清空整个热更目录 ⇒ 降版本必须同时降副本、保持相对顺序，否则误触发清空。

## 改动文件

- `assets/scripts/UI/panelUpdate.ts`（+160 行，**纯新增、未改任何原有行**）：
  - `CheckLocalConfig()` 增加启动自检调用；`_storagePath` 提前赋值。
  - 新增 `CollectFiles()` / `RepairIncompleteDownloads()`：递归扫 `<storage>`，`.tmp` 残留或落地文件大小与清单不符 ⇒ 从所有清单文件剔除该条、删除坏文件、清单版本降末位（不动主/次版本）、复位 `tempver`（避免上层 `DeleteAllFiles` 清空热更目录），返回 true；全程 `try/catch` 兜底，异常只记日志。

## 验证

- 真机只读（同一份逻辑复刻）：健康状态 **0 误判**；**57** 条相对路径命中清单（排除"全部跳过"的假阴性）；size 不符正例精确抓出目标文件；`.tmp` 正例抓到并正确还原清单键；清单自引用被跳过（真机确有 567,481 vs 567,609 的差异）；63 个文件 ≈ **90ms**。
- 触发机制端到端：现场手工"删记录 + 末位版本降一"后，手机重启即补下 2,233,549 字节并正常显示新图。
- 静态：`git diff --numstat` = 160 增 / 0 删；lint 无 error/warning。
- 工具侧 `2上传最新热更新.command` 曾有一次"改了图但没重建就打包"（包内 room_card 仍是旧图），以相邻两版清单该文件 md5 相同可判定。
- 手机遗留排障备份（可删）：`Remote/project.manifest.bak-20260916-repair2`、`Remote/assets/resources/native/25/….manifest.bak-20260916-repair`。

## 未完成/下一步

1. **本轮改动未 Creator 构建、未出热更包、未上传**，自愈代码尚未下发到真机；下发的顺序必须是"重建 → 生成包 → 上传"。
2. 工具侧尚未加"资源新鲜度校验"（现在只校验脚本，只换图不重建会打出内容未变的包）。
3. `make_manifests()` 早于 `sync_native_build_manifests()`，导致包内清单副本永远落后一版（清单自引用所致，无害，可不改）。
4. `setVerifyCallback` 仍恒返回 `true`：**默认不改** —— 回调 `path` 指向最终文件还是 `.tmp` 无稳定保证，判错会让所有资源校验失败；本次以"启动按磁盘事实核对"替代。
5. 自检触发后若服务器版本恰好等于降级后的版本，该次不会下载，等服务器版本推进后自动补。
