#!/usr/bin/env python3
"""Serialize the approved three jackpot tabs; keep server values and native cards live.

Only the jackpot subtree of the room prefab/scene and the jackpot record row are
edited. Run extraction once with --extract, then rerun layout independently.
"""
import argparse, base64, copy, hashlib, json, shutil, uuid
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import foreground, rounded
from apply_v8_agent import new, loc, label
from repair_v7_responsive_layout import ensure_widget

SOURCE=ROOT/'design-previews/待确认/2026-09-14-奖池三Tab'
OUT=ROOT/'art_sources/v8-repairs/jackpot-popup'
R='奖池面板'
C=R+'/容器'
TABS=['奖池总览','奖池','奖池记录']
TIERS=['1-3','2-5','5-10','10-20','20-40','50-100']
BOXES={}

def save(key,im,box=None,source=None,border=0):
    name='jackpot_v8_'+key+'.png';dest=ASSET_DIR/name
    im.save(dest,optimize=True);update_meta(name)
    mp=Path(str(dest)+'.meta');meta=json.loads(mp.read_text())
    meta.update(packable=False,filterMode='bilinear')
    for edge in ['borderLeft','borderRight','borderTop','borderBottom']:
        meta['subMetas'][dest.stem][edge]=border
    mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    BOXES[key]=dict(box=box,source=source,size=im.size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest())

def cut(key,im,box,radius=0,glyph=False,source=None):
    piece=im.crop(box)
    if radius:piece=rounded(piece,radius)
    if glyph:piece=foreground(piece)
    save(key,piece,box,source)

def source_fonts():
    """Keep approved numeral shapes/embossing; supply every runtime glyph."""
    sources=[Image.open(SOURCE/f).convert('RGBA') for f in ['01-奖池总览.png','02-奖池-原版牌色.png','03-奖池记录.png']]
    configs=[('serif_digits',124,88,12,'Times New Roman Bold.ttf',[
        (0,(238,568,790,691),'3,001,800'),(1,(288,592,741,701),'386,800'),(2,(582,591,914,690),'77,360')]),
        ('digits',56,42,5,'Arial Bold.ttf',[
        (0,(277,872,484,932),'386,800'),(0,(712,872,918,932),'426,000'),
        (0,(277,1017,484,1078),'508,000'),(0,(712,1017,918,1078),'601,000'),
        (2,(565,913,712,967),'77,360')])]
    for key,size,cap,top,fontname,samples in configs:
        glyphs={}
        for index,box,chars in samples:
            im=sources[index].crop(box);a=np.asarray(im);m=(a[:,:,0]>110)&(a[:,:,0]>a[:,:,2]*.85)
            active=m.sum(0)>1;runs=[];start=None
            for x,on in enumerate(list(active)+[False]):
                if on and start is None:start=x
                if not on and start is not None:runs.append((start,x));start=None
            assert len(runs)==len(chars),(key,chars,runs)
            digitcols=np.zeros(im.width,bool)
            for ch,(l,r) in zip(chars,runs):
                if ch.isdigit():digitcols[l:r]=True
            ys=np.where((m&digitcols).any(1))[0];ct,cb=ys[0],ys[-1]+1;scale=cap/(cb-ct)
            for ch,(l,r) in zip(chars,runs):
                if ch in glyphs:continue
                ys=np.where(m[:,l:r].any(1))[0];t,b=ys[0],ys[-1]+1
                tile=foreground(im.crop((l-2,t-2,r+3,b+4)))
                tile=tile.resize((round(tile.width*scale),round(tile.height*scale)),Image.Resampling.LANCZOS)
                glyphs[ch]=(tile,top+round((t-ct-2)*scale),tile.width-2)
        font=ImageFont.truetype('/System/Library/Fonts/Supplemental/'+fontname,136)
        for ch in '0123456789.-—+':
            if ch in glyphs:continue
            mask=Image.new('L',(170,175));ImageDraw.Draw(mask).text((8,136),ch,font=font,anchor='ls',fill=255)
            l,t,r,b=mask.getbbox();tilemask=mask.crop((l-2,t-2,r+3,b+4))
            desired=cap if ch.isdigit() else max(4,round(cap*.12)) if ch=='.' else round(cap*.35)
            scale=desired/(b-t);tilemask=tilemask.resize((round(tilemask.width*scale),round(tilemask.height*scale)),Image.Resampling.LANCZOS)
            w,h=tilemask.size;f=np.linspace(0,1,h)[:,None,None];rgb=np.broadcast_to(np.array([255,247,218])*(1-f)+np.array([218,164,71])*f,(h,w,3)).astype('uint8')
            tile=Image.fromarray(rgb).convert('RGBA');tile.putalpha(tilemask)
            glyphs[ch]=(tile,top if ch.isdigit() else top+cap-desired,w-2)
        atlas=Image.new('RGBA',(1024,256));lines=[];x=y=3
        for ch,(tile,offset,advance) in glyphs.items():
            if x+tile.width+4>1024:x=3;y=134
            assert y+tile.height<256
            atlas.alpha_composite(tile,(x,y));lines.append(f'char id={ord(ch)} x={x} y={y} width={tile.width} height={tile.height} xoffset=0 yoffset={offset} xadvance={advance} page=0 chnl=15');x+=tile.width+6
        save(key,atlas,source='Approved jackpot number glyphs; missing glyphs use matching native serif/sans font')
        meta=json.loads((ASSET_DIR/f'jackpot_v8_{key}.png.meta').read_text());height=size if key=='serif_digits' else 64
        (ASSET_DIR/f'jackpot_v8_{key}.fnt').write_text(f'info face="V8 Jackpot {key}" size={size} bold=0 italic=0 unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0\ncommon lineHeight={height} base={top+cap} scaleW=1024 scaleH=256 pages=1 packed=0\npage id=0 file="jackpot_v8_{key}.png"\nchars count='+str(len(lines))+'\n'+'\n'.join(lines)+'\n')
        mp=ASSET_DIR/f'jackpot_v8_{key}.fnt.meta';ident=json.loads(mp.read_text())['uuid'] if mp.exists() else str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-jackpot/'+key))
        mp.write_text(json.dumps(dict(ver='2.1.2',uuid=ident,importer='bitmap-font',textureUuid=meta['uuid'],fontSize=size,subMetas={}),indent=2)+'\n')

def extract():
    im=[Image.open(SOURCE/f).convert('RGBA') for f in ['01-奖池总览.png','02-奖池-原版牌色.png','03-奖池记录.png']]
    clean=[Image.open(OUT/f'clean-{i}.png').convert('RGBA') for i in range(3)]
    base=Image.open(OUT/'blank-panel.png').convert('RGBA')
    cut('panel',base,(60,130,964,1450),radius=40)
    cut('title',im[0],(419,154,611,256),glyph=True)
    cut('title_rule',im[0],(280,257,805,293),glyph=True)
    close=im[0].crop((856,152,940,236));mask=Image.new('L',(336,336));ImageDraw.Draw(mask).ellipse((8,8,324,324),fill=255);close.putalpha(mask.resize(close.size,Image.Resampling.LANCZOS));save('close',close)
    for i,box in enumerate([(85,314,373,412),(373,314,653,412),(653,314,940,412)]):
        cut('tab_'+str(i)+'_on',im[i],box,radius=21)
        cut('tab_'+str(i)+'_off',im[1 if i==0 else 0],box,radius=21)
    for i,box in enumerate([(85,431,940,742),(85,431,940,742),(85,431,940,751)]):
        cut('hero_'+str(i),clean[i],box,radius=28)
    for i,box in enumerate([(90,757,934,809),(90,752,934,807),(90,765,934,817)]):cut('section_'+str(i),im[i],box,glyph=True)
    for i,(x,y) in enumerate([(85,818),(520,818),(85,962),(520,962),(85,1106),(520,1106)]):
        cut('tier_'+str(i),clean[0],(x,y,x+420,y+129),radius=22)
    cut('rule_overview',im[0],(85,1251,940,1429),radius=22)
    cut('detail_header',im[1],(85,809,940,867),radius=20)
    for i,y in enumerate([864,1024,1183]):cut('hand_'+str(i),clean[1],(85,y,940,y+150),radius=21)
    cut('rule_detail',im[1],(85,1347,940,1431),radius=22)
    # Preserve the original glass surface; only erase the five static row rules.
    # Separators belong to the scrolling record rows, not the fixed backdrop.
    panel=clean[2].crop((85,823,940,1429));a=np.asarray(panel).copy();h,w=a.shape[:2]
    for source_y in [974,1057,1141,1224,1312]:
        lo=source_y-823-3;hi=lo+7
        for y in range(lo,hi):
            f=(y-lo+1)/(hi-lo+1);a[y,16:w-16,:3]=a[lo-1,16:w-16,:3]*(1-f)+a[hi,16:w-16,:3]*f
    save('list',rounded(Image.fromarray(a),24))
    cut('list_header',im[2],(103,842,921,893),glyph=True)
    cut('list_hint',im[2],(383,1350,641,1386),glyph=True)
    cut('row_rule',im[2],(104,974,919,975))
    save('dim',Image.new('RGBA',(4,4),(0,7,18,165)))
    source_fonts()
    (OUT/'cuts.json').write_text(json.dumps(BOXES,ensure_ascii=False,indent=2)+'\n')

def art(p,path,key,box=None,x=0,y=0,w=None,h=None):
    parent,name=path.rsplit('/',1);n=new(p,parent,name)
    asset='jackpot_v8_'+key+'.png';iw,ih=Image.open(ASSET_DIR/asset).size
    if box:x=(box[0]+box[2])/2-512;y=790-(box[1]+box[3])/2;w=box[2]-box[0];h=box[3]-box[1]
    loc(p,path,x,y,iw if w is None else w,ih if h is None else h);p.sprite(n,asset)
    return n

def group(p,path,scale=1):
    n=p.node(path);loc(p,path,0,0,904,1320);p.disable(n,'cc.Sprite');p.data[n]['_trs']['array'][7:10]=[scale,scale,1];return n

def text(p,path,value,box,size,font=None,align=1,bold=False,wrap=False):
    x=(box[0]+box[2])/2-512;y=790-(box[1]+box[3])/2
    n=label(p,path,value,x=x,y=y,w=box[2]-box[0],h=box[3]-box[1],size=size,align=align,bold=bold,wrap=wrap)
    _,c=p.component(n,'cc.Label');c['_overflow']=c['_N$overflow']=2;c['_lineHeight']=size+5;c['_spacingX']=0
    if font:
        c['_N$file']={'__uuid__':json.loads((ASSET_DIR/(font+'.fnt.meta')).read_text())['uuid']};c['_styleFlags']=0
        p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':255,'b':255,'a':255};p.disable(n,'cc.LabelShadow')
    else:p.data[n]['_color']={'__type__':'cc.Color','r':250,'g':245,'b':231,'a':255}
    return n

def clear_scope(p,n):
    for ref in p.data[n]['_components']:
        c=p.data[ref['__id__']]
        if c['__type__'] in ['cc.Sprite','cc.Label','cc.LabelOutline','cc.LabelShadow','cc.Widget','cc.Layout']:
            c['_enabled']=False
            if c['__type__']=='cc.Sprite':c['_spriteFrame']=None
    for ref in p.data[n]['_children']:clear_scope(p,ref['__id__'])

def first(p,parent,child):
    refs=p.data[p.node(parent)]['_children'];i=p.node(child);refs[:]=[{'__id__':i}]+[r for r in refs if r['__id__']!=i]

def room(relative):
    p=Prefab.__new__(Prefab);p.path=ROOT/relative;p.data=json.loads(p.path.read_text())
    p.root=next(i for i,o in enumerate(p.data) if o.get('__type__')=='cc.Node' and o.get('_name')=='panelGameView')
    active=p.data[p.node(R)]['_active'];clear_scope(p,p.node(R))
    # Preserve full-screen blocker; the three art groups share a fixed scale.
    ensure_widget(p,p.node(R)).update(_enabled=True,alignMode=1,_alignFlags=45,_left=0,_right=0,_top=0,_bottom=0)
    n=art(p,R+'/V8遮罩','dim',w=750,h=1334)
    ensure_widget(p,n).update(_enabled=True,alignMode=1,_alignFlags=45,_left=0,_right=0,_top=0,_bottom=0)
    first(p,R,R+'/V8遮罩')
    for path in [R+'/bk',R+'/条件',C]:group(p,path,.75)
    p.sprite(p.node(R+'/bk'),'jackpot_v8_panel.png')
    art(p,R+'/bk/奖 池','title',(419,154,611,256))
    art(p,R+'/bk/V8标题分隔','title_rule',(280,257,805,293))
    n=art(p,R+'/bk/关闭上上层','close',(856,152,940,236))
    _,button=p.component(n,'cc.Button')
    if button is None:
        button=copy.deepcopy(next(o for o in p.data if o.get('__type__')=='cc.Button'))
        button.update(node={'__id__':n},_enabled=True,_id='',clickEvents=[],**{'_N$target':{'__id__':n},'_N$transition':0,'transition':0,'_N$interactable':True})
        i=len(p.data);p.data.append(button);p.data[n]['_components'].append({'__id__':i})
    for i,(name,box) in enumerate(zip(TABS,[(85,314,373,412),(373,314,653,412),(653,314,940,412)])):
        path=R+'/条件/'+name;n=p.node(path);loc(p,path,(box[0]+box[2])/2-512,790-363,box[2]-box[0],98)
        for child,state in [('Background','off'),('checkmark','on')]:art(p,path+'/'+child,f'tab_{i}_{state}',w=box[2]-box[0],h=98)
        _,toggle=p.component(n,'cc.Toggle');toggle.update(_enabled=True,**{'_N$isChecked':i==1,'_N$transition':0,'transition':0})
        p.set_active(p.node(path+'/checkmark'),i==1)
        group(p,C+'/'+name);p.set_active(p.node(C+'/'+name),i==1)
    overview=C+'/奖池总览';detail=C+'/奖池';record=C+'/奖池记录'
    for path in [overview+'/总金额',overview+'/各级奖池奖励设定',detail+'/金额',record+'/最大赢家']:group(p,path)
    for path,i in [(overview,0),(detail,1),(record,2)]:
        art(p,path+'/V8金额底板',f'hero_{i}',(85,431,940,751 if i==2 else 742));first(p,path,path+'/V8金额底板')
        art(p,path+'/V8分节标题',f'section_{i}',[(90,757,934,809),(90,752,934,807),(90,765,934,817)][i])
    text(p,overview+'/总金额/num','0',(228,550,795,693),124,'jackpot_v8_serif_digits')
    for i,(x,y) in enumerate([(85,818),(520,818),(85,962),(520,962),(85,1106),(520,1106)]):
        art(p,overview+'/各级奖池奖励设定/V8级别'+str(i),f'tier_{i}',(x,y,x+420,y+129))
        first(p,overview+'/各级奖池奖励设定',overview+'/各级奖池奖励设定/V8级别'+str(i))
        text(p,overview+'/各级奖池奖励设定/底皮'+TIERS[i],'0',(x+169,y+48,x+395,y+112),56,'jackpot_v8_digits',align=2)
    art(p,overview+'/V8规则','rule_overview',(85,1251,940,1429))
    text(p,detail+'/金额/num','0',(276,574,748,713),124,'jackpot_v8_serif_digits')
    text(p,detail+'/当前级别','底皮 —',(431,548,593,582),28,bold=True)
    art(p,detail+'/V8牌型表头','detail_header',(85,809,940,867))
    cards=[['4_1a','2_3a','2_12a','0_12a'],['4_1a','2_3a','2_2a','0_2a'],['2_12a','0_12a','2_2a','0_2a']]
    for row,y in enumerate([864,1024,1183]):
        art(p,detail+'/V8牌型行'+str(row),f'hand_{row}',(85,y,940,y+150))
        for col,key in enumerate(cards[row]):
            path=detail+f'/V8原始牌面{row}_{col}';n=new(p,detail,path.rsplit('/',1)[1])
            loc(p,path,328+114*col-512,790-(y+75),100,128.5714286)
            _,sp=p.ensure_sprite(n);meta=json.loads((ROOT/f'assets/resources/pk2/{key}.png.meta').read_text())
            sp.update(_enabled=True,_spriteFrame={'__uuid__':meta['subMetas'][key]['uuid']},_type=0,_sizeMode=0,_isTrimmedMode=False)
    art(p,detail+'/V8规则','rule_detail',(85,1347,940,1431))
    winner=record+'/最大赢家'
    text(p,winner+'/name','—',(327,573,521,638),42,bold=True)
    text(p,winner+'/type','—',(360,646,467,692),28,bold=True)
    text(p,winner+'/gold','0',(572,575,913,696),111,'jackpot_v8_serif_digits')
    text(p,winner+'/time','—',(422,705,605,742),26)
    art(p,record+'/V8记录底板','list',(85,823,940,1429));first(p,record,record+'/V8记录底板')
    try:p.set_active(p.node(record+'/V8表头'),False)
    except KeyError:pass
    art(p,record+'/V8滚动提示','list_hint',(383,1350,641,1386))
    text(p,record+'/V8记录状态','暂无获奖记录',(175,1060,850,1120),31)
    scroll=record+'/记录列表';loc(p,scroll,0,790-1103,815,420);loc(p,scroll+'/view',0,0,815,420)
    n=loc(p,scroll+'/view/content',0,210,815,0);p.data[n]['_anchorPoint']['y']=1
    _,layout=p.component(n,'cc.Layout');layout.update(_enabled=True,_resize=1,**{'_N$layoutType':2,'_N$paddingTop':0,'_N$paddingBottom':0,'_N$paddingLeft':0,'_N$paddingRight':0,'_N$spacingX':0,'_N$spacingY':0})
    p.set_active(p.node(record+'/V8滚动提示'),False)
    p.set_active(p.node(R),active);p.save()

def row():
    p=Prefab('assets/resources/Prefabs/奖池记录对象.prefab');clear_scope(p,p.root)
    loc(p,'奖池记录对象',0,0,815,84)
    for name,box,size,font,align,bold in [
        ('name',(127,0,325,84),34,None,0,True),('type',(350,0,446,84),32,None,1,False),
        ('gold',(552,0,728,84),48,'jackpot_v8_digits',2,False),('time',(786,0,887,84),25,None,1,False)]:
        # Use source-aligned columns; row's local origin is its vertical center.
        path='奖池记录对象/'+name;n=text(p,path,'—' if font is None else '0',(box[0],748,box[2],832),size,font,align=align,bold=bold,wrap=name=='time')
        if name=='time':_,c=p.component(n,'cc.Label');c['_lineHeight']=29
    art(p,'奖池记录对象/垫底','row_rule',x=0,y=-41.5,w=815,h=1)
    p.save()

if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('--extract',action='store_true');opt=args.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    if opt.extract:extract()
    room('assets/resources/UI/panelGameView.prefab');room('assets/Scenes/drh8.fire');row()
    print('Serialized approved jackpot tabs in room prefab, scene, and record row.')
