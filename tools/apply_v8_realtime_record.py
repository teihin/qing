#!/usr/bin/env python3
"""Extract compact approved art and serialize the real-time record drawer only.

No runtime layout/skin injection. --extract rebuilds this task's assets; layout
can be rerun independently without changing UUIDs or unrelated serialized data.
"""
import argparse, copy, hashlib, json
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_agent import new, loc, label
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import foreground, clear_rect, compact_panel, rounded
from repair_v7_responsive_layout import ensure_widget

SOURCE=ROOT/'design-previews/效果图V8-new/06-桌内界面/04-实时战绩.png'
OUT=ROOT/'art_sources/v8-repairs/realtime-record'
R='实时战绩'
S=750/1024
W=594
CX=-375+W/2
CUTS={}

def save(key,im,box=None,border=0):
    path=ASSET_DIR/('realtime_v8_'+key+'.png')
    im.save(path,optimize=True);update_meta(path.name)
    mp=path.with_suffix('.png.meta');meta=json.loads(mp.read_text())
    meta.update(packable=True,filterMode='bilinear')
    for k in ['borderLeft','borderRight','borderTop','borderBottom']:
        meta['subMetas'][path.stem][k]=border
    mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    CUTS[key]=dict(source_box=box,size=im.size,border=border,bytes=path.stat().st_size,
                   rgba_bytes=im.width*im.height*4,sha256=hashlib.sha256(path.read_bytes()).hexdigest())

def ellipse(im,inset=0):
    m=Image.new('L',(im.width*4,im.height*4));ImageDraw.Draw(m).ellipse((inset*4,inset*4,im.width*4-1-inset*4,im.height*4-1-inset*4),fill=255)
    im.putalpha(m.resize(im.size,Image.Resampling.LANCZOS));return im

def smooth_field(im,radius,strip):
    """Keep reference corners/outline; rebuild blank fill from a clean column.

    A 1D colour profile contains no screenshot glyphs or horizontal variation
    that could turn into vertical streaks when the middle is nine-sliced.
    """
    a=np.array(im);profile=np.median(a[:,strip[0]:strip[1],:3],axis=1).astype('uint8')
    # Summary separator crosses even the otherwise blank sample column.
    if im.height==275:profile[140:153]=np.linspace(profile[139],profile[153],13).astype('uint8')
    line=Image.fromarray(profile[:,None,:]).filter(ImageFilter.GaussianBlur(8))
    fill=line.resize(im.size).convert('RGBA')
    mask=Image.new('L',im.size);ImageDraw.Draw(mask).rounded_rectangle((8,8,im.width-9,im.height-9),radius=max(0,radius-8),fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(5));out=Image.composite(fill,im,mask)
    return rounded(out,radius)

def extract():
    im=Image.open(SOURCE).convert('RGBA')
    assert im.size==(1024,1536)
    # All four perimeter curves come from the approved summary card. Remove the
    # interior data using its clean boundaries, then retain 24px corner regions.
    panel=im.crop((26,104,789,379))
    panel=smooth_field(panel,24,(55,85)).resize((572,206),Image.Resampling.LANCZOS)
    save('panel',compact_panel(panel,(144,144),24),(26,104,789,379),24)
    # Drawer perimeter is text-free. A compact Coons surface avoids stretching
    # screenshot rows into the vertical stripe artifacts of the old skins.
    drawer=im.crop((0,0,810,1536))
    drawer=smooth_field(drawer,15,(1,14))
    drawer=drawer.resize((594,1126),Image.Resampling.LANCZOS)
    save('drawer',compact_panel(drawer,(112,160),12),(0,0,810,1536),12)
    for key,box in {
        'title':(282,20,538,88),'title_rule':(145,46,262,68),
        'pool_label':(370,121,447,163),'total_in':(183,268,305,305),
        'total_score':(515,267,637,305),'nickname':(65,417,139,462),
        'buyin':(451,417,518,462),'score':(667,417,740,462),
        'watch':(58,1161,135,1204),'clock':(607,1163,645,1200),
        'squeeze':(58,1437,138,1484)}.items():
        save(key,foreground(im.crop(box)),box)
    save('close',ellipse(im.crop((719,18,797,95)),1),(719,18,797,95))
    save('self',rounded(im.crop((185,491,241,535)),15),(185,491,241,535))
    save('switch',rounded(im.crop((519,1427,655,1495)),33),(519,1427,655,1495))
    save('row',im.crop((260,557,380,626)).resize((48,32),Image.Resampling.LANCZOS),(260,557,380,626))
    save('selected',im.crop((260,472,380,551)).resize((48,40),Image.Resampling.LANCZOS),(260,472,380,551))
    save('rule',Image.new('RGBA',(2,2),(228,209,170,255)))
    # Only the existing reference avatar frame is used, with a transparent hole.
    ring=im.crop((60,1218,189,1345));ring=ellipse(ring,1)
    m=ring.getchannel('A');d=ImageDraw.Draw(m);d.ellipse((6,6,ring.width-7,ring.height-7),fill=0);ring.putalpha(m)
    save('avatar_ring',ring.resize((100,100),Image.Resampling.LANCZOS),(60,1218,189,1345))
    (OUT/'cuts.json').write_text(json.dumps(CUTS,ensure_ascii=False,indent=2)+'\n')

def art(p,path,key,x=0,y=0,w=None,h=None,sliced=False):
    parent,name=path.rsplit('/',1);new(p,parent,name)
    asset=key if key.endswith('.png') else 'realtime_v8_'+key+'.png'
    iw,ih=Image.open(ASSET_DIR/asset).size
    n=loc(p,path,x,y,iw*S if w is None else w,ih*S if h is None else h)
    p.sprite(n,asset,sliced);return n

def pin(p,n,top=None,bottom=None,left=None,right=None):
    o=p.data[n];wg=ensure_widget(p,n)
    flags=(1 if top is not None else 0)|(4 if bottom is not None else 0)|(8 if left is not None else 0)|(32 if right is not None else 0)
    # ON_WINDOW_RESIZE, not ALWAYS: the content's y belongs to ScrollView after
    # layout, otherwise a Widget would reset every drag to the top each frame.
    wg.update(_enabled=True,alignMode=1,_alignFlags=flags)
    for key,value in [('_top',top),('_bottom',bottom),('_left',left),('_right',right)]:
        if value is not None:wg[key]=value
    # Serialize the same base geometry that Widget will compute in Creator.
    parent=p.data[o['_parent']['__id__']];pw=parent['_contentSize']['width'];ph=parent['_contentSize']['height'];w=o['_contentSize']['width'];h=o['_contentSize']['height'];ax=o['_anchorPoint']['x'];ay=o['_anchorPoint']['y']
    if top is not None and bottom is not None:h=ph-top-bottom;o['_contentSize']['height']=h
    if left is not None and right is not None:w=pw-left-right;o['_contentSize']['width']=w
    if left is not None:o['_trs']['array'][0]=-pw*parent['_anchorPoint']['x']+left+w*ax
    elif right is not None:o['_trs']['array'][0]=pw*(1-parent['_anchorPoint']['x'])-right-w*(1-ax)
    if top is not None:o['_trs']['array'][1]=ph*(1-parent['_anchorPoint']['y'])-top-h*(1-ay)
    elif bottom is not None:o['_trs']['array'][1]=-ph*parent['_anchorPoint']['y']+bottom+h*ay
    return n

def at(p,path,key,top,x=CX,w=None,h=None,sliced=False):
    return pin(p,art(p,path,key,x=x,w=w,h=h,sliced=sliced),top=top)

def txt(p,path,value,x,y,w,h,size,align=1,font=None):
    n=label(p,path,value,x=x,y=y,w=w,h=h,size=size,align=align)
    _,c=p.component(n,'cc.Label');c.update(_overflow=2,_spacingX=0,**{'_N$overflow':2})
    p.data[n]['_color'].update(r=250,g=240,b=214)
    if font:
        c['_N$file']={'__uuid__':json.loads((ASSET_DIR/(font+'.fnt.meta')).read_text())['uuid']}
        p.data[n]['_color'].update(r=255,g=255,b=255);p.disable(n,'cc.LabelShadow')
    return n

def clear(p,n):
    for r in p.data[n].get('_components',[]):
        c=p.data[r['__id__']]
        if c['__type__'] in ['cc.Sprite','cc.Label','cc.LabelOutline','cc.LabelShadow','cc.Widget','cc.Layout']:
            c['_enabled']=False
            if c['__type__']=='cc.Sprite':c['_spriteFrame']=None
    for r in p.data[n].get('_children',[]):clear(p,r['__id__'])

def first(p,parent,children):
    a=p.data[p.node(parent)]['_children'];ids=[p.node(x) for x in children]
    a[:]=[{'__id__':i} for i in ids]+[r for r in a if r['__id__'] not in ids]

def scroll(p,path,top=None,bottom=None,height=100,watch=False):
    n=loc(p,path,CX,0,552,height);pin(p,n,top=top,bottom=bottom)
    h=p.data[n]['_contentSize']['height']
    v=loc(p,path+'/view',0,0,552,h);pin(p,v,top=0,bottom=0,left=0,right=0)
    c=loc(p,path+'/view/content',0,h/2,552,0);p.data[c]['_anchorPoint']['y']=1;pin(p,c,top=0,left=0,right=0)
    _,lay=p.component(c,'cc.Layout');lay.update(_enabled=True,_resize=1,**{'_N$cellSize':{'__type__':'cc.Size','width':138,'height':130},'_N$layoutType':3 if watch else 2,'_N$paddingTop':0,'_N$paddingBottom':0,'_N$paddingLeft':0,'_N$paddingRight':0,'_N$spacingX':0,'_N$spacingY':0,'_N$startAxis':0,'_N$verticalDirection':1})
    lay.pop('_cellSize',None)
    bar=new(p,path,'V8滚动条');loc(p,path+'/V8滚动条',274,0,4,h-8);pin(p,bar,top=4,bottom=4,right=0)
    handle=art(p,path+'/V8滚动条/滑块','rule',w=4,h=30)
    p.data[handle]['_color'].update(r=154,g=220,b=250)
    cid,component=p.component(bar,'cc.Scrollbar')
    if component is None:
        cid=len(p.data);component={'__type__':'cc.Scrollbar','_name':'','_objFlags':0,'node':{'__id__':bar},'_enabled':True,'_id':''};p.data.append(component);p.data[bar]['_components'].append({'__id__':cid})
    ref={'__id__':p.component(handle,'cc.Sprite')[0]}
    component.update(handle=ref,direction=1,enableAutoHide=False,autoHideTime=1,**{'_N$handle':ref,'_N$direction':1})
    for r in p.data[n]['_components']:
        comp=p.data[r['__id__']]
        if comp['__type__']=='0d83fc3wRhLQ5psw1ZE2ymI':
            comp.update(_enabled=True,horizontal=False,vertical=True,inertia=True,elastic=True,cancelInnerEvents=True)
            comp.update(verticalScrollBar={'__id__':cid},**{'_N$verticalScrollBar':{'__id__':cid}})
    return n

def room(relative):
    p=Prefab.__new__(Prefab);p.path=ROOT/relative;p.data=json.loads(p.path.read_text())
    # Another task may edit a different room subtree between runs. Compare each
    # application to its own fresh baseline instead of restoring an old file.
    before=OUT/'last-apply-before';before.mkdir(parents=True,exist_ok=True)
    (before/p.path.name).write_text(json.dumps(p.data,ensure_ascii=False,indent=2)+'\n')
    p.root=next(i for i,o in enumerate(p.data) if o.get('__type__')=='cc.Node' and o.get('_name')=='panelGameView')
    root=p.node(R);active=p.data[root]['_active'];clear(p,root)
    loc(p,R,0,0,750,1334);pin(p,root,top=0,bottom=0,left=0,right=0)
    n=art(p,R+'/V8遮罩','jackpot_v8_dim.png',w=750,h=1334);pin(p,n,top=0,bottom=0,left=0,right=0)
    n=art(p,R+'/bg','drawer',w=W,h=1334,sliced=True);pin(p,n,top=0,bottom=0,left=0)
    first(p,R,[R+'/V8遮罩',R+'/bg'])
    at(p,R+'/label','title',17)
    at(p,R+'/V8标题线','title_rule',35,x=CX-145)
    n=at(p,R+'/V8标题线右','title_rule',35,x=CX+145);p.data[n]['_trs']['array'][7]=-1
    # Retain legacy strategy event nodes but their transparent artwork stays off.
    for ch in p.data[p.node(R+'/label')]['_children']:p.data[ch['__id__']]['_active']=False
    close=at(p,R+'/关闭上层','close',14,x=177,w=55,h=55)
    if not p.component(close,'cc.Button')[1]:
        c=copy.deepcopy(next(o for o in p.data if o.get('__type__')=='cc.Button'))
        c.update(node={'__id__':close},_enabled=True,_id='',clickEvents=[],**{'_N$target':{'__id__':close},'_N$transition':0,'transition':0,'_N$interactable':True})
        p.data[close]['_components'].append({'__id__':len(p.data)});p.data.append(c)
    at(p,R+'/bk','panel',79,w=558,h=205,sliced=True)
    at(p,R+'/V8奖池标题','pool_label',92)
    pin(p,txt(p,R+'/奖池','0',CX,0,490,63,67,font='jackpot_v8_serif_digits'),top=123)
    at(p,R+'/V8概况横线','rule',186,w=522,h=1)
    at(p,R+'/V8总带入标题','total_in',200,x=CX-144)
    at(p,R+'/V8总得分标题','total_score',200,x=CX+144)
    pin(p,txt(p,R+'/总带入','0',CX-144,0,230,44,45,font='jackpot_v8_serif_digits'),top=230)
    pin(p,txt(p,R+'/总得分','0',CX+144,0,230,44,45,font='jackpot_v8_serif_digits'),top=230)
    at(p,R+'/V8概况竖线','rule',204,w=1,h=63)
    # One reusable nine-slice serves summary, full list and watcher background.
    n=at(p,R+'/V8战绩底板','panel',299,w=558,h=754,sliced=True);pin(p,n,top=299,bottom=288)
    for key,x in [('nickname',-300),('buyin',-16),('score',143)]:at(p,R+'/V8表头'+key,key,315,x=x)
    at(p,R+'/V8表头横线','rule',352,w=550,h=1)
    scroll(p,R+'/战绩列表',top=354,bottom=300)
    n=txt(p,R+'/V8列表状态','暂无战绩',CX,0,480,40,26);pin(p,n,top=420)
    n=art(p,R+'/V8围观底板','panel',x=CX,w=558,h=196,sliced=True);pin(p,n,bottom=79)
    n=art(p,R+'/title2','watch',x=-303);pin(p,n,bottom=231)
    # Keep exact countdown path even though the previous title sprite was larger.
    n=txt(p,R+'/title2/倒计时','00:00:00',381,0,122,30,23);p.data[n]['_color'].update(r=250,g=240,b=214)
    art(p,R+'/title2/V8时钟','clock',x=302,w=24,h=24)
    art(p,R+'/title2/V8分隔','rule',x=161,w=226,h=1)
    scroll(p,R+'/围观列表',bottom=89,height=133,watch=True)
    # The embedded template is unused; server entries still use 观战对象.prefab.
    for r in p.data[p.node(R+'/围观列表/view/content')]['_children']:p.data[r['__id__']]['_active']=False
    t=loc(p,R+'/搓牌开关',53,0,100,51);pin(p,t,bottom=15)
    bg=art(p,R+'/搓牌开关/Background','switch',w=100,h=50);p.data[bg]['_trs']['array'][7]=-1;p.data[bg]['_color'].update(r=135,g=162,b=178)
    check=art(p,R+'/搓牌开关/checkmark','switch',w=100,h=50)
    _,toggle=p.component(t,'cc.Toggle');toggle.update(_enabled=True,**{'_N$isChecked':False,'_N$transition':0,'transition':0})
    if 'checkMark' in toggle:toggle['checkMark']={'__id__':p.component(check,'cc.Sprite')[0]}
    p.set_active(check,False)
    art(p,R+'/搓牌开关/搓牌','squeeze',x=-353,w=59,h=35)
    art(p,R+'/搓牌开关/V8分隔','rule',x=-196,w=230,h=1)
    n=txt(p,R+'/搓牌开关/V8状态','已关闭',105,0,104,36,25)
    # Backdrops must precede all preserved dynamic labels, regardless of old order.
    first(p,R,[R+'/V8遮罩',R+'/bg',R+'/bk',R+'/V8战绩底板',R+'/V8围观底板'])
    p.set_active(root,active);p.save()

def row():
    p=Prefab('assets/resources/Prefabs/带入记录.prefab');clear(p,p.root)
    loc(p,'带入记录',0,0,552,76);pin(p,p.root,left=0,right=0) if p.data[p.root]['_parent'] else None
    art(p,'带入记录/V8隔行','row',w=552,h=76)
    art(p,'带入记录/V8本人底','selected',w=552,h=76)
    art(p,'带入记录/V8分隔','rule',y=-37.5,w=552,h=1);p.data[p.node('带入记录/V8分隔')]['_opacity']=60
    txt(p,'带入记录/name','—',-177,2,150,40,28,align=0)
    txt(p,'带入记录/in','0',12,2,136,40,28,align=2)
    txt(p,'带入记录/score','0',181,2,155,40,29,align=2)
    art(p,'带入记录/V8本人','self',x=-73,y=2,w=36,h=29)
    n=txt(p,'带入记录/V8离桌','已离桌',-188,-23,130,23,19,align=0);p.data[n]['_color'].update(r=133,g=158,b=179)
    for key in ['V8本人底','V8本人','V8隔行','V8离桌']:p.set_active(p.node('带入记录/'+key),False)
    first(p,'带入记录',['带入记录/V8隔行','带入记录/V8本人底','带入记录/V8分隔'])
    p.save()

def watcher():
    p=Prefab('assets/resources/Prefabs/观战对象.prefab')
    loc(p,'观战对象',0,0,138,130)
    txt(p,'观战对象/name','—',0,-48,124,28,22)
    n=loc(p,'观战对象/head',0,17,86,86);_,mask=p.component(n,'cc.Mask');mask['_type']=1;mask['_segments']=64
    loc(p,'观战对象/head/img',0,0,86,86)
    art(p,'观战对象/V8头像框','avatar_ring',y=17,w=92,h=92)
    p.save()

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--extract',action='store_true');args=ap.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    if args.extract:extract()
    room('assets/resources/UI/panelGameView.prefab');room('assets/Scenes/drh8.fire');row();watcher()
    print('Updated real-time record subtree and its two dedicated row Prefabs.')
