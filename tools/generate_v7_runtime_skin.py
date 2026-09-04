#!/usr/bin/env python3
"""Generate the deterministic runtime bitmaps for the approved V7 8L skin.

The script only writes assets/resources/V7 and keeps the generated/photo masters
under art_sources/v7.  UI JSON and scripts are intentionally handled separately.
"""

from __future__ import annotations

import json
import math
import random
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/resources/V7"
SOURCE = ROOT / "art_sources/v7"
PREVIEW = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版"
FONT_PATH = ROOT / "assets/font/PingFF.ttf"
SS = 4

BLUE_TOP = (28, 82, 119, 250)
BLUE_BOTTOM = (4, 36, 62, 252)
BLUE_DARK = (2, 23, 42, 255)
GOLD = (225, 197, 145, 255)
GOLD_HI = (248, 226, 181, 255)
GOLD_DARK = (124, 94, 58, 255)
COOL_EDGE = (151, 179, 190, 210)
CYAN = (54, 216, 229, 255)


def stable_uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.UUID("f353c31a-2e77-4f0d-9147-812a4adb9a19"), name))


def write_meta(path: Path, sliced: bool = False) -> None:
    raw_uuid = stable_uuid("raw:" + path.name)
    sf_uuid = stable_uuid("sprite:" + path.name)
    with Image.open(path) as im:
        w, h = im.size
    border = min(28, w // 4, h // 4) if sliced else 0
    data = {
        "ver": "2.3.7",
        "uuid": raw_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": w,
        "height": h,
        "platformSettings": {},
        "subMetas": {
            path.stem: {
                "ver": "1.0.6",
                "uuid": sf_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": raw_uuid,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": w,
                "height": h,
                "rawWidth": w,
                "rawHeight": h,
                "borderTop": border,
                "borderBottom": border,
                "borderLeft": border,
                "borderRight": border,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def save(im: Image.Image, name: str, sliced: bool = False) -> None:
    path = OUT / name
    im.save(path, optimize=True)
    write_meta(path, sliced=sliced)


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    scale = max(size[0] / im.width, size[1] / im.height)
    nw, nh = round(im.width * scale), round(im.height * scale)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    return im.crop(((nw - size[0]) // 2, (nh - size[1]) // 2,
                    (nw + size[0]) // 2, (nh + size[1]) // 2))


def scaled_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size * SS)


def vertical_gradient(size: tuple[int, int], top=BLUE_TOP, bottom=BLUE_BOTTOM) -> Image.Image:
    w, h = size
    im = Image.new("RGBA", size)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        d.line((0, y, w, y), fill=c)
    return im


def panel(size=(180, 110), radius=20, selected=False) -> Image.Image:
    w, h = size
    W, H = w * SS, h * SS
    fill = vertical_gradient((W, H),
                             (42, 104, 143, 252) if selected else (31, 83, 119, 248),
                             (6, 38, 64, 253))
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS), radius * SS, fill=255)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = mask.filter(ImageFilter.GaussianBlur(5 * SS))
    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow_layer.putalpha(shadow.point(lambda p: p * 90 // 255))
    out.alpha_composite(shadow_layer)
    out.paste(fill, (0, 0), mask)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 3 * SS), radius * SS,
                        outline=GOLD_DARK, width=1 * SS)
    d.rounded_rectangle((4 * SS, 4 * SS, W - 4 * SS, H - 4 * SS), (radius - 1) * SS,
                        outline=COOL_EDGE, width=1 * SS)
    d.arc((6 * SS, 6 * SS, W - 6 * SS, H - 6 * SS), 195, 345, fill=(225, 236, 235, 145), width=1 * SS)
    d.arc((7 * SS, 7 * SS, W - 7 * SS, H - 7 * SS), 15, 165, fill=(2, 18, 34, 210), width=2 * SS)
    # Fine felt grain keeps the panel from reading as a flat blue slab.
    rng = random.Random(w * 10000 + h + (1 if selected else 0))
    for _ in range(max(80, w * h // 25)):
        x, y = rng.randrange(W), rng.randrange(H)
        if mask.getpixel((x, y)):
            a = rng.randrange(3, 12)
            d.point((x, y), fill=(150, 215, 226, a))
    return out.resize((w, h), Image.Resampling.LANCZOS)


def draw_art_text(im: Image.Image, text: str, center: tuple[int, int], size: int,
                  fill=GOLD_HI, stroke=BLUE_DARK, width=1, anchor="mm") -> None:
    d = ImageDraw.Draw(im)
    xy = (center[0] * SS, center[1] * SS)
    font = scaled_font(size)
    d.text((xy[0] + SS, xy[1] + 2 * SS), text, font=font, anchor=anchor,
           fill=(0, 6, 12, 125), stroke_width=width * SS, stroke_fill=(0, 6, 12, 125))
    d.text(xy, text, font=font, anchor=anchor, fill=fill,
           stroke_width=width * SS, stroke_fill=stroke)


def icon(draw: ImageDraw.ImageDraw, kind: str, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = [v * SS for v in box]
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    s = min(x1 - x0, y1 - y0)
    lw = max(4, s // 12)
    color = GOLD_HI
    if kind in ("user", "mine"):
        draw.ellipse((cx-s*.18, y0+s*.05, cx+s*.18, y0+s*.41), fill=color, outline=GOLD_DARK, width=lw//2)
        draw.rounded_rectangle((cx-s*.32, y0+s*.48, cx+s*.32, y0+s*.9), radius=int(s*.18), fill=color, outline=GOLD_DARK, width=lw//2)
    elif kind in ("lock", "settings"):
        if kind == "lock":
            draw.arc((cx-s*.26, y0+s*.04, cx+s*.26, y0+s*.58), 180, 360, fill=color, width=lw)
            draw.rounded_rectangle((cx-s*.32, y0+s*.36, cx+s*.32, y0+s*.9), radius=lw, fill=color, outline=GOLD_DARK, width=lw//2)
            draw.ellipse((cx-lw, cy, cx+lw, cy+2*lw), fill=BLUE_DARK)
        else:
            draw.ellipse((cx-s*.34, cy-s*.34, cx+s*.34, cy+s*.34), fill=color, outline=GOLD_DARK, width=lw//2)
            draw.ellipse((cx-s*.13, cy-s*.13, cx+s*.13, cy+s*.13), fill=BLUE_DARK)
    elif kind in ("gift", "promotion"):
        if kind == "gift":
            draw.rectangle((x0+s*.16, y0+s*.42, x1-s*.16, y1-s*.12), fill=color, outline=GOLD_DARK, width=lw//2)
            draw.rectangle((cx-lw, y0+s*.36, cx+lw, y1-s*.12), fill=GOLD_DARK)
            draw.arc((cx-s*.34, y0+s*.02, cx, y0+s*.52), 195, 355, fill=color, width=lw)
            draw.arc((cx, y0+s*.02, cx+s*.34, y0+s*.52), 185, 345, fill=color, width=lw)
        else:
            pts=[(x0+s*.1,cy),(cx+s*.14,y0+s*.08),(x1-s*.08,cy-s*.14),(cx-s*.05,y1-s*.08)]
            draw.polygon(pts,fill=color)
            draw.ellipse((cx+s*.05,y0+s*.13,cx+s*.27,y0+s*.35),outline=BLUE_DARK,width=lw)
    elif kind in ("ranking", "record"):
        pts=[(x0+s*.08,y0+s*.36),(x0+s*.25,y0+s*.7),(cx,y0+s*.28),(x1-s*.25,y0+s*.7),(x1-s*.08,y0+s*.36),(x1-s*.18,y1-s*.17),(x0+s*.18,y1-s*.17)]
        draw.polygon(pts,fill=color,outline=GOLD_DARK)
    elif kind == "match":
        draw.ellipse((cx-s*.29,cy-s*.29,cx+s*.29,cy+s*.29),fill=color,outline=GOLD_DARK,width=lw//2)
        draw.polygon([(cx,cy-s*.18),(cx+s*.06,cy-s*.04),(cx+s*.22,cy-s*.03),(cx+s*.1,cy+s*.07),(cx+s*.14,cy+s*.22),(cx,cy+s*.13),(cx-s*.14,cy+s*.22),(cx-s*.1,cy+s*.07),(cx-s*.22,cy-s*.03),(cx-s*.06,cy-s*.04)],fill=BLUE_DARK)
    elif kind == "report":
        draw.polygon([(cx,y0+s*.04),(x1-s*.08,y1-s*.12),(x0+s*.08,y1-s*.12)],fill=color,outline=GOLD_DARK)
        draw.line((cx,y0+s*.3,cx,cy+s*.1),fill=BLUE_DARK,width=lw)
        draw.ellipse((cx-lw,cy+s*.24,cx+lw,cy+s*.24+2*lw),fill=BLUE_DARK)
    elif kind == "service":
        draw.arc((x0+s*.13,y0+s*.12,x1-s*.13,y1-s*.12),180,360,fill=color,width=lw)
        draw.rounded_rectangle((x0+s*.08,cy-s*.02,x0+s*.25,cy+s*.3),radius=lw,fill=color)
        draw.rounded_rectangle((x1-s*.25,cy-s*.02,x1-s*.08,cy+s*.3),radius=lw,fill=color)
        draw.arc((cx-s*.05,cy+s*.16,cx+s*.27,y1-s*.04),0,100,fill=color,width=lw//2)
    elif kind == "wallet":
        draw.rounded_rectangle((x0+s*.08,y0+s*.2,x1-s*.08,y1-s*.16),radius=lw,fill=color,outline=GOLD_DARK,width=lw//2)
        draw.rounded_rectangle((cx,y0+s*.39,x1-s*.02,y0+s*.68),radius=lw,fill=GOLD_HI,outline=BLUE_DARK,width=lw//2)
        draw.ellipse((cx+s*.13,cy-lw,cx+s*.13+2*lw,cy+lw),fill=BLUE_DARK)
    elif kind == "announcement":
        draw.polygon([(x0+s*.08,cy-s*.12),(cx-s*.05,y0+s*.18),(cx-s*.05,y1-s*.18),(x0+s*.08,cy+s*.12)],fill=color)
        draw.rectangle((cx-s*.05,cy-s*.17,x1-s*.12,cy+s*.17),fill=color)
        draw.arc((cx+s*.05,y0+s*.03,x1,y1-s*.03),290,70,fill=color,width=lw)
    elif kind == "money":
        for i in range(3):
            yy=y0+s*(.28+.22*i)
            draw.ellipse((x0+s*.12,yy-s*.12,x1-s*.12,yy+s*.12),fill=color,outline=GOLD_DARK,width=lw//2)
        draw.polygon([(cx,cy-s*.15),(cx+s*.2,cy+s*.03),(cx+s*.07,cy+s*.03),(cx+s*.07,cy+s*.23),(cx-s*.07,cy+s*.23),(cx-s*.07,cy+s*.03),(cx-s*.2,cy+s*.03)],fill=BLUE_DARK)


def labeled_button(name: str, text: str, kind: str, size=(280, 96), font=29) -> None:
    im = panel((size[0]*SS, size[1]*SS), radius=18*SS).resize((size[0]*SS,size[1]*SS),Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    if kind:
        icon(d, kind, (18, 18, 78, 78))
    draw_art_text(im, text, (size[0]//2 + (18 if kind else 0), size[1]//2), font)
    save(im.resize(size, Image.Resampling.LANCZOS), name)


def title_asset(name: str, text: str, size=(360, 72), font=38) -> None:
    im = Image.new("RGBA", (size[0]*SS, size[1]*SS), (0,0,0,0))
    draw_art_text(im, text, (size[0]//2, size[1]//2), font)
    save(im.resize(size, Image.Resampling.LANCZOS), name)


def nav_item(name: str, text: str, kind: str, selected=False) -> None:
    size=(130,132)
    im=Image.new("RGBA",(size[0]*SS,size[1]*SS),(0,0,0,0))
    d=ImageDraw.Draw(im)
    icon(d,kind,(37,12,93,68))
    draw_art_text(im,text,(65,98),24)
    if selected:
        d.rounded_rectangle((34*SS,124*SS,96*SS,128*SS),radius=2*SS,fill=CYAN)
    save(im.resize(size,Image.Resampling.LANCZOS),name)


def input_asset(name: str, kind: str, size=(620,112)) -> None:
    im=panel((size[0]*SS,size[1]*SS),radius=18*SS).resize((size[0]*SS,size[1]*SS),Image.Resampling.LANCZOS)
    d=ImageDraw.Draw(im)
    icon(d,kind,(28,22,92,86))
    d.line((120*SS,22*SS,120*SS,90*SS),fill=(205,214,207,180),width=1*SS)
    save(im.resize(size,Image.Resampling.LANCZOS),name)


def main() -> None:
    OUT.mkdir(parents=True,exist_ok=True)
    folder_meta=OUT.with_suffix(".meta")
    if not folder_meta.exists():
        folder_meta.write_text(json.dumps({"ver":"1.1.3","uuid":stable_uuid("folder:V7"),"importer":"folder","isBundle":False,"bundleName":"","priority":1,"compressionType":{},"optimizeHotUpdate":{},"inlineSpriteFrames":{},"isRemoteBundle":{},"subMetas":{}},indent=2)+"\n")

    bg=Image.open(SOURCE/"casino_background_master.png").convert("RGB")
    save(cover(bg,(750,1334)),"casino_bg.png")
    gift=Image.open(PREVIEW/"05-赠送.png").convert("RGB").crop((0,95,941,500))
    save(cover(gift,(750,323)),"gift_hero.png")

    shield=Image.open(SOURCE/"8l_shield_master.png").convert("RGBA")
    shield_data=np.array(shield)
    rgb=shield_data[:,:,:3].astype(np.int16)
    alpha=shield_data[:,:,3]
    # Image extraction occasionally leaves isolated red/yellow fringe pixels.
    # Remove those pixels and very-low-alpha noise before any downsampling so
    # both the hero and navigation shields keep a clean antialiased silhouette.
    fringe=((rgb[:,:,0] > rgb[:,:,1] + 45) & (rgb[:,:,0] > rgb[:,:,2] + 65) & (alpha < 220))
    alpha[(alpha < 18) | fringe]=0
    shield_data[:,:,3]=alpha
    shield=Image.fromarray(shield_data,"RGBA")
    save(shield,"shield_hd.png")
    save(shield.resize((188,198),Image.Resampling.LANCZOS),"shield_room.png")
    save(shield.resize((146,154),Image.Resampling.LANCZOS),"shield_nav.png")

    save(panel((180,110),20),"panel_slice.png",True)
    save(panel((180,110),20,True),"panel_selected_slice.png",True)
    save(panel((180,110),16),"room_card_slice.png",True)
    save(panel((180,110),16),"row_slice.png",True)
    save(panel((180,110),24),"profile_panel_slice.png",True)
    save(panel((180,110),20),"input_slice.png",True)
    nav=vertical_gradient((750*SS,155*SS),(31,91,128,255),(2,28,51,255))
    nd=ImageDraw.Draw(nav); nd.line((0,1*SS,750*SS,1*SS),fill=(190,177,143,220),width=1*SS)
    save(nav.resize((750,155),Image.Resampling.LANCZOS),"nav_bar.png")

    input_asset("input_user.png","user")
    input_asset("input_password.png","lock")
    labeled_button("login_button.png","登 录","",(550,100),36)
    labeled_button("gift_confirm.png","确认赠送","gift",(420,92),32)
    labeled_button("settlement_return.png","返回大厅","",(360,88),32)
    for filename,text,kind in [
        ("lobby_ranking.png","排行榜","ranking"),("lobby_match.png","比赛场","match"),("lobby_report.png","举报反馈","report")]:
        labeled_button(filename,text,kind,(220,86),27)
    for filename,text,kind in [
        ("mine_agent.png","我的代理","user"),("mine_promotion.png","游戏推广","promotion"),
        ("mine_money.png","金币流向","money"),("mine_gift.png","赠送金币","gift"),
        ("mine_record.png","我的战绩","record"),("mine_settings.png","系统设置","settings")]:
        labeled_button(filename,text,kind,(340,94),29)

    title_asset("title_records.png","我的战绩")
    title_asset("title_gift.png","赠送礼物")
    title_asset("title_gift_history.png","赠送记录",(300,58),30)
    title_asset("title_settlement.png","牌局结算")
    title_asset("title_lobby.png","健康游戏提示：理性娱乐 适度游戏",(610,64),25)
    title_asset("link_reset.png","重置密码",(210,54),25)
    title_asset("link_register.png","快速注册",(210,54),25)

    for key,text in [("all","全部"),("small","小皮"),("middle","中皮"),("large","大皮")]:
        for sel in (False,True):
            im=panel((110*SS,62*SS),radius=14*SS,selected=sel).resize((110*SS,62*SS),Image.Resampling.LANCZOS)
            draw_art_text(im,text,(55,31),24,fill=BLUE_DARK if sel else GOLD_HI,stroke=(0,0,0,0),width=0)
            save(im.resize((110,62),Image.Resampling.LANCZOS),f"filter_{key}{'_sel' if sel else ''}.png")

    for key,text in [("today","今日"),("yesterday","昨日"),("before","前日")]:
        for sel in (False,True):
            im=panel((210*SS,62*SS),radius=14*SS,selected=sel).resize((210*SS,62*SS),Image.Resampling.LANCZOS)
            draw_art_text(im,text,(105,31),25,fill=BLUE_DARK if sel else GOLD_HI,stroke=(0,0,0,0),width=0)
            save(im.resize((210,62),Image.Resampling.LANCZOS),f"date_{key}{'_sel' if sel else ''}.png")

    for filename,text in [("filter_join.png","⚡ 快速加入"),("filter_free.png","□ 有空位")]:
        im=Image.new("RGBA",(180*SS,62*SS),(0,0,0,0))
        draw_art_text(im,text,(90,31),22)
        save(im.resize((180,62),Image.Resampling.LANCZOS),filename)

    for text,kind in [("公告","announcement"),("客服","service"),("钱包","wallet"),("我的","mine")]:
        nav_item(f"nav_{kind}.png",text,kind,False)
        nav_item(f"nav_{kind}_sel.png",text,kind,True)

    # Medal/rank frames remain separate from live avatar images.
    for key,label,metal in [("runner","亚军",(205,222,230,255)),("mvp","MVP",GOLD_HI),("third","季军",(218,171,128,255))]:
        im=Image.new("RGBA",(210*SS,245*SS),(0,0,0,0)); d=ImageDraw.Draw(im)
        d.ellipse((20*SS,10*SS,190*SS,180*SS),outline=metal,width=6*SS)
        d.ellipse((27*SS,17*SS,183*SS,173*SS),outline=GOLD_DARK,width=2*SS)
        tag=panel((150*SS,52*SS),radius=10*SS).resize((150*SS,52*SS),Image.Resampling.LANCZOS)
        im.alpha_composite(tag,(30*SS,164*SS)); draw_art_text(im,label,(105,190),27,fill=metal)
        save(im.resize((210,245),Image.Resampling.LANCZOS),f"rank_{key}.png")

    for name,text,kind in [("give_user.png","ID","user"),("give_amount.png","赠送金额","money"),("give_password.png","交易密码","lock")]:
        im=panel((660*SS,92*SS),radius=15*SS).resize((660*SS,92*SS),Image.Resampling.LANCZOS);d=ImageDraw.Draw(im)
        icon(d,kind,(22,17,78,73)); draw_art_text(im,text,(100,46),24,anchor="lm")
        d.line((230*SS,18*SS,230*SS,74*SS),fill=(195,203,195,150),width=1*SS)
        save(im.resize((660,92),Image.Resampling.LANCZOS),name)


if __name__ == "__main__":
    main()
