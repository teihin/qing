#!/usr/bin/env python3
"""Render the runtime-created 20-avatar selector without opening Creator."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUTPUT = ROOT / "art_sources/avatars/qin_avatar_picker_runtime_preview.png"
FONT = ASSETS / "font/PingFF.ttf"


def paste_center(canvas: Image.Image, layer: Image.Image, x: float, y: float, size=None) -> None:
    if size is not None:
        layer = layer.resize(size, Image.Resampling.LANCZOS)
    px = round(canvas.width / 2 + x - layer.width / 2)
    py = round(canvas.height / 2 - y - layer.height / 2)
    canvas.alpha_composite(layer, (px, py))


def image(path: str) -> Image.Image:
    return Image.open(ASSETS / path).convert("RGBA")


def main() -> None:
    canvas = image("ImagesLuck/公用/背景.png")
    paste_center(canvas, image("ImagesLuck/公用1/顶部.png"), 0, 617, (750, 92))
    paste_center(canvas, image("ImagesLuck/头像/修改信息.png"), 0, 620, (129, 40))

    paste_center(canvas, image("ImagesLuck/公用/头像2.png"), 0, 450, (182, 182))
    paste_center(canvas, image("resources/avatars/头像01.png"), 0, 450, (168, 168))

    paste_center(canvas, image("ImagesLuck/头像/昵称输入.png"), -11.949, 287.425, (586, 100))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(FONT), 25)
    draw.text((375, 1334 / 2 - 285), "玩家昵称", font=font, fill=(231, 212, 174, 255), anchor="mm")
    paste_center(canvas, image("ImagesLuck/头像/点击上传.png"), 0, 185, (215, 47))

    for index in range(1, 21):
        col = (index - 1) % 5
        row = (index - 1) // 5
        x = (col - 2) * 124
        y = -90 + 165 - row * 110
        cx = round(canvas.width / 2 + x)
        cy = round(canvas.height / 2 - y)
        draw.ellipse((cx - 50, cy - 50, cx + 50, cy + 50), fill=(10, 8, 5, 245), outline=(126, 79, 31, 230), width=2)
        avatar = image(f"resources/avatars/头像{index:02d}.png").resize((90, 90), Image.Resampling.LANCZOS)
        canvas.alpha_composite(avatar, (cx - 45, cy - 45))
        if index == 1:
            draw.ellipse((cx - 50, cy - 50, cx + 50, cy + 50), outline=(248, 204, 112, 255), width=5)
            draw.ellipse((cx + 25, cy - 51, cx + 51, cy - 25), fill=(238, 187, 82, 255))
            draw.line((cx + 31, cy - 38, cx + 36, cy - 33, cx + 44, cy - 43), fill=(42, 24, 7, 255), width=3, joint="curve")

    paste_center(canvas, image("imagesKK/公用/确定.png"), -2.187, -410, (198, 66))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUTPUT, quality=95)
    print(OUTPUT)


if __name__ == "__main__":
    main()
