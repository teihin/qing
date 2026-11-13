#!/usr/bin/env python3
"""Install the project-owned iOS app services into Creator output.

Adds GPS, save-to-album and clipboard selectors as an AppController category so
Creator regenerating proj.ios_mac does not drop them. Also restores the matching
Info.plist permission strings and CoreLocation.framework link.
"""

from pathlib import Path
import plistlib
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "native/ios/app"
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


def deduplicate_service_lines(text: str) -> str:
    seen: set[str] = set()
    output: list[str] = []
    for line in text.splitlines(keepends=True):
        if "QingAppServices" in line or "CoreLocation.framework" in line:
            if line in seen:
                continue
            seen.add(line)
        output.append(line)
    return "".join(output)


def main() -> int:
    header = SOURCE_DIR / "QingAppServices.h"
    implementation = SOURCE_DIR / "QingAppServices.mm"
    pbxproj = find_project_file()
    required = [header, implementation, INFO_PLIST, pbxproj]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(missing))

    shutil.copy2(header, IOS_ROOT / header.name)
    shutil.copy2(implementation, IOS_ROOT / implementation.name)

    with INFO_PLIST.open("rb") as stream:
        info = plistlib.load(stream)
    info["NSLocationWhenInUseUsageDescription"] = (
        "用于获取当前位置，以支持牌桌中的距离提示和位置相关功能。"
    )
    info["NSPhotoLibraryAddUsageDescription"] = "用于将游戏截图和二维码保存到系统相册。"
    info["NSLocalNetworkUsageDescription"] = (
        "用于在测试期间通过局域网连接开发调试工具并查看运行日志。"
    )
    transport = info.setdefault("NSAppTransportSecurity", {})
    transport["NSAllowsArbitraryLoads"] = True
    with INFO_PLIST.open("wb") as stream:
        plistlib.dump(info, stream, fmt=plistlib.FMT_XML, sort_keys=False)

    project = pbxproj.read_text(encoding="utf-8")
    project = replace_once(
        project,
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n",
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n"
        "\t\t74D0A00174D0A00174D0A001 /* QingAppServices.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 74D0A00374D0A00374D0A003 "
        "/* QingAppServices.mm */; settings = {COMPILER_FLAGS = \"-fobjc-arc\"; }; };\n",
        "app services build file",
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
        "\t\t74D0A00274D0A00274D0A002 /* QingAppServices.h */ = "
        "{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; "
        "name = QingAppServices.h; path = ios/QingAppServices.h; sourceTree = \"<group>\"; };\n"
        "\t\t74D0A00374D0A00374D0A003 /* QingAppServices.mm */ = "
        "{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.cpp.objcpp; "
        "name = QingAppServices.mm; path = ios/QingAppServices.mm; sourceTree = \"<group>\"; };\n",
        "app services file references",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n",
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n"
        "\t\t\t\t74D0A00274D0A00274D0A002 /* QingAppServices.h */,\n"
        "\t\t\t\t74D0A00374D0A00374D0A003 /* QingAppServices.mm */,\n",
        "app services project group",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n",
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n"
        "\t\t\t\t74D0A00174D0A00174D0A001 /* QingAppServices.mm in Sources */,\n",
        "app services source phase",
    )
    project = replace_once(
        project,
        "\t\tBA3A85EC1A724AE900924D24 /* Security.framework in Frameworks */ = "
        "{isa = PBXBuildFile; fileRef = BA3A85EB1A724AE900924D24 /* Security.framework */; };\n",
        "\t\tBA3A85EC1A724AE900924D24 /* Security.framework in Frameworks */ = "
        "{isa = PBXBuildFile; fileRef = BA3A85EB1A724AE900924D24 /* Security.framework */; };\n"
        "\t\t74D0A00574D0A00574D0A005 /* CoreLocation.framework in Frameworks */ = "
        "{isa = PBXBuildFile; fileRef = 74D0A00474D0A00474D0A004 /* CoreLocation.framework */; };\n",
        "CoreLocation build file",
    )
    project = replace_once(
        project,
        "\t\tBA3A85EB1A724AE900924D24 /* Security.framework */ = "
        "{isa = PBXFileReference; lastKnownFileType = wrapper.framework; "
        "name = Security.framework; "
        "path = Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS8.1.sdk/System/Library/Frameworks/Security.framework; "
        "sourceTree = DEVELOPER_DIR; };\n",
        "\t\tBA3A85EB1A724AE900924D24 /* Security.framework */ = "
        "{isa = PBXFileReference; lastKnownFileType = wrapper.framework; "
        "name = Security.framework; "
        "path = Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS8.1.sdk/System/Library/Frameworks/Security.framework; "
        "sourceTree = DEVELOPER_DIR; };\n"
        "\t\t74D0A00474D0A00474D0A004 /* CoreLocation.framework */ = "
        "{isa = PBXFileReference; lastKnownFileType = wrapper.framework; "
        "name = CoreLocation.framework; "
        "path = System/Library/Frameworks/CoreLocation.framework; sourceTree = SDKROOT; };\n",
        "CoreLocation file reference",
    )
    project = replace_once(
        project,
        "\t\t\t\tBA3A85EC1A724AE900924D24 /* Security.framework in Frameworks */,\n",
        "\t\t\t\tBA3A85EC1A724AE900924D24 /* Security.framework in Frameworks */,\n"
        "\t\t\t\t74D0A00574D0A00574D0A005 /* CoreLocation.framework in Frameworks */,\n",
        "CoreLocation frameworks phase",
    )
    pbxproj.write_text(deduplicate_service_lines(project), encoding="utf-8")

    print("iOS app services synchronized")
    print(IOS_ROOT / implementation.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_ios_app_services.py: {exc}", file=sys.stderr)
        sys.exit(1)
