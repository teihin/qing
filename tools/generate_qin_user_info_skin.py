#!/usr/bin/env python3
"""Deterministically rebuild the Qin artwork used by panelUserInfo.

Only panel-specific chrome is redrawn.  The avatar, recharge button, switches,
all prop icons and every Images/道具 resource remain read-only inputs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
INTERACTION = ROOT / "assets" / "ImagesLuck" / "互动"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
SETTINGS = ROOT / "assets" / "ImagesLuck" / "设置"
OTHER = ROOT / "assets" / "resources" / "other"
ART = ROOT / "art_sources" / "user_info"
SOURCE = ART / "qin_user_info_lacquer_source.png"
PREVIEW = ART / "qin_user_info_runtime_preview.png"
PING = ROOT / "assets" / "font" / "PingFF.ttf"
SONGTI = Path("/System/Library/Fonts/Supplemental/Songti.ttc")

PANEL = INTERACTION / "用户信息框.png"
TITLE = INTERACTION / "玩家信息.png"
VIP = INTERACTION / "开通VIP.png"
VOICE = INTERACTION / "语音回放.png"
GIFT = INTERACTION / "赠送.png"
VOICE_CHAT = INTERACTION / "语音聊天.png"
STATS = INTERACTION / "数值底框.png"
PROP_CARD = INTERACTION / "表情框.png"

STAT_LABELS = (
    (INTERACTION / "总手数.png", "总手数:"),
    (INTERACTION / "总胜率.png", "总胜率:"),
    (INTERACTION / "失败率.png", "失败率:"),
    (INTERACTION / "胜利.png", "胜利:"),
    (INTERACTION / "平局.png", "平局:"),
    (INTERACTION / "失败.png", "失败:"),
    (INTERACTION / "入池率.png", "入池率:"),
    (INTERACTION / "翻牌率.png", "翻牌率:"),
    (INTERACTION / "翻牌胜率.png", "翻牌胜率:"),
)

TARGETS = (
    PANEL,
    TITLE,
    VIP,
    VOICE,
    GIFT,
    VOICE_CHAT,
    STATS,
    PROP_CARD,
) + tuple(path for path, _ in STAT_LABELS)

PROP_IMAGES = (
    INTERACTION / "吻.png",
    INTERACTION / "鸡.png",
    INTERACTION / "啤酒.png",
    INTERACTION / "拇指.png",
    INTERACTION / "炸弹.png",
    INTERACTION / "枪.png",
    ROOT / "assets" / "Images" / "道具" / "x1.png",
    ROOT / "assets" / "Images" / "道具" / "x3.png",
    ROOT / "assets" / "Images" / "道具" / "x7.png",
    ROOT / "assets" / "Images" / "道具" / "x8.png",
    ROOT / "assets" / "Images" / "道具" / "机枪" / "item15_1.png",
)

S = 4
GOLD_HI = (255, 237, 181, 255)
GOLD = (223, 172, 82, 255)
GOLD_MID = (151, 96, 38, 255)
GOLD_DARK = (66, 39, 14, 255)
IVORY = (235, 218, 181, 255)
MUTED = (155, 139, 112, 255)
WINE = (95, 31, 24, 255)
COPPER = (188, 76, 54, 255)


def scaled_font(size: float, *, song: bool = False, scale: int = S) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SONGTI if song else PING), max(1, round(size * scale)), index=0)


def center_text(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...] | int,
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, ...] | int | None = None,
) -> None:
    box = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke_width)
    x = center[0] - (box[2] - box[0]) / 2 - box[0]
    y = center[1] - (box[3] - box[1]) / 2 - box[1]
    draw.text(
        (round(x), round(y)),
        text,
        font=text_font,
        fill=fill,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill if stroke_fill is not None else fill,
    )


def vertical_gradient(
    size: tuple[int, int],
    top: tuple[int, int, int, int],
    bottom: tuple[int, int, int, int],
) -> Image.Image:
    column = Image.new("RGBA", (1, size[1]))
    column.putdata(
        [
            tuple(
                round(top[index] * (1.0 - ratio) + bottom[index] * ratio)
                for index in range(4)
            )
            for y in range(size[1])
            for ratio in (y / max(1, size[1] - 1),)
        ]
    )
    return column.resize(size)


def metal_text(image: Image.Image, text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int]) -> None:
    mask = Image.new("L", image.size, 0)
    center_text(ImageDraw.Draw(mask), center, text, text_font, 255)
    edge = mask.filter(ImageFilter.MaxFilter(S * 2 + 1))
    glow = edge.filter(ImageFilter.GaussianBlur(1.2 * S))
    glow_layer = Image.new("RGBA", image.size, (188, 105, 29, 0))
    glow_layer.putalpha(glow.point(lambda value: round(value * 0.12)))
    image.alpha_composite(glow_layer)
    outline = Image.new("RGBA", image.size, (45, 25, 8, 0))
    outline.putalpha(edge)
    image.alpha_composite(outline)
    metal = vertical_gradient(image.size, GOLD_HI, GOLD_MID)
    metal.putalpha(mask)
    image.alpha_composite(metal)
    highlight = ImageChops.subtract(mask, ImageChops.offset(mask, S, S))
    shine = Image.new("RGBA", image.size, (255, 252, 225, 0))
    shine.putalpha(highlight)
    image.alpha_composite(shine)


def meta_size(path: Path) -> tuple[int, int]:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    return int(meta["width"]), int(meta["height"])


def meta_trim(path: Path) -> tuple[int, int, int, int]:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    sub_meta = next(iter(meta["subMetas"].values()))
    return (
        int(sub_meta["trimX"]),
        int(sub_meta["trimY"]),
        int(sub_meta["width"]),
        int(sub_meta["height"]),
    )


def ensure_full_trim_metadata(path: Path) -> None:
    """Keep the original full-canvas SpriteFrame contract after live reimport."""
    meta_path = path.with_suffix(path.suffix + ".meta")
    original = meta_path.read_text(encoding="utf-8")
    meta = json.loads(original)
    width, height = int(meta["width"]), int(meta["height"])
    sub_meta = next(iter(meta["subMetas"].values()))
    expected = {
        "trimX": 0,
        "trimY": 0,
        "width": width,
        "height": height,
        "rawWidth": width,
        "rawHeight": height,
        "offsetX": 0,
        "offsetY": 0,
    }
    changed = False
    for key, value in expected.items():
        if sub_meta.get(key) != value:
            sub_meta[key] = value
            changed = True
    if changed:
        suffix = "\n" if original.endswith("\n") else ""
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + suffix, encoding="utf-8")


def save_asset(path: Path, image: Image.Image) -> Path:
    ensure_full_trim_metadata(path)
    expected = meta_size(path)
    image = image.convert("RGBA")
    if image.size != expected:
        image = image.resize(expected, Image.Resampling.LANCZOS)
    x, y, width, height = meta_trim(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", expected, 0)
    clipped.paste(alpha.crop((x, y, x + width, y + height)), (x, y))
    image.putalpha(clipped)
    pixels = image.load()
    for px, py in ((x, y), (x + width - 1, y), (x, y + height - 1), (x + width - 1, y + height - 1)):
        red, green, blue, alpha_value = pixels[px, py]
        if alpha_value < 8:
            pixels[px, py] = (max(red, 74), max(green, 44), max(blue, 16), 8)
    image.save(path, format="PNG", compress_level=9)
    return path


def lacquer(size: tuple[int, int], *, brightness: float = 0.35) -> Image.Image:
    if not SOURCE.exists():
        raise RuntimeError(f"Missing generated material source: {SOURCE}")
    image = ImageOps.fit(Image.open(SOURCE).convert("RGB"), size, Image.Resampling.LANCZOS)
    image = ImageEnhance.Color(image).enhance(0.26)
    image = ImageEnhance.Contrast(image).enhance(0.72)
    image = ImageEnhance.Brightness(image).enhance(brightness)
    return image.convert("RGBA")


def draw_diamond(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int, *, fill=GOLD) -> None:
    draw.polygon(((x, y - radius), (x + radius, y), (x, y + radius), (x - radius, y)), fill=fill)


def make_panel() -> Path:
    size = meta_size(PANEL)
    panel = Image.new("RGBA", size, (0, 0, 0, 0))
    base = lacquer(size, brightness=0.30)
    base.alpha_composite(vertical_gradient(size, (21, 16, 10, 85), (2, 2, 2, 180)))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((2, 2, size[0] - 3, size[1] - 3), radius=24, fill=255)
    base.putalpha(mask)
    panel.alpha_composite(base)

    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((2, 2, 620, 877), radius=24, outline=GOLD_DARK, width=5)
    draw.rounded_rectangle((7, 7, 615, 872), radius=19, outline=GOLD, width=1)
    draw.rounded_rectangle((11, 11, 611, 868), radius=16, outline=(255, 234, 174, 74), width=1)

    # Clear title rail and a single calm profile bay.  Repeated Qin motifs are
    # deliberately avoided so avatar, switches and prop art stay readable.
    draw.rounded_rectangle((18, 18, 604, 108), radius=14, fill=(7, 6, 4, 238), outline=(137, 87, 32, 105), width=1)
    draw.line((56, 111, 567, 111), fill=(202, 143, 55, 105), width=1)
    draw.line((112, 115, 511, 115), fill=(255, 230, 164, 34), width=1)
    draw_diamond(draw, 311, 113, 4)

    draw.rounded_rectangle((25, 126, 598, 342), radius=15, fill=(3, 3, 3, 174), outline=(174, 112, 38, 35), width=1)
    draw.line((51, 343, 572, 343), fill=(191, 127, 44, 58), width=1)

    # The separate statistics and prop-card sprites provide the lower visual
    # hierarchy; only one quiet vertical guide is kept behind them.
    draw.line((22, 360, 22, 842), fill=(190, 127, 43, 32), width=1)
    draw.line((600, 360, 600, 842), fill=(190, 127, 43, 32), width=1)
    draw.line((178, 860, 445, 860), fill=(203, 146, 57, 44), width=1)
    draw_diamond(draw, 311, 860, 3)
    return save_asset(PANEL, panel)


def make_title() -> Path:
    width, height = meta_size(TITLE)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((2 * S, 19 * S, 15 * S, 19 * S), fill=GOLD_MID, width=S)
    draw.line(((width - 15) * S, 19 * S, (width - 2) * S, 19 * S), fill=GOLD_MID, width=S)
    draw_diamond(draw, 9 * S, 19 * S, 2 * S)
    draw_diamond(draw, (width - 9) * S, 19 * S, 2 * S)
    metal_text(image, "玩家信息", scaled_font(25, song=True), (width * S // 2, height * S // 2))
    return save_asset(TITLE, image.resize((width, height), Image.Resampling.LANCZOS))


def rounded_button(path: Path, text: str, icon: str) -> Path:
    width, height = meta_size(path)
    canvas = (width * S, height * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    box = (2 * S, 2 * S, (width - 3) * S, (height - 3) * S)
    draw.rounded_rectangle(box, radius=22 * S, fill=(5, 5, 4, 248), outline=GOLD_DARK, width=3 * S)
    draw.rounded_rectangle((5 * S, 5 * S, (width - 6) * S, (height - 6) * S), radius=19 * S, outline=GOLD, width=S)
    draw.line((19 * S, 9 * S, (width - 19) * S, 9 * S), fill=(255, 238, 185, 96), width=S)
    draw.line((19 * S, (height - 9) * S, (width - 19) * S, (height - 9) * S), fill=(99, 57, 19, 160), width=S)

    cx, cy = 34 * S, height * S // 2
    line = GOLD_HI
    if icon == "voice":
        draw.polygon(((23 * S, cy - 5 * S), (29 * S, cy - 5 * S), (37 * S, cy - 12 * S), (37 * S, cy + 12 * S), (29 * S, cy + 5 * S), (23 * S, cy + 5 * S)), fill=line)
        draw.arc((34 * S, cy - 12 * S, 51 * S, cy + 12 * S), -58, 58, fill=line, width=2 * S)
        draw.arc((36 * S, cy - 17 * S, 58 * S, cy + 17 * S), -58, 58, fill=GOLD, width=S)
        text_center = (126 * S, cy)
    else:
        draw.rounded_rectangle((21 * S, cy - 7 * S, 48 * S, cy + 14 * S), radius=2 * S, outline=line, width=2 * S)
        draw.rectangle((19 * S, cy - 12 * S, 50 * S, cy - 5 * S), outline=line, width=2 * S)
        draw.line((35 * S, cy - 12 * S, 35 * S, cy + 14 * S), fill=GOLD, width=2 * S)
        draw.arc((25 * S, cy - 22 * S, 35 * S, cy - 9 * S), 185, 356, fill=line, width=2 * S)
        draw.arc((35 * S, cy - 22 * S, 45 * S, cy - 9 * S), 185, 356, fill=line, width=2 * S)
        text_center = (121 * S, cy)

    metal_text(image, text, scaled_font(22), text_center)
    return save_asset(path, image.resize((width, height), Image.Resampling.LANCZOS))


def make_vip() -> Path:
    width, height = meta_size(VIP)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((S, S, (width - 2) * S, (height - 2) * S), radius=14 * S, fill=(24, 9, 7, 250), outline=GOLD_MID, width=2 * S)
    draw.rounded_rectangle((4 * S, 4 * S, (width - 5) * S, (height - 5) * S), radius=11 * S, fill=WINE, outline=(255, 218, 137, 118), width=S)
    draw.line((15 * S, 6 * S, (width - 15) * S, 6 * S), fill=(255, 225, 155, 90), width=S)
    metal_text(image, "开通VIP", scaled_font(16), (width * S // 2, height * S // 2))
    return save_asset(VIP, image.resize((width, height), Image.Resampling.LANCZOS))


def make_voice_chat() -> Path:
    width, height = meta_size(VOICE_CHAT)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    metal_text(image, "语音聊天", scaled_font(20), (width * S // 2, height * S // 2))
    return save_asset(VOICE_CHAT, image.resize((width, height), Image.Resampling.LANCZOS))


def make_stats() -> Path:
    width, height = meta_size(STATS)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    base = ImageOps.fit(lacquer((width, height), brightness=0.28), (width * S, height * S), Image.Resampling.LANCZOS)
    base.alpha_composite(vertical_gradient(base.size, (16, 12, 7, 82), (1, 1, 1, 154)))
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((2 * S, 18 * S, (width - 3) * S, (height - 3) * S), radius=18 * S, fill=255)
    base.putalpha(mask)
    image.alpha_composite(base)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 18 * S, (width - 3) * S, (height - 3) * S), radius=18 * S, outline=GOLD_DARK, width=3 * S)
    draw.rounded_rectangle((6 * S, 22 * S, (width - 7) * S, (height - 7) * S), radius=14 * S, outline=GOLD, width=S)
    for x in (187, 374):
        draw.line((x * S, 37 * S, x * S, (height - 22) * S), fill=(178, 118, 41, 54), width=S)
    for y in (100, 155):
        draw.line((22 * S, y * S, (width - 22) * S, y * S), fill=(207, 145, 51, 62), width=S)
    draw.line((70 * S, 31 * S, (width - 70) * S, 31 * S), fill=(255, 231, 169, 42), width=S)
    draw_diamond(draw, width * S // 2, 31 * S, 3 * S)
    return save_asset(STATS, image.resize((width, height), Image.Resampling.LANCZOS))


def make_stat_label(path: Path, text: str) -> Path:
    width, height = meta_size(path)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    size = 16.5 if len(text) >= 5 else 18
    metal_text(image, text, scaled_font(size), (width * S // 2, height * S // 2))
    return save_asset(path, image.resize((width, height), Image.Resampling.LANCZOS))


def make_prop_card() -> Path:
    width, height = meta_size(PROP_CARD)
    image = Image.new("RGBA", (width * S, height * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2 * S, 2 * S, (width - 3) * S, (height - 3) * S), radius=13 * S, fill=(4, 4, 3, 248), outline=GOLD_DARK, width=3 * S)
    draw.rounded_rectangle((5 * S, 5 * S, (width - 6) * S, 96 * S), radius=10 * S, fill=(14, 11, 7, 244), outline=(221, 169, 75, 160), width=S)
    draw.ellipse((32 * S, 15 * S, (width - 32) * S, 82 * S), fill=(100, 62, 22, 20))
    draw.rounded_rectangle((5 * S, 99 * S, (width - 6) * S, (height - 6) * S), radius=8 * S, fill=(16, 11, 6, 252), outline=(182, 119, 39, 148), width=S)
    draw.line((18 * S, 102 * S, (width - 18) * S, 102 * S), fill=(255, 229, 164, 52), width=S)
    draw_diamond(draw, width * S // 2, 6 * S, 2 * S)
    return save_asset(PROP_CARD, image.resize((width, height), Image.Resampling.LANCZOS))


def build_assets() -> list[Path]:
    if set(TARGETS) & set(PROP_IMAGES):
        raise RuntimeError("Prop artwork must never be a panelUserInfo generator target")
    outputs = [make_panel(), make_title(), make_vip()]
    outputs.extend((rounded_button(VOICE, "语音回放", "voice"), rounded_button(GIFT, "赠送", "gift")))
    outputs.extend((make_voice_chat(), make_stats(), make_prop_card()))
    outputs.extend(make_stat_label(path, text) for path, text in STAT_LABELS)
    if set(outputs) != set(TARGETS):
        raise RuntimeError("panelUserInfo target/output mismatch")
    return outputs


def paste_center(canvas: Image.Image, source: Image.Image, center: tuple[float, float], size: tuple[int, int] | None = None) -> None:
    source = source.convert("RGBA")
    if size is not None and source.size != size:
        source = source.resize(size, Image.Resampling.LANCZOS)
    x = round(center[0] - source.width / 2)
    y = round(center[1] - source.height / 2)
    canvas.alpha_composite(source, (x, y))


def render_preview() -> Path:
    canvas = ImageOps.fit(Image.open(SOURCE).convert("RGB"), (750, 1334), Image.Resampling.LANCZOS).convert("RGBA")
    canvas = ImageEnhance.Brightness(canvas).enhance(0.42)
    canvas.alpha_composite(Image.new("RGBA", canvas.size, (0, 0, 0, 96)))

    # Root world position and anchor are preserved by the original prefab.  In
    # top-left image coordinates its local origin is (443, 649).
    root_x, root_y = 443.0, 649.0
    paste_center(canvas, Image.open(PANEL), (root_x - 54, root_y + 27))
    paste_center(canvas, Image.open(TITLE), (root_x - 54, root_y - (-27 + 378.69)))

    data_x, data_y = root_x - 52, root_y + 29
    paste_center(canvas, Image.open(COMMON / "头像2.png"), (data_x - 149, data_y - 241.908), (147, 147))
    paste_center(canvas, Image.open(OTHER / "默认头像.png"), (data_x - 149, data_y - 241.908), (133, 133))
    paste_center(canvas, Image.open(VIP), (data_x - 149, data_y - (241.908 - 55.483)))
    paste_center(canvas, Image.open(VOICE), (data_x + 145, data_y - 218.818))
    paste_center(canvas, Image.open(GIFT), (data_x + 145, data_y - 136.826))
    paste_center(canvas, Image.open(KK_COMMON / "充值.png"), (data_x + 207.897, data_y - 473.624))
    paste_center(canvas, Image.open(VOICE_CHAT), (data_x + 181.165 - 119.409, data_y - 305.258))
    paste_center(canvas, Image.open(SETTINGS / "关.png"), (data_x + 181.165, data_y - 305.258), (130, 43))

    draw = ImageDraw.Draw(canvas)
    draw.text((data_x - 206.279 - 17, data_y - 144.175 - 13), "ID:", font=scaled_font(24, scale=1), fill=GOLD)
    draw.text((data_x - 168.75 - 5, data_y - 144.175 - 13), "100086", font=scaled_font(24, scale=1), fill=IVORY)
    center_text(draw, (data_x - 147.154, data_y - 107.015), "秦风玩家", scaled_font(24, scale=1), GOLD_HI)

    stats_center = (data_x, data_y + 14.245)
    paste_center(canvas, Image.open(STATS), stats_center)
    label_positions = (
        (-203.839, 53.071), (-17.362, 53.071), (153.195, 53.071),
        (-206.251, 0), (-21.711, 0), (154.387, 0),
        (-203.839, -56.689), (-20.505, -56.689), (150.768, -56.689),
    )
    value_positions = (
        (-150.168, 53.071), (31.181, 53.071), (204.007, 53.071),
        (-148.097, 0), (32.331, 0), (204.81, 0),
        (-149.372, -56.689), (32.756, -56.689), (204.89, -56.689),
    )
    values = ("128", "63%", "21%", "81", "20", "27", "54%", "72%", "68%")
    for (path, _), position in zip(STAT_LABELS, label_positions):
        paste_center(canvas, Image.open(path), (stats_center[0] + position[0], stats_center[1] - position[1]))
    for index, (value, position) in enumerate(zip(values, value_positions)):
        colour = COPPER if index in (2, 5) else IVORY
        center_text(draw, (stats_center[0] + position[0], stats_center[1] - position[1]), value, scaled_font(22, scale=1), colour)

    props_origin = (data_x + 24.98, data_y + 261.808)
    prop_specs = (
        (-200.5, 93, INTERACTION / "吻.png"),
        (-31.5, 93, INTERACTION / "鸡.png"),
        (137.5, 93, INTERACTION / "啤酒.png"),
        (-200.5, -93, INTERACTION / "拇指.png"),
        (-31.5, -93, INTERACTION / "炸弹.png"),
        (137.5, -93, INTERACTION / "枪.png"),
    )
    for x, y, icon_path in prop_specs:
        center = (props_origin[0] + x, props_origin[1] - y)
        paste_center(canvas, Image.open(PROP_CARD), center)
        paste_center(canvas, Image.open(icon_path), (center[0], center[1] - 14.043))
        center_text(draw, (center[0], center[1] + 43.982), "0.1", scaled_font(25, scale=1), GOLD)

    ART.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(PREVIEW, format="PNG", compress_level=9)
    return PREVIEW


def main() -> None:
    outputs = build_assets()
    preview = render_preview()
    print(f"Generated {len(outputs)} panelUserInfo assets")
    print(f"Preview: {preview.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
