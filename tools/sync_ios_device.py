#!/usr/bin/env python3
"""Install the project-owned iOS Keychain device bridge into Creator output."""

from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "native/ios/device"
IOS_ROOT = ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios"
PBXPROJ = ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/Qing.xcodeproj/project.pbxproj"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> int:
    header = SOURCE_DIR / "QingDeviceBridge.h"
    implementation = SOURCE_DIR / "QingDeviceBridge.mm"
    required = [header, implementation, PBXPROJ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(missing))

    shutil.copy2(header, IOS_ROOT / header.name)
    shutil.copy2(implementation, IOS_ROOT / implementation.name)
    project = PBXPROJ.read_text(encoding="utf-8")
    project = replace_once(
        project,
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n",
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n"
        "\t\t72D0A00172D0A00172D0A001 /* QingDeviceBridge.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 72D0A00372D0A00372D0A003 /* QingDeviceBridge.mm */; settings = {COMPILER_FLAGS = \"-fobjc-arc\"; }; };\n",
        "device build file",
    )
    project = replace_once(
        project,
        "\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; name = AppController.mm; path = ios/AppController.mm; sourceTree = \"<group>\"; };\n",
        "\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; name = AppController.mm; path = ios/AppController.mm; sourceTree = \"<group>\"; };\n"
        "\t\t72D0A00272D0A00272D0A002 /* QingDeviceBridge.h */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; name = QingDeviceBridge.h; path = ios/QingDeviceBridge.h; sourceTree = \"<group>\"; };\n"
        "\t\t72D0A00372D0A00372D0A003 /* QingDeviceBridge.mm */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; name = QingDeviceBridge.mm; path = ios/QingDeviceBridge.mm; sourceTree = \"<group>\"; };\n",
        "device file references",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n",
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n"
        "\t\t\t\t72D0A00272D0A00272D0A002 /* QingDeviceBridge.h */,\n"
        "\t\t\t\t72D0A00372D0A00372D0A003 /* QingDeviceBridge.mm */,\n",
        "device project group",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n",
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n"
        "\t\t\t\t72D0A00172D0A00172D0A001 /* QingDeviceBridge.mm in Sources */,\n",
        "device source phase",
    )
    PBXPROJ.write_text(project, encoding="utf-8")
    print("iOS device identity bridge synchronized")
    print(IOS_ROOT / implementation.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_ios_device.py: {exc}", file=sys.stderr)
        sys.exit(1)
