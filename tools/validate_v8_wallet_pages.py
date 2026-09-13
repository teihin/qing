#!/usr/bin/env python3
"""Read-only formal-resource/contracts checks plus offline layout evidence."""
import json
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image
from apply_v7_prefab_skin import Prefab, frame_uuid
from render_v8_wallet_pages import prepare, OUT
from render_v8_wallet_recharge import render

ROOT=Path(__file__).resolve().parents[1]


def main():
    manifest=json.loads((ROOT/'art_sources/v8-repairs/wallet-pages/cuts.json').read_text())
    for name,data in manifest.items():
        f=ROOT/'assets/resources/V7'/name
        assert hashlib.sha256(f.read_bytes()).hexdigest()==data['sha256'],name
        im=Image.open(f).convert('RGBA');meta=json.loads(Path(str(f)+'.meta').read_text())
        fr=next(iter(meta['subMetas'].values()))
        assert (fr['width'],fr['height'])==im.size and fr['trimType']=='none',name
        if data['kind'] in ['crop','foreground','contour']:
            ref=np.asarray(Image.open(ROOT/data['source']).convert('RGBA').crop(data['box']))
            a=np.asarray(im);assert a.shape==ref.shape,name
            assert np.array_equal(a[:,:,:3][a[:,:,3]>0],ref[:,:,:3][a[:,:,3]>0]),name
    # Existing real input bindings, password modes, lengths and event targets stay intact.
    p=Prefab('assets/resources/Prefabs/钱包.prefab')
    before=json.loads((ROOT/'art_sources/v8-repairs/wallet-pages/before/钱包.prefab').read_text())
    input_count=0
    for i,c in enumerate(before):
        if c.get('__type__')=='cc.EditBox':
            now=p.data[i];assert now['__type__']==c['__type__']
            for key in ['node','maxLength','_N$inputFlag','_N$inputMode','_N$textLabel','_N$placeholderLabel',
                        'editingDidBegan','textChanged','editingDidEnded','editingReturn']:
                assert now.get(key)==c.get(key),(i,key)
            input_count+=1
        if c.get('__type__')=='cc.Button':
            now=p.data[i]
            assert now['node']==c['node'] and now.get('clickEvents')==c.get('clickEvents'),i
    for path in ['钱包/bk','钱包/实名/bk','钱包/订单详情/bk']:
        sp=p.component(p.node(path),'cc.Sprite')[1]
        assert sp['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png') and sp['_type']==0,path
    mainp=Prefab('assets/resources/UI/panelMain.prefab')
    assert mainp.component(mainp.node('资金明细/V7金币流向母版'),'cc.Sprite')[1]['_spriteFrame']['__uuid__']==frame_uuid('lobby_scene_long_v8.png')
    for key in ['charged','given','withdrawn']:
        assert not mainp.data[mainp.node('资金明细/V8资金概况/累计_'+key)]['_active']
        assert not mainp.data[mainp.node('资金明细/V8资金概况/V8标题_'+key)]['_active']

    cases=0
    for page in ['withdraw','record','realname','money']:
        for h in [1334,1500,1624,1778,1860]:
            pp=prepare(page);_,boxes=render(h,pp,page,OUT)
            prefix=pp.data[pp.root]['_name']
            if page=='withdraw':
                root='钱包/容器/提现';names=['余额','类型选择','提现选项/金额','提现选项/姓名',
                    '提现选项/银行','提现选项/卡号','提现选项/密码','提现选项/提现文本','提现选项/申请提现']
                for a,b in zip(names,names[1:]):assert boxes[root+'/'+a][3]<=boxes[root+'/'+b][1],(page,h,a,b)
                assert boxes[root+'/提现选项/申请提现'][3]<h
            if page in ['record','money']:
                root='钱包/容器/记录' if page=='record' else prefix+'/资金明细'
                listing='列表' if page=='record' else '资金明细列表'
                header=boxes[root+'/标题'];view=boxes[root+'/'+listing+'/view'];pager=boxes[root+'/分页']
                # Coin header extends 6 logical pixels behind the rounded list
                # corner; only its blank blue material overlaps the viewport.
                assert header[3]<=(view[1]+(8 if page=='money' else 0)) and view[3]<=pager[1] and pager[3]<h,(page,h)
                content=pp.node(('钱包/容器/记录' if page=='record' else '资金明细')+'/'+listing+'/view/content')
                widget=pp.component(content,'cc.Widget')[1]
                assert widget['alignMode']==1 and not widget['_alignFlags']&4,(page,'content must scroll independently')
            if page=='realname':
                root='钱包/实名/信息';names=['钱包-实名认证','V7实名主标题','V7实名副标题','姓名','银行','卡号','交易密码','确认密码','提交实名信息','V7实名重要提示']
                for a,b in zip(names,names[1:]):assert boxes[root+'/'+a][3]<=boxes[root+'/'+b][1],(page,h,a,b)
                assert boxes[root+'/V7实名重要提示'][3]<h
            for path,rect in boxes.items():
                if path.endswith('/bk') or path.endswith('/V7金币流向母版'):
                    if rect[0]==0 and rect[2]==750:assert rect[3]>=h,(page,h,path)
            cases+=1
    print(f'PASS: {len(manifest)} V8 component assets; {input_count} preserved EditBox contracts; 20 page/phone layouts; independent masked lists; shared scene; no fabricated totals. Creator not launched.')


if __name__=='__main__':main()
