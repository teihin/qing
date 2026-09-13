#!/usr/bin/env python3
"""Read-only scope, control binding, layout and imported-resource checks."""
import argparse
import json
from collections import Counter
import numpy as np
from PIL import Image
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR, frame_uuid
from apply_v8_settings import PAGE, OUT


def tree(p,n):
    result={n}
    result.update(r['__id__'] for r in p.data[n].get('_components',[]))
    if p.data[n].get('_prefab'):result.add(p.data[n]['_prefab']['__id__'])
    for r in p.data[n].get('_children',[]):result.update(tree(p,r['__id__']))
    return result


def validate(imports=False,baseline=None):
    p=Prefab(PAGE);old=Prefab(PAGE)
    old.data=json.loads((ROOT/baseline if baseline else OUT/'before/panelMain.prefab').read_text())
    scope=tree(old,old.node('设置'))
    for i,obj in enumerate(old.data):
        if i not in scope:assert p.data[i]==obj,('Changed outside settings',i)
        elif obj.get('__type__')=='cc.Node':assert p.data[i]['_name']==obj['_name']
        elif obj.get('__type__')=='cc.Button' or 'checkEvents' in obj:
            assert p.data[i]==obj,('Changed Button/Toggle binding',i)
    assert (ROOT/'assets/scripts/UI/panelMain.ts').read_bytes()==(OUT/'before/panelMain.ts').read_bytes()
    for arr in [old.data,p.data]:
        counts=Counter(o['fileId'] for o in arr if o.get('__type__')=='cc.PrefabInfo')
        if arr is old.data:previous=counts
        else:assert all(count<=max(1,previous[key]) for key,count in counts.items()),'New duplicate fileId'
    assert not p.data[p.node('设置/V7系统设置母版')]['_active']
    assert p.component(p.node('设置/V7系统设置母版'),'cc.Sprite')[1]['_spriteFrame'] is None
    assert p.component(p.node('设置/V8大厅背景'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
    assert p.data[p.node('设置/列表/item/防盗号状态')]['_active']
    assert not p.data[p.node('设置/列表/修改预留信息')]['_active']
    for path in ['修改登陆密码','修改交易密码','修改预留信息',
                 'item/聊天语音','item/游戏音效','item/防盗号','切换账号']:
        divider=p.node('设置/列表/'+path+'/V8图文分隔')
        sprite=p.component(divider,'cc.Sprite')[1]
        assert not p.data[divider]['_active'] and not sprite['_enabled']
        assert sprite['_spriteFrame'] is None
    # Project design widths are fixed; native Widgets handle varying portrait height.
    for height in [1334,1500,1624,1778,1860]:
        boxes={p.root:(0,0,750,height)}
        def layout(n):
            o=p.data[n];par=boxes[o['_parent']['__id__']];x,y=o['_trs']['array'][:2]
            w,h=o['_contentSize']['width'],o['_contentSize']['height']
            widget=p.component(n,'cc.Widget')[1]
            if widget and widget['_enabled']:
                f=widget['_alignFlags'];pw,ph=par[2:]
                if f&8 and f&32:w=pw-widget['_left']-widget['_right'];x=(widget['_left']-widget['_right'])/2
                elif f&16:x=widget['_horizontalCenter']
                if f&1 and f&4:h=ph-widget['_top']-widget['_bottom'];y=(widget['_bottom']-widget['_top'])/2
                elif f&1:y=ph/2-widget['_top']-h/2
                elif f&4:y=-ph/2+widget['_bottom']+h/2
            boxes[n]=(par[0]+x,par[1]+y,w,h)
            for r in o.get('_children',[]):layout(r['__id__'])
        layout(p.node('设置'))
        names=['修改登陆密码','修改交易密码','item/聊天语音','item/游戏音效','item/防盗号','item/防盗号状态','切换账号']
        last_bottom=None
        for path in names:
            x,y,w,h=boxes[p.node('设置/列表/'+path)]
            assert abs(x)+w/2<=375 and abs(y)+h/2<=height/2,(height,path,'outside screen')
            if last_bottom is not None:assert y+h/2<=last_bottom,(height,path,'overlap')
            last_bottom=y-h/2
    names=['lobby_scene_long_v8.png','money_v8_shield.png','personal_info2_header_bg_v8.png','wallet_header_back_v8.png',
           'settlement_v8_list_panel.png','settlement_row_exact.png','register_toggle_on_exact.png','register_toggle_off_exact.png']
    manifest=json.loads((OUT/'icons.json').read_text())
    atlas=Image.open(OUT/'icons-transparent.png')
    for name,entry in manifest['icons'].items():
        icon=Image.open(ASSET_DIR/name)
        assert icon.mode=='RGBA' and icon.getchannel('A').getextrema()[0]==0
        assert np.array_equal(np.array(icon),np.array(atlas.crop(entry['cell']).crop(entry['crop'])))
        names.append(name)
    if imports:
        uid=json.loads((ROOT/(PAGE+'.meta')).read_text())['uuid']
        imported=json.loads((ROOT/'library/imports'/uid[:2]/(uid+'.json')).read_text())
        authored=json.loads(json.dumps(p.data));authored[0].pop('_name',None);imported[0].pop('_name',None)
        assert authored==imported,'Stale main Prefab'
        for name in names:
            uid=json.loads((ASSET_DIR/(name+'.meta')).read_text())['uuid']
            a,b=[np.array(Image.open(f).convert('RGBA'),dtype=float)/255 for f in [ASSET_DIR/name,ROOT/'library/imports'/uid[:2]/(uid+'.png')]]
            assert a.shape==b.shape,name
            a[:,:,:3]*=a[:,:,3,None];b[:,:,:3]*=b[:,:,3,None]
            assert abs(a-b).max()<.00001,('Stale texture',name)
    print('PASS: settings-only changes, original events and business, five portrait heights, nine alpha-preserving icons'+('; main Prefab and 17 textures imported' if imports else ''))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--imports',action='store_true')
    parser.add_argument('--baseline',help='Prefab snapshot for this settings-only revision')
    args=parser.parse_args();validate(args.imports,args.baseline)
