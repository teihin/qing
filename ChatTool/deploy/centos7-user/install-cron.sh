#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_file="$(mktemp)"
trap 'rm -f "${temporary_file}"' EXIT

if ! crontab -l > "${temporary_file}" 2>/dev/null; then
  : > "${temporary_file}"
fi
sed -i "/qing-chattool-/d" "${temporary_file}"
printf '@reboot %s/start.sh >/dev/null 2>&1 # qing-chattool-server\n' "${deploy_dir}" >> "${temporary_file}"
printf '* * * * * %s/install-caddy-routes.sh >/dev/null 2>&1 # qing-chattool-caddy-routes\n' "${deploy_dir}" >> "${temporary_file}"
crontab "${temporary_file}"
echo "ChatTool启动项和路由看门狗已安装"
