#!/usr/bin/env python3
"""Read-only guards for review scope, unchanged poker and Creator imports."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR, frame_uuid
from apply_v8_review import PAGE, ROW, TEXT_ROW, OUT


def subtree(p,n):
    ids={n}
    ids.update(r['__id__'] for r in p.data[n].get('_components',[]))
    if p.data[n].get('_prefab'):ids.add(p.data[n]['_prefab']['__id__'])
    for r in p.data[n].get('_children',[]):ids.update(subtree(p,r['__id__']))
    return ids


def before(file):
    p=Prefab(file)
    p.data=json.loads((OUT/'before'/Path(file).name).read_text())
    return p


def canonical(p):
    """Resolve node references by path; Creator may reorder serialized objects."""
    ids={0:'asset'}
    def walk(n,path):
        ids[n]=path
        for r in p.data[n].get('_components',[]):
            ids[r['__id__']]=path+'#'+p.data[r['__id__']]['__type__']
        if p.data[n].get('_prefab'):ids[p.data[n]['_prefab']['__id__']]=path+'#prefab'
        for r in p.data[n].get('_children',[]):
            walk(r['__id__'],path+'/'+p.data[r['__id__']]['_name'])
    walk(p.root,'')
    def norm(value):
        if isinstance(value,dict):
            return {'ref':ids[value['__id__']]} if '__id__' in value else {k:norm(v) for k,v in value.items() if k!='_id'}
        if isinstance(value,list):return [norm(v) for v in value]
        return value
    return {path:norm(p.data[i]) for i,path in ids.items()}


def validate(imports=False):
    original=before(PAGE);p=Prefab(PAGE);allowed=subtree(original,original.node('牌局回顾'))
    for i,obj in enumerate(original.data):
        if i not in allowed:assert p.data[i]==obj,'Changed settlement outside review: '+str(i)
    for file in [PAGE,ROW,TEXT_ROW]:
        old=before(file);new=Prefab(file)
        old_nodes,new_nodes=canonical(old),canonical(new)
        for path,o in old_nodes.items():
            if o.get('__type__')=='cc.Node':assert o['_name']==new_nodes[path]['_name']
            if o.get('__type__') in ['cc.Button','cc.Toggle']:
                for key in ['clickEvents','checkEvents','_N$checkMark','_N$target']:
                    assert o.get(key)==new_nodes[path].get(key),(file,path,key)
        if imports:
            uid=json.loads((ROOT/(file+'.meta')).read_text())['uuid']
            imported=json.loads((ROOT/'library/imports'/uid[:2]/(uid+'.json')).read_text())
            authored=json.loads(json.dumps(new.data));imported[0].pop('_name',None);authored[0].pop('_name',None)
            assert imported==authored,'Stale Creator Prefab: '+file
    old=before(ROW);new=Prefab(ROW)
    # The user saved card highlight positions in Creator during this task.
    # Preserve that saved version instead of reverting their concurrent edits.
    old.data=json.loads((OUT/'before/回顾对象2.user-saved.prefab').read_text())
    a,b=canonical(old),canonical(new)
    for path in ['手牌/牌组1','手牌/牌组2']:
        for key,value in a.items():
            if key=='/'+path or key.startswith('/'+path+'/') or key.startswith('/'+path+'#'):
                assert value==b[key],('Changed current poker layout',key)
    assert a['/手牌']==b['/手牌']
    assert not new.component(new.node('V7头像框'),'cc.Widget')[1]['_enabled']
    assert p.component(p.node('牌局回顾/V7回顾长背景'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
    assert (ROOT/'assets/scripts/UI/panelRecordInfo.ts').read_bytes()==(OUT/'before/panelRecordInfo.ts').read_bytes(),'Unexpected business script change'
    row=Prefab(TEXT_ROW)
    assert not row.component(row.root,'cc.Sprite')[1]['_enabled']
    assert row.data[row.node('V8操作分隔线')]['_contentSize']=={'__type__':'cc.Size','width':676,'height':2}
    badge=row.node('决策');sprite=row.component(badge,'cc.Sprite')[1]
    assert sprite['_type']==0 and sprite['_sizeMode']==2
    assert row.data[badge]['_contentSize']=={'__type__':'cc.Size','width':49,'height':36}
    if imports:
        names=['lobby_scene_long_v8.png','personal_info2_header_bg_v8.png','wallet_header_back_v8.png',
               'settlement_v8_list_panel.png','settlement_row_exact.png','wallet_v8_gold_button.png','review_avatar_ring_exact.png',
               *['money_v8_page_'+key+'.png' for key in ['first','prev','next','last','value']]]
        for name in names:
            uid=json.loads((ASSET_DIR/(name+'.meta')).read_text())['uuid']
            files=[ASSET_DIR/name,ROOT/'library/imports'/uid[:2]/(uid+'.png')]
            a,b=[np.asarray(Image.open(f).convert('RGBA')).astype(float)/255 for f in files]
            assert a.shape==b.shape,name
            a[:,:,:3]*=a[:,:,3,None];b[:,:,:3]*=b[:,:,3,None]
            assert abs(a-b).max()<.00001,'Stale Creator texture: '+name
    print('PASS: settlement isolated, current poker layout preserved, original events/business intact, transparent rows and native-ratio badges'+('; 3 Creator Prefabs and 12 shared textures match' if imports else ''))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--imports',action='store_true')
    validate(parser.parse_args().imports)
