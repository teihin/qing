#!/usr/bin/env python3
"""Generate the black-gold Qin skin for panelMain/Main/我的.

Only existing PNG pixels are replaced.  File names, dimensions, meta files,
SpriteFrame UUIDs, node names, and button behavior remain unchanged.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

sys.dont_write_bytecode = True

from generate_qin_ranking_skin import (
    GOLD,
    GOLD_DARK,
    GOLD_HI,
    GOLD_MID,
    IVORY,
    LATIN,
    PING,
    SONGTI,
    S,
    center_text,
    font,
    gradient,
    metal_text,
    save,
)


ROOT = Path(__file__).resolve().parents[1]
MINE = ROOT / "assets" / "ImagesLuck" / "我的"
OPTIONS = MINE / "选项"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
COMMON1 = ROOT / "assets" / "ImagesLuck" / "公用1"
HALL = ROOT / "assets" / "ImagesLuck" / "大厅"
OTHER = ROOT / "assets" / "resources" / "other"
ART = ROOT / "art_sources" / "mine"

AVATAR_SOURCE = ART / "qin_default_avatar_source.png"


def scaled(size: tuple[int, int]) -> tuple[int, int]:
    return size[0] * S, size[1] * S


def make_title() -> Path:
    size = (83, 39)
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    metal_text(image, "我的", font(PING, 25), (size[0] * S // 2, size[1] * S // 2), stroke=1, glow=2)
    return save(MINE / "我的.png", image.resize(size, Image.Resampling.LANCZOS))


def make_default_avatar() -> Path:
    source = Image.open(AVATAR_SOURCE).convert("RGB")
    inset = max(1, round(source.width * 0.036))
    source = source.crop((inset, inset, source.width - inset, source.height - inset))
    image = ImageOps.fit(source, (140, 139), Image.Resampling.LANCZOS).convert("RGBA")
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).ellipse((1, 0, 139, 139), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.55))
    image.putalpha(mask)
    pixels = image.load()
    for point in ((0, 0), (139, 0), (0, 138), (139, 138)):
        pixels[point] = (28, 19, 8, 8)
    return save(OTHER / "默认头像.png", image)


def make_avatar_frame() -> Path:
    size = (153, 153)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow_mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow_mask).ellipse((5 * S, 5 * S, 148 * S, 148 * S), outline=165, width=7 * S)
    aura = Image.new("RGBA", canvas, (201, 124, 32, 0))
    aura.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(5 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.ellipse((4 * S, 4 * S, 149 * S, 149 * S), outline=GOLD_DARK, width=6 * S)
    draw.ellipse((9 * S, 9 * S, 144 * S, 144 * S), outline=GOLD_HI, width=2 * S)
    draw.ellipse((14 * S, 14 * S, 139 * S, 139 * S), outline=(132, 79, 25, 235), width=S)
    for angle in (45, 135, 225, 315):
        rad = math.radians(angle)
        cx = 76.5 * S + math.cos(rad) * 69 * S
        cy = 76.5 * S + math.sin(rad) * 69 * S
        d = 5 * S
        draw.polygon(((cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)), fill=GOLD_HI)
    return save(COMMON / "头像2.png", image.resize(size, Image.Resampling.LANCZOS))


def make_upload() -> Path:
    size = (215, 47)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow).rounded_rectangle((4 * S, 4 * S, 211 * S, 43 * S), radius=19 * S, outline=145, width=5 * S)
    layer = Image.new("RGBA", canvas, (196, 119, 29, 0))
    layer.putalpha(glow.filter(ImageFilter.GaussianBlur(4 * S)))
    image.alpha_composite(layer)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((3 * S, 4 * S, 212 * S, 43 * S), radius=19 * S,
                           fill=(8, 7, 6, 238), outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((7 * S, 8 * S, 208 * S, 39 * S), radius=15 * S,
                           outline=(239, 199, 113, 220), width=S)
    draw.polygon(((25 * S, 28 * S), (25 * S, 18 * S), (31 * S, 18 * S),
                  (31 * S, 13 * S), (39 * S, 21 * S), (31 * S, 29 * S),
                  (31 * S, 24 * S), (28 * S, 24 * S)), fill=GOLD_HI)
    center_text(draw, (126 * S, 23.5 * S), "点击上传头像", font(PING, 18), IVORY,
                stroke_width=S, stroke_fill=(47, 25, 7, 255))
    return save(MINE / "点击上传.png", image.resize(size, Image.Resampling.LANCZOS))


def make_coin_frame() -> Path:
    size = (221, 44)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    panel = gradient(canvas, (31, 24, 14, 246), (6, 6, 5, 248))
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle((2 * S, 3 * S, 219 * S, 41 * S), radius=18 * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 3 * S, 219 * S, 41 * S), radius=18 * S,
                           outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((6 * S, 7 * S, 215 * S, 37 * S), radius=14 * S,
                           outline=(238, 197, 110, 210), width=S)
    draw.ellipse((9 * S, 8 * S, 39 * S, 38 * S), fill=(93, 55, 15, 255), outline=GOLD_HI, width=2 * S)
    draw.ellipse((14 * S, 13 * S, 34 * S, 33 * S), outline=GOLD, width=S)
    center_text(draw, (24 * S, 23 * S), "秦", font(SONGTI, 14), GOLD_HI)
    draw.line((50 * S, 11 * S, 50 * S, 33 * S), fill=(123, 75, 27, 120), width=S)
    return save(MINE / "金币框.png", image.resize(size, Image.Resampling.LANCZOS))


def make_vip_pad() -> Path:
    size = (142, 143)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow).ellipse((7 * S, 5 * S, 135 * S, 133 * S), outline=145, width=8 * S)
    aura = Image.new("RGBA", canvas, (199, 123, 31, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(6 * S)))
    image.alpha_composite(aura)
    draw = ImageDraw.Draw(image)
    draw.ellipse((6 * S, 5 * S, 136 * S, 135 * S), fill=(7, 6, 5, 242), outline=GOLD_DARK, width=5 * S)
    draw.ellipse((12 * S, 11 * S, 130 * S, 129 * S), outline=GOLD_HI, width=S)
    draw.arc((22 * S, 20 * S, 120 * S, 118 * S), 200, 340, fill=GOLD_MID, width=2 * S)
    draw.line((22 * S, 127 * S, 120 * S, 127 * S), fill=(234, 184, 85, 150), width=S)
    return save(MINE / "VIP卡垫.png", image.resize(size, Image.Resampling.LANCZOS))


def make_vip_card(filename: str, subtitle: str) -> Path:
    size = (102, 65)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 4 * S, 100 * S, 61 * S), radius=12 * S,
                           fill=(10, 8, 5, 245), outline=GOLD_DARK, width=4 * S)
    draw.rounded_rectangle((6 * S, 8 * S, 96 * S, 57 * S), radius=9 * S,
                           outline=GOLD_HI, width=S)
    draw.polygon(((12 * S, 15 * S), (18 * S, 23 * S), (24 * S, 15 * S),
                  (30 * S, 23 * S), (36 * S, 15 * S), (33 * S, 30 * S), (15 * S, 30 * S)),
                 fill=GOLD)
    center_text(draw, (64 * S, 23 * S), "VIP", font(LATIN, 19), GOLD_HI,
                stroke_width=S, stroke_fill=(54, 29, 7, 255))
    center_text(draw, (51 * S, 46 * S), subtitle, font(PING, 14), IVORY,
                stroke_width=S, stroke_fill=(51, 28, 8, 255))
    return save(MINE / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_data_label(filename: str, text: str, size: tuple[int, int]) -> Path:
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    center_text(draw, (size[0] * S / 2, size[1] * S / 2), text, font(PING, 17), GOLD_HI,
                stroke_width=S, stroke_fill=(47, 25, 7, 255))
    return save(MINE / filename, image.resize(size, Image.Resampling.LANCZOS))


def draw_option_icon(draw: ImageDraw.ImageDraw, kind: str, cx: int, cy: int) -> None:
    c = GOLD_HI
    mid = GOLD_MID
    w = 2 * S
    x, y = cx * S, cy * S
    if kind == "record":
        draw.line((x - 15 * S, y - 15 * S, x + 15 * S, y + 15 * S), fill=c, width=w)
        draw.line((x + 15 * S, y - 15 * S, x - 15 * S, y + 15 * S), fill=c, width=w)
        draw.line((x - 20 * S, y - 18 * S, x - 11 * S, y - 19 * S), fill=mid, width=3 * S)
        draw.line((x + 20 * S, y - 18 * S, x + 11 * S, y - 19 * S), fill=mid, width=3 * S)
    elif kind == "agent":
        draw.ellipse((x - 8 * S, y - 19 * S, x + 8 * S, y - 3 * S), outline=c, width=w)
        draw.arc((x - 19 * S, y - 1 * S, x + 19 * S, y + 25 * S), 185, 355, fill=c, width=w)
        draw.polygon(((x + 12 * S, y + 5 * S), (x + 21 * S, y + 9 * S),
                      (x + 18 * S, y + 22 * S), (x + 12 * S, y + 27 * S),
                      (x + 6 * S, y + 22 * S), (x + 3 * S, y + 9 * S)), outline=mid)
    elif kind == "flow":
        draw.ellipse((x - 18 * S, y - 17 * S, x + 8 * S, y + 9 * S), outline=c, width=w)
        center_text(draw, (x - 5 * S, y - 4 * S), "秦", font(SONGTI, 12), c)
        draw.line((x - 2 * S, y + 15 * S, x + 19 * S, y + 15 * S), fill=c, width=w)
        draw.polygon(((x + 19 * S, y + 15 * S), (x + 11 * S, y + 9 * S), (x + 11 * S, y + 21 * S)), fill=c)
        draw.line((x + 17 * S, y - 12 * S, x + 4 * S, y - 12 * S), fill=mid, width=w)
    elif kind == "gift":
        draw.rectangle((x - 19 * S, y - 5 * S, x + 19 * S, y + 22 * S), outline=c, width=w)
        draw.rectangle((x - 23 * S, y - 12 * S, x + 23 * S, y - 4 * S), outline=c, width=w)
        draw.line((x, y - 12 * S, x, y + 22 * S), fill=mid, width=w)
        draw.arc((x - 16 * S, y - 27 * S, x, y - 8 * S), 190, 350, fill=c, width=w)
        draw.arc((x, y - 27 * S, x + 16 * S, y - 8 * S), 190, 350, fill=c, width=w)
    elif kind == "data":
        draw.ellipse((x - 18 * S, y - 19 * S, x - 4 * S, y - 5 * S), outline=c, width=w)
        draw.arc((x - 24 * S, y - 4 * S, x + 2 * S, y + 22 * S), 185, 355, fill=c, width=w)
        for i, length in enumerate((14, 22, 18)):
            yy = y - 15 * S + i * 13 * S
            draw.line((x + 7 * S, yy, x + (7 + length) * S, yy), fill=c if i != 1 else mid, width=w)
    else:
        points = []
        for i in range(24):
            radius = 23 if i % 2 == 0 else 17
            angle = -math.pi / 2 + i * math.pi / 12
            points.append((x + math.cos(angle) * radius * S, y + math.sin(angle) * radius * S))
        draw.polygon(points, outline=c)
        draw.ellipse((x - 9 * S, y - 9 * S, x + 9 * S, y + 9 * S), outline=mid, width=w)


def make_option_row(filename: str, label: str, kind: str) -> Path:
    size = (722, 91)
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    glow = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow).rounded_rectangle((3 * S, 5 * S, 719 * S, 86 * S), radius=17 * S,
                                           outline=115, width=6 * S)
    aura = Image.new("RGBA", canvas, (196, 117, 28, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(5 * S)))
    image.alpha_composite(aura)
    panel = gradient(canvas, (35, 27, 16, 249), (6, 6, 5, 250))
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle((2 * S, 4 * S, 720 * S, 87 * S), radius=18 * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 4 * S, 720 * S, 87 * S), radius=18 * S,
                           outline=GOLD_DARK, width=5 * S)
    draw.rounded_rectangle((7 * S, 9 * S, 715 * S, 82 * S), radius=14 * S,
                           outline=(238, 198, 112, 205), width=S)
    draw.line((130 * S, 18 * S, 130 * S, 73 * S), fill=(119, 73, 26, 145), width=S)
    draw.line((150 * S, 13 * S, 566 * S, 13 * S), fill=(255, 231, 169, 45), width=S)
    draw_option_icon(draw, kind, 75, 46)

    text_font = font(PING, 25)
    box = draw.textbbox((0, 0), label, font=text_font, stroke_width=S)
    ty = 46 * S - (box[3] - box[1]) / 2 - box[1]
    draw.text((158 * S, round(ty)), label, font=text_font, fill=IVORY,
              stroke_width=S, stroke_fill=(48, 26, 7, 255))

    ax, ay = 671 * S, 46 * S
    draw.line((ax - 9 * S, ay - 14 * S, ax + 4 * S, ay), fill=GOLD_HI, width=3 * S)
    draw.line((ax + 4 * S, ay, ax - 9 * S, ay + 14 * S), fill=GOLD_HI, width=3 * S)
    draw.line((ax - 15 * S, ay - 14 * S, ax - 2 * S, ay), fill=GOLD_MID, width=S)
    draw.line((ax - 2 * S, ay, ax - 15 * S, ay + 14 * S), fill=GOLD_MID, width=S)
    return save(OPTIONS / filename, image.resize(size, Image.Resampling.LANCZOS))


def draw_preview_label(image: Image.Image, center: tuple[int, int], text: str, size: int, color=IVORY) -> None:
    scale = 2
    layer = Image.new("RGBA", (image.width * scale, image.height * scale), (0, 0, 0, 0))
    preview_font = ImageFont.truetype(str(PING), size * scale)
    center_text(ImageDraw.Draw(layer), (center[0] * scale, center[1] * scale), text, preview_font, color)
    image.alpha_composite(layer.resize(image.size, Image.Resampling.LANCZOS))


def make_preview() -> Path:
    preview = Image.open(COMMON / "背景.png").convert("RGBA")
    preview.alpha_composite(Image.open(COMMON1 / "顶部.png").convert("RGBA"), (0, 0))
    title = Image.open(MINE / "我的.png").convert("RGBA")
    preview.alpha_composite(title, (334, 27))
    service = Image.open(HALL / "客服.png").convert("RGBA")
    preview.alpha_composite(service, (665, 15))

    frame = Image.open(COMMON / "头像2.png").convert("RGBA")
    avatar = Image.open(OTHER / "默认头像.png").convert("RGBA")
    preview.alpha_composite(frame, (119, 145))
    preview.alpha_composite(avatar, (126, 152))
    preview.alpha_composite(Image.open(MINE / "点击上传.png").convert("RGBA"), (88, 325))

    draw_preview_label(preview, (423, 192), "玩家昵称", 24)
    draw_preview_label(preview, (370, 232), "ID:", 20)
    draw_preview_label(preview, (435, 232), "100001", 20)
    preview.alpha_composite(Image.open(MINE / "金币框.png").convert("RGBA"), (315, 265))
    draw_preview_label(preview, (433, 287), "88888.00", 22, GOLD_HI)

    rows = (
        "战绩选择条.png", "代理选择条.png", "资金流向选择条.png",
        "赠送选择条.png", "个人数据.png", "设置选择条.png",
    )
    for index, filename in enumerate(rows):
        preview.alpha_composite(Image.open(OPTIONS / filename).convert("RGBA"), (13, 407 + index * 106))

    preview.alpha_composite(Image.open(HALL / "操作台底板.png").convert("RGBA"), (0, 1181))
    nav_specs = [
        (HALL / "排行榜2.png", 74, 1284), (HALL / "公告2.png", 224, 1284),
        (HALL / "钱包2.png", 537, 1284), (HALL / "我的2.png", 682, 1284),
    ]
    for path, cx, cy in nav_specs:
        icon = Image.open(path).convert("RGBA")
        preview.alpha_composite(icon, (round(cx - icon.width / 2), round(cy - icon.height / 2)))
    preview.alpha_composite(Image.open(HALL / "秦_发现按钮.png").convert("RGBA"), (273, 1188))

    target = ART / "qin_mine_runtime_preview.png"
    preview.convert("RGB").save(target, optimize=True, quality=95)
    return target


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = [
        make_title(),
        make_default_avatar(),
        make_avatar_frame(),
        make_upload(),
        make_coin_frame(),
        make_vip_pad(),
        make_vip_card("VIP月卡.png", "月卡"),
        make_vip_card("VIP半年卡.png", "半年卡"),
        make_vip_card("VIP年度卡.png", "年度卡"),
        make_data_label("总局数.png", "总局数:", (80, 27)),
        make_data_label("总胜率.png", "总胜率:", (80, 27)),
        make_data_label("获胜手数.png", "获胜手数:", (105, 27)),
        make_data_label("平局手数.png", "平局手数:", (104, 27)),
        make_data_label("失败手数.png", "失败手数:", (105, 27)),
        make_option_row("战绩选择条.png", "战绩", "record"),
        make_option_row("代理选择条.png", "代理", "agent"),
        make_option_row("资金流向选择条.png", "交易明细", "flow"),
        make_option_row("赠送选择条.png", "赠送/受赠", "gift"),
        make_option_row("个人数据.png", "个人数据", "data"),
        make_option_row("设置选择条.png", "设置", "settings"),
    ]
    outputs.append(make_preview())
    for output in outputs:
        print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
