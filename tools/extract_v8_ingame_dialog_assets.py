#!/usr/bin/env python3
"""Generate two shared V8 dialog chrome textures.

The gold button is cut from the approved V8 confirmation dialog; the header
uses the dedicated ImageGen source at art_sources/ingame-dialogs-v8.
Other dialog chrome reuses formal V8 textures already in the project.
This script does not modify Prefabs, Scenes or any shared existing asset.
"""
from pathlib import Path
import json
import uuid
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'design-previews/效果图V8-new/04-登录与弹窗/03-普通弹窗-取消和确定.png'
HEADER_SOURCE = ROOT / 'art_sources/ingame-dialogs-v8/header-redesigned.png'
OUT = ROOT / 'assets/V7'

def clean_middle(im, edge, top=5, bottom=5):
    a=np.array(im).astype(float); h,w=a.shape[:2]
    t=np.linspace(0,1,w-2*edge)[None,:,None]
    a[top:h-bottom,edge:w-edge,:3]=a[top:h-bottom,edge:edge+1,:3]*(1-t)+a[top:h-bottom,w-edge-1:w-edge,:3]*t
    return Image.fromarray(a.astype('uint8'))

def compact(im, target, border):
    w,h=im.size; tw,th=target; out=Image.new('RGBA',target)
    sx=(0,border,w-border,w); sy=(0,border,h-border,h)
    dx=(0,border,tw-border,tw); dy=(0,border,th-border,th)
    for y in range(3):
        for x in range(3):
            piece=im.crop((sx[x],sy[y],sx[x+1],sy[y+1]))
            piece=piece.resize((dx[x+1]-dx[x],dy[y+1]-dy[y]),Image.Resampling.LANCZOS)
            out.paste(piece,(dx[x],dy[y]))
    return out

def save(key, im, border):
    p=OUT/f'ingame_dialog_v8_{key}.png'; im.save(p,optimize=True)
    texture=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-ingame-dialog/texture/'+key))
    frame=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-ingame-dialog/frame/'+key))
    w,h=im.size
    sub=dict(ver='1.0.6',uuid=frame,importer='sprite-frame',rawTextureUuid=texture,
             trimType='none',trimThreshold=1,rotated=False,offsetX=0,offsetY=0,
             trimX=0,trimY=0,width=w,height=h,rawWidth=w,rawHeight=h,
             borderTop=border,borderBottom=border,borderLeft=border,borderRight=border,subMetas={})
    meta=dict(ver='2.3.7',uuid=texture,importer='texture',type='sprite',wrapMode='clamp',
              filterMode='bilinear',premultiplyAlpha=False,genMipmaps=False,packable=True,
              width=w,height=h,platformSettings={},subMetas={p.stem:sub})
    p.with_suffix('.png.meta').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')

def main():
    src=Image.open(SOURCE).convert('RGBA')
    gold=clean_middle(src.crop((487,897,747,979)),32)
    mask=Image.new('L',(1040,328));ImageDraw.Draw(mask).rounded_rectangle((4,4,1035,323),56,fill=255)
    gold.putalpha(mask.resize(gold.size,Image.Resampling.LANCZOS))
    gold=gold.resize((208,66),Image.Resampling.LANCZOS)
    save('gold_button',compact(gold,(96,66),16),16)
    header=Image.open(HEADER_SOURCE).convert('RGBA')
    if header.size != (144,58):
        raise ValueError(f'Header source must be 144x58, got {header.size}: {HEADER_SOURCE}')
    save('header',header,25)
    preview=Image.new('RGBA',(640,200),(5,33,51,255))
    for key,x,size in [('header',20,(300,70)),('gold_button',350,(260,78))]:
        p=Image.open(OUT/f'ingame_dialog_v8_{key}.png')
        # Preview the same nine-slice behavior used by the formal Sprite.
        border=25 if key=='header' else 16
        preview.alpha_composite(compact(p,size,border),(x,55))
    dest=ROOT/'art_sources/ingame-dialogs-v8';dest.mkdir(parents=True,exist_ok=True)
    preview.save(dest/'shared-chrome.png')
    print('Wrote 2 shared V8 textures:',sum((OUT/f'ingame_dialog_v8_{x}.png').stat().st_size for x in ('header','gold_button')),'bytes')

if __name__=='__main__': main()
