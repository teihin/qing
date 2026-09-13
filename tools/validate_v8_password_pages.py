#!/usr/bin/env python3
"""Read-only password form scope, input contracts and layout/import checks."""
import argparse
import copy
import json
from collections import Counter
from apply_v7_prefab_skin import Prefab, ROOT, frame_uuid
from apply_v8_password_pages import PAGE, OUT, PAGES, descendants
from validate_v8_settings import tree


def validate(imports=False,baseline=None):
    p=Prefab(PAGE);old=Prefab(PAGE)
    old.data=json.loads((ROOT/baseline if baseline else OUT/'before/panelMain.prefab').read_text())
    scope=set().union(*(tree(old,old.node(name)) for name in PAGES))
    for i,obj in enumerate(old.data):
        if i not in scope:assert obj==p.data[i],('Changed outside password pages',i)
        elif obj.get('__type__') in ['cc.Button','cc.EditBox']:
            assert obj==p.data[i],('Changed interaction contract',i)
        elif obj.get('__type__')=='cc.Node':assert obj['_name']==p.data[i]['_name']
    assert (ROOT/'assets/scripts/UI/panelMain.ts').read_bytes()==(OUT/'before/panelMain.ts').read_bytes()
    before=Counter(o['fileId'] for o in old.data if o.get('__type__')=='cc.PrefabInfo')
    after=Counter(o['fileId'] for o in p.data if o.get('__type__')=='cc.PrefabInfo')
    assert all(n<=max(1,before[k]) for k,n in after.items())
    for name in PAGES:
        for n in descendants(p,p.node(name)):
            edit=p.component(n,'cc.EditBox')[1]
            if edit:
                for key in ['_N$textLabel','_N$placeholderLabel']:
                    text=p.data[edit[key]['__id__']]
                    assert text['_N$overflow']==text['_overflow']==1
                    assert text['_N$string']==text['_string']
        assert not p.data[p.node(name+'/V7密码页面母版')]['_active']
        assert p.component(p.node(name+'/V7密码页面母版'),'cc.Sprite')[1]['_spriteFrame'] is None
        assert p.component(p.node(name+'/V8大厅背景'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
        for height in [1334,1500,1624,1778,1860]:
            boxes={p.node(name):(0,0,750,height)}
            def walk(n):
                o=p.data[n];parent=boxes[o['_parent']['__id__']];x,y=o['_trs']['array'][:2]
                w,h=o['_contentSize']['width'],o['_contentSize']['height'];a=o['_anchorPoint']
                c=p.component(n,'cc.Widget')[1]
                if c and c['_enabled']:
                    f=c['_alignFlags'];pw,ph=parent[2:]
                    if f&40==40:w=pw-c['_left']-c['_right'];x=-pw/2+c['_left']+w*a['x']
                    elif f&16:x=c['_horizontalCenter']
                    if f&5==5:h=ph-c['_top']-c['_bottom'];y=ph/2-c['_top']-h*(1-a['y'])
                    elif f&1:y=ph/2-c['_top']-h*(1-a['y'])
                    elif f&4:y=-ph/2+c['_bottom']+h*a['y']
                boxes[n]=(parent[0]+x+w*(.5-a['x']),parent[1]+y+h*(.5-a['y']),w,h)
                for ref in o['_children']:walk(ref['__id__'])
            for ref in p.data[p.node(name)]['_children']:walk(ref['__id__'])
            last_bottom=None
            rows=['新密码1','新密码2'] if name=='初始化交易密码' else ['原有密码','新密码1','新密码2']
            for path in [name+'/列表/'+r for r in rows]+[name+'/列表/ok/确定'+name]:
                x,y,w,h=boxes[p.node(path)]
                assert abs(x)+w/2<=375 and abs(y)+h/2<=height/2,(name,height,path,'outside')
                if last_bottom is not None:assert y+h/2<=last_bottom,(name,height,'overlap')
                last_bottom=y-h/2
            back=boxes[p.node(name+'/title copy/关闭上上层')]
            assert height/2-back[1]==36,(name,height,'back position')
    if imports:
        uid=json.loads((ROOT/(PAGE+'.meta')).read_text())['uuid']
        actual=json.loads((ROOT/'library/imports'/uid[:2]/(uid+'.json')).read_text())
        expected=copy.deepcopy(p.data);expected[0].pop('_name',None);actual[0].pop('_name',None)
        assert actual==expected,'Creator Prefab import is stale'
    print('PASS: three password pages, eight unchanged EditBox contracts, five heights, unchanged other pages'+('; Creator import current' if imports else ''))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--imports',action='store_true')
    parser.add_argument('--baseline',help='Prefab snapshot for this password-only revision')
    args=parser.parse_args();validate(args.imports,args.baseline)
