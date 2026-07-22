#!/usr/bin/env python3
"""Rebuild panelRecordInfo art in the established restrained Qin black-gold style."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


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


def lacquer_panel(size: tuple[int, int], radius=10, inset=2) -> Image.Image:
    im = canvas(size)
    d = ImageDraw.Draw(im)
    b = (inset*S, inset*S, (size[0]-inset)*S-1, (size[1]-inset)*S-1)
    d.rounded_rectangle(b, radius=radius*S, fill=(7, 7, 6, 244), outline=GOLD_DARK, width=3*S)
    d.rounded_rectangle((b[0]+3*S, b[1]+3*S, b[2]-3*S, b[3]-3*S),
                        radius=max(1, radius-3)*S, outline=(236, 188, 102, 210), width=S)
    d.line((b[0]+12*S, b[1]+5*S, b[2]-12*S, b[1]+5*S), fill=(255, 235, 176, 80), width=S)
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
    im = lacquer_panel(size, radius=15, inset=2)
    d = ImageDraw.Draw(im)
    d.polygon(((8*S, size[1]*S//2), (15*S, (size[1]//2-5)*S), (15*S, (size[1]//2+5)*S)), fill=GOLD)
    d.polygon((((size[0]-8)*S, size[1]*S//2), ((size[0]-15)*S, (size[1]//2-5)*S), ((size[0]-15)*S, (size[1]//2+5)*S)), fill=GOLD)
    center(d, (0, 0, size[0]*S, size[1]*S), text, ft(21), GOLD_HI, 1)
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
    im = lacquer_panel(size, radius=22, inset=2)
    d = ImageDraw.Draw(im)
    if selected:
        d.rounded_rectangle((8*S, 8*S, (size[0]-8)*S, (size[1]-8)*S), radius=17*S,
                            fill=(92, 53, 16, 150), outline=GOLD, width=2*S)
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
    for name, text, fs in (("回放.png","牌局回顾",21),("奖池.png","奖池",18),("战局详情.png","战局详情",24),
                           ("本局总带入.png","本局总带入",20),("本局总手数.png","本局总手数",20)):
        out.append(label(DETAIL/name, text, Image.open(DETAIL/name).size, fs))

    for name in ("战绩数据底框.png", "房间信息底板.png", "数据底框.png", "时间框.png"):
        p=DETAIL/name; out.append(save(p, lacquer_panel(Image.open(p).size, radius=10).resize(Image.open(p).size, Image.Resampling.LANCZOS)))

    # Atlas/helper art still belongs to this panel's package even when not directly serialized.
    out.append(label(DETAIL/"数字.png", "0 1 2 3 4 5 6 7 8 9", (195,56), 16))
    chip=canvas((50,44)); cd=ImageDraw.Draw(chip); cd.ellipse((5*S,2*S,45*S,42*S), fill=(8,8,7,255), outline=GOLD, width=3*S); cd.ellipse((13*S,10*S,37*S,34*S), outline=GOLD_HI, width=S); center(cd,(13*S,10*S,37*S,34*S),"秦",ft(14),GOLD_HI,1)
    out.append(save(DETAIL/"筹码.png", chip.resize((50,44), Image.Resampling.LANCZOS)))

    for name, text, selected in (("牌局回顾未选中.png","牌局回顾",False),("牌局回顾选中.png","牌局回顾",True),
                                 ("文字牌谱未选中.png","文字牌谱",False),("文字牌谱选中.png","文字牌谱",True)):
        out.append(tab(PAIPU/name, text, selected))

    # Runtime-style sheet for quick visual QA.
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
