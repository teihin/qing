#!/usr/bin/env python3
"""Generate the deterministic UI slices for the Qin login skin."""

from __future__ import annotations

import argparse
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


SCALE = 4
ROOT = Path(__file__).resolve().parents[1]
LOGIN_DIR = ROOT / "assets" / "ImagesLuck" / "登陆"
ART_DIR = ROOT / "art_sources" / "login"
PING_FONT = ROOT / "assets" / "font" / "PingFF.ttf"
HEITI_FONT = Path("/System/Library/Fonts/STHeiti Medium.ttc")
SONGTI_FONT = Path("/System/Library/Fonts/Supplemental/Songti.ttc")
LATIN_FONT = Path("/System/Library/Fonts/Supplemental/Times New Roman.ttf")
LOGIN_LOGO_SOURCE = ART_DIR / "qin_login_logo_final_source.png"


def sc(value: float) -> int:
    return round(value * SCALE)


def font(path: Path, size: float, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), sc(size), index=index)


def vertical_gradient(size: tuple[int, int], top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    width, height = size
    channels = len(top)
    image = Image.new("RGBA" if channels == 4 else "RGB", size)
    pixels = image.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(channels))
        for x in range(width):
            pixels[x, y] = color
    return image


def rounded_mask(size: tuple[int, int], box: tuple[int, int, int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def gold_gradient(size: tuple[int, int]) -> Image.Image:
    return vertical_gradient(size, (255, 241, 183, 255), (132, 72, 18, 255))


def text_mask(size: tuple[int, int], text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int], stroke: int = 0) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    bbox = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke)
    x = center[0] - (bbox[2] - bbox[0]) // 2 - bbox[0]
    y = center[1] - (bbox[3] - bbox[1]) // 2 - bbox[1]
    draw.text((x, y), text, font=text_font, fill=255, stroke_width=stroke, stroke_fill=255)
    return mask


def paste_metal_text(image: Image.Image, text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int], stroke: int = 2) -> None:
    size = image.size
    fill_mask = text_mask(size, text, text_font, center)
    stroke_mask = text_mask(size, text, text_font, center, sc(stroke))
    shadow = stroke_mask.filter(ImageFilter.GaussianBlur(sc(8)))
    shadow_layer = Image.new("RGBA", size, (0, 0, 0, 210))
    shadow_layer.putalpha(shadow.point(lambda p: round(p * 0.82)))
    image.alpha_composite(shadow_layer)

    outline = Image.new("RGBA", size, (38, 20, 6, 0))
    outline.putalpha(stroke_mask)
    image.alpha_composite(outline)

    metal = gold_gradient(size)
    random.seed(20260722)
    noise = Image.new("L", size, 0)
    noise_pixels = noise.load()
    for y in range(max(0, center[1] - sc(150)), min(size[1], center[1] + sc(150))):
        for x in range(max(0, center[0] - sc(160)), min(size[0], center[0] + sc(160))):
            noise_pixels[x, y] = random.randint(0, 24)
    sheen = Image.new("RGBA", size, (255, 255, 255, 0))
    sheen.putalpha(ImageChops.multiply(fill_mask, noise))
    metal.putalpha(fill_mask)
    image.alpha_composite(metal)
    image.alpha_composite(sheen)

    highlight = ImageChops.subtract(fill_mask, ImageChops.offset(fill_mask, sc(1), sc(2)))
    highlight_layer = Image.new("RGBA", size, (255, 248, 205, 0))
    highlight_layer.putalpha(highlight)
    image.alpha_composite(highlight_layer)


def draw_letterspaced(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, center_x: int, y: int, spacing: int, fill: tuple[int, int, int, int]) -> None:
    widths = [draw.textlength(char, font=text_font) for char in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = center_x - total / 2
    for char, width in zip(text, widths):
        draw.text((round(x), y), char, font=text_font, fill=fill)
        x += width + spacing


def prepare_background(source_path: Path, clean_source_path: Path | None = None) -> Image.Image:
    source = Image.open(source_path).convert("RGB")
    if clean_source_path is not None:
        clean = Image.open(clean_source_path).convert("RGB")
        if clean.size != source.size:
            clean = ImageOps.fit(clean, source.size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

        # Only inpaint the original medallion area.  Everything outside this
        # feathered mask remains byte-for-byte sourced from the approved image.
        patch_mask = Image.new("L", source.size, 0)
        ImageDraw.Draw(patch_mask).ellipse((120, 20, 820, 760), fill=255)
        patch_mask = patch_mask.filter(ImageFilter.GaussianBlur(42))
        source = Image.composite(clean, source, patch_mask)

    background = ImageOps.fit(source, (750, 1334), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")
    work = background.resize((sc(750), sc(1334)), Image.Resampling.LANCZOS)

    # Darken the control area so foreground components remain readable.
    dark = Image.new("RGBA", work.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(dark)
    for y in range(sc(430), sc(1040)):
        distance = abs(y / SCALE - 710)
        alpha = max(0, round(76 - distance * 0.12))
        d.line((0, y, work.width, y), fill=(0, 0, 0, alpha))
    work.alpha_composite(dark)
    return work


def make_background(source_path: Path, clean_source_path: Path) -> Path:
    work = prepare_background(source_path, clean_source_path)

    result = work.resize((750, 1334), Image.Resampling.LANCZOS).convert("RGB")
    target = LOGIN_DIR / "秦_登录背景.png"
    result.save(target, optimize=True, quality=95)
    return target


def make_logo(source_path: Path) -> Path:
    if LOGIN_LOGO_SOURCE.exists():
        result = Image.open(LOGIN_LOGO_SOURCE).convert("RGBA")
        if result.size != (400, 400):
            result = ImageOps.contain(result, (400, 400), method=Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
            canvas.alpha_composite(result, ((400 - result.width) // 2, (400 - result.height) // 2))
            result = canvas

        target = LOGIN_DIR / "秦_登录LOGO.png"
        result.save(target, optimize=True)
        return target

    work = prepare_background(source_path)

    # Accurate, controllable game mark.  The circle comes from the approved
    # source while the Qin glyph and QIN lettering remain deterministic.
    logo_center = (sc(375), sc(300))
    paste_metal_text(work, "秦", font(SONGTI_FONT, 232), logo_center, stroke=3)
    draw = ImageDraw.Draw(work)
    draw_letterspaced(draw, "QIN", font(LATIN_FONT, 25), sc(375), sc(425), sc(14), (225, 190, 116, 235))

    logo = work.crop((sc(175), sc(118), sc(575), sc(518)))
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).ellipse((sc(12), sc(16), sc(388), sc(392)), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(sc(6)))
    logo.putalpha(mask)
    result = logo.resize((400, 400), Image.Resampling.LANCZOS).convert("RGBA")

    # Keep Creator's serialized 400x400 untrimmed frame stable while the four
    # almost-transparent corner pixels remain visually invisible.
    pixels = result.load()
    for point in ((0, 0), (399, 0), (0, 399), (399, 399)):
        pixels[point] = (32, 22, 10, 8)

    target = LOGIN_DIR / "秦_登录LOGO.png"
    result.save(target, optimize=True)
    return target


def make_input_frame() -> Path:
    size = (sc(573), sc(86))
    image = Image.new("RGBA", size, (0, 0, 0, 0))

    outer_box = (sc(3), sc(4), sc(570), sc(82))
    inner_box = (sc(6), sc(7), sc(567), sc(79))
    outer = rounded_mask(size, outer_box, sc(38))
    inner = rounded_mask(size, inner_box, sc(35))
    border = ImageChops.subtract(outer, inner)

    glow = border.filter(ImageFilter.GaussianBlur(sc(5)))
    glow_layer = Image.new("RGBA", size, (185, 117, 35, 0))
    glow_layer.putalpha(glow.point(lambda p: round(p * 0.34)))
    image.alpha_composite(glow_layer)

    panel = vertical_gradient(size, (25, 21, 16, 246), (4, 4, 4, 246))
    panel.putalpha(inner)
    image.alpha_composite(panel)

    border_fill = vertical_gradient(size, (255, 225, 151, 255), (111, 61, 17, 255))
    border_fill.putalpha(border)
    image.alpha_composite(border_fill)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(inner_box, radius=sc(35), outline=(255, 239, 185, 80), width=sc(1))
    draw.line((sc(184), sc(19), sc(184), sc(67)), fill=(111, 75, 35, 210), width=sc(1))
    draw.line((sc(185), sc(22), sc(185), sc(64)), fill=(255, 222, 146, 75), width=sc(1))
    # Fine corner accents give the frame a crafted, non-generic finish.
    for x1, x2 in ((sc(24), sc(52)), (sc(521), sc(549))):
        draw.line((x1, sc(7), x2, sc(7)), fill=(255, 231, 170, 150), width=sc(1))
        draw.line((x1, sc(79), x2, sc(79)), fill=(132, 79, 24, 155), width=sc(1))

    target = LOGIN_DIR / "秦_输入框.png"
    image.resize((573, 86), Image.Resampling.LANCZOS).save(target, optimize=True)
    return target


def draw_metal_text_small(image: Image.Image, text: str, text_font: ImageFont.FreeTypeFont, center: tuple[int, int]) -> None:
    mask = text_mask(image.size, text, text_font, center)
    metal = vertical_gradient(image.size, (255, 235, 171, 255), (182, 111, 30, 255))
    metal.putalpha(mask)
    image.alpha_composite(metal)


def make_account_label() -> Path:
    size = (sc(107), sc(37))
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    gold = (231, 179, 79, 255)
    draw.ellipse((sc(6), sc(3), sc(19), sc(16)), outline=gold, width=sc(2))
    draw.rounded_rectangle((sc(2), sc(18), sc(23), sc(33)), radius=sc(8), outline=gold, width=sc(2))
    draw_metal_text_small(image, "账号", font(HEITI_FONT, 22), (sc(70), sc(18)))
    target = LOGIN_DIR / "账号.png"
    image.resize((107, 37), Image.Resampling.LANCZOS).save(target, optimize=True)
    return target


def make_password_label() -> Path:
    size = (sc(108), sc(37))
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    gold = (231, 179, 79, 255)
    draw.rounded_rectangle((sc(3), sc(15), sc(24), sc(33)), radius=sc(2), outline=gold, width=sc(2))
    draw.arc((sc(6), sc(2), sc(21), sc(22)), start=180, end=360, fill=gold, width=sc(2))
    draw.ellipse((sc(12), sc(21), sc(15), sc(24)), fill=gold)
    draw.line((sc(13.5), sc(24), sc(13.5), sc(28)), fill=gold, width=sc(1))
    draw_metal_text_small(image, "密码", font(HEITI_FONT, 22), (sc(71), sc(18)))
    target = LOGIN_DIR / "密码.png"
    image.resize((108, 37), Image.Resampling.LANCZOS).save(target, optimize=True)
    return target


def make_clear_button() -> Path:
    size = (sc(45), sc(45))
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((sc(5), sc(5), sc(40), sc(40)), outline=180, width=sc(3))
    glow = glow.filter(ImageFilter.GaussianBlur(sc(3)))
    glow_layer = Image.new("RGBA", size, (205, 139, 48, 0))
    glow_layer.putalpha(glow)
    image.alpha_composite(glow_layer)
    draw.ellipse((sc(5), sc(5), sc(40), sc(40)), fill=(8, 7, 6, 205), outline=(218, 164, 72, 245), width=sc(2))
    draw.line((sc(15), sc(15), sc(30), sc(30)), fill=(247, 218, 151, 255), width=sc(2))
    draw.line((sc(30), sc(15), sc(15), sc(30)), fill=(247, 218, 151, 255), width=sc(2))
    target = LOGIN_DIR / "秦_清除.png"
    image.resize((45, 45), Image.Resampling.LANCZOS).save(target, optimize=True)
    return target


def make_login_button() -> Path:
    size = (sc(365), sc(77))
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    outer_box = (sc(3), sc(4), sc(362), sc(73))
    inner_box = (sc(7), sc(8), sc(358), sc(69))
    outer = rounded_mask(size, outer_box, sc(34))
    inner = rounded_mask(size, inner_box, sc(30))
    border = ImageChops.subtract(outer, inner)

    glow = border.filter(ImageFilter.GaussianBlur(sc(7)))
    glow_layer = Image.new("RGBA", size, (213, 139, 44, 0))
    glow_layer.putalpha(glow.point(lambda p: round(p * 0.45)))
    image.alpha_composite(glow_layer)

    panel = vertical_gradient(size, (52, 36, 17, 252), (8, 7, 6, 252))
    panel.putalpha(inner)
    image.alpha_composite(panel)
    gold = vertical_gradient(size, (255, 238, 177, 255), (139, 74, 17, 255))
    gold.putalpha(border)
    image.alpha_composite(gold)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(inner_box, radius=sc(30), outline=(255, 237, 178, 90), width=sc(1))
    draw.line((sc(74), sc(15), sc(291), sc(15)), fill=(255, 229, 157, 80), width=sc(1))
    draw.line((sc(88), sc(62), sc(277), sc(62)), fill=(117, 67, 22, 160), width=sc(1))
    draw_metal_text_small(image, "登录", font(PING_FONT, 30), (sc(182.5), sc(38)))
    target = LOGIN_DIR / "手机登陆.png"
    image.resize((365, 77), Image.Resampling.LANCZOS).save(target, optimize=True)
    return target


def make_preview(background: Path, logo: Path, input_frame: Path, account: Path, password: Path, clear: Path, button: Path) -> Path:
    preview = Image.open(background).convert("RGBA")
    logo_img = Image.open(logo).convert("RGBA")
    frame = Image.open(input_frame).convert("RGBA")
    account_img = Image.open(account).convert("RGBA")
    password_img = Image.open(password).convert("RGBA")
    clear_img = Image.open(clear).convert("RGBA").resize((37, 37), Image.Resampling.LANCZOS)
    button_img = Image.open(button).convert("RGBA")

    preview.alpha_composite(logo_img, (175, 118))
    input_x = 75
    phone_y = 525
    password_y = 643
    preview.alpha_composite(frame, (input_x, phone_y))
    preview.alpha_composite(frame, (input_x, password_y))
    preview.alpha_composite(account_img, (122, phone_y + 25))
    preview.alpha_composite(password_img, (122, password_y + 25))
    preview.alpha_composite(clear_img, (567, phone_y + 25))
    preview.alpha_composite(clear_img, (567, password_y + 25))
    preview.alpha_composite(button_img, (193, 852))

    draw = ImageDraw.Draw(preview)
    placeholder_font = ImageFont.truetype(str(HEITI_FONT), 20)
    draw.text((303, phone_y + 32), "请输入手机号", font=placeholder_font, fill=(130, 122, 108, 210))
    draw.text((303, password_y + 32), "请输入密码", font=placeholder_font, fill=(130, 122, 108, 210))

    ART_DIR.mkdir(parents=True, exist_ok=True)
    target = ART_DIR / "qin_login_runtime_preview.png"
    preview.convert("RGB").save(target, optimize=True, quality=95)
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--background-source",
        type=Path,
        default=ART_DIR / "qin_login_background_minimal_source.png",
    )
    parser.add_argument(
        "--clean-background-source",
        type=Path,
        default=ART_DIR / "qin_login_background_minimal_source.png",
    )
    args = parser.parse_args()

    LOGIN_DIR.mkdir(parents=True, exist_ok=True)
    background = make_background(args.background_source, args.clean_background_source)
    logo = make_logo(args.background_source)
    input_frame = make_input_frame()
    account = make_account_label()
    password = make_password_label()
    clear = make_clear_button()
    button = make_login_button()
    preview = make_preview(background, logo, input_frame, account, password, clear, button)
    for path in (background, logo, input_frame, account, password, clear, button, preview):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
