#!/usr/bin/env python3
"""Install the project-owned Android in-game chat WebView bridge."""

from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native/android/chat/QingChatWebViewBridge.java"
DIRECT_IMAGE_SOURCE = ROOT / "native/android/chat/DirectChatImageBridge.java"
ANDROID = ROOT / "build/jsb-link/frameworks/runtime-src/proj.android-studio/app"
JAVA_DIR = ANDROID / "src/org/cocos2dx/javascript"
APP_ACTIVITY = JAVA_DIR / "AppActivity.java"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> int:
    missing_sources = [str(path) for path in (SOURCE, DIRECT_IMAGE_SOURCE) if not path.is_file()]
    if missing_sources:
        raise RuntimeError("missing source: " + ", ".join(missing_sources))
    if not APP_ACTIVITY.is_file():
        raise RuntimeError("Android generated project is missing; build Android in Creator first")

    JAVA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE, JAVA_DIR / SOURCE.name)
    shutil.copy2(DIRECT_IMAGE_SOURCE, JAVA_DIR / DIRECT_IMAGE_SOURCE.name)

    activity = APP_ACTIVITY.read_text(encoding="utf-8")
    if "DirectChatImageBridge.initialize(this);" not in activity:
        if "        QingChatWebViewBridge.initialize(this);\n" in activity:
            activity = replace_once(
                activity,
                "        QingChatWebViewBridge.initialize(this);\n",
                "        QingChatWebViewBridge.initialize(this);\n"
                "        DirectChatImageBridge.initialize(this);\n",
                "direct image initialization",
            )
        else:
            activity = replace_once(
                activity,
                "        app = this;\n",
                "        app = this;\n"
                "        QingChatWebViewBridge.initialize(this);\n"
                "        DirectChatImageBridge.initialize(this);\n",
                "chat WebView initialization",
            )

    if "DirectChatImageBridge.onActivityResult(requestCode, resultCode, data)" not in activity:
        chat_result = (
            "        if (QingChatWebViewBridge.onActivityResult(requestCode, resultCode, data)) {\n"
            "            return;\n"
            "        }\n"
        )
        if chat_result in activity:
            activity = replace_once(
                activity,
                chat_result,
                "        if (DirectChatImageBridge.onActivityResult(requestCode, resultCode, data)) {\n"
                "            return;\n"
                "        }\n" + chat_result,
                "direct image activity result",
            )
        else:
            activity = replace_once(
                activity,
                "        super.onActivityResult(requestCode, resultCode, data);\n",
                "        super.onActivityResult(requestCode, resultCode, data);\n"
                "        if (DirectChatImageBridge.onActivityResult(requestCode, resultCode, data)) {\n"
                "            return;\n"
                "        }\n"
                "        if (QingChatWebViewBridge.onActivityResult(requestCode, resultCode, data)) {\n"
                "            return;\n"
                "        }\n",
                "chat activity result",
            )

    if "DirectChatImageBridge.shutdown();" not in activity:
        if "        QingChatWebViewBridge.shutdown();\n" in activity:
            activity = replace_once(
                activity,
                "        QingChatWebViewBridge.shutdown();\n",
                "        DirectChatImageBridge.shutdown();\n"
                "        QingChatWebViewBridge.shutdown();\n",
                "direct image shutdown",
            )
        else:
            activity = replace_once(
                activity,
                "        SDKWrapper.getInstance().onDestroy();\n",
                "        DirectChatImageBridge.shutdown();\n"
                "        QingChatWebViewBridge.shutdown();\n"
                "        SDKWrapper.getInstance().onDestroy();\n",
                "chat WebView shutdown",
            )
    APP_ACTIVITY.write_text(activity, encoding="utf-8")

    print("Android in-game chat WebView bridge synchronized")
    print(JAVA_DIR / SOURCE.name)
    print(JAVA_DIR / DIRECT_IMAGE_SOURCE.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_android_chat_webview.py: {exc}", file=sys.stderr)
        sys.exit(1)
