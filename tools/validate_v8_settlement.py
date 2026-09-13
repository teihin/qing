#!/usr/bin/env python3
"""Read-only source, alpha, binding, geometry and optional Creator import QA."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image
from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR, frame_uuid
from render_v8_wallet_recharge import render, nine
from render_v8_wallet_pages import samples
from apply_v8_settlement import PAGE, ROW, SOURCE, OUT, S


def validate(imports=False):
    cuts=json.loads((OUT/'cuts.json').read_text())
    assert cuts['source_sha256']==hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    for name,cut in cuts['assets'].items():
        file=ASSET_DIR/name;im=Image.open(file).convert('RGBA');a=np.asarray(im)
        assert list(im.size)==cut['size']
        assert hashlib.sha256(file.read_bytes()).hexdigest()==cut['sha256']
        meta=json.loads(Path(str(file)+'.meta').read_text());frame=meta['subMetas'][file.stem]
        assert frame['rawWidth']==im.width and frame['rawHeight']==im.height
        assert frame['trimType']=='none'
        if imports:
            uid=meta['uuid'];imported=ROOT/'library/imports'/uid[:2]/(uid+'.png')
            b=np.asarray(Image.open(imported).convert('RGBA'))
            assert a.shape==b.shape, name
            # Creator can dilate RGB outside alpha for filtering. Compare the
            # visible premultiplied pixels rather than ignored transparent RGB.
            a=a.astype(float)/255;b=b.astype(float)/255
            a[:,:,:3]*=a[:,:,3,None];b[:,:,:3]*=b[:,:,3,None]
            assert abs(a-b).max()<.00001, 'Creator still has older pixels: '+name
    a=np.asarray(Image.open(ASSET_DIR/'settlement_award_frames_exact.png'))
    for x,y in [(210,300),(511,265),(815,304),(100,400),(450,445)]:
        if y<427:assert a[y-86,x,3]==0,'baked avatar/scenery'
    p=Prefab(PAGE)
    assert p.component(p.node('bg'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
    assert not p.data[p.node('V8结算延展底纹')]['_active']
    assert not p.component(p.node('排行'),'cc.Sprite')[1]['_enabled']
    assert p.data[p.root]['_children'][-1]['__id__']==p.node('牌局回顾')
    # Keep existing component types, click handlers and queue animation UUID.
    original=json.loads(subprocess.check_output(['git','show','HEAD:'+PAGE]))
    for i,c in enumerate(original):
        if c.get('__type__')=='sp.Skeleton':assert p.data[i]['_N$skeletonData']==c['_N$skeletonData']
        if c.get('__type__')=='cc.Button':assert p.data[i]['clickEvents']==c['clickEvents']
        if c.get('__type__')=='cc.Node':assert p.data[i]['_name']==c['_name']
    r=Prefab(ROW)
    for name in ['名字','id','带入','手数','输赢']:assert r.component(r.node(name),'cc.Label')[1]['_enabled']
    if imports:
        for file, prefab in [(PAGE,p),(ROW,r)]:
            uid=json.loads((ROOT/(file+'.meta')).read_text())['uuid']
            imported=json.loads((ROOT/'library/imports'/uid[:2]/(uid+'.json')).read_text())
            authored=json.loads(json.dumps(prefab.data))
            # Creator supplies the Prefab resource name; every node/component
            # and resource reference must otherwise match the authored file.
            imported[0].pop('_name',None);authored[0].pop('_name',None)
            assert imported==authored,'Creator still has an older Prefab: '+file
    panel=Image.open(ASSET_DIR/'settlement_v8_list_panel.png').convert('RGBA')
    frame=json.loads((ASSET_DIR/'settlement_v8_list_panel.png.meta').read_text())['subMetas']['settlement_v8_list_panel']
    for h in [1125,1334,1624,1778,1860]:
        q=Prefab(PAGE)
        sample_rows=[['信贷黄经理','411973','100','38','-100'],['小虾米','541507','100','6','-100'],['冲死背时','282703','150','6','-150'],['文化人','379731','200','28','-161'],['速搏家','182771','200','20','-200'],['欢乐马123','531344','300','17','-300'],['猪脚饭','197310','300','46','-300']]
        samples(q,q.node('战绩列表/view/content'),ROW,[dict(zip(['名字','id','带入','手数','输赢'],[v[0],'ID:'+v[1],*v[2:]])) for v in sample_rows])
        for path,text in [('排行/土豪/name','体面'),('排行/MVP/name','五哥'),('排行/大鱼/name','欢乐马123'),('基本/房间名','房间号:594741'),('基本/时长','15:55'),('扩展/底皮','底皮:1/3'),('扩展/奖池','总奖池:168')]:q.component(q.node(path),'cc.Label')[1]['_string']=text
        _,boxes=render(h,q,'samples',OUT/'qa')
        box=lambda path:boxes['panelRecordInfo/'+path]
        queue,review=box('排行/排队'),box('title/牌局回顾')
        assert queue[2]+5<review[0] and abs((queue[1]+queue[3])-(review[1]+review[3]))<=3
        listing,ret=box('战绩列表'),box('关闭')
        assert listing[3]+15<ret[1] and ret[3]<h-40
        assert abs(listing[0]-30*S)<1
        scaled=np.asarray(nine(panel,(round(964*S),listing[3]-listing[1]),frame))
        # Pixel-grain bands amplified down the screen have strong second
        # derivatives; this panel's broad material stays below two RGB levels.
        inner=scaled[30:-30,30:-30,:3].astype(float)
        assert abs(np.diff(inner,n=2,axis=1)).max()<=2,'vertical striping'
    print('PASS: 11 component assets, alpha holes, original bindings and 5 screen heights'+('; Creator visible pixels match' if imports else ''))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--imports',action='store_true')
    validate(parser.parse_args().imports)
