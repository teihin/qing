#!/usr/bin/env python3
"""Serialize the V8 mine page; keep account fields and permission-driven grid."""
import base64,copy,json,uuid
from pathlib import Path
from apply_v7_prefab_skin import Prefab
from apply_v8_login import update_meta
from apply_v7_lobby_exact import untint,style_label
from repair_v7_responsive_layout import top

S=750/1023
M='Main/我的'
P=(55,457,968,897)

def place(p,path,rect,parent=P,asset=None):
    n=p.node(path);a,b,c,d=rect;e,f,g,h=parent
    p.set_pos(n,(a+c-e-g)*S/2,(f+h-b-d)*S/2,(c-a)*S,(d-b)*S,disable_widget=True)
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[n]['_trs']['array'][7:10]=[1,1,1]
    if asset:p.sprite(n,asset);untint(p,n)
    return n

def label(p,path,rect,size,preview=None):
    n=place(p,path,rect);nd=p.data[n]
    style_label(p,path,x=nd['_trs']['array'][0],y=nd['_trs']['array'][1],width=nd['_contentSize']['width'],height=nd['_contentSize']['height'],size=round(size*S),preview=preview)
    nd['_color']={'__type__':'cc.Color','r':250,'g':235,'b':205,'a':255}
    _,c=p.component(n,'cc.Label');c['_enableWrapText']=False

def unique_clone(p,source,parent,name):
    n=p.clone_subtree(source,parent,name)
    def fix(n):
        nd=p.data[n];ident=uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-mine/'+name+'/'+str(n))
        p.data[nd['_prefab']['__id__']]['fileId']=ident.hex[:2]+base64.b64encode(ident.bytes[1:]).decode()
        for r in nd.get('_children',[]):fix(r['__id__'])
    fix(n);return n

def main():
    for c in json.loads(Path('tools/v8_mine_crops.json').read_text()):update_meta(Path(c['output']).name)
    p=Prefab('assets/resources/UI/panelMain.prefab')
    # The approved mine artwork splits at y=459: hero/profile are fixed above,
    # while the 459..1371 field continues behind the action grid. Render that
    # slice in a dedicated top-anchored node instead of centering a short
    # bitmap on the 1334px root (which drops the lower half).
    root=p.node(M);p.disable(root,'cc.Sprite')
    try: lower=p.node(M+'/V8我的中下背景')
    except KeyError: lower=unique_clone(p,p.node(M+'/Title'),root,'V8我的中下背景')
    p.hide_children(lower);p.set_active(lower,True)
    p.art(lower,'mine_bg_exact.png',0,0,750,912*S,hide=True);untint(p,lower);p.disable(lower,'cc.Widget')
    top(p,M+'/V8我的中下背景',459*S,width=750,height=912*S)
    children=p.data[root].get('_children',[])
    try: extend=p.node(M+'/V8我的延展底纹')
    except KeyError: extend=unique_clone(p,lower,root,'V8我的延展底纹')
    p.hide_children(extend);p.set_active(extend,True)
    p.art(extend,'mine_floor_tile_v8.png',0,0,750,1100*S,hide=True);untint(p,extend);p.disable(extend,'cc.Widget')
    _,tile_sprite=p.component(extend,'cc.Sprite');tile_sprite['_type']=2;tile_sprite['_sizeMode']=0
    from repair_v7_responsive_layout import bottom
    bottom(p,M+'/V8我的延展底纹',153*S,width=750,height=1100*S)
    children[:]=[{'__id__':extend},{'__id__':lower}]+[r for r in children if r.get('__id__') not in (extend,lower)]
    hero=p.node(M+'/Title');p.art(hero,'mine_hero_exact.png',0,0,750,459*S,hide=True);untint(p,hero)
    top(p,M+'/Title',0,width=750,height=459*S)
    for container,asset in [('信息','mine_profile_exact.png'),('数据','transparent.png')]:
        path=M+'/'+container;n=p.node(path);p.sprite(n,asset);untint(p,n)
        top(p,path,457*S,width=913*S,height=440*S)
    avatar=M+'/信息/头像';place(p,avatar,(105,479,258,633),asset='transparent.png')
    place(p,avatar+'/mask',(110,486,252,626),parent=(105,479,258,633))
    place(p,avatar+'/mask/img',(110,486,252,626),parent=(110,486,252,626))
    # Portrait remains in the existing circular mask. Full ring is last so its
    # approved edge covers any antialiased square source pixels.
    try:ring=p.node(avatar+'/V8头像前框')
    except KeyError:ring=unique_clone(p,p.node(M+'/信息/复制ID'),p.node(avatar),'V8头像前框')
    p.hide_children(ring);p.disable(ring,'cc.Button');p.set_active(ring,True)
    place(p,avatar+'/V8头像前框',(105,479,258,633),parent=(105,479,258,633),asset='mine_avatar_ring_exact.png')
    for name,r,size in [('name',(282,500,413,553),39),('id',(736,510,850,554),34),('gold',(368,568,461,609),37)]:label(p,M+'/信息/'+name,r,size)
    place(p,M+'/信息/复制ID',(856,507,908,560),asset='transparent.png')
    fields=[('总手数',(187,665,225,706),33),('总胜率',(357,665,455,706),32),('获胜手数',(567,665,606,706),33),('平局手数',(730,665,767,706),33),('失败手数',(883,665,922,706),33)]
    for name,r,size in fields:label(p,M+'/数据/'+name,r,size)
    # These five dimensions have no existing server field binding. Render a
    # neutral empty-state value rather than bake the reference's sample zeros.
    for stake,x in [(1,170),(2,335),(5,502),(10,676),(20,847)]:
        name=f'V8{stake}皮手数';path=M+'/数据/'+name
        try:n=p.node(path)
        except KeyError:n=unique_clone(p,p.node(M+'/数据/总手数'),p.node(M+'/数据'),name)
        p.set_active(n,True);label(p,path,(x-39,748,x+39,801),44,'—')
    ops=p.node(M+'/操作');p.data[ops]['_anchorPoint']['y']=.5
    # Keep profile-to-actions spacing from the approved image. Extra phone
    # height belongs after the coherent body and before the bottom navigation.
    # One source pixel of tolerance avoids floating-point Grid row breaks.
    top(p,M+'/操作',912*S,width=956*S,height=441*S)
    specs=[('代理','mine_agent_exact.png',443,137),('推广二维码','mine_promotion_exact.png',454,137),('资金明细','mine_money_exact.png',443,138),('赠送','mine_gift_exact.png',454,138),('战绩','mine_record_exact.png',443,137),('设置','mine_settings_exact.png',454,137)]
    ids=[]
    for i,(name,asset,w,h) in enumerate(specs):
        n=p.node(M+'/操作/'+name);ids.append(n);p.art(n,asset,0,0,w*S,h*S,hide=True);untint(p,n);p.disable(n,'cc.Widget')
        p.set_active(n,name!='代理')
        _,b=p.component(n,'cc.Button');b['_N$transition']=b['transition']=0
    extra=[r for r in p.data[ops]['_children'] if r['__id__'] not in ids]
    for r in extra:p.set_active(r['__id__'],False)
    p.data[ops]['_children']=[{'__id__':n} for n in ids]+extra
    _,layout=p.component(ops,'cc.Layout');layout.update(_enabled=True,_resize=0)
    layout['_N$layoutType']=3;layout['_N$startAxis']=0;layout['_N$spacingX']=16*S;layout['_N$spacingY']=15*S
    layout['_N$paddingLeft']=layout['_N$paddingRight']=layout['_N$paddingTop']=layout['_N$paddingBottom']=0
    layout['_N$paddingLeft']=21*S
    # Author the default five-button positions as well as the native grid.
    visible=ids[1:];left=-914*S/2;topY=441*S/2
    for i,n in enumerate(visible):
        w=p.data[n]['_contentSize']['width'];h=p.data[n]['_contentSize']['height'];x=left+w/2
        if i%2:x=left+p.data[visible[i-1]]['_contentSize']['width']+16*S+w/2
        p.set_pos(n,x,topY-h/2-(i//2)*152*S)
    # Keep the shared navigation background when opening the mine page.
    # Only the selected mark changes, using the same treatment as notices.
    mark=p.node('Down/我的/checkmark');notice=p.node('Down/公告/checkmark')
    _,sprite=p.component(mark,'cc.Sprite');_,notice_sprite=p.component(notice,'cc.Sprite')
    sprite['_spriteFrame']=copy.deepcopy(notice_sprite['_spriteFrame'])
    size=p.data[notice]['_contentSize']
    p.set_pos(mark,0,0,size['width'],size['height'],disable_widget=True);untint(p,mark)
    p.save()

if __name__=='__main__':main()
