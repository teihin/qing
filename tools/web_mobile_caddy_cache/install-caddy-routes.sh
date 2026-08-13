#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
admin_url="http://127.0.0.1:2019"

if ! curl --fail --silent --max-time 2 \
  "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
  exit 1
fi

install_route() {
  local route_id="$1"
  local route_file="$2"

  if curl --fail --silent --max-time 2 "${admin_url}/id/${route_id}" >/dev/null; then
    return 0
  fi

  curl --fail --silent --show-error --max-time 5 \
    -X PUT \
    -H "Content-Type: application/json" \
    --data-binary "@${route_file}" \
    "${admin_url}/config/apps/http/servers/srv0/routes/0"
}

# 后插入的路由位于索引0；先资源、后入口，使入口no-store保持最高优先级。
install_route "qing_web_mobile_assets_immutable" "${deploy_dir}/caddy-assets-route.json"
install_route "qing_web_mobile_index_no_store" "${deploy_dir}/caddy-index-route.json"
