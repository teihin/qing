#!/usr/bin/env python3
"""Generate formal V7 art for the settlement hand-review page.

The page keeps account data, cards and scores as live Prefab nodes.  This file
only creates the non-stretchable header/tabs/rings and clean stretchable panel
materials used by those nodes.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from generate_v7_runtime_skin import OUT, ROOT, save


FONT = ROOT / "assets/font/PingFF.ttf"
SS = 4
GOLD = (225, 188, 132, 255)
GOLD_HI = (247, 222, 177, 255)
GOLD_DARK = (108, 78, 47, 255)
BLUE_TOP = (25, 83, 122, 252)
BLUE_BOTTOM = (3, 31, 55, 254)
COOL = (129, 169, 184, 190)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * SS)


def save_crisp(image: Image.Image, name: str, sliced: bool = False) -> None:
    save(image, name, sliced=sliced)
    meta_path = OUT / f"{name}.meta"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["packable"] = False
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def gradient(size: tuple[int, int], top=BLUE_TOP, bottom=BLUE_BOTTOM) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        draw.line((0, y, width, y), fill=color)
    return image


def rounded_panel(size: tuple[int, int], radius: int = 18,
                  selected: bool = False) -> Image.Image:
    width, height = size
    W, H = width * SS, height * SS
    image = gradient(
        (W, H),
        (49, 113, 151, 253) if selected else (28, 84, 122, 252),
        (5, 35, 60, 254),
    )
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS),
                         radius * SS, fill=255)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = mask.filter(ImageFilter.GaussianBlur(4 * SS))
    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow_layer.putalpha(shadow.point(lambda p: p * 80 // 255))
    out.alpha_composite(shadow_layer)
    out.paste(image, (0, 0), mask)
    draw = ImageDraw.Draw(out, "RGBA")
    draw.rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS),
                           radius * SS, outline=GOLD_DARK, width=1 * SS)
    draw.rounded_rectangle((5 * SS, 5 * SS, W - 5 * SS, H - 5 * SS),
                           (radius - 2) * SS, outline=COOL, width=1 * SS)
    draw.arc((8 * SS, 8 * SS, W - 8 * SS, H - 8 * SS), 195, 345,
             fill=(230, 239, 235, 105), width=1 * SS)
    rng = random.Random(width * 911 + height * 37 + int(selected))
    for _ in range(max(120, width * height // 30)):
        x, y = rng.randrange(W), rng.randrange(H)
        if mask.getpixel((x, y)):
            draw.point((x, y), fill=(152, 218, 226, rng.randrange(3, 10)))
    return out.resize(size, Image.Resampling.LANCZOS)


def art_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str,
             size: int, fill=GOLD_HI, anchor: str = "mm") -> None:
    x, y = xy[0] * SS, xy[1] * SS
    draw.text((x + SS, y + 2 * SS), text, font=font(size), anchor=anchor,
              fill=(0, 5, 12, 130), stroke_width=SS,
              stroke_fill=(0, 5, 12, 130))
    draw.text((x, y), text, font=font(size), anchor=anchor, fill=fill,
              stroke_width=SS, stroke_fill=(45, 30, 18, 180))


def header() -> Image.Image:
    image = gradient((750 * SS, 72 * SS), (10, 47, 77, 255), (2, 24, 43, 255))
    draw = ImageDraw.Draw(image, "RGBA")
    # Same curved title panel rhythm as 我的战绩, but with a clean right side.
    curve = [(0, 71), (220, 71), (238, 68), (249, 60), (258, 44),
             (269, 18), (279, 0)]
    curve = [(x * SS, y * SS) for x, y in curve]
    draw.line(curve, fill=(224, 176, 108, 255), width=1 * SS, joint="curve")
    draw.line((0, 71 * SS, 750 * SS, 71 * SS), fill=(128, 90, 53, 210), width=1 * SS)
    # Back arrow is baked as art; the real Button remains a transparent hotspot.
    draw.line((44 * SS, 26 * SS, 26 * SS, 36 * SS, 44 * SS, 46 * SS),
              fill=GOLD_HI, width=5 * SS, joint="curve")
    draw.line((27 * SS, 36 * SS, 60 * SS, 36 * SS), fill=GOLD_HI, width=5 * SS)
    art_text(draw, (142, 36), "牌局回顾", 34)
    return image.resize((750, 72), Image.Resampling.LANCZOS)


def info_bar() -> Image.Image:
    image = rounded_panel((708, 64), 16)
    work = image.resize((708 * SS, 64 * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    draw.line((474 * SS, 15 * SS, 474 * SS, 49 * SS), fill=(133, 148, 145, 170), width=SS)
    draw.line((510 * SS, 24 * SS, 548 * SS, 24 * SS), fill=GOLD_HI, width=2 * SS)
    draw.line((510 * SS, 43 * SS, 548 * SS, 43 * SS), fill=(235, 72, 74, 255), width=2 * SS)
    art_text(draw, (582, 24), "底牌", 19)
    art_text(draw, (582, 43), "尾飞", 19)
    return work.resize((708, 64), Image.Resampling.LANCZOS)


def row() -> Image.Image:
    image = rounded_panel((708, 184), 18)
    work = image.resize((708 * SS, 184 * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    for x in (132, 530):
        draw.line((x * SS, 18 * SS, x * SS, 166 * SS),
                  fill=(121, 142, 143, 125), width=SS)
    return work.resize((708, 184), Image.Resampling.LANCZOS)


def avatar_ring() -> Image.Image:
    W = H = 118 * SS
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((7 * SS, 7 * SS, 111 * SS, 111 * SS),
                 outline=(61, 38, 19, 190), width=5 * SS)
    draw.ellipse((5 * SS, 5 * SS, 113 * SS, 113 * SS),
                 outline=GOLD_HI, width=2 * SS)
    draw.ellipse((10 * SS, 10 * SS, 108 * SS, 108 * SS),
                 outline=GOLD_DARK, width=2 * SS)
    draw.arc((3 * SS, 3 * SS, 115 * SS, 115 * SS), 196, 344,
             fill=(255, 238, 196, 210), width=2 * SS)
    return image.resize((118, 118), Image.Resampling.LANCZOS)


def tab(text: str, selected: bool) -> Image.Image:
    image = rounded_panel((248, 62), 17, selected=selected)
    work = image.resize((248 * SS, 62 * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    if selected:
        # Restrained gold inset, matching V7 selected tabs without black text.
        draw.rounded_rectangle((8 * SS, 7 * SS, 240 * SS, 55 * SS),
                               13 * SS, fill=(224, 184, 126, 225),
                               outline=GOLD_HI, width=SS)
        fill = (9, 39, 62, 255)
    else:
        fill = GOLD_HI
    art_text(draw, (124, 32), text, 27, fill=fill)
    return work.resize((248, 62), Image.Resampling.LANCZOS)


def section_header() -> Image.Image:
    image = rounded_panel((704, 60), 14)
    work = image.resize((704 * SS, 60 * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    draw.line((352 * SS, 10 * SS, 352 * SS, 50 * SS),
              fill=(132, 151, 150, 150), width=SS)
    return work.resize((704, 60), Image.Resampling.LANCZOS)


def text_row() -> Image.Image:
    image = rounded_panel((704, 52), 12)
    work = image.resize((704 * SS, 52 * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    for x in (384, 500):
        draw.line((x * SS, 10 * SS, x * SS, 42 * SS),
                  fill=(123, 143, 143, 120), width=SS)
    return work.resize((704, 52), Image.Resampling.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save_crisp(header(), "review_header_exact.png")
    save_crisp(info_bar(), "review_info_bar_exact.png")
    save_crisp(row(), "review_row_exact.png", sliced=True)
    save_crisp(avatar_ring(), "review_avatar_ring_exact.png")
    save_crisp(tab("牌局回顾", False), "review_tab_cards_off_exact.png")
    save_crisp(tab("牌局回顾", True), "review_tab_cards_on_exact.png")
    save_crisp(tab("文字牌谱", False), "review_tab_text_off_exact.png")
    save_crisp(tab("文字牌谱", True), "review_tab_text_on_exact.png")
    save_crisp(section_header(), "review_section_header_exact.png", sliced=True)
    save_crisp(text_row(), "review_text_row_exact.png", sliced=True)
    print("已生成牌局回顾正式高清组件美术。")


if __name__ == "__main__":
    main()
