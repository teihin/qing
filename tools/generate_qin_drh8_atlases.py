#!/usr/bin/env python3
"""Build the runtime card-back and DragonBones atlases used by ``drh8``.

The script deliberately keeps every existing target path, pixel size, atlas
rectangle, ``.meta`` file and UUID unchanged.  It expects three finished,
transparent card-back masters:

* ``art_sources/drh8/qin_card_back_variant1_source.png``
* ``art_sources/drh8/qin_card_back_variant2_source.png``
* ``art_sources/drh8/qin_card_back_variant3_source.png``

Runtime mapping is not numerically obvious in the legacy cut-card atlas:

* variant 1 -> 牌背0/1, 搓背0/1, ``pai3`` slices (names ending in ``3``)
* variant 2 -> 牌背2,   搓背2,   ``pai1`` slices (names without a suffix)
* variant 3 -> 牌背3,   搓背3,   ``pai2`` slices (names ending in ``2``)

The source masters are never modified.  The script also rebuilds the visual
content of ``ui_bigwin_tex.png`` in restrained Qin black-gold style while
leaving ``ui_bigwin_tex.json`` untouched, and creates the previously missing
``resources/other/drh/滚.png`` plus a deterministic Creator 2.4.13 meta file.

Use ``--check-structure`` before the masters arrive to validate the existing
atlas JSON and target metadata without writing any art.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import uuid
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art_sources" / "drh8"
ZUOTYPE = ROOT / "assets" / "resources" / "zuotype"
HAND_DIR = ROOT / "assets" / "ImagesLuck" / "动画" / "切"
BIGWIN_DIR = ROOT / "assets" / "ImagesLuck" / "动画" / "奖池动画"
DRH_STATUS = ROOT / "assets" / "resources" / "other" / "drh"
FONT_PATH = ROOT / "assets" / "font" / "PingFF.ttf"
QIN_LOGO_SOURCE = ROOT / "art_sources" / "login" / "qin_login_logo_final_source.png"

CARD_SOURCES = {
    1: ART / "qin_card_back_variant1_source.png",
    2: ART / "qin_card_back_variant2_source.png",
    3: ART / "qin_card_back_variant3_source.png",
}

HAND_ATLAS = HAND_DIR / "hand_tex.png"
HAND_JSON = HAND_DIR / "hand_tex.json"
BIGWIN_ATLAS = BIGWIN_DIR / "ui_bigwin_tex.png"
BIGWIN_JSON = BIGWIN_DIR / "ui_bigwin_tex.json"
ROLL_IMAGE = DRH_STATUS / "滚.png"

GOLD_LIGHT = (255, 233, 162, 255)
GOLD = (218, 164, 70, 255)
GOLD_DARK = (91, 51, 14, 255)
LACQUER = (10, 9, 8, 255)


class BuildError(RuntimeError):
    """A deterministic input or output validation failure."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"无法读取 JSON：{path}: {exc}") from exc


def texture_meta(path: Path) -> dict:
    meta_path = path.with_suffix(path.suffix + ".meta")
    data = read_json(meta_path)
    if not data.get("subMetas"):
        raise BuildError(f"目标没有 SpriteFrame subMeta：{meta_path}")
    return data


def sprite_meta(path: Path) -> dict:
    return next(iter(texture_meta(path)["subMetas"].values()))


def raw_size(path: Path) -> tuple[int, int]:
    sub = sprite_meta(path)
    return int(sub["rawWidth"]), int(sub["rawHeight"])


def trim_box(path: Path) -> tuple[int, int, int, int]:
    sub = sprite_meta(path)
    x = int(sub["trimX"])
    y = int(sub["trimY"])
    return x, y, x + int(sub["width"]), y + int(sub["height"])


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.convert("RGBA").getchannel("A").getbbox()


def save_preserving_meta_trim(path: Path, image: Image.Image) -> None:
    """Save an RGBA image while preserving the exact existing auto-trim box."""
    image = image.convert("RGBA")
    expected_size = raw_size(path)
    if image.size != expected_size:
        raise BuildError(f"{path} 尺寸应为 {expected_size}，实际为 {image.size}")

    x0, y0, x1, y1 = trim_box(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", image.size, 0)
    clipped.paste(alpha.crop((x0, y0, x1, y1)), (x0, y0))
    image.putalpha(clipped)

    # Creator's trim threshold is 1.  Four practically invisible anchors make
    # the output crop deterministic even when a new master has round corners.
    px = image.load()
    for x, y in ((x0, y0), (x1 - 1, y0), (x0, y1 - 1), (x1 - 1, y1 - 1)):
        r, g, b, _ = px[x, y]
        px[x, y] = (r or 92, g or 54, b or 16, 8)

    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)
    if alpha_bbox(Image.open(path)) != (x0, y0, x1, y1):
        raise BuildError(f"{path} 的透明裁剪范围未能保持为 {(x0, y0, x1, y1)}")


def validate_existing_target(path: Path) -> None:
    if not path.exists():
        raise BuildError(f"缺少目标文件：{path}")
    if not path.with_suffix(path.suffix + ".meta").exists():
        raise BuildError(f"缺少目标 meta：{path}.meta")
    with Image.open(path) as image:
        if image.size != raw_size(path):
            raise BuildError(f"{path} PNG 尺寸与 meta 不一致")


def validate_card_source(path: Path) -> Image.Image:
    if not path.exists():
        raise BuildError(f"缺少牌背源图：{path}")
    try:
        image = Image.open(path).convert("RGBA")
        image.load()
    except OSError as exc:
        raise BuildError(f"无法读取牌背源图：{path}: {exc}") from exc

    if image.width < 696 or image.height < 894:
        raise BuildError(
            f"牌背源图分辨率过低：{path} 为 {image.size}，至少需要 696×894"
        )
    if image.width >= image.height:
        raise BuildError(f"牌背源图必须为竖版：{path} 为 {image.size}")
    if image.getchannel("A").getextrema()[0] != 0:
        raise BuildError(f"牌背源图必须带真实透明背景：{path}")
    bbox = alpha_bbox(image)
    if not bbox:
        raise BuildError(f"牌背源图完全透明：{path}")
    content = image.crop(bbox)
    ratio = content.width / content.height
    if not 0.58 <= ratio <= 0.90:
        raise BuildError(f"牌背主体宽高比异常：{path} 主体比例为 {ratio:.3f}")
    return content


def add_qin_logo(source: Image.Image) -> Image.Image:
    """Place the already-approved accurate Qin emblem in the generated medallion."""
    if not QIN_LOGO_SOURCE.exists():
        raise BuildError(f"缺少已确认的秦LOGO源图：{QIN_LOGO_SOURCE}")
    logo = Image.open(QIN_LOGO_SOURCE).convert("RGBA")
    # The approved source includes a small QIN line below the circular emblem;
    # the card back uses only the round Qin seal so the tiny Latin text cannot blur.
    logo = logo.crop((0, 0, logo.width, round(logo.height * 0.90)))
    bbox = alpha_bbox(logo)
    if not bbox:
        raise BuildError(f"秦LOGO源图没有有效透明像素：{QIN_LOGO_SOURCE}")
    logo = logo.crop(bbox)
    target_size = round(source.width * 0.52)
    logo.thumbnail((target_size, target_size), Image.Resampling.LANCZOS)
    out = source.copy()
    out.alpha_composite(
        logo,
        ((source.width - logo.width) // 2, (source.height - logo.height) // 2),
    )
    return out


def render_card_target(source: Image.Image, target: Path) -> Image.Image:
    width, height = raw_size(target)
    x0, y0, x1, y1 = trim_box(target)
    card = source.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    out.alpha_composite(card, (x0, y0))
    return out


def subtextures(data: dict) -> dict[str, dict]:
    return {item["name"]: item for item in data.get("SubTexture", [])}


def validate_atlas(atlas: Path, atlas_json: Path, required: Iterable[str]) -> tuple[dict, dict[str, dict]]:
    data = read_json(atlas_json)
    with Image.open(atlas) as image:
        actual_size = image.size
    declared_size = (int(data["width"]), int(data["height"]))
    if actual_size != declared_size:
        raise BuildError(
            f"图集尺寸与 JSON 不一致：{atlas}={actual_size}, {atlas_json}={declared_size}"
        )
    regions = subtextures(data)
    missing = sorted(set(required) - set(regions))
    if missing:
        raise BuildError(f"{atlas_json} 缺少切片：{', '.join(missing)}")
    for name, item in regions.items():
        x, y = int(item["x"]), int(item["y"])
        w, h = int(item["width"]), int(item["height"])
        if x < 0 or y < 0 or x + w > actual_size[0] or y + h > actual_size[1]:
            raise BuildError(f"{atlas_json} 切片越界：{name}")
    return data, regions


def card_for_hand_slice(source: Image.Image, size: tuple[int, int], angle: float) -> Image.Image:
    """Fit one master to the legacy straight or ±7-degree card rectangle."""
    width, height = size
    if abs(angle) < 0.01:
        return source.resize(size, Image.Resampling.LANCZOS)

    # Legacy tilted card slices are 154×197 and originate from a 133×183 card.
    base_width = min(width, 133)
    base_height = min(height, 183)
    base = source.resize((base_width, base_height), Image.Resampling.LANCZOS)
    rotated = base.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    left = (rotated.width - width) // 2
    top = (rotated.height - height) // 2
    if left >= 0 and top >= 0:
        out.alpha_composite(rotated.crop((left, top, left + width, top + height)))
    else:
        out.alpha_composite(rotated, ((width - rotated.width) // 2, (height - rotated.height) // 2))
    return out


def replace_hand_cards(sources: dict[int, Image.Image]) -> Image.Image:
    required = {
        "放牌", "放牌2", "放牌3",
        "下牌", "下牌2", "下牌3",
        "上牌", "上牌2", "上牌3",
    }
    _, regions = validate_atlas(HAND_ATLAS, HAND_JSON, required)
    atlas = Image.open(HAND_ATLAS).convert("RGBA")

    # Runtime card-back 1 plays pai3; 2 plays pai1; 3 plays pai2.
    mapping = {
        1: ("放牌3", "下牌3", "上牌3"),
        2: ("放牌", "下牌", "上牌"),
        3: ("放牌2", "下牌2", "上牌2"),
    }
    for variant, names in mapping.items():
        for name in names:
            item = regions[name]
            box = (
                int(item["x"]), int(item["y"]),
                int(item["x"]) + int(item["width"]),
                int(item["y"]) + int(item["height"]),
            )
            if name.startswith("下牌"):
                angle = 7.0
            elif name.startswith("上牌"):
                angle = -7.0
            else:
                angle = 0.0
            card = card_for_hand_slice(sources[variant], (box[2] - box[0], box[3] - box[1]), angle)
            atlas.paste((0, 0, 0, 0), box)
            atlas.alpha_composite(card, (box[0], box[1]))
    return atlas


def font(size: int) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.exists():
        raise BuildError(f"缺少项目字体：{FONT_PATH}")
    return ImageFont.truetype(str(FONT_PATH), size)


def centered_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    stroke_width: int = 1,
    stroke_fill: tuple[int, int, int, int] = (49, 25, 5, 255),
) -> None:
    bounds = draw.textbbox((0, 0), text, font=text_font, stroke_width=stroke_width)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    x = (box[0] + box[2] - width) / 2 - bounds[0]
    y = (box[1] + box[3] - height) / 2 - bounds[1]
    draw.text(
        (round(x), round(y)), text, font=text_font, fill=fill,
        stroke_width=stroke_width, stroke_fill=stroke_fill,
    )


def qin_bigwin_banner(size: tuple[int, int], phase: float) -> Image.Image:
    """Detailed black-gold replacement for one legacy BIG WIN frame."""
    scale = 3
    w, h = size
    image = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    pulse = 34 + round(24 * (0.5 + 0.5 * math.sin(phase * math.tau)))
    gd.ellipse(
        (40 * scale, 42 * scale, (w - 40) * scale, (h - 24) * scale),
        fill=(225, 154, 43, pulse),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(19 * scale))
    image.alpha_composite(glow)
    draw = ImageDraw.Draw(image)

    # Broad Qin bronze wings and a restrained lacquer centre plaque.
    left_wing = [
        (18, 118), (104, 69), (205, 57), (175, 89),
        (231, 100), (172, 114), (220, 139), (108, 150),
    ]
    right_wing = [(w - x, y) for x, y in left_wing]
    draw.polygon([(x * scale, y * scale) for x, y in left_wing],
                 fill=(91, 49, 12, 245), outline=(218, 163, 66, 255))
    draw.polygon([(x * scale, y * scale) for x, y in right_wing],
                 fill=(91, 49, 12, 245), outline=(218, 163, 66, 255))
    for inset, color, width in (
        (0, (77, 41, 10, 255), 5),
        (5, (222, 169, 75, 255), 3),
        (9, (255, 226, 148, 210), 1),
    ):
        draw.rounded_rectangle(
            ((142 + inset) * scale, (43 + inset) * scale,
             (w - 142 - inset) * scale, (h - 39 - inset) * scale),
            radius=max(4, 24 - inset) * scale,
            fill=LACQUER if inset == 0 else None,
            outline=color,
            width=width * scale,
        )

    # Fine geometric side marks, kept sparse so the title remains legible.
    for side in (-1, 1):
        cx = w // 2 + side * 244
        diamond = [(cx, 91), (cx + side * 17, 118), (cx, 145), (cx - side * 17, 118)]
        draw.line([(x * scale, y * scale) for x, y in diamond + [diamond[0]]],
                  fill=(234, 185, 91, 240), width=2 * scale)
        draw.line(((cx - side * 82) * scale, 118 * scale,
                   (cx - side * 19) * scale, 118 * scale),
                  fill=(167, 105, 34, 220), width=2 * scale)

    # Qin seal above the semantic Chinese replacement for BIG WIN.
    seal_x, seal_y = w // 2, 47
    draw.ellipse(
        ((seal_x - 25) * scale, (seal_y - 25) * scale,
         (seal_x + 25) * scale, (seal_y + 25) * scale),
        fill=(31, 20, 8, 255), outline=(240, 191, 93, 255), width=2 * scale,
    )
    centered_text(
        draw,
        ((seal_x - 24) * scale, (seal_y - 24) * scale,
         (seal_x + 24) * scale, (seal_y + 24) * scale),
        "秦", font(29 * scale), GOLD_LIGHT, 1 * scale,
    )
    centered_text(
        draw,
        (154 * scale, 76 * scale, (w - 154) * scale, (h - 43) * scale),
        "大赢家", font(57 * scale), GOLD_LIGHT, 2 * scale,
    )
    draw.line(
        (223 * scale, (h - 54) * scale, (w - 223) * scale, (h - 54) * scale),
        fill=(235, 184, 81, 220), width=2 * scale,
    )
    return image.resize(size, Image.Resampling.LANCZOS)


def qin_card_emblem(size: tuple[int, int], variant: int) -> Image.Image:
    scale = 3
    w, h = size
    image = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = 8
    draw.rounded_rectangle(
        (margin * scale, margin * scale, (w - margin) * scale, (h - margin) * scale),
        radius=14 * scale, fill=(8, 8, 7, 255), outline=(85, 47, 12, 255), width=5 * scale,
    )
    draw.rounded_rectangle(
        ((margin + 4) * scale, (margin + 4) * scale,
         (w - margin - 4) * scale, (h - margin - 4) * scale),
        radius=11 * scale, outline=(230, 179, 80, 255), width=2 * scale,
    )
    draw.rounded_rectangle(
        ((margin + 9) * scale, (margin + 9) * scale,
         (w - margin - 9) * scale, (h - margin - 9) * scale),
        radius=8 * scale, outline=(129, 82, 27, 230), width=1 * scale,
    )
    cx, cy = w // 2, h // 2
    radius = min(w, h) // 4
    draw.ellipse(
        ((cx - radius) * scale, (cy - radius) * scale,
         (cx + radius) * scale, (cy + radius) * scale),
        fill=(28, 18, 7, 255), outline=GOLD, width=2 * scale,
    )
    centered_text(
        draw,
        ((cx - radius) * scale, (cy - radius) * scale,
         (cx + radius) * scale, (cy + radius) * scale),
        "秦", font((51 if variant == 1 else 47) * scale), GOLD_LIGHT, 2 * scale,
    )
    # Small corner key patterns replace the former JOKER lettering.
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        x = margin + 14 if sx > 0 else w - margin - 14
        y = margin + 18 if sy > 0 else h - margin - 18
        draw.line(
            ((x - sx * 8) * scale, y * scale, x * scale, (y + sy * 8) * scale,
             (x + sx * 8) * scale, y * scale, x * scale, (y - sy * 8) * scale,
             (x - sx * 8) * scale, y * scale),
            fill=(205, 146, 54, 230), width=1 * scale,
        )
    return image.resize(size, Image.Resampling.LANCZOS)


def qin_gold_beam(size: tuple[int, int]) -> Image.Image:
    w, h = size
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    layers = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layers)
    for inset, alpha in ((2, 50), (15, 70), (29, 105), (43, 150)):
        draw.ellipse((inset, h // 2 - max(2, h // 2 - inset // 2),
                      w - inset, h // 2 + max(2, h // 2 - inset // 2)),
                     fill=(244, 181, 66, alpha))
    layers = layers.filter(ImageFilter.GaussianBlur(12))
    image.alpha_composite(layers)
    draw = ImageDraw.Draw(image)
    draw.line((w // 8, h // 2, w - w // 8, h // 2), fill=GOLD_LIGHT, width=2)
    return image


def qin_number_frame(size: tuple[int, int]) -> Image.Image:
    scale = 3
    w, h = size
    image = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (5 * scale, 7 * scale, (w - 5) * scale, (h - 7) * scale),
        radius=22 * scale, fill=(7, 8, 7, 245), outline=(74, 43, 13, 255), width=5 * scale,
    )
    draw.rounded_rectangle(
        (10 * scale, 12 * scale, (w - 10) * scale, (h - 12) * scale),
        radius=17 * scale, outline=(230, 179, 78, 255), width=2 * scale,
    )
    draw.line(
        (41 * scale, 20 * scale, (w - 41) * scale, 20 * scale),
        fill=(255, 229, 154, 135), width=1 * scale,
    )
    return image.resize(size, Image.Resampling.LANCZOS)


def qin_seal(size: tuple[int, int]) -> Image.Image:
    scale = 3
    w, h = size
    image = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cx, cy = w // 2, h // 2
    radius = min(w, h) // 2 - 5
    draw.ellipse(
        ((cx - radius) * scale, (cy - radius) * scale,
         (cx + radius) * scale, (cy + radius) * scale),
        fill=(29, 17, 7, 250), outline=GOLD, width=3 * scale,
    )
    centered_text(
        draw,
        ((cx - radius) * scale, (cy - radius) * scale,
         (cx + radius) * scale, (cy + radius) * scale),
        "秦", font(max(18, radius) * scale), GOLD_LIGHT, 1 * scale,
    )
    return image.resize(size, Image.Resampling.LANCZOS)


def gold_recolor(image: Image.Image) -> Image.Image:
    """Idempotently map every visible hue to a gold/bronze luminance palette."""
    image = image.convert("RGBA")
    r, g, b, a = image.split()
    luminance = ImageChops.lighter(ImageChops.lighter(r, g), b)
    gold_g = luminance.point(lambda value: (value * 178 + 127) // 255)
    gold_b = luminance.point(lambda value: (value * 66 + 127) // 255)
    return Image.merge("RGBA", (luminance, gold_g, gold_b, a))


def replace_region(atlas: Image.Image, item: dict, replacement: Image.Image) -> None:
    x, y = int(item["x"]), int(item["y"])
    width, height = int(item["width"]), int(item["height"])
    if replacement.size != (width, height):
        replacement = replacement.resize((width, height), Image.Resampling.LANCZOS)
    atlas.paste((0, 0, 0, 0), (x, y, x + width, y + height))
    atlas.alpha_composite(replacement.convert("RGBA"), (x, y))


def rebuild_bigwin_atlas() -> Image.Image:
    required = {
        *(f"WING{index}" for index in range(1, 15)),
        "PAI1", "PAI2", "db_00000", "shuzikuang", "g_00000", "zi_00000",
    }
    _, regions = validate_atlas(BIGWIN_ATLAS, BIGWIN_JSON, required)
    atlas = gold_recolor(Image.open(BIGWIN_ATLAS))

    for index in range(1, 15):
        name = f"WING{index}"
        item = regions[name]
        banner = qin_bigwin_banner(
            (int(item["width"]), int(item["height"])),
            phase=(index - 1) / 14.0,
        )
        replace_region(atlas, item, banner)

    # zi_00000 is the legacy static BIG WIN title at its own 640×236 region.
    # Replace it explicitly; it is not one of the fourteen animated WING frames.
    item = regions["zi_00000"]
    replace_region(
        atlas,
        item,
        qin_bigwin_banner(
            (int(item["width"]), int(item["height"])),
            phase=0.75,
        ),
    )

    for index, name in enumerate(("PAI1", "PAI2"), start=1):
        item = regions[name]
        replace_region(
            atlas, item,
            qin_card_emblem((int(item["width"]), int(item["height"])), index),
        )

    item = regions["db_00000"]
    replace_region(atlas, item, qin_gold_beam((int(item["width"]), int(item["height"]))))
    item = regions["shuzikuang"]
    replace_region(atlas, item, qin_number_frame((int(item["width"]), int(item["height"]))))
    item = regions["g_00000"]
    replace_region(atlas, item, qin_seal((int(item["width"]), int(item["height"]))))
    return atlas


def render_roll_badge() -> Image.Image:
    scale = 4
    w, h = 94, 45
    image = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (1 * scale, 1 * scale, (w - 1) * scale - 1, (h - 1) * scale - 1),
        radius=11 * scale, fill=(9, 9, 8, 250), outline=(77, 43, 12, 255), width=3 * scale,
    )
    draw.rounded_rectangle(
        (4 * scale, 4 * scale, (w - 4) * scale - 1, (h - 4) * scale - 1),
        radius=8 * scale, outline=(224, 171, 74, 255), width=1 * scale,
    )
    draw.line(
        (16 * scale, 7 * scale, (w - 16) * scale, 7 * scale),
        fill=(255, 232, 166, 115), width=1 * scale,
    )
    centered_text(
        draw, (0, 0, w * scale, h * scale), "滚",
        font(23 * scale), GOLD_LIGHT, 1 * scale,
    )
    return image.resize((w, h), Image.Resampling.LANCZOS)


def ensure_roll_meta() -> None:
    meta_path = ROLL_IMAGE.with_suffix(".png.meta")
    if meta_path.exists():
        data = read_json(meta_path)
        sub = next(iter(data.get("subMetas", {}).values()), None)
        if not sub or int(sub.get("rawWidth", 0)) != 94 or int(sub.get("rawHeight", 0)) != 45:
            raise BuildError(f"现有滚.png.meta规格不正确，拒绝覆盖：{meta_path}")
        return

    texture_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing:assets/resources/other/drh/滚.png"))
    frame_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing:assets/resources/other/drh/滚.png#滚"))
    data = {
        "ver": "2.3.7",
        "uuid": texture_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": 94,
        "height": 45,
        "platformSettings": {},
        "subMetas": {
            "滚": {
                "ver": "1.0.6",
                "uuid": frame_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": texture_uuid,
                "trimType": "auto",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": 94,
                "height": 45,
                "rawWidth": 94,
                "rawHeight": 45,
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {},
            }
        },
    }
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_structure() -> None:
    targets = [
        *(ZUOTYPE / f"牌背{index}.png" for index in range(4)),
        *(ZUOTYPE / f"搓背{index}.png" for index in range(4)),
        HAND_ATLAS,
        BIGWIN_ATLAS,
    ]
    for target in targets:
        validate_existing_target(target)
    validate_atlas(
        HAND_ATLAS,
        HAND_JSON,
        {"放牌", "放牌2", "放牌3", "下牌", "下牌2", "下牌3", "上牌", "上牌2", "上牌3"},
    )
    validate_atlas(
        BIGWIN_ATLAS,
        BIGWIN_JSON,
        {
            *(f"WING{index}" for index in range(1, 15)),
            "PAI1", "PAI2", "db_00000", "shuzikuang", "g_00000", "zi_00000",
        },
    )


def build() -> list[Path]:
    validate_structure()
    sources = {
        index: add_qin_logo(validate_card_source(path))
        for index, path in CARD_SOURCES.items()
    }

    # Existing metas are never written. Hash them before the build and verify
    # them again after all PNG outputs are complete.
    existing_meta_paths = [
        *(ZUOTYPE / f"牌背{index}.png.meta" for index in range(4)),
        *(ZUOTYPE / f"搓背{index}.png.meta" for index in range(4)),
        HAND_ATLAS.with_suffix(".png.meta"),
        BIGWIN_ATLAS.with_suffix(".png.meta"),
    ]
    meta_hashes = {path: sha256(path) for path in existing_meta_paths}

    outputs: list[Path] = []
    source_by_runtime_index = {0: sources[1], 1: sources[1], 2: sources[2], 3: sources[3]}
    for prefix in ("牌背", "搓背"):
        for index in range(4):
            target = ZUOTYPE / f"{prefix}{index}.png"
            save_preserving_meta_trim(target, render_card_target(source_by_runtime_index[index], target))
            outputs.append(target)

    save_preserving_meta_trim(HAND_ATLAS, replace_hand_cards(sources))
    outputs.append(HAND_ATLAS)

    save_preserving_meta_trim(BIGWIN_ATLAS, rebuild_bigwin_atlas())
    outputs.append(BIGWIN_ATLAS)

    ensure_roll_meta()
    roll = render_roll_badge()
    # 滚.png is new and intentionally uses a full 94×45 trim box.
    roll.save(ROLL_IMAGE, format="PNG", optimize=True)
    if roll.size != (94, 45) or alpha_bbox(roll) != (0, 0, 94, 45):
        raise BuildError("滚.png 输出规格异常")
    outputs.extend((ROLL_IMAGE, ROLL_IMAGE.with_suffix(".png.meta")))

    changed_metas = [path for path, digest in meta_hashes.items() if sha256(path) != digest]
    if changed_metas:
        raise BuildError("已有 meta 被意外修改：" + ", ".join(str(path) for path in changed_metas))
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-structure",
        action="store_true",
        help="只验证现有目标尺寸、meta 与图集切片，不读取源图、不写文件",
    )
    args = parser.parse_args()
    try:
        if args.check_structure:
            validate_structure()
            print("drh8 图集结构检查通过；未写入文件。")
        else:
            outputs = build()
            print(f"已生成 {len(outputs)} 个 drh8 运行资源：")
            for path in outputs:
                print(path.relative_to(ROOT))
        return 0
    except BuildError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
