# 2026-10-24 俱乐部快速注册无邀请码

## 目录/分支

- 根目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 本轮未提交 Git；工作区原有俱乐部成员页、入会接口及设计稿修改均保留。

## 改动

- `assets/resources/UI/panelLogin.prefab`
  - 注册资料框改用 `assets/V7/register_modal_panel_club_exact.png`。
  - 邀请码节点停用；四个输入行、防盗号、状态、确认注册和安全提示整体上移。
  - 头像预览与头像圆环改为 180×180，填满背景头像框。
- `assets/scripts/UI/panelLogin.ts`
  - 删除邀请码输入绑定、校验和请求字段，保留昵称、账号、密码、确认密码、防盗号、头像和状态逻辑。
- `XuanManager/server/internal/api/registrations.go`
  - 俱乐部模式允许缺省邀请码并跳过上级关系查询；携带邀请码时继续校验和绑定。
  - 标准模式仍要求邀请码，空上级链写入 `upper_guuid/upper2_guuid/upper3_guuid`。
- `XuanManager/server/internal/config/config.go`
  - 新增 `XUAN_GAME_MODE`，默认为 `club`，只接受 `club` 或 `standard`。
- `.env.example`、运行环境示例、后台接口文档和部署说明同步更新。

## 验证

- 新背景图已人工查看，邀请码区域已从整张底图清除，四行和底部控件位置符合确认稿。
- Prefab 静态检查确认邀请码节点 inactive、头像为 180×180、各节点坐标已上移、背景 SpriteFrame 已指向新资源。
- `panelLogin.ts` 使用项目现有 TypeScript 运行库 `transpileModule` 检查通过。
- `XuanManager/server` 执行 `go test ./...` 通过。
- 尚未做 Creator 重新导入、客户端构建、真机注册或真实数据库联调。
