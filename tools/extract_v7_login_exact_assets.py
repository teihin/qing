#!/usr/bin/env python3
"""Extract the main login controls from the final approved V7 login image.

The input borders, icons, separators, art placeholders, link lettering and
login button are cut from the confirmed pixels.  Only the placeholder glyphs
are removed from the input bases so live EditBox text can replace them.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from generate_v7_runtime_skin import OUT, ROOT, save


REFERENCE = (
    ROOT
    / "design-previews/2026-09-04-V7确认风格六页统一版"
    / "01-登录.png"
)
REFERENCE_SCALE = 750 / 941


def save_crisp(image: Image.Image, name: str) -> None:
    save(image, name)
    meta_path = OUT / f"{name}.meta"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["packable"] = False
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def rounded_alpha(size: tuple[int, int], radius: int) -> Image.Image:
    scale = 4
    mask = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size[0] * scale - 1, size[1] * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return mask.resize(size, Image.Resampling.LANCZOS)


def erase_placeholder(
    image: Image.Image,
    box: tuple[int, int, int, int],
) -> Image.Image:
    """Remove only warm placeholder pixels using the row's own vertical tone."""
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    x0, y0, x1, y1 = box
    region = rgba[y0:y1, x0:x1, :3].astype(np.int16)
    warm = region[:, :, 0] - region[:, :, 2]
    glyph = (
        (region[:, :, 0] > 105)
        & (region[:, :, 1] > 82)
        & (warm > 22)
    )
    glyph_image = Image.fromarray(glyph.astype(np.uint8) * 255, "L")
    glyph = np.array(glyph_image.filter(ImageFilter.MaxFilter(9))) > 0

    sample_top = rgba[max(0, y0 - 7):max(1, y0 - 2), x0:x1, :3].mean(axis=0)
    sample_bottom = rgba[min(rgba.shape[0] - 1, y1 + 2):min(rgba.shape[0], y1 + 7), x0:x1, :3].mean(axis=0)
    if sample_top.shape[0] == 0 or sample_bottom.shape[0] == 0:
        raise RuntimeError("登录输入框占位文字清理采样区无效")
    for local_y in range(y1 - y0):
        t = local_y / max(1, y1 - y0 - 1)
        tone = sample_top * (1 - t) + sample_bottom * t
        target = rgba[y0 + local_y, x0:x1, :3]
        target[glyph[local_y]] = np.clip(tone[glyph[local_y]], 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def extract_gold_text(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    rgb = rgba[:, :, :3].astype(np.int16)
    warm = rgb[:, :, 0] - rgb[:, :, 2]
    brightness = rgb.mean(axis=2)
    alpha = np.clip((warm - 8) * 5.0, 0, 255)
    alpha *= np.clip((brightness - 34) / 90, 0, 1)
    rgba[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def centered_canvas(
    image: Image.Image,
    size: tuple[int, int],
) -> Image.Image:
    scaled = image.resize(
        (
            max(1, round(image.width * REFERENCE_SCALE)),
            max(1, round(image.height * REFERENCE_SCALE)),
        ),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(
        scaled,
        ((size[0] - scaled.width) // 2, (size[1] - scaled.height) // 2),
    )
    return canvas


def main() -> None:
    if not REFERENCE.exists():
        raise FileNotFoundError(f"最终登录确认稿不存在：{REFERENCE}")
    source = Image.open(REFERENCE).convert("RGBA")

    account = source.crop((139, 753, 800, 894))
    account = erase_placeholder(account, (158, 43, 375, 101))
    account.putalpha(rounded_alpha(account.size, 31))
    save_crisp(account, "login_input_account_exact.png")

    password = source.crop((139, 918, 800, 1061))
    password = erase_placeholder(password, (158, 43, 375, 102))
    password.putalpha(rounded_alpha(password.size, 31))
    save_crisp(password, "login_input_password_exact.png")

    button = source.crop((139, 1214, 800, 1340))
    button.putalpha(rounded_alpha(button.size, 31))
    save_crisp(button, "login_button_exact.png")

    account_hint = extract_gold_text(source.crop((299, 796, 491, 854)))
    password_hint = extract_gold_text(source.crop((299, 963, 491, 1021)))
    save_crisp(centered_canvas(account_hint, (220, 54)), "login_hint_account_exact.png")
    save_crisp(centered_canvas(password_hint, (220, 54)), "login_hint_password_exact.png")

    reset = extract_gold_text(source.crop((154, 1098, 315, 1156)))
    register = extract_gold_text(source.crop((614, 1098, 787, 1156)))
    save_crisp(centered_canvas(reset, (210, 54)), "login_link_reset_exact.png")
    save_crisp(centered_canvas(register, (210, 54)), "login_link_register_exact.png")

    print("已从 V7 最终六页确认稿直接切出登录输入框、按钮和美术字。")


if __name__ == "__main__":
    main()
