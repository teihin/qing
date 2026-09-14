#!/usr/bin/env python3
"""Author the leaderboard's approved V8 components in its formal prefabs."""
import copy,json,uuid
from PIL import Image
from apply_v7_prefab_skin import Prefab,ROOT,ASSET_DIR
from apply_v8_agent import new,loc,group,label,clear
from apply_v8_settings import pin
from repair_v7_responsive_layout import ensure_widget

S=750/941
OUT=ROOT/'art_sources/v8-repairs/leaderboard'
PAGE='assets/resources/Prefabs/排行榜.prefab'
ROW='assets/resources/Prefabs/排行榜对象.prefab'
NAMES=[('玩家手数榜','hands'),('玩家赢分榜','win'),('代理红利榜','agent')]

def script_id(name):
    u=json.loads((ROOT/('assets/scripts/common/'+name+'.ts.meta')).read_text())['uuid'].replace('-','')
    chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    return u[:5]+''.join(chars[int(u[i:i+3],16)>>6]+chars[int(u[i:i+3],16)&63] for i in range(5,32,3))

def art(p,path,key,x=0,y=0,w=None,h=None,sliced=False):
    parent,name=path.rsplit('/',1);new(p,parent,name)
    asset=key if key.endswith('.png') else 'leaderboard_v8_'+key+'.png';iw,ih=Image.open(ASSET_DIR/asset).size
    if w is None:w=iw*S
    if h is None:h=ih*w/iw
    n=loc(p,path,x,y,w,h);p.sprite(n,asset,sliced);return n

def at(p,path,key,top,x=0,**kw):
    art(p,path,key,**kw);pin(p,path,top=top,x=x)

def text(p,path,value,x=0,y=0,w=150,h=40,size=28,number=False,**kw):
    n=label(p,path,value,x=x,y=y,w=w,h=h,size=size,**kw)
    p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':248,'b':232,'a':255}
    if number:
        c=p.component(n,'cc.Label')[1];c['_N$file']={'__uuid__':json.loads((ASSET_DIR/'leaderboard_v8_digits.fnt.meta').read_text())['uuid']};c['_styleFlags']=0
        p.data[n]['_color']={'__type__':'cc.Color','r':255,'g':255,'b':255,'a':255};p.disable(n,'cc.LabelShadow')
    return n

def top_text(p,path,value,top,x=0,**kw):
    text(p,path,value,**kw);pin(p,path,top=top,x=x)

def first(p,parent,paths):
    ids=[p.node(q) for q in paths];refs=p.data[p.node(parent)]['_children'];refs[:]=[{'__id__':i} for i in ids]+[r for r in refs if r['__id__'] not in ids]

def row(p,r):
    n=loc(p,r,0,0,880*S,120*S);p.disable(n,'cc.Sprite');p.disable(n,'cc.Widget')
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5}
    text(p,r+'/idx','—',x=-368*S,w=112*S,h=94*S,size=72,number=True)
    text(p,r+'/name','—',x=-139*S,y=22*S,w=272*S,h=51*S,size=35,bold=True,align=0)
    text(p,r+'/V8玩家ID','ID:—',x=-139*S,y=-27*S,w=272*S,h=44*S,size=27,align=0)
    text(p,r+'/played_count','—',x=124*S,w=239*S,h=66*S,size=44,number=True)
    text(p,r+'/user_reward','—',x=347*S,w=191*S,h=66*S,size=44,number=True)
    for name in ['proxy_guuid','proxy_reward']:
        p.set_active(p.node(r+'/'+name),False);p.disable(p.node(r+'/'+name),'cc.Label')
    for rank in [1,2,3]:
        path=r+'/V8皇冠'+str(rank);art(p,path,'crown_'+str(rank),x=-368*S,w=97*S);p.set_active(p.node(path),False)
    art(p,r+'/line','rule_horizontal',y=-59*S,w=878*S,h=2)
    for i,x in enumerate([0,247]):art(p,r+'/V8列分隔'+str(i),'rule_vertical',x=x*S,w=1.5,h=87*S)

def apply():
    (OUT/'before').mkdir(parents=True,exist_ok=True)
    for f in [PAGE,ROW,'assets/scripts/UI/panelPaihangbang.ts','assets/scripts/common/PaiHangScrollItem.ts']:
        dest=OUT/'before'/(f.split('/')[-1]+('.txt' if f.endswith('.ts') else ''))
        if not dest.exists():dest.write_bytes((ROOT/f).read_bytes())
    p=Prefab(PAGE);clear(p);r='排行榜';group(p,r)
    group(p,r+'/容器')
    at(p,r+'/V8大厅背景','lobby_scene_long_v8.png',0,w=750)
    loc(p,r+'/title',0,0,750,110*S);pin(p,r+'/title',top=0,stretch=True)
    art(p,r+'/title/V8标题牌','header',x=(418-941)/2*S,w=418*S)
    loc(p,r+'/title/关闭上上层',-395*S,0,132*S,110*S)
    # All dynamic account/activity data remain real Label and Button nodes.
    g=r+'/广告';loc(p,g,0,0,885*S,272*S);pin(p,g,top=147*S)
    art(p,g+'/V8底框','hero',w=885*S,h=272*S,sliced=True)
    art(p,g+'/V8盾牌','shield',x=(152.5-470.5)*S,y=(283-286)*S,w=195*S)
    art(p,g+'/V8荣耀标题','hero_title',x=(413-470.5)*S,y=(283-202.5)*S,w=262*S)
    text(p,g+'/开始时间','活动时间 —',x=(584-470.5)*S,y=(283-267)*S,w=594*S,h=43*S,size=28,align=0)
    text(p,g+'/结束时间','至 —',x=(584-470.5)*S,y=(283-309)*S,w=594*S,h=43*S,size=28,align=0)
    text(p,g+'/V8本人指标','',x=(724-470.5)*S,y=(283-205)*S,w=316*S,h=44*S,size=23,align=2)
    text(p,g+'/V8排名标题','我的排名',x=(344-470.5)*S,y=(283-365)*S,w=115*S,h=44*S,size=25,align=0)
    text(p,g+'/V8排名','—',x=(446-470.5)*S,y=(283-365)*S,w=91*S,h=44*S,size=28)
    text(p,g+'/V8奖励标题','当前奖励',x=(547-470.5)*S,y=(283-365)*S,w=124*S,h=44*S,size=25)
    text(p,g+'/V8奖励','—',x=(643-470.5)*S,y=(283-365)*S,w=82*S,h=46*S,size=34,number=True)
    art(p,g+'/领取奖励','claim',x=(794-470.5)*S,y=(283-358.5)*S,w=202*S)
    text(p,g+'/已领取','已领取',x=(794-470.5)*S,y=(283-358.5)*S,w=202*S,h=70*S,size=30)
    p.set_active(p.node(g+'/领取奖励'),False);p.set_active(p.node(g+'/已领取'),False)
    p.set_active(p.node(g+'/我的信息'),False)
    first(p,g,[g+'/V8底框'])
    t=r+'/条件';art(p,t,'tabs_base',w=883*S,h=88*S);pin(p,t,top=437*S)
    for i,(name,key) in enumerate(NAMES):
        path=t+'/'+name;loc(p,path,(i-1)*294*S,0,294*S,88*S)
        for state,suffix in [('Background','off'),('checkmark','on')]:art(p,path+'/'+state,'tab_'+key+'_'+suffix,w=294*S,h=88*S)
        # Normal artwork is one common bar; each toggle only overlays its pill.
        p.disable(p.node(path+'/Background'),'cc.Sprite')
        for ref in p.data[p.node(path)]['_children']:
            if p.data[ref['__id__']]['_name'] not in ['Background','checkmark']:p.set_active(ref['__id__'],False)
        toggle=p.component(p.node(path),'cc.Toggle')[1];toggle['isChecked']=toggle['_N$isChecked']=i==0
        first(p,path,[path+'/Background',path+'/checkmark'])
        p.set_active(p.node(path+'/checkmark'),i==0)
    for name,key in NAMES:
        g=r+'/容器/'+name;group(p,g);p.set_active(p.node(g),key=='hands')
        top=635*S if key=='hands' else 545*S;head=84*S
        art(p,g+'/V8表格底框','list',w=885*S,h=810*S,sliced=True);pin(p,g+'/V8表格底框',top=top,bottom=28,stretch=True,left=28*S,right=28*S)
        art(p,g+'/标题','table_'+key,w=885*S,h=head);pin(p,g+'/标题',top=top)
        for ref in p.data[p.node(g+'/标题')]['_children']:p.set_active(ref['__id__'],False)
        p.set_active(p.node(g+'/文本'),False)
        path=g+'/列表';loc(p,path,0,0,880*S,550);pin(p,path,top=top+head,bottom=42,stretch=True,left=30.5*S,right=30.5*S)
        for ref in p.data[p.node(path)]['_components']:
            c=p.data[ref['__id__']]
            if c['__type__'] in ['4ab6bpK1vlG5JtBhU75monu','0d83fc3wRhLQ5psw1ZE2ymI',script_id('LeaderboardScrollView')]:
                c.update(__type__=script_id('LeaderboardScrollView'),_enabled=True,elastic=False,inertia=True,brake=.65,bounceDuration=.2,LastEvent=0,page=None)
            if c['__type__']=='55af2sKFClD1pPk4h4O5dyV':c['_enabled']=False
        # Cocos still calls onLoad on disabled components. Detach the old virtual
        # list so it cannot disable Layout or hide appended rows during scrolling.
        refs=p.data[p.node(path)]['_components']
        refs[:]=[ref for ref in refs if p.data[ref['__id__']]['__type__']!='55af2sKFClD1pPk4h4O5dyV']
        view=path+'/view';loc(p,view,0,0,880*S,550);pin(p,view,top=0,bottom=0,stretch=True)
        content=view+'/content';n=loc(p,content,0,275,880*S,0);p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':1}
        ensure_widget(p,n).update(_enabled=True,alignMode=1,_alignFlags=41,_left=0,_right=0,_top=0,_bottom=0)
        _,lay=p.component(n,'cc.Layout');lay.update(_enabled=True,_resize=1,**{'_N$layoutType':2,'_N$paddingTop':0,'_N$paddingBottom':0,'_N$paddingLeft':0,'_N$paddingRight':0,'_N$spacingX':0,'_N$spacingY':0,'_N$verticalDirection':1})
        top_text(p,g+'/V8空列表','暂无排行数据',top+head+80,x=0,w=550,h=50,size=28)
        p.set_active(p.node(g+'/V8空列表'),False)
        # Keep legacy node names for compatibility, with no active pager script.
        pg=p.node(g+'/分页');p.set_active(pg,False)
        p.data[pg]['_components'][:]=[ref for ref in p.data[pg]['_components'] if p.data[ref['__id__']]['__type__']!=script_id('PageEx')]
        first(p,g,[g+'/V8表格底框',g+'/标题',g+'/列表'])
    f=r+'/容器/玩家手数榜/选择手数';loc(p,f,0,0,883*S,75*S);pin(p,f,top=545*S)
    for i,name in enumerate(['1皮','2皮','5皮','10皮','20皮']):
        path=f+'/'+name;loc(p,path,(i-2)*176.6*S,0,176.6*S,75*S)
        for state,suffix in [('Background','off'),('checkmark','on')]:
            art(p,path+'/'+state,'filter_'+suffix,w=176.6*S,h=75*S)
            text(p,path+'/'+state+'/V8文字',name,w=158*S,h=59*S,size=33,bold=True)
            if suffix=='on':p.data[p.node(path+'/'+state+'/V8文字')]['_color']={'__type__':'cc.Color','r':3,'g':27,'b':54,'a':255};p.disable(p.node(path+'/'+state+'/V8文字'),'cc.LabelShadow')
        for ref in p.data[p.node(path)]['_children']:
            if p.data[ref['__id__']]['_name'] not in ['Background','checkmark']:p.set_active(ref['__id__'],False)
        toggle=p.component(p.node(path),'cc.Toggle')[1];toggle['isChecked']=toggle['_N$isChecked']=i==0
        # Old secondary toggles drew Background after checkmark, hiding selection.
        first(p,path,[path+'/Background',path+'/checkmark'])
        p.set_active(p.node(path+'/checkmark'),i==0)
    p.set_active(p.node(f+'/50皮'),False)
    row(p,r+'/排行榜对象');p.set_active(p.node(r+'/排行榜对象'),False)
    p.component(p.root,'afeb6fShj1Kr7TKnGKYetqS')[1]['rowTemplate']={'__id__':p.node(r+'/排行榜对象')}
    first(p,r,[r+'/V8大厅背景',r+'/容器',r+'/广告',r+'/条件',r+'/title'])
    p.save()
    p=Prefab(ROW);clear(p);row(p,'排行榜对象');p.save()
    print('Saved the formal leaderboard page and reusable row prefab.')

if __name__=='__main__':apply()
