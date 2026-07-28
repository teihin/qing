#!/usr/bin/env python3
"""Static regression checks for the project-owned iOS room voice bridge."""

from pathlib import Path
import plistlib


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "native/ios/voice/QingVoiceBridge.mm"
HEADER = ROOT / "native/ios/voice/QingVoiceBridge.h"
GENERATED_ROOT = (
    ROOT / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios"
)
GENERATED_SOURCE = GENERATED_ROOT / SOURCE.name
GENERATED_HEADER = GENERATED_ROOT / HEADER.name
INFO_PLIST = GENERATED_ROOT / "Info.plist"
APP_CONTROLLER = GENERATED_ROOT / "AppController.mm"
PROJECT = (
    ROOT
    / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/Qing.xcodeproj/project.pbxproj"
)
MOBILE_MANAGER = ROOT / "assets/scripts/mobile/MobileManager.ts"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def count_once(text: str, value: str, label: str) -> None:
    require(text.count(value) == 1, f"{label}: expected once")


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    header = HEADER.read_text(encoding="utf-8")
    generated_source = GENERATED_SOURCE.read_text(encoding="utf-8")
    generated_header = GENERATED_HEADER.read_text(encoding="utf-8")
    require(source == generated_source, "generated iOS implementation is stale")
    require(header == generated_header, "generated iOS header is stale")

    require(
        "uploadTaskWithStreamedRequest" in source,
        "Apple streamed upload API is not used",
    )
    require(
        "needNewBodyStream:" in source,
        "initial NSURLSession request body callback is missing",
    )
    require(
        'setValue:@"100-continue" forHTTPHeaderField:@"Expect"' in source,
        "HTTP 100-continue protection is missing",
    )
    require("request.HTTPBodyStream" not in source, "ignored request body stream is set")
    require("QingVoiceMaxBytes = QingVoiceBytesPerSecond * 9800 / 1000" in source,
            "9.8 second native hard limit changed")
    require("QingVoiceMinBytes = QingVoiceBytesPerSecond * 300 / 1000" in source,
            "300 ms minimum changed")
    require("cancelRecordSession:" in source, "record cancellation helper is missing")
    require("recordSessions.allObjects" in source, "room-wide pending upload cleanup is missing")
    require("downgradesTLS" in source, "HTTPS downgrade protection is missing")
    require("serverTrust" not in source, "custom server trust bypass must not be added")
    require("allowsAnyHTTPSCertificate" not in source,
            "invalid certificate bypass must not be added")

    with INFO_PLIST.open("rb") as stream:
        info = plistlib.load(stream)
    require(
        info.get("NSMicrophoneUsageDescription")
        == "用于在游戏房间内按住录制并发送语音消息。",
        "microphone purpose string is missing",
    )
    require(
        info.get("CFBundleIdentifier") == "com.fireball.qing",
        "bundle identifier drifted",
    )
    require(
        info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads") is True,
        "plain HTTP compatibility is not enabled",
    )

    controller = APP_CONTROLLER.read_text(encoding="utf-8")
    count_once(controller, '#import "QingVoiceBridge.h"', "bridge import")
    count_once(controller, "[QingVoiceBridge initializeBridge];", "bridge init")
    count_once(
        controller,
        "[QingVoiceBridge ApplicationWillResignActive];",
        "background hook",
    )
    count_once(controller, "[QingVoiceBridge shutdownBridge];", "shutdown hook")

    project = PROJECT.read_text(encoding="utf-8")
    count_once(
        project,
        "QingVoiceBridge.mm in Sources */ =",
        "voice build file",
    )
    count_once(
        project,
        "QingVoiceBridge.mm in Sources */,",
        "voice source phase",
    )
    require(
        'COMPILER_FLAGS = "-fobjc-arc"' in project,
        "voice source must compile with ARC",
    )
    require(
        project.count("IPHONEOS_DEPLOYMENT_TARGET = 12.0;") == 2,
        "iOS application target must require iOS 12 or later",
    )
    require(
        project.count("PRODUCT_BUNDLE_IDENTIFIER = com.fireball.qing;") == 2,
        "Xcode bundle identifier is missing",
    )

    manager = MOBILE_MANAGER.read_text(encoding="utf-8")
    for selector in (
        '"Prepare:"',
        '"StartRecord:clientTag:"',
        '"StopRecord"',
        '"PlayFile:voiceId:"',
        '"PreloadFile:voiceId:"',
        '"LeaveRoom"',
    ):
        require(selector in manager, f"Cocos selector missing: {selector}")
    require(
        "generation !== this.voiceRoomGeneration" in manager,
        "stale room callback protection is missing",
    )
    print("iOS voice static validation passed")


if __name__ == "__main__":
    main()
