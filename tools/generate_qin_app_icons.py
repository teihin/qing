#!/usr/bin/env python3
"""从已确认的 D 版母图生成 Android 与 iOS 应用图标。"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art_sources/app_icon/qin_app_icon_d_source.png"
MASTER = ROOT / "art_sources/app_icon/qin_app_icon_d_master_1024.png"

ANDROID_RES = (
    ROOT
    / "build/jsb-link/frameworks/runtime-src/proj.android-studio/res"
)
IOS_APPICON = (
    ROOT
    / "build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/Images.xcassets/AppIcon.appiconset"
)

ANDROID_SIZES = {
    "mipmap-mdpi/ic_launcher.png": 48,
    "mipmap-hdpi/ic_launcher.png": 72,
    "mipmap-xhdpi/ic_launcher.png": 96,
    "mipmap-xxhdpi/ic_launcher.png": 144,
    "mipmap-xxxhdpi/ic_launcher.png": 192,
}

IOS_SIZES = {
    "Icon-20.png": 20,
    "Icon-20@2x.png": 40,
    "Icon-20@3x.png": 60,
    "Icon-29.png": 29,
    "Icon-29@2x.png": 58,
    "Icon-29@3x.png": 87,
    "Icon-40.png": 40,
    "Icon-40@2x.png": 80,
    "Icon-40@3x.png": 120,
    "Icon-50.png": 50,
    "Icon-50@2x.png": 100,
    "Icon-57.png": 57,
    "Icon-57@2x.png": 114,
    "Icon-60@2x.png": 120,
    "Icon-60@3x.png": 180,
    "Icon-72.png": 72,
    "Icon-72@2x.png": 144,
    "Icon-76.png": 76,
    "Icon-76@2x.png": 152,
    "Icon-83.5@2x.png": 167,
    "Icon-1024.png": 1024,
}


def save_icon(master: Image.Image, target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    icon = master.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(target, "PNG", optimize=True, compress_level=9)


def bind_ios_marketing_icon() -> None:
    contents_path = IOS_APPICON / "Contents.json"
    contents = json.loads(contents_path.read_text(encoding="utf-8"))
    for entry in contents.get("images", []):
        if entry.get("idiom") == "ios-marketing":
            entry["filename"] = "Icon-1024.png"
            break
    else:
        contents.setdefault("images", []).append(
            {
                "idiom": "ios-marketing",
                "size": "1024x1024",
                "scale": "1x",
                "filename": "Icon-1024.png",
            }
        )
    contents_path.write_text(
        json.dumps(contents, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"缺少应用图标源图: {SOURCE}")
    if not IOS_APPICON.is_dir():
        raise FileNotFoundError(f"缺少 iOS AppIcon 目录: {IOS_APPICON}")

    with Image.open(SOURCE) as source:
        if source.width != source.height:
            raise ValueError(f"应用图标源图必须为正方形，当前为 {source.size}")
        master = source.convert("RGB").resize(
            (1024, 1024), Image.Resampling.LANCZOS
        )

    MASTER.parent.mkdir(parents=True, exist_ok=True)
    master.save(MASTER, "PNG", optimize=True, compress_level=9)

    for relative_path, size in ANDROID_SIZES.items():
        save_icon(master, ANDROID_RES / relative_path, size)
    for filename, size in IOS_SIZES.items():
        save_icon(master, IOS_APPICON / filename, size)

    bind_ios_marketing_icon()

    print(f"应用图标母版: {MASTER.relative_to(ROOT)}")
    print(f"Android 图标: {len(ANDROID_SIZES)} 张")
    print(f"iOS 图标: {len(IOS_SIZES)} 张")


if __name__ == "__main__":
    main()
