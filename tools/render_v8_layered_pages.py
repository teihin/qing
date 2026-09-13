#!/usr/bin/env python3
"""Read-only geometry previews of formal layered sprites (not runtime QA)."""
import json
from pathlib import Path
from PIL import Image
from apply_v7_prefab_skin import Prefab

ROOT=Path(__file__).resolve().parents[1]

def render(page,height):
    p=Prefab('assets/resources/UI/panelMain.prefab')
    assets={}
    for f in (ROOT/'assets/resources/V7').glob('*.png.meta'):
        for s in json.loads(f.read_text()).get('subMetas',{}).values():assets[s['uuid']]=Path(str(f)[:-5])
    canvas=Image.new('RGBA',(750,height))
    def walk(n,parent_box,skip_sprite=False):
        obj=p.data[n]
        if not obj.get('_active',True):return
        px,py,pw,ph=parent_box
        w,h=obj['_contentSize']['width'],obj['_contentSize']['height']
        x,y=obj['_trs']['array'][:2];ax,ay=obj['_anchorPoint']['x'],obj['_anchorPoint']['y']
        _,widget=p.component(n,'cc.Widget')
        if widget and widget['_enabled']:
            flags=widget['_alignFlags']
            if flags&8 and flags&32:w=pw-widget['_left']-widget['_right'];x=-pw/2+widget['_left']+w*ax
            elif flags&16:x=widget['_horizontalCenter']
            if flags&1 and flags&4:h=ph-widget['_top']-widget['_bottom'];y=ph/2-widget['_top']-h*(1-ay)
            elif flags&1:y=ph/2-widget['_top']-h*(1-ay)
            elif flags&4:y=-ph/2+widget['_bottom']+h*ay
            elif flags&2:y=widget['_verticalCenter']
        left=px+pw/2+x-w*ax;upper=py+ph/2-y-h*(1-ay)
        _,sprite=p.component(n,'cc.Sprite')
        if not skip_sprite and sprite and sprite['_enabled']:
            uid=(sprite.get('_spriteFrame') or {}).get('__uuid__');asset=assets.get(uid)
            if asset and w>0 and h>0:
                im=Image.open(asset).convert('RGBA').resize((round(w),round(h)),Image.Resampling.LANCZOS)
                canvas.alpha_composite(im,(round(left),round(upper)))
        for ref in obj.get('_children',[]):walk(ref['__id__'],(left,upper,w,h))
    root=p.node('Main/'+page)
    for ref in p.data[root]['_children']:walk(ref['__id__'],(0,0,750,height))
    # Shared footer, without business-state overlays in this geometry preview.
    down=p.node('Down');obj=p.data[down];_,sp=p.component(down,'cc.Sprite')
    im=Image.open(assets[sp['_spriteFrame']['__uuid__']]).convert('RGBA')
    h=round(obj['_contentSize']['height']);im=im.resize((750,h),Image.Resampling.LANCZOS);canvas.alpha_composite(im,(0,height-h))
    out=ROOT/'art_sources/v8-repairs/qa';out.mkdir(exist_ok=True)
    dest=out/f'{page}-{height}-prefab-geometry.png';canvas.save(dest)
    print(dest)
    return canvas

if __name__=='__main__':
    for height in [1334,1624,1778,1860]:render('公告',height)
