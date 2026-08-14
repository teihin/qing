#!/usr/bin/env python3
"""Generate the neutral 8L payment-channel icon used for iconType=other."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "ImagesLuck" / "钱包" / "其他支付.png"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
SCALE = 4


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * SCALE)


def main() -> None:
    width, height = 238, 121
    image = Image.new("RGBA", (width * SCALE, height * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    box = (7 * SCALE, 17 * SCALE, 231 * SCALE, 104 * SCALE)
    radius = 17 * SCALE

    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    panel = Image.new("RGBA", image.size, (0, 0, 0, 0))
    panel_pixels = panel.load()
    top = (41, 88, 111)
    bottom = (7, 27, 39)
    for y in range(box[1], box[3] + 1):
        ratio = (y - box[1]) / max(1, box[3] - box[1])
        color = tuple(round(top[index] * (1 - ratio) + bottom[index] * ratio) for index in range(3))
        for x in range(box[0], box[2] + 1):
            panel_pixels[x, y] = (*color, 255)
    panel.putalpha(mask)
    image.alpha_composite(panel)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box, radius=radius, outline=(213, 232, 237, 255), width=3 * SCALE)
    inner = (10 * SCALE, 20 * SCALE, 228 * SCALE, 101 * SCALE)
    draw.rounded_rectangle(inner, radius=14 * SCALE, outline=(42, 177, 202, 190), width=SCALE)
    draw.line((34 * SCALE, 24 * SCALE, 202 * SCALE, 24 * SCALE), fill=(244, 252, 255, 92), width=SCALE)

    card_back = (36 * SCALE, 39 * SCALE, 66 * SCALE, 76 * SCALE)
    card_front = (48 * SCALE, 46 * SCALE, 78 * SCALE, 83 * SCALE)
    draw.rounded_rectangle(card_back, radius=5 * SCALE, outline=(136, 216, 230, 220), width=2 * SCALE)
    draw.rounded_rectangle(card_front, radius=5 * SCALE, fill=(225, 241, 244, 235), outline=(255, 255, 255, 255), width=2 * SCALE)
    draw.ellipse((57 * SCALE, 57 * SCALE, 69 * SCALE, 69 * SCALE), fill=(22, 122, 150, 255))

    label = "其他支付"
    label_font = font(25)
    text_box = draw.textbbox((0, 0), label, font=label_font)
    text_width = text_box[2] - text_box[0]
    text_height = text_box[3] - text_box[1]
    text_x = 154 * SCALE - text_width // 2
    text_y = 60 * SCALE - text_height // 2 - text_box[1]
    draw.text((text_x + SCALE, text_y + SCALE), label, font=label_font, fill=(0, 0, 0, 110))
    draw.text((text_x, text_y), label, font=label_font, fill=(241, 249, 251, 255))

    image = image.resize((width, height), Image.Resampling.LANCZOS)
    pixels = image.load()
    for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        pixels[point] = (0, 0, 0, 2)
    image.save(OUTPUT, optimize=True)
    print(OUTPUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
