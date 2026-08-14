#!/usr/bin/env python3
"""Generate the black-gold Qin skin used by resources/Prefabs/钱包.

The script keeps every existing image dimension, meta trim rectangle and UUID.
Recharge-channel brand tabs keep their normal UnionPay/Alipay/WeChat colours,
and the transparent selected-state highlight is intentionally left untouched.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

sys.dont_write_bytecode = True

from generate_qin_ranking_skin import (  # noqa: E402
    GOLD,
    GOLD_DARK,
    GOLD_HI,
    GOLD_MID,
    IVORY,
    PING,
    SONGTI,
    S,
    center_text,
    font,
    gradient,
    metal_text,
    save,
)


ROOT = Path(__file__).resolve().parents[1]
WALLET = ROOT / "assets" / "ImagesLuck" / "钱包"
COMMON = ROOT / "assets" / "ImagesLuck" / "公用"
COMMON1 = ROOT / "assets" / "ImagesLuck" / "公用1"
KK_COMMON = ROOT / "assets" / "imagesKK" / "公用"
OTHER = ROOT / "assets" / "resources" / "other"
ART = ROOT / "art_sources" / "wallet"

EMBLEM_SOURCE = ART / "qin_wallet_emblem_source.png"

OUTPUTS: list[Path] = []


def scaled(size: tuple[int, int]) -> tuple[int, int]:
    return size[0] * S, size[1] * S


def emit(path: Path, image: Image.Image) -> Path:
    output = save(path, image)
    OUTPUTS.append(output)
    return output


def lacquer_panel(
    size: tuple[int, int],
    *,
    selected: bool = False,
    radius: int | None = None,
    inset: int = 2,
) -> Image.Image:
    """Create a reusable black-obsidian panel with restrained Qin gold edges."""
    canvas = scaled(size)
    radius = radius if radius is not None else max(7, min(size) // 3)
    image = Image.new("RGBA", canvas, (0, 0, 0, 0))
    box = (inset * S, inset * S, (size[0] - inset) * S, (size[1] - inset) * S)

    if selected:
        glow_mask = Image.new("L", canvas, 0)
        ImageDraw.Draw(glow_mask).rounded_rectangle(box, radius=radius * S, outline=145, width=5 * S)
        glow = Image.new("RGBA", canvas, (205, 127, 31, 0))
        glow.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(4 * S)))
        image.alpha_composite(glow)

    panel = gradient(
        canvas,
        (42, 30, 16, 250) if selected else (25, 21, 15, 246),
        (6, 6, 5, 252),
    )
    mask = Image.new("L", canvas, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius * S, fill=255)
    panel.putalpha(mask)
    image.alpha_composite(panel)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        box,
        radius=radius * S,
        outline=GOLD_MID if selected else (105, 67, 28, 215),
        width=(3 if selected else 2) * S,
    )
    inner = ((inset + 4) * S, (inset + 4) * S, (size[0] - inset - 4) * S, (size[1] - inset - 4) * S)
    draw.rounded_rectangle(
        inner,
        radius=max(2, radius - 4) * S,
        outline=(248, 213, 137, 190 if selected else 95),
        width=S,
    )
    draw.line(
        ((inset + radius) * S, (inset + 5) * S, (size[0] - inset - radius) * S, (inset + 5) * S),
        fill=(255, 238, 184, 72 if selected else 32),
        width=S,
    )
    return image


def make_tab(filename: str, label: str, selected: bool) -> Path:
    size = Image.open(WALLET / filename).size
    image = lacquer_panel(size, selected=selected, radius=26, inset=1)
    metal_text(
        image,
        label,
        font(PING, 27),
        (size[0] * S // 2, size[1] * S // 2),
        stroke=1,
        glow=2 if selected else 0,
    )
    if not selected:
        veil = Image.new("RGBA", image.size, (5, 5, 4, 78))
        image.alpha_composite(veil)
    return emit(WALLET / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_amount_tile(filename: str, selected: bool) -> Path:
    size = (192, 82)
    image = lacquer_panel(size, selected=selected, radius=13, inset=2)
    draw = ImageDraw.Draw(image)
    cx, cy = size[0] * S // 2, size[1] * S // 2
    draw.line((30 * S, cy, 162 * S, cy), fill=(159, 98, 31, 34), width=S)
    draw.polygon(
        ((20 * S, cy), (25 * S, cy - 5 * S), (30 * S, cy), (25 * S, cy + 5 * S)),
        outline=GOLD_MID if selected else (102, 69, 34, 150),
    )
    return emit(WALLET / filename, image.resize(size, Image.Resampling.LANCZOS))


def make_button(
    path: Path,
    text: str,
    *,
    primary: bool = True,
    warning: bool = False,
    font_size: int | None = None,
) -> Path:
    size = Image.open(path).size if path.exists() else (214, 58)
    image = lacquer_panel(size, selected=primary, radius=max(8, min(size) // 2 - 2), inset=2)
    draw = ImageDraw.Draw(image)
    if warning:
        draw.line((24 * S, 12 * S, (size[0] - 24) * S, 12 * S), fill=(196, 86, 66, 145), width=2 * S)
        draw.line(
            (24 * S, (size[1] - 12) * S, (size[0] - 24) * S, (size[1] - 12) * S),
            fill=(196, 86, 66, 90),
            width=S,
        )
    text_size = font_size or max(15, min(27, round(size[1] * 0.34)))
    metal_text(
        image,
        text,
        font(PING, text_size),
        (size[0] * S // 2, size[1] * S // 2),
        stroke=1,
        glow=2 if primary else 0,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_input_frame() -> Path:
    size = (615, 86)
    image = lacquer_panel(size, selected=False, radius=15, inset=2)
    draw = ImageDraw.Draw(image)
    draw.line((25 * S, 70 * S, 590 * S, 70 * S), fill=(221, 166, 75, 92), width=S)
    draw.polygon(((14 * S, 43 * S), (20 * S, 37 * S), (26 * S, 43 * S), (20 * S, 49 * S)), outline=GOLD_MID)
    return emit(WALLET / "输入底框.png", image.resize(size, Image.Resampling.LANCZOS))


def make_field_label(filename: str, text: str, *, font_size: int | None = None) -> Path:
    path = WALLET / filename
    size = Image.open(path).size
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    text_size = font_size or max(15, min(25, round(size[1] * 0.57)))
    metal_text(
        image,
        text,
        font(PING, text_size),
        (size[0] * S // 2, size[1] * S // 2),
        stroke=1,
        glow=0,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def emblem_rgba(size: tuple[int, int]) -> Image.Image:
    source = Image.open(EMBLEM_SOURCE).convert("RGB")
    source = ImageOps.fit(source, size, Image.Resampling.LANCZOS).convert("RGBA")
    source = ImageEnhance.Contrast(source).enhance(1.08)
    rgb = source.convert("RGB")
    r, g, b = rgb.split()
    brightness = ImageOps.autocontrast(Image.merge("RGB", (r, g, b)).convert("L"))
    alpha = brightness.point(lambda p: 0 if p < 18 else min(255, round((p - 18) * 2.5)))
    source.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.35)))
    return source


def make_coin() -> Path:
    size = (30, 25)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    emblem = emblem_rgba((25, 25))
    image.alpha_composite(emblem, (2, 0))
    pixels = image.load()
    for point in ((0, 0), (29, 0), (0, 24), (29, 24)):
        pixels[point] = (117, 72, 24, 8)
    return emit(WALLET / "金币.png", image)


def make_wallet_title() -> Path:
    size = (84, 40)
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    metal_text(image, "钱包", font(PING, 26), (42 * S, 20 * S), stroke=1, glow=2)
    return emit(WALLET / "钱包.png", image.resize(size, Image.Resampling.LANCZOS))


def make_balance() -> Path:
    size = (479, 73)
    image = lacquer_panel(size, selected=False, radius=21, inset=2)
    emblem = emblem_rgba((58 * S, 58 * S))
    image.alpha_composite(emblem, (9 * S, 7 * S))
    draw = ImageDraw.Draw(image)
    draw.line((76 * S, 16 * S, 76 * S, 57 * S), fill=(146, 88, 28, 140), width=S)
    metal_text(image, "钱包余额", font(PING, 20), (145 * S, 36 * S), stroke=1, glow=0)
    draw.line((210 * S, 36 * S, 454 * S, 36 * S), fill=(222, 166, 75, 34), width=S)
    return emit(WALLET / "钱包余额.png", image.resize(size, Image.Resampling.LANCZOS))


def make_long_title(filename: str, text: str, font_size: int) -> Path:
    path = WALLET / filename
    size = Image.open(path).size
    image = lacquer_panel(size, selected=False, radius=13, inset=1)
    metal_text(
        image,
        text,
        font(PING, font_size),
        (size[0] * S // 2, size[1] * S // 2),
        stroke=1,
        glow=1,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_withdraw_type(path: Path, text: str, icon: str) -> Path:
    size = Image.open(path).size if path.exists() else (214, 58)
    image = lacquer_panel(size, selected=True, radius=18, inset=1)
    draw = ImageDraw.Draw(image)
    draw.ellipse((11 * S, 10 * S, 49 * S, 48 * S), fill=(45, 29, 12, 240), outline=GOLD, width=2 * S)
    if icon == "bank":
        draw.polygon(((18 * S, 24 * S), (30 * S, 15 * S), (42 * S, 24 * S)), outline=GOLD_HI)
        for x in (21, 28, 35, 42):
            draw.line((x * S, 25 * S, x * S, 38 * S), fill=GOLD_HI, width=S)
        draw.line((17 * S, 40 * S, 43 * S, 40 * S), fill=GOLD_HI, width=2 * S)
    else:
        center_text(draw, (30 * S, 29 * S), "支" if icon == "alipay" else "T", font(PING, 19), GOLD_HI)
    center_text(draw, (132 * S, 29 * S), text, font(PING, 21), IVORY, S, (49, 26, 7, 255))
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_member_channel(path: Path, text: str, selected: bool) -> Path:
    size = Image.open(path).size
    image = lacquer_panel(size, selected=selected, radius=15, inset=1)
    draw = ImageDraw.Draw(image)
    if "VIP" in text:
        draw.polygon(
            ((16 * S, 27 * S), (20 * S, 15 * S), (27 * S, 24 * S), (34 * S, 15 * S), (38 * S, 27 * S)),
            fill=GOLD if selected else (136, 99, 48, 220),
        )
    else:
        draw.ellipse((18 * S, 14 * S, 38 * S, 34 * S), outline=GOLD if selected else (136, 99, 48, 220), width=2 * S)
    center_text(
        draw,
        (137 * S, size[1] * S / 2),
        text,
        font(PING, 19),
        IVORY if selected else (173, 158, 126, 255),
        S,
        (49, 26, 7, 255),
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_close_button() -> Path:
    size = (45, 45)
    image = lacquer_panel(size, selected=False, radius=21, inset=1)
    draw = ImageDraw.Draw(image)
    draw.line((14 * S, 14 * S, 31 * S, 31 * S), fill=GOLD_HI, width=3 * S)
    draw.line((31 * S, 14 * S, 14 * S, 31 * S), fill=GOLD_HI, width=3 * S)
    return emit(COMMON / "btn_4.png", image.resize(size, Image.Resampling.LANCZOS))


def make_frame_bottom() -> Path:
    path = KK_COMMON / "框底.png"
    size = Image.open(path).size
    image = lacquer_panel(size, selected=False, radius=18, inset=1)
    draw = ImageDraw.Draw(image)
    draw.line((28 * S, 20 * S, (size[0] - 28) * S, 20 * S), fill=(238, 198, 112, 155), width=2 * S)
    draw.polygon(
        ((size[0] * S / 2 - 6 * S, 18 * S), (size[0] * S / 2, 12 * S), (size[0] * S / 2 + 6 * S, 18 * S), (size[0] * S / 2, 24 * S)),
        outline=GOLD_HI,
    )
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def make_paste_icon() -> Path:
    path = COMMON / "粘贴2.jpg"
    size = Image.open(path).size
    image = gradient(size, (22, 17, 10), (5, 5, 4)).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((67, 54, 193, 210), radius=18, outline=(212, 162, 76), width=8)
    draw.rounded_rectangle((91, 36, 169, 76), radius=13, fill=(26, 19, 9), outline=(255, 231, 169), width=6)
    for y in (105, 135, 165):
        draw.line((92, y, 170, y), fill=(232, 193, 111), width=5)
    image.save(path, quality=94, subsampling=0)
    OUTPUTS.append(path)
    return path


def make_submit_text() -> Path:
    path = OTHER / "提交订单.png"
    size = Image.open(path).size
    image = Image.new("RGBA", scaled(size), (0, 0, 0, 0))
    metal_text(image, "提交订单", font(PING, 20), (size[0] * S // 2, size[1] * S // 2), stroke=1, glow=0)
    return emit(path, image.resize(size, Image.Resampling.LANCZOS))


def paste_rgba(canvas: Image.Image, path: Path, xy: tuple[int, int], size: tuple[int, int] | None = None) -> None:
    asset = Image.open(path).convert("RGBA")
    if size:
        asset = asset.resize(size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(asset, xy)


def preview_font(size: int):
    return font(PING, size / S)


def preview_page(kind: str) -> Image.Image:
    page = Image.open(COMMON / "背景.png").convert("RGBA")
    paste_rgba(page, COMMON1 / "顶部.png", (0, 0))
    paste_rgba(page, WALLET / "钱包.png", (333, 25))
    paste_rgba(page, ROOT / "assets" / "ImagesLuck" / "大厅" / "客服.png", (678, 10))
    paste_rgba(page, WALLET / "1.png", (95, 102))
    paste_rgba(page, WALLET / "2.png", (294, 102))
    paste_rgba(page, WALLET / "3.png", (466, 102))

    draw = ImageDraw.Draw(page)
    if kind == "充值":
        draw.text((72, 211), "选择充值渠道", font=preview_font(22), fill=IVORY)
        for path, xy in (
            (WALLET / "3-1.png", (61, 250)),
            (WALLET / "支付宝.png", (256, 250)),
            (WALLET / "3-2.png", (451, 250)),
        ):
            paste_rgba(page, path, xy, (238, 121))
        draw.text((72, 412), "选择充值金额", font=preview_font(22), fill=IVORY)
        for i, label in enumerate(("50", "100", "500", "1000", "2000", "5000")):
            x = 61 + (i % 3) * 211
            y = 455 + (i // 3) * 112
            paste_rgba(page, WALLET / ("金额按钮底1.png" if i == 0 else "金额按钮底2.png"), (x, y), (192, 82))
            center_text(draw, (x + 96, y + 41), label, preview_font(23), GOLD_HI if i == 0 else IVORY)
        draw.text((72, 700), "充值金额将按当前通道规则到账", font=preview_font(18), fill=(196, 86, 66, 255))
        paste_rgba(page, WALLET / "充值提示按钮.png", (230, 785))
        paste_rgba(page, WALLET / "充值按钮.png", (193, 920))
    elif kind == "提现":
        paste_rgba(page, WALLET / "钱包余额.png", (136, 222))
        center_text(draw, (460, 258), "88888.00", preview_font(25), GOLD_HI)
        for p, xy in (
            (WALLET / "银行卡提现.png", (54, 330)),
            (WALLET / "支付宝提现.png", (268, 330)),
            (WALLET / "USDT提现.png", (482, 330)),
        ):
            paste_rgba(page, p, xy)
        for i, label in enumerate(("金额", "姓名", "银行", "银行卡号", "交易密码")):
            y = 425 + i * 100
            paste_rgba(page, WALLET / "输入底框.png", (68, y), (615, 86))
            draw.text((100, y + 28), label, font=preview_font(20), fill=(132, 122, 108, 255))
        paste_rgba(page, WALLET / "全部提现.png", (500, 925))
        paste_rgba(page, WALLET / "申请提现.png", (193, 1045))
    elif kind == "记录":
        paste_rgba(page, COMMON / "表格标题头.png", (0, 230))
        for text, x in (("类型", 92), ("金额", 280), ("时间", 460), ("状态", 650)):
            center_text(draw, (x, 278), text, preview_font(20), GOLD_HI)
        for row in range(6):
            y = 335 + row * 102
            draw.line((40, y + 76, 710, y + 76), fill=(146, 88, 28, 85), width=1)
            draw.text((61, y), "充值", font=preview_font(18), fill=IVORY)
            draw.text((244, y), "+500.00", font=preview_font(18), fill=GOLD_HI)
            draw.text((405, y), "2026-07-22", font=preview_font(17), fill=IVORY)
            draw.text((611, y), "已完成", font=preview_font(18), fill=GOLD)
        center_text(draw, (375, 1040), "1 / 5", preview_font(21), GOLD_HI)
    elif kind == "实名":
        paste_rgba(page, WALLET / "钱包-实名认证.png", (149, 215))
        for i, label in enumerate(("姓名", "银行名称", "银行卡号", "交易密码", "确认密码")):
            y = 330 + i * 112
            paste_rgba(page, WALLET / "输入底框.png", (68, y), (615, 86))
            draw.text((102, y + 28), label, font=preview_font(20), fill=(132, 122, 108, 255))
        draw.text((86, 920), "请确认实名信息准确，提交后将用于账户安全验证", font=preview_font(17), fill=(196, 86, 66, 255))
        paste_rgba(page, ROOT / "assets" / "imagesKK" / "公用" / "确定.png", (228, 1025), (295, 85))
    elif kind == "订单":
        paste_rgba(page, WALLET / "订单详情.png", (310, 210))
        draw.text((88, 302), "该笔订单关闭还剩时间", font=preview_font(19), fill=IVORY)
        draw.text((525, 302), "09:38", font=preview_font(22), fill=GOLD_HI)
        for i, (label, value) in enumerate((
            ("订单编号", "QIN202607220001"),
            ("姓名", "玩家姓名"),
            ("银行名称", "示例银行"),
            ("银行卡号", "**** **** 8888"),
            ("充值金额", "500.00"),
        )):
            y = 370 + i * 102
            paste_rgba(page, WALLET / "输入底框.png", (68, y), (615, 86))
            draw.text((96, y + 29), label, font=preview_font(18), fill=(132, 122, 108, 255))
            draw.text((265, y + 29), value, font=preview_font(18), fill=IVORY if i < 4 else GOLD_HI)
            paste_rgba(page, WALLET / "复制.png", (557, y + 18), (113, 49))
        paste_rgba(page, WALLET / "刷新.png", (197, 980))
    else:
        overlay = Image.new("RGBA", page.size, (0, 0, 0, 148))
        page.alpha_composite(overlay)
        paste_rgba(page, KK_COMMON / "框.png", (57, 270))
        draw = ImageDraw.Draw(page)
        center_text(draw, (375, 332), "选择银行", preview_font(24), GOLD_HI)
        paste_rgba(page, COMMON / "btn_4.png", (622, 292))
        for i, label in enumerate(("中国银行", "工商银行", "建设银行", "农业银行", "招商银行")):
            y = 390 + i * 88
            paste_rgba(page, COMMON / "表格标题头.png", (78, y), (594, 76))
            draw.text((118, y + 24), label, font=preview_font(19), fill=IVORY)
            draw.text((620, y + 24), "›", font=preview_font(22), fill=GOLD_HI)
    return page


def make_preview() -> Path:
    names = ("充值", "提现", "记录", "实名", "订单", "选择银行")
    pages = [preview_page(name).resize((450, 800), Image.Resampling.LANCZOS) for name in names]
    sheet = Image.new("RGB", (1390, 1710), (7, 6, 5))
    draw = ImageDraw.Draw(sheet)
    for i, (name, page) in enumerate(zip(names, pages)):
        col, row = i % 3, i // 3
        x, y = 10 + col * 460, 50 + row * 850
        sheet.paste(page.convert("RGB"), (x, y))
        center_text(draw, (x + 225, y - 25), name, preview_font(20), (232, 193, 111))
    out = ART / "qin_wallet_runtime_preview.png"
    sheet.save(out, quality=94)
    return out


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)

    for filename, label, selected in (
        ("1.png", "充值", True),
        ("2.png", "提现", True),
        ("3.png", "记录", True),
        ("4.png", "充值", False),
        ("5.png", "提现", False),
        ("6.png", "记录", False),
    ):
        make_tab(filename, label, selected)

    make_amount_tile("金额按钮底1.png", True)
    make_amount_tile("金额按钮底2.png", False)

    for filename, text, primary, warning, text_size in (
        ("充值按钮.png", "充值", True, False, 25),
        ("未完成订单.png", "进入未完成订单", False, True, 21),
        ("充值提示按钮.png", "充值提现必看", False, True, 20),
        ("申请提现.png", "申请提现", True, False, 24),
        ("全部提现.png", "全部提现", False, False, 20),
        ("刷新.png", "刷新", False, False, 23),
        ("复制.png", "复制", False, False, 18),
        ("生成订单.png", "生成订单", True, False, 18),
    ):
        make_button(WALLET / filename, text, primary=primary, warning=warning, font_size=text_size)

    make_input_frame()
    make_wallet_title()
    make_balance()
    make_coin()
    make_long_title("钱包-实名认证.png", "实名认证和交易密码设置", 22)
    make_long_title("订单详情.png", "订单详情", 22)

    for filename, text, text_size in (
        ("提现金额.png", "金额:", 21),
        ("提现姓名.png", "姓名:", 21),
        ("提现银行.png", "银行:", 21),
        ("提现卡号.png", "卡号:", 21),
        ("提现交易密码.png", "交易密码:", 19),
        ("RMB金额.png", "RMB金额:", 20),
        ("USDT数量.png", "USDT数量:", 20),
        ("TRC20地址.png", "TRC20地址:", 20),
        ("姓名.png", "姓名", 21),
        ("银行名称.png", "银行名称", 20),
        ("银行卡号.png", "银行卡号", 20),
        ("交易密码.png", "交易密码", 20),
        ("确认密码.png", "确认密码", 20),
        ("订单编号.png", "订单编号", 20),
        ("充值金额.png", "充值金额", 20),
        ("类型.png", "类型", 20),
        ("金额.png", "金额", 20),
        ("时间.png", "时间", 20),
        ("状态.png", "状态", 20),
    ):
        make_field_label(filename, text, font_size=text_size)

    make_withdraw_type(WALLET / "银行卡提现.png", "银行卡提现", "bank")
    make_withdraw_type(WALLET / "支付宝提现.png", "支付宝提现", "alipay")
    make_withdraw_type(WALLET / "USDT提现.png", "USDT提现", "usdt")

    make_member_channel(COMMON1 / "普通会员通道.png", "普通会员通道", True)
    make_member_channel(COMMON1 / "普通会员通道未.png", "普通会员通道", False)
    make_member_channel(COMMON1 / "VIP会员通道.png", "VIP会员通道", True)
    make_member_channel(COMMON1 / "VIP会员通道未.png", "VIP会员通道", False)
    make_close_button()
    make_frame_bottom()
    make_paste_icon()
    make_submit_text()

    preview = make_preview()
    for path in OUTPUTS:
        print(path.relative_to(ROOT))
    print(preview.relative_to(ROOT))


if __name__ == "__main__":
    main()
