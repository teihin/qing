#!/usr/bin/env python3
"""Author approved in-game review directly into Prefab/Scene, with compact art."""
import argparse, copy, hashlib, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_agent import new, loc, label
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import foreground, clear_rect, compact_panel, rounded
from apply_v8_realtime_record import pin, first, ellipse
from repair_v7_responsive_layout import ensure_widget

OUT=ROOT/'art_sources/v8-repairs/ingame-review'
SOURCE=ROOT/'design-previews/效果图V8-new/06-桌内界面'
R='牌局回顾'; S=750/1024; W=634; CX=375-W/2; LW=626
GOLD=(250,240,218); SUB=(150,191,219)
CUTS={}

def save(key,im,box=None,border=0):
    path=ASSET_DIR/('ingame_review_v8_'+key+'.png')
    im.save(path,optimize=True);update_meta(path.name)
    mp=path.with_suffix('.png.meta');m=json.loads(mp.read_text());m['packable']=True
    edges=border if isinstance(border,tuple) else (border,)*4
    for k,v in zip(['borderLeft','borderRight','borderTop','borderBottom'],edges):m['subMetas'][path.stem][k]=v
    mp.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
    CUTS[key]=dict(source_box=box,size=im.size,border=edges,bytes=path.stat().st_size,rgba_bytes=im.width*im.height*4)

def clean_field(im,strip,radius=0):
    # Only blank pixel columns are sampled; smooth the 1D profile so nine-slice
    # expansion cannot amplify glyph fragments or screenshot grain into stripes.
    a=np.asarray(im);v=np.median(a[:,strip[0]:strip[1],:3],axis=1).astype('uint8')
    field=Image.fromarray(v[:,None,:]).filter(ImageFilter.GaussianBlur(3)).resize(im.size).convert('RGBA')
    mask=Image.new('L',im.size);ImageDraw.Draw(mask).rounded_rectangle((4,4,im.width-5,im.height-5),radius=max(0,radius-4),fill=255)
    return rounded(Image.composite(field,im,mask),radius) if radius else field

def smooth_plate(im,radius,strip):
    """Retain the authored outline, replace only its fill with a clean gradient.

    Averages from blank top/middle/bottom patches define the palette. No source
    row or column is stretched through the centre of the final plate.
    """
    a=np.asarray(im);h,w=a.shape[:2];x0,x1=strip
    stops=[(0,np.median(a[8:14,x0:x1,:3],axis=(0,1))),
           (.55,np.median(a[h//2-3:h//2+3,x0:x1,:3],axis=(0,1))),
           (1,np.median(a[h-15:h-8,x0:x1,:3],axis=(0,1)))]
    ys=np.linspace(0,1,h)
    rgb=np.stack([np.interp(ys,[s[0] for s in stops],[s[1][c] for s in stops]) for c in range(3)],axis=1)
    fill=Image.fromarray(np.repeat(rgb[:,None,:],w,axis=1).astype('uint8')).convert('RGBA')
    mask=Image.new('L',(w*4,h*4));ImageDraw.Draw(mask).rounded_rectangle((12,12,w*4-13,h*4-13),radius=max(0,radius-3)*4,fill=255)
    mask=mask.resize((w,h),Image.Resampling.LANCZOS)
    return rounded(Image.composite(fill,im,mask),radius)

def extract():
    a=Image.open(SOURCE/'07-牌局回顾.png').convert('RGBA');b=Image.open(SOURCE/'08-文字牌谱.png').convert('RGBA')
    assert a.size==b.size==(1024,1536)
    # Text-free lower drawer field with the original left metallic rim.
    # The reference's empty footer still contains vertical texture. Use averaged
    # blue colour stops, with a separate clean metallic left edge in this atlas.
    lower=np.asarray(a.crop((178,1480,1000,1530)))[:,:,:3].mean(axis=(0,1))
    upper=np.asarray(a.crop((810,470,830,510)))[:,:,:3].mean(axis=(0,1))
    v=np.linspace(0,1,96)[:,None,None]
    rgb=np.broadcast_to(upper[None,None,:]*(1-v)+lower[None,None,:]*v,(96,64,3)).astype('uint8')
    drawer=Image.fromarray(rgb).convert('RGBA')
    rim=ImageDraw.Draw(drawer);rim.line((0,0,0,95),fill=(234,218,178,255));rim.line((1,0,1,95),fill=(59,177,214,255))
    save('drawer',drawer,(158,1478,1024,1536),(4,2,2,2))
    row=a.crop((164,624,1021,794));row=clean_field(row,(640,660))
    save('row',row.resize((32,48),Image.Resampling.LANCZOS),(164,624,1021,794))
    selected=a.crop((164,278,1021,453));selected=clean_field(selected,(645,665),22)
    save('selected',compact_panel(selected,(112,96),24),(164,278,1021,453),24)
    blue=b.crop((164,278,1021,350));blue=smooth_plate(blue,11,(20,28))
    save('blue',compact_panel(rounded(blue,11),(112,72),12),(164,278,1021,350),12)
    gold=a.crop((185,109,592,182));gold=smooth_plate(gold,16,(30,65))
    save('gold',compact_panel(rounded(gold,16),(112,72),18),(185,109,592,182),18)
    for key,box,src in [('title',(484,18,730,77),a),('pool',(190,221,267,265),a),
                        ('report',(849,212,1000,271),b),('mode',(190,23,328,76),a)]:
        im=foreground(src.crop(box)) if key not in ['report','mode'] else rounded(src.crop(box),29)
        save(key,im,box)
    save('close',ellipse(a.crop((937,14,1006,83)),1),(937,14,1006,83))
    # Four tiny original navigation glyphs, kept at natural proportions.
    for key,box in [('first',(316,1390,398,1471)),('prev',(419,1390,500,1471)),('next',(653,1390,735,1471)),('last',(753,1390,835,1471))]:
        save(key,ellipse(a.crop(box),2),box)
    save('rule',Image.new('RGBA',(2,2),(232,220,188,255)))
    (OUT/'cuts.json').write_text(json.dumps(CUTS,ensure_ascii=False,indent=2)+'\n')

def art(p,path,key,x=0,y=0,w=None,h=None,sliced=False):
    parent,name=path.rsplit('/',1);new(p,parent,name)
    file=key if key.endswith('.png') else 'ingame_review_v8_'+key+'.png'
    iw,ih=Image.open(ASSET_DIR/file).size
    n=loc(p,path,x,y,iw*S if w is None else w,ih*S if h is None else h);p.sprite(n,file,sliced)
    return n

def txt(p,path,text,x=0,y=0,w=120,h=36,size=26,align=1,color=GOLD,bold=False):
    n=label(p,path,text,x=x,y=y,w=w,h=h,size=size,align=align,bold=bold)
    _,c=p.component(n,'cc.Label');c.update(_overflow=2,**{'_N$overflow':2},_lineHeight=size+3,_spacingX=0)
    p.data[n]['_color'].update(**dict(zip('rgb',color)));p.disable(n,'cc.LabelShadow')
    return n

def top_art(p,path,key,top,x=CX,**kw):return pin(p,art(p,path,key,x=x,**kw),top=top)

def clear(p,n):
    for ref in p.data[n].get('_components',[]):
        c=p.data[ref['__id__']]
        if c['__type__'] in ['cc.Sprite','cc.Label','cc.LabelOutline','cc.LabelShadow','cc.Widget','cc.Layout']:
            c['_enabled']=False
            if c['__type__']=='cc.Sprite':c['_spriteFrame']=None
    for ref in p.data[n].get('_children',[]):clear(p,ref['__id__'])

def scroll(p,path):
    n=loc(p,path,CX,0,LW,960);pin(p,n,top=204,bottom=161)
    h=p.data[n]['_contentSize']['height']
    v=loc(p,path+'/view',0,0,LW,h);pin(p,v,top=0,bottom=0,left=0,right=0)
    c=loc(p,path+'/view/content',0,h/2,LW,0);p.data[c]['_anchorPoint']['y']=1
    pin(p,c,top=0,left=0,right=0)
    _,lay=p.component(c,'cc.Layout');lay.update(_enabled=True,_resize=1,**{'_N$layoutType':2,'_N$paddingTop':0,'_N$paddingBottom':0,'_N$spacingY':0})
    for ref in p.data[n]['_components']:
        comp=p.data[ref['__id__']]
        if comp['__type__']=='0d83fc3wRhLQ5psw1ZE2ymI':
            comp.update(_enabled=True,horizontal=False,vertical=True,inertia=True,elastic=True,cancelInnerEvents=True)
    return n

def room(relative):
    p=Prefab.__new__(Prefab);p.path=ROOT/relative;p.data=json.loads(p.path.read_text())
    p.root=next(i for i,o in enumerate(p.data) if o.get('__type__')=='cc.Node' and o.get('_name')=='panelGameView')
    root=p.node(R);active=p.data[root]['_active'];clear(p,root)
    loc(p,R,0,0,750,1334);pin(p,root,top=0,bottom=0,left=0,right=0)
    n=art(p,R+'/V8遮罩','jackpot_v8_dim.png',w=750,h=1334);pin(p,n,top=0,bottom=0,left=0,right=0)
    n=art(p,R+'/BG2','drawer',w=W,h=1334,sliced=True);pin(p,n,top=0,bottom=0,right=0)
    top_art(p,R+'/label','title',14,w=180,h=43)
    for ref in p.data[p.node(R+'/label')]['_children']:p.set_active(ref['__id__'],False)
    top_art(p,R+'/地方','mode',18,x=-185,w=101,h=39)
    n=top_art(p,R+'/关闭上层','close',11,x=337,w=51,h=51)
    if not p.component(n,'cc.Button')[1]:
        button=copy.deepcopy(next(o for o in p.data if o.get('__type__')=='cc.Button'))
        button.update(node={'__id__':n},_enabled=True,_id='',clickEvents=[],**{'_N$target':{'__id__':n},'_N$transition':0,'transition':0,'_N$interactable':True})
        p.data[n]['_components'].append({'__id__':len(p.data)});p.data.append(button)
    top_art(p,R+'/V8标题分隔','rule',68,w=626,h=1)
    tabs=loc(p,R+'/操作',CX,0,596,54);pin(p,tabs,top=80)
    for index,(name,key) in enumerate([('牌局回顾','tab_cards'),('文字牌谱','tab_text')]):
        path=R+'/操作/'+name;t=loc(p,path,-149 if index==0 else 149,0,298,54)
        for state,asset in [('Background','blue'),('checkmark','gold')]:
            art(p,path+'/'+state,asset,w=298,h=54,sliced=True)
            # Shared live font labels avoid four full-width text+tab textures.
            txt(p,path+'/'+state+'/V8文字',name,w=274,h=45,size=29,color=(5,40,64) if state=='checkmark' else GOLD,bold=True)
        _,toggle=p.component(t,'cc.Toggle');toggle.update(_enabled=True,**{'_N$isChecked':index==0,'_N$transition':0,'transition':0})
        p.set_active(p.node(path+'/checkmark'),index==0)
    top_art(p,R+'/V8信息分隔','rule',148,w=626,h=1)
    top_art(p,R+'/奖池背景','pool',163,x=-207,w=56,h=32)
    pin(p,txt(p,R+'/奖池','0',x=-117,w=108,h=43,size=32,align=0),top=158)
    for key,x,value,color in [('图例1',151,'底牌',(236,255,20)),('图例2',270,'尾飞',(255,79,49))]:
        n=top_art(p,R+'/'+key,'rule',174,x=x,w=36,h=4);p.data[n]['_color'].update(**dict(zip('rgb',color)))
        txt(p,R+'/'+key+'/label',value,x=55,w=63,h=33,size=24)
    n=top_art(p,R+'/举报','report',155,x=305,w=111,h=44)
    for ref in p.data[n]['_children']:p.set_active(ref['__id__'],False)
    p.set_active(n,False)
    scroll(p,R+'/回顾列表');scroll(p,R+'/文字牌谱')
    for section in ['1','2','3']:
        path=R+'/文字牌谱/view/content/'+section
        n=loc(p,path,0,0,LW,52);p.data[n]['_anchorPoint']['y']=1
        _,lay=p.component(n,'cc.Layout');lay.update(_enabled=True,_resize=1,**{'_N$layoutType':2,'_N$paddingTop':0,'_N$paddingBottom':12,'_N$spacingY':0})
        art(p,path+'/标题','blue',w=LW,h=52,sliced=True)
        txt(p,path+'/标题/New Label','第'+['一','二','三'][int(section)-1]+'轮',x=-239,w=132,h=44,size=28,align=0,bold=True)
        txt(p,path+'/标题/New Label copy','剩余钵钵',x=244,w=130,h=34,size=21)
        txt(p,path+'/标题/V8操作标题','操作',x=7,w=88,h=34,size=22)
        n=loc(p,path+'/list',0,0,LW,0);p.data[n]['_anchorPoint']['y']=1
        _,lay=p.component(n,'cc.Layout');lay.update(_enabled=True,_resize=1,**{'_N$layoutType':2,'_N$spacingY':0,'_N$paddingTop':0,'_N$paddingBottom':0})
    p.set_active(p.node(R+'/文字牌谱'),False)
    n=art(p,R+'/V8页脚分隔','rule',x=CX,w=626,h=1);pin(p,n,bottom=160)
    n=txt(p,R+'/V8局数','暂无已完成牌局',x=CX,w=206,h=35,size=24);pin(p,n,bottom=110)
    for name,x in [('左',CX-182),('右',CX+182)]:
        n=art(p,R+'/V8局数线'+name,'rule',x=x,w=190,h=1);pin(p,n,bottom=127)
    pager=loc(p,R+'/分页',CX,0,410,58);pin(p,pager,bottom=45)
    # Controller already handles one-based rounds. The old generic PageEx would
    # bind the same four buttons a second time with zero-based paging semantics.
    p.disable(pager,'e5505goZe9Jt5n5drSPXovA')
    for name,key,x in [('首页','first',-160),('上一页','prev',-85),('下一页','next',85),('尾页','last',160)]:
        n=loc(p,R+'/分页/'+name,x,0,60,60)
        art(p,R+'/分页/'+name+'/11',key,w=60,h=60)
        _,button=p.component(n,'cc.Button');button.update(_enabled=True,**{'_N$transition':0,'transition':0})
    txt(p,R+'/分页/页码','0 / 0',w=100,h=42,size=23)
    n=pin(p,txt(p,R+'/V8空记录','暂无已完成牌局',x=CX,w=560,h=45,size=27,color=SUB),top=360);p.set_active(n,False)
    first(p,R,[R+'/V8遮罩',R+'/BG2'])
    p.set_active(root,active);p.save()

def row():
    p=Prefab('assets/resources/Prefabs/回顾对象.prefab');r='回顾对象'
    # Card scripts/frames and state sprites survive untouched; only their editor
    # geometry changes. No runtime texture replacement is introduced.
    loc(p,r,0,0,LW,128)
    for o in p.data:
        if o.get('__type__') in ['cc.Widget','cc.Layout']:o['_enabled']=False
    art(p,r+'/V8行底','row',w=LW,h=128)
    n=art(p,r+'/V8本人底','selected',w=LW,h=128,sliced=True);p.set_active(n,False)
    art(p,r+'/line','rule',y=-63.5,w=LW,h=1);p.data[p.node(r+'/line')]['_opacity']=90
    n=loc(p,r+'/head',-255,10,76,76);_,mask=p.component(n,'cc.Mask');mask['_type']=1;mask['_segments']=64
    loc(p,r+'/head/img',0,0,76,76)
    art(p,r+'/V8头像框','realtime_v8_avatar_ring.png',x=-255,y=10,w=83,h=83)
    txt(p,r+'/name','—',x=-159,y=17,w=105,h=32,size=25,align=0)
    txt(p,r+'/id','ID:—',x=-159,y=-14,w=105,h=25,size=17,align=0,color=SUB)
    loc(p,r+'/庄',-121,45,24,24)
    loc(p,r+'/state',13,-44,51,22)
    txt(p,r+'/三花','三花',x=13,y=-44,w=136,h=28,size=23)
    p.set_active(p.node(r+'/三花'),False)
    loc(p,r+'/手牌',40,8,225,116)
    for g,x in [('牌组1',-68),('牌组2',57)]:
        loc(p,r+'/手牌/'+g,x,0,97,103)
        for name,cx in [('handbig',-25),('handbig copy',25)]:
            path=r+'/手牌/'+g+'/'+name
            n=loc(p,path,cx,8,45,63)
            loc(p,path+'/BK1',0,0,45,63);loc(p,path+'/BK0',0,0,45,63)
            for child in ['BK1','BK0']:
                _,sp=p.component(p.node(path+'/'+child),'cc.Sprite');sp.update(_type=0,_sizeMode=0)
            loc(p,path+'/line',0,-28,42,3)
    for name,x in [('牌型1',-68),('牌型2',57)]:txt(p,r+'/手牌/'+name,'—',x=x,y=-42,w=108,h=29,size=21)
    txt(p,r+'/score','',x=242,y=0,w=125,h=40,size=32,align=2)
    loc(p,r+'/list',238,2,142,110)
    for key,y,size in [('1',38,18),('2',2,34),('3',-34,18)]:txt(p,r+'/list/'+key,'',y=y,w=142,h=35,size=size,align=2)
    first(p,r,[r+'/V8行底',r+'/V8本人底',r+'/line']);p.save()

def text_row():
    p=Prefab('assets/resources/Prefabs/文字牌谱对象.prefab');r='文字牌谱对象'
    loc(p,r,0,0,LW,49)
    txt(p,r+'/name','—',x=-261,w=84,h=34,size=24,align=0)
    txt(p,r+'/V8玩家ID','ID:—',x=-145,w=140,h=29,size=17,align=0,color=SUB)
    # Keep original compact decision Sprite: on callback it loads the existing
    # other/牌谱 artwork at native 49:36 aspect, never as a sliced square.
    n=loc(p,r+'/决策',-18,0,49,36);_,sp=p.component(n,'cc.Sprite');sp.update(_type=0,_sizeMode=2,_isTrimmedMode=False)
    txt(p,r+'/操作','—',x=75,w=120,h=35,size=25,align=0)
    txt(p,r+'/剩余','—',x=245,w=126,h=35,size=27,align=2)
    n=art(p,r+'/V8分隔','rule',y=-24,w=LW,h=1);p.data[n]['_opacity']=85
    p.save()

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--extract',action='store_true');args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    if args.extract:extract()
    room('assets/resources/UI/panelGameView.prefab');room('assets/Scenes/drh8.fire');row();text_row()
    print('Serialized in-game review with compact sliced plates and original dynamic cards.')
