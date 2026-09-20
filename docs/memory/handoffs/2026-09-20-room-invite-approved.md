# 房间邀请批准稿实施

- 目录 `/Volumes/SSD/qing`，分支 `main`；用户确认房间邀请效果图后授权实施，未授权提交或推送。
- 唯一新依据：`design-previews/效果图V8-new/04-登录与弹窗/房间邀请-20260920.png`。仅房间邀请替代先前通用温馨提示方案。
- 正式修改：`assets/resources/UI/panelRoomInvite.prefab`、`assets/scripts/UI/panelRoomInvite.ts`；9张独立PNG及meta位于 `assets/V7/游戏内/room_invite_approved_*`。
- 保留动态邀请人、房间号、底皮、人数、服务端说明；保留忽略、前往房间及本次登录不再弹出，新关闭按钮等同忽略。旧大弹窗生成器已排除房间邀请，避免覆盖新稿。
- 来源与切片记录：`art_sources/room-invite-approved/README.md`；提取/装配工具为 `tools/extract_room_invite_approved.py` 和 `tools/apply_room_invite_approved.py`。
- 静态原图切片在排除5个动态孔后，643811个静态像素与批准稿一致；圆角外透明。
- Creator导入核验：9张PNG与library导入像素一致；Prefab 64个序列化对象与导入版本一致，仅导入器补充根资源名。新增勾选图标UUID冲突已修复，纹理/SpriteFrame/SVG分别唯一。
- `tools/room_invite_logic_mock_regression.js`执行实际TypeScript类（去类型、依赖mock），覆盖自定义数据、无效JSON、过期邀请、忽略/前往/关闭和抑制标志，检查通过。
- 布局离线预览位于 `art_sources/room-invite-approved/previews/`，直接读取正式Prefab生成750×1334/1624两屏，房间号按正式BMFont绘制。离线渲染器不模拟Label SHRINK，长邀请人示例可能截断；正式Label保留overflow=2，真实Cocos长文显示仍待验。不等同真实Cocos渲染或在线回包。
- 未执行真实账号邀请入房、构建、真机或发布；用户正在编辑其他Prefab，未切换或保存用户当前编辑页。保留其他任务Scene、panelMain与DrhPlayerLogic等修改。

## 用户实机反馈后的修正

- 下方重复的邀请文案已在正式Prefab隐藏，并删除脚本赋值；生成器、mock及离线预览同步更新。
- 底皮/人数显示双横线仍在排查：当前发送/解析V2字段及新Label赋值一致，已编译JS也包含新字段；未取得截图当时的运行脚本与邀请消息，不能直接认定服务端数据缺失。
- 独立IAB的真实Cocos引擎实例化正式Prefab并执行当前组件start，测试数据实际读回底皮1/3、人数3/8，证明新脚本赋值有效；未获取用户原页面运行代码，旧脚本缓存仍为待确认假设。
- 本次隐藏文案的源Prefab与编译脚本已更新，但library当前仍保留旧active=true；需Creator重新导入目标Prefab后刷新用户页面，不能把先前导入通过算到本次改动。
