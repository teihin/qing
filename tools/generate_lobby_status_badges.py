#!/usr/bin/env python3
"""Generate the lobby room-status badges (状态_等待中/准备/游戏中/参与过).

Output: assets/resources/other/状态_*.png at 236x94 (shown at 150x60 by the
room-item prefab). Gold laurel wreath + glowing capsule plate + metallic text.

The laurel art comes from vibe_images/laurel_wreath_gold_*.png; its black
background is keyed out by luminance so the branches composite over the plate.

Existing .png.meta files are never rewritten: only the texture bytes change,
which keeps UUIDs and the 236x94 sprite settings intact.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "resources" / "other"
WREATH = ROOT / "vibe_images" / "laurel_wreath_gold_1794230120673_c4e3eb43.png"

SS = 6                      # supersample factor
CW, CH = 236, 94            # final canvas, must match the .meta size

FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_INDEX = 1


def vgrad3(size, stops):
    """Vertical RGBA gradient from [(pos, rgba), ...] stops."""
    w, h = size
    col = Image.new("RGBA", (1, h))
    px = col.load()
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / max(1e-6, p1 - p0)
                px[0, y] = tuple(round(c0[j] * (1 - k) + c1[j] * k) for j in range(4))
                break
        else:
            px[0, y] = stops[-1][1]
    return col.resize((w, h))


def colorize(mask, color):
    layer = Image.new("RGBA", mask.size, color[:3] + (255,))
    layer.putalpha(mask.point(lambda v: round(v * color[3] / 255)))
    return layer


def load_branches():
    src = Image.open(WREATH).convert("RGB")
    a = np.asarray(src).astype(np.float32)
    a[930:1024, 1330:1536] = 0                     # drop the generator watermark
    alpha = np.clip((a.max(axis=2) - 10) * 3.2, 0, 255)
    keyed = Image.fromarray(np.dstack([a, alpha]).astype(np.uint8), "RGBA")
    return keyed.crop((120, 40, 560, 970)), keyed.crop((980, 40, 1400, 970))


def build(text, pal, left, right):
    img = Image.new("RGBA", (CW * SS, CH * SS), (0, 0, 0, 0))
    W, H = img.size

    plate = (29 * SS, 17 * SS, W - 29 * SS, H - 17 * SS)
    radius = int(18 * SS)

    # outer bloom, then the dark plate, so the glow only rims the capsule
    rim_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(rim_mask).rounded_rectangle(plate, radius=radius, outline=255, width=int(3.0 * SS))
    img.alpha_composite(colorize(rim_mask.filter(ImageFilter.GaussianBlur(6 * SS)), pal["glow"] + (135,)))
    img.alpha_composite(colorize(rim_mask.filter(ImageFilter.GaussianBlur(1.8 * SS)), pal["glow"] + (205,)))

    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(plate, radius=radius, fill=255)
    img.paste(vgrad3((W, H), [(0.0, pal["top"]), (1.0, pal["bottom"])]), (0, 0), mask)

    cxp = (plate[0] + plate[2]) / 2
    sheen = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sheen).ellipse(
        (cxp - 58 * SS, plate[1] + 26 * SS, cxp + 58 * SS, plate[1] + 44 * SS), fill=255)
    img.alpha_composite(colorize(ImageChops.multiply(sheen.filter(ImageFilter.GaussianBlur(12 * SS)), mask),
                                 pal["sheen"] + (16,)))

    d = ImageDraw.Draw(img)
    d.rounded_rectangle(plate, radius=radius, outline=pal["rim"], width=int(1.6 * SS))
    inset = int(3.2 * SS)
    d.rounded_rectangle((plate[0] + inset, plate[1] + inset, plate[2] - inset, plate[3] - inset),
                        radius=radius - inset, outline=pal["glow"][:3] + (110,), width=int(0.8 * SS))
    d.rounded_rectangle((plate[0] - 1.4 * SS, plate[1] - 1.4 * SS, plate[2] + 1.4 * SS, plate[3] + 1.4 * SS),
                        radius=radius + int(1.4 * SS), outline=pal["rim_dim"], width=int(1.0 * SS))

    for side, branch in ((-1, left), (1, right)):
        target_h = 92 * SS
        tw = int(branch.width * target_h / branch.height)
        b = branch.resize((tw, target_h), Image.LANCZOS)
        x = -int(2 * SS) if side < 0 else W - tw + int(2 * SS)
        img.alpha_composite(b, (x, (H - target_h) // 2))

    fs = int(45 * SS)
    font = ImageFont.truetype(FONT_PATH, fs, index=FONT_INDEX)
    bb = font.getbbox(text)
    tx = (W - (bb[2] - bb[0])) / 2 - bb[0]
    ty = (H - (bb[3] - bb[1])) / 2 - bb[1] + 1 * SS

    tmask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(tmask).text((tx, ty), text, font=font, fill=255)
    tmask = tmask.filter(ImageFilter.MaxFilter(int(0.8 * SS) * 2 + 1))       # faux bold

    ext = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ed = ImageDraw.Draw(ext)
    for k in range(int(2.2 * SS), 0, -1):
        ed.text((tx + 0.4 * SS, ty + k), text, font=font, fill=pal["stroke"])
    img.alpha_composite(ext.filter(ImageFilter.MaxFilter(int(0.9 * SS) * 2 + 1)))

    stroke_mask = tmask.filter(ImageFilter.MaxFilter(int(0.95 * SS) * 2 + 1))
    img.alpha_composite(colorize(stroke_mask, pal["stroke"]))
    img.paste(vgrad3((W, H), pal["metal"]), (0, 0), tmask)

    top_edge = ImageChops.subtract(tmask, ImageChops.offset(tmask, 0, int(1.2 * SS)))
    img.alpha_composite(colorize(top_edge, (255, 255, 255, 165)))

    out = img.resize((CW, CH), Image.Resampling.LANCZOS)
    out.save(OUT / f"{pal['name']}.png", optimize=True)
    return out


def pal(name, text, top, bottom, rim, rim_dim, glow, sheen, t_top, t_bottom, stroke):
    metal = [(0.0, (255, 255, 255, 255)), (0.14, t_top), (0.55, t_bottom),
             (1.0, tuple(round(c * 0.72) for c in t_bottom[:3]) + (255,))]
    return dict(name=name, text=text, top=top, bottom=bottom, rim=rim, rim_dim=rim_dim,
                glow=glow, sheen=sheen, metal=metal, stroke=stroke)


PALETTES = [
    pal("状态_等待中", "等待中",
        (14, 54, 96, 255), (3, 16, 34, 255),
        (150, 240, 255, 255), (46, 150, 205, 255),
        (60, 200, 255, 255), (180, 240, 255, 255),
        (255, 255, 255, 255), (118, 224, 255, 255), (3, 26, 46, 255)),
    pal("状态_准备", "等待中",
        (11, 58, 36, 255), (2, 18, 12, 255),
        (170, 255, 198, 255), (44, 158, 94, 255),
        (70, 235, 130, 255), (192, 255, 216, 255),
        (248, 255, 252, 255), (86, 226, 148, 255), (2, 26, 15, 255)),
    pal("状态_游戏中", "进行中",
        (88, 52, 10, 255), (26, 14, 3, 255),
        (255, 226, 152, 255), (192, 130, 42, 255),
        (255, 170, 40, 255), (255, 238, 184, 255),
        (255, 254, 232, 255), (255, 186, 52, 255), (42, 21, 1, 255)),
    pal("状态_参与过", "参与过",
        (48, 30, 98, 255), (16, 8, 34, 255),
        (226, 202, 255, 255), (124, 90, 188, 255),
        (168, 116, 255, 255), (232, 216, 255, 255),
        (255, 250, 255, 255), (152, 104, 242, 255), (16, 6, 34, 255)),
]


def main():
    left, right = load_branches()
    for p in PALETTES:
        build(p["text"], p, left, right)
        print("wrote", OUT / f"{p['name']}.png")


if __name__ == "__main__":
    main()
