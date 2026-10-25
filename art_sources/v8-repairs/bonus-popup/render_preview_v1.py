from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "art_sources/v8-repairs/bonus-popup/qa"
OUT.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size, index=1 if bold else 0)
    return ImageFont.load_default()


def fit_asset(path: Path, size: tuple[int, int]) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    return image.resize(size, Image.Resampling.LANCZOS)


def nine_slice(path: Path, size: tuple[int, int], margins: tuple[int, int, int, int]) -> Image.Image:
    """Scale a panel while keeping its four rounded corners pixel-proportional."""
    source = Image.open(path).convert("RGBA")
    tw, th = size
    left, top, right, bottom = margins
    sw, sh = source.size
    if tw < left + right or th < top + bottom:
        raise ValueError(f"target {size} is smaller than protected corners {margins} for {path}")
    x = [0, left, sw - right, sw]
    y = [0, top, sh - bottom, sh]
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for row in range(3):
        for col in range(3):
            crop = source.crop((x[col], y[row], x[col + 1], y[row + 1]))
            dest_w = (left, tw - left - right, right)[col]
            dest_h = (top, th - top - bottom, bottom)[row]
            if crop.size != (dest_w, dest_h):
                crop = crop.resize((dest_w, dest_h), Image.Resampling.LANCZOS)
            out.alpha_composite(crop, ((0, left, tw - right)[col], (0, top, th - bottom)[row]))
    return out


def center_text(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fnt, fill, stroke=0, stroke_fill=None):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    x = x0 + (x1 - x0 - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = y0 + (y1 - y0 - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.text((x, y), text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)


def paste_scaled(canvas: Image.Image, source: Path, box: tuple[int, int, int, int]):
    x, y, w, h = box
    canvas.alpha_composite(fit_asset(source, (w, h)), (x, y))


def paste_panel(canvas: Image.Image, source: Path, box: tuple[int, int, int, int], margins: tuple[int, int, int, int]):
    x, y, w, h = box
    canvas.alpha_composite(nine_slice(source, (w, h), margins), (x, y))


def build(dialog: bool = False) -> Image.Image:
    # Match panelHongli's actual 750-wide logical canvas.
    W, H = 750, 1334
    bg = Image.open(ROOT / "assets/V7/lobby_scene_long_v8.png").convert("RGBA")
    bg = bg.resize((W, int(bg.height * W / bg.width)), Image.Resampling.LANCZOS)
    bg = bg.crop((0, 0, W, H))
    overlay = Image.new("RGBA", (W, H), (0, 20, 55, 92))
    bg = Image.alpha_composite(bg, overlay)
    canvas = bg.copy()
    draw = ImageDraw.Draw(canvas)
    gold = (255, 231, 176, 255)
    ivory = (246, 246, 242, 255)
    cyan = (137, 238, 255, 255)
    muted = (205, 225, 239, 255)
    blue = ROOT / "assets/V7"

    # Fixed V8-new header.
    draw.rectangle((0, 0, W, 70), fill=(3, 42, 88, 165))
    draw.line((0, 70, W, 70), fill=gold, width=2)
    draw.text((28, 3), "‹", font=font(63), fill=gold)
    draw.text((83, 17), "我的红利", font=font(32, True), fill=gold)

    # Summary block: today's, yesterday's and cumulative bonus.
    paste_panel(canvas, blue / "agent_v8_summary.png", (56, 94, 638, 105), (30, 30, 30, 30))
    labels = ["今日红利", "昨日红利", "累计红利"]
    values = ["386", "528", "26,800"]
    for i, (label, value) in enumerate(zip(labels, values)):
        x0 = 66 + i * 208
        x1 = x0 + 194
        center_text(draw, (x0, 107, x1, 142), label, font(22, True), cyan)
        center_text(draw, (x0, 144, x1, 188), value, font(31, True), gold)
        if i < 2:
            draw.line((x1 + 5, 114, x1 + 5, 182), fill=(104, 193, 229, 150), width=1)

    # Claim action line.
    paste_panel(canvas, blue / "agent_v8_table_base.png", (18, 202, 420, 58), (21, 21, 21, 21))
    draw.text((26, 218), "未领取红利：", font=font(24, True), fill=gold)
    draw.text((170, 218), "8,888", font=font(26, True), fill=(255, 242, 93, 255))
    paste_scaled(canvas, blue / "agent_v8_home_withdraw.png", (454, 201, 130, 58))
    paste_scaled(canvas, blue / "agent_v8_home_history.png", (600, 199, 130, 59))

    # List panel and table header.
    paste_panel(canvas, blue / "agent_v8_list.png", (56, 272, 638, 792), (48, 48, 48, 48))
    paste_panel(canvas, blue / "agent_v8_table_base.png", (60, 286, 630, 58), (28, 22, 28, 22))
    columns = ["玩家", "类型", "金额", "时间"]
    col_x = [63, 220, 378, 523]
    col_w = [145, 145, 130, 150]
    for x, w, label in zip(col_x, col_w, columns):
        center_text(draw, (x, 292, x + w, 337), label, font(21, True), ivory)
    draw.line((212, 298, 212, 333), fill=(166, 220, 242, 180), width=1)
    draw.line((370, 298, 370, 333), fill=(166, 220, 242, 180), width=1)
    draw.line((515, 298, 515, 333), fill=(166, 220, 242, 180), width=1)

    rows = [
        ("659348", "直属红利", "386", "10/25 14:20"),
        ("157710", "玩家红利", "528", "10/25 11:05"),
        ("482913", "下级红利", "1,200", "10/24 20:18"),
        ("320086", "直属红利", "800", "10/24 09:42"),
    ]
    for i, row in enumerate(rows):
        y = 350 + i * 75
        paste_panel(canvas, blue / "agent_v8_row.png", (64, y, 622, 61), (26, 24, 26, 24))
        for x, w, value in zip(col_x, col_w, row):
            center_text(draw, (x, y + 5, x + w, y + 55), value, font(18), ivory)

    draw.text((253, 1008), "数据由服务端实时返回", font=font(18), fill=muted)

    # Pagination uses the current V8-new circular controls.
    paste_panel(canvas, blue / "agent_v8_pager.png", (21, 1120, 708, 82), (30, 30, 30, 30))
    paste_scaled(canvas, blue / "agent_v8_page_first.png", (72, 1132, 50, 50))
    paste_scaled(canvas, blue / "agent_v8_page_prev.png", (183, 1132, 50, 50))
    paste_panel(canvas, blue / "agent_v8_page_value.png", (279, 1131, 190, 58), (28, 28, 28, 28))
    paste_scaled(canvas, blue / "agent_v8_page_next.png", (517, 1132, 50, 50))
    paste_scaled(canvas, blue / "agent_v8_page_last.png", (628, 1132, 50, 50))
    center_text(draw, (279, 1131, 469, 1189), "1 / 3", font(24, True), ivory)

    if dialog:
        veil = Image.new("RGBA", (W, H), (0, 12, 30, 126))
        canvas = Image.alpha_composite(canvas, veil)
        paste_panel(canvas, blue / "agent_v8_popup.png", (100, 362, 550, 430), (48, 48, 48, 48))
        draw = ImageDraw.Draw(canvas)
        center_text(draw, (125, 390, 625, 450), "确认提取", font(32, True), gold)
        draw.line((145, 468, 605, 468), fill=(205, 221, 229, 210), width=1)
        center_text(draw, (130, 500, 620, 552), "是否确认提取所有红利？", font(23), ivory)
        center_text(draw, (130, 557, 620, 605), "可提取金额：8,888", font(21), ivory)
        paste_scaled(canvas, blue / "agent_v8_button_cancel.png", (145, 650, 190, 61))
        paste_scaled(canvas, blue / "agent_v8_button_withdraw.png", (415, 649, 190, 67))

    return canvas


build().save(OUT / "my-hongli-v4.png")
build(True).save(OUT / "my-hongli-v4-withdraw-dialog.png")
print(OUT / "my-hongli-v4.png")
print(OUT / "my-hongli-v4-withdraw-dialog.png")
