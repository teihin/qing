#!/usr/bin/env python3
"""Author exact V8 registration geometry in the existing login Prefab."""
import copy
from apply_v7_prefab_skin import Prefab
from apply_v7_login_register_exact import full_widget, centered_widget, untint, editbox_component
from apply_v8_login import update_meta

SCALE=750/941
PANEL=(103,221,837,1525)
BASE='注册弹窗/注册资料框'
ROWS={
    '邀请码':('invite',(128,706,812,796)),
    '昵称':('nickname',(128,801,812,891)),
    '账号':('account',(128,896,812,986)),
    '密码':('password',(128,991,812,1081)),
    '确认密码':('confirm',(128,1086,812,1177)),
}
WHITE={'__type__':'cc.Color','r':255,'g':255,'b':255,'a':255}
TEXT={'__type__':'cc.Color','r':244,'g':237,'b':216,'a':255}

def place(p,path,rect,parent_rect=PANEL):
    x0,y0,x1,y1=rect
    px0,py0,px1,py1=parent_rect
    node=p.node(path)
    p.set_pos(node,((x0+x1-px0-px1)/2)*SCALE,
              ((py0+py1-y0-y1)/2)*SCALE,(x1-x0)*SCALE,(y1-y0)*SCALE,disable_widget=True)
    p.data[node]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[node]['_trs']['array'][7:10]=[1,1,1]
    return node

def main():
    names=['register_modal_panel_exact.png','register_avatar_ring_exact.png',
           'register_toggle_off_exact.png','register_toggle_on_exact.png',
           'register_status_clean_exact.png','register_status_icon_exact.png',
           'register_submit_exact.png','register_anti_theft_exact.png']
    names += [f'register_row_{key}_exact.png' for key,_ in ROWS.values()]
    for name in names:update_meta(name)
    p=Prefab('assets/resources/UI/panelLogin.prefab')
    dialog=p.node(BASE)
    # Disable old percentage Widgets below the fixed dialog. They must not
    # move exact crop overlays independently when the screen becomes taller.
    def fixed_subtree(node):
        for ref in p.data[node].get('_children',[]):
            p.disable(ref['__id__'],'cc.Widget');fixed_subtree(ref['__id__'])
    fixed_subtree(dialog)
    full_widget(p,p.node('注册弹窗'),750,1334)
    full_widget(p,p.node('注册弹窗/遮罩'),750,1334)
    p.set_active(p.node('注册弹窗'),False)
    centered_widget(p,dialog,734*SCALE,1304*SCALE)
    # Center the source canvas as a whole and retain the approved modal offset.
    _,widget=p.component(dialog,'cc.Widget')
    widget.update(_horizontalCenter=-.5*SCALE,_verticalCenter=-37*SCALE,
                  _isAbsHorizontalCenter=True,_isAbsVerticalCenter=True)
    p.set_pos(dialog,-.5*SCALE,-37*SCALE)
    p.sprite(dialog,'register_modal_panel_exact.png');untint(p,dialog)

    for child in ['8L徽标','注册标题','注册副标题','注册安全提示',
                  'V7注册标题美术','V7注册副标题美术','V7注册标题分隔','V7注册安全提示美术']:
        p.set_active(p.node(BASE+'/'+child),False)
    close=place(p,BASE+'/关闭注册',(746,241,815,312))
    p.set_active(p.node(BASE+'/关闭注册/关闭图标'),False)

    avatar_rect=(356,439,584,663)
    group=place(p,BASE+'/头像选择',avatar_rect)
    p.disable(group,'cc.Sprite')
    avatar=place(p,BASE+'/头像选择/头像预览',(361,442,579,660),avatar_rect)
    untint(p,avatar)
    ring=place(p,BASE+'/头像选择/V7头像圆环',avatar_rect,avatar_rect)
    p.sprite(ring,'register_avatar_ring_exact.png');untint(p,ring)
    p.set_active(ring,True)
    for name,rect in [('上一头像',(271,524,322,584)),('下一头像',(614,523,665,584))]:
        place(p,BASE+'/头像选择/'+name,rect,avatar_rect)
        p.set_active(p.node(BASE+'/头像选择/'+name+'/箭头'),False)
        p.set_active(p.node(BASE+'/头像选择/'+name+'/V7头像箭头美术'),False)
    for child in ['字段名称','分割线','头像序号','V7头像提示美术']:
        p.set_active(p.node(BASE+'/头像选择/'+child),False)
    # Frame/background cover must draw after the real square avatar image.
    children=p.data[group]['_children']
    children[:]=[r for r in children if r['__id__']!=ring]+[{'__id__':ring}]

    for name,(key,rect) in ROWS.items():
        path=BASE+'/'+name
        row=place(p,path,rect)
        p.sprite(row,f'register_row_{key}_exact.png');untint(p,row)
        p.disable(row,'cc.Sprite') # Existing input events enable only the live row.
        for child in ['字段名称','分割线']:p.set_active(p.node(path+'/'+child),False)
        input_rect=(400,rect[1]+16,797,rect[1]+74)
        edit_id=place(p,path+'/输入',input_rect,rect)
        _,edit=editbox_component(p,edit_id)
        font_size=28*SCALE
        edit.update({'_N$fontSize':font_size,'_N$lineHeight':36*SCALE,
                     '_N$fontColor':copy.deepcopy(TEXT),'_N$placeholder':''})
        w,h=397*SCALE,58*SCALE
        for child in ['TEXT_LABEL','PLACEHOLDER_LABEL']:
            label_id=p.node(path+'/输入/'+child)
            p.set_pos(label_id,-w/2,h/2,w,h,disable_widget=True)
            p.data[label_id]['_anchorPoint']={'__type__':'cc.Vec2','x':0,'y':1}
            p.data[label_id]['_color']=copy.deepcopy(TEXT)
            _,label=p.component(label_id,'cc.Label')
            label.update({'_fontSize':font_size,'_lineHeight':36*SCALE,
                          '_N$horizontalAlign':0,'_N$verticalAlign':1,'_N$overflow':1,'_enableWrapText':False})
            p.disable(label_id,'cc.LabelOutline')
            if child=='PLACEHOLDER_LABEL':
                label.update({'_enabled':False,'_string':'','_N$string':''})
                p.set_active(label_id,False)

    anti_rect=(128,1182,812,1280)
    anti=place(p,BASE+'/防盗号',anti_rect)
    p.sprite(anti,'register_anti_theft_exact.png');p.disable(anti,'cc.Sprite')
    for child in ['防盗号文字','防盗号说明']:p.set_active(p.node(BASE+'/防盗号/'+child),False)
    toggle_rect=(686,1205,784,1260)
    toggle=place(p,BASE+'/防盗号/防盗号开关',toggle_rect,anti_rect)
    for child,asset in [('Background','register_toggle_off_exact.png'),('checkmark','register_toggle_on_exact.png')]:
        node=place(p,BASE+'/防盗号/防盗号开关/'+child,toggle_rect,toggle_rect)
        p.sprite(node,asset);untint(p,node)
    for ref in p.data[toggle]['_components']:
        comp=p.data[ref['__id__']]
        if '_N$isChecked' in comp:comp['_N$isChecked']=False

    bg=place(p,BASE+'/V7注册动态状态底',(142,1283,800,1340))
    p.sprite(bg,'register_status_clean_exact.png');untint(p,bg);p.set_active(bg,False)
    # The dynamic state uses the whole strip; the baked default remains exact.
    status=place(p,BASE+'/注册状态',(185,1285,793,1339))
    _,label=p.component(status,'cc.Label')
    label.update({'_fontSize':20,'_lineHeight':21,'_N$horizontalAlign':1,
                  '_N$verticalAlign':1,'_N$overflow':1,'_enableWrapText':True})
    p.data[status]['_color']=copy.deepcopy(TEXT);p.set_active(status,False)
    icon=place(p,BASE+'/V7注册状态图标',(313,1296,352,1335))
    p.sprite(icon,'register_status_icon_exact.png');untint(p,icon)
    # Dynamic messages may be wider than the default sentence. Place this
    # small original icon at the left, with its opaque source crop behind it.
    p.set_pos(icon,(163-470)*SCALE,(873-1311.5)*SCALE)
    p.set_active(icon,False)
    submit=place(p,BASE+'/确认注册',(128,1343,812,1448))
    p.sprite(submit,'register_submit_exact.png');p.disable(submit,'cc.Sprite')
    p.set_active(p.node(BASE+'/确认注册/确认注册文字'),False)
    # Click hit nodes stay fixed over the approved art, including during press.
    def no_zoom(node):
        _,button=p.component(node,'cc.Button')
        if button:button['_N$transition']=button['transition']=0
        for ref in p.data[node].get('_children',[]):no_zoom(ref['__id__'])
    no_zoom(dialog)
    p.save()
    print('V8 registration authored from one fixed reference coordinate system.')

if __name__=='__main__':main()
