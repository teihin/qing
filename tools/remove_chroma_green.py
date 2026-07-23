#!/usr/bin/env python3
"""Remove a flat green image-generation background while preserving soft edges."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def remove_green(source: Path, destination: Path, despill: bool = False) -> None:
    image = Image.open(source).convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            dominance = green - max(red, blue)
            if green >= 150 and dominance >= 45:
                # Hard-clear the flat key color; softly attenuate antialiased fringes.
                edge_alpha = max(0, min(255, 255 - (dominance - 45) * 3))
                alpha = min(alpha, edge_alpha)
                if alpha:
                    spill = max(0, green - max(red, blue))
                    green = max(max(red, blue), green - spill)
            if despill and alpha and green > max(red, blue):
                green = max(red, blue)
            pixels[x, y] = (red, green, blue, alpha)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument(
        "--despill",
        action="store_true",
        help="remove residual green reflection from non-green subject colors",
    )
    args = parser.parse_args()
    remove_green(args.source, args.destination, despill=args.despill)


if __name__ == "__main__":
    main()
