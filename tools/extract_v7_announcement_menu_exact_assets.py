#!/usr/bin/env python3
"""Build one tall approved V7 announcement-menu bitmap for Cocos.

The visible title, shield, cards, button typography and borders come directly
from the approved 941x1672 mockup.  Only the empty table below the controls is
extended with a colour-matched continuous floor plate.  Runtime therefore uses
one fixed-proportion bitmap instead of a sliced or stitched background.
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageStat

from generate_v7_runtime_skin import ROOT, OUT, save


REFERENCE = (
    ROOT
    / "design-previews/2026-09-04-V7公告菜单高清效果图-v1/01-公告菜单主页.png"
)
TARGET_SIZE = (750, 1334)
BODY_HEIGHT = 1179
LONG_HEIGHT = 1800
ASSET = "announcement_menu_long_exact.png"
FLOOR_SOURCE = ROOT / "art_sources/announcement/v7_long_floor_source.png"


def main() -> None:
    source = Image.open(REFERENCE).convert("RGB")
    if source.size != (941, 1672):
        raise ValueError(f"公告确认稿尺寸异常: {source.size}")

    scaled = source.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    body = scaled.crop((0, 0, TARGET_SIZE[0], BODY_HEIGHT))

    # The reference puts decorative red chips against the lower-right nav
    # edge.  On a tall phone they would otherwise end abruptly before the
    # adaptive floor extension.  Replace only that lower corner with adjacent
    # table texture and feather the join; the principal shield/cards/chips stay
    # pixel-identical to the approved mockup.
    replacement = body.crop((430, 1035, 570, BODY_HEIGHT))
    replacement = replacement.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    replacement = replacement.resize((140, BODY_HEIGHT - 1035), Image.Resampling.LANCZOS)
    patch_layer = body.copy()
    patch_layer.paste(replacement, (610, 1035))
    feather = Image.new("L", body.size, 0)
    fd = ImageDraw.Draw(feather)
    for x in range(560, 601):
        alpha = round((x - 560) / 40 * 255)
        fd.line((x, 1035, x, BODY_HEIGHT), fill=alpha)
    fd.rectangle((601, 1035, 750, BODY_HEIGHT), fill=255)
    body = Image.composite(patch_layer, body, feather)
    # The mockup contains the first tip of its own center navigation shield at
    # the very bottom.  The project already renders the shared accepted nav bar
    # above this body, so extend the adjacent quiet table texture over that tip
    # to avoid two slightly different shield crowns meeting at the seam.
    clean_floor = body.crop((0, 1140, TARGET_SIZE[0], 1170))
    clean_floor = clean_floor.resize((TARGET_SIZE[0], 39), Image.Resampling.LANCZOS)
    body.paste(clean_floor, (0, 1140))
    # Preserve the accepted design unchanged through the cards/buttons.  A
    # separately generated clean table plane is used only below them.  It is
    # colour-matched and dissolved across a wide floor-only zone, rather than
    # joined on one horizontal row.  The dissolve starts only after the fourth
    # button, cards and chips, so every approved foreground pixel stays intact
    # while the empty table beneath them becomes one continuous tall scene.
    if not FLOOR_SOURCE.is_file():
        raise FileNotFoundError(f"缺少公告桌面延展源: {FLOOR_SOURCE}")
    generated = Image.open(FLOOR_SOURCE).convert("RGB")
    generated = generated.resize(
        (750, round(generated.height * 750 / generated.width)),
        Image.Resampling.LANCZOS,
    )
    blend_top = 1100
    blend_bottom = 1400
    required = LONG_HEIGHT - blend_top
    # The source's top edge has deliberate blueprint lines.  Start farther down
    # in its calm woven centre so the accepted linework can fade away once,
    # instead of producing two overlapping sets of marks in the transition.
    source_y = 330
    generated = generated.crop((0, source_y, 750, source_y + required))

    body_sample = body.crop((320, 1020, 730, BODY_HEIGHT))
    generated_sample = generated.crop((0, 0, 750, 180))
    body_mean = ImageStat.Stat(body_sample).mean
    generated_mean = ImageStat.Stat(generated_sample).mean
    matched_channels = []
    for channel, want, have in zip(generated.split(), body_mean, generated_mean):
        factor = max(0.8, min(1.2, want / max(1, have)))
        matched_channels.append(
            channel.point(lambda value, f=factor: min(255, round(value * f)))
        )
    generated = Image.merge("RGB", matched_channels)
    generated = ImageEnhance.Contrast(generated).enhance(0.95)

    # Quiet continuation used behind the dissolve after the approved source
    # ends.  It never becomes the final visible texture by itself.
    quiet = body.crop((260, 1100, 650, BODY_HEIGHT))
    quiet = quiet.resize((750, LONG_HEIGHT - BODY_HEIGHT), Image.Resampling.BICUBIC)
    quiet = quiet.filter(ImageFilter.GaussianBlur(radius=2.2))
    edge = body.crop((0, BODY_HEIGHT - 60, 750, BODY_HEIGHT))
    edge = edge.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    edge = edge.resize((750, 140), Image.Resampling.BICUBIC)
    edge_layer = quiet.copy()
    edge_layer.paste(edge, (0, 0))
    edge_mask = Image.new("L", quiet.size, 0)
    ed = ImageDraw.Draw(edge_mask)
    for y in range(140):
        t = y / 139
        ed.line((0, y, 750, y), fill=round((1 - t * t) * 255))
    quiet = Image.composite(edge_layer, quiet, edge_mask)
    base = Image.new("RGB", (750, LONG_HEIGHT))
    base.paste(body, (0, 0))
    base.paste(quiet, (0, BODY_HEIGHT))

    generated_layer = base.copy()
    generated_layer.paste(generated, (0, blend_top))
    alpha = Image.new("L", (750, LONG_HEIGHT), 0)
    ad = ImageDraw.Draw(alpha)
    for y in range(blend_top, LONG_HEIGHT):
        t = min(1.0, (y - blend_top) / (blend_bottom - blend_top))
        t = t * t * (3 - 2 * t)
        ad.line((0, y, 750, y), fill=round(t * 255))

    long_image = Image.composite(generated_layer, base, alpha)

    # Never nine-slice or scale this composition.  Short screens crop its quiet
    # lower table behind the fixed navigation; tall screens reveal more of the
    # same single bitmap without moving the title, shield, props or controls.
    save(long_image, ASSET, sliced=False)

    print(f"generated {OUT / ASSET} {long_image.size}")


if __name__ == "__main__":
    main()
