#!/usr/bin/env python3
"""Replace the remaining legacy-blue art referenced by panelMain.prefab."""

from __future__ import annotations

import colorsys
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art_sources" / "panel_main_remaining"
TEXTURE = ART / "qin_obsidian_lacquer_source.png"
FONT = ROOT / "assets" / "font" / "PingFF.ttf"
S = 4
GOLD_HI = (255, 237, 176, 255)
GOLD = (218, 164, 75, 255)
GOLD_DARK = (91, 52, 15, 255)
IVORY = (239, 225, 194, 255)
RED = (151, 50, 28, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * S)


def center_text(draw: ImageDraw.ImageDraw, size: tuple[int, int], text: str, size_px: int,
                fill=GOLD_HI, stroke=1) -> None:
    f = font(size_px)
    box = draw.textbbox((0, 0), text, font=f, stroke_width=stroke*S)
    x = (size[0]*S - (box[2]-box[0]))/2 - box[0]
    y = (size[1]*S - (box[3]-box[1]))/2 - box[1]
    draw.text((round(x), round(y)), text, font=f, fill=fill,
              stroke_width=stroke*S, stroke_fill=(45, 23, 6, 255))


def texture(size: tuple[int, int], alpha=255) -> Image.Image:
    src = Image.open(TEXTURE).convert("RGB")
    im = ImageOps.fit(src, (size[0]*S, size[1]*S), Image.Resampling.LANCZOS).convert("RGBA")
    if alpha != 255: im.putalpha(alpha)
    return im


def clean_lacquer(size: tuple[int, int], alpha=255) -> Image.Image:
    """Calm announcement surface: no stone grains, clouds, or repeated motifs."""
    w, h = size[0]*S, size[1]*S
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    p = im.load()
    for y in range(h):
        t = y / max(1, h-1)
        # Very restrained warm-black vertical gradient.
        v = round(13*(1-t) + 6*t)
        warm = round(3*(1-t))
        for x in range(w): p[x,y] = (v+warm, v+1, v, alpha)
    d = ImageDraw.Draw(im)
    d.rectangle((0,0,w-1,max(S,2*S)),fill=(53,36,17,min(alpha,95)))
    return im


def frame(im: Image.Image, radius=10, inset=2, corners=True) -> None:
    d = ImageDraw.Draw(im)
    w, h = im.size; b=(inset*S,inset*S,w-inset*S-1,h-inset*S-1)
    d.rounded_rectangle(b, radius=radius*S, outline=(55,30,8,255), width=5*S)
    d.rounded_rectangle((b[0]+2*S,b[1]+2*S,b[2]-2*S,b[3]-2*S),
                        radius=max(1,radius-2)*S, outline=GOLD, width=2*S)
    d.rounded_rectangle((b[0]+5*S,b[1]+5*S,b[2]-5*S,b[3]-5*S),
                        radius=max(1,radius-5)*S, outline=(255,232,164,110), width=S)
    if corners and w > 100*S and h > 55*S:
        k=14*S
        for x,y,sx,sy in ((b[0]+7*S,b[1]+7*S,1,1),(b[2]-7*S,b[1]+7*S,-1,1),
                           (b[0]+7*S,b[3]-7*S,1,-1),(b[2]-7*S,b[3]-7*S,-1,-1)):
            d.line((x,y+sy*k,x,y,x+sx*k,y),fill=(240,194,103,210),width=S)


def meta_trim(path: Path) -> tuple[int,int,int,int] | None:
    try:
        data=json.loads(path.with_suffix(path.suffix+".meta").read_text(encoding="utf-8"))
        sub=next(iter(data.get("subMetas",{}).values()))
        return int(sub["trimX"]),int(sub["trimY"]),int(sub["width"]),int(sub["height"])
    except Exception: return None


def save(path: Path, im: Image.Image) -> Path:
    original=Image.open(path); mode=original.mode
    im=im.resize(original.size,Image.Resampling.LANCZOS)
    if mode in ("RGBA","LA","P"):
        im=im.convert("RGBA")
        trim=meta_trim(path)
        if trim:
            x,y,w,h=trim; a=im.getchannel("A"); clipped=Image.new("L",im.size,0)
            clipped.paste(a.crop((x,y,x+w,y+h)),(x,y)); im.putalpha(clipped)
            pix=im.load()
            for px,py in ((x,y),(x+w-1,y),(x,y+h-1),(x+w-1,y+h-1)):
                if 0<=px<im.width and 0<=py<im.height and pix[px,py][3]<8: pix[px,py]=(80,48,17,8)
        if mode=="P":
            im=im.quantize(colors=255,method=Image.Quantize.FASTOCTREE)
    else: im=im.convert("RGB")
    im.save(path,optimize=True)
    return path


def title(path: Path, text: str, fs=24) -> Path:
    sz=Image.open(path).size; im=Image.new("RGBA",(sz[0]*S,sz[1]*S),(0,0,0,0))
    d=ImageDraw.Draw(im)
    if sz[0] > 150:
        d.line((8*S,(sz[1]-5)*S,(sz[0]-8)*S,(sz[1]-5)*S),fill=(167,103,31,150),width=S)
        d.polygon(((sz[0]*S//2-4*S,(sz[1]-8)*S),(sz[0]*S//2+4*S,(sz[1]-8)*S),(sz[0]*S//2,(sz[1]-2)*S)),fill=RED)
    center_text(d,sz,text,fs)
    return save(path,im)


def button(path: Path, text: str, fs=23, radius=14) -> Path:
    sz=Image.open(path).size; im=texture(sz,248); frame(im,radius=radius)
    d=ImageDraw.Draw(im); d.line((18*S,8*S,(sz[0]-18)*S,8*S),fill=(255,235,173,80),width=S)
    center_text(d,sz,text,fs)
    return save(path,im)


def input_frame(path: Path) -> Path:
    sz=Image.open(path).size; im=Image.new("RGBA",(sz[0]*S,sz[1]*S),(0,0,0,0)); d=ImageDraw.Draw(im)
    b=(2*S,3*S,(sz[0]-2)*S,(sz[1]-3)*S)
    d.rounded_rectangle(b,radius=min(34,sz[1]//2)*S,fill=(8,7,6,246),outline=GOLD_DARK,width=4*S)
    d.rounded_rectangle((b[0]+3*S,b[1]+3*S,b[2]-3*S,b[3]-3*S),radius=min(30,sz[1]//2-3)*S,outline=GOLD,width=S)
    return save(path,im)


def setting_card(path: Path, text: str, icon: str) -> Path:
    sz=Image.open(path).size; im=texture(sz,252); frame(im,radius=8); d=ImageDraw.Draw(im)
    cx=sz[0]*S//2; cy=82*S
    d.ellipse((cx-35*S,cy-35*S,cx+35*S,cy+35*S),fill=(11,10,8,255),outline=GOLD,width=2*S)
    center_text(d,(sz[0],135),icon,40)
    center_text(d,(sz[0],sz[1]),text,24)
    return save(path,im)


def toggle(path: Path, on: bool) -> Path:
    sz=Image.open(path).size; im=Image.new("RGBA",(sz[0]*S,sz[1]*S),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((4*S,8*S,(sz[0]-4)*S,(sz[1]-8)*S),radius=28*S,fill=(9,8,7,255),outline=GOLD_DARK,width=3*S)
    knob_x=(sz[0]-38 if on else 38)*S
    d.ellipse((knob_x-24*S,sz[1]*S//2-24*S,knob_x+24*S,sz[1]*S//2+24*S),fill=(104,59,17,255),outline=GOLD_HI,width=2*S)
    center_text(d,sz,"开" if on else "关",22,IVORY)
    return save(path,im)


def recolor_legacy(path: Path) -> Path:
    original=Image.open(path); rgba=original.convert("RGBA"); out=Image.new("RGBA",rgba.size); src=rgba.load(); dst=out.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r,g,b,a=src[x,y]
            h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
            if a==0: dst[x,y]=(r,g,b,a); continue
            if (s>.18 and 0.48<h<0.98) or (b>85 and b>r*1.12 and b>g*1.05):
                # Blue/cyan legacy surfaces become warm black lacquer or bronze highlights.
                lum=.2126*r+.7152*g+.0722*b
                if lum>155: nr,ng,nb=(151,104,48)
                elif lum>85: nr,ng,nb=(55,36,18)
                else: nr,ng,nb=(14,12,9)
                dst[x,y]=(nr,ng,nb,a)
            elif s<.12 and v>.92: dst[x,y]=(242,231,205,a)
            else: dst[x,y]=(r,g,b,a)
    return save(path,out)


def build() -> list[Path]:
    out=[]
    ann=ROOT/"assets/ImagesLuck/公告"
    # Static rule pages contain baked Chinese copy and standard-colour playing
    # cards.  A global hue remap makes their headings illegible and turns red
    # suits blue.  They are rebuilt by polish_qin_announcement_pages.py from
    # checked-in source snapshots and must not be recoloured here.
    for name,text in {
        "公告.png":"公告","最新公告.png":"最新公告","充值提现公告.png":"充值提现公告","平台简介.png":"平台简介",
        "特色玩法介绍.png":"特色玩法介绍","红利说明.png":"红利说明","惩罚公告.png":"惩罚公告",
        "赢家逃跑惩罚机制.png":"赢家逃跑惩罚机制","还原地道打旋.png":"还原地道打旋",
        "惩罚公告标题.png":"惩罚公告","玩家ID.png":"玩家ID","违规情况.png":"违规情况","处罚结果.png":"处罚结果"
    }.items(): out.append(title(ann/name,text,22 if len(text)<7 else 19))
    for name,text in (("最新公告标题.png","最新公告"),("组 78.png","红利说明")):
        p=ann/name
        if p.exists(): out.append(title(p,text,21))
    for name in ("透明底框.png","弹窗公告底.png"):
        p=ann/name
        if p.exists():
            sz=Image.open(p).size; im=clean_lacquer(sz,245); frame(im,10,corners=False); out.append(save(p,im))
    p=ann/"惩罚标题框.png"
    if p.exists():
        sz=Image.open(p).size; im=clean_lacquer(sz,246); frame(im,8,corners=False); out.append(save(p,im))
    p=ann/"公告底.png"; out.append(save(p,clean_lacquer(Image.open(p).size,255)))

    settings=ROOT/"assets/ImagesLuck/设置"
    out += [title(settings/"设置.png","设置",24), title(settings/"语音.png","语音聊天",22), title(settings/"音效.png","游戏音效",22)]
    out += [setting_card(settings/"切换账号.png","切换账号","↻"), setting_card(settings/"修改登录密码.png","修改登录密码","锁"), setting_card(settings/"修改交易密码.png","修改交易密码","钥")]
    out += [toggle(settings/"开.png",True),toggle(settings/"关.png",False)]

    avatar=ROOT/"assets/ImagesLuck/头像"
    out += [title(avatar/"修改信息.png","修改信息",23),button(avatar/"点击上传.png","选择头像",21),input_frame(avatar/"昵称输入.png")]

    mine=ROOT/"assets/ImagesLuck/我的"
    for name,text in (("修改交易密码标题.png","修改交易密码"),("修改密码.png","修改登录密码"),("资金流向标题.png","资金明细"),("赠送_受赠记录.png","赠送/受赠记录")):
        out.append(title(mine/name,text,22))
    for name,text in (("原有密码.png","原有密码"),("新设密码.png","新设密码"),("确认密码.png","确认密码")):
        out.append(title(mine/name,text,18))

    give=ROOT/"assets/ImagesLuck/赠送"
    for name,text in (("玩家ID.png","玩家ID"),("昵称.png","昵称"),("时间.png","时间"),("金额.png","金额"),("操作.png","操作")):
        p=give/name; out.append(input_frame(p) if name=="玩家ID.png" else title(p,text,18))

    join=ROOT/"assets/ImagesXYPK/加入房间"
    for n in range(10): out.append(button(join/f"{n}.png",str(n),32,10))
    out += [button(join/"删除.png","删除",22,10),button(join/"重置.png","重置",22,10),title(join/"加入房间.png","加入房间",24),input_frame(join/"加入房间框.png")]
    if (join/"弹窗.png").exists():
        p=join/"弹窗.png"; sz=Image.open(p).size; im=texture(sz,248); frame(im,12); out.append(save(p,im))

    promo=ROOT/"assets/ImagesXYPK/推广"
    # The Hongli promotion page has its own cleaner, layout-aware generator.
    # Do not overwrite its background, QR frame or action button here.
    out += [title(promo/"推广.png","推广",24)]

    common=ROOT/"assets/ImagesLuck/公用"
    out += [input_frame(common/"输入框.png"), button(common/"取消.png","取消",25)]
    login=ROOT/"assets/ImagesLuck/登陆"; out.append(button(login/"CHACHA.png","×",28,20))
    words=ROOT/"assets/ImagesLuck/文字"
    out += [title(words/"更变.png","更变",18),title(words/"数量.png","数量",18),title(words/"时间.png","时间",18)]
    return out


if __name__ == "__main__":
    files=build(); print(f"generated {len(files)} panelMain remaining assets")
