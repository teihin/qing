#!/usr/bin/env python3
"""Install the project-owned iOS voice bridge into Creator's generated project."""

from pathlib import Path
import plistlib
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "native/ios/voice"
IOS_ROOT = ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios"
APP_CONTROLLER = IOS_ROOT / "AppController.mm"
INFO_PLIST = IOS_ROOT / "Info.plist"
PBXPROJ = (
    ROOT
    / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/Qing.xcodeproj/project.pbxproj"
)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> int:
    header = SOURCE_DIR / "QingVoiceBridge.h"
    implementation = SOURCE_DIR / "QingVoiceBridge.mm"
    required = [header, implementation, APP_CONTROLLER, INFO_PLIST, PBXPROJ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(missing))

    shutil.copy2(header, IOS_ROOT / header.name)
    shutil.copy2(implementation, IOS_ROOT / implementation.name)

    controller = APP_CONTROLLER.read_text(encoding="utf-8")
    controller = replace_once(
        controller,
        '#import "SDKWrapper.h"\n',
        '#import "SDKWrapper.h"\n#import "QingVoiceBridge.h"\n',
        "voice bridge import",
    )
    controller = replace_once(
        controller,
        "    [[SDKWrapper getInstance] application:application didFinishLaunchingWithOptions:launchOptions];\n",
        "    [[SDKWrapper getInstance] application:application didFinishLaunchingWithOptions:launchOptions];\n"
        "    [QingVoiceBridge initializeBridge];\n",
        "voice bridge initialization",
    )
    controller = replace_once(
        controller,
        "    app->onPause();\n"
        "    [[SDKWrapper getInstance] applicationWillResignActive:application];\n",
        "    [QingVoiceBridge ApplicationWillResignActive];\n"
        "    app->onPause();\n"
        "    [[SDKWrapper getInstance] applicationWillResignActive:application];\n",
        "voice background handling",
    )
    controller = replace_once(
        controller,
        "    [[SDKWrapper getInstance] applicationWillTerminate:application];\n"
        "    delete app;\n",
        "    [QingVoiceBridge shutdownBridge];\n"
        "    [[SDKWrapper getInstance] applicationWillTerminate:application];\n"
        "    delete app;\n",
        "voice shutdown",
    )
    APP_CONTROLLER.write_text(controller, encoding="utf-8")

    with INFO_PLIST.open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") == "com.fireball.Qing":
        info["CFBundleIdentifier"] = "com.fireball.qing"
    info["NSMicrophoneUsageDescription"] = (
        "用于在游戏房间内按住录制并发送语音消息。"
    )
    with INFO_PLIST.open("wb") as stream:
        plistlib.dump(info, stream, fmt=plistlib.FMT_XML, sort_keys=False)

    project = PBXPROJ.read_text(encoding="utf-8")
    project = replace_once(
        project,
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n",
        "\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 509D4AAC17EBB2AB00697056 /* AppController.mm */; };\n"
        "\t\t71C0A00171C0A00171C0A001 /* QingVoiceBridge.mm in Sources */ = "
        "{isa = PBXBuildFile; fileRef = 71C0A00371C0A00371C0A003 "
        "/* QingVoiceBridge.mm */; settings = {COMPILER_FLAGS = \"-fobjc-arc\"; }; };\n",
        "voice build file",
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
        "\t\t71C0A00271C0A00271C0A002 /* QingVoiceBridge.h */ = "
        "{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; "
        "name = QingVoiceBridge.h; path = ios/QingVoiceBridge.h; sourceTree = \"<group>\"; };\n"
        "\t\t71C0A00371C0A00371C0A003 /* QingVoiceBridge.mm */ = "
        "{isa = PBXFileReference; fileEncoding = 4; "
        "lastKnownFileType = sourcecode.cpp.objcpp; name = QingVoiceBridge.mm; "
        "path = ios/QingVoiceBridge.mm; sourceTree = \"<group>\"; };\n",
        "voice file references",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n",
        "\t\t\t\t509D4AAC17EBB2AB00697056 /* AppController.mm */,\n"
        "\t\t\t\t71C0A00271C0A00271C0A002 /* QingVoiceBridge.h */,\n"
        "\t\t\t\t71C0A00371C0A00371C0A003 /* QingVoiceBridge.mm */,\n",
        "voice project group",
    )
    project = replace_once(
        project,
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n",
        "\t\t\t\t509D4ABC17EBB2AB00697056 /* AppController.mm in Sources */,\n"
        "\t\t\t\t71C0A00171C0A00171C0A001 /* QingVoiceBridge.mm in Sources */,\n",
        "voice source phase",
    )
    ios_target_anchor = (
        "\t\t\t\tINFOPLIST_FILE = ios/Info.plist;\n"
        "\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 10.0;\n"
    )
    ios_target_settings = (
        "\t\t\t\tINFOPLIST_FILE = ios/Info.plist;\n"
        "\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 12.0;\n"
        "\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.fireball.qing;\n"
    )
    if ios_target_settings not in project:
        count = project.count(ios_target_anchor)
        if count != 2:
            raise RuntimeError(
                f"iOS target settings: expected exactly two anchors, found {count}"
            )
        project = project.replace(ios_target_anchor, ios_target_settings)
    PBXPROJ.write_text(project, encoding="utf-8")

    print("iOS voice bridge synchronized")
    print(IOS_ROOT / implementation.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"sync_ios_voice.py: {exc}", file=sys.stderr)
        sys.exit(1)
