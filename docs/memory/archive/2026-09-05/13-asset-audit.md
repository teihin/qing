# 历史原文摘录：资源体积与未使用审计

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 574–582 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## 资源体积与未使用审计

- 2026-07-29 已新增只读审计工具`tools/audit_cocos_unused_assets.py`，入口固定为`login.fire`、`panelMain.prefab`、`drh8.fire`和`panelGameView.prefab`，会递归跟踪标准/压缩UUID、DragonBones图集图片、可达脚本导入与项目现有动态加载约定，并把`build/jsb-link/assets`逻辑字节反向归属到源UUID。不要用外置exFAT卷上的`du`占用判断包体；当前构建资源逻辑体积为49.38 MiB，而目录分配占用会被128 KiB分配单元严重放大。
- 本轮没有删除或移动资源。审计报告为`reports/cocos-unused-assets-audit-2026-07-29.md`，完整候选为`reports/cocos-unused-assets-candidates-2026-07-29.csv`，动态保留清单为`reports/cocos-dynamic-assets-retained-2026-07-29.csv`。当前发现102个已进入构建的疑似未用资源，构建归属体积3.12 MiB；其中旧`表情`/`表情---`两套Prefab、两套旧DragonBones表情资源及已注释的`表情声音`共90个、约3.07 MiB，是主要候选。另有282个、6.88 MiB源码残留未独立进入当前资源构建，不得直接当作APK/IPA节省量。
- 动态加载保护已明确覆盖`表情2/*`、`pk2/*`、`zuotype/*`、本地头像、道具及其音效、牌局动作音效、`other/<服务端状态值>`、`other/drh/*`、`other/牌谱/*`、动态UI/条目Prefab、KBEngine实体类及Cocos全局脚本；这些不能仅因场景/Prefab无直接UUID引用而删除。真正清理时应先移到项目外隔离目录，重新构建并比较APK/IPA，再回归大厅全部入口、牌桌、战绩/牌谱、钱包/管理、表情/道具/音效和三端语音。
- 2026-07-29 `assets/font/PingFF.ttf`源文件为10.34 MiB，在当前Android APK和iOS IPA中压缩后分别占约6.72 MiB和6.71 MiB；其UUID直接绑定于56个场景/Prefab中的620个`cc.Label`，其中当前审计可达的47个文件含587个Label，大厅、牌桌和主要动态条目均大量使用，不能按“少量旧界面字体”删除。所有绑定共用同一字体UUID，因此可以保留文件名和`.meta`原位换字库，无需逐个修改Label。临时HarfBuzz测算显示：仅保留项目源码当前出现的900个汉字会缩至约192 KiB、ZIP约131 KiB，但会遗漏服务端公告、聊天、玩家名等动态字符；保留GB2312常用字符集会缩至约1.54 MiB、ZIP约1.02 MiB，理论上可比当前包内字体减少约5.7 MiB，但繁体、罕见姓名字和Emoji仍可能缺字。正式替换前必须确定动态文本字符范围，优先考虑“静态UI使用子集字体、任意动态文本使用系统字体”或接受明确字符集约束，并做三端显示、对齐和缺字回归。
- 2026-07-29 当前Android Release APK内图片共1072项、压缩后31.73 MiB，是字体之外最大的资源类别；其中PNG 1066项/30.05 MiB、JPG 6项/1.68 MiB。Android包将这些已压缩图片按原字节存储，图片文件每减少1 MiB，APK通常会直接减少接近1 MiB；当前iOS IPA图片压缩后为31.54 MiB。对`build/jsb-link/assets`内1061张PNG做不落盘的Pillow最高级无损重编码测算，并只采用体积变小结果，可从29.91 MiB降至28.84 MiB，理论节省1.06 MiB（3.56%）；全部图片重新解码为RGBA逐像素比对均无差异。传统PNG无损优化有收益但幅度有限，JPG无损优化通常只涉及元数据和Huffman表，收益更小；若要再明显减包，需要评估大背景/牌面/动画图集的尺寸、透明区域、WebP或有损但视觉无差别的编码，不能再称为严格无损。正式执行时只能优化`assets`源图并保留`.meta`/UUID，不能直接改`build`生成物；仅在新文件更小时替换，之后必须重新构建、生成热更新清单/MD5，并回归Web、Android、iOS的颜色、透明度、图集切片和旧PNG混淆输出。
- 2026-07-29 用户已把项目所在`/Volumes/CB`从exFAT重新格式化为普通APFS；当前挂载为`/dev/disk4s1`、大小1 TB、不区分大小写、未加密、可读写。全盘扫描已确认AppleDouble `._*`为0，过去约13万个伴生文件导致的Creator/Gradle隐藏资源和清理失败问题已从文件系统层消除。盘内仍有`.DS_Store`、`.Spotlight-V100`和`.fseventsd`，这些是macOS正常Finder/索引/文件事件数据，不应和`._*`混为一谈，也不要按“所有点文件”统删；`.git`、`.gitignore`等项目自身点文件必须保留。此前为规避exFAT而把Gradle中间产物迁到本机APFS临时目录的配置可以继续使用，若未来希望简化则需单独评估并重新跑完整Android构建，不能因换盘直接删除。

