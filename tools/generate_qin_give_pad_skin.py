#!/usr/bin/env python3
"""Generate the restrained black-gold Qin skin used by panelGivePad.

Only panel-specific PNG pixels are overwritten. Shared frame, avatar, input and
secondary-button assets are intentionally left untouched. The prefab keeps its
node names and interaction hierarchy; a small serialized color/layout patch is
maintained separately in panelGivePad.prefab.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

sys.dont_write_bytecode = True

from generate_qin_ranking_skin import (  # noqa: E402
    GOLD,
    GOLD_DARK,
    GOLD_HI,
    GOLD_MID,
    IVORY,
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
TEXT = ROOT / "assets" / "ImagesLuck" / "文字"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
OTHER = ROOT / "assets" / "resources" / "other"
ART = ROOT / "art_sources" / "give_pad"
PREFAB = ROOT / "assets" / "resources" / "UI" / "panelGivePad.prefab"

OUTPUTS: list[Path] = []


def scaled(size: tuple[int, int]) -> tuple[int, int]:
    return size[0] * S, size[1] * S


def emit(path: Path, image: Image.Image) -> Path:
    output = save(path, image)
    OUTPUTS.append(output)
    return output


def make_title() -> Path:
    """Rebuild the old cyan title as a compact ceremonial gold nameplate."""
    path = KK_COMMON / "赠送金币.png"
    size = Image.open(path).size
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cy = size[1] * S // 2

    for left, right in ((1, 14), (size[0] - 15, size[0] - 1)):
        draw.line((left * S, cy, right * S, cy), fill=(211, 150, 61, 170), width=S)
    for cx in (10, size[0] - 10):
        d = 3 * S
        draw.polygon(((cx * S, cy - d), (cx * S + d, cy), (cx * S, cy + d), (cx * S - d, cy)),
                     fill=GOLD_MID, outline=GOLD_HI)

    metal_text(
        image,
        "赠送金币",
        font(PING, 22),
        (size[0] * S // 2, cy),
        stroke=1,
        glow=2,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_profile_plate() -> Path:
    """Create the two quiet lacquer strips behind nickname and player ID."""
    path = COMMON / "名字垫底.png"
    size = Image.open(path).size
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))

    shadow_mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle(
        (3 * S, 4 * S, (size[0] - 2) * S, (size[1] - 2) * S),
        radius=14 * S,
        fill=150,
    )
    shadow = Image.new("RGBA", canvas, (0, 0, 0, 0))
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(3 * S)))
    image.alpha_composite(shadow)

    panel = gradient(canvas, (37, 29, 18, 248), (7, 7, 6, 250))
    panel_mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(panel_mask).rounded_rectangle(
        (1 * S, 1 * S, (size[0] - 1) * S, (size[1] - 1) * S),
        radius=14 * S,
        fill=255,
    )
    panel.putalpha(panel_mask)
    image.alpha_composite(panel)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (1 * S, 1 * S, (size[0] - 1) * S, (size[1] - 1) * S),
        radius=14 * S,
        outline=(119, 74, 27, 235),
        width=2 * S,
    )
    draw.rounded_rectangle(
        (5 * S, 5 * S, (size[0] - 5) * S, (size[1] - 5) * S),
        radius=10 * S,
        outline=(244, 207, 126, 95),
        width=S,
    )
    draw.line((22 * S, 6 * S, (size[0] - 42) * S, 6 * S), fill=(255, 235, 174, 38), width=S)

    # A restrained Qin seal at the far right keeps the dynamic text area clear.
    cx, cy = (size[0] - 21) * S, size[1] * S // 2
    draw.ellipse((cx - 12 * S, cy - 12 * S, cx + 12 * S, cy + 12 * S),
                 fill=(50, 31, 12, 170), outline=(174, 111, 36, 175), width=S)
    draw.ellipse((cx - 8 * S, cy - 8 * S, cx + 8 * S, cy + 8 * S),
                 outline=(237, 194, 101, 80), width=S)
    center_text(draw, (cx, cy), "秦", font(SONGTI, 11), (221, 166, 75, 155))

    marker_x = 12 * S
    d = 3 * S
    draw.polygon(((marker_x, cy - d), (marker_x + d, cy), (marker_x, cy + d), (marker_x - d, cy)),
                 fill=(226, 174, 78, 205))
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_field_label(path: Path, text: str, text_size: int) -> Path:
    size = Image.open(path).size
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    metal_text(
        image,
        text,
        font(PING, text_size),
        (size[0] * S // 2, size[1] * S // 2),
        stroke=1,
        glow=0,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_primary_button() -> Path:
    """Create a warm, weighty primary action without changing hit geometry."""
    path = KK_COMMON / "赠送按钮1.png"
    size = Image.open(path).size
    canvas = scaled(size)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))

    glow_mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(glow_mask).rounded_rectangle(
        (4 * S, 5 * S, (size[0] - 4) * S, (size[1] - 5) * S),
        radius=22 * S,
        outline=155,
        width=7 * S,
    )
    glow = Image.new("RGBA", canvas, (198, 119, 27, 0))
    glow.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(5 * S)))
    image.alpha_composite(glow)

    panel = gradient(canvas, (76, 48, 20, 252), (10, 8, 5, 254))
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (2 * S, 3 * S, (size[0] - 2) * S, (size[1] - 3) * S),
        radius=22 * S,
        fill=255,
    )
    panel.putalpha(mask)
    image.alpha_composite(panel)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (2 * S, 3 * S, (size[0] - 2) * S, (size[1] - 3) * S),
        radius=22 * S,
        outline=GOLD_DARK,
        width=5 * S,
    )
    draw.rounded_rectangle(
        (7 * S, 8 * S, (size[0] - 7) * S, (size[1] - 8) * S),
        radius=17 * S,
        outline=(248, 213, 137, 225),
        width=S,
    )
    draw.rounded_rectangle(
        (10 * S, 11 * S, (size[0] - 10) * S, (size[1] - 11) * S),
        radius=14 * S,
        outline=(138, 83, 28, 180),
        width=S,
    )
    draw.line((25 * S, 12 * S, (size[0] - 25) * S, 12 * S), fill=(255, 239, 185, 85), width=S)

    # Coin seal and divider give the primary action its own recognizable silhouette.
    cx, cy = 42 * S, size[1] * S // 2
    draw.ellipse((cx - 18 * S, cy - 18 * S, cx + 18 * S, cy + 18 * S),
                 fill=(43, 26, 9, 235), outline=GOLD_HI, width=2 * S)
    draw.ellipse((cx - 12 * S, cy - 12 * S, cx + 12 * S, cy + 12 * S),
                 outline=GOLD_MID, width=S)
    center_text(draw, (cx, cy), "秦", font(SONGTI, 17), GOLD_HI,
                stroke_width=S, stroke_fill=(56, 30, 8, 255))
    draw.line((75 * S, 20 * S, 75 * S, (size[1] - 20) * S), fill=(154, 94, 31, 150), width=S)

    metal_text(image, "赠送", font(PING, 28), (166 * S, cy), stroke=1, glow=2)
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def paste_center(canvas: Image.Image, asset: Image.Image, center: tuple[float, float], size: tuple[int, int] | None = None) -> None:
    if size is not None:
        asset = asset.resize(size, Image.Resampling.LANCZOS)
    x = round(center[0] - asset.width / 2)
    y = round(center[1] - asset.height / 2)
    canvas.alpha_composite(asset.convert("RGBA"), (x, y))


def nine_slice(
    source: Image.Image,
    target_size: tuple[int, int],
    borders: tuple[int, int, int, int],
) -> Image.Image:
    """Resize a Cocos SLICED Sprite without stretching its fixed border bays."""
    source = source.convert("RGBA")
    target = Image.new("RGBA", target_size, (0, 0, 0, 0))
    left, right, top, bottom = borders
    sx = (0, left, source.width - right, source.width)
    sy = (0, top, source.height - bottom, source.height)
    dx = (0, left, target_size[0] - right, target_size[0])
    dy = (0, top, target_size[1] - bottom, target_size[1])
    for row in range(3):
        for col in range(3):
            source_box = (sx[col], sy[row], sx[col + 1], sy[row + 1])
            destination_box = (dx[col], dy[row], dx[col + 1], dy[row + 1])
            tile = source.crop(source_box)
            width = destination_box[2] - destination_box[0]
            height = destination_box[3] - destination_box[1]
            if tile.size != (width, height):
                tile = tile.resize((width, height), Image.Resampling.LANCZOS)
            target.alpha_composite(tile, (destination_box[0], destination_box[1]))
    return target


def preview_font(size: int):
    return font(PING, size / S)


def make_preview() -> Path:
    """Compose the generated runtime PNGs at the serialized prefab positions."""
    background_path = COMMON / "背景.png"
    if background_path.exists():
        background = ImageOps.fit(Image.open(background_path).convert("RGB"), (750, 1334), Image.Resampling.LANCZOS)
    else:
        background = Image.new("RGB", (750, 1334), (11, 10, 8))
    background = background.convert("RGBA")
    background.alpha_composite(Image.new("RGBA", background.size, (0, 0, 0, 148)))

    frame = nine_slice(Image.open(KK_COMMON / "框.png"), (700, 734), (83, 81, 106, 42))
    background.alpha_composite(frame, (25, 300))

    paste_center(background, Image.open(KK_COMMON / "赠送金币.png"), (375, 354))
    paste_center(background, Image.open(COMMON / "头像2.png"), (273, 523))
    avatar = Image.open(OTHER / "默认头像.png").convert("RGBA").resize((139, 139), Image.Resampling.LANCZOS)
    paste_center(background, avatar, (273, 523))

    plate = Image.open(COMMON / "名字垫底.png").convert("RGBA")
    paste_center(background, plate, (433, 496), (247, 41))
    paste_center(background, plate, (433, 558), (247, 41))

    draw = ImageDraw.Draw(background)
    draw.text((355, 486), "秦风雅客", font=preview_font(22), fill=IVORY,
              stroke_width=1, stroke_fill=(40, 23, 8, 255))
    draw.text((349, 548), "ID:", font=preview_font(21), fill=(202, 156, 82, 255))
    draw.text((388, 548), "100086", font=preview_font(22), fill=IVORY,
              stroke_width=1, stroke_fill=(40, 23, 8, 255))

    input_frame = Image.open(COMMON / "输入框.png").convert("RGBA")
    paste_center(background, input_frame, (385, 668))
    paste_center(background, input_frame, (385, 773))
    paste_center(background, Image.open(TEXT / "金额.png"), (205, 668))
    paste_center(background, Image.open(TEXT / "交易密码.png"), (205, 773))
    draw.text((305, 657), "请输入金额", font=preview_font(20), fill=(153, 143, 123, 255))
    draw.text((305, 762), "请输入交易密码", font=preview_font(20), fill=(153, 143, 123, 255))

    paste_center(background, Image.open(COMMON / "取消.png"), (251, 898))
    paste_center(background, Image.open(KK_COMMON / "赠送按钮1.png"), (514, 898))

    ART.mkdir(parents=True, exist_ok=True)
    out = ART / "qin_give_pad_runtime_preview.png"
    background.convert("RGB").save(out, quality=95)
    return out


def validate() -> None:
    expected = {
        KK_COMMON / "赠送金币.png": (131, 40),
        COMMON / "名字垫底.png": (240, 41),
        TEXT / "金额.png": (54, 31),
        TEXT / "交易密码.png": (108, 32),
        KK_COMMON / "赠送按钮1.png": (258, 84),
    }
    for path, size in expected.items():
        image = Image.open(path)
        if image.size != size or image.mode != "RGBA":
            raise RuntimeError(f"Invalid output {path}: {image.size} {image.mode}")
        meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
        if (meta["width"], meta["height"]) != size:
            raise RuntimeError(f"Meta size mismatch: {path}")
        sub_meta = next(iter(meta["subMetas"].values()))
        expected_bbox = (
            int(sub_meta["trimX"]),
            int(sub_meta["trimY"]),
            int(sub_meta["trimX"] + sub_meta["width"]),
            int(sub_meta["trimY"] + sub_meta["height"]),
        )
        if image.getchannel("A").getbbox() != expected_bbox:
            raise RuntimeError(f"Alpha trim mismatch: {path}")

        # Old art used saturated cyan. No strongly blue pixel may survive.
        pixels = image.get_flattened_data()
        if any(b > 145 and b > r * 1.45 and b > g * 1.15 for r, g, b, a in pixels if a > 32):
            raise RuntimeError(f"Strong blue pixels remain: {path}")


def validate_prefab() -> None:
    data = json.loads(PREFAB.read_text(encoding="utf-8"))
    nodes: dict[str, dict] = {}

    def walk(index: int, parent: str = "") -> None:
        node = data[index]
        if node.get("__type__") != "cc.Node":
            return
        node_path = f"{parent}/{node['_name']}" if parent else node["_name"]
        nodes[node_path] = node
        for child in node.get("_children", []):
            walk(child["__id__"], node_path)

    walk(1)
    required = (
        "panelGivePad/bk/输入金额",
        "panelGivePad/bk/金额",
        "panelGivePad/bk/id",
        "panelGivePad/bk/name",
        "panelGivePad/bk/密码",
        "panelGivePad/bk/头像/mask/img",
        "panelGivePad/bk/确定赠送",
        "panelGivePad/bk/关闭",
    )
    missing = [path for path in required if path not in nodes]
    if missing:
        raise RuntimeError(f"Missing scripted panelGivePad nodes: {missing}")

    amount = nodes["panelGivePad/bk/金额"]
    x, y = amount["_trs"]["array"][:2]
    if abs(x - 3.617) > 1e-6 or abs(y + 1.454) > 1e-6:
        raise RuntimeError(f"Fixed amount label escaped its input bay: {(x, y)}")

    bk = nodes["panelGivePad/bk"]
    child_ids = [item["__id__"] for item in bk["_children"]]
    amount_index = data.index(amount)
    input_frame_index = data.index(nodes["panelGivePad/bk/img"])
    if child_ids.index(amount_index) < child_ids.index(input_frame_index):
        raise RuntimeError("Fixed amount label is rendered below the opaque input frame")


def main() -> None:
    make_title()
    make_profile_plate()
    make_field_label(TEXT / "金额.png", "金额", 21)
    make_field_label(TEXT / "交易密码.png", "交易密码:", 20)
    make_primary_button()
    validate()
    validate_prefab()
    preview = make_preview()

    print("Generated panelGivePad Qin skin:")
    for path in OUTPUTS:
        print(path.relative_to(ROOT))
    print(preview.relative_to(ROOT))


if __name__ == "__main__":
    main()
