#!/usr/bin/env python3
"""Read-only record geometry QA with reference sample rows (not live results)."""
from pathlib import Path
from PIL import Image
from apply_v7_prefab_skin import Prefab
from render_v8_wallet_recharge import render
from render_v8_wallet_pages import samples

OUT=Path(__file__).resolve().parents[1]/'art_sources/v8-repairs/record/qa'

def prepare(selected='-1',multi=False):
    p=Prefab('assets/resources/UI/panelRecordList.prefab')
    for key in ['0','-1','-2']:p.set_active(p.node('条件/'+key+'/checkmark'),key==selected)
    # 直接验证正式 Prefab 的常驻分页，不在预览里改写显隐。
    p.component(p.node('分页/页码'),'cc.Label')[1]['_string']='2/3' if multi else '1/1'
    parent=p.node('战绩列表/view/content')
    rows=[('496535','20/40','3000','-3000'),('392150','20/40','4000','+9063'),
          ('843617','20/40','2000','-260'),('738468','5/10','1000','-1000'),
          ('696148','5/10','3500','-3500'),('444945','5/10','1500','-1500')]
    samples(p,parent,'assets/resources/Prefabs/战绩对象.prefab',[
        dict(zip(['房间号','底皮','带入','输赢'],row)) for row in rows])
    padding=p.component(parent,'cc.Layout')[1]['_N$paddingTop']
    for i,ref in enumerate(p.data[parent]['_children']):
        n=ref['__id__'];p.data[n]['_trs']['array'][1]-=padding
        for ch in p.data[n]['_children']:
            if p.data[ch['__id__']]['_name']=='输赢' and i==1:
                p.data[ch['__id__']]['_color']={'__type__':'cc.Color','r':246,'g':63,'b':54,'a':255}
    return p

def render_record(height,p,name):
    fields=[]
    for obj in p.data:
        if obj.get('__type__')=='cc.Label' and (obj.get('_N$file') or {}).get('__uuid__')=='3fefea76-f578-58cd-af64-df3335369d3b':
            node=p.data[obj['node']['__id__']];parent=p.data[node['_parent']['__id__']]
            if parent['_name'].startswith('qa-row-'):
                fields.append((parent['_name']+'/'+node['_name'],obj['_string'],obj['_fontSize'],node['_color']))
                obj['_enabled']=False
    im,boxes=render(height,p,name,OUT)
    atlas=Image.open(Path(__file__).resolve().parents[1]/'assets/resources/V7/v8_record_digits.png').convert('RGBA')
    for path,text,size,color in fields:
        box=next(v for k,v in boxes.items() if k.endswith('/'+path))
        factor=size/31.68;w=round(len(text)*18*factor);h=round(36*factor)
        line=Image.new('RGBA',(18*len(text),36))
        for i,ch in enumerate(text):
            col=ord(ch)-43
            if 0<=col<15:line.alpha_composite(atlas.crop((col*18,0,col*18+18,36)),(i*18,0))
        tint=Image.new('RGBA',line.size,tuple(color[k] for k in ['r','g','b'])+(255,));tint.putalpha(line.getchannel('A'))
        im.alpha_composite(tint.resize((w,h),Image.Resampling.LANCZOS),(round((box[0]+box[2]-w)/2),round((box[1]+box[3]-h)/2)))
    im.save(OUT/f'{name}-{height}.png')
    return im,boxes

if __name__=='__main__':
    for h in [1334,1624,1778,1860]:render_record(h,prepare(),'reference-samples')
    for key in ['0','-1','-2']:render_record(1334,prepare(key,True),'multi-'+key)
