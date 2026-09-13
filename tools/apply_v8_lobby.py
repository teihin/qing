#!/usr/bin/env python3
"""Write V8-new lobby coordinates into the existing formal Prefab."""
import copy,json,struct
from pathlib import Path
from apply_v7_prefab_skin import Prefab
from apply_v8_login import update_meta
from apply_v7_lobby_exact import untint, style_label, fill_parent
from repair_v7_responsive_layout import top,bottom,stretch

S=750/941
L='Main/发现'
R=L+'/房间列表/房间对象'

def art(p,path,asset,rect,parent=(0,0,941,1672),hide=False):
    n=p.node(path);x0,y0,x1,y1=rect;px0,py0,px1,py1=parent
    p.art(n,asset,(x0+x1-px0-px1)*S/2,(py0+py1-y0-y1)*S/2,(x1-x0)*S,(y1-y0)*S,hide=hide)
    p.disable(n,'cc.Widget');untint(p,n)
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    p.data[n]['_trs']['array'][7:10]=[1,1,1]
    return n

def at_top(p,path,rect):
    x0,y0,x1,y1=rect;top(p,path,y0*S,x=((x0+x1)/2-470.5)*S,width=(x1-x0)*S,height=(y1-y0)*S)

def main():
    cuts=json.loads(Path('tools/v8_lobby_crops.json').read_text())
    for cut in cuts:
        f=Path(cut['output'])
        if f.parent.name=='V7':update_meta(f.name)
        else:
            m=json.loads(Path(str(f)+'.meta').read_text());w,h=struct.unpack('>II',f.read_bytes()[16:24]);m.update(width=w,height=h,packable=False)
            for sm in m['subMetas'].values():sm.update(width=w,height=h,rawWidth=w,rawHeight=h,trimType='none',trimX=0,trimY=0,offsetX=0,offsetY=0)
            Path(str(f)+'.meta').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
    p=Prefab('assets/resources/UI/panelMain.prefab')
    # A single outpainted scene covers the whole viewport, including the
    # transparent crest at the top of the shared footer. No repeated tiles.
    root = p.node(L)
    p.disable(root, 'cc.Sprite')
    for name in ['V8大厅中下背景', 'V8大厅延展底纹']:
        try: p.set_active(p.node(L+'/'+name),False)
        except KeyError: pass
    try: scene = p.node(L+'/V8大厅完整背景')
    except KeyError: scene = p.clone_subtree(p.node(L+'/Title'),root,'V8大厅完整背景')
    p.hide_children(scene);p.set_active(scene,True)
    image_path=Path('assets/resources/V7/lobby_scene_long_v8.png')
    iw,ih=struct.unpack('>II',image_path.read_bytes()[16:24])
    update_meta(image_path.name)
    p.art(scene,image_path.name,0,0,750,ih*750/iw,hide=True)
    untint(p,scene)
    top(p,L+'/V8大厅完整背景',0,width=750,height=ih*750/iw)
    children=p.data[root]['_children']
    children[:]=[{'__id__':scene}]+[r for r in children if r['__id__']!=scene]
    for path,asset,rect in [(L+'/Title','lobby_header_exact.png',(0,0,941,77)),
                           (L+'/LOGO','lobby_shield_v8_exact.png',(321,121,600,436))]:
        art(p,path,asset,rect,hide=True);at_top(p,path,rect)
    for name,asset,rect in [('排行榜','lobby_ranking_exact.png',(29,466,310,563)),
                           ('比赛场','lobby_match_exact.png',(328,466,608,563)),
                           ('举报反馈','lobby_report_exact.png',(623,466,913,563)),
                           ('V8声音入口','transparent.png',(20,0,98,76))]:
        art(p,L+'/'+name,asset,rect,hide=True);at_top(p,L+'/'+name,rect)
    filt=(29,583,912,681)
    art(p,L+'/过滤','filter_bar_exact.png',filt);at_top(p,L+'/过滤',filt)
    for name,key,rect in [('全','all',(40,595,161,671)),('小','small',(170,595,281,671)),('中','middle',(281,595,395,671)),('大','large',(395,595,505,671))]:
        path=L+'/过滤/'+name
        # A normal-state gold label is kept beneath the selected pill.
        art(p,path+'/Background','v8_filter_all_normal.png' if name=='全' else 'transparent.png',rect,parent=rect,hide=True)
        art(p,path+'/checkmark','filter_'+key+'_exact_sel.png',rect,parent=rect,hide=True)
        n=p.node(path);x0,y0,x1,y1=rect;p.set_pos(n,(x0+x1-filt[0]-filt[2])*S/2,(filt[1]+filt[3]-y0-y1)*S/2,(x1-x0)*S,(y1-y0)*S,disable_widget=True)
        # Some legacy toggles draw Background after checkmark; the normal gold
        # glyph must remain underneath the selected dark lettering.
        bg=p.node(path+'/Background');mark=p.node(path+'/checkmark')
        children=p.data[n]['_children'];children[:]=[r for r in children if r['__id__'] not in (bg,mark)]+[{'__id__':bg},{'__id__':mark}]
    # The source all-selected pill is present only as a real Toggle checkmark.
    # Other normal labels remain in the approved filter panel.
    join=(527,594,710,671);art(p,L+'/过滤/加入房间','transparent.png',join,parent=filt,hide=True)
    free=L+'/过滤/空位条件';n=p.node(free);p.set_pos(n,(814-470.5)*S,0,175*S,76*S,disable_widget=True)
    n=p.node(free+'/有空位');p.set_pos(n,0,0,175*S,76*S,disable_widget=True)
    art(p,free+'/有空位/Background','transparent.png',(738,617,769,648),parent=(726.5,594,901.5,670),hide=True)
    art(p,free+'/有空位/checkmark','filter_check_exact.png',(738,617,769,648),parent=(726.5,594,901.5,670),hide=True)
    p.disable(p.node(L+'/房间列表'),'cc.Sprite');stretch(p,L+'/房间列表',694*S,135*S)
    fill_parent(p,L+'/房间列表/view',750,1334-829*S)
    room=p.node(R);p.set_pos(room,-770.654,295.158,883*S,133*S,disable_widget=True)
    art(p,R+'/房间底框','room_card_exact.png',(29,694,912,827),parent=(29,694,912,827))
    for name in ['大图标','V8静态信息']:p.set_active(p.node(R+'/'+name),False)
    specs=[('name',(207,714,704,767),48,0),('底皮',(279,777,313,815),34,1),('倒计时',(475,778,536,816),34,1),('时间',(609,778,705,816),32,1),('人数',(785,777,861,816),34,1)]
    for name,r,size,align in specs:
        x0,y0,x1,y1=r
        style_label(p,R+'/'+name,x=(x0+x1-941)*S/2,y=(1521-y0-y1)*S/2,width=(x1-x0)*S,height=(y1-y0)*S,size=round(size*S),align=align)
        n=p.node(R+'/'+name);p.disable(n,'cc.Widget');p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':238,'b':205,'a':255}
        _,c=p.component(n,'cc.Label');c['_enableWrapText']=False
    state=p.node(R+'/状态');p.set_pos(state,(821-470.5)*S,(760.5-736)*S,126*S,50*S,disable_widget=True)
    _,state_sprite=p.component(state,'cc.Sprite');state_sprite['_sizeMode']=0
    _,v=p.component(p.node(L+'/房间列表'),'55af2sKFClD1pPk4h4O5dyV');v.update(paddingTop=0,paddingBottom=2*S,spaceY=9*S)
    nav=(0,1519,941,1672);art(p,'Down','nav_bar_exact.png',nav);bottom(p,'Down',0,width=750,height=153*S)
    for name,x,w in [('客服',274,150),('公告',97,150),('发现',470.5,175),('钱包',667,150),('我的',837,150)]:
        path='Down/'+name;n=p.node(path);p.set_pos(n,(x-470.5)*S,-2*S,w*S,134*S,disable_widget=True)
        if name=='客服':p.sprite(n,'transparent.png')
        else:
            for suffix in ['Background','checkmark']:
                nn=p.node(path+'/'+suffix)
                p.set_pos(nn,0,0,w*S,134*S,disable_widget=True)
                if suffix=='Background' or name=='发现':p.sprite(nn,'transparent.png')
    # The selected "我的" state uses the same compact bottom-nav treatment
    # as the announcement page.  Keep the shared full navigation bar and
    # swap only this toggle's selected icon/underline; never replace the whole
    # footer with a page-specific artwork sheet.
    mine_mark=p.node('Down/我的/checkmark')
    _,mine_sprite=p.component(mine_mark,'cc.Sprite')
    notice_mark=p.node('Down/公告/checkmark')
    _,notice_sprite=p.component(notice_mark,'cc.Sprite')
    mine_sprite['_spriteFrame']=copy.deepcopy(notice_sprite['_spriteFrame'])
    size=p.data[notice_mark]['_contentSize']
    p.set_pos(mine_mark,0,0,size['width'],size['height'],disable_widget=True)
    # Bitmap-backed controls must not scale an invisible node while art stays put.
    for path in [L+'/排行榜',L+'/比赛场',L+'/举报反馈',L+'/V8声音入口',L+'/过滤/加入房间']:
        _,b=p.component(p.node(path),'cc.Button');b['_N$transition']=b['transition']=0
    p.save()
    # Server messages temporarily occupy the health-tip banner. An opaque
    # formal material avoids two unrelated strings rendering over one another.
    notice=Prefab('assets/resources/UI/panelCloudNotify.prefab')
    n=notice.node('msk');notice.sprite(n,'v8_notice_header.png');untint(notice,n)
    top(notice,'msk',0,width=750,height=77*S,stretch_x=True)
    txt=notice.node('txt');_,lab=notice.component(txt,'cc.Label')
    lab.update(_fontSize=28,_lineHeight=38,_enableWrapText=False)
    _,widget=notice.component(txt,'cc.Widget')
    widget.update(_enabled=True,_alignFlags=1,_top=10,_isAbsTop=True,alignMode=1)
    notice.save()

if __name__=='__main__':main()
