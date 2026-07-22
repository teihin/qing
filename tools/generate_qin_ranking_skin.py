#!/usr/bin/env python3
"""Generate the black-gold Qin skin used by Prefabs/排行榜.

The script overwrites the existing PNG files in place so Creator keeps every
SpriteFrame UUID and serialized reference.  It deliberately does not touch
prefabs, meta files, node names, toggles, or ranking semantics.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
RANKING = ROOT / "assets" / "ImagesLuck" / "排行榜"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
COMMON1 = ROOT / "assets" / "ImagesLuck" / "公用1"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
HALL = ROOT / "assets" / "ImagesLuck" / "大厅"
ART = ROOT / "art_sources" / "ranking"

TROPHY_SOURCE = ART / "qin_ranking_trophy_source.png"
HALL_BACKGROUND = HALL / "大厅背景.png"

PING = ROOT / "assets" / "font" / "PingFF.ttf"
SONGTI = Path("/System/Library/Fonts/Supplemental/Songti.ttc")
LATIN = Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf")

GOLD_HI = (255, 240, 190, 255)
GOLD = (220, 166, 75, 255)
GOLD_MID = (163, 101, 31, 255)
GOLD_DARK = (76, 43, 15, 255)
IVORY = (242, 226, 188, 255)
OBSIDIAN = (7, 7, 6, 250)
S = 4


def font(path: Path, size: float, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), round(size * S), index=index)


def gradient(size: tuple[int, int], top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    mode = "RGBA" if len(top) == 4 else "RGB"
    column = Image.new(mode, (1, size[1]))
    values = []
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        values.append(tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(len(top))))
    column.putdata(values)
    return column.resize(size)


def center_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...] | int,
    stroke_width: int = 0,
    stroke_fill: tuple[int, ...] | int | None = None,
) -> None:
    box = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke_width)
    x = xy[0] - (box[2] - box[0]) / 2 - box[0]
    y = xy[1] - (box[3] - box[1]) / 2 - box[1]
    draw.text(
        (round(x), round(y)),
        text,
        font=text_font,
        fill=fill,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill if stroke_fill is not None else fill,
    )


def text_mask(
    size: tuple[int, int], text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int], stroke: int = 0
) -> Image.Image:
    mask = Image.new("L", size, 0)
    center_text(ImageDraw.Draw(mask), center, text, text_font, 255, stroke, 255)
    return mask


def metal_text(
    image: Image.Image,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    center: tuple[int, int],
    stroke: int = 1,
    glow: int = 2,
) -> None:
    fill_mask = text_mask(image.size, text, text_font, center)
    edge_mask = text_mask(image.size, text, text_font, center, stroke * S)
    if glow:
        aura = edge_mask.filter(ImageFilter.GaussianBlur(glow * S))
        layer = Image.new("RGBA", image.size, (207, 128, 35, 0))
        layer.putalpha(aura.point(lambda p: round(p * 0.28)))
        image.alpha_composite(layer)
    outline = Image.new("RGBA", image.size, (48, 25, 7, 0))
    outline.putalpha(edge_mask)
    image.alpha_composite(outline)
    metal = gradient(image.size, GOLD_HI, GOLD_MID)
    metal.putalpha(fill_mask)
    image.alpha_composite(metal)
    highlight = ImageChops.subtract(fill_mask, ImageChops.offset(fill_mask, S, S))
    high = Image.new("RGBA", image.size, (255, 250, 220, 0))
    high.putalpha(highlight)
    image.alpha_composite(high)


def meta_trim(path: Path) -> tuple[int, int, int, int]:
    data = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    sub = next(iter(data.get("subMetas", {}).values()))
    return int(sub["trimX"]), int(sub["trimY"]), int(sub["width"]), int(sub["height"])


def constrain_alpha_to_meta(path: Path, image: Image.Image) -> Image.Image:
    """Preserve Creator's current automatic-trim rectangle exactly."""
    if image.mode != "RGBA":
        return image
    x, y, w, h = meta_trim(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", image.size, 0)
    clipped.paste(alpha.crop((x, y, x + w, y + h)), (x, y))
    image.putalpha(clipped)
    pixels = image.load()
    for px, py in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
        r, g, b, a = pixels[px, py]
        if a < 8:
            pixels[px, py] = (r or 128, g or 79, b or 25, 8)
    return image


def save(path: Path, image: Image.Image, rgb: bool = False) -> Path:
    image = image.convert("RGB" if rgb else "RGBA")
    if not rgb:
        image = constrain_alpha_to_meta(path, image)
    image.save(path, optimize=True)
    return path


def make_background() -> Path:
    source = Image.open(HALL_BACKGROUND).convert("RGB")
    source = ImageOps.fit(source, (750, 1334), Image.Resampling.LANCZOS)
    source = ImageEnhance.Color(source).enhance(0.42)
    source = ImageEnhance.Brightness(source).enhance(0.43)
    source = source.filter(ImageFilter.GaussianBlur(9)).convert("RGBA")

    shade = gradient((750, 1334), (4, 4, 4, 120), (6, 5, 4, 218))
    source.alpha_composite(shade)
    ornament = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ornament)

    # Quiet bronze geometry: visible enough to feel designed, subdued enough for text-heavy screens.
    cx, cy = 375, 790
    for radius, alpha in ((332, 18), (270, 24), (212, 28), (154, 21)):
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(184, 116, 35, alpha), width=1)
    for angle in range(0, 360, 30):
        rad = math.radians(angle)
        x1, y1 = cx + math.cos(rad) * 145, cy + math.sin(rad) * 145
        x2, y2 = cx + math.cos(rad) * 330, cy + math.sin(rad) * 330
        draw.line((x1, y1, x2, y2), fill=(174, 105, 30, 18), width=1)
    for inset in (24, 42):
        draw.line((inset, 118, inset, 1210), fill=(160, 97, 29, 25), width=1)
        draw.line((750 - inset, 118, 750 - inset, 1210), fill=(160, 97, 29, 25), width=1)
    draw.line((74, 1148, 676, 1148), fill=(210, 153, 66, 23), width=1)
    source.alpha_composite(ornament)

    vignette = Image.new("L", source.size, 225)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-160, 20, 910, 1420), fill=0)
    vignette = vignette.filter(ImageFilter.GaussianBlur(125))
    edge = Image.new("RGBA", source.size, (0, 0, 0, 0))
    edge.putalpha(vignette.point(lambda p: round(p * 0.55)))
    source.alpha_composite(edge)
    return save(COMMON / "背景.png", source, rgb=True)


def white_to_alpha(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    arr = np.asarray(source.convert("RGB")).astype(np.float32)
    saturation = np.max(arr, axis=2) - np.min(arr, axis=2)
    luminance = arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722
    # Separate dark lacquer and saturated gold from the source's bright neutral
    # studio backdrop.  Using both channels keeps specular gold while discarding
    # the pale background sweep.
    alpha = np.maximum((220.0 - luminance) * 6.2, (saturation - 18.0) * 4.5)
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    mask = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.65))
    rgba.putalpha(mask)
    return rgba


def make_trophy() -> Path:
    source = Image.open(TROPHY_SOURCE).convert("RGB")
    source = ImageEnhance.Color(source).enhance(1.06)
    source = ImageEnhance.Contrast(source).enhance(1.04)
    isolated = white_to_alpha(source)
    isolated = ImageOps.fit(isolated, (580, 271), Image.Resampling.LANCZOS)

    image = Image.new("RGBA", (580, 271), (0, 0, 0, 0))
    glow_mask = isolated.getchannel("A").filter(ImageFilter.GaussianBlur(13))
    glow = Image.new("RGBA", image.size, (199, 124, 33, 0))
    glow.putalpha(glow_mask.point(lambda p: round(p * 0.18)))
    image.alpha_composite(glow)
    image.alpha_composite(isolated)

    # Rebuild the information bay at the exact runtime width.  The generated
    # concept's side insets were attractive but collided with the serialized
    # end-date label, whose position must remain unchanged.
    bay = Image.new("RGBA", (580 * S, 271 * S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bay)
    bd.rounded_rectangle((6 * S, 146 * S, 574 * S, 264 * S), radius=12 * S,
                         fill=(7, 7, 6, 248), outline=GOLD_DARK, width=5 * S)
    bd.rounded_rectangle((11 * S, 151 * S, 569 * S, 259 * S), radius=9 * S,
                         outline=GOLD_HI, width=S)
    bd.line((34 * S, 155 * S, 546 * S, 155 * S), fill=(255, 229, 163, 70), width=S)
    cx = 290 * S
    bd.polygon(((cx - 7 * S, 260 * S), (cx, 267 * S), (cx + 7 * S, 260 * S)),
               fill=(8, 7, 5, 255), outline=GOLD_MID)
    image.alpha_composite(bay.resize((580, 271), Image.Resampling.LANCZOS))
    return save(RANKING / "排行奖杯.png", image)


def make_title() -> Path:
    size = (99, 40)
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    metal_text(image, "排行榜", font(PING, 25), (size[0] * S // 2, size[1] * S // 2), stroke=1, glow=2)
    return save(RANKING / "排行榜.png", image.resize(size, Image.Resampling.LANCZOS))


def make_time_label(filename: str, text: str, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((1 * S, 15 * S, 10 * S, 15 * S), fill=GOLD_MID, width=S)
    draw.polygon(((7 * S, 11 * S), (12 * S, 15 * S), (7 * S, 19 * S)), fill=GOLD)
    center_text(draw, (68 * S, size[1] * S / 2), text, font(PING, 18), IVORY,
                stroke_width=S, stroke_fill=(46, 24, 7, 255))
    return save(RANKING / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_tab() -> Path:
    size = (446, 54)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow).rounded_rectangle((14 * S, 5 * S, 432 * S, 49 * S), radius=20 * S, outline=130, width=5 * S)
    aura = Image.new("RGBA", canvas, (202, 126, 33, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(4 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((12 * S, 5 * S, 434 * S, 49 * S), radius=21 * S,
                           fill=(8, 7, 5, 244), outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((17 * S, 9 * S, 429 * S, 45 * S), radius=18 * S,
                           outline=GOLD_HI, width=S)
    draw.line((42 * S, 27 * S, 118 * S, 27 * S), fill=(141, 88, 29, 170), width=S)
    draw.line((328 * S, 27 * S, 404 * S, 27 * S), fill=(141, 88, 29, 170), width=S)
    metal_text(image, "玩家手数排行榜", font(PING, 23), (223 * S, 27 * S), stroke=1, glow=1)
    return save(RANKING / "玩家手数.png", image.resize(size, Image.Resampling.LANCZOS))


def make_filter_bar() -> Path:
    size = (750, 108)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow = Image.new("RGBA", canvas, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((5 * S, 15 * S, 745 * S, 94 * S), radius=38 * S,
                                           outline=(191, 116, 28, 110), width=8 * S)
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5 * S)))
    panel = gradient(canvas, (29, 23, 15, 248), (6, 6, 5, 250))
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle((5 * S, 14 * S, 745 * S, 95 * S), radius=39 * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((5 * S, 14 * S, 745 * S, 95 * S), radius=39 * S,
                           outline=GOLD_DARK, width=5 * S)
    draw.rounded_rectangle((11 * S, 20 * S, 739 * S, 89 * S), radius=33 * S,
                           outline=GOLD_HI, width=S)
    for x in (187.5, 312.5, 437.5, 562.5):
        draw.line((round(x * S), 29 * S, round(x * S), 80 * S), fill=(115, 72, 27, 110), width=S)
    draw.line((72 * S, 18 * S, 678 * S, 18 * S), fill=(255, 229, 165, 80), width=S)
    return save(RANKING / "排行榜皮数框.png", image.resize(size, Image.Resampling.LANCZOS))


def make_selection() -> Path:
    size = (84, 78)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    points = [(42 * S, 2 * S), (77 * S, 21 * S), (73 * S, 57 * S),
              (42 * S, 75 * S), (11 * S, 57 * S), (7 * S, 21 * S)]
    halo = Image.new("L", canvas, 0)
    ImageDraw.Draw(halo).line(points + [points[0]], fill=170, width=7 * S, joint="curve")
    aura = Image.new("RGBA", canvas, (204, 126, 31, 0))
    aura.putalpha(halo.filter(ImageFilter.GaussianBlur(5 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.polygon(points, fill=(8, 7, 5, 247), outline=GOLD_HI)
    inner = [(42 * S, 8 * S), (70 * S, 24 * S), (67 * S, 53 * S),
             (42 * S, 68 * S), (17 * S, 53 * S), (14 * S, 24 * S)]
    draw.line(inner + [inner[0]], fill=GOLD_MID, width=2 * S, joint="curve")
    draw.polygon(((42 * S, 5 * S), (47 * S, 10 * S), (42 * S, 15 * S), (37 * S, 10 * S)), fill=GOLD_HI)
    return save(RANKING / "xuan.png", image.resize(size, Image.Resampling.LANCZOS))


def make_rank_number(filename: str, text: str, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    fsize = 20 if len(text) <= 2 else 19
    metal_text(image, text, font(PING, fsize), (size[0] * S // 2, size[1] * S // 2), stroke=1, glow=1)
    return save(RANKING / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_header_label(filename: str, text: str, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))
    center_text(ImageDraw.Draw(image), (size[0] * S / 2, size[1] * S / 2), text, font(PING, 21), GOLD_HI,
                stroke_width=S, stroke_fill=(52, 29, 9, 255))
    return save(RANKING / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_base_bar() -> Path:
    size = (750, 90)
    canvas = (size[0] * S, size[1] * S)
    image = gradient(canvas, (25, 19, 12, 235), (6, 6, 5, 239))
    draw = ImageDraw.Draw(image)
    draw.line((0, 3 * S, 750 * S, 3 * S), fill=GOLD_DARK, width=3 * S)
    draw.line((0, 6 * S, 750 * S, 6 * S), fill=(242, 201, 118, 205), width=S)
    draw.line((0, 86 * S, 750 * S, 86 * S), fill=(111, 68, 24, 160), width=S)
    draw.line((68 * S, 12 * S, 682 * S, 12 * S), fill=(255, 231, 169, 32), width=S)
    return save(COMMON / "垫底.png", image.resize(size, Image.Resampling.LANCZOS))


def make_table_header() -> Path:
    size = (750, 96)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    panel = gradient(canvas, (39, 29, 17, 246), (8, 7, 6, 247))
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle((11 * S, 11 * S, 736 * S, 86 * S), radius=12 * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((11 * S, 11 * S, 736 * S, 86 * S), radius=12 * S,
                           outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((15 * S, 15 * S, 732 * S, 82 * S), radius=9 * S,
                           outline=(236, 195, 110, 205), width=S)
    draw.line((38 * S, 18 * S, 708 * S, 18 * S), fill=(255, 233, 173, 55), width=S)
    for x in range(35, 725, 18):
        draw.line((x * S, 25 * S, x * S, 72 * S), fill=(178, 111, 34, 12), width=S)
    return save(COMMON / "表格标题头.png", image.resize(size, Image.Resampling.LANCZOS))


def make_divider() -> Path:
    size = (742, 4)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    pixels = image.load()
    for x in range(size[0]):
        edge = min(1.0, x / 74.0, (size[0] - 1 - x) / 74.0)
        for y, factor in enumerate((0.25, 0.85, 0.45, 0.12)):
            pixels[x, y] = (221, 162, 70, round(220 * edge * factor))
    return save(COMMON1 / "分割线.png", image)


def make_back() -> Path:
    size = (52, 64)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((43 * S, 17 * S, 11 * S, 17 * S), fill=GOLD_HI, width=3 * S)
    draw.line((11 * S, 17 * S, 23 * S, 6 * S), fill=GOLD_HI, width=3 * S)
    draw.line((11 * S, 17 * S, 23 * S, 28 * S), fill=GOLD_HI, width=3 * S)
    draw.line((25 * S, 21 * S, 43 * S, 21 * S), fill=GOLD_MID, width=S)
    center_text(draw, (26 * S, 51 * S), "返回", font(PING, 15), GOLD_HI,
                stroke_width=S, stroke_fill=(55, 31, 9, 255))
    return save(KK_COMMON / "back.png", image.resize(size, Image.Resampling.LANCZOS))


def make_pagination(filename: str, kind: str, size: tuple[int, int]) -> Path:
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    direction = -1 if kind in ("first", "prev") else 1
    centers = [size[0] * 0.60]
    if kind in ("first", "last"):
        centers = [size[0] * 0.43, size[0] * 0.66]
    for center in centers:
        if direction < 0:
            points = ((center + 6) * S, 10 * S), ((center - 5) * S, 23.5 * S), ((center + 6) * S, 37 * S)
        else:
            points = ((center - 6) * S, 10 * S), ((center + 5) * S, 23.5 * S), ((center - 6) * S, 37 * S)
        draw.line(points, fill=GOLD_HI, width=3 * S, joint="curve")
    if kind == "first":
        draw.line((10 * S, 9 * S, 10 * S, 38 * S), fill=GOLD_MID, width=2 * S)
    elif kind == "last":
        draw.line(((size[0] - 10) * S, 9 * S, (size[0] - 10) * S, 38 * S), fill=GOLD_MID, width=2 * S)
    return save(KK_COMMON / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_column_frame() -> Path:
    size = (198, 43)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 3 * S, 196 * S, 40 * S), radius=17 * S,
                           fill=(10, 8, 6, 236), outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((6 * S, 7 * S, 192 * S, 36 * S), radius=13 * S,
                           outline=(235, 193, 106, 210), width=S)
    return save(KK_COMMON / "栏目标题框.png", image.resize(size, Image.Resampling.LANCZOS))


def make_tip_bar() -> Path:
    size = (750, 57)
    canvas = (size[0] * S, size[1] * S)
    image = gradient(canvas, (22, 17, 11, 230), (7, 6, 5, 238))
    draw = ImageDraw.Draw(image)
    draw.line((0, 2 * S, 750 * S, 2 * S), fill=GOLD_DARK, width=2 * S)
    draw.line((0, 54 * S, 750 * S, 54 * S), fill=(206, 145, 55, 125), width=S)
    return save(KK_COMMON / "提示底框.png", image.resize(size, Image.Resampling.LANCZOS))


def make_coin() -> Path:
    size = (24, 24)
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((1 * S, 1 * S, 23 * S, 23 * S), fill=(170, 105, 27, 255), outline=GOLD_HI, width=2 * S)
    draw.ellipse((5 * S, 5 * S, 19 * S, 19 * S), fill=(60, 36, 12, 255), outline=GOLD, width=S)
    center_text(draw, (12 * S, 12 * S), "秦", font(SONGTI, 10), GOLD_HI)
    return save(COMMON / "小金币.png", image.resize(size, Image.Resampling.LANCZOS))


def draw_preview_text(
    image: Image.Image,
    center: tuple[int, int],
    text: str,
    size: int,
    color: tuple[int, int, int, int] = IVORY,
) -> None:
    scale = 2
    layer = Image.new("RGBA", (image.width * scale, image.height * scale), (0, 0, 0, 0))
    preview_font = ImageFont.truetype(str(PING), size * scale)
    center_text(ImageDraw.Draw(layer), (center[0] * scale, center[1] * scale), text, preview_font, color)
    image.alpha_composite(layer.resize(image.size, Image.Resampling.LANCZOS))


def make_preview() -> Path:
    preview = Image.open(COMMON / "背景.png").convert("RGBA")
    preview.alpha_composite(Image.open(COMMON1 / "顶部.png").convert("RGBA"), (0, 0))
    preview.alpha_composite(Image.open(KK_COMMON / "back.png").convert("RGBA"), (47, 18))
    preview.alpha_composite(Image.open(RANKING / "排行榜.png").convert("RGBA"), (326, 27))

    preview.alpha_composite(Image.open(RANKING / "排行奖杯.png").convert("RGBA"), (85, 75))
    preview.alpha_composite(Image.open(RANKING / "开始时间.png").convert("RGBA"), (77, 236))
    preview.alpha_composite(Image.open(RANKING / "结束时间.png").convert("RGBA"), (397, 235))
    draw_preview_text(preview, (292, 251), "2026.07.01", 18)
    draw_preview_text(preview, (607, 251), "2026.07.31", 18)
    draw_preview_text(preview, (375, 311), "我的有效手数：--    当前排名：未上榜", 18)

    preview.alpha_composite(Image.open(COMMON / "垫底.png").convert("RGBA"), (0, 343))
    preview.alpha_composite(Image.open(RANKING / "玩家手数.png").convert("RGBA"), (159, 361))

    preview.alpha_composite(Image.open(RANKING / "排行榜皮数框.png").convert("RGBA"), (0, 423))
    centers = [124, 249, 374, 499, 624]
    preview.alpha_composite(Image.open(RANKING / "xuan.png").convert("RGBA"), (centers[0] - 42, 430))
    for center, name in zip(centers, ("1皮", "2皮", "5皮", "10皮", "20皮")):
        part = Image.open(RANKING / f"{name}.png").convert("RGBA")
        preview.alpha_composite(part, (round(center - part.width / 2), round(470 - part.height / 2)))

    preview.alpha_composite(Image.open(COMMON / "表格标题头.png").convert("RGBA"), (0, 524))
    for center, filename in ((69, "名次.png"), (247, "玩家信息.png"), (467, "手数.png"), (628, "奖励.png")):
        part = Image.open(RANKING / filename).convert("RGBA")
        preview.alpha_composite(part, (round(center - part.width / 2), round(572 - part.height / 2)))

    divider = Image.open(COMMON1 / "分割线.png").convert("RGBA").resize((628, 8), Image.Resampling.LANCZOS)
    sample_rows = [
        ("1", "玩家昵称\n100001", "128", "888"),
        ("2", "玩家昵称\n100002", "105", "588"),
        ("3", "玩家昵称\n100003", "96", "388"),
        ("4", "玩家昵称\n100004", "82", "188"),
        ("5", "玩家昵称\n100005", "71", "88"),
        ("6", "玩家昵称\n100006", "65", "68"),
        ("7", "玩家昵称\n100007", "53", "58"),
    ]
    for row, values in enumerate(sample_rows):
        cy = 657 + row * 80
        if cy > 1190:
            break
        if row < 3:
            medal_colors = ((255, 224, 135, 255), (222, 218, 205, 255), (206, 143, 72, 255))
            color = medal_colors[row]
        else:
            color = IVORY
        for x, value in zip((69, 247, 467, 628), values):
            draw_preview_text(preview, (x, cy), value, 18 if "\n" not in value else 15, color)
        preview.alpha_composite(divider, (61, cy + 36))

    base = Image.open(COMMON / "垫底.png").convert("RGBA").resize((730, 80), Image.Resampling.LANCZOS)
    preview.alpha_composite(base, (10, 1254))
    draw_preview_text(preview, (375, 1294), "活动奖励以排行榜结算结果为准", 17, (190, 167, 123, 255))
    target = ART / "qin_ranking_runtime_preview.png"
    preview.convert("RGB").save(target, optimize=True, quality=95)
    return target


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = [
        make_background(),
        make_trophy(),
        make_title(),
        make_time_label("开始时间.png", "开始时间：", (118, 31)),
        make_time_label("结束时间.png", "结束时间：", (118, 32)),
        make_tab(),
        make_filter_bar(),
        make_selection(),
        make_rank_number("1皮.png", "1皮", (42, 29)),
        make_rank_number("2皮.png", "2皮", (44, 29)),
        make_rank_number("5皮.png", "5皮", (42, 29)),
        make_rank_number("10皮.png", "10皮", (57, 29)),
        make_rank_number("20皮.png", "20皮", (58, 29)),
        make_header_label("名次.png", "名次", (54, 31)),
        make_header_label("玩家信息.png", "玩家信息", (102, 31)),
        make_header_label("手数.png", "手数", (54, 31)),
        make_header_label("奖励.png", "奖励", (53, 31)),
        make_base_bar(),
        make_table_header(),
        make_divider(),
        make_back(),
        make_pagination("11.png", "first", (55, 47)),
        make_pagination("左2.png", "prev", (44, 47)),
        make_pagination("右1.png", "next", (44, 47)),
        make_pagination("22.png", "last", (55, 47)),
        make_column_frame(),
        make_tip_bar(),
        make_coin(),
    ]
    outputs.append(make_preview())
    for output in outputs:
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
