#!/usr/bin/env python3
"""Render the Prefab-authored wallet real-name layout for visual QA."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
V7 = ROOT / "assets/resources/V7"
FONT = ROOT / "assets/font/PingFF.ttf"


def paste_center(canvas: Image.Image, name: str, top: int,
                 size: tuple[int, int] | None = None) -> None:
    art = Image.open(V7 / name).convert("RGBA")
    if size is not None and art.size != size:
        art = art.resize(size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(art, ((canvas.width - art.width) // 2, top))


def render(height: int, output: Path) -> None:
    background = Image.open(V7 / "wallet_bg_exact.png").convert("RGBA")
    if background.height < height:
        raise ValueError(f"background height {background.height} < {height}")
    canvas = background.crop((0, 0, 750, height))

    header = Image.open(V7 / "wallet_realname_header_exact.png").convert("RGBA")
    canvas.alpha_composite(header, (0, 0))
    paste_center(canvas, "wallet_realname_shield_exact.png", 104, (142, 149))
    paste_center(canvas, "wallet_realname_hero_title_exact.png", 261)
    paste_center(canvas, "wallet_realname_hero_subtitle_exact.png", 327)
    paste_center(canvas, "wallet_realname_form_panel_exact.png", 385, (642, 490))

    rows = (
        ("wallet_realname_row_name_exact.png", 401, "请输入姓名"),
        ("wallet_realname_row_bank_exact.png", 493, "请输入银行"),
        ("wallet_realname_row_card_exact.png", 585, "请输入卡号"),
        ("wallet_realname_row_password_exact.png", 677, "请输入交易密码"),
        ("wallet_realname_row_confirm_exact.png", 769, "请确认交易密码"),
    )
    font = ImageFont.truetype(str(FONT), 28)
    draw = ImageDraw.Draw(canvas)
    for name, top, placeholder in rows:
        paste_center(canvas, name, top)
        box = draw.textbbox((0, 0), placeholder, font=font)
        text_h = box[3] - box[1]
        draw.text((296, top + (78 - text_h) // 2 - box[1]), placeholder,
                  font=font, fill=(182, 180, 177, 255))

    paste_center(canvas, "wallet_realname_submit_exact.png", 887)
    paste_center(canvas, "wallet_realname_warning_exact.png", 997)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, quality=95)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(args.height, args.output)


if __name__ == "__main__":
    main()
