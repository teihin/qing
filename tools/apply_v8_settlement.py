#!/usr/bin/env python3
"""Author V8-new settlement components. No runtime skin or network changes."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v7_lobby_exact import untint, style_label, fill_parent
from apply_v8_login import update_meta
from repair_v8_record_art import child, reset, contour
from apply_v8_wallet_recharge import compact_panel
from repair_v7_responsive_layout import top, bottom, stretch, ensure_widget

S = 750 / 1024
SOURCE = ROOT / 'design-previews/效果图V8-new/01-主页面/06-结算.png'
OUT = ROOT / 'art_sources/v8-repairs/settlement'
PAGE = 'assets/resources/UI/panelRecordInfo.prefab'
ROW = 'assets/resources/Prefabs/战绩玩家对象.prefab'
CUTS = {}


def save(name, im, box, border=0):
    pixels=np.asarray(im.convert('RGBA')).copy()
    pixels[pixels[:,:,3]==0,:3]=0
    im=Image.fromarray(pixels)
    im.save(ASSET_DIR / name, optimize=True)
    update_meta(name)
    mp = ASSET_DIR / (name + '.meta')
    meta = json.loads(mp.read_text())
    meta['packable'] = border > 0
    frame = meta['subMetas'][Path(name).stem]
    for edge in ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']:
        frame[edge] = border
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    CUTS[name] = dict(box=box, size=im.size, border=border,
                      sha256=hashlib.sha256((ASSET_DIR / name).read_bytes()).hexdigest())


def clean_field(im, box):
    """Smooth four-boundary interpolation, never expand a noisy pixel strip."""
    a = np.asarray(im).copy()
    x0, y0, x1, y1 = box
    smooth = np.asarray(im.filter(ImageFilter.GaussianBlur(3))).astype(float)
    # Boundaries are outside the text; broad averaging removes glyph shadows.
    t = smooth[y0, x0:x1, :3]; b = smooth[y1-1, x0:x1, :3]
    u = np.linspace(0, 1, x1-x0)[:, None]
    for y in range(y0, y1):
        v = (y-y0)/(y1-y0-1)
        side = (1-u)*smooth[y, x0, :3] + u*smooth[y, x1-1, :3]
        corners = (1-u)*((1-v)*t[0]+v*b[0])+u*((1-v)*t[-1]+v*b[-1])
        a[y, x0:x1, :3] = np.clip((1-v)*t+v*b+side-corners, 0, 255)
    return Image.fromarray(a)


def divider(src):
    # Raise the source rule's contrast without stretching a noisy background.
    im = src.crop((50, 735, 974, 737)).convert('RGBA')
    a = np.asarray(im).copy()
    a[:, :, :3] = np.rint(a[:, :, :3] * .65 + np.array([150, 185, 208]) * .35)
    return Image.fromarray(a)


def extract():
    src = Image.open(SOURCE).convert('RGBA')
    assert src.size == (1024, 1536)
    # Trace only the left title plate; no second scenery or baked review button.
    box = (0, 0, 363, 88)
    im = src.crop(box); mask = Image.new('L', (363*4, 88*4))
    pts = [(0,0),(361,0),(327,66),(321,75),(311,81),(297,84),(0,84)]
    ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in pts], fill=255)
    im.putalpha(mask.resize(im.size, Image.Resampling.LANCZOS))
    save('settlement_header_exact.png', im, box)
    # Preserve the approved metallic silhouettes, with real transparent holes.
    # Avatar, name and title pixels are never part of this foreground asset.
    box = (0, 86, 1024, 427)
    mask = Image.new('L', (1024*4, 341*4)); draw = ImageDraw.Draw(mask)
    def ellipse(rect, fill):
        a,b,c,d = rect; draw.ellipse((a*4,(b-86)*4,c*4,(d-86)*4), fill=fill)
    for outer, inner in [((121,209,299,391),(134,223,287,377)),
                         ((383,137,640,392),(397,152,625,379)),
                         ((724,214,905,395),(738,227,892,381))]:
        ellipse(outer,255); ellipse(inner,0)
    for pts in [[(210,183),(225,200),(211,215),(196,200)],
                [(511,95),(532,121),(514,146),(492,121)],
                [(814,182),(829,200),(815,216),(800,200)]]:
        draw.polygon([(x*4,(y-86)*4) for x,y in pts],fill=255)
    # Badge strips are separate; crop the rings above their opaque faceplates.
    for rect in [(146,372,275,427),(433,364,591,427),(754,372,876,427)]:
        a,b,c,d=rect;draw.rectangle((a*4,(b-86)*4,c*4,(d-86)*4),fill=0)
    im = src.crop(box); im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS))
    save('settlement_award_frames_exact.png', im, box)
    for name,box,hole in [('th',(145,369,275,423),(22,13,108,44)),
                          ('mvp',(432,363,592,423),None),
                          ('dy',(754,369,876,423),(22,13,102,44))]:
        im=src.crop(box)
        if hole:im=clean_field(im,hole)
        im=contour(im,(2,2,im.width-3,im.height-4),(13,11))
        save('settlement_badge_'+name+'.png',im,box)
    box=(30,472,994,547);im=src.crop(box);a=np.asarray(im).copy()
    bands=[(278,311),(491,527),(735,769),(922,955)]
    centers=[(l+r)/2-30 for l,r in bands]
    fields=np.stack([np.asarray(src.crop((l,472,r,547)).filter(ImageFilter.GaussianBlur(4)))[:,:,:3].mean(axis=1) for l,r in bands])
    for y in range(9,66):
        for c in range(3):a[y,13:-13,c]=np.interp(np.arange(13,951),centers,fields[:,y,c])
    for x in [322,532,775]:a[20:57,x-30:x-27]=np.asarray(im)[20:57,x-30:x-27]
    im=Image.fromarray(a)
    save('settlement_v8_summary.png',contour(im,(1,1,962,73),(24,24)),box)
    box=(30,558,994,646)
    save('settlement_table_header_exact.png',contour(src.crop(box),(1,1,962,114),(24,0)),box)
    # Fit a continuous, low-frequency 2D blue field from clear source regions.
    # Retain the original rounded frame. No row, text, grain or line is tiled.
    box=(30,641,994,1335);im=src.crop(box);a=np.asarray(im).copy();h,w=a.shape[:2]
    ys=[12,81,84,175,178,265,268,356,359,450,453,537,540,650,661]
    xx,yy=np.meshgrid(np.arange(19,w-19,5),ys)
    xn=xx.ravel()/(w-1);yn=yy.ravel()/(h-1)
    powers=[(i,j) for i in range(4) for j in range(3)]
    design=np.array([xn**i*yn**j for i,j in powers]).T
    coeff=np.linalg.lstsq(design,a[yy.ravel(),xx.ravel(),:3],rcond=None)[0]
    X,Y=np.meshgrid(np.arange(w)/(w-1),np.arange(h)/(h-1))
    field=sum((X**i*Y**j)[...,None]*c for (i,j),c in zip(powers,coeff))
    # Fill the whole interior, with a narrow soft join inside the untouched rim.
    dist=np.minimum.reduce([np.broadcast_to(np.arange(w),(h,w)),np.broadcast_to(np.arange(w)[::-1],(h,w)),np.broadcast_to(np.arange(h)[:,None],(h,w)),np.broadcast_to(np.arange(h)[::-1,None],(h,w))])
    alpha=np.clip((dist-8)/10,0,1)[...,None]
    a[:,:,:3]=np.clip(a[:,:,:3]*(1-alpha)+field*alpha,0,255)
    im=contour(Image.fromarray(a),(0,0,w-1,h-1),(24,24))
    im=im.resize((round(w*S),round(h*S)),Image.Resampling.LANCZOS)
    save('settlement_v8_list_panel.png',compact_panel(im,(256,320),25),box,25)
    # Rows contain only a divider; the shared list panel supplies their material.
    box=(50,735,974,737)
    save('settlement_row_exact.png',divider(src),box)
    for name,box,radius in [('return',(298,1362,727,1460),32),('review',(771,11,1001,78),31)]:
        im=src.crop(box);save('settlement_'+name+'_exact.png',contour(im,(1,1,im.width-2,im.height-2),(radius,radius)),box)
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'cuts.json').write_text(json.dumps(dict(source=str(SOURCE.relative_to(ROOT)),source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),assets=CUTS),ensure_ascii=False,indent=2)+'\n')
    # Old broad source-cut manifest would restore avatar samples and strip fills.
    prepared=OUT/'prepared';prepared.mkdir(exist_ok=True);crops=[]
    for name,cut in CUTS.items():
        Image.open(ASSET_DIR/name).save(prepared/name,optimize=True)
        crops.append(dict(source=str((prepared/name).relative_to(ROOT)),
                          output='assets/resources/V7/'+name,box=[0,0,*cut['size']]))
    (ROOT/'tools/v8_settlement_crops.json').write_text(json.dumps(crops,ensure_ascii=False,indent=2)+'\n')


def label(p,path,x,y,w,h,size,text,align=1,bold=False):
    n=p.node(path);reset(p,n);p.disable(n,'cc.Widget');p.set_active(n,True)
    style_label(p,path,x=x*S,y=y*S,width=w*S,height=h*S,size=round(size*S),preview=text,align=align)
    p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':237,'b':202,'a':255}
    p.component(n,'cc.Label')[1].update(_enabled=True,_enableWrapText=False,_styleFlags=1 if bold else 0)


def apply():
    p=Prefab(PAGE)
    for path in ['', 'V8结算延展底纹','排行']:
        n=p.node(path);p.disable(n,'cc.Sprite');p.component(n,'cc.Sprite')[1]['_spriteFrame']=None
        if path=='V8结算延展底纹':p.set_active(n,False)
    n=p.node('bg');reset(p,n);p.set_active(n,True);p.hide_children(n)
    p.sprite(n,'lobby_scene_long_v8.png');top(p,'bg',0,width=750,height=2353*750/941)
    n=p.node('title');reset(p,n);p.disable(n,'cc.Sprite');top(p,'title',0,width=750,height=86*S)
    n=child(p,p.node('title'),'V8标题底图');p.art(n,'settlement_header_exact.png',(181.5-512)*S,-S,363*S,88*S)
    n=p.node('title/关闭');reset(p,n);p.set_active(n,True);p.art(n,'transparent.png',-455*S,0,112*S,86*S,hide=True);p.disable(n,'cc.Widget')
    p.set_active(p.node('title/战局详情'),False)
    n=p.node('title/牌局回顾');reset(p,n);p.art(n,'settlement_review_exact.png',(886-512)*S,-1.5*S,230*S,67*S,hide=True);p.disable(n,'cc.Widget')
    p.component(n,'cc.Button')[1]['_N$target']={'__id__':n}
    p.data[p.node('title')]['_children']=[{'__id__':p.node('title/'+name)} for name in ['V8标题底图','战局详情','关闭','牌局回顾']]
    ranking=p.node('排行');reset(p,ranking);top(p,'排行',86*S,width=750,height=381*S)
    for name,cx,cy,size in [('土豪',210.5,300,157),('MVP',511,265.5,232),('大鱼',815,304,158)]:
        root=p.node('排行/'+name);reset(p,root);p.set_active(root,True);p.disable(root,'cc.Sprite')
        p.set_pos(root,(cx-512)*S,(276.5-cy)*S,size*S,size*S,disable_widget=True)
        p.set_active(p.node('排行/'+name+'/th'),False)
        mask=p.node('排行/'+name+'/mask');reset(p,mask);p.set_pos(mask,0,0,size*S,size*S,disable_widget=True)
        p.component(mask,'cc.Mask')[1]['_type']=1
        image=p.node('排行/'+name+'/mask/img');reset(p,image);p.set_pos(image,0,0,size*S,size*S)
        ensure_widget(p,image).update(_enabled=True,_alignFlags=45,_left=0,_right=0,_top=0,_bottom=0,alignMode=1)
        label(p,'排行/'+name+'/name',0,cy-445,264,42,32,'',bold=True)
    p.set_active(p.node('排行/劳模'),False)
    n=p.node('排行/V7荣誉框前景');reset(p,n);p.art(n,'settlement_award_frames_exact.png',0,20*S,750,341*S,hide=True);p.disable(n,'cc.Widget')
    for key,cx,cy,w,h in [('th',210,396,130,54),('mvp',512,393,160,60),('dy',815,396,122,54)]:
        n=child(p,ranking,'V8称号_'+key);p.art(n,'settlement_badge_'+key+'.png',(cx-512)*S,(276.5-cy)*S,w*S,h*S)
        if key!='mvp':
            try:title=p.node('排行/V8称号_'+key+'/文字')
            except KeyError:
                # Clone only an existing label, preserving source node IDs.
                from apply_v8_mine import unique_clone
                title=unique_clone(p,p.node('排行/土豪/name'),n,'文字')
            label(p,'排行/V8称号_'+key+'/文字',0,1,w-12,h-6,29,'土豪' if key=='th' else '大鱼',bold=True)
    # Keep node path, Button, Spine and business visibility intact.
    n=p.node('排行/排队');reset(p,n);p.set_pos(n,(687-512)*S,(276.5-44)*S,146*S,64*S,disable_widget=True)
    n=p.node('排行/排队/pd');p.set_pos(n,0,0,218,86,disable_widget=True);p.data[n]['_trs']['array'][7:9]=[146*S/218]*2
    n=p.node('基本');reset(p,n);p.sprite(n,'settlement_v8_summary.png');top(p,'基本',472*S,width=964*S,height=75*S)
    p.set_active(p.node('基本/地九王'),False)
    # The legacy mode badge can be activated by real data; its own Sprite stays
    # disabled in this composition, while the review page retains mode display.
    p.disable(p.node('基本/地九王'),'cc.Sprite');p.hide_children(p.node('基本/地九王'))
    label(p,'基本/房间名',-327,0,260,52,29,'房间号:—')
    label(p,'基本/时长',366,0,177,52,29,'—')
    n=p.node('扩展');reset(p,n);p.disable(n,'cc.Sprite');p.hide_children(n);top(p,'扩展',472*S,width=964*S,height=75*S)
    label(p,'扩展/底皮',-86,0,182,52,29,'底皮:—')
    label(p,'扩展/奖池',144,0,217,52,29,'总奖池:—')
    n=p.node('V7结算表头');reset(p,n);p.sprite(n,'settlement_table_header_exact.png');top(p,'V7结算表头',558*S,width=964*S,height=88*S)
    n=p.node('战绩列表');reset(p,n);p.sprite(n,'settlement_v8_list_panel.png',sliced=True);stretch(p,'战绩列表',641*S,201*S,left=30*S,right=30*S)
    fill_parent(p,'战绩列表/view',964*S,1334-842*S)
    n=p.node('战绩列表/view/content');p.data[n]['_contentSize']['width']=964*S
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':1}
    ensure_widget(p,n).update(_enabled=True,_alignFlags=41,_left=0,_right=0,_top=0,alignMode=1)
    p.component(n,'cc.Layout')[1].update(_resize=1,**{'_N$paddingTop':4*S,'_N$paddingBottom':25*S,'_N$spacingY':0})
    n=p.node('关闭');reset(p,n);p.art(n,'settlement_return_exact.png',0,0,429*S,98*S,hide=True);bottom(p,'关闭',76*S,width=429*S,height=98*S)
    p.component(n,'cc.Button')[1]['_N$target']={'__id__':n}
    p.set_active(p.node('牌局回顾'),False)
    order=['bg','排行','基本','扩展','V7结算表头','战绩列表','关闭','title','牌局回顾']
    ids=[p.node(path) for path in order];p.data[p.root]['_children'][:]=[r for r in p.data[p.root]['_children'] if r['__id__'] not in ids]+[{'__id__':n} for n in ids]
    p.save()

    p=Prefab(ROW);reset(p,p.root);p.disable(p.root,'cc.Sprite');p.set_pos(p.root,0,0,924*S,92*S,disable_widget=True)
    for name in ['头像','txt','惩罚']:p.set_active(p.node(name),False)
    # Rank labels are retained for business updates, but the reference has no
    # extra index column. Disable only their renderers, not their data nodes.
    for name in ['idx','idx2']:p.disable(p.node(name),'cc.Label')
    n=p.node('line');reset(p,n);p.set_active(n,True);p.art(n,'settlement_row_exact.png',0,-44*S,924*S,2*S);p.disable(n,'cc.Widget')
    label(p,'名字',-420,15,276,40,29,'',align=0,bold=True)
    label(p,'id',-420,-20,276,31,23,'',align=0)
    # Existing text nodes use center anchors; left alignment starts at this x.
    for name in ['名字','id']:p.data[p.node(name)]['_anchorPoint']['x']=0
    for name,x in [('带入',-92),('手数',121),('输赢',344)]:label(p,name,x,0,180,52,29,'')
    p.data[p.node('输赢')]['_color']={'__type__':'cc.Color','r':174,'g':202,'b':28,'a':255}
    # A conditional penalty remains visible on the right side beneath the ID.
    label(p,'惩罚',-145,-29,375,23,16,'',align=0);p.set_active(p.node('惩罚'),False)
    p.save()

    apply_readability()


def apply_readability():
    """Focused typography patch; safe to apply without rebuilding the layout."""
    def text(p, path, size, height=None, width=None, y=None, bold=None, outline=1):
        n=p.node(path);node=p.data[n];c=p.component(n,'cc.Label')[1]
        c.update(_fontSize=size,_lineHeight=size+2,_enableWrapText=False)
        if bold is not None:c['_styleFlags']=1 if bold else 0
        node['_color']={'__type__':'cc.Color','r':255,'g':242,'b':216,'a':255}
        if height is not None:node['_contentSize']['height']=height
        if width is not None:node['_contentSize']['width']=width
        if y is not None:node['_trs']['array'][1]=y
        o=p.component(n,'cc.LabelOutline')[1]
        o.update(_enabled=True,_width=outline,_color={'__type__':'cc.Color','r':2,'g':18,'b':31,'a':255})

    p=Prefab(PAGE)
    for name in ['土豪','MVP','大鱼']:
        text(p,'排行/'+name+'/name',28,height=52*S,bold=True,outline=2)
    summary_font=p.component(p.node('基本/房间名'),'cc.Label')[1]['_N$file']
    for path in ['基本/房间名','基本/时长','扩展/底皮','扩展/奖池']:
        text(p,path,26)
        p.component(p.node(path),'cc.Label')[1].update(_isSystemFontUsed=False,**{'_N$file':summary_font})
    p.save()
    p=Prefab(ROW)
    text(p,'名字',26,height=44*S,y=18*S,bold=True)
    text(p,'id',21,height=36*S,y=-22*S)
    for path in ['带入','手数','输赢']:text(p,path,26,height=56*S)
    p.data[p.node('输赢')]['_color']={'__type__':'cc.Color','r':203,'g':225,'b':55,'a':255}
    p.data[p.node('line')]['_contentSize']['height']=3
    p.save()



if __name__=='__main__':
    extract();apply();print('V8-new settlement assets and Prefabs saved.')
