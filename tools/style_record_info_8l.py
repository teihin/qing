#!/usr/bin/env python3
"""Deterministically rebuild the battle-detail page in premium 8L art.

The generated PNGs and the companion prefab layout form one approved visual
system. Runtime node names and scripts remain unchanged.
"""

from __future__ import annotations

import shutil
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DETAIL = ROOT / "assets/ImagesLuck/战绩详情"
COMMON_FRAME = ROOT / "assets/ImagesLuck/公用/皇冠框.png"
HONOR_AVATAR_FRAME = DETAIL / "荣誉头像框.png"
MASTER_LOGO = ROOT / "WebHome/assets/8l-logo.png"
FONT_PATH = ROOT / "assets/font/PingFF.ttf"
ART_DIR = ROOT / "art_sources/record_info"
AI_DIRECTION = ART_DIR / "8l_record_info_ai_direction.png"
BACKUP_DIR = ROOT / "HisImg/20260815-record-info-before-redesign"
PREVIEW_PATH = ART_DIR / "8l_record_info_runtime_preview.png"

SCALE = 4
NAVY = (2, 12, 27, 255)
NAVY_MID = (4, 28, 48, 255)
NAVY_LIGHT = (6, 48, 70, 255)
SILVER = (218, 235, 243, 255)
SILVER_DARK = (104, 139, 157, 255)
CYAN = (34, 205, 218, 255)
CYAN_SOFT = (82, 181, 202, 255)
CHAMPAGNE = (231, 200, 132, 255)
BRONZE = (184, 143, 91, 255)
WHITE = (242, 250, 253, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size * SCALE)


def canvas(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", (size[0] * SCALE, size[1] * SCALE), (0, 0, 0, 0))


def sc(value: float) -> int:
    return round(value * SCALE)


def lerp_color(first: tuple[int, ...], second: tuple[int, ...], amount: float) -> tuple[int, ...]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(first, second))


def downsample(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def gradient(size: tuple[int, int], top: tuple[int, int, int, int], bottom: tuple[int, int, int, int]) -> Image.Image:
    image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        amount = y / max(1, size[1] - 1)
        draw.line((0, y, size[0], y), fill=lerp_color(top, bottom, amount))
    return image


def add_glow(base: Image.Image, mask: Image.Image, color: tuple[int, int, int], radius: float, opacity: float) -> None:
    blurred = mask.filter(ImageFilter.GaussianBlur(sc(radius)))
    blurred = blurred.point(lambda value: round(value * opacity))
    layer = Image.new("RGBA", base.size, (*color, 0))
    layer.putalpha(blurred)
    base.alpha_composite(layer)


def text_position(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont,
                  box: tuple[int, int, int, int], stroke_width: int = 0) -> tuple[int, int]:
    bounds = draw.textbbox((0, 0), text, font=face, stroke_width=stroke_width)
    x = (box[0] + box[2] - (bounds[2] - bounds[0])) / 2 - bounds[0]
    y = (box[1] + box[3] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    return round(x), round(y)


def metallic_text(base: Image.Image, text: str, font_size: int,
                  box: tuple[int, int, int, int],
                  top: tuple[int, int, int, int] = WHITE,
                  bottom: tuple[int, int, int, int] = SILVER_DARK,
                  glow: tuple[int, int, int] = (19, 148, 188),
                  stroke: tuple[int, int, int, int] = (0, 9, 20, 255),
                  stroke_width: int = 1) -> None:
    face = font(font_size)
    mask = Image.new("L", base.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    scaled_box = tuple(sc(value) for value in box)
    position = text_position(mask_draw, text, face, scaled_box, sc(stroke_width))

    stroke_mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(stroke_mask).text(
        position, text, font=face, fill=255,
        stroke_width=sc(stroke_width), stroke_fill=255,
    )
    add_glow(base, stroke_mask, glow, 1.8, 0.30)
    stroke_layer = Image.new("RGBA", base.size, stroke)
    stroke_layer.putalpha(stroke_mask)
    base.alpha_composite(stroke_layer)

    mask_draw.text(position, text, font=face, fill=255)
    fill = gradient(base.size, top, bottom)
    fill.putalpha(mask)
    base.alpha_composite(fill)

    # A restrained one-pixel upper highlight gives the small text a bevel.
    highlight = Image.new("L", base.size, 0)
    ImageDraw.Draw(highlight).text((position[0], position[1] - sc(0.5)), text, font=face, fill=115)
    highlight_layer = Image.new("RGBA", base.size, (255, 255, 255, 0))
    highlight_layer.putalpha(highlight)
    base.alpha_composite(highlight_layer)


def polygon_panel(image: Image.Image, points: list[tuple[float, float]],
                  top: tuple[int, int, int, int], bottom: tuple[int, int, int, int],
                  outer: tuple[int, int, int, int], inner: tuple[int, int, int, int]) -> None:
    pts = [(sc(x), sc(y)) for x, y in points]
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    add_glow(image, mask, outer[:3], 2.2, 0.23)
    fill = gradient(image.size, top, bottom)
    fill.putalpha(mask)
    image.alpha_composite(fill)
    draw = ImageDraw.Draw(image)
    draw.line(pts + [pts[0]], fill=outer, width=sc(2), joint="curve")
    inset = [
        (
            round(image.width / 2 + (x - image.width / 2) * 0.985),
            round(image.height / 2 + (y - image.height / 2) * 0.985),
        )
        for x, y in pts
    ]
    draw.line(inset + [inset[0]], fill=inner, width=sc(0.8), joint="curve")


def diamond(draw: ImageDraw.ImageDraw, center: tuple[float, float], radius: float,
            fill: tuple[int, int, int, int] = CYAN,
            outline: tuple[int, int, int, int] = SILVER) -> None:
    cx, cy = center
    points = [(sc(cx), sc(cy - radius)), (sc(cx + radius), sc(cy)),
              (sc(cx), sc(cy + radius)), (sc(cx - radius), sc(cy))]
    draw.polygon(points, fill=fill, outline=outline)


def title_asset(path: Path, text: str, size: tuple[int, int], compact: bool = False) -> None:
    image = canvas(size)
    height = size[1]
    points = [
        (1, height * 0.52), (10, 6), (32, 6), (38, 2),
        (size[0] - 38, 2), (size[0] - 32, 6), (size[0] - 10, 6),
        (size[0] - 1, height * 0.52), (size[0] - 10, height - 6),
        (size[0] - 34, height - 6), (size[0] - 40, height - 2),
        (40, height - 2), (34, height - 6), (10, height - 6),
    ]
    polygon_panel(image, points, (8, 40, 61, 246), NAVY, SILVER, (26, 135, 163, 230))
    draw = ImageDraw.Draw(image)
    diamond(draw, (size[0] / 2, 3.5), 3.3)
    draw.line((sc(8), sc(height - 5), sc(36), sc(height - 5)), fill=(38, 186, 203, 170), width=sc(0.8))
    draw.line((sc(size[0] - 36), sc(height - 5), sc(size[0] - 8), sc(height - 5)), fill=(38, 186, 203, 170), width=sc(0.8))
    metallic_text(image, text, 22 if compact else 24, (3, 1, size[0] - 3, height - 1),
                  stroke_width=1)
    image = downsample(image, size)
    image.save(path, optimize=True)


def ai_title_asset(path: Path, text: str, size: tuple[int, int],
                   crop_box: tuple[int, int, int, int], compact: bool = False) -> None:
    """Extract the approved metallic art lettering while removing its mockup background."""
    if not AI_DIRECTION.is_file():
        title_asset(path, text, size, compact)
        return
    source = Image.open(AI_DIRECTION).convert("RGB").crop(crop_box)
    source = source.resize(size, Image.Resampling.LANCZOS).convert("RGBA")
    pixels = []
    for red, green, blue, _ in source.get_flattened_data():
        # The direction sheet uses a nearly black/navy backdrop. Brightness-keying
        # keeps the silver letters, cyan filigree and bevel while making the outer
        # mockup background genuinely transparent for Cocos.
        brightness = max(red, green, blue)
        alpha = max(0, min(255, round((brightness - 28) * 2.6)))
        pixels.append((red, green, blue, alpha))
    source.putdata(pixels)
    source.save(path, optimize=True)


def honor_badge(path: Path, text: str, style: str) -> None:
    size = Image.open(path).size
    image = canvas(size)
    palettes = {
        "wealth": (CHAMPAGNE, (114, 76, 25, 255), (231, 194, 116), (255, 241, 184, 255), CHAMPAGNE),
        "mvp": (SILVER, (18, 88, 116, 255), (38, 171, 210), WHITE, (112, 194, 219, 255)),
        "fish": ((62, 223, 219, 255), (3, 83, 103, 255), (24, 190, 198), (209, 255, 251, 255), (35, 191, 200, 255)),
        "worker": ((198, 176, 139, 255), (73, 61, 48, 255), (93, 161, 167), (239, 229, 207, 255), BRONZE),
    }
    outer, inner_tone, glow, text_top, text_bottom = palettes[style]
    if style == "mvp":
        points = [(3, 31), (14, 15), (40, 13), (49, 5), (60, 1), (71, 5), (80, 13), (106, 15), (117, 31), (106, 48), (77, 49), (69, 57), (51, 57), (43, 49), (14, 48)]
    elif style == "fish":
        points = [(2, 30), (14, 17), (36, 17), (44, 10), (76, 10), (84, 17), (106, 17), (118, 30), (106, 44), (84, 44), (76, 51), (44, 51), (36, 44), (14, 44)]
    elif style == "worker":
        points = [(4, 20), (15, 11), (39, 11), (45, 5), (75, 5), (81, 11), (105, 11), (116, 20), (116, 46), (105, 54), (15, 54), (4, 46)]
    else:
        points = [(3, 26), (15, 13), (38, 13), (46, 6), (74, 6), (82, 13), (105, 13), (117, 26), (111, 47), (81, 47), (74, 55), (46, 55), (39, 47), (9, 47)]
    polygon_panel(image, points, (8, 40, 59, 250), NAVY, outer, inner_tone)
    draw = ImageDraw.Draw(image)

    if style == "wealth":
        crown = [(49, 13), (51, 5), (57, 10), (60, 2), (64, 10), (70, 5), (71, 13)]
        draw.polygon([(sc(x), sc(y)) for x, y in crown], fill=CHAMPAGNE, outline=SILVER)
        draw.line((sc(49), sc(14), sc(71), sc(14)), fill=CHAMPAGNE, width=sc(1.5))
    elif style == "mvp":
        diamond(draw, (60, 8), 6, CYAN, WHITE)
        diamond(draw, (60, 8), 2.2, (219, 252, 255, 255), CYAN)
    elif style == "fish":
        draw.arc((sc(39), sc(3), sc(81), sc(27)), 18, 160, fill=(70, 226, 225, 230), width=sc(1.5))
        draw.arc((sc(46), sc(7), sc(74), sc(21)), 20, 155, fill=SILVER, width=sc(0.8))
        diamond(draw, (60, 8), 3.2, CYAN, SILVER)
    else:
        for angle_x, angle_y in ((52, 5), (60, 2), (68, 5), (74, 10), (46, 10)):
            draw.rectangle((sc(angle_x - 1.2), sc(angle_y), sc(angle_x + 1.2), sc(angle_y + 6)), fill=BRONZE)
        draw.ellipse((sc(53), sc(7), sc(67), sc(21)), outline=SILVER, width=sc(1.2))
        diamond(draw, (60, 14), 2.5, CYAN_SOFT, SILVER)

    metallic_text(image, text, 24 if text != "MVP" else 25, (5, 13, 115, 56),
                  top=text_top, bottom=text_bottom, glow=glow)
    downsample(image, size).save(path, optimize=True)


def rounded_glass(size: tuple[int, int], radius: int, separators: tuple[int, ...] = (),
                  corner_marks: bool = False, left_accent: bool = False) -> Image.Image:
    image = canvas(size)
    mask = Image.new("L", image.size, 0)
    box = (sc(2), sc(2), sc(size[0] - 2), sc(size[1] - 2))
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=sc(radius), fill=255)
    add_glow(image, mask, (17, 138, 178), 2.2, 0.20)
    fill = gradient(image.size, (7, 38, 59, 238), (2, 14, 29, 248))
    fill.putalpha(mask)
    image.alpha_composite(fill)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box, radius=sc(radius), outline=(150, 188, 205, 245), width=sc(2))
    draw.rounded_rectangle((sc(5), sc(5), sc(size[0] - 5), sc(size[1] - 5)),
                           radius=sc(max(2, radius - 3)), outline=(19, 112, 145, 220), width=sc(1))
    draw.line((sc(18), sc(6), sc(size[0] - 18), sc(6)), fill=(204, 236, 245, 90), width=sc(0.8))
    for x in separators:
        draw.line((sc(x), sc(12), sc(x), sc(size[1] - 12)), fill=(52, 116, 140, 150), width=sc(1))
        draw.ellipse((sc(x - 1.7), sc(size[1] / 2 - 1.7), sc(x + 1.7), sc(size[1] / 2 + 1.7)), fill=(63, 192, 207, 170))
    if corner_marks:
        color = (102, 202, 215, 210)
        for x, y, sx, sy in ((11, 11, 1, 1), (size[0] - 11, 11, -1, 1),
                              (11, size[1] - 11, 1, -1), (size[0] - 11, size[1] - 11, -1, -1)):
            draw.line((sc(x), sc(y + 8 * sy), sc(x), sc(y), sc(x + 12 * sx), sc(y)), fill=color, width=sc(1.5))
    if left_accent:
        draw.rounded_rectangle((sc(3), sc(18), sc(8), sc(size[1] - 18)), radius=sc(2), fill=(33, 187, 203, 210))
    return image


def honor_frame(path: Path) -> None:
    size = Image.open(path).size
    image = canvas(size)
    body = rounded_glass(size, 38)
    image.alpha_composite(body)
    draw = ImageDraw.Draw(image)

    # Cover the ordinary center border with the same full 8L crest used by the
    # approved direction sheet. The logo is intentionally allowed to overlap
    # the panel edge so the hierarchy reads like the reference, not a generic
    # rounded rectangle with plain text in the middle.
    cx = size[0] / 2
    draw.line((sc(28), sc(42), sc(cx - 60), sc(42)), fill=(67, 172, 194, 150), width=sc(1))
    draw.line((sc(cx + 60), sc(42), sc(size[0] - 28), sc(42)), fill=(67, 172, 194, 150), width=sc(1))
    logo = Image.open(MASTER_LOGO).convert("RGBA").resize((sc(114), sc(114)), Image.Resampling.LANCZOS)
    shadow = logo.getchannel("A").filter(ImageFilter.GaussianBlur(sc(4)))
    logo_x = sc(cx - 57)
    logo_y = sc(-5)
    glow_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_crop = Image.new("RGBA", logo.size, (30, 183, 211, 0))
    glow_crop.putalpha(shadow.point(lambda value: round(value * 0.45)))
    glow_layer.alpha_composite(glow_crop, (logo_x, logo_y))
    image.alpha_composite(glow_layer)
    image.alpha_composite(logo, (logo_x, logo_y))
    downsample(image, size).save(path, optimize=True)


def honor_avatar_frame(path: Path) -> None:
    """Build the circular silver/cyan portrait frame used by all four honors."""
    size = (153, 153)
    image = canvas(size)
    draw = ImageDraw.Draw(image)
    cx = cy = size[0] / 2

    glow_mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(glow_mask).ellipse(
        (sc(9), sc(9), sc(size[0] - 9), sc(size[1] - 9)),
        outline=255,
        width=sc(8),
    )
    add_glow(image, glow_mask, (31, 177, 207), 3.5, 0.48)

    for inset, color, width in (
        (8, SILVER, 2.2),
        (12, (38, 164, 190, 255), 1.2),
        (16, (132, 172, 188, 230), 1.0),
    ):
        draw.ellipse(
            (sc(inset), sc(inset), sc(size[0] - inset), sc(size[1] - inset)),
            outline=color,
            width=sc(width),
        )

    # Cardinal details and the top diamond reproduce the premium instrument
    # ring language of the mockup without covering the dynamic portrait.
    for angle in range(0, 360, 45):
        import math
        rad = math.radians(angle)
        x1 = cx + math.cos(rad) * 63
        y1 = cy + math.sin(rad) * 63
        x2 = cx + math.cos(rad) * 68
        y2 = cy + math.sin(rad) * 68
        draw.line((sc(x1), sc(y1), sc(x2), sc(y2)), fill=(214, 235, 242, 225), width=sc(1.1))
    diamond(draw, (cx, 8), 5.2, CYAN, WHITE)
    diamond(draw, (cx, 8), 2.1, WHITE, CYAN)
    downsample(image, size).save(path, optimize=True)


def medal_asset(path: Path, number: str, tone: tuple[int, int, int, int]) -> None:
    size = Image.open(path).size
    image = canvas(size)
    draw = ImageDraw.Draw(image)
    cx, cy = size[0] / 2, size[1] / 2
    draw.polygon([(sc(cx - 13), sc(cy + 10)), (sc(cx - 4), sc(size[1] - 2)), (sc(cx), sc(cy + 19)),
                  (sc(cx + 5), sc(size[1] - 2)), (sc(cx + 13), sc(cy + 10))], fill=(11, 79, 100, 255))
    draw.ellipse((sc(cx - 26), sc(cy - 26), sc(cx + 26), sc(cy + 26)), fill=NAVY, outline=tone, width=sc(2.5))
    draw.ellipse((sc(cx - 21), sc(cy - 21), sc(cx + 21), sc(cy + 21)), outline=(89, 180, 198, 220), width=sc(1))
    metallic_text(image, number, 28, (round(cx - 24), round(cy - 24), round(cx + 24), round(cy + 24)),
                  top=WHITE, bottom=tone, glow=(25, 158, 194))
    downsample(image, size).save(path, optimize=True)


def logo_asset(path: Path) -> None:
    size = Image.open(path).size
    image = canvas(size)
    cx, cy = size[0] / 2, size[1] / 2
    points = [(cx, 2), (cx + 49, 19), (cx + 41, 63), (cx, 90), (cx - 41, 63), (cx - 49, 19)]
    polygon_panel(image, points, (7, 61, 84, 255), NAVY, SILVER, (26, 167, 192, 235))
    diamond(ImageDraw.Draw(image), (cx, 12), 5, CYAN, WHITE)
    metallic_text(image, "8L", 42, (round(cx - 47), 12, round(cx + 47), 75),
                  top=WHITE, bottom=(101, 165, 188, 255), glow=(24, 171, 205))
    downsample(image, size).save(path, optimize=True)


def simple_label(path: Path, text: str, font_size: int) -> None:
    size = Image.open(path).size
    image = canvas(size)
    metallic_text(image, text, font_size, (0, 0, size[0], size[1]),
                  top=WHITE, bottom=(91, 161, 183, 255), glow=(22, 147, 184))
    draw = ImageDraw.Draw(image)
    draw.line((sc(size[0] * 0.20), sc(size[1] - 3), sc(size[0] * 0.80), sc(size[1] - 3)),
              fill=(32, 182, 197, 170), width=sc(0.8))
    downsample(image, size).save(path, optimize=True)


def chip_asset(path: Path) -> None:
    size = Image.open(path).size
    image = canvas(size)
    draw = ImageDraw.Draw(image)
    draw.ellipse((sc(4), sc(1), sc(size[0] - 4), sc(size[1] - 1)), fill=(3, 31, 49, 255), outline=SILVER, width=sc(2))
    draw.ellipse((sc(10), sc(7), sc(size[0] - 10), sc(size[1] - 7)), outline=CYAN, width=sc(1.5))
    metallic_text(image, "8L", 12, (8, 6, size[0] - 8, size[1] - 6), top=WHITE, bottom=SILVER_DARK)
    downsample(image, size).save(path, optimize=True)


def backup_targets(paths: list[Path]) -> None:
    if BACKUP_DIR.exists():
        return
    for path in paths:
        relative = path.relative_to(ROOT)
        target = BACKUP_DIR / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        meta = path.with_suffix(path.suffix + ".meta")
        if meta.is_file():
            meta_target = BACKUP_DIR / meta.relative_to(ROOT)
            meta_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(meta, meta_target)


def preserve_meta_contract(paths: list[Path]) -> None:
    """Keep Creator's historical auto-trim rectangle and UUID file byte-for-byte."""
    for path in paths:
        meta = path.with_suffix(path.suffix + ".meta")
        backup_meta = BACKUP_DIR / meta.relative_to(ROOT)
        if not backup_meta.is_file():
            raise RuntimeError(f"missing original meta backup: {backup_meta}")
        document = json.loads(backup_meta.read_text(encoding="utf-8"))
        sub_meta = next(iter(document["subMetas"].values()))
        trim_x = int(sub_meta["trimX"])
        trim_y = int(sub_meta["trimY"])
        trim_width = int(sub_meta["width"])
        trim_height = int(sub_meta["height"])

        image = Image.open(path).convert("RGBA")
        alpha = image.getchannel("A")
        clipped = Image.new("L", image.size, 0)
        clipped.paste(
            alpha.crop((trim_x, trim_y, trim_x + trim_width, trim_y + trim_height)),
            (trim_x, trim_y),
        )
        image.putalpha(clipped)
        pixels = image.load()
        for x, y in (
            (trim_x, trim_y),
            (trim_x + trim_width - 1, trim_y),
            (trim_x, trim_y + trim_height - 1),
            (trim_x + trim_width - 1, trim_y + trim_height - 1),
        ):
            red, green, blue, alpha_value = pixels[x, y]
            if alpha_value < 8:
                pixels[x, y] = (red or 8, green or 28, blue or 42, 8)
        image.save(path, optimize=True)
        shutil.copy2(backup_meta, meta)


def build_preview() -> None:
    background = Image.open(ROOT / "assets/ImagesLuck/公用/背景.png").convert("RGBA").resize((750, 1334), Image.Resampling.LANCZOS)
    overlay = Image.new("RGBA", background.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    body_font = ImageFont.truetype(str(FONT_PATH), 18)
    small_font = ImageFont.truetype(str(FONT_PATH), 15)

    def paste_center(path: Path, center_xy: tuple[int, int], target_size: tuple[int, int] | None = None) -> None:
        item = Image.open(path).convert("RGBA")
        if target_size is not None:
            item = item.resize(target_size, Image.Resampling.LANCZOS)
        overlay.alpha_composite(item, (round(center_xy[0] - item.width / 2), round(center_xy[1] - item.height / 2)))

    paste_center(DETAIL / "战局详情.png", (375, 49), (268, 83))
    paste_center(DETAIL / "回放.png", (650, 49), (208, 61))
    paste_center(COMMON_FRAME, (375, 337), (664, 367))

    avatar_frame = Image.open(HONOR_AVATAR_FRAME).convert("RGBA")
    avatar = Image.open(ROOT / "assets/resources/other/默认头像.png").convert("RGBA")
    honors = [(143, 298, "土豪.png", "玩家甲"), (298, 298, "MVP.png", "玩家乙"),
              (452, 298, "大鱼.png", "玩家丙"), (607, 298, "劳模.png", "玩家丁")]
    for x, y, badge_name, player in honors:
        overlay.alpha_composite(avatar_frame.resize((129, 129), Image.Resampling.LANCZOS), (x - 64, y - 64))
        overlay.alpha_composite(avatar.resize((97, 97), Image.Resampling.LANCZOS), (x - 48, y - 48))
        paste_center(DETAIL / badge_name, (x, y + 66), (116, 57))
        bounds = draw.textbbox((0, 0), player, font=small_font)
        draw.text((x - (bounds[2] - bounds[0]) / 2, y + 120), player, font=small_font, fill=(201, 225, 234, 255))

    paste_center(DETAIL / "时间框.png", (375, 547), (589, 78))
    draw.text((325, 525), "1-555555", font=body_font, fill=(73, 205, 219, 255))
    draw.text((300, 554), "08-15 19:30  至  20:15", font=small_font, fill=(179, 207, 218, 255))
    paste_center(DETAIL / "数据底框.png", (375, 635), (735, 64))
    for x, text in ((135, "奖池 8888"), (328, "总手数 25"), (535, "总带入 12000")):
        draw.text((x, 626), text, font=small_font, fill=(208, 230, 237, 255))

    for index in range(5):
        y = 690 + index * 123
        paste_center(DETAIL / "战绩数据底框.png", (375, y + 55))
        draw.text((205, y + 25), f"玩家{index + 1}", font=body_font, fill=(213, 235, 241, 255))
        draw.text((205, y + 51), f"ID: 10368{index}", font=small_font, fill=(116, 172, 190, 255))
        draw.text((205, y + 76), "带入: 1200", font=small_font, fill=(181, 207, 216, 255))
        draw.text((390, y + 43), "手数: 25", font=body_font, fill=(207, 229, 236, 255))
        draw.text((565, y + 43), "+320", font=body_font, fill=(67, 207, 211, 255))

    background.alpha_composite(overlay)
    ART_DIR.mkdir(parents=True, exist_ok=True)
    background.convert("RGB").save(PREVIEW_PATH, optimize=True)


def build() -> list[Path]:
    # The portrait ring is a new, purpose-built asset and therefore has no
    # legacy trim contract to restore. Every historical texture still keeps
    # its byte-for-byte original meta file.
    targets = sorted(path for path in DETAIL.glob("*.png") if path != HONOR_AVATAR_FRAME) + [COMMON_FRAME]
    backup_targets(targets)

    ai_title_asset(DETAIL / "战局详情.png", "战局详情", Image.open(DETAIL / "战局详情.png").size,
                   (300, 22, 655, 128))
    ai_title_asset(DETAIL / "回放.png", "牌局回顾", Image.open(DETAIL / "回放.png").size,
                   (670, 33, 940, 115), compact=True)
    honor_badge(DETAIL / "土豪.png", "土豪", "wealth")
    honor_badge(DETAIL / "MVP.png", "MVP", "mvp")
    honor_badge(DETAIL / "大鱼.png", "大鱼", "fish")
    honor_badge(DETAIL / "劳模.png", "劳模", "worker")

    for path, separators, corners, accent in (
        (DETAIL / "房间信息底板.png", (182, 364, 546), True, False),
        (DETAIL / "数据底框.png", (250, 500), False, False),
        (DETAIL / "时间框.png", (), True, False),
        (DETAIL / "战绩数据底框.png", (), True, True),
    ):
        size = Image.open(path).size
        result = rounded_glass(size, 12 if size[1] > 60 else 9, separators, corners, accent)
        downsample(result, size).save(path, optimize=True)

    honor_frame(COMMON_FRAME)
    honor_avatar_frame(HONOR_AVATAR_FRAME)
    medal_asset(DETAIL / "1.png", "1", CHAMPAGNE)
    medal_asset(DETAIL / "2.png", "2", SILVER)
    medal_asset(DETAIL / "3.png", "3", BRONZE)
    combined = Image.new("RGBA", Image.open(DETAIL / "123.png").size, (0, 0, 0, 0))
    for x, name in ((6, "1.png"), (74, "2.png"), (142, "3.png")):
        combined.alpha_composite(Image.open(DETAIL / name).convert("RGBA"), (x, 0))
    combined.save(DETAIL / "123.png", optimize=True)
    logo_asset(DETAIL / "LOGO.png")

    for name, text, font_size in (("奖池.png", "奖池", 17), ("本局总手数.png", "本局总手数", 18),
                                  ("本局总带入.png", "本局总带入", 18)):
        simple_label(DETAIL / name, text, font_size)
    simple_label(DETAIL / "数字.png", "0 1 2 3 4 5 6 7 8 9", 15)
    chip_asset(DETAIL / "筹码.png")

    preserve_meta_contract(targets)
    build_preview()
    return targets + [HONOR_AVATAR_FRAME]


if __name__ == "__main__":
    generated = build()
    print(f"updated {len(generated)} battle-detail images")
    print(f"backup: {BACKUP_DIR.relative_to(ROOT)}")
    print(f"preview: {PREVIEW_PATH.relative_to(ROOT)}")
