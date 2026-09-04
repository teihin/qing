#!/usr/bin/env python3
"""Extract the approved lobby artwork into deterministic Cocos bitmap assets.

Unlike the first V7 pass, this tool uses the accepted 02-lobby mockup itself as
the color/material authority. Static art is cropped from that image so its
typography, metal, border and blue values do not drift during re-drawing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from generate_v7_runtime_skin import OUT, ROOT, save


REFERENCE = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版/02-大厅.png"
CLEAN_BACKGROUND = ROOT / "art_sources/v7/casino_background_clean_v8.png"
FONT = ROOT / "assets/font/PingFF.ttf"
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
        (1 * ss, 1 * ss, (size[0] - 1) * ss, (size[1] - 1) * ss),
        radius=radius * ss, fill=255,
    )
    mask = mask.resize(size, Image.Resampling.LANCZOS)
    crop.putalpha(mask)
    return crop


def blank_filter_base(full_filter: Image.Image) -> Image.Image:
    """Remove only the selected-all pill while retaining the exact bar/text."""
    result = full_filter.copy().convert("RGBA")
    # Reconstruct this one interior area with the same vertical blue field.
    # The outer frame and every other approved glyph remain untouched.
    x0, y0, x1, y1 = 10, 10, 109, 83
    arr = np.asarray(result).copy()
    for y in range(y0, y1):
        # Use the clean panel immediately to the right of the selected block.
        sample = arr[y, 112:132, :3]
        color = np.median(sample, axis=0)
        arr[y, x0:x1, :3] = color
        arr[y, x0:x1, 3] = 255
    result = Image.fromarray(arr, "RGBA")
    # Restore the normal unselected label. The approved UI uses this bundled
    # face; rendering at 4x keeps the same crisp edge as the other filter text.
    ss = 4
    overlay = Image.new("RGBA", (result.width * ss, result.height * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(str(FONT), 25 * ss)
    draw.text((59 * ss, 47 * ss), "全部", font=font, anchor="mm",
              fill=(239, 210, 159, 255), stroke_width=1 * ss,
              stroke_fill=(14, 24, 31, 210))
    result.alpha_composite(overlay.resize(result.size, Image.Resampling.LANCZOS))
    return result


def selected_filter_asset(reference_pill: Image.Image, text: str) -> Image.Image:
    if text == "全部":
        return reference_pill
    arr = np.asarray(reference_pill).copy()
    # Replace the old dark glyph with nearby champagne-metal pixels.
    y0, y1 = 12, 55
    for y in range(y0, y1):
        sample = np.concatenate((arr[y, 7:14, :3], arr[y, 81:88, :3]), axis=0)
        arr[y, 14:81, :3] = np.median(sample, axis=0)
    base = Image.fromarray(arr, "RGBA")
    ss = 4
    overlay = Image.new("RGBA", (base.width * ss, base.height * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(str(FONT), 25 * ss)
    draw.text((base.width * 0.5 * ss, base.height * 0.51 * ss), text,
              font=font, anchor="mm", fill=(4, 28, 49, 255))
    base.alpha_composite(overlay.resize(base.size, Image.Resampling.LANCZOS))
    return base


def foreground_layer(source: Image.Image, regions: tuple[tuple[int, int, int, int], ...],
                     kind: str = "gold") -> Image.Image:
    """Keep approved lettering/icons while removing their blue panel field."""
    rgba = np.asarray(source.convert("RGBA")).copy()
    r = rgba[:, :, 0].astype(np.int16)
    g = rgba[:, :, 1].astype(np.int16)
    b = rgba[:, :, 2].astype(np.int16)
    allowed = np.zeros(r.shape, dtype=bool)
    for x0, y0, x1, y1 in regions:
        allowed[y0:y1, x0:x1] = True
    if kind == "cyan":
        foreground = (g > 95) & (b > 100) & (r < 110) & (g > r * 1.35)
        alpha = np.clip((g - 72) * 4, 0, 255)
    else:
        foreground = (r > 52) & (r > b * 0.82) & (g > b * 0.62)
        alpha = np.clip((r - 35) * 4, 0, 255)
    rgba[:, :, 3] = np.where(allowed & foreground, alpha, 0).astype(np.uint8)
    rgba[rgba[:, :, 3] == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def status_sprite(ref: Image.Image, box: tuple[int, int, int, int], kind: str) -> Image.Image:
    crop = ref.crop(box).convert("RGBA")
    layer = foreground_layer(crop, ((0, 0, crop.width, crop.height),), kind)
    scaled = layer.resize((81, 33), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (96, 32), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((96 - scaled.width) // 2, -1))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = Image.open(REFERENCE).convert("RGB")

    clean = Image.open(CLEAN_BACKGROUND).convert("RGB")
    clean_arr = np.asarray(clean, dtype=np.int16)
    # Match the accepted mockup's unobscured side margins in the lower field.
    clean_arr[:, :, 0] += 4
    clean_arr[:, :, 1] += 8
    clean_arr[:, :, 2] += 9
    clean = Image.fromarray(np.clip(clean_arr, 0, 255).astype(np.uint8), "RGB")
    save(clean.resize((750, 1334), Image.Resampling.LANCZOS), "casino_bg_exact.png")

    save(scaled_crop(ref, (0, 0, 941, 80), (750, 64)), "lobby_header_exact.png")
    # Extend through the three main action buttons so every exposed gap uses
    # the approved scene pixels. The interaction nodes remain transparent on
    # top, preserving their original hit areas without double-blending edges.
    save(scaled_crop(ref, (0, 80, 941, 744), (750, 530)), "lobby_hero_exact.png")

    # The accepted room-list margins average roughly RGB(5,46,79). Reuse only
    # the high-frequency texture of the clean background around that exact
    # blue-gray base; this avoids a flat fill and also prevents tall screens
    # from stretching the brighter casino-floor area into the list.
    clean_scaled = clean.resize((750, 1334), Image.Resampling.LANCZOS)
    texture = clean_scaled.crop((0, 650, 750, 1150)).filter(ImageFilter.GaussianBlur(0.6))
    tex = np.asarray(texture, dtype=np.int16)
    smooth = np.asarray(texture.filter(ImageFilter.GaussianBlur(22)), dtype=np.int16)
    detail = np.clip(tex - smooth, -15, 15)
    low = np.asarray(texture.filter(ImageFilter.GaussianBlur(75)), dtype=np.float32)
    low_luma = low.mean(axis=2, keepdims=True)
    low_shape = np.clip((low_luma - np.median(low_luma)) * 0.10, -5, 5)
    base = np.zeros_like(tex) + np.array([5, 46, 79], dtype=np.int16)
    list_field = np.clip(base + detail * 0.62 + low_shape, 0, 255).astype(np.uint8)
    save(Image.fromarray(list_field, "RGB"), "lobby_list_bg_exact.png", sliced=True)

    buttons = (
        ("lobby_ranking_exact.png", (27, 609, 310, 723)),
        ("lobby_match_exact.png", (329, 609, 612, 723)),
        ("lobby_report_exact.png", (630, 609, 913, 723)),
    )
    for name, box in buttons:
        save(rounded_crop(ref, box, (226, 91), 16), name)

    full_filter = rounded_crop(ref, (27, 744, 913, 862), (706, 94), 15)
    save(blank_filter_base(full_filter), "filter_bar_exact.png")
    pill = rounded_crop(ref, (44, 760, 163, 842), (95, 65), 10)
    for key, text in (("all", "全部"), ("small", "小皮"),
                      ("middle", "中皮"), ("large", "大皮")):
        save(selected_filter_asset(pill.copy(), text), f"filter_{key}_exact_sel.png")

    transparent = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    save(transparent, "transparent.png")
    check = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(check)
    draw.line((6, 17, 13, 24, 27, 7), fill=(239, 210, 159, 255), width=3,
              joint="curve")
    save(check, "filter_check_exact.png")

    # Include the part of the central 8L shield that rises above the bar body.
    # Cropping from the bar's horizontal top edge (y=1504) cut off the shield
    # crown in-game.  The taller bitmap remains bottom-anchored, while the list
    # still ends at the 134px body height so the shield can overlap it exactly
    # as it does in the approved mockup.
    nav = scaled_crop(ref, (0, 1478, 941, 1672), (750, 155)).convert("RGBA")
    # Only the shield cap is allowed to occupy the 21px overlap area.  The
    # source screenshot naturally contains the final room row behind it; an
    # alpha mask prevents that row from being baked into the navigation art.
    nav_mask_ss = 4
    nav_mask = Image.new("L", (750 * nav_mask_ss, 155 * nav_mask_ss), 0)
    nav_draw = ImageDraw.Draw(nav_mask)
    nav_draw.rectangle((0, 21 * nav_mask_ss, 750 * nav_mask_ss,
                        155 * nav_mask_ss), fill=255)
    cap_points = (
        (313, 21), (318, 17), (335, 11), (354, 6), (375, 3),
        (396, 6), (415, 11), (432, 17), (437, 21),
    )
    nav_draw.polygon(tuple((x * nav_mask_ss, y * nav_mask_ss)
                           for x, y in cap_points) +
                     ((437 * nav_mask_ss, 22 * nav_mask_ss),
                      (313 * nav_mask_ss, 22 * nav_mask_ss)), fill=255)
    nav.putalpha(nav_mask.resize(nav.size, Image.Resampling.LANCZOS))
    save(nav, "nav_bar_exact.png")
    underline = Image.new("RGBA", (130, 134), (0, 0, 0, 0))
    ud = ImageDraw.Draw(underline)
    ud.rounded_rectangle((37, 126, 93, 129), radius=2,
                         fill=(221, 186, 123, 235))
    save(underline, "nav_selected_overlay.png")

    # Small room emblem sampled from the accepted card, then clipped with the
    # already-clean master alpha so the edge stays smooth on HD screens.
    emblem = scaled_crop(ref, (54, 889, 180, 1035), (100, 116)).convert("RGBA")
    master_alpha = Image.open(ROOT / "art_sources/v7/8l_shield_master.png").getchannel("A")
    master_alpha = master_alpha.resize(emblem.size, Image.Resampling.LANCZOS)
    emblem.putalpha(master_alpha)
    save(emblem, "shield_room_exact.png")

    # Dynamic cards keep live text, but the panel surface/border is sampled from
    # the approved first card rather than using the earlier generic blue panel.
    card = rounded_crop(ref, (27, 878, 914, 1048), (706, 135), 16)
    # Keep the approved pictograms, but rebuild the two small captions as
    # high-resolution bitmap lettering.  The source crop's captions became too
    # small after the 941→706 card resize; drawing them at 4x preserves the V7
    # art-text edge while making “底皮 / 局数” match the live values visually.
    approved_symbols = foreground_layer(card, (
        (279, 73, 309, 121),   # 牌图标
        (435, 73, 476, 121),   # 时钟图标
        (568, 73, 602, 121),   # 人数图标
    ))
    static_layer = Image.new("RGBA", card.size, (0, 0, 0, 0))

    def place_symbol(box: tuple[int, int, int, int], center: tuple[int, int],
                     max_size: tuple[int, int]) -> None:
        symbol = approved_symbols.crop(box)
        bounds = symbol.getbbox()
        if bounds is None:
            return
        symbol = symbol.crop(bounds)
        scale = min(max_size[0] / symbol.width, max_size[1] / symbol.height)
        size = (max(1, round(symbol.width * scale)),
                max(1, round(symbol.height * scale)))
        symbol = symbol.resize(size, Image.Resampling.LANCZOS)
        static_layer.alpha_composite(
            symbol, (round(center[0] - size[0] / 2),
                     round(center[1] - size[1] / 2)))

    # One shared baseline/visual center for every static and dynamic field.
    place_symbol((279, 73, 309, 121), (290, 99), (31, 31))
    place_symbol((435, 73, 476, 121), (453, 99), (30, 30))
    place_symbol((568, 73, 602, 121), (589, 99), (31, 31))
    label_ss = 4
    labels = Image.new("RGBA", (706 * label_ss, 135 * label_ss), (0, 0, 0, 0))
    label_draw = ImageDraw.Draw(labels)
    label_font = ImageFont.truetype(str(FONT), 25 * label_ss)
    for x, caption in ((151, "底皮"), (313, "局数")):
        label_draw.text((x * label_ss, 99 * label_ss), caption,
                        font=label_font, anchor="lm",
                        fill=(231, 194, 139, 255),
                        stroke_width=1 * label_ss,
                        stroke_fill=(10, 29, 41, 205))
    static_layer.alpha_composite(labels.resize(static_layer.size,
                                                Image.Resampling.LANCZOS))
    save(static_layer, "room_static_exact.png")
    # Remove baked content with a gentle sampled field while retaining the exact
    # perimeter. All live labels and the independent shield are drawn by Prefab.
    arr = np.asarray(card).copy()
    for y in range(7, 128):
        left = np.median(arr[y, 7:12, :3], axis=0)
        right = np.median(arr[y, 694:699, :3], axis=0)
        ramp = np.linspace(left, right, 682)
        arr[y, 12:694, :3] = ramp
        arr[y, 12:694, 3] = 255
    save(Image.fromarray(arr, "RGBA"), "room_card_exact.png", sliced=True)

    # The runtime loads these by room status. Keep their existing dimensions
    # and metadata UUIDs, but replace the legacy neon-arrow lettering with the
    # exact approved gold/cyan art.
    status_game = status_sprite(ref, (774, 913, 876, 955), "gold")
    status_wait = status_sprite(ref, (775, 1280, 877, 1322), "cyan")
    status_game.save(ROOT / "assets/resources/other/状态_游戏中.png", optimize=True)
    status_wait.save(ROOT / "assets/resources/other/状态_等待中.png", optimize=True)
    status_wait.save(ROOT / "assets/resources/other/状态_准备.png", optimize=True)

    print("已从确认稿提取大厅顶部、主视觉、按钮、筛选栏、房间卡片和底栏资源。")


if __name__ == "__main__":
    main()
