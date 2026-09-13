#!/usr/bin/env python3
"""Author real settings controls with shared V8 materials, only inside 设置."""
import copy
from PIL import Image
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v7_lobby_exact import style_label, untint
from apply_v8_mine import unique_clone
from repair_v7_responsive_layout import ensure_widget

PAGE='assets/resources/UI/panelMain.prefab'
OUT=ROOT/'art_sources/v8-repairs/settings'
FONT={'__uuid__':'fd7307b2-666e-4c26-963d-59f787cad6fb'}
PANEL='settlement_v8_list_panel.png'
GOLD={'__type__':'cc.Color','r':255,'g':242,'b':216,'a':255}
SUB={'__type__':'cc.Color','r':213,'g':229,'b':235,'a':255}


def reset(p,n):
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[n]['_trs']['array'][7:10]=[1,1,1]
    untint(p,n);p.disable(n,'cc.Widget')


def new(p,parent,name,label=False):
    path=parent+'/'+name
    try:n=p.node(path)
    except KeyError:
        template='设置/列表/item/防盗号/防盗号文字' if label else '设置/title/设置'
        n=unique_clone(p,p.node(template),p.node(parent),name)
    reset(p,n);p.set_active(n,True)
    return path


def art(p,path,asset,x,y,w,h,sliced=False):
    n=p.node(path);reset(p,n);p.sprite(n,asset,sliced=sliced)
    p.set_pos(n,x,y,w,h);p.set_active(n,True)


def label(p,parent,name,value,x,y,w,h,size=30,sub=False,align=0,bold=False):
    path=new(p,parent,name,True)
    style_label(p,path,x=x,y=y,width=w,height=h,size=size,preview=value,align=align)
    n=p.node(path);c=p.component(n,'cc.Label')[1]
    c.update(_enabled=True,_lineHeight=size+4,_enableWrapText=False,
             _isSystemFontUsed=False,_styleFlags=1 if bold else 0,**{'_N$file':copy.deepcopy(FONT)})
    p.data[n]['_color']=copy.deepcopy(SUB if sub else GOLD)
    p.component(n,'cc.LabelOutline')[1].update(_width=1,_color={'__type__':'cc.Color','r':2,'g':18,'b':31,'a':255})
    return path


def pin(p,path,*,top=None,bottom=None,x=0,width=None,height=None,stretch=False,left=0,right=0):
    n=p.node(path);node=p.data[n];parent=p.data[node['_parent']['__id__']]
    pw=parent['_contentSize']['width'];ph=parent['_contentSize']['height']
    w=width if width is not None else node['_contentSize']['width']
    h=height if height is not None else node['_contentSize']['height']
    flags=16
    if stretch:w=pw-left-right;flags=40;x=(left-right)/2
    if top is not None and bottom is not None:
        h=ph-top-bottom;y=(bottom-top)/2;flags|=5
    elif top is not None:y=ph/2-top-h/2;flags|=1
    else:y=-ph/2+bottom+h/2;flags|=4
    p.set_pos(n,x,y,w,h)
    ensure_widget(p,n).update(_enabled=True,alignMode=1,_alignFlags=flags,
        _top=top or 0,_bottom=bottom or 0,_left=left,_right=right,
        _horizontalCenter=x,_isAbsTop=True,_isAbsBottom=True,_originalWidth=w,_originalHeight=h)


def icon(p,parent,key,x,y,size=62,name='V8图标'):
    path=new(p,parent,name);asset='settings_v8_icon_'+key+'.png'
    w,h=Image.open(ASSET_DIR/asset).size;s=size/max(w,h)
    art(p,path,asset,x,y,w*s,h*s)
    return path


def row(p,path,key,title,desc,top,interactive=False):
    art(p,path,PANEL,0,0,650,100,True);pin(p,path,top=top)
    icon(p,path,key,-272,0,62)
    # Use whitespace between icon and text; no decorative stroke through the row.
    try:
        divider=p.node(path+'/V8图文分隔')
        p.set_active(divider,False);p.disable(divider,'cc.Sprite')
    except KeyError:pass
    label(p,path,'V8名称',title,-5,19,376,42,bold=True)
    label(p,path,'V8说明',desc,-5,-22,376,32,size=23,sub=True)
    if interactive:icon(p,path,'chevron',279,0,30,'V8箭头')


def apply():
    (OUT/'before').mkdir(parents=True,exist_ok=True)
    for f in [PAGE,'assets/scripts/UI/panelMain.ts']:
        dest=OUT/'before'/f.split('/')[-1]
        if not dest.exists():dest.write_bytes((ROOT/f).read_bytes())
    p=Prefab(PAGE);root=p.node('设置')
    p.disable(root,'cc.Sprite')
    old=p.node('设置/V7系统设置母版');p.set_active(old,False);p.disable(old,'cc.Sprite')
    bg=new(p,'设置','V8大厅背景');art(p,bg,'lobby_scene_long_v8.png',0,0,750,2353*750/941)
    pin(p,bg,top=0)
    shield=new(p,'设置','V8盾牌');w,h=Image.open(ASSET_DIR/'money_v8_shield.png').size
    art(p,shield,'money_v8_shield.png',0,0,234*w/h,234);pin(p,shield,top=88)

    title='设置/title';art(p,title,'personal_info2_header_bg_v8.png',0,0,750,72)
    pin(p,title,top=0,stretch=True)
    button=title+'/关闭上上层';n=p.node(button);reset(p,n);p.disable(n,'cc.Sprite')
    p.set_pos(n,-326,0,96,72)
    arrow=button+'/关闭';art(p,arrow,'wallet_header_back_v8.png',0,0,45,43)
    label(p,title,'V8标题','系统设置',-159,0,240,50,size=34,bold=True)

    group='设置/列表';art(p,group,PANEL,0,0,694,966,True)
    p.disable(p.node(group),'cc.Layout');pin(p,group,top=336,bottom=32,stretch=True,left=28,right=28)
    gear=icon(p,group,'gear',-280,0,50,'V8标题图标');pin(p,gear,top=23,x=-280)
    heading=label(p,group,'V8标题','系统设置',-130,0,218,52,size=34,bold=True);pin(p,heading,top=22,x=-130)
    caption=label(p,group,'V8提示','健康游戏  理性娱乐',190,0,254,40,size=22,sub=True,align=2);pin(p,caption,top=30,x=190)
    line=new(p,group,'V8标题分隔');art(p,line,'settlement_row_exact.png',0,0,642,2);pin(p,line,top=83)

    rows=[('修改登陆密码','login','修改登录密码','修改账号的登录密码',99),
          ('修改交易密码','trade','交易密码','设置或修改交易密码',207)]
    for name,key,heading,desc,y in rows:row(p,group+'/'+name,key,heading,desc,y,True)
    p.set_active(p.node(group+'/修改预留信息'),False)
    item=group+'/item';n=p.node(item);reset(p,n);p.disable(n,'cc.Sprite');pin(p,item,top=0,bottom=0,stretch=True)
    toggles=[('聊天语音','聊天语音','voice','聊天语音','开启或关闭聊天语音',315),
             ('游戏音效','游戏音效','audio','游戏音效','开启或关闭游戏音效',423),
             ('防盗号','防盗号开关','security','防盗号','限制其他设备登录',531)]
    for name,toggle,key,heading,desc,y in toggles:
        path=item+'/'+name;row(p,path,key,heading,desc,y)
        control=path+'/'+toggle;n=p.node(control);reset(p,n);p.set_pos(n,252,0,136,92)
        for state,key2,word,x in [('Background','off','关',26),('checkmark','on','开',-26)]:
            art(p,control+'/'+state,'register_toggle_'+key2+'_exact.png',0,0,112,112*55/98)
            label(p,control+'/'+state,'V8状态',word,x,0,38,38,size=22,align=1)
    for path in [item+'/语音',item+'/音效',item+'/防盗号/防盗号文字']:
        p.set_active(p.node(path),False)
    status=item+'/防盗号状态';n=p.node(status);reset(p,n);p.set_active(n,True)
    style_label(p,status,x=0,y=0,width=616,height=60,size=22,align=0)
    p.data[n]['_color']=copy.deepcopy(SUB)
    p.component(n,'cc.Label')[1].update(_lineHeight=28,_enableWrapText=True,_isSystemFontUsed=False,**{'_N$file':copy.deepcopy(FONT)})
    pin(p,status,top=644,width=616,height=60)

    exit_path=group+'/切换账号'
    row(p,exit_path,'logout','切换账号','退出当前账号，返回登录',0,True)
    pin(p,exit_path,bottom=24)
    # Keep the panel behind all controls, the header foremost, and no baked page.
    for obj in p.data:
        if obj.get('__type__')=='cc.Sprite' and not obj.get('_enabled',True):
            n=obj['node']['__id__'];cur=n
            while p.data[cur].get('_parent') is not None and cur!=root:cur=p.data[cur]['_parent']['__id__']
            if cur==root:obj['_spriteFrame']=None
    children=p.data[root]['_children'];last=[p.node(bg),p.node(shield),p.node(group),p.node(title)]
    children[:]=[r for r in children if r['__id__'] not in last]+[{'__id__':n} for n in last]
    p.save()
    print('V8 settings: real controls authored; other panelMain subtrees and business scripts untouched.')


if __name__=='__main__':apply()
