#!/usr/bin/env python3
"""Separate the approved announcement controls from a continuous scene plate."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from apply_v7_prefab_skin import Prefab
from apply_v7_lobby_exact import untint, fill_parent
from apply_v8_login import update_meta
from repair_v7_responsive_layout import top, bottom
from prepare_v8_visual_repairs import mask_polygon

ROOT=Path(__file__).resolve().parents[1]
S=750/941
A='Main/公告'
SOURCE='design-previews/效果图V8-new/02-公告/01-公告菜单主页.png'
OUT=ROOT/'assets/resources/V7'

def main():
    source=Image.open(ROOT/SOURCE).convert('RGBA')
    scene=Image.open(ROOT/'art_sources/v8-repairs/announcement-clean-long.png').convert('RGBA')
    scene=scene.resize((941,round(scene.height*941/scene.width)),Image.Resampling.LANCZOS)
    scene.save(OUT/'announcement_scene_long_v8.png');update_meta('announcement_scene_long_v8.png')
    cuts=[]
    def cut(name,box,points=None,radius=0):
        im=source.crop(box)
        if points: im.putalpha(mask_polygon(im.size,[(x-box[0],y-box[1]) for x,y in points]))
        elif radius:
            mask=Image.new('L',(im.width*4,im.height*4));ImageDraw.Draw(mask).rounded_rectangle((0,0,im.width*4-1,im.height*4-1),radius=radius*4,fill=255)
            im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS))
        im.save(OUT/name);update_meta(name)
        cuts.append({'source':SOURCE,'output':'assets/resources/V7/'+name,'box':list(box)})
        return box
    header=cut('announcement_header_v8_exact.png',(0,0,941,140),[(0,0),(941,0),(941,98),(780,98),(752,101),(725,114),(686,126),(490,126),(479,138),(468,126),(289,126),(250,119),(216,105),(177,98),(0,98)])
    shield=cut('announcement_shield_v8_exact.png',(65,617,405,1024),[
        (239,620),(215,634),(190,644),(159,653),(121,662),(112,685),(101,701),(87,713),(67,723),
        (79,758),(91,838),(76,830),(88,873),(101,916),(113,941),(132,958),(168,981),(203,1001),
        (239,1020),(274,999),(309,978),(341,958),(360,935),(373,906),(386,855),(388,831),(373,844),
        (387,760),(402,724),(382,714),(365,698),(353,679),(350,662),(311,653),(280,643),(258,632)])
    title_box=(72,253,444,387)
    title=source.crop(title_box)
    # Restrict color extraction to the actual glyph rectangles, then remove
    # disconnected city-light specks. Pure-white highlights belong to the
    # lettering too; testing only r>b would punch holes through those strokes.
    import numpy as np
    from scipy import ndimage
    rgb=np.asarray(source.convert('RGB')).astype(float)
    r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    bright=(r>130)&(g>110)&(r>b*.92)
    complete=np.zeros(bright.shape,dtype=bool)
    for rect,minimum in [((216,258,396,337),50),((207,341,397,363),30),((289,366,318,385),8)]:
        x0,y0,x1,y1=rect;lab,_=ndimage.label(bright[y0:y1,x0:x1]);counts=np.bincount(lab.ravel())
        keep=counts>=minimum;keep[0]=False
        complete[y0:y1,x0:x1]|=keep[lab]
    complete=ndimage.binary_dilation(complete,iterations=1)
    mask=Image.fromarray((complete[253:387,72:444]*255).astype('uint8'))
    d=ImageDraw.Draw(mask);d.ellipse((3,5,110,115),fill=255)
    d.rectangle((140,123,371,126),fill=255)
    title.putalpha(mask);title.save(OUT/'announcement_wordmark_v8_exact.png');update_meta('announcement_wordmark_v8_exact.png')
    buttons=[('公告6','announcement_latest_button_v8_exact.png',(445,472,907,646)),
             ('公告1','announcement_rules_button_v8_exact.png',(445,665,907,840)),
             ('公告2','announcement_bonus_button_v8_exact.png',(445,860,907,1036)),
             ('公告5','announcement_penalty_button_v8_exact.png',(445,1056,907,1233))]
    for _,asset,box in buttons:cut(asset,box,radius=29)
    deck=cut('announcement_cards_v8_exact.png',(0,1030,443,1377),[
        (0,1211),(48,1218),(10,1093),(10,1080),(23,1074),(114,1049),(119,1045),(248,1033),
        (257,1037),(260,1045),(267,1046),(344,1071),(351,1076),(353,1084),(432,1122),
        (440,1130),(441,1140),(385,1304),(377,1311),(370,1312),(310,1292),(310,1342),
        (296,1353),(274,1361),(250,1364),(220,1364),(193,1361),(170,1356),(152,1347),
        (142,1341),(140,1360),(113,1369),(79,1374),(46,1373),(20,1368),(0,1361)])
    chips=cut('announcement_chips_right_v8_exact.png',(814,1277,941,1500),[
        (941,1278),(924,1283),(910,1291),(903,1301),(900,1324),(890,1339),(883,1358),
        (871,1369),(859,1384),(842,1390),(825,1399),(816,1411),(815,1430),(819,1447),
        (815,1460),(819,1499),(941,1499)])
    (ROOT/'tools/v8_announcement_foreground_crops.json').write_text(json.dumps(cuts,ensure_ascii=False,indent=2)+'\n')

    p=Prefab('assets/resources/UI/panelMain.prefab');root=p.node(A)
    p.disable(root,'cc.Sprite')
    for name in ['V8公告延展底纹','V7公告长屏补底','V7公告菜单高清母版']:
        try:p.set_active(p.node(A+'/'+name),False)
        except KeyError:pass
    def node(name,asset,box,footer=False):
        path=A+'/'+name
        try:n=p.node(path)
        except KeyError:n=p.clone_subtree(p.node(A+'/title copy'),root,name)
        x0,y0,x1,y1=box;w,h=(x1-x0)*S,(y1-y0)*S;x=((x0+x1)/2-470.5)*S
        p.set_active(n,True);p.art(n,asset,x,0,w,h,hide=True);untint(p,n)
        if footer:bottom(p,path,(1672-y1)*S,x=x,width=w,height=h)
        else:top(p,path,y0*S,x=x,width=w,height=h)
        return n
    bg=node('V8公告完整背景','announcement_scene_long_v8.png',(0,0,941,scene.height))
    node('title copy','announcement_header_v8_exact.png',header)
    node('V8公告盾牌','announcement_shield_v8_exact.png',shield)
    node('V8公告美术字','announcement_wordmark_v8_exact.png',title_box)
    node('V8公告扑克筹码','announcement_cards_v8_exact.png',deck,footer=True)
    node('V8公告右筹码','announcement_chips_right_v8_exact.png',(chips[0],chips[1]+40,chips[2],chips[3]+40),footer=True)
    children=p.data[root]['_children'];children[:]=[{'__id__':bg}]+[r for r in children if r['__id__']!=bg]
    home=p.node(A+'/主页');p.disable(home,'cc.Sprite');p.disable(home,'cc.Layout');fill_parent(p,A+'/主页',750,1334)
    for name,asset,box in buttons:
        path=A+'/主页/'+name;n=p.node(path);x0,y0,x1,y1=box
        p.set_active(n,True);p.art(n,asset,0,0,(x1-x0)*S,(y1-y0)*S,hide=True);untint(p,n)
        top(p,path,y0*S,x=((x0+x1)/2-470.5)*S,width=(x1-x0)*S,height=(y1-y0)*S)
        _,button=p.component(n,'cc.Button')
        if button:button['_N$transition']=button['transition']=0
    for name in ['惩罚列表','公告8','公告3','公告4']:p.set_active(p.node(A+'/主页/'+name),False)
    p.save()
    print('Announcement scene, title, shield, four buttons and bottom decoration are separate formal sprites.')

if __name__=='__main__':main()
