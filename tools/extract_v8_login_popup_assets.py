#!/usr/bin/env python3
"""Extract fixed popup art from the approved V8-new login/popup sheets."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
from apply_v8_login import update_meta

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "design-previews/效果图V8-new/04-登录与弹窗"
OUT = ROOT / "assets/resources/V7"
REPAIRS = ROOT / "art_sources/v8-repairs"

def crop(name: str, box: tuple[int,int,int,int], out: str, size: tuple[int,int], clear: tuple[int,int,int,int] | None = None) -> None:
    image = Image.open(SRC / name).convert("RGBA").crop(box).resize(size, Image.Resampling.LANCZOS)
    if clear:
        # Prepared imagegen material replaces the entire empty well. Never
        # smear a source column across each row: that creates horizontal bars.
        repaired = Image.open(REPAIRS / "popup-clean-generated.png").convert('RGBA').resize(size, Image.Resampling.LANCZOS)
        mask=Image.new('L',size)
        ImageDraw.Draw(mask).rounded_rectangle(clear,radius=12,fill=255)
        image=Image.composite(repaired,image,mask)
        silhouette=Image.new('L',size)
        ImageDraw.Draw(silhouette).rounded_rectangle((0,0,size[0]-1,size[1]-1),radius=24,fill=255)
        image.putalpha(silhouette)
    image.save(OUT / out)
    meta = OUT / (out + ".meta")
    data = json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {"ver": "2.3.7", "uuid": str(uuid.uuid4()), "importer": "texture", "type": "sprite", "wrapMode": "clamp", "filterMode": "bilinear", "premultiplyAlpha": False, "genMipmaps": False, "platformSettings": {}}
    stem = Path(out).stem
    sub = data.setdefault("subMetas", {}).setdefault(stem, {"ver": "1.0.6", "uuid": str(uuid.uuid4()), "importer": "sprite-frame", "rawTextureUuid": data["uuid"], "trimType": "none", "trimThreshold": 1, "rotated": False, "offsetX": 0, "offsetY": 0, "trimX": 0, "trimY": 0, "borderTop": 0, "borderBottom": 0, "borderLeft": 0, "borderRight": 0, "subMetas": {}})
    sub["width"], sub["height"] = image.size
    sub["rawWidth"], sub["rawHeight"] = image.size
    data["packable"] = False
    meta.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def small(source, box, output, buttons):
    original=Image.open(SRC/source).convert('RGBA').crop(box)
    # Use uniform scale inside the existing fixed dialog canvas. The dual
    # reference has different crop bounds: its bottom border must not be cut.
    factor=532/original.width
    h=round(original.height*factor)
    original=original.resize((532,h),Image.Resampling.LANCZOS)
    y=(366-h)//2
    image=Image.new('RGBA',(532,366))
    image.alpha_composite(original,(0,y))
    material=Image.open(REPAIRS/'popup-small-clean-generated.png').convert('RGBA').resize((532,366),Image.Resampling.LANCZOS)
    # The generator's material only; its generated title/button are discarded.
    field=material.crop((10,64,522,247)).resize((514,h-36),Image.Resampling.LANCZOS)
    replacement=Image.new('RGBA',image.size)
    replacement.alpha_composite(field,(9,y+28))
    clear=Image.new('L',image.size);d=ImageDraw.Draw(clear)
    d.rounded_rectangle((9,y+28,522,y+h-9),radius=14,fill=255)
    title_bottom=round((650-box[1])*factor) if '取消' in source else round((632-box[1])*factor)
    d.rounded_rectangle((116,y-2,415,y+title_bottom+3),radius=22,fill=0)
    for b in buttons:
        r=tuple(round((v-box[i%2])*factor)+(y if i%2 else 0) for i,v in enumerate(b))
        d.rounded_rectangle((r[0]-2,r[1]-2,r[2]+2,r[3]+4),radius=9,fill=0)
    image=Image.composite(replacement,image,clear)
    silhouette=Image.new('L',image.size);d=ImageDraw.Draw(silhouette)
    body_top=round((605-box[1])*factor) if '取消' in source else round((589-box[1])*factor)
    d.rounded_rectangle((0,y+body_top,531,y+h-1),radius=23,fill=255)
    d.rounded_rectangle((117,y,413,y+title_bottom),radius=22,fill=255)
    image.putalpha(silhouette)
    image.save(OUT/output);update_meta(output)

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Fixed announcement dialog, with the scrolling message surface cleared.
    crop("01-公告弹窗-大内容区.png", (74,324,867,1381), "popup_announcement_latest_v8_exact.png", (632,840), (26,88,605,725))
    small('02-普通弹窗-单确定.png',(138,566,805,994),'popup_message_single_v8_exact.png',[(339,864,601,944)])
    small('03-普通弹窗-取消和确定.png',(137,581,804,1026),'popup_message_dual_v8_exact.png',[(195,898,455,978),(487,898,746,978)])
    for prepared,formal in [('popup_announcement_latest_v8_exact.png','popup_announcement_latest_exact_nobar.png'),
                            ('popup_message_single_v8_exact.png','popup_message_single_exact.png'),
                            ('popup_message_dual_v8_exact.png','popup_message_dual_exact.png')]:
        (OUT/formal).write_bytes((OUT/prepared).read_bytes());update_meta(formal)
    print("V8 弹窗已使用干净内面，保留正式 UUID 和定稿边框/标题/按钮")

if __name__ == "__main__":
    main()
