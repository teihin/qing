#!/usr/bin/env python3
"""Deterministically rebuild panelRecordList art in the Qin black-gold style."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "assets/ImagesLuck/战绩"
COMMON = ROOT / "assets/ImagesLuck/公用"
COMMON1 = ROOT / "assets/ImagesLuck/公用1"
KK_COMMON = ROOT / "assets/imagesKK/公用"
ART = ROOT / "art_sources/record_list"
SOURCE = ART / "qin_record_emblem_source.png"
HEADER_SOURCE = ART / "qin_record_header_final_source.png"
PING = ROOT / "assets/font/PingFF.ttf"
S = 4
GOLD_HI = (255, 240, 190, 255)
GOLD = (220, 166, 75, 255)
GOLD_MID = (147, 88, 26, 255)
GOLD_DARK = (69, 38, 12, 255)
IVORY = (242, 226, 188, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(PING), size * S)


def center(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt, fill, stroke=0, stroke_fill=None):
    box = draw.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    draw.text((xy[0] - (box[2]-box[0])/2 - box[0], xy[1] - (box[3]-box[1])/2 - box[1]),
              text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill or fill)


def metal_text(im: Image.Image, text: str, size: int, xy: tuple[int, int]):
    mask = Image.new("L", im.size, 0)
    center(ImageDraw.Draw(mask), (xy[0]*S, xy[1]*S), text, font(size), 255)
    edge = mask.filter(ImageFilter.MaxFilter(2*S+1))
    glow = edge.filter(ImageFilter.GaussianBlur(2*S))
    layer = Image.new("RGBA", im.size, (194, 116, 28, 0)); layer.putalpha(glow.point(lambda p: int(p*.25))); im.alpha_composite(layer)
    outline = Image.new("RGBA", im.size, (46, 24, 7, 0)); outline.putalpha(edge); im.alpha_composite(outline)
    grad = Image.new("RGBA", im.size)
    gd = ImageDraw.Draw(grad)
    for y in range(im.height):
        t = y/max(1, im.height-1); c=tuple(round(GOLD_HI[i]*(1-t)+GOLD_MID[i]*t) for i in range(4)); gd.line((0,y,im.width,y),fill=c)
    grad.putalpha(mask); im.alpha_composite(grad)


def trim(path: Path) -> tuple[int,int,int,int]:
    data=json.loads(path.with_suffix(path.suffix+".meta").read_text())
    sub=next(iter(data["subMetas"].values()))
    return tuple(int(sub[k]) for k in ("trimX","trimY","width","height"))


def save(path: Path, im: Image.Image):
    original=Image.open(path)
    mode=original.mode
    meta=json.loads(path.with_suffix(path.suffix+".meta").read_text())
    target_size=(int(meta["width"]),int(meta["height"]))
    im=im.resize(target_size,Image.Resampling.LANCZOS).convert("RGBA")
    if mode in ("RGBA", "P"):
        x,y,w,h=trim(path); a=im.getchannel("A"); clipped=Image.new("L",im.size); clipped.paste(a.crop((x,y,x+w,y+h)),(x,y)); im.putalpha(clipped)
        px=im.load()
        for xx,yy in ((x,y),(x+w-1,y),(x,y+h-1),(x+w-1,y+h-1)):
            r,g,b,a=px[xx,yy]; px[xx,yy]=(r or 120,g or 72,b or 22,max(a,8))
    if mode == "P":
        output=im.quantize(colors=255,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE)
    else:
        output=im.convert(mode)
    output.save(path,optimize=True)


def canvas(size): return Image.new("RGBA",(size[0]*S,size[1]*S),(0,0,0,0))


def lacquer_button(path: Path, text: str, selected: bool):
    w,h=Image.open(path).size; im=canvas((w,h)); d=ImageDraw.Draw(im)
    box=(3*S,4*S,(w-3)*S,(h-4)*S); radius=22*S
    d.rounded_rectangle(box,radius,fill=(10,9,7,252),outline=GOLD_DARK,width=4*S)
    d.rounded_rectangle((6*S,7*S,(w-6)*S,(h-7)*S),radius-3*S,outline=GOLD if selected else (123,83,34,255),width=S)
    if selected:
        d.rounded_rectangle((10*S,11*S,(w-10)*S,(h-11)*S),radius-7*S,fill=(79,46,14,110),outline=GOLD_HI,width=S)
    else:
        d.line((19*S,(h-12)*S,(w-19)*S,(h-12)*S),fill=(104,68,28,170),width=S)
    metal_text(im,text,24 if h>=55 else 20,(w//2,h//2))
    save(path,im)


def label_asset(path: Path, text: str, size: int=22):
    w,h=Image.open(path).size; im=canvas((w,h)); metal_text(im,text,size,(w//2,h//2)); save(path,im)


def icon_asset(path: Path, kind: str):
    w,h=Image.open(path).size; im=canvas((w,h)); d=ImageDraw.Draw(im); cx,cy=w*S/2,h*S/2
    gold=GOLD_HI; dark=(61,35,12,255)
    if kind=="room":
        d.polygon([(cx,5*S),(5*S,cy-2*S),(9*S,cy-2*S),(9*S,(h-6)*S),((w-9)*S,(h-6)*S),((w-9)*S,cy-2*S),((w-5)*S,cy-2*S)],fill=dark,outline=gold)
        d.rectangle((cx-3*S,cy+3*S,cx+3*S,(h-6)*S),fill=gold)
    elif kind=="chip":
        r=min(w,h)*S*.38; d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=dark,outline=gold,width=2*S); d.ellipse((cx-r*.55,cy-r*.55,cx+r*.55,cy+r*.55),outline=GOLD,width=S); d.rectangle((cx-S,cy-r*.75,cx+S,cy+r*.75),fill=GOLD)
    elif kind=="time":
        r=min(w,h)*S*.39; d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=dark,outline=gold,width=2*S); d.line((cx,cy,cx,cy-r*.55),fill=gold,width=2*S); d.line((cx,cy,cx+r*.45,cy+r*.25),fill=gold,width=2*S)
    elif kind=="coin":
        r=min(w,h)*S*.4; d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=dark,outline=gold,width=2*S); d.rectangle((cx-r*.23,cy-r*.23,cx+r*.23,cy+r*.23),outline=GOLD_HI,width=S)
    save(path,im)


def make_stats():
    path=RECORD/"局数手数.png"; w,h=Image.open(path).size; im=canvas((w,h)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((3*S,3*S,(w-3)*S,(h-3)*S),10*S,fill=(7,7,6,235),outline=GOLD_DARK,width=3*S)
    d.rounded_rectangle((7*S,7*S,(w-7)*S,(h-7)*S),7*S,outline=(178,115,39,210),width=S)
    d.line((w*S//2,10*S,w*S//2,(h-10)*S),fill=(151,94,29,180),width=S)
    center(d,(w*S*.25,h*S*.5),"总局数:",font(18),IVORY); center(d,(w*S*.75,h*S*.5),"总手数:",font(18),IVORY)
    save(path,im)


def make_header_panel():
    """Fit the approved full-detail concept directly into the runtime sprite.

    The approved effect is the source of truth.  Do not reconstruct or simplify
    its central scroll, circular Qin pattern, clouds, laurels or side ornaments.
    Only the preview checkerboard is removed and the complete composition is
    resized to the dimensions declared by the existing Cocos texture metadata.
    """
    path=COMMON/"我的战绩框.png"
    meta=json.loads(path.with_suffix(path.suffix+".meta").read_text())
    w,h=int(meta["width"]),int(meta["height"])
    src=Image.open(HEADER_SOURCE).convert("RGB")
    pixels=np.asarray(src)
    luminance=pixels.mean(2)
    foreground=luminance < 170
    ys,xs=np.where(foreground)
    if not len(xs):
        raise RuntimeError(f"No panel bounds found in {HEADER_SOURCE}")
    left,top,right,bottom=int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)
    # The source panel has a clean rounded silhouette.  Rebuild only its alpha
    # edge so the visible checkerboard becomes real transparency.
    pad=1
    bounds=(max(0,left-pad),max(0,top-pad),min(src.width,right+pad),min(src.height,bottom+pad))
    radius=max(1,round((bounds[3]-bounds[1])*0.063))
    alpha=Image.new("L",src.size,0)
    ImageDraw.Draw(alpha).rounded_rectangle(
        (bounds[0],bounds[1],bounds[2]-1,bounds[3]-1),radius=radius,fill=255
    )
    rgba=src.convert("RGBA")
    rgba.putalpha(alpha)
    runtime=rgba.resize((w,h),Image.Resampling.LANCZOS)
    # Keep the existing full-frame auto-trim contract without a visible mark.
    px=runtime.load()
    for x,y in ((0,0),(w-1,0),(0,h-1),(w-1,h-1)):
        px[x,y]=(120,72,22,8)
    runtime.save(path,optimize=True)


def preview_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(PING), size)


def paste_asset(canvas: Image.Image, path: Path, xy: tuple[int, int], size: tuple[int, int] | None = None):
    asset=Image.open(path).convert("RGBA")
    if size:
        asset=asset.resize(size,Image.Resampling.LANCZOS)
    canvas.alpha_composite(asset,xy)


def make_preview() -> Path:
    page=Image.open(COMMON/"背景.png").convert("RGBA")
    paste_asset(page,COMMON1/"顶部.png",(0,0))
    paste_asset(page,KK_COMMON/"back.png",(48,14))
    paste_asset(page,RECORD/"我的战绩.png",(310,27))
    paste_asset(page,COMMON/"我的战绩框.png",(69,108))
    paste_asset(page,RECORD/"局数手数.png",(107,317))
    draw=ImageDraw.Draw(page)
    center(draw,(285,343),"28",preview_font(22),GOLD_HI)
    center(draw,(545,343),"166",preview_font(22),GOLD_HI)

    for path,x in ((RECORD/"前一天2.png",83),(RECORD/"昨天2.png",283),(RECORD/"今天.png",483)):
        paste_asset(page,path,(x,409))

    paste_asset(page,COMMON/"表格标题头.png",(0,488))
    for path,x,y in (
        (RECORD/"房间ID.png",44,516),
        (RECORD/"底皮.png",224,516),
        (RECORD/"时间2.png",437,516),
        (RECORD/"输赢.png",602,517),
    ):
        paste_asset(page,path,(x,y))

    rows=(
        ("103685", "10", "07-22 18:46", "+320"),
        ("103412", "5", "07-22 17:20", "-80"),
        ("102967", "20", "07-22 15:08", "+760"),
        ("102580", "10", "07-22 13:55", "+120"),
        ("102144", "2", "07-22 11:31", "-20"),
        ("101809", "5", "07-22 10:16", "+55"),
        ("101263", "10", "07-22 09:02", "+210"),
    )
    for i,(room,ante,time_text,score) in enumerate(rows):
        y=596+i*87
        paste_asset(page,COMMON1/"分割线.png",(4,y+66),(742,4))
        center(draw,(95,y+28),room,preview_font(19),(232,193,111,255))
        center(draw,(270,y+28),ante,preview_font(19),IVORY)
        center(draw,(475,y+28),time_text,preview_font(18),IVORY)
        score_color=(196,86,66,255) if score.startswith("+") else (92,156,111,255)
        center(draw,(650,y+28),score,preview_font(20),score_color)

    for path,xy in (
        (KK_COMMON/"11.png",(142,1242)),
        (KK_COMMON/"左2.png",(243,1242)),
        (KK_COMMON/"右1.png",(463,1242)),
        (KK_COMMON/"22.png",(555,1242)),
    ):
        paste_asset(page,path,xy)
    center(draw,(375,1266),"1/4",preview_font(21),GOLD_HI)
    out=ART/"qin_record_list_runtime_preview.png"
    page.convert("RGB").save(out,quality=95)
    return out


def main():
    make_header_panel(); make_stats()
    label_asset(RECORD/"我的战绩.png","我的战绩",26)
    for name,text,selected in (("今天.png","今天",True),("今天2.png","今天",False),("昨天.png","昨天",True),("昨天2.png","昨天",False),("前一天.png","前一天",True),("前一天2.png","前一天",False)):
        lacquer_button(RECORD/name,text,selected)
    for name,text in (("房间ID.png","房间ID"),("底皮.png","底皮"),("时间2.png","时间"),("输赢.png","输赢"),("总局数1.png","总局数"),("总手数.png","总手数")):
        label_asset(RECORD/name,text,18)
    for name,kind in (("房间号.png","room"),("筹码.png","chip"),("时间.png","time"),("金币.png","coin")):
        icon_asset(RECORD/name,kind)
    # Legacy asset retained by the directory although panelRecordList does not currently reference it.
    icon_asset(RECORD/"总局数.png","time")
    preview=make_preview()
    print("generated 20 runtime PNGs")
    print(preview.relative_to(ROOT))


if __name__=="__main__": main()
