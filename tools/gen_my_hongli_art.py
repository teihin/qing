#!/usr/bin/env python3
"""Generate the V8 "我的红利" (club / union) skin art.

Outputs go to assets/V7/ as new files with fresh deterministic metas; the
existing shared V7 art is never overwritten because other panels still use it.
"""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/V7"
TMP = ROOT / "temp/my-hongli-art"
SS = 4

GOLD_HI = (255, 245, 214)
GOLD = (243, 210, 145)
GOLD_MID = (214, 164, 88)
GOLD_DEEP = (158, 104, 38)
GOLD_DARK = (74, 45, 12)

NAVY_TOP = (28, 74, 118)
NAVY_BOT = (7, 31, 58)
NAVY_EDGE = (5, 22, 42)


# ------------------------------------------------------------------ helpers
def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def vgrad3(size, stops):
    """Vertical gradient with [(pos0..1, rgb), ...]"""
    w, h = size
    out = np.zeros((h, w, 3), dtype=np.uint8)
    stops = sorted(stops)
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                out[y, :, :] = lerp(c0, c1, k)
                break
    return out


def vgrad(size, top, bottom):
    w, h = size
    t = np.linspace(0.0, 1.0, h)[:, None, None]
    a = np.array(top, dtype=np.float32)[None, None, :]
    b = np.array(bottom, dtype=np.float32)[None, None, :]
    arr = a + (b - a) * t
    arr = np.repeat(arr, w, axis=1)
    return arr.astype(np.uint8)


def rounded_mask(size, radius, shrink=0):
    w, h = size
    m = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    r = max(0, radius - shrink)
    box = [shrink * SS, shrink * SS, (w - shrink) * SS - 1, (h - shrink) * SS - 1]
    d.rounded_rectangle(box, radius=r * SS, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def ring_mask(size, radius, inset_from, inset_to):
    outer = rounded_mask(size, radius, shrink=inset_from)
    inner = rounded_mask(size, radius, shrink=inset_to)
    return Image.fromarray(
        np.clip(np.asarray(outer, dtype=np.int16) - np.asarray(inner, dtype=np.int16), 0, 255).astype(np.uint8)
    )


def tint(mask, rgb, alpha=255):
    w, h = mask.size
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[:, :, 0] = rgb[0]
    arr[:, :, 1] = rgb[1]
    arr[:, :, 2] = rgb[2]
    arr[:, :, 3] = np.clip(np.asarray(mask, dtype=np.uint16) * alpha // 255, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def gold_ring(size, radius, inset_from=0, inset_to=3, top=GOLD_HI, bottom=GOLD_DEEP):
    m = ring_mask(size, radius, inset_from, inset_to)
    g = Image.fromarray(np.dstack([vgrad(size, top, bottom), np.asarray(m)]), "RGBA")
    return g


def over(base, layer):
    base.alpha_composite(layer)
    return base


def draw_plate(size, radius, fill_top=NAVY_TOP, fill_bot=NAVY_BOT, alpha=250,
               border=4, inner_line=True, line_inset=12, top_gloss=30,
               bottom_shade=True):
    w, h = size
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    body = rounded_mask(size, radius)
    fill = Image.fromarray(np.dstack([vgrad(size, fill_top, fill_bot), np.asarray(body)]), "RGBA")
    if alpha < 255:
        arr = np.asarray(fill).copy()
        arr[:, :, 3] = (arr[:, :, 3].astype(np.uint16) * alpha // 255).astype(np.uint8)
        fill = Image.fromarray(arr, "RGBA")
    out.alpha_composite(fill)

    # edge shadow so the plate separates from the lobby behind it
    edge = Image.fromarray(
        np.clip(np.asarray(rounded_mask(size, radius, shrink=0), dtype=np.int16)
                - np.asarray(rounded_mask(size, radius, shrink=1), dtype=np.int16), 0, 255).astype(np.uint8)
    )
    out.alpha_composite(tint(edge, NAVY_EDGE, 210))

    # dark contour, then warm gold rim
    out.alpha_composite(gold_ring(size, radius, 0, max(1, border // 2), (58, 36, 10), (58, 36, 10)))
    out.alpha_composite(gold_ring(size, radius, border // 2, border, (255, 236, 178), (146, 92, 32)))
    if inner_line:
        out.alpha_composite(gold_ring(size, radius, border + 4, border + 6, GOLD, GOLD_MID))

    # glossy top band
    if top_gloss:
        grad = np.zeros((h, w, 4), dtype=np.uint8)
        span = max(1, int(h * 0.45))
        for y in range(span):
            a = int(top_gloss * (1 - y / span) ** 2)
            grad[y, :, :3] = 255
            grad[y, :, 3] = a
        gloss = Image.fromarray(grad, "RGBA")
        out.alpha_composite(Image.composite(gloss, Image.new("RGBA", size, (0, 0, 0, 0)),
                                           rounded_mask(size, radius, shrink=border + 1)))
    if bottom_shade:
        grad = np.zeros((h, w, 4), dtype=np.uint8)
        span = max(1, int(h * 0.3))
        for i in range(span):
            y = h - 1 - i
            grad[y, :, 3] = int(70 * (1 - i / span) ** 2)
        shade = Image.fromarray(grad, "RGBA")
        out.alpha_composite(Image.composite(shade, Image.new("RGBA", size, (0, 0, 0, 0)),
                                            rounded_mask(size, radius, shrink=border + 1)))
    return out


def corner_flourish(size=56):
    """Subtle double-arc inlay for the ledger corner (stays inside the 9-slice corner)."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = 30
    for inset, width, col in [(13, 2, (255, 236, 186, 150)), (18, 1, (214, 168, 96, 110))]:
        r = c - inset
        d.arc([(c - r) * SS, (c - r) * SS, (c + r) * SS, (c + r) * SS], 180, 270, fill=col, width=width * SS)
    return img.resize((size, size), Image.LANCZOS)


# ------------------------------------------------------------------ art text
def _font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def draw_text_layer(text, font, tracking, outline, fill_top, fill_mid, fill_bot, glow=0, pad=None):
    """Supersampled gold text: PIL stroke for smooth outlines, vertical metal fill."""
    k = 4
    fs = font.size * k
    f = ImageFont.truetype(font.path, fs, index=font.index)
    stroke = round(outline * k)
    pad = (outline + (glow or 0) + 6) * k
    widths = [f.getlength(ch) for ch in text]
    total = sum(widths) + tracking * k * (len(text) - 1)
    asc, desc = f.getmetrics()
    w = int(total + pad * 2)
    h = int(asc + desc + pad * 2)
    base = pad + asc
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fill = (0, 0, 0, 0)
    x = pad
    if glow:
        g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        cx = pad
        for ch in text:
            gd.text((cx, base), ch, font=f, fill=(255, 210, 120, 120), anchor="ls",
                    stroke_width=stroke + 2 * k, stroke_fill=(255, 210, 120, 120))
            cx += f.getlength(ch) + tracking * k
        img.alpha_composite(g.filter(ImageFilter.GaussianBlur(2.4 * k)))
    for ch in text:
        d.text((x, base), ch, font=f, fill=(255, 255, 255, 255), anchor="ls",
               stroke_width=stroke, stroke_fill=(44, 26, 6, 255))
        x += f.getlength(ch) + tracking * k
    bbox = img.getbbox()
    img = img.crop(bbox)
    w, h = img.size

    # mask of the glyph body (inside the outline) via a second pass without stroke
    body = Image.new("L", (w, h), 0)
    bd = ImageDraw.Draw(body)
    ox, oy = pad - bbox[0], pad - bbox[1]
    x = ox
    for ch in text:
        bd.text((x, base - bbox[1]), ch, font=f, fill=255, anchor="ls")
        x += f.getlength(ch) + tracking * k
    bm = np.asarray(body, dtype=np.float32) / 255.0

    grad = vgrad3((w, h), [(0.0, fill_top), (0.42, fill_mid), (1.0, fill_bot)])
    arr = np.asarray(img).astype(np.float32)
    # keep the dark outline, replace the glyph body with the metal gradient
    rgb = arr[:, :, :3]
    out = rgb * (1 - bm[:, :, None]) + grad * bm[:, :, None]
    out = np.dstack([out, arr[:, :, 3]])
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")

    # soft top light along the glyph edge
    up = np.clip(np.roll(bm, 3, axis=0) - bm, 0, 1)[:, :, None]
    hi = np.dstack([np.full((h, w), 255, np.float32), np.full((h, w), 250, np.float32),
                    np.full((h, w), 225, np.float32), up * 150])
    img = Image.alpha_composite(img, Image.fromarray(hi.astype(np.uint8), "RGBA"))
    return img.resize((max(1, round(w / k)), max(1, round(h / k))), Image.LANCZOS)


def gold_text(text, font, tracking=0, outline=3, glow=0, **_):
    return draw_text_layer(text, font, tracking, outline,
                           (255, 250, 222), (243, 202, 120), (150, 90, 26), glow)


def brown_text(text, font, tracking=0, **_):
    return draw_text_layer(text, font, tracking, 0, (96, 60, 18), (74, 44, 12), (52, 30, 6))


def header_text_bitmap(text, font_path, font_size, target_size, left_pad=12,
                       fill=(250, 242, 214), lower=(211, 169, 96)):
    """Light V8 header lettering used by the other pages.

    Keep the output canvas stable so the existing Prefab SpriteFrame size and
    node contract stay unchanged while the glyph style changes.
    """
    w, h = target_size
    canvas = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    f = ImageFont.truetype(font_path, font_size * SS, index=2)
    stroke = 2 * SS
    shadow = 2 * SS
    bbox = f.getbbox(text, stroke_width=stroke)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = left_pad * SS - bbox[0]
    y = (h * SS - text_h) // 2 - bbox[1]
    d = ImageDraw.Draw(canvas)

    # Warm lower edge first, then the cream face; this matches the restrained
    # header lettering used by 我的业绩/排行榜 without the heavy black-gold
    # outline of the old Hongli title.
    d.text((x, y + shadow), text, font=f, fill=lower + (255,),
           stroke_width=stroke, stroke_fill=(13, 42, 66, 245))
    d.text((x, y), text, font=f, fill=fill + (255,),
           stroke_width=stroke, stroke_fill=(13, 42, 66, 245))
    return canvas.resize((w, h), Image.LANCZOS)


def region_mask(size, box, radius):
    w, h = size
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    x0, y0, x1, y1 = [int(v * SS) for v in box]
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(radius * SS), fill=255)
    return big.resize((w, h), Image.LANCZOS)


def region_ring(size, box, radius, inset=3):
    outer = region_mask(size, box, radius)
    x0, y0, x1, y1 = box
    inner = region_mask(size, (x0 + inset, y0 + inset, x1 - inset, y1 - inset),
                        max(1, radius - inset))
    return Image.fromarray(np.clip(np.asarray(outer, dtype=np.int16)
                                   - np.asarray(inner, dtype=np.int16), 0, 255).astype(np.uint8))


# ------------------------------------------------------------------ outputs
def save(img, name):
    img.save(OUT / name)


def make_stats_card():
    size = (1276, 210)
    out = draw_plate(size, 34, fill_top=(32, 82, 128), fill_bot=(8, 33, 61), alpha=250)
    # three soft column separators
    sep = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sep)
    for x in (425, 851):
        for dy, a in ((0, 150), (2, 60)):
            d.line([(x, 26 + dy), (x, size[1] - 26 + dy)], fill=(255, 232, 176, a), width=2)
    out.alpha_composite(sep)
    save(out, "hongli_v8_stats_card.png")


def make_list_frame():
    base = (320, 320)
    out = draw_plate(base, 30, fill_top=(22, 62, 102), fill_bot=(7, 29, 55), alpha=248,
                     border=4, inner_line=True, line_inset=12, top_gloss=14)
    fl = corner_flourish(56)
    out.alpha_composite(fl, (0, 0))
    out.alpha_composite(fl.transpose(Image.FLIP_LEFT_RIGHT), (base[0] - 56, 0))
    out.alpha_composite(fl.transpose(Image.FLIP_TOP_BOTTOM), (0, base[1] - 56))
    out.alpha_composite(fl.transpose(Image.ROTATE_180), (base[0] - 56, base[1] - 56))
    save(out, "hongli_v8_list_frame.png")


def make_claim_bar():
    size = (782, 160)
    # A cooler teal-blue status panel separates the unclaimed balance from the
    # gold withdrawal button beside it.  The left label bay and right amount
    # bay give the row a clearer visual hierarchy than one flat navy capsule.
    out = draw_plate(size, 80, fill_top=(31, 91, 126), fill_bot=(7, 35, 62), alpha=250,
                     border=4, inner_line=True, line_inset=12, top_gloss=24)
    left_box = (16, 15, 522, 145)
    right_box = (528, 15, 766, 145)
    left_fill = Image.fromarray(np.dstack([
        vgrad(size, (49, 119, 139), (11, 53, 78)),
        np.asarray(region_mask(size, left_box, 62)) * 0.84
    ]).astype(np.uint8), "RGBA")
    right_fill = Image.fromarray(np.dstack([
        vgrad(size, (38, 82, 105), (7, 32, 57)),
        np.asarray(region_mask(size, right_box, 62)) * 0.92
    ]).astype(np.uint8), "RGBA")
    out.alpha_composite(left_fill)
    out.alpha_composite(right_fill)
    out.alpha_composite(tint(region_ring(size, left_box, 62, 3), (255, 224, 158), 135))
    out.alpha_composite(tint(region_ring(size, right_box, 62, 3), (255, 208, 126), 190))
    divider = Image.new("RGBA", size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(divider)
    dd.line([(522, 35), (522, 125)], fill=(255, 224, 158, 130), width=2)
    dd.line([(525, 42), (525, 118)], fill=(12, 38, 61, 170), width=2)
    out.alpha_composite(divider)
    save(out, "hongli_v8_claim_bar.png")


def make_extract_button():
    """Rounded-rectangle gold button (方形圆角), 9-sliced at 24 px borders."""
    size = (340, 124)   # exactly 2x the 170x62 node: no 9-slice seams in the gradient
    radius = 18
    border = 18
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    body = rounded_mask(size, radius)
    grad = vgrad3(size, [(0.0, (255, 242, 205)), (0.40, (249, 213, 146)),
                         (0.72, (226, 168, 90)), (1.0, (186, 124, 46))])
    out.alpha_composite(Image.fromarray(np.dstack([grad, np.asarray(body)]), "RGBA"))

    inner = rounded_mask(size, radius, shrink=border)
    detail = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(detail)
    d.rectangle([6, 0, size[0] - 6, 9], fill=(255, 255, 255, 60))
    d.rectangle([6, size[1] - 12, size[0] - 6, size[1]], fill=(122, 68, 14, 46))
    out.alpha_composite(Image.composite(detail, Image.new("RGBA", size, (0, 0, 0, 0)), inner))

    out.alpha_composite(gold_ring(size, radius, 0, 3, (92, 54, 12), (92, 54, 12)))
    out.alpha_composite(gold_ring(size, radius, 3, 5, (255, 248, 216), (176, 116, 44)))
    save(out, "hongli_v8_btn_extract.png")


def make_table_header():
    size = (1384, 172)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    body = rounded_mask(size, 18)
    grad = vgrad(size, (36, 92, 143), (12, 44, 78))
    out.alpha_composite(Image.fromarray(np.dstack([grad, np.asarray(body)]), "RGBA"))
    out.alpha_composite(gold_ring(size, 18, 0, 3, (255, 240, 198), (150, 98, 34)))
    line = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(line)
    d.line([(16, size[1] - 8), (size[0] - 16, size[1] - 8)], fill=(255, 226, 160, 210), width=3)
    grad_line = line.filter(ImageFilter.GaussianBlur(0.6))
    out.alpha_composite(Image.composite(grad_line, Image.new("RGBA", size, (0, 0, 0, 0)), body))
    save(out, "hongli_v8_table_header.png")


def make_row():
    size = (1368, 168)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    body = rounded_mask(size, 14)
    grad = vgrad(size, (26, 70, 112), (12, 43, 76))
    arr = np.dstack([grad, (np.asarray(body, dtype=np.uint16) * 232 // 255).astype(np.uint8)])
    out.alpha_composite(Image.fromarray(arr, "RGBA"))
    out.alpha_composite(gold_ring(size, 14, 0, 2, (206, 166, 104), (86, 60, 26)))
    save(out, "hongli_v8_row.png")


def make_pager():
    size = (1416, 164)
    out = draw_plate(size, 26, fill_top=(26, 68, 108), fill_bot=(8, 32, 58), alpha=250,
                     border=3, inner_line=True, line_inset=10, top_gloss=18)
    save(out, "hongli_v8_pager.png")


def make_page_value():
    size = (380, 116)
    out = draw_plate(size, 58, fill_top=(30, 78, 122), fill_bot=(9, 34, 62), alpha=250,
                     border=4, inner_line=False)
    save(out, "hongli_v8_page_value.png")


def make_rules():
    v = Image.new("RGBA", (8, 84), (0, 0, 0, 0))
    grad = vgrad((8, 84), (255, 236, 190, 40), (236, 196, 128, 210))
    v.alpha_composite(Image.fromarray(np.dstack([grad[:, :, :3], np.full((84, 8), 200, np.uint8)]), "RGBA"))
    v.save(OUT / "hongli_v8_rule_v.png")
    h = Image.new("RGBA", (300, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(h)
    d.rounded_rectangle([0, 2, 299, 5], radius=2, fill=(255, 226, 160, 190))
    h.save(OUT / "hongli_v8_rule_h.png")


def key_icon(src, name, size, threshold=44, crop_pad=6):
    img = Image.open(src).convert("RGB")
    a = np.asarray(img).astype(np.float32)
    # drop the bottom-right watermark row before keying
    h, w, _ = a.shape
    a[int(h * 0.88):, int(w * 0.62):] = 0
    lum = a.max(axis=2)
    alpha = np.clip((lum - threshold) / (255 - threshold), 0, 1)
    # keep the painted colours; bleed the background toward warm gold at the edge
    # so the soft cutout does not turn into a dirty halo on dark panels
    edge = (255, 208, 128)
    rgb = a * alpha[:, :, None] + np.array(edge, np.float32) * (1 - alpha[:, :, None])
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    bbox = im.getbbox()
    im = im.crop(bbox)
    scale = min(size[0] / im.width, size[1] / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    im.save(OUT / name)
    return im


def bronze(img):
    """Recolour a keyed icon to dark bronze so it reads on the gold button."""
    a = np.asarray(img).astype(np.float32)
    lum = (a[:, :, 0] * .4 + a[:, :, 1] * .45 + a[:, :, 2] * .15) / 255.0
    lum = np.clip((lum - .15) / .85, 0, 1)
    dark = np.array((48, 26, 4), np.float32)
    light = np.array((132, 88, 38), np.float32)
    rgb = dark + (light - dark) * lum[:, :, None]
    alpha = np.clip(a[:, :, 3] * 1.9, 0, 255)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")


def flat_gift(size=128):
    k = 4
    n = size * k
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = [22 * k, 52 * k, 106 * k, 112 * k]
    d.rounded_rectangle(box, radius=8 * k, fill=(96, 56, 14, 255))
    d.rounded_rectangle([25 * k, 55 * k, 103 * k, 109 * k], radius=6 * k, fill=(176, 120, 48, 255))
    d.rounded_rectangle([18 * k, 34 * k, 110 * k, 58 * k], radius=6 * k, fill=(112, 66, 18, 255))
    d.rounded_rectangle([21 * k, 37 * k, 107 * k, 55 * k], radius=4 * k, fill=(200, 142, 62, 255))
    d.rectangle([58 * k, 34 * k, 70 * k, 112 * k], fill=(120, 72, 20, 255))
    d.rectangle([60 * k, 34 * k, 68 * k, 112 * k], fill=(214, 158, 76, 255))
    for cx0, cx1 in ((30, 58), (70, 98)):
        d.ellipse([cx0 * k, 14 * k, cx1 * k, 40 * k], fill=(96, 56, 14, 255))
        d.ellipse([(cx0 + 3) * k, 17 * k, (cx1 - 3) * k, 37 * k], fill=(212, 154, 72, 255))
    d.rounded_rectangle([54 * k, 26 * k, 74 * k, 44 * k], radius=5 * k, fill=(120, 72, 20, 255))
    d.rounded_rectangle([57 * k, 29 * k, 71 * k, 41 * k], radius=4 * k, fill=(226, 172, 90, 255))
    return img.resize((size, size), Image.LANCZOS)


def make_icons():
    key_icon(ROOT / "vibe_images/hongli_coin_icon_1794230993494_964c19c0.png", "hongli_v8_coin.png", (128, 128))
    flat_gift(128).save(OUT / "hongli_v8_gift.png")
    laurel = Image.open("/tmp/laurel_keyed.png").convert("RGBA")
    w, h = laurel.size
    left = laurel.crop(laurel.crop((0, 0, w // 2, h)).getbbox())
    right = laurel.crop((w // 2, 0, w, h))
    rx = right.getbbox()
    right = laurel.crop((w // 2 + rx[0], rx[1], w // 2 + rx[2], rx[3]))
    for im, name in ((left, "hongli_v8_laurel_l.png"), (right, "hongli_v8_laurel_r.png")):
        scale = 128 / im.height
        im.resize((max(1, int(im.width * scale)), 128), Image.LANCZOS).save(OUT / name)


def make_texts():
    """Art text is authored at 2x the final UI size for crisp downscaling."""
    song = "/System/Library/Fonts/Supplemental/Songti.ttc"
    header_font = "/System/Library/Fonts/Hiragino Sans GB.ttc"
    title = header_text_bitmap("我的红利", header_font, 72, (456, 121), left_pad=12)
    title.save(OUT / "hongli_v8_txt_title.png")
    unclaimed = header_text_bitmap("未领取红利", header_font, 58, (343, 80), left_pad=6,
                                  fill=(255, 242, 205), lower=(225, 181, 102))
    unclaimed.save(OUT / "hongli_v8_txt_unclaimed.png")
    extract = brown_text("提取红利", _font(song, 54, 0), tracking=3)
    extract.save(OUT / "hongli_v8_txt_extract.png")


def make_digit_font():
    """Gold bitmap digits rendered supersampled: crisp at 30-50 px label sizes."""
    song = "/System/Library/Fonts/Supplemental/Songti.ttc"
    base_size = 256
    f = _font(song, base_size, 0)
    asc, desc = f.getmetrics()
    outline = 4
    glyphs = []

    for ch in "0123456789-":
        img = gold_text(ch, f, tracking=0, outline=outline)
        yoff = asc + f.getbbox(ch)[1] - outline
        glyphs.append((ch, img, yoff, round(f.getlength(ch)) + 4))

    dot_px = 42
    dot = Image.new("RGBA", (dot_px, dot_px), (0, 0, 0, 0))
    big = Image.new("RGBA", (dot_px * SS, dot_px * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    n = dot_px * SS
    d.ellipse([2 * SS, 2 * SS, n - 2 * SS, n - 2 * SS], fill=(44, 26, 6, 255))
    d.ellipse([7 * SS, 7 * SS, n - 7 * SS, n - 7 * SS], fill=(250, 226, 168, 255))
    d.ellipse([14 * SS, 14 * SS, n - 14 * SS, n - 14 * SS], fill=(206, 146, 62, 255))
    dot = big.resize((dot_px, dot_px), Image.LANCZOS)
    baseline = max(y + img.height for _, img, y, _ in glyphs) - 4
    glyphs.append((".", dot, baseline - 52, 40))

    shift = min(y for _, _, y, _ in glyphs) - 4
    line_h = max(y + img.height for _, img, y, _ in glyphs) - shift + 6
    pad = 4
    width = pad
    for _, img, _, _ in glyphs:
        width += img.width + pad
    atlas_w = max(2048, 1 << (width - 1).bit_length())
    atlas = Image.new("RGBA", (atlas_w, line_h), (0, 0, 0, 0))
    entries = []
    x = pad
    for ch, img, yoff, adv in glyphs:
        oy = yoff - shift
        atlas.alpha_composite(img, (x, oy))
        # BMFont yoffset is relative to the top of the line.  Subtracting the
        # ascent here turns an in-line glyph offset (about 8px) into a large
        # negative offset (about -264px), so Cocos renders digits above their
        # Label nodes. Keep the atlas-relative offset instead.
        entries.append((ord(ch), x, oy, img.width, img.height, oy, adv))
        x += img.width + pad
    atlas.save(OUT / "hongli_v8_digits.png")

    lines = [f'info face="V8 Hongli digits" size={base_size} bold=0 italic=0 unicode=1 stretchH=100 '
             f'smooth=1 aa=1 padding=0,0,0,0 spacing=2,2',
             f"common lineHeight={line_h} base={baseline - shift} scaleW={atlas_w} scaleH={line_h} pages=1 packed=0",
             'page id=0 file="hongli_v8_digits.png"',
             f"chars count={len(entries)}"]
    for cid, gx, gy, gw, gh, oy, adv in entries:
        lines.append(f"char id={cid} x={gx} y={gy} width={gw} height={gh} xoffset=0 yoffset={oy} "
                     f"xadvance={adv} page=0 chnl=15")
    (OUT / "hongli_v8_digits.fnt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    tex = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/assets/V7/hongli_v8_digits.png"))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/assets/V7/hongli_v8_digits.png#sprite"))
    png_meta = {
        "ver": "2.3.7", "uuid": tex, "importer": "texture", "type": "sprite", "wrapMode": "clamp",
        "filterMode": "bilinear", "premultiplyAlpha": False, "genMipmaps": False, "packable": False,
        "width": atlas_w, "height": line_h, "platformSettings": {},
        "subMetas": {"hongli_v8_digits": {
            "ver": "1.0.6", "uuid": frame, "importer": "sprite-frame", "rawTextureUuid": tex,
            "trimType": "none", "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0,
            "trimX": 0, "trimY": 0, "width": atlas_w, "height": line_h,
            "rawWidth": atlas_w, "rawHeight": line_h,
            "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0, "subMetas": {}}},
    }
    (OUT / "hongli_v8_digits.png.meta").write_text(json.dumps(png_meta, ensure_ascii=False, indent=2),
                                                   encoding="utf-8")
    fnt_meta = {
        "ver": "2.1.2",
        "uuid": str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/assets/V7/hongli_v8_digits.fnt")),
        "importer": "bitmap-font",
        "textureUuid": tex,
        "fontSize": base_size,
        "subMetas": {},
    }
    (OUT / "hongli_v8_digits.fnt.meta").write_text(json.dumps(fnt_meta, ensure_ascii=False, indent=2),
                                                   encoding="utf-8")


def write_meta(name, border=(0, 0, 0, 0)):
    png = OUT / f"{name}.png"
    w, h = Image.open(png).size
    stem = name
    tex = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qing/assets/V7/{name}.png"))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qing/assets/V7/{name}.png#sprite"))
    meta = {
        "ver": "2.3.7",
        "uuid": tex,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": False,
        "width": w,
        "height": h,
        "platformSettings": {},
        "subMetas": {
            stem: {
                "ver": "1.0.6",
                "uuid": frame,
                "importer": "sprite-frame",
                "rawTextureUuid": tex,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": w,
                "height": h,
                "rawWidth": w,
                "rawHeight": h,
                "borderTop": border[0],
                "borderBottom": border[1],
                "borderLeft": border[2],
                "borderRight": border[3],
                "subMetas": {},
            }
        },
    }
    (OUT / f"{name}.png.meta").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    make_stats_card()
    make_list_frame()
    make_claim_bar()
    make_extract_button()
    make_table_header()
    make_row()
    make_pager()
    make_page_value()
    make_rules()
    make_icons()
    make_texts()
    make_digit_font()
    for name in ["hongli_v8_stats_card", "hongli_v8_claim_bar", "hongli_v8_btn_extract",
                 "hongli_v8_table_header", "hongli_v8_row", "hongli_v8_pager", "hongli_v8_page_value",
                 "hongli_v8_rule_v", "hongli_v8_rule_h", "hongli_v8_coin", "hongli_v8_gift",
                 "hongli_v8_laurel_l", "hongli_v8_laurel_r", "hongli_v8_txt_title",
                 "hongli_v8_txt_unclaimed", "hongli_v8_txt_extract"]:
        write_meta(name, (0, 0, 0, 0))
    write_meta("hongli_v8_list_frame", (56, 56, 56, 56))
    write_meta("hongli_v8_btn_extract", (0, 0, 0, 0))
    print("generated", len(list(OUT.glob("hongli_v8_*"))), "files")


if __name__ == "__main__":
    main()
