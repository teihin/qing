#!/usr/bin/env python3
"""Safely restyle the five baked hall-announcement pages.

The Chinese copy, numbers, punctuation, line wrapping and card examples are
already rasterised into the legacy PNGs. This script therefore performs only
position-preserving colour/material transforms. It never redraws, OCRs,
retypes, moves or resizes content. That constraint is intentional: announcement
data must not drift while the 8L art is refreshed.

Pages 1 and 2 contain opaque reading panels, so their original pixels are
blended into a quieter navy-glass palette. Pages 3 to 5 are mostly transparent
overlay art; their original alpha and pixel positions are retained exactly and
only visible RGB values are changed. The six standard playing-card faces on
page 1 are restored byte-for-byte from the legacy source after colour styling.
"""

from __future__ import annotations

import math
import hashlib
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art_sources" / "notify" / "announcement_pages" / "legacy"
TARGET = ROOT / "assets" / "ImagesLuck" / "公告"

SOFT_WHITE = (230, 241, 248)
SILVER = (193, 218, 232)
CYAN = (70, 183, 220)

# These are the reviewed Git-source bitmaps. Pinning them makes the art build
# fail closed if any baked wording, number, punctuation or example is replaced.
EXPECTED_SOURCE_SHA256 = {
    1: "b433d1ff32570b35196d145a8db59cbd9eaa97c54378cb90b4549a1b7df32250",
    2: "70d4cb4f32d7ecd85b494982fa6a61d6365f1ff97d289ee06bb046c97c114e3b",
    3: "f3795d9d63658d958168714c4e9647c213db54ce3d1bd7025bbe3d1a6cad42f4",
    4: "d56a4bb51c878c9ac70fb89fc41724f36f98607d21fc352c93307ea68c9bf348",
    5: "6312812e00be833eb17a4458c46be62c81ec474c5dbc76c3dd0ca87ae929d37d",
}


def _luma(rgb: tuple[int, int, int]) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def _saturation(rgb: tuple[int, int, int]) -> float:
    high = max(rgb)
    low = min(rgb)
    return 0.0 if high == 0 else (high - low) / high


def _navy_base(x: int, y: int, width: int, height: int) -> tuple[int, int, int]:
    """Return a restrained blue-black glass colour for one source position."""
    dx = (x - width * 0.50) / max(1.0, width * 0.70)
    dy = (y - height * 0.26) / max(1.0, height * 0.85)
    glow = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy))
    return (3 + round(5 * glow), 14 + round(16 * glow), 31 + round(26 * glow))


def _restyle_reading_page(source: Image.Image) -> Image.Image:
    """Colour-grade one opaque legacy page without changing pixel geometry."""
    source = source.convert("RGBA")
    output = source.copy()
    src = source.load()
    dst = output.load()
    width, height = source.size

    # Retain enough of the source gradient to preserve all existing ornamental
    # detail, while moving its bright cyan/purple field into the current 8L
    # blue-black palette. Every destination pixel derives from the source pixel
    # at the exact same coordinate.
    source_mix = 0.34
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = src[x, y]
            if alpha == 0:
                continue
            lum = _luma((red, green, blue))
            sat = _saturation((red, green, blue))
            base = _navy_base(x, y, width, height)
            new_red = round(red * source_mix + base[0] * (1.0 - source_mix))
            new_green = round(green * source_mix + base[1] * (1.0 - source_mix))
            new_blue = round(blue * source_mix + base[2] * (1.0 - source_mix))

            # Lift the original neutral glyph pixels to silver-white. The
            # source antialias values still control every edge; only RGB changes.
            if lum >= 140 and sat <= 0.28:
                strength = max(0.0, min(1.0, (lum - 120.0) / 135.0))
                new_red = round(188 + 50 * strength)
                new_green = round(207 + 41 * strength)
                new_blue = round(221 + 32 * strength)
            elif blue > red * 1.12 and green > red * 1.05 and lum >= 75 and sat >= 0.18:
                # Existing cyan art remains cyan, but is deliberately subdued so
                # large background gradients do not compete with the copy.
                strength = max(0.0, min(1.0, (lum - 75.0) / 155.0))
                cyan = (
                    15 + round(45 * strength),
                    75 + round(115 * strength),
                    110 + round(125 * strength),
                )
                new_red = round(new_red * 0.68 + cyan[0] * 0.32)
                new_green = round(new_green * 0.68 + cyan[1] * 0.32)
                new_blue = round(new_blue * 0.68 + cyan[2] * 0.32)
            dst[x, y] = (new_red, new_green, new_blue, alpha)

    # The output alpha envelope is required to match the legacy source exactly.
    output.putalpha(source.getchannel("A"))
    return output


def _lift_existing_dark_detail(
    output: Image.Image,
    source: Image.Image,
    boxes: tuple[tuple[int, int, int, int], ...],
) -> None:
    """Improve dark embossed glyphs by recolouring only their existing pixels.

    A local-luminance difference identifies the already-rasterised dark strokes.
    No masks are drawn from text strings and no pixel positions are added.
    """
    grayscale = source.convert("L")
    blurred = grayscale.filter(ImageFilter.GaussianBlur(4.0))
    detail = grayscale.load()
    local = blurred.load()
    dst = output.load()
    width, height = output.size
    for x0, y0, x1, y1 in boxes:
        for y in range(max(0, y0), min(height, y1)):
            for x in range(max(0, x0), min(width, x1)):
                delta = local[x, y] - detail[x, y]
                if delta <= 8:
                    continue
                strength = min(1.0, (delta - 8.0) / 32.0)
                red, green, blue, alpha = dst[x, y]
                dst[x, y] = (
                    round(red * (1.0 - strength) + SILVER[0] * strength),
                    round(green * (1.0 - strength) + SILVER[1] * strength),
                    round(blue * (1.0 - strength) + SILVER[2] * strength),
                    alpha,
                )


def _restore_standard_cards(output: Image.Image, source: Image.Image) -> None:
    """Restore the six standard card faces exactly, including red suits."""
    card_boxes = (
        (114, 220, 167, 292),
        (175, 220, 228, 292),
        (235, 220, 288, 292),
        (459, 220, 512, 292),
        (520, 220, 573, 292),
        (582, 220, 635, 292),
    )
    for box in card_boxes:
        crop = source.crop(box)
        output.paste(crop, box[:2])


def _restyle_transparent_overlay(source: Image.Image) -> Image.Image:
    """Restyle visible overlay pixels while preserving the alpha map exactly."""
    source = source.convert("RGBA")
    output = source.copy()
    src = source.load()
    dst = output.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = src[x, y]
            if alpha == 0:
                continue
            lum = _luma((red, green, blue))
            sat = _saturation((red, green, blue))
            if lum >= 150 and sat <= 0.32:
                strength = max(0.0, min(1.0, (lum - 120.0) / 135.0))
                colour = (
                    round(SILVER[0] + (SOFT_WHITE[0] - SILVER[0]) * strength),
                    round(SILVER[1] + (SOFT_WHITE[1] - SILVER[1]) * strength),
                    round(SILVER[2] + (SOFT_WHITE[2] - SILVER[2]) * strength),
                )
            elif lum >= 70 and sat >= 0.18:
                strength = max(0.0, min(1.0, (lum - 70.0) / 150.0))
                colour = (
                    round(45 + (CYAN[0] - 45) * strength),
                    round(116 + (CYAN[1] - 116) * strength),
                    round(151 + (CYAN[2] - 151) * strength),
                )
            else:
                strength = max(0.0, min(1.0, lum / 150.0))
                colour = (
                    round(3 + 21 * strength),
                    round(13 + 42 * strength),
                    round(28 + 67 * strength),
                )
            dst[x, y] = (*colour, alpha)
    output.putalpha(source.getchannel("A"))
    return output


def build_page(number: int) -> Path:
    source_path = SOURCE / f"{number}.png"
    actual_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if actual_hash != EXPECTED_SOURCE_SHA256[number]:
        raise AssertionError(
            f"page {number}: reviewed source content changed "
            f"({actual_hash} != {EXPECTED_SOURCE_SHA256[number]})"
        )
    source = Image.open(source_path).convert("RGBA")
    if number in (1, 2):
        output = _restyle_reading_page(source)
        if number == 1:
            # These boxes cover only the existing embossed heading/label art.
            _lift_existing_dark_detail(
                output,
                source,
                (
                    (145, 170, 270, 210),
                    (500, 170, 620, 210),
                    (255, 345, 495, 415),
                    (255, 565, 495, 635),
                    (255, 780, 495, 850),
                    (255, 965, 495, 1035),
                    (245, 1175, 505, 1245),
                    (255, 1475, 495, 1545),
                ),
            )
            _restore_standard_cards(output, source)
        else:
            # The legacy table already contains the authoritative values
            # 10% / 60% / 12% / 8%. Lift those exact raster strokes instead of
            # retyping them, so the data cannot be changed by this art pass.
            _lift_existing_dark_detail(output, source, ((145, 585, 608, 834),))
    else:
        output = _restyle_transparent_overlay(source)

    if output.size != source.size or output.getchannel("A").tobytes() != source.getchannel("A").tobytes():
        raise AssertionError(f"page {number}: geometry or alpha changed")

    target = TARGET / f"{number}.png"
    output.save(target, optimize=True)
    return target


def build() -> list[Path]:
    required = [SOURCE / f"{number}.png" for number in range(1, 6)]
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError("missing announcement source: " + ", ".join(map(str, missing)))
    return [build_page(number) for number in range(1, 6)]


if __name__ == "__main__":
    for output in build():
        print(output.relative_to(ROOT))
