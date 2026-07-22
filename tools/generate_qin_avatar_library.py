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
    paths: list[Path] = []

    for row in range(ROWS):
        y0 = round(row * sheet.height / ROWS)
        y1 = round((row + 1) * sheet.height / ROWS)
        for col in range(COLS):
            x0 = round(col * sheet.width / COLS)
            x1 = round((col + 1) * sheet.width / COLS)
            cell = sheet.crop((x0, y0, x1, y1))
            side = min(cell.size)
            left = (cell.width - side) // 2
            cell = cell.crop((left, 0, left + side, side)).resize(
                (SIZE, SIZE), Image.Resampling.LANCZOS
            ).convert("RGBA")

            mask = Image.new("L", (SIZE, SIZE), 0)
            ImageDraw.Draw(mask).ellipse((5, 5, 250, 250), fill=255)
            mask = mask.filter(ImageFilter.GaussianBlur(0.7))
            cell.putalpha(mask)

            index = row * COLS + col + 1
            path = OUTPUT / f"头像{index:02d}.png"
            cell.save(path, optimize=True)
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
