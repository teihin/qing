#!/usr/bin/env python3
"""Extract the approved V7 gift page into deterministic Cocos bitmaps.

The accepted 05-gift mockup is the visual authority.  Static typography,
icons, borders and button art are sampled directly from it; only live input,
record values and avatars are removed for Prefab/runtime data overlays.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from generate_v7_runtime_skin import OUT, ROOT, cover, save
from extract_v7_wallet_exact_assets import clean_panel


REFERENCE = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版/05-赠送.png"
CLEAN_BACKGROUND = ROOT / "art_sources/v7/casino_background_clean_v8.png"
HERO_SOURCE = ROOT / "art_sources/v7/gift/gift_hero_no_hands_v2_source.png"
SCALE = 750 / 941


def scaled_crop(source: Image.Image, box: tuple[int, int, int, int],
                size: tuple[int, int]) -> Image.Image:
    return source.crop(box).resize(size, Image.Resampling.LANCZOS)


def rounded_crop(source: Image.Image, box: tuple[int, int, int, int],
                 size: tuple[int, int], radius: int) -> Image.Image:
    crop = scaled_crop(source, box, size).convert("RGBA")
    ss = 4
    mask = Image.new("L", (size[0] * ss, size[1] * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (ss, ss, (size[0] - 1) * ss, (size[1] - 1) * ss),
        radius=radius * ss, fill=255,
    )
    crop.putalpha(mask.resize(size, Image.Resampling.LANCZOS))
    return crop


def erase_horizontal(image: Image.Image, x0: int, x1: int,
                     y0: int, y1: int) -> Image.Image:
    """Remove live text while retaining the approved local panel lighting."""
    arr = np.asarray(image.convert("RGBA")).copy()
    width = arr.shape[1]
    x0, x1 = max(12, x0), min(width - 12, x1)
    for y in range(max(4, y0), min(arr.shape[0] - 4, y1)):
        left = np.median(arr[y, x0 - 10:x0 - 3, :3], axis=0)
        right = np.median(arr[y, x1 + 3:x1 + 10, :3], axis=0)
        arr[y, x0:x1, :3] = np.linspace(left, right, x1 - x0)
        arr[y, x0:x1, 3] = 255
    return Image.fromarray(arr, "RGBA")


def clean_wide_panel(image: Image.Image, edge: int = 7) -> Image.Image:
    """Keep the exact side/bottom rules and clear all sample record content."""
    original = np.asarray(image.convert("RGBA")).copy()
    arr = original.copy()
    width, height = image.size
    for y in range(edge, height - edge):
        left = np.median(original[y, edge:edge + 8, :3], axis=0)
        right = np.median(original[y, width - edge - 8:width - edge, :3], axis=0)
        arr[y, edge + 8:width - edge - 8, :3] = np.linspace(
            left, right, width - 2 * edge - 16)
        arr[y, edge + 8:width - edge - 8, 3] = 255
    # Restore the exact outer rules after clearing the live content.
    arr[:, :edge + 2] = original[:, :edge + 2]
    arr[:, width - edge - 2:] = original[:, width - edge - 2:]
    arr[:edge + 2, :] = original[:edge + 2, :]
    arr[height - edge - 2:, :] = original[height - edge - 2:, :]
    return Image.fromarray(arr, "RGBA")


def exact_background(reference: Image.Image) -> Image.Image:
    """Rebuild the exposed lower field from the mockup's real margin colors."""
    clean = cover(Image.open(CLEAN_BACKGROUND).convert("RGB"), (750, 1334))
    texture = clean.crop((0, 640, 750, 1334)).resize(
        (750, 1334), Image.Resampling.LANCZOS)
    tex = np.asarray(texture, dtype=np.int16)
    smooth = np.asarray(texture.filter(ImageFilter.GaussianBlur(28)), dtype=np.int16)
    detail = np.clip(tex - smooth, -18, 18)

    ref = np.asarray(reference.convert("RGB"), dtype=np.int16)
    result = np.zeros((1334, 750, 3), dtype=np.int16)
    for y in range(1334):
        src_y = min(1671, round(y / SCALE))
        margins = np.concatenate((ref[src_y, :22], ref[src_y, 919:]), axis=0)
        base = np.median(margins, axis=0)
        result[y, :, :] = base
    result = np.clip(result + detail * 0.42, 0, 255).astype(np.uint8)
    return Image.fromarray(result, "RGB")


def avatar_ring(reference: Image.Image) -> Image.Image:
    crop = scaled_crop(reference, (214, 1127, 302, 1215), (70, 70)).convert("RGBA")
    ss = 4
    alpha = Image.new("L", (70 * ss, 70 * ss), 0)
    draw = ImageDraw.Draw(alpha)
    draw.ellipse((ss, ss, 69 * ss, 69 * ss), fill=255)
    draw.ellipse((4 * ss, 4 * ss, 66 * ss, 66 * ss), fill=0)
    crop.putalpha(alpha.resize(crop.size, Image.Resampling.LANCZOS))
    return crop


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = Image.open(REFERENCE).convert("RGB")
    if ref.size != (941, 1672):
        raise RuntimeError(f"05-赠送.png 尺寸异常: {ref.size}")

    save(exact_background(ref), "gift_bg_exact.png")
    save(scaled_crop(ref, (0, 0, 941, 102), (750, 81)),
         "gift_header_exact.png")
    if not HERO_SOURCE.is_file():
        raise RuntimeError(f"赠送页新版主视觉缺失: {HERO_SOURCE}")
    hero = cover(Image.open(HERO_SOURCE).convert("RGB"), (750, 300))
    save(hero, "gift_hero_exact.png")

    fields = (
        ("gift_input_id_exact.png", (55, 477, 885, 579), 168),
        ("gift_input_amount_exact.png", (55, 599, 885, 701), 247),
        ("gift_input_password_exact.png", (55, 720, 885, 823), 247),
    )
    for name, box, dynamic_x in fields:
        field = rounded_crop(ref, box, (660, 82), 15)
        save(erase_horizontal(field, dynamic_x, 625, 13, 69), name)

    save(rounded_crop(ref, (210, 847, 729, 952), (414, 84), 14),
         "gift_confirm_exact.png")
    save(scaled_crop(ref, (26, 984, 914, 1117), (708, 106)),
         "gift_history_header_exact.png")

    # Do not erase the three baked sample rows from the mockup: their divider
    # bands survive nine-slice stretching.  Rebuild one continuous V7 surface.
    list_panel = clean_panel(ref, (26, 1116, 914, 1467), (708, 280))
    save(list_panel, "gift_list_panel_exact.png", sliced=True)

    row = scaled_crop(ref, (27, 1116, 913, 1232), (706, 93))
    save(clean_wide_panel(row, edge=3), "gift_record_row_exact.png")
    save(avatar_ring(ref), "gift_avatar_ring_exact.png")

    pagination = scaled_crop(ref, (26, 1465, 914, 1599), (708, 107)).convert("RGBA")
    pagination = erase_horizontal(pagination, 317, 391, 29, 83)
    save(pagination, "gift_pagination_exact.png")

    print("已从确认稿提取赠送页标题、主视觉、输入框、记录区、头像环和翻页栏资源。")


if __name__ == "__main__":
    main()
