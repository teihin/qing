#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 / 恢复 iOS 原生工程的持久化镜像。

背景
----
`build/jsb-link/frameworks/runtime-src/proj.ios_mac` 是 Creator 生成的原生工程，不受 git
跟踪。一旦在 Creator 里重新构建 iOS，手工加进来的文件（QingVoiceBridge、QingAppServices、
QingChatWebViewBridge、DirectChatImageBridge、QingDeviceBridge）以及 pbxproj 里对应的编译
引用都会丢；AppController.mm、Info.plist 的手工改动也会被模板版覆盖。

手工维护的那一份镜像在：
    build-templates/jsb-link/frameworks/runtime-src/proj.ios_mac

用法
----
    python3 tools/ios/check_ios_native.py            # 只检查，不改任何文件
    python3 tools/ios/check_ios_native.py --restore  # 从模板恢复（先整体备份现有工程）

退出码：0 一致 / 1 有差异（--restore 后仍不一致也算 1）
"""

import hashlib
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BUILD_DIR = os.path.join(ROOT, "build/jsb-link/frameworks/runtime-src/proj.ios_mac")
TPL_DIR = os.path.join(ROOT, "build-templates/jsb-link/frameworks/runtime-src/proj.ios_mac")

IOS_SUB = "ios"
PBX_REL = os.path.join("8L.xcodeproj", "project.pbxproj")

SKIP_DIRS = {"xcuserdata", "__pycache__"}
SKIP_FILES = {".DS_Store"}


def md5(path):
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def walk_files(base):
    """返回 base 下的相对路径列表，跳过用户态与垃圾文件。"""
    result = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in sorted(filenames):
            if name in SKIP_FILES:
                continue
            full = os.path.join(dirpath, name)
            result.append(os.path.relpath(full, base))
    return result


def check_sources():
    """逐个比对 ios/ 下模板文件与当前工程。返回问题列表。"""
    problems = []
    tpl_ios = os.path.join(TPL_DIR, IOS_SUB)
    build_ios = os.path.join(BUILD_DIR, IOS_SUB)
    if not os.path.isdir(tpl_ios):
        return ["模板目录不存在：%s" % os.path.relpath(tpl_ios, ROOT)]
    if not os.path.isdir(build_ios):
        return ["当前工程目录不存在：%s" % os.path.relpath(build_ios, ROOT)]

    for rel in walk_files(tpl_ios):
        src = os.path.join(tpl_ios, rel)
        dst = os.path.join(build_ios, rel)
        if not os.path.isfile(dst):
            problems.append("缺失  ios/%s" % rel)
        elif md5(src) != md5(dst):
            problems.append("不一致 ios/%s" % rel)
    return problems


def check_pbxproj():
    """比对工程文件，并确认每个 .mm 都在 Sources 编译列表里。"""
    problems = []
    tpl_pbx = os.path.join(TPL_DIR, PBX_REL)
    build_pbx = os.path.join(BUILD_DIR, PBX_REL)
    if not os.path.isfile(tpl_pbx):
        return ["模板缺少 %s" % PBX_REL], ""
    if not os.path.isfile(build_pbx):
        return ["当前工程缺少 %s" % PBX_REL], ""

    with open(build_pbx, "r", encoding="utf-8", errors="replace") as handle:
        current = handle.read()

    if md5(tpl_pbx) != md5(build_pbx):
        problems.append("不一致 %s" % PBX_REL)

    # 每个手写 .mm 都必须有 "<name>.mm in Sources"，否则编译时不会参与链接。
    ios_dir = os.path.join(BUILD_DIR, IOS_SUB)
    if os.path.isdir(ios_dir):
        for name in sorted(os.listdir(ios_dir)):
            if not name.endswith(".mm"):
                continue
            if ("%s in Sources" % name) not in current:
                problems.append("pbxproj 未引用 %s（不会参与编译）" % name)
    return problems, current


def restore():
    """从模板整体恢复，先把现有工程备份到同级目录。"""
    if not os.path.isdir(TPL_DIR):
        print("模板目录不存在，无法恢复：%s" % os.path.relpath(TPL_DIR, ROOT))
        return False

    if os.path.isdir(BUILD_DIR):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = "%s.bak-%s" % (BUILD_DIR, stamp)
        shutil.copytree(BUILD_DIR, backup, symlinks=True)
        print("已备份现有工程 -> %s" % os.path.relpath(backup, ROOT))

    for rel in walk_files(os.path.join(TPL_DIR, IOS_SUB)):
        src = os.path.join(TPL_DIR, IOS_SUB, rel)
        dst = os.path.join(BUILD_DIR, IOS_SUB, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        os.chmod(dst, 0o644)
    print("已恢复 ios/ 下 %d 个文件" % len(walk_files(os.path.join(TPL_DIR, IOS_SUB))))

    tpl_pbx = os.path.join(TPL_DIR, PBX_REL)
    if os.path.isfile(tpl_pbx):
        dst_pbx = os.path.join(BUILD_DIR, PBX_REL)
        os.makedirs(os.path.dirname(dst_pbx), exist_ok=True)
        shutil.copyfile(tpl_pbx, dst_pbx)
        os.chmod(dst_pbx, 0o644)
        print("已恢复 %s" % PBX_REL)
    return True


def main():
    do_restore = "--restore" in sys.argv[1:]
    if do_restore:
        if not restore():
            return 1
        print("")

    problems = check_sources()
    pbx_problems, _ = check_pbxproj()
    problems.extend(pbx_problems)

    if not problems:
        print("iOS 原生工程与模板一致，编译引用齐全。")
        return 0

    print("发现 %d 处差异：" % len(problems))
    for item in problems:
        print("  - %s" % item)
    if not do_restore:
        print("\n在 Creator 里重新构建过 iOS 工程才会出现这些差异。")
        print("确认要覆盖当前工程时执行：python3 tools/ios/check_ios_native.py --restore")
    return 1


if __name__ == "__main__":
    sys.exit(main())
