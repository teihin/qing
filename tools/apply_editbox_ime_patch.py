#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「原生输入条紧贴键盘上沿」补丁写入 Cocos Creator 引擎目录。

背景
----
Android 端 EditBox 的原生输入条由引擎里的
``cocos/platform/android/java/src/org/cocos2dx/lib/Cocos2dxEditBox.java`` 摆放。
这份源码不属于本仓库，位于 Creator 安装目录，重装或升级 Creator 会被覆盖，
表现为输入条重新跑到屏幕中间（老版靠 getHeight() 倍数硬抬，永远对不准）。

``settings.gradle`` 的 ``libcocos2dx`` 直接引用这个目录，所以改这里等于改 APK，
必须重新出安卓包，热更新下发不了。

用法
----
    python3 tools/apply_editbox_ime_patch.py            # 自动找 2.4.13
    python3 tools/apply_editbox_ime_patch.py --version 2.4.13
    python3 tools/apply_editbox_ime_patch.py --check    # 只报告状态，不写文件

幂等：目标文件已含 QING-IME-PATCH 标记时不做任何写入。
"""

import argparse
import datetime
import os
import shutil
import sys

MARKER = "QING-IME-PATCH"
RELATIVE = ("Contents/Resources/cocos2d-x/cocos/platform/android/java/src/"
            "org/cocos2dx/lib/Cocos2dxEditBox.java")
CREATOR_ROOT = "/Applications/Cocos/Creator"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_GRADLE = os.path.join(PROJECT_ROOT, "build/jsb-link/frameworks/runtime-src/"
                                            "proj.android-studio/settings.gradle")
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "android-engine", "Cocos2dxEditBox.java")


def target_from_gradle():
    """读工程 settings.gradle 里 libcocos2dx 的实际 projectDir，最贴近真实编译。"""
    if not os.path.isfile(SETTINGS_GRADLE):
        return None
    for line in open(SETTINGS_GRADLE, encoding="utf-8"):
        if "libcocos2dx" not in line or "projectDir" not in line:
            continue
        quote = line.split("new File(", 1)[-1].strip()
        quote = quote.split(")")[0].strip().strip("'\"")
        # libcocos2dx 的 build.gradle 用 java.srcDir "../java/src"，源码在兄弟目录
        candidates = [
            os.path.join(quote, "..", "java", "src", "org", "cocos2dx", "lib",
                         "Cocos2dxEditBox.java"),
            os.path.join(quote, "src", "org", "cocos2dx", "lib", "Cocos2dxEditBox.java"),
        ]
        for path in candidates:
            if os.path.isfile(path):
                return os.path.normpath(path)
    return None


def candidate_versions():
    if not os.path.isdir(CREATOR_ROOT):
        return []
    names = []
    for name in sorted(os.listdir(CREATOR_ROOT)):
        if os.path.isfile(os.path.join(CREATOR_ROOT, name, "CocosCreator.app", RELATIVE)):
            names.append(name)
    return names


def resolve_target(version):
    if version:
        path = os.path.join(CREATOR_ROOT, version, "CocosCreator.app", RELATIVE)
        return path if os.path.isfile(path) else None
    from_gradle = target_from_gradle()
    if from_gradle:
        return from_gradle
    found = [os.path.join(CREATOR_ROOT, v, "CocosCreator.app", RELATIVE)
             for v in candidate_versions()]
    if len(found) == 1:
        return found[0]
    if not found:
        return None
    print("检测到多个 Creator 版本，请用 --version 指定其一：")
    for path in found:
        print("  " + path)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", help="Creator 版本目录名，例如 2.4.13")
    parser.add_argument("--check", action="store_true", help="只检查，不写文件")
    args = parser.parse_args()

    target = resolve_target(args.version)
    if not target:
        print("找不到 Cocos2dxEditBox.java，确认 Creator 安装在 %s" % CREATOR_ROOT)
        return 2
    print("目标: " + target)

    current = open(target, encoding="utf-8").read()
    applied = MARKER in current
    if applied:
        print("状态: 补丁已应用，无需改动")
    else:
        print("状态: 补丁未应用（原生输入条会飘在画面中间）")

    if args.check or applied:
        return 0

    if not os.path.isfile(TEMPLATE):
        print("缺少补丁模板: " + TEMPLATE)
        return 2

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = target + ".qing-bak-" + stamp
    shutil.copy2(target, backup)
    print("备份: " + backup)

    shutil.copyfile(TEMPLATE, target)
    print("已写入补丁。下一步：重新编安卓包（Java 改动，热更新下发不了）")
    print("  cd build/jsb-link/frameworks/runtime-src/proj.android-studio")
    print("  ./gradlew :qing:assembleRelease")
    return 0


if __name__ == "__main__":
    sys.exit(main())
