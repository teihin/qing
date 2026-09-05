#!/usr/bin/env python3
"""Extract the accepted V7 wallet mockups into deterministic Cocos assets.

Static borders, headers, art lettering, icons and buttons are sampled directly
from the accepted effect images.  Live balance/input/record values are removed
so the Prefab can render real data on top without baking demo content.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from generate_v7_runtime_skin import OUT, ROOT, cover, save


PREVIEW = ROOT / "design-previews/2026-09-05-V7钱包三页效果图-v1"
BACKGROUND = ROOT / "art_sources/v7/casino_background_clean_v8.png"
LONG_FLOOR = ROOT / "art_sources/announcement/v7_long_floor_source.png"
FONT = ROOT / "assets/font/PingFF.ttf"
SCALE = 750 / 941


def crop(source: Image.Image, box: tuple[int, int, int, int],
         size: tuple[int, int]) -> Image.Image:
    return source.crop(box).resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def rounded(source: Image.Image, box: tuple[int, int, int, int],
            size: tuple[int, int], radius: int) -> Image.Image:
    image = crop(source, box, size)
    ss = 4
    mask = Image.new("L", (size[0] * ss, size[1] * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (ss, ss, (size[0] - 1) * ss, (size[1] - 1) * ss),
        radius=radius * ss, fill=255,
    )
    image.putalpha(mask.resize(size, Image.Resampling.LANCZOS))
    return image


def erase_horizontal(image: Image.Image, x0: int, x1: int,
                     y0: int, y1: int) -> Image.Image:
    """Clear a live text strip while keeping the local approved texture."""
    arr = np.asarray(image.convert("RGBA")).copy()
    h, w = arr.shape[:2]
    x0, x1 = max(12, x0), min(w - 12, x1)
    y0, y1 = max(2, y0), min(h - 2, y1)
    for y in range(y0, y1):
        left = np.median(arr[y, x0 - 10:x0 - 3, :3], axis=0)
        right = np.median(arr[y, x1 + 3:x1 + 10, :3], axis=0)
        arr[y, x0:x1, :3] = np.linspace(left, right, x1 - x0)
        arr[y, x0:x1, 3] = 255
    return Image.fromarray(arr, "RGBA")


def erase_box(image: Image.Image, box: tuple[int, int, int, int]) -> None:
    """Erase a rectangular control from a large panel in-place."""
    x0, y0, x1, y1 = box
    arr = np.asarray(image.convert("RGBA")).copy()
    h, w = arr.shape[:2]
    x0, x1 = max(8, x0), min(w - 8, x1)
    y0, y1 = max(2, y0), min(h - 2, y1)
    for y in range(y0, y1):
        left = np.median(arr[y, max(0, x0 - 8):x0, :3], axis=0)
        right = np.median(arr[y, x1:min(w, x1 + 8), :3], axis=0)
        arr[y, x0:x1, :3] = np.linspace(left, right, x1 - x0)
        arr[y, x0:x1, 3] = 255
    image.paste(Image.fromarray(arr, "RGBA"))


def clean_panel(source: Image.Image, box: tuple[int, int, int, int],
                size: tuple[int, int], edge: int = 9) -> Image.Image:
    """Build a truly clean V7 panel; never reuse baked rows or sample text.

    ``source`` and ``box`` stay in the signature so all existing extraction
    calls remain deterministic, but the surface is rebuilt from the approved
    V7 blue/gold palette.  This prevents source row borders from becoming
    repeated horizontal bars after nine-slice stretching.
    """
    del source, box, edge
    w, h = size
    yy, xx = np.indices((h, w))
    t = yy.astype(np.float32) / max(1, h - 1)
    top = np.array((20, 66, 96), dtype=np.float32)
    bottom = np.array((4, 29, 50), dtype=np.float32)
    rgb = top[None, None, :] * (1 - t[:, :, None]) + bottom[None, None, :] * t[:, :, None]
    # A soft center lift and sub-pixel deterministic grain retain the felt
    # quality without introducing any horizontal seams.
    center = 1.0 - np.abs(xx.astype(np.float32) / max(1, w - 1) * 2.0 - 1.0)
    rgb += center[:, :, None] * 2.2
    noise = (((xx * 17 + yy * 29) % 13) - 6).astype(np.float32) / 9.0
    rgb += noise[:, :, None]
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    image = Image.fromarray(rgba, "RGBA")

    ss = 4
    work = image.resize((w * ss, h * ss), Image.Resampling.BICUBIC)
    alpha = Image.new("L", work.size, 0)
    ad = ImageDraw.Draw(alpha)
    radius = min(22, max(8, min(w, h) // 8)) * ss
    ad.rounded_rectangle((1 * ss, 1 * ss, w * ss - 1 * ss - 1,
                          h * ss - 1 * ss - 1), radius=radius, fill=255)
    work.putalpha(alpha)
    draw = ImageDraw.Draw(work, "RGBA")
    draw.rounded_rectangle((1 * ss, 1 * ss, w * ss - 1 * ss - 1,
                            h * ss - 1 * ss - 1), radius=radius,
                           outline=(180, 153, 108, 225), width=1 * ss)
    draw.rounded_rectangle((4 * ss, 4 * ss, w * ss - 4 * ss - 1,
                            h * ss - 4 * ss - 1), radius=max(ss, radius - 3 * ss),
                           outline=(52, 96, 120, 220), width=1 * ss)
    return work.resize((w, h), Image.Resampling.LANCZOS)


def selected_channel(card: Image.Image) -> Image.Image:
    """Add a clear but restrained selected frame to a recharge channel."""
    w, h = card.size
    ss = 4
    work = card.convert("RGBA").resize((w * ss, h * ss), Image.Resampling.LANCZOS)
    # Lift the selected card slightly; the text and icon remain unchanged.
    glaze = Image.new("RGBA", work.size, (44, 105, 142, 34))
    work = Image.alpha_composite(work, glaze)
    draw = ImageDraw.Draw(work, "RGBA")
    draw.rounded_rectangle((2 * ss, 2 * ss, w * ss - 2 * ss - 1,
                            h * ss - 2 * ss - 1), radius=18 * ss,
                           outline=(247, 220, 169, 255), width=2 * ss)
    draw.rounded_rectangle((6 * ss, 6 * ss, w * ss - 6 * ss - 1,
                            h * ss - 6 * ss - 1), radius=14 * ss,
                           outline=(165, 139, 100, 235), width=1 * ss)
    return work.resize((w, h), Image.Resampling.LANCZOS)


def gold_cutout(image: Image.Image) -> Image.Image:
    """Turn an icon crop into a transparent champagne-gold cutout."""
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    value = rgb.max(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    alpha = np.clip((value - 92) * 4 + chroma * 2, 0, 255).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(.35)))
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def wallet_background() -> Image.Image:
    source = Image.open(BACKGROUND).convert("RGB")
    top = cover(source, (750, 1334))
    floor = cover(Image.open(LONG_FLOOR).convert("RGB"), (750, 1800))
    # Preserve the approved casino composition on ordinary screens, then
    # dissolve the empty lower felt into one genuine long texture.  This is a
    # single blend, not stacked or mirrored slices, so long phones have no
    # horizontal seam.
    mask = Image.new("L", (750, 1334), 255)
    draw = ImageDraw.Draw(mask)
    blend_top = 1060
    for y in range(blend_top, 1334):
        value = round(255 * (1333 - y) / max(1, 1333 - blend_top))
        draw.line((0, y, 750, y), fill=value)
    result = floor.convert("RGBA")
    blended = Image.composite(top.convert("RGBA"),
                              floor.crop((0, 0, 750, 1334)).convert("RGBA"),
                              mask)
    result.alpha_composite(blended, (0, 0))
    return result.convert("RGB")


def draw_selected_type(template: Image.Image, text: str) -> Image.Image:
    image = template.copy().convert("RGBA")
    # Rebuild only the lettering strip over the selected pill texture.
    image = erase_horizontal(image, 18, image.width - 18, 12, image.height - 10)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 25)
    draw.text((image.width / 2 + 1, image.height / 2 + 2), text,
              font=font, anchor="mm", fill=(0, 20, 38, 175))
    draw.text((image.width / 2, image.height / 2), text,
              font=font, anchor="mm", fill=(4, 34, 57, 255))
    return image


def input_asset(source: Image.Image, box: tuple[int, int, int, int],
                filename: str) -> None:
    image = rounded(source, box, (602, 79), 15)
    save(erase_horizontal(image, 230, 570, 10, 69), filename)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    recharge = Image.open(PREVIEW / "01-充值.png").convert("RGB")
    withdraw = Image.open(PREVIEW / "02-提现.png").convert("RGB")
    records = Image.open(PREVIEW / "03-记录.png").convert("RGB")
    for name, image in (("充值", recharge), ("提现", withdraw), ("记录", records)):
        if image.size != (941, 1672):
            raise RuntimeError(f"{name}效果图尺寸异常: {image.size}")

    save(wallet_background(), "wallet_bg_exact.png")
    save(crop(recharge, (0, 0, 941, 105), (750, 84)), "wallet_header_exact.png")
    for key, image in (("recharge", recharge), ("withdraw", withdraw), ("record", records)):
        save(rounded(image, (53, 126, 889, 209), (666, 66), 19),
             f"wallet_tabs_{key}_exact.png")

    # Recharge page background is a clean scalable shell.  Both section titles
    # are independent exact crops, so tall-phone growth cannot distort them.
    save(clean_panel(recharge, (67, 279, 873, 1612), (642, 1063)),
         "wallet_recharge_panel_exact.png", sliced=True)
    save(crop(recharge, (104, 309, 837, 371), (584, 49)),
         "wallet_recharge_channel_title_exact.png")
    save(crop(recharge, (104, 800, 837, 862), (584, 49)),
         "wallet_recharge_amount_title_exact.png")

    channels = (
        ("bank", (103, 397, 458, 559)),
        ("alipay", (482, 397, 837, 559)),
        ("wechat", (103, 582, 458, 744)),
        ("other", (482, 582, 837, 744)),
    )
    for key, box in channels:
        card = rounded(recharge, box, (284, 129), 17)
        save(card, f"wallet_channel_{key}_exact.png")
        save(selected_channel(card),
             f"wallet_channel_{key}_selected_exact.png")

    amount_off = rounded(recharge, (103, 883, 331, 1029), (182, 116), 14)
    amount_on = rounded(recharge, (604, 883, 838, 1029), (186, 116), 14)
    save(erase_horizontal(amount_off, 28, 154, 25, 94),
         "wallet_amount_off_exact.png")
    save(erase_horizontal(amount_on, 28, 158, 25, 94),
         "wallet_amount_on_exact.png")
    notice = rounded(recharge, (101, 1240, 839, 1390), (588, 120), 14)
    save(erase_horizontal(notice, 116, 560, 18, 102),
         "wallet_recharge_notice_exact.png")
    save(rounded(recharge, (105, 1437, 836, 1566), (582, 103), 25),
         "wallet_recharge_confirm_exact.png")

    # Withdrawal balance keeps exact art while the live number is cleared.
    balance = rounded(withdraw, (67, 279, 873, 614), (642, 267), 20)
    balance = erase_horizontal(balance, 145, 497, 85, 176)
    save(balance, "wallet_withdraw_balance_exact.png")

    save(clean_panel(withdraw, (67, 635, 873, 1611), (642, 778)),
         "wallet_withdraw_form_exact.png", sliced=True)

    type_bar = rounded(withdraw, (93, 655, 848, 730), (602, 60), 15)
    bank_selected = crop(withdraw, (93, 655, 349, 730), (204, 60))
    # Replace the selected bank segment with the unselected middle texture.
    bank_unselected = crop(withdraw, (349, 655, 593, 730), (204, 60))
    bank_unselected = erase_horizontal(bank_unselected, 12, 192, 8, 53)
    draw = ImageDraw.Draw(bank_unselected)
    font = ImageFont.truetype(str(FONT), 25)
    draw.text((102, 31), "银行卡提现", font=font, anchor="mm", fill=(231, 201, 151, 255))
    type_bar.paste(bank_unselected, (0, 0))
    save(type_bar, "wallet_withdraw_types_base_exact.png")
    save(bank_selected, "wallet_withdraw_type_bank_exact.png")
    save(draw_selected_type(bank_selected, "支付宝提现"),
         "wallet_withdraw_type_alipay_exact.png")
    save(draw_selected_type(bank_selected, "USDT提现"),
         "wallet_withdraw_type_usdt_exact.png")

    input_specs = (
        ("amount", (94, 758, 848, 857)),
        ("name", (94, 881, 848, 980)),
        ("bank", (94, 1004, 848, 1103)),
        ("card", (94, 1128, 848, 1227)),
        ("password", (94, 1251, 848, 1350)),
    )
    for key, box in input_specs:
        input_asset(withdraw, box, f"wallet_withdraw_input_{key}_exact.png")
    save(rounded(withdraw, (100, 1451, 841, 1577), (590, 100), 24),
         "wallet_withdraw_submit_exact.png")

    # Alternate payment fields share the same approved card material.  Their
    # labels remain real Prefab labels, so no server-specific wording is baked.
    generic = input_asset_base = rounded(withdraw, (94, 758, 848, 857), (602, 79), 15)
    generic = erase_horizontal(generic, 70, 568, 10, 68)
    save(generic, "wallet_withdraw_input_generic_exact.png")

    # Record panel and row: all demo values are removed before real list data.
    save(clean_panel(records, (67, 281, 873, 1509), (642, 979)),
         "wallet_record_panel_exact.png", sliced=True)
    save(crop(records, (91, 332, 849, 420), (604, 70)),
         "wallet_record_header_exact.png")
    row = clean_panel(records, (85, 449, 850, 601), (610, 121), edge=5)
    save(row, "wallet_record_row_exact.png")
    save(gold_cutout(crop(records, (107, 490, 171, 557), (52, 54))),
         "wallet_record_icon_in_exact.png")
    save(gold_cutout(crop(records, (107, 665, 171, 731), (52, 53))),
         "wallet_record_icon_out_exact.png")
    pagination = crop(records, (91, 1348, 849, 1488), (604, 112))
    pagination = erase_horizontal(pagination, 274, 330, 31, 82)
    save(pagination, "wallet_record_pagination_exact.png")

    print("已从确认稿提取钱包标题、页签、充值、提现和记录页高清资源。")


if __name__ == "__main__":
    main()
