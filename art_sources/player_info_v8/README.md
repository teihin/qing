# 玩家信息 V8 资源

`player_info_v8_*` 由 `tools/extract_v8_player_info_assets.py` 从唯一确认稿
`05-玩家信息弹窗.png` 提取；`tools/migrate_v8_player_info.py` 只负责正式
`panelUserInfo.prefab` 的节点几何与资源绑定。

- `panel`、`button`、`stats`、`prop_card` 是紧凑九宫格纹理；统计分隔线是独立
  `grid_line` 节点，不能烘焙进 `stats`。
- 六个 `icon_*` 是确认稿中的透明道具切图；原旧道具图不再用于本弹窗。
- 资源均保持 `trimType: none`，供 Creator 重新导入。
- 19 张 PNG 合计 272 KB、213,771 像素，RGBA 运行纹理约 0.815 MiB。

## 拆分与复用

| 资源 | 纹理尺寸 | 使用方式 |
|---|---|---|
| panel | 128×384 | 九宫格，48px 边界 |
| button | 104×74 | 语音回放、赠送和充值共用，32px 边界 |
| stats | 128×160 | 九宫格，32px 边界；分割线另设节点 |
| prop_card | 80×96 | 六道具共用，20px 边界 |
| title / divider / close / copy / mic | 按原稿分别直切 | 保持比例，不随九宫格拉伸 |
| avatar_frame | 132×132 | 原稿圆框修成正圆，真实头像仍动态加载 |
| icon_* | 6 张透明切图 | 保留原协议节点名，价格为独立 Label |
| toggle_on / toggle_off | 51×34 | checked 表示屏蔽语音，显示灰色关闭态 |

九宫格从确认稿保留边角与高光，清理中部文案后压缩空白区域；不会将完整弹窗、
示例人物、示例统计值或整块道具区打成一张运行纹理。

迁移写入 Cocos 2.4 的 `_trs`，新增 Label 使用 `_N$string` 等正式序列化字段。
资源提取与 Prefab 迁移分为两个命令，修改布局时不必重新写图：

```sh
python3 tools/extract_v8_player_info_assets.py
python3 tools/migrate_v8_player_info.py
```

运行后需让 Creator 导入资源；网页 Recompile 本身不能代替 AssetDB 导入。
