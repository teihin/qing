#!/usr/bin/env python3
"""Extract transparent V8 game-settings components into formal Cocos assets.

Sources are retained under art_sources/game-settings-v8.  This extractor never
touches game-table or runtime card-back textures; all outputs are explicit
``assets/V7/settings_v8_*`` popup-preview art with stable Cocos 2.4 metas.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Dict, Tuple

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art_sources" / "game-settings-v8"
OUTPUT = ROOT / "assets" / "V7"
NAMESPACE = uuid.UUID("2c7b7c66-cc5f-4c13-9e2f-4b910810e276")


def bbox_crop(image: Image.Image, rect: Tuple[int, int, int, int], padding: int = 3) -> Image.Image:
    """Crop one atlas cell to its alpha-connected visual bounds with AA kept."""
    cell = image.crop(rect)
    alpha = cell.getchannel("A")
    box = alpha.getbbox()
    if box is None:
        raise ValueError(f"empty atlas cell {rect}")
    left = max(0, box[0] - padding)
    top = max(0, box[1] - padding)
    right = min(cell.width, box[2] + padding)
    bottom = min(cell.height, box[3] + padding)
    return cell.crop((left, top, right, bottom))


def stable_meta(name: str, image: Image.Image, borders: Tuple[int, int, int, int] = (0, 0, 0, 0)) -> Dict[str, object]:
    texture = str(uuid.uuid5(NAMESPACE, f"texture:{name}"))
    frame = str(uuid.uuid5(NAMESPACE, f"frame:{name}"))
    top, bottom, left, right = borders
    stem = Path(name).stem
    return {
        "ver": "2.3.7", "uuid": texture, "importer": "texture", "type": "sprite",
        "wrapMode": "clamp", "filterMode": "bilinear", "premultiplyAlpha": False,
        "genMipmaps": False, "packable": True, "width": image.width, "height": image.height,
        "platformSettings": {},
        "subMetas": {stem: {
            "ver": "1.0.6", "uuid": frame, "importer": "sprite-frame", "rawTextureUuid": texture,
            "trimType": "none", "trimThreshold": 1, "rotated": False,
            "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0,
            "width": image.width, "height": image.height,
            "rawWidth": image.width, "rawHeight": image.height,
            "borderTop": top, "borderBottom": bottom, "borderLeft": left, "borderRight": right,
            "subMetas": {},
        }},
    }


def write(name: str, image: Image.Image, borders: Tuple[int, int, int, int] = (0, 0, 0, 0)) -> None:
    image = image.convert("RGBA")
    path = OUTPUT / name
    image.save(path)
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(stable_meta(name, image, borders), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def title_art(reference: Image.Image) -> Image.Image:
    """Keep only the gold title art from the approved composition, not its backdrop."""
    crop = reference.crop((316, 228, 638, 315)).convert("RGBA")
    pixels = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            red, green, blue, alpha = pixels[x, y]
            # The text is warm gold; thresholding removes blue panel pixels
            # while retaining the anti-aliased yellow/cream edge pixels.
            strength = max(0, min(255, int((red + green - 1.25 * blue - 155) * 2.4)))
            pixels[x, y] = (red, green, blue, min(alpha, strength))
    box = crop.getchannel("A").getbbox()
    if box is None:
        raise ValueError("approved reference title was not found")
    return crop.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(crop.width, box[2] + 2), min(crop.height, box[3] + 2)))


def composed_selected(base: Image.Image, selected_frame: Image.Image, check: Image.Image) -> Image.Image:
    """One Toggle checkmark Sprite: a lower-right gold check bubble.

    The atlas selection rectangle has a deliberately wide generic aspect ratio;
    scaling it onto portrait tables creates false horizontal edges.  The
    existing preview art remains the visible background, so only its matching
    check bubble is composited here.
    """
    canvas = Image.new("RGBA", base.size)
    from PIL import ImageDraw
    border = max(2, round(min(base.size) / 34))
    inset = max(1, border)
    ImageDraw.Draw(canvas).rounded_rectangle(
        (inset, inset, base.width - inset - 1, base.height - inset - 1),
        radius=max(10, round(min(base.size) / 7)), outline=(255, 203, 69, 255), width=border,
    )
    scale = min(base.width / 2.8 / check.width, base.height / 2.8 / check.height)
    mark = check.resize((round(check.width * scale), round(check.height * scale)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, (
        base.width - mark.width - max(1, base.width // 28),
        base.height - mark.height - max(1, base.height // 24),
    ))
    return canvas


def main() -> None:
    atlas_path = SOURCE / "components-atlas-source.png"
    frame_path = SOURCE / "frame-source.png"
    approved_path = ROOT / "design-previews" / "效果图V8-new" / "06-桌内界面" / "10-牌局设置.png"
    for path in (atlas_path, frame_path, approved_path):
        if not path.is_file():
            raise FileNotFoundError(path)
    atlas = Image.open(atlas_path).convert("RGBA")
    frame = Image.open(frame_path).convert("RGBA")
    reference = Image.open(approved_path).convert("RGBA")
    if atlas.size != (1254, 1254):
        raise ValueError(f"unexpected component atlas size {atlas.size}")

    # These cells deliberately leave a few transparent pixels around each
    # component; bbox_crop then strips only empty margin and preserves AA.
    cells = {
        "settings_v8_table_1.png": (35, 25, 260, 400),
        "settings_v8_table_2.png": (275, 25, 500, 400),
        "settings_v8_table_3.png": (515, 25, 745, 400),
        "settings_v8_table_4.png": (755, 25, 980, 400),
        "settings_v8_table_5.png": (995, 25, 1220, 400),
        "settings_v8_back_0.png": (90, 425, 425, 805),
        "settings_v8_back_1.png": (440, 425, 785, 805),
        "settings_v8_back_2.png": (825, 425, 1160, 805),
        "settings_v8_top_cards.png": (42, 835, 390, 1040),
        "settings_v8_close.png": (405, 825, 660, 1050),
        "settings_v8_toggle_on.png": (655, 842, 925, 1035),
        "settings_v8_toggle_off.png": (930, 842, 1210, 1035),
        "settings_v8_table_icon.png": (30, 1040, 205, 1245),
        "settings_v8_back_icon.png": (195, 1040, 350, 1245),
        "settings_v8_sound_icon.png": (350, 1040, 530, 1245),
        "settings_v8_voice_icon.png": (540, 1040, 675, 1245),
        "settings_v8_spotlight_icon.png": (690, 1040, 820, 1245),
        "settings_v8_check.png": (820, 1040, 975, 1245),
        "settings_v8_selection.png": (1060, 1030, 1254, 1254),
    }
    pieces = {name: bbox_crop(atlas, rect) for name, rect in cells.items()}
    # The source frame has a correct transparent perimeter already; retain its
    # full silhouette so the arched top can never become a stretched 9-slice.
    write("settings_v8_frame.png", frame)
    write("settings_v8_title.png", title_art(reference))
    for name, image in pieces.items():
        write(name, image)
    write("settings_v8_rule.png", Image.new("RGBA", (382, 4), (101, 208, 236, 185)))
    controls = Image.new("RGBA", (610, 280))
    # Formal transparent inner panel: soft-blue rounded edge, no text or
    # baked controls, so all runtime Toggle states remain live Cocos nodes.
    from PIL import ImageDraw
    draw = ImageDraw.Draw(controls)
    draw.rounded_rectangle((1, 1, 608, 278), radius=28, outline=(57, 211, 245, 205), width=2)
    write("settings_v8_controls_frame.png", controls)
    for index in range(1, 6):
        base = pieces[f"settings_v8_table_{index}.png"]
        write(f"settings_v8_table_{index}_selected.png", composed_selected(base, pieces["settings_v8_selection.png"], pieces["settings_v8_check.png"]))
    for index in range(3):
        base = pieces[f"settings_v8_back_{index}.png"]
        write(f"settings_v8_back_{index}_selected.png", composed_selected(base, pieces["settings_v8_selection.png"], pieces["settings_v8_check.png"]))
    print("Extracted V8 settings component assets into assets/V7.")


if __name__ == "__main__":
    main()
