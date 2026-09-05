#!/usr/bin/env python3
"""Extract exact runtime artwork from the accepted V7 follow-up previews.

The previews remain the visual source of truth.  Live QR codes, editable text
and list data are removed from the baked artwork so Prefab-owned interactive
nodes can render real values without overlapping sample content.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from generate_v7_runtime_skin import OUT, ROOT, save
from extract_v7_wallet_exact_assets import FONT, clean_panel, erase_horizontal
import generate_v7_followup_design_previews as preview_gen


PREVIEW = ROOT / "design-previews/2026-09-05-V7后续模块全套效果图-v3"
LONG_FLOOR = ROOT / "art_sources/announcement/v7_long_floor_source.png"
PROMO_SOURCE = ROOT / "art_sources/v7/promotion/promo_cool_approved_750x1334.png"
PROMO_HEADER = ROOT / "art_sources/v7/promotion/promo_header_approved_750x81.png"
PROMO_CLEAN_BACKGROUND = ROOT / "art_sources/v7/promotion/promo_background_clean_v2_source.png"
S = 750 / 941
BASE_H = 1334
LONG_H = 1800


def sc(value: float) -> int:
    return round(value * S)


def scaled(name: str) -> Image.Image:
    image = Image.open(PREVIEW / name).convert("RGBA")
    if image.size != (941, 1672):
        raise RuntimeError(f"效果图尺寸异常: {name}: {image.size}")
    return image.resize((750, BASE_H), Image.Resampling.LANCZOS)


def crop_scaled(name: str, box: tuple[int, int, int, int],
                size: tuple[int, int] | None = None) -> Image.Image:
    source = Image.open(PREVIEW / name).convert("RGBA")
    result = source.crop(box)
    if size is None:
        size = (sc(box[2] - box[0]), sc(box[3] - box[1]))
    return result.resize(size, Image.Resampling.LANCZOS)


def fade_to_background(page: Image.Image, start: int = 1300) -> Image.Image:
    """Extend a 750x1334 accepted page without stretching its fixed artwork."""
    del start
    floor = preview_gen.cover(Image.open(LONG_FLOOR).convert("RGB"),
                              (750, LONG_H)).convert("RGBA")
    mask = Image.new("L", (750, BASE_H), 255)
    md = ImageDraw.Draw(mask)
    blend_top = 1150
    for y in range(blend_top, BASE_H):
        md.line((0, y, 750, y),
                fill=round(255 * (BASE_H - 1 - y) /
                           max(1, BASE_H - 1 - blend_top)))
    result = floor.copy()
    blended = Image.composite(page.convert("RGBA"),
                              floor.crop((0, 0, 750, BASE_H)), mask)
    result.alpha_composite(blended, (0, 0))
    return result


def clean_base() -> Image.Image:
    """Return the approved background without any page-specific baked UI."""
    return preview_gen.base_page().resize((750, BASE_H), Image.Resampling.LANCZOS)


def replace_below(page: Image.Image, split: int) -> Image.Image:
    """Remove baked list samples with a feathered clean-background splice."""
    base = clean_base()
    blend_h = 32
    top = max(0, split - blend_h)
    page.alpha_composite(base.crop((0, split, 750, BASE_H)), (0, split))
    if top < split:
        old = page.crop((0, top, 750, split))
        new = base.crop((0, top, 750, split))
        mask = Image.new("L", (750, split - top), 0)
        md = ImageDraw.Draw(mask)
        for y in range(split - top):
            md.line((0, y, 750, y), fill=round(255 * y / max(1, split - top - 1)))
        page.paste(Image.composite(new, old, mask), (0, top))
    return page


def clean_table_header(size: tuple[int, int], labels: tuple[str, ...],
                       centers: tuple[int, ...]) -> Image.Image:
    """Create a crisp list header with no sample values underneath it."""
    image = clean_panel(Image.new("RGBA", (1, 1)), (0, 0, 1, 1), size)
    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.truetype(str(FONT), 22)
    for index, (label, center) in enumerate(zip(labels, centers)):
        draw.text((center, size[1] // 2 + 1), label, font=font, anchor="mm",
                  fill=(232, 198, 145, 255))
        if index:
            x = round((centers[index - 1] + center) / 2)
            draw.line((x, 13, x, size[1] - 13), fill=(126, 113, 91, 165), width=1)
    return image


def erase_rect(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Remove sample copy from a horizontal region using its local texture."""
    x0, y0, x1, y1 = box
    return erase_horizontal(image, x0, x1, y0, y1)


def clean_qr_card() -> Image.Image:
    card = crop_scaled("01-游戏推广.png", (294, 465, 648, 819), (282, 282))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((18, 18, 263, 263), radius=8,
                           fill=(238, 223, 193, 255))
    return card


def promo_headline() -> Image.Image:
    """Create independent anti-aliased hero lettering for responsive layout."""
    scale = 4
    image = Image.new("RGBA", (640 * scale, 78 * scale), (0, 0, 0, 0))
    font = ImageFont.truetype(str(FONT), 43 * scale)
    text = "◆  好友同桌 · 精彩开局  ◆"
    mask = Image.new("L", image.size, 0)
    md = ImageDraw.Draw(mask)
    md.text((320 * scale, 39 * scale), text, font=font, anchor="mm", fill=255)
    glow = mask.filter(ImageFilter.GaussianBlur(5 * scale))
    glow_layer = Image.new("RGBA", image.size, (74, 178, 255, 0))
    glow_layer.putalpha(glow.point(lambda value: value * 145 // 255))
    image.alpha_composite(glow_layer)
    draw = ImageDraw.Draw(image)
    draw.text((320 * scale, 39 * scale), text, font=font, anchor="mm",
              fill=(232, 245, 255, 255), stroke_width=1 * scale,
              stroke_fill=(20, 62, 104, 235))
    return image.resize((640, 78), Image.Resampling.LANCZOS)


def promo_qr_frame() -> Image.Image:
    """Create a clean QR surround; the real code remains a Graphics node."""
    scale = 4
    width, height = 350, 374
    image = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    card = (18 * scale, 32 * scale, 332 * scale, 370 * scale)

    glow_mask = Image.new("L", image.size, 0)
    gd = ImageDraw.Draw(glow_mask)
    gd.rounded_rectangle(card, radius=22 * scale, outline=245,
                         width=7 * scale)
    glow = glow_mask.filter(ImageFilter.GaussianBlur(8 * scale))
    glow_layer = Image.new("RGBA", image.size, (65, 174, 255, 0))
    glow_layer.putalpha(glow.point(lambda value: value * 175 // 255))
    image.alpha_composite(glow_layer)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle(card, radius=22 * scale,
                           fill=(242, 247, 250, 255),
                           outline=(118, 193, 246, 255), width=3 * scale)
    draw.rounded_rectangle((31 * scale, 54 * scale, 319 * scale, 357 * scale),
                           radius=14 * scale, fill=(255, 255, 255, 255),
                           outline=(220, 233, 242, 255), width=2 * scale)

    tab = [
        (61 * scale, 2 * scale), (289 * scale, 2 * scale),
        (315 * scale, 27 * scale), (289 * scale, 55 * scale),
        (61 * scale, 55 * scale), (35 * scale, 27 * scale),
    ]
    draw.polygon(tab, fill=(3, 28, 55, 255))
    draw.line(tab + [tab[0]], fill=(94, 176, 236, 255), width=2 * scale,
              joint="curve")
    font = ImageFont.truetype(str(FONT), 23 * scale)
    draw.text((175 * scale, 28 * scale), "专属邀请二维码", font=font,
              anchor="mm", fill=(224, 239, 250, 255))
    draw.text((55 * scale, 28 * scale), "◆", font=font, anchor="mm",
              fill=(232, 198, 145, 255))
    draw.text((295 * scale, 28 * scale), "◆", font=font, anchor="mm",
              fill=(232, 198, 145, 255))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def promo_info_panel() -> Image.Image:
    """Two-row panel for readable ID and download address values."""
    scale = 4
    width, height = 640, 190
    image = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((3 * scale, 3 * scale,
                            (width - 3) * scale, (height - 3) * scale),
                           radius=19 * scale, fill=(2, 28, 54, 244),
                           outline=(70, 153, 216, 220), width=2 * scale)
    draw.rounded_rectangle((7 * scale, 7 * scale,
                            (width - 7) * scale, (height - 7) * scale),
                           radius=15 * scale, outline=(31, 82, 124, 210),
                           width=1 * scale)
    draw.line((28 * scale, 73 * scale, (width - 28) * scale, 73 * scale),
              fill=(86, 146, 190, 115), width=1 * scale)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def promo_copy_button() -> Image.Image:
    scale = 4
    width, height = 86, 40
    image = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((2 * scale, 2 * scale,
                            (width - 2) * scale, (height - 2) * scale),
                           radius=11 * scale, fill=(18, 70, 112, 255),
                           outline=(232, 198, 145, 245), width=2 * scale)
    font = ImageFont.truetype(str(FONT), 19 * scale)
    draw.text((width * scale // 2, height * scale // 2), "复制", font=font,
              anchor="mm", fill=(247, 224, 181, 255))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def promo_action_button(text: str, icon: str) -> Image.Image:
    """Draw a balanced button face with a centered vector icon and label."""
    scale = 4
    width, height = 270, 82
    image = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    for y in range(4 * scale, (height - 4) * scale):
        t = (y - 4 * scale) / max(1, (height - 8) * scale)
        top = (22, 86, 143, 255)
        bottom = (5, 35, 72, 255)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        draw.line((4 * scale, y, (width - 4) * scale, y), fill=color)
    draw.rounded_rectangle((3 * scale, 3 * scale,
                            (width - 3) * scale, (height - 3) * scale),
                           radius=16 * scale, outline=(75, 167, 232, 255),
                           width=3 * scale)
    draw.rounded_rectangle((7 * scale, 7 * scale,
                            (width - 7) * scale, (height - 7) * scale),
                           radius=13 * scale, outline=(232, 198, 145, 175),
                           width=1 * scale)
    gold = (239, 207, 153, 255)
    ix, iy = 48 * scale, 41 * scale
    line_w = 4 * scale
    if icon == "share":
        draw.rounded_rectangle((27 * scale, 42 * scale, 58 * scale, 62 * scale),
                               radius=3 * scale, outline=gold, width=line_w)
        draw.line((44 * scale, 48 * scale, 44 * scale, 22 * scale),
                  fill=gold, width=line_w)
        draw.line((44 * scale, 22 * scale, 34 * scale, 32 * scale),
                  fill=gold, width=line_w)
        draw.line((44 * scale, 22 * scale, 54 * scale, 32 * scale),
                  fill=gold, width=line_w)
    else:
        draw.line((ix, 18 * scale, ix, 49 * scale), fill=gold, width=line_w)
        draw.line((ix, 49 * scale, 37 * scale, 38 * scale),
                  fill=gold, width=line_w)
        draw.line((ix, 49 * scale, 59 * scale, 38 * scale),
                  fill=gold, width=line_w)
        draw.rounded_rectangle((29 * scale, 55 * scale, 67 * scale, 65 * scale),
                               radius=2 * scale, outline=gold, width=line_w)
    font = ImageFont.truetype(str(FONT), 27 * scale)
    draw.text((165 * scale, 42 * scale), text, font=font, anchor="mm",
              fill=(232, 242, 249, 255))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def promo_assets() -> None:
    """Build modular cool-blue promotion art for responsive Prefab layout."""
    source = Image.open(PROMO_SOURCE).convert("RGBA")
    header = Image.open(PROMO_HEADER).convert("RGBA")
    clean_background = Image.open(PROMO_CLEAN_BACKGROUND).convert("RGBA")
    if source.size != (750, BASE_H):
        raise RuntimeError(f"游戏推广确认稿尺寸异常: {source.size}")
    if header.size != (750, 81):
        raise RuntimeError(f"游戏推广标题栏尺寸异常: {header.size}")

    # The first implementation kept QR chrome and action buttons baked into a
    # top-anchored 1800px master.  That crowded short screens and left a large
    # empty tail on tall phones.  Use a clean background plate and let Prefab
    # nodes own every foreground element so they can be centered responsively.
    page = preview_gen.cover(clean_background, (750, LONG_H), top_bias=False)
    save(page, "followup_promo_master_long.png")
    save(header, "followup_promo_header_exact.png")
    save(promo_headline(), "followup_promo_headline_exact.png")
    save(promo_qr_frame(), "followup_promo_qr_frame_exact.png")
    save(promo_info_panel(), "followup_promo_info_panel_exact.png")
    save(promo_copy_button(), "followup_promo_copy_button_exact.png")
    save(promo_action_button("分享海报", "share"),
         "followup_promo_share_button_exact.png")
    save(promo_action_button("保存到相册", "download"),
         "followup_promo_save_button_exact.png")


def money_assets() -> None:
    # The user explicitly removed income/expense/balance summaries and all
    # filters.  Keep a concise hero and let the clean list begin immediately.
    canvas = preview_gen.base_page()
    preview_gen.header(canvas, "金币流向")
    preview_gen.hero(canvas, "每一笔金币变动清晰可查",
                     "按时间顺序展示变动金额与变动后余额", "¥")
    preview_gen.divider(canvas, 355, "金币明细")
    page = canvas.resize((750, BASE_H), Image.Resampling.LANCZOS)
    save(fade_to_background(page), "followup_money_master_long.png")

    preview = Image.open(PREVIEW / "02-金币流向.png").convert("RGBA")
    panel = clean_panel(preview, (72, 626, 869, 1450), (636, 657))
    save(panel, "followup_money_list_panel_exact.png", sliced=True)
    save(clean_table_header((636, 51), ("说明", "收/支", "流向后", "时间"),
                            (108, 248, 373, 518)),
         "followup_money_list_header_exact.png")
    row = clean_panel(preview, (82, 702, 859, 794), (620, 73), edge=7)
    save(row, "followup_money_row_exact.png", sliced=True)


def settings_assets() -> None:
    page = scaled("03-系统设置.png")
    save(fade_to_background(page), "followup_settings_master_long.png")
    save(crop_scaled("03-系统设置.png", (748, 414, 820, 458), (58, 35)),
         "followup_switch_on_exact.png")
    save(crop_scaled("03-系统设置.png", (748, 648, 820, 692), (58, 35)),
         "followup_switch_off_exact.png")


def password_master(filename: str, out_name: str, ys: tuple[int, ...]) -> None:
    page = scaled(filename)
    for y in ys:
        page = erase_rect(page, (sc(370), sc(y + 10), sc(795), sc(y + 82)))
    save(fade_to_background(page), out_name)


def reserved_assets() -> None:
    # The early preview for this legacy entry accidentally showed bank-card
    # fields, while the shipped panelYLinfo protocol is account + two Chinese
    # reserve phrases + SMS code.  Keep the accepted V3 visual system, but draw
    # the real product fields so the editor-visible artwork never promises a
    # backend flow that does not exist.
    page = preview_gen.base_page()
    preview_gen.header(page, "修改预留信息")
    preview_gen.hero(page, "账户预留信息保护",
                     "请填写并牢记您的中文预留信息", "♥")
    preview_gen.panel(page, (72, 345, 869, 1260), radius=24, strong=True)
    preview_gen.divider(page, 395, "预留信息")
    for y, label, icon in (
        (445, "账号", "●"),
        (557, "新预留信息", "◆"),
        (669, "确认预留信息", "◆"),
        (781, "验证码", "♣"),
    ):
        # Dynamic values/placeholders are owned by Prefab EditBoxes.  Leaving
        # the value side blank avoids the sample-copy overlap seen in earlier
        # reskins while preserving all labels, dividers and field chrome.
        preview_gen.field(page, y, label, "", icon, width=700)
    preview_gen.button(page, (690, 794, 824, 860), "获取", selected=True,
                       size=21)
    preview_gen.plain_text(
        page, (128, 930), "1. 预留信息只能使用中文，至少输入3个汉字。",
        20, anchor="lm", color=preview_gen.SUBTEXT,
    )
    preview_gen.plain_text(
        page, (128, 970), "2. 两次输入必须保持一致，请妥善保管。",
        20, anchor="lm", color=preview_gen.SUBTEXT,
    )
    preview_gen.plain_text(
        page, (128, 1010), "3. 首次设置无需验证码，修改时需短信验证。",
        20, anchor="lm", color=preview_gen.SUBTEXT,
    )
    preview_gen.button(page, (196, 1100, 745, 1204), "提交预留信息",
                       "✓", selected=True, size=31)
    page = page.resize((750, BASE_H), Image.Resampling.LANCZOS)
    save(fade_to_background(page), "followup_reserved_master_long.png")


def agent_home_assets() -> None:
    page = scaled("08-代理首页.png")
    for box in (
        (285, 210, 625, 285),
        (85, 455, 855, 520),
        (85, 1015, 855, 1085),
        (85, 1138, 855, 1192),
    ):
        page = erase_rect(page, tuple(sc(v) for v in box))
    save(fade_to_background(page), "followup_agent_home_master_long.png")


AGENT_LISTS = (
    ("09-代理-我的玩家.png", "players", 140, 320),
    ("10-代理-我的业绩.png", "performance", 240, 420),
    ("11-代理-我的盟主.png", "leader", 140, 320),
    ("12-代理-总业绩.png", "total", 140, 320),
    ("13-代理-红利提取记录.png", "bonus_history", 140, 320),
    ("14-代理-奖池提取记录.png", "pool_history", 140, 320),
)


def agent_list_assets() -> None:
    for filename, key, summary_y, table_y in AGENT_LISTS:
        page = scaled(filename)
        page = erase_rect(page, (sc(95), sc(summary_y + 62),
                                 sc(846), sc(summary_y + 135)))
        split = sc(table_y)
        page = replace_below(page, split)
        save(fade_to_background(page, start=1260), f"followup_agent_{key}_master_long.png")
        save(crop_scaled(filename, (70, table_y, 871, table_y + 64), (638, 51)),
             f"followup_agent_{key}_header_exact.png")

    source = Image.open(PREVIEW / "09-代理-我的玩家.png").convert("RGBA")
    save(clean_panel(source, (70, 320, 871, 1452), (638, 902)),
         "followup_agent_list_panel_exact.png", sliced=True)
    save(clean_panel(source, (80, 396, 861, 488), (622, 73), edge=7),
         "followup_agent_row_exact.png", sliced=True)

    tabs = ("我的玩家", "二级代理", "三级代理")
    for selected in range(3):
        canvas = preview_gen.base_page()
        preview_gen.panel(canvas, (90, 140, 851, 215), radius=17)
        width = 761 // 3
        for index, text in enumerate(tabs):
            x1 = 98 + index * width
            x2 = 98 + (index + 1) * width - 8
            if index == selected:
                preview_gen.button(canvas, (x1, 147, x2, 208), text,
                                   selected=True, size=23)
            else:
                preview_gen.gold_text(canvas, (98 + index * width + width / 2, 178),
                                      text, 23)
        save(canvas.crop((90, 140, 851, 215)).resize((607, 60), Image.Resampling.LANCZOS),
             f"followup_agent_tabs_{selected}_exact.png")


def agent_promo_assets() -> None:
    # Agent promotion uses the same clean promotion shell and dynamic URL.
    promo_assets()
    page = Image.open(OUT / "followup_promo_master_long.png").convert("RGBA")
    save(page, "followup_agent_promo_master_long.png")


POPUPS = (
    ("16-代理-盟主收益.png", "leader_income"),
    ("17-代理-奖池收益.png", "pool_income"),
    ("18-代理-大区收益.png", "region_income"),
    ("19-代理-我的分红.png", "share_income"),
    ("20-代理-添加代理确认.png", "add_agent"),
    ("21-代理-删除授权确认.png", "delete_agent"),
    ("22-代理-提取红利确认.png", "withdraw_bonus"),
    ("23-代理-比例设置.png", "ratio"),
)


def agent_popup_assets() -> None:
    for filename, key in POPUPS:
        card = crop_scaled(filename, (130, 510, 811, 1130), (543, 494))
        # Keep exact title, shield and buttons; remove sample live copy only.
        card = erase_rect(card, (24, sc(820 - 510), 519, sc(995 - 510)))
        save(card, f"followup_agent_popup_{key}_exact.png")


RANKINGS = (
    ("24-排行榜-玩家手数榜.png", "hands", 608),
    ("25-排行榜-玩家赢分榜.png", "wins", 500),
    ("26-排行榜-代理红利榜.png", "bonus", 500),
)


def ranking_assets() -> None:
    base = clean_base()
    for filename, key, table_y in RANKINGS:
        canvas = preview_gen.base_page()
        preview_gen.header(canvas, "排行榜")
        preview_gen.panel(canvas, (70, 135, 871, 370), radius=26, strong=True)
        preview_gen.shield(canvas, (170, 252), 165)
        preview_gen.gold_text(canvas, (285, 182), "8L 荣耀榜", 38, anchor="lm")
        preview_gen.plain_text(canvas, (287, 230), "活动时间", 19,
                               anchor="lm", color=preview_gen.SUBTEXT)
        preview_gen.plain_text(canvas, (287, 270), "我的排名与当前奖励",
                               22, anchor="lm", color=preview_gen.TEXT)
        page = canvas.resize((750, BASE_H), Image.Resampling.LANCZOS)
        # Top category tabs and optional stake tabs are live Toggle art.
        for y0, y1 in ((392, 478), (500, 584) if key == "hands" else (0, 0)):
            if y1 > y0:
                top, bottom = sc(y0), sc(y1)
                page.alpha_composite(base.crop((0, top, 750, bottom)), (0, top))
        split = sc(table_y)
        page = replace_below(page, split)
        save(fade_to_background(page, start=1260), f"followup_ranking_{key}_master_long.png")
        save(crop_scaled(filename, (70, table_y, 871, table_y + 64), (638, 51)),
             f"followup_ranking_{key}_header_exact.png")

    source = Image.open(PREVIEW / "25-排行榜-玩家赢分榜.png").convert("RGBA")
    save(clean_panel(source, (70, 500, 871, 1450), (638, 757)),
         "followup_ranking_list_panel_exact.png", sliced=True)
    save(clean_panel(source, (80, 576, 861, 668), (622, 73), edge=7),
         "followup_ranking_row_exact.png", sliced=True)
    save(crop_scaled("25-排行榜-玩家赢分榜.png", (675, 278, 830, 348), (124, 56)),
         "followup_ranking_claim_exact.png")

    categories = ("玩家手数榜", "玩家赢分榜", "代理红利榜")
    for selected in range(3):
        canvas = preview_gen.base_page()
        preview_gen.panel(canvas, (70, 392, 871, 478), radius=17)
        for index, text in enumerate(categories):
            x1, x2 = 79 + index * 261, 79 + index * 261 + 252
            if index == selected:
                preview_gen.button(canvas, (x1, 402, x2, 468), text,
                                   selected=True, size=23)
            else:
                preview_gen.gold_text(canvas, ((x1 + x2) // 2, 435), text, 22)
        save(canvas.crop((70, 392, 871, 478)).resize((638, 69), Image.Resampling.LANCZOS),
             f"followup_ranking_tabs_{selected}_exact.png")

    stakes = ("1皮", "2皮", "5皮", "10皮", "20皮")
    for selected in range(5):
        canvas = preview_gen.base_page()
        preview_gen.panel(canvas, (88, 500, 853, 584), radius=16)
        for index, text in enumerate(stakes):
            if index == selected:
                preview_gen.button(canvas, (98 + index * 148, 510,
                                            225 + index * 148, 574), text,
                                   selected=True, size=22)
            else:
                preview_gen.gold_text(canvas, (161 + index * 148, 542), text, 22)
        save(canvas.crop((88, 500, 853, 584)).resize((610, 67), Image.Resampling.LANCZOS),
             f"followup_ranking_stakes_{selected}_exact.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    promo_assets()
    money_assets()
    settings_assets()
    password_master("04-修改登录密码.png", "followup_password_login_master_long.png",
                    (462, 588, 714))
    password_master("05-修改交易密码.png", "followup_password_trade_master_long.png",
                    (462, 588, 714))
    password_master("06-初始化交易密码.png", "followup_password_init_master_long.png",
                    (462, 588))
    reserved_assets()
    agent_home_assets()
    agent_list_assets()
    agent_promo_assets()
    agent_popup_assets()
    ranking_assets()
    print("V7 后续主功能精确资源已生成")


if __name__ == "__main__":
    main()
