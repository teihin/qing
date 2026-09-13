#!/usr/bin/env python3
"""Author real password forms in panelMain; never replace them with page images."""
import copy
from PIL import Image
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_settings import new, art, label, icon, pin, reset, FONT, GOLD, SUB, PANEL
from repair_v7_responsive_layout import ensure_widget

PAGE='assets/resources/UI/panelMain.prefab'
OUT=ROOT/'art_sources/v8-repairs/passwords'
PAGES=['修改登陆密码','修改交易密码','初始化交易密码']


def descendants(p,n):
    yield n
    for ref in p.data[n].get('_children',[]):yield from descendants(p,ref['__id__'])


def field(p,path,caption,placeholder,top,height):
    art(p,path,PANEL,0,0,650,height,True);pin(p,path,top=top)
    # Original decorative art is retired; the original txt EditBox remains live.
    for ref in list(p.data[p.node(path)]['_children']):
        n=ref['__id__']
        if p.data[n]['_name']!='txt' and not p.data[n]['_name'].startswith('V8'):
            p.set_active(n,False)
    icon(p,path,'login',-282,0,48)
    label(p,path,'V8名称',caption,-148,0,204,48,size=28,bold=True)
    edit_path=path+'/txt';n=p.node(edit_path);reset(p,n)
    p.set_pos(n,143,0,310,78);p.set_active(n,True)
    bg=p.node(edit_path+'/BACKGROUND_SPRITE');reset(p,bg)
    p.set_pos(bg,0,0,310,78)
    for suffix,placeholder_state in [('TEXT_LABEL',False),('PLACEHOLDER_LABEL',True)]:
        n=p.node(edit_path+'/'+suffix);reset(p,n);p.set_active(n,True)
        node=p.data[n];node['_anchorPoint'].update(x=0,y=1)
        p.set_pos(n,-145,39,290,78)
        node['_color']=copy.deepcopy(SUB if placeholder_state else GOLD)
        c=p.component(n,'cc.Label')[1]
        c.update(_enabled=True,_fontSize=26 if placeholder_state else 28,_lineHeight=34,
                 _overflow=1,_enableWrapText=False,_isSystemFontUsed=False,
                 **{'_N$file':copy.deepcopy(FONT),'_N$horizontalAlign':0,'_N$verticalAlign':1,'_N$overflow':1})
        if placeholder_state:c['_string']=c['_N$string']=placeholder
        p.disable(n,'cc.LabelOutline')
        # Cocos EditBox upgrades both inner labels to anchor (0,1). Match the
        # stored position and use a native Widget so resize/focus cannot offset it.
        ensure_widget(p,n).update(_enabled=True,alignMode=1,_target=None,_alignFlags=45,
            _left=10,_right=10,_top=0,_bottom=0,_horizontalCenter=0,_verticalCenter=0,
            _isAbsLeft=True,_isAbsRight=True,_isAbsTop=True,_isAbsBottom=True)


def apply():
    (OUT/'before').mkdir(parents=True,exist_ok=True)
    for file in [PAGE,'assets/scripts/UI/panelMain.ts']:
        dest=OUT/'before'/file.split('/')[-1]
        if not dest.exists():dest.write_bytes((ROOT/file).read_bytes())
    p=Prefab(PAGE)
    for root_name in PAGES:
        root=p.node(root_name);p.disable(root,'cc.Sprite')
        old=p.node(root_name+'/V7密码页面母版');p.set_active(old,False);p.disable(old,'cc.Sprite')
        bg=new(p,root_name,'V8大厅背景')
        art(p,bg,'lobby_scene_long_v8.png',0,0,750,2353*750/941);pin(p,bg,top=0)
        shield=new(p,root_name,'V8盾牌');w,h=Image.open(ASSET_DIR/'money_v8_shield.png').size
        art(p,shield,'money_v8_shield.png',0,0,234*w/h,234);pin(p,shield,top=88)
        title=root_name+'/title copy'
        art(p,title,'personal_info2_header_bg_v8.png',0,0,750,72);pin(p,title,top=0,stretch=True)
        p.set_active(p.node(title+'/修改密码'),False)
        button=title+'/关闭上上层';n=p.node(button);reset(p,n);p.disable(n,'cc.Sprite')
        p.set_pos(n,-326,0,96,72)
        art(p,button+'/关闭','wallet_header_back_v8.png',0,0,45,43)
        label(p,title,'V8标题',root_name.replace('登陆','登录'),-104,0,350,50,size=34,bold=True)

        group=root_name+'/列表'
        art(p,group,PANEL,0,0,694,886,True);p.disable(p.node(group),'cc.Layout')
        pin(p,group,top=356,bottom=92,stretch=True,left=28,right=28)
        init=root_name=='初始化交易密码';trade=root_name=='修改交易密码'
        if trade or init:
            hero=icon(p,group,'security' if init else 'login',0,0,82,'V8安全图标');pin(p,hero,top=28)
            heading=label(p,group,'V8表单标题','设置交易密码' if init else '修改交易密码',0,0,590,60,size=40,align=1,bold=True)
            pin(p,heading,top=126)
            hint=label(p,group,'V8表单说明','请设置并妥善保管您的交易密码' if init else '为保障账户安全，请设置新的交易密码',0,0,626,44,size=24,sub=True,align=1)
            pin(p,hint,top=194)
        fields=[('新密码1','新交易密码' if trade or init else '新登录密码','请输入新密码'),
                ('新密码2','确认交易密码' if trade or init else '确认新密码','请再次输入新密码')]
        if not init:fields.insert(0,('原有密码','原交易密码' if trade else '原登录密码','请输入原密码'))
        first,step,height=(310,146,118) if init else ((264,132,112) if trade else (64,166,128))
        for index,(name,caption,placeholder) in enumerate(fields):
            field(p,group+'/'+name,caption,placeholder,first+step*index,height)

        holder=group+'/ok';n=p.node(holder);reset(p,n);p.disable(n,'cc.Sprite')
        p.set_active(n,True);pin(p,holder,bottom=56,width=560,height=112)
        ok=holder+'/确定'+root_name
        if init:
            art(p,ok,PANEL,0,0,560,112,True)
            text=label(p,ok,'V8文字','初始化交易密码',0,0,500,70,size=36,align=1,bold=True)
        else:
            w,h=Image.open(ASSET_DIR/'personal_info2_confirm_button_v8.png').size
            art(p,ok,'personal_info2_confirm_button_v8.png',0,0,560,560*h/w)
        for n in descendants(p,root):
            sprite=p.component(n,'cc.Sprite')[1]
            if sprite and not sprite.get('_enabled',True):sprite['_spriteFrame']=None
        front=[p.node(bg),p.node(shield),p.node(group),p.node(title)]
        children=p.data[root]['_children']
        children[:]=[r for r in children if r['__id__'] not in front]+[{'__id__':n} for n in front]
    p.save()
    print('Authored login/trade/init password forms and eight aligned live EditBoxes.')


if __name__=='__main__':apply()
