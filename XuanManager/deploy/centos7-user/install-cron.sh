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
crontab "${temporary_file}"
echo "XuanManager startup and route watchdog installed"
