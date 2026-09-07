#!/usr/bin/env python3
"""Cut formal quick-registration art from the approved V7 effect image.

Static lettering, icons, borders and button art come from the confirmed image
itself.  Only clean stretchable surfaces and states absent from the mockup are
derived; live values/placeholders remain native Prefab controls.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from extract_v7_wallet_exact_assets import crop, erase_horizontal, rounded
from generate_v7_runtime_skin import OUT, ROOT, save


PREVIEW = (
    ROOT
    / "design-previews/2026-09-06-V7快速注册弹窗效果图-v3"
    / "01-快速注册弹窗-大字版.png"
)
FONT = ROOT / "assets/font/PingFF.ttf"
SS = 4
GOLD = (231, 197, 145, 255)
GOLD_HI = (249, 226, 181, 255)
COOL = (207, 216, 220, 255)
COOL_DIM = (174, 188, 196, 255)
NAVY = (4, 31, 53, 255)


def save_crisp(image: Image.Image, name: str, *, sliced: bool = False) -> None:
    save(image, name, sliced=sliced)
    meta_path = OUT / f"{name}.meta"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["packable"] = False
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * SS)


def highres(size: tuple[int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (size[0] * SS, size[1] * SS), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image, "RGBA")


def finish(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.LANCZOS)


def draw_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    size: int,
    fill=GOLD_HI,
    *,
    anchor: str = "mm",
    shadow: bool = False,
) -> None:
    x, y = xy[0] * SS, xy[1] * SS
    if shadow:
        draw.text(
            (x + SS, y + 2 * SS), text, font=font(size), anchor=anchor,
            fill=(0, 9, 20, 130), stroke_width=SS,
            stroke_fill=(0, 6, 14, 120),
        )
    draw.text(
        (x, y), text, font=font(size), anchor=anchor, fill=fill,
        stroke_width=SS if shadow else 0,
        stroke_fill=(73, 48, 24, 185),
    )


def text_asset(text: str, size: tuple[int, int], font_size: int) -> Image.Image:
    work, draw = highres(size)
    draw_text(draw, (size[0] / 2, size[1] / 2), text, font_size, shadow=True)
    return finish(work, size)


def register_surface(size: tuple[int, int], *, panel: bool = False) -> Image.Image:
    """Rebuild the approved navy felt/metal surface without baked text."""
    w, h = size
    yy, xx = np.indices((h, w))
    t = yy.astype(np.float32) / max(1, h - 1)
    if panel:
        top = np.array((13, 54, 84), dtype=np.float32)
        bottom = np.array((3, 30, 52), dtype=np.float32)
    else:
        top = np.array((22, 70, 101), dtype=np.float32)
        bottom = np.array((4, 36, 61), dtype=np.float32)
    rgb = top[None, None, :] * (1 - t[:, :, None]) + bottom[None, None, :] * t[:, :, None]
    center = 1.0 - np.abs(xx.astype(np.float32) / max(1, w - 1) * 2.0 - 1.0)
    rgb += center[:, :, None] * (2.4 if panel else 4.6)
    noise = (((xx * 19 + yy * 31) % 17) - 8).astype(np.float32) / 11.0
    rgb += noise[:, :, None]
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    surface = Image.fromarray(rgba, "RGBA")

    work = surface.resize((w * SS, h * SS), Image.Resampling.BICUBIC)
    draw = ImageDraw.Draw(work, "RGBA")
    radius = (20 if panel else 14) * SS
    mask = Image.new("L", work.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (SS, SS, w * SS - SS - 1, h * SS - SS - 1),
        radius=radius, fill=255,
    )
    work.putalpha(mask)

    if panel:
        # Only the avatar picker needs a derived live surface.  Draw its quiet
        # geometric grain on a transparent overlay and alpha-composite it;
        # ImageDraw on the opaque base would replace pixels and turn the
        # intended three-percent lines into the black dotted pattern rejected
        # in the in-game comparison.
        pattern = Image.new("RGBA", work.size, (0, 0, 0, 0))
        pattern_draw = ImageDraw.Draw(pattern, "RGBA")
        step_x, step_y = 24 * SS, 14 * SS
        for y in range(30 * SS, h * SS - 26 * SS, step_y):
            row = (y // step_y) & 1
            for x in range((12 if row else 0) * SS, w * SS, step_x):
                pts = [
                    (x, y - 7 * SS), (x + 12 * SS, y), (x + 12 * SS, y + 8 * SS),
                    (x, y + 15 * SS), (x - 12 * SS, y + 8 * SS), (x - 12 * SS, y),
                ]
                pattern_draw.line(
                    pts + [pts[0]], fill=(100, 139, 157, 12), width=SS
                )
        work = Image.alpha_composite(work, pattern)
        draw = ImageDraw.Draw(work, "RGBA")

    draw.rounded_rectangle(
        (SS, SS, w * SS - SS - 1, h * SS - SS - 1),
        radius=radius, outline=(239, 203, 145, 245), width=SS,
    )
    draw.rounded_rectangle(
        (4 * SS, 4 * SS, w * SS - 4 * SS - 1, h * SS - 4 * SS - 1),
        radius=max(SS, radius - 3 * SS), outline=(112, 151, 165, 225), width=SS,
    )
    if not panel:
        draw.line((20 * SS, 5 * SS, (w - 20) * SS, 5 * SS),
                  fill=(212, 231, 233, 80), width=SS)
    return finish(work, size)


def rounded_surface(size: tuple[int, int], *, selected: bool = False) -> Image.Image:
    surface = register_surface(size)
    if not selected:
        return surface
    work = surface.resize((size[0] * SS, size[1] * SS), Image.Resampling.LANCZOS)
    overlay = Image.new("RGBA", work.size, (35, 91, 128, 28))
    work = Image.alpha_composite(work, overlay)
    draw = ImageDraw.Draw(work, "RGBA")
    draw.rounded_rectangle(
        (2 * SS, 2 * SS, size[0] * SS - 2 * SS - 1, size[1] * SS - 2 * SS - 1),
        radius=17 * SS, outline=GOLD_HI, width=1 * SS,
    )
    return finish(work, size)


def icon(draw: ImageDraw.ImageDraw, kind: str, cx: int, cy: int) -> None:
    s = SS
    outline = GOLD_HI
    fill = (239, 207, 153, 255)
    if kind == "ticket":
        draw.rounded_rectangle(
            ((cx - 22) * s, (cy - 17) * s, (cx + 22) * s, (cy + 17) * s),
            radius=5 * s, fill=fill, outline=outline, width=s,
        )
        draw.ellipse(((cx - 28) * s, (cy - 5) * s, (cx - 18) * s, (cy + 5) * s), fill=NAVY)
        draw.ellipse(((cx + 18) * s, (cy - 5) * s, (cx + 28) * s, (cy + 5) * s), fill=NAVY)
        pts = []
        import math
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            r = 9 if i % 2 == 0 else 4
            pts.append(((cx + math.cos(a) * r) * s, (cy + math.sin(a) * r) * s))
        draw.polygon(pts, fill=(15, 60, 88, 255))
    elif kind == "person":
        draw.ellipse(((cx - 12) * s, (cy - 23) * s, (cx + 12) * s, (cy + 1) * s), fill=fill)
        draw.pieslice(
            ((cx - 24) * s, (cy - 1) * s, (cx + 24) * s, (cy + 38) * s),
            180, 360, fill=fill,
        )
    elif kind == "lock":
        draw.arc(
            ((cx - 15) * s, (cy - 24) * s, (cx + 15) * s, (cy + 6) * s),
            180, 360, fill=outline, width=5 * s,
        )
        draw.rounded_rectangle(
            ((cx - 20) * s, (cy - 4) * s, (cx + 20) * s, (cy + 26) * s),
            radius=4 * s, fill=fill,
        )
        draw.ellipse(((cx - 3) * s, (cy + 5) * s, (cx + 3) * s, (cy + 11) * s), fill=NAVY)
        draw.rectangle(((cx - 2) * s, (cy + 10) * s, (cx + 2) * s, (cy + 18) * s), fill=NAVY)
    elif kind == "shield":
        pts = [
            (cx * s, (cy - 26) * s), ((cx + 23) * s, (cy - 17) * s),
            ((cx + 19) * s, (cy + 12) * s), (cx * s, (cy + 28) * s),
            ((cx - 19) * s, (cy + 12) * s), ((cx - 23) * s, (cy - 17) * s),
        ]
        draw.polygon(pts, outline=outline, fill=(9, 48, 76, 255))
        draw.line(pts + [pts[0]], fill=outline, width=2 * s, joint="curve")
        draw_text(draw, (cx, cy + 1), "★", 18, GOLD_HI)


def input_row(label: str, kind: str) -> Image.Image:
    size = (600, 88)
    base = rounded_surface(size)
    work = base.resize((size[0] * SS, size[1] * SS), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(work, "RGBA")
    icon(draw, kind, 46, 44)
    draw_text(draw, (92, 44), label, 29, anchor="lm")
    draw.line((230 * SS, 15 * SS, 230 * SS, 73 * SS), fill=(161, 181, 187, 210), width=SS)
    return finish(work, size)


def anti_theft_row() -> Image.Image:
    size = (600, 92)
    base = rounded_surface(size)
    work = base.resize((size[0] * SS, size[1] * SS), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(work, "RGBA")
    icon(draw, "shield", 46, 46)
    draw_text(draw, (92, 31), "防盗号保护", 29, anchor="lm")
    draw_text(draw, (92, 66), "开启后仅当前设备可登录", 20, COOL, anchor="lm")
    return finish(work, size)


def submit_button() -> Image.Image:
    size = (600, 92)
    base = rounded_surface(size, selected=True)
    work = base.resize((size[0] * SS, size[1] * SS), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(work, "RGBA")
    draw_text(draw, (300, 47), "确认注册", 40, shadow=True)
    return finish(work, size)


def refresh_button() -> Image.Image:
    size = (300, 62)
    base = rounded_surface(size, selected=True)
    work = base.resize((size[0] * SS, size[1] * SS), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(work, "RGBA")
    draw_text(draw, (150, 31), "换一批头像", 27, shadow=False)
    return finish(work, size)


def header_rule() -> Image.Image:
    size = (420, 24)
    work, draw = highres(size)
    draw.line((8 * SS, 12 * SS, 185 * SS, 12 * SS), fill=(185, 153, 104, 210), width=SS)
    draw.line((235 * SS, 12 * SS, 412 * SS, 12 * SS), fill=(185, 153, 104, 210), width=SS)
    draw.polygon(
        [(210 * SS, 2 * SS), (219 * SS, 12 * SS), (210 * SS, 22 * SS), (201 * SS, 12 * SS)],
        fill=GOLD_HI,
    )
    draw_text(draw, (210, 12), "♠", 14, GOLD_HI)
    return finish(work, size)


def avatar_ring(size: tuple[int, int], selected: bool = False) -> Image.Image:
    work, draw = highres(size)
    w, h = size
    pad = 3
    draw.ellipse(
        (pad * SS, pad * SS, (w - pad) * SS, (h - pad) * SS),
        outline=GOLD_HI, width=(3 if selected else 2) * SS,
    )
    draw.ellipse(
        ((pad + 5) * SS, (pad + 5) * SS, (w - pad - 5) * SS, (h - pad - 5) * SS),
        outline=(70, 118, 140, 235), width=SS,
    )
    return finish(work, size)


def toggle(on: bool) -> Image.Image:
    size = (108, 56)
    work, draw = highres(size)
    fill = (18, 78, 111, 255) if on else (6, 42, 70, 255)
    draw.rounded_rectangle(
        (2 * SS, 2 * SS, 106 * SS, 54 * SS), radius=26 * SS,
        fill=fill, outline=GOLD if on else (112, 145, 159, 255), width=2 * SS,
    )
    cx = 80 if on else 28
    draw.ellipse(
        ((cx - 20) * SS, 8 * SS, (cx + 20) * SS, 48 * SS),
        fill=GOLD_HI if on else (183, 207, 217, 255),
        outline=(255, 239, 202, 235), width=SS,
    )
    return finish(work, size)


def direct_title(source: Image.Image) -> Image.Image:
    """Cut the approved title lettering itself; do not redraw it with a font."""
    return warm_cutout(crop(source, (294, 301, 647, 371), (330, 64)))


def direct_panel(source: Image.Image) -> Image.Image:
    """Keep the approved dialog pixels intact instead of recreating its art.

    The Prefab overlays only the genuinely dynamic fields.  This preserves the
    exact double border, corner highlights, blue falloff, leather grain and all
    static lettering from the accepted effect image.
    """
    exact = source.crop((104, 223, 835, 1522)).convert("RGBA")
    size = exact.size
    alpha = Image.new("L", size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle(
        (1, 1, size[0] - 2, size[1] - 2), radius=31, fill=255,
    )
    exact.putalpha(alpha.filter(ImageFilter.GaussianBlur(.35)))
    return exact


def direct_status_clean(source: Image.Image) -> Image.Image:
    """Make a small exact-height field for non-default runtime feedback."""
    image = crop(source, (190, 1279, 751, 1338), (447, 47))
    return erase_horizontal(image, 22, 425, 3, 44)


def warm_cutout(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    value = rgb.max(axis=2)
    warm = np.clip((red - blue - 8) * 5.0, 0, 255)
    bright = np.clip((value - 80) * 3.0, 0, 255)
    alpha = np.minimum(warm, bright).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(.25)))
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def direct_shield(source: Image.Image) -> Image.Image:
    """Cut the small 8L crest from V3 and remove only its panel background."""
    size = (76, 80)
    image = crop(source, (426, 235, 514, 314), size)
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(
        [(38, 2), (61, 9), (66, 29), (59, 60), (38, 78),
         (17, 60), (10, 29), (15, 9)],
        fill=255,
    )
    image.putalpha(mask.filter(ImageFilter.GaussianBlur(.45)))
    return image


def direct_round(source: Image.Image, box: tuple[int, int, int, int],
                 size: tuple[int, int]) -> Image.Image:
    image = crop(source, box, size)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size[0] - 2, size[1] - 2), fill=255)
    image.putalpha(mask.resize(size, Image.Resampling.LANCZOS))
    return image


def direct_avatar_ring(source: Image.Image) -> Image.Image:
    """Keep only the clean circular frame around the approved avatar.

    The former crop was four pixels too tall and caught the top of the
    ``点击选择头像`` lettering at six o'clock.  Use the real 225 px circle
    bounds from the approved image, then retain only the narrow frame band.
    """
    size = (180, 180)
    image = crop(source, (358, 441, 583, 666), size)
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((1, 1, 178, 178), fill=255)
    draw.ellipse((6, 6, 174, 174), fill=0)
    image.putalpha(mask.filter(ImageFilter.GaussianBlur(.35)))
    return image


def direct_row(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Keep exact V3 borders/icons/field art; clear only the live placeholder."""
    image = rounded(source, box, (540, 70), 13)
    return erase_horizontal(image, 205, 522, 7, 63)


def direct_anti_theft(source: Image.Image) -> Image.Image:
    image = rounded(source, (130, 1183, 811, 1279), (540, 76), 13)
    return erase_horizontal(image, 432, 522, 8, 68)


def direct_refresh_background(source: Image.Image) -> Image.Image:
    image = rounded(source, (130, 1345, 811, 1445), (300, 62), 15)
    return erase_horizontal(image, 45, 255, 8, 54)


def main() -> None:
    source = Image.open(PREVIEW).convert("RGB")
    if source.size != (941, 1672):
        raise RuntimeError(f"快速注册效果图尺寸异常: {source.size}")

    save_crisp(direct_panel(source), "register_modal_panel_exact.png", sliced=True)
    # Art lettering and icons below are cut from the accepted effect image.
    # They are not recreated with a locally chosen font or substitute icon.
    save_crisp(direct_title(source), "register_title_exact.png")
    save_crisp(warm_cutout(crop(source, (250, 369, 691, 408), (350, 31))),
               "register_subtitle_exact.png")
    save_crisp(warm_cutout(crop(source, (258, 399, 683, 432), (335, 24))),
               "register_header_rule_exact.png")
    save_crisp(direct_shield(source), "register_shield_exact.png")
    save_crisp(direct_round(source, (746, 239, 815, 309), (58, 58)),
               "register_close_exact.png")

    rows = (
        ("invite", (130, 707, 811, 795)),
        ("nickname", (130, 801, 811, 891)),
        ("account", (130, 897, 811, 987)),
        ("password", (130, 992, 811, 1081)),
        ("confirm", (130, 1087, 811, 1176)),
    )
    for key, box in rows:
        save_crisp(direct_row(source, box), f"register_row_{key}_exact.png")

    save_crisp(direct_anti_theft(source), "register_anti_theft_exact.png")
    save_crisp(rounded(source, (130, 1345, 811, 1445), (540, 78), 15),
               "register_submit_exact.png")
    save_crisp(direct_refresh_background(source), "register_avatar_refresh_exact.png")
    save_crisp(direct_avatar_ring(source), "register_avatar_ring_exact.png")
    save_crisp(warm_cutout(crop(source, (350, 650, 591, 701), (190, 40))),
               "register_avatar_prompt_exact.png")
    save_crisp(rounded(source, (270, 523, 320, 581), (46, 52), 8),
               "register_arrow_left_exact.png")
    save_crisp(rounded(source, (616, 523, 668, 581), (46, 52), 8),
               "register_arrow_right_exact.png")
    save_crisp(direct_avatar_ring(source).resize((112, 112), Image.Resampling.LANCZOS),
               "register_avatar_item_ring_exact.png")
    toggle_off = rounded(source, (686, 1202, 784, 1261), (87, 45), 21)
    save_crisp(toggle_off, "register_toggle_off_exact.png")
    # The accepted mockup only shows the off state.  Mirror that exact cropped
    # control for the on state instead of drawing a substitute switch.
    save_crisp(ImageOps.mirror(toggle_off), "register_toggle_on_exact.png")
    save_crisp(warm_cutout(crop(source, (304, 1285, 352, 1336), (38, 40))),
               "register_status_icon_exact.png")
    save_crisp(direct_status_clean(source), "register_status_clean_exact.png")
    save_crisp(warm_cutout(crop(source, (205, 1448, 736, 1508), (422, 48))),
               "register_safety_exact.png")
    save_crisp(register_surface((650, 760), panel=True), "register_avatar_picker_panel_exact.png", sliced=True)
    print("已生成 V7 快速注册弹窗分层高清资源。")


if __name__ == "__main__":
    main()
