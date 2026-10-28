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
