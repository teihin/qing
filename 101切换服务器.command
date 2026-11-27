#!/bin/zsh
# 一键切换客户端服务器环境：1=测试服  2=正式服
# 只修改 assets/scripts/common/GameDef.ts 里的 5 个地址常量，其他文件不动。
# 用法：双击运行后输入 1 或 2；也可在终端里 `./切换服务器.command 1`

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

GAMEDEF="${GAMEDEF_FILE:-$SCRIPT_DIR/assets/scripts/common/GameDef.ts}"
TARGET="$1"

if [[ ! -f "$GAMEDEF" ]]; then
    echo "找不到 $GAMEDEF"
    exit 1
fi

if [[ -z "$TARGET" ]]; then
    /usr/bin/python3 - "$GAMEDEF" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()
def val(name):
    m = re.search(r'(?m)^export const %s:string = "([^"]*)"' % name, src)
    return m.group(1) if m else "(缺失)"
host = val("SERVER_IP")
if host.startswith("154.37.155.17"):
    env = "测试服"
elif "tjkdplus" in host:
    env = "正式服"
else:
    env = "未知"
print("当前环境：%s" % env)
print("  游戏连接   %s : %s" % (val("SERVER_IP"), "20013"))
print("  客服/支付  %s" % val("HHHH"))
print("  注册       %s" % val("REG_HOST"))
PY
    echo
    printf "请输入 1=测试服  2=正式服 : "
    read TARGET
fi

/usr/bin/python3 - "$GAMEDEF" "$TARGET" <<'PY'
import os, re, sys, tempfile

path, arg = sys.argv[1], sys.argv[2].strip()

HOST_TEST = "154.37.155.17"
HOST_PROD = "72679781.tjkdplus.com.cname.hcnamedns.com."

# 正式服保持现有写法（含域名结尾的点），测试服按「连接地址 154.37.155.17，客服/注册端口 80」
ENVS = {
    "1": ("测试服", {
        "WEB_IP": HOST_TEST,
        "SERVER_IP": HOST_TEST,
        "BASE_SERVER_IP": HOST_TEST,
        "HHHH": HOST_TEST + ":80",
        "REG_HOST": HOST_TEST + ":80",
    }),
    "2": ("正式服", {
        "WEB_IP": HOST_PROD,
        "SERVER_IP": HOST_PROD,
        "BASE_SERVER_IP": HOST_PROD,
        "HHHH": HOST_PROD + ":28800",
        "REG_HOST": HOST_PROD + ":28802",
    }),
}

if arg not in ENVS:
    print("输入无效：%r，只能是 1 或 2" % arg)
    sys.exit(2)

name, wanted = ENVS[arg]
src = open(path, encoding="utf-8").read()
out = src
changed = []

for key, value in wanted.items():
    pat = re.compile(r'(?m)^(export const %s:string = ")([^"]*)(")' % key)
    m = pat.search(out)
    if not m:
        print("GameDef.ts 里找不到常量 %s，已中止，文件未改动" % key)
        sys.exit(1)
    if m.group(2) != value:
        out = pat.sub(lambda mm: mm.group(1) + value + mm.group(3), out, count=1)
        changed.append("%s: %s -> %s" % (key, m.group(2), value))

if out != src:
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".gamedef-", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(out)
    os.chmod(tmp, os.stat(path).st_mode & 0o777)
    os.replace(tmp, path)

print("已切换到：%s" % name)
if changed:
    for line in changed:
        print("  " + line)
else:
    print("  配置本来就是该环境，无需改动")
print()
print("游戏连接   %s:20013" % wanted["SERVER_IP"])
print("客服/支付  %s" % wanted["HHHH"])
print("注册       %s" % wanted["REG_HOST"])
PY
result_code=$?

echo
if (( result_code == 0 )); then
    echo "提示：Creator 需重新编译；出包前记得重新生成热更新包（1生成热更新包.command）。"
fi
echo
read "REPLY?按回车键关闭窗口..."
exit "$result_code"
