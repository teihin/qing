#!/usr/bin/env python3
"""Cut the approved V8-new recharge art and serialize only wallet chrome/recharge.

No historical design folders are read. Backgrounds, tabs, cards and live-value
bases are individual assets; the only vertically stretchable art is a clean
compact panel. This script never launches Creator or changes payment protocols.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from apply_v7_prefab_skin import Prefab, ASSET_DIR, frame_uuid
from apply_v7_lobby_exact import untint, style_label
from apply_v7_wallet_exact import full_widget, root_top, page_top, page_bottom, page_stretch
from apply_v8_login import update_meta
from repair_v7_responsive_layout import ensure_widget

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'design-previews/效果图V8-new/03-钱包/01-充值.png'
S = 750 / 941
BASE_H = 1334
PAGE_H = 1136
R = '钱包/容器/充值/根'
C = R + '/通道视口/充值渠道'
GOLD = {'__type__': 'cc.Color', 'r': 255, 'g': 237, 'b': 202, 'a': 255}
NAVY = {'__type__': 'cc.Color', 'r': 4, 'g': 34, 'b': 57, 'a': 255}
CUTS = {}


def rounded(image, radius):
    w, h = image.size
    mask = Image.new('L', (w * 4, h * 4))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1),
                                           radius=radius * 4, fill=255)
    image = image.convert('RGBA')
    image.putalpha(mask.resize((w, h), Image.Resampling.LANCZOS))
    return image


def foreground(image, dark=False):
    """Keep reference glyph pixels and shadows, remove the surrounding field."""
    arr = np.asarray(image.convert('RGBA')).copy()
    rgb = arr[:, :, :3].astype(float)
    if dark:
        seed = (rgb[:, :, 2] > rgb[:, :, 0] * 1.15) & (rgb[:, :, 0] < 130)
    else:
        seed = (rgb[:, :, 0] > 78) & (rgb[:, :, 0] > rgb[:, :, 2] * .83)
    mask = Image.fromarray((seed * 255).astype('uint8'))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.35))
    arr[:, :, 3] = np.asarray(mask)
    return Image.fromarray(arr)


def clear_rect(image, box):
    """Interpolate a live-value hole from its four clean boundaries only."""
    arr = np.asarray(image.convert('RGBA')).copy()
    x0, y0, x1, y1 = box
    top = arr[y0, x0:x1, :3].astype(float)
    bottom = arr[y1 - 1, x0:x1, :3].astype(float)
    u = np.linspace(0, 1, x1 - x0)[:, None]
    for y in range(y0, y1):
        v = (y - y0) / (y1 - y0 - 1)
        side = (1-u)*arr[y, x0, :3] + u*arr[y, x1-1, :3]
        corners = (1-u)*((1-v)*top[0]+v*bottom[0])+u*((1-v)*top[-1]+v*bottom[-1])
        arr[y, x0:x1, :3] = np.clip((1-v)*top+v*bottom+side-corners, 0, 255)
    return Image.fromarray(arr)


def compact_panel(image, out_size=(180, 256), border=32):
    """Compact only the clean middle; preserve all four corners for nine-slice."""
    w, h = image.size; ow, oh = out_size
    out = Image.new('RGBA', out_size)
    sx = [0, border, w-border, w]; sy = [0, border, h-border, h]
    dx = [0, border, ow-border, ow]; dy = [0, border, oh-border, oh]
    for j in range(3):
        for i in range(3):
            part = image.crop((sx[i], sy[j], sx[i+1], sy[j+1]))
            out.paste(part.resize((dx[i+1]-dx[i], dy[j+1]-dy[j]),
                                  Image.Resampling.LANCZOS), (dx[i], dy[j]))
    return out


def save(name, image, box=None, kind='crop', border=0):
    image.save(ASSET_DIR / name, optimize=True)
    update_meta(name)
    meta_path = ASSET_DIR / (name + '.meta')
    meta = json.loads(meta_path.read_text())
    meta['packable'] = True
    frame = meta['subMetas'][Path(name).stem]
    for edge in ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']:
        frame[edge] = border
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    CUTS[name] = {'box': box, 'kind': kind, 'size': list(image.size),
                  'sha256': hashlib.sha256((ASSET_DIR / name).read_bytes()).hexdigest()}


def extract():
    src = Image.open(SOURCE).convert('RGBA')
    assert src.size == (941, 1672)
    # Fixed header: the arrow, title and customer-service action are separate.
    header = src.crop((106, 0, 404, 103)).resize((941, 103), Image.Resampling.LANCZOS)
    save('wallet_header_exact.png', header, [0, 0, 941, 103], 'clean-header')
    for name, box in [('wallet_header_back_v8.png', (27, 22, 94, 85)),
                      ('wallet_header_title_v8.png', (410, 20, 533, 87)),
                      ('wallet_header_service_v8.png', (719, 22, 920, 85))]:
        save(name, foreground(src.crop(box)), list(box), 'foreground')

    # One empty tab bar shared by all three toggles; selected pills are separate.
    bar = src.crop((53, 127, 888, 207))
    bar = clear_rect(bar, (363, 12, 472, 70))
    bar = clear_rect(bar, (642, 12, 752, 70))
    arr = np.asarray(bar).copy()
    # Left selected pill occupies the original field: use the clean right field,
    # reflected only within this reusable plain tab material, never the scene.
    arr[:, :278] = arr[:, -278:][:, ::-1]
    save('wallet_tabs_base_v8.png', rounded(Image.fromarray(arr), 22),
         [53, 127, 888, 207], 'clean-tabs')
    sources = [src, Image.open(SOURCE.with_name('02-提现.png')).convert('RGBA'),
               Image.open(SOURCE.with_name('03-记录.png')).convert('RGBA')]
    for key, im, box in [('recharge', src, (53, 128, 328, 207)),
                         ('withdraw', sources[1], (336, 128, 605, 207)),
                         ('record', sources[2], (612, 128, 888, 207))]:
        save('wallet_tabs_' + key + '_exact.png', rounded(im.crop(box), 22),
             list(box), 'selected-tab')
    for key, im, box in [('recharge', sources[1], (150, 143, 232, 193)),
                         ('withdraw', src, (428, 143, 513, 193)),
                         ('record', src, (708, 143, 795, 193))]:
        save('wallet_tab_' + key + '_normal_v8.png', foreground(im.crop(box)),
             list(box), 'tab-foreground')

    # Reference frame + clean unobscured gap rows. No control pixels enter the
    # nine-slice center, so resizing cannot duplicate text or horizontal bars.
    box = (65, 299, 876, 1614)
    panel = np.asarray(src.crop(box)).copy(); h, w = panel.shape[:2]
    gaps = [330, 392, 785, 878, 1220, 1414, 1587]
    rows = np.array([np.asarray(Image.fromarray(panel[y-299-2:y-299+3, :, :3])
                    .filter(ImageFilter.GaussianBlur(9))).mean(axis=0) for y in gaps])
    yy = np.arange(31, h-28)
    for x in range(29, w-29):
        for c in range(3):
            panel[yy, x, c] = np.interp(yy, np.array(gaps)-299, rows[:, x, c])
    panel = rounded(Image.fromarray(panel), 39)
    panel = panel.resize((round(w*S), round(h*S)), Image.Resampling.LANCZOS)
    save('wallet_recharge_panel_exact.png', compact_panel(panel), list(box),
         'compact-clean-panel', border=32)

    for key, box in [('bank', (102, 408, 460, 576)),
                     ('alipay', (480, 408, 839, 576)),
                     ('wechat', (102, 595, 460, 763)),
                     ('other', (480, 595, 839, 763))]:
        save('wallet_channel_' + key + '_exact.png', rounded(src.crop(box), 19), list(box))
    # The existing transparent selection border has no baked channel symbol.
    for key, box in [('channel', (103, 329, 839, 383)),
                     ('amount', (103, 810, 839, 865))]:
        title = foreground(src.crop(box))
        # Keep the two hairline rules as reference pixels with a feathered mask.
        a = np.asarray(title).copy()
        for lx, rx in [(0, 204), (532, 736)]:
            y = 27
            a[y-1:y+2, lx:rx, 3] = 210
        save('wallet_recharge_' + key + '_title_exact.png', Image.fromarray(a),
             list(box), 'foreground')

    for key, box, hole in [('off', (102, 889, 333, 1036), (28, 37, 211, 109)),
                            ('on', (602, 888, 842, 1038), (33, 39, 208, 111))]:
        im = clear_rect(src.crop(box), hole)
        save('wallet_amount_' + key + '_exact.png', rounded(im, 19), list(box), 'live-value-base')
    notice_box = (102, 1241, 839, 1391)
    notice = clear_rect(src.crop(notice_box), (141, 22, 659, 122))
    save('wallet_recharge_notice_exact.png', rounded(notice, 21), list(notice_box), 'live-value-base')
    box=(240,1260,810,1370)
    save('wallet_recharge_notice_text_v8.png', foreground(src.crop(box)), list(box), 'foreground')
    box = (104, 1436, 837, 1573)
    save('wallet_recharge_confirm_exact.png', rounded(src.crop(box), 36), list(box))
    out = ROOT / 'art_sources/v8-repairs/wallet-recharge'
    out.mkdir(parents=True, exist_ok=True)
    (out/'cuts.json').write_text(json.dumps({'source': str(SOURCE.relative_to(ROOT)),
        'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'assets': CUTS},
        ensure_ascii=False, indent=2) + '\n')


def plain_node(p, parent, name):
    for ref in p.data[parent]['_children']:
        if p.data[ref['__id__']]['_name'] == name:
            return ref['__id__']
    node = copy.deepcopy(p.data[p.node(R + '/V7选择充值渠道')])
    node.update(_name=name, _children=[], _components=[], _prefab=None,
                _parent={'__id__': parent}, _active=True, _id='')
    index=len(p.data); p.data.append(node)
    p.data[parent]['_children'].append({'__id__': index})
    return index


def art(p, node, asset, rect, parent=(0, 0, 941, 1672), hide=False):
    x0,y0,x1,y1=rect; px0,py0,px1,py1=parent
    p.art(node,asset,(x0+x1-px0-px1)*S/2,(py0+py1-y0-y1)*S/2,
          (x1-x0)*S,(y1-y0)*S,hide=hide)
    p.disable(node,'cc.Widget');p.set_active(node,True);untint(p,node)
    p.data[node]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[node]['_trs']['array'][7:10]=[1,1,1]


def anchored(p, node, asset, rect, bottom=False, root=False):
    art(p,node,asset,rect)
    x0,y0,x1,y1=rect; w=(x1-x0)*S; h=(y1-y0)*S; x=(x0+x1-941)*S/2
    if root: root_top(p,node,y0*S,w,h,x)
    elif bottom: page_bottom(p,node,BASE_H-y1*S,w,h,x)
    else: page_top(p,node,y0*S,w,h,x)


def apply_channel_flow(p):
    """Serialize the two-row reference as top-anchored flow, not tall-screen fill.

    Runtime only adjusts these existing nodes by the real channel row height.
    Keep the panel's bottom value as the minimum screen-bottom clearance.
    """
    for name in ['V7充值面板', '通道视口', 'V7选择充值金额', '金额',
                 'V7充值提示框', '充值提示', 'V8默认充值提示', '确认充值']:
        n=p.node(R+'/'+name);obj=p.data[n]
        _,widget=p.component(n,'cc.Widget')
        height=obj['_contentSize']['height']
        if not widget['_alignFlags'] & 1:
            widget['_top']=PAGE_H-widget['_bottom']-height
        widget.update(_enabled=True,alignMode=1,
                      _alignFlags=(widget['_alignFlags'] & ~6) | 1,
                      _originalHeight=height)
        obj['_trs']['array'][1]=PAGE_H/2-widget['_top']-height/2


def apply(p=None):
    own = p is None
    p = p or Prefab('assets/resources/Prefabs/钱包.prefab')
    # Only the shared wallet chrome and recharge branch are changed.
    scene=Image.open(ASSET_DIR/'lobby_scene_long_v8.png')
    bg=p.node('钱包/bk');p.sprite(bg,'lobby_scene_long_v8.png');untint(p,bg)
    root_top(p,bg,0,750,scene.height*750/scene.width)
    title=p.node('钱包/Title')
    anchored(p,title,'wallet_header_exact.png',(0,0,941,103),root=True)
    art(p,p.node('钱包/Title/关闭'),'wallet_header_back_v8.png',(27,22,94,85),(0,0,941,103),hide=True)
    art(p,p.node('钱包/Title/钱包'),'wallet_header_title_v8.png',(410,20,533,87),(0,0,941,103),hide=True)
    art(p,p.node('钱包/Title/客服'),'wallet_header_service_v8.png',(719,22,920,85),(0,0,941,103),hide=True)
    tabs=p.node('钱包/选项');p.disable(tabs,'cc.Layout')
    anchored(p,tabs,'wallet_tabs_base_v8.png',(53,127,888,207),root=True)
    specs=[('充值','recharge',(53,128,328,207),(150,143,232,193)),
           ('提现','withdraw',(336,128,605,207),(428,143,513,193)),
           ('记录','record',(612,128,888,207),(708,143,795,193))]
    for name,key,rect,glyph in specs:
        n=p.node('钱包/选项/'+name)
        art(p,n,'transparent.png',rect,(53,127,888,207))
        art(p,p.node('钱包/选项/'+name+'/Background'),'wallet_tab_'+key+'_normal_v8.png',glyph,rect,hide=True)
        mark=p.node('钱包/选项/'+name+'/checkmark')
        art(p,mark,'wallet_tabs_'+key+'_exact.png',rect,rect,hide=True)
        _,toggle=p.component(n,'cc.Toggle');toggle['_N$isChecked']=name=='充值'
        p.set_active(mark,name=='充值')
        refs=p.data[n]['_children'];refs[:]=[r for r in refs if r['__id__']!=mark]+[{'__id__':mark}]

    for path in [R, '钱包/容器/充值']:full_widget(p,p.node(path),750,PAGE_H)
    panel=p.node(R+'/V7充值面板');p.sprite(panel,'wallet_recharge_panel_exact.png',sliced=True);untint(p,panel)
    page_stretch(p,panel,299*S,BASE_H-1614*S,65*S,65*S)
    anchored(p,p.node(R+'/V7选择充值渠道'),'wallet_recharge_channel_title_exact.png',(103,329,839,383))
    anchored(p,p.node(R+'/V7选择充值金额'),'wallet_recharge_amount_title_exact.png',(103,810,839,865),bottom=True)

    viewport=p.node(R+'/通道视口');content=p.node(C)
    # Author the two-row reference; apply_channel_flow removes vertical stretch.
    page_stretch(p,viewport,408*S,BASE_H-763*S,102*S,102*S)
    _,scroll=p.component(viewport,'cc.ScrollView');scroll.update(horizontal=False,vertical=True,elastic=False)
    p.disable(content,'cc.Widget')
    width=737*S;ch=168*S;cw=358*S;gx=20*S;gy=19*S
    p.set_pos(content,0,355*S/2,width,355*S)
    p.data[content]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':1}
    content_widget=ensure_widget(p,content)
    content_widget.update(_enabled=True,alignMode=1,_alignFlags=17,_top=0,
        _horizontalCenter=0,_isAbsTop=True,_isAbsHorizontalCenter=True)
    _,layout=p.component(content,'cc.Layout')
    layout.update(_enabled=True,_resize=1,_layoutSize={'__type__':'cc.Size','width':width,'height':355*S})
    layout.update({'_N$layoutType':3,'_N$cellSize':{'__type__':'cc.Size','width':cw,'height':ch},
        '_N$paddingLeft':0,'_N$paddingRight':0,'_N$paddingTop':0,'_N$paddingBottom':0,
        '_N$spacingX':gx,'_N$spacingY':gy,'_N$startAxis':0,'_N$horizontalDirection':0,
        '_N$verticalDirection':1,'_N$affectedByScale':False})
    types={'支付1':'bank','支付2':'alipay','支付3':'bank','支付4':'alipay','支付5':'wechat'}
    i=0
    for ref in p.data[content]['_children']:
        n=ref['__id__'];name=p.data[n]['_name']
        _,toggle=p.component(n,'cc.Toggle')
        if toggle is None:continue
        p.set_pos(n,-width/2+cw/2+(i%2)*(cw+gx),-ch/2-(i//2)*(ch+gy),cw,ch,disable_widget=True)
        i+=int(p.data[n]['_active'])
        asset='wallet_channel_'+types.get(name,'other')+'_exact.png'
        for suffix,filename in [('Background',asset),('checkmark','wallet_channel_selected_overlay.png')]:
            nn=p.node(C+'/'+name+'/'+suffix);p.art(nn,filename,0,0,cw,ch,hide=True);p.disable(nn,'cc.Widget');untint(p,nn)
        p.set_active(p.node(C+'/'+name+'/checkmark'),toggle['_N$isChecked'])
    comp=next(c for c in p.data if 'paymentAlipayIcon' in c)
    for prop,key in [('paymentAlipayIcon','alipay'),('paymentUnionPayIcon','bank'),('paymentWeChatIcon','wechat'),('paymentOtherIcon','other')]:
        comp[prop]={'__uuid__':frame_uuid('wallet_channel_'+key+'_exact.png')}

    amounts=p.node(R+'/金额');p.disable(amounts,'cc.Layout')
    page_bottom(p,amounts,BASE_H-1202*S,737*S,314*S)
    for i,name in enumerate(['50','100','500','1000','2000','5000']):
        path=R+'/金额/'+name;n=p.node(path);x=(i%3-1)*251*S;y=(83 if i<3 else -83)*S
        p.set_pos(n,x,y,232*S,148*S,disable_widget=True)
        for suffix,filename,w,h in [('Background','wallet_amount_off_exact.png',231,147),('checkmark','wallet_amount_on_exact.png',240,150)]:
            nn=p.node(path+'/'+suffix);p.art(nn,filename,0,0,w*S,h*S,hide=True);p.disable(nn,'cc.Widget');untint(p,nn)
        _,toggle=p.component(n,'cc.Toggle');toggle['_N$isChecked']=False;checked=False;p.set_active(p.node(path+'/checkmark'),False)
        style_label(p,path+'/txt',x=0,y=0,width=213*S,height=75*S,size=round(44*S),preview=name+'元')
        nn=p.node(path+'/txt');p.disable(nn,'cc.Widget');p.data[nn]['_color']=copy.deepcopy(NAVY if checked else GOLD)
        _,label=p.component(nn,'cc.Label');label.update(_enableWrapText=False,_styleFlags=1)
        refs=p.data[n]['_children'];txt=nn;refs[:]=[r for r in refs if r['__id__']!=txt]+[{'__id__':txt}]

    anchored(p,p.node(R+'/V7充值提示框'),'wallet_recharge_notice_exact.png',(102,1241,839,1391),bottom=True)
    note=p.node(R+'/充值提示');page_bottom(p,note,BASE_H-1363*S,554*S,100*S,(531-470.5)*S)
    style_label(p,R+'/充值提示',x=(531-470.5)*S,y=p.data[note]['_trs']['array'][1],width=554*S,height=100*S,
        size=round(32*S),preview='请使用实名认证名下的银行卡充值，\n准确按照订单金额进行转账。',align=0)
    _,label=p.component(note,'cc.Label');label.update(_lineHeight=46*S,_enableWrapText=True,_styleFlags=0,
        _string='',**{'_N$string':''})
    p.data[note]['_color']=copy.deepcopy(GOLD)
    default_note=plain_node(p,p.node(R),'V8默认充值提示')
    anchored(p,default_note,'wallet_recharge_notice_text_v8.png',(240,1260,810,1370),bottom=True)
    anchored(p,p.node(R+'/确认充值'),'wallet_recharge_confirm_exact.png',(104,1436,837,1573),bottom=True)
    apply_channel_flow(p)
    if own:p.save()


if __name__=='__main__':
    extract()
    apply()
    print('V8-new recharge source art extracted and wallet Prefab updated.')
