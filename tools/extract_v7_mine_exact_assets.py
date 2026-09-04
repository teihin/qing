#!/usr/bin/env python3
"""Extract the approved V7 Mine page into deterministic Cocos bitmaps.

The accepted 03-Mine mockup is the visual authority.  Large static regions and
all six action buttons are sampled directly from it.  Only account-dependent
content (avatar, name, id, gold and summary values) is removed from the profile
card so the Prefab can draw live data above the exact approved material.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from generate_v7_runtime_skin import OUT, ROOT, cover, save


REFERENCE = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版/03-我的.png"
CLEAN_BACKGROUND = ROOT / "art_sources/v7/casino_background_clean_v8.png"
SCALE = 750 / 1023


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


def erase_horizontal(arr: np.ndarray, box: tuple[int, int, int, int]) -> None:
    """Replace a text/avatar rectangle with the card's local blue field."""
    x0, y0, x1, y1 = box
    height, width = arr.shape[:2]
    x0, y0 = max(3, x0), max(3, y0)
    x1, y1 = min(width - 3, x1), min(height - 3, y1)
    for y in range(y0, y1):
        left = np.median(arr[y, max(3, x0 - 10):max(4, x0 - 3), :3], axis=0)
        right = np.median(arr[y, min(width - 4, x1 + 3):min(width - 3, x1 + 10), :3], axis=0)
        ramp = np.linspace(left, right, max(1, x1 - x0))
        arr[y, x0:x1, :3] = ramp
        arr[y, x0:x1, 3] = 255


def clean_profile_card(card: Image.Image) -> Image.Image:
    """Keep exact borders/captions while clearing only live account values."""
    original = np.asarray(card.convert("RGBA")).copy()
    arr = original.copy()

    # Rebuild the open upper field from the card's genuinely empty center
    # strip. Sampling beside individual glyphs produced visible streaks; this
    # low-frequency field keeps the approved vertical illumination without
    # retaining demo account content.
    for y in range(8, 191):
        sample = original[y, 326:452, :3]
        color = np.median(sample, axis=0).astype(np.float32)
        x = np.arange(655, dtype=np.float32)
        highlight = 5.0 * (1.0 - np.abs(x - 327.0) / 327.0)
        row = np.clip(color[None, :] + highlight[:, None], 0, 255)
        arr[y, 8:663, :3] = row
        arr[y, 8:663, 3] = 255

    # Restore the exact outer metal/cool-gray rim and the internal separator.
    arr[:, :9] = original[:, :9]
    arr[:, 662:] = original[:, 662:]
    arr[:9, :] = original[:9, :]
    arr[132:140, :] = original[132:140, :]

    # Keep the exact approved gold pill through a rounded mask, so the sampled
    # source field outside its corners cannot form a darker rectangular patch.
    pill_mask = Image.new("L", (671, 314), 0)
    ImageDraw.Draw(pill_mask).rounded_rectangle((164, 72, 329, 117),
                                                radius=23, fill=255)
    pill_mask_arr = np.asarray(pill_mask) > 0
    arr[pill_mask_arr] = original[pill_mask_arr]
    for y in range(78, 113):
        left = np.median(arr[y, 207:214, :3], axis=0)
        right = np.median(arr[y, 292:305, :3], axis=0)
        arr[y, 214:292, :3] = np.linspace(left, right, 78)
        arr[y, 214:292, 3] = 255

    # Restore the approved pencil/copy icons and static summary captions. The
    # allowed rectangles deliberately stop before each dynamic value.
    allowed = np.zeros(arr.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in (
        # The approved pencil is intentionally omitted: the live nickname can
        # be longer than the demo name and otherwise collides with this icon.
        (469, 29, 503, 82),
        (24, 142, 99, 185), (119, 142, 218, 185),
        (325, 142, 383, 185), (436, 142, 503, 185),
        (539, 142, 606, 185),
        (134, 142, 141, 185), (307, 142, 314, 185),
        (422, 142, 429, 185), (526, 142, 533, 185),
    ):
        allowed[y0:y1, x0:x1] = True
    r = original[:, :, 0].astype(np.int16)
    g = original[:, :, 1].astype(np.int16)
    b = original[:, :, 2].astype(np.int16)
    foreground = allowed & (((r > 82) & (r > b * 0.85) & (g > b * 0.65)) |
                            ((g > 82) & (b > 82) & (r > 55)))
    arr[foreground] = original[foreground]

    # Move the copy pictogram farther right. The demo image left only a few
    # pixels between a six-digit ID and the icon; the live ID now gets a stable
    # 20px+ visual gap without changing the panel width.
    copy_source = original[29:82, 589:628].copy()
    cr = copy_source[:, :, 0].astype(np.int16)
    cg = copy_source[:, :, 1].astype(np.int16)
    cb = copy_source[:, :, 2].astype(np.int16)
    copy_foreground = (((cr > 82) & (cr > cb * 0.85) & (cg > cb * 0.65)) |
                       ((cg > 82) & (cb > 82) & (cr > 55)))
    copy_target = arr[29:82, 619:658]
    copy_target[copy_foreground] = copy_source[copy_foreground]

    # The lower five-column panel is static in the current product and is kept
    # pixel-for-pixel from the accepted mockup, including its fine separators.
    arr[190:, :] = original[190:, :]
    return Image.fromarray(arr, "RGBA")


def avatar_ring(reference: Image.Image) -> Image.Image:
    crop = scaled_crop(reference, (108, 476, 258, 626), (118, 118)).convert("RGBA")
    ss = 4
    alpha = Image.new("L", (118 * ss, 118 * ss), 0)
    draw = ImageDraw.Draw(alpha)
    draw.ellipse((2 * ss, 2 * ss, 116 * ss, 116 * ss), fill=255)
    draw.ellipse((10 * ss, 10 * ss, 108 * ss, 108 * ss), fill=0)
    crop.putalpha(alpha.resize(crop.size, Image.Resampling.LANCZOS))
    return crop


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = Image.open(REFERENCE).convert("RGB")
    if ref.size != (1023, 1537):
        raise RuntimeError(f"03-我的.png 尺寸异常: {ref.size}")

    # The approved Mine page uses this clean lounge/felt field without the
    # legacy poker chips and cards.  Hero artwork below covers its upper area.
    clean = cover(Image.open(CLEAN_BACKGROUND).convert("RGB"), (750, 1334))
    clean_arr = np.asarray(clean, dtype=np.int16)
    clean_arr[:, :, 0] += 3
    clean_arr[:, :, 1] += 7
    clean_arr[:, :, 2] += 10
    save(Image.fromarray(np.clip(clean_arr, 0, 255).astype(np.uint8), "RGB"),
         "mine_bg_exact.png")

    # Header, casino interior, large smooth 8L shield and CASINO mark are one
    # immutable top slice, preventing either emblem from being stretched.
    save(scaled_crop(ref, (0, 0, 1023, 455), (750, 334)),
         "mine_hero_exact.png")

    profile = scaled_crop(ref, (55, 453, 970, 881), (671, 314)).convert("RGBA")
    save(clean_profile_card(profile), "mine_profile_exact.png")
    save(avatar_ring(ref), "mine_avatar_ring_exact.png")

    buttons = (
        ("mine_agent_exact.png", (55, 906, 499, 1035), (326, 95)),
        ("mine_promotion_exact.png", (516, 906, 970, 1035), (333, 95)),
        ("mine_money_exact.png", (55, 1054, 499, 1182), (326, 94)),
        ("mine_gift_exact.png", (516, 1054, 970, 1182), (333, 94)),
        ("mine_record_exact.png", (55, 1201, 499, 1333), (326, 97)),
        ("mine_settings_exact.png", (516, 1201, 970, 1333), (333, 97)),
    )
    for name, box, size in buttons:
        save(rounded_crop(ref, box, size, 16), name)

    # The accepted Mine tab uses a restrained cyan underline.  The nav icons,
    # labels and central shield continue to come from the shared exact nav art.
    underline = Image.new("RGBA", (130, 134), (0, 0, 0, 0))
    ud = ImageDraw.Draw(underline)
    ud.rounded_rectangle((36, 125, 94, 130), radius=3,
                         fill=(59, 225, 231, 245))
    save(underline, "nav_mine_selected_overlay.png")

    print("已从确认稿提取‘我的’页主视觉、资料卡、头像环、六个按钮和底栏选中态。")


if __name__ == "__main__":
    main()
