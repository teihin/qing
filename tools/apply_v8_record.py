#!/usr/bin/env python3
"""Author V8-new records with real row values and conditional pagination."""
import json
from pathlib import Path
from apply_v7_prefab_skin import Prefab
from apply_v7_lobby_exact import untint,style_label
from apply_v7_record_exact import full_view
from apply_v8_login import update_meta
from apply_v8_mine import unique_clone
from repair_v7_responsive_layout import top,bottom,stretch,ensure_widget

S=750/941

def main():
    for c in json.loads(Path('tools/v8_record_crops.json').read_text()):update_meta(Path(c['output']).name)
    p=Prefab('assets/resources/UI/panelRecordList.prefab')
    # The approved field starts at source y=651 and is a 941x1021 slice.
    # Keep it in a dedicated top-anchored node; placing this short bitmap on
    # the full root would center it and shift the lower half on tall phones.
    p.disable(p.root,'cc.Sprite')
    try: lower=p.node('V8战绩中下背景')
    except KeyError: lower=unique_clone(p,p.node('title'),p.root,'V8战绩中下背景')
    p.hide_children(lower);p.set_active(lower,True)
    p.art(lower,'record_bg_exact.png',0,0,750,1021*S,hide=True);untint(p,lower);p.disable(lower,'cc.Widget')
    top(p,'V8战绩中下背景',651*S,width=750,height=1021*S)
    children=p.data[p.root].get('_children',[])
    try: extend=p.node('V8战绩延展底纹')
    except KeyError: extend=unique_clone(p,lower,p.root,'V8战绩延展底纹')
    p.hide_children(extend);p.set_active(extend,True)
    p.art(extend,'lobby_floor_tile_v8.png',0,0,750,1100*S,hide=True);untint(p,extend);p.disable(extend,'cc.Widget')
    _,tile_sprite=p.component(extend,'cc.Sprite');tile_sprite['_type']=2;tile_sprite['_sizeMode']=0
    bottom(p,'V8战绩延展底纹',0,width=750,height=1100*S)
    children[:]=[{'__id__':extend},{'__id__':lower}]+[r for r in children if r.get('__id__') not in (extend,lower)]
    for path,asset,y,w,h in [('title','record_header_exact.png',0,941,90),('统计','record_hero_exact.png',90,941,561),('条件','v8_record_tabs_base.png',550,831,85),('标题','record_table_header_exact.png',650,905,80)]:
        n=p.node(path);p.sprite(n,asset);untint(p,n);top(p,path,y*S,width=w*S,height=h*S)
    p.disable(p.node('条件'),'cc.Layout')
    try:mid=p.node('条件/V8昨日文字')
    except KeyError:mid=unique_clone(p,p.node('标题'),p.node('条件'),'V8昨日文字')
    p.hide_children(mid);p.set_active(mid,True);p.art(mid,'v8_record_yesterday_normal.png',-7*S,-1*S,79*S,41*S);p.disable(mid,'cc.Widget');untint(p,mid)
    # This normal label is behind the selected mark in all three states.
    children=p.data[p.node('条件')]['_children'];children[:]=[{'__id__':mid}]+[r for r in children if r['__id__']!=mid]
    for key,x,asset in [('0',193,'today'),('-1',463.5,'yesterday'),('-2',737,'before')]:
        t=p.node('条件/'+key);p.set_pos(t,(x-469.5)*S,0,277*S,85*S,disable_widget=True)
        for suffix in ['Background','checkmark']:
            n=p.node('条件/'+key+'/'+suffix);p.art(n,'transparent.png' if suffix=='Background' else f'v8_record_{asset}_pill.png',0,0,277*S,73*S,hide=True);p.disable(n,'cc.Widget');untint(p,n)
    p.sprite(p.node('战绩列表'),'record_list_panel_exact.png')
    stretch(p,'战绩列表',730*S,122*S,left=18*S,right=18*S)
    full_view(p,'战绩列表/view',905*S,1334-852*S)
    content=p.node('战绩列表/view/content');p.data[content]['_contentSize']['width']=905*S
    w=ensure_widget(p,content);w.update(_enabled=True,_alignFlags=41,_left=0,_right=0,_top=0,alignMode=1)
    _,layout=p.component(content,'cc.Layout');layout['_N$paddingTop']=15*S;layout['_N$paddingBottom']=5*S;layout['_N$spacingY']=15*S
    try:footer=p.node('V8保留提示')
    except KeyError:footer=unique_clone(p,p.node('标题'),p.root,'V8保留提示')
    p.hide_children(footer);p.set_active(footer,True);p.sprite(footer,'v8_record_retention.png');untint(p,footer)
    bottom(p,'V8保留提示',37*S,width=905*S,height=85*S)
    p.set_active(p.node('分页'),False)
    # Preserve existing native pagination for multi-page responses only.
    bottom(p,'分页',0,width=708,height=107)
    p.save()
    row=Prefab('assets/resources/Prefabs/战绩对象.prefab')
    row.art(row.root,'record_row_exact.png',0,0,886*S,120*S);untint(row,row.root);row.disable(row.root,'cc.Widget')
    for name,x,width,preview in [('房间号',226,135,'496535'),('底皮',401,110,'20/40'),('带入',590,120,'3000'),('输赢',801,140,'-3000')]:
        style_label(row,name,x=(x-470)*S,y=0,width=width*S,height=58*S,size=round(35*S),preview=preview)
        row.disable(row.node(name),'cc.Widget')
    row.data[row.node('输赢')]['_color']={'__type__':'cc.Color','r':174,'g':202,'b':28,'a':255}
    row.save()

if __name__=='__main__':main()
