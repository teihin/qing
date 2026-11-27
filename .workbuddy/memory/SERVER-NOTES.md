# SERVER-NOTES.md —— 154.37.155.17 运维踩坑（客服 / 运营 / 音频三服务）

> 从 `MEMORY.md` 拆出，只放服务器操作细节；跨任务结论留在 MEMORY.md。
> 访问：`ssh -p 2233 -i ~/.ssh/id_ed25519_newserver client_update@154.37.155.17`

## 环境事实（先记住，能省一半排查时间）

- **没有 `ss` 命令，也没有可用的 systemd**（`systemctl` 直接报 `Failed to get D-Bus connection`）。
  - 查端口：`(echo >/dev/tcp/127.0.0.1/PORT) && echo 通`，或 `ps aux`。
  - **`ss -ltn | grep 端口` 一定回 "NOT LISTENING"**，据此判服务挂了会误判（2026-10-21 就误判过 MySQL）。
- `/var/log/messages`、`dmesg` 普通账号读不到，OOM 之类查不着，别死磕。
- 机器会不定期重启（2026-09-28 23:06 一次）。`uptime -s` 看开机时间。

## 三个服务的启动机制（同一套模板）

`/www/html/.chattool`、`/www/html/.xuanmanager`、`/www/html/.audio-server`

- crontab 里只有 **`@reboot <dir>/start.sh`**（客服站另有每分钟 `install-caddy-routes.sh` 装 Caddy 路由）。
- `start.sh` → `nohup supervise.sh &` → `supervise.sh` 里 `while true` 拉起真正二进制，3 秒重试。
- **`@reboot` 只给一次机会**：重启时若拉起失败，或进程中途死亡，没有任何机制再救 → 永久宕机。

### 致命坑：pid 文件跨重启残留 + pid 复用

`start.sh` 原本用「pid 文件存在 + `kill -0`」判存活。机器重启后 `run/supervisor.pid` 里的旧 pid
极可能被系统启动期的其它进程复用，`kill -0` 返回成功 → 误判「已在运行」→ `exit 0` → 再也起不来。

- 实证（2026-09-27 → 10-21 宕机 24 天）：pid 文件 = **1134**，重启后同机 audio supervise = 1119、
  xuanmanager supervise = 1157，1134 正好被夹在中间被别人占了。
- 正确判法：核对 `/proc/<pid>/cmdline` 里确实是 `supervise.sh`。
- **三个服务已于 2026-10-21 全部修好并加 `* * * * * start.sh` 看门狗**（日志各自 `logs/watchdog.log`，
  过滤掉 "已在运行"/"already running"）。任意进程被 kill 后约 60 秒内自动拉起，已实测。
- `install-cron.sh` 用 `sed -i "/qing-<服务>-/d"` 清理旧条目，**新增条目注释必须以该前缀开头**，否则重复安装会积累。

## 客服站（ChatTool）

- 线上：静态 `/www/html/.chattool/web`，二进制 `bin/chattool`，配置 `deploy/centos7-user/runtime.env`，
  服务 `127.0.0.1:8893`，Caddy 对外 `http://154.37.155.17/chattool/`。
- **502 = 后端 8893 挂了**（Caddy 还活着）；裸 IP 根返回 **404 是正常的**。
- 前端产物不入库，Go 进程动态读盘 → 换静态文件不用重启服务。
- 部署流程见技能 `chattool-web-deploy`。

## 自杀陷阱

- `pkill -9 -f ".../chattool"` 会匹配到 **ssh 自己那条 `bash -c` 命令行**，把自己杀掉，SSH 断开 exit 255。
  改用 `ps -C chattool -o pid=` 精确取进程名，或先读 pid 文件再用变量 kill。

## XuanManager（运营后台）

- 部署 `/www/html/.xuanmanager/`：`bin/xuanmanager`、`run.sh`（`source runtime.env`）、`supervise.sh`、`start.sh`（幂等）、
  cron 每分钟 watchdog。**前端静态目录是 `XUAN_STATIC_DIR=/www/html/.xuanmanager/web`** ——
  `/www/html/mgr` 是已废弃的旧站（Oct 13 那份），`/www/html/xuanmanager` 不存在；
  Caddy 只有 `handle_path /xuanmanager/* → 127.0.0.1:8891` 一条反代，静态文件由 Go 按请求读盘，换目录不用重启。
- 前端发布：本地 `vite build` → tar 上传 → `web → web.prev`、`web.new → web` 两跳切换（别直接覆盖，回滚方便）。
- 判「是否新二进制」：`sha256sum /proc/<pid>/exe` 或看新路由返回 401 还是 404。
  `stat -c %i /proc/<pid>/exe` 得到的 inode 会和磁盘文件不一致（内核语义），别拿它当判据。
- **多行 ssh 脚本会被服务端直接掐断**（`Connection closed by ... port 2233`，脚本一行都没跑，像是「什么都没发生」）。
  同一批操作拆成几条单行 ssh 就正常；遇到空结果先怀疑连接被掐。
- 接入令牌（`mgr_automation_setting.agent_enroll_token`）现在是**可选**的，不配就是开放注册；
  关掉：`DELETE /api/automation/agent-token`（或直接删这行 setting）。
- **cron watchdog 每分钟 `start.sh`**：kill 后 2 秒内它就能把**旧二进制**拉起来，`./start.sh` 会报
  "already running" 让人误判。稳妥做法是一条命令里做完 `kill → mv → ./start.sh → sha256sum /proc/<pid>/exe`，
  发现 sha 不对就再 kill 一次重启。

## 重复 supervisor 抢 8891（2026-11-25 踩过）

- `stop.sh` **只杀 `run/supervisor.pid` 里那一个** supervisor。如果这个 pid 文件过期（之前手工 kill 过、
  或 start.sh 在 cron watchdog 跑到一半时并发启动），就会留下**两个 `supervise.sh`**：
  一个占着 8891 正常服务，另一个每 3 秒拉起子进程、子进程 bind 失败 →
  `xuanmanager.log` 里刷 `server stopped unexpectedly / listen tcp 127.0.0.1:8891: bind: address already in use`，
  外部请求出现 **502**（表现为 Worker 侧「实时通道断开 / 心跳失败 502」，约 20 秒后自愈）。
- 处理：`ps -eo pid,ppid,cmd | grep -E "[.]xuanmanager/(supervise|bin)"` 看清有几对，
  杀掉多余的那一对（supervisor + 它自己的子进程），把存活 supervisor 的 pid 写回 `run/supervisor.pid`。
- 判据：只应存在 **1 个 supervise.sh + 1 个 bin/xuanmanager**，且日志不再刷 bind 失败。

## 正式服 8.153.70.197（与测试服 154.37.155.17 不是一台）

- 登录同测试服：`ssh -p 2233 -i ~/.ssh/id_ed25519_newserver client_update@8.153.70.197`
  （`~/.hot-update-upload-config.prod.json` 里记的就是这台）。
- **后台部署根目录是 `/www/.xuanmanager`**（注意没有 `html`），测试服才是 `/www/html/.xuanmanager`。
  脚本一族（start/stop/supervise/run/runtime.env/web/bin）结构相同，别拿错路径。
- Caddy：`/etc/caddy/Caddyfile` 只有一个站点块 `:28800`，`handle_path /xuanmanager/* → 127.0.0.1:8891`
  （剥前缀），静态站 `/up/*` 与 `/www/html` 同机；`install-caddy-route.sh` 在这台是 `exit 0` 的空脚本
  （往共用 srv0 挂路由会给整站启自动 HTTPS，把纯 HTTP 打死）。
- **公网入口只能从白名单网络访问**：本机直连 `8.153.70.197:28800` 和域名都连不上（000），
  但从 `/var/log/caddy/web-access.log` 的 `"host"` 字段能看到真实 Host：
  `72679781.tjkdplus.com.cname.hcnamedns.com:28800`。
- **数据库是远程的**（`XUAN_DB_HOST=172.22.161.126`），本机**没有 mysql 客户端**，
  想核对迁移/表结构不能用 `mysql` 命令；只能靠「迁移失败会 `os.Exit(1)`」这条：
  服务起来了 = 迁移都执行成功了。
- 正式服后台二进制和测试服同为 `codex/club-ui` 线（不是 main）；`main` 停在 2026-10-24，
  缺 honor-rank / club-perf 等路由，别把 main 的构建往上发。

## 从 MEMORY.md 拆入（2026-11-25）：数据库 / 原生构建

- **`webcm_user` 没有 `LOCK TABLES` 权限**：`mysqldump` 备份直接 `mysql <` 导入会 `ERROR 1044`
  （每张表都带 `LOCK TABLES ... WRITE`）。先 `sed -e "/^LOCK TABLES/d" -e "/^UNLOCK TABLES/d"` 过滤再导；
  mysql 客户端没有跳过它的开关，且遇错即停、前面 `DROP/CREATE` 已生效 → 必须整份重跑。
- **正式服 pymysql 读环境变量要剥引号**：`runtime.env` 里 `XUAN_DB_PASSWORD="..."` 带引号，
  直接把值拼进 `pymysql.connect` 会 `1045 Access denied`；解析后要 `.strip().strip('"').strip("'")`。
- **Android（`build/jsb-link/.../proj.android-studio`）**：Gradle project cache 必须在持久目录
  （现为 `~/Library/Caches/qing-android-gradle-project-cache`，工程内 `.gradle` 是软链接，`gradlew` 里
  另有 `--project-cache-dir`，两处要一致；指过 `/private/tmp` 重启被清 → 软链接悬空报
  `Cannot create directory .../.gradle/8.9/fileHashes`）。
- **Gradle daemon 堆必须显式调大**：`gradle.properties` 的
  `org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m`（默认 512m，release 打包 R8+资源压缩+双 ABI 会 OOM，
  AS 只报 `PackageAndroidArtifact$IncrementalSplitterRunnable`）。**判别口诀：先看工程目录有没有
  `java_pid<daemonPid>.hprof`**（配了 `+HeapDumpOnOutOfMemoryError`，只有真 OOM 才落堆转储；这些 hprof 是证据别删）。
- **`proj.android-studio` 是 Cocos 生成的**（模板 `cocos2d-x/templates/js-template-link/...`，那行 jvmargs 在模板里是注释的 — OOM 根子）。
  **在 Creator 里重新构建原生 Android/iOS 会覆盖本目录**，把 4G 堆、`.gradle` 软链接、`gradlew`/`build.gradle` 的 hack 全冲掉；
  要持久化就镜像到 `build-templates/<构建输出目录名>/`（`build-templates/web-mobile/` ↔ `build/web-mobile`，原生 link 用
  `build-templates/jsb-link/...`），**软链接没法靠模板复制**。日常 1/2/3/4 号 `.command`（热更/上传）不会重建原生工程。
- **iOS 原生工程已做持久化**：`proj.ios_mac/ios/*`（QingVoiceBridge / QingAppServices / 各 Bridge / AppController.mm / Info.plist）
  与 `8L.xcodeproj/project.pbxproj` 已镜像到 `build-templates/jsb-link/frameworks/runtime-src/proj.ios_mac/`；
  重建后原生行为异常（语音/分享/保存图片/音频会话）先跑 `python3 tools/ios/check_ios_native.py`，再 `--restore` 恢复（会先备份）。
  pbxproj 里 bundle id `com.fireball.qing`、team `7Q54T2MBWP` 是写死的，换 Creator 大版本后别直接覆盖。
