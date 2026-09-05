# 历史原文摘录：GitHub 与 SSH

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 593–606 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## GitHub 与 SSH

- XuanManager 正式服务器 SSH 部署连接固定使用 `client_update@154.37.155.17:2233`，本机身份文件为 `~/.ssh/id_ed25519_newserver`，建议命令：`ssh -i ~/.ssh/id_ed25519_newserver -p 2233 -o IdentitiesOnly=yes client_update@154.37.155.17`。2026-08-11 已实测登录成功，远端身份为 `uid=1000(client_update)`、主目录/落点为 `/www`，并具备 `/www/html/.xuanmanager` 写权限。`webcm_user` 是服务器本机 MySQL 的数据库账号，不能用于 SSH；不得在本文件记录对应密码。

- 2026-07-22 已在本机创建 GitHub Ed25519 密钥，文件名为 `~/.ssh/id_ed25519_github_qing`，并配置为本机访问 `github.com` 所有仓库的默认密钥；私钥不得提交、复制到项目或对外发送。
- GitHub SSH 已验证成功，身份为 `teihin`；远程仓库地址为 `git@github.com:teihin/qing.git`，默认分支为 `main`。远端已有持续提交记录，不再是空仓库。
- 当前活跃 Git 仓库位于 `/Volumes/CCCC/qing`，不是历史挂载 `/Volumes/CB/qing`；开始任务时必须先用 `pwd`、`git status -sb` 和 `git remote -v` 重新确认活动检出。
- 公开仓库提交前已将 `Tool.ts` 的短信平台账号字段和 `MobileManager.ts` 的微信、语音及统计平台配置字段置空；恢复这些功能时必须改用服务端或不入库的安全配置，不得再次硬编码真实凭据。
- `.gitignore` 已排除根目录签名文件、`runtime-src.zip`、macOS 元数据以及既有 Creator 缓存目录，避免敏感文件和生成内容进入仓库。
- 2026-07-22 已完成首次提交并成功推送到 `origin/main`；后续改动应继续先检查敏感信息和大文件，再提交并推送该分支。
- 后续所有 Git 提交说明必须使用中文，并详细写明修改内容；提交正文应按实际情况说明修改原因、涉及模块、关键行为变化、验证结果及未验证风险，不使用“更新”“修复问题”等无法追溯的笼统描述。
- 若本机代理导致 GitHub SSH 22 端口在握手阶段断开，可改走 GitHub 官方 `ssh.github.com:443`；2026-07-22 已按 GitHub 官方公布值核对 Ed25519 主机指纹、写入 `known_hosts` 并验证账号认证和推送成功。不得使用跳过主机校验的方式绕过错误。
- 2026-08-13 再次遇到 Clash Fake-IP 下 `github.com:22` 连接被关闭；使用项目专用密钥访问 `ssh.github.com:443` 验证成功。为让 VS Code 的 `origin/main` 跟踪引用同步更新，应继续以命名远端 `origin` 推送，并仅在单次命令中用 Git URL rewrite 把 `git@github.com:` 映射到 `ssh://git@ssh.github.com:443/`；不要永久改坏仓库远端，也不要跳过主机校验。

