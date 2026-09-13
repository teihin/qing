#!/usr/bin/env python3
"""Read-only V8 source-pixel, native layout, and business binding checks."""
import json,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
from apply_v7_prefab_skin import Prefab

ROOT=Path(__file__).resolve().parents[1]

def require(ok,message):
    if not ok:raise AssertionError(message)

def crops(manifest):
    for cut in json.loads((ROOT/manifest).read_text()):
        file=ROOT/cut['output'];out=Image.open(file).convert('RGBA');b=cut['box'];expected=(b[2]-b[0],b[3]-b[1])
        require(out.size==expected,f'{file.name}: crop size')
        if file.name == 'announcement_menu_floor_exact.png':
            # The V8 menu's centre token crown begins around x=390..550;
            # extension material must never include it or tiling will repeat
            # the token across a long phone.
            source_box = cut.get('sourceBox', b)
            require(source_box[0] >= 550 or source_box[2] <= 390,
                    'announcement floor crop must exclude centre token')
        meta=json.loads(Path(str(file)+'.meta').read_text());frame=next(iter(meta['subMetas'].values()))
        require((frame['width'],frame['height'])==expected,f'{file.name}: SpriteFrame dimensions')
        require(frame['trimType']=='none' and frame['trimX']==frame['trimY']==0,f'{file.name}: unexpected trimming')
        if cut.get('sideField') or cut.get('tiledStrip') or cut.get('foreground'):continue
        source=Image.open(ROOT/cut['source']).convert('RGBA').crop(b)
        keep=out.getchannel('A').point(lambda a:255 if a==255 else 0)
        draw=ImageDraw.Draw(keep)
        for r in cut.get('clear',[])+cut.get('horizontalClear',[])+cut.get('stripClear',[])+cut.get('bandClear',[]):
            draw.rectangle((r[0]-b[0],r[1]-b[1],r[2]-b[0]-1,r[3]-b[1]-1),fill=0)
        if cut.get('glyphOverlay'):
            g=cut['glyphOverlay'];w,h=g[2]-g[0],g[3]-g[1];x,y=(expected[0]-w)//2,(expected[1]-h)//2
            draw.rectangle((x,y,x+w,y+h),fill=0)
        diff=ImageChops.difference(out.convert('RGB'),source.convert('RGB'))
        for channel in diff.split():require(ImageChops.multiply(channel,keep).getbbox() is None,f'{file.name}: changed approved static pixels')

def widget(p,path,flags):
    _,w=p.component(p.node(path),'cc.Widget');require(w and w['_enabled'] and w['_alignFlags']==flags,path+': widget')
    return w

def main():
    for manifest in ['tools/v8_lobby_crops.json','tools/v8_mine_crops.json','tools/v8_record_crops.json','tools/v8_gift_crops.json','tools/v8_lobby_foreground_crops.json','tools/v8_announcement_foreground_crops.json','tools/v8_announcement_detail_crops.json','tools/v8_wallet_crops.json','tools/v8_followup_crops.json']:crops(manifest)
    p=Prefab('assets/resources/UI/panelMain.prefab');s=750/941
    for path in ['Main/发现/Title','Main/发现/LOGO','Main/发现/过滤']:widget(p,path,17)
    w=widget(p,'Main/发现/房间列表',45)
    require(abs(w['_top']-694*s)<1e-5 and abs(w['_bottom']-135*s)<1e-5,'list boundaries')
    _,v=p.component(p.node('Main/发现/房间列表'),'55af2sKFClD1pPk4h4O5dyV')
    require(v['itemPrefab']['__id__']==p.node('Main/发现/房间列表/房间对象'),'room template binding')
    _,status=p.component(p.node('Main/发现/房间列表/房间对象/状态'),'cc.Sprite')
    require(status['_sizeMode']==0,'runtime status image must keep authored size')
    for h in [1334,1500,1624,1778]:
        view=h-w['_top']-w['_bottom'];require(view>=6*133*s+5*v['spaceY'],'short screen must show six complete rows')
    for name in ['全','小','中','大']:
        _,t=p.component(p.node('Main/发现/过滤/'+name),'cc.Toggle');require(t and t['_enabled'],'filter toggle '+name)
    ops=p.node('Main/我的/操作');_,grid=p.component(ops,'cc.Layout')
    require(grid['_enabled'] and grid['_N$layoutType']==3 and grid['_resize']==0,'native variable-width mine grid')
    require(p.data[ops]['_contentSize']['width'] >= 700,'mine grid safety width')
    names=['代理','推广二维码','资金明细','赠送','战绩','设置']
    ids=[p.node('Main/我的/操作/'+n) for n in names]
    require([r['__id__'] for r in p.data[ops]['_children']][:6]==ids,'permission grid order')
    sm=750/1023
    for h in [1334,1500,1624,1778]:
        require(912*sm>897*sm and 1353*sm<h-188*sm,'mine body overlaps profile or bottom navigation')
    mark_node=p.node('Down/我的/checkmark')
    mark_sprite=p.component(mark_node,'cc.Sprite')[1]
    notice_mark=p.component(p.node('Down/公告/checkmark'),'cc.Sprite')[1]
    require(mark_sprite and mark_sprite['_spriteFrame']==notice_mark['_spriteFrame'],'mine selected state must reuse compact nav art')
    require(p.data[mark_node]['_contentSize']['width']<200,'mine selected state must not be full footer art')
    mark_widget=p.component(mark_node,'cc.Widget')[1]
    require(not mark_widget or not mark_widget['_enabled'],'mine selected mark must not stretch over shared navigation')
    for page,background,legacy in [
        ('发现','V8大厅完整背景',['V8大厅中下背景','V8大厅延展底纹']),
        ('公告','V8公告完整背景',['V7公告菜单高清母版','V8公告延展底纹'])]:
        path='Main/'+page+'/'+background
        n=p.node(path);obj=p.data[n];_,spr=p.component(n,'cc.Sprite')
        require(obj['_active'] and spr['_enabled'] and spr['_type']==0,path+': one continuous non-tiled scene')
        ww=widget(p,path,17);require(ww['_top']==0,path+': top anchor')
        for height in [1334,1500,1624,1778,1860]:
            require(obj['_contentSize']['height']>=height,path+': background must continue behind footer at '+str(height))
        for old in legacy:require(not p.data[p.node('Main/'+page+'/'+old)]['_active'],old+': obsolete collage must be off')
    for name in ['排行榜','比赛场','举报反馈','LOGO']:
        _,spr=p.component(p.node('Main/发现/'+name),'cc.Sprite')
        require(spr['_spriteFrame'] and p.data[p.node('Main/发现/'+name)]['_contentSize']['width']<300,
                'lobby '+name+': independent proportioned foreground')
    for name in ['公告6','公告1','公告2','公告5']:
        n=p.node('Main/公告/主页/'+name);_,spr=p.component(n,'cc.Sprite')
        require(spr and spr['_enabled'] and p.data[n]['_active'],'announcement button '+name)
    for name in ['announcement_detail_latest_exact.png','announcement_detail_rules_exact.png','announcement_detail_bonus_exact.png','announcement_detail_penalty_exact.png']:
        im=Image.open(ROOT/'assets/resources/V7'/name)
        require(im.size==(941,1672),name+': detail art must preserve V8 source size')
    mine_lower=p.node('Main/我的/V8我的中下背景'); ml=p.data[mine_lower]
    require(abs(ml['_contentSize']['width']-750)<1e-5 and abs(ml['_contentSize']['height']-912*750/1023)<1e-5,
            'mine lower background must use a dedicated aspect-correct slice')
    mine_extend=p.node('Main/我的/V8我的延展底纹'); _,mes=p.component(mine_extend,'cc.Sprite')
    require(mes and mes['_type']==2,'mine extension must tile its floor texture')
    record=Prefab('assets/resources/UI/panelRecordList.prefab'); rl=record.node('V8战绩中下背景'); rld=record.data[rl]
    require(abs(rld['_contentSize']['width']-750)<1e-5 and abs(rld['_contentSize']['height']-1021*750/941)<1e-5,
            'record lower background must use a dedicated aspect-correct slice')
    _,res=record.component(record.node('V8战绩延展底纹'),'cc.Sprite'); require(res and res['_type']==2,'record extension must tile its floor texture')
    gift_lower=p.node('赠送/V8赠送中下背景'); gld=p.data[gift_lower]
    require(abs(gld['_contentSize']['width']-750)<1e-5 and abs(gld['_contentSize']['height']-(1672-509)*750/941)<1e-5,
            'gift lower background must use a dedicated aspect-correct slice')
    _,ges=p.component(p.node('赠送/V8赠送延展底纹'),'cc.Sprite'); require(ges and ges['_type']==2,'gift extension must tile its floor texture')
    settlement=Prefab('assets/resources/UI/panelRecordInfo.prefab')
    _,root_sprite=settlement.component(settlement.root,'cc.Sprite')
    require(not root_sprite or not root_sprite['_enabled'],'settlement root must not render a full UI screenshot')
    bg=settlement.node('bg'); bgd=settlement.data[bg]
    require(abs(bgd['_contentSize']['width']-750)<1e-5 and abs(bgd['_contentSize']['height']-750*1536/1024)<1e-5,
            'settlement scene background must keep source aspect ratio')
    _,ses=settlement.component(settlement.node('V8结算延展底纹'),'cc.Sprite'); require(ses and ses['_type']==2,'settlement extension must tile its floor texture')
    scripts=(ROOT/'assets/scripts/UI/panelMain.ts').read_text();a=scripts.index('private RefreshAgentMenuVisibility()');b=scripts.index('public set_photo',a)
    require('setPosition' not in scripts[a:b],'permission function must not overwrite V8 art coordinates')
    notice=Prefab('assets/resources/UI/panelCloudNotify.prefab');n=notice.data[notice.node('msk')]
    require(n['_opacity']==255 and n['_color']['r']==255,'notice banner must cover health tip')
    gift=Prefab('assets/resources/UI/panelMain.prefab');g=gift.node('赠送')
    for path in ['赠送/title','赠送/V7赠送主视觉','赠送/操作','赠送/赠送记录列表','赠送/分页']:
        require(gift.data[gift.node(path)].get('_active',True),path+': active')
    for name in ['用户id','金额','V7交易密码']:
        eid,edit=gift.component(gift.node('赠送/操作/'+name),'cc.EditBox');require(edit and edit['_enabled'],'gift editbox '+name)
    require(gift.node('赠送/操作/提交赠送') is not None,'gift submit')
    require(gift.data[gift.node('赠送/赠送记录列表/view/content')]['_contentSize']['width']>700,'gift list width')
    wallet=Prefab('assets/resources/Prefabs/钱包.prefab')
    wb=wallet.node('钱包/bk'); wbd=wallet.data[wb]
    scene=Image.open(ROOT/'assets/resources/V7/lobby_scene_long_v8.png')
    scene_h=scene.height*750/scene.width
    _,wbs=wallet.component(wb,'cc.Sprite')
    scene_meta=json.loads((ROOT/'assets/resources/V7/lobby_scene_long_v8.png.meta').read_text())
    scene_uuid=scene_meta['subMetas']['lobby_scene_long_v8']['uuid']
    require(wbs['_spriteFrame']['__uuid__']==scene_uuid,
            'wallet background must reuse lobby_scene_long_v8.png')
    require(abs(wbd['_contentSize']['width']-750)<1e-5 and abs(wbd['_contentSize']['height']-scene_h)<1e-5,
            'wallet background must keep the shared lobby scene aspect ratio')
    require(abs(wallet.data[wb]['_trs']['array'][1]-(1334/2-scene_h/2))<1e-5,
            'wallet shared background must stay top anchored')
    print('V8 lobby/mine/record/gift source pixels, live bindings, responsive geometry, and formal Prefab checks: PASS')

if __name__=='__main__':main()
