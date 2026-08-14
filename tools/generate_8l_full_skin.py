#!/usr/bin/env python3
"""Generate the complete 8L blue-green/silver raster skin in place.

The script keeps every existing image path, pixel size, alpha mask and Cocos
``.meta`` file stable.  It discovers images referenced by scenes/prefabs, adds
known dynamically loaded UI families, excludes poker faces/avatars/emotes and
then applies a deterministic luxury sapphire/platinum palette.  A small set of
brand-critical assets is rebuilt from the approved 8L source plates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

import jackpot_card_colors


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ART = ROOT / "art_sources" / "8l"
LOGIN_SOURCE = ART / "8l_login_background_source.png"
HALL_SOURCE = ART / "8l_hall_background_source.png"
TABLE_SOURCE = ART / "8l_table_generated_source.png"
LOGO_GENERATED = ART / "8l_logo_generated_source.png"
LOGO_MASTER = ART / "8l_logo_master.png"
FONT_PATH = ASSETS / "font" / "PingFF.ttf"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}
SERIALIZED_SUFFIXES = {".fire", ".prefab", ".anim", ".json", ".plist"}
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

UI_ROOTS = (
    ASSETS / "ImagesLuck",
    ASSETS / "ImagesXYPK",
    ASSETS / "imagesKK",
)

EXCLUDED_PREFIXES = (
    "assets/ImagesLuck/表情/",
    "assets/Images/表情/",
    "assets/Images/表情kk/",
    "assets/Images/表情图标/",
    "assets/Images/道具/",
    "assets/resources/avatars/",
    "assets/resources/pk2/",
)

EXCLUDED_EXACT = {
    "assets/ImagesLuck/互动/吻.png",
    "assets/ImagesLuck/互动/啤酒.png",
    "assets/ImagesLuck/互动/拇指.png",
    "assets/ImagesLuck/互动/枪.png",
    "assets/ImagesLuck/互动/炸弹.png",
    "assets/ImagesLuck/互动/鸡.png",
    "assets/ImagesLuck/钱包/3-1.png",
    "assets/ImagesLuck/钱包/其他支付.png",
    "assets/ImagesLuck/钱包/支付宝.png",
    "assets/ImagesLuck/钱包/微信.png",
    "assets/ImagesLuck/钱包/选择.png",
    "assets/ImagesXYPK/推广/二维码6.png",
}

PK2_SKIN_FILES = {
    "assets/resources/pk2/bigbig.png",
    "assets/resources/pk2/bigbi1.png",
}

BACKGROUND_TARGETS = {
    "assets/ImagesLuck/大厅/大厅背景.png": "hall",
    "assets/ImagesLuck/公用/背景.png": "common",
    "assets/ImagesLuck/我的/我的背景.png": "common",
    "assets/ImagesLuck/登陆/背景.png": "login",
    "assets/ImagesLuck/登陆/秦_登录背景.png": "login",
    "assets/ImagesXYPK/推广/背景.png": "common",
    "assets/imagesKK/公用/背景1.png": "common",
    "assets/imagesKK/游戏大厅/大厅底图.png": "hall",
    "assets/imagesKK/游戏大厅/背景.png": "hall",
}

LOGO_TARGETS = {
    "assets/ImagesLuck/登陆/秦_登录LOGO.png",
    "assets/ImagesLuck/游戏内/LOGO.png",
    "assets/ImagesLuck/大厅/大图标.png",
    "assets/ImagesLuck/战绩详情/LOGO.png",
    "assets/ImagesLuck/游戏内/defaultIcon.png",
    "assets/ImagesLuck/公用/头像2.png",
    "assets/resources/other/Default_Man_Head.png",
    "assets/resources/other/head.png",
    "assets/resources/other/默认头像.png",
    "assets/imagesKK/游戏大厅/图标.png",
    "assets/ImagesLuck/启动图标.png",
}

PROFILE_FRAME = "assets/ImagesLuck/我的/头像.png"

HALL_HERO = "assets/ImagesLuck/大厅/秦_大厅主视觉.png"
DISCOVER_BUTTON = "assets/ImagesLuck/大厅/秦_发现按钮.png"
BOTTOM_NAV_BASE = "assets/ImagesLuck/大厅/操作台底板.png"
BOTTOM_NAV_ICONS = {
    "assets/ImagesLuck/大厅/排行榜2.png": "ranking",
    "assets/ImagesLuck/大厅/公告2.png": "notice",
    "assets/ImagesLuck/大厅/钱包2.png": "wallet",
    "assets/ImagesLuck/大厅/我的2.png": "profile",
}

ATLAS_LOGO = "assets/ImagesLuck/动画/大厅LOGO动画/logo_tex.png"
ATLAS_NAV = "assets/ImagesLuck/动画/导航按钮动画/MainButton_backup_tex.png"
ATLAS_HAND = "assets/ImagesLuck/动画/切/hand_tex.png"
NATURAL_HAND_ATLAS = ROOT / "HisImg" / "qing" / ATLAS_HAND
NATURAL_HAND_FRAMES = {"放牌手", "底部手", "顶部手"}
ATLAS_BIGWIN = {
    "assets/ImagesLuck/动画/报奖-old/ui_bigwin_tex.png",
    "assets/ImagesLuck/动画/奖池动画/ui_bigwin_tex.png",
}

WHOLE_CHIP_TARGETS = {
    "assets/ImagesLuck/大厅/小图标1.png",
    "assets/ImagesLuck/公用/小金币.png",
    "assets/ImagesLuck/战绩详情/筹码.png",
}

# x/y/r are expressed in the target image's native pixel coordinates.
SEAL_PATCHES = {
    "assets/ImagesLuck/我的/金币框.png": (24, 23, 16),
    "assets/ImagesLuck/我的/选项/资金流向选择条.png": (70, 42, 11),
    "assets/ImagesLuck/公用/名字垫底.png": (219, 20.5, 13),
    "assets/imagesKK/公用/赠送按钮1.png": (42, 42, 20),
    "assets/ImagesLuck/公告/秦_通知弹窗底.png": (49.5, 59.5, 23),
    "assets/ImagesLuck/公用1/奖池框.png": (25, 28, 16),
    "assets/ImagesLuck/游戏内/个人金币.png": (18, 17.5, 12),
    "assets/ImagesLuck/奖池/奖池-.png": (48, 76.5, 31),
    "assets/ImagesLuck/代理/装饰框.png": (299.5, 26, 20),
    "assets/ImagesLuck/代理/盟主徽标.png": (13.5, 13.5, 11),
    "assets/ImagesXYPK/代理/盟主.png": (49, 50, 23),
}

TURNTABLE_BUTTONS = {
    "assets/ImagesXYPK/转盘/按钮.png",
    "assets/ImagesXYPK/转盘/按钮灰.png",
}

TURNTABLE_WHEELS = {
    "assets/ImagesXYPK/转盘/转盘1.png",
    "assets/ImagesXYPK/转盘/转盘3.png",
}

TEAL = (23, 201, 199, 255)
TEAL_DARK = (5, 73, 91, 255)
SILVER = (222, 235, 241, 255)
PLATINUM = (153, 184, 197, 255)
NAVY = (3, 13, 27, 255)
NAVY_2 = (4, 30, 49, 255)
CHAMPAGNE = (221, 196, 143, 255)


class SkinError(RuntimeError):
    pass


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def all_files(directory: Path) -> Iterable[Path]:
    if directory.is_dir():
        yield from (path for path in directory.rglob("*") if path.is_file())


def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_SUFFIXES


def canonical_image(opened: Image.Image) -> Image.Image:
    """Materialize palette transparency before ``Image.copy`` drops it."""
    if "A" in opened.getbands() or "transparency" in opened.info:
        return opened.convert("RGBA")
    return opened.convert("RGB")


def referenced_image_paths() -> set[Path]:
    references: set[str] = set()
    for path in all_files(ASSETS):
        if path.suffix.lower() not in SERIALIZED_SUFFIXES or path.name.endswith(".meta"):
            continue
        try:
            text = path.read_text("utf-8-sig")
        except (OSError, UnicodeDecodeError):
            continue
        references.update(match.group(0) for match in UUID_RE.finditer(text))

    result: set[Path] = set()
    for path in all_files(ASSETS):
        if not is_image(path):
            continue
        meta = path.with_suffix(path.suffix + ".meta")
        if not meta.is_file():
            continue
        try:
            document = json.loads(meta.read_text("utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        uuids = {document.get("uuid")}
        uuids.update(
            item.get("uuid")
            for item in (document.get("subMetas") or {}).values()
            if isinstance(item, dict)
        )
        if any(uuid in references for uuid in uuids if uuid):
            result.add(path.resolve())
    return result


def excluded(path: Path) -> bool:
    value = relative(path)
    if value in PK2_SKIN_FILES:
        return False
    if value in EXCLUDED_EXACT:
        return True
    return any(value.startswith(prefix) for prefix in EXCLUDED_PREFIXES)


def collect_targets() -> list[Path]:
    targets: set[Path] = set()
    # The three historical UI trees contain screens that are opened by string
    # names or kept as alternate panels, so a static UUID scan alone is not a
    # complete runtime-art inventory.  Include every raster in these UI trees
    # and let the explicit exclusions keep content art (emotes/gifts) intact.
    for root in UI_ROOTS:
        targets.update(path.resolve() for path in all_files(root) if is_image(path))
    for path in referenced_image_paths():
        if any(path.is_relative_to(root.resolve()) for root in UI_ROOTS):
            targets.add(path)
        elif path.is_relative_to((ASSETS / "Images" / "奖池").resolve()):
            targets.add(path)
        elif path.is_relative_to((ASSETS / "resources" / "other").resolve()):
            targets.add(path)
        elif path.is_relative_to((ASSETS / "resources" / "zuotype").resolve()):
            targets.add(path)
        elif relative(path) in PK2_SKIN_FILES:
            targets.add(path)

    dynamic_dirs = (
        ASSETS / "ImagesLuck" / "动画",
        ASSETS / "ImagesXYPK" / "动画",
        ASSETS / "ImagesXYPK" / "转盘",
        ASSETS / "Images" / "奖池",
        ASSETS / "resources" / "other",
        ASSETS / "resources" / "zuotype",
    )
    for directory in dynamic_dirs:
        targets.update(path.resolve() for path in all_files(directory) if is_image(path))
    for path in all_files(ASSETS):
        if is_image(path) and "秦_" in path.name:
            targets.add(path.resolve())
    for value in PK2_SKIN_FILES:
        path = ROOT / value
        if path.is_file():
            targets.add(path.resolve())
    return sorted((path for path in targets if not excluded(path)), key=relative)


def write_targets(path: Path) -> list[Path]:
    targets = collect_targets()
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 8L 全界面换皮运行图片清单",
        "# 自动来自场景/Prefab UUID引用、动态UI资源族和秦_专用资源；不含扑克牌面/头像/表情/礼物/支付品牌。",
        *(relative(target) for target in targets),
    ]
    path.write_text("\n".join(lines) + "\n", "utf-8")
    return targets


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), max(1, size))


def fit(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(source, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def prepare_logo_master() -> Image.Image:
    if not LOGO_GENERATED.is_file():
        raise SkinError(f"缺少8L徽章源图：{LOGO_GENERATED}")
    source = Image.open(LOGO_GENERATED).convert("RGB")
    arr = np.asarray(source)
    maximum = arr.max(axis=2)
    minimum = arr.min(axis=2)
    background = (minimum > 220) & ((maximum - minimum) < 22)
    foreground = ~background
    rows = np.where(foreground.sum(axis=1) > max(10, source.width // 200))[0]
    if not rows.size:
        raise SkinError("8L徽章源图无法分离棋盘背景")
    alpha = np.zeros((source.height, source.width), dtype=np.uint8)
    for y in rows:
        xs = np.where(foreground[y])[0]
        if xs.size:
            alpha[y, xs.min(): xs.max() + 1] = 255
    mask = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.2))
    rgba = source.convert("RGBA")
    rgba.putalpha(mask)
    bbox = mask.getbbox()
    if not bbox:
        raise SkinError("8L徽章透明蒙版为空")
    cropped = rgba.crop(bbox)
    contained = ImageOps.contain(cropped, (904, 904), Image.Resampling.LANCZOS)
    master = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    master.alpha_composite(contained, ((1024 - contained.width) // 2, (1024 - contained.height) // 2))
    ART.mkdir(parents=True, exist_ok=True)
    master.save(LOGO_MASTER, optimize=True)
    return master


def recolor_8l(source: Image.Image, *, hue_shift: float = 0.0) -> Image.Image:
    rgba = source.convert("RGBA")
    arr = np.asarray(rgba, dtype=np.float32)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3:4]
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = np.clip(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 255)
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = maximum - minimum

    out = np.empty_like(rgb)
    # Neutral material becomes deep navy through platinum rather than brown.
    out[:, :, 0] = np.clip(lum * 0.55 - 5, 2, 225)
    out[:, :, 1] = np.clip(lum * 0.72 + 3, 10, 238)
    out[:, :, 2] = np.clip(lum * 0.88 + 12, 20, 247)

    warm = (r > b * 1.08) & (g > b * 1.02) & (r > 45)
    t = lum / 255.0
    warm_hi = np.clip((t - 0.33) / 0.67, 0, 1)
    warm_r = np.where(t < 0.33, 3 + 20 * t, 62 + 177 * warm_hi)
    warm_g = np.where(t < 0.33, 12 + 54 * t, 105 + 137 * warm_hi)
    warm_b = np.where(t < 0.33, 23 + 74 * t, 128 + 119 * warm_hi)
    out[:, :, 0] = np.where(warm, warm_r, out[:, :, 0])
    out[:, :, 1] = np.where(warm, warm_g, out[:, :, 1])
    out[:, :, 2] = np.where(warm, warm_b, out[:, :, 2])

    # Red/purple interface pigment becomes teal, but do not treat low-luminance
    # brown gradients as saturated red; doing so creates visible horizontal
    # bands in nine-sliced input fields.  Warm gold has already been mapped to
    # platinum and is explicitly excluded here.
    red_or_purple = (
        (((r > g * 1.12) & (r > b * 1.08)) | ((r > g * 1.08) & (b > g * 1.08)))
        & (~warm)
        & (lum > 45)
    )
    out[:, :, 0] = np.where(red_or_purple, 4 + 42 * t, out[:, :, 0])
    out[:, :, 1] = np.where(red_or_purple, 17 + 163 * t, out[:, :, 1])
    out[:, :, 2] = np.where(red_or_purple, 30 + 178 * t, out[:, :, 2])

    cool = (b > r * 1.05) & (g > r * 1.02) & (saturation > 12)
    shift = max(-0.18, min(0.18, hue_shift))
    out[:, :, 0] = np.where(cool, np.clip(8 + lum * (0.32 + shift), 4, 165), out[:, :, 0])
    out[:, :, 1] = np.where(cool, np.clip(20 + lum * (0.74 - shift * 0.5), 18, 230), out[:, :, 1])
    out[:, :, 2] = np.where(cool, np.clip(30 + lum * (0.92 - shift), 28, 250), out[:, :, 2])

    # Near-white UI stays crisp silver.
    bright_neutral = (saturation < 18) & (lum > 170)
    out[:, :, 0] = np.where(bright_neutral, np.clip(lum * 0.90, 0, 239), out[:, :, 0])
    out[:, :, 1] = np.where(bright_neutral, np.clip(lum * 0.95, 0, 245), out[:, :, 1])
    out[:, :, 2] = np.where(bright_neutral, np.clip(lum, 0, 251), out[:, :, 2])

    result = np.concatenate((np.clip(out, 0, 255), alpha), axis=2).astype(np.uint8)
    return Image.fromarray(result, "RGBA")


def original_alpha_mask(source: Image.Image) -> Image.Image | None:
    return source.convert("RGBA").getchannel("A") if "A" in source.getbands() else None


def enforce_alpha_contract(image: Image.Image, source: Image.Image) -> Image.Image:
    if "A" not in source.getbands():
        return image.convert("RGB")
    result = image.convert("RGBA")
    source_alpha = source.convert("RGBA").getchannel("A")
    result_alpha = result.getchannel("A")
    source_bbox = source_alpha.getbbox()
    if not source_bbox:
        result.putalpha(Image.new("L", source.size, 0))
        return result
    outside = Image.new("L", source.size, 0)
    outside.paste(result_alpha.crop(source_bbox), source_bbox)
    # Preserve the serialized trim bounds with invisible low-alpha anchors.
    pixels = outside.load()
    left, top, right, bottom = source_bbox
    for point in ((left, top), (right - 1, top), (left, bottom - 1), (right - 1, bottom - 1)):
        pixels[point] = max(1, pixels[point])
    result.putalpha(outside)
    return result


def logo_asset(source: Image.Image, master: Image.Image, *, scale: float = 0.94) -> Image.Image:
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    alpha = original_alpha_mask(source)
    bbox = alpha.getbbox() if alpha is not None else (0, 0, *source.size)
    if not bbox:
        return result
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    contained = ImageOps.contain(master, (max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.LANCZOS)
    x = bbox[0] + (width - contained.width) // 2
    y = bbox[1] + (height - contained.height) // 2
    result.alpha_composite(contained, (x, y))
    return enforce_alpha_contract(result, source)


def hall_hero(source: Image.Image, master: Image.Image) -> Image.Image:
    w, h = source.size
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    cy = int(h * 0.47)
    for inset, color, width in (
        (35, (42, 170, 183, 70), 3),
        (58, (211, 228, 235, 100), 2),
        (82, (9, 80, 104, 115), 2),
    ):
        draw.arc((inset, cy - (w - inset * 2) // 2, w - inset, cy + (w - inset * 2) // 2), 205, 335, fill=color, width=width)
    logo = ImageOps.contain(master, (290, 290), Image.Resampling.LANCZOS)
    result.alpha_composite(logo, ((w - logo.width) // 2, max(0, (h - logo.height) // 2 - 8)))
    draw.line((100, h - 24, w - 100, h - 24), fill=(159, 192, 204, 115), width=2)
    return enforce_alpha_contract(result, source)


def discover_button(source: Image.Image, master: Image.Image) -> Image.Image:
    w, h = source.size
    scale = 4
    canvas = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    outer = [(68, 34), (141, 34), (174, 67), (157, 144), (52, 144), (35, 67)]
    inner = [(72, 39), (137, 39), (168, 70), (153, 138), (56, 138), (41, 70)]
    outer4 = [(x * scale, y * scale) for x, y in outer]
    inner4 = [(x * scale, y * scale) for x, y in inner]
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.line(outer4 + [outer4[0]], fill=(0, 238, 237, 190), width=5 * scale, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(5 * scale))
    canvas.alpha_composite(glow)
    draw = ImageDraw.Draw(canvas)
    draw.polygon(outer4, fill=(4, 24, 40, 252), outline=(225, 235, 238, 255))
    draw.line(outer4 + [outer4[0]], fill=(220, 232, 236, 255), width=2 * scale, joint="curve")
    draw.line(inner4 + [inner4[0]], fill=(24, 202, 202, 245), width=1 * scale, joint="curve")
    draw.line(
        [(75 * scale, 43 * scale), (134 * scale, 43 * scale)],
        fill=(255, 239, 190, 190), width=1 * scale,
    )
    logo = ImageOps.contain(master, (112 * scale, 82 * scale), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, ((w * scale - logo.width) // 2, 40 * scale))
    label_font = font(21 * scale)
    label = "发现"
    box = draw.textbbox((0, 0), label, font=label_font)
    draw.text(
        ((w * scale - (box[2] - box[0])) / 2, 110 * scale),
        label,
        font=label_font,
        fill=(239, 243, 244, 255),
        stroke_width=1,
        stroke_fill=(50, 83, 96, 220),
    )
    result = canvas.resize(source.size, Image.Resampling.LANCZOS)
    return enforce_alpha_contract(result, source)


def bottom_nav_base(source: Image.Image) -> Image.Image:
    """Rebuild the 153px container as the approved 90px visual footer."""
    w, h = source.size
    scale = 3
    result = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    visual_top = 62
    for y in range(visual_top, h):
        ratio = (y - visual_top) / max(1, h - visual_top - 1)
        color = (
            int(4 + 1 * ratio),
            int(20 - 8 * ratio),
            int(34 - 13 * ratio),
            int(238 + 17 * ratio),
        )
        draw.rectangle((0, y * scale, w * scale, (y + 1) * scale), fill=color)
    draw.line((0, 62 * scale, w * scale, 62 * scale), fill=(223, 232, 234, 255), width=2 * scale)
    draw.line((0, 65 * scale, w * scale, 65 * scale), fill=(34, 118, 137, 210), width=1 * scale)
    # Separators sit midway between the unchanged runtime touch targets.
    for x in (149, 301, 458, 610):
        draw.line(
            (x * scale, 77 * scale, x * scale, 147 * scale),
            fill=(118, 152, 164, 105),
            width=1 * scale,
        )
    result = result.resize(source.size, Image.Resampling.LANCZOS)
    return enforce_alpha_contract(result, source)


def bottom_nav_icon(source: Image.Image, kind: str) -> Image.Image:
    """Draw compact platinum line icons without the old solid round tiles."""
    w, h = source.size
    scale = 4
    canvas = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    strokes = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(strokes)
    white = (229, 238, 241, 255)
    silver = (181, 204, 212, 245)
    width = 2 * scale
    cx = w * scale // 2

    if kind == "ranking":
        star = []
        import math
        for index in range(10):
            angle = -math.pi / 2 + index * math.pi / 5
            radius = (8 if index % 2 == 0 else 3.4) * scale
            star.append((cx + math.cos(angle) * radius, 9 * scale + math.sin(angle) * radius))
        draw.line(star + [star[0]], fill=white, width=max(scale, 1), joint="curve")
        bars = ((-15, 29, 8), (-5, 23, 14), (5, 18, 19))
        for x, top, height in bars:
            draw.rectangle(
                ((w / 2 + x) * scale, top * scale, (w / 2 + x + 7) * scale, (top + height) * scale),
                outline=silver,
                width=width,
            )
        draw.line(((w / 2 - 18) * scale, 39 * scale, (w / 2 + 18) * scale, 39 * scale), fill=white, width=width)
        label_y = 47
    elif kind == "notice":
        draw.rounded_rectangle((10 * scale, 3 * scale, (w - 10) * scale, 38 * scale), radius=3 * scale, outline=white, width=width)
        for y in (13, 20, 27):
            draw.line((16 * scale, y * scale, (w - 16) * scale, y * scale), fill=silver, width=scale)
        label_y = 44
    elif kind == "wallet":
        draw.rounded_rectangle((5 * scale, 9 * scale, (w - 5) * scale, 37 * scale), radius=4 * scale, outline=white, width=width)
        draw.rounded_rectangle(((w - 22) * scale, 17 * scale, (w - 2) * scale, 32 * scale), radius=3 * scale, fill=(4, 23, 37, 255), outline=white, width=width)
        draw.ellipse(((w - 15) * scale, 22 * scale, (w - 11) * scale, 26 * scale), fill=(30, 213, 208, 255))
        label_y = 43
    else:
        draw.ellipse(((w / 2 - 7) * scale, 3 * scale, (w / 2 + 7) * scale, 17 * scale), outline=white, width=width)
        draw.arc((8 * scale, 18 * scale, (w - 8) * scale, 48 * scale), 190, 350, fill=white, width=width)
        draw.line((9 * scale, 34 * scale, 9 * scale, 43 * scale), fill=silver, width=width)
        draw.line(((w - 9) * scale, 34 * scale, (w - 9) * scale, 43 * scale), fill=silver, width=width)
        label_y = 44

    glow = strokes.filter(ImageFilter.GaussianBlur(2.2 * scale))
    glow.putalpha(glow.getchannel("A").point(lambda value: value * 90 // 255))
    canvas.alpha_composite(glow)
    canvas.alpha_composite(strokes)
    labels = {"ranking": "排行榜", "notice": "公告", "wallet": "钱包", "profile": "我的"}
    label = labels[kind]
    label_font = font((15 if kind == "ranking" else 16) * scale)
    text_draw = ImageDraw.Draw(canvas)
    box = text_draw.textbbox((0, 0), label, font=label_font)
    text_draw.text(
        ((w * scale - (box[2] - box[0])) / 2, label_y * scale),
        label,
        font=label_font,
        fill=(225, 234, 237, 255),
    )
    result = canvas.resize(source.size, Image.Resampling.LANCZOS)
    return enforce_alpha_contract(result, source)


def profile_frame(source: Image.Image) -> Image.Image:
    w, h = source.size
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    cx, cy = w // 2, int(h * 0.43)
    radius = max(12, int(min(w, h) * 0.34))
    outer = (cx - radius, cy - radius, cx + radius, cy + radius)
    draw.ellipse(outer, fill=(3, 20, 35, 238), outline=(218, 233, 240, 255), width=max(2, h // 65))
    inset = max(5, h // 30)
    draw.ellipse(
        (outer[0] + inset, outer[1] + inset, outer[2] - inset, outer[3] - inset),
        outline=(20, 197, 195, 235),
        width=max(2, h // 90),
    )
    y = cy + radius // 5
    for side in (-1, 1):
        start = cx + side * radius
        p1 = cx + side * int(radius * 1.65)
        p2 = cx + side * int(radius * 2.35)
        end = cx + side * int(radius * 3.20)
        points = [(start, y), (p1, y - radius // 3), (p2, y - radius // 3), (end, y + radius // 14)]
        draw.line(points, fill=(213, 229, 236, 235), width=max(2, h // 85), joint="curve")
        inner = [(start, y + inset), (p1, y - radius // 3 + inset), (p2, y - radius // 3 + inset), (end, y + radius // 14 + inset)]
        draw.line(inner, fill=(17, 157, 166, 180), width=max(1, h // 125), joint="curve")
    diamond = max(4, h // 30)
    draw.polygon(
        [(cx, cy - radius - diamond * 2), (cx + diamond, cy - radius - diamond),
         (cx, cy - radius), (cx - diamond, cy - radius - diamond)],
        fill=(19, 210, 204, 255), outline=(224, 236, 240, 255),
    )
    return enforce_alpha_contract(result, source)


def card_back(source: Image.Image, master: Image.Image) -> Image.Image:
    w, h = source.size
    result = Image.new("RGBA", source.size, (2, 13, 26, 255))
    draw = ImageDraw.Draw(result)
    margin = max(2, min(w, h) // 24)
    radius = max(4, min(w, h) // 10)
    draw.rounded_rectangle((margin, margin, w - margin - 1, h - margin - 1), radius=radius, fill=(3, 24, 43, 255), outline=(208, 226, 234, 255), width=max(1, margin // 2))
    draw.rounded_rectangle((margin * 2, margin * 2, w - margin * 2 - 1, h - margin * 2 - 1), radius=max(2, radius - margin), outline=(15, 181, 181, 220), width=max(1, margin // 3))
    for inset in range(margin * 3, max(margin * 3 + 1, min(w, h) // 2), max(4, margin * 2)):
        if w - inset * 2 <= 4 or h - inset * 2 <= 4:
            break
        draw.rounded_rectangle((inset, inset, w - inset - 1, h - inset - 1), radius=max(2, radius - inset // 3), outline=(74, 123, 139, 50), width=1)
    logo = ImageOps.contain(master, (max(8, int(w * 0.62)), max(8, int(h * 0.42))), Image.Resampling.LANCZOS)
    result.alpha_composite(logo, ((w - logo.width) // 2, (h - logo.height) // 2))
    alpha = original_alpha_mask(source)
    if alpha is not None:
        result.putalpha(alpha)
    return enforce_alpha_contract(result, source)


def chip_asset(source: Image.Image) -> Image.Image:
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    alpha = original_alpha_mask(source)
    bbox = alpha.getbbox() if alpha is not None else (0, 0, *source.size)
    if not bbox:
        return result
    left, top, right, bottom = bbox
    cx, cy = (left + right - 1) / 2, (top + bottom - 1) / 2
    radius = max(2, min(right - left, bottom - top) / 2 - 1)
    draw = ImageDraw.Draw(result)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=NAVY_2, outline=SILVER, width=max(1, round(radius * .12)))
    inset = max(2, radius * .27)
    draw.ellipse((cx - radius + inset, cy - radius + inset, cx + radius - inset, cy + radius - inset), outline=TEAL, width=max(1, round(radius * .09)))
    diamond = max(1.5, radius * .18)
    draw.polygon(((cx, cy - diamond), (cx + diamond, cy), (cx, cy + diamond), (cx - diamond, cy)), fill=PLATINUM)
    return enforce_alpha_contract(result, source)


def patch_seal(source: Image.Image, center: tuple[float, float], radius: float, master: Image.Image) -> Image.Image:
    result = recolor_8l(source)
    draw = ImageDraw.Draw(result)
    cx, cy = center
    border = max(1, round(radius * .10))
    draw.ellipse((cx - radius - 1, cy - radius - 1, cx + radius + 1, cy + radius + 1), fill=NAVY_2, outline=SILVER, width=border)
    inset = max(2, radius * .25)
    draw.ellipse((cx - radius + inset, cy - radius + inset, cx + radius - inset, cy + radius - inset), outline=TEAL, width=max(1, border - 1))
    if radius >= 14:
        logo = ImageOps.contain(master, (max(4, round(radius * 1.25)), max(4, round(radius * 1.25))), Image.Resampling.LANCZOS)
        result.alpha_composite(logo, (round(cx - logo.width / 2), round(cy - logo.height / 2)))
    else:
        d = max(2, radius * .22)
        draw.polygon(((cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)), fill=PLATINUM)
    return enforce_alpha_contract(result, source)


def table_swatch(source: Image.Image, variant: int) -> Image.Image:
    plate = fit(Image.open(TABLE_SOURCE).convert("RGB"), source.size).convert("RGBA")
    overlay = Image.new("RGBA", source.size, (0, 8 + variant * 3, 18 + variant * 5, 12 + variant * 2))
    plate.alpha_composite(overlay)
    alpha = original_alpha_mask(source)
    if alpha is not None:
        plate.putalpha(alpha)
    return enforce_alpha_contract(plate, source)


def card_stack_icon(source: Image.Image, master: Image.Image) -> Image.Image:
    result = Image.new("RGBA", source.size, (0, 0, 0, 0))
    w, h = source.size
    card_w, card_h = max(8, int(w * .52)), max(12, int(h * .72))
    for index, (dx, angle) in enumerate(((-int(w * .13), -7), (int(w * .13), 7))):
        dummy = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        mask = Image.new("L", dummy.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((1, 1, card_w - 2, card_h - 2), radius=max(2, card_w // 10), fill=255)
        dummy.putalpha(mask)
        card = card_back(dummy, master).rotate(angle, Image.Resampling.BICUBIC, expand=True)
        result.alpha_composite(card, ((w - card.width) // 2 + dx, (h - card.height) // 2 + index))
    return enforce_alpha_contract(result, source)


def common_background(kind: str, size: tuple[int, int]) -> Image.Image:
    source_path = LOGIN_SOURCE if kind == "login" else HALL_SOURCE
    if not source_path.is_file():
        raise SkinError(f"缺少背景母版：{source_path}")
    result = fit(Image.open(source_path).convert("RGB"), size).convert("RGBA")
    if kind == "common":
        overlay = Image.new("RGBA", size, (0, 8, 18, 72))
        result.alpha_composite(overlay)
    return result.convert("RGB")


def table_background(source: Image.Image, variant: int) -> Image.Image:
    # The generated plate already has the correct portrait table proportions
    # for the fixed player-seat coordinates.  Variants stay deliberately close
    # so changing desktop styles cannot reduce text/card contrast.
    base = fit(Image.open(TABLE_SOURCE).convert("RGB"), source.size).convert("RGBA")
    tints = {
        1: (0, 15, 25, 14),
        2: (0, 35, 38, 18),
        3: (8, 28, 50, 13),
        4: (8, 48, 48, 16),
        5: (12, 24, 42, 19),
    }
    base.alpha_composite(Image.new("RGBA", source.size, tints.get(variant, tints[3])))
    return base.convert("RGB")


def atlas_json(path: Path) -> dict | None:
    candidate = path.with_suffix(".json")
    if not candidate.is_file():
        return None
    try:
        return json.loads(candidate.read_text("utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


def clear_frame(atlas: Image.Image, item: dict) -> tuple[int, int, int, int]:
    x, y = int(item["x"]), int(item["y"])
    w, h = int(item["width"]), int(item["height"])
    ImageDraw.Draw(atlas).rectangle((x, y, x + w - 1, y + h - 1), fill=(0, 0, 0, 0))
    return x, y, w, h


def paste_logo_frame(atlas: Image.Image, item: dict, master: Image.Image, opacity: int = 255) -> None:
    x, y, w, h = clear_frame(atlas, item)
    logo = ImageOps.contain(master, (max(1, w - 4), max(1, h - 4)), Image.Resampling.LANCZOS)
    if opacity < 255:
        logo = logo.copy()
        logo.putalpha(logo.getchannel("A").point(lambda value: value * opacity // 255))
    atlas.alpha_composite(logo, (x + (w - logo.width) // 2, y + (h - logo.height) // 2))


def paste_text_frame(atlas: Image.Image, item: dict, text: str) -> None:
    x, y, w, h = clear_frame(atlas, item)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    f = font(max(9, int(h * 0.54)))
    bounds = draw.textbbox((0, 0), text, font=f, stroke_width=1)
    tx = (w - (bounds[2] - bounds[0])) // 2
    ty = (h - (bounds[3] - bounds[1])) // 2 - bounds[1]
    draw.text((tx, ty), text, font=f, fill=SILVER, stroke_width=1, stroke_fill=TEAL_DARK)
    atlas.alpha_composite(layer, (x, y))


def card_for_atlas_slice(size: tuple[int, int], angle: float, master: Image.Image) -> Image.Image:
    width, height = size
    base_width = min(width, 133)
    base_height = min(height, 183)
    dummy = Image.new("RGBA", (base_width, base_height), (0, 0, 0, 0))
    mask = Image.new("L", dummy.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((1, 1, base_width - 2, base_height - 2), radius=max(5, base_width // 12), fill=255)
    dummy.putalpha(mask)
    card = card_back(dummy, master)
    if abs(angle) > .01:
        card = card.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    left = (card.width - width) // 2
    top = (card.height - height) // 2
    if left >= 0 and top >= 0:
        output.alpha_composite(card.crop((left, top, left + width, top + height)))
    else:
        output.alpha_composite(card, ((width - card.width) // 2, (height - card.height) // 2))
    return output


def bigwin_banner(size: tuple[int, int], master: Image.Image) -> Image.Image:
    w, h = size
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    margin_x = max(3, int(w * .06))
    margin_y = max(3, int(h * .12))
    radius = max(5, int(min(w, h) * .10))
    draw.rounded_rectangle((margin_x, margin_y, w - margin_x - 1, h - margin_y - 1), radius=radius, fill=(2, 17, 31, 246), outline=SILVER, width=max(1, int(min(w, h) * .018)))
    inset = max(3, int(min(w, h) * .055))
    draw.rounded_rectangle((margin_x + inset, margin_y + inset, w - margin_x - inset - 1, h - margin_y - inset - 1), radius=max(3, radius - inset // 2), outline=TEAL, width=max(1, int(min(w, h) * .010)))
    logo_size = max(8, int(min(w, h) * .30))
    logo = ImageOps.contain(master, (logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_y = margin_y + max(1, int(h * .025))
    result.alpha_composite(logo, ((w - logo.width) // 2, logo_y))
    title = "大赢家"
    f = font(max(8, int(h * .24)))
    bounds = draw.textbbox((0, 0), title, font=f, stroke_width=1)
    tx = (w - (bounds[2] - bounds[0])) / 2 - bounds[0]
    ty = h * .57 - (bounds[3] - bounds[1]) / 2 - bounds[1]
    draw.text((tx, ty), title, font=f, fill=SILVER, stroke_width=1, stroke_fill=TEAL_DARK)
    draw.line((int(w * .24), int(h * .81), int(w * .76), int(h * .81)), fill=CHAMPAGNE, width=max(1, int(h * .01)))
    return result


def patch_atlas(path: Path, image: Image.Image, master: Image.Image) -> Image.Image:
    document = atlas_json(path)
    if not document:
        return image
    atlas = image.convert("RGBA")
    natural_hand_atlas: Image.Image | None = None
    if relative(path) == ATLAS_HAND:
        if not NATURAL_HAND_ATLAS.is_file():
            raise SkinError(f"缺少正常肤色人手图集：{NATURAL_HAND_ATLAS}")
        with Image.open(NATURAL_HAND_ATLAS) as opened:
            natural_hand_atlas = opened.convert("RGBA")
        if natural_hand_atlas.size != atlas.size:
            raise SkinError(
                f"正常肤色人手图集尺寸错误：{natural_hand_atlas.size} != {atlas.size}"
            )
    for item in document.get("SubTexture") or []:
        name = str(item.get("name", ""))
        if relative(path) == ATLAS_LOGO:
            if name.startswith("LOGO_"):
                suffix = int(name.split("_")[-1]) if name.split("_")[-1].isdigit() else 8
                paste_logo_frame(atlas, item, master, opacity=min(255, 110 + suffix * 11))
            elif name in {"PAI_1", "PAI_2", "CHOUMA"}:
                clear_frame(atlas, item)
        elif relative(path) == ATLAS_NAV and name == "POKER_1":
            paste_logo_frame(atlas, item, master)
        elif relative(path) == ATLAS_HAND and name in {
            "放牌", "放牌2", "放牌3", "下牌", "下牌2", "下牌3", "上牌", "上牌2", "上牌3"
        }:
            x, y, w, h = clear_frame(atlas, item)
            angle = 7.0 if name.startswith("下牌") else (-7.0 if name.startswith("上牌") else 0.0)
            atlas.alpha_composite(card_for_atlas_slice((w, h), angle, master), (x, y))
        elif relative(path) == ATLAS_HAND and name in NATURAL_HAND_FRAMES:
            x = int(item["x"])
            y = int(item["y"])
            w = int(item["width"])
            h = int(item["height"])
            # 人手是动画骨骼切片，只恢复原版正常肤色像素；牌背切片仍由上面
            # 的8L逻辑生成，图集坐标、尺寸、透明度和DragonBones数据均不改。
            atlas.paste(natural_hand_atlas.crop((x, y, x + w, y + h)), (x, y))
        elif relative(path) in ATLAS_BIGWIN:
            if name.startswith("WING") or name == "zi_00000":
                x, y, w, h = clear_frame(atlas, item)
                atlas.alpha_composite(bigwin_banner((w, h), master), (x, y))
            elif name in {"BIG", "PAI1", "PAI2", "g_00000"}:
                paste_logo_frame(atlas, item, master)
            elif name in {"WIN"}:
                paste_text_frame(atlas, item, "大奖")
    return atlas


def special_result(path: Path, source: Image.Image, master: Image.Image) -> Image.Image | None:
    value = relative(path)
    if value == "assets/resources/other/观战.png":
        # 观战状态使用独立的黑金高对比铭牌，不能再被全局蓝色换色覆盖。
        return source.copy()
    if value == "assets/ImagesLuck/奖池/比列.png":
        # The chart is UI art around twelve real playing-card faces.  Recolour
        # the labels/rings, but keep standard red/black card semantics intact.
        return jackpot_card_colors.preserve_card_faces(recolor_8l(source), source)
    if value in BACKGROUND_TARGETS:
        return common_background(BACKGROUND_TARGETS[value], source.size)
    if value == HALL_HERO:
        return hall_hero(source, master)
    if value == DISCOVER_BUTTON:
        return discover_button(source, master)
    if value == BOTTOM_NAV_BASE:
        return bottom_nav_base(source)
    if value in BOTTOM_NAV_ICONS:
        return bottom_nav_icon(source, BOTTOM_NAV_ICONS[value])
    if value == PROFILE_FRAME:
        return profile_frame(source)
    if value == "assets/ImagesLuck/游戏内/yuan.png":
        # 该图是头像倒计时与决策进度的径向填充遮罩，节点颜色会在运行时
        # 切换为黑/绿/橙/红。必须保留原圆形 alpha，不能重建成实心矩形。
        result = Image.new("RGBA", source.size, (255, 255, 255, 0))
        if "A" in source.getbands():
            result.putalpha(source.convert("RGBA").getchannel("A"))
        return result
    if value in WHOLE_CHIP_TARGETS:
        return chip_asset(source)
    if value in SEAL_PATCHES:
        x, y, radius = SEAL_PATCHES[value]
        return patch_seal(source, (x, y), radius, master)
    if value == "assets/ImagesLuck/游戏内/dfc32212323.png":
        return card_stack_icon(source, master)
    if value.startswith("assets/ImagesLuck/游戏内/额外/") and path.stem in {"1", "2", "3", "4", "5"}:
        return table_swatch(source, int(path.stem))
    if value in TURNTABLE_BUTTONS:
        return patch_seal(source, (source.width / 2, source.height / 2), min(source.size) * .30, master)
    if value in TURNTABLE_WHEELS:
        return patch_seal(source, (source.width / 2, source.height * .49), min(source.width * .18, source.height * .21), master)
    if value in LOGO_TARGETS:
        return logo_asset(source, master)
    if value.startswith("assets/resources/zuotype/") and path.suffix.lower() in {".jpg", ".jpeg"} and path.stem.isdigit():
        return table_background(source, int(path.stem))
    if value in PK2_SKIN_FILES or "牌背" in path.stem or "搓背" in path.stem:
        return card_back(source, master)
    return None


def save_atomic(path: Path, image: Image.Image, source: Image.Image) -> None:
    suffix = path.suffix.lower()
    target_mode = source.mode
    if suffix in {".jpg", ".jpeg"}:
        output = image.convert("RGB")
    elif "A" in source.getbands():
        output = image.convert("RGBA")
    else:
        output = image.convert("RGB")
    if output.size != source.size:
        raise SkinError(f"输出尺寸变化：{relative(path)} {source.size} -> {output.size}")
    with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", suffix=suffix, dir=path.parent, delete=False) as handle:
        temp = Path(handle.name)
    try:
        if suffix in {".jpg", ".jpeg"}:
            output.save(temp, quality=95, subsampling=0, optimize=True)
        else:
            output.save(temp, optimize=True)
        with Image.open(temp) as check:
            if check.size != source.size:
                raise SkinError(f"写入后尺寸错误：{relative(path)}")
            if suffix == ".png" and check.mode != output.mode:
                raise SkinError(f"写入后模式错误：{relative(path)} {check.mode} != {output.mode}")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def build_one(path: Path, master: Image.Image) -> None:
    with Image.open(path) as opened:
        source = canonical_image(opened)
    result = special_result(path, source, master)
    rebuilt = result is not None
    if result is None:
        result = recolor_8l(source)
    value = relative(path)
    if value in {ATLAS_LOGO, ATLAS_NAV, ATLAS_HAND} or value in ATLAS_BIGWIN:
        result = patch_atlas(path, result, master)
    if "A" in source.getbands():
        # Generic recolours preserve alpha exactly; brand rebuilds and edited
        # atlases preserve the original outer trim bounding box so Creator's
        # serialized sprite offsets cannot move.
        if not rebuilt and value not in {ATLAS_LOGO, ATLAS_NAV, ATLAS_HAND, *ATLAS_BIGWIN}:
            result.putalpha(source.convert("RGBA").getchannel("A"))
        else:
            result = enforce_alpha_contract(result, source)
    save_atomic(path, result, source)


def validate_targets(targets: list[Path], before: dict[str, dict] | None = None) -> None:
    errors: list[str] = []
    for path in targets:
        value = relative(path)
        try:
            with Image.open(path) as image:
                info = {"size": image.size, "mode": image.mode}
                if "A" in image.getbands():
                    info["bbox"] = image.convert("RGBA").getchannel("A").getbbox()
        except Exception as exc:
            errors.append(f"无法读取 {value}: {exc}")
            continue
        if before and value in before:
            expected = before[value]
            if info["size"] != expected["size"]:
                errors.append(f"尺寸变化 {value}: {expected['size']} -> {info['size']}")
            if expected.get("bbox") and info.get("bbox") != expected.get("bbox"):
                errors.append(f"透明裁剪变化 {value}: {expected.get('bbox')} -> {info.get('bbox')}")
        meta = path.with_suffix(path.suffix + ".meta")
        if not meta.is_file():
            errors.append(f"缺少 meta：{value}")
    if errors:
        raise SkinError("\n".join(errors[:30]))


def apply(targets: list[Path], verbose: bool) -> None:
    for source in (LOGIN_SOURCE, HALL_SOURCE, TABLE_SOURCE, LOGO_GENERATED, FONT_PATH):
        if not source.is_file():
            raise SkinError(f"缺少8L换皮依赖：{source}")
    master = prepare_logo_master()
    before: dict[str, dict] = {}
    meta_hashes: dict[str, str] = {}
    for path in targets:
        with Image.open(path) as image:
            materialized = canonical_image(image)
            entry: dict = {"size": materialized.size, "mode": materialized.mode}
            if "A" in materialized.getbands():
                entry["bbox"] = materialized.getchannel("A").getbbox()
            before[relative(path)] = entry
        meta = path.with_suffix(path.suffix + ".meta")
        if meta.is_file():
            meta_hashes[relative(meta)] = sha256(meta)

    total = len(targets)
    for index, path in enumerate(targets, 1):
        build_one(path, master)
        if verbose or index == total or index % 25 == 0:
            print(f"[{index}/{total}] {relative(path)}")
    validate_targets(targets, before)
    for value, digest in meta_hashes.items():
        if sha256(ROOT / value) != digest:
            raise SkinError(f"meta 被意外修改：{value}")
    print(f"8L 全界面运行美术生成完成：{total} 张；尺寸、透明裁剪、meta 哈希均通过")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="生成8L蓝绿银全界面美术")
    result.add_argument("--write-targets", type=Path, help="只写出运行图片目标清单，不修改 assets")
    result.add_argument("--targets-file", type=Path, help="应用时使用指定清单，默认重新发现")
    result.add_argument("--apply", action="store_true", help="原路径覆盖生成（请先用 manage_skin_versions.py 快照）")
    result.add_argument("--verbose", action="store_true")
    return result


def read_target_file(path: Path) -> list[Path]:
    targets: list[Path] = []
    for line in path.read_text("utf-8-sig").splitlines():
        value = line.strip()
        if value and not value.startswith("#"):
            candidate = (ROOT / value).resolve()
            if not candidate.is_file() or not is_image(candidate):
                raise SkinError(f"目标清单包含无效图片：{value}")
            targets.append(candidate)
    return sorted(set(targets), key=relative)


def main() -> int:
    args = parser().parse_args()
    try:
        if args.write_targets:
            targets = write_targets((ROOT / args.write_targets).resolve() if not args.write_targets.is_absolute() else args.write_targets)
            print(f"已写出8L运行图片清单：{len(targets)} 张 -> {args.write_targets}")
        if args.apply:
            targets = read_target_file(args.targets_file) if args.targets_file else collect_targets()
            if not targets:
                raise SkinError("没有可生成的目标图片")
            apply(targets, args.verbose)
        if not args.write_targets and not args.apply:
            parser().print_help()
    except (SkinError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
