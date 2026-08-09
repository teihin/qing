# 历史美术版本

每个版本保留原项目相对目录，例如 `HisImg/qing/assets/ImagesLuck/...`，并由
`skin-manifest.json` 记录文件与 `.meta` 哈希。恢复时只覆盖图片，不覆盖 Cocos
Creator 的 `.meta`，因此 UUID 和资源引用保持不变。

常用命令（在项目根目录执行）：

```sh
./tools/skin_version.sh list
./tools/skin_version.sh verify qing
./tools/skin_version.sh verify 8L-premium-v1
./tools/skin_version.sh verify 8L-premium-v2
./tools/skin_version.sh verify 8L-premium-v3
./tools/skin_version.sh restore qing --dry-run
./tools/skin_version.sh restore qing
./tools/skin_version.sh restore 8L-premium-v1
./tools/skin_version.sh restore 8L-premium-v2
./tools/skin_version.sh restore 8L-premium-v3
```

- `qing`：8L 换皮前的旧版运行美术。
- `8L-premium-v1`：客户确认的深海蓝绿、铂金银灰高端会所版。
- `8L-premium-v2`：在 v1 基础上按客户效果图校正大厅底部切换条的正式版。
- `8L-premium-v3`：在 v2 基础上移除主页、我的、推广和公共弹层背景中的误加同心圆。
- 恢复前会先校验归档文件和当前 `.meta`；任何哈希不一致都会停止，不会半恢复。
- 新增版本使用 `snapshot <版本名> --targets-file <清单>`，已存在的版本不会被覆盖。
- 清单审计发现额外旧图时使用 `extend <版本名> --targets-file <清单>`；它只补充未登记路径，绝不覆盖已归档原图。
