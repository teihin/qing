#!/usr/bin/env python3
"""Generate the small deterministic art set used by the V7 startup loaders.

The approved V7 casino background and shield remain source assets.  This tool
only draws clean stretchable panels, a progress treatment and static art text;
the real loading percentage and status remain native Cocos nodes.
"""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/resources/V7"
WEB_SPLASH = ROOT / "build-templates/web-mobile/splash.png"
PREVIEW = ROOT / "design-previews/2026-09-06-V7启动加载界面效果图-v1"
FONT = ROOT / "assets/font/PingFF.ttf"
SS = 4

GOLD = (226, 196, 143, 255)
GOLD_HI = (250, 229, 187, 255)
GOLD_DARK = (121, 87, 48, 255)
NAVY = (2, 25, 45, 255)
BLUE_TOP = (23, 77, 112, 252)
BLUE_BOTTOM = (4, 34, 60, 254)
COOL = (142, 183, 196, 220)


def stable_uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.UUID("97e123aa-a58e-4b35-bbdc-1cc4802cf293"), name))


def write_meta(path: Path, sliced: bool = False) -> None:
    with Image.open(path) as im:
        width, height = im.size
    border = min(24, width // 4, height // 4) if sliced else 0
    raw_uuid = stable_uuid("raw:" + path.name)
    frame_uuid = stable_uuid("sprite:" + path.name)
    meta = {
        "ver": "2.3.7",
        "uuid": raw_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": width,
        "height": height,
        "platformSettings": {},
        "subMetas": {
            path.stem: {
                "ver": "1.0.6",
                "uuid": frame_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": raw_uuid,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": width,
                "height": height,
                "rawWidth": width,
                "rawHeight": height,
                "borderTop": border,
                "borderBottom": border,
                "borderLeft": border,
                "borderRight": border,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def save(im: Image.Image, name: str, sliced: bool = False) -> Image.Image:
    path = OUT / name
    im.save(path, optimize=True)
    write_meta(path, sliced=sliced)
    return im


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * SS)


def gradient(size: tuple[int, int], top: tuple[int, ...], bottom: tuple[int, ...]) -> Image.Image:
    width, height = size
    result = Image.new("RGBA", size)
    draw = ImageDraw.Draw(result)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        draw.line((0, y, width, y), fill=color)
    return result


def rounded_panel(size: tuple[int, int], radius: int = 22) -> Image.Image:
    width, height = size
    W, H = width * SS, height * SS
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS), radius * SS, fill=255)
    fill = gradient((W, H), BLUE_TOP, BLUE_BOTTOM)
    result = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = mask.filter(ImageFilter.GaussianBlur(7 * SS))
    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow_layer.putalpha(shadow.point(lambda value: value * 95 // 255))
    result.alpha_composite(shadow_layer)
    result.paste(fill, (0, 0), mask)
    draw = ImageDraw.Draw(result)
    box = (3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS)
    draw.rounded_rectangle(box, radius * SS, outline=GOLD_DARK, width=2 * SS)
    draw.rounded_rectangle((5 * SS, 5 * SS, W - 5 * SS, H - 5 * SS), (radius - 2) * SS,
                           outline=COOL, width=1 * SS)
    draw.arc((8 * SS, 8 * SS, W - 8 * SS, H - 8 * SS), 195, 344,
             fill=(230, 241, 239, 145), width=1 * SS)
    return result.resize(size, Image.Resampling.LANCZOS)


def art_text(text: str, size: tuple[int, int], font_size: int, tracking: int = 0) -> Image.Image:
    W, H = size[0] * SS, size[1] * SS
    result = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    fnt = font(font_size)
    if tracking <= 0:
        draw.text((W // 2 + SS, H // 2 + 2 * SS), text, font=fnt, anchor="mm",
                  fill=(0, 8, 17, 150), stroke_width=SS, stroke_fill=(0, 8, 17, 150))
        draw.text((W // 2, H // 2), text, font=fnt, anchor="mm",
                  fill=GOLD_HI, stroke_width=SS, stroke_fill=GOLD_DARK)
    else:
        widths = [draw.textlength(ch, font=fnt) for ch in text]
        total = sum(widths) + tracking * SS * max(0, len(text) - 1)
        x = (W - total) / 2
        for ch, char_width in zip(text, widths):
            draw.text((x + SS, H // 2 + 2 * SS), ch, font=fnt, anchor="lm", fill=(0, 8, 17, 150))
            draw.text((x, H // 2), ch, font=fnt, anchor="lm", fill=GOLD_HI,
                      stroke_width=SS, stroke_fill=GOLD_DARK)
            x += char_width + tracking * SS
    return result.resize(size, Image.Resampling.LANCZOS)


def make_progress() -> None:
    track = rounded_panel((600, 30), radius=15)
    save(track, "startup_progress_track_exact.png", sliced=True)

    W, H = 594 * SS, 20 * SS
    fill = gradient((W, H), (255, 235, 190, 255), (190, 143, 77, 255))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), 10 * SS, fill=255)
    result = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    result.paste(fill, (0, 0), mask)
    draw = ImageDraw.Draw(result)
    draw.line((10 * SS, 3 * SS, W - 10 * SS, 3 * SS), fill=(255, 250, 229, 200), width=SS)
    save(result.resize((594, 20), Image.Resampling.LANCZOS),
         "startup_progress_fill_exact.png", sliced=True)


def make_spinner() -> None:
    size = 160
    result = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    cx = cy = size * SS / 2
    for index in range(12):
        angle = math.radians(index * 30 - 90)
        alpha = 65 + index * 15
        radius = 58 * SS
        x = cx + math.cos(angle) * radius
        y = cy + math.sin(angle) * radius
        tangent = angle + math.pi / 2
        dx = math.cos(tangent) * 5 * SS
        dy = math.sin(tangent) * 5 * SS
        color = (247, 222, 176, min(255, alpha))
        draw.line((x - dx, y - dy, x + dx, y + dy), fill=color, width=7 * SS)
    draw.ellipse((52 * SS, 52 * SS, 108 * SS, 108 * SS), outline=(142, 183, 196, 165), width=2 * SS)
    # A small spade at the center keeps the loader visibly part of the 8L family.
    draw.polygon([(80 * SS, 59 * SS), (63 * SS, 80 * SS), (80 * SS, 99 * SS), (97 * SS, 80 * SS)],
                 fill=GOLD_HI)
    draw.ellipse((62 * SS, 73 * SS, 82 * SS, 93 * SS), fill=GOLD_HI)
    draw.ellipse((78 * SS, 73 * SS, 98 * SS, 93 * SS), fill=GOLD_HI)
    draw.polygon([(80 * SS, 86 * SS), (72 * SS, 108 * SS), (88 * SS, 108 * SS)], fill=GOLD_HI)
    save(result.resize((size, size), Image.Resampling.LANCZOS), "startup_loading_ring_exact.png")


def make_retry_assets() -> None:
    panel = rounded_panel((560, 360), radius=28)
    draw = ImageDraw.Draw(panel)
    # Panel title is static art; the actual error reason remains a live label.
    title = art_text("连接提示", (250, 58), 34, tracking=2)
    panel.alpha_composite(title, ((560 - 250) // 2, 28))
    draw.line((65, 98, 495, 98), fill=(174, 136, 79, 155), width=1)
    save(panel, "startup_retry_panel_exact.png", sliced=True)

    button = rounded_panel((300, 84), radius=20)
    button.alpha_composite(art_text("重新连接", (270, 68), 31, tracking=1), (15, 8))
    save(button, "startup_retry_button_exact.png", sliced=True)

    save(rounded_panel((260, 210), radius=24), "startup_loading_card_exact.png", sliced=True)


def make_web_splash() -> None:
    shield = Image.open(OUT / "shield_hd.png").convert("RGBA")
    bbox = shield.getbbox()
    if bbox:
        shield = shield.crop(bbox)
    shield.thumbnail((220, 232), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    alpha = shield.getchannel("A")
    shadow = alpha.filter(ImageFilter.GaussianBlur(7))
    shadow_layer = Image.new("RGBA", shield.size, (0, 7, 18, 160))
    shadow_layer.putalpha(shadow.point(lambda value: value * 150 // 255))
    x = (256 - shield.width) // 2
    y = (256 - shield.height) // 2
    result.alpha_composite(shadow_layer, (x + 2, y + 5))
    result.alpha_composite(shield, (x, y))
    WEB_SPLASH.parent.mkdir(parents=True, exist_ok=True)
    result.save(WEB_SPLASH, optimize=True)


def make_preview() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    bg = Image.open(OUT / "announcement_detail_bg_long_exact.png").convert("RGB").crop((0, 0, 750, 1334)).convert("RGBA")
    shield = Image.open(OUT / "shield_hd.png").convert("RGBA")
    shield.thumbnail((340, 358), Image.Resampling.LANCZOS)
    bg.alpha_composite(shield, ((750 - shield.width) // 2, 170))
    title = Image.open(OUT / "startup_title_exact.png").convert("RGBA")
    subtitle = Image.open(OUT / "startup_subtitle_exact.png").convert("RGBA")
    rule = Image.open(OUT / "register_header_rule_exact.png").convert("RGBA")
    bg.alpha_composite(title, ((750 - title.width) // 2, 580))
    bg.alpha_composite(subtitle, ((750 - subtitle.width) // 2, 645))
    bg.alpha_composite(rule, ((750 - rule.width) // 2, 684))
    track = Image.open(OUT / "startup_progress_track_exact.png").convert("RGBA")
    fill = Image.open(OUT / "startup_progress_fill_exact.png").convert("RGBA").crop((0, 0, 356, 20))
    bg.alpha_composite(track, (75, 982))
    bg.alpha_composite(fill, (78, 987))
    draw = ImageDraw.Draw(bg)
    fnt = ImageFont.truetype(str(FONT), 30)
    small = ImageFont.truetype(str(FONT), 23)
    draw.text((375, 932), "60%", font=fnt, anchor="mm", fill=GOLD_HI,
              stroke_width=1, stroke_fill=GOLD_DARK)
    draw.text((375, 1058), "正在检查资源完整性", font=small, anchor="mm", fill=GOLD)
    tip = Image.open(OUT / "startup_tip_exact.png").convert("RGBA")
    bg.alpha_composite(tip, ((750 - tip.width) // 2, 1182))
    bg.convert("RGB").save(PREVIEW / "01-启动加载-750x1334.png", quality=95)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save(art_text("正在进入游戏", (430, 68), 40, tracking=2), "startup_title_exact.png")
    save(art_text("SECURE CONNECTION · RESOURCE LOADING", (520, 36), 18, tracking=0),
         "startup_subtitle_exact.png")
    save(art_text("安全校验 · 高清资源加载", (420, 38), 21, tracking=1), "startup_tip_exact.png")
    make_progress()
    make_spinner()
    make_retry_assets()
    make_web_splash()
    make_preview()


if __name__ == "__main__":
    main()
