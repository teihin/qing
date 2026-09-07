#!/usr/bin/env python3
"""Extract clean runtime popup art from the approved V7 popup mockups."""

from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from generate_v7_runtime_skin import FONT_PATH, OUT, ROOT, save


PREVIEW = ROOT / "design-previews/2026-09-04-V7弹窗效果图-v2"
ANNOUNCEMENT = PREVIEW / "01-公告弹窗-大内容区.png"
MESSAGE_SINGLE = PREVIEW / "02-普通弹窗-单确定.png"
MESSAGE_DUAL = PREVIEW / "03-普通弹窗-取消和确定.png"


def scaled_crop(source: Image.Image, box: tuple[int, int, int, int],
                size: tuple[int, int]) -> Image.Image:
    return source.crop(box).convert("RGBA").resize(size, Image.Resampling.LANCZOS)


def clean_text_area(image: Image.Image, box: tuple[int, int, int, int],
                    seed: int) -> None:
    """Replace baked copy with a matching navy reading surface."""
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    source = image.convert("RGB")
    left = max(0, x0 - 10)
    sample = source.crop((left, y0, min(image.width, left + 8), y1))
    sample = sample.resize((1, height), Image.Resampling.BILINEAR)
    field = Image.new("RGBA", (width, height))
    for y in range(height):
        base = sample.getpixel((0, y))
        for x in range(width):
            center = 1.0 - abs((x / max(1, width - 1)) * 2.0 - 1.0)
            lift = int(round(center * 3.0))
            field.putpixel((x, y), (
                min(255, base[0] + lift),
                min(255, base[1] + lift),
                min(255, base[2] + lift),
                255,
            ))

    # Draw the subtle surface pattern on a transparent overlay.  Drawing RGBA
    # colors directly into ``field`` replaces its alpha as well, which makes
    # the original baked sample copy leak through along every pattern stroke.
    pattern = Image.new("RGBA", field.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(pattern, "RGBA")
    for offset in range(-height, width + height, 18):
        draw.line((offset, 0, offset + height, height), fill=(118, 167, 190, 8), width=1)
        draw.line((offset + height, 0, offset, height), fill=(0, 18, 34, 10), width=1)
    rng = random.Random(seed)
    for _ in range(max(240, width * height // 95)):
        x = rng.randrange(width)
        y = rng.randrange(height)
        alpha = rng.randrange(3, 10)
        draw.point((x, y), fill=(155, 211, 222, alpha))
    field = Image.alpha_composite(field, pattern)
    image.alpha_composite(field, (x0, y0))


def clean_vertical_artifact(image: Image.Image,
                            box: tuple[int, int, int, int], seed: int) -> None:
    """Remove baked vertical UI while preserving the surrounding navy texture."""
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    source = image.convert("RGB")
    sample_left = max(0, x0 - 26)
    sample_right = max(sample_left + 1, x0 - 8)
    field = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    pixels = field.load()
    for y in range(height):
        sy = min(source.height - 1, y0 + y)
        row = [source.getpixel((x, sy)) for x in range(sample_left, sample_right)]
        base = tuple(sum(pixel[channel] for pixel in row) // len(row)
                     for channel in range(3))
        for x in range(width):
            lift = ((x + y) % 7) - 3
            pixels[x, y] = tuple(max(0, min(255, channel + lift))
                                 for channel in base) + (255,)

    pattern = Image.new("RGBA", field.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(pattern, "RGBA")
    for offset in range(-height, width + height, 18):
        draw.line((offset, 0, offset + height, height),
                  fill=(118, 167, 190, 7), width=1)
        draw.line((offset + height, 0, offset, height),
                  fill=(0, 18, 34, 9), width=1)
    rng = random.Random(seed)
    for _ in range(max(120, width * height // 80)):
        draw.point((rng.randrange(width), rng.randrange(height)),
                   fill=(155, 211, 222, rng.randrange(3, 9)))
    image.alpha_composite(Image.alpha_composite(field, pattern), (x0, y0))


def clean_announcement_surface(image: Image.Image,
                               box: tuple[int, int, int, int], seed: int) -> None:
    """Create one continuous reading surface with no erased-text bands."""
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    field = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(field, "RGBA")
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(a * (1 - t) + b * t)
                      for a, b in zip((24, 51, 70), (10, 31, 49)))
        draw.line((0, y, width, y), fill=color + (255,))
    # Sparse grain only; no diagonal grid and no horizontal repair strips.
    rng = random.Random(seed)
    grain = Image.new("RGBA", field.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grain, "RGBA")
    for _ in range(max(800, width * height // 160)):
        gd.point((rng.randrange(width), rng.randrange(height)),
                 fill=(155, 200, 215, rng.randrange(2, 7)))
    field = Image.alpha_composite(field, grain)
    image.alpha_composite(field, (x0, y0))


def rounded_alpha(image: Image.Image, radius: int) -> Image.Image:
    alpha = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(alpha)
    draw.rounded_rectangle((0, 0, image.width - 1, image.height - 1),
                           radius=radius, fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    result = image.copy()
    result.putalpha(alpha)
    return result


def message_alpha(image: Image.Image) -> Image.Image:
    alpha = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(alpha)
    draw.rounded_rectangle((0, 20, image.width - 1, image.height - 1),
                           radius=18, fill=255)
    draw.rounded_rectangle((116, 0, 416, 72), radius=23, fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    result = image.copy()
    result.putalpha(alpha)
    return result


def erase_announcement_title(image: Image.Image) -> None:
    # Only the four baked title glyphs are removed.  The title plate, diamonds
    # and layered edge remain from the approved effect image.
    clean_text_area(image, (220, 27, 412, 69), seed=7711)


def draw_gold_title(image: Image.Image, text: str) -> None:
    scale = 4
    canvas = image.resize((image.width * scale, image.height * scale),
                          Image.Resampling.NEAREST)
    font = ImageFont.truetype(str(FONT_PATH), 41 * scale)
    draw = ImageDraw.Draw(canvas)
    box = draw.textbbox((0, 0), text, font=font, stroke_width=1 * scale)
    width = box[2] - box[0]
    height = box[3] - box[1]
    x = (canvas.width - width) // 2 - box[0]
    y = 49 * scale - height // 2 - box[1]

    shadow_mask = Image.new("L", canvas.size, 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.text((x, y + 2 * scale), text, font=font, fill=205,
                     stroke_width=1 * scale, stroke_fill=190)
    shadow = Image.new("RGBA", canvas.size, (1, 19, 34, 0))
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(0.7 * scale)))
    canvas.alpha_composite(shadow)

    mask = Image.new("L", canvas.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.text((x, y), text, font=font, fill=255,
                   stroke_width=1 * scale, stroke_fill=255)
    gradient = Image.new("RGBA", canvas.size)
    gradient_draw = ImageDraw.Draw(gradient)
    top_y = max(0, y + box[1])
    bottom_y = min(canvas.height - 1, y + box[3])
    for row in range(top_y, bottom_y + 1):
        ratio = (row - top_y) / max(1, bottom_y - top_y)
        color = tuple(round(a * (1 - ratio) + b * ratio)
                      for a, b in zip((255, 235, 191, 255), (220, 169, 105, 255)))
        gradient_draw.line((0, row, canvas.width, row), fill=color)
    canvas.paste(gradient, (0, 0), mask)
    image.alpha_composite(canvas.resize(image.size, Image.Resampling.LANCZOS))


def announcement_variants() -> dict[str, Image.Image]:
    source = Image.open(ANNOUNCEMENT).convert("RGB")
    if source.size != (941, 1672):
        raise RuntimeError(f"公告效果图尺寸异常: {source.size}")
    panel = scaled_crop(source, (74, 345, 867, 1398), (632, 840))
    clean_announcement_surface(panel, (27, 89, 604, 724), seed=7701)
    panel = rounded_alpha(panel, 22)

    result = {"latest": panel}
    for key, text in (("recharge", "充值公告"), ("activity", "活动公告")):
        variant = panel.copy()
        erase_announcement_title(variant)
        draw_gold_title(variant, text)
        result[key] = variant
    return result


def message_panel(path: Path, box: tuple[int, int, int, int], seed: int) -> Image.Image:
    source = Image.open(path).convert("RGB")
    if source.size != (941, 1672):
        raise RuntimeError(f"普通弹窗效果图尺寸异常: {source.size}")
    panel = scaled_crop(source, box, (532, 366))
    clean_text_area(panel, (23, 74, 509, 218), seed=seed)
    return message_alpha(panel)


def switch_account_button(panel: Image.Image) -> Image.Image:
    """Reuse the accepted single-dialogue button and replace only its wording."""
    button = panel.crop((161, 241, 371, 305)).convert("RGBA")
    scale = 4
    work = button.resize((button.width * scale, button.height * scale),
                         Image.Resampling.BICUBIC)
    pixels = work.load()
    # The button face is a shallow vertical gold gradient.  Sample clean pixels
    # on both sides of the old two-character title, then interpolate across the
    # middle so the replacement remains a single continuous metal surface.
    x0, x1 = 38 * scale, 172 * scale
    for y in range(10 * scale, 54 * scale):
        left = [pixels[x, y] for x in range(27 * scale, 37 * scale)]
        right = [pixels[x, y] for x in range(173 * scale, 183 * scale)]
        for x in range(x0, x1):
            t = (x - x0) / max(1, x1 - x0 - 1)
            li = left[(x + y) % len(left)]
            ri = right[(x + y * 3) % len(right)]
            pixels[x, y] = tuple(round(a * (1 - t) + b * t)
                                 for a, b in zip(li, ri))

    draw = ImageDraw.Draw(work, "RGBA")
    label_font = ImageFont.truetype(str(FONT_PATH), 27 * scale)
    draw.text((105 * scale, 32 * scale), "切换账号", font=label_font,
              fill=(2, 25, 44, 255), anchor="mm",
              stroke_width=1 * scale, stroke_fill=(218, 178, 112, 130))
    return work.resize(button.size, Image.Resampling.LANCZOS)


def save_unpacked(image: Image.Image, name: str) -> None:
    """Keep text-bearing popup art out of the dynamic atlas for crisp display."""
    save(image, name)
    meta_path = OUT / f"{name}.meta"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["packable"] = False
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, image in announcement_variants().items():
        save(image, f"popup_announcement_{key}_exact_nobar.png")
    single = message_panel(MESSAGE_SINGLE, (136, 590, 805, 1050), 7721)
    save(single, "popup_message_single_exact.png")
    save(message_panel(MESSAGE_DUAL, (136, 590, 805, 1050), 7722),
         "popup_message_dual_exact.png")
    save_unpacked(switch_account_button(single),
                  "popup_switch_account_button_exact.png")
    print("已从V7弹窗确认稿提取公告、普通弹窗及切换账号高清资源。")


if __name__ == "__main__":
    main()
