#!/bin/bash
# 部署本次「后台按俱乐部/联盟授权暗抽」改动到正式 XuanManager 8891。
# 只包含本次暗抽改动；其他未提交的 XuanManager 改动未打包。
set -euo pipefail

ART="$(cd "$(dirname "$0")" && pwd)"
HOST="154.37.155.17"
PORT="2233"
USER="client_update"
KEY="$HOME/.ssh/id_ed25519_newserver"
REMOTE="/www/html/.xuanmanager"
TS="$(date +%Y%m%d-%H%M%S)"
SSH=(ssh -i "$KEY" -p "$PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 "$USER@$HOST")
SCP=(scp -i "$KEY" -P "$PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15)

[ -x "$ART/xuanmanager" ] || { echo "missing $ART/xuanmanager" >&2; exit 1; }
[ -f "$ART/web.tar.gz" ] || { echo "missing $ART/web.tar.gz" >&2; exit 1; }

echo "[1/4] preflight ssh"
"${SSH[@]}" "test -d '$REMOTE' && test -x '$REMOTE/start.sh' && test -x '$REMOTE/stop.sh' && echo ok"

echo "[2/4] upload"
"${SCP[@]}" "$ART/xuanmanager" "$USER@$HOST:$REMOTE/xuanmanager.dark-setting.upload"
"${SCP[@]}" "$ART/web.tar.gz" "$USER@$HOST:$REMOTE/web.dark-setting.upload.tar.gz"

echo "[3/4] deploy"
"${SSH[@]}" "TS='$TS' bash -s" <<'EOF'
set -euo pipefail
cd /www/html/.xuanmanager
mkdir -p "backups/$TS"
cp -p bin/xuanmanager "backups/$TS/xuanmanager"
cp -a web "backups/$TS/web"

rollback() {
  echo "deploy failed, rolling back" >&2
  install -m 755 "backups/$TS/xuanmanager" bin/xuanmanager
  rm -rf web
  if [ -d "web.previous-dark-setting-$TS" ]; then
    mv "web.previous-dark-setting-$TS" web
  else
    cp -a "backups/$TS/web" web
  fi
  ./start.sh || true
}
trap 'rollback' ERR

./stop.sh
install -m 755 xuanmanager.dark-setting.upload bin/xuanmanager
rm -rf "web.new.$TS"
mkdir "web.new.$TS"
tar -xzf web.dark-setting.upload.tar.gz -C "web.new.$TS"
mv web "web.previous-dark-setting-$TS"
mv "web.new.$TS" web
rm -f xuanmanager.dark-setting.upload web.dark-setting.upload.tar.gz

./start.sh
sleep 1
health="$(curl -fsS http://127.0.0.1:8891/api/health)"
echo "health: $health"
unauth="$(curl -s -o /dev/null -w '%{http_code}' -X PUT http://127.0.0.1:8891/api/game/clubs/820084/dark-setting)"
echo "unauth PUT dark-setting: $unauth"
case "$unauth" in
  401|403) ;;
  *) echo "unexpected unauth status: $unauth" >&2; false ;;
esac
trap - ERR
echo "binary: $(sha256sum bin/xuanmanager)"
ls -1 web/assets | tail -4
tail -n 20 logs/xuanmanager.log
EOF

echo "[4/4] done"
echo "rollback: /www/html/.xuanmanager/backups/$TS + web.previous-dark-setting-$TS"
