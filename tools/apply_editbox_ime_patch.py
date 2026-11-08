#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把输入框相关补丁写入 Cocos Creator 引擎目录（安卓）。

覆盖两个文件
------------
1. ``Cocos2dxEditBox.java``
   原生输入条定位。老实现把带 ``ALIGN_PARENT_BOTTOM`` 的
   ``RelativeLayout.LayoutParams`` 加进 ``FrameLayout``，规则被静默丢弃，
   容器实际钉在窗口左上角，所以历史上写的 ``topMargin`` 全是「距屏幕顶」，
   只能靠 ``getHeight()`` 乘倍数硬凑。现改为容器 ``gravity=BOTTOM`` +
   ``bottomMargin = 键盘高度``（``WindowInsets.Type.ime()`` 优先）。

2. ``Cocos2dxGLSurfaceView.java``
   恢复官方语义：点输入条上方的空白区结束编辑并收起键盘。2026-07-23 的
   touch 修复把这里的 ``complete()`` 注释掉了，导致只能点「完成」才能关键盘。

为什么要脚本
------------
这两份源码不属于本仓库，位于 Creator 安装目录，重装或升级 Creator 会被
覆盖。``settings.gradle`` 的 ``libcocos2dx`` 直接引用那个目录，所以改它等于
改 APK —— **必须重新出安卓包，热更新下发不了**。

用法
----
    python3 tools/apply_editbox_ime_patch.py            # 按 settings.gradle 自动定位
    python3 tools/apply_editbox_ime_patch.py --check    # 只报告状态，不写文件

幂等：文件已含 ``QING-IME-PATCH`` 标记时跳过，不重复备份。
"""

import argparse
import datetime
import os
import shutil
import sys

MARKER = "QING-IME-PATCH"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_GRADLE = os.path.join(PROJECT_ROOT, "build/jsb-link/frameworks/runtime-src/"
                                            "proj.android-studio/settings.gradle")
TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "android-engine")
PATCH_FILES = ("Cocos2dxEditBox.java", "Cocos2dxGLSurfaceView.java")


def libsrc_dir_from_gradle():
    """读工程 settings.gradle 里 libcocos2dx 的 projectDir，推出 java 源码目录。"""
    if not os.path.isfile(SETTINGS_GRADLE):
        return None
    for line in open(SETTINGS_GRADLE, encoding="utf-8"):
        if "libcocos2dx" not in line or "projectDir" not in line:
            continue
        raw = line.split("new File(", 1)[-1].strip().split(")")[0].strip().strip("'\"")
        # libcocos2dx 的 build.gradle 用 java.srcDir "../java/src"
        for candidate in (os.path.join(raw, "..", "java", "src", "org", "cocos2dx", "lib"),
                          os.path.join(raw, "src", "org", "cocos2dx", "lib")):
            if os.path.isdir(candidate):
                return os.path.normpath(candidate)
    return None


def apply_one(src_dir, name, check_only, stamp):
    target = os.path.join(src_dir, name)
    if not os.path.isfile(target):
        print("  [缺失]   " + target)
        return 1

    content = open(target, encoding="utf-8").read()
    if MARKER in content:
        print("  [已应用] " + name)
        return 0

    print("  [未应用] " + name)
    if check_only:
        return 1

    template = os.path.join(TEMPLATE_DIR, name)
    if not os.path.isfile(template):
        print("    缺少模板: " + template)
        return 1

    backup = target + ".qing-bak-" + stamp
    shutil.copy2(target, backup)
    shutil.copyfile(template, target)
    print("    备份 -> " + os.path.basename(backup))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只检查，不写文件")
    args = parser.parse_args()

    src_dir = libsrc_dir_from_gradle()
    if not src_dir:
        print("找不到引擎 java 源码目录。确认下面这个文件存在且 Creator 已安装：")
        print("  " + SETTINGS_GRADLE)
        return 2

    print("目标目录: " + src_dir)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    pending = 0
    for name in PATCH_FILES:
        pending += apply_one(src_dir, name, args.check, stamp)

    if pending == 0:
        print("全部已应用，无需改动。")
        return 0
    if args.check:
        print("有 %d 个文件未打补丁，去掉 --check 执行写入。" % pending)
        return 1

    print("已写入。下一步重新编安卓包（原生层，热更新下发不了）：")
    print("  cd build/jsb-link/frameworks/runtime-src/proj.android-studio")
    print("  ./gradlew :qing:assembleRelease")
    return 0


if __name__ == "__main__":
    sys.exit(main())
