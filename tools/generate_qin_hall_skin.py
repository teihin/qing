#!/usr/bin/env python3
"""Generate deterministic black-gold art slices for panelMain's discovery page.

The runtime logo and selected discovery button are exported as static Sprite
images.  The existing nodes remain in panelMain, while their former
DragonBones components are replaced by cc.Sprite components in the prefab.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
HALL = ROOT / "assets" / "ImagesLuck" / "大厅"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用1"
OLD_HALL = ROOT / "assets" / "imagesKK" / "游戏大厅"
OTHER = ROOT / "assets" / "resources" / "other"
LOGO_ATLAS = ROOT / "assets" / "ImagesLuck" / "动画" / "大厅LOGO动画" / "logo_tex.png"
NAV_ATLAS = ROOT / "assets" / "ImagesLuck" / "动画" / "导航按钮动画" / "MainButton_backup_tex.png"
ART = ROOT / "art_sources" / "hall"

BACKGROUND_SOURCE = ART / "qin_hall_background_source.png"
PAIGOW_SOURCE = ART / "qin_paigow_source.png"

PING = ROOT / "assets" / "font" / "PingFF.ttf"
HEITI = Path("/System/Library/Fonts/STHeiti Medium.ttc")
SONGTI = Path("/System/Library/Fonts/Supplemental/Songti.ttc")
LATIN = Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf")

GOLD_HI = (255, 239, 184, 255)
GOLD = (218, 164, 74, 255)
GOLD_MID = (168, 105, 33, 255)
GOLD_DARK = (82, 46, 14, 255)
OBSIDIAN = (9, 8, 7, 246)
S = 4


def font(path: Path, size: float, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), round(size * S), index=index)


def vertical_gradient(size: tuple[int, int], top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    return gradient(size, top, bottom)


def gradient(size: tuple[int, int], top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    """Efficient vertical gradient (kept separate for readability)."""
    mode = "RGBA" if len(top) == 4 else "RGB"
    column = Image.new(mode, (1, size[1]))
    values = []
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        values.append(tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(len(top))))
    column.putdata(values)
    return column.resize(size)


def center_text(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, text_font: ImageFont.FreeTypeFont,
                fill: tuple[int, ...], stroke_width: int = 0, stroke_fill: tuple[int, ...] | None = None) -> None:
    box = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke_width)
    x = xy[0] - (box[2] - box[0]) / 2 - box[0]
    y = xy[1] - (box[3] - box[1]) / 2 - box[1]
    draw.text((round(x), round(y)), text, font=text_font, fill=fill,
              stroke_width=stroke_width, stroke_fill=stroke_fill or fill)


def text_mask(size: tuple[int, int], text: str, text_font: ImageFont.FreeTypeFont,
              center: tuple[int, int], stroke: int = 0) -> Image.Image:
    mask = Image.new("L", size, 0)
    center_text(ImageDraw.Draw(mask), center, text, text_font, 255, stroke, 255)
    return mask


def metal_text(image: Image.Image, text: str, text_font: ImageFont.FreeTypeFont,
               center: tuple[int, int], stroke: int = 1, glow: int = 4) -> None:
    fill_mask = text_mask(image.size, text, text_font, center)
    edge_mask = text_mask(image.size, text, text_font, center, stroke * S)
    if glow:
        aura = edge_mask.filter(ImageFilter.GaussianBlur(glow * S))
        layer = Image.new("RGBA", image.size, (204, 128, 38, 0))
        layer.putalpha(aura.point(lambda p: round(p * 0.30)))
        image.alpha_composite(layer)
    outline = Image.new("RGBA", image.size, (54, 28, 7, 0))
    outline.putalpha(edge_mask)
    image.alpha_composite(outline)
    metal = gradient(image.size, GOLD_HI, GOLD_MID)
    metal.putalpha(fill_mask)
    image.alpha_composite(metal)
    highlight = ImageChops.subtract(fill_mask, ImageChops.offset(fill_mask, S, S))
    high = Image.new("RGBA", image.size, (255, 249, 212, 0))
    high.putalpha(highlight)
    image.alpha_composite(high)


def letterspaced(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont,
                 center_x: float, y: float, spacing: float, fill: tuple[int, ...]) -> None:
    widths = [draw.textlength(ch, font=text_font) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = center_x - total / 2
    for ch, width in zip(text, widths):
        draw.text((round(x), round(y)), ch, font=text_font, fill=fill)
        x += width + spacing


def meta_trim(path: Path) -> tuple[int, int, int, int]:
    data = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    sub = next(iter(data.get("subMetas", {}).values()))
    return int(sub["trimX"]), int(sub["trimY"]), int(sub["width"]), int(sub["height"])


def constrain_alpha_to_meta(path: Path, image: Image.Image) -> Image.Image:
    """Keep Creator's current automatic-trim bounds byte-for-byte compatible."""
    if image.mode != "RGBA":
        return image
    x, y, w, h = meta_trim(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", image.size, 0)
    clipped.paste(alpha.crop((x, y, x + w, y + h)), (x, y))
    image.putalpha(clipped)
    px = image.load()
    for point in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
        r, g, b, a = px[point]
        if a < 8:
            px[point] = (r or 128, g or 78, b or 24, 8)
    return image


def save(path: Path, image: Image.Image, rgb: bool = False) -> Path:
    image = image.convert("RGB" if rgb else "RGBA")
    if not rgb:
        image = constrain_alpha_to_meta(path, image)
    image.save(path, optimize=True)
    return path


def make_background() -> Path:
    source = Image.open(BACKGROUND_SOURCE).convert("RGB")
    image = ImageOps.fit(source, (750, 1334), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    image = ImageEnhance.Color(image).enhance(0.78)
    image = ImageEnhance.Contrast(image).enhance(1.08).convert("RGBA")

    # Keep controls readable and make the lower room-list area deliberately quiet.
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, 750, 105), fill=(0, 0, 0, 85))
    for y in range(335, 1240):
        if y < 540:
            alpha = round(48 + (y - 335) * 0.22)
        else:
            alpha = round(93 + min(50, (y - 540) * 0.07))
        draw.line((0, y, 750, y), fill=(1, 1, 1, alpha))
    draw.rectangle((0, 1180, 750, 1334), fill=(0, 0, 0, 105))
    image.alpha_composite(overlay)

    vignette = Image.new("L", image.size, 235)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-190, -60, 940, 1500), fill=0)
    vignette = vignette.filter(ImageFilter.GaussianBlur(120))
    shade = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shade.putalpha(vignette.point(lambda p: round(p * 0.44)))
    image.alpha_composite(shade)
    return save(HALL / "大厅背景.png", image, rgb=True)


def make_top() -> Path:
    size = (750 * S, 92 * S)
    image = gradient(size, (6, 6, 6, 246), (13, 10, 7, 215))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 78 * S, 750 * S, 91 * S), fill=(5, 4, 3, 235))
    draw.line((0, 78 * S, 750 * S, 78 * S), fill=(91, 52, 18, 220), width=S)
    draw.line((0, 82 * S, 750 * S, 82 * S), fill=(245, 204, 119, 220), width=S)
    draw.line((0, 85 * S, 750 * S, 85 * S), fill=(104, 59, 18, 210), width=S)
    for inset, alpha in ((36, 110), (86, 65), (144, 36)):
        draw.arc((inset * S, -82 * S, (750 - inset) * S, 93 * S), 8, 172,
                 fill=(205, 139, 48, alpha), width=S)
    cx, cy = 375 * S, 82 * S
    draw.polygon(((cx, cy - 7 * S), (cx + 7 * S, cy), (cx, cy + 7 * S), (cx - 7 * S, cy)),
                 fill=(10, 8, 5, 255), outline=(246, 210, 132, 255))
    draw.ellipse((cx - S, cy - S, cx + S, cy + S), fill=(255, 237, 173, 255))
    return save(COMMON / "顶部.png", image.resize((750, 92), Image.Resampling.LANCZOS))


def make_title() -> Path:
    image = Image.new("RGBA", (128 * S, 39 * S), (0, 0, 0, 0))
    metal_text(image, "游戏大厅", font(PING, 27), (64 * S, 19 * S), stroke=1, glow=2)
    return save(HALL / "游戏大厅标题.png", image.resize((128, 39), Image.Resampling.LANCZOS))


def make_customer_service() -> Path:
    image = Image.new("RGBA", (54 * S, 65 * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    gold = GOLD
    draw.arc((7 * S, 4 * S, 47 * S, 42 * S), 190, 350, fill=gold, width=3 * S)
    draw.arc((12 * S, 9 * S, 42 * S, 39 * S), 190, 350, fill=GOLD_HI, width=S)
    draw.rounded_rectangle((5 * S, 22 * S, 14 * S, 37 * S), radius=3 * S,
                           fill=(13, 10, 7, 255), outline=gold, width=2 * S)
    draw.rounded_rectangle((40 * S, 22 * S, 49 * S, 37 * S), radius=3 * S,
                           fill=(13, 10, 7, 255), outline=gold, width=2 * S)
    draw.arc((24 * S, 28 * S, 46 * S, 43 * S), 0, 95, fill=gold, width=2 * S)
    draw.ellipse((25 * S, 37 * S, 31 * S, 42 * S), fill=GOLD_HI)
    center_text(draw, (27 * S, 54 * S), "客服", font(HEITI, 15), GOLD_HI,
                stroke_width=S, stroke_fill=(69, 39, 12, 255))
    return save(HALL / "客服.png", image.resize((54, 65), Image.Resampling.LANCZOS))


def rounded_panel(size: tuple[int, int], outer: tuple[int, int, int, int], radius: int) -> Image.Image:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(outer, radius=radius, fill=(8, 7, 6, 244), outline=(102, 60, 19, 255), width=5 * S)
    inner = tuple(v + (5 * S if i < 2 else -5 * S) for i, v in enumerate(outer))
    draw.rounded_rectangle(inner, radius=max(S, radius - 4 * S), outline=(244, 205, 124, 220), width=S)
    return image


def make_filter_bar() -> Path:
    size = (750 * S, 131 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle((7 * S, 26 * S, 743 * S, 104 * S), radius=38 * S,
                         outline=(196, 120, 32, 150), width=7 * S)
    glow = glow.filter(ImageFilter.GaussianBlur(5 * S))
    image.alpha_composite(glow)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6 * S, 25 * S, 744 * S, 105 * S), radius=40 * S,
                           fill=(8, 7, 6, 244), outline=(104, 59, 18, 255), width=5 * S)
    draw.rounded_rectangle((12 * S, 31 * S, 738 * S, 99 * S), radius=34 * S,
                           outline=(247, 211, 133, 235), width=2 * S)
    draw.line((218 * S, 35 * S, 218 * S, 96 * S), fill=(120, 74, 27, 150), width=S)
    cx = 375 * S
    draw.polygon(((cx - 13 * S, 103 * S), (cx, 118 * S), (cx + 13 * S, 103 * S)),
                 fill=(12, 9, 6, 255), outline=(229, 176, 79, 255))
    draw.line((48 * S, 25 * S, 702 * S, 25 * S), fill=(255, 227, 160, 105), width=S)
    return save(OLD_HALL / "切页底.png", image.resize((750, 131), Image.Resampling.LANCZOS))


def make_quick_join() -> Path:
    size = (196 * S, 71 * S)
    image = rounded_panel(size, (2 * S, 3 * S, 194 * S, 68 * S), 31 * S)
    draw = ImageDraw.Draw(image)
    draw.ellipse((19 * S, 20 * S, 39 * S, 40 * S), outline=GOLD_HI, width=2 * S)
    draw.line((36 * S, 37 * S, 47 * S, 48 * S), fill=GOLD_HI, width=3 * S)
    center_text(draw, (119 * S, 35 * S), "快速加入", font(PING, 24), GOLD_HI,
                stroke_width=S, stroke_fill=(65, 37, 10, 255))
    return save(OLD_HALL / "快速加入.png", image.resize((196, 71), Image.Resampling.LANCZOS))


def make_selection() -> Path:
    size = (79 * S, 73 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    points = [(39 * S, 2 * S), (72 * S, 20 * S), (68 * S, 53 * S),
              (39 * S, 70 * S), (10 * S, 53 * S), (6 * S, 20 * S)]
    gd.line(points + [points[0]], fill=(219, 144, 44, 180), width=5 * S, joint="curve")
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(4 * S)))
    draw = ImageDraw.Draw(image)
    draw.polygon(points, fill=(10, 8, 5, 238), outline=(248, 214, 137, 255))
    inner = [(39 * S, 7 * S), (67 * S, 23 * S), (63 * S, 49 * S),
             (39 * S, 64 * S), (15 * S, 49 * S), (11 * S, 23 * S)]
    draw.line(inner + [inner[0]], fill=(141, 83, 23, 230), width=S, joint="curve")
    draw.ellipse((36 * S, 9 * S, 42 * S, 15 * S), fill=GOLD_HI)
    return save(HALL / "选择框.png", image.resize((79, 73), Image.Resampling.LANCZOS))


def make_number(name: str, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    metal_text(image, name, font(LATIN, 25), (size[0] * S // 2, size[1] * S // 2), stroke=1, glow=1)
    return save(HALL / f"{name}.png", image.resize(size, Image.Resampling.LANCZOS))


def make_room_frame() -> Path:
    size = (750 * S, 153 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((8 * S, 7 * S, 742 * S, 146 * S), radius=18 * S,
                                           outline=(190, 115, 30, 130), width=6 * S)
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5 * S)))
    panel = gradient(size, (31, 25, 16, 248), (5, 5, 5, 248))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((8 * S, 7 * S, 742 * S, 146 * S), radius=18 * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8 * S, 7 * S, 742 * S, 146 * S), radius=18 * S,
                           outline=(99, 57, 18, 255), width=5 * S)
    draw.rounded_rectangle((13 * S, 12 * S, 737 * S, 141 * S), radius=14 * S,
                           outline=(238, 197, 112, 210), width=S)
    draw.line((121 * S, 19 * S, 121 * S, 134 * S), fill=(105, 67, 29, 130), width=S)
    draw.arc((28 * S, 27 * S, 105 * S, 119 * S), 70, 290, fill=(199, 139, 53, 90), width=S)
    return save(HALL / "房间框.png", image.resize((750, 153), Image.Resampling.LANCZOS))


def make_big_icon() -> Path:
    size = (94 * S, 91 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((8 * S, 7 * S, 86 * S, 85 * S), outline=190, width=5 * S)
    aura = Image.new("RGBA", size, (202, 130, 37, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(4 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.ellipse((8 * S, 7 * S, 86 * S, 85 * S), fill=(8, 7, 5, 245), outline=GOLD_DARK, width=4 * S)
    draw.ellipse((14 * S, 13 * S, 80 * S, 79 * S), outline=GOLD_HI, width=S)
    metal_text(image, "秦", font(SONGTI, 48), (47 * S, 45 * S), stroke=1, glow=2)
    return save(HALL / "大图标.png", image.resize((94, 91), Image.Resampling.LANCZOS))


def make_game_name() -> Path:
    image = Image.new("RGBA", (89 * S, 32 * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((3 * S, 16 * S, 15 * S, 5 * S), fill=GOLD, width=S)
    draw.line((3 * S, 16 * S, 15 * S, 27 * S), fill=GOLD, width=S)
    center_text(draw, (52 * S, 16 * S), "地九王", font(PING, 20), GOLD_HI,
                stroke_width=S, stroke_fill=(59, 32, 8, 255))
    return save(HALL / "地九王.png", image.resize((89, 32), Image.Resampling.LANCZOS))


def make_small_icon(index: int, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    c = GOLD_HI
    w, h = size[0] * S, size[1] * S
    if index == 1:
        draw.ellipse((4 * S, 4 * S, w - 4 * S, h - 4 * S), outline=c, width=2 * S)
        draw.ellipse((9 * S, 9 * S, w - 9 * S, h - 9 * S), outline=GOLD_MID, width=S)
        center_text(draw, (w / 2, h / 2), "秦", font(SONGTI, 14), c)
    elif index == 2:
        draw.ellipse((9 * S, 3 * S, 19 * S, 14 * S), outline=c, width=2 * S)
        draw.rounded_rectangle((4 * S, 15 * S, 24 * S, 30 * S), radius=8 * S, outline=c, width=2 * S)
    else:
        draw.line((5 * S, 3 * S, 19 * S, 3 * S), fill=c, width=2 * S)
        draw.line((5 * S, 29 * S, 19 * S, 29 * S), fill=c, width=2 * S)
        draw.line((7 * S, 5 * S, 17 * S, 27 * S), fill=c, width=2 * S)
        draw.line((17 * S, 5 * S, 7 * S, 27 * S), fill=GOLD_MID, width=2 * S)
    return save(HALL / f"小图标{index}.png", image.resize(size, Image.Resampling.LANCZOS))


def make_status(filename: str, text: str, active: bool) -> Path:
    size = (96 * S, 32 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = GOLD_HI if active else (135, 116, 84, 255)
    for x in (2, 10):
        draw.line((x * S, 8 * S, (x + 8) * S, 16 * S), fill=color, width=2 * S)
        draw.line(((x + 8) * S, 16 * S, x * S, 24 * S), fill=color, width=2 * S)
    center_text(draw, (61 * S, 16 * S), text, font(HEITI, 17), color,
                stroke_width=S, stroke_fill=(48, 27, 8, 255))
    return save(OTHER / filename, image.resize((96, 32), Image.Resampling.LANCZOS))


def nav_icon(kind: str, label: str, size: tuple[int, int], bright: bool) -> Image.Image:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = GOLD_HI if bright else (119, 99, 67, 255)
    edge = GOLD_MID if bright else (66, 57, 43, 255)
    cx = size[0] * S / 2
    if bright:
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).ellipse((cx - 22 * S, 1 * S, cx + 22 * S, 42 * S), fill=170)
        aura = Image.new("RGBA", image.size, (192, 119, 30, 0))
        aura.putalpha(mask.filter(ImageFilter.GaussianBlur(6 * S)))
        image.alpha_composite(aura)
    if kind == "rank":
        draw.rectangle((cx - 20 * S, 27 * S, cx - 8 * S, 40 * S), outline=color, width=2 * S)
        draw.rectangle((cx - 6 * S, 19 * S, cx + 6 * S, 40 * S), outline=color, width=2 * S)
        draw.rectangle((cx + 8 * S, 24 * S, cx + 20 * S, 40 * S), outline=color, width=2 * S)
        draw.polygon(((cx, 2 * S), (cx + 4 * S, 9 * S), (cx + 12 * S, 10 * S),
                      (cx + 6 * S, 15 * S), (cx + 8 * S, 22 * S), (cx, 18 * S),
                      (cx - 8 * S, 22 * S), (cx - 6 * S, 15 * S), (cx - 12 * S, 10 * S),
                      (cx - 4 * S, 9 * S)), fill=color)
    elif kind == "notice":
        draw.rounded_rectangle((cx - 18 * S, 7 * S, cx + 18 * S, 37 * S), radius=5 * S,
                               outline=color, width=2 * S)
        draw.line((cx - 12 * S, 14 * S, cx + 12 * S, 14 * S), fill=edge, width=S)
        draw.line((cx - 12 * S, 21 * S, cx + 8 * S, 21 * S), fill=color, width=2 * S)
        draw.line((cx - 12 * S, 28 * S, cx + 4 * S, 28 * S), fill=edge, width=S)
    elif kind == "wallet":
        draw.rounded_rectangle((cx - 20 * S, 10 * S, cx + 20 * S, 38 * S), radius=5 * S,
                               outline=color, width=2 * S)
        draw.rounded_rectangle((cx + 4 * S, 18 * S, cx + 22 * S, 31 * S), radius=3 * S,
                               fill=(10, 8, 5, 255), outline=color, width=2 * S)
        draw.ellipse((cx + 9 * S, 22 * S, cx + 13 * S, 26 * S), fill=color)
    else:
        draw.ellipse((cx - 8 * S, 4 * S, cx + 8 * S, 20 * S), outline=color, width=2 * S)
        draw.arc((cx - 18 * S, 20 * S, cx + 18 * S, 45 * S), 185, 355, fill=color, width=2 * S)
        draw.line((cx - 18 * S, 33 * S, cx - 20 * S, 43 * S), fill=edge, width=2 * S)
        draw.line((cx + 18 * S, 33 * S, cx + 20 * S, 43 * S), fill=edge, width=2 * S)
    center_text(draw, (cx, (size[1] - 9) * S), label, font(PING, 17), color,
                stroke_width=S, stroke_fill=(45, 25, 7, 255))
    return image.resize(size, Image.Resampling.LANCZOS)


def make_bottom_bar() -> Path:
    size = (750 * S, 153 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    panel = gradient(size, (29, 23, 14, 250), (4, 4, 4, 253))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rectangle((0, 12 * S, 750 * S, 153 * S), fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.line((0, 12 * S, 279 * S, 12 * S), fill=GOLD_MID, width=4 * S)
    draw.line((471 * S, 12 * S, 750 * S, 12 * S), fill=GOLD_MID, width=4 * S)
    draw.line((0, 16 * S, 279 * S, 16 * S), fill=GOLD_HI, width=S)
    draw.line((471 * S, 16 * S, 750 * S, 16 * S), fill=GOLD_HI, width=S)
    draw.arc((278 * S, -44 * S, 472 * S, 150 * S), 180, 360, fill=GOLD_DARK, width=6 * S)
    draw.arc((284 * S, -38 * S, 466 * S, 144 * S), 180, 360, fill=GOLD_HI, width=2 * S)
    draw.ellipse((302 * S, -19 * S, 448 * S, 127 * S), fill=(7, 6, 5, 252), outline=GOLD_MID, width=3 * S)
    for x in (146, 287, 463, 606):
        draw.line(((x - 18) * S, 28 * S, x * S, 148 * S), fill=(112, 70, 27, 150), width=S)
        draw.line(((x - 15) * S, 28 * S, (x + 3) * S, 148 * S), fill=(245, 211, 137, 45), width=S)
    return save(HALL / "操作台底板.png", image.resize((750, 153), Image.Resampling.LANCZOS))


def extract_paigow() -> Image.Image:
    source = Image.open(PAIGOW_SOURCE).convert("RGB")
    crop = source.crop((220, 70, 1530, 805))
    arr = np.asarray(crop).astype(np.float32)
    maximum = arr.max(axis=2)
    minimum = arr.min(axis=2)
    saturation = maximum - minimum
    luminance = arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722
    alpha = np.maximum((232.0 - luminance) * 7.0, saturation * 8.0)
    alpha[(luminance > 234) & (saturation < 10)] = 0
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    mask = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.8))
    rgba = crop.convert("RGBA")
    rgba.putalpha(mask)
    bbox = mask.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def make_domino(size: tuple[int, int], dark: bool, pips: int, angle: float = 0) -> Image.Image:
    w, h = size
    image = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    fill = (14, 13, 11, 255) if dark else (222, 211, 181, 255)
    pip = (226, 170, 73, 255) if dark else (28, 22, 14, 255)
    draw.rounded_rectangle((4 * S, 3 * S, (w - 4) * S, (h - 3) * S), radius=8 * S,
                           fill=fill, outline=GOLD_HI, width=2 * S)
    draw.line((7 * S, h * S / 2, (w - 7) * S, h * S / 2), fill=GOLD_MID, width=S)
    points = [(0.32, 0.25), (0.68, 0.25), (0.32, 0.75), (0.68, 0.75), (0.5, 0.25), (0.5, 0.75)]
    for px, py in points[:pips]:
        cx, cy = px * w * S, py * h * S
        r = max(2, round(min(w, h) * 0.055)) * S
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=pip, outline=GOLD_MID, width=S)
    result = image.resize((w, h), Image.Resampling.LANCZOS)
    if angle:
        result = result.rotate(angle, Image.Resampling.BICUBIC, expand=False)
    return result


def make_logo_frame(frame_index: int, with_sweep: bool = True) -> Image.Image:
    size = (485 * S, 137 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((179 * S, 3 * S, 306 * S, 130 * S), fill=130)
    aura = Image.new("RGBA", size, (196, 119, 29, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(17 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.line((22 * S, 68 * S, 177 * S, 68 * S), fill=(117, 70, 24, 210), width=S)
    draw.line((308 * S, 68 * S, 463 * S, 68 * S), fill=(117, 70, 24, 210), width=S)
    draw.line((51 * S, 64 * S, 165 * S, 64 * S), fill=(246, 210, 132, 165), width=S)
    draw.line((320 * S, 64 * S, 434 * S, 64 * S), fill=(246, 210, 132, 165), width=S)
    draw.polygon(((184 * S, 68 * S), (194 * S, 58 * S), (204 * S, 68 * S), (194 * S, 78 * S)),
                 outline=GOLD)
    draw.polygon(((301 * S, 68 * S), (291 * S, 58 * S), (281 * S, 68 * S), (291 * S, 78 * S)),
                 outline=GOLD)
    draw.ellipse((181 * S, 4 * S, 304 * S, 127 * S), fill=(8, 7, 5, 235), outline=GOLD_DARK, width=5 * S)
    draw.ellipse((187 * S, 10 * S, 298 * S, 121 * S), outline=GOLD_HI, width=2 * S)
    draw.ellipse((195 * S, 18 * S, 290 * S, 113 * S), outline=(125, 75, 24, 220), width=S)
    metal_text(image, "秦", font(SONGTI, 78), (242 * S, 59 * S), stroke=1, glow=3)
    letterspaced(draw, "QIN", font(LATIN, 14), 242 * S, 103 * S, 5 * S, GOLD_HI)
    if with_sweep:
        sweep_x = (-70 + frame_index * 52) * S
        sweep = Image.new("RGBA", size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sweep)
        sd.polygon(((sweep_x, 0), (sweep_x + 17 * S, 0), (sweep_x + 85 * S, 137 * S),
                    (sweep_x + 68 * S, 137 * S)), fill=(255, 245, 199, 50))
        image.alpha_composite(sweep.filter(ImageFilter.GaussianBlur(3 * S)))
    return image.resize((485, 137), Image.Resampling.LANCZOS)


def make_static_main_visual() -> Path:
    """Build the approved Qin seal + Pai Gow composition as one transparent image."""
    image = Image.new("RGBA", (672, 349), (0, 0, 0, 0))
    glow_mask = Image.new("L", image.size, 0)
    gd = ImageDraw.Draw(glow_mask)
    gd.ellipse((160, 8, 512, 320), fill=105)
    glow = Image.new("RGBA", image.size, (196, 119, 29, 0))
    glow.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(48)))
    image.alpha_composite(glow)

    logo = make_logo_frame(0, with_sweep=False).resize((530, 150), Image.Resampling.LANCZOS)
    tiles = ImageOps.contain(extract_paigow(), (340, 176), Image.Resampling.LANCZOS)
    image.alpha_composite(logo, (71, 0))
    image.alpha_composite(tiles, ((672 - tiles.width) // 2, 135))

    base = ImageDraw.Draw(image)
    base.ellipse((205, 289, 467, 335), fill=(0, 0, 0, 72), outline=(191, 124, 38, 70), width=1)
    return save(HALL / "秦_大厅主视觉.png", image)


def make_logo_atlas() -> Path:
    atlas = Image.new("RGBA", (1024, 2048), (0, 0, 0, 0))
    paigow = ImageOps.contain(extract_paigow(), (364, 187), Image.Resampling.LANCZOS)
    atlas.alpha_composite(paigow, (1 + (366 - paigow.width) // 2, 1 + (189 - paigow.height) // 2))

    logo_regions = [
        (1, 418), (1, 835), (1, 279), (488, 696), (488, 418), (369, 1), (1, 557),
        (488, 279), (369, 140), (1, 974), (488, 835), (488, 557), (1, 696),
    ]
    for i, (x, y) in enumerate(logo_regions, 1):
        atlas.alpha_composite(make_logo_frame(i), (x, y))

    atlas.alpha_composite(make_domino((95, 84), False, 4, -8), (1, 192))
    atlas.alpha_composite(make_domino((141, 153), True, 6, 5), (856, 1))

    # Warm flare and point light used by the existing animation.
    flare = Image.new("RGBA", (154, 81), (0, 0, 0, 0))
    fm = Image.new("L", flare.size, 0)
    ImageDraw.Draw(fm).ellipse((18, 24, 136, 57), fill=205)
    layer = Image.new("RGBA", flare.size, (244, 174, 72, 0))
    layer.putalpha(fm.filter(ImageFilter.GaussianBlur(13)))
    flare.alpha_composite(layer)
    ImageDraw.Draw(flare).line((20, 40, 134, 40), fill=(255, 239, 183, 220), width=2)
    atlas.alpha_composite(flare, (856, 156))
    light = Image.new("RGBA", (88, 89), (0, 0, 0, 0))
    ld = ImageDraw.Draw(light)
    ld.ellipse((31, 31, 57, 57), fill=(255, 241, 193, 245))
    for angle in range(0, 360, 45):
        x = 44 + math.cos(math.radians(angle)) * 39
        y = 44 + math.sin(math.radians(angle)) * 39
        ld.line((44, 44, x, y), fill=(243, 184, 79, 160), width=2)
    atlas.alpha_composite(light.filter(ImageFilter.GaussianBlur(0.6)), (488, 974))
    return save(LOGO_ATLAS, atlas)


def nav_badge_content() -> Image.Image:
    image = Image.new("RGBA", (186 * S, 112 * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((24 * S, 78 * S, 162 * S, 78 * S), fill=(104, 62, 21, 180), width=S)
    metal_text(image, "秦", font(SONGTI, 58), (93 * S, 38 * S), stroke=1, glow=2)
    center_text(draw, (93 * S, 88 * S), "发现", font(PING, 20), GOLD_HI,
                stroke_width=S, stroke_fill=(55, 29, 7, 255))
    return image.resize((186, 112), Image.Resampling.LANCZOS)


def make_static_discovery_button() -> Path:
    """Build the selected bottom-tab badge as one static transparent Sprite."""
    size = (209 * S, 146 * S)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    aura_mask = Image.new("L", size, 0)
    ImageDraw.Draw(aura_mask).ellipse((19 * S, 4 * S, 190 * S, 142 * S), outline=175, width=10 * S)
    aura = Image.new("RGBA", size, (200, 124, 32, 0))
    aura.putalpha(aura_mask.filter(ImageFilter.GaussianBlur(9 * S)))
    image.alpha_composite(aura)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4 * S, 15 * S, 205 * S, 142 * S), radius=57 * S,
                           fill=(7, 6, 5, 248), outline=GOLD_DARK, width=6 * S)
    draw.arc((7 * S, 0, 202 * S, 145 * S), 188, 352, fill=GOLD_HI, width=3 * S)
    draw.arc((15 * S, 8 * S, 194 * S, 138 * S), 188, 352, fill=(139, 83, 25, 235), width=2 * S)
    draw.ellipse((37 * S, 10 * S, 172 * S, 130 * S), fill=(5, 5, 4, 220), outline=GOLD_MID, width=2 * S)
    draw.ellipse((43 * S, 16 * S, 166 * S, 124 * S), outline=GOLD_HI, width=S)
    draw.line((36 * S, 94 * S, 173 * S, 94 * S), fill=(105, 63, 21, 190), width=S)
    metal_text(image, "秦", font(SONGTI, 57), (104 * S, 48 * S), stroke=1, glow=2)
    center_text(draw, (104 * S, 108 * S), "发现", font(PING, 20), GOLD_HI,
                stroke_width=S, stroke_fill=(55, 29, 7, 255))
    return save(HALL / "秦_发现按钮.png", image.resize((209, 146), Image.Resampling.LANCZOS))


def make_nav_atlas() -> Path:
    atlas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))

    outer = Image.new("RGBA", (209 * S, 141 * S), (0, 0, 0, 0))
    od = ImageDraw.Draw(outer)
    od.rounded_rectangle((4 * S, 18 * S, 205 * S, 138 * S), radius=55 * S,
                         fill=(8, 7, 5, 242), outline=GOLD_DARK, width=5 * S)
    od.arc((8 * S, 2 * S, 201 * S, 143 * S), 188, 352, fill=GOLD_HI, width=3 * S)
    od.arc((16 * S, 10 * S, 193 * S, 136 * S), 188, 352, fill=(137, 82, 25, 230), width=2 * S)
    atlas.alpha_composite(outer.resize((209, 141), Image.Resampling.LANCZOS), (1, 1))

    inner = Image.new("RGBA", (145 * S, 127 * S), (0, 0, 0, 0))
    idr = ImageDraw.Draw(inner)
    idr.ellipse((5 * S, 4 * S, 140 * S, 124 * S), fill=(6, 6, 5, 245), outline=GOLD_MID, width=4 * S)
    idr.ellipse((11 * S, 10 * S, 134 * S, 118 * S), outline=GOLD_HI, width=S)
    atlas.alpha_composite(inner.resize((145, 127), Image.Resampling.LANCZOS), (189, 148))
    atlas.alpha_composite(nav_badge_content(), (1, 144))

    glow = Image.new("RGBA", (196, 145), (0, 0, 0, 0))
    gm = Image.new("L", glow.size, 0)
    ImageDraw.Draw(gm).ellipse((17, 8, 179, 137), outline=180, width=10)
    gl = Image.new("RGBA", glow.size, (204, 129, 37, 0))
    gl.putalpha(gm.filter(ImageFilter.GaussianBlur(9)))
    glow.alpha_composite(gl)
    atlas.alpha_composite(glow, (212, 1))

    star = Image.new("RGBA", (26, 23), (0, 0, 0, 0))
    sd = ImageDraw.Draw(star)
    sd.ellipse((7, 5, 19, 17), fill=GOLD_HI)
    sd.line((1, 11, 25, 11), fill=(232, 170, 72, 180))
    sd.line((13, 0, 13, 22), fill=(232, 170, 72, 180))
    atlas.alpha_composite(star, (1, 394))

    light_regions = [
        (181, 382, 178, 15), (1, 371, 178, 21), (181, 353, 178, 27), (1, 338, 178, 31),
        (181, 317, 178, 34), (1, 299, 178, 37), (1, 258, 178, 39), (181, 277, 178, 38),
    ]
    for i, (x, y, w, h) in enumerate(light_regions, 1):
        strip = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(strip)
        intensity = 80 + i * 19
        for dot in range(9):
            px = 8 + dot * 20
            py = max(2, round((h - 5) * (0.35 + 0.45 * abs(dot - 4) / 4)))
            d.rounded_rectangle((px, py, px + 11, min(h - 1, py + 4)), radius=2,
                                fill=(245, 190, 83, min(255, intensity)))
        atlas.alpha_composite(strip, (x, y))
    return save(NAV_ATLAS, atlas)


def make_nav_icons() -> list[Path]:
    specs = [
        ("排行榜", "rank", (77, 71)),
        ("公告", "notice", (58, 67)),
        ("钱包", "wallet", (57, 62)),
        ("我的", "mine", (56, 65)),
    ]
    paths: list[Path] = []
    for label, kind, size in specs:
        for suffix, bright in (("1", False), ("2", True)):
            path = HALL / f"{label}{suffix}.png"
            paths.append(save(path, nav_icon(kind, label, size, bright)))
    return paths


def make_preview() -> Path:
    preview = Image.open(HALL / "大厅背景.png").convert("RGBA")
    preview.alpha_composite(Image.open(COMMON / "顶部.png").convert("RGBA"), (0, 0))
    preview.alpha_composite(Image.open(HALL / "游戏大厅标题.png").convert("RGBA"), (311, 21))
    preview.alpha_composite(Image.open(HALL / "客服.png").convert("RGBA"), (665, 9))

    preview.alpha_composite(Image.open(HALL / "秦_大厅主视觉.png").convert("RGBA"), (39, 92))

    preview.alpha_composite(Image.open(OLD_HALL / "切页底.png").convert("RGBA"), (0, 382))
    preview.alpha_composite(Image.open(OLD_HALL / "快速加入.png").convert("RGBA"), (20, 406))
    centers = [266, 366, 466, 566, 666]
    names = ["1", "2", "5", "10", "20"]
    selection = Image.open(HALL / "选择框.png").convert("RGBA")
    preview.alpha_composite(selection, (centers[0] - 39, 405))
    for x, name in zip(centers, names):
        number = Image.open(HALL / f"{name}.png").convert("RGBA")
        preview.alpha_composite(number, (round(x - number.width / 2), round(442 - number.height / 2)))

    preview.alpha_composite(Image.open(HALL / "操作台底板.png").convert("RGBA"), (0, 1181))
    icon_specs = [
        (HALL / "排行榜2.png", 74, 1284), (HALL / "公告2.png", 224, 1284),
        (HALL / "钱包2.png", 537, 1284), (HALL / "我的2.png", 682, 1284),
    ]
    for path, cx, cy in icon_specs:
        icon = Image.open(path).convert("RGBA")
        preview.alpha_composite(icon, (round(cx - icon.width / 2), round(cy - icon.height / 2)))

    preview.alpha_composite(Image.open(HALL / "秦_发现按钮.png").convert("RGBA"), (273, 1188))
    target = ART / "qin_hall_runtime_preview.png"
    preview.convert("RGB").save(target, optimize=True, quality=95)
    return target


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = [
        make_background(), make_top(), make_title(), make_customer_service(),
        make_filter_bar(), make_quick_join(), make_selection(),
        make_room_frame(), make_big_icon(), make_game_name(),
        make_small_icon(1, (33, 33)), make_small_icon(2, (28, 32)), make_small_icon(3, (24, 33)),
        make_status("状态_准备.png", "等待中", True),
        make_status("状态_等待中.png", "等待中", True),
        make_status("状态_游戏中.png", "游戏中", True),
        make_status("状态_参与过.png", "参与过", False),
        make_bottom_bar(), make_static_main_visual(), make_static_discovery_button(),
    ]
    outputs.extend(make_number(name, size) for name, size in (
        ("1", (20, 28)), ("2", (23, 29)), ("5", (23, 28)), ("10", (37, 29)), ("20", (39, 29)),
    ))
    outputs.extend(make_nav_icons())
    outputs.append(make_preview())
    for output in outputs:
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
