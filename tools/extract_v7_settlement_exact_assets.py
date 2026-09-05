#!/usr/bin/env python3
"""Extract deterministic V7 settlement art from the approved 06 mockup.

The accepted bitmap is the material/color authority.  Static headers, frames,
captions and borders stay baked; live portraits, names and values are cleared
for the Prefab to populate at runtime.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from extract_v7_gift_exact_assets import clean_wide_panel, erase_horizontal, scaled_crop
from generate_v7_runtime_skin import FONT_PATH, OUT, ROOT, cover, save


REFERENCE = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版/06-结算.png"
CLEAN_BACKGROUND = ROOT / "art_sources/v7/casino_background_clean_v8.png"
SCALE = 750 / 1024


def exact_background(reference: Image.Image) -> Image.Image:
    """Continue the approved dark-blue field on portrait screens of any height."""
    clean = cover(Image.open(CLEAN_BACKGROUND).convert("RGB"), (750, 1334))
    texture = clean.crop((0, 540, 750, 1334)).resize(
        (750, 1334), Image.Resampling.LANCZOS)
    tex = np.asarray(texture, dtype=np.int16)
    smooth = np.asarray(texture.filter(ImageFilter.GaussianBlur(28)), dtype=np.int16)
    detail = np.clip(tex - smooth, -16, 16)

    ref = np.asarray(reference.convert("RGB"), dtype=np.int16)
    result = np.zeros((1334, 750, 3), dtype=np.int16)
    for y in range(1334):
        src_y = min(reference.height - 1, round(y / SCALE))
        margins = np.concatenate((ref[src_y, :28], ref[src_y, -28:]), axis=0)
        result[y, :, :] = np.median(margins, axis=0)
    result = np.clip(result + detail * 0.38, 0, 255).astype(np.uint8)
    return Image.fromarray(result, "RGB")


def clean_hero(reference: Image.Image) -> Image.Image:
    hero = scaled_crop(reference, (0, 78, 1024, 474), (750, 290)).convert("RGBA")

    # Live avatars completely cover these neutral wells.  Clearing the demo
    # photos prevents stale people appearing for the brief frame before an
    # account avatar is assigned, while preserving the exact metal rings.
    draw = ImageDraw.Draw(hero)
    # Clear only the portrait apertures.  The metal rings, crown/diamond tips
    # and bottom name plates must remain completely visible.
    draw.ellipse((97, 103, 209, 215), fill=(8, 28, 43, 255))
    draw.ellipse((295, 56, 455, 216), fill=(8, 28, 43, 255))
    draw.ellipse((540, 103, 652, 215), fill=(8, 28, 43, 255))

    # The award titles and frames are art; only account-dependent names are
    # removed.  Runtime labels are positioned over these exact clear regions.
    for x0, x1 in ((91, 218), (310, 440), (538, 704)):
        hero = erase_horizontal(hero, x0, x1, 252, 289)

    # The approved composition supplies the frame geometry, but this product's
    # established award semantics remain 土豪 / MVP / 大鱼.  Replace only the
    # two side-tag glyphs while retaining the sampled metal plates themselves.
    hero = erase_horizontal(hero, 111, 196, 219, 251)
    hero = erase_horizontal(hero, 560, 647, 219, 251)
    ss = 4
    overlay = Image.new("RGBA", (750 * ss, 290 * ss), (0, 0, 0, 0))
    label_draw = ImageDraw.Draw(overlay)
    label_font = ImageFont.truetype(str(FONT_PATH), 21 * ss)
    label_draw.text((153 * ss, 235 * ss), "土豪", font=label_font, anchor="mm",
                    fill=(226, 213, 186, 255), stroke_width=1 * ss,
                    stroke_fill=(3, 22, 36, 220))
    label_draw.text((603 * ss, 235 * ss), "大鱼", font=label_font, anchor="mm",
                    fill=(223, 181, 137, 255), stroke_width=1 * ss,
                    stroke_fill=(3, 22, 36, 220))
    hero.alpha_composite(overlay.resize(hero.size, Image.Resampling.LANCZOS))
    return hero


def award_frames_overlay(reference: Image.Image) -> Image.Image:
    """Extract clean rings/tips as a foreground drawn above live avatars.

    Use the already-cleaned hero instead of the reference portraits.  Color
    thresholding previously retained green/skin pixels near the circular edge,
    which looked like a second picture behind the live avatar.
    """
    hero = clean_hero(reference)
    ss = 4
    geometry = Image.new("L", (hero.width * ss, hero.height * ss), 0)
    draw = ImageDraw.Draw(geometry)
    for outer, inner in (
        ((84, 72, 222, 222), (97, 103, 209, 215)),
        ((279, 26, 471, 226), (295, 56, 455, 216)),
        ((528, 72, 667, 222), (540, 103, 652, 215)),
    ):
        draw.ellipse(tuple(v * ss for v in outer), fill=255)
        draw.ellipse(tuple(v * ss for v in inner), fill=0)
    # Preserve the three crown/diamond tips above the circular frames.
    # Stop each tip mask exactly at the portrait aperture.  Extending these
    # rectangles farther down would place a dark rectangular patch over the
    # upper part of the live circular avatar.
    draw.rectangle(tuple(v * ss for v in (132, 62, 175, 102)), fill=255)
    draw.rectangle(tuple(v * ss for v in (348, 0, 401, 55)), fill=255)
    draw.rectangle(tuple(v * ss for v in (574, 61, 617, 102)), fill=255)

    alpha = geometry.resize(hero.size, Image.Resampling.LANCZOS)
    hero.putalpha(alpha)
    return hero


def exact_header(reference: Image.Image) -> Image.Image:
    """Use the taller 我的战绩 header rhythm without changing page content."""
    header = scaled_crop(reference, (0, 0, 1024, 78), (750, 72)).convert("RGBA")
    # Reproduce the same continuous curved divider as 我的战绩 at 4x and
    # downsample it, avoiding the jagged or broken one-pixel result produced by
    # directly scaling the source pixels.
    ss = 4
    ornament = Image.new("RGBA", (750 * ss, 72 * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ornament)
    points = [(277, -2), (269, 17), (261, 36), (253, 54),
              (247, 63), (239, 68), (229, 71), (216, 72)]
    points = [(x * ss, y * ss) for x, y in points]
    draw.line(points, fill=(49, 40, 28, 190), width=3 * ss, joint="curve")
    draw.line(points, fill=(218, 172, 105, 255), width=1 * ss, joint="curve")
    header.alpha_composite(ornament.resize(header.size, Image.Resampling.LANCZOS))
    return header


def clean_summary(reference: Image.Image) -> Image.Image:
    panel = scaled_crop(reference, (32, 473, 992, 546), (704, 53)).convert("RGBA")
    # All four summary values are live data. Clear the whole inner field so no
    # baked digits can remain visible behind a shorter runtime value, while
    # retaining the approved one-pixel highlight, outline and rounded corners.
    return clean_wide_panel(panel, edge=2)


def review_button(return_button: Image.Image) -> Image.Image:
    """Build the requested top-right action from the accepted button material."""
    base = return_button.resize((178, 46), Image.Resampling.LANCZOS).convert("RGBA")
    base = erase_horizontal(base, 34, 164, 5, 41)
    ss = 4
    overlay = Image.new("RGBA", (178 * ss, 46 * ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    gold = (236, 201, 151, 255)
    dark = (3, 24, 40, 210)
    draw.ellipse((12 * ss, 11 * ss, 36 * ss, 35 * ss), outline=gold, width=2 * ss)
    draw.polygon(((21 * ss, 16 * ss), (21 * ss, 30 * ss), (31 * ss, 23 * ss)), fill=gold)
    font = ImageFont.truetype(str(FONT_PATH), 21 * ss)
    draw.text((102 * ss, 23 * ss), "牌局回顾", font=font, anchor="mm",
              fill=gold, stroke_width=1 * ss, stroke_fill=dark)
    base.alpha_composite(overlay.resize(base.size, Image.Resampling.LANCZOS))
    return base


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    reference = Image.open(REFERENCE).convert("RGB")
    if reference.size != (1024, 1536):
        raise RuntimeError(f"06-结算.png 尺寸异常: {reference.size}")

    save(exact_background(reference), "settlement_bg_exact.png")
    save(exact_header(reference), "settlement_header_exact.png")
    save(clean_hero(reference), "settlement_hero_exact.png")
    save(award_frames_overlay(reference), "settlement_award_frames_exact.png")
    save(clean_summary(reference), "settlement_summary_exact.png")
    save(scaled_crop(reference, (29, 558, 995, 646), (708, 65)),
         "settlement_table_header_exact.png")

    list_panel = scaled_crop(reference, (29, 643, 995, 1336), (708, 508))
    save(clean_wide_panel(list_panel), "settlement_list_panel_exact.png", sliced=True)

    row = scaled_crop(reference, (48, 644, 976, 739), (680, 70))
    save(clean_wide_panel(row, edge=2), "settlement_row_exact.png")

    return_button = scaled_crop(reference, (305, 1364, 715, 1455), (300, 67)).convert("RGBA")
    save(return_button, "settlement_return_exact.png")
    save(review_button(return_button), "settlement_review_exact.png")

    print("已从06-结算确认稿提取标题、荣誉区、汇总栏、玩家表格、返回及牌局回顾按钮。")


if __name__ == "__main__":
    main()
