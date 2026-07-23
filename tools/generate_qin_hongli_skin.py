#!/usr/bin/env python3
"""Deterministically rebuild panelHongli's dedicated Qin-style artwork.

The generator is intentionally narrow.  It overwrites only the agent/rebate
PNG files listed in ``TARGETS`` and writes two visual previews under
``art_sources/hongli``.  Prefabs, scripts, shared UI artwork, promotion art and
all existing Cocos metadata are read-only inputs.

Art direction: clean warm-black lacquer, restrained fine gold edges, ivory
type and a small amount of copper-red emphasis.  No cyan/blue neon and no
crown motif are used.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
LUCK_AGENT = ROOT / "assets" / "ImagesLuck" / "代理"
XYPK_AGENT = ROOT / "assets" / "ImagesXYPK" / "代理"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
COMMON1 = ROOT / "assets" / "ImagesLuck" / "公用1"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
ART = ROOT / "art_sources" / "hongli"
PING = ROOT / "assets" / "font" / "PingFF.ttf"
SONGTI = Path("/System/Library/Fonts/Supplemental/Songti.ttc")

S = 3
GOLD_HI = (255, 236, 177, 255)
GOLD = (225, 174, 82, 255)
GOLD_MID = (159, 101, 38, 255)
GOLD_DARK = (80, 48, 18, 255)
IVORY = (241, 226, 194, 255)
MUTED = (166, 153, 128, 255)
COPPER = (180, 77, 54, 255)
BLACK_TOP = (34, 28, 20, 250)
BLACK_BOTTOM = (7, 7, 6, 253)


LUCK_NAMES = (
    "ID.png",
    "三级代理未选中.png",
    "三级代理选中.png",
    "上级.png",
    "下级.png",
    "二级代理未选中.png",
    "二级代理选中.png",
    "今日贡献.png",
    "分红比例.png",
    "切页底.png",
    "总人.png",
    "我的.png",
    "我的业绩.png",
    "我的分红.png",
    "我的玩家.png",
    "我的玩家未选中.png",
    "我的玩家选中.png",
    "手数.png",
    "授权.png",
    "提取记录.png",
    "新增.png",
    "时间.png",
    "时间2.png",
    "昵称.png",
    "框.png",
    "比例.png",
    "比例设置.png",
    "玩家信息.png",
    "玩家数.png",
    "玩家数量.png",
    "盟主.png",
    "累计.png",
    "累计红利总数.png",
    "累计红利提取.png",
    "累计贡献.png",
    "累计贡献1.png",
    "装饰框.png",
    "输入框.png",
    "输入比例.png",
    "金额.png",
    "盟主徽标.png",
)

XYPK_NAMES = (
    "今日贡献.png",
    "代理标题.png",
    "奖池红利提取记录.png",
    "底框.png",
    "总业绩.png",
    "总业绩tt.png",
    "总人数.png",
    "我的业绩.png",
    "我的玩家.png",
    "授权按钮.png",
    "推广按钮.png",
    "提取.png",
    "提取记录.png",
    "盟主.png",
    "累计总贡献.png",
    "红利余额.png",
    "提升.png",
)

TARGETS: tuple[Path, ...] = tuple(LUCK_AGENT / name for name in LUCK_NAMES) + tuple(
    XYPK_AGENT / name for name in XYPK_NAMES
)
TARGET_RELATIVE: tuple[str, ...] = tuple(str(path.relative_to(ROOT)) for path in TARGETS)
OUTPUTS: list[Path] = []

NEW_BADGE = LUCK_AGENT / "盟主徽标.png"
NEW_BADGE_SIZE = (82, 27)
NEW_BADGE_SPRITE_UUID = "7c3dc7c0-5a97-4307-9ac3-d58e0d3a1a23"


def scaled(size: tuple[int, int]) -> tuple[int, int]:
    return size[0] * S, size[1] * S


def font(size: float, *, song: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SONGTI if song else PING), max(1, round(size * S)), index=0)


def center_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...] | int,
    *,
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


def vertical_gradient(
    size: tuple[int, int], top: tuple[int, int, int, int], bottom: tuple[int, int, int, int]
) -> Image.Image:
    column = Image.new("RGBA", (1, size[1]))
    values = []
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        values.append(tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4)))
    column.putdata(values)
    return column.resize(size)


def text_mask(
    size: tuple[int, int], text: str, text_font: ImageFont.FreeTypeFont, xy: tuple[int, int], stroke: int = 0
) -> Image.Image:
    mask = Image.new("L", size, 0)
    center_text(ImageDraw.Draw(mask), xy, text, text_font, 255, stroke_width=stroke, stroke_fill=255)
    return mask


def metal_text(
    image: Image.Image,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    xy: tuple[int, int],
    *,
    stroke: int = 1,
    glow: int = 0,
) -> None:
    fill_mask = text_mask(image.size, text, text_font, xy)
    edge_mask = text_mask(image.size, text, text_font, xy, stroke * S)
    if glow:
        aura = edge_mask.filter(ImageFilter.GaussianBlur(glow * S))
        layer = Image.new("RGBA", image.size, (194, 111, 28, 0))
        layer.putalpha(aura.point(lambda value: round(value * 0.24)))
        image.alpha_composite(layer)
    edge = Image.new("RGBA", image.size, (44, 24, 8, 0))
    edge.putalpha(edge_mask)
    image.alpha_composite(edge)
    metal = vertical_gradient(image.size, GOLD_HI, GOLD_MID)
    metal.putalpha(fill_mask)
    image.alpha_composite(metal)
    highlight = ImageChops.subtract(fill_mask, ImageChops.offset(fill_mask, S, S))
    shine = Image.new("RGBA", image.size, (255, 250, 220, 0))
    shine.putalpha(highlight)
    image.alpha_composite(shine)


def existing_size(path: Path) -> tuple[int, int]:
    if path == NEW_BADGE and not path.exists():
        return NEW_BADGE_SIZE
    with Image.open(path) as image:
        return image.size


def read_meta(path: Path) -> dict | None:
    meta_path = path.with_suffix(path.suffix + ".meta")
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8"))


def meta_trim(path: Path, size: tuple[int, int]) -> tuple[int, int, int, int]:
    data = read_meta(path)
    if data is None:
        if path == NEW_BADGE:
            return 0, 0, size[0], size[1]
        raise RuntimeError(f"Missing meta: {path}")
    sub = next(iter(data["subMetas"].values()))
    return int(sub["trimX"]), int(sub["trimY"]), int(sub["width"]), int(sub["height"])


def save_asset(path: Path, image: Image.Image) -> Path:
    size = existing_size(path)
    if image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    image = image.convert("RGBA")
    x, y, width, height = meta_trim(path, size)
    alpha = image.getchannel("A")
    clipped = Image.new("L", size, 0)
    clipped.paste(alpha.crop((x, y, x + width, y + height)), (x, y))
    image.putalpha(clipped)
    pixels = image.load()
    for px, py in ((x, y), (x + width - 1, y), (x, y + height - 1), (x + width - 1, y + height - 1)):
        red, green, blue, alpha_value = pixels[px, py]
        if alpha_value < 8:
            pixels[px, py] = (max(red, 91), max(green, 55), max(blue, 20), 8)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", compress_level=9)
    OUTPUTS.append(path)
    return path


def lacquer_panel(
    size: tuple[int, int],
    *,
    radius: int | None = None,
    selected: bool = False,
    inset: int = 2,
    divider: bool = False,
) -> Image.Image:
    width, height = size
    canvas = scaled(size)
    radius = radius if radius is not None else max(7, min(24, min(size) // 3))
    box = (inset * S, inset * S, (width - inset) * S - 1, (height - inset) * S - 1)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    if selected:
        glow_mask = Image.new("L", canvas, 0)
        ImageDraw.Draw(glow_mask).rounded_rectangle(box, radius=radius * S, outline=145, width=5 * S)
        glow = Image.new("RGBA", canvas, (192, 112, 29, 0))
        glow.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(4 * S)))
        image.alpha_composite(glow)
    panel = vertical_gradient(
        canvas,
        (48, 36, 22, 252) if selected else BLACK_TOP,
        (9, 8, 6, 254) if selected else BLACK_BOTTOM,
    )
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        box,
        radius=radius * S,
        outline=GOLD if selected else (116, 75, 31, 235),
        width=(3 if selected else 2) * S,
    )
    inner = (
        (inset + 5) * S,
        (inset + 5) * S,
        (width - inset - 5) * S - 1,
        (height - inset - 5) * S - 1,
    )
    if inner[2] > inner[0] and inner[3] > inner[1]:
        draw.rounded_rectangle(
            inner,
            radius=max(2, radius - 5) * S,
            outline=(248, 211, 132, 160 if selected else 74),
            width=S,
        )
    line_y = (inset + 6) * S
    line_inset = max(inset + radius, 13) * S
    if width * S - line_inset > line_inset:
        draw.line((line_inset, line_y, width * S - line_inset, line_y), fill=(255, 235, 173, 48), width=S)
    if divider:
        draw.line((width * S // 2, 13 * S, width * S // 2, (height - 13) * S), fill=(135, 80, 27, 105), width=S)
    return image


def draw_diamond(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int, *, fill=GOLD, outline=GOLD_HI) -> None:
    draw.polygon(((x, y - radius), (x + radius, y), (x, y + radius), (x - radius, y)), fill=fill, outline=outline)


def draw_coin(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int) -> None:
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(50, 31, 13, 245), outline=GOLD, width=2 * S)
    draw.ellipse((x - radius + 5 * S, y - radius + 5 * S, x + radius - 5 * S, y + radius - 5 * S), outline=GOLD_MID, width=S)
    hole = max(3 * S, radius // 4)
    draw.rectangle((x - hole, y - hole, x + hole, y + hole), outline=GOLD_HI, width=S)


def draw_icon(draw: ImageDraw.ImageDraw, kind: str, center: tuple[int, int], scale: float = 1.0) -> None:
    cx, cy = center
    unit = S * scale
    line = max(S, round(1.5 * unit))
    gold = GOLD
    if kind == "users":
        for dx, dy, radius in ((0, -8, 7), (-12, -3, 5), (12, -3, 5)):
            r = round(radius * unit)
            x, y = round(cx + dx * unit), round(cy + dy * unit)
            draw.ellipse((x - r, y - r, x + r, y + r), outline=gold, width=line)
        draw.arc((cx - 19 * unit, cy + 1 * unit, cx + 19 * unit, cy + 25 * unit), 190, 350, fill=gold, width=line)
    elif kind in ("chart", "bars"):
        draw.line((cx - 19 * unit, cy + 17 * unit, cx - 19 * unit, cy - 16 * unit), fill=gold, width=line)
        draw.line((cx - 19 * unit, cy + 17 * unit, cx + 20 * unit, cy + 17 * unit), fill=gold, width=line)
        if kind == "chart":
            points = [(cx - 14 * unit, cy + 9 * unit), (cx - 3 * unit, cy), (cx + 6 * unit, cy + 5 * unit), (cx + 18 * unit, cy - 13 * unit)]
            draw.line(points, fill=GOLD_HI, width=line)
            for x, y in points:
                r = round(2.2 * unit)
                draw.ellipse((x - r, y - r, x + r, y + r), fill=GOLD_HI)
        else:
            for dx, h in ((-11, 13), (0, 23), (11, 31)):
                draw.rectangle((cx + (dx - 4) * unit, cy + 14 * unit - h * unit, cx + (dx + 4) * unit, cy + 14 * unit), outline=gold, width=line)
    elif kind == "record":
        draw.rounded_rectangle((cx - 17 * unit, cy - 20 * unit, cx + 17 * unit, cy + 20 * unit), radius=3 * unit, outline=gold, width=line)
        for offset in (-9, 0, 9):
            draw.line((cx - 10 * unit, cy + offset * unit, cx + 10 * unit, cy + offset * unit), fill=GOLD_HI if offset == -9 else gold, width=line)
    elif kind == "share":
        points = ((cx - 14 * unit, cy), (cx + 11 * unit, cy - 14 * unit), (cx + 11 * unit, cy + 15 * unit))
        draw.line((points[0], points[1]), fill=gold, width=line)
        draw.line((points[0], points[2]), fill=gold, width=line)
        for x, y in points:
            r = round(5 * unit)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(45, 28, 12, 255), outline=GOLD_HI, width=line)
    elif kind == "seal":
        r = round(20 * unit)
        draw_diamond(draw, round(cx), round(cy), r, fill=(57, 35, 13, 255), outline=GOLD)
        center_text(draw, (cx, cy), "秦", font(14 * scale, song=True), GOLD_HI, stroke_width=S, stroke_fill=(55, 28, 7, 255))
    else:
        draw_coin(draw, (round(cx), round(cy)), round(18 * unit))


def plain_text_asset(path: Path, text: str, *, size_hint: float | None = None, title: bool = False, muted: bool = False) -> Path:
    width, height = existing_size(path)
    image = Image.new("RGBA", scaled((width, height)), (0, 0, 0, 0))
    text_size = size_hint if size_hint is not None else max(14, min(23, height * (0.58 if height < 35 else 0.54)))
    if title:
        metal_text(image, text, font(text_size), (width * S // 2, height * S // 2), stroke=1, glow=1 if height >= 38 else 0)
    else:
        fill = MUTED if muted else IVORY
        center_text(
            ImageDraw.Draw(image),
            (width * S / 2, height * S / 2),
            text,
            font(text_size),
            fill,
            stroke_width=S,
            stroke_fill=(33, 21, 10, 235),
        )
    return save_asset(path, image.resize((width, height), Image.Resampling.LANCZOS))


def make_tab(path: Path, label: str, selected: bool) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=max(10, size[1] // 2 - 5), selected=selected, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    if selected:
        draw.line((28 * S, (height - 8) * S, (width - 28) * S, (height - 8) * S), fill=GOLD, width=2 * S)
        draw_diamond(draw, 17 * S, height * S // 2, 3 * S)
    fill = GOLD_HI if selected else MUTED
    center_text(draw, (width * S / 2, height * S / 2), label, font(20), fill, stroke_width=S, stroke_fill=(35, 22, 9, 255))
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_band(path: Path) -> Path:
    width, height = existing_size(path)
    image = vertical_gradient(scaled((width, height)), (22, 18, 13, 236), (7, 7, 6, 244))
    draw = ImageDraw.Draw(image)
    draw.line((0, 3 * S, width * S, 3 * S), fill=(174, 112, 43, 150), width=S)
    draw.line((34 * S, (height - 4) * S, (width - 34) * S, (height - 4) * S), fill=(222, 171, 82, 55), width=S)
    for x in (18, width - 18):
        draw_diamond(draw, x * S, height * S // 2, 3 * S, fill=COPPER, outline=GOLD_MID)
    return save_asset(path, image.resize((width, height), Image.Resampling.LANCZOS))


def make_stat_tile(path: Path, label: str, icon: str) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=16, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw_icon(draw, icon, (31 * S, height * S // 2), 0.52)
    draw.line((53 * S, 14 * S, 53 * S, (height - 14) * S), fill=(145, 89, 31, 120), width=S)
    center_text(draw, (128 * S, height * S / 2), label, font(18), IVORY, stroke_width=S, stroke_fill=(37, 22, 8, 255))
    draw.line((208 * S, height * S / 2, (width - 19) * S, height * S / 2), fill=(205, 150, 64, 45), width=S)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_wide_strip(path: Path) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=26, inset=3)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw.line((26 * S, height * S // 2, (width - 26) * S, height * S // 2), fill=(196, 136, 52, 30), width=S)
    for x in (16, width - 16):
        draw_diamond(draw, x * S, height * S // 2, 4 * S, fill=COPPER, outline=GOLD)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_player_count(path: Path) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=28, inset=3)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw_icon(draw, "users", (56 * S, height * S // 2), 0.72)
    draw.line((92 * S, 22 * S, 92 * S, (height - 22) * S), fill=(154, 94, 34, 120), width=S)
    center_text(draw, (312 * S, height * S / 2), "您目前的下级玩家数量:", font(22), IVORY, stroke_width=S, stroke_fill=(36, 22, 9, 255))
    draw.line((524 * S, height * S / 2, (width - 31) * S, height * S / 2), fill=(220, 166, 74, 45), width=S)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_summary_frame(path: Path, columns: int, *, seal: bool = False) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=18, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    for index in range(1, columns):
        x = round(width * index / columns) * S
        draw.line((x, 29 * S, x, (height - 21) * S), fill=(151, 92, 31, 95), width=S)
    draw.line((24 * S, 49 * S, (width - 24) * S, 49 * S), fill=(225, 170, 77, 40), width=S)
    if seal:
        cx = width * S // 2
        draw.ellipse((cx - 18 * S, 8 * S, cx + 18 * S, 44 * S), fill=(45, 27, 10, 252), outline=GOLD_MID, width=2 * S)
        center_text(draw, (cx, 26 * S), "秦", font(15, song=True), GOLD_HI, stroke_width=S, stroke_fill=(56, 29, 8, 255))
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_input(path: Path) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=max(14, size[1] // 2 - 8), inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw.line((31 * S, (height - 20) * S, (width - 31) * S, (height - 20) * S), fill=(211, 155, 66, 65), width=S)
    draw_diamond(draw, 18 * S, height * S // 2, 3 * S, fill=GOLD_MID, outline=GOLD_HI)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_metric_card(path: Path, icon: str) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=13, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw.line((19 * S, 53 * S, (width - 19) * S, 53 * S), fill=(193, 132, 47, 80), width=S)
    draw_icon(draw, icon, (width * S // 2, 28 * S), 0.55)
    draw.line((29 * S, 100 * S, (width - 29) * S, 100 * S), fill=(224, 171, 79, 28), width=S)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_nav_button(path: Path, label: str, icon: str) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=24, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    icon_x = 49
    draw.ellipse((20 * S, 20 * S, 78 * S, (height - 20) * S), fill=(43, 27, 12, 235), outline=GOLD_MID, width=2 * S)
    draw_icon(draw, icon, (icon_x * S, height * S // 2), 0.56)
    draw.line((91 * S, 24 * S, 91 * S, (height - 24) * S), fill=(149, 88, 29, 120), width=S)
    text_x = 168 if label != "我的盟主" else 156
    metal_text(image, label, font(25 if len(label) <= 4 else 23), (text_x * S, height * S // 2), stroke=1, glow=0)
    draw.line((110 * S, (height - 18) * S, (width - 24) * S, (height - 18) * S), fill=(230, 179, 89, 32), width=S)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_small_button(path: Path, label: str, *, warning: bool = False) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=max(10, size[1] // 2 - 4), selected=not warning, inset=2)
    width, height = size
    draw = ImageDraw.Draw(image)
    if warning:
        draw.line((14 * S, (height - 8) * S, (width - 14) * S, (height - 8) * S), fill=COPPER, width=S)
    metal_text(image, label, font(20), (width * S // 2, height * S // 2), stroke=1, glow=0)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_primary_extract(path: Path) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=31, selected=True, inset=3)
    width, height = size
    draw = ImageDraw.Draw(image)
    draw_coin(draw, (67 * S, height * S // 2), 27 * S)
    draw.line((112 * S, 27 * S, 112 * S, (height - 27) * S), fill=(164, 98, 32, 150), width=S)
    metal_text(image, "提取红利", font(33), (278 * S, height * S // 2), stroke=1, glow=1)
    draw.line((143 * S, (height - 21) * S, (width - 31) * S, (height - 21) * S), fill=(255, 225, 152, 58), width=S)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_balance(path: Path) -> Path:
    size = existing_size(path)
    image = lacquer_panel(size, radius=31, inset=3)
    width, height = size
    draw = ImageDraw.Draw(image)
    metal_text(image, "红利余额", font(24), (width * S // 2, 30 * S), stroke=1, glow=0)
    draw.line((72 * S, 54 * S, (width - 72) * S, 54 * S), fill=(222, 165, 72, 85), width=S)
    bay = (30 * S, 65 * S, (width - 30) * S, (height - 18) * S)
    draw.rounded_rectangle(bay, radius=20 * S, fill=(4, 4, 4, 225), outline=(136, 84, 31, 190), width=2 * S)
    draw_coin(draw, (62 * S, 106 * S), 21 * S)
    draw.line((95 * S, 78 * S, 95 * S, 134 * S), fill=(143, 85, 27, 115), width=S)
    for x in range(126, width - 44, 52):
        draw.line((x * S, 92 * S, x * S, 121 * S), fill=(221, 169, 78, 20), width=S)
    for x in (17, width - 17):
        draw_diamond(draw, x * S, height * S // 2, 4 * S, fill=COPPER, outline=GOLD)
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def make_badge(path: Path) -> Path:
    size = NEW_BADGE_SIZE
    image = lacquer_panel(size, radius=11, selected=False, inset=1)
    draw = ImageDraw.Draw(image)
    draw.ellipse((4 * S, 4 * S, 23 * S, 23 * S), fill=(64, 37, 13, 250), outline=GOLD_MID, width=S)
    center_text(draw, (13.5 * S, 13.5 * S), "秦", font(8.5, song=True), GOLD_HI, stroke_width=S, stroke_fill=(49, 25, 7, 255))
    center_text(draw, (52 * S, 13.5 * S), "盟主", font(13), IVORY, stroke_width=S, stroke_fill=(43, 24, 8, 255))
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def build_assets() -> list[Path]:
    OUTPUTS.clear()

    small_labels = {
        "ID.png": ("ID", 17),
        "上级.png": ("上级ID", 19),
        "下级.png": ("下级玩家", 19),
        "今日贡献.png": ("今日贡献", 18),
        "分红比例.png": ("分红比例", 20),
        "总人.png": ("总人数", 17),
        "我的.png": ("我的ID", 19),
        "手数.png": ("手数", 18),
        "授权.png": ("授权", 18),
        "新增.png": ("今日新增人数", 19),
        "时间.png": ("注册时间", 18),
        "时间2.png": ("时间", 18),
        "昵称.png": ("昵称", 18),
        "比例.png": ("比例", 18),
        "比例设置.png": ("比例设置", 20),
        "玩家信息.png": ("玩家信息", 18),
        "玩家数.png": ("玩家数", 18),
        "累计.png": ("累计总贡献", 18),
        "累计贡献.png": ("累计贡献", 17),
        "累计贡献1.png": ("累计贡献", 18),
        "输入比例.png": ("请输入设定比例", 20),
        "金额.png": ("金额", 18),
    }
    title_labels = {
        "我的业绩.png": ("我的业绩", 23),
        "我的分红.png": ("我的分红", 23),
        "我的玩家.png": ("我的玩家", 23),
        "提取记录.png": ("提取记录", 23),
        "盟主.png": ("盟主", 23),
    }
    for name, (text, text_size) in small_labels.items():
        plain_text_asset(LUCK_AGENT / name, text, size_hint=text_size)
    for name, (text, text_size) in title_labels.items():
        plain_text_asset(LUCK_AGENT / name, text, size_hint=text_size, title=True)

    for filename, label, selected in (
        ("我的玩家未选中.png", "我的玩家", False),
        ("我的玩家选中.png", "我的玩家", True),
        ("二级代理未选中.png", "二级代理", False),
        ("二级代理选中.png", "二级代理", True),
        ("三级代理未选中.png", "三级代理", False),
        ("三级代理选中.png", "三级代理", True),
    ):
        make_tab(LUCK_AGENT / filename, label, selected)

    make_band(LUCK_AGENT / "切页底.png")
    make_summary_frame(LUCK_AGENT / "框.png", 3)
    make_summary_frame(LUCK_AGENT / "装饰框.png", 2, seal=True)
    make_input(LUCK_AGENT / "输入框.png")
    make_player_count(LUCK_AGENT / "玩家数量.png")
    make_stat_tile(LUCK_AGENT / "累计红利总数.png", "累计总红利", "coin")
    make_stat_tile(LUCK_AGENT / "累计红利提取.png", "累计总提取", "record")
    make_badge(NEW_BADGE)

    plain_text_asset(XYPK_AGENT / "代理标题.png", "代理", size_hint=24, title=True)
    plain_text_asset(XYPK_AGENT / "总业绩tt.png", "总业绩", size_hint=23, title=True)
    plain_text_asset(XYPK_AGENT / "奖池红利提取记录.png", "奖池红利提取记录", size_hint=23, title=True)
    make_wide_strip(XYPK_AGENT / "底框.png")
    make_metric_card(XYPK_AGENT / "总人数.png", "users")
    make_metric_card(XYPK_AGENT / "今日贡献.png", "coin")
    make_metric_card(XYPK_AGENT / "累计总贡献.png", "bars")
    make_nav_button(XYPK_AGENT / "我的玩家.png", "我的玩家", "users")
    make_nav_button(XYPK_AGENT / "我的业绩.png", "我的业绩", "chart")
    # The runtime percentage label sits at local x=228.  Keep the static copy
    # compact so values such as "18%" never collide with it.
    make_nav_button(XYPK_AGENT / "盟主.png", "盟主", "seal")
    make_nav_button(XYPK_AGENT / "提取记录.png", "提取记录", "record")
    make_nav_button(XYPK_AGENT / "推广按钮.png", "推广", "share")
    make_nav_button(XYPK_AGENT / "总业绩.png", "总业绩", "bars")
    make_small_button(XYPK_AGENT / "授权按钮.png", "授权")
    make_small_button(XYPK_AGENT / "提升.png", "设置")
    make_primary_extract(XYPK_AGENT / "提取.png")
    make_balance(XYPK_AGENT / "红利余额.png")

    if len(OUTPUTS) != len(TARGETS) or set(OUTPUTS) != set(TARGETS):
        missing = sorted(str(path.relative_to(ROOT)) for path in set(TARGETS) - set(OUTPUTS))
        extra = sorted(str(path.relative_to(ROOT)) for path in set(OUTPUTS) - set(TARGETS))
        raise RuntimeError(f"Target mismatch: generated={len(OUTPUTS)}, missing={missing}, extra={extra}")
    return list(OUTPUTS)


def paste_center(canvas: Image.Image, source: Image.Image, center: tuple[float, float], size: tuple[int, int] | None = None) -> None:
    source = source.convert("RGBA")
    if size is not None and source.size != size:
        source = source.resize(size, Image.Resampling.LANCZOS)
    x = round(center[0] - source.width / 2)
    y = round(center[1] - source.height / 2)
    canvas.alpha_composite(source, (x, y))


def preview_font(size: float, *, song: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SONGTI if song else PING), max(1, round(size)), index=0)


def preview_center(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, size: int, fill=IVORY) -> None:
    center_text(draw, xy, text, preview_font(size), fill, stroke_width=1, stroke_fill=(29, 18, 7, 220))


def base_preview(title: str) -> Image.Image:
    background = Image.open(COMMON / "背景.png").convert("RGB")
    background = ImageOps.fit(background, (750, 1334), Image.Resampling.LANCZOS).convert("RGBA")
    top = Image.open(COMMON1 / "顶部.png").convert("RGBA")
    paste_center(background, top, (375, 46), (750, 92))
    draw = ImageDraw.Draw(background)
    preview_center(draw, (375, 45), title, 25, GOLD_HI)
    draw.line((22, 94, 728, 94), fill=(182, 120, 44, 80), width=1)
    draw.line((31, 45, 48, 31), fill=GOLD, width=2)
    draw.line((31, 45, 48, 59), fill=GOLD, width=2)
    return background


def draw_table_rows(canvas: Image.Image, y0: int, columns: list[tuple[int, str]], rows: int = 7) -> None:
    draw = ImageDraw.Draw(canvas)
    header = Image.open(COMMON / "表格标题头.png").convert("RGBA")
    paste_center(canvas, header, (375, y0), (750, 72))
    for x, label in columns:
        preview_center(draw, (x, y0), label, 18, GOLD_HI)
    for row in range(rows):
        y = y0 + 50 + row * 62
        draw.line((38, y + 25, 712, y + 25), fill=(176, 113, 40, 52), width=1)
        for index, (x, _label) in enumerate(columns):
            sample = ("10086", "秦风雅客", "386", "2026-07-23", "已授权")[index % 5]
            preview_center(draw, (x, y), sample, 16, IVORY if index != len(columns) - 1 else GOLD)
    preview_center(draw, (375, 1248), "1 / 5", 19, GOLD_HI)


def render_main_preview() -> Image.Image:
    canvas = base_preview("代理")
    draw = ImageDraw.Draw(canvas)
    table = Image.open(COMMON / "表格标题头.png").convert("RGBA")
    paste_center(canvas, table, (375, 156), (750, 82))
    preview_center(draw, (132, 156), "今日红利  1280", 18)
    preview_center(draw, (375, 156), "昨日红利  986", 18)
    preview_center(draw, (619, 156), "前日红利  1126", 18)

    paste_center(canvas, Image.open(XYPK_AGENT / "红利余额.png"), (372, 292))
    preview_center(draw, (388, 310), "8 8 8 8 8 8", 31, GOLD_HI)
    paste_center(canvas, Image.open(XYPK_AGENT / "底框.png"), (375, 418))
    paste_center(canvas, Image.open(LUCK_AGENT / "累计红利总数.png"), (202, 418))
    paste_center(canvas, Image.open(LUCK_AGENT / "累计红利提取.png"), (547, 418))
    preview_center(draw, (275, 418), "36800", 18, GOLD_HI)
    preview_center(draw, (620, 418), "15600", 18, GOLD_HI)
    paste_center(canvas, Image.open(XYPK_AGENT / "提取.png"), (369, 531))

    paste_center(canvas, table, (375, 680), (750, 102))
    for x, label, value in ((95, "上级ID", "10001"), (278, "下级玩家", "128"), (466, "我的ID", "600086"), (654, "今日新增", "8")):
        preview_center(draw, (x, 662), label, 17, GOLD)
        preview_center(draw, (x, 701), value, 18, IVORY)

    buttons = (
        ("我的玩家.png", (251, 881)),
        ("我的业绩.png", (538, 881)),
        ("盟主.png", (251, 991)),
        ("提取记录.png", (538, 991)),
        ("推广按钮.png", (251, 1101)),
        ("总业绩.png", (538, 1101)),
    )
    for filename, center in buttons:
        paste_center(canvas, Image.open(XYPK_AGENT / filename), center)
    preview_center(draw, (335, 992), "18%", 16, COPPER)
    return canvas


def render_players_preview() -> Image.Image:
    canvas = base_preview("我的玩家")
    paste_center(canvas, Image.open(LUCK_AGENT / "玩家数量.png"), (375, 171))
    draw = ImageDraw.Draw(canvas)
    preview_center(draw, (680, 171), "128", 22, GOLD_HI)
    draw_table_rows(canvas, 286, [(84, "ID"), (248, "昵称"), (411, "手数"), (571, "注册时间"), (681, "授权")], 10)
    paste_center(canvas, Image.open(XYPK_AGENT / "授权按钮.png"), (678, 354), (108, 36))
    return canvas


def render_leader_preview() -> Image.Image:
    canvas = base_preview("盟主")
    paste_center(canvas, Image.open(LUCK_AGENT / "装饰框.png"), (375, 204))
    draw = ImageDraw.Draw(canvas)
    preview_center(draw, (236, 175), "今日贡献", 18, GOLD)
    preview_center(draw, (236, 226), "2680", 24, GOLD_HI)
    preview_center(draw, (514, 175), "累计贡献", 18, GOLD)
    preview_center(draw, (514, 226), "58600", 24, GOLD_HI)
    draw_table_rows(canvas, 354, [(78, "ID"), (222, "昵称"), (381, "玩家数"), (515, "比例"), (664, "设置")], 9)
    paste_center(canvas, Image.open(XYPK_AGENT / "提升.png"), (664, 422), (108, 36))
    return canvas


def render_performance_preview() -> Image.Image:
    canvas = base_preview("我的业绩")
    paste_center(canvas, Image.open(LUCK_AGENT / "切页底.png"), (375, 150))
    paste_center(canvas, Image.open(LUCK_AGENT / "我的玩家选中.png"), (124, 150))
    paste_center(canvas, Image.open(LUCK_AGENT / "二级代理未选中.png"), (349, 150))
    paste_center(canvas, Image.open(LUCK_AGENT / "三级代理未选中.png"), (585, 150))
    paste_center(canvas, Image.open(LUCK_AGENT / "框.png"), (375, 305))
    cards = (("总人数.png", "总人数", "128", 174), ("今日贡献.png", "今日贡献", "2680", 375), ("累计总贡献.png", "累计总贡献", "58600", 576))
    draw = ImageDraw.Draw(canvas)
    for filename, label, value, x in cards:
        paste_center(canvas, Image.open(XYPK_AGENT / filename), (x, 305))
        preview_center(draw, (x, 273), label, 16, GOLD)
        preview_center(draw, (x, 333), value, 23, GOLD_HI)
    draw_table_rows(canvas, 487, [(135, "玩家信息"), (388, "今日贡献"), (624, "累计贡献")], 9)
    return canvas


def render_total_preview() -> Image.Image:
    canvas = base_preview("总业绩")
    draw = ImageDraw.Draw(canvas)
    paste_center(canvas, Image.open(LUCK_AGENT / "累计红利总数.png"), (204, 167))
    paste_center(canvas, Image.open(LUCK_AGENT / "累计红利提取.png"), (548, 167))
    preview_center(draw, (278, 167), "26800", 18, GOLD_HI)
    preview_center(draw, (621, 167), "18%", 18, GOLD_HI)
    paste_center(canvas, Image.open(LUCK_AGENT / "输入框.png"), (310, 276), (423, 78))
    preview_center(draw, (294, 276), "请输入授权用户ID", 18, MUTED)
    paste_center(canvas, Image.open(XYPK_AGENT / "授权按钮.png"), (605, 276))
    draw_table_rows(canvas, 375, [(132, "用户ID"), (372, "昵称"), (630, "授权")], 11)
    return canvas


def render_records_preview() -> Image.Image:
    canvas = base_preview("提取记录")
    draw_table_rows(canvas, 195, [(184, "时间"), (432, "提取金额"), (642, "状态")], 12)
    draw = ImageDraw.Draw(canvas)
    preview_center(draw, (432, 245), "1280", 17, GOLD_HI)
    preview_center(draw, (642, 245), "已完成", 17, (114, 166, 114, 255))
    return canvas


def render_dialog_preview() -> Image.Image:
    canvas = base_preview("代理设置")
    shade = Image.new("RGBA", canvas.size, (0, 0, 0, 112))
    canvas.alpha_composite(shade)
    frame = Image.open(KK_COMMON / "框.png").convert("RGBA")
    paste_center(canvas, frame, (375, 650), (635, 680))
    draw = ImageDraw.Draw(canvas)
    preview_center(draw, (375, 392), "盟主比例设置", 25, GOLD_HI)
    paste_center(canvas, Image.open(LUCK_AGENT / "输入框.png"), (375, 590))
    preview_center(draw, (375, 590), "请输入设定比例", 19, MUTED)
    paste_center(canvas, Image.open(XYPK_AGENT / "提升.png"), (375, 765), (190, 63))
    preview_center(draw, (375, 845), "注意：分成比例只能提升，不能降低", 16, COPPER)
    paste_center(canvas, Image.open(LUCK_AGENT / "盟主徽标.png"), (375, 470), (123, 41))
    return canvas


def make_previews() -> list[Path]:
    ART.mkdir(parents=True, exist_ok=True)
    main = render_main_preview()
    main_path = ART / "qin_hongli_main_preview.png"
    main.save(main_path, format="PNG", compress_level=9)

    pages = (
        ("主页面", main),
        ("我的玩家", render_players_preview()),
        ("我的盟主", render_leader_preview()),
        ("我的业绩", render_performance_preview()),
        ("总业绩", render_total_preview()),
        ("提取记录", render_records_preview()),
        ("设置弹窗", render_dialog_preview()),
    )
    card_width, card_height = 360, 640
    gap_x, gap_y = 24, 54
    cols = 4
    rows = math.ceil(len(pages) / cols)
    sheet = Image.new("RGB", (cols * card_width + (cols + 1) * gap_x, rows * card_height + (rows + 1) * gap_y), (13, 11, 8))
    draw = ImageDraw.Draw(sheet)
    for index, (label, page) in enumerate(pages):
        col, row = index % cols, index // cols
        x = gap_x + col * (card_width + gap_x)
        y = gap_y + row * (card_height + gap_y)
        thumb = page.convert("RGB").resize((card_width, card_height), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x, y))
        preview_center(draw, (x + card_width / 2, y - 23), label, 20, GOLD_HI)
        draw.rectangle((x - 1, y - 1, x + card_width, y + card_height), outline=(142, 91, 35), width=1)
    states_path = ART / "qin_hongli_states_preview.png"
    sheet.save(states_path, format="PNG", compress_level=9)
    return [main_path, states_path]


def strong_blue_count(image: Image.Image) -> int:
    count = 0
    rgba = image.convert("RGBA")
    pixels = rgba.get_flattened_data() if hasattr(rgba, "get_flattened_data") else rgba.getdata()
    for red, green, blue, alpha in pixels:
        if alpha <= 32:
            continue
        blue_neon = blue > 145 and blue > red * 1.45 and blue > green * 1.15
        cyan_neon = green > 145 and blue > 145 and max(green, blue) > red * 1.6
        if blue_neon or cyan_neon:
            count += 1
    return count


def validate() -> None:
    if len(TARGETS) != 58 or len(set(TARGETS)) != 58:
        raise RuntimeError(f"Expected 58 unique targets, got {len(TARGETS)} / {len(set(TARGETS))}")
    for path in TARGETS:
        if not path.exists():
            raise RuntimeError(f"Missing generated target: {path}")
        image = Image.open(path)
        expected_size = NEW_BADGE_SIZE if path == NEW_BADGE else existing_size(path)
        if image.size != expected_size or image.mode != "RGBA":
            raise RuntimeError(f"Invalid image spec: {path}: {image.size} {image.mode}")
        meta = read_meta(path)
        if meta is not None:
            if (int(meta["width"]), int(meta["height"])) != image.size:
                raise RuntimeError(f"Meta size mismatch: {path}")
            sub = next(iter(meta["subMetas"].values()))
            expected_bbox = (
                int(sub["trimX"]),
                int(sub["trimY"]),
                int(sub["trimX"]) + int(sub["width"]),
                int(sub["trimY"]) + int(sub["height"]),
            )
            if image.getchannel("A").getbbox() != expected_bbox:
                raise RuntimeError(f"Alpha trim mismatch: {path}: {image.getchannel('A').getbbox()} != {expected_bbox}")
            if path == NEW_BADGE and sub.get("uuid") != NEW_BADGE_SPRITE_UUID:
                raise RuntimeError(f"Unexpected badge SpriteFrame UUID: {sub.get('uuid')}")
        if strong_blue_count(image):
            raise RuntimeError(f"Strong blue/cyan pixels remain: {path}")


def digest(paths: list[Path] | tuple[Path, ...]) -> dict[str, str]:
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def meta_digest() -> dict[str, str]:
    paths = [path.with_suffix(path.suffix + ".meta") for path in TARGETS]
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths if path.exists()}


def main() -> None:
    meta_before = meta_digest()
    build_assets()
    previews = make_previews()
    validate()
    first = digest(list(TARGETS) + previews)
    build_assets()
    previews = make_previews()
    validate()
    second = digest(list(TARGETS) + previews)
    if first != second:
        changed = sorted(key for key in first if first[key] != second.get(key))
        raise RuntimeError(f"Generation is not deterministic: {changed}")
    if meta_before != meta_digest():
        raise RuntimeError("A target .meta file changed during generation")

    print(f"Generated {len(TARGETS)} panelHongli Qin assets (two identical passes).")
    print("Targets:")
    for path in TARGETS:
        print(path.relative_to(ROOT))
    print("Previews:")
    for path in previews:
        print(path.relative_to(ROOT))
    print("Validation: size/mode/meta trim/blue-cyan/deterministic hash passed")


if __name__ == "__main__":
    main()
