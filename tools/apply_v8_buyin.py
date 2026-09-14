#!/usr/bin/env python3
"""Cut the approved buy-in art and serialize only its existing room subtree."""
import argparse, copy, hashlib, json, uuid
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import foreground, rounded
from apply_v8_agent import new, loc, label
from repair_v7_responsive_layout import ensure_widget

SOURCE = ROOT/'design-previews/效果图V8-new/06-桌内界面/06-带入积分.png'
OUT = ROOT/'art_sources/v8-repairs/buyin'
R = '带入窗口'
S = 750/1024
CY = 777
BOXES = {}
COMPONENT_UUID = 'be1ba9a8-1aae-4ae5-bf71-0b76e49b5d21'
COMPONENT_ID = 'be1bamoGq5K5b9xC3bkm10h'

def save(key, im, box=None, border=0):
    name = 'buyin_v8_'+key+'.png'; path = ASSET_DIR/name
    im.save(path, optimize=True); update_meta(name)
    mp = Path(str(path)+'.meta'); meta = json.loads(mp.read_text())
    meta.update(packable=False,filterMode='bilinear')
    for edge in ['borderLeft','borderRight','borderTop','borderBottom']:
        meta['subMetas'][path.stem][edge] = border
    mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    BOXES[key] = dict(box=box,size=im.size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())

def ellipse(im):
    mask=Image.new('L',(im.width*4,im.height*4)); ImageDraw.Draw(mask).ellipse((1,1,im.width*4-2,im.height*4-2),fill=255)
    im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));return im

def font_atlas(im, key, box, chars, size, font_name):
    sample=im.crop(box); a=np.asarray(sample); rgb=a[:,:,:3].astype(float)
    m=(rgb[:,:,0]>120)&(rgb[:,:,0]>rgb[:,:,2]*.90)
    cols=m.sum(0)>1;runs=[];start=None
    for x,on in enumerate(list(cols)+[False]):
        if on and start is None:start=x
        if not on and start is not None:runs.append((start,x));start=None
    assert len(runs)==len(chars),(key,runs,chars)
    digitcols=np.zeros(sample.width,bool)
    for ch,(l,r) in zip(chars,runs):
        if ch.isdigit():digitcols[l:r]=True
    ys=np.where((m&digitcols).any(1))[0];ct,cb=int(ys[0]),int(ys[-1]+1);cap=cb-ct;top=(size-cap)//2
    glyphs={}
    for ch,(l,r) in zip(chars,runs):
        if ch in glyphs:continue
        yy=np.where(m[:,l:r].any(1))[0];t,b=int(yy[0]),int(yy[-1]+1)
        tile=foreground(sample.crop((l-2,t-2,r+3,b+4)))
        glyphs[ch]=(tile,top+t-ct-2,tile.width-2)
    native=ImageFont.truetype('/System/Library/Fonts/Supplemental/'+font_name,150)
    for ch in '0123456789.,-':
        if ch in glyphs:continue
        mask=Image.new('L',(170,180));ImageDraw.Draw(mask).text((8,145),ch,font=native,anchor='ls',fill=255)
        l,t,r,b=mask.getbbox();mask=mask.crop((l-2,t-2,r+3,b+4))
        desired=cap if ch.isdigit() else max(3,round(cap*.12)) if ch=='.' else round(cap*.30)
        scale=desired/(b-t);mask=mask.resize((round(mask.width*scale),round(mask.height*scale)),Image.Resampling.LANCZOS)
        w,h=mask.size;f=np.linspace(0,1,h)[:,None,None]
        hi=[255,245,218] if key=='large_digits' else [246,241,226]
        lo=[208,166,93] if key=='large_digits' else [224,223,216]
        rgb=np.broadcast_to(np.array(hi)*(1-f)+np.array(lo)*f,(h,w,3)).astype('uint8')
        tile=Image.fromarray(rgb).convert('RGBA');tile.putalpha(mask)
        if key=='large_digits':
            shadow=Image.new('RGBA',(w+5,h+5),(12,31,44,0));shadow.putalpha(Image.new('L',shadow.size))
            dark=Image.new('RGBA',mask.size,(28,43,51,210));dark.putalpha(mask.filter(ImageFilter.GaussianBlur(1)))
            shadow.alpha_composite(dark,(2,3));shadow.alpha_composite(tile,(0,0));tile=shadow
        glyphs[ch]=(tile,top if ch.isdigit() else top+cap-desired,w-2)
    atlas=Image.new('RGBA',(1024,256));lines=[];x=y=3
    for ch,(tile,offset,advance) in glyphs.items():
        if x+tile.width+4>1024:x=3;y=size+8
        atlas.alpha_composite(tile,(x,y));lines.append(f'char id={ord(ch)} x={x} y={y} width={tile.width} height={tile.height} xoffset=0 yoffset={offset} xadvance={advance} page=0 chnl=15');x+=tile.width+6
    save(key,atlas,box)
    name='buyin_v8_'+key;meta=json.loads((ASSET_DIR/(name+'.png.meta')).read_text())
    (ASSET_DIR/(name+'.fnt')).write_text(f'info face="V8 Buyin {key}" size={size} bold=0 italic=0 unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0\ncommon lineHeight={size} base={top+cap} scaleW=1024 scaleH=256 pages=1 packed=0\npage id=0 file="{name}.png"\nchars count={len(lines)}\n'+'\n'.join(lines)+'\n')
    mp=ASSET_DIR/(name+'.fnt.meta');ident=json.loads(mp.read_text())['uuid'] if mp.exists() else str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-buyin/'+key))
    mp.write_text(json.dumps(dict(ver='2.1.2',uuid=ident,importer='bitmap-font',textureUuid=meta['uuid'],fontSize=size,subMetas={}),indent=2)+'\n')

def extract():
    im=Image.open(SOURCE).convert('RGBA');clean=Image.open(OUT/'clean-plates.png').convert('RGBA')
    # Continuous clean plates; independent controls replace these holes.
    panel=rounded(clean.crop((76,280,949,1312)),40)
    for box in [(283,280,741,336),(132,398,892,815),(132,843,892,1045),(133,1151,497,1259),(529,1151,891,1259)]:
        ImageDraw.Draw(panel).rectangle((box[0]-76,box[1]-280,box[2]-77,box[3]-281),fill=(0,0,0,0))
    save('panel',panel,(76,280,949,1312))
    for key,box,radius in [('selection',(130,396,894,817),18),('amount',(177,489,847,639),19),('balance',(130,841,894,1047),18)]:
        tile=rounded(clean.crop(box),radius)
        if key=='selection':ImageDraw.Draw(tile).rectangle((49,95,715,240),fill=(0,0,0,0))
        save(key,tile,box)
    # Approved immutable pixels, never re-typeset.
    for key,box in [('caption',(419,422,605,468)),('already',(170,874,288,916)),('balance_label',(170,971,327,1013)),('minimum',(158,741,228,779)),('maximum',(708,741,775,779)),('hint',(343,1080,680,1120))]:
        save(key,foreground(im.crop(box)),box)
    for key,box,radius in [('cancel',(131,1149,500,1263),23),('confirm',(526,1149,894,1263),24),('recharge',(716,957,869,1027),34)]:save(key,rounded(im.crop(box),radius),box)
    # The plaque has sloping sides, not rounded-rectangle corners.
    tile=im.crop((278,242,747,343));mask=Image.new('L',(tile.width*4,tile.height*4));d=ImageDraw.Draw(mask)
    points=[(40,1),(429,1),(444,6),(458,18),(467,35),(451,80),(442,91),(424,99),(45,99),(26,93),(17,82),(2,36),(10,19),(24,7)]
    d.polygon([(x*4,y*4) for x,y in points],fill=255);tile.putalpha(mask.resize(tile.size,Image.Resampling.LANCZOS));save('title',tile,(278,242,747,343))
    save('close',ellipse(im.crop((861,309,923,372))),(861,309,923,372))
    save('handle',ellipse(im.crop((375,670,434,730))),(375,670,434,730))
    # Native track gradients, with original rounded end-caps retained by nine-slice.
    track=im.crop((441,689,860,713));track.paste(track.crop((403,0,419,24)).transpose(Image.Transpose.FLIP_LEFT_RIGHT),(0,0));save('track',track,border=12)
    fill=im.crop((164,688,364,713));fill.paste(fill.crop((0,0,16,25)).transpose(Image.Transpose.FLIP_LEFT_RIGHT),(184,0));save('fill',fill,border=12)
    save('dim',Image.new('RGBA',(4,4),(0,7,18,175)))
    # A same-family plain panel is only needed for the unpictured insufficient-balance state.
    save('notice_panel',rounded(clean.crop((130,841,894,1047)),18),border=24)
    font_atlas(im,'large_digits',(338,510,685,628),'2,000',128,'Arial Bold.ttf')
    font_atlas(im,'digits',(587,972,703,1016),'5,000',44,'Arial.ttf')
    (OUT/'cuts.json').write_text(json.dumps(BOXES,ensure_ascii=False,indent=2)+'\n')

def clear(p,n):
    for r in p.data[n]['_components']:
        c=p.data[r['__id__']]
        if c['__type__'] in ['cc.Sprite','cc.Label','cc.LabelShadow','cc.LabelOutline','cc.Widget','cc.Layout']:
            c['_enabled']=False
            if c['__type__']=='cc.Sprite':c['_spriteFrame']=None
    for r in p.data[n]['_children']:clear(p,r['__id__'])

def position(p,path,box,parent_center=(512,CY)):
    return loc(p,path,((box[0]+box[2])/2-parent_center[0])*S,(parent_center[1]-(box[1]+box[3])/2)*S,(box[2]-box[0])*S,(box[3]-box[1])*S)

def art(p,path,key,box,parent_center=(512,CY),sliced=False):
    parent,name=path.rsplit('/',1);new(p,parent,name)
    n=position(p,path,box,parent_center);p.sprite(n,'buyin_v8_'+key+'.png',sliced);return n

def digits(p,path,box,value='0',size=44,large=False,align=1):
    x=((box[0]+box[2])/2-512)*S;y=(CY-(box[1]+box[3])/2)*S
    n=label(p,path,value,x=x,y=y,w=(box[2]-box[0])*S,h=(box[3]-box[1])*S,size=size*S,align=align)
    _,c=p.component(n,'cc.Label');key='large_digits' if large else 'digits'
    c.update(_spacingX=0,_styleFlags=0,_lineHeight=size*S,_overflow=2,**{'_N$overflow':2,'_N$file':{'__uuid__':json.loads((ASSET_DIR/f'buyin_v8_{key}.fnt.meta').read_text())['uuid']}})
    p.disable(n,'cc.LabelShadow');p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':255,'b':255,'a':255};return n

def room(relative):
    p=Prefab.__new__(Prefab);p.path=ROOT/relative;p.data=json.loads(p.path.read_text())
    p.root=next(i for i,o in enumerate(p.data) if o.get('__type__')=='cc.Node' and o.get('_name')=='panelGameView')
    root=p.node(R);active=p.data[root]['_active'];clear(p,root)
    loc(p,R,0,0,750,1334);ensure_widget(p,root).update(_enabled=True,alignMode=1,_alignFlags=45,_left=0,_right=0,_top=0,_bottom=0)
    mask=art(p,R+'/mask','dim',(0,0,1024,1536));loc(p,R+'/mask',0,0,750,1334)
    ensure_widget(p,mask).update(_enabled=True,alignMode=1,_alignFlags=45,_left=0,_right=0,_top=0,_bottom=0)
    loc(p,R+'/bk',0,0,750,1334)
    art(p,R+'/bk/V8底板','panel',(76,280,949,1312))
    art(p,R+'/bk/V8标题','title',(278,242,747,343))
    art(p,R+'/bk/关闭上上层','close',(861,309,923,372))
    # Keep both legacy backing node identities, and keep the recharge's parent chain.
    for r in p.data[root]['_children']:
        n=r['__id__']
        if p.data[n]['_name']=='数值底框':p.set_pos(n,0,0,750,1334,disable_widget=True)
    art(p,R+'/数值底框/充值','recharge',(716,957,869,1027))
    plates=[]
    for key,box in [('selection',(130,396,894,817)),('amount',(177,489,847,639)),('balance',(130,841,894,1047))]:plates.append(art(p,R+'/V8_'+key,key,box))
    for key,box in [('caption',(419,422,605,468)),('already',(170,874,288,916)),('balance_label',(170,971,327,1013)),('minimum',(158,741,228,779)),('maximum',(708,741,775,779)),('hint',(343,1080,680,1120))]:art(p,R+'/V8_'+key,key,box)
    digits(p,R+'/msg',(224,497,799,635),size=128,large=True)
    digits(p,R+'/已带入',(354,869,714,922),align=2)
    digits(p,R+'/gold',(354,965,699,1018),align=2)
    digits(p,R+'/V8最低值',(234,737,441,783),size=39,align=0)
    digits(p,R+'/V8最高值',(779,737,866,783),size=39,align=2)
    slider=position(p,R+'/Slider',(165,670,858,731))
    art(p,R+'/Slider/Background','track',(164,689,860,713),parent_center=(511.5,700.5),sliced=True)
    fill=art(p,R+'/Slider/Fill','fill',(165,688,858,713),parent_center=(511.5,700.5),sliced=True)
    handle=art(p,R+'/Slider/Handle','handle',(135,670,194,730),parent_center=(511.5,700.5))
    p.set_active(p.node(R+'/Slider/SliderCopy'),False);p.set_active(p.node(R+'/Slider/Handle/lg1'),False)
    oldid=p.data[slider]['_components'][0]['__id__'];old=p.data[oldid]
    p.data[oldid]={'__type__':'cc.Slider','_name':'','_objFlags':0,'node':{'__id__':slider},'_enabled':True,'direction':0,'slideEvents':[],'_N$handle':old['_N$handle'],'_N$progress':0,'_id':''}
    _,progress=p.component(slider,'cc.ProgressBar')
    if progress is None:
        pi=len(p.data);progress={'__type__':'cc.ProgressBar','_name':'','_objFlags':0,'node':{'__id__':slider},'_enabled':True,'_id':''};p.data.append(progress);p.data[slider]['_components'].append({'__id__':pi})
    progress.update(**{'_N$barSprite':{'__id__':p.component(fill,'cc.Sprite')[0]},'_N$mode':0,'_N$totalLength':693*S,'_N$progress':0,'_N$reverse':False})
    art(p,R+'/关闭上层','cancel',(131,1149,500,1263));art(p,R+'/确认带入','confirm',(526,1149,894,1263))
    p.set_active(p.node(R+'/sit'),False)
    # Place every newly added backdrop below live values and hit targets.
    refs=p.data[root]['_children'];front=[mask,p.node(R+'/bk')]+plates
    refs[:]=[{'__id__':i} for i in front]+[r for r in refs if r['__id__'] not in front]
    bchildren=p.data[p.node(R+'/bk')]['_children'];close=p.node(R+'/bk/关闭上上层');bchildren[:]=[r for r in bchildren if r['__id__']!=close]+[{'__id__':close}]
    # Balance-insufficient overlay: keep the existing callback names and prompt text dynamic.
    notice=p.node(R+'/余额不足提示');loc(p,R+'/余额不足提示',0,0,700*S,540*S);p.sprite(notice,'buyin_v8_notice_panel.png',True)
    n=p.node(R+'/余额不足提示/带入积分');loc(p,R+'/余额不足提示/带入积分',0,250*S,469*S,101*S);p.sprite(n,'buyin_v8_title.png')
    label(p,R+'/余额不足提示/txt','余额不足，请充值',x=0,y=55*S,w=600*S,h=170*S,size=42*S,wrap=True)
    for r in p.data[notice]['_children']:
        n=r['__id__'];name=p.data[n]['_name'];_,button=p.component(n,'cc.Button')
        if not button:continue
        if name=='充值':
            p.set_pos(n,164*S,-160*S,280*S,110*S,True);p.sprite(n,'buyin_v8_recharge.png')
        elif p.data[n]['_children']:
            p.set_pos(n,300*S,213*S,64*S,64*S,True);p.sprite(n,'buyin_v8_close.png');p.hide_children(n);button['_N$target']={'__id__':n}
        else:p.set_pos(n,-164*S,-160*S,280*S,86.5*S,True);p.sprite(n,'buyin_v8_cancel.png')
    p.set_active(notice,False)
    refs=p.data[root]['_children'];refs[:]=[r for r in refs if r['__id__']!=notice]+[{'__id__':notice}]
    def fix_buttons(n):
        _,b=p.component(n,'cc.Button')
        if b:
            b.update(_enabled=True,zoomScale=.97,**{'_N$transition':3,'transition':3,'_N$target':{'__id__':n}})
            _,sp=p.component(n,'cc.Sprite')
            if sp and sp.get('_spriteFrame'):
                for k in ['_N$normalSprite','_N$pressedSprite','pressedSprite','_N$hoverSprite','hoverSprite','_N$disabledSprite']:b[k]=copy.deepcopy(sp['_spriteFrame'])
        for r in p.data[n]['_children']:fix_buttons(r['__id__'])
    fix_buttons(root)
    cid,c=p.component(root,COMPONENT_ID)
    if c is None:cid,c=p.component(root,COMPONENT_UUID)
    if c is None:
        cid=len(p.data);c={'__type__':COMPONENT_ID,'_name':'','_objFlags':0,'node':{'__id__':root},'_enabled':True,'_id':''};p.data.append(c);p.data[root]['_components'].append({'__id__':cid})
    c['__type__']=COMPONENT_ID
    for key,path,typ in [('slider','Slider','cc.Slider'),('fill','Slider','cc.ProgressBar'),('amount','msg','cc.Label'),('minimum','V8最低值','cc.Label'),('maximum','V8最高值','cc.Label'),('already','已带入','cc.Label'),('balance','gold','cc.Label'),('confirm','确认带入','cc.Button')]:c[key]={'__id__':p.component(p.node(R+'/'+path),typ)[0]}
    p.set_active(root,active);p.save()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--extract',action='store_true');args=parser.parse_args()
    if args.extract:extract()
    mp=ROOT/'assets/scripts/common/BuyinDisplay.ts.meta'
    if not mp.exists():mp.write_text(json.dumps(dict(ver='1.1.0',uuid=COMPONENT_UUID,importer='typescript',isPlugin=False,loadPluginInWeb=True,loadPluginInNative=True,loadPluginInEditor=False,subMetas={}),indent=2)+'\n')
    for file in ['assets/resources/UI/panelGameView.prefab','assets/Scenes/drh8.fire']:room(file)
