#!/usr/bin/env python3
"""Repair only coin-flow artwork from its approved V8-new reference.

Static source pixels are extracted at authoring time. Rounded borders are
scaled to the 750-wide canvas before nine-slicing, and the complete curved
edge stays in the fixed corner cells. No wallet/shared artwork is rewritten.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
import numpy as np
from apply_v7_prefab_skin import Prefab, ASSET_DIR
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import clear_rect
from apply_v8_wallet_pages import S, local, top_art, label, scroll_region, pager

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'design-previews/效果图V8-new/05-后续模块/02-金币流向.png'
OUT = ROOT / 'art_sources/v8-repairs/money-corners'


def contour(im, bounds, radii):
    """Antialiased source contour, with independently measured top/bottom radii."""
    scale = 4
    mask = Image.new('L', (im.width*scale, im.height*scale))
    d = ImageDraw.Draw(mask)
    x0,y0,x1,y1 = [v*scale for v in bounds]
    rt,rb = [v*scale for v in radii]
    d.rectangle((x0+rt,y0,x1-rt,y0+rt), fill=255)
    d.rectangle((x0,y0+rt,x1,y1-rb), fill=255)
    d.rectangle((x0+rb,y1-rb,x1-rb,y1), fill=255)
    for x,y,r,start in [(x0,y0,rt,180),(x1-2*rt,y0,rt,270),
                        (x0,y1-2*rb,rb,90),(x1-2*rb,y1-2*rb,rb,0)]:
        d.pieslice((x,y,x+2*r,y+2*r), start, start+90, fill=255)
    im.putalpha(mask.resize(im.size, Image.Resampling.LANCZOS))
    return im


def extract():
    src = Image.open(SOURCE).convert('RGBA')
    manifest = {}
    def save(name, im, box, border=0, kind='crop'):
        path = ASSET_DIR/name
        im.save(path, optimize=True)
        update_meta(name)
        mp = Path(str(path)+'.meta'); meta = json.loads(mp.read_text())
        fr = meta['subMetas'][path.stem]
        for edge in ['borderLeft','borderRight','borderTop','borderBottom']: fr[edge]=border
        mp.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
        manifest[name] = dict(box=list(box), kind=kind, border=border,
                              size=list(im.size), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    # This fixed header is entirely static; its existing back hit target stays live.
    save('money_v8_header_exact.png',src.crop((0,0,941,90)),(0,0,941,90))
    for name,box,hole,bounds,radii,border in [
        ('money_v8_summary_panel.png',(24,500,918,804),(27,34,867,280),(4,6,889,298),(44,34),48),
        ('money_v8_list_panel.png',(25,971,917,1593),(7,12,885,608),(3,3,889,618),(24,24),26),
        ('money_v8_row_panel.png',(34,986,908,1092),(20,8,849,99),(3,3,870,103),(20,20),23),
        ('money_v8_page_value.png',(355,1471,587,1564),(20,15,212,78),(3,3,229,90),(14,14),16),
    ]:
        im = clear_rect(src.crop(box),hole)
        if name=='money_v8_list_panel.png':
            # Unobscured gaps provide the source's blue material. Coons blending
            # of its bright perimeter can undershoot to black in a large panel.
            arr=np.asarray(src.crop(box)).copy()
            ys=np.array([982,1096,1210,1325,1453,1569,1580])-box[1]
            clean=arr[ys,:,:3].copy()
            x0,y0,x1,y1=hole
            for x in range(x0,x1):
                for c in range(3):
                    arr[y0:y1,x,c]=np.interp(np.arange(y0,y1),ys,clean[:,x,c])
            im=Image.fromarray(arr)
        im = contour(im,bounds,radii)
        im = im.resize((round(im.width*S),round(im.height*S)),Image.Resampling.LANCZOS)
        save(name,im,box,border,'source-contour-clean-base')
    # Header overlaps the list's top border just as in the approved composition.
    box=(25,887,917,998)
    im=contour(src.crop(box),(3,3,889,110),(24,1))
    save('money_v8_table_exact.png',im,box)
    # Keep source round pagination, including the stroke; do not mask through it.
    for key,box in [('first',(120,1470,214,1565)),('prev',(247,1470,341,1565)),
                    ('next',(606,1470,700,1565)),('last',(728,1470,823,1565))]:
        im=src.crop(box)
        mask=Image.new('L',(im.width*4,im.height*4))
        ImageDraw.Draw(mask).ellipse((8,8,(im.width-2)*4,(im.height-2)*4),fill=255)
        im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS))
        save('money_v8_page_'+key+'.png',im,box)
    # Thin dividers remain static; labels and icons are independently bound.
    save('money_v8_row_rule.png',src.crop((507,1015,510,1066)),(507,1015,510,1066))
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'cuts.json').write_text(json.dumps(dict(source=str(SOURCE.relative_to(ROOT)),
        source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),assets=manifest),ensure_ascii=False,indent=2)+'\n')


def apply():
    p=Prefab('assets/resources/UI/panelMain.prefab');r='资金明细'
    # Preserve the shared scene, shield, business data, buttons and their events.
    top_art(p,r+'/title copy','money_v8_header_exact.png',(0,0,941,90))
    local(p,r+'/title copy/关闭上上层','transparent.png',(18,10,101,84),(0,0,941,90),True)
    p.set_active(p.node(r+'/title copy/资金流向'),False)
    parent=(24,500,918,718)
    top_art(p,r+'/V8资金概况','money_v8_summary_panel.png',parent,sliced=True)
    for ref in p.data[p.node(r+'/V8资金概况')]['_children']:
        child=p.data[ref['__id__']]
        if child['_name'].startswith(('累计_','V8标题_','V8累计')) or child['_name']=='V8横分隔':
            child['_active']=False
    local(p,r+'/V8资金概况/V8金币图标','money_v8_coins.png',(57,537,234,683),parent)
    local(p,r+'/V8资金概况/V8当前金币','money_v8_current_title.png',(298,537,449,583),parent)
    local(p,r+'/V8资金概况/V8金币分隔','wallet_v8_vertical_rule.png',(262,545,264,666),parent)
    balance=p.node(r+'/V8资金概况/当前金币')
    old=p.component(balance,'cc.Label')[1].get('_string','—')
    label(p,r+'/V8资金概况/当前金币',(286,583,590,678),parent,87,old,0)
    p.component(balance,'cc.Label')[1]['_styleFlags']=1
    local(p,r+'/V8资金概况/金币充值','money_v8_recharge.png',(622,571,884,672),parent)
    # Removed statistics free 82 source pixels; the list absorbs tall-screen height.
    top_art(p,r+'/V8记录标题','money_v8_record_title.png',(23,741,914,798))
    top_art(p,r+'/标题','money_v8_table_exact.png',(25,805,917,916),hide=True)
    n=scroll_region(p,r+'/资金明细列表',(25,889,917,1593),20,154)
    p.sprite(n,'money_v8_list_panel.png',sliced=True)
    pager(p,r+'/分页',(78,1465,863,1566))
    pagebox=(78,1465,863,1566)
    for name,key,box in [('首页','first',(120,1470,214,1565)),('上一页','prev',(247,1470,341,1565)),
                         ('下一页','next',(606,1470,700,1565)),('尾页','last',(728,1470,823,1565))]:
        local(p,r+'/分页/'+name,'money_v8_page_'+key+'.png',box,pagebox,True)
    local(p,r+'/分页/V8页码底框','money_v8_page_value.png',(355,1471,587,1564),pagebox,sliced=True)
    page=p.node(r+'/分页');num=p.node(r+'/分页/页码')
    p.data[page]['_children'][:]=[ref for ref in p.data[page]['_children'] if ref['__id__']!=num]+[{'__id__':num}]
    # List renders over the lower edge of the table header, exactly as the reference.
    root=p.node(r)
    names=['V7金币流向母版','V8盾牌','V8资金概况','V8记录标题','标题','资金明细列表','分页','title copy']
    ids=[p.node(r+'/'+name) for name in names]
    p.data[root]['_children'][:]=[ref for ref in p.data[root]['_children'] if ref['__id__'] not in ids]+[{'__id__':i} for i in ids]
    p.save()
    row=Prefab('assets/resources/Prefabs/资金明细对象.prefab');parent=(34,986,908,1092)
    row.art(row.root,'money_v8_row_panel.png',0,0,874*S,106*S,sliced=True)
    for name,box,size in [('time',(54,1005,243,1073),29),('type',(359,1005,491,1073),33),
                          ('count',(535,1005,674,1073),35),('now',(728,1005,892,1073),35)]:
        label(row,name,box,parent,size,'—')
    for key in ['in','game','gift','out']:
        n=local(row,'V8类型图标_'+key,'money_v8_icon_'+key+'.png',(273,1003,347,1076),parent)
        row.set_active(n,False)
    for i,x in enumerate([244,507,707]):
        local(row,'V8列分隔'+str(i),'money_v8_row_rule.png',(x,1015,x+2,1066),parent)
    row.save()


if __name__=='__main__':
    extract();apply()
    print('Coin-flow totals removed; reference panels, complete corner caps and pagination saved.')
