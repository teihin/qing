#!/usr/bin/env python3
"""Install the project-owned Android device identity bridge into Creator output."""

from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native/android/device/QingDeviceBridge.java"
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
    if not SOURCE.is_file():
        raise RuntimeError(f"missing source: {SOURCE}")
    if not APP_ACTIVITY.is_file():
        raise RuntimeError("Android generated project is missing; build Android in Creator first")

    JAVA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE, JAVA_DIR / SOURCE.name)
    activity = APP_ACTIVITY.read_text(encoding="utf-8")
    activity = replace_once(
        activity,
        "        app = this;\n",
        "        app = this;\n        QingDeviceBridge.initialize(this);\n",
        "device bridge initialization",
    )
    activity = replace_once(
        activity,
        "        SDKWrapper.getInstance().onDestroy();\n",
        "        QingDeviceBridge.clear();\n        SDKWrapper.getInstance().onDestroy();\n",
        "device bridge cleanup",
    )
    APP_ACTIVITY.write_text(activity, encoding="utf-8")
    print("Android device identity bridge synchronized")
    print(JAVA_DIR / SOURCE.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_android_device.py: {exc}", file=sys.stderr)
        sys.exit(1)
