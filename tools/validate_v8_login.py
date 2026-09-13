#!/usr/bin/env python3
"""Read-only checks: approved art contours, continuous backdrop and Prefab geometry."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from apply_v7_prefab_skin import Prefab, ASSET_DIR, ROOT

def main():
    p = Prefab('assets/resources/UI/panelLogin.prefab')
    reference = Image.open(ROOT/'design-previews/效果图V8-new/01-主页面/01-登录.png').convert('RGBA')
    _,root_sprite = p.component(p.root,'cc.Sprite')
    assert not root_sprite['_enabled'], '拉满屏幕的根节点仍在绘制完整登录图'
    meta_by_uuid = {}
    for file in ASSET_DIR.glob('*.png.meta'):
        m=json.loads(file.read_text())
        for frame in m['subMetas'].values(): meta_by_uuid[frame['uuid']]=(file.with_suffix(''),m)

    def image_for(path):
        _,sprite = p.component(p.node(path),'cc.Sprite')
        assert sprite and sprite['_enabled'] and sprite['_type']==0, path+' 必须单独等比绘制'
        f,m = meta_by_uuid[sprite['_spriteFrame']['__uuid__']]
        img = Image.open(f).convert('RGBA')
        assert img.size==(m['width'],m['height']),f.name+' 导入尺寸失配'
        return img

    background=image_for('V8登录背景')
    assert background.size==(941,2232)
    background_node=p.data[p.node('V8登录背景')]
    background_id=p.data[background_node['_prefab']['__id__']]['fileId']
    assert sum(v.get('__type__')=='cc.PrefabInfo' and v.get('fileId')==background_id for v in p.data)==1,'新背景复用了旧节点标识'
    assert background.getchannel('A').getextrema()==(255,255),'完整背景出现透明孔洞'
    clean_source=Image.open(ROOT/'art_sources/v8-login/continuous-background-source.png').convert('RGB')
    resized_source=clean_source.resize(background.size,Image.Resampling.LANCZOS)
    assert max(ImageStat.Stat(ImageChops.difference(background.convert('RGB'),resized_source)).mean)<3,'背景被重新拼接，已偏离完整底图'
    paths=['登录LOGO','手机号','密码','忘记密码','注册账号','登陆']
    # Convert actual serialized coordinates back to approved source coordinates.
    # This catches wrong anchors/offsets even if all referenced files exist.
    bounds={}
    for path in ['V8登录背景']+paths:
        n=p.data[p.node(path)]
        _,widget=p.component(p.node(path),'cc.Widget')
        assert widget and widget['_enabled'] and widget['_alignFlags']==18,path+' 不是固定等比居中'
        x,y=widget['_horizontalCenter'],widget['_verticalCenter']
        width,height=n['_contentSize']['width'],n['_contentSize']['height']
        assert abs(x-n['_trs']['array'][0])<1e-6 and abs(y-n['_trs']['array'][1])<1e-6
        if path=='V8登录背景':
            assert width>=750 and height>=1778,'长背景未覆盖最大校验画布'
            assert abs(width/background.width-height/background.height)<1e-7,'长背景被拉伸'
            continue
        img=image_for(path+'/BACKGROUND_SPRITE' if path in ['手机号','密码'] else path)
        assert abs(width/img.width-height/img.height)<1e-7,path+' 图像被拉伸'
        assert abs(width/img.width-750/941)<1e-7,path+' 比例不匹配'
        x0=round((x-width/2)*941/750+941/2)
        y0=round(1672/2-(y+height/2)*941/750)
        bounds[path]=(x-width/2,y-height/2,x+width/2,y+height/2)
        assert img.getpixel((0,0))[3]==0,path+' 外角仍夹带旧背景'
        if path in ['手机号','密码']:
            hint='V7账号占位美术字' if path=='手机号' else 'V7密码占位美术字'
            hint_node=p.data[p.node(path+'/'+hint)]
            hint_img=image_for(path+'/'+hint)
            hx,hy=hint_node['_trs']['array'][:2]
            px=round(hx*941/750+img.width/2-hint_img.width/2)
            py=round(img.height/2-hy*941/750-hint_img.height/2)
            assert hint_img.getchannel('A').getextrema()==(255,255),'占位文字又被颜色阈值抠图'
            img.alpha_composite(hint_img,(px,py))
        original=reference.crop((x0,y0,x0+img.width,y0+img.height))
        opaque=img.getchannel('A').point(lambda a:255 if a==255 else 0)
        diff=ImageChops.difference(img.convert('RGB'),original.convert('RGB'))
        assert Image.composite(diff,Image.new('RGB',img.size),opaque).getbbox() is None,path+' 定稿美术内部像素被改写'
        if path in ['忘记密码','注册账号']:
            original_pixels,actual_pixels=original.load(),img.load()
            for yy in range(img.height):
                for xx in range(img.width):
                    pixel=original_pixels[xx,yy]
                    if min(pixel[:3])>170:assert actual_pixels[xx,yy]==pixel,path+' 浅色文字被误抠掉'
    order=['登录LOGO','手机号','密码','忘记密码','登陆']
    for a,b in zip(order,order[1:]): assert bounds[a][1]>bounds[b][3],a+' 与 '+b+' 重叠'
    for screen_h in [1334,1500,1624,1778]:
        for path,(left,bottom,right,top) in bounds.items():
            assert left>=-375 and right<=375 and bottom>=-screen_h/2 and top<=screen_h/2,(screen_h,path,'越界')
    for path in ['手机号','密码']:
        n=p.data[p.node(path)]
        comps=[p.data[r['__id__']] for r in n['_components']]
        edits=[c for c in comps if '_N$textLabel' in c and '_N$placeholderLabel' in c]
        assert len(edits)==1,path+' 原生输入绑定丢失'
        assert n['_parent']=={'__id__':p.root},path+' 业务路径被改变'
        if path=='密码':assert edits[0]['_N$inputFlag']==0,'密码掩码丢失'
    for path in ['忘记密码','注册账号','登陆']:
        _,button=p.component(p.node(path),'cc.Button')
        assert button and button['_enabled'] and button['_N$interactable']
        assert button.get('transition',button['_N$transition'])==0,'完整切图不能缩放露出背景孔洞'
    assert not p.data[p.node('注册弹窗')]['_active']
    print('PASS: 定稿美术内部像素保留；背景来自单张完整底图；四档屏幕无拉伸/重叠；输入和按钮契约保留。')

if __name__=='__main__':main()
