#!/usr/bin/env python3
"""Author record Prefabs with shared lobby scenery and compact nine-slices."""
import hashlib
import json
import uuid
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from apply_v7_prefab_skin import Prefab, ASSET_DIR, ROOT
from apply_v7_lobby_exact import untint, style_label
from apply_v7_record_exact import full_view
from apply_v8_login import update_meta
from apply_v8_mine import unique_clone
from apply_v8_wallet_recharge import clear_rect, compact_panel
from repair_v7_responsive_layout import top, bottom, stretch, ensure_widget

S=750/941
SOURCE=ROOT/'design-previews/效果图V8-new/01-主页面/04-战绩.png'
OUT=ROOT/'art_sources/v8-repairs/record'
PAGE='assets/resources/UI/panelRecordList.prefab'
ROW='assets/resources/Prefabs/战绩对象.prefab'
DIGIT_FONT_UUID=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-record/digit-font'))

def contour(im,bounds,radii):
    scale=4;mask=Image.new('L',(im.width*scale,im.height*scale));d=ImageDraw.Draw(mask)
    x0,y0,x1,y1=[v*scale for v in bounds];rt,rb=[v*scale for v in radii]
    d.rectangle((x0+rt,y0,x1-rt,y0+rt),fill=255)
    d.rectangle((x0,y0+rt,x1,y1-rb),fill=255)
    d.rectangle((x0+rb,y1-rb,x1-rb,y1),fill=255)
    for x,y,r,start in [(x0,y0,rt,180),(x1-2*rt,y0,rt,270),(x0,y1-2*rb,rb,90),(x1-2*rb,y1-2*rb,rb,0)]:
        if r:d.pieslice((x,y,x+2*r,y+2*r),start,start+90,fill=255)
    im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));return im

def extract():
    src=Image.open(SOURCE).convert('RGBA');manifest={}
    def save(name,im,box,border=0):
        im.save(ASSET_DIR/name,optimize=True);update_meta(name)
        mp=ASSET_DIR/(name+'.meta');meta=json.loads(mp.read_text());fr=meta['subMetas'][Path(name).stem]
        for edge in ['borderLeft','borderRight','borderTop','borderBottom']:fr[edge]=border
        mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
        manifest[name]=dict(sourceBox=list(box),size=list(im.size),border=border,sha256=hashlib.sha256((ASSET_DIR/name).read_bytes()).hexdigest())
    def sliced(name,im,box,size,border):
        # Cocos keeps border pixels unscaled. Normalize to canvas units first.
        im=im.resize((round(im.width*S),round(im.height*S)),Image.Resampling.LANCZOS)
        save(name,compact_panel(im,size,border),box,border)
    save('record_header_exact.png',src.crop((0,0,941,90)),(0,0,941,90))
    # Trace the approved silhouette, retaining curved shoulders and side wings.
    box=(306,147,622,527);points=[]
    def line(x,y):points.append((x,y))
    def curve(a,b,c):
        start=points[-1]
        for t in np.linspace(0,1,32)[1:]:
            q=1-t;points.append(tuple(q**3*start[k]+3*q*q*t*a[k]+3*q*t*t*b[k]+t**3*c[k] for k in [0,1]))
    line(467,149);curve((435,170),(393,178),(359,188));curve((354,218),(332,241),(309,248))
    line(333,355);line(316,344);line(340,427);curve((342,449),(351,461),(370,471))
    curve((402,489),(434,508),(467,524));curve((500,505),(530,488),(562,470))
    curve((585,460),(593,448),(598,423));line(610,344);line(597,355);line(620,249)
    curve((592,241),(571,217),(567,188));curve((531,180),(493,164),(467,149))
    im=src.crop(box);mask=Image.new('L',(im.width*4,im.height*4))
    ImageDraw.Draw(mask).polygon([((x-box[0])*4,(y-box[1])*4) for x,y in points],fill=255)
    im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save('record_hero_exact.png',im,box)
    # Empty normal capsule: source end caps and unobstructed blue material.
    box=(54,550,885,635);im=src.crop(box)
    for hole in [(78,15,194,70),(262,7,555,81),(626,15,737,70)]:im=clear_rect(im,hole)
    arr=np.asarray(im).copy();left=np.asarray(im)[:,190:254,:3].mean(axis=1);right=np.asarray(im)[:,565:625,:3].mean(axis=1)
    for x in range(266,555):
        u=(x-266)/288;arr[7:81,x,:3]=(left[7:81]*(1-u)+right[7:81]*u).astype('uint8')
    im=contour(Image.fromarray(arr),(0,0,830,84),(41,41));sliced('v8_record_tabs_base.png',im,box,(240,68),33)
    box=(325,557,602,630);im=clear_rect(src.crop(box),(84,10,195,64))
    im=contour(im,(1,1,275,71),(23,23));sliced('v8_record_selected_base.png',im,box,(112,58),20)
    # Split source glyphs from their bases. Both toggle states retain the glyph.
    for key,box,dark in [('today',(155,570,234,617),False),('yesterday',(420,570,508,618),True),('before',(697,570,775,617),False)]:
        arr=np.asarray(src.crop(box)).astype(float)
        alpha=np.clip((190-arr[:,:,0])/150,0,1) if dark else np.clip((arr[:,:,0]-45)/150,0,1)
        for state,color in [('normal',(248,232,202)),('selected',(9,37,61))]:
            out=np.zeros(arr.shape,dtype='uint8');out[:,:,:3]=color;out[:,:,3]=(alpha*255).astype('uint8')
            save('v8_record_'+key+'_'+state+'.png',Image.fromarray(out),box)
    box=(18,650,923,730);save('record_table_header_exact.png',contour(src.crop(box),(0,0,904,79),(32,0)),box)
    # Four clean boundaries remove sample contents; no thin band is tiled.
    box=(18,730,923,1635);im=src.crop(box)
    # Average the unobscured inter-row field before enlarging it, so neither
    # row-border shadows nor pixel-scale grain become long repeated stripes.
    gaps=[737,874,1009,1144,1279,1414,1543,1610]
    samples=np.asarray(src)[gaps,26:915,:].mean(axis=0).astype('uint8')[None,:,:]
    material=Image.fromarray(samples).resize((32,1),Image.Resampling.BOX).resize((889,875),Image.Resampling.BICUBIC)
    im.paste(material,(8,5))
    im=contour(im,(0,-32,904,904),(0,30));sliced('record_list_panel_exact.png',im,box,(224,240),26)
    box=(27,745,913,865);im=clear_rect(src.crop(box),(20,14,866,106))
    im=contour(im,(0,0,885,119),(22,22));sliced('record_row_exact.png',im,box,(224,96),20)
    box=(48,762,140,850);im=src.crop(box);a=np.asarray(im).astype(float)
    mask=Image.fromarray((np.clip((a[:,:,0]-45)/150,0,1)*255).astype('uint8'))
    ImageDraw.Draw(mask).ellipse((18,2,69,55),fill=255);im.putalpha(mask);save('v8_record_replay.png',im,box)
    box=(40,1566,896,1610);im=src.crop(box);a=np.asarray(im).astype(float)
    im.putalpha(Image.fromarray((np.clip((a[:,:,0]-40)/145,0,1)*255).astype('uint8')));save('v8_record_retention.png',im,box)
    # The reference's condensed numerals stay dynamic via a tiny LabelAtlas.
    # This avoids substituting the wider body font for room IDs and scores.
    glyphs={}
    for text,box in [('496535',(174,782,284,825)),('392150',(174,918,284,961)),
                     ('843617',(174,1053,284,1096)),('20/40',(354,782,448,825)),
                     ('-3000',(748,782,849,825)),('+9063',(748,918,849,961))]:
        a=np.asarray(src.crop(box)).astype(float);solid=a[:,:,0]>90
        edges=np.diff(np.r_[False,solid.sum(axis=0)>1,False].astype(int))
        runs=list(zip(np.where(edges==1)[0],np.where(edges==-1)[0]))
        assert len(runs)==len(text),(text,runs)
        for ch,(left,right) in zip(text,runs):
            if ch in glyphs:continue
            left=max(0,int(left)-1);right=min(a.shape[1],int(right)+1)
            alpha=np.clip((a[:,left:right,0]-45)/150,0,1)
            ys=np.where(solid[:,left:right])[0]
            # All digits share a baseline; signs retain their source midline.
            shift=8 if box[1]==782 else 9
            cell=Image.new('RGBA',(18,36))
            pixels=np.full((43,right-left,4),255,dtype='uint8');pixels[:,:,3]=(alpha*255).astype('uint8')
            cell.alpha_composite(Image.fromarray(pixels),((18-(right-left))//2,5-shift))
            glyphs[ch]=cell
    atlas=Image.new('RGBA',(18*15,36))
    for code in range(43,58):
        ch=chr(code);cell=glyphs.get(ch,Image.new('RGBA',(18,36)))
        if ch in '.,':
            d=ImageDraw.Draw(cell);d.ellipse((7,27,9,29),fill='white')
            if ch==',':d.line((9,29,7,32),fill='white',width=1)
        atlas.alpha_composite(cell,((code-43)*18,0))
    save('v8_record_digits.png',atlas,(174,782,849,1096))
    font=ASSET_DIR/'v8_record_digits.labelatlas'
    font.write_text('{"__type__":"cc.LabelAtlas"}\n')
    texture=json.loads((ASSET_DIR/'v8_record_digits.png.meta').read_text())['uuid']
    fm=dict(ver='1.1.2',uuid=DIGIT_FONT_UUID,importer='label-atlas',itemWidth=18,itemHeight=36,startChar='+',rawTextureUuid=texture,fontSize=31.68,subMetas={})
    Path(str(font)+'.meta').write_text(json.dumps(fm,indent=2)+'\n')
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'cuts.json').write_text(json.dumps(dict(source=str(SOURCE.relative_to(ROOT)),source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),assets=manifest),ensure_ascii=False,indent=2)+'\n')
    prepared=OUT/'prepared';prepared.mkdir(exist_ok=True);crops=[]
    for name in manifest:
        im=Image.open(ASSET_DIR/name);im.save(prepared/name,optimize=True)
        crops.append(dict(source=str((prepared/name).relative_to(ROOT)),output='assets/resources/V7/'+name,box=[0,0,im.width,im.height]))
    (ROOT/'tools/v8_record_crops.json').write_text(json.dumps(crops,ensure_ascii=False,indent=2)+'\n')

def reset(p,n):
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[n]['_trs']['array'][7:10]=[1,1,1];untint(p,n)

def child(p,parent,name):
    try:n=next(r['__id__'] for r in p.data[parent]['_children'] if p.data[r['__id__']]['_name']==name)
    except StopIteration:
        source=next(i for i,o in enumerate(p.data) if o.get('__type__')=='cc.Node' and not o.get('_children') and p.component(i,'cc.Sprite')[1])
        n=unique_clone(p,source,parent,name)
    p.set_active(n,True);reset(p,n);p.disable(n,'cc.Widget');return n

def apply():
    p=Prefab(PAGE)
    for path in ['','V8战绩中下背景','V8战绩延展底纹']:
        n=p.node(path);p.disable(n,'cc.Sprite');p.component(n,'cc.Sprite')[1]['_spriteFrame']=None
        if path:p.set_active(n,False)
    n=p.node('bg');reset(p,n);p.set_active(n,True);p.sprite(n,'lobby_scene_long_v8.png');top(p,'bg',0,width=750,height=2353*S)
    for path,asset,box in [('title','record_header_exact.png',(0,0,941,90)),('统计','record_hero_exact.png',(306,147,622,527)),('条件','v8_record_tabs_base.png',(54,550,885,635)),('标题','record_table_header_exact.png',(18,650,923,730))]:
        n=p.node(path);reset(p,n);p.sprite(n,asset,sliced=path=='条件');a,b,c,d=box
        top(p,path,b*S,x=((a+c)/2-470.5)*S,width=(c-a)*S,height=(d-b)*S)
        if path!='条件':p.hide_children(n)
    n=p.node('title/关闭');reset(p,n);p.set_active(n,True);p.art(n,'transparent.png',-414*S,0,113*S,90*S,hide=True);p.disable(n,'cc.Widget')
    p.set_active(p.node('条件/V8昨日文字'),False);p.disable(p.node('条件'),'cc.Layout')
    for key,x,asset,w in [('0',193,'today',79),('-1',463.5,'yesterday',88),('-2',737,'before',78)]:
        t=p.node('条件/'+key);reset(p,t);p.set_pos(t,(x-469.5)*S,0,277*S,85*S,disable_widget=True)
        bg=p.node('条件/'+key+'/Background');reset(p,bg);p.art(bg,'v8_record_'+asset+'_normal.png',0,0,w*S,47*S,hide=True);p.disable(bg,'cc.Widget')
        mark=p.node('条件/'+key+'/checkmark');reset(p,mark);p.art(mark,'v8_record_selected_base.png',0,0,277*S,73*S,hide=True,sliced=True);p.disable(mark,'cc.Widget')
        text=child(p,mark,'V8日期文字');p.art(text,'v8_record_'+asset+'_selected.png',0,0,w*S,47*S)
        p.set_active(mark,key=='0');p.component(t,'cc.Toggle')[1]['_N$isChecked']=key=='0';p.data[t]['_children']=[{'__id__':bg},{'__id__':mark}]
    n=p.node('战绩列表');reset(p,n);p.disable(n,'cc.Sprite');stretch(p,'战绩列表',730*S,122*S,left=18*S,right=18*S)
    full_view(p,'战绩列表/view',905*S,820*S)
    c=p.node('战绩列表/view/content');p.data[c]['_contentSize']['width']=905*S;p.data[c]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':1}
    ensure_widget(p,c).update(_enabled=True,_alignFlags=41,_left=0,_right=0,_top=0,alignMode=1)
    p.component(c,'cc.Layout')[1].update(_enabled=True,**{'_N$layoutType':2,'_N$resizeMode':1,'_N$paddingTop':15*S,'_N$paddingBottom':12*S,'_N$spacingY':15*S})
    n=child(p,p.root,'V8战绩列表底框');p.sprite(n,'record_list_panel_exact.png',sliced=True);stretch(p,'V8战绩列表底框',730*S,37*S,left=18*S,right=18*S)
    # 用户补充要求分页常驻；沿用底部独立区域，不与保留提示重叠。
    n=p.node('V8保留提示');reset(p,n);p.hide_children(n);p.set_active(n,False);p.sprite(n,'v8_record_retention.png');bottom(p,'V8保留提示',62*S,width=856*S,height=44*S)
    n=p.node('分页');reset(p,n);p.disable(n,'cc.Sprite');p.disable(n,'cc.Layout');bottom(p,'分页',45*S,width=905*S,height=73*S);p.set_active(n,True)
    for name,key,x in [('首页','first',185),('上一页','prev',305),('下一页','next',636),('尾页','last',756)]:
        n=p.node('分页/'+name);reset(p,n);p.art(n,'money_v8_page_'+key+'.png',(x-470.5)*S,0,67*S,67*S,hide=True);p.disable(n,'cc.Widget')
    n=child(p,p.node('分页'),'V8页码底框');p.art(n,'money_v8_page_value.png',0,0,207*S,69*S,sliced=True)
    style_label(p,'分页/页码',x=0,y=0,width=195*S,height=65*S,size=28,preview='1/1')
    ids=p.data[p.node('分页')]['_children'];num=p.node('分页/页码');ids[:]=[r for r in ids if r['__id__']!=num]+[{'__id__':num}]
    ids=[p.node(name) for name in ['bg','统计','条件','V8战绩列表底框','标题','战绩列表','V8保留提示','分页','title']]
    p.data[p.root]['_children'][:]=[r for r in p.data[p.root]['_children'] if r['__id__'] not in ids]+[{'__id__':n} for n in ids];p.save()
    row=Prefab(ROW);reset(row,row.root);row.art(row.root,'record_row_exact.png',0,0,886*S,120*S,sliced=True);row.disable(row.root,'cc.Widget')
    for name,x,width,preview in [('房间号',226,155,'496535'),('底皮',401,145,'20/40'),('带入',590,150,'3000'),('输赢',801,170,'-3000')]:
        n=row.node(name);reset(row,n);row.set_active(n,True);style_label(row,name,x=(x-470)*S,y=0,width=width*S,height=60*S,size=round(35*S),preview=preview)
        row.disable(n,'cc.Widget');row.component(n,'cc.Label')[1].update(_enableWrapText=False,_overflow=2,_fontSize=25,_lineHeight=32,**{'_N$file':{'__uuid__':DIGIT_FONT_UUID},'_isSystemFontUsed':False})
        row.data[n]['_color']={'__type__':'cc.Color','r':248,'g':232,'b':202,'a':255}
    row.data[row.node('输赢')]['_color']={'__type__':'cc.Color','r':174,'g':202,'b':28,'a':255}
    n=child(row,row.root,'V8查看回放');row.art(n,'v8_record_replay.png',(94-470)*S,-S,92*S,88*S);row.save()

def main():
    extract();apply();print('Saved record components and shared lobby scene.')

if __name__=='__main__':main()
