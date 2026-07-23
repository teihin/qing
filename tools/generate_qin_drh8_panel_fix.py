#!/usr/bin/env python3
"""Deterministically repair drh8 popup/control art after the broad Qin reskin.

This pass is intentionally separate from ``generate_qin_drh8_skin.py``.  It is
run after the broad skin generator and only overwrites PNG pixels.  Existing
paths, raw dimensions, image modes, SpriteFrame trim rectangles, nine-slice
borders, ``.meta`` files, UUIDs, scenes and prefabs remain untouched.

The legacy HEAD art is used as the semantic contract: selection frames stay
transparent, jackpot digits remain separate wells, connected tabs retain
left/middle/right silhouettes, value strips keep a fixed label area plus a
quiet dynamic-value area, and title sprites are not redrawn as buttons.

Several shared sprites are saved as RAW/TRIMMED in Creator while their scene
nodes have smaller manually saved sizes.  For those sprites, the visible art is
drawn inside the smallest drh8-safe rectangle and practically invisible alpha
anchors preserve the historical meta trim.  This prevents Creator from making
the visible button/switch overlap adjacent nodes when it restores raw size.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = ROOT / "assets" / "font" / "PingFF.ttf"
SCALE = 4

GOLD_HI = (246, 222, 158, 255)
GOLD = (203, 151, 67, 255)
GOLD_MID = (135, 86, 31, 255)
GOLD_DARK = (63, 38, 14, 255)
IVORY = (232, 218, 183, 255)
MUTED = (148, 130, 96, 255)
BLACK = (5, 5, 4, 255)
LACQUER_TOP = (18, 15, 10, 250)
LACQUER_BOTTOM = (7, 7, 6, 252)
ANCHOR_ALPHA = 3  # Creator trimThreshold is 1.


class BuildError(RuntimeError):
    """A deterministic input/output or structure validation failure."""


@dataclass(frozen=True)
class Context:
    path: Path
    size: tuple[int, int]
    mode: str
    trim: tuple[int, int, int, int]
    borders: tuple[float, float, float, float]  # left, right, top, bottom


Renderer = Callable[[Context], Image.Image]


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"无法读取 JSON：{path}: {exc}") from exc


def context_for(path: Path) -> Context:
    if not path.exists():
        raise BuildError(f"缺少目标 PNG：{path}")
    meta_path = path.with_suffix(path.suffix + ".meta")
    meta = read_json(meta_path)
    if not meta.get("subMetas"):
        raise BuildError(f"目标没有 SpriteFrame subMeta：{meta_path}")
    sub = next(iter(meta["subMetas"].values()))
    with Image.open(path) as image:
        size = image.size
        mode = image.mode
    raw = (int(sub["rawWidth"]), int(sub["rawHeight"]))
    if size != raw:
        raise BuildError(f"PNG 与 meta 原始尺寸不一致：{path} {size} != {raw}")
    x = int(sub["trimX"])
    y = int(sub["trimY"])
    trim = (x, y, x + int(sub["width"]), y + int(sub["height"]))
    borders = (
        float(sub.get("borderLeft", 0)),
        float(sub.get("borderRight", 0)),
        float(sub.get("borderTop", 0)),
        float(sub.get("borderBottom", 0)),
    )
    return Context(path, size, mode, trim, borders)


def font(size: int) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.exists():
        raise BuildError(f"缺少字体：{FONT_PATH}")
    return ImageFont.truetype(str(FONT_PATH), max(1, round(size * SCALE)))


def hs(value: float) -> int:
    return round(value * SCALE)


def hbox(bounds: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(hs(value) for value in bounds)  # type: ignore[return-value]


def hi_canvas(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", (size[0] * SCALE, size[1] * SCALE), (0, 0, 0, 0))


def finish(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.LANCZOS)


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    bounds: tuple[float, float, float, float],
    text: str,
    size: int,
    fill: tuple[int, int, int, int] = GOLD_HI,
    stroke: int = 1,
) -> None:
    fnt = font(size)
    x0, y0, x1, y1 = hbox(bounds)
    bb = draw.multiline_textbbox(
        (0, 0), text, font=fnt, spacing=hs(1), align="center", stroke_width=hs(stroke)
    )
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    draw.multiline_text(
        ((x0 + x1 - tw) / 2 - bb[0], (y0 + y1 - th) / 2 - bb[1]),
        text,
        font=fnt,
        fill=fill,
        spacing=hs(1),
        align="center",
        stroke_width=hs(stroke),
        stroke_fill=(31, 19, 7, 230),
    )


def vertical_gradient(
    size: tuple[int, int],
    top: tuple[int, int, int, int] = LACQUER_TOP,
    bottom: tuple[int, int, int, int] = LACQUER_BOTTOM,
) -> Image.Image:
    width, height = size[0] * SCALE, size[1] * SCALE
    out = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(out)
    denom = max(1, height - 1)
    for y in range(height):
        t = y / denom
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        draw.line((0, y, width, y), fill=color)
    return out


def rounded_mask(
    size: tuple[int, int],
    bounds: tuple[float, float, float, float],
    radius: float,
) -> Image.Image:
    mask = Image.new("L", (size[0] * SCALE, size[1] * SCALE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(hbox(bounds), radius=hs(radius), fill=255)
    return mask


def paste_gradient(
    image: Image.Image,
    mask: Image.Image,
    top: tuple[int, int, int, int] = LACQUER_TOP,
    bottom: tuple[int, int, int, int] = LACQUER_BOTTOM,
) -> None:
    image.paste(vertical_gradient((image.width // SCALE, image.height // SCALE), top, bottom), (0, 0), mask)


def trim_local_bounds(ctx: Context, inset: float = 0) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = ctx.trim
    return (x0 + inset, y0 + inset, x1 - 1 - inset, y1 - 1 - inset)


def draw_clean_button(
    ctx: Context,
    text: str,
    safe_size: tuple[int, int] | None = None,
    primary: bool = True,
    font_size: int | None = None,
) -> Image.Image:
    width, height = ctx.size
    safe_w, safe_h = safe_size or (max(8, width - 4), max(8, height - 4))
    safe_w, safe_h = min(safe_w, width - 2), min(safe_h, height - 2)
    left = (width - safe_w) / 2
    top = (height - safe_h) / 2
    bounds = (left, top, left + safe_w - 1, top + safe_h - 1)
    radius = min(safe_h * 0.32, 18)
    image = hi_canvas(ctx.size)
    mask = rounded_mask(ctx.size, bounds, radius)
    paste_gradient(
        image,
        mask,
        (27, 19, 10, 252) if primary else (18, 16, 12, 250),
        (8, 7, 5, 252),
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        hbox(bounds), radius=hs(radius), outline=GOLD_MID, width=hs(2)
    )
    inner = (left + 4, top + 4, left + safe_w - 5, top + safe_h - 5)
    draw.rounded_rectangle(
        hbox(inner),
        radius=hs(max(2, radius - 4)),
        outline=GOLD_HI if primary else GOLD,
        width=hs(1),
    )
    fs = font_size or max(15, min(27, round(safe_h * 0.40)))
    draw_centered_text(draw, bounds, text, fs, GOLD_HI if primary else IVORY, 1)
    return finish(image, ctx.size)


def draw_toggle(ctx: Context, enabled: bool) -> Image.Image:
    # Smallest saved drh8 target is 92x39 (the live-record rubbing toggle).
    safe_w, safe_h = 92, 39
    width, height = ctx.size
    left, top = (width - safe_w) / 2, (height - safe_h) / 2
    bounds = (left, top, left + safe_w - 1, top + safe_h - 1)
    radius = safe_h / 2
    image = hi_canvas(ctx.size)
    mask = rounded_mask(ctx.size, bounds, radius)
    paste_gradient(
        image,
        mask,
        (37, 25, 10, 252) if enabled else (17, 16, 13, 250),
        (7, 7, 6, 252),
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(radius), outline=GOLD_MID, width=hs(2))
    inner = (left + 3, top + 3, left + safe_w - 4, top + safe_h - 4)
    draw.rounded_rectangle(hbox(inner), radius=hs(radius - 3), outline=GOLD, width=hs(1))
    knob_r = (safe_h - 10) / 2
    knob_x = left + safe_w - 6 - knob_r if enabled else left + 6 + knob_r
    knob_y = top + safe_h / 2
    draw.ellipse(
        hbox((knob_x - knob_r, knob_y - knob_r, knob_x + knob_r, knob_y + knob_r)),
        fill=(83, 52, 18, 255) if enabled else (47, 37, 22, 255),
        outline=GOLD_HI,
        width=hs(1.5),
    )
    text_bounds = (
        left + 7,
        top + 2,
        knob_x - knob_r - 2 if enabled else left + safe_w - 7,
        top + safe_h - 2,
    )
    if not enabled:
        text_bounds = (knob_x + knob_r + 2, top + 2, left + safe_w - 7, top + safe_h - 2)
    draw_centered_text(draw, text_bounds, "开" if enabled else "关", 17, GOLD_HI if enabled else MUTED, 1)
    return finish(image, ctx.size)


def tint_existing_alpha(
    ctx: Context,
    color: tuple[int, int, int, int] = GOLD_HI,
) -> Image.Image:
    """Keep a legacy icon silhouette while replacing its old neon hue."""
    with Image.open(ctx.path) as source:
        alpha = source.convert("RGBA").getchannel("A")
    image = Image.new("RGBA", ctx.size, color)
    image.putalpha(alpha)
    return image


def recolor_lower_cyan_to_gold(ctx: Context) -> Image.Image:
    """Remove the legacy cyan rule caption without altering playing-card art."""
    with Image.open(ctx.path) as source:
        image = source.convert("RGBA")
    pixels = image.load()
    start_y = round(ctx.size[1] * 0.82)
    for y in range(start_y, ctx.size[1]):
        for x in range(ctx.size[0]):
            red, green, blue, alpha = pixels[x, y]
            if (
                alpha > 16
                and blue > 145
                and green > 105
                and blue > red * 1.35
                and green > red * 1.15
            ):
                pixels[x, y] = (GOLD_HI[0], GOLD_HI[1], GOLD_HI[2], alpha)
    return image


def draw_round_action(
    ctx: Context,
    text: str = "",
    selected: bool = True,
    safe_size: tuple[int, int] | None = None,
    font_size: int = 24,
) -> Image.Image:
    """Transparent circular action control without a rectangular shadow mat."""
    width, height = ctx.size
    safe_w, safe_h = safe_size or (width - 4, height - 4)
    diameter = min(safe_w, safe_h, width - 2, height - 2)
    left = (width - diameter) / 2
    top = (height - diameter) / 2
    bounds = (left, top, left + diameter - 1, top + diameter - 1)
    image = hi_canvas(ctx.size)
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse(hbox(bounds), fill=255)
    paste_gradient(
        image,
        mask,
        (33, 23, 11, 255) if selected else (18, 16, 12, 250),
        (6, 6, 5, 255),
    )
    draw = ImageDraw.Draw(image)
    draw.ellipse(hbox(bounds), outline=GOLD_HI if selected else GOLD_MID, width=hs(2))
    inner = (left + 6, top + 6, left + diameter - 7, top + diameter - 7)
    draw.ellipse(hbox(inner), outline=GOLD_MID, width=hs(2))
    inner2 = (left + 11, top + 11, left + diameter - 12, top + diameter - 12)
    draw.ellipse(hbox(inner2), outline=(214, 166, 76, 120), width=hs(1))
    # Four restrained Qin-style cardinal markers.
    cx, cy = width / 2, height / 2
    marker = max(2, diameter * 0.035)
    for mx, my in ((cx, top + 7), (cx, top + diameter - 8), (left + 7, cy), (left + diameter - 8, cy)):
        draw.polygon(
            hbox((mx, my - marker, mx + marker, my, mx, my + marker, mx - marker, my)),
            fill=GOLD if selected else GOLD_MID,
        )
    if text:
        draw_centered_text(
            draw,
            (left + 11, top + 10, left + diameter - 11, top + diameter - 10),
            text,
            font_size,
            GOLD_HI if selected else IVORY,
            1,
        )
    return finish(image, ctx.size)


def draw_observer_badge(ctx: Context) -> Image.Image:
    """Keep the observer mark below the face instead of covering the portrait."""
    width, height = ctx.size
    safe_w, safe_h = 46, 22
    left = (width - safe_w) / 2
    top = height - safe_h - 4
    bounds = (left, top, left + safe_w - 1, top + safe_h - 1)
    image = hi_canvas(ctx.size)
    mask = rounded_mask(ctx.size, bounds, 8)
    paste_gradient(image, mask, (27, 20, 11, 252), (7, 7, 6, 252))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(8), outline=GOLD_HI, width=hs(1.5))
    inner = (left + 3, top + 3, left + safe_w - 4, top + safe_h - 4)
    draw.rounded_rectangle(hbox(inner), radius=hs(5), outline=GOLD_MID, width=hs(1))
    draw_centered_text(draw, bounds, "观战", 11, GOLD_HI, 0)
    return finish(image, ctx.size)


def draw_jackpot_amount_strip(ctx: Context) -> Image.Image:
    """Match the existing right-aligned dynamic amount label with one value well."""
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    body_h = min(92, height - 20)
    top = (height - body_h) / 2
    bounds = (7, top, width - 8, top + body_h - 1)
    mask = rounded_mask(ctx.size, bounds, 18)
    paste_gradient(image, mask, (24, 18, 10, 252), (6, 6, 5, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(18), outline=GOLD_MID, width=hs(2))
    inner = (bounds[0] + 5, bounds[1] + 5, bounds[2] - 5, bounds[3] - 5)
    draw.rounded_rectangle(hbox(inner), radius=hs(13), outline=(220, 171, 81, 135), width=hs(1))
    coin_x = 48
    coin_r = min(27, body_h * 0.33)
    cy = height / 2
    draw.ellipse(hbox((coin_x - coin_r, cy - coin_r, coin_x + coin_r, cy + coin_r)), fill=(62, 39, 14, 255), outline=GOLD_HI, width=hs(1.5))
    draw_centered_text(draw, (coin_x - coin_r, cy - coin_r, coin_x + coin_r, cy + coin_r), "秦", 17, GOLD_HI, 0)
    draw_centered_text(draw, (82, top + 4, 278, top + body_h - 5), "奖池总额", 22, GOLD_HI, 1)
    draw.line((hs(292), hs(top + 12), hs(292), hs(top + body_h - 13)), fill=(174, 119, 45, 170), width=hs(1))
    value_bounds = (307, top + 10, width - 24, top + body_h - 11)
    draw.rounded_rectangle(hbox(value_bounds), radius=hs(10), fill=(3, 3, 3, 190), outline=GOLD_DARK, width=hs(1))
    return finish(image, ctx.size)


def draw_small_jackpot_amount_strip(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (4, 5, width - 5, height - 6)
    mask = rounded_mask(ctx.size, bounds, 12)
    paste_gradient(image, mask, (22, 17, 9, 252), (6, 6, 5, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(12), outline=GOLD_MID, width=hs(1.5))
    draw_centered_text(draw, (10, 2, 108, height - 2), "奖池", 17, GOLD_HI, 1)
    draw.line((hs(112), hs(13), hs(112), hs(height - 14)), fill=(174, 119, 45, 150), width=hs(1))
    return finish(image, ctx.size)


def draw_popup(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    bounds = trim_local_bounds(ctx, 1)
    radius = 18
    mask = rounded_mask(ctx.size, bounds, radius)
    paste_gradient(image, mask, (18, 15, 10, 255), (6, 6, 5, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(radius), outline=GOLD_MID, width=hs(2))
    inner = (bounds[0] + 5, bounds[1] + 5, bounds[2] - 5, bounds[3] - 5)
    draw.rounded_rectangle(hbox(inner), radius=hs(radius - 5), outline=(178, 130, 57, 190), width=hs(1))
    top_border = ctx.borders[2]
    if top_border > 0:
        y = ctx.trim[1] + top_border
        draw.line((hs(bounds[0] + 8), hs(y), hs(bounds[2] - 8), hs(y)), fill=(190, 137, 55, 150), width=hs(1))
        # One restrained title sheen; the body deliberately contains no rows.
        draw.line((hs(bounds[0] + 22), hs(y - 7), hs(bounds[2] - 22), hs(y - 7)), fill=(245, 215, 144, 35), width=hs(1))
    return finish(image, ctx.size)


def draw_side_panel(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    x0, y0, x1, y1 = ctx.trim
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rectangle(hbox((x0, y0, x1 - 1, y1 - 1)), fill=255)
    paste_gradient(image, mask, (17, 14, 9, 252), (5, 5, 4, 253))
    draw = ImageDraw.Draw(image)
    draw.line((hs(x0 + 1), hs(y0), hs(x0 + 1), hs(y1 - 1)), fill=GOLD_MID, width=hs(1))
    draw.line((hs(x1 - 2), hs(y0), hs(x1 - 2), hs(y1 - 1)), fill=GOLD_DARK, width=hs(1))
    header = ctx.borders[2] or 130
    draw.line((hs(x0 + 8), hs(y0 + header), hs(x1 - 9), hs(y0 + header)), fill=(199, 145, 63, 170), width=hs(1))
    return finish(image, ctx.size)


def draw_clean_field(ctx: Context, radius: int = 9) -> Image.Image:
    image = hi_canvas(ctx.size)
    bounds = trim_local_bounds(ctx, 1)
    mask = rounded_mask(ctx.size, bounds, radius)
    paste_gradient(image, mask, (16, 14, 10, 248), (7, 7, 6, 250))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(radius), outline=GOLD_MID, width=hs(1.5))
    inner = (bounds[0] + 3, bounds[1] + 3, bounds[2] - 3, bounds[3] - 3)
    draw.rounded_rectangle(hbox(inner), radius=hs(max(2, radius - 3)), outline=(211, 164, 79, 115), width=hs(1))
    return finish(image, ctx.size)


def draw_title_background(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    x0, y0, x1, y1 = ctx.trim
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rectangle(hbox((x0, y0, x1 - 1, y1 - 1)), fill=255)
    paste_gradient(image, mask, (18, 15, 10, 228), (7, 7, 6, 235))
    draw = ImageDraw.Draw(image)
    # Stretch-safe: only a single top and bottom hairline, no fixed ornaments.
    draw.line((hs(x0), hs(y0 + 1), hs(x1 - 1), hs(y0 + 1)), fill=(196, 142, 57, 120), width=hs(1))
    draw.line((hs(x0), hs(y1 - 2), hs(x1 - 1), hs(y1 - 2)), fill=GOLD_DARK, width=hs(1))
    return finish(image, ctx.size)


def draw_notice_strip(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    # Soft translucent center survives both 474px and 750px node widths.
    for y in range(height * SCALE):
        t = abs((y / max(1, height * SCALE - 1)) - 0.5) * 2
        alpha = round(175 * (1 - t) + 18 * t)
        ImageDraw.Draw(image).line((0, y, width * SCALE, y), fill=(7, 7, 6, alpha))
    draw = ImageDraw.Draw(image)
    draw.line((0, hs(1), hs(width), hs(1)), fill=(190, 139, 58, 80), width=hs(1))
    draw.line((0, hs(height - 2), hs(width), hs(height - 2)), fill=(190, 139, 58, 60), width=hs(1))
    return finish(image, ctx.size)


def draw_selection_frame(ctx: Context, tall: bool = False) -> Image.Image:
    image = hi_canvas(ctx.size)
    x0, y0, x1, y1 = ctx.trim
    inset = 3 if tall else 4
    bounds = (x0 + inset, y0 + inset, x1 - inset - 1, y1 - inset - 1)
    radius = 19 if tall else 10
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(radius), outline=GOLD_MID, width=hs(2))
    inner = (bounds[0] + 3, bounds[1] + 3, bounds[2] - 3, bounds[3] - 3)
    draw.rounded_rectangle(hbox(inner), radius=hs(max(2, radius - 3)), outline=GOLD_HI, width=hs(1))
    # The interior remains transparent; only the selection tick is added.
    cx = (bounds[0] + bounds[2]) / 2
    cy = bounds[1] + (bounds[3] - bounds[1]) * (0.55 if tall else 0.86)
    draw.line((hs(cx - 8), hs(cy), hs(cx - 2), hs(cy + 6)), fill=GOLD_HI, width=hs(2))
    draw.line((hs(cx - 2), hs(cy + 6), hs(cx + 10), hs(cy - 7)), fill=GOLD_HI, width=hs(2))
    return finish(image, ctx.size)


def draw_star_outline(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    draw = ImageDraw.Draw(image)
    width, height = ctx.size
    cx, cy = width / 2, height / 2
    outer, inner = min(width, height) * 0.43, min(width, height) * 0.20
    points: list[tuple[int, int]] = []
    for index in range(10):
        angle = math.radians(-90 + index * 36)
        radius = outer if index % 2 == 0 else inner
        points.append((hs(cx + math.cos(angle) * radius), hs(cy + math.sin(angle) * radius)))
    draw.line(points + [points[0]], fill=GOLD_HI, width=hs(2), joint="curve")
    inner_points = []
    for index in range(10):
        angle = math.radians(-90 + index * 36)
        radius = outer - 5 if index % 2 == 0 else inner - 2
        inner_points.append((hs(cx + math.cos(angle) * radius), hs(cy + math.sin(angle) * radius)))
    draw.line(inner_points + [inner_points[0]], fill=GOLD_MID, width=hs(1), joint="curve")
    return finish(image, ctx.size)


def draw_slider_track(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    track_h = min(10, height - 4)
    top = (height - track_h) / 2
    bounds = (2, top, width - 3, top + track_h - 1)
    mask = rounded_mask(ctx.size, bounds, track_h / 2)
    paste_gradient(image, mask, (42, 29, 12, 255), (9, 8, 6, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(track_h / 2), outline=GOLD_MID, width=hs(1))
    draw.line((hs(8), hs(top + 2), hs(width - 9), hs(top + 2)), fill=(244, 214, 144, 100), width=hs(1))
    return finish(image, ctx.size)


def draw_score_bubble(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    body = (7, 2, width - 8, height - 9)
    mask = rounded_mask(ctx.size, body, 7)
    paste_gradient(image, mask, (20, 17, 11, 252), (7, 7, 6, 252))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(body), radius=hs(7), outline=GOLD_MID, width=hs(1.5))
    cx = width / 2
    draw.polygon(
        [(hs(cx - 7), hs(height - 10)), (hs(cx + 7), hs(height - 10)), (hs(cx), hs(height - 1))],
        fill=(10, 9, 6, 252),
        outline=GOLD_MID,
    )
    return finish(image, ctx.size)


def draw_coin_field(ctx: Context) -> Image.Image:
    image = draw_clean_field(ctx, 8).resize((ctx.size[0] * SCALE, ctx.size[1] * SCALE), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    height = ctx.size[1]
    cx, cy, radius = 18, height / 2, min(10, height / 2 - 4)
    draw.ellipse(hbox((cx - radius, cy - radius, cx + radius, cy + radius)), fill=(72, 45, 15, 255), outline=GOLD_HI, width=hs(1))
    draw_centered_text(draw, (cx - radius, cy - radius, cx + radius, cy + radius), "秦", 8, GOLD_HI, 0)
    return finish(image, ctx.size)


def draw_split_value(ctx: Context, label: str, split: int) -> Image.Image:
    image = draw_clean_field(ctx, max(6, ctx.size[1] // 4)).resize((ctx.size[0] * SCALE, ctx.size[1] * SCALE), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    draw.line((hs(split), hs(5), hs(split), hs(ctx.size[1] - 6)), fill=(165, 113, 43, 155), width=hs(1))
    draw_centered_text(draw, (4, 1, split - 3, ctx.size[1] - 1), label, max(12, min(17, ctx.size[1] // 2)), GOLD_HI, 1)
    return finish(image, ctx.size)


def draw_pool_value(ctx: Context) -> Image.Image:
    image = draw_clean_field(ctx, 12).resize((ctx.size[0] * SCALE, ctx.size[1] * SCALE), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    height = ctx.size[1]
    cx, cy, radius = 25, height / 2, min(14, height / 2 - 6)
    draw.ellipse(hbox((cx - radius, cy - radius, cx + radius, cy + radius)), fill=(72, 45, 14, 255), outline=GOLD_HI, width=hs(1))
    draw_centered_text(draw, (cx - radius, cy - radius, cx + radius, cy + radius), "秦", 10, GOLD_HI, 0)
    draw_centered_text(draw, (44, 1, 103, height - 1), "奖池:", 16, GOLD_HI, 1)
    draw.line((hs(108), hs(7), hs(108), hs(height - 8)), fill=(164, 112, 42, 155), width=hs(1))
    return finish(image, ctx.size)


def draw_card_slot(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (5, 2, width - 6, height - 3)
    mask = rounded_mask(ctx.size, bounds, 7)
    paste_gradient(image, mask, (20, 16, 10, 250), (6, 6, 5, 252))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(7), outline=GOLD_MID, width=hs(2))
    inner = (bounds[0] + 4, bounds[1] + 4, bounds[2] - 4, bounds[3] - 4)
    draw.rounded_rectangle(hbox(inner), radius=hs(4), outline=(217, 168, 81, 120), width=hs(1))
    return finish(image, ctx.size)


def draw_light_title(ctx: Context, text: str) -> Image.Image:
    image = hi_canvas(ctx.size)
    draw = ImageDraw.Draw(image)
    width, height = ctx.size
    center = width / 2
    gap = min(54, width * 0.28)
    y = height * 0.55
    draw.line((hs(2), hs(y), hs(center - gap), hs(y)), fill=(175, 123, 48, 150), width=hs(1))
    draw.line((hs(center + gap), hs(y), hs(width - 2), hs(y)), fill=(175, 123, 48, 150), width=hs(1))
    draw_centered_text(draw, (0, 0, width, height), text, max(14, min(23, round(height * 0.58))), GOLD_HI, 1)
    return finish(image, ctx.size)


def draw_selector_bar(ctx: Context, text: str) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (1, 2, width - 2, height - 3)
    mask = rounded_mask(ctx.size, bounds, min(12, height / 3))
    paste_gradient(image, mask, (21, 17, 10, 248), (7, 7, 6, 250))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(min(12, height / 3)), outline=GOLD_MID, width=hs(1.5))
    draw.line((hs(15), hs(height - 6), hs(width - 16), hs(height - 6)), fill=(213, 165, 76, 100), width=hs(1))
    draw_centered_text(draw, bounds, text, 20, GOLD_HI, 1)
    return finish(image, ctx.size)


def tab_mask(ctx: Context, position: str, inset: int = 2) -> Image.Image:
    width, height = ctx.size
    x0, y0, x1, y1 = inset, inset, width - inset - 1, height - inset - 1
    radius = max(8, (y1 - y0) / 2)
    mask = Image.new("L", (width * SCALE, height * SCALE), 0)
    draw = ImageDraw.Draw(mask)
    if position == "middle":
        draw.rectangle(hbox((x0, y0, x1, y1)), fill=255)
    elif position == "left":
        draw.rounded_rectangle(hbox((x0, y0, x1, y1)), radius=hs(radius), fill=255)
        draw.rectangle(hbox((x0 + radius, y0, x1, y1)), fill=255)
    elif position == "right":
        draw.rounded_rectangle(hbox((x0, y0, x1, y1)), radius=hs(radius), fill=255)
        draw.rectangle(hbox((x0, y0, x1 - radius, y1)), fill=255)
    else:
        raise BuildError(f"未知 Tab 位置：{position}")
    return mask


def draw_connected_tab(ctx: Context, text: str, position: str, selected: bool) -> Image.Image:
    image = hi_canvas(ctx.size)
    mask = tab_mask(ctx, position)
    paste_gradient(
        image,
        mask,
        (47, 31, 12, 255) if selected else (18, 16, 12, 248),
        (10, 8, 6, 252),
    )
    # Derive a silhouette-correct border, including square joining edges.
    eroded = mask.filter(ImageFilter.MinFilter(2 * SCALE + 1))
    border = ImageChops.subtract(mask, eroded)
    border_color = Image.new("RGBA", image.size, GOLD_HI if selected else GOLD_MID)
    image.alpha_composite(Image.composite(border_color, Image.new("RGBA", image.size), border))
    draw = ImageDraw.Draw(image)
    draw_centered_text(draw, (4, 1, ctx.size[0] - 4, ctx.size[1] - 1), text, 19, GOLD_HI if selected else MUTED, 1)
    if selected:
        draw.line((hs(18), hs(ctx.size[1] - 8), hs(ctx.size[0] - 18), hs(ctx.size[1] - 8)), fill=GOLD_HI, width=hs(2))
    return finish(image, ctx.size)


def draw_digit_wells(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    draw = ImageDraw.Draw(image)
    width, height = ctx.size
    count = 6
    margin = max(6, round(width * 0.035))
    gap = max(4, round(width * 0.018))
    diameter = min((width - 2 * margin - (count - 1) * gap) / count, height * 0.56)
    total = count * diameter + (count - 1) * gap
    x = (width - total) / 2
    y = max(5, height * 0.10)
    for _ in range(count):
        bounds = (x, y, x + diameter, y + diameter)
        draw.ellipse(hbox(bounds), fill=(10, 8, 6, 252), outline=GOLD_MID, width=hs(2))
        inner = (x + 4, y + 4, x + diameter - 4, y + diameter - 4)
        draw.ellipse(hbox(inner), outline=GOLD_HI, width=hs(1))
        pedestal_y = y + diameter + 2
        draw.polygon(
            [
                (hs(x + diameter * 0.25), hs(pedestal_y)),
                (hs(x + diameter * 0.75), hs(pedestal_y)),
                (hs(x + diameter * 0.63), hs(min(height - 3, pedestal_y + diameter * 0.20))),
                (hs(x + diameter * 0.37), hs(min(height - 3, pedestal_y + diameter * 0.20))),
            ],
            fill=(50, 31, 11, 245),
            outline=GOLD_MID,
        )
        x += diameter + gap
    return finish(image, ctx.size)


def draw_reward_card(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    body = (5, 21, width - 6, height - 4)
    mask = rounded_mask(ctx.size, body, 13)
    paste_gradient(image, mask, (20, 16, 10, 250), (7, 7, 6, 252))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(body), radius=hs(13), outline=GOLD_MID, width=hs(2))
    draw.rounded_rectangle(hbox((10, 27, width - 11, height - 9)), radius=hs(8), outline=(222, 174, 84, 120), width=hs(1))
    cx = width / 2
    draw.polygon(
        [(hs(cx - 30), hs(24)), (hs(cx - 18), hs(8)), (hs(cx - 5), hs(21)), (hs(cx + 8), hs(6)), (hs(cx + 23), hs(22)), (hs(cx + 32), hs(11)), (hs(cx + 27), hs(32)), (hs(cx - 27), hs(32))],
        fill=(53, 33, 12, 255),
        outline=GOLD_HI,
    )
    return finish(image, ctx.size)


def draw_big_winner(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (2, 3, width - 3, height - 4)
    mask = rounded_mask(ctx.size, bounds, 15)
    paste_gradient(image, mask, (26, 18, 9, 252), (6, 6, 5, 252))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(15), outline=GOLD_MID, width=hs(2))
    draw.line((hs(18), hs(49), hs(width - 19), hs(49)), fill=(193, 139, 55, 130), width=hs(1))
    draw_centered_text(draw, (0, 5, width, 48), "最大赢家", 23, GOLD_HI, 1)
    # The large lower region remains unpatterned for dynamic winner data.
    return finish(image, ctx.size)


def draw_header_strip(ctx: Context, text: str) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (1, 3, width - 2, height - 4)
    mask = rounded_mask(ctx.size, bounds, min(10, height / 4))
    paste_gradient(image, mask, (23, 18, 10, 248), (7, 7, 6, 250))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(min(10, height / 4)), outline=GOLD_MID, width=hs(1))
    draw_centered_text(draw, bounds, text, max(15, min(22, round(height * 0.42))), GOLD_HI, 1)
    return finish(image, ctx.size)


def draw_report_content(ctx: Context) -> Image.Image:
    image = hi_canvas(ctx.size)
    width, height = ctx.size
    bounds = (2, 2, width - 3, height - 3)
    mask = rounded_mask(ctx.size, bounds, 9)
    paste_gradient(image, mask, (13, 12, 9, 235), (6, 6, 5, 240))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(hbox(bounds), radius=hs(9), outline=GOLD_MID, width=hs(1))
    return finish(image, ctx.size)


def draw_voice_frame(ctx: Context, level: int) -> Image.Image:
    image = hi_canvas(ctx.size)
    draw = ImageDraw.Draw(image)
    width, height = ctx.size
    cx = width / 2
    bottom = height - 6
    color = GOLD_HI
    # Large, stable microphone base shared by all four animation frames.
    draw.rounded_rectangle(hbox((cx - 7, bottom - 37, cx + 7, bottom - 15)), radius=hs(7), outline=color, width=hs(2.5))
    draw.arc(hbox((cx - 15, bottom - 28, cx + 15, bottom - 3)), 0, 180, fill=color, width=hs(2.5))
    draw.line((hs(cx), hs(bottom - 5), hs(cx), hs(bottom + 1)), fill=color, width=hs(2.5))
    draw.line((hs(cx - 9), hs(bottom + 1), hs(cx + 9), hs(bottom + 1)), fill=color, width=hs(2.5))
    # H1 has the microphone cap; H2/H3/H4 progressively add three arcs.
    arc_specs = [(18, bottom - 53, bottom - 25), (23, bottom - 68, bottom - 23), (27, bottom - 87, bottom - 20)]
    cap = (cx - 10, bottom - 48, cx + 10, bottom - 34)
    draw.arc(hbox(cap), 205, 335, fill=GOLD, width=hs(2))
    for radius, top, low in arc_specs[: max(0, level - 1)]:
        draw.arc(hbox((cx - radius, top, cx + radius, low)), 205, 335, fill=GOLD, width=hs(2.5))
    return finish(image, ctx.size)


def draw_voice_bubble(ctx: Context, level: int) -> Image.Image:
    image = hi_canvas(ctx.size)
    draw = ImageDraw.Draw(image)
    width, height = ctx.size
    body = (11, 4, width - 2, height - 5)
    mask = rounded_mask(ctx.size, body, 9)
    paste_gradient(image, mask, (22, 17, 9, 252), (7, 7, 6, 252))
    draw.rounded_rectangle(hbox(body), radius=hs(9), outline=GOLD_MID, width=hs(1.5))
    cy = height / 2
    draw.polygon([(hs(1), hs(cy)), (hs(12), hs(cy - 7)), (hs(12), hs(cy + 7))], fill=(12, 10, 7, 252), outline=GOLD_MID)
    sx = 34
    draw.ellipse(hbox((sx - 3, cy - 3, sx + 3, cy + 3)), fill=GOLD_HI)
    for index in range(level):
        radius = 8 + index * 7
        draw.arc(hbox((sx - radius, cy - radius, sx + radius, cy + radius)), 300, 60, fill=GOLD_HI, width=hs(2))
    return finish(image, ctx.size)


def apply_trim_and_anchors(ctx: Context, image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    if rgba.size != ctx.size:
        raise BuildError(f"渲染尺寸错误：{ctx.path} {rgba.size} != {ctx.size}")
    x0, y0, x1, y1 = ctx.trim
    alpha = rgba.getchannel("A")
    clipped = Image.new("L", ctx.size, 0)
    clipped.paste(alpha.crop(ctx.trim), (x0, y0))
    rgba.putalpha(clipped)
    pixels = rgba.load()
    for x, y in ((x0, y0), (x1 - 1, y0), (x0, y1 - 1), (x1 - 1, y1 - 1)):
        red, green, blue, old_alpha = pixels[x, y]
        pixels[x, y] = (red or 72, green or 44, blue or 16, max(old_alpha, ANCHOR_ALPHA))
    return rgba


def save_asset(relative: str, renderer: Renderer) -> Path:
    path = ROOT / relative
    ctx = context_for(path)
    rendered = apply_trim_and_anchors(ctx, renderer(ctx))
    if ctx.mode == "RGBA":
        final = rendered
    elif ctx.mode == "RGB":
        if ctx.trim != (0, 0, ctx.size[0], ctx.size[1]):
            raise BuildError(f"RGB 目标不能保持非全幅 trim：{path}")
        final = Image.new("RGB", ctx.size, BLACK[:3])
        final.paste(rendered.convert("RGB"), mask=rendered.getchannel("A"))
    elif ctx.mode == "P":
        # Pillow's RGBA FASTOCTREE quantizer writes a palette transparency
        # table, so transparent silhouettes and the low-alpha trim anchors are
        # retained while the legacy indexed-PNG mode remains unchanged.
        final = rendered.quantize(
            colors=256,
            method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.NONE,
        )
    else:
        raise BuildError(f"本修正脚本不支持目标模式 {ctx.mode}：{path}")
    final.save(path, format="PNG", optimize=True)
    with Image.open(path) as check:
        bbox = check.convert("RGBA").getchannel("A").getbbox()
        if check.size != ctx.size or check.mode != ctx.mode:
            raise BuildError(f"输出尺寸/模式变化：{path} {check.size}/{check.mode}")
        if bbox != ctx.trim:
            raise BuildError(f"输出 trim 变化：{path} {bbox} != {ctx.trim}")
    return path


def alpha_at(path: Path, point: tuple[int, int]) -> int:
    with Image.open(path) as image:
        return image.convert("RGBA").getpixel(point)[3]


def high_alpha_bbox(path: Path, threshold: int = 32) -> tuple[int, int, int, int] | None:
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        return alpha.point(lambda value: 255 if value >= threshold else 0).getbbox()


def structural_checks(paths: list[Path]) -> None:
    transparent_points = {
        "assets/ImagesLuck/公用/选择框.png": (63, 55),
        "assets/ImagesLuck/游戏内/桌面选中.png": (48, 38),
        "assets/ImagesLuck/游戏内/牌桌_0030_椭圆-1.png": (59, 82),
        "assets/imagesKK/公用/lg1.png": (32, 31),
        "assets/ImagesLuck/游戏内/zuoxia.png": (5, 5),
        "assets/resources/other/休或丢0.png": (5, 5),
        "assets/resources/other/自动休0.png": (5, 5),
        "assets/ImagesLuck/游戏内/e2.png": (5, 5),
    }
    for relative, point in transparent_points.items():
        path = ROOT / relative
        if alpha_at(path, point) > 8:
            raise BuildError(f"结构校验失败，中心应透明：{relative} @ {point}")

    for relative, safe in (
        ("assets/ImagesLuck/公用/取消.png", (152, 54)),
        ("assets/imagesKK/公用/确定.png", (152, 54)),
        ("assets/ImagesLuck/游戏内/解散房间.png", (216, 57)),
        ("assets/resources/other/观战.png", (46, 22)),
        ("assets/ImagesLuck/设置/关.png", (92, 39)),
        ("assets/ImagesLuck/设置/开.png", (92, 39)),
    ):
        bbox = high_alpha_bbox(ROOT / relative)
        if not bbox or bbox[2] - bbox[0] > safe[0] + 2 or bbox[3] - bbox[1] > safe[1] + 2:
            raise BuildError(f"RAW/TRIMMED 安全区超限：{relative} {bbox} > {safe}")

    for relative in (
        "assets/ImagesLuck/奖池/奖池-.png",
        "assets/ImagesLuck/奖池/奖池桌面数字背景.png",
    ):
        path = ROOT / relative
        with Image.open(path) as image:
            alpha = image.convert("RGBA").getchannel("A")
            coverage = sum(alpha.histogram()[17:]) / (alpha.width * alpha.height)
        if coverage >= 0.90:
            raise BuildError(f"奖池金额框透明边距不足：{relative} coverage={coverage:.3f}")

    rule_path = ROOT / "assets/imagesKK/公用/2.png"
    with Image.open(rule_path) as image:
        rgba = image.convert("RGBA")
        cyan_count = 0
        for y in range(round(rgba.height * 0.82), rgba.height):
            for x in range(rgba.width):
                red, green, blue, alpha = rgba.getpixel((x, y))
                cyan_count += int(
                    alpha > 16
                    and blue > 145
                    and green > 105
                    and blue > red * 1.35
                    and green > red * 1.15
                )
    if cyan_count:
        raise BuildError(f"牌型规则仍含旧青色像素：{cyan_count}")

    missing = [path for path in paths if not path.exists()]
    if missing:
        raise BuildError("输出缺失：" + ", ".join(str(path) for path in missing))


def build() -> list[Path]:
    jobs: list[tuple[str, Renderer]] = [
        # RAW/TRIMMED shared controls: visible core is deliberately smaller.
        ("assets/ImagesLuck/公用/取消.png", lambda ctx: draw_clean_button(ctx, "取消", (152, 54), False, 22)),
        ("assets/imagesKK/公用/确定.png", lambda ctx: draw_clean_button(ctx, "确定", (152, 54), True, 22)),
        ("assets/ImagesLuck/设置/关.png", lambda ctx: draw_toggle(ctx, False)),
        ("assets/ImagesLuck/设置/开.png", lambda ctx: draw_toggle(ctx, True)),

        # Popup and stretchable content backgrounds.
        ("assets/ImagesLuck/公用/弹框小.png", draw_popup),
        ("assets/ImagesLuck/公用/数值底框.png", draw_clean_field),
        ("assets/ImagesLuck/公用/标题底.png", draw_title_background),
        ("assets/ImagesLuck/公用/选择框.png", lambda ctx: draw_selection_frame(ctx, False)),
        ("assets/ImagesLuck/公用1/侧弹框.png", draw_side_panel),
        ("assets/ImagesLuck/游戏内/额外/下拉框.png", draw_popup),
        ("assets/imagesKK/公用/tishibg.png", draw_notice_strip),
        ("assets/ImagesXYPK/其他/内容框.png", draw_report_content),

        # Fixed labels plus quiet dynamic-value zones.
        ("assets/ImagesLuck/公用1/奖池框.png", draw_pool_value),
        ("assets/ImagesLuck/公用1/总代入.png", lambda ctx: draw_split_value(ctx, "总代入:", 92)),
        ("assets/ImagesLuck/公用1/总得分.png", lambda ctx: draw_split_value(ctx, "总得分:", 92)),
        ("assets/ImagesLuck/游戏内/frame_xiazhu.png", draw_clean_field),
        ("assets/ImagesLuck/游戏内/个人金币.png", draw_coin_field),
        ("assets/ImagesLuck/游戏内/底皮.png", lambda ctx: draw_split_value(ctx, "皮池", 75)),
        ("assets/ImagesLuck/游戏内/芒果条.png", lambda ctx: draw_split_value(ctx, "芒果", 82)),
        ("assets/ImagesLuck/游戏内/diban_shuzi.png", draw_score_bubble),
        ("assets/ImagesLuck/游戏内/分牌背景.png", draw_card_slot),

        # Titles and selector bars retain their non-button roles.
        ("assets/ImagesLuck/游戏内/实时战绩.png", lambda ctx: draw_light_title(ctx, "实时战绩")),
        ("assets/ImagesLuck/游戏内/额外/选择桌面.png", lambda ctx: draw_selector_bar(ctx, "选择桌面")),
        ("assets/ImagesLuck/游戏内/额外/选择牌面.png", lambda ctx: draw_selector_bar(ctx, "选择牌背")),
        ("assets/ImagesLuck/游戏内/桌面选中.png", lambda ctx: draw_selection_frame(ctx, True)),
        ("assets/ImagesLuck/游戏内/牌桌_0030_椭圆-1.png", lambda ctx: draw_selection_frame(ctx, True)),

        # Voice animation, speech bubbles and slider.
        ("assets/ImagesLuck/游戏内/H1.png", lambda ctx: draw_voice_frame(ctx, 1)),
        ("assets/ImagesLuck/游戏内/H2.png", lambda ctx: draw_voice_frame(ctx, 2)),
        ("assets/ImagesLuck/游戏内/H3.png", lambda ctx: draw_voice_frame(ctx, 3)),
        ("assets/ImagesLuck/游戏内/H4.png", lambda ctx: draw_voice_frame(ctx, 4)),
        ("assets/ImagesLuck/游戏内/btn_yuyin.png", lambda ctx: draw_voice_frame(ctx, 1)),
        ("assets/imagesKK/公用/yuyintiao1_zuo.png", lambda ctx: draw_voice_bubble(ctx, 1)),
        ("assets/imagesKK/公用/yuyintiao2_zuo.png", lambda ctx: draw_voice_bubble(ctx, 2)),
        ("assets/imagesKK/公用/yuyintiao3_zuo.png", lambda ctx: draw_voice_bubble(ctx, 3)),
        ("assets/imagesKK/公用/lg1.png", draw_star_outline),
        ("assets/imagesKK/公用/lg2.png", draw_slider_track),

        # Connected jackpot tabs and transparent digit wells.
        ("assets/ImagesLuck/奖池/1.png", lambda ctx: draw_connected_tab(ctx, "奖池总览", "left", True)),
        ("assets/ImagesLuck/奖池/2.png", lambda ctx: draw_connected_tab(ctx, "奖池", "middle", True)),
        ("assets/ImagesLuck/奖池/3.png", lambda ctx: draw_connected_tab(ctx, "奖池记录", "right", True)),
        ("assets/ImagesLuck/奖池/4.png", lambda ctx: draw_connected_tab(ctx, "奖池总览", "left", False)),
        ("assets/ImagesLuck/奖池/5.png", lambda ctx: draw_connected_tab(ctx, "奖池", "middle", False)),
        ("assets/ImagesLuck/奖池/6.png", lambda ctx: draw_connected_tab(ctx, "奖池记录", "right", False)),
        ("assets/ImagesLuck/奖池/奖池-.png", draw_jackpot_amount_strip),
        ("assets/ImagesLuck/奖池/奖池桌面数字背景.png", draw_small_jackpot_amount_strip),
        ("assets/ImagesLuck/奖池/圆角矩形.png", draw_reward_card),
        ("assets/ImagesLuck/奖池/当前奖金.png", lambda ctx: draw_header_strip(ctx, "当前奖池记录")),
        ("assets/ImagesLuck/奖池/最大赢家.png", draw_big_winner),
        ("assets/ImagesLuck/奖池/框.png", draw_clean_field),

        # Buttons use one outer metal rim and one inner hairline only.
        ("assets/ImagesLuck/公用1/充值.png", lambda ctx: draw_clean_button(ctx, "充值", None, True, 20)),
        ("assets/ImagesLuck/游戏内/回座.png", lambda ctx: draw_clean_button(ctx, "回座", None, True, 21)),
        ("assets/ImagesLuck/游戏内/牌型展示.png", lambda ctx: draw_clean_button(ctx, "牌型展示", None, True, 20)),
        ("assets/ImagesLuck/游戏内/牌局设置.png", lambda ctx: draw_clean_button(ctx, "牌局设置", None, True, 20)),
        ("assets/ImagesLuck/游戏内/留座离桌.png", lambda ctx: draw_clean_button(ctx, "留座离桌", None, True, 20)),
        ("assets/ImagesLuck/游戏内/确认分牌.png", lambda ctx: draw_clean_button(ctx, "确认分牌", None, True, 19)),
        ("assets/ImagesLuck/游戏内/站起围观.png", lambda ctx: draw_clean_button(ctx, "站起围观", None, True, 20)),
        ("assets/ImagesLuck/游戏内/补充钵钵.png", lambda ctx: draw_clean_button(ctx, "补充钵钵", None, True, 20)),
        ("assets/ImagesLuck/游戏内/解散房间.png", lambda ctx: draw_clean_button(ctx, "解散房间", (216, 57), False, 20)),
        ("assets/ImagesLuck/游戏内/退出房间.png", lambda ctx: draw_clean_button(ctx, "退出房间", None, False, 20)),
        ("assets/ImagesLuck/游戏内/闹钟.png", lambda ctx: tint_existing_alpha(ctx, GOLD_HI)),
        ("assets/ImagesLuck/游戏内/zuoxia.png", lambda ctx: draw_round_action(ctx, "空位", True, (88, 88), 21)),
        ("assets/resources/other/休或丢0.png", lambda ctx: draw_round_action(ctx, "丢或休", False, (100, 100), 21)),
        ("assets/resources/other/休或丢1.png", lambda ctx: draw_round_action(ctx, "丢或休", True, (100, 100), 21)),
        ("assets/resources/other/自动休0.png", lambda ctx: draw_round_action(ctx, "自动\n休牌", False, (100, 100), 20)),
        ("assets/resources/other/自动休1.png", lambda ctx: draw_round_action(ctx, "自动\n休牌", True, (100, 100), 20)),
        ("assets/ImagesLuck/游戏内/e1.png", lambda ctx: draw_round_action(ctx, "强制\n秀牌", True, (100, 100), 19)),
        ("assets/ImagesLuck/游戏内/e2.png", lambda ctx: draw_round_action(ctx, "看剩\n余牌", False, (100, 100), 19)),
        ("assets/resources/other/观战.png", draw_observer_badge),
        ("assets/ImagesLuck/游戏内/btn_da.png", lambda ctx: draw_round_action(ctx, "大", True, (103, 103), 28)),
        ("assets/ImagesLuck/游戏内/2.png", lambda ctx: draw_round_action(ctx, "", True, (94, 94), 22)),
        ("assets/ImagesLuck/游戏内/3.png", lambda ctx: draw_round_action(ctx, "", True, (94, 94), 22)),
        ("assets/ImagesLuck/游戏内/4.png", lambda ctx: draw_round_action(ctx, "", True, (94, 94), 22)),
        ("assets/imagesKK/公用/2.png", recolor_lower_cyan_to_gold),
        ("assets/ImagesXYPK/其他/举报.png", lambda ctx: draw_clean_button(ctx, "举报", None, False, 14)),
        ("assets/ImagesXYPK/其他/确定举报.png", lambda ctx: draw_clean_button(ctx, "确定举报", None, True, 23)),
    ]

    outputs = [save_asset(relative, renderer) for relative, renderer in jobs]
    structural_checks(outputs)
    return outputs


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-determinism",
        action="store_true",
        help="连续构建两次并比较所有输出 SHA-256",
    )
    args = parser.parse_args()

    outputs = build()
    if args.verify_determinism:
        first = {path: digest(path) for path in outputs}
        second_outputs = build()
        second = {path: digest(path) for path in second_outputs}
        changed = [path for path in outputs if first[path] != second[path]]
        if changed:
            raise BuildError("重复构建不确定：" + ", ".join(str(path) for path in changed))
        print("重复构建 SHA-256 一致")

    print(f"已修正 {len(outputs)} 张 drh8 弹层/控件 PNG")
    for path in outputs:
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
