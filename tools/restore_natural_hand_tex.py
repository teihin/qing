#!/usr/bin/env python3
"""Restore natural skin colours in the three hand frames of hand_tex.png.

Only the DragonBones hand rectangles are copied from the archived original.
All card-back rectangles, atlas geometry, JSON and Creator metadata remain
unchanged.  The approved 8L art-source copy is updated together with runtime.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ATLAS_JSON = ROOT / "assets" / "ImagesLuck" / "动画" / "切" / "hand_tex.json"
RUNTIME_ATLAS = ROOT / "assets" / "ImagesLuck" / "动画" / "切" / "hand_tex.png"
ART_SOURCE_ATLAS = (
    ROOT / "art_sources" / "8l" / "table-cardback-20260813" / "qing_hand_tex_new.png"
)
NATURAL_ATLAS = ROOT / "HisImg" / "qing" / "assets" / "ImagesLuck" / "动画" / "切" / "hand_tex.png"
HAND_FRAMES = {"放牌手", "底部手", "顶部手"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hand_boxes() -> list[tuple[str, tuple[int, int, int, int]]]:
    document = json.loads(ATLAS_JSON.read_text(encoding="utf-8"))
    result: list[tuple[str, tuple[int, int, int, int]]] = []
    for item in document.get("SubTexture", []):
        name = str(item.get("name", ""))
        if name not in HAND_FRAMES:
            continue
        x = int(item["x"])
        y = int(item["y"])
        width = int(item["width"])
        height = int(item["height"])
        result.append((name, (x, y, x + width, y + height)))
    if {name for name, _ in result} != HAND_FRAMES:
        raise RuntimeError("hand_tex.json 缺少完整人手切片")
    return result


def save_atomic(path: Path, image: Image.Image) -> None:
    mode = stat.S_IMODE(path.stat().st_mode)
    with tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.", suffix=".png", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
    try:
        image.save(temporary, format="PNG", optimize=True)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def restore_one(path: Path, natural: Image.Image, boxes: list[tuple[str, tuple[int, int, int, int]]]) -> int:
    with Image.open(path) as opened:
        before = opened.convert("RGBA")
    if before.size != natural.size:
        raise RuntimeError(f"图集尺寸不一致：{path} {before.size} != {natural.size}")

    result = before.copy()
    inside = Image.new("L", result.size, 0)
    draw = ImageDraw.Draw(inside)
    for _, box in boxes:
        result.paste(natural.crop(box), (box[0], box[1]))
        draw.rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=255)

    difference = ImageChops.difference(before, result)
    outside_difference = Image.composite(
        difference, Image.new("RGBA", result.size, (0, 0, 0, 0)), ImageOps.invert(inside)
    )
    if outside_difference.getbbox() is not None:
        raise RuntimeError(f"人手切片之外出现像素变化：{path}")

    natural_difference = ImageChops.difference(result, natural)
    inside_difference = Image.composite(
        natural_difference, Image.new("RGBA", result.size, (0, 0, 0, 0)), inside
    )
    if inside_difference.getbbox() is not None:
        raise RuntimeError(f"人手切片未与正常肤色原图一致：{path}")
    if before.getchannel("A").tobytes() != result.getchannel("A").tobytes():
        raise RuntimeError(f"透明通道发生变化：{path}")

    red, green, blue, alpha = difference.split()
    changed_mask = ImageChops.lighter(
        ImageChops.lighter(red, green), ImageChops.lighter(blue, alpha)
    )
    changed_pixels = sum(changed_mask.histogram()[1:])
    save_atomic(path, result)
    return changed_pixels


def main() -> int:
    for required in (ATLAS_JSON, RUNTIME_ATLAS, ART_SOURCE_ATLAS, NATURAL_ATLAS):
        if not required.is_file():
            raise RuntimeError(f"缺少文件：{required}")

    meta = RUNTIME_ATLAS.with_suffix(".png.meta")
    meta_before = digest(meta)
    with Image.open(NATURAL_ATLAS) as opened:
        natural = opened.convert("RGBA")
    boxes = hand_boxes()

    for target in (RUNTIME_ATLAS, ART_SOURCE_ATLAS):
        changed = restore_one(target, natural, boxes)
        print(f"已恢复正常肤色：{target.relative_to(ROOT)}，变化像素 {changed}")

    if digest(meta) != meta_before:
        raise RuntimeError("hand_tex.png.meta 被意外修改")
    print("牌背切片、图集JSON、尺寸、透明通道和meta均保持不变")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
