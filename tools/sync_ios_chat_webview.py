#!/usr/bin/env python3
"""Install the project-owned iOS in-game chat WebView bridge."""

from pathlib import Path
import plistlib
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "native/ios/chat"
IOS_ROOT = ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios"
INFO_PLIST = IOS_ROOT / "Info.plist"
IOS_PROJECT_ROOT = ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac"


def find_project_file() -> Path:
    candidates = sorted(IOS_PROJECT_ROOT.glob("*.xcodeproj/project.pbxproj"))
    if len(candidates) != 1:
        raise RuntimeError(
            "expected exactly one generated iOS Xcode project, found "
            + str(len(candidates))
        )
    return candidates[0]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    old_lines = set(old.splitlines())
    added_lines = [line for line in new.splitlines() if line not in old_lines]
    if added_lines and all(line in text.splitlines() for line in added_lines):
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def deduplicate_bridge_lines(text: str) -> str:
    seen: set[str] = set()
    output: list[str] = []
    for line in text.splitlines(keepends=True):
        if "QingChatWebViewBridge" in line:
            if line in seen:
                continue
            seen.add(line)
        output.append(line)
    return "".join(output)


def main() -> int:
    header = SOURCE_DIR / "QingChatWebViewBridge.h"
    implementation = SOURCE_DIR / "QingChatWebViewBridge.mm"
    pbxproj = find_project_file()
    required = [header, implementation, INFO_PLIST, pbxproj]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(missing))

    shutil.copy2(header, IOS_ROOT / header.name)
    shutil.copy2(implementation, IOS_ROOT / implementation.name)

    with INFO_PLIST.open("rb") as stream:
        info = plistlib.load(stream)
    info["NSPhotoLibraryUsageDescription"] = "用于从相册选择图片或视频发送给在线客服。"
    info["NSCameraUsageDescription"] = "用于拍摄图片或视频发送给在线客服。"
    with INFO_PLIST.open("wb") as stream:
        plistlib.dump(info, stream, fmt=plistlib.FMT_XML, sort_keys=False)

    project = pbxproj.read_text(encoding="utf-8")
    project = replace_once(
        project,
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n",
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n"
        "\t\t71C0B00171C0B00171C0B001 /* QingChatWebViewBridge.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 71C0B00371C0B00371C0B003 "
        "/* QingChatWebViewBridge.mm */; settings = {COMPILER_FLAGS = \"-fobjc-arc\"; }; };\n",
        "chat WebView build file",
    )
    project = replace_once(
        project,
        "\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */ = "
        "{isa = PBXFileReference; fileEncoding = 4; "
        "lastKnownFileType = sourcecode.cpp.objcpp; name = AppController.mm; "
        "path = ios/AppController.mm; sourceTree = \"<group>\"; };\n",
        "\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */ = "
        "{isa = PBXFileReference; fileEncoding = 4; "
        "lastKnownFileType = sourcecode.cpp.objcpp; name = AppController.mm; "
        "path = ios/AppController.mm; sourceTree = \"<group>\"; };\n"
        "\t\t71C0B00271C0B00271C0B002 /* QingChatWebViewBridge.h */ = "
        "{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; "
        "name = QingChatWebViewBridge.h; path = ios/QingChatWebViewBridge.h; sourceTree = \"<group>\"; };\n"
        "\t\t71C0B00371C0B00371C0B003 /* QingChatWebViewBridge.mm */ = "
        "{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; "
        "name = QingChatWebViewBridge.mm; path = ios/QingChatWebViewBridge.mm; sourceTree = \"<group>\"; };\n",
        "chat WebView file references",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n",
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n"
        "\t\t\t\t71C0B00271C0B00271C0B002 /* QingChatWebViewBridge.h */,\n"
        "\t\t\t\t71C0B00371C0B00371C0B003 /* QingChatWebViewBridge.mm */,\n",
        "chat WebView project group",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n",
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n"
        "\t\t\t\t71C0B00171C0B00171C0B001 /* QingChatWebViewBridge.mm in Sources */,\n",
        "chat WebView source phase",
    )
    pbxproj.write_text(deduplicate_bridge_lines(project), encoding="utf-8")

    print("iOS in-game chat WebView bridge synchronized")
    print(IOS_ROOT / implementation.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_ios_chat_webview.py: {exc}", file=sys.stderr)
        sys.exit(1)
