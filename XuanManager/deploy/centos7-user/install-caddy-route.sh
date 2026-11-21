#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
admin_url="http://127.0.0.1:2019"
route_file="${deploy_dir}/caddy-route.json"

for _ in {1..30}; do
  if curl --fail --silent --max-time 1 "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent --max-time 2 "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
  echo "Caddy admin API is unavailable" >&2
  exit 1
fi

# 玩家付款页走独立前缀 /pgw（不剥离），与后台 /xuanmanager 分开。
# 老部署里这条路由可能只匹配 /xuanmanager/*，这里补齐，避免线上付款页 404。
if curl --fail --silent --max-time 2 "${admin_url}/id/qing_xuanmanager_proxy" >/dev/null; then
  curl --fail --silent --show-error \
    -X PATCH \
    -H "Content-Type: application/json" \
    --data '["/xuanmanager/*","/pgw","/pgw/*"]' \
    "${admin_url}/config/apps/http/servers/srv0/routes/5/match/0/path" >/dev/null || true
  echo "XuanManager Caddy route is already installed"
  exit 0
fi

curl --fail --silent --show-error \
  -X PUT \
  -H "Content-Type: application/json" \
  --data-binary "@${route_file}" \
  "${admin_url}/config/apps/http/servers/srv0/routes/0"

echo "XuanManager Caddy route installed"
