#!/usr/bin/env python3
"""Keep dynamic numbers live using the approved source's gold glyph pixels."""
import json,uuid
import numpy as np
from PIL import Image,ImageFilter
from extract_v8_agent_assets import source,ASSET_DIR,OUT,update_meta,foreground

def main():
    # Font-size normalization only: preserve each source glyph's aspect ratio.
    samples=[(8,(145,458,268,509),'26,800'),(8,(411,458,535,509),'17,912'),
             (8,(690,458,777,509),'386'),(8,(680,1164,741,1202),'419'),
             (8,(766,1044,797,1090),'5'),(8,(294,212,559,286),'8,888.00'),
             (12,(586,208,802,278),'18.50%')]
    glyphs={};manifest={}
    for idx,box,text in samples:
        im=Image.open(source(idx)).convert('RGBA').crop(box);a=np.array(im)
        mask=(a[:,:,0]>100)&(a[:,:,0]>a[:,:,2]*.85)
        active=mask.sum(axis=0)>1;bounds=[];start=None
        for x,v in enumerate(list(active)+[False]):
            if v and start is None:start=x
            if not v and start is not None:bounds.append((start,x));start=None
        assert len(bounds)==len(text),(text,bounds)
        # Cap height from full digits, punctuation must retain its baseline.
        digit_cols=np.zeros(im.width,bool)
        for char,(l,r) in zip(text,bounds):
            if char.isdigit():digit_cols[l:r]=True
        ys=np.where((mask&digit_cols).any(axis=1))[0];cap_top,cap_bottom=ys[0],ys[-1]+1
        scale=52/(cap_bottom-cap_top)
        for char,(l,r) in zip(text,bounds):
            if char in glyphs:continue
            ys=np.where(mask[:,l:r].any(axis=1))[0];t,b=ys[0],ys[-1]+1
            piece=foreground(im.crop((max(0,l-2),max(0,t-2),min(im.width,r+3),min(im.height,b+4))))
            piece=piece.resize((round(piece.width*scale),round(piece.height*scale)),Image.Resampling.LANCZOS)
            glyphs[char]=(piece,round((t-cap_top)*scale)+3,round((r-l+3)*scale))
            manifest[char]={'source':str(source(idx)),'box':[box[0]+l,box[1]+t,box[0]+r,box[1]+b]}
    # Pending-value dash is a direct short part of the source gold separator.
    dash=Image.open(source(8)).convert('RGBA').crop((380,1106,412,1108)).resize((30,2),Image.Resampling.LANCZOS)
    for c in ['-','—','−']:glyphs[c]=(dash,30,35)
    atlas=Image.new('RGBA',(1024,128));lines=[];x=3
    for char,(im,offset,advance) in glyphs.items():
        atlas.alpha_composite(im,(x,3));lines.append(f'char id={ord(char)} x={x} y=3 width={im.width} height={im.height} xoffset=0 yoffset={offset} xadvance={max(im.width-3,advance)} page=0 chnl=15');x+=im.width+7
    assert x<1024
    filename='agent_v8_digits.png';atlas.save(ASSET_DIR/filename);update_meta(filename)
    meta=json.loads((ASSET_DIR/(filename+'.meta')).read_text());meta['packable']=False
    (ASSET_DIR/(filename+'.meta')).write_text(json.dumps(meta,indent=2)+'\n')
    fnt=ASSET_DIR/'agent_v8_digits.fnt'
    fnt.write_text('info face="V8 Agent Gold" size=64 bold=0 italic=0 unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=2,2\ncommon lineHeight=68 base=57 scaleW=1024 scaleH=128 pages=1 packed=0\npage id=0 file="agent_v8_digits.png"\nchars count='+str(len(lines))+'\n'+'\n'.join(lines)+'\n')
    fm={'ver':'2.1.0','uuid':str(uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-agent/gold-numbers')),'textureUuid':meta['uuid'],'fontSize':64,'subMetas':{}}
    (ASSET_DIR/'agent_v8_digits.fnt.meta').write_text(json.dumps(fm,indent=2)+'\n')
    (OUT/'number-glyphs.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2,default=int)+'\n')
    print('Extracted live gold bitmap font:', ''.join(glyphs))
if __name__=='__main__':main()
