#!/usr/bin/env python3
"""Read-only checks for source-faithful V8 registration and live input geometry."""
import json
from pathlib import Path
from PIL import Image,ImageChops
from apply_v7_prefab_skin import Prefab,ROOT,ASSET_DIR
from apply_v7_login_register_exact import editbox_component

S=750/941
BASE='注册弹窗/注册资料框'
def main():
    p=Prefab('assets/resources/UI/panelLogin.prefab')
    source=Image.open(ROOT/'design-previews/效果图V8-new/04-登录与弹窗/01-快速注册弹窗-大字版.png').convert('RGBA')
    by_uuid={}
    for path in ASSET_DIR.glob('*.png.meta'):
        m=json.loads(path.read_text())
        for f in m['subMetas'].values():by_uuid[f['uuid']]=(path.with_suffix(''),m,f)
    def art(path):
        _,sprite=p.component(p.node(path),'cc.Sprite')
        assert sprite and sprite['_type']==0,path+' 被九切拉伸'
        file,meta,frame=by_uuid[sprite['_spriteFrame']['__uuid__']]
        image=Image.open(file).convert('RGBA')
        assert image.size==(meta['width'],meta['height'])==(frame['width'],frame['height'])
        assert not meta['packable'] and frame['trimType']=='none'
        return image
    def source_box(path):
        node=p.data[p.node(path)]
        w,h=node['_contentSize']['width'],node['_contentSize']['height']
        x=y=0
        i=p.node(path)
        while i!=p.node('注册弹窗'):
            n=p.data[i]
            assert n['_trs']['array'][7:10]==[1,1,1]
            x+=n['_trs']['array'][0];y+=n['_trs']['array'][1]
            i=n['_parent']['__id__']
        return tuple(round(v) for v in ((x-w/2)/S+470.5,836-(y+h/2)/S,(x+w/2)/S+470.5,836-(y-h/2)/S))
    def same_opaque(image,expected,label):
        assert image.size==expected.size,label+' 尺寸与源坐标不符'
        mask=image.getchannel('A').point(lambda a:255 if a==255 else 0)
        delta=ImageChops.difference(image.convert('RGB'),expected.convert('RGB'))
        assert Image.composite(delta,Image.new('RGB',image.size),mask).getbbox() is None,label+' 定稿像素被重绘或坐标不匹配'

    panel=art(BASE)
    assert source_box(BASE)==(103,221,837,1525)
    same_opaque(panel,source.crop(source_box(BASE)),'整个弹窗')
    assert panel.getpixel((0,0))[3]==0 and panel.getpixel((367,330))[3]==0
    ring_path=BASE+'/头像选择/V7头像圆环'
    ring=art(ring_path)
    assert source_box(ring_path)==(356,439,584,663)
    same_opaque(ring,source.crop(source_box(ring_path)),'头像金属环')
    assert ring.getpixel((0,0))[3]==255 and ring.getpixel((114,112))[3]==0,'头像角落或中心遮挡'
    avatar=p.data[p.node(BASE+'/头像选择/头像预览')]
    assert avatar['_contentSize']['width']>=212*S and avatar['_contentSize']['height']>=209*S
    group=p.data[p.node(BASE+'/头像选择')]
    order=[r['__id__'] for r in group['_children']]
    assert order.index(p.node(ring_path))>order.index(p.node(BASE+'/头像选择/头像预览'))
    toggle_path=BASE+'/防盗号/防盗号开关'
    off=art(toggle_path+'/Background')
    same_opaque(off,source.crop(source_box(toggle_path+'/Background')),'开关默认态')
    assert ImageChops.difference(art(toggle_path+'/checkmark'),off.transpose(Image.Transpose.FLIP_LEFT_RIGHT)).getbbox() is None

    for name,y0,y1 in [('邀请码',706,796),('昵称',801,891),('账号',896,986),('密码',991,1081),('确认密码',1086,1177)]:
        path=BASE+'/'+name
        assert source_box(path)==(128,y0,812,y1)
        image=art(path)
        expected=source.crop(source_box(path))
        # Only the dynamic placeholder rectangle may differ from the source row.
        expected.paste(image.crop((262,17,673,72)),(262,17))
        same_opaque(image,expected,name+' 输入行')
        _,sprite=p.component(p.node(path),'cc.Sprite')
        assert not sprite['_enabled'],name+' 初始态覆盖了定稿占位字'
        edit_id=p.node(path+'/输入')
        _,edit=editbox_component(p,edit_id)
        assert edit and edit['_N$placeholder']=='',name+' 原生输入或占位绑定缺失'
        if name in ['密码','确认密码']:assert edit['_N$inputFlag']==0
        for child in ['字段名称','分割线','输入/PLACEHOLDER_LABEL']:
            assert not p.data[p.node(path+'/'+child)]['_active'],name+' 旧文字重复显示'
        text_node=p.data[p.node(path+'/输入/TEXT_LABEL')]
        assert text_node['_anchorPoint']['x']==0 and text_node['_anchorPoint']['y']==1
        x0,t,x1,b=source_box(path+'/输入')
        assert 390<=x0<x1<=801 and y0<t<b<y1,name+' 动态文字越过标题或边框'

    _,widget=p.component(p.node(BASE),'cc.Widget')
    assert widget['_enabled'] and widget['_alignFlags']==18
    assert widget['_isAbsHorizontalCenter'] and widget['_isAbsVerticalCenter']
    def no_stretch(i):
        _,w=p.component(i,'cc.Widget')
        assert not w or not w['_enabled'],'内部仍有独立响应式 Widget'
        for r in p.data[i].get('_children',[]):no_stretch(r['__id__'])
    for ref in p.data[p.node(BASE)]['_children']:no_stretch(ref['__id__'])
    for h in [1334,1500,1624,1778]:
        assert h/2+widget['_verticalCenter']-1304*S/2>0
        assert h/2-widget['_verticalCenter']-1304*S/2>0
    children=[r['__id__'] for r in p.data[p.node(BASE)]['_children']]
    assert children.index(p.node(BASE+'/V7注册动态状态底'))<children.index(p.node(BASE+'/注册状态'))
    assert source_box(BASE+'/V7注册动态状态底')[3]<source_box(BASE+'/确认注册')[1]
    for child in ['关闭注册','确认注册','头像选择/头像预览','头像选择/上一头像','头像选择/下一头像']:
        _,button=p.component(p.node(BASE+'/'+child),'cc.Button')
        assert button and button['_enabled'] and button['_N$interactable']
        assert button['transition']==button['_N$transition']==0
    _,block=p.component(p.node('注册弹窗'),'cc.BlockInputEvents')
    assert block and block['_enabled'] and not p.data[p.node('注册弹窗')]['_active']
    print('PASS: V8 弹窗定稿像素/坐标一致；动态输入、头像遮边、开关与状态层保留；四档高度无拉伸越界。')

if __name__=='__main__':main()
