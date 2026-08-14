#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
admin_url="http://127.0.0.1:2019"
if ! curl --fail --silent --max-time 2 \
  "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
  exit 1
fi

# Caddy重启后管理API配置会回到基础Caddyfile；缺失时重新插入，不覆盖其他站点。
ensure_route() {
  route_id="$1"
  route_file="$2"
  if curl --fail --silent --max-time 2 "${admin_url}/id/${route_id}" >/dev/null; then
    return 0
  fi

  curl --fail --silent --show-error --max-time 5 \
    -X PUT \
    -H "Content-Type: application/json" \
    --data-binary "@${route_file}" \
    "${admin_url}/config/apps/http/servers/srv0/routes/0"
}

ensure_route \
  "qing_webhome_mobileconfig_headers" \
  "${deploy_dir}/caddy-mobileconfig-route.json"
ensure_route \
  "qing_webhome_entry_cache_headers" \
  "${deploy_dir}/caddy-cache-route.json"
