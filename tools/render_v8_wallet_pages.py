#!/usr/bin/env python3
"""Offline compositions from the formal Prefabs. No Creator or network use."""
import copy
from pathlib import Path
from apply_v7_prefab_skin import Prefab
from render_v8_wallet_recharge import render

OUT=Path(__file__).resolve().parents[1]/'art_sources/v8-repairs/wallet-pages/qa'


def samples(p,parent,path,rows):
    sample=Prefab(path)
    for j,data in enumerate(rows):
        offset=len(p.data)
        def remap(value):
            if isinstance(value,dict):
                if set(value)=={'__id__'}:return {'__id__':value['__id__']+offset}
                return {k:remap(v) for k,v in value.items()}
            if isinstance(value,list):return [remap(v) for v in value]
            return value
        p.data.extend(remap(sample.data));n=offset+sample.root;p.data[n]['_parent']={'__id__':parent}
        p.data[parent]['_children'].append({'__id__':n});p.data[n]['_name']=f'qa-row-{j}'
        _,layout=p.component(parent,'cc.Layout');spacing=layout['_N$spacingY'];h=p.data[n]['_contentSize']['height']
        p.data[n]['_trs']['array'][0:2]=[0,-h/2-j*(h+spacing)]
        for name,text in data.items():
            i=sample.node(name)+offset
            if isinstance(text,bool):p.data[i]['_active']=text;continue
            c=p.component(i,'cc.Label')[1];c['_string']=c['_N$string']=text


def prepare(page):
    if page=='money':
        p=Prefab('assets/resources/UI/panelMain.prefab')
        for ref in p.data[p.root]['_children']:
            p.data[ref['__id__']]['_active']=p.data[ref['__id__']]['_name']=='资金明细'
        samples(p,p.node('资金明细/资金明细列表/view/content'),'assets/resources/Prefabs/资金明细对象.prefab',[
            {'time':'08/17 22:31','type':'充值','count':'+1000','now':'5,320','V8类型图标_in':True},
            {'time':'08/16 19:42','type':'游戏输赢','count':'-300','now':'4,320','V8类型图标_game':True},
            {'time':'08/14 15:08','type':'赠送','count':'-88','now':'4,620','V8类型图标_gift':True},
            {'time':'08/12 11:20','type':'提现','count':'-500','now':'4,708','V8类型图标_out':True}])
        return p
    p=Prefab('assets/resources/Prefabs/钱包.prefab')
    for ref in p.data[p.root]['_children']:
        n=p.data[ref['__id__']];n['_active']=n['_name'] in ({'realname':['实名'],'order':['订单详情'],'bank':['选择银行']}.get(page,['bk','Title','选项','容器']))
    if page not in ['realname','order','bank']:
        tab='记录' if page=='record' else '提现'
        for ref in p.data[p.node('钱包/容器')]['_children']:p.data[ref['__id__']]['_active']=p.data[ref['__id__']]['_name']==tab
        for name in ['充值','提现','记录']:p.set_active(p.node('钱包/选项/'+name+'/checkmark'),name==tab)
    if page=='record':
        samples(p,p.node('钱包/容器/记录/列表/view/content'),'assets/resources/Prefabs/交易查询对象.prefab',[
            {'type':'充值','count':'+500.00','time':'09/04 18:26','状态文字':'已完成'},
            {'type':'提现','count':'-200.00','time':'09/03 14:10','状态文字':'审核中','V7充值图标':False,'V7提现图标':True},
            {'type':'充值','count':'+1,000.00','time':'09/01 20:45','状态文字':'已完成'},
            {'type':'提现','count':'-500.00','time':'08/29 11:08','状态文字':'已完成','V7充值图标':False,'V7提现图标':True},
            {'type':'充值','count':'+100.00','time':'08/27 09:32','状态文字':'未完成'}])
    return p


if __name__=='__main__':
    for page in ['withdraw','record','realname','money']:
        for h in [1334,1624,1778]:render(h,prepare(page),page,OUT)
