#!/usr/bin/env python3
"""Deterministically rebuild the legacy-blue drh8 art in the Qin black-gold skin.

The script only overwrites raster art.  It deliberately does not touch the drh8
scene, prefabs, meta files, playing-card faces, table backgrounds, card backs or
DragonBones atlases.  Every output keeps the existing pixel size, image mode and
visible-alpha bounds so Cocos Creator 2.4.13 can keep the current UUIDs and trim
data.
"""

from __future__ import annotations

import colorsys
import math
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFilter, ImageFont

import generate_qin_drh8_panel_fix as panel_fix


ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
ART = ROOT / "art_sources" / "drh8"
ACTION_BUTTON_SOURCE = ART / "qin_action_button_source.png"
S = 3

GOLD_HI = (255, 239, 184, 255)
GOLD = (219, 165, 73, 255)
GOLD_MID = (155, 94, 28, 255)
GOLD_DARK = (70, 39, 12, 255)
IVORY = (239, 226, 192, 255)
MUTED = (139, 124, 94, 255)
BLACK = (5, 6, 5, 255)
LACQUER = (11, 10, 8, 250)
RED = (111, 29, 22, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), max(1, size * S))


def canvas(size: tuple[int, int], fill=(0, 0, 0, 0)) -> Image.Image:
    return Image.new("RGBA", (size[0] * S, size[1] * S), fill)


def box(size: tuple[int, int]) -> tuple[int, int, int, int]:
    return (0, 0, size[0] * S, size[1] * S)


def text_center(
    draw: ImageDraw.ImageDraw,
    bounds: tuple[float, float, float, float],
    text: str,
    size: int,
    fill=GOLD_HI,
    stroke: int = 1,
    spacing: int = 1,
) -> None:
    f = font(size)
    lines = text.split("\n")
    widths: list[float] = []
    heights: list[float] = []
    for line in lines:
        bb = draw.textbbox((0, 0), line, font=f, stroke_width=stroke * S)
        widths.append(bb[2] - bb[0])
        heights.append(bb[3] - bb[1])
    total_h = sum(heights) + max(0, len(lines) - 1) * spacing * S
    cy = (bounds[1] + bounds[3] - total_h) / 2
    for line, width, height in zip(lines, widths, heights):
        x = (bounds[0] + bounds[2] - width) / 2
        draw.text(
            (x, cy),
            line,
            font=f,
            fill=fill,
            stroke_width=stroke * S,
            stroke_fill=(35, 20, 7, 235),
        )
        cy += height + spacing * S


def add_corner_diamonds(draw: ImageDraw.ImageDraw, size: tuple[int, int], inset=8) -> None:
    w, h = size[0] * S, size[1] * S
    r = max(2, min(size) // 18) * S
    for cx, cy in ((inset * S, h // 2), (w - inset * S, h // 2)):
        draw.polygon(((cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)),
                     outline=GOLD_MID, fill=(32, 20, 9, 225))
        draw.polygon(((cx, cy - r // 2), (cx + r // 2, cy),
                      (cx, cy + r // 2), (cx - r // 2, cy)), fill=GOLD)


def lacquer_panel(size: tuple[int, int], radius: int | None = None,
                  selected: bool = False, transparent=True) -> Image.Image:
    w, h = size
    im = canvas(size, (0, 0, 0, 0) if transparent else BLACK)
    d = ImageDraw.Draw(im)
    r = max(3, min(18, min(w, h) // 4)) if radius is None else radius
    outer = (1 * S, 1 * S, (w - 1) * S - 1, (h - 1) * S - 1)
    d.rounded_rectangle(outer, radius=r * S, fill=(5, 5, 4, 247),
                        outline=GOLD_DARK, width=max(S, 2 * S))
    if w >= 18 and h >= 18:
        d.rounded_rectangle((5 * S, 5 * S, (w - 5) * S, (h - 5) * S),
                            radius=max(1, r - 3) * S,
                            fill=(12, 10, 7, 242),
                            outline=GOLD_HI if selected else GOLD_MID,
                            width=S)
        d.rounded_rectangle((8 * S, 8 * S, (w - 8) * S, (h - 8) * S),
                            radius=max(1, r - 6) * S,
                            outline=(82, 55, 25, 185), width=S)
    # restrained brushed-lacquer sheen; no noisy repeating pattern
    for y in range(max(2, h // 4), min(h - 2, h * 3 // 4), max(5, h // 9)):
        d.line((10 * S, y * S, (w - 10) * S, y * S), fill=(255, 222, 148, 9), width=S)
    if selected and h > 16:
        d.line((18 * S, (h - 7) * S, (w - 18) * S, (h - 7) * S),
               fill=GOLD_HI, width=2 * S)
    return im


def pill(size: tuple[int, int], text: str, selected=False, muted=False,
         font_size: int | None = None, corner=True) -> Image.Image:
    im = lacquer_panel(size, radius=max(4, min(size) // 3), selected=selected)
    d = ImageDraw.Draw(im)
    if corner and size[0] > 70:
        add_corner_diamonds(d, size, max(7, min(14, size[0] // 14)))
    fs = font_size or max(12, min(25, int(size[1] * 0.4)))
    text_center(d, box(size), text, fs, MUTED if muted else GOLD_HI, 1)
    return im


def label_text(size: tuple[int, int], text: str, font_size: int | None = None,
               lines=False) -> Image.Image:
    im = canvas(size)
    d = ImageDraw.Draw(im)
    fs = font_size or max(12, min(24, int(size[1] * 0.62)))
    if lines and size[0] > 80:
        cy = size[1] * S // 2
        span = max(12, size[0] // 8) * S
        d.line((2 * S, cy, span, cy), fill=GOLD_MID, width=S)
        d.line(((size[0] * S - span), cy, (size[0] - 2) * S, cy), fill=GOLD_MID, width=S)
    text_center(d, box(size), text, fs, GOLD_HI, 1)
    return im


def action_button(size: tuple[int, int], text: str, selected=True,
                  accent=GOLD_MID, font_size: int = 28) -> Image.Image:
    w, h = size
    im = canvas(size)
    cx, cy = w * S // 2, h * S // 2
    if not ACTION_BUTTON_SOURCE.exists():
        raise FileNotFoundError(f"missing action button source: {ACTION_BUTTON_SOURCE}")
    base = Image.open(ACTION_BUTTON_SOURCE).convert("RGBA")
    bbox_alpha = base.getchannel("A").getbbox()
    if not bbox_alpha:
        raise ValueError(f"empty action button source: {ACTION_BUTTON_SOURCE}")
    base = base.crop(bbox_alpha)
    diameter = int(min(w, h) * .94 * S)
    base = base.resize((diameter, diameter), Image.Resampling.LANCZOS)
    if not selected:
        veil = Image.new("RGBA", base.size, (20, 20, 18, 105))
        base = Image.alpha_composite(base, veil)
    im.alpha_composite(base, (cx - diameter // 2, cy - diameter // 2))
    d = ImageDraw.Draw(im)
    text_center(d, (cx-diameter*.31, cy-diameter*.31,
                    cx+diameter*.31, cy+diameter*.31), text, font_size,
                GOLD_HI if selected else IVORY, 1, 0)
    return im


def icon_disc(size: tuple[int, int], kind: str) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S//2, h*S//2
    r = int(min(w, h) * .39 * S)
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(7, 7, 6, 248),
              outline=GOLD_DARK, width=4*S)
    d.ellipse((cx-r+4*S, cy-r+4*S, cx+r-4*S, cy+r-4*S),
              outline=GOLD_HI, width=S)
    c = GOLD_HI
    lw = max(S, 2*S)
    if kind == "mic":
        d.rounded_rectangle((cx-6*S, cy-15*S, cx+6*S, cy+5*S), 6*S,
                            outline=c, width=lw)
        d.arc((cx-13*S, cy-4*S, cx+13*S, cy+17*S), 0, 180, fill=c, width=lw)
        d.line((cx, cy+13*S, cx, cy+21*S), fill=c, width=lw)
        d.line((cx-8*S, cy+21*S, cx+8*S, cy+21*S), fill=c, width=lw)
    elif kind == "grid":
        for yy in (-10, 5):
            for xx in (-10, 5):
                d.rounded_rectangle((cx+xx*S, cy+yy*S, cx+(xx+8)*S, cy+(yy+8)*S),
                                    2*S, outline=c, width=lw)
    elif kind == "record":
        d.rounded_rectangle((cx-14*S, cy-17*S, cx+14*S, cy+16*S), 3*S,
                            outline=c, width=lw)
        d.line((cx-8*S, cy-8*S, cx+8*S, cy-8*S), fill=c, width=lw)
        d.line((cx-8*S, cy, cx+8*S, cy), fill=c, width=lw)
        d.line((cx-8*S, cy+8*S, cx+3*S, cy+8*S), fill=c, width=lw)
    elif kind == "info":
        d.rounded_rectangle((cx-13*S, cy-17*S, cx+13*S, cy+16*S), 3*S,
                            outline=c, width=lw)
        text_center(d, (cx-11*S, cy-15*S, cx+11*S, cy+14*S), "?", 23, c, 1)
    elif kind == "chat":
        d.ellipse((cx-15*S, cy-14*S, cx+15*S, cy+11*S), outline=c, width=lw)
        d.polygon(((cx-3*S, cy+10*S), (cx+2*S, cy+19*S), (cx+7*S, cy+9*S)), fill=c)
        d.ellipse((cx-8*S, cy-4*S, cx-4*S, cy), fill=c)
        d.ellipse((cx+4*S, cy-4*S, cx+8*S, cy), fill=c)
        d.arc((cx-8*S, cy-1*S, cx+8*S, cy+7*S), 15, 165, fill=c, width=lw)
    return im


def star_icon(size: tuple[int, int]) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S/2, h*S/2
    ro, ri = min(w, h)*.42*S, min(w, h)*.19*S
    pts = []
    for i in range(10):
        angle = math.radians(-90+i*36)
        r = ro if i % 2 == 0 else ri
        pts.append((cx+math.cos(angle)*r, cy+math.sin(angle)*r))
    d.polygon(pts, fill=(36, 23, 9, 255), outline=GOLD_HI)
    d.line(pts+[pts[0]], fill=GOLD_MID, width=2*S, joint="curve")
    return im


def warning_icon(size: tuple[int, int]) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    d.polygon(((w*S/2, 2*S), ((w-2)*S, (h-2)*S), (2*S, (h-2)*S)),
              fill=(37, 23, 8, 255), outline=GOLD_HI)
    text_center(d, (2*S, 2*S, (w-2)*S, (h-2)*S), "!", max(10, int(h*.58)), GOLD_HI, 1)
    return im


def qin_seal(size: tuple[int, int]) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S//2, h*S//2
    r = int(min(w, h) * .39 * S)
    d.ellipse((cx-r-4*S, cy-r-4*S, cx+r+4*S, cy+r+4*S),
              fill=(0, 0, 0, 130), outline=GOLD_DARK, width=4*S)
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(8, 7, 5, 250),
              outline=GOLD_HI, width=2*S)
    d.ellipse((cx-r+5*S, cy-r+5*S, cx+r-5*S, cy+r-5*S),
              outline=GOLD_MID, width=S)
    text_center(d, (cx-r, cy-r-2*S, cx+r, cy+r), "秦", max(20, int(min(w,h)*.45)), GOLD_HI, 1)
    return im


def card_icon(size: tuple[int, int]) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    for dx, dy, ang in ((7, 5, -7), (17, 1, 7)):
        layer = canvas((max(20, w-20), max(28, h-10)))
        ld = ImageDraw.Draw(layer)
        lw, lh = layer.size
        ld.rounded_rectangle((2*S, 2*S, (lw//S-2)*S, (lh//S-2)*S), 4*S,
                             fill=(8, 7, 5, 255), outline=GOLD_HI, width=2*S)
        ld.ellipse((lw//2-8*S, lh//2-8*S, lw//2+8*S, lh//2+8*S), outline=GOLD_MID, width=S)
        text_center(ld, (lw//2-8*S, lh//2-8*S, lw//2+8*S, lh//2+8*S), "秦", 11, GOLD_HI, 1)
        layer = layer.rotate(ang, resample=Image.Resampling.BICUBIC, expand=True)
        im.alpha_composite(layer, (dx*S, dy*S))
    return im


def voice_frame(size: tuple[int, int], level: int) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx = w*S//2
    base = int(h*.82*S)
    c = GOLD_HI
    d.rounded_rectangle((cx-6*S, base-26*S, cx+6*S, base-7*S), 6*S,
                        outline=c, width=2*S)
    d.arc((cx-13*S, base-17*S, cx+13*S, base+2*S), 0, 180, fill=c, width=2*S)
    d.line((cx, base-1*S, cx, base+8*S), fill=c, width=2*S)
    d.line((cx-8*S, base+8*S, cx+8*S, base+8*S), fill=c, width=2*S)
    for n in range(level):
        pad = (15 + n*6)*S
        top = base-(31+n*9)*S
        d.arc((cx-pad, top, cx+pad, base+5*S), 205, 335,
              fill=(GOLD[0], GOLD[1], GOLD[2], max(100, 230-n*30)), width=2*S)
    return im


def voice_bubble(size: tuple[int, int], level: int) -> Image.Image:
    im = lacquer_panel(size, radius=max(5, size[1]//3), selected=False)
    d = ImageDraw.Draw(im)
    h = size[1]
    d.polygon(((5*S, h*S//2), (14*S, (h//2-6)*S), (14*S, (h//2+6)*S)), fill=GOLD_MID)
    x0 = 25*S
    for i in range(3):
        height = (8 + i*5) * S
        alpha = 255 if i < level else 70
        d.rounded_rectangle((x0+i*13*S, h*S//2-height//2,
                             x0+(i*13+5)*S, h*S//2+height//2), 2*S,
                            fill=(GOLD_HI[0], GOLD_HI[1], GOLD_HI[2], alpha))
    return im


def table_swatch(size: tuple[int, int], accent: tuple[int, int, int]) -> Image.Image:
    im = lacquer_panel(size, radius=max(8, size[0]//3), selected=False)
    d = ImageDraw.Draw(im)
    w, h = size
    d.rounded_rectangle((12*S, 12*S, (w-12)*S, (h-12)*S), 24*S,
                        fill=(*accent, 205), outline=GOLD_MID, width=2*S)
    d.rounded_rectangle((18*S, 18*S, (w-18)*S, (h-18)*S), 20*S,
                        outline=(*tuple(min(255, c+45) for c in accent), 190), width=S)
    # A faint Qin seal keeps all five options in the same product family.
    text_center(d, (16*S, 22*S, (w-16)*S, (h-20)*S), "秦", 22,
                (236, 207, 143, 100), 0)
    return im


def recolor_neon_to_gold(source: Image.Image) -> Image.Image:
    """Preserve semantic pixels while replacing blue/green/purple neon hues."""
    rgba = source.convert("RGBA")
    out = Image.new("RGBA", rgba.size)
    src = rgba.load()
    dst = out.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            h, sat, val = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            deg = h*360
            legacy = sat > .20 and ((62 <= deg <= 270) or (274 <= deg <= 345))
            if legacy:
                # Dark neon becomes lacquer; lit neon becomes warm metal.
                if val < .20:
                    nr, ng, nb = (10, 8, 5)
                else:
                    nv = .28 + .70*val
                    ns = min(.78, .46 + .30*sat)
                    nr, ng, nb = colorsys.hsv_to_rgb(39/360, ns, min(1, nv))
                    nr, ng, nb = int(nr*255), int(ng*255), int(nb*255)
                dst[x, y] = (nr, ng, nb, a)
            elif sat < .16 and val > .70:
                # Cool white labels become ivory without changing their glyphs.
                k = .78 + .22*val
                dst[x, y] = (int(242*k), int(229*k), int(193*k), a)
            else:
                dst[x, y] = (r, g, b, a)
    return out


def constrain_to_reference(reference: Image.Image, generated: Image.Image) -> Image.Image:
    size = reference.size
    rgba = generated.convert("RGBA")
    if rgba.size != size:
        rgba = rgba.resize(size, Image.Resampling.LANCZOS)
    old_bbox = reference.convert("RGBA").getchannel("A").getbbox()
    if old_bbox is None:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    new_bbox = rgba.getchannel("A").getbbox()
    if new_bbox != old_bbox:
        if new_bbox is None:
            crop = Image.new("RGBA", (old_bbox[2]-old_bbox[0], old_bbox[3]-old_bbox[1]), (8, 7, 5, 255))
        else:
            crop = rgba.crop(new_bbox).resize((old_bbox[2]-old_bbox[0], old_bbox[3]-old_bbox[1]),
                                                Image.Resampling.LANCZOS)
        fixed = Image.new("RGBA", size, (0, 0, 0, 0))
        fixed.alpha_composite(crop, (old_bbox[0], old_bbox[1]))
        rgba = fixed
    # One nearly transparent pixel at each extreme prevents an antialiasing
    # implementation change from altering Creator's historical trim rectangle.
    px = rgba.load()
    for x, y in ((old_bbox[0], old_bbox[1]), (old_bbox[2]-1, old_bbox[1]),
                 (old_bbox[0], old_bbox[3]-1), (old_bbox[2]-1, old_bbox[3]-1)):
        r, g, b, a = px[x, y]
        if a == 0:
            px[x, y] = (26, 17, 7, 1)
    return rgba


def save_asset(relative: str, render: Image.Image | Callable[[tuple[int, int]], Image.Image]) -> Path:
    path = ROOT / relative
    reference = Image.open(path)
    original_size = reference.size
    original_mode = reference.mode
    original_bbox = reference.convert("RGBA").getchannel("A").getbbox()
    image = render(original_size) if callable(render) else render
    image = constrain_to_reference(reference, image)
    if original_mode == "RGB":
        final = Image.new("RGB", original_size, BLACK[:3])
        final.paste(image, mask=image.getchannel("A"))
    elif original_mode == "P":
        final = image.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
    else:
        final = image.convert(original_mode)
    final.save(path, optimize=True)
    check = Image.open(path)
    assert check.size == original_size, (path, check.size, original_size)
    assert check.mode == original_mode, (path, check.mode, original_mode)
    assert check.convert("RGBA").getchannel("A").getbbox() == original_bbox, (
        path, check.convert("RGBA").getchannel("A").getbbox(), original_bbox)
    return path


def draw_bottom_pool(size: tuple[int, int], multiple: str) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S//2, h*S//2
    r = min(w, h)*S//2 - 4*S
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(5, 6, 5, 248), outline=GOLD_DARK, width=4*S)
    d.ellipse((cx-r+5*S, cy-r+5*S, cx+r-5*S, cy+r-5*S), outline=GOLD_HI, width=2*S)
    d.ellipse((cx-r+10*S, cy-r+10*S, cx+r-10*S, cy+r-10*S), fill=(21, 14, 7, 240), outline=GOLD_MID, width=S)
    text_center(d, (0, 18*S, w*S, 54*S), "底池", 19, GOLD_HI, 1)
    text_center(d, (0, 48*S, w*S, 89*S), multiple, 23, IVORY, 1)
    return im


def draw_simple_frame(size: tuple[int, int]) -> Image.Image:
    return lacquer_panel(size, radius=max(4, min(size)//6), selected=False)


def draw_check_frame(size: tuple[int, int]) -> Image.Image:
    im = lacquer_panel(size, radius=max(5, min(size)//5), selected=True)
    d = ImageDraw.Draw(im)
    w, h = size
    d.line((w*.34*S, h*.49*S, w*.46*S, h*.61*S), fill=GOLD_HI, width=4*S)
    d.line((w*.46*S, h*.61*S, w*.68*S, h*.34*S), fill=GOLD_HI, width=4*S)
    return im


def draw_jackpot_tab(size: tuple[int, int], text: str, selected: bool) -> Image.Image:
    return pill(size, text, selected=selected, muted=not selected, font_size=20, corner=False)


def draw_jackpot_digits_bg(size: tuple[int, int]) -> Image.Image:
    im = canvas(size)
    d = ImageDraw.Draw(im)
    w, h = size
    d.rounded_rectangle((1*S, 12*S, (w-1)*S, (h-2)*S), 18*S,
                        fill=(5, 5, 4, 246), outline=GOLD_DARK, width=4*S)
    d.rounded_rectangle((6*S, 17*S, (w-6)*S, (h-7)*S), 14*S,
                        outline=GOLD_HI, width=S)
    count = 7 if w > 300 else 6
    gap = 5*S
    slot_w = (w*S - 30*S - (count-1)*gap)//count
    x = 15*S
    for _ in range(count):
        d.ellipse((x, 22*S, x+slot_w, min((h-11)*S, 22*S+slot_w)),
                  fill=(13, 10, 6, 255), outline=GOLD_MID, width=2*S)
        d.arc((x+4*S, 26*S, x+slot_w-4*S, min((h-15)*S, 18*S+slot_w)),
              205, 330, fill=GOLD_HI, width=S)
        x += slot_w + gap
    return im


def draw_jackpot_card(size: tuple[int, int]) -> Image.Image:
    im = lacquer_panel(size, radius=14, selected=False)
    d = ImageDraw.Draw(im)
    w, h = size
    # Qin crown instead of the former poker-card crown.
    cx = w*S//2
    d.polygon(((cx-34*S, 22*S), (cx-20*S, 7*S), (cx-5*S, 20*S),
               (cx+9*S, 5*S), (cx+25*S, 22*S), (cx+35*S, 12*S),
               (cx+31*S, 34*S), (cx-31*S, 34*S)),
              fill=(45, 28, 10, 255), outline=GOLD_HI)
    d.line((cx-31*S, 38*S, cx+31*S, 38*S), fill=GOLD_MID, width=2*S)
    return im


def draw_big_winner(size: tuple[int, int]) -> Image.Image:
    im = lacquer_panel(size, radius=15, selected=True)
    d = ImageDraw.Draw(im)
    w, h = size
    cx = w*S//2
    d.polygon(((cx-28*S, 39*S), (cx-15*S, 20*S), (cx, 36*S),
               (cx+16*S, 17*S), (cx+31*S, 39*S), (cx+39*S, 25*S),
               (cx+34*S, 53*S), (cx-34*S, 53*S)),
              fill=(53, 32, 11, 255), outline=GOLD_HI)
    text_center(d, (0, 45*S, w*S, (h-12)*S), "最大赢家", 28, GOLD_HI, 1)
    return im


def draw_report_content(size: tuple[int, int]) -> Image.Image:
    im = lacquer_panel(size, radius=10, selected=False)
    d = ImageDraw.Draw(im)
    w, h = size
    d.rounded_rectangle((12*S, 12*S, (w-12)*S, (h-12)*S), 7*S,
                        fill=(4, 4, 3, 190), outline=(108, 73, 33, 180), width=S)
    return im


def draw_turntable_button(size: tuple[int, int], enabled: bool) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S//2, h*S//2
    r = min(w, h)*S//2 - 5*S
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(7, 6, 5, 255),
              outline=GOLD_DARK if enabled else (75, 70, 61, 255), width=5*S)
    d.ellipse((cx-r+6*S, cy-r+6*S, cx+r-6*S, cy+r-6*S),
              fill=(57, 34, 10, 255) if enabled else (34, 34, 31, 255),
              outline=GOLD_HI if enabled else (151, 145, 132, 255), width=2*S)
    text_center(d, (cx-r, cy-r, cx+r, cy+r), "秦", 38,
                GOLD_HI if enabled else IVORY, 1)
    return im


def draw_turntable(size: tuple[int, int], enabled: bool) -> Image.Image:
    w, h = size
    im = canvas(size)
    wheel = canvas(size)
    d = ImageDraw.Draw(wheel)
    cx, cy = w*S//2, int(h*.49*S)
    r = int(min(w*.36, h*.42)*S)
    colors_on = ((43, 26, 9, 255), (12, 10, 7, 255))
    colors_off = ((55, 54, 50, 255), (24, 24, 22, 255))
    colors = colors_on if enabled else colors_off
    for i in range(12):
        a0 = -90 + i*30
        a1 = a0 + 30
        pts = [(cx, cy)]
        for deg in range(a0, a1+1, 3):
            rad = math.radians(deg)
            pts.append((cx+math.cos(rad)*r, cy+math.sin(rad)*r))
        d.polygon(pts, fill=colors[i % 2], outline=GOLD_MID if enabled else (108, 105, 96, 255))
    d.ellipse((cx-r-18*S, cy-r-18*S, cx+r+18*S, cy+r+18*S),
              outline=GOLD_DARK if enabled else (80, 78, 72, 255), width=10*S)
    d.ellipse((cx-r-8*S, cy-r-8*S, cx+r+8*S, cy+r+8*S),
              outline=GOLD_HI if enabled else (175, 169, 153, 255), width=3*S)
    d.ellipse((cx-42*S, cy-42*S, cx+42*S, cy+42*S),
              fill=(6, 6, 5, 255), outline=GOLD_HI if enabled else MUTED, width=3*S)
    text_center(d, (cx-37*S, cy-37*S, cx+37*S, cy+37*S), "秦", 36,
                GOLD_HI if enabled else IVORY, 1)
    for i in range(12):
        a = math.radians(-90+i*30)
        px, py = cx+math.cos(a)*(r+14*S), cy+math.sin(a)*(r+14*S)
        d.ellipse((px-5*S, py-5*S, px+5*S, py+5*S),
                  fill=GOLD_HI if enabled else (182, 177, 164, 255), outline=GOLD_DARK)
    return wheel


def draw_turntable_icon(size: tuple[int, int]) -> Image.Image:
    w, h = size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = w*S//2, 32*S
    r = min(26, w//3)*S
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(16, 10, 5, 255), outline=GOLD_HI, width=2*S)
    for i in range(8):
        a = math.radians(i*45)
        d.line((cx, cy, cx+math.cos(a)*r, cy+math.sin(a)*r), fill=GOLD_MID, width=S)
    d.ellipse((cx-5*S, cy-5*S, cx+5*S, cy+5*S), fill=GOLD_HI)
    text_center(d, (0, 57*S, w*S, h*S), "幸运转盘", 14, GOLD_HI, 1)
    return im


def build_style_source() -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    size = (1200, 560)
    im = Image.new("RGB", size, (5, 5, 4))
    d = ImageDraw.Draw(im)
    for y in range(size[1]):
        c = int(5 + 7*y/size[1])
        d.line((0, y, size[0], y), fill=(c, max(4, c-1), max(3, c-3)))
    title_font = ImageFont.truetype(str(FONT), 44)
    d.text((54, 35), "秦 · 牌桌黑金美术基准", font=title_font, fill=GOLD_HI[:3])
    d.line((55, 95, 1145, 95), fill=GOLD_MID[:3], width=2)
    samples = [
        (pill((260, 74), "牌局设置", True, font_size=25), (65, 150)),
        (action_button((120, 132), "跟", True), (365, 128)),
        (qin_seal((150, 110)), (535, 143)),
        (draw_jackpot_digits_bg((390, 112)), (735, 140)),
        (table_swatch((97, 179), (21, 61, 84)), (80, 330)),
        (draw_big_winner((511, 137)).resize((420, 113), Image.Resampling.LANCZOS), (260, 354)),
        (draw_turntable_button((114, 114), True), (780, 354)),
    ]
    for sample, pos in samples:
        sample = sample.resize((sample.width//S, sample.height//S), Image.Resampling.LANCZOS)
        im.paste(sample, pos, sample)
    path = ART / "qin_drh8_style_source.png"
    im.save(path, optimize=True)
    return path


def build_preview(paths: list[Path]) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    selected = [p for p in paths if p.suffix.lower() == ".png"]
    cols, cw, ch = 5, 260, 190
    rows = math.ceil(len(selected) / cols)
    sheet = Image.new("RGB", (cols*cw, rows*ch), (27, 27, 25))
    d = ImageDraw.Draw(sheet)
    label_font = ImageFont.truetype(str(FONT), 14)
    for i, path in enumerate(selected):
        x, y = (i % cols)*cw, (i // cols)*ch
        tile = Image.new("RGBA", (cw-14, ch-42), (8, 8, 7, 255))
        im = Image.open(path).convert("RGBA")
        im.thumbnail((cw-24, ch-52), Image.Resampling.LANCZOS)
        tile.alpha_composite(im, ((tile.width-im.width)//2, (tile.height-im.height)//2))
        sheet.paste(tile.convert("RGB"), (x+7, y+6))
        d.text((x+8, y+ch-30), path.name, font=label_font, fill=GOLD_HI[:3])
    # This is an asset QA sheet.  The 750×1334 scene-level runtime preview is
    # produced separately by render_drh8_scene_preview.py from the live scene.
    out = ART / "qin_drh8_asset_sheet.png"
    sheet.save(out, optimize=True)
    return out


def build() -> list[Path]:
    out: list[Path] = []

    # Main-table controls and player chrome.
    for name, multiple in (("2.png", "X2"), ("3.png", "X4"), ("4.png", "X8")):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/{name}",
                              lambda sz, m=multiple: draw_bottom_pool(sz, m)))
    for name, text, active in (
        ("btn_da.png", "大", True), ("btn_diu.png", "丢", True),
        ("btn_gen.png", "跟", True), ("btn_xiu.png", "休", True),
        ("敲.png", "敲", True), ("e1.png", "强制\n秀牌", True),
        ("e2.png", "看剩\n余牌", False),
    ):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/{name}",
                              lambda sz, t=text, a=active: action_button(sz, t, a, font_size=22 if "\n" in t else 29)))
    out.append(save_asset("assets/ImagesLuck/游戏内/btn_shishizhanji.png",
                          lambda sz: icon_disc(sz, "record")))
    out.append(save_asset("assets/ImagesLuck/游戏内/桌面聊天图标.png",
                          lambda sz: icon_disc(sz, "chat")))
    out.append(save_asset("assets/ImagesLuck/游戏内/pic_2.png",
                          lambda sz: icon_disc(sz, "info")))
    out.append(save_asset("assets/ImagesLuck/游戏内/pic_3.png",
                          lambda sz: icon_disc(sz, "grid")))
    out.append(save_asset("assets/ImagesLuck/游戏内/dfc32212323.png", card_icon))
    out.append(save_asset("assets/ImagesLuck/游戏内/LOGO.png", qin_seal))

    for name, text, fs in (
        ("实时战绩.png", "实时战绩", 22), ("底皮.png", "皮池", 18),
        ("牌型展示.png", "牌型展示", 21), ("牌局设置.png", "牌局设置", 21),
        ("留座离桌.png", "留座离桌", 21), ("确认分牌.png", "确认分牌", 20),
        ("站起围观.png", "站起围观", 21), ("补充钵钵.png", "补充钵钵", 21),
        ("退出房间.png", "退出房间", 21), ("回座.png", "回座", 22),
    ):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/{name}",
                              lambda sz, t=text, f=fs: pill(sz, t, selected=True, font_size=f)))
    for name in ("diban_shuzi.png", "frame_xiazhu.png", "个人金币.png"):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/{name}", draw_simple_frame))
    out.append(save_asset("assets/ImagesLuck/游戏内/芒果条.png",
                          lambda sz: pill(sz, "芒果", selected=False, font_size=17, corner=False)))
    out.append(save_asset("assets/ImagesLuck/游戏内/分牌背景.png", draw_simple_frame))
    out.append(save_asset("assets/ImagesLuck/游戏内/桌面选中.png", draw_check_frame))
    out.append(save_asset("assets/ImagesLuck/游戏内/zuoxia.png",
                          lambda sz: action_button(sz, "空位", False, font_size=20)))

    # Voice button and both animations.
    for idx, name in enumerate(("H1.png", "H2.png", "H3.png", "H4.png"), 1):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/{name}",
                              lambda sz, level=idx: voice_frame(sz, level)))
    out.append(save_asset("assets/ImagesLuck/游戏内/btn_yuyin.png",
                          lambda sz: voice_frame(sz, 1)))
    for idx, name in enumerate(("yuyintiao1_zuo.png", "yuyintiao2_zuo.png", "yuyintiao3_zuo.png"), 1):
        out.append(save_asset(f"assets/imagesKK/公用/{name}",
                              lambda sz, level=idx: voice_bubble(sz, level)))

    # Settings drawer: five table choices stay recognisable by their center hue.
    accents = ((24, 73, 103), (78, 35, 79), (111, 35, 26), (27, 78, 50), (48, 45, 39))
    for idx, accent in enumerate(accents, 1):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/额外/{idx}.png",
                              lambda sz, a=accent: table_swatch(sz, a)))
    out.append(save_asset("assets/ImagesLuck/游戏内/额外/下拉框.png", draw_simple_frame))
    for name, text in (("选择桌面.png", "选择桌面"), ("选择牌面.png", "选择牌背"),
                       ("游戏音效.png", "游戏音效"), ("语音聊天.png", "语音聊天"),
                       ("音效.png", "游戏音效"), ("语音.png", "语音聊天")):
        out.append(save_asset(f"assets/ImagesLuck/游戏内/额外/{name}",
                              lambda sz, t=text: label_text(sz, t, lines=sz[0] > 200)))

    # Runtime action-state images loaded by DrhPlayerLogic.
    for name, text in (("丢", "丢"), ("休", "休"), ("分", "分牌中"), ("大", "大"),
                       ("搓牌中", "搓牌中"), ("敲", "敲"), ("跟", "跟")):
        out.append(save_asset(f"assets/resources/other/drh/{name}.png",
                              lambda sz, t=text: pill(sz, t, selected=True, font_size=18, corner=False)))
    for name, text, active in (("休或丢0.png", "丢或休", False), ("休或丢1.png", "丢或休", True),
                               ("自动休0.png", "自动\n休牌", False), ("自动休1.png", "自动\n休牌", True)):
        out.append(save_asset(f"assets/resources/other/{name}",
                              lambda sz, t=text, a=active: action_button(sz, t, a, font_size=21)))
    out.append(save_asset("assets/resources/other/观众.png",
                          lambda sz: pill(sz, "观战", False, font_size=17, corner=False)))
    out.append(save_asset("assets/resources/other/观战.png",
                          lambda sz: pill(sz, "观战中", True, font_size=15, corner=False)))

    # Shared legacy-blue pieces reached from drh8 popups.
    out.append(save_asset("assets/ImagesLuck/公用/取消.png",
                          lambda sz: pill(sz, "取消", False, font_size=30)))
    for rel in ("assets/ImagesLuck/公用/弹框小.png", "assets/ImagesLuck/公用/数值底框.png",
                "assets/ImagesLuck/公用/标题底.png", "assets/ImagesLuck/公用/选择框.png",
                "assets/ImagesLuck/公用1/侧弹框.png", "assets/ImagesLuck/公用1/奖池框.png",
                "assets/imagesKK/公用/tishibg.png"):
        out.append(save_asset(rel, draw_simple_frame))
    out.append(save_asset("assets/ImagesLuck/公用1/充值.png",
                          lambda sz: pill(sz, "充值", True, font_size=20)))
    for rel, text in (
        ("assets/ImagesLuck/公用/围观.png", "围观用户"),
        ("assets/ImagesLuck/公用/已带入.png", "已带入/总金币:"),
        ("assets/ImagesLuck/公用/带入.png", "带入"),
        ("assets/ImagesLuck/公用/搓牌.png", "搓牌"),
        ("assets/ImagesLuck/公用/昵称.png", "昵称"),
        ("assets/ImagesLuck/公用/积分.png", "积分"),
        ("assets/ImagesLuck/公用/牌局设置.png", "牌局设置"),
        ("assets/ImagesLuck/公用1/带入积分.png", "带入积分"),
        ("assets/ImagesLuck/公用1/总代入.png", "总代入:"),
        ("assets/ImagesLuck/公用1/总得分.png", "总得分:"),
        ("assets/imagesKK/公用/牌型提示.png", "牌型提示"),
    ):
        out.append(save_asset(rel, lambda sz, t=text: label_text(sz, t, lines=False)))
    out.append(save_asset("assets/imagesKK/公用/lg1.png", star_icon))
    out.append(save_asset("assets/imagesKK/公用/lg2.png", draw_simple_frame))
    for rel in ("assets/imagesKK/游戏大厅/地九王.png", "assets/resources/other/地九王.png"):
        out.append(save_asset(rel, lambda sz: pill(sz, "地九王", True, font_size=16, corner=False)))

    # Jackpot tabs and content.
    for name, text, selected in (("1.png", "奖池总览", True), ("2.png", "奖池", True),
                                 ("3.png", "奖池记录", True), ("4.png", "奖池总览", False),
                                 ("5.png", "奖池", False), ("6.png", "奖池记录", False)):
        out.append(save_asset(f"assets/ImagesLuck/奖池/{name}",
                              lambda sz, t=text, s=selected: draw_jackpot_tab(sz, t, s)))
    out.append(save_asset("assets/ImagesLuck/奖池/圆角矩形.png", draw_jackpot_card))
    out.append(save_asset("assets/ImagesLuck/奖池/奖池-.png", draw_jackpot_digits_bg))
    out.append(save_asset("assets/ImagesLuck/奖池/奖池桌面数字背景.png", draw_jackpot_digits_bg))
    out.append(save_asset("assets/ImagesLuck/奖池/最大赢家.png", draw_big_winner))
    out.append(save_asset("assets/ImagesLuck/奖池/框.png", draw_simple_frame))
    for name, text, lines in (("各级.png", "一分皮奖池金额", True),
                              ("奖池.png", "奖池", False),
                              ("当前奖金.png", "当前奖池记录", False)):
        out.append(save_asset(f"assets/ImagesLuck/奖池/{name}",
                              lambda sz, t=text, ln=lines: label_text(sz, t, lines=ln)))
    for name in ("比列.png", "奖池桌面数字.png"):
        path = ROOT / "assets" / "ImagesLuck" / "奖池" / name
        out.append(save_asset(str(path.relative_to(ROOT)), recolor_neon_to_gold(Image.open(path))))

    # Report and review subpanels.
    for name, text in (("举 报.png", "举报"), ("举报.png", "举报"),
                       ("举报标题.png", "举报"), ("牌局回顾.png", "牌局回顾")):
        out.append(save_asset(f"assets/ImagesXYPK/其他/{name}",
                              lambda sz, t=text: label_text(sz, t)))
    out.append(save_asset("assets/ImagesXYPK/其他/内容框.png", draw_report_content))
    for name, text in (("提交jb.png", "提交举报"), ("提交举报.png", "提交举报"),
                       ("确定举报.png", "确定举报")):
        out.append(save_asset(f"assets/ImagesXYPK/其他/{name}",
                              lambda sz, t=text: pill(sz, t, True, font_size=23)))
    out.append(save_asset("assets/ImagesXYPK/其他/提示.png", warning_icon))

    # Turntable art; removes the old POKER STAR wording.
    out.append(save_asset("assets/ImagesXYPK/转盘/1.png", draw_simple_frame))
    out.append(save_asset("assets/ImagesXYPK/转盘/2.png", draw_simple_frame))
    out.append(save_asset("assets/ImagesXYPK/转盘/框.png", draw_simple_frame))
    out.append(save_asset("assets/ImagesXYPK/转盘/按钮.png",
                          lambda sz: draw_turntable_button(sz, True)))
    out.append(save_asset("assets/ImagesXYPK/转盘/按钮灰.png",
                          lambda sz: draw_turntable_button(sz, False)))
    out.append(save_asset("assets/ImagesXYPK/转盘/转盘1.png",
                          lambda sz: draw_turntable(sz, False)))
    out.append(save_asset("assets/ImagesXYPK/转盘/转盘3.png",
                          lambda sz: draw_turntable(sz, True)))
    out.append(save_asset("assets/ImagesXYPK/转盘/转盘_06.png", draw_turntable_icon))

    # Creator 2.4.13 applies RAW/TRIMMED Sprite size during __preload.  Run the
    # geometry-aware repair pass last so the broad skin can never leave popup
    # controls with oversized visible content or opaque selection overlays.
    out = list(dict.fromkeys(out + panel_fix.build()))

    build_style_source()
    build_preview(out)
    return out


if __name__ == "__main__":
    files = build()
    print(f"generated {len(files)} drh8 runtime images")
    for file in files:
        print(file.relative_to(ROOT))
