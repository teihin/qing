#!/usr/bin/env python3
"""Componentized V8-new withdrawal, records, real-name and coin-flow artwork.

Only approved source crops are used. One long scene and small reusable empty
panels replace page-sized screenshots. This is an editor-time migration.
"""
import copy
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
from apply_v7_prefab_skin import Prefab, ASSET_DIR
from apply_v7_lobby_exact import style_label, untint
from apply_v7_wallet_exact import full_widget, page_top, page_bottom, page_stretch, root_top
from repair_v7_responsive_layout import ensure_widget
from apply_v8_wallet_recharge import foreground, rounded, clear_rect, compact_panel
from apply_v8_login import update_meta
from repair_wallet_editbox_labels import repair as repair_editbox_labels

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'design-previews/效果图V8-new'
OUT=ROOT/'art_sources/v8-repairs/wallet-pages'
S=750/941
GOLD={'__type__':'cc.Color','r':255,'g':237,'b':202,'a':255}
WHITE={'__type__':'cc.Color','r':225,'g':235,'b':251,'a':255}
NAVY={'__type__':'cc.Color','r':4,'g':34,'b':57,'a':255}
MANIFEST={}


def shield_cut(im):
    """Follow the connected gold rim instead of keeping a rectangular backdrop."""
    a=np.asarray(im).astype(float)
    rim=(a[:,:,0]>78)&(a[:,:,0]>a[:,:,2]*.83)
    rim=ndimage.binary_closing(rim,iterations=2)
    filled=ndimage.binary_fill_holes(rim)
    labels,count=ndimage.label(filled)
    sizes=np.bincount(labels.ravel());sizes[0]=0
    mask=labels==int(sizes.argmax())
    # Include the source anti-aliasing around the connected outer edge.
    mask=ndimage.binary_dilation(mask,iterations=1)
    im.putalpha(Image.fromarray((mask*255).astype('uint8')))
    return im


def save(name, im, source, box, kind='crop', border=0):
    path=ASSET_DIR/name;im.save(path,optimize=True);update_meta(name)
    meta_path=Path(str(path)+'.meta');meta=json.loads(meta_path.read_text())
    fr=meta['subMetas'][path.stem]
    for k in ['borderLeft','borderRight','borderTop','borderBottom']:fr[k]=border
    meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    MANIFEST[name]={'source':str(source.relative_to(ROOT)),'box':box,'kind':kind,
        'size':list(im.size),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def extract():
    wd=SOURCE/'03-钱包/02-提现.png';rec=SOURCE/'03-钱包/03-记录.png'
    real=SOURCE/'03-钱包/04-实名认证与交易密码设置.png';flow=SOURCE/'05-后续模块/02-金币流向.png'
    def cut(path,name,box,fg=False,radius=0):
        im=Image.open(path).convert('RGBA').crop(box)
        if fg:im=foreground(im)
        elif radius:im=rounded(im,radius)
        save(name,im,path,box,'foreground' if fg else 'crop')
    # Empty reusable bases: no balances, controls, titles, records or hints baked in.
    im=Image.open(wd).convert('RGBA');box=(66,280,875,616)
    panel=im.crop(box);panel=clear_rect(panel,(36,36,panel.width-36,panel.height-20))
    save('wallet_v8_panel.png',compact_panel(rounded(panel,44),(180,200),32),wd,box,'clean-panel',32)
    box=(94,757,848,858);row=im.crop(box)
    row=clear_rect(row,(18,12,row.width-18,row.height-12))
    save('wallet_v8_field.png',compact_panel(rounded(row,18),(196,84),18),wd,box,'clean-field',18)
    # Gold button material is shared by alternate tabs and ancillary actions.
    box=(342,502,597,582);gold=im.crop(box)
    gold=clear_rect(gold,(32,16,gold.width-32,gold.height-16))
    save('wallet_v8_gold_button.png',compact_panel(rounded(gold,18),(160,76),18),wd,box,'clean-button',18)
    for name,box,fg,rad in [
        ('wallet_v8_balance_title.png',(197,320,744,380),True,0),
        ('wallet_v8_withdraw_all.png',(340,501,600,584),False,20),
        ('wallet_v8_withdraw_submit.png',(99,1445,841,1578),False,32),
        ('wallet_v8_type_bank.png',(127,672,315,720),True,0),
        ('wallet_v8_type_alipay.png',(384,672,567,720),True,0),
        ('wallet_v8_type_usdt.png',(646,672,831,720),True,0),
        ('wallet_v8_type_bank_on.png',(91,653,351,735),False,24),
    ]:cut(wd,name,box,fg,rad)
    bank=foreground(im.crop((127,672,315,720)),dark=True)
    a=np.asarray(bank).copy();a[:,:,:3]=[255,237,202]
    save('wallet_v8_type_bank.png',Image.fromarray(a),wd,[127,672,315,720],'derived-normal-state')
    # Source field labels/icons are transparent and separate from the shared base.
    for key,y in [('amount',757),('name',880),('bank',1003),('card',1126),('password',1249)]:
        cut(wd,'wallet_v8_field_'+key+'.png',(117,y+12,350,y+88),True)
    cut(rec,'wallet_v8_record_header.png',(90,349,848,412),True)
    cut(rec,'wallet_v8_rule.png',(360,334,562,336))
    cut(rec,'wallet_v8_record_in.png',(108,492,171,555),True)
    cut(rec,'wallet_v8_record_out.png',(108,668,172,731),True)
    for key,box in [('first',(149,1376,222,1451)),('prev',(280,1376,352,1451)),
                    ('next',(588,1376,660,1451)),('last',(717,1376,789,1451))]:
        cut(rec,'wallet_v8_page_'+key+'.png',box,False,38)
    cut(real,'wallet_v8_realname_title.png',(386,34,558,83),True)
    cut(real,'wallet_v8_realname_hero_title.png',(210,307,733,366),True)
    cut(real,'wallet_v8_realname_subtitle.png',(189,378,747,418),True)
    cut(real,'wallet_v8_realname_submit.png',(197,1081,713,1179),False,28)
    cut(real,'wallet_v8_realname_warning.png',(109,1224,830,1507),True)
    for key,y in [('name',477),('bank',590),('card',702),('password',814),('confirm',926)]:
        cut(real,'wallet_v8_realname_'+key+'.png',(128,y+14,329,y+74),True)
    cut(real,'wallet_v8_vertical_rule.png',(350,499,352,548))
    # Shield keeps its dark blue interior. Remove only the outside of the contour.
    shield=shield_cut(Image.open(real).convert('RGBA').crop((400,139,533,291)))
    save('wallet_v8_realname_shield.png',shield,real,[400,139,533,291],'contour')
    cut(flow,'money_v8_title.png',(108,14,322,76),True)
    cut(flow,'money_v8_coins.png',(57,544,234,690),True)
    cut(flow,'money_v8_current_title.png',(298,544,449,590),True)
    cut(flow,'money_v8_recharge.png',(622,578,884,679),False,22)
    cut(flow,'money_v8_record_title.png',(23,823,914,880),True)
    cut(flow,'money_v8_record_header.png',(26,889,914,975),False,25)
    for key,box in [('charged',(61,730,181,776)),('given',(369,730,487,776)),('withdrawn',(676,730,796,776))]:
        cut(flow,'money_v8_total_'+key+'.png',box,True)
    for key,box in [('in',(273,1003,347,1076)),('game',(273,1116,347,1189)),
                    ('gift',(273,1230,347,1303)),('out',(273,1350,347,1423))]:
        cut(flow,'money_v8_icon_'+key+'.png',box,True)
    im=Image.open(flow).convert('RGBA');box=(333,141,606,474);shield=shield_cut(im.crop(box))
    save('money_v8_shield.png',shield,flow,box,'contour')
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'cuts.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2)+'\n')


def node(p,path):
    try:return p.node(path)
    except KeyError:
        if '/' not in path:path=p.data[p.root]['_name']+'/'+path
        parent,name=path.rsplit('/',1);parent=p.node(parent)
        item=copy.deepcopy(p.data[p.root]);item.update(_name=name,_parent={'__id__':parent},
            _children=[],_components=[],_prefab=None,_id='',_active=True)
        item['_trs']['array']=[0,0,0,0,0,0,1,1,1,1]
        item['_opacity']=255;item['_color']=copy.deepcopy(GOLD)
        i=len(p.data);p.data.append(item);p.data[parent]['_children'].append({'__id__':i});return i


def normalize(p,n):
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[n]['_trs']['array'][7:10]=[1,1,1]
    p.disable(n,'cc.Widget');p.set_active(n,True)


def local(p,path,asset,box,parent,hide=False,sliced=False):
    n=node(p,path);normalize(p,n)
    x0,y0,x1,y1=box;px0,py0,px1,py1=parent
    p.art(n,asset,(x0+x1-px0-px1)*S/2,(py0+py1-y0-y1)*S/2,
        (x1-x0)*S,(y1-y0)*S,hide=hide,sliced=sliced);untint(p,n)
    return n


def top_art(p,path,asset,box,page=False,hide=False,sliced=False):
    n=local(p,path,asset,box,(0,0,941,1672),hide,sliced)
    x0,y0,x1,y1=box
    (page_top if page else root_top)(p,n,y0*S,(x1-x0)*S,(y1-y0)*S,(x0+x1-941)*S/2)
    return n


def label(p,path,box,parent,size,text=None,align=1,color=GOLD):
    n=node(p,path);normalize(p,n);p.disable(n,'cc.Sprite')
    if p.component(n,'cc.Label')[1] is None:
        c=copy.deepcopy(next(c for c in p.data if c['__type__']=='cc.Label'))
        c.update(node={'__id__':n},_id='',_enabled=True);i=len(p.data);p.data.append(c);p.data[n]['_components'].append({'__id__':i})
    x0,y0,x1,y1=box;px0,py0,px1,py1=parent
    style_label(p,path,x=(x0+x1-px0-px1)*S/2,y=(py0+py1-y0-y1)*S/2,
        width=(x1-x0)*S,height=(y1-y0)*S,size=round(size*S),preview=text,align=align)
    p.data[n]['_color']=copy.deepcopy(color);p.disable(n,'cc.LabelOutline')
    _,c=p.component(n,'cc.Label');c['_enableWrapText']=False;c['_enabled']=True
    return n


def input_row(p,path,box,icon,placeholder,page=True):
    n=top_art(p,path,'wallet_v8_field.png',box,page,sliced=True)
    for ref in p.data[n]['_children']:
        ch=p.data[ref['__id__']]
        if ch['_name'] not in ['input','银行','只读','粘贴','V8字段标题']:ch['_active']=False
    x0,y0,x1,y1=box
    if icon:
        local(p,path+'/V8字段标题',icon,(x0+23,y0+12,x0+256,y1-13),box)
    ep=path+'/input';e=p.node(ep);normalize(p,e)
    width=(x1-x0-327)*S;height=(y1-y0-18)*S
    p.set_pos(e,(151)*S,0,width,height)
    p.sprite(p.node(ep+'/BACKGROUND_SPRITE'),'transparent.png')
    p.disable(p.node(ep+'/BACKGROUND_SPRITE'),'cc.Widget')
    p.set_pos(p.node(ep+'/BACKGROUND_SPRITE'),0,0,width,height)
    editbox=p.component(e,'cc.EditBox')[1]
    editbox['_fontSize']=round(32*S);editbox['_N$fontSize']=round(32*S)
    for suffix,col in [('TEXT_LABEL',GOLD),('PLACEHOLDER_LABEL',WHITE)]:
        ln=p.node(ep+'/'+suffix);normalize(p,ln)
        style_label(p,ep+'/'+suffix,x=0,y=0,width=width-6,height=height,size=round(32*S),
            preview=placeholder if suffix=='PLACEHOLDER_LABEL' else None,align=0)
        p.data[ln]['_color']=copy.deepcopy(col);p.disable(ln,'cc.LabelOutline')
    editbox['_N$placeholder']=placeholder
    for name in ['银行','只读']:
        try:hit=p.node(path+'/'+name)
        except KeyError:continue
        active=p.data[hit]['_active']
        normalize(p,hit);p.art(hit,'transparent.png',0,0,(x1-x0)*S,(y1-y0)*S,hide=True)
        if name=='只读':p.set_active(hit,active)


def apply_withdraw(p):
    r='钱包/容器/提现';o=r+'/提现选项'
    full_widget(p,p.node(r),750,1136);full_widget(p,p.node(o),750,1136);p.disable(p.node(o),'cc.Layout')
    top_art(p,r+'/余额','wallet_v8_panel.png',(66,280,875,616),True,sliced=True)
    top_art(p,r+'/V8钱包余额标题','wallet_v8_balance_title.png',(197,320,744,380),True)
    label(p,r+'/余额/num',(259,384,683,480),(66,280,875,616),88,'0.00')
    p.component(p.node(r+'/余额/num'),'cc.Label')[1]['_styleFlags']=1
    top_art(p,r+'/全部提现','wallet_v8_withdraw_all.png',(340,501,600,584),True,True)
    panel=top_art(p,o+'/V7提现表单','wallet_v8_panel.png',(66,635,875,1618),True,sliced=True)
    # Keep the authored form compact on a long phone; extra height reveals the
    # shared scene below it, rather than inserting blank rows into the form.
    group=top_art(p,r+'/类型选择','wallet_v8_field.png',(91,653,849,735),True,sliced=True);p.disable(group,'cc.Layout')
    specs=[('银行卡提现','bank',91,351),('支付宝提现','alipay',345,603),('USDT提现','usdt',596,849)]
    for name,key,x0,x1 in specs:
        path=r+'/类型选择/'+name;box=(x0,653,x1,735)
        local(p,path,'transparent.png',box,(91,653,849,735))
        local(p,path+'/Background','wallet_v8_type_'+key+'.png',(x0+25,672,x1-25,720),box,True)
        mark=local(p,path+'/checkmark','wallet_v8_type_bank_on.png' if key=='bank' else 'wallet_v8_gold_button.png',box,box,True,sliced=key!='bank')
        if key!='bank':label(p,path+'/checkmark/V8选中文字',(x0,663,x1,723),box,39,name,color=NAVY)
        _,toggle=p.component(p.node(path),'cc.Toggle');p.set_active(mark,toggle['_N$isChecked'])
    fields=[('金额','amount',757,'请输入金额'),('姓名','name',880,'请输入姓名'),('银行','bank',1003,'请选择银行'),
            ('卡号','card',1126,'请输入卡号'),('密码','password',1249,'请输入交易密码')]
    for name,key,y,hint in fields:input_row(p,o+'/'+name,(94,y,848,y+101),'wallet_v8_field_'+key+'.png',hint)
    for name,key,y,hint in [('支付宝','card',1003,'请输入支付宝账号'),('支行','bank',1126,'请输入支行'),
                           ('RMB金额','amount',757,'请输入RMB金额'),('USDT数量','amount',880,'请输入USDT数量'),
                           ('TRC20地址','card',1003,'请输入TRC20地址')]:
        path=o+'/'+name;input_row(p,path,(94,y,848,y+101),None,hint)
        label(p,path+'/V8字段标题',(202,y+15,385,y+85),(94,y,848,y+101),33,name,align=0)
        p.set_active(p.node(path),False)
    # The optional sixth bank field is packed into the same form span by the
    # data-driven controller; it is not drawn over the card-number field.
    rate=p.node(o+'/汇率');page_top(p,rate,736*S,754*S,20*S)
    for name in ['txt','txt copy']:
        n=p.node(o+'/汇率/'+name);p.data[n]['_contentSize']['height']=20*S
        p.component(n,'cc.Label')[1]['_fontSize']=round(19*S)
    try:
        paste=p.node(o+'/TRC20地址/粘贴');p.art(paste,'wallet_v8_gold_button.png',333*S,0,63*S,62*S,hide=True,sliced=True)
        label(p,o+'/TRC20地址/粘贴/V8文字',(0,0,63,62),(0,0,63,62),22,'粘贴',color=NAVY)
        edit=p.node(o+'/TRC20地址/input');p.data[edit]['_contentSize']['width']=345*S
        p.data[edit]['_trs']['array'][0]=117*S
    except KeyError:pass
    notice=p.node(o+'/提现文本');page_top(p,notice,1372*S,730*S,58*S)
    style_label(p,o+'/提现文本',x=0,y=p.data[notice]['_trs']['array'][1],width=730*S,height=58*S,
        size=round(32*S),preview='请核对提现信息，提交后不可修改。',align=1)
    p.data[notice]['_color']=copy.deepcopy(GOLD);p.disable(notice,'cc.LabelOutline')
    submit=local(p,o+'/申请提现','wallet_v8_withdraw_submit.png',(99,1445,841,1578),(0,0,941,1672),True)
    page_top(p,submit,1445*S,742*S,133*S)
    # Form panel must be behind the payout tab bar, including selected art.
    ids=p.data[p.node(r)]['_children'];options=p.node(o);group=p.node(r+'/类型选择')
    ids[:]=[ref for ref in ids if ref['__id__'] not in [options,group]]+[{'__id__':options},{'__id__':group}]


def pager(p,path,box,page=False):
    n=top_art(p,path,'transparent.png',box,page);p.disable(n,'cc.Layout')
    x0,y0,x1,y1=box
    if page:page_bottom(p,n,1334-y1*S,(x1-x0)*S,(y1-y0)*S)
    else:
        wg=ensure_widget(p,n);wg.update(_alignFlags=20,_bottom=1334-y1*S)
        p.set_pos(n,0,-1334/2+wg['_bottom']+(y1-y0)*S/2)
    for name,key,x in [('首页','first',x0+95),('上一页','prev',x0+225),('下一页','next',x1-225),('尾页','last',x1-95)]:
        h=75 if page else 94;w=h*73/75;cy=(y0+y1)/2
        local(p,path+'/'+name,'wallet_v8_page_'+key+'.png',(x-w/2,cy-h/2,x+w/2,cy+h/2),box,True)
    label(p,path+'/页码',((x0+x1)/2-80,y0,(x0+x1)/2+80,y1),box,43,'1/1')


def scroll_region(p,path,box,top_inset,bottom_inset,page=False):
    n=top_art(p,path,'wallet_v8_panel.png',box,page,sliced=True)
    if page:page_stretch(p,n,box[1]*S,1334-box[3]*S,box[0]*S,(941-box[2])*S)
    else:
        wg=ensure_widget(p,n);wg.update(_alignFlags=45,_top=box[1]*S,_bottom=1334-box[3]*S,_left=box[0]*S,_right=(941-box[2])*S)
    view=p.node(path+'/view');normalize(p,view)
    side=22 if page else 10
    width=(box[2]-box[0]-side*2)*S;height=(box[3]-box[1]-top_inset-bottom_inset)*S
    p.set_pos(view,0,(bottom_inset-top_inset)*S/2,width,height)
    w=ensure_widget(p,view);w.update(_enabled=True,alignMode=1,_alignFlags=45,_left=side*S,_right=side*S,_top=top_inset*S,_bottom=bottom_inset*S)
    content=p.node(path+'/view/content');p.data[content]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':1}
    p.set_pos(content,0,height/2,width,100)
    w=ensure_widget(p,content);w.update(_enabled=True,alignMode=1,_alignFlags=41,_left=0,_right=0,_top=0)
    _,layout=p.component(content,'cc.Layout');layout.update(_enabled=True,_resize=1)
    layout['_N$paddingTop']=layout['_N$paddingBottom']=0;layout['_N$spacingY']=(22 if page else 14)*S
    return n


def apply_record(p):
    r='钱包/容器/记录'
    scroll_region(p,r+'/列表',(66,284,875,1508),165,174,True)
    top_art(p,r+'/标题','wallet_v8_record_header.png',(90,349,848,412),True,True)
    top_art(p,r+'/V8表头上分隔','wallet_v8_rule.png',(92,334,846,336),True)
    top_art(p,r+'/V8表头下分隔','wallet_v8_rule.png',(92,418,846,420),True)
    pager(p,r+'/分页',(90,1371,848,1457),True)
    row=Prefab('assets/resources/Prefabs/交易查询对象.prefab')
    row.art(row.root,'wallet_v8_field.png',0,0,765*S,153*S,sliced=True);untint(row,row.root)
    parent=(86,449,851,602)
    for name,box,size,txt,align in [('type',(184,488,269,558),34,'充值',0),('count',(286,488,454,558),34,'0',1),
                                 ('time',(472,488,680,558),33,'—',1),('状态文字',(706,488,839,558),34,'—',1)]:
        label(row,name,box,parent,size,txt,align)
    local(row,'V7充值图标','wallet_v8_record_in.png',(108,492,171,555),parent,True)
    local(row,'V7提现图标','wallet_v8_record_out.png',(108,492,171,555),parent,True);row.set_active(row.node('V7提现图标'),False)
    row.save()


def apply_realname(p):
    r='钱包/实名';info=r+'/信息'
    top_art(p,r+'/bk','lobby_scene_long_v8.png',(0,0,941,2353))
    top_art(p,r+'/Title','wallet_header_exact.png',(0,0,941,103))
    local(p,r+'/Title/关闭','wallet_header_back_v8.png',(27,22,94,85),(0,0,941,103),True)
    local(p,r+'/Title/钱包','wallet_v8_realname_title.png',(386,34,558,83),(0,0,941,103),True)
    top_art(p,info+'/钱包-实名认证','wallet_v8_realname_shield.png',(400,139,533,291),hide=True)
    top_art(p,info+'/V7实名主标题','wallet_v8_realname_hero_title.png',(210,307,733,366),hide=True)
    top_art(p,info+'/V7实名副标题','wallet_v8_realname_subtitle.png',(189,378,747,418),hide=True)
    top_art(p,info+'/V7实名表单底','wallet_v8_panel.png',(76,441,867,1054),sliced=True)
    for name,key,y,hint in [('姓名','name',477,'请输入姓名'),('银行','bank',590,'请输入银行'),
                          ('卡号','card',702,'请输入卡号'),('交易密码','password',814,'请输入交易密码'),
                          ('确认密码','confirm',926,'请确认交易密码')]:
        path=info+'/'+name;box=(103,y,839,y+91)
        input_row(p,path,box,None,hint,False)
        local(p,path+'/V8字段标题','wallet_v8_realname_'+key+'.png',(128,y+14,329,y+74),box)
        local(p,path+'/V8分隔线','wallet_v8_vertical_rule.png',(350,y+22,352,y+71),box)
    top_art(p,info+'/提交实名信息','wallet_v8_realname_submit.png',(197,1081,713,1179),hide=True)
    panel=top_art(p,info+'/V7实名重要提示','wallet_v8_field.png',(87,1203,855,1534),sliced=True)
    local(p,info+'/V7实名重要提示/V8内容','wallet_v8_realname_warning.png',(109,1224,830,1507),(87,1203,855,1534))
    p.set_active(p.node(info+'/实名文本'),False)


def apply_auxiliary(p):
    # These existing wallet dialogs have no separate V8-new plate. Reuse the
    # same controls and preserve every business node and native input contract.
    r='钱包/选择银行/bk';n=p.node(r)
    p.sprite(n,'wallet_v8_panel.png',sliced=True);untint(p,n)
    title=label(p,r+'/V8选择银行',(190,35,622,108),(0,0,811,1155),40,'选择银行')
    row=Prefab('assets/resources/Prefabs/银行对象.prefab')
    row.sprite(row.root,'wallet_v8_field.png',sliced=True);untint(row,row.root)
    row.save()

    r='钱包/订单详情';info=r+'/信息'
    top_art(p,r+'/bk','lobby_scene_long_v8.png',(0,0,941,2353))
    top_art(p,r+'/Title','wallet_header_exact.png',(0,0,941,103))
    local(p,r+'/Title/关闭上上层','wallet_header_back_v8.png',(27,22,94,85),(0,0,941,103),True)
    local(p,r+'/Title/客服','wallet_header_service_v8.png',(719,22,920,85),(0,0,941,103),True)
    label(p,r+'/Title/订单详情',(315,20,627,87),(0,0,941,103),44,'订单详情')
    full_widget(p,p.node(info),750,1334);p.disable(p.node(info),'cc.Layout')
    for ref in p.data[p.node(info)]['_children']:
        n=ref['__id__']
        if p.data[n]['_name']=='New Node':p.set_active(n,False)
    top_art(p,info+'/V8订单底板','wallet_v8_panel.png',(66,178,875,1438),sliced=True)
    back=p.node(info+'/V8订单底板');children=p.data[p.node(info)]['_children']
    children[:]=[{'__id__':back}]+[x for x in children if x['__id__']!=back]
    timer=top_art(p,info+'/info','transparent.png',(95,206,849,275))
    label(p,info+'/info/New Label',(123,215,515,263),(95,206,849,275),29,'该笔订单关闭还剩时间：',0)
    label(p,info+'/info/time',(529,215,819,263),(95,206,849,275),29,'—',0)
    for i,name in enumerate(['订单编号','姓名','银行名称','银行卡号','充值金额']):
        path=info+'/'+name;y=310+i*136;box=(94,y,848,y+106)
        top_art(p,path,'wallet_v8_field.png',box,sliced=True)
        label(p,path+'/V8字段标题',(112,y+18,276,y+87),box,30,name,0)
        label(p,path+'/txt',(282,y+18,709,y+87),box,28,None,0)
        local(p,path+'/复制','wallet_v8_gold_button.png',(723,y+21,833,y+85),box,True,True)
        label(p,path+'/复制/V8文字',(0,0,110,64),(0,0,110,64),27,'复制',color=NAVY)
    for name,y,title in [('结果',1032,'订单状态'),('余额',1116,'钱包余额')]:
        box=(94,y,848,y+67);top_art(p,info+'/'+name,'transparent.png',box)
        label(p,info+'/'+name+'/V8标题',(112,y,352,y+67),box,30,title,0)
        label(p,info+'/'+name+'/txt',(359,y,822,y+67),box,30,None,0)
    path=info+'/刷新订单';box=(263,1260,678,1371)
    top_art(p,path,'wallet_v8_gold_button.png',box,sliced=True,hide=True)
    label(p,path+'/V8文字',box,box,41,'刷新订单',color=NAVY)

    r='钱包/容器/充值/充值信息/bk'
    p.sprite(p.node(r),'wallet_v8_panel.png',sliced=True);untint(p,p.node(r))
    label(p,r+'/V8标题',(170,25,640,90),(0,0,809,906),40,'充值信息')
    for name in ['银行','姓名','卡号','手机','身份证']:
        path=r+'/list/'+name;n=p.node(path)
        p.sprite(n,'wallet_v8_field.png',sliced=True);untint(p,n)
        # Replace only the input field material; preserve EditBox references.
        ep=path+'/input';e=p.node(ep)
        try:p.sprite(p.node(ep+'/BACKGROUND_SPRITE'),'transparent.png')
        except KeyError:pass
        for suffix in ['TEXT_LABEL','PLACEHOLDER_LABEL','New Label']:
            nn=p.node(ep+'/'+suffix);p.data[nn]['_color']=copy.deepcopy(GOLD)
            p.disable(nn,'cc.LabelOutline')
    n=p.node(r+'/确认充值2');p.art(n,'wallet_recharge_confirm_exact.png',0,-290,435,81,hide=True);untint(p,n)


def apply_money():
    # Coin-flow has its own source panels and no unsupported cumulative totals.
    # Keep subsequent full-page migrations from restoring the rejected artwork.
    from repair_v8_money_art import extract, apply
    extract()
    apply()


def main():
    extract()
    p=Prefab('assets/resources/Prefabs/钱包.prefab')
    apply_withdraw(p);apply_record(p);apply_realname(p);apply_auxiliary(p)
    repair_editbox_labels(p.data);p.save()
    apply_money()
    print('V8 wallet pages and coin-flow components saved; shared lobby scene retained.')


if __name__=='__main__':main()
