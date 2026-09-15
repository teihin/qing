#!/usr/bin/env python3
"""按 Prefab 坐标合成一行房间行预览，检查图标与数字的相对大小和清晰度。"""
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Volumes/SSD/qing/assets/V7/"
SCALE = 2  # 卡面是 712.77x130 的 2 倍
card = Image.open(ROOT + "room_card_exact.png").convert("RGBA")
d = ImageDraw.Draw(card)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Songti.ttc", 48)
CY = 130 + 33 * SCALE


def icon(name, x):
    im = Image.open(ROOT + name).convert("RGBA")
    s = int(36 * SCALE)
    im = im.resize((s, s), Image.LANCZOS)
    card.paste(im, (int(713 + x * SCALE - s / 2), int(CY - s / 2)), im)


def text(s, x):
    d.text((713 + x * SCALE, CY), s, font=font, fill=(255, 226, 170), anchor="lm",
           stroke_width=3, stroke_fill=(20, 50, 90))


icon("room_icon_chip.png", -202)
text("1/3", -172)
icon("room_icon_clock.png", -100)
text("45分钟", -78)
icon("room_icon_player.png", 45)
text("0/8", 68)
text("剩余时间 5分钟", 150)
card.resize((1000, 182), Image.LANCZOS).save("/tmp/qingcard/mock_row2.png")
print("ok")
