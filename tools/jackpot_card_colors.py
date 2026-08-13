#!/usr/bin/env python3
"""Restore and preserve standard playing-card colors in the jackpot chart."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "assets" / "ImagesLuck" / "奖池" / "比列.png"
REFERENCE = ROOT / "HisImg" / "qing" / "assets" / "ImagesLuck" / "奖池" / "比列.png"

# Twelve card faces in the 506x369 composite.  Only these rectangles are
# semantic poker art; surrounding labels and payout rings remain in the 8L skin.
CARD_RECTS = (
    (104, 78, 166, 163), (178, 78, 241, 163),
    (252, 78, 314, 163), (326, 78, 388, 163),
    (104, 180, 166, 264), (178, 180, 241, 264),
    (252, 180, 314, 264), (326, 180, 388, 264),
    (104, 282, 166, 366), (178, 282, 241, 366),
    (252, 282, 314, 366), (326, 282, 388, 366),
)


def preserve_card_faces(styled: Image.Image, source: Image.Image) -> Image.Image:
    """Copy card faces from source while retaining all surrounding styled pixels."""
    result = styled.convert("RGBA")
    source_rgba = source.convert("RGBA")
    if result.size != source_rgba.size:
        raise ValueError(f"奖池牌型图尺寸不一致：{result.size} != {source_rgba.size}")
    for bounds in CARD_RECTS:
        result.paste(source_rgba.crop(bounds), bounds[:2])
    return result


def restore_target() -> None:
    if not TARGET.is_file() or not REFERENCE.is_file():
        raise FileNotFoundError(f"缺少奖池牌型图或原版归档：{TARGET} / {REFERENCE}")
    with Image.open(TARGET) as current_opened, Image.open(REFERENCE) as reference_opened:
        current = current_opened.convert("RGBA")
        reference = reference_opened.convert("RGBA")
        original_size = current.size
        original_bbox = current.getchannel("A").getbbox()
        result = preserve_card_faces(current, reference)
    if result.size != original_size or result.getchannel("A").getbbox() != original_bbox:
        raise ValueError("恢复奖池牌面后尺寸或透明裁剪范围发生变化")

    with tempfile.NamedTemporaryFile(
        prefix=f".{TARGET.name}.", suffix=TARGET.suffix, dir=TARGET.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
    try:
        result.save(temporary, optimize=True)
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    restore_target()
    print(f"已恢复奖池牌型标准颜色：{TARGET.relative_to(ROOT)}")
