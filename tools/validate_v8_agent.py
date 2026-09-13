#!/usr/bin/env python3
"""Read-only V8 agent binding, import, slicing and portrait layout validation."""
import argparse,copy,json
from collections import Counter
import numpy as np
from PIL import Image
from apply_v7_prefab_skin import Prefab,ROOT,ASSET_DIR,frame_uuid
from apply_v8_agent import PAGE,OUT,LISTS,POPS,ROWS

def geometry(p,height):
    boxes={p.root:(0,0,750,height)}
    def visit(n):
        o=p.data[n];par=boxes[o['_parent']['__id__']];px,py,pw,ph=par;x,y=o['_trs']['array'][:2]
        w,h=o['_contentSize']['width'],o['_contentSize']['height'];ax,ay=o['_anchorPoint']['x'],o['_anchorPoint']['y']
        g=p.component(n,'cc.Widget')[1]
        if g and g['_enabled']:
            f=g['_alignFlags']
            if f&8 and f&32:w=pw-g['_left']-g['_right'];x=-pw/2+g['_left']+w*ax
            elif f&16:x=g['_horizontalCenter']
            if f&1 and f&4:h=ph-g['_top']-g['_bottom'];y=ph/2-g['_top']-h*(1-ay)
            elif f&1:y=ph/2-g['_top']-h*(1-ay)
            elif f&4:y=-ph/2+g['_bottom']+h*ay
            elif f&2:y=g['_verticalCenter']
        boxes[n]=(px+x,py+y,w,h)
        for r in o['_children']:visit(r['__id__'])
    for r in p.data[p.root]['_children']:visit(r['__id__'])
    return boxes

def run(imports=False):
    files=[PAGE]+['assets/resources/Prefabs/'+r+'.prefab' for r in ROWS]
    for f in files:
        p=Prefab(f);old=json.loads((OUT/'before'/p.path.name).read_text())
        for i,o in enumerate(old):
            if o.get('__type__')=='cc.Node':
                assert p.data[i]['_name']==o['_name'],('renamed business node',f,i)
                assert p.data[i]['_parent']==o['_parent'],('reparented business node',f,i)
            if o.get('__type__')=='cc.Button' or 'checkEvents' in o:
                assert p.data[i]==o,('modified original events',f,i)
            if o.get('__type__')=='cc.EditBox':
                now=copy.deepcopy(p.data[i]);now.pop('_N$placeholder',None)
                assert now==o,('modified input contract',f,i)
        before=Counter(o['fileId'] for o in old if o.get('__type__')=='cc.PrefabInfo')
        after=Counter(o['fileId'] for o in p.data if o.get('__type__')=='cc.PrefabInfo')
        assert all(n<=max(1,before[k]) for k,n in after.items()),('duplicate new PrefabInfo',f)
        for o in p.data:
            if o.get('__type__')=='cc.Label' and o['_enabled']:
                assert o['_N$overflow']==o['_overflow']==1
                if '_N$string' in o:assert o['_N$string']==o['_string']
        if imports:
            uid=json.loads((ROOT/(f+'.meta')).read_text())['uuid']
            imported=json.loads((ROOT/'library/imports'/uid[:2]/(uid+'.json')).read_text())
            authored=copy.deepcopy(p.data);authored[0].pop('_name',None);imported[0].pop('_name',None)
            assert authored==imported,('stale imported Prefab',f)
    p=Prefab(PAGE)
    for page in ['panelHongli']+['panelHongli/'+n for n,i in LISTS]:
        c=p.component(p.node(page+'/V8大厅背景'),'cc.Sprite')[1]
        assert c['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
    for o in p.data:
        if o.get('__type__')=='cc.Node' and '母版' in o.get('_name',''):
            assert not o['_active']
            c=p.component(p.data.index(o),'cc.Sprite')[1]
            if c:assert c['_spriteFrame'] is None and not c['_enabled']
    for height in [1334,1500,1624,1778,1860]:
        b=geometry(p,height)
        for name,index in LISTS:
            x,y,w,h=b[p.node(name+'/列表')];px,py,pw,ph=b[p.node(name+'/分页')]
            assert h>730 and y-h/2>py+ph/2,('pager overlaps scroll area',name,height)
            assert py-ph/2>=-height/2,('pager outside screen',name,height)
            for target in ['title/关闭上上层','分页/首页','分页/上一页','分页/下一页','分页/尾页']:
                tx,ty,tw,th=b[p.node(name+'/'+target)]
                assert abs(tx)+tw/2<=375.1 and abs(ty)+th/2<=height/2+.1,(name,target,height)
        for name,key in POPS:
            x,y,w,h=b[p.node(name+'/bk')];assert (x,y)==(0,0) and w<=600 and h<650,(name,height)
        for parent in ['总业绩/标题','添加盟主面板/bk','修改盟主面板/bk']:
            input=parent+('/用户ID' if parent.startswith('总业绩') else '/比例');x,y,w,h=b[p.node(input)]
            assert abs(x)+w/2<375 and abs(y)+h/2<height/2
    assert not p.data[p.node('推广二维码')]['_active'], 'duplicate promotion must stay retired'
    actions=p.node('操作');layout=p.component(actions,'cc.Layout')[1]
    assert layout['_enabled'] and layout['_N$layoutType']==3 and layout['_N$startAxis']==0
    ordered=['我的玩家','我的业绩','我的盟主','提取记录','推广','总业绩']
    assert [p.data[r['__id__']]['_name'] for r in p.data[actions]['_children'][:6]]==ordered
    assert p.data[actions]['_contentSize']['height']==194
    for name in ordered:
        n=p.node('操作/'+name);assert p.data[n]['_contentSize']=={'__type__':'cc.Size','width':204,'height':88}
        child=p.node('操作/'+name+'/V8按钮美术');assert p.component(child,'cc.Sprite')[1]['_enabled']
    fm=json.loads((ASSET_DIR/'agent_v8_digits.fnt.meta').read_text())
    font=(ASSET_DIR/'agent_v8_digits.fnt').read_text()
    for char in '0123456789,.%—':assert ('char id='+str(ord(char))+' ') in font
    if imports:
        imp=json.loads((ROOT/'library/imports'/fm['uuid'][:2]/(fm['uuid']+'.json')).read_text())
        assert any(o.get('__type__')=='cc.BitmapFont' for o in (imp if isinstance(imp,list) else [imp]))
    cuts=json.loads((OUT/'cuts.json').read_text());names=set(cuts)|{'agent_v8_solid.png','agent_v8_digits.png'}
    for name in names:
        im=Image.open(ASSET_DIR/name).convert('RGBA');meta=json.loads((ASSET_DIR/(name+'.meta')).read_text());frame=next(iter(meta['subMetas'].values()))
        assert meta['filterMode']=='bilinear' and not meta['genMipmaps']
        if frame['borderTop']:
            from render_v8_wallet_recharge import nine
            out=nine(im,(im.width+310,im.height+613),frame);border=frame['borderTop']
            # Nine-slice leaves the complete antialiased corner caps unchanged.
            for right in [False,True]:
                for bottom in [False,True]:
                    a=(im.width-border if right else 0,im.height-border if bottom else 0)
                    z=(out.width-border if right else 0,out.height-border if bottom else 0)
                    assert np.array_equal(np.array(im.crop((*a,a[0]+border,a[1]+border))),np.array(out.crop((*z,z[0]+border,z[1]+border)))),name
        if imports:
            u=meta['uuid'];im2=Image.open(ROOT/'library/imports'/u[:2]/(u+'.png')).convert('RGBA')
            assert np.array_equal(np.array(im),np.array(im2)),('stale texture',name)
    print('PASS: original node/event/input contracts; 18 agent views at five heights; promotion uses the main page; unchanged antialiased corner cells; '+str(len(names))+' textures'+('; six Prefabs and textures match Creator imports' if imports else ''))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--imports',action='store_true');run(ap.parse_args().imports)
