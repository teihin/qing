#!/bin/zsh

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"
result_code=0
python3 tools/upload_web_mobile.py || result_code=$?

echo
if (( result_code == 0 )); then
    read "REPLY?网页版上传完成，按回车键关闭窗口..."
elif (( result_code == 2 )); then
    read "REPLY?已取消上传，服务器未发生变化，按回车键关闭窗口..."
    result_code=0
else
    read "REPLY?网页版上传失败（退出码 ${result_code}），按回车键关闭窗口..."
fi

if [[ "$TERM_PROGRAM" == "Apple_Terminal" ]]; then
    (sleep 0.2; osascript -e 'tell application "Terminal" to if (count of windows) > 0 then close front window') >/dev/null 2>&1 &!
fi
exit "$result_code"
