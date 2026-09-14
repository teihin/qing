#!/usr/bin/env python3
"""Read-only source, component, clipping and aspect checks for the V8 leaderboard."""
import json,hashlib
from pathlib import Path
from PIL import Image
from apply_v7_prefab_skin import ROOT,ASSET_DIR,Prefab,frame_uuid
from apply_v8_leaderboard import script_id,NAMES
p=Prefab('assets/resources/Prefabs/排行榜.prefab');r='排行榜'
assert not p.data[p.node(r+'/V7排行榜母版')]['_active']
assert p.component(p.node(r+'/V8大厅背景'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
for parent,expected in [(r+'/条件',[n for n,_ in NAMES]),(r+'/容器/玩家手数榜/选择手数',['1皮','2皮','5皮','10皮','20皮'])]:
    nodes=[p.data[c['__id__']] for c in p.data[p.node(parent)]['_children'] if p.data[c['__id__']]['_active']]
    assert [n['_name'] for n in nodes]==expected
    checked=[]
    for n in nodes:
        path=parent+'/'+n['_name'];children=[p.data[c['__id__']]['_name'] for c in n['_children']]
        assert children.index('checkmark')>children.index('Background')
        toggle=p.component(p.node(path),'cc.Toggle')[1];checked.append(toggle['_N$isChecked'])
        assert p.data[p.node(path+'/checkmark')]['_active']==toggle['_N$isChecked']
    assert checked==[True]+[False]*(len(checked)-1)
for name,key in NAMES:
    g=r+'/容器/'+name
    assert bool(p.data[p.node(g)]['_active'])==(key=='hands')
    list_node=p.node(g+'/列表');assert p.component(list_node,script_id('LeaderboardScrollView'))[1]['_enabled']
    assert not p.component(list_node,'55af2sKFClD1pPk4h4O5dyV')[1]
    content=p.node(g+'/列表/view/content');assert p.component(content,'cc.Layout')[1]['_enabled']
    assert p.data[content]['_anchorPoint']=={'__type__':'cc.Vec2','x':.5,'y':1}
    assert not p.data[p.node(g+'/分页')]['_active']
    assert not p.component(p.node(g+'/分页'),script_id('PageEx'))[1]
    for height in [1180,1280,1334,1624,1800]:
        w=p.component(list_node,'cc.Widget')[1]
        assert height-w['_top']-w['_bottom']>400
        panel=p.component(p.node(g+'/V8表格底框'),'cc.Widget')[1]
        assert panel['_bottom']==28 and w['_bottom']==42
        assert w['_bottom']-panel['_bottom']==14
# All active source components are independent assets, with complete alpha corners.
manifest=json.loads((ROOT/'art_sources/v8-repairs/leaderboard/cuts.json').read_text())
for name,info in manifest.items():
    f=ASSET_DIR/name
    assert hashlib.sha256(f.read_bytes()).hexdigest()==info['sha256']
    with Image.open(f) as im:im.verify()
    assert info['source'].startswith('design-previews/效果图V8-new/')
for key in ['hero','list','pager','filter_on','filter_off','page_value']:
    im=Image.open(ASSET_DIR/('leaderboard_v8_'+key+'.png')).convert('RGBA')
    assert all(im.getpixel((x,y))[3]<10 for x,y in [(0,0),(im.width-1,0),(0,im.height-1),(im.width-1,im.height-1)])
# Detached glyphs and shields must not be nine-sliced or warped.
for o in p.data:
    if o.get('__type__')=='cc.Node' and (o.get('_name','').startswith('V8皇冠') or o.get('_name')=='V8盾牌'):
        c=p.component(p.data.index(o),'cc.Sprite')[1];assert c['_type']==0
        f=next(name for name in manifest if frame_uuid(name)==c['_spriteFrame']['__uuid__'])
        im=Image.open(ASSET_DIR/f);size=o['_contentSize'];assert abs(size['width']/size['height']-im.width/im.height)<.01
print('PASS formal components, selected layers, five portrait heights, expanded infinite list without pager, source hashes and antialiased asset corners; no files rewritten.')
