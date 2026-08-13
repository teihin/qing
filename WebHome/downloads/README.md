# 下载文件目录

- `8L.mobileconfig`：由 `../scripts/generate_mobileconfig.py` 自动生成，苹果按钮已引用该文件。
- `8L.apk`：仅是网站内部的下载路径，不需要手工复制到本目录。`4上传推广网站.command`会从Cocos Android生成目录的`app/release/`第一层读取唯一APK，不限制源文件名，并在上传ZIP中映射为该名称。

脚本不会自动生成APK，也不会按时间猜测。`app/release/`没有APK或同时存在多个APK时会停止上传，请确保其中只有一个经过正式签名和真机验证的Release包。
