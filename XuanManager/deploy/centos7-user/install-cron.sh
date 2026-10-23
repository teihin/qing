#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_file="$(mktemp)"
trap 'rm -f "${temporary_file}"' EXIT

if ! crontab -l > "${temporary_file}" 2>/dev/null; then
  : > "${temporary_file}"
fi
sed -i "/qing-xuanmanager-/d" "${temporary_file}"
printf '@reboot %s/start.sh >/dev/null 2>&1 # qing-xuanmanager-server\n' "${deploy_dir}" >> "${temporary_file}"
printf '* * * * * %s/install-caddy-route.sh >/dev/null 2>&1 # qing-xuanmanager-caddy-route\n' "${deploy_dir}" >> "${temporary_file}"
# 每分钟存活性看门狗：进程意外退出后自动拉起。@reboot 只给一次机会，
# 没有它则任何一次意外死亡都会变成永久宕机。
printf '* * * * * %s/start.sh 2>&1 | grep -v "already running" >> %s/logs/watchdog.log # qing-xuanmanager-watchdog\n' \
  "${deploy_dir}" "${deploy_dir}" >> "${temporary_file}"
crontab "${temporary_file}"
echo "XuanManager startup, route watchdog and liveness watchdog installed"
