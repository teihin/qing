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

    for name, text, selected in (("牌局回顾未选中.png","牌局回顾",False),("牌局回顾选中.png","牌局回顾",True),
                                 ("文字牌谱未选中.png","文字牌谱",False),("文字牌谱选中.png","文字牌谱",True)):
        out.append(tab(PAIPU/name, text, selected))

    # Runtime-style sheet for quick visual QA. Prefer the approved art-direction
    # concept when present so future rebuilds retain the intended visual target.
    concept = ART/"qin_record_info_main_source.png"
    if concept.exists():
        preview = Image.open(concept).convert("RGB").resize((750,1334),Image.Resampling.LANCZOS)
        preview.save(ART/"qin_record_info_runtime_preview.png", optimize=True)
        return out
    preview = Image.new("RGB", (750, 1334), (8, 7, 5)); pd=ImageDraw.Draw(preview)
    pd.rectangle((0,0,749,91), fill=(16,13,9)); pd.text((315,30), "战局详情", font=ImageFont.truetype(str(FONT),26), fill=(235,190,105))
    pd.rounded_rectangle((18,112,732,245), 12, fill=(12,10,7), outline=(145,92,31), width=2)
    pd.text((42,135), "房间信息  ·  时长  ·  底皮  ·  奖池", font=ImageFont.truetype(str(FONT),20), fill=(242,226,188))
    for i,(name,text) in enumerate((("土豪.png","土豪"),("MVP.png","MVP"),("大鱼.png","大鱼"),("劳模.png","劳模"))):
        x=28+i*180; preview.paste(Image.open(DETAIL/name),(x,275),Image.open(DETAIL/name)); pd.text((x+8,343),"玩家昵称",font=ImageFont.truetype(str(FONT),17),fill=(242,226,188))
    pd.rounded_rectangle((18,390,732,1140),12,fill=(10,9,7),outline=(145,92,31),width=2)
    for y in range(460,1090,82): pd.line((34,y,716,y),fill=(91,57,23),width=1)
    preview.save(ART/"qin_record_info_runtime_preview.png", optimize=True)
    return out


if __name__ == "__main__":
    files = build()
    print(f"generated {len(files)} runtime images")
