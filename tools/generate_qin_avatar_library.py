#!/usr/bin/env python3
"""Slice and package the 20-character Qin avatar selection library."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art_sources" / "avatars" / "qin_avatar_contact_sheet.png"
OUTPUT = ROOT / "assets" / "resources" / "avatars"
PREVIEW = ROOT / "art_sources" / "avatars" / "qin_avatar_library_preview.png"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
SIZE = 256
COLS = 5
ROWS = 4

# 源母版的分隔线和外框并不是严格等宽网格，不能按sheet.width / 5硬切。
# 以下坐标是逐张拟合金色圆形头像框得到的真实圆心；固定以圆心裁256×256，
# 可确保头像框、透明圆形Mask及运行时选中圈三者完全同心。
CROP_CENTERS: tuple[tuple[int, int], ...] = (
    (171, 143), (469, 143), (767, 144), (1064, 143), (1360, 143),
    (169, 388), (468, 387), (764, 387), (1060, 388), (1360, 389),
    (170, 633), (468, 634), (765, 632), (1061, 633), (1358, 633),
    (168, 878), (467, 878), (764, 881), (1060, 878), (1357, 878),
)


def deterministic_uuid(name: str, kind: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"qing-avatar-library/{kind}/{name}"))


def write_meta(path: Path) -> None:
    name = path.stem
    texture_uuid = deterministic_uuid(name, "texture")
    frame_uuid = deterministic_uuid(name, "sprite-frame")
    data = {
        "ver": "2.3.7",
        "uuid": texture_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": SIZE,
        "height": SIZE,
        "platformSettings": {},
        "subMetas": {
            name: {
                "ver": "1.0.6",
                "uuid": frame_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": texture_uuid,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": SIZE,
                "height": SIZE,
                "rawWidth": SIZE,
                "rawHeight": SIZE,
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def build() -> list[Path]:
    sheet = Image.open(SOURCE).convert("RGB")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    folder_meta = {
        "ver": "1.1.3", "uuid": deterministic_uuid("avatars", "folder"),
        "importer": "folder", "isBundle": False, "bundleName": "", "priority": 1,
        "compressionType": {}, "optimizeHotUpdate": {}, "inlineSpriteFrames": {},
        "isRemoteBundle": {}, "subMetas": {},
    }
    OUTPUT.with_suffix(".meta").write_text(
        json.dumps(folder_meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    paths: list[Path] = []

    assert len(CROP_CENTERS) == COLS * ROWS
    half = SIZE // 2
    for index, (center_x, center_y) in enumerate(CROP_CENTERS, start=1):
        box = (center_x - half, center_y - half, center_x + half, center_y + half)
        if box[0] < 0 or box[1] < 0 or box[2] > sheet.width or box[3] > sheet.height:
            raise ValueError(f"avatar crop {index:02d} is outside source sheet: {box}")
        cell = sheet.crop(box).convert("RGBA")

        mask = Image.new("L", (SIZE, SIZE), 0)
        ImageDraw.Draw(mask).ellipse((5, 5, 250, 250), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(0.7))
        cell.putalpha(mask)

        path = OUTPUT / f"头像{index:02d}.png"
        cell.save(path, optimize=True)
        # 已有资源必须保留Creator生成的.meta字节和UUID；只为首次新增文件补meta。
        if not path.with_suffix(path.suffix + ".meta").exists():
            write_meta(path)
        paths.append(path)

    preview = Image.new("RGB", (1100, 900), (13, 10, 7))
    font = ImageFont.truetype(str(FONT), 24)
    for i, path in enumerate(paths):
        avatar = Image.open(path).convert("RGBA").resize((190, 190), Image.Resampling.LANCZOS)
        x = 25 + (i % COLS) * 215
        y = 20 + (i // COLS) * 215
        preview.paste(avatar, (x, y), avatar)
        ImageDraw.Draw(preview).text((x + 74, y + 184), f"{i+1:02d}", font=font, fill=(231, 190, 104))
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    preview.save(PREVIEW, optimize=True)
    return paths


if __name__ == "__main__":
    files = build()
    print(f"generated {len(files)} selectable avatars")
