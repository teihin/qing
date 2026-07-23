#!/usr/bin/env python3
"""Rebuild the Hongli promotion page with a clean, restrained Qin layout."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PROMO = ROOT / "assets" / "ImagesXYPK" / "推广"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"


def text(draw, xy, value, size, fill, anchor="mm"):
    draw.text(xy, value, font=ImageFont.truetype(str(FONT), size), fill=fill, anchor=anchor)


def rounded_outline(draw, box, radius, fill, outline, width=1):
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)


def make_background():
    width, height = 750, 1334
    image = Image.new("RGBA", (width, height), (8, 8, 7, 255))
    pixels = image.load()
    for y in range(height):
        t = y / (height - 1)
        for x in range(width):
            dx = (x - width / 2) / (width / 2)
            glow = max(0.0, 1.0 - (dx * dx + ((y - 520) / 620) ** 2))
            base = round(8 + 5 * glow - 2 * t)
            pixels[x, y] = (base + 2, base + 1, base, 255)

    draw = ImageDraw.Draw(image, "RGBA")
    # Quiet outer frame and a single central card replace the noisy full-screen texture.
    draw.rectangle((14, 91, 735, 1320), outline=(183, 126, 48, 105), width=1)
    draw.rectangle((19, 96, 730, 1315), outline=(80, 53, 23, 110), width=1)
    rounded_outline(
        draw,
        (92, 205, 658, 955),
        26,
        (14, 13, 11, 242),
        (174, 117, 43, 150),
        2,
    )
    rounded_outline(
        draw,
        (102, 215, 648, 945),
        20,
        (18, 16, 13, 210),
        (77, 51, 23, 130),
        1,
    )

    draw.line((155, 284, 300, 284), fill=(143, 92, 34, 95), width=1)
    draw.line((450, 284, 595, 284), fill=(143, 92, 34, 95), width=1)
    draw.ellipse((366, 275, 384, 293), outline=(203, 144, 58, 155), width=1)
    draw.ellipse((371, 280, 379, 288), fill=(203, 144, 58, 115))

    text(draw, (375, 252), "邀请好友  共聚秦风", 28, (239, 208, 144, 255))
    text(draw, (375, 317), "扫描二维码即可进入游戏", 18, (164, 151, 125, 255))
    text(draw, (375, 800), "专属邀请二维码", 21, (226, 188, 112, 255))
    text(draw, (375, 837), "分享给好友，一起加入牌局", 17, (151, 140, 119, 255))

    # Minimal corner accents, deliberately low contrast.
    for left, top, sx, sy in ((93, 206, 1, 1), (657, 206, -1, 1), (93, 954, 1, -1), (657, 954, -1, -1)):
        draw.line((left, top, left + 38 * sx, top), fill=(213, 154, 65, 145), width=2)
        draw.line((left, top, left, top + 38 * sy), fill=(213, 154, 65, 145), width=2)

    image.save(PROMO / "背景.png")


def make_qr_frame():
    image = Image.new("RGBA", (363, 363), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    # Keep alpha bounds exactly x/y=30..333 to match the existing Cocos trim metadata.
    rounded_outline(draw, (30, 30, 333, 333), 22, (250, 247, 238, 255), (221, 177, 91, 255), 3)
    draw.rounded_rectangle((39, 39, 324, 324), 16, outline=(76, 52, 23, 180), width=1)
    for x, y, sx, sy in ((48, 48, 1, 1), (315, 48, -1, 1), (48, 315, 1, -1), (315, 315, -1, -1)):
        draw.line((x, y, x + 20 * sx, y), fill=(173, 112, 36, 210), width=2)
        draw.line((x, y, x, y + 20 * sy), fill=(173, 112, 36, 210), width=2)
    image.save(PROMO / "二维码框底.png")


def make_button():
    image = Image.new("RGBA", (356, 77), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    rounded_outline(draw, (1, 1, 354, 75), 18, (28, 23, 16, 255), (230, 177, 75, 255), 2)
    draw.rounded_rectangle((7, 7, 348, 69), 14, outline=(105, 69, 27, 220), width=1)
    draw.line((32, 60, 324, 60), fill=(104, 67, 25, 100), width=1)
    text(draw, (178, 37), "分享二维码", 22, (244, 213, 149, 255))
    image.save(PROMO / "分享二维码.png")


if __name__ == "__main__":
    make_background()
    make_qr_frame()
    make_button()
    print("Generated clean promotion page assets.")
