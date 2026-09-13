#!/usr/bin/env python3
"""Package imagegen background repairs and exact V8 foreground cutouts.

This is an authoring tool. It only crops/masks source art and assembles prepared
imagegen materials; it never invents textures by stretching a sampled row.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageChops
from apply_v8_login import update_meta

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'design-previews/效果图V8-new/01-主页面/02-大厅.png'
REPAIRS = ROOT / 'art_sources/v8-repairs'
OUT = ROOT / 'assets/resources/V7'


def mask_polygon(size, points):
    mask = Image.new('L', (size[0]*4, size[1]*4))
    ImageDraw.Draw(mask).polygon([(round(x*4), round(y*4)) for x,y in points], fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS)


def save(im, name):
    im.save(OUT / name)
    update_meta(name)


def main():
    scene = Image.open(REPAIRS/'lobby-clean-long.png').convert('RGBA')
    # Keep the outpaint's natural proportions. This single plate covers a
    # 750x1875 canvas and continues behind the transparent crest of the footer.
    scene = scene.resize((941, round(scene.height*941/scene.width)), Image.Resampling.LANCZOS)
    save(scene, 'lobby_scene_long_v8.png')
    source = Image.open(SRC).convert('RGBA')
    shield_box = (321, 121, 600, 436)
    shield_points = [(462,123),(452,130),(437,138),(417,145),(390,153),(367,159),
        (362,173),(355,185),(343,197),(325,207),(331,228),(338,267),(343,286),
        (334,281),(339,298),(343,318),(348,337),(355,356),(365,371),(380,383),
        (405,398),(435,416),(462,433),(486,418),(516,400),(542,385),(559,370),
        (569,353),(577,332),(582,309),(586,282),(576,289),(581,268),(587,229),
        (593,208),(577,199),(563,184),(556,172),(552,159),(529,153),(505,146),
        (484,137),(471,129)]
    shield = source.crop(shield_box)
    shield.putalpha(mask_polygon(shield.size,[(x-shield_box[0],y-shield_box[1]) for x,y in shield_points]))
    save(shield,'lobby_shield_v8_exact.png')
    cuts=[]
    for name,box in [('lobby_ranking_exact.png',(29,466,310,563)),
                     ('lobby_match_exact.png',(328,466,608,563)),
                     ('lobby_report_exact.png',(623,466,913,563))]:
        im=source.crop(box);mask=Image.new('L',(im.width*4,im.height*4))
        ImageDraw.Draw(mask).rounded_rectangle((0,0,im.width*4-1,im.height*4-1),radius=18*4,fill=255)
        im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save(im,name)
        cuts.append({'source':str(SRC.relative_to(ROOT)),'output':'assets/resources/V7/'+name,'box':list(box),'radius':18})
    cuts.append({'source':str(SRC.relative_to(ROOT)),'output':'assets/resources/V7/lobby_shield_v8_exact.png','box':list(shield_box),'polygon':shield_points})
    (ROOT/'tools/v8_lobby_foreground_crops.json').write_text(json.dumps(cuts,ensure_ascii=False,indent=2)+'\n')
    print('Packaged one continuous lobby background and four independent approved foreground crops.')


if __name__ == '__main__':
    main()
