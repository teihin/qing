#!/usr/bin/env python3
"""Extract the approved V7 in-room menu art and matching shortcut icons.

The menu title, lettering and menu icons come directly from the confirmed
effect image.  Only the clean fixed panel surface and circular icon plates are
reconstructed so no sample text or coloured button remains baked into a
dynamic state.
"""

from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    ROOT
    / "design-previews"
    / "2026-09-07-V7桌内统一风格重设计-v6"
    / "01-左上角小型牌局菜单.png"
)
PLAYER_SOURCE = (
    ROOT
    / "design-previews"
    / "2026-09-07-V7桌内统一风格重设计-v6"
    / "05-玩家信息弹窗.png"
)
OUT = ROOT / "assets" / "resources" / "V7"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
UUID_NAMESPACE = uuid.UUID("c0b3cf52-1098-4f79-8f7f-e6f92a499973")


BUTTON_BOXES = {
    "ingame_menu_watch_exact.png": (38, 243, 279, 362),
    "ingame_menu_chips_exact.png": (292, 243, 525, 362),
    "ingame_menu_seat_exact.png": (38, 373, 279, 492),
    "ingame_menu_cards_exact.png": (292, 373, 525, 492),
    "ingame_menu_settings_exact.png": (38, 502, 279, 622),
    "ingame_menu_dissolve_exact.png": (292, 502, 525, 622),
    "ingame_menu_service_exact.png": (38, 632, 279, 753),
    "ingame_menu_exit_exact.png": (292, 632, 525, 753),
}


def stable_uuid(label: str) -> str:
    return str(uuid.uuid5(UUID_NAMESPACE, label))


def write_meta(path: Path) -> None:
    with Image.open(path) as image:
        width, height = image.size
    raw_uuid = stable_uuid("raw:" + path.name)
    frame_uuid = stable_uuid("frame:" + path.name)
    meta = {
        "ver": "2.3.7",
        "uuid": raw_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": False,
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
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def save(image: Image.Image, name: str) -> None:
    path = OUT / name
    image.save(path, optimize=True)
    write_meta(path)


def vertical_gradient(size: tuple[int, int]) -> Image.Image:
    width, height = size
    result = Image.new("RGBA", size)
    draw = ImageDraw.Draw(result)
    top = (12, 61, 99, 255)
    bottom = (5, 34, 59, 255)
    for y in range(height):
        ratio = y / max(1, height - 1)
        colour = tuple(
            round(top[channel] * (1 - ratio) + bottom[channel] * ratio)
            for channel in range(4)
        )
        draw.line((0, y, width, y), fill=colour)
    return result


def make_panel(source: Image.Image) -> None:
    panel = source.crop((16, 151, 541, 779)).convert("RGBA")

    # Replace the baked button grid by one continuous clean surface.  The
    # title, separator, outer gold line and rounded corners remain direct-cut.
    content_box = (20, 90, 510, 609)
    clean = vertical_gradient((content_box[2] - content_box[0], content_box[3] - content_box[1]))
    texture = source.crop((552, 151, 941, 779)).convert("RGBA")
    texture = texture.resize(clean.size, Image.Resampling.LANCZOS)
    texture = texture.filter(ImageFilter.GaussianBlur(1.5))
    clean = Image.blend(clean, texture, 0.16)
    panel.paste(clean, content_box[:2])

    alpha = Image.new("L", panel.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle(
        (0, 0, panel.width - 1, panel.height - 1), radius=22, fill=255
    )
    panel.putalpha(alpha)
    save(panel, "ingame_menu_panel_exact.png")


def make_buttons(source: Image.Image) -> None:
    for name, box in BUTTON_BOXES.items():
        crop = source.crop(box).convert("RGBA")
        # Equalise all hit-area canvases without distorting the narrower right
        # column art from the effect image.
        canvas = Image.new("RGBA", (241, 121), (0, 0, 0, 0))
        x = (canvas.width - crop.width) // 2
        y = (canvas.height - crop.height) // 2
        canvas.paste(crop, (x, y))
        mask = Image.new("L", canvas.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (max(0, x + 1), y, min(canvas.width - 1, x + crop.width - 1), y + crop.height - 1),
            radius=18,
            fill=255,
        )
        canvas.putalpha(mask)
        save(canvas, name)


def warm_foreground(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    alpha = Image.new("L", image.size, 0)
    mask = alpha.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _ = pixels[x, y]
            warm = max(red - blue * 0.72, green - blue * 0.68)
            light = (red + green + blue) / 3
            strength = max(0.0, min(255.0, (warm - 25.0) * 4.2))
            if light < 48:
                strength = 0
            mask[x, y] = round(strength)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    image.putalpha(alpha)
    return image


def circle_mask(size: tuple[int, int]) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse((2, 2, size[0] - 3, size[1] - 3), fill=255)
    return mask


def make_shortcut_plate(size: int = 128, scale: int = 4) -> Image.Image:
    """Return the common crisp V7 shortcut plate at supersampled size."""

    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    halo_draw.ellipse(
        (7 * scale, 7 * scale, 121 * scale, 121 * scale),
        outline=(32, 144, 198, 130),
        width=5 * scale,
    )
    canvas.alpha_composite(halo.filter(ImageFilter.GaussianBlur(3 * scale)))

    fill = vertical_gradient((104 * scale, 104 * scale))
    fill_mask = Image.new("L", fill.size, 0)
    ImageDraw.Draw(fill_mask).ellipse((0, 0, fill.width - 1, fill.height - 1), fill=255)
    canvas.paste(fill, (12 * scale, 12 * scale), fill_mask)

    draw = ImageDraw.Draw(canvas)
    draw.ellipse(
        (8 * scale, 8 * scale, 120 * scale, 120 * scale),
        outline=(231, 194, 125, 255),
        width=3 * scale,
    )
    draw.ellipse(
        (13 * scale, 13 * scale, 115 * scale, 115 * scale),
        outline=(90, 184, 220, 240),
        width=2 * scale,
    )
    draw.ellipse(
        (19 * scale, 19 * scale, 109 * scale, 109 * scale),
        outline=(231, 194, 125, 138),
        width=1 * scale,
    )
    return canvas


def rounded_line(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int, int, int],
    *,
    scale: int,
    fill: tuple[int, int, int, int],
    width: int,
) -> None:
    x1, y1, x2, y2 = (value * scale for value in xy)
    line_width = width * scale
    draw.line((x1, y1, x2, y2), fill=fill, width=line_width)
    radius = line_width // 2
    for x, y in ((x1, y1), (x2, y2)):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_shortcut_glyph(name: str, size: int = 128, scale: int = 4) -> Image.Image:
    glyph = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glyph)
    gold = (239, 207, 147, 255)
    dark = (5, 20, 36, 155)
    width = 5 * scale

    if name == "menu":
        for y in (47, 64, 81):
            rounded_line(draw, (40, y, 88, y), scale=scale, fill=gold, width=6)
    elif name == "review":
        draw.ellipse((38 * scale, 38 * scale, 90 * scale, 90 * scale), outline=gold, width=width)
        draw.polygon(
            [(58 * scale, 49 * scale), (58 * scale, 79 * scale), (80 * scale, 64 * scale)],
            fill=gold,
        )
    elif name == "cards":
        draw.rounded_rectangle(
            (34 * scale, 42 * scale, 70 * scale, 88 * scale),
            radius=4 * scale,
            outline=gold,
            width=4 * scale,
        )
        draw.rounded_rectangle(
            (55 * scale, 35 * scale, 94 * scale, 86 * scale),
            radius=4 * scale,
            fill=(7, 48, 79, 255),
            outline=gold,
            width=4 * scale,
        )
        font = ImageFont.truetype(str(FONT), 19 * scale)
        draw.text((42 * scale, 48 * scale), "8", font=font, fill=gold, anchor="mm")
        draw.text((74 * scale, 59 * scale), "L", font=font, fill=gold, anchor="mm")
    elif name == "chat":
        draw.arc(
            (37 * scale, 35 * scale, 91 * scale, 91 * scale),
            start=188,
            end=352,
            fill=gold,
            width=6 * scale,
        )
        draw.rounded_rectangle(
            (33 * scale, 57 * scale, 44 * scale, 79 * scale),
            radius=5 * scale,
            fill=gold,
        )
        draw.rounded_rectangle(
            (84 * scale, 57 * scale, 95 * scale, 79 * scale),
            radius=5 * scale,
            fill=gold,
        )
        rounded_line(draw, (89, 78, 83, 89), scale=scale, fill=gold, width=5)
        rounded_line(draw, (83, 89, 71, 89), scale=scale, fill=gold, width=5)
    elif name == "record":
        for y in (46, 64, 82):
            draw.ellipse(
                ((35 * scale), ((y - 4) * scale), (43 * scale), ((y + 4) * scale)),
                fill=gold,
            )
            rounded_line(draw, (54, y, 91, y), scale=scale, fill=gold, width=5)
    elif name == "voice":
        draw.rounded_rectangle(
            (51 * scale, 34 * scale, 77 * scale, 73 * scale),
            radius=13 * scale,
            fill=gold,
        )
        draw.arc(
            (42 * scale, 50 * scale, 86 * scale, 91 * scale),
            start=0,
            end=180,
            fill=gold,
            width=5 * scale,
        )
        rounded_line(draw, (64, 90, 64, 99), scale=scale, fill=gold, width=5)
        rounded_line(draw, (52, 99, 76, 99), scale=scale, fill=gold, width=5)
    else:
        raise ValueError(name)

    shadow = Image.new("RGBA", glyph.size, (0, 0, 0, 0))
    shadow_alpha = glyph.getchannel("A").filter(ImageFilter.GaussianBlur(1.5 * scale))
    shadow.putalpha(shadow_alpha)
    shadow_colour = Image.new("RGBA", glyph.size, dark)
    shadow_colour.putalpha(shadow_alpha)
    result = Image.new("RGBA", glyph.size, (0, 0, 0, 0))
    result.alpha_composite(shadow_colour, (scale, 2 * scale))
    result.alpha_composite(glyph)
    return result


def make_shortcuts() -> None:
    for key, output in {
        "menu": "ingame_icon_menu_exact.png",
        "review": "ingame_icon_review_exact.png",
        "cards": "ingame_icon_cards_exact.png",
        "chat": "ingame_icon_chat_exact.png",
        "record": "ingame_icon_record_exact.png",
        "voice": "ingame_icon_voice_exact.png",
    }.items():
        plate = make_shortcut_plate()
        plate.alpha_composite(draw_shortcut_glyph(key))
        save(plate.resize((128, 128), Image.Resampling.LANCZOS), output)


def make_empty_seat() -> None:
    """Create a clean V7 empty-seat badge for the live seat buttons.

    This item has no approved source crop, so it is drawn deterministically
    from the same cold-blue, champagne-gold and fine-line vocabulary as the
    confirmed in-room art.  The outside stays transparent and the centre is a
    single uninterrupted surface so no rectangular cutting residue is visible.
    """

    scale = 4
    size = 144
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def ellipse(box: tuple[int, int, int, int], **kwargs) -> None:
        draw.ellipse(tuple(value * scale for value in box), **kwargs)

    # A faceted medallion with an actual lounge-seat symbol reads as an action,
    # instead of the previous plain circle containing only two characters.
    halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    halo_draw.ellipse(
        (7 * scale, 7 * scale, 137 * scale, 137 * scale),
        outline=(38, 172, 225, 150),
        width=7 * scale,
    )
    halo = halo.filter(ImageFilter.GaussianBlur(5 * scale))
    canvas.alpha_composite(halo)

    ellipse((8, 8, 136, 136), fill=(2, 20, 39, 248), outline=(244, 210, 145, 255), width=3 * scale)
    ellipse((14, 14, 130, 130), outline=(94, 204, 238, 245), width=2 * scale)
    ellipse((20, 20, 124, 124), outline=(223, 185, 111, 178), width=1 * scale)

    inner = vertical_gradient((96 * scale, 96 * scale))
    inner_mask = Image.new("L", inner.size, 0)
    ImageDraw.Draw(inner_mask).ellipse((0, 0, inner.width - 1, inner.height - 1), fill=242)
    canvas.paste(inner, (24 * scale, 24 * scale), inner_mask)

    gold = (240, 207, 145, 255)
    cyan = (113, 214, 243, 245)
    # Four registration marks give the medallion a deliberate compass-like
    # silhouette while preserving a clean transparent outside edge.
    draw.polygon(
        [(72 * scale, 2 * scale), (78 * scale, 9 * scale), (72 * scale, 16 * scale), (66 * scale, 9 * scale)],
        fill=gold,
    )
    draw.polygon(
        [(72 * scale, 128 * scale), (78 * scale, 135 * scale), (72 * scale, 142 * scale), (66 * scale, 135 * scale)],
        fill=gold,
    )
    ellipse((4, 68, 12, 76), fill=cyan)
    ellipse((132, 68, 140, 76), fill=cyan)

    # Gold lounge chair: padded back, cushion, arms and legs.  The highlight
    # button turns the otherwise static empty marker into a clear entry point.
    chair_shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    chair_draw = ImageDraw.Draw(chair_shadow)
    chair_draw.rounded_rectangle(
        (47 * scale, 34 * scale, 97 * scale, 80 * scale),
        radius=13 * scale,
        fill=(0, 7, 17, 180),
    )
    chair_shadow = chair_shadow.filter(ImageFilter.GaussianBlur(3 * scale))
    canvas.alpha_composite(chair_shadow, (scale, 2 * scale))

    draw.rounded_rectangle(
        (47 * scale, 34 * scale, 97 * scale, 80 * scale),
        radius=13 * scale,
        fill=(7, 47, 77, 255),
        outline=gold,
        width=4 * scale,
    )
    draw.arc(
        (54 * scale, 42 * scale, 90 * scale, 72 * scale),
        start=192,
        end=348,
        fill=(117, 204, 229, 210),
        width=2 * scale,
    )
    ellipse((67, 50, 73, 56), fill=gold)
    draw.rounded_rectangle(
        (40 * scale, 72 * scale, 104 * scale, 92 * scale),
        radius=8 * scale,
        fill=(5, 33, 58, 255),
        outline=gold,
        width=4 * scale,
    )
    rounded_line(draw, (39, 62, 39, 84), scale=scale, fill=gold, width=5)
    rounded_line(draw, (105, 62, 105, 84), scale=scale, fill=gold, width=5)
    rounded_line(draw, (51, 91, 48, 101), scale=scale, fill=gold, width=4)
    rounded_line(draw, (93, 91, 96, 101), scale=scale, fill=gold, width=4)

    # Small plus badge: a subtle interactive cue, kept within the medallion.
    ellipse((99, 25, 121, 47), fill=(6, 54, 86, 255), outline=cyan, width=2 * scale)
    rounded_line(draw, (105, 36, 115, 36), scale=scale, fill=gold, width=3)
    rounded_line(draw, (110, 31, 110, 41), scale=scale, fill=gold, width=3)

    draw.rounded_rectangle(
        (29 * scale, 101 * scale, 115 * scale, 132 * scale),
        radius=13 * scale,
        fill=(3, 28, 52, 242),
        outline=(227, 190, 119, 230),
        width=2 * scale,
    )
    font = ImageFont.truetype(str(FONT), 29 * scale)
    text = "空位"
    box = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    text_x = (canvas.width - (box[2] - box[0])) // 2
    text_y = 116 * scale - (box[3] - box[1]) // 2 - box[1]
    draw.text(
        (text_x + scale, text_y + scale),
        text,
        font=font,
        fill=(0, 10, 22, 150),
    )
    draw.text((text_x, text_y), text, font=font, fill=gold)

    canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    save(canvas, "ingame_empty_seat_exact.png")


def main() -> None:
    if not SOURCE.exists() or not PLAYER_SOURCE.exists():
        raise SystemExit("missing confirmed in-room V7 effect image")
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    player_source = Image.open(PLAYER_SOURCE).convert("RGBA")
    if source.size != (941, 1672) or player_source.size != (941, 1672):
        raise SystemExit(f"unexpected source sizes: {source.size}, {player_source.size}")
    make_panel(source)
    make_buttons(source)
    make_shortcuts()
    make_empty_seat()
    print("generated V7 in-room menu, shortcut and empty-seat assets")


if __name__ == "__main__":
    main()
