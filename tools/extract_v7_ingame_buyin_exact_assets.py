#!/usr/bin/env python3
"""Extract the confirmed V7 in-room buy-in popup into formal Cocos assets.

Static lettering and icons are cut from the approved effect image.  The amount,
current/total value and slider position remain dynamic in the Prefab.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    ROOT
    / "design-previews"
    / "2026-09-07-V7带入积分弹窗效果图-v1"
    / "01-带入积分.png"
)
OUT = ROOT / "assets" / "resources" / "V7"
UUID_NAMESPACE = uuid.UUID("9728f9cc-34af-4a03-ab02-cc55e4c174ce")


def stable_uuid(label: str) -> str:
    return str(uuid.uuid5(UUID_NAMESPACE, label))


def write_meta(path: Path, *, borders: tuple[int, int, int, int] = (0, 0, 0, 0)) -> None:
    with Image.open(path) as image:
        width, height = image.size
    raw_uuid = stable_uuid("raw:" + path.name)
    frame_uuid = stable_uuid("frame:" + path.name)
    left, right, top, bottom = borders
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
                "borderTop": top,
                "borderBottom": bottom,
                "borderLeft": left,
                "borderRight": right,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def save(image: Image.Image, name: str, *, borders: tuple[int, int, int, int] = (0, 0, 0, 0)) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    image.save(path, optimize=True)
    write_meta(path, borders=borders)


def rounded_crop(
    source: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
) -> Image.Image:
    crop = source.crop(box).convert("RGBA")
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (1, 1, crop.width - 2, crop.height - 2), radius=radius, fill=255
    )
    crop.putalpha(mask)
    return crop


def surface(size: tuple[int, int], top=(8, 37, 68), bottom=(2, 18, 36)) -> Image.Image:
    image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        ratio = y / max(1, size[1] - 1)
        colour = tuple(
            round(top[channel] * (1 - ratio) + bottom[channel] * ratio)
            for channel in range(3)
        ) + (255,)
        draw.line((0, y, size[0], y), fill=colour)
    return image


def clean_inner(crop: Image.Image, inset: int, radius: int) -> Image.Image:
    """Preserve the direct-cut border but clear its illustrative live content."""

    result = crop.copy().convert("RGBA")
    clean = surface((result.width - inset * 2, result.height - inset * 2))
    clean = clean.filter(ImageFilter.GaussianBlur(0.55))
    mask = Image.new("L", clean.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, clean.width - 1, clean.height - 1), radius=radius, fill=255
    )
    result.paste(clean, (inset, inset), mask)
    return result


def make_panel(source: Image.Image) -> None:
    # Full fixed popup, including the approved title, crest and fine border.
    panel = source.crop((100, 351, 841, 1300)).convert("RGBA")

    # The slider position is live.  Remove its complete illustrated group here;
    # the confirmed endpoint/helper lettering is restored by a separate direct cut.
    clean = surface((625, 174), top=(8, 40, 71), bottom=(4, 25, 47))
    clean = clean.filter(ImageFilter.GaussianBlur(0.7))
    panel.paste(clean, (58, 428))

    # Use a shape mask matching the fixed modal body plus its top spade crest.
    mask = Image.new("L", panel.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 70, panel.width - 1, panel.height - 1), radius=48, fill=255)
    draw.ellipse((288, 0, 451, 140), fill=255)
    draw.polygon(((270, 70), (290, 45), (451, 45), (471, 70)), fill=255)
    panel.putalpha(mask)
    save(panel, "ingame_buyin_panel_exact.png")


def make_amount(source: Image.Image) -> None:
    crop = rounded_crop(source, (160, 578, 781, 747), 26)
    crop = clean_inner(crop, 13, 19)
    save(crop, "ingame_buyin_amount_box_exact.png")


def make_info(source: Image.Image) -> None:
    crop = rounded_crop(source, (157, 976, 784, 1102), 15)
    # Keep the direct-cut coin icon and label; clear only the live current/total value.
    clean = surface((190, 83), top=(7, 31, 56), bottom=(3, 18, 35))
    clean = clean.filter(ImageFilter.GaussianBlur(0.45))
    crop.paste(clean, (410, 22))
    save(crop, "ingame_buyin_info_box_exact.png")


def make_buttons(source: Image.Image) -> None:
    specs = {
        "ingame_buyin_topup_exact.png": ((572, 620, 738, 699), 20),
        "ingame_buyin_cancel_exact.png": ((158, 1134, 441, 1238), 32),
        "ingame_buyin_confirm_exact.png": ((491, 1134, 784, 1238), 32),
        "ingame_buyin_close_exact.png": ((737, 448, 814, 525), 39),
    }
    for name, (box, radius) in specs.items():
        save(rounded_crop(source, box, radius), name)


def make_slider(source: Image.Image) -> None:
    # Clean scalable track matching the approved outline and cyan light line.
    scale = 3
    width, height = 620 * scale, 44 * scale
    track = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(track)
    draw.rounded_rectangle(
        (2 * scale, 2 * scale, width - 3 * scale, height - 3 * scale),
        radius=20 * scale,
        fill=(3, 17, 31, 255),
        outline=(226, 190, 119, 255),
        width=2 * scale,
    )
    draw.rounded_rectangle(
        (8 * scale, 8 * scale, width - 9 * scale, height - 9 * scale),
        radius=14 * scale,
        outline=(74, 156, 201, 230),
        width=2 * scale,
    )
    draw.line(
        (18 * scale, 17 * scale, (620 - 18) * scale, 17 * scale),
        fill=(65, 178, 237, 100),
        width=2 * scale,
    )
    track = track.resize((620, 44), Image.Resampling.LANCZOS)
    save(track, "ingame_buyin_slider_track_exact.png", borders=(20, 20, 20, 20))

    # The ornate spade handle is direct-cut; a circular alpha mask removes the
    # source background without touching the gold/cyan ring.
    handle = source.crop((411, 782, 510, 881)).convert("RGBA")
    mask = Image.new("L", handle.size, 0)
    ImageDraw.Draw(mask).ellipse((1, 1, handle.width - 2, handle.height - 2), fill=255)
    handle.putalpha(mask)
    save(handle, "ingame_buyin_slider_handle_exact.png")

    # Dynamic blue progress strip.  It is updated only in width by SliderEx.
    fill = Image.new("RGBA", (560, 24), (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill)
    fill_draw.rounded_rectangle(
        (0, 0, 559, 23),
        radius=12,
        fill=(22, 127, 217, 255),
        outline=(87, 207, 255, 255),
        width=3,
    )
    fill = fill.filter(ImageFilter.GaussianBlur(0.18))
    save(fill, "ingame_buyin_slider_fill_exact.png", borders=(12, 12, 10, 10))

    copy = source.crop((145, 854, 796, 950)).convert("RGBA")
    save(copy, "ingame_buyin_slider_copy_exact.png")


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (941, 1672):
        raise RuntimeError(f"unexpected source size: {source.size}")
    make_panel(source)
    make_amount(source)
    make_info(source)
    make_buttons(source)
    make_slider(source)
    print("extracted confirmed V7 in-room buy-in popup assets")


if __name__ == "__main__":
    main()
