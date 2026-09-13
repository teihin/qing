#!/usr/bin/env python3
"""Offline view of serialized recharge sprites, nine-slices and live labels.

This reads the formal Prefab, applies native Widget/Layout geometry, and writes
QA images outside assets. It is not Creator/runtime validation.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from apply_v7_prefab_skin import Prefab

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'art_sources/v8-repairs/wallet-recharge/qa'


def nine(im, size, frame):
    w,h=im.size;ow,oh=size
    l,r,t,b=[frame[k] for k in ['borderLeft','borderRight','borderTop','borderBottom']]
    xs=[0,l,w-r,w];ys=[0,t,h-b,h];xx=[0,l,ow-r,ow];yy=[0,t,oh-b,oh]
    out=Image.new('RGBA',size)
    for j in range(3):
        for i in range(3):
            part=im.crop((xs[i],ys[j],xs[i+1],ys[j+1]))
            out.paste(part.resize((xx[i+1]-xx[i],yy[j+1]-yy[j]),Image.Resampling.BILINEAR),(xx[i],yy[j]))
    return out


def render(height=1334, prefab=None, name=None, out_dir=None):
    p=prefab or Prefab('assets/resources/Prefabs/钱包.prefab')
    assets={}
    for f in (ROOT/'assets/resources/V7').glob('*.png.meta'):
        for frame in json.loads(f.read_text())['subMetas'].values():
            assets[frame['uuid']]=(Path(str(f)[:-5]),frame)
    output=Image.new('RGBA',(750,height));boxes={}
    def walk(n,parent_origin,parent_size,parent_anchor,path,clip=None,override=None):
        obj=p.data[n]
        if not obj.get('_active',True):return
        w,h=[obj['_contentSize'][key] for key in ['width','height']]
        ax,ay=[obj['_anchorPoint'][key] for key in ['x','y']]
        pw,ph=parent_size;pax,pay=parent_anchor
        x,y=obj['_trs']['array'][:2]
        if override is not None:x,y=override
        _,wg=p.component(n,'cc.Widget')
        if wg and wg['_enabled']:
            flags=wg['_alignFlags']
            if flags&8 and flags&32:
                w=pw-wg['_left']-wg['_right'];x=-pw*pax+wg['_left']+w*ax
            elif flags&16:x=pw*(.5-pax)+wg['_horizontalCenter']
            if flags&1 and flags&4:
                h=ph-wg['_top']-wg['_bottom'];y=ph*(1-pay)-wg['_top']-h*(1-ay)
            elif flags&1:y=ph*(1-pay)-wg['_top']-h*(1-ay)
            elif flags&4:y=-ph*pay+wg['_bottom']+h*ay
            elif flags&2:y=ph*(.5-pay)+wg['_verticalCenter']
        ox,oy=parent_origin[0]+x,parent_origin[1]+y
        left=ox-w*ax;top=height-(oy+h*(1-ay))
        rect=(round(left),round(top),round(left+w),round(top+h));boxes[path]=rect
        layer=Image.new('RGBA',output.size)
        _,sp=p.component(n,'cc.Sprite')
        if sp and sp['_enabled'] and w>0 and h>0:
            entry=assets.get((sp.get('_spriteFrame') or {}).get('__uuid__'))
            if entry:
                f,frame=entry;im=Image.open(f).convert('RGBA');size=(max(1,round(w)),max(1,round(h)))
                im=nine(im,size,frame) if sp['_type']==1 else im.resize(size,Image.Resampling.LANCZOS)
                layer.alpha_composite(im,(round(left),round(top)))
        _,label=p.component(n,'cc.Label')
        if label and label['_enabled']:
            font=ImageFont.truetype(str(ROOT/'assets/font/PingFF.ttf'),round(label['_fontSize']))
            text=label.get('_string','');lines=[]
            for line in text.split('\n'):
                if label.get('_enableWrapText'):
                    row=''
                    for char in line:
                        if font.getlength(row+char)>w and row:lines.append(row);row=''
                        row+=char
                    lines.append(row)
                else:lines.append(line)
            draw=ImageDraw.Draw(layer);lh=label['_lineHeight'];color=tuple(obj['_color'][c] for c in 'rgb')+(255,)
            ty=top+(h-len(lines)*lh)/2
            for line in lines:
                tx=left+(w-font.getlength(line))/2 if label['_N$horizontalAlign']==1 else left
                box=font.getbbox(line);draw.text((tx,ty+(lh-(box[3]-box[1]))/2-box[1]),line,font=font,fill=color,
                    stroke_width=1 if label.get('_styleFlags',0)&1 else 0)
                ty+=lh
        if clip:
            mask=Image.new('L',output.size);ImageDraw.Draw(mask).rectangle(clip,fill=255)
            alpha=layer.getchannel('A');from PIL import ImageChops
            layer.putalpha(ImageChops.multiply(alpha,mask))
        output.alpha_composite(layer)
        _,mask=p.component(n,'cc.Mask')
        if mask and mask['_enabled']:
            clip=rect if clip is None else (max(clip[0],rect[0]),max(clip[1],rect[1]),min(clip[2],rect[2]),min(clip[3],rect[3]))
        _,layout=p.component(n,'cc.Layout');idx=0
        for ref in obj['_children']:
            ch=ref['__id__'];over=None
            if layout and layout['_enabled'] and layout['_N$layoutType']==3 and p.data[ch]['_active']:
                cw=layout['_N$cellSize']['width'];chh=layout['_N$cellSize']['height']
                gx=layout['_N$spacingX'];gy=layout['_N$spacingY'];cols=int((w+gx)/(cw+gx))
                over=(-w*ax+cw/2+(idx%cols)*(cw+gx),h*(1-ay)-chh/2-(idx//cols)*(chh+gy));idx+=1
            walk(ch,(ox,oy),(w,h),(ax,ay),path+'/'+p.data[ch]['_name'],clip,over)
    for ref in p.data[p.root]['_children']:
        walk(ref['__id__'],(375,height/2),(750,height),(.5,.5),p.data[p.root]['_name']+'/'+p.data[ref['__id__']]['_name'])
    folder=out_dir or OUT;folder.mkdir(parents=True,exist_ok=True)
    file=folder/f'{name or "recharge"}-{height}.png';output.save(file)
    (folder/f'{name+"-" if name else ""}geometry-{height}.json').write_text(json.dumps(boxes,ensure_ascii=False,indent=2)+'\n')
    print(file)
    return output,boxes


if __name__=='__main__':
    for height in [1334,1500,1624,1778]:render(height)
