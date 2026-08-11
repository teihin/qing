#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
admin_url="http://127.0.0.1:2019"

for _ in {1..30}; do
  if curl --fail --silent --max-time 1 "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --fail --silent --max-time 2 "${admin_url}/config/apps/http/servers/srv0/routes/" >/dev/null; then
  echo "Caddy管理接口不可用" >&2
  exit 1
fi

install_route() {
  local route_id="$1"
  local route_file="$2"
  if curl --fail --silent --max-time 2 "${admin_url}/id/${route_id}" >/dev/null; then
    return 0
  fi
  curl --fail --silent --show-error \
    -X PUT \
    -H "Content-Type: application/json" \
    --data-binary "@${route_file}" \
    "${admin_url}/config/apps/http/servers/srv0/routes/0"
}

install_route "qing_chattool_proxy" "${deploy_dir}/caddy-proxy-route.json"
install_route "qing_chattool_redirect" "${deploy_dir}/caddy-redirect-route.json"
echo "ChatTool Caddy路由已安装"
