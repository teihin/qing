#!/usr/bin/env python3
"""Generate V7 effect previews for the remaining account-side modules.

The previews reuse the approved V7 casino background, muted champagne-gold
typography, blue-gray embossed panels and smooth 8L shield.  Text is rendered
deterministically so Chinese labels and business content remain exact.
This script only writes design-previews; it does not touch runtime assets.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "design-previews/2026-09-05-V7后续模块全套效果图-v3"
V7 = ROOT / "assets/resources/V7"
W, H = 941, 1672
FONT_MED = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_LIGHT = "/System/Library/Fonts/STHeiti Light.ttc"
GOLD = (232, 198, 145)
GOLD_HI = (250, 225, 181)
GOLD_LOW = (177, 137, 87)
TEXT = (236, 215, 181)
SUBTEXT = (184, 177, 166)
CYAN = (77, 220, 224)
GREEN = (155, 207, 59)
RED = (255, 88, 77)
NAVY = (5, 32, 54)


def font(size: int, medium: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_MED if medium else FONT_LIGHT, size)


def safe_icon(value: str) -> str:
    """Use glyphs present in the bundled Chinese font; avoid tofu squares."""
    return {
        "⚙": "♠", "◉": "♣", "♪": "♦", "♜": "♠",
        "⇄": "♣", "▣": "♠", "♢": "♦", "✎": "♥",
        "↗": "♠", "✓": "◆", "♟": "♣", "♛": "♠",
    }.get(value, value)


def cover(image: Image.Image, size=(W, H), top_bias=True) -> Image.Image:
    sw, sh = image.size
    tw, th = size
    scale = max(tw / sw, th / sh)
    resized = image.resize((round(sw * scale), round(sh * scale)), Image.Resampling.LANCZOS)
    x = max(0, (resized.width - tw) // 2)
    y = 0 if top_bias else max(0, (resized.height - th) // 2)
    return resized.crop((x, y, x + tw, y + th))


def base_page() -> Image.Image:
    bg = cover(Image.open(V7 / "wallet_bg_exact.png").convert("RGB"))
    glaze = Image.new("RGBA", (W, H), (1, 15, 30, 62))
    bg = Image.alpha_composite(bg.convert("RGBA"), glaze)
    # Add a subtle felt vignette while keeping the approved background texture.
    v = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(v)
    vd.ellipse((-260, -100, W + 260, H + 300), fill=170)
    v = v.filter(ImageFilter.GaussianBlur(120))
    shade = Image.new("RGBA", (W, H), (0, 8, 20, 105))
    shade.putalpha(Image.eval(v, lambda p: 105 - p * 50 // 170))
    return Image.alpha_composite(bg, shade)


def rounded_gradient(size, top_color, bottom_color, radius, border=None,
                     inner=None, shadow=True) -> Image.Image:
    w, h = size
    layer = Image.new("RGBA", (w + 24, h + 30), (0, 0, 0, 0))
    if shadow:
        s = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(s)
        sd.rounded_rectangle((12, 14, 12 + w, 14 + h), radius=radius,
                             fill=(0, 0, 0, 145))
        s = s.filter(ImageFilter.GaussianBlur(10))
        layer.alpha_composite(s)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    grad = Image.new("RGBA", (w, h))
    px = grad.load()
    for y in range(h):
        t = y / max(1, h - 1)
        col = tuple(round(top_color[i] * (1 - t) + bottom_color[i] * t) for i in range(3)) + (255,)
        for x in range(w):
            px[x, y] = col
    layer.alpha_composite(Image.composite(grad, Image.new("RGBA", (w, h)), mask), (12, 9))
    d = ImageDraw.Draw(layer)
    if border:
        d.rounded_rectangle((12, 9, 11 + w, 8 + h), radius=radius,
                            outline=border, width=2)
    if inner:
        d.rounded_rectangle((15, 12, 8 + w, 5 + h), radius=max(1, radius - 3),
                            outline=inner, width=1)
    return layer


def panel(img: Image.Image, box, radius=20, strong=False):
    x1, y1, x2, y2 = box
    tc = (24, 80, 116) if strong else (18, 65, 96)
    bc = (4, 29, 50) if strong else (5, 34, 57)
    art = rounded_gradient((x2 - x1, y2 - y1), tc, bc, radius,
                           border=(133, 132, 113, 225),
                           inner=(48, 91, 116, 230))
    img.alpha_composite(art, (x1 - 12, y1 - 9))


def gold_text(img: Image.Image, xy, text: str, size: int, anchor="mm",
              color=GOLD, stroke=0, font_obj=None):
    d = ImageDraw.Draw(img)
    f = font_obj or font(size)
    x, y = xy
    # V2 keeps only a restrained one-pixel separation shadow.  The previous
    # three-pixel black extrusion made normal labels look dirty and heavy.
    if size >= 30:
        d.text((x + 1, y + 1), text, font=f, anchor=anchor,
               fill=(3, 18, 29, 105))
    d.text((x, y), text, font=f, anchor=anchor, fill=color,
           stroke_width=min(stroke, 1), stroke_fill=(65, 46, 28, 115))


def plain_text(img: Image.Image, xy, text: str, size: int, anchor="mm",
               color=TEXT, medium=False):
    ImageDraw.Draw(img).text(xy, text, font=font(size, medium), anchor=anchor, fill=color)


def header(img: Image.Image, title: str, right: str | None = None):
    # V3 follows the exact visual grammar of the approved record header:
    # a brighter blue title block whose right edge drops into a smooth curved
    # gold divider, plus a dark navy reminder strip on the right.
    reference = Image.open(V7 / "record_header_exact.png").convert("RGB")
    h = round(72 * W / 750)
    scale = 4
    hw, hh = W * scale, h * scale
    work = Image.new("RGBA", (hw, hh), (0, 0, 0, 255))
    wd = ImageDraw.Draw(work)

    # Sample clean columns from the formal record asset so the blue values and
    # vertical texture stay tied to the approved page instead of an estimate.
    for yy in range(hh):
        sy = min(reference.height - 1, round(yy * (reference.height - 1) / max(1, hh - 1)))
        right_col = reference.getpixel((reference.width - 2, sy))
        wd.line((0, yy, hw, yy), fill=right_col + (255,))

    title_width = font(40).getbbox(title)[2]
    bottom_end = max(360, min(555, 145 + title_width + 58))
    top_end = bottom_end + 68
    curve = []
    for idx in range(41):
        t = idx / 40
        # Quadratic Bezier: a mostly diagonal upper edge that eases into the
        # rounded lower shoulder seen on the record-page title block.
        x = ((1 - t) ** 2 * top_end
             + 2 * (1 - t) * t * (bottom_end + 24)
             + t ** 2 * bottom_end)
        y = t * (h - 2)
        curve.append((round(x * scale), round(y * scale)))
    left_mask = Image.new("L", (hw, hh), 0)
    md = ImageDraw.Draw(left_mask)
    md.polygon([(0, 0), (round(top_end * scale), 0), *curve,
                (0, round((h - 2) * scale))], fill=255)
    left_grad = Image.new("RGBA", (hw, hh), (0, 0, 0, 0))
    lgd = ImageDraw.Draw(left_grad)
    for yy in range(hh):
        sy = min(reference.height - 1, round(yy * (reference.height - 1) / max(1, hh - 1)))
        left_col = reference.getpixel((5, sy))
        lgd.line((0, yy, hw, yy), fill=left_col + (255,))
    work.alpha_composite(Image.composite(left_grad, Image.new("RGBA", (hw, hh)), left_mask))
    wd = ImageDraw.Draw(work)
    wd.line(curve, fill=(205, 170, 117, 235), width=2 * scale, joint="curve")
    wd.line((0, (h - 2) * scale, hw, (h - 2) * scale),
            fill=(151, 127, 93, 210), width=2 * scale)
    work = work.resize((W, h), Image.Resampling.LANCZOS)
    img.alpha_composite(work, (0, 0))

    d = ImageDraw.Draw(img)
    cy = h // 2
    d.line((43, cy, 72, 24), fill=GOLD_HI, width=7)
    d.line((43, cy, 72, h - 24), fill=GOLD_HI, width=7)
    d.line((46, cy, 91, cy), fill=GOLD_HI, width=7)
    gold_text(img, (101, cy), title, 39, anchor="lm", color=GOLD_HI)

    # Keep the right strip intentionally empty.  This preserves the record
    # header's asymmetric blue composition without crowding long page titles.


def divider(img: Image.Image, y: int, title: str, x1=78, x2=863):
    d = ImageDraw.Draw(img)
    d.line((x1, y, x2, y), fill=(70, 92, 103, 180), width=1)
    cx = (x1 + x2) // 2
    tw = d.textbbox((0, 0), title, font=font(28))[2]
    d.rectangle((cx - tw // 2 - 38, y - 20, cx + tw // 2 + 38, y + 20), fill=(7, 37, 61, 255))
    d.polygon((cx - tw // 2 - 26, y, cx - tw // 2 - 20, y - 6,
               cx - tw // 2 - 14, y, cx - tw // 2 - 20, y + 6), outline=GOLD_LOW)
    d.polygon((cx + tw // 2 + 26, y, cx + tw // 2 + 20, y - 6,
               cx + tw // 2 + 14, y, cx + tw // 2 + 20, y + 6), outline=GOLD_LOW)
    gold_text(img, (cx, y), title, 28)


def button(img: Image.Image, box, text: str, icon: str | None = None,
           selected=False, size=30):
    x1, y1, x2, y2 = box
    if selected:
        # Selected tabs and primary actions stay in the same blue-gold system.
        # Bright gold/ivory lettering replaces the near-black V1 labels.
        art = rounded_gradient((x2 - x1, y2 - y1), (43, 105, 142),
                               (8, 46, 76), 16,
                               border=(211, 176, 124, 245),
                               inner=(92, 137, 155, 225))
    else:
        art = rounded_gradient((x2 - x1, y2 - y1), (24, 78, 112),
                               (5, 32, 54), 16,
                               border=(117, 121, 110, 235),
                               inner=(43, 88, 115, 230))
    img.alpha_composite(art, (x1 - 12, y1 - 9))
    c = GOLD_HI if selected else GOLD
    if icon:
        gold_text(img, (x1 + 45, (y1 + y2) // 2), safe_icon(icon), size + 6, color=c)
        gold_text(img, ((x1 + x2) // 2 + 15, (y1 + y2) // 2), text, size, color=c)
    else:
        gold_text(img, ((x1 + x2) // 2, (y1 + y2) // 2), text, size, color=c)


def field(img: Image.Image, y: int, label: str, placeholder: str,
          icon="◇", width=735):
    x1 = (W - width) // 2
    panel(img, (x1, y, x1 + width, y + 92), radius=16)
    gold_text(img, (x1 + 44, y + 46), safe_icon(icon), 31)
    gold_text(img, (x1 + 93, y + 46), label, 27, anchor="lm")
    ImageDraw.Draw(img).line((x1 + 215, y + 21, x1 + 215, y + 71), fill=(124, 110, 89), width=1)
    plain_text(img, (x1 + 245, y + 46), placeholder, 24, anchor="lm", color=SUBTEXT)


def toggle_row(img: Image.Image, y: int, label: str, note: str, on=True, icon="♠"):
    panel(img, (85, y, 856, y + 102), radius=17)
    gold_text(img, (135, y + 51), safe_icon(icon), 35)
    gold_text(img, (188, y + 39), label, 29, anchor="lm")
    plain_text(img, (188, y + 72), note, 18, anchor="lm", color=SUBTEXT)
    x = 748
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x, y + 29, x + 72, y + 73), radius=22,
                        fill=(35, 152, 162) if on else (52, 66, 77),
                        outline=(124, 151, 150), width=1)
    knob_x = x + 50 if on else x + 22
    d.ellipse((knob_x - 17, y + 34, knob_x + 17, y + 68), fill=(239, 218, 181))


def shield(img: Image.Image, center, height=150, opacity=255):
    im = Image.open(V7 / "shield_room_exact.png").convert("RGBA")
    w = round(height * im.width / im.height)
    im = im.resize((w, height), Image.Resampling.LANCZOS)
    if opacity != 255:
        im.putalpha(im.getchannel("A").point(lambda p: p * opacity // 255))
    img.alpha_composite(im, (round(center[0] - w / 2), round(center[1] - height / 2)))


def hero(img: Image.Image, title: str, subtitle: str, icon="♠"):
    panel(img, (70, 135, 871, 315), radius=24, strong=True)
    shield(img, (162, 225), 130)
    gold_text(img, (245, 202), title, 38, anchor="lm")
    plain_text(img, (247, 252), subtitle, 21, anchor="lm", color=SUBTEXT)
    gold_text(img, (815, 225), safe_icon(icon), 65, color=(205, 178, 132))


def pagination(img: Image.Image, y: int, page="1/3"):
    # Use the approved gift-page pagination artwork itself, including its five
    # controls and fine double-line border.  Only the dynamic page number is
    # overlaid in the blank center field.
    art = Image.open(V7 / "gift_pagination_exact.png").convert("RGBA")
    target_w = 890
    target_h = round(107 * target_w / 710)
    art = art.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (W - target_w) // 2
    img.alpha_composite(art, (x, y))
    gold_text(img, (W // 2, y + target_h // 2), page, 30, color=GOLD_HI)


def table(img: Image.Image, box, columns, rows, widths=None,
          highlight_first=False, font_size=22, row_height=92):
    x1, y1, x2, y2 = box
    panel(img, box, radius=20)
    header_h = 64
    d = ImageDraw.Draw(img)
    # Record-page style: a distinct embossed header followed by independent
    # compact rounded row cards, rather than one flat spreadsheet surface.
    header_art = rounded_gradient((x2 - x1, header_h), (31, 93, 132),
                                  (10, 49, 78), 16,
                                  border=(137, 134, 112, 225),
                                  inner=(54, 99, 124, 225), shadow=False)
    img.alpha_composite(header_art, (x1 - 12, y1 - 9))
    widths = widths or [1 / len(columns)] * len(columns)
    usable = x2 - x1 - 32
    starts = [x1 + 16]
    for w in widths[:-1]:
        starts.append(starts[-1] + usable * w)
    centers = [starts[i] + usable * widths[i] / 2 for i in range(len(columns))]
    for i, col in enumerate(columns):
        gold_text(img, (centers[i], y1 + 32), col, 24)
        if i:
            d.line((starts[i], y1 + 16, starts[i], y1 + 48), fill=(94, 96, 91), width=1)
    # Keep data rows compact and aligned at the top of the list viewport.  The
    # remaining lower area is intentional scroll/list breathing room rather
    # than stretching a few records into oversized cards.
    gap = 11
    available = y2 - y1 - header_h - 25
    row_h = min(row_height, (available - gap * max(0, len(rows) - 1)) / max(1, len(rows)))
    for ri, row in enumerate(rows):
        row_top = y1 + header_h + 12 + ri * (row_h + gap)
        card = rounded_gradient((x2 - x1 - 20, round(row_h)),
                                (24, 77, 109), (7, 39, 64), 14,
                                border=(105, 112, 103, 210),
                                inner=(42, 83, 108, 220), shadow=True)
        img.alpha_composite(card, (x1 - 2, round(row_top) - 9))
        cy = row_top + row_h / 2
        for ci, val in enumerate(row):
            color = TEXT
            if isinstance(val, tuple):
                val, color = val
            if highlight_first and ri < 3 and ci == 0:
                color = (248, 215, 150)
            plain_text(img, (centers[ci], cy), str(val), font_size, color=color)


def save(img: Image.Image, name: str):
    OUT.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT / name, quality=96)


def promo_page(title="游戏推广") -> Image.Image:
    img = base_page(); header(img, title, "推广规则")
    hero(img, "邀请好友，共享牌桌精彩", "专属二维码 · 自动绑定推广关系", "♣")
    panel(img, (105, 350, 836, 1450), radius=26, strong=True)
    divider(img, 397, "专属推广二维码", 140, 801)
    # Deterministic decorative QR placeholder.
    qr = Image.new("RGB", (354, 354), (238, 223, 193))
    qd = ImageDraw.Draw(qr)
    random.seed(81)
    n, cell, pad = 29, 10, 32
    for yy in range(n):
        for xx in range(n):
            if random.random() > .52:
                qd.rectangle((pad + xx * cell, pad + yy * cell,
                              pad + xx * cell + 8, pad + yy * cell + 8), fill=(4, 35, 57))
    for ox, oy in ((pad, pad), (pad + 22 * cell, pad), (pad, pad + 22 * cell)):
        qd.rectangle((ox, oy, ox + 66, oy + 66), fill=(4, 35, 57))
        qd.rectangle((ox + 10, oy + 10, ox + 56, oy + 56), fill=(238, 223, 193))
        qd.rectangle((ox + 22, oy + 22, ox + 44, oy + 44), fill=(4, 35, 57))
    qmask = Image.new("L", qr.size, 0); ImageDraw.Draw(qmask).rounded_rectangle((0, 0, 353, 353), 18, fill=255)
    qrr = Image.new("RGBA", qr.size); qrr.paste(qr, mask=qmask)
    img.alpha_composite(qrr, (294, 465))
    shield(img, (471, 642), 88)
    gold_text(img, (471, 864), "推广ID：157710", 28)
    field(img, 915, "推广链接", "系统自动生成推广链接", icon="♠", width=650)
    plain_text(img, (471, 1053), "扫码注册后，玩家将自动归属您的推广关系", 22, color=SUBTEXT)
    button(img, (245, 1120, 696, 1218), "分享二维码", "↗", size=31)
    button(img, (245, 1242, 696, 1340), "保存到相册", "▣", size=31)
    plain_text(img, (471, 1400), "推广数据与代理权限以服务器实际返回为准", 19, color=(165, 161, 152))
    return img


def money_flow_page() -> Image.Image:
    img = base_page(); header(img, "金币流向")
    hero(img, "每一笔金币变动清晰可查", "收入、支出与变动后余额统一展示", "¥")
    cards = ((73, 344, 330, 494, "收入", "+8,888", GREEN),
             (342, 344, 599, 494, "支出", "-3,260", RED),
             (611, 344, 868, 494, "当前余额", "25,680", GOLD_HI))
    for x1, y1, x2, y2, lab, value, col in cards:
        panel(img, (x1, y1, x2, y2), radius=18)
        plain_text(img, ((x1+x2)//2, y1+43), lab, 21, color=SUBTEXT)
        gold_text(img, ((x1+x2)//2, y1+98), value, 30, color=col)
    panel(img, (72, 518, 869, 602), radius=17)
    button(img, (88, 529, 271, 591), "全部", selected=True, size=25)
    gold_text(img, (385, 560), "收入", 25)
    gold_text(img, (535, 560), "支出", 25)
    gold_text(img, (731, 560), "近30天", 25)
    rows = [
        ("牌局结算", ("+9063", GREEN), "28,743", "09/05 11:36"),
        ("赠送金币", ("-100", RED), "19,680", "09/05 10:12"),
        ("充值到账", ("+500", GREEN), "19,780", "09/04 22:08"),
        ("牌局结算", ("-260", RED), "19,280", "09/04 19:45"),
        ("提现申请", ("-1000", RED), "19,540", "09/03 16:20"),
        ("收到赠送", ("+88", GREEN), "20,540", "09/02 09:18"),
    ]
    table(img, (72, 626, 869, 1450), ("说明", "收/支", "流向后", "时间"), rows,
          widths=(.31, .2, .21, .28), font_size=21)
    pagination(img, 1480, "1/5")
    return img


def settings_page() -> Image.Image:
    img = base_page(); header(img, "系统设置")
    hero(img, "游戏与账号安全设置", "声音开关、设备保护与密码管理", "⚙")
    divider(img, 355, "游戏设置")
    toggle_row(img, 385, "聊天语音", "控制牌桌中的语音播放", True, "◉")
    toggle_row(img, 502, "游戏音效", "控制按钮、发牌与结算音效", True, "♪")
    toggle_row(img, 619, "防盗号", "开启后限制其他设备使用密码登录", False, "♜")
    divider(img, 770, "账号与安全")
    ops = ((85, 804, 458, 920, "切换账号", "⇄"),
           (483, 804, 856, 920, "修改登录密码", "▣"),
           (85, 944, 458, 1060, "修改交易密码", "♢"),
           (483, 944, 856, 1060, "修改预留信息", "✎"))
    for x1,y1,x2,y2,t,ic in ops: button(img,(x1,y1,x2,y2),t,ic,size=27)
    panel(img, (85, 1090, 856, 1425), radius=22)
    shield(img, (180, 1257), 150, opacity=210)
    gold_text(img, (285, 1170), "安全提示", 30, anchor="lm")
    plain_text(img, (285, 1224), "请勿向任何人透露登录密码和交易密码", 21, anchor="lm", color=TEXT)
    plain_text(img, (285, 1265), "更换设备时建议先开启防盗号保护", 21, anchor="lm", color=TEXT)
    plain_text(img, (285, 1306), "涉及资金操作时请仔细核对账户信息", 21, anchor="lm", color=TEXT)
    return img


def password_page(title: str, init=False) -> Image.Image:
    img = base_page(); header(img, title, "账号安全")
    hero(img, "安全密码保护", "密码由6—12位字符组成，请妥善保管", "♜")
    panel(img, (85, 350, 856, 1160), radius=24, strong=True)
    divider(img, 398, title)
    y = 462
    if not init:
        field(img, y, "原有密码", "请输入目前使用的密码", "●", width=680); y += 126
    field(img, y, "新设密码", "请输入新密码", "◆", width=680); y += 126
    field(img, y, "确认密码", "请再次输入新密码", "◆", width=680); y += 146
    panel(img, (130, y, 811, y + 176), radius=16)
    gold_text(img, (170, y + 42), "!", 34)
    plain_text(img, (210, y + 38), "密码设置说明", 23, anchor="lm", color=TEXT)
    plain_text(img, (210, y + 82), "· 请勿使用过于简单或与账号相同的密码", 19, anchor="lm", color=SUBTEXT)
    plain_text(img, (210, y + 120), "· 两次输入必须保持一致", 19, anchor="lm", color=SUBTEXT)
    button(img, (196, 1210, 745, 1314), "确认提交", "✓", selected=True, size=33)
    shield(img, (471, 1470), 140, opacity=120)
    return img


def reserved_info_page() -> Image.Image:
    img = base_page(); header(img, "修改预留信息", "联系客服")
    hero(img, "实名认证与提现预留信息", "请确保姓名、银行及卡号准确无误", "✎")
    panel(img, (72, 345, 869, 1435), radius=24, strong=True)
    divider(img, 395, "预留信息")
    ys = 445
    for label, holder, ic in (("姓名","请输入姓名","●"),("银行名称","请选择银行","▣"),
                              ("银行卡号","请输入卡号","▭"),("交易密码","请输入交易密码","◆"),
                              ("确认密码","请确认交易密码","◆")):
        field(img, ys, label, holder, ic, width=700); ys += 112
    plain_text(img, (128, 1045), "1. 请填写真实姓名，保存后姓名不可修改。", 20, anchor="lm", color=SUBTEXT)
    plain_text(img, (128, 1084), "2. 仅可使用实名对应名下的银行卡。", 20, anchor="lm", color=SUBTEXT)
    plain_text(img, (128, 1123), "3. 交易密码需与登录密码不同，请牢记。", 20, anchor="lm", color=SUBTEXT)
    button(img, (196, 1190, 745, 1294), "提交预留信息", "✓", selected=True, size=32)
    return img


def agent_home() -> Image.Image:
    img=base_page();header(img,"我的代理","代理规则")
    panel(img,(70,135,871,355),radius=25,strong=True)
    shield(img,(180,245),150)
    gold_text(img,(300,188),"红利余额",30,anchor="lm")
    gold_text(img,(300,248),"8,888.00",48,anchor="lm",color=GOLD_HI)
    plain_text(img,(300,302),"实时统计 · 可提取金额以服务器为准",19,anchor="lm",color=SUBTEXT)
    button(img,(660,222,830,296),"提取红利",size=24)
    panel(img,(70,380,871,548),radius=20)
    for x,lab,val in ((205,"累计总红利","26,800"),(470,"累计总提取","17,912"),(735,"今日红利","386")):
        plain_text(img,(x,425),lab,20,color=SUBTEXT);gold_text(img,(x,482),val,31)
    divider(img,585,"代理管理")
    ops=((80,620,348,730,"我的玩家","♟"),(365,620,633,730,"我的业绩","♜"),(650,620,861,730,"我的盟主","♛"),
         (80,755,348,865,"提取记录","¥"),(365,755,633,865,"游戏推广","♣"),(650,755,861,865,"总业绩","◆"))
    for x1,y1,x2,y2,t,ic in ops:button(img,(x1,y1,x2,y2),t,ic,size=24)
    panel(img,(70,900,871,1195),radius=22,strong=True)
    divider(img,950,"代理数据")
    items=((180,"上级ID","659348"),(390,"我的ID","157710"),(600,"下级玩家","86"),(790,"今日新增","5"))
    for x,l,v in items:
        plain_text(img,(x,1010),l,19,color=SUBTEXT);gold_text(img,(x,1060),v,26)
    ImageDraw.Draw(img).line((110,1104,830,1104),fill=(69,88,97),width=1)
    for x,l,v in ((220,"今日红利","386"),(470,"昨日红利","528"),(720,"前日红利","419")):
        plain_text(img,(x,1143),l,19,color=SUBTEXT);gold_text(img,(x,1175),v,24)
    shield(img,(471,1375),155,opacity=115)
    return img


def agent_list_page(title, summary, columns, rows, tabs=None) -> Image.Image:
    img=base_page();header(img,title)
    y=140
    if tabs:
        panel(img,(90,y,851,y+75),radius=17)
        tw=(761)//len(tabs)
        for i,t in enumerate(tabs):
            if i==0:button(img,(98+i*tw,y+7,98+(i+1)*tw-8,y+68),t,selected=True,size=23)
            else:gold_text(img,(98+i*tw+tw/2,y+38),t,23)
        y+=100
    panel(img,(90,y,851,y+155),radius=21,strong=True)
    for i,(lab,val) in enumerate(summary):
        x=90+(i+.5)*761/len(summary)
        plain_text(img,(x,y+43),lab,20,color=SUBTEXT);gold_text(img,(x,y+98),val,29)
    y+=180
    bottom=1452
    table(img,(70,y,871,bottom),columns,rows,font_size=20)
    pagination(img,1480,"1/3")
    return img


def agent_popup(title, lines, action="确定", dual=True) -> Image.Image:
    img=agent_home().filter(ImageFilter.GaussianBlur(2))
    img=Image.alpha_composite(img,Image.new("RGBA",(W,H),(0,8,17,150)))
    panel(img,(130,510,811,1130),radius=30,strong=True)
    gold_text(img,(471,585),title,38)
    ImageDraw.Draw(img).line((185,635,756,635),fill=(120,107,88),width=1)
    shield(img,(471,735),150,opacity=225)
    y=840
    for line in lines:
        plain_text(img,(471,y),line,24,color=TEXT);y+=48
    if dual:
        button(img,(185,1010,450,1092),"取消",size=28)
        button(img,(492,1010,756,1092),action,selected=True,size=28)
    else:
        button(img,(290,1010,652,1092),action,selected=True,size=28)
    return img


def ranking_page(kind: str) -> Image.Image:
    img=base_page();header(img,"排行榜","活动规则")
    panel(img,(70,135,871,370),radius=26,strong=True)
    shield(img,(170,252),165)
    gold_text(img,(285,182),"8L 荣耀榜",38,anchor="lm")
    plain_text(img,(287,230),"活动时间  09/01 00:00 — 09/30 23:59",19,anchor="lm",color=SUBTEXT)
    plain_text(img,(287,270),"我的排名  18   当前奖励  500金币",22,anchor="lm",color=TEXT)
    button(img,(675,278,830,348),"领取奖励",size=23)
    tabs=("玩家手数榜","玩家赢分榜","代理红利榜")
    panel(img,(70,392,871,478),radius=17)
    for i,t in enumerate(tabs):
        x1=79+i*261;x2=x1+252
        if t==kind:button(img,(x1,402,x2,468),t,selected=True,size=23)
        else:gold_text(img,((x1+x2)//2,435),t,22)
    y=500
    if kind=="玩家手数榜":
        panel(img,(88,y,853,y+84),radius=16)
        for i,t in enumerate(("1皮","2皮","5皮","10皮","20皮")):
            if i==0:button(img,(98+i*148,y+10,225+i*148,y+74),t,selected=True,size=22)
            else:gold_text(img,(161+i*148,y+42),t,22)
        y+=108
        cols=("名次","玩家信息","手数","奖励")
        rows=(("1","小小羊\nID:659348","12,680","2,000"),("2","欢乐马123\nID:531344","10,820","1,200"),
              ("3","两棵树\nID:157710","9,630","800"),("4","速撸家\nID:182771","8,260","500"),("5","文化人\nID:379731","7,950","300"))
    elif kind=="玩家赢分榜":
        cols=("名次","玩家信息","赢分","奖金")
        rows=(("1","欢乐马123\nID:531344","+90,630","3,000"),("2","两棵树\nID:157710","+82,400","2,000"),
              ("3","小小羊\nID:659348","+75,260","1,000"),("4","速撸家\nID:182771","+61,800","500"),("5","文化人\nID:379731","+58,950","300"))
    else:
        cols=("名次","代理信息","红利","奖励")
        rows=(("1","两棵树\nID:157710","18,630","3,000"),("2","欢乐马123\nID:531344","15,200","2,000"),
              ("3","小小羊\nID:659348","12,860","1,000"),("4","速撸家\nID:182771","9,800","500"),("5","文化人\nID:379731","8,950","300"))
    table(img,(70,y,871,1450),cols,rows,widths=(.14,.42,.22,.22),highlight_first=True,font_size=20)
    pagination(img,1480,"1/10")
    return img


def contact_sheet(names, output, cols=3, thumb_w=300):
    thumbs=[]
    for name in names:
        im=Image.open(OUT/name).convert("RGB")
        th=round(im.height*thumb_w/im.width)
        thumbs.append((name,im.resize((thumb_w,th),Image.Resampling.LANCZOS)))
    rows=math.ceil(len(thumbs)/cols); cell_h=round(1672*thumb_w/941)+54
    sheet=Image.new("RGB",(cols*(thumb_w+24)+24,rows*cell_h+24),(39,39,39))
    d=ImageDraw.Draw(sheet)
    for i,(name,im) in enumerate(thumbs):
        x=24+(i%cols)*(thumb_w+24);y=24+(i//cols)*cell_h
        sheet.paste(im,(x,y));d.text((x+thumb_w//2,y+im.height+24),Path(name).stem,
                                    font=font(19),anchor="mm",fill=(232,220,199))
    sheet.save(OUT/output)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    outputs=[]
    pages=[
        ("01-游戏推广.png",promo_page()),
        ("02-金币流向.png",money_flow_page()),
        ("03-系统设置.png",settings_page()),
        ("04-修改登录密码.png",password_page("修改登录密码")),
        ("05-修改交易密码.png",password_page("修改交易密码")),
        ("06-初始化交易密码.png",password_page("初始化交易密码",True)),
        ("07-修改预留信息.png",reserved_info_page()),
        ("08-代理首页.png",agent_home()),
        ("09-代理-我的玩家.png",agent_list_page("我的玩家",(("下级玩家数量","86"),("今日新增","5")),
          ("ID","昵称","手数","授权"),(("659348","小小羊","368","添加代理"),("598666","打火机拿开些","255","已授权"),("531344","欢乐马123","186","添加代理"),("182771","速撸家","95","已授权"),("379731","文化人","72","添加代理")))),
        ("10-代理-我的业绩.png",agent_list_page("我的业绩",(("总人数","86"),("今日总贡献","3,680"),("累计总贡献","126,900")),
          ("玩家信息","今日贡献","累计贡献"),(("小小羊\nID:659348","680","16,800"),("欢乐马123\nID:531344","596","14,260"),("速撸家\nID:182771","485","12,900"),("文化人\nID:379731","372","10,850"),("两棵树\nID:157710","328","9,600")),("我的玩家","二级代理","三级代理"))),
        ("11-代理-我的盟主.png",agent_list_page("我的盟主",(("今日贡献","1,280"),("累计贡献","39,600")),
          ("ID","昵称","玩家数","比例"),(("157710","两棵树","28","20%"),("531344","欢乐马123","22","18%"),("659348","小小羊","16","15%"),("182771","速撸家","12","12%"),("379731","文化人","8","10%")))),
        ("12-代理-总业绩.png",agent_list_page("总业绩",(("昨日所有下级玩家业绩","12,680"),("所占比例","18.50%")),
          ("ID","昵称","授权","操作"),(("157710","两棵树","已授权","删除"),("531344","欢乐马123","已授权","删除"),("659348","小小羊","未授权","授权"),("182771","速撸家","已授权","删除"),("379731","文化人","未授权","授权")))),
        ("13-代理-红利提取记录.png",agent_list_page("红利提取记录",(("累计提取","17,912"),("可提取红利","8,888")),
          ("时间","金额","状态"),(("09/05 11:36","1,000",("已完成",GREEN)),("09/03 18:22","2,000",("已完成",GREEN)),("09/01 09:15","500",("处理中",CYAN)),("08/28 14:02","800",("已完成",GREEN)),("08/20 20:18","1,200",("已完成",GREEN))))),
        ("14-代理-奖池提取记录.png",agent_list_page("奖池红利提取记录",(("奖池收益余额","3,680"),("累计提取","12,900")),
          ("时间","提取金额","状态"),(("09/05 08:20","680",("已完成",GREEN)),("09/02 12:10","1,000",("已完成",GREEN)),("08/30 21:18","500",("审核中",CYAN)),("08/24 10:05","800",("已完成",GREEN)),("08/17 16:42","1,200",("已完成",GREEN))))),
        ("15-代理-推广二维码.png",promo_page("代理推广")),
        ("16-代理-盟主收益.png",agent_popup("盟主收益",("今日收益：  386","累计收益：  18,680"),"知道了",False)),
        ("17-代理-奖池收益.png",agent_popup("奖池收益",("今日收益：  268","累计收益：  12,900","累计提取：  9,220","奖池余额：  3,680"),"提取收益",True)),
        ("18-代理-大区收益.png",agent_popup("大区收益",("今日收益：  568","累计收益：  26,800"),"知道了",False)),
        ("19-代理-我的分红.png",agent_popup("我的分红",("当前所占比例：  18.50%",),"提取分红",True)),
        ("20-代理-添加代理确认.png",agent_popup("添加代理",("是否确认将以下玩家添加为代理？","小小羊  [659348]"),"确认添加",True)),
        ("21-代理-删除授权确认.png",agent_popup("删除授权",("是否确认删除用户：两棵树？","ID：157710"),"确认删除",True)),
        ("22-代理-提取红利确认.png",agent_popup("提取红利",("是否确认提取所有红利？","可提取金额：8,888"),"确认提取",True)),
        ("23-代理-比例设置.png",agent_popup("比例设置",("盟主：小小羊  [659348]","请输入盟主分成比例","注意：盟主分成比例只能提升不能降低"),"确认设置",True)),
        ("24-排行榜-玩家手数榜.png",ranking_page("玩家手数榜")),
        ("25-排行榜-玩家赢分榜.png",ranking_page("玩家赢分榜")),
        ("26-排行榜-代理红利榜.png",ranking_page("代理红利榜")),
    ]
    for name,img in pages:
        save(img,name);outputs.append(name)
    contact_sheet(outputs[:7],"00-主功能与设置总览.png",cols=3)
    contact_sheet(outputs[7:23],"00-代理全套总览.png",cols=4,thumb_w=230)
    contact_sheet(outputs[23:],"00-排行榜三页总览.png",cols=3)
    print(f"已生成 {len(outputs)} 张页面效果图和3张总览：{OUT}")


if __name__ == "__main__":
    main()
