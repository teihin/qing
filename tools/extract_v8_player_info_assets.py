#!/usr/bin/env python3
"""Cut the approved player popup into reusable, compact Cocos textures.

Only writes player_info_v8 PNG/meta files and the resource contact sheet.
Interior cleanup excludes source text/values; borders and icons retain source art.
"""
from pathlib import Path
from collections import deque
import json
import uuid
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/V7'
SOURCE = ROOT / 'design-previews/效果图V8-new/04-登录与弹窗/05-玩家信息弹窗.png'
SRC = Image.open(SOURCE).convert('RGBA')
S = 750 / 941

def save(name, im, border=0):
    path = OUT / ('player_info_v8_' + name + '.png')
    im.save(path, optimize=True)
    tex = str(uuid.uuid5(uuid.NAMESPACE_URL, 'qing/player_info_v8/texture/' + name))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, 'qing/player_info_v8/' + name))
    w, h = im.size
    sub = dict(ver='1.0.6', uuid=frame, importer='sprite-frame', rawTextureUuid=tex,
               trimType='none', trimThreshold=1, rotated=False, offsetX=0, offsetY=0,
               trimX=0, trimY=0, width=w, height=h, rawWidth=w, rawHeight=h,
               borderTop=border, borderBottom=border, borderLeft=border, borderRight=border, subMetas={})
    meta = dict(ver='2.3.7', uuid=tex, importer='texture', type='sprite', wrapMode='clamp',
                filterMode='bilinear', premultiplyAlpha=False, genMipmaps=False, packable=True,
                width=w, height=h, platformSettings={}, subMetas={path.stem:sub})
    path.with_suffix('.png.meta').write_text(json.dumps(meta, ensure_ascii=False, indent=2)+'\n')

def rounded(im, radius, inset=0):
    k=4; w,h=im.size
    mask=Image.new('L',(w*k,h*k)); ImageDraw.Draw(mask).rounded_rectangle(
        (inset*k,inset*k,(w-inset)*k-1,(h-inset)*k-1),radius*k,fill=255)
    im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS)); return im

def compact(im, size, border):
    """Preserve all four borders; resample just the empty center strips."""
    w,h=im.size; tw,th=size; b=border
    out=Image.new('RGBA',size)
    xx=[0,b,w-b,w]; yy=[0,b,h-b,h]
    tx=[0,b,tw-b,tw]; ty=[0,b,th-b,th]
    for y in range(3):
        for x in range(3):
            p=im.crop((xx[x],yy[y],xx[x+1],yy[y+1]))
            p=p.resize((tx[x+1]-tx[x],ty[y+1]-ty[y]),Image.Resampling.LANCZOS)
            out.paste(p,(tx[x],ty[y]))
    return out

def scale(im): return im.resize((round(im.width*S),round(im.height*S)),Image.Resampling.LANCZOS)

def glyph(box):
    a=np.array(SRC.crop(box)).astype(float)
    # Ivory/gold artwork is separable from the deep blue surface.
    alpha=np.clip((a[:,:,0]-25)/70,0,1)
    a[:,:,3]=alpha*255
    return Image.fromarray(a.astype('uint8'))

def blank_horizontal(box, edge, remove_rows=()):
    im=SRC.crop(box); a=np.array(im).astype(float); h,w=a.shape[:2]
    t=np.linspace(0,1,w-2*edge)[None,:,None]
    a[:,edge:w-edge,:3]=a[:,edge:edge+1,:3]*(1-t)+a[:,w-edge-1:w-edge,:3]*t
    for lo,hi in remove_rows:
        f=np.linspace(0,1,hi-lo)[:,None,None]
        a[lo:hi,18:w-18,:3]=a[lo-2:lo-1,18:w-18,:3]*(1-f)+a[hi+1:hi+2,18:w-18,:3]*f
    return Image.fromarray(a.astype('uint8'))

def panel():
    box=(38,220,903,1633); a=np.array(SRC.crop(box)).astype(float); h,w=a.shape[:2]
    source=np.array(SRC).astype(float)
    ys=np.array([260,400,570,720,1145,1575,1600])
    centers=np.array([source[y,470,:3] for y in ys])
    for y in range(32,h-32):
        gy=y+220
        mid=np.array([np.interp(gy,ys,centers[:,c]) for c in range(3)])
        left=source[gy,70,:3]; right=source[gy,871,:3]
        x=np.arange(32,w-32); split=w//2
        for c in range(3): a[y,32:w-32,c]=np.interp(x,[32,split,w-33],[left[c],mid[c],right[c]])
    # Upper-right corner overlaps the separate close glyph: use the matching
    # clean upper-left corner, preserving the original metal rim and cyan light.
    a[:64,w-64:]=a[:64,:64][:,::-1]
    im=rounded(Image.fromarray(a.astype('uint8')),62,2)
    im=scale(im); save('panel',compact(im,(128,384),48),48)

def flood_icon(box):
    im=SRC.crop(box); a=np.array(im).astype(float); h,w=a.shape[:2]
    left=np.median(a[:,:3,:3],axis=1); right=np.median(a[:,-3:,:3],axis=1)
    t=np.linspace(0,1,w)[None,:,None]
    bg=left[:,None,:]*(1-t)+right[:,None,:]*t
    candidate=np.sum((a[:,:,:3]-bg)**2,axis=2)<38**2
    seen=np.zeros((h,w),bool); q=deque()
    for x in range(w): q.extend(((0,x),(h-1,x)))
    for y in range(h): q.extend(((y,0),(y,w-1)))
    while q:
        y,x=q.popleft()
        if x<0 or y<0 or x>=w or y>=h or seen[y,x] or not candidate[y,x]: continue
        seen[y,x]=True; q.extend(((y-1,x),(y+1,x),(y,x-1),(y,x+1)))
    # Remove tiny disconnected background islands while keeping the silhouette.
    alpha=Image.fromarray((~seen).astype('uint8')*255)
    a[:,:,3]=np.array(alpha)
    im=Image.fromarray(a.astype('uint8')); bounds=alpha.getbbox()
    return im.crop((max(0,bounds[0]-2),max(0,bounds[1]-2),min(w,bounds[2]+2),min(h,bounds[3]+2)))

def run():
    panel()
    button=blank_horizontal((493,608,857,701),62)
    button=rounded(button,46,2); save('button',compact(scale(button),(104,74),32),32)
    stats=blank_horizontal((89,735,855,1137),48,((145,153),(258,266)))
    # Erase the two short vertical rule ends in the top and bottom border bands.
    a=np.array(stats)
    for x in (257,510):
        for y0,y1 in ((0,48),(354,402)):
            a[y0:y1,x-2:x+3]=a[y0:y1,x-5:x-4]
    stats=rounded(Image.fromarray(a),43,2)
    save('stats',compact(scale(stats),(128,160),32),32)
    card=blank_horizontal((108,1184,344,1365),35)
    card=rounded(card,23,2); save('prop_card',compact(scale(card),(80,96),20),20)
    save('title',scale(glyph((346,286,598,351))))
    save('divider',scale(glyph((143,357,799,386))))
    save('close',scale(glyph((787,251,866,330))))
    save('copy',scale(glyph((440,432,471,466))))
    save('mic',scale(glyph((151,626,198,685))))
    ring=glyph((103,405,269,556)); ring=ring.resize((132,132),Image.Resampling.LANCZOS)
    # Source avatar is an ellipse. Keep its gold artwork only in a circular rim.
    k=4; mask=Image.new('L',(132*k,132*k)); d=ImageDraw.Draw(mask)
    d.ellipse((2*k,2*k,130*k,130*k),fill=255); d.ellipse((10*k,10*k,122*k,122*k),fill=0)
    ring.putalpha(Image.fromarray(np.minimum(np.array(ring.getchannel('A')),np.array(mask.resize((132,132),Image.Resampling.LANCZOS)))))
    save('avatar_frame',ring)
    # Source switch is separate, never includes the text or surrounding panel.
    toggle=rounded(SRC.crop((775,462,839,505)),21,1)
    save('toggle_on',scale(toggle))
    off=toggle.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    a=np.array(off).astype(float); lum=a[:,:,:3].mean(2)
    a[:,:,:3]=a[:,:,:3]*.23+lum[:,:,None]*np.array([.56,.68,.73])[None,None,:]
    save('toggle_off',scale(Image.fromarray(a.astype('uint8'))))
    boxes={'chicken':(159,1202,295,1322),'bomb':(415,1199,536,1321),
           'gun':(627,1207,802,1323),'shark':(132,1405,307,1511),
           'like':(416,1390,531,1511),'poop':(651,1398,785,1515)}
    for key,box in boxes.items(): save('icon_'+key,flood_icon(box))
    line=Image.new('RGBA',(2,2),(95,167,192,180)); save('grid_line',line)
    # Contact sheet includes source-derived formal textures, never the full design.
    names=['panel','button','stats','prop_card','title','divider','avatar_frame','close','icon_chicken','icon_bomb','icon_gun','icon_shark','icon_like','icon_poop','toggle_on','mic']
    sheet=Image.new('RGBA',(800,600),(5,33,51,255))
    for i,key in enumerate(names):
        im=Image.open(OUT/f'player_info_v8_{key}.png'); im.thumbnail((180,120),Image.Resampling.LANCZOS)
        x=(i%4)*200+(200-im.width)//2; y=(i//4)*150+8
        sheet.alpha_composite(im,(x,y)); ImageDraw.Draw(sheet).text(((i%4)*200+12,(i//4)*150+132),key,fill='white')
    dest=ROOT/'art_sources/player_info_v8_preview.png'; sheet.save(dest)
    paths=list(OUT.glob('player_info_v8_*.png'))
    pixels=sum(Image.open(p).width*Image.open(p).height for p in paths)
    print(json.dumps(dict(textures=len(paths),png_bytes=sum(p.stat().st_size for p in paths),pixels=pixels,rgba_mib=round(pixels*4/1024**2,3))))

if __name__=='__main__': run()
