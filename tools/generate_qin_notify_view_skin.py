#!/usr/bin/env python3
"""Deterministically rebuild the Qin artwork used by panelNotifyView.

The three notification prefabs share one dedicated panel background and three
title SpriteFrames.  This script only writes those four runtime images plus
static previews; shared buttons, the old generic announcement background,
prefabs, scripts and existing metadata remain read-only inputs.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
NOTICE = ROOT / "assets" / "ImagesLuck" / "公告"
TITLE_DIR = NOTICE / "标题"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
ART = ROOT / "art_sources" / "notify"
SOURCE = ART / "qin_notify_lacquer_source.png"
PING = ROOT / "assets" / "font" / "PingFF.ttf"
SONGTI = Path("/System/Library/Fonts/Supplemental/Songti.ttc")

BACKGROUND = NOTICE / "秦_通知弹窗底.png"
TITLE_SPECS = (
    (TITLE_DIR / "最新公告.png", "最新公告"),
    (TITLE_DIR / "充值公告.png", "充值公告"),
    (TITLE_DIR / "活动公告.png", "活动公告"),
)
TARGETS: tuple[Path, ...] = (BACKGROUND,) + tuple(path for path, _ in TITLE_SPECS)

S = 4
GOLD_HI = (255, 236, 177, 255)
GOLD = (222, 169, 78, 255)
GOLD_MID = (151, 94, 35, 255)
GOLD_DARK = (71, 42, 15, 255)
IVORY = (232, 215, 180, 255)
MUTED = (159, 146, 123, 255)
COPPER = (178, 77, 55, 255)


def font(size: float, *, song: bool = False, scale: int = S) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SONGTI if song else PING), max(1, round(size * scale)), index=0)


def center_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, ...] | int,
    *,
    stroke_width: int = 0,
    stroke_fill: tuple[int, ...] | int | None = None,
) -> None:
    box = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke_width)
    x = xy[0] - (box[2] - box[0]) / 2 - box[0]
    y = xy[1] - (box[3] - box[1]) / 2 - box[1]
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
    values = []
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        values.append(tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4)))
    column.putdata(values)
    return column.resize(size)


def text_mask(
    size: tuple[int, int], text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int], stroke: int = 0
) -> Image.Image:
    mask = Image.new("L", size, 0)
    center_text(ImageDraw.Draw(mask), center, text, text_font, 255, stroke_width=stroke, stroke_fill=255)
    return mask


def metal_text(
    image: Image.Image,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    center: tuple[int, int],
) -> None:
    fill_mask = text_mask(image.size, text, text_font, center)
    edge_mask = text_mask(image.size, text, text_font, center, S)
    aura = edge_mask.filter(ImageFilter.GaussianBlur(1.5 * S))
    glow = Image.new("RGBA", image.size, (191, 111, 28, 0))
    glow.putalpha(aura.point(lambda value: round(value * 0.18)))
    image.alpha_composite(glow)
    outline = Image.new("RGBA", image.size, (43, 24, 8, 0))
    outline.putalpha(edge_mask)
    image.alpha_composite(outline)
    metal = vertical_gradient(image.size, GOLD_HI, GOLD_MID)
    metal.putalpha(fill_mask)
    image.alpha_composite(metal)
    highlight = ImageChops.subtract(fill_mask, ImageChops.offset(fill_mask, S, S))
    shine = Image.new("RGBA", image.size, (255, 249, 220, 0))
    shine.putalpha(highlight)
    image.alpha_composite(shine)


def meta_trim(path: Path) -> tuple[int, int, int, int]:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    sub_meta = next(iter(meta["subMetas"].values()))
    return (
        int(sub_meta["trimX"]),
        int(sub_meta["trimY"]),
        int(sub_meta["width"]),
        int(sub_meta["height"]),
    )


def save_asset(path: Path, image: Image.Image) -> Path:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    size = (int(meta["width"]), int(meta["height"]))
    image = image.convert("RGBA")
    if image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    x, y, width, height = meta_trim(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", size, 0)
    clipped.paste(alpha.crop((x, y, x + width, y + height)), (x, y))
    image.putalpha(clipped)
    pixels = image.load()
    for px, py in ((x, y), (x + width - 1, y), (x, y + height - 1), (x + width - 1, y + height - 1)):
        red, green, blue, alpha_value = pixels[px, py]
        if alpha_value < 8:
            pixels[px, py] = (max(red, 91), max(green, 55), max(blue, 20), 8)
    image.save(path, format="PNG", compress_level=9)
    return path


def draw_diamond(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int) -> None:
    draw.polygon(
        ((x, y - radius), (x + radius, y), (x, y + radius), (x - radius, y)),
        fill=GOLD,
        outline=GOLD_HI,
    )


def make_background() -> Path:
    if not SOURCE.exists():
        raise RuntimeError(f"Missing generated lacquer source: {SOURCE}")

    size = (633, 880)
    source = Image.open(SOURCE).convert("RGB")
    source = ImageOps.fit(source, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    source = ImageEnhance.Color(source).enhance(0.28)
    source = ImageEnhance.Contrast(source).enhance(0.72)
    source = ImageEnhance.Brightness(source).enhance(0.31)
    source = source.filter(ImageFilter.GaussianBlur(1.2)).convert("RGBA")

    # Suppress the source's corner highlights so the dynamic announcement body
    # remains calm and legible; only a faint material shift survives.
    source.alpha_composite(Image.new("RGBA", size, (3, 3, 3, 170)))
    source.alpha_composite(vertical_gradient(size, (20, 16, 11, 62), (2, 2, 2, 145)))

    panel = Image.new("RGBA", size, (0, 0, 0, 0))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((2, 2, 630, 877), radius=17, fill=255)
    source.putalpha(mask)
    panel.alpha_composite(source)

    draw = ImageDraw.Draw(panel)
    draw.rounded_rectangle((2, 2, 630, 877), radius=17, outline=(91, 55, 19, 255), width=4)
    draw.rounded_rectangle((7, 7, 625, 872), radius=13, outline=GOLD, width=1)
    draw.rounded_rectangle((11, 11, 621, 868), radius=10, outline=(255, 229, 163, 86), width=1)

    # Calm title rail and reading bay.  No repeated ornament or dense texture.
    draw.rounded_rectangle((17, 17, 616, 113), radius=11, fill=(8, 7, 5, 244), outline=(121, 76, 28, 100), width=1)
    draw.line((42, 117, 591, 117), fill=(197, 137, 52, 105), width=1)
    draw.line((82, 121, 551, 121), fill=(255, 230, 168, 34), width=1)
    draw_diamond(draw, 316, 119, 4)

    draw.rounded_rectangle((27, 132, 606, 744), radius=11, fill=(3, 3, 3, 248), outline=(180, 117, 40, 29), width=1)
    draw.line((42, 151, 42, 721), fill=(187, 124, 43, 35), width=1)
    draw.line((591, 151, 591, 721), fill=(187, 124, 43, 35), width=1)

    draw.rounded_rectangle((17, 758, 616, 862), radius=12, fill=(8, 7, 5, 244), outline=(128, 79, 28, 58), width=1)
    draw.line((58, 757, 575, 757), fill=(194, 132, 47, 70), width=1)
    draw.line((135, 851, 498, 851), fill=(205, 147, 61, 34), width=1)
    draw_diamond(draw, 316, 851, 3)

    # One restrained seal in the title rail balances the visible close icon.
    draw.ellipse((29, 39, 70, 80), fill=(42, 25, 10, 224), outline=GOLD_MID, width=2)
    draw.ellipse((35, 45, 64, 74), outline=(255, 228, 161, 88), width=1)
    center_text(draw, (49.5, 59.5), "秦", font(17, song=True, scale=1), GOLD_HI, stroke_width=1, stroke_fill=(49, 25, 7, 255))

    return save_asset(BACKGROUND, panel)


def make_title(path: Path, text: str) -> Path:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    size = (int(meta["width"]), int(meta["height"]))
    canvas = (size[0] * S, size[1] * S)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((2 * S, size[1] * S // 2, 13 * S, size[1] * S // 2), fill=GOLD_MID, width=S)
    draw.line(((size[0] - 13) * S, size[1] * S // 2, (size[0] - 2) * S, size[1] * S // 2), fill=GOLD_MID, width=S)
    draw_diamond(draw, 8 * S, size[1] * S // 2, 2 * S)
    draw_diamond(draw, (size[0] - 8) * S, size[1] * S // 2, 2 * S)
    metal_text(image, text, font(23), (size[0] * S // 2, size[1] * S // 2))
    return save_asset(path, image.resize(size, Image.Resampling.LANCZOS))


def build_assets() -> list[Path]:
    outputs = [make_background()]
    outputs.extend(make_title(path, text) for path, text in TITLE_SPECS)
    if set(outputs) != set(TARGETS):
        raise RuntimeError("Notification target/output mismatch")
    return outputs


def paste_center(canvas: Image.Image, source: Image.Image, center: tuple[float, float], size: tuple[int, int] | None = None) -> None:
    source = source.convert("RGBA")
    if size is not None and source.size != size:
        source = source.resize(size, Image.Resampling.LANCZOS)
    x = round(center[0] - source.width / 2)
    y = round(center[1] - source.height / 2)
    canvas.alpha_composite(source, (x, y))


def render_preview(title_path: Path) -> Image.Image:
    background = Image.open(COMMON / "背景.png").convert("RGB")
    canvas = ImageOps.fit(background, (750, 1334), Image.Resampling.LANCZOS).convert("RGBA")
    canvas.alpha_composite(Image.new("RGBA", canvas.size, (0, 0, 0, 155)))

    center = (375, 667)
    paste_center(canvas, Image.open(BACKGROUND), center, (700, 880))
    paste_center(canvas, Image.open(title_path), (375, center[1] - 379))
    paste_center(canvas, Image.open(COMMON / "btn_4.png"), (663, center[1] - 389), (45, 45))
    paste_center(canvas, Image.open(KK_COMMON / "确定.png"), (370, center[1] + 357), (238, 79))

    draw = ImageDraw.Draw(canvas)
    body_font = font(24, scale=1)
    sample_lines = (
        "亲爱的玩家：",
        "",
        "为营造公平、健康的游戏环境，请共同遵守平台规则。",
        "重要信息将通过公告及时发布，请留意内容更新。",
        "",
        "1. 请妥善保管账号信息。",
        "2. 请勿相信任何非官方交易或代充信息。",
        "3. 如遇异常，请通过游戏内客服渠道反馈。",
        "",
        "具体内容以游戏内实时公告为准。",
    )
    x, y = 89, 363
    for line in sample_lines:
        draw.text((x, y), line, font=body_font, fill=IVORY, stroke_width=1, stroke_fill=(18, 13, 7, 180))
        y += 43
    return canvas


def make_previews() -> list[Path]:
    ART.mkdir(parents=True, exist_ok=True)
    previews = [(text, render_preview(path)) for path, text in TITLE_SPECS]
    main_path = ART / "qin_notify_view_runtime_preview.png"
    previews[0][1].save(main_path, format="PNG", compress_level=9)

    thumb_size = (375, 667)
    gap = 28
    sheet = Image.new("RGB", (3 * thumb_size[0] + 4 * gap, thumb_size[1] + 2 * gap + 42), (13, 11, 8))
    draw = ImageDraw.Draw(sheet)
    for index, (label, preview) in enumerate(previews):
        x = gap + index * (thumb_size[0] + gap)
        y = gap + 42
        sheet.paste(preview.convert("RGB").resize(thumb_size, Image.Resampling.LANCZOS), (x, y))
        center_text(draw, (x + thumb_size[0] / 2, 28), label, font(20, scale=1), GOLD_HI, stroke_width=1, stroke_fill=(31, 18, 7))
        draw.rectangle((x - 1, y - 1, x + thumb_size[0], y + thumb_size[1]), outline=(142, 91, 35), width=1)
    states_path = ART / "qin_notify_view_states_preview.png"
    sheet.save(states_path, format="PNG", compress_level=9)
    return [main_path, states_path]


def strong_blue_count(path: Path) -> int:
    count = 0
    with Image.open(path) as source:
        image = source.convert("RGBA")
        pixels = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
        for red, green, blue, alpha in pixels:
            if alpha <= 32:
                continue
            strong_blue = blue > 145 and blue > red * 1.45 and blue > green * 1.15
            strong_cyan = green > 145 and blue > 145 and max(green, blue) > red * 1.6
            if strong_blue or strong_cyan:
                count += 1
    return count


def validate_assets() -> None:
    if len(TARGETS) != 4 or len(set(TARGETS)) != 4:
        raise RuntimeError("Expected four unique notification targets")
    for path in TARGETS:
        meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
        sub_meta = next(iter(meta["subMetas"].values()))
        with Image.open(path) as source:
            source.load()
            if source.mode != "RGBA":
                raise RuntimeError(f"Target must be RGBA: {path}")
            size = source.size
            bbox = source.getchannel("A").getbbox()
        expected_size = (int(meta["width"]), int(meta["height"]))
        expected_bbox = (
            int(sub_meta["trimX"]),
            int(sub_meta["trimY"]),
            int(sub_meta["trimX"]) + int(sub_meta["width"]),
            int(sub_meta["trimY"]) + int(sub_meta["height"]),
        )
        if size != expected_size or bbox != expected_bbox:
            raise RuntimeError(f"PNG/meta mismatch: {path}: size={size}, bbox={bbox}")
        if strong_blue_count(path):
            raise RuntimeError(f"Strong blue/cyan remains: {path}")


def digest(paths: tuple[Path, ...] | list[Path]) -> dict[str, str]:
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def meta_digest() -> dict[str, str]:
    return digest([path.with_suffix(path.suffix + ".meta") for path in TARGETS])


def main() -> None:
    meta_before = meta_digest()
    build_assets()
    previews = make_previews()
    validate_assets()
    first = digest(list(TARGETS) + previews)
    build_assets()
    previews = make_previews()
    validate_assets()
    second = digest(list(TARGETS) + previews)
    if first != second:
        changed = sorted(path for path in first if first[path] != second.get(path))
        raise RuntimeError(f"Generation is not deterministic: {changed}")
    if meta_before != meta_digest():
        raise RuntimeError("A notification .meta file changed during generation")
    print("Generated 4 panelNotifyView Qin assets (two identical passes).")
    for path in TARGETS:
        print(path.relative_to(ROOT))
    print("Previews:")
    for path in previews:
        print(path.relative_to(ROOT))
    print("Validation: size/RGBA/meta trim/blue-cyan/deterministic hash passed")


if __name__ == "__main__":
    main()
