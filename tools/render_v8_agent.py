#!/usr/bin/env python3
"""Offline agent QA from the serialized Prefab, including its source-cut bitmap font.

This reads the formal Prefab, applies native Widget/Layout geometry, and writes
QA images outside assets. It is not Creator/runtime validation.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops
from apply_v7_prefab_skin import Prefab

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'art_sources/v8-repairs/agent/qa'
import re
from apply_v8_agent import PAGE,LISTS,POPS
FONT_UUID=json.loads((ROOT/'assets/resources/V7/agent_v8_digits.fnt.meta').read_text())['uuid']
GLYPHS={int(d['id']):d for d in (dict((k,int(v)) for k,v in re.findall(r'(\w+)=(-?\d+)',line)) for line in (ROOT/'assets/resources/V7/agent_v8_digits.fnt').read_text().splitlines() if line.startswith('char '))}
ATLAS=Image.open(ROOT/'assets/resources/V7/agent_v8_digits.png').convert('RGBA')


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
    p=prefab or Prefab(PAGE)
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
                channels=list(im.split());color=obj.get('_color',{'r':255,'g':255,'b':255})
                for i,key in enumerate('rgb'):channels[i]=channels[i].point(lambda x:x*color[key]/255)
                channels[3]=channels[3].point(lambda x:x*obj.get('_opacity',255)/255)
                im=Image.merge('RGBA',channels)
                layer.alpha_composite(im,(round(left),round(top)))
        _,label=p.component(n,'cc.Label')
        if label and label['_enabled'] and label.get('_N$file',{}).get('__uuid__')==FONT_UUID:
            scale=label['_fontSize']/64;text=label.get('_string','');glyphs=[GLYPHS.get(ord(c)) for c in text]
            tw=sum(g['xadvance'] for g in glyphs if g)*scale
            tx=left+(w-tw)/2 if label['_N$horizontalAlign']==1 else left
            ty=top+(h-68*scale)/2
            for g in glyphs:
                if not g:continue
                im=ATLAS.crop((g['x'],g['y'],g['x']+g['width'],g['y']+g['height']))
                im=im.resize((max(1,round(g['width']*scale)),max(1,round(g['height']*scale))),Image.Resampling.LANCZOS)
                layer.alpha_composite(im,(round(tx),round(ty+g['yoffset']*scale)));tx+=g['xadvance']*scale
        elif label and label['_enabled']:
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


def sample(page=None,count=6):
    p=Prefab(PAGE)
    for name,_ in LISTS+POPS:p.set_active(p.node(name),False)
    p.set_active(p.node('推广二维码'),False)
    if page:p.set_active(p.node(page),True)
    if page=='修改盟主面板':
        for fld,value in [('name','示例盟主'),('id','123456')]:
            c=p.component(p.node(page+'/bk/'+fld),'cc.Label')[1];c['_string']=c['_N$string']=value
    values={'红利余额/num':'8,888.00','统计/累计总红利/num':'26,800','统计/累计总提取/num':'17,912','统计/V8今日红利':'386','数据/上级ID':'659348','数据/我的ID':'157710','数据/下级玩家':'86','数据/今日新增':'5','红利统计/今日红利':'386','红利统计/昨日红利':'528','红利统计/前日红利':'419'}
    for path,value in values.items():
        c=p.component(p.node(path),'cc.Label')[1];c['_string']=c['_N$string']=value
    if count<6:p.set_active(p.node('操作/我的盟主'),False)
    if count<5:p.set_active(p.node('操作/总业绩'),False)
    p.data[p.node('操作')]['_contentSize']['width']=422 if count<=4 else 640
    return p

if __name__=='__main__':
    for height,count in [(1334,6),(1624,4),(1624,5)]:render(height,sample(count=count),name='home-'+str(count))
    for page in ['我的玩家','我的业绩','总业绩','奖池收益','修改盟主面板']:
        render(1624,sample(page),name=page)
