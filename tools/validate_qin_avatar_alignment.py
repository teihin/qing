#!/usr/bin/env python3
"""Verify that every generated gold avatar ring is centered in its 256px canvas."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
AVATARS = ROOT / "assets/resources/avatars"
ANGLES = np.linspace(0, 2 * np.pi, 720, endpoint=False)


def detect_ring_center(path: Path) -> tuple[int, int]:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    gold = (
        (red > 135)
        & (green > 70)
        & (green < 240)
        & (blue < 145)
        & ((red.astype(int) - blue.astype(int)) > 45)
    )
    best_score = -1.0
    best_center = (0, 0)
    for center_y in range(123, 134):
        for center_x in range(123, 134):
            samples = []
            for radius in (116, 117, 118, 119, 120):
                xs = np.rint(center_x + radius * np.cos(ANGLES)).astype(int)
                ys = np.rint(center_y + radius * np.sin(ANGLES)).astype(int)
                samples.append(gold[ys, xs])
            score = float(np.stack(samples).max(axis=0).mean())
            if score > best_score:
                best_score = score
                best_center = (center_x, center_y)
    return best_center


def main() -> None:
    maximum_offset = 0
    for index in range(1, 21):
        path = AVATARS / f"头像{index:02d}.png"
        center_x, center_y = detect_ring_center(path)
        offset = max(abs(center_x - 128), abs(center_y - 128))
        maximum_offset = max(maximum_offset, offset)
        if offset > 2:
            raise AssertionError(f"{path.name} ring center is ({center_x}, {center_y})")
    print(f"PASS: 20 avatar rings centered, maximum offset {maximum_offset}px")


if __name__ == "__main__":
    main()
