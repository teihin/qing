#!/bin/zsh

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"
result_code=0
python3 tools/generate_hot_update.py || result_code=$?

echo
if (( result_code == 0 )); then
    read "REPLY?生成完成，按回车键关闭窗口..."
else
    read "REPLY?生成失败（退出码 ${result_code}），按回车键关闭窗口..."
fi

if [[ "$TERM_PROGRAM" == "Apple_Terminal" ]]; then
    (sleep 0.2; osascript -e 'tell application "Terminal" to if (count of windows) > 0 then close front window') >/dev/null 2>&1 &!
fi
exit "$result_code"
