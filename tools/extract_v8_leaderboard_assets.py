#!/usr/bin/env python3
"""Cut only the approved 24–26 leaderboard states into independent components."""
import hashlib,json,uuid
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from apply_v7_prefab_skin import ROOT,ASSET_DIR
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import foreground

SOURCE=ROOT/'design-previews/效果图V8-new/05-后续模块'
OUT=ROOT/'art_sources/v8-repairs/leaderboard'
S=750/941
IM={n:Image.open(next(SOURCE.glob(str(n)+'-*.png'))).convert('RGBA') for n in [24,25,26]}
CUTS={}

def contour(im,bounds,radii):
    scale=4;mask=Image.new('L',(im.width*scale,im.height*scale));d=ImageDraw.Draw(mask)
    x0,y0,x1,y1=[v*scale for v in bounds];rt,rb=[v*scale for v in radii]
    d.rectangle((x0+rt,y0,x1-rt,y0+rt),fill=255)
    d.rectangle((x0,y0+rt,x1,y1-rb),fill=255)
    d.rectangle((x0+rb,y1-rb,x1-rb,y1),fill=255)
    for x,y,r,start in [(x0,y0,rt,180),(x1-2*rt,y0,rt,270),(x0,y1-2*rb,rb,90),(x1-2*rb,y1-2*rb,rb,0)]:
        if r:d.pieslice((x,y,x+2*r,y+2*r),start,start+90,fill=255)
    im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));return im

def save(key,im,box=None,index=24,border=0,kind='source-cut'):
    name='leaderboard_v8_'+key+'.png';dest=ASSET_DIR/name
    im.save(dest,optimize=True);update_meta(name)
    mp=Path(str(dest)+'.meta');meta=json.loads(mp.read_text());meta.update(packable=False,filterMode='bilinear')
    for edge in ['borderLeft','borderRight','borderTop','borderBottom']:meta['subMetas'][dest.stem][edge]=border
    mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    CUTS[name]=dict(source=str(next(SOURCE.glob(str(index)+'-*.png')).relative_to(ROOT)),box=box,kind=kind,border=border,size=im.size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest())

def cut(key,box,index=24,radius=0,glyph=False):
    im=IM[index].crop(box)
    if radius:im=contour(im,(0,0,im.width-1,im.height-1),(radius,radius))
    if glyph:im=foreground(im)
    save(key,im,box,index)

def material(key,box,radius,exclusions=(),index=24,header=False):
    """Fit the clean source face; preserve the full original rim/corner pixels.

    A smooth low-order field is sampled in two dimensions, never a noisy single
    scanline. Foreground, dividers, inset controls, and their shadows are masked.
    """
    im=IM[index].crop(box);a=np.asarray(im).copy();h,w=a.shape[:2];rgb=a[:,:,:3].astype(float)
    bad=(rgb[:,:,0]>rgb[:,:,2]*.60)|(rgb[:,:,1]>160)
    bad=np.asarray(Image.fromarray((bad*255).astype('uint8')).filter(ImageFilter.MaxFilter(19)))>0
    for x0,y0,x1,y1 in exclusions:bad[y0:y1,x0:x1]=True
    bad[:24]=True;bad[-24:]=True;bad[:,:24]=True;bad[:,-24:]=True
    yy,xx=np.mgrid[:h,:w];x=xx/(w-1)*2-1;y=yy/(h-1)*2-1
    basis=np.stack([x**i*y**j for i in range(5) for j in range(4) if i+j<=4],-1)
    sample=(~bad)&(xx%4==0)&(yy%4==0)
    assert sample.sum()>100,(key,sample.sum())
    b=basis[sample];v=rgb[sample];coef=np.linalg.lstsq(b,v,rcond=None)[0]
    residual=abs(b@coef-v).max(1);keep=residual<max(8,np.quantile(residual,.8));coef=np.linalg.lstsq(b[keep],v[keep],rcond=None)[0]
    field=basis@coef
    if key=='hero':
        # Avoid extrapolating a high-degree field into the shield's large hole.
        field[:,:210]=field[:,210:211]
    fitted=a.copy();fitted[:,:,:3]=np.clip(field,0,255).astype('uint8')
    mask=Image.new('L',im.size);ImageDraw.Draw(mask).rounded_rectangle((17,17,w-18,h-18),radius=max(2,radius-17),fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(2))
    im=Image.composite(Image.fromarray(fitted),im,mask)
    # The list's source left/right rims have horizontal row-rule intersections.
    # Replace only those small straight-edge intersections from clean neighbours.
    if key=='list':
        a=np.asarray(im).copy()
        for sy in [717,832,950,1067,1189,1315]:
            y0=sy-box[1]-3;y1=y0+7
            if 24<y0<h-24:
                for lo,hi in [(0,20),(w-20,w)]:
                    top=a[y0-3,lo:hi,:3].astype(float);bot=a[y1+3,lo:hi,:3].astype(float)
                    for iy in range(y0,y1):a[iy,lo:hi,:3]=top+(bot-top)*(iy-y0)/(y1-y0)
        im=Image.fromarray(a)
    im=contour(im,(1,1,w-2,h-2),(radius,0 if header else radius))
    im=im.resize((round(w*S),round(h*S)),Image.Resampling.LANCZOS)
    save(key,im,box,index,round((radius+6)*S),'source-clean-face-complete-corners')

def digits():
    glyphs={};mapping={}
    samples=[((540,750,667,809),'1,286'),((577,873,663,927),'986'),((578,1235,665,1282),'615'),
             ((799,1350,876,1406),'200'),((578,995,665,1047),'882'),((575,1114,670,1162),'728'),
             ((800,1232,876,1285),'300'),((800,1113,876,1164),'500'),((80,1089,125,1164),'4')]
    for box,chars in samples:
        im=IM[24].crop(box);a=np.asarray(im);m=(a[:,:,0]>110)&(a[:,:,0]>a[:,:,2]*.84)
        active=m.sum(0)>1;bounds=[];start=None
        for x,v in enumerate(list(active)+[False]):
            if v and start is None:start=x
            if not v and start is not None:bounds.append((start,x));start=None
        assert len(bounds)==len(chars),(chars,bounds)
        cols=np.zeros(im.width,bool)
        for ch,(l,r) in zip(chars,bounds):
            if ch.isdigit():cols[l:r]=True
        ys=np.where((m&cols).any(1))[0];cap_top=ys[0];scale=52/(ys[-1]+1-cap_top)
        for ch,(l,r) in zip(chars,bounds):
            if ch in glyphs:continue
            ys=np.where(m[:,l:r].any(1))[0];t,b=ys[0],ys[-1]+1
            part=foreground(im.crop((max(0,l-2),max(0,t-2),min(im.width,r+3),min(im.height,b+4))))
            part=part.resize((round(part.width*scale),round(part.height*scale)),Image.Resampling.LANCZOS)
            glyphs[ch]=(part,round((t-cap_top)*scale)+3,round((r-l+3)*scale))
            mapping[ch]=dict(box=[box[0]+l,box[1]+t,box[0]+r,box[1]+b])
    assert all(c in glyphs for c in '0123456789,')
    # Slash and plus are independent source glyphs; keep live page/signed values.
    for ch,box,index in [('/',(443,1512,468,1580),24),('+',(514,685,542,719),25)]:
        im=foreground(IM[index].crop(box));a=np.asarray(im);ys,xs=np.where(a[:,:,3]>100)
        assert len(xs)>5
        im=im.crop((max(0,xs.min()-1),max(0,ys.min()-1),min(im.width,xs.max()+2),min(im.height,ys.max()+2)))
        scale=(54 if ch=='/' else 32)/im.height;im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
        glyphs[ch]=(im,3 if ch=='/' else 15,im.width+3);mapping[ch]=dict(box=box,index=index)
    # The period is the source comma's top; the dash uses a straight gold edge.
    comma=glyphs[','][0];dot=comma.crop((0,0,comma.width,max(3,comma.height//2)))
    glyphs['.']=(dot,48,dot.width+2)
    dash=foreground(IM[24].crop((767,398,801,401)))
    for ch in ['-','—','−']:glyphs[ch]=(dash,30,38)
    atlas=Image.new('RGBA',(1024,128));lines=[];x=3
    for ch,(im,offset,advance) in glyphs.items():
        atlas.alpha_composite(im,(x,3));lines.append(f'char id={ord(ch)} x={x} y=3 width={im.width} height={im.height} xoffset=0 yoffset={offset} xadvance={max(im.width-3,advance)} page=0 chnl=15');x+=im.width+7
    assert x<1024
    save('digits',atlas,kind='live-source-glyph-atlas')
    meta=json.loads((ASSET_DIR/'leaderboard_v8_digits.png.meta').read_text())
    (ASSET_DIR/'leaderboard_v8_digits.fnt').write_text('info face="V8 Leaderboard" size=64 bold=0 italic=0 unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=2,2\ncommon lineHeight=68 base=57 scaleW=1024 scaleH=128 pages=1 packed=0\npage id=0 file="leaderboard_v8_digits.png"\nchars count='+str(len(lines))+'\n'+'\n'.join(lines)+'\n')
    (ASSET_DIR/'leaderboard_v8_digits.fnt.meta').write_text(json.dumps(dict(ver='2.1.0',uuid=str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-leaderboard/digits')),textureUuid=meta['uuid'],fontSize=64,subMetas={}),indent=2)+'\n')
    (OUT/'number-glyphs.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2,default=int)+'\n')

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    # Header left plate only; the rest reveals the actual lobby background.
    im=IM[24].crop((0,0,418,110));mask=Image.new('L',(418*4,110*4))
    pts=[(0,0),(415,0),(405,8),(395,21),(384,38),(375,56),(365,77),(357,90),(348,100),(337,106),(325,109),(0,109)]
    ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in pts],fill=255);im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save('header',im,(0,0,418,110))
    material('hero',(28,147,913,419),28,[(18,16,237,254),(660,161,874,258)])
    cut('hero_title',(282,170,544,235),glyph=True)
    im=IM[24].crop((55,174,250,398));mask=Image.new('L',(195*4,224*4))
    pts=[(98,0),(121,14),(162,27),(165,42),(192,63),(183,118),(173,157),(151,184),(123,207),(97,222),(64,207),(30,181),(12,148),(3,65),(24,50),(30,27),(66,17)]
    ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in pts],fill=255);im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save('shield',im,(55,174,250,398))
    cut('claim',(693,317,895,400),radius=20)
    bar=IM[24].crop((30,437,913,525))
    bar.paste(IM[25].crop((30,437,323,525)),(0,0))
    save('tabs_base',contour(bar,(0,0,882,87),(20,20)),(30,437,913,525),kind='common-normal-tab-bar-from-approved-states')
    # Each toggle owns one label/background/checkmark, with no giant bar overlay.
    for i,(name,index,box) in enumerate([('hands',24,(30,437,323,525)),('win',25,(323,437,619,525)),('agent',26,(619,437,913,525))]):
        cut('tab_'+name+'_on',box,index,radius=18)
        cut('tab_'+name+'_off',box,25 if i==0 else 24,radius=18)
    for i,(name,x0,x1) in enumerate([('1',30,205),('2',205,378),('5',378,553),('10',553,729),('20',729,913)]):
        cut('filter_'+name+'_off',(x0,545,x1,620),radius=17)
    # Normal 1皮 is built from clean normal material + source normal numeral.
    # Selected controls use the approved first pill, with a real label for all five.
    # Remove source text using clean top/bottom field interpolation, smoothed in X.
    for state,box in [('on',(30,545,205,620)),('off',(205,545,378,620))]:
        im=IM[24].crop(box);a=np.asarray(im).copy();h,w=a.shape[:2]
        top=np.asarray(Image.fromarray(a[9:12,:,:3]).resize((w,45)).filter(ImageFilter.GaussianBlur(15)))[22].astype(float)
        bot=np.asarray(Image.fromarray(a[-10:-7,:,:3]).resize((w,45)).filter(ImageFilter.GaussianBlur(15)))[22].astype(float)
        for yy in range(12,h-11):
            t=(yy-12)/(h-24);a[yy,14:w-14,:3]=(top[14:w-14]*(1-t)+bot[14:w-14]*t).astype('uint8')
        im=contour(Image.fromarray(a),(0,0,w-1,h-1),(17,17));save('filter_'+state,im,box)
    material('list',(28,635,913,1447),28,[(0,0,885,91)])
    # Only static column headings are in these crops; no row/sample data.
    for name,index,box in [('hands',24,(28,635,913,719)),('win',25,(28,545,913,638)),('agent',26,(28,545,913,638))]:
        im=IM[index].crop(box);im=contour(im,(0,0,im.width-1,im.height-1),(27,0));save('table_'+name,im,box,index)
    for rank,box in [(1,(54,730,151,819)),(2,(54,848,151,934)),(3,(55,963,151,1053))]:
        im=IM[24].crop(box);mask=Image.new('L',(im.width*4,im.height*4));d=ImageDraw.Draw(mask)
        pts=[(7,27),(26,44),(49,12),(73,43),(89,25),(79,79),(18,79)]
        d.polygon([(x*4,y*4) for x,y in pts],fill=255)
        for x,y in [(7,27),(49,11),(89,26)]:d.ellipse(((x-6)*4,(y-6)*4,(x+6)*4,(y+6)*4),fill=255)
        # Preserve the entire polished base and the dark numeric ink.
        d.rounded_rectangle((15*4,74*4,82*4,(im.height-6)*4),radius=3*4,fill=255)
        im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save('crown_'+str(rank),im,box)
    # Sample the bright stroke itself; surrounding blue rows dilute thin rules.
    cut('rule_horizontal',(45,832,894,833));cut('rule_vertical',(470,743,471,820))
    material('pager',(28,1469,913,1614),27,[(38,12,150,132),(183,12,298,132),(310,12,579,132),(590,12,705,132),(735,12,851,132)])
    # Clear page-number field without touching its complete rounded rim.
    im=IM[24].crop((344,1489,599,1593));a=np.asarray(im).copy()
    top=np.asarray(Image.fromarray(a[12:15,:,:3]).resize((im.width,41)).filter(ImageFilter.GaussianBlur(14)))[20].astype(float)
    bot=np.asarray(Image.fromarray(a[-15:-12,:,:3]).resize((im.width,41)).filter(ImageFilter.GaussianBlur(14)))[20].astype(float)
    for yy in range(14,im.height-14):
        t=(yy-14)/(im.height-29);a[yy,16:-16,:3]=(top[16:-16]*(1-t)+bot[16:-16]*t).astype('uint8')
    save('page_value',contour(Image.fromarray(a),(0,0,im.width-1,im.height-1),(22,22)),(344,1489,599,1593))
    for name,box in [('first',(70,1491,172,1595)),('prev',(216,1491,318,1595)),('next',(623,1491,726,1595)),('last',(769,1491,872,1595))]:
        im=IM[24].crop(box);mask=Image.new('L',(im.width*4,im.height*4));ImageDraw.Draw(mask).ellipse((4,4,(im.width-1)*4,(im.height-1)*4),fill=255);im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save('page_'+name,im,box)
    digits()
    (OUT/'cuts.json').write_text(json.dumps(CUTS,ensure_ascii=False,indent=2)+'\n')
    print('Leaderboard components:',len(CUTS))

if __name__=='__main__':main()
