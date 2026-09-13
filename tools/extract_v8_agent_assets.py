#!/usr/bin/env python3
"""Source-locked agent component cuts. Never run historical V7 crop tools."""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import numpy as np
from scipy import ndimage
from apply_v7_prefab_skin import ROOT,ASSET_DIR
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import clear_rect,foreground,compact_panel
from repair_v8_money_art import contour

SOURCE=ROOT/'design-previews/效果图V8-new/05-后续模块'
OUT=ROOT/'art_sources/v8-repairs/agent'
S=750/941
MANIFEST={}

def depth_material(image,name,radius):
    """Fit the actual unobscured blue face, not the bright perimeter.

    Gold text and its shadow are excluded, as are shields and inset controls.
    A low-order surface keeps the reference's broad light/dark depth without
    stretching noisy scanlines. The source rim and complete corners stay intact.
    """
    arr=np.asarray(image).copy();h,w=arr.shape[:2];rgb=arr[:,:,:3].astype(float)
    warm=(rgb[:,:,0]>65)&(rgb[:,:,0]>rgb[:,:,2]*.64)
    excluded=ndimage.binary_dilation(warm,iterations=7)
    objects={
        'hero':[(35,20,210,h-15),(575,65,w-12,h-36)],
        'popup':[(250,128,425,310),(30,h-130,w-30,h-22)],
        'ratio_popup':[(233,140,432,350),(25,h-145,w-25,h-18)],
        'promotion_panel':[(180,102,565,480),(28,549,w-28,668),(130,760,w-130,1020)],
        'tabs':[(0,0,265,h)],
    }.get(name,[])
    for x0,y0,x1,y1 in objects:excluded[max(0,y0):min(h,y1),max(0,x0):min(w,x1)]=True
    excluded[:18]=True;excluded[-18:]=True;excluded[:,:18]=True;excluded[:,-18:]=True
    ys,xs=np.mgrid[0:h,0:w];x=xs/(w-1)*2-1;y=ys/(h-1)*2-1
    terms=[(i,j) for i in range(5) for j in range(5-i)]
    samples=(~excluded)&(xs%5==0)&(ys%5==0)
    assert samples.sum()>len(terms)*2,(name,'insufficient clean source face')
    basis=np.stack([x**i*y**j for i,j in terms],axis=-1)
    a=basis[samples];values=rgb[samples]
    coeff=np.linalg.lstsq(a,values,rcond=None)[0]
    # Remove sparse bevel/divider remnants from the fit without flattening it.
    residual=np.abs(a@coeff-values).max(axis=1);keep=residual<max(9,np.quantile(residual,.8))
    coeff=np.linalg.lstsq(a[keep],values[keep],rcond=None)[0]
    filled=arr.copy();filled[:,:,:3]=np.clip(basis@coeff,0,255).astype('uint8')
    inset=26 if name in ['hero','summary','data'] else 22 if name in ['popup','ratio_popup','promotion_panel'] else 9
    mask=Image.new('L',(w,h));ImageDraw.Draw(mask).rounded_rectangle((inset,inset,w-inset-1,h-inset-1),radius=max(3,radius-inset),fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(2))
    return Image.composite(Image.fromarray(filled),image,mask)

def source(index):return next(SOURCE.glob(f'{index:02}-*.png'))

def cut(name,index,box,radius=0,clean=False,border=0,glyph=False,compact=None):
    src=source(index);im=Image.open(src).convert('RGBA').crop(box)
    if clean and name!='qr_back':
        im=depth_material(im,name,radius)
    elif clean:
        # The hole encloses all sample content; its four boundaries are clear
        # blue material, several pixels inside the entire rounded rim.
        arr=np.asarray(im).copy();x0,y0,x1,y1=12,8,im.width-12,im.height-8
        # Side samples stay outside the controls, including wide confirm
        # buttons. Clamp the samples near corners to the straight rim segment.
        sampling=arr.copy();corner=round(radius+10)
        sampling[y0,:, :3]=sampling[y0,:, :3]
        for yy in [y0,y1-1]:
            sampling[yy,:corner,:3]=sampling[yy,corner,:3]
            sampling[yy,-corner:,:3]=sampling[yy,-corner-1,:3]
        for xx in [x0,x1-1]:
            sampling[:corner,xx,:3]=sampling[corner,xx,:3]
            sampling[-corner:,xx,:3]=sampling[-corner-1,xx,:3]
        # Smooth only clean boundary samples along their own axis. Stretching
        # raw noisy scanlines produces the vertical bands rejected by the user.
        top=np.asarray(Image.fromarray(sampling[y0:y0+1,x0:x1,:3]).resize((x1-x0,33)).filter(ImageFilter.GaussianBlur(22)))[16].astype(float)
        bot=np.asarray(Image.fromarray(sampling[y1-1:y1,x0:x1,:3]).resize((x1-x0,33)).filter(ImageFilter.GaussianBlur(22)))[16].astype(float)
        left=np.asarray(Image.fromarray(sampling[y0:y1,x0:x0+1,:3]).resize((33,y1-y0)).filter(ImageFilter.GaussianBlur(15)))[:,16].astype(float)
        right=np.asarray(Image.fromarray(sampling[y0:y1,x1-1:x1,:3]).resize((33,y1-y0)).filter(ImageFilter.GaussianBlur(15)))[:,16].astype(float)
        u=np.linspace(0,1,x1-x0)[:,None]
        for y in range(y0,y1):
            v=(y-y0)/(y1-y0-1);side=(1-u)*left[y-y0]+u*right[y-y0]
            corners=(1-u)*((1-v)*top[0]+v*bot[0])+u*((1-v)*top[-1]+v*bot[-1])
            arr[y,x0:x1,:3]=np.clip((1-v)*top+v*bot+side-corners,0,255)
        mask=Image.new('L',im.size);ImageDraw.Draw(mask).rounded_rectangle((12,8,im.width-13,im.height-9),radius=max(4,radius-8),fill=255)
        im=Image.composite(Image.fromarray(arr),im,mask)
    if radius:
        r=min(radius,(min(im.size)-5)/2)
        im=contour(im,(0,1,im.width-1,im.height-2),(r,r))
    if glyph:im=foreground(im)
    if border:
        im=im.resize((round(im.width*S),round(im.height*S)),Image.Resampling.LANCZOS)
        if compact:im=compact_panel(im,compact,border)
    filename='agent_v8_'+name+'.png';im.save(ASSET_DIR/filename,optimize=True);update_meta(filename)
    mp=ASSET_DIR/(filename+'.meta');meta=json.loads(mp.read_text());meta.update(packable=False,filterMode='bilinear')
    f=meta['subMetas'][Path(filename).stem]
    for edge in ['borderLeft','borderRight','borderTop','borderBottom']:f[edge]=border
    mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    MANIFEST[filename]=dict(source=str(src.relative_to(ROOT)),box=box,radius=radius,clean=clean,
        border=border,glyph=glyph,size=im.size,sha256=hashlib.sha256((ASSET_DIR/filename).read_bytes()).hexdigest())

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for i in range(8,16):cut('header_'+str(i),i,(0,0,Image.open(source(i)).width,90))
    # Natural source border widths are converted to logical pixels BEFORE
    # slicing. All curved pixels stay in the fixed corner cells.
    cut('hero',8,(69,136,873,357),27,True,30,compact=(360,176))
    cut('summary',8,(69,378,873,549),25,True,30,compact=(360,136))
    cut('data',8,(69,896,873,1219),25,True,30,compact=(360,258))
    cut('row',9,(78,396,863,490),17,22,20,compact=(360,75))
    cut('table_base',9,(69,318,873,387),20,24,21,compact=(360,55))
    # Unobscured lower list material: no sample rows/characters in this crop.
    # Top comes from the clean header panel and is overlaid by the table header.
    cut('list',9,(69,920,873,1457),22,False,25,compact=(420,428))
    cut('pager',10,(23,1477,918,1616),12,True,17,compact=(420,111))
    cut('page_value',9,(346,1512,593,1597),16,True,19,compact=(197,68))
    cut('button_base',8,(652,218,842,302),20,True,23)
    cut('popup',17,(128,508,814,1132),34,True,34,compact=(460,497))
    cut('ratio_popup',23,(75,581,736,1281),34,True,34,compact=(460,558))
    for name,box in [('players',(76,620,348,734)),('performance',(360,620,625,734)),
        ('leaders',(637,620,868,734)),('history',(76,754,348,870)),
        ('promotion',(360,754,625,870)),('total',(637,754,868,870)),('withdraw',(651,217,843,303))]:
        cut('home_'+name,8,box,24 if name!='withdraw' else 20)
    for name,box in [('manage',(371,563,574,611)),('data',(369,925,575,974))]:cut('caption_'+name,8,box)
    cut('rule_title',8,(90,584,352,587))
    cut('rule_data',8,(89,947,362,950))
    cut('rule_horizontal',8,(108,1106,832,1109))
    cut('rule_vertical',8,(279,1003,282,1080))
    cut('hero_title',8,(297,169,450,211),glyph=True)
    # Independent shield keeps the actual dark interior as well as gold rim.
    src=Image.open(source(8)).convert('RGBA');im=src.crop((118,164,259,328))
    mask=Image.new('L',(im.width*4,im.height*4));pts=[(69,2),(88,11),(116,20),(119,34),(136,48),(130,100),(118,127),(92,148),(69,162),(48,150),(22,128),(11,102),(2,47),(18,35),(22,18),(45,13)]
    ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in pts],fill=255);im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS))
    name='agent_v8_shield.png';im.save(ASSET_DIR/name);update_meta(name)
    MANIFEST[name]=dict(source=str(source(8).relative_to(ROOT)),box=(118,164,259,328),polygon=pts,size=im.size)
    for name,box in [('first',(89,1512,173,1596)),('prev',(229,1512,314,1596)),('next',(625,1512,712,1596)),('last',(765,1512,851,1596))]:
        cut('page_'+name,9,box,40)
    cut('tabs',10,(87,137,855,218),25,True,26,compact=(400,65))
    cut('tab_active',10,(96,143,348,211),18,True,20)
    for i,name in [(16,'leader'),(17,'pool'),(18,'region'),(19,'share')]:
        cut('title_'+name,i,(353,543,590,601),glyph=True)
    for i,name,box in [(20,'add',(365,543,578,601)),(21,'delete',(384,554,562,602)),
        (22,'withdraw',(383,546,565,598)),(23,'ratio',(313,629,499,684))]:cut('title_'+name,i,box,glyph=True)
    for name,i,box in [('cancel',17,(180,1010,456,1098)),('income',17,(488,1010,762,1098)),
        ('ok',16,(280,1006,665,1100)),('add',20,(486,1025,797,1123)),
        ('delete',21,(490,992,771,1083)),('withdraw',22,(489,992,772,1091)),
        ('ratio',23,(418,1141,700,1238))]:cut('button_'+name,i,box,23)
    cut('promotion_banner',15,(67,130,878,316),27)
    cut('promotion_title',15,(327,374,618,424),glyph=True)
    cut('promotion_panel',15,(101,346,843,1477),34,True,34,compact=(460,500))
    cut('qr_back',15,(291,460,656,818),20,True,23)
    cut('promotion_share',15,(239,1118,705,1226),23)
    cut('promotion_save',15,(239,1243,705,1352),23)
    Image.new('RGBA',(2,2),'white').save(ASSET_DIR/'agent_v8_solid.png');update_meta('agent_v8_solid.png')
    OUT.joinpath('cuts.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2)+'\n')
    print('Wrote',len(MANIFEST),'independent source components; full rounded contours retained.')

if __name__=='__main__':main()
