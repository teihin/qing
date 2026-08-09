# Cocos 未使用资源保守审计（2026-07-29）

本报告只做整理，没有删除、移动或改名任何资源。判定入口为登录场景、大
厅 `panelMain.prefab`、牌桌 `drh8.fire` 与 `panelGameView.prefab`；在此
基础上递归跟踪场景/Prefab/动画等序列化文件中的 UUID、组件脚本的本地
导入，以及项目现有的动态加载路径。

## 结论摘要

- 当前 `build/jsb-link/assets` 逻辑体积：**49.38 MiB**。
- 已反向归属到源资源 UUID：**48.94 MiB**；其余主要是
  `index.jsc`、分包配置和引擎内置资源，不能直接归到单个源文件。
- 高置信度“疑似未用且已进入当前构建”的资源：**102 个，
  当前构建归属体积合计 3.12 MiB**。
- 另有 **282 个 / 6.88 MiB**
  疑似源码残留没有独立映射到当前构建文件，所以这一部分不能直接当作
  可节省包体。
- 两类候选合计 **384 个源文件 / 10.08 MiB 源文件体积**；
  其中真正与当前资源包体直接相关的仍以前一项构建归属体积为准。

| 分类 | 文件数 | 源文件逻辑体积 | 当前构建归属体积 |
|---|---|---|---|
| 静态可达（含脚本依赖） | 861 | 27.77 MiB | 24.82 MiB |
| 动态加载保留 | 439 | 29.30 MiB | 21.00 MiB |
| 疑似未用、当前构建中存在 | 102 | 3.20 MiB | 3.12 MiB |
| 疑似未用、当前构建中未归属 | 282 | 6.88 MiB | 0 B（当前快照未独立归属） |

## 关键发现

- 最大的一组是旧表情系统：**90 个 / 3.07 MiB 构建归属体积**。当前牌桌代码实际按
  `表情2/<编号>` 加载，新版 `表情2` 已整体保留；旧 `表情`、
  `表情---`、两套 DragonBones 表情资源和 `表情声音` 未被当前链命中，
  且旧表情音效加载代码已注释。
- 除旧表情系统外，已打包候选还有 **12 个 / 56.32 KiB**，主要是旧奖励/红利列表对象、
  `handbig.prefab`、资源目录图标、旧 `DefCtl` 和 inspector 配置。
- 动态牌面、牌背、头像、道具、动作音效、服务端状态图、牌桌操作图、
  牌谱图、KBEngine 动态脚本均已主动排除，不计入候选。

## 对现有安装包快照的影响

| 安装包快照 | 文件大小 | 资源条目压缩后 | 原生库/主程序压缩后 | 候选条目压缩后 |
|---|---|---|---|---|
| Android Release APK | 65.22 MiB | 44.55 MiB | 19.21 MiB | 2.55 MiB |
| iOS 未签名 IPA | 53.25 MiB | 42.14 MiB | 5.62 MiB | 2.34 MiB |

“候选条目压缩后”是直接读取现有 ZIP 条目的压缩字节，并非删除后重打包
的承诺值；中央目录、资源配置和对齐方式也会随重建变化。它比源文件体积
更接近最终可节省量，但最终数字仍必须以隔离清理后的新包为准。

当前保留资源的主要体积来源：

| 目录 | 文件数 | 当前构建归属体积 |
|---|---|---|
| assets/ImagesLuck | 461 | 10.83 MiB |
| assets/font | 3 | 10.34 MiB |
| assets/resources/pk2 | 171 | 9.16 MiB |
| assets/resources/zuotype | 25 | 4.11 MiB |
| assets/resources/Audio | 27 | 3.50 MiB |
| assets/resources/avatars | 20 | 2.70 MiB |
| assets/Images | 246 | 1.52 MiB |
| assets/imagesKK | 37 | 1.04 MiB |
| assets/ImagesXYPK | 48 | 908.18 KiB |
| assets/resources/UI | 21 | 583.39 KiB |
| assets/resources/project.manifest | 1 | 421.20 KiB |
| assets/resources/other | 44 | 375.49 KiB |
| assets/Scenes | 2 | 200.24 KiB |
| assets/resources/Prefabs | 35 | 169.00 KiB |
| assets/resources/道具 | 23 | 21.80 KiB |

`assets/font` 主要是 10.34 MiB 的 `PingFF.ttf`，它当前确实被界面使用，
所以没有列为未使用资源；若后续继续减包，做字体子集化通常比继续寻找零散
孤儿图更有收益，但必须覆盖全部客户端固定文字和服务端可能下发的中文字符。

这里的“当前构建归属体积”是未压缩构建资源的逻辑字节数，不是 exFAT 的
`du` 占用，也不是最终 APK/IPA 的精确压缩后节省量；真正删除前仍要做一次
隔离构建才能得到最终包体差值。

## 疑似未用资源按目录汇总

| 目录 | 文件数 | 源文件体积 | 当前构建归属体积 |
|---|---|---|---|
| assets/Images/表情kk | 30 | 1.24 MiB | 1.27 MiB |
| assets/resources/表情声音 | 10 | 938.35 KiB | 939.47 KiB |
| assets/Images/表情 | 30 | 869.99 KiB | 888.56 KiB |
| assets/resources/icon.png | 1 | 39.92 KiB | 40.18 KiB |
| assets/resources/Prefabs | 9 | 107.86 KiB | 15.33 KiB |
| assets/resources/表情--- | 10 | 23.78 KiB | 7.47 KiB |
| assets/resources/表情 | 10 | 24.05 KiB | 7.07 KiB |
| assets/resources/DefCtl | 1 | 2.30 KiB | 681 B |
| assets/resources/cc-inspector.json | 1 | 61 B | 153 B |

## 疑似未用资源按类型汇总

| 类型 | 文件数 | 源文件体积 | 当前构建归属体积 |
|---|---|---|---|
| image | 21 | 1.31 MiB | 1.31 MiB |
| audio | 10 | 938.35 KiB | 939.47 KiB |
| data | 41 | 844.51 KiB | 889.96 KiB |
| prefab | 30 | 158.00 KiB | 30.54 KiB |

## 体积最大的疑似未用资源（前 80 个）

| 源文件 | 类型 | 源文件体积 | 当前构建归属体积 |
|---|---|---|---|
| assets/resources/表情声音/7.wav | audio | 538.84 KiB | 538.95 KiB |
| assets/Images/表情kk/3_fennu/3_fennu_tex.png | image | 139.93 KiB | 140.01 KiB |
| assets/Images/表情kk/6_niupigu/6_niupigu_ske.json | data | 132.37 KiB | 135.22 KiB |
| assets/Images/表情kk/4_dushen/4_dushen_ske.json | data | 123.71 KiB | 127.23 KiB |
| assets/Images/表情kk/10_xiyue/10_xiyue_ske.json | data | 107.62 KiB | 110.14 KiB |
| assets/resources/表情声音/5.mp3 | audio | 108.67 KiB | 108.79 KiB |
| assets/Images/表情kk/4_dushen/4_dushen_tex.png | image | 102.95 KiB | 103.02 KiB |
| assets/Images/表情/3/xiyuetiao_tex.png | image | 100.25 KiB | 100.32 KiB |
| assets/Images/表情/6/wulian_tex.png | image | 94.20 KiB | 94.27 KiB |
| assets/Images/表情/4/fennu_tex.png | image | 92.90 KiB | 92.97 KiB |
| assets/resources/表情声音/6.wav | audio | 92.41 KiB | 92.52 KiB |
| assets/Images/表情/1/OK_tex.png | image | 86.93 KiB | 87.01 KiB |
| assets/resources/表情声音/4.mp3 | audio | 79.62 KiB | 79.74 KiB |
| assets/Images/表情/7/liubixue_tex.png | image | 76.82 KiB | 76.89 KiB |
| assets/Images/表情kk/9_sanyan/9_sanyan_ske.json | data | 70.36 KiB | 72.36 KiB |
| assets/Images/表情/2/gouyin_tex.png | image | 66.99 KiB | 67.06 KiB |
| assets/Images/表情/5/wabikong_tex.png | image | 65.80 KiB | 65.88 KiB |
| assets/Images/表情/10/feiwen_tex.png | image | 63.29 KiB | 63.37 KiB |
| assets/Images/表情kk/2_gouyin/2_gouyin_ske.json | data | 60.10 KiB | 62.89 KiB |
| assets/Images/表情kk/7_baidingwang/7_baidingwang_tex.png | image | 58.50 KiB | 58.58 KiB |
| assets/Images/表情kk/5_wulian/5_wulian_ske.json | data | 55.92 KiB | 58.02 KiB |
| assets/Images/表情/8/dianzan_tex.png | image | 57.13 KiB | 57.20 KiB |
| assets/Images/表情/9/bishi_tex.png | image | 53.62 KiB | 53.69 KiB |
| assets/Images/表情kk/8_anzhongguancha/8_anzhongguancha_ske.json | data | 51.90 KiB | 53.46 KiB |
| assets/Images/表情kk/3_fennu/3_fennu_ske.json | data | 46.88 KiB | 49.22 KiB |
| assets/Images/表情kk/6_niupigu/6_niupigu_tex.png | image | 47.41 KiB | 47.48 KiB |
| assets/Images/表情kk/7_baidingwang/7_baidingwang_ske.json | data | 40.82 KiB | 42.88 KiB |
| assets/resources/icon.png | image | 39.92 KiB | 40.18 KiB |
| assets/Images/表情kk/5_wulian/5_wulian_tex.png | image | 35.79 KiB | 35.87 KiB |
| assets/Images/表情kk/2_gouyin/2_gouyin_tex.png | image | 35.24 KiB | 35.32 KiB |
| assets/Images/表情kk/10_xiyue/10_xiyue_tex.png | image | 33.58 KiB | 33.66 KiB |
| assets/Images/表情kk/1_bishi/1_bishi_ske.json | data | 30.17 KiB | 31.75 KiB |
| assets/Images/表情kk/8_anzhongguancha/8_anzhongguancha_tex.png | image | 29.80 KiB | 29.88 KiB |
| assets/Images/表情kk/9_sanyan/9_sanyan_tex.png | image | 28.93 KiB | 29.00 KiB |
| assets/resources/表情声音/9.mp3 | audio | 26.98 KiB | 27.09 KiB |
| assets/Images/表情kk/1_bishi/1_bishi_tex.png | image | 26.79 KiB | 26.87 KiB |
| assets/resources/表情声音/2.mp3 | audio | 24.83 KiB | 24.94 KiB |
| assets/resources/表情声音/1.mp3 | audio | 21.77 KiB | 21.89 KiB |
| assets/resources/表情声音/10.mp3 | audio | 20.39 KiB | 20.50 KiB |
| assets/Images/表情/3/xiyuetiao_ske.json | data | 16.83 KiB | 18.10 KiB |
| assets/Images/表情/4/fennu_ske.json | data | 14.39 KiB | 16.11 KiB |
| assets/resources/表情声音/3.mp3 | audio | 15.51 KiB | 15.62 KiB |
| assets/Images/表情/7/liubixue_ske.json | data | 13.29 KiB | 15.28 KiB |
| assets/Images/表情/6/wulian_ske.json | data | 12.02 KiB | 13.75 KiB |
| assets/Images/表情/1/OK_ske.json | data | 11.41 KiB | 13.04 KiB |
| assets/resources/表情声音/8.mp3 | audio | 9.32 KiB | 9.43 KiB |
| assets/Images/表情/2/gouyin_ske.json | data | 8.05 KiB | 9.38 KiB |
| assets/Images/表情/5/wabikong_ske.json | data | 7.68 KiB | 9.12 KiB |
| assets/Images/表情/9/bishi_ske.json | data | 7.66 KiB | 8.87 KiB |
| assets/Images/表情/8/dianzan_ske.json | data | 6.74 KiB | 7.80 KiB |
| assets/Images/表情/10/feiwen_ske.json | data | 6.45 KiB | 7.68 KiB |
| assets/Images/表情kk/4_dushen/4_dushen_tex.json | data | 3.30 KiB | 4.09 KiB |
| assets/resources/Prefabs/伙伴红利分配对象.prefab | prefab | 22.07 KiB | 2.65 KiB |
| assets/resources/Prefabs/战绩红利对象.prefab | prefab | 19.10 KiB | 2.26 KiB |
| assets/Images/表情kk/7_baidingwang/7_baidingwang_tex.json | data | 1.55 KiB | 2.06 KiB |
| assets/Images/表情kk/3_fennu/3_fennu_tex.json | data | 1.31 KiB | 1.75 KiB |
| assets/Images/表情kk/2_gouyin/2_gouyin_tex.json | data | 1.30 KiB | 1.74 KiB |
| assets/resources/Prefabs/活动详细记录对象.prefab | prefab | 14.01 KiB | 1.74 KiB |
| assets/resources/Prefabs/奖池收益对象.prefab | prefab | 11.48 KiB | 1.67 KiB |
| assets/Images/表情kk/6_niupigu/6_niupigu_tex.json | data | 1.16 KiB | 1.56 KiB |
| assets/resources/Prefabs/奖池提取记录对象.prefab | prefab | 10.22 KiB | 1.54 KiB |
| assets/resources/Prefabs/伙伴对象.prefab | prefab | 10.31 KiB | 1.51 KiB |
| assets/resources/Prefabs/奖励详细记录对象.prefab | prefab | 8.38 KiB | 1.40 KiB |
| assets/resources/Prefabs/道具对象2.prefab | prefab | 3.98 KiB | 1.37 KiB |
| assets/Images/表情/7/liubixue_tex.json | data | 1012 B | 1.36 KiB |
| assets/Images/表情kk/9_sanyan/9_sanyan_tex.json | data | 899 B | 1.22 KiB |
| assets/resources/Prefabs/handbig.prefab | prefab | 8.32 KiB | 1.19 KiB |
| assets/Images/表情/5/wabikong_tex.json | data | 862 B | 1.18 KiB |
| assets/Images/表情/6/wulian_tex.json | data | 850 B | 1.16 KiB |
| assets/Images/表情/2/gouyin_tex.json | data | 837 B | 1.15 KiB |
| assets/Images/表情/1/OK_tex.json | data | 834 B | 1.14 KiB |
| assets/Images/表情kk/10_xiyue/10_xiyue_tex.json | data | 792 B | 1.10 KiB |
| assets/Images/表情kk/1_bishi/1_bishi_tex.json | data | 792 B | 1.09 KiB |
| assets/Images/表情kk/5_wulian/5_wulian_tex.json | data | 786 B | 1.09 KiB |
| assets/Images/表情/4/fennu_tex.json | data | 785 B | 1.09 KiB |
| assets/Images/表情kk/8_anzhongguancha/8_anzhongguancha_tex.json | data | 753 B | 1.05 KiB |
| assets/Images/表情/10/feiwen_tex.json | data | 734 B | 1.03 KiB |
| assets/Images/表情/9/bishi_tex.json | data | 684 B | 987 B |
| assets/Images/表情/3/xiyuetiao_tex.json | data | 577 B | 860 B |
| assets/Images/表情/8/dianzan_tex.json | data | 568 B | 849 B |

完整名单见：

- `reports/cocos-unused-assets-candidates-2026-07-29.csv`

## 未进入当前资源构建的源码残留

这些文件适合后续整理仓库，但当前没有独立构建文件归属，不能把它们的
源文件体积直接算成 APK/IPA 可节省体积。所有 TypeScript/JavaScript
已因 Cocos 合包、全局模块和 KBEngine 动态类机制而保守保留，不在候选中。

| 目录 | 文件数 | 源文件体积 |
|---|---|---|
| assets/ImagesLuck | 144 | 3.50 MiB |
| assets/ImagesXYPK | 37 | 1.97 MiB |
| assets/imagesKK | 48 | 984.86 KiB |
| assets/Images | 43 | 422.47 KiB |
| assets/temp | 1 | 19.11 KiB |
| assets/Scenes | 1 | 10.21 KiB |
| assets/font | 6 | 2.27 KiB |
| assets/animation | 2 | 1.88 KiB |

体积最大的源码残留（前 50 个）：

| 源文件 | 类型 | 源文件体积 |
|---|---|---|
| assets/ImagesXYPK/转盘/转盘动画2/zhuanpan0311_tex.png | image | 727.58 KiB |
| assets/ImagesLuck/登陆/背景.png | image | 611.20 KiB |
| assets/ImagesLuck/动画/大厅LOGO动画/logo_tex.png | image | 593.57 KiB |
| assets/ImagesLuck/公用/框.png | image | 372.81 KiB |
| assets/ImagesLuck/游戏内/biankuang.png | image | 318.84 KiB |
| assets/ImagesXYPK/转盘/动画/zhuanpan_dongxioa_tex.png | image | 306.76 KiB |
| assets/imagesKK/游戏大厅/顶部Banner.png | image | 300.25 KiB |
| assets/ImagesLuck/动画/报奖-old/ui_bigwin_tex.png | image | 193.78 KiB |
| assets/ImagesLuck/我的/我的背景.png | image | 183.92 KiB |
| assets/ImagesXYPK/动画/敲/touxiangkuang_tex.png | image | 172.37 KiB |
| assets/ImagesXYPK/转盘/转盘3.png | image | 165.97 KiB |
| assets/ImagesXYPK/转盘/转盘1.png | image | 162.47 KiB |
| assets/imagesKK/游戏大厅/大厅底图.png | image | 160.61 KiB |
| assets/ImagesXYPK/转盘/转盘动画2/zhuanpan0311_ske.json | data | 128.89 KiB |
| assets/ImagesLuck/我的/个人数据框.png | image | 114.40 KiB |
| assets/imagesKK/游戏大厅/底部底板.png | image | 72.92 KiB |
| assets/ImagesLuck/启动图标.png | image | 68.14 KiB |
| assets/ImagesXYPK/推广/11.png | image | 61.06 KiB |
| assets/ImagesXYPK/加入房间/弹窗.png | image | 57.16 KiB |
| assets/ImagesLuck/动画/导航按钮动画/MainButton_backup_tex.png | image | 49.71 KiB |
| assets/imagesKK/游戏大厅/状态2.png | image | 42.19 KiB |
| assets/imagesKK/游戏大厅/状态1.png | image | 42.19 KiB |
| assets/Images/奖池/奖池bg.png | image | 42.12 KiB |
| assets/ImagesLuck/游戏内/底池背景.png | image | 36.72 KiB |
| assets/ImagesLuck/战绩详情/房间信息底板.png | image | 33.72 KiB |
| assets/Images/奖池/pxjlbl.png | image | 32.64 KiB |
| assets/imagesKK/公用/背景1.png | image | 32.57 KiB |
| assets/imagesKK/游戏大厅/大中小底框.png | image | 30.60 KiB |
| assets/imagesKK/游戏大厅/帽子.png | image | 29.48 KiB |
| assets/ImagesLuck/奖池/框1.png | image | 29.07 KiB |
| assets/ImagesXYPK/转盘/动画/zhuanpan_dongxioa_ske.json | data | 28.79 KiB |
| assets/imagesKK/游戏大厅/大厅.png | image | 25.98 KiB |
| assets/ImagesXYPK/转盘/框.png | image | 25.64 KiB |
| assets/imagesKK/游戏大厅/大厅2.png | image | 20.92 KiB |
| assets/ImagesLuck/动画/报奖-old/ui_bigwin_ske.json | data | 19.49 KiB |
| assets/Images/表情图标/愤怒拿刀.png | image | 19.24 KiB |
| assets/ImagesLuck/战绩详情/数据底框.png | image | 19.16 KiB |
| assets/temp/选择银行.prefab | prefab | 19.11 KiB |
| assets/ImagesXYPK/转盘/2.png | image | 18.57 KiB |
| assets/ImagesLuck/游戏内/额外/奖池底框.png | image | 18.20 KiB |
| assets/ImagesLuck/我的/头像.png | image | 18.12 KiB |
| assets/imagesKK/游戏大厅/图标.png | image | 17.68 KiB |
| assets/imagesKK/游戏大厅/排行榜.png | image | 16.51 KiB |
| assets/ImagesLuck/表情/流汗/3_3.png | image | 16.29 KiB |
| assets/ImagesLuck/表情/流汗/3_0.png | image | 16.29 KiB |
| assets/ImagesLuck/游戏内/充值.png | image | 16.25 KiB |
| assets/ImagesXYPK/代理/提取记录按钮.png | image | 16.13 KiB |
| assets/ImagesXYPK/转盘/按钮灰.png | image | 16.11 KiB |
| assets/ImagesXYPK/转盘/按钮.png | image | 16.09 KiB |
| assets/ImagesLuck/我的/按钮框.png | image | 15.85 KiB |

## 已按动态加载保留的资源

下列资源即使没有被场景/Prefab UUID 直接引用，也不会列入待清理名单：

- `UI/<面板名>`、`Prefabs/<对象名>` 等可达脚本中的字面量加载；
- `avatars/头像01..20`；
- `pk2/*` 牌面、`zuotype/*` 牌型/牌背；
- `表情2/*`、`道具/*`、`Audio/道具声音/*`；
- `Audio/eff/*` 牌局动作音效；
- `other/<服务端状态值>`、`other/状态_*`、`other/背景_*` 房间/记录状态图；
- `other/drh/*` 牌桌操作图、`other/牌谱/*` 回顾牌谱图。
- 全部 TypeScript/JavaScript（Cocos 合包、全局 QR/CryptoJS 与 KBEngine 动态类）。

| 目录 | 文件数 | 当前构建归属体积 |
|---|---|---|
| assets/resources/pk2 | 171 | 9.16 MiB |
| assets/resources/zuotype | 25 | 4.11 MiB |
| assets/resources/Audio | 27 | 3.50 MiB |
| assets/resources/avatars | 20 | 2.70 MiB |
| assets/resources/UI | 21 | 583.39 KiB |
| assets/resources/project.manifest | 1 | 421.20 KiB |
| assets/resources/other | 44 | 375.49 KiB |
| assets/resources/Prefabs | 35 | 169.00 KiB |
| assets/resources/道具 | 23 | 21.80 KiB |
| assets/resources/表情2 | 10 | 5.36 KiB |
| assets/resources/version.manifest | 1 | 284 B |
| assets/scripts | 59 | 0 B |
| assets/migration | 2 | 0 B |

动态保留完整名单及触发原因：`reports/cocos-dynamic-assets-retained-2026-07-29.csv`

## 审计边界与风险

- `assets/resources` 会被 Cocos 整包构建；因此其中未被运行链命中的文件仍会
  真实进入包体，是本次最主要的候选来源。
- 已处理当前代码中可见的字符串拼接和编号型动态加载，但服务端如果能下发任意
  新资源名、或原生层通过文件名直接访问资源，静态审计无法百分之百证明未用。
- `login - 001.fire` 被视为测试/备用场景，不作为产品入口；只被它引用的资源
  可能进入候选名单。
- 当前结果对应现有 `build/jsb-link/assets` 快照。以后重新构建、改大厅或改牌桌
  后应重新运行脚本。
- 下一步若要清理，建议先把候选移到项目外隔离目录，再完整构建并回归登录、
  大厅所有入口、牌桌、战绩、钱包、管理功能、表情/道具/音效和三端语音；不要
  直接永久删除。

## 构建中未归属到单个源文件的主要内容

| 构建文件 | 逻辑体积 |
|---|---|
| main/index.jsc | 294.21 KiB |
| resources/config.json | 74.86 KiB |
| internal/import/09/0967b326a.json | 56.36 KiB |
| main/config.json | 4.90 KiB |
| resources/native/56/567dcd80-8bf4-4535-8a5a-313f1caf078a.png | 1.64 KiB |
| resources/native/73/73a0903d-d80e-4e3c-aa67-f999543c08f5.png | 1.39 KiB |
| internal/config.json | 1.33 KiB |
| resources/native/99/99170b0b-d210-46f1-b213-7d9e3f23098a.png | 1.15 KiB |
| resources/native/cf/cfef78f1-c8df-49b7-8ed0-4c953ace2621.png | 1.11 KiB |
| resources/native/b4/b43ff3c2-02bb-4874-81f7-f2dea6970f18.png | 1.09 KiB |
| resources/native/e8/e851e89b-faa2-4484-bea6-5c01dd9f06e2.png | 1.06 KiB |
| resources/native/d2/d29077ba-1627-4a72-9579-7b56a235340c.png | 1.04 KiB |
| resources/native/71/71561142-4c83-4933-afca-cb7a17f67053.png | 1.03 KiB |
| resources/native/02/0291c134-b3da-4098-b7b5-e397edbe947f.png | 1.02 KiB |
| internal/index.jsc | 320 B |
| resources/index.jsc | 320 B |
| resources/import/e7/e7aba14b-f956-4480-b254-8d57832e273f.json | 205 B |
| resources/import/90/90004ad6-2f6d-40e1-93ef-b714375c6f06.json | 205 B |
| resources/import/29/29158224-f8dd-4661-a796-1ffab537140e.json | 205 B |
| resources/import/88/88e79fd5-96b4-4a77-a1f4-312467171014.json | 205 B |

## 工具与复查方式

重新审计：

```bash
python3 tools/audit_cocos_unused_assets.py
```

扫描到源资源总计 **1684 个 / 67.15 MiB**。
