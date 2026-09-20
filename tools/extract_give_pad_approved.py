#!/usr/bin/env python3
"""Extract approved fixed artwork for panelGivePad without baking live data."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design-previews/效果图V8-new/04-登录与弹窗/赠送金币-20260920.png"
OUT = ROOT / "assets/V7"
PREFIX = "give_pad_approved_"
CLEAN_PANEL = ROOT / "art_sources/give-pad-approved/give_pad_approved_clean_panel_source.png"


def write_meta(path: Path, key: str, size: tuple[int, int], borders=(0, 0, 0, 0)) -> None:
    texture = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/give-pad-approved/texture/" + key))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/give-pad-approved/frame/" + key))
    w, h = size
    top, bottom, left, right = borders
    sub = {"ver": "1.0.6", "uuid": frame, "importer": "sprite-frame", "rawTextureUuid": texture,
           "trimType": "none", "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0,
           "trimX": 0, "trimY": 0, "width": w, "height": h, "rawWidth": w, "rawHeight": h,
           "borderTop": top, "borderBottom": bottom, "borderLeft": left, "borderRight": right, "subMetas": {}}
    data = {"ver": "2.3.7", "uuid": texture, "importer": "texture", "type": "sprite", "wrapMode": "clamp",
            "filterMode": "bilinear", "premultiplyAlpha": False, "genMipmaps": False, "packable": True,
            "width": w, "height": h, "platformSettings": {}, "subMetas": {path.stem: sub}}
    path.with_suffix(".png.meta").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save(key: str, image: Image.Image, borders=(0, 0, 0, 0)) -> None:
    path = OUT / f"{PREFIX}{key}.png"
    image.save(path, optimize=True)
    write_meta(path, key, image.size, borders)


def keyed_crop(source: Image.Image, box: tuple[int, int, int, int], threshold=146) -> Image.Image:
    """Keep the reference pixels which form the bright fixed art, with true alpha."""
    crop = source.crop(box).convert("RGBA")
    gray = crop.convert("L")
    alpha = gray.point(lambda value: 255 if value >= threshold else 0).filter(ImageFilter.MaxFilter(3))
    # Preserve a thin antialiased edge from the approved pixels, not blue screenshot rows.
    soft = gray.point(lambda value: max(0, min(255, (value - threshold + 24) * 11)))
    alpha = ImageChops.lighter(alpha, soft)
    crop.putalpha(alpha)
    return crop


def make_panel() -> Image.Image:
    """Use the supplied clean high-resolution panel, trimming only generator fringe transparency."""
    if not CLEAN_PANEL.is_file():
        raise FileNotFoundError(CLEAN_PANEL)
    original = Image.open(CLEAN_PANEL).convert("RGBA")
    bbox = original.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("clean panel has no alpha")
    image = original.crop(bbox)
    # Restrict the outer edge to one smooth rounded silhouette; inner gradient and frame pixels are untouched.
    perimeter = Image.new("L", image.size, 0)
    radius = round(min(image.size) * .05)
    ImageDraw.Draw(perimeter).rounded_rectangle((1, 1, image.width - 2, image.height - 2), radius=radius, fill=255)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), perimeter))
    return image


def make_input(source: Image.Image) -> Image.Image:
    """Mirror the reference field's empty right bay, so no placeholder glyph is baked."""
    right = source.crop((765, 813, 915, 922)).resize((128, 74), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (256, 74), (0, 0, 0, 0))
    image.alpha_composite(right.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (0, 0))
    image.alpha_composite(right, (128, 0))
    return image


def make_button(source: Image.Image) -> Image.Image:
    """The gold button and its dark-blue approved lettering are one exact reference crop."""
    image = source.crop((124, 1104, 900, 1234)).convert("RGBA")
    alpha = Image.new("L", image.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle((1, 1, image.width - 2, image.height - 2), radius=62, fill=255)
    image.putalpha(alpha)
    return image


def make_avatar_ring(source: Image.Image) -> Image.Image:
    crop = source.crop((157, 529, 373, 745)).convert("RGBA")
    alpha = Image.new("L", crop.size, 0)
    draw = ImageDraw.Draw(alpha)
    # The approved crop contains a sample portrait. Retain only the 10px gold/white annulus.
    draw.ellipse((0, 0, 215, 215), fill=255)
    draw.ellipse((10, 10, 205, 205), fill=0)
    crop.putalpha(alpha)
    return crop


def make_contact_sheet() -> None:
    """Small transparent-grid inspection sheet for the formal extracted components."""
    names = ("panel", "title", "divider", "recipient", "amount", "password", "id_prefix", "close", "lock", "avatar_ring", "input", "button")
    sheet = Image.new("RGBA", (960, 780), (18, 28, 43, 255))
    draw = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        x, y = (i % 3) * 320 + 10, (i // 3) * 195 + 10
        draw.rectangle((x, y, x + 300, y + 175), outline=(53, 166, 203, 255), width=1)
        image = Image.open(OUT / f"{PREFIX}{name}.png").convert("RGBA")
        image.thumbnail((282, 138), Image.Resampling.LANCZOS)
        sheet.alpha_composite(image, (x + (300 - image.width) // 2, y + 21 + (138 - image.height) // 2))
        draw.text((x + 8, y + 154), name, fill=(213, 238, 246, 255))
    contact = ROOT / "art_sources/give-pad-approved/give_pad_approved_contact_sheet.png"
    contact.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(contact, optimize=True)


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (1024, 1536):
        raise ValueError(f"unexpected approved reference size: {source.size}")
    # Fixed lettering/icons are direct approved-reference crops. Dynamic avatar/name/ID/input text are excluded.
    save("panel", make_panel())
    save("title", keyed_crop(source, (360, 315, 666, 395), 150))
    save("divider", keyed_crop(source, (172, 403, 856, 438), 126))
    save("recipient", keyed_crop(source, (112, 460, 329, 517), 140))
    save("amount", keyed_crop(source, (112, 836, 330, 893), 140))
    save("password", keyed_crop(source, (112, 973, 331, 1034), 140))
    save("id_prefix", keyed_crop(source, (408, 646, 482, 697), 142))
    save("close", keyed_crop(source, (836, 287, 928, 379), 128))
    save("lock", keyed_crop(source, (370, 982, 438, 1047), 126))
    save("avatar_ring", make_avatar_ring(source))
    save("input", make_input(source), (18, 18, 18, 18))
    save("button", make_button(source))
    # The whole button already owns its fixed lettering; remove the obsolete separate draft asset.
    for stale in (OUT / f"{PREFIX}button_label.png", OUT / f"{PREFIX}button_label.png.meta"):
        stale.unlink(missing_ok=True)
    make_contact_sheet()
    print("wrote give-pad approved assets")


if __name__ == "__main__":
    main()
