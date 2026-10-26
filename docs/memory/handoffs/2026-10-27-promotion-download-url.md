# 游戏推广下载地址接入后台（XuanManager）

- 日期：2026-10-27
- 目录：`/Volumes/SSD/qing`（分支以 `git status` 实时结果为准，本次未提交、未部署）
- 目标：游戏内「游戏推广」分享页显示的「游戏下载地址」原先只有客户端默认值（`http://www.baidu.com`），
  后台没有维护入口。本次在后台加一个配置页，直接读写那条哈希配置。

## 数据链路（已核对代码）

- 客户端 `ConfigManager.downloadurl` 默认 `http://www.baidu.com`（`assets/scripts/logic/ConfigManager.ts:56`）。
- 登录进大厅时 `UpdateDefConfig()` 执行 `GetOneHashKey("下载url")`（同文件 96 行），
  回包 context `查询哈希_下载url` 时明文写回 `downloadurl`（226–229 行，不做 base64）。
- 推广面板 `panelMain.OpenPromotionPanel()` 把 `V7推广链接` 设成该值（`panelMain.ts:328`），
  也就是截图里「游戏下载地址」那一行；「复制推广地址」按钮复制的也是它（971 行）。
- 所以配置项 = 游戏端哈希表 `kbedm.usr_hash_info`，`hash_key='下载url'`，内容为明文 http(s) 地址。

## 改动

后端（`XuanManager/server`）：

- `migrations/029_promotion_download_url.sql`：模块 39「游戏推广下载地址」（`/configuration/promotion-download`）
  + 权限 `configuration.promotion_download.view/.update`（授权给角色 1），不新建表。
- `internal/api/promotion_download_url.go`：`GET/PUT /api/configuration/promotion-download`。
  读第一条 `下载url`；写前按原行快照、写后回读校验、失败按原 id 逐行恢复（MyISAM 无回滚），写审计
  `configuration.promotion_download.update`；只接受完整 `http(s)://` 地址（拒绝相对路径、`javascript:`、空格、含账号密码）。
- `internal/api/server.go`：注册上述两条路由（需要登录与对应权限，PUT 需 CSRF + 同源）。
- `internal/api/promotion_download_url_test.go`：URL 校验用例 + 键名/默认值与客户端一致性断言。

前端（`XuanManager/web`）：

- `pages/PromotionDownloadPage.tsx`：单字段页面（当前值、哈希键、上次修改、重复行提示、确认勾选保存）。
- `types.ts`：`PromotionDownloadURLState`；`App.tsx`：路由分支；`components/Layout.tsx`：`downloads` 图标。

与之无关、本次**没有**改：`WebHome/`（推广下载站及其 `site-config.json`、`.mobileconfig`、上传脚本）、
Caddy 路由、客户端代码。后台只维护哈希值，APK 文件仍由 `4上传推广网站.command` 上传。

## 已验证（本地）

- `go build ./...`、`go vet ./...`、`go test ./...` 全过。
- `tsc -b`、`eslint src`、`vite build`（产物 `web/dist`）全过。

## 未验证

- 迁移 029 未在 MySQL 5.7 实跑；本机无 MySQL，后台页面未做登录态真实读写。
- 未验证客户端真机：改值后重新登录进大厅，推广页是否显示新地址。
- 库里若已有多条 `下载url`，保存会统一改成新值（页面有提示），未做真实数据核对。


## 部署（2026-10-27 00:12，正式 8891）

- 二进制：Linux amd64 静态编译 8,655,032 B，sha256 `90033117c408609b5196f64d8ff78b86ab8708f2351c48709d690ddd6c82675e`，本地与服务器上传后一致，`/proc/<pid>/exe` 哈希一致。
- 前端：新 bundle `index-BOlrWaQn.js`（503,340 B），CSS 仍为 `index-CqfIDap7.css`；旧 `index-BdazyoDN.js` 保留在 `web/assets`，避免已打开的标签页资源 404。
- 回滚件：`/www/html/.xuanmanager/backups/xuanmanager.20261027-0012-promodl-rollback/`（旧二进制 8,634,552 B、旧 `index.html`、旧 assets）。
- 切换方式：`stop.sh` → 换 `bin/xuanmanager` → 解包覆盖 `web/` → `start.sh`；`/api/health` 200，`XuanManager started`。
- 迁移：`mgr_schema_migration` 已记录 `029_promotion_download_url.sql`；`mgr_module` id=39 路由 `/configuration/promotion-download`；权限 3901/3902 已入库并授 role 1。
- 接口：`GET /api/configuration/promotion-download` 本机与公网均 **401**（路由存在、需登录）；public index 200 且引用新 JS，JS 200。
- 数据现状：`kbedm.usr_hash_info` 中 `hash_key='下载url'` **0 行**，页面显示内置默认 `http://www.baidu.com`，需后台登录后点一次保存才落库。
- 上传包与本地临时文件已清理，`/www/html/_incoming` 为空。

## 下一步（需用户确认）

1. 构建 Linux 产物：`cd XuanManager/web && npm run build`；`cd ../server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o bin/xuanmanager ./cmd/xuanmanager`。
2. 上传并重启正式 8891（保留 `backups/` 回滚目录），确认日志跑完迁移 029、`/api/health` 正常。
3. 后台登录 → 系统配置 → 游戏推广下载地址，改一次并核对 `usr_hash_info` 回读与审计。
4. 玩家端重新登录进大厅，确认「我的 → 推广二维码」的「游戏下载地址」已变成新值。验收细则见
   `XuanManager/部署说明.md` 第 33 条。
