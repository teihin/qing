#!/usr/bin/env python3
"""Rebuild panelRecordInfo art in the established restrained Qin black-gold style."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
import random


ROOT = Path(__file__).resolve().parents[1]
DETAIL = ROOT / "assets" / "ImagesLuck" / "战绩详情"
PAIPU = ROOT / "assets" / "ImagesLuck" / "游戏内" / "牌普"
ART = ROOT / "art_sources" / "record_info"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
S = 4
GOLD_HI = (255, 239, 183, 255)
GOLD = (219, 164, 72, 255)
GOLD_DARK = (82, 47, 15, 255)
IVORY = (242, 226, 188, 255)
RED = (137, 38, 20, 255)


def ft(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * S)


def center(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str,
           font: ImageFont.FreeTypeFont, fill=IVORY, stroke=1) -> None:
    bb = draw.textbbox((0, 0), text, font=font, stroke_width=stroke * S)
    x = (box[0] + box[2] - (bb[2] - bb[0])) / 2 - bb[0]
    y = (box[1] + box[3] - (bb[3] - bb[1])) / 2 - bb[1]
    stroke_fill = 255 if isinstance(fill, int) else (45, 24, 7, 255)
    draw.text((round(x), round(y)), text, font=font, fill=fill,
              stroke_width=stroke * S, stroke_fill=stroke_fill)


def meta_trim(path: Path) -> tuple[int, int, int, int]:
    data = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    sub = next(iter(data["subMetas"].values()))
    return int(sub["trimX"]), int(sub["trimY"]), int(sub["width"]), int(sub["height"])


def save(path: Path, image: Image.Image) -> Path:
    image = image.convert("RGBA")
    x, y, w, h = meta_trim(path)
    alpha = image.getchannel("A")
    clipped = Image.new("L", image.size, 0)
    clipped.paste(alpha.crop((x, y, x + w, y + h)), (x, y))
    image.putalpha(clipped)
    pix = image.load()
    for px, py in ((x, y), (x+w-1, y), (x, y+h-1), (x+w-1, y+h-1)):
        r, g, b, a = pix[px, py]
        if a < 8:
            pix[px, py] = (110, 68, 24, 8)
    image.save(path, optimize=True)
    return path


def canvas(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", (size[0] * S, size[1] * S), (0, 0, 0, 0))


def obsidian_texture(size: tuple[int, int], alpha=255) -> Image.Image:
    random.seed(size[0] * 1009 + size[1])
    im = Image.new("RGBA", (size[0] * S, size[1] * S), (9, 9, 8, alpha))
    p = im.load()
    for y in range(im.height):
        for x in range(im.width):
            n = random.randrange(-5, 6)
            v = max(3, min(20, 10 + n + int(4 * y / max(1, im.height))))
            p[x, y] = (v + 2, v + 1, v, alpha)
    return im.filter(ImageFilter.GaussianBlur(0.35 * S))


def corner_key(d: ImageDraw.ImageDraw, x: int, y: int, sx: int, sy: int, span=22) -> None:
    x *= S; y *= S; span *= S
    pts = [(x, y + sy*span), (x, y), (x + sx*span, y),
           (x + sx*span, y + sy*5*S), (x + sx*7*S, y + sy*5*S),
           (x + sx*7*S, y + sy*14*S), (x + sx*13*S, y + sy*14*S)]
    d.line(pts, fill=(202, 146, 61, 230), width=2*S, joint="curve")


def lacquer_panel(size: tuple[int, int], radius=10, inset=2) -> Image.Image:
    im = canvas(size)
    d = ImageDraw.Draw(im)
    b = (inset*S, inset*S, (size[0]-inset)*S-1, (size[1]-inset)*S-1)
    panel = obsidian_texture(size, 248)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(b, radius=radius*S, fill=255)
    panel.putalpha(mask)
    im.alpha_composite(panel)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(b, radius=radius*S, outline=(55, 31, 10, 255), width=5*S)
    d.rounded_rectangle((b[0]+2*S, b[1]+2*S, b[2]-2*S, b[3]-2*S), radius=max(1,radius-2)*S, outline=GOLD, width=2*S)
    d.rounded_rectangle((b[0]+3*S, b[1]+3*S, b[2]-3*S, b[3]-3*S),
                        radius=max(1, radius-3)*S, outline=(236, 188, 102, 210), width=S)
    d.line((b[0]+12*S, b[1]+5*S, b[2]-12*S, b[1]+5*S), fill=(255, 235, 176, 80), width=S)
    corner_key(d, inset+7, inset+7, 1, 1, min(22, size[0]//5))
    corner_key(d, size[0]-inset-7, inset+7, -1, 1, min(22, size[0]//5))
    corner_key(d, inset+7, size[1]-inset-7, 1, -1, min(22, size[0]//5))
    corner_key(d, size[0]-inset-7, size[1]-inset-7, -1, -1, min(22, size[0]//5))
    return im


def label(path: Path, text: str, size: tuple[int, int], font_size: int) -> Path:
    im = canvas(size)
    glow = Image.new("L", im.size, 0)
    gd = ImageDraw.Draw(glow)
    center(gd, (0, 0, im.width, im.height), text, ft(font_size), fill=255, stroke=1)
    aura = Image.new("RGBA", im.size, (196, 120, 31, 0))
    aura.putalpha(glow.filter(ImageFilter.GaussianBlur(2*S)).point(lambda p: round(p*.22)))
    im.alpha_composite(aura)
    center(ImageDraw.Draw(im), (0, 0, im.width, im.height), text, ft(font_size), GOLD_HI, 1)
    return save(path, im.resize(size, Image.Resampling.LANCZOS))


def badge(path: Path, text: str) -> Path:
    size = Image.open(path).size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = size[0]*S//2, size[1]*S//2
    if text == "土豪":
        d.ellipse((cx-28*S,cy-28*S,cx+28*S,cy+28*S),fill=(11,10,8,255),outline=GOLD,width=3*S)
        d.ellipse((cx-23*S,cy-23*S,cx+23*S,cy+23*S),outline=(239,202,123,220),width=S)
    elif text == "MVP":
        d.polygon([(cx,3*S),(cx+13*S,13*S),(cx+29*S,17*S),(cx+21*S,31*S),(cx+23*S,52*S),(cx,45*S),(cx-23*S,52*S),(cx-21*S,31*S),(cx-29*S,17*S),(cx-13*S,13*S)],fill=(31,20,10,255),outline=GOLD)
    elif text == "大鱼":
        d.ellipse((cx-29*S,cy-25*S,cx+29*S,cy+25*S),fill=(9,15,14,255),outline=GOLD,width=3*S)
        d.arc((cx-17*S,cy-11*S,cx+15*S,cy+13*S),195,520,fill=(220,171,78,255),width=2*S)
    else:
        d.rounded_rectangle((cx-30*S,4*S,cx+30*S,(size[1]-4)*S),radius=5*S,fill=(18,13,8,255),outline=GOLD,width=2*S)
        for yy in (9, size[1]-9): d.line((cx-25*S,yy*S,cx+25*S,yy*S),fill=(239,202,123,170),width=S)
    center(d, (0, 0, size[0]*S, size[1]*S), text, ft(20), GOLD_HI, 1)
    return save(path, im.resize(size, Image.Resampling.LANCZOS))


def medal(path: Path, number: str, tone: tuple[int, int, int, int]) -> Path:
    size = Image.open(path).size
    im = canvas(size)
    d = ImageDraw.Draw(im)
    cx, cy = size[0]*S//2, size[1]*S//2
    r = min(size)*S//2 - 4*S
    d.polygon(((cx-12*S, cy+12*S), (cx-4*S, cy+27*S), (cx, cy+17*S),
               (cx+5*S, cy+27*S), (cx+13*S, cy+12*S)), fill=(91, 47, 17, 255))
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(10, 9, 7, 255), outline=GOLD_DARK, width=4*S)
    d.ellipse((cx-r+4*S, cy-r+4*S, cx+r-4*S, cy+r-4*S), outline=tone, width=2*S)
    center(d, (cx-r, cy-r, cx+r, cy+r), number, ft(29), tone, 1)
    return save(path, im.resize(size, Image.Resampling.LANCZOS))


def tab(path: Path, text: str, selected: bool) -> Path:
    size = Image.open(path).size
    im = lacquer_panel(size, radius=5, inset=2)
    d = ImageDraw.Draw(im)
    if selected:
        d.polygon(((8*S,8*S),((size[0]-8)*S,8*S),((size[0]-16)*S,(size[1]-8)*S),(16*S,(size[1]-8)*S)),
                  fill=(78,45,15,210), outline=GOLD)
        d.line((35*S,(size[1]-7)*S,(size[0]-35)*S,(size[1]-7)*S),fill=GOLD_HI,width=2*S)
    center(d, (0, 0, size[0]*S, size[1]*S), text, ft(24), GOLD_HI if selected else IVORY, 1)
    return save(path, im.resize(size, Image.Resampling.LANCZOS))


def compact_state(path: Path, text: str, size: tuple[int, int]) -> Path:
    """Small semantic state badge: clean lacquer, thin gold edge, unchanged text."""
    im = canvas(size)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((S, S, size[0] * S - S - 1, size[1] * S - S - 1),
                        radius=5 * S, fill=(11, 10, 8, 250),
                        outline=(92, 55, 18, 255), width=2 * S)
    d.rounded_rectangle((3 * S, 3 * S, (size[0] - 3) * S - 1, (size[1] - 3) * S - 1),
                        radius=3 * S, outline=(221, 170, 77, 230), width=S)
    center(d, (0, 0, size[0] * S, size[1] * S), text,
           ft(15 if size[1] < 30 else 18), GOLD_HI, 1)
    return save(path, im.resize(size, Image.Resampling.LANCZOS))


def clean_checkerboard(path: Path, size: tuple[int, int]) -> Image.Image:
    """Remove the preview checkerboard around an otherwise finished UI frame."""
    im = Image.open(path).convert("RGB").resize(size, Image.Resampling.LANCZOS)
    out = im.convert("RGBA")
    pix = out.load()
    for yy in range(out.height):
        for xx in range(out.width):
            r, g, b, _ = pix[xx, yy]
            neutral = max(r, g, b) - min(r, g, b) < 12
            alpha = 0 if neutral and min(r, g, b) > 185 else 255
            pix[xx, yy] = (r, g, b, alpha)
    return out


def paste_center(base: Image.Image, item: Image.Image, center_xy: tuple[float, float], size: tuple[int, int]) -> None:
    item = item.convert("RGBA").resize(size, Image.Resampling.LANCZOS)
    x = round(center_xy[0] - size[0] / 2)
    y = round(center_xy[1] - size[1] / 2)
    base.alpha_composite(item, (x, y))


def build_runtime_preview(out_path: Path) -> None:
    """Compose the unchanged Prefab layout from the actual runtime PNG files."""
    preview = Image.open(ROOT / "assets" / "ImagesLuck" / "公用" / "背景.png").convert("RGBA")
    d = ImageDraw.Draw(preview)
    warm = (232, 188, 103, 255)
    ivory = (239, 222, 181, 255)
    font20 = ImageFont.truetype(str(FONT), 20)
    font18 = ImageFont.truetype(str(FONT), 18)
    font16 = ImageFont.truetype(str(FONT), 16)

    paste_center(preview, Image.open(ROOT / "assets" / "ImagesLuck" / "公用1" / "顶部.png"), (375, 50), (750, 100))
    paste_center(preview, Image.open(DETAIL / "战局详情.png"), (375, 48), (129, 40))
    paste_center(preview, Image.open(ROOT / "assets" / "ImagesLuck" / "公用" / "皇冠框.png"), (375, 282), (664, 367))

    avatar_frame = Image.open(ROOT / "assets" / "ImagesLuck" / "公用" / "头像2.png")
    avatar = Image.open(ROOT / "assets" / "resources" / "other" / "默认头像.png")
    honor_data = (
        (155, 274, "土豪.png", "秦风玩家"),
        (292, 331, "MVP.png", "玄甲将军"),
        (458, 331, "大鱼.png", "关中客"),
        (593, 274, "劳模.png", "咸阳士"),
    )
    for x, y, badge_name, player in honor_data:
        paste_center(preview, avatar_frame, (x, y), (126, 115))
        paste_center(preview, avatar, (x, y + 4), (96, 96))
        paste_center(preview, Image.open(DETAIL / badge_name), (x, y + 43), (120, 59))
        bb = d.textbbox((0, 0), player, font=font18)
        d.text((x - (bb[2] - bb[0]) / 2, y + 66), player, font=font18, fill=warm)

    paste_center(preview, Image.open(DETAIL / "时间框.png"), (375, 464), (561, 78))
    d.text((318, 446), "秦·103685", font=font20, fill=warm)
    d.text((305, 474), "07-22 18:46  至  19:11", font=font16, fill=ivory)
    paste_center(preview, Image.open(ROOT / "assets" / "ImagesLuck" / "公用" / "表格标题头.png"), (375, 556), (750, 96))
    d.text((130, 548), "奖池 8888", font=font18, fill=warm)
    d.text((323, 548), "总手数 25", font=font18, fill=warm)
    d.text((525, 548), "总带入 12000", font=font18, fill=warm)

    row = Image.open(DETAIL / "战绩数据底框.png")
    for i in range(6):
        y = 650 + i * 119
        preview.alpha_composite(row.resize((749, 119), Image.Resampling.LANCZOS), (0, y))
        paste_center(preview, avatar_frame, (160, y + 55), (92, 84))
        paste_center(preview, avatar, (160, y + 57), (70, 70))
        d.text((201, y + 22), f"玩家{i + 1}", font=font18, fill=warm)
        d.text((201, y + 49), f"ID:10368{i}", font=font16, fill=(167, 145, 101, 255))
        d.text((201, y + 76), "带入:1200", font=font16, fill=ivory)
        d.text((390, y + 44), "手数:25", font=font18, fill=ivory)
        d.text((555, y + 44), "+320", font=font18, fill=(202, 88, 59, 255))
    preview.convert("RGB").save(out_path, optimize=True)


def build() -> list[Path]:
    ART.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    for name, num, tone in (("1.png", "1", GOLD_HI), ("2.png", "2", (204, 176, 119, 255)), ("3.png", "3", (190, 111, 47, 255))):
        out.append(medal(DETAIL/name, num, tone))
    # The combined podium sprite is rebuilt from the three individual medals.
    combined = canvas((216, 61))
    for x, name in ((6, "1.png"), (74, "2.png"), (142, "3.png")):
        combined.alpha_composite(Image.open(DETAIL/name).convert("RGBA").resize((68*S, 61*S)), (x*S, 0))
    out.append(save(DETAIL/"123.png", combined.resize((216, 61), Image.Resampling.LANCZOS)))

    # Remove the old POKER STAR brand while retaining a restrained Qin seal motif.
    logo = canvas((159, 92)); d = ImageDraw.Draw(logo); cx, cy = 79*S, 44*S
    d.ellipse((cx-37*S, cy-37*S, cx+37*S, cy+37*S), fill=(7,7,6,245), outline=GOLD_DARK, width=5*S)
    d.ellipse((cx-31*S, cy-31*S, cx+31*S, cy+31*S), outline=GOLD_HI, width=S)
    center(d, (cx-30*S, cy-30*S, cx+30*S, cy+30*S), "秦", ft(44), GOLD_HI, 1)
    out.append(save(DETAIL/"LOGO.png", logo.resize((159,92), Image.Resampling.LANCZOS)))

    for name, text in (("MVP.png","MVP"),("劳模.png","劳模"),("土豪.png","土豪"),("大鱼.png","大鱼")):
        out.append(badge(DETAIL/name, text))
    for name, text, fs in (("回放.png","牌局回顾",21),("奖池.png","奖池",18),
                           ("本局总带入.png","本局总带入",20),("本局总手数.png","本局总手数",20)):
        out.append(label(DETAIL/name, text, Image.open(DETAIL/name).size, fs))

    # The title is a miniature bronze plaque rather than floating text.
    title_path = DETAIL/"战局详情.png"; title_size = Image.open(title_path).size
    title = lacquer_panel(title_size, radius=4, inset=1); td = ImageDraw.Draw(title)
    td.rectangle((5*S,6*S,(title_size[0]-5)*S,(title_size[1]-6)*S), outline=(164,105,33,180), width=S)
    td.rectangle((title_size[0]*S//2-4*S,(title_size[1]-8)*S,title_size[0]*S//2+4*S,title_size[1]*S),fill=RED)
    center(td,(0,0,title_size[0]*S,title_size[1]*S),"战局详情",ft(24),GOLD_HI,1)
    out.append(save(title_path,title.resize(title_size,Image.Resampling.LANCZOS)))

    for name in ("战绩数据底框.png", "房间信息底板.png", "数据底框.png", "时间框.png"):
        p=DETAIL/name; sz=Image.open(p).size; panel=lacquer_panel(sz, radius=10)
        d=ImageDraw.Draw(panel)
        if name == "房间信息底板.png":
            for x in (sz[0]//4,sz[0]//2,sz[0]*3//4):
                d.line((x*S,22*S,x*S,(sz[1]-22)*S),fill=(128,80,28,180),width=S)
                d.ellipse((x*S-2*S,sz[1]*S//2-2*S,x*S+2*S,sz[1]*S//2+2*S),fill=GOLD)
            d.rectangle((sz[0]*S//2-8*S,(sz[1]-13)*S,sz[0]*S//2+8*S,(sz[1]-3)*S),fill=RED,outline=GOLD)
        elif name in ("战绩数据底框.png","数据底框.png"):
            d.line((18*S,12*S,(sz[0]-18)*S,12*S),fill=(232,190,102,80),width=S)
            for x in range(35,sz[0]-30,90): d.polygon(((x*S,(sz[1]-6)*S),((x+4)*S,(sz[1]-10)*S),((x+8)*S,(sz[1]-6)*S),((x+4)*S,(sz[1]-2)*S)),outline=(122,76,25,140))
        out.append(save(p, panel.resize(sz, Image.Resampling.LANCZOS)))

    # Atlas/helper art still belongs to this panel's package even when not directly serialized.
    out.append(label(DETAIL/"数字.png", "0 1 2 3 4 5 6 7 8 9", (195,56), 16))
    chip=canvas((50,44)); cd=ImageDraw.Draw(chip); cd.ellipse((5*S,2*S,45*S,42*S), fill=(8,8,7,255), outline=GOLD, width=3*S); cd.ellipse((13*S,10*S,37*S,34*S), outline=GOLD_HI, width=S); center(cd,(13*S,10*S,37*S,34*S),"秦",ft(14),GOLD_HI,1)
    out.append(save(DETAIL/"筹码.png", chip.resize((50,44), Image.Resampling.LANCZOS)))

    for name, text, selected in (("牌局回顾未选中.png", "牌局回顾", False),
                                 ("牌局回顾选中.png", "牌局回顾", True),
                                 ("文字牌谱未选中.png", "文字牌谱", False),
                                 ("文字牌谱选中.png", "文字牌谱", True)):
        out.append(tab(PAIPU / name, text, selected))

    honor_source = ART / "qin_record_info_honor_frame_clean_source.png"
    out.append(save(ROOT / "assets" / "ImagesLuck" / "公用" / "皇冠框.png",
                    clean_checkerboard(honor_source, (612, 367))))

    for name in ("开牌", "弃牌", "休牌"):
        out.append(compact_state(ROOT / "assets" / "resources" / "other" / f"{name}.png", name, (67, 27)))
    for name in ("丢", "休", "大", "挨-", "挨", "敲", "跟"):
        out.append(compact_state(ROOT / "assets" / "resources" / "other" / "牌谱" / f"{name}.png", name, (49, 36)))
    divider = Image.new("RGBA", (727, 4), (0, 0, 0, 0))
    dd = ImageDraw.Draw(divider)
    dd.line((0, 1, 726, 1), fill=(95, 59, 20, 150), width=1)
    dd.line((52, 2, 674, 2), fill=(214, 158, 65, 190), width=1)
    out.append(save(ROOT / "assets" / "ImagesLuck" / "公用" / "分隔线.png", divider))

    build_runtime_preview(ART / "qin_record_info_runtime_preview.png")

    # Rebuild the runtime card back from the approved Qin source while preserving
    # the existing 348x480 canvas and its historical 317x479 trim rectangle.
    card_source = Image.open(ART / "qin_card_back_source.png").convert("RGB")
    non_black = Image.new("L", card_source.size, 0)
    src_px = card_source.load()
    mask_px = non_black.load()
    for yy in range(card_source.height):
        for xx in range(card_source.width):
            mask_px[xx, yy] = 255 if max(src_px[xx, yy]) > 18 else 0
    bounds = non_black.getbbox()
    if bounds is None:
        raise ValueError("Qin card-back source has no visible card")
    card = card_source.crop(bounds).resize((317, 479), Image.Resampling.LANCZOS).convert("RGBA")
    rounded = Image.new("L", card.size, 0)
    ImageDraw.Draw(rounded).rounded_rectangle((0, 0, 316, 478), radius=19, fill=255)
    card.putalpha(rounded)
    card_runtime = Image.new("RGBA", (348, 480), (0, 0, 0, 0))
    card_runtime.alpha_composite(card, (16, 1))
    out.append(save(ROOT / "assets" / "resources" / "pk2" / "bigbig.png", card_runtime))
    return out


if __name__ == "__main__":
    files = build()
    print(f"generated {len(files)} runtime images")
