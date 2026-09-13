#!/usr/bin/env python3
"""Componentize the real agent UI in its formal Prefab, using V8-new cuts."""
import base64,copy,json,uuid
from PIL import Image
from apply_v7_prefab_skin import Prefab,ROOT,ASSET_DIR
from apply_v7_lobby_exact import untint
from repair_v7_responsive_layout import ensure_widget
from apply_v8_settings import pin

PAGE='assets/resources/UI/panelHongli.prefab'
OUT=ROOT/'art_sources/v8-repairs/agent'
S=750/941
GOLD={'__type__':'cc.Color','r':255,'g':239,'b':208,'a':255}
SUB={'__type__':'cc.Color','r':220,'g':233,'b':241,'a':255}
FONT={'__uuid__':'fd7307b2-666e-4c26-963d-59f787cad6fb'}
LISTS=[('我的玩家',9),('我的业绩',10),('我的盟主',11),('总业绩',12),('提取记录',13),('奖池提取记录',14)]
POPS=[('盟主收益','leader'),('奖池收益','pool'),('大区收益','region'),('总业绩2','share'),
      ('添加代理面板','add'),('删除总业绩对象面板','delete'),('提取红利面板','withdraw'),
      ('提取奖池收益面板','withdraw'),('提取分红面板','share'),('添加盟主面板','ratio'),('修改盟主面板','ratio')]
ROWS=['玩家对象','贡献对象','盟主对象','总业绩对象','红利提取记录对象']

def new(p,parent,name):
    path=parent+'/'+name
    try:return p.node(path)
    except KeyError:pass
    template=copy.deepcopy(p.data[p.root]);i=len(p.data)
    template.update(_name=name,_parent={'__id__':p.node(parent)},_children=[],_components=[],_active=True,_prefab={'__id__':i+1})
    template['_trs']['array']=[0,0,0,0,0,0,1,1,1,1];template['_opacity']=255
    template['_contentSize']={'__type__':'cc.Size','width':100,'height':100}
    template['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5};template['_id']=''
    ident=uuid.uuid5(uuid.NAMESPACE_URL,'qing/v8-agent/'+str(p.path)+'/'+path)
    info=copy.deepcopy(p.data[p.data[p.root]['_prefab']['__id__']]);info.update(fileId=ident.hex[:2]+base64.b64encode(ident.bytes[1:]).decode())
    p.data.extend([template,info]);p.data[p.node(parent)]['_children'].append({'__id__':i});return i

def reset(p,n):
    p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':.5,'y':.5};p.data[n]['_trs']['array'][7:10]=[1,1,1]
    p.disable(n,'cc.Widget');untint(p,n)

def loc(p,path,x,y,w,h):
    n=p.node(path);reset(p,n);p.set_pos(n,x,y,w,h);p.set_active(n,True);return n

def art(p,path,key,x=0,y=0,w=None,h=None,sliced=False):
    if '/' in path:
        parent,name=path.rsplit('/',1);new(p,parent,name)
    asset=key if key.endswith('.png') else 'agent_v8_'+key+'.png'
    iw,ih=Image.open(ASSET_DIR/asset).size
    if w is None:w=iw*S
    if h is None:h=ih*w/iw
    n=loc(p,path,x,y,w,h);p.sprite(n,asset,sliced);return n

def at(p,path,key,top,x=0,w=None,h=None,sliced=False):
    art(p,path,key,w=w,h=h,sliced=sliced);pin(p,path,top=top,x=x)

def group(p,path):
    n=p.node(path);reset(p,n);p.set_pos(n,0,0,750,1334);p.disable(n,'cc.Sprite')
    if n==p.root:ensure_widget(p,n).update(_enabled=True,alignMode=1,_alignFlags=45,_top=0,_bottom=0,_left=0,_right=0)
    else:pin(p,path,top=0,bottom=0,stretch=True)

def label(p,path,text=None,x=0,y=0,w=160,h=40,size=28,align=1,sub=False,bold=False,wrap=False,number=False):
    parent,name=path.rsplit('/',1);n=new(p,parent,name);loc(p,path,x,y,w,h)
    cid,c=p.component(n,'cc.Label')
    if c is None:
        c=copy.deepcopy(next(o for o in p.data if o.get('__type__')=='cc.Label'));cid=len(p.data)
        c.update(node={'__id__':n},_id='');p.data.append(c);p.data[n]['_components'].append({'__id__':cid})
    if text is not None:c['_string']=c['_N$string']=text
    c.update(_enabled=True,_fontSize=size,_lineHeight=size+5,_enableWrapText=wrap,_isSystemFontUsed=False,
        _styleFlags=1 if bold else 0,_overflow=1,**{'_N$overflow':1,'_N$file':copy.deepcopy(FONT),'_N$horizontalAlign':align,'_N$verticalAlign':1})
    p.data[n]['_color']=copy.deepcopy(SUB if sub else GOLD)
    p.disable(n,'cc.LabelOutline')
    if number:
        c['_N$file']={'__uuid__':json.loads((ASSET_DIR/'agent_v8_digits.fnt.meta').read_text())['uuid']}
        c['_styleFlags']=0;untint(p,n)
        p.disable(n,'cc.LabelShadow')
    else:
        _,shadow=p.component(n,'cc.LabelShadow')
        if shadow is None:
            shadow={'__type__':'cc.LabelShadow','_name':'','_objFlags':0,'node':{'__id__':n},'_enabled':True,'_id':''}
            sid=len(p.data);p.data.append(shadow);p.data[n]['_components'].append({'__id__':sid})
        shadow.update(_enabled=True,_color={'__type__':'cc.Color','r':0,'g':13,'b':27,'a':190},_offset={'__type__':'cc.Vec2','x':1,'y':-2},_blur=2)
    return n

def lt(p,path,text,top,x=0,w=160,h=40,size=28,**kw):
    label(p,path,text,w=w,h=h,size=size,**kw);pin(p,path,top=top,x=x)

def button(p,path,key,x,y,w,h=None,text=None):
    n=art(p,path,key,x,y,w,h)
    # Keep original component and event bindings. Only its pixels and geometry change.
    if text:label(p,path+'/V8文字',text,w=w-12,h=p.data[n]['_contentSize']['height']-8,size=25,bold=True)
    return n

def clear(p):
    for o in p.data:
        if o.get('__type__') in ['cc.Sprite','cc.Label','cc.LabelOutline','cc.LabelShadow','cc.Widget','cc.Layout']:
            o['_enabled']=False
            if o['__type__']=='cc.Sprite':o['_spriteFrame']=None
        if o.get('__type__')=='cc.Node' and '母版' in o.get('_name',''):o['_active']=False

def header(p,path,index,home=False):
    art(p,path+'/title','header_'+str(index),w=750,h=90*S);pin(p,path+'/title',top=0,stretch=True)
    target=path+'/title/'+('关闭' if home else '关闭上上层')
    loc(p,target,-325,0,100,90*S)

def backdrop(p,path):
    at(p,path+'/V8大厅背景','lobby_scene_long_v8.png',0,w=750)
    ids=p.data[p.node(path)]['_children'];bg=p.node(path+'/V8大厅背景');ids[:]=[{'__id__':bg}]+[r for r in ids if r['__id__']!=bg]

def home(p):
    r='panelHongli';group(p,r);backdrop(p,r)
    for g in ['统计','数据','红利统计','红利余额','操作']:group(p,r+'/'+g)
    at(p,r+'/hlye','hero',136*S,w=804*S,h=221*S,sliced=True)
    at(p,r+'/hlye/V8盾牌','shield',28*S,x=-283*S,w=141*S)
    at(p,r+'/hlye/V8标题','hero_title',29*S,x=-90*S,w=153*S)
    lt(p,r+'/红利余额/num',None,212*S,x=0,w=350*S,h=80*S,size=52,align=0,number=True)
    lt(p,r+'/hlye/V8说明','实时统计 · 可提取金额以服务器为准',151*S,x=105*S,w=556*S,h=40*S,size=19,align=0,sub=True)
    at(p,r+'/统计/V8底框','summary',378*S,w=804*S,h=171*S,sliced=True)
    for path,x,title in [('累计总红利',-264,'累计总红利'),('累计总提取',0,'累计总提取')]:
        group(p,r+'/统计/'+path);lt(p,r+'/统计/'+path+'/num',None,449*S,x=x*S,w=230*S,h=69*S,size=34,number=True)
        lt(p,r+'/统计/V8'+path,title,403*S,x=x*S,w=250*S,h=44*S,size=25,sub=True)
    lt(p,r+'/统计/V8今日标题','今日红利',403*S,x=264*S,w=220*S,size=25,sub=True)
    lt(p,r+'/统计/V8今日红利','—',449*S,x=264*S,w=230*S,h=69*S,size=34,number=True)
    button(p,r+'/统计/提取红利','home_withdraw',0,0,192*S);pin(p,r+'/统计/提取红利',top=217*S,x=276*S)
    # A native Grid compacts permission-hidden actions; art stays serialized.
    try:p.set_active(p.node(r+'/操作/V8标题'),False)
    except KeyError:pass
    at(p,r+'/V8代理管理标题','caption_manage',563*S,w=203*S)
    for sign in [-1,1]:at(p,r+'/V8管理横线'+str(sign),'rule_title',584*S,x=sign*269*S,w=278*S,h=3*S)
    g=loc(p,r+'/操作',0,0,640,194);pin(p,r+'/操作',top=620*S)
    _,lay=p.component(g,'cc.Layout')
    if lay is None:
        lay=copy.deepcopy(next(o for o in p.data if o.get('__type__')=='cc.Layout'))
        cid=len(p.data);p.data.append(lay);p.data[g]['_components'].append({'__id__':cid});lay['node']={'__id__':g}
    lay.update(_enabled=True,_layoutSize={'__type__':'cc.Size','width':640,'height':194},_resize=0,
        **{'_N$layoutType':3,'_N$cellSize':{'__type__':'cc.Size','width':204,'height':88},'_N$startAxis':0,
           '_N$paddingLeft':0,'_N$paddingRight':0,'_N$paddingTop':0,'_N$paddingBottom':0,
           '_N$spacingX':14,'_N$spacingY':18,'_N$verticalDirection':1,'_N$horizontalDirection':0,'_N$affectedByScale':False})
    specs=[('我的玩家','players'),('我的业绩','performance'),('我的盟主','leaders'),('提取记录','history'),('推广','promotion'),('总业绩','total')]
    for i,(name,key) in enumerate(specs):
        path=r+'/操作/'+name;n=loc(p,path,(i%3-1)*218,53-(i//3)*106,204,88);p.disable(n,'cc.Sprite')
        iw,ih=Image.open(ASSET_DIR/('agent_v8_home_'+key+'.png')).size;scale=min(204/iw,88/ih)
        art(p,path+'/V8按钮美术','home_'+key,w=iw*scale,h=ih*scale)
    refs=p.data[g]['_children'];ordered=[p.node(r+'/操作/'+name) for name,_ in specs]
    refs[:]=[{'__id__':i} for i in ordered]+[a for a in refs if a['__id__'] not in ordered]
    for ref in refs:
        if ref['__id__'] not in ordered:p.set_active(ref['__id__'],False)
    at(p,r+'/数据/V8底框','data',896*S,w=804*S,h=323*S,sliced=True)
    at(p,r+'/数据/V8标题','caption_data',925*S,w=206*S)
    for sign in [-1,1]:at(p,r+'/数据/V8标题横线'+str(sign),'rule_data',947*S,x=sign*246*S,w=273*S,h=3*S)
    at(p,r+'/数据/V8水平分隔','rule_horizontal',1106*S,w=724*S,h=3*S)
    for k,x in enumerate([-190,21,220]):at(p,r+'/数据/V8竖线'+str(k),'rule_vertical',1003*S,x=x*S,w=3*S,h=77*S)
    for k,x in enumerate([-120,123]):at(p,r+'/数据/V8下排竖线'+str(k),'rule_vertical',1136*S,x=x*S,w=3*S,h=57*S)
    for k,x in enumerate([-133,133]):at(p,r+'/统计/V8竖线'+str(k),'rule_vertical',412*S,x=x*S,w=3*S,h=102*S)
    for name,title,x in [('上级ID','上级ID',-292),('我的ID','我的ID',-85),('下级玩家','下级玩家',123),('今日新增','今日新增',312)]:
        lt(p,r+'/数据/V8'+title,title,994*S,x=x*S,w=180*S,size=24,sub=True)
        lt(p,r+'/数据/'+name,None,1040*S,x=x*S,w=180*S,h=57*S,size=32,number=True)
    for name,x in [('今日红利',-243),('昨日红利',0),('前日红利',243)]:
        lt(p,r+'/红利统计/V8'+name,name,1125*S,x=x*S,w=220*S,size=24,sub=True)
        lt(p,r+'/红利统计/'+name,None,1163*S,x=x*S,w=220*S,h=44*S,size=29,number=True)
    at(p,r+'/V8底部盾牌','shield',1300*S,w=170*S)
    # Draw the material under the existing live groups, then navigation last.
    ids=[p.node(r+'/'+x) for x in ['V8大厅背景','hlye','统计','数据','红利统计','红利余额','操作','V8底部盾牌','V8代理管理标题','V8管理横线-1','V8管理横线1','title']]
    rest=[ref for ref in p.data[p.root]['_children'] if ref['__id__'] not in ids]
    p.data[p.root]['_children']=[{'__id__':n} for n in ids]+rest
    # Newly added bases must precede old dynamic fields inside each group.
    for g in ['统计','数据']:
        n=p.node(r+'/'+g);bg=p.node(r+'/'+g+'/V8底框');refs=p.data[n]['_children'];refs[:]=[{'__id__':bg}]+[v for v in refs if v['__id__']!=bg]
    header(p,r,8,True)

def pagination(p,path):
    art(p,path,'pager',w=710,h=106,sliced=True);pin(p,path,bottom=44)
    for name,key,x in [('首页','first',-270),('上一页','prev',-160),('下一页','next',160),('尾页','last',270)]:button(p,path+'/'+name,'page_'+key,x,0,67)
    art(p,path+'/V8页码底框','page_value',w=194,h=64,sliced=True)
    label(p,path+'/页码',None,w=176,h=55,size=35)
    refs=p.data[p.node(path)]['_children'];num=p.node(path+'/页码');refs[:]=[x for x in refs if x['__id__']!=num]+[{'__id__':num}]

def edit(p,path,x,y,w,h,placeholder):
    loc(p,path,x,y,w,h);p.disable(p.node(path),'cc.Sprite')
    art(p,path+'/V8输入底框','button_base',w=w,h=h,sliced=True)
    c=p.component(p.node(path),'cc.EditBox')[1];c['_N$placeholder']=placeholder
    for ref in ['_N$textLabel','_N$placeholderLabel']:
        comp=p.data[c[ref]['__id__']];n=comp['node']['__id__'];name=p.data[n]['_name']
        label(p,path+'/'+name,'' if ref=='_N$textLabel' else placeholder,x=0,y=0,w=w-24,h=h,size=25,align=0,sub=ref!='_N$textLabel')
        p.data[n]['_anchorPoint']={'__type__':'cc.Vec2','x':0,'y':1};p.set_pos(n,-w/2+12,h/2,w-24,h)
        ensure_widget(p,n).update(_enabled=True,alignMode=1,_alignFlags=45,_top=0,_bottom=0,_left=12,_right=12)
    bg=p.node(path+'/V8输入底框');refs=p.data[p.node(path)]['_children'];refs[:]=[{'__id__':bg}]+[r for r in refs if r['__id__']!=bg]

def lists(p):
    for name,index in LISTS:
        r='panelHongli/'+name;group(p,r);backdrop(p,r);header(p,r,index)
        summary_top=190 if name=='我的业绩' else 110
        at(p,r+'/V8概况底框','summary',summary_top,w=612,h=124,sliced=True)
        if name=='我的玩家':stats=[('统计/下级玩家数量/num','下级玩家数量',-155),('V8今日新增','今日新增',155)]
        elif name=='我的业绩':stats=[('统计/总人数/num','总人数',-204),('统计/今日总贡献/num','今日总贡献',0),('统计/累计总贡献/num','累计总贡献',204)]
        elif name=='我的盟主':stats=[('统计/今日贡献/num','今日贡献',-155),('统计/累计贡献/num','累计贡献',155)]
        elif name=='总业绩':stats=[('统计/昨日贡献/num','昨日所有下级玩家业绩',-155),('统计/所占比例/num','所占比例',155)]
        elif name=='提取记录':stats=[('V8累计提取','累计提取',-155),('V8可提取红利','可提取红利',155)]
        else:stats=[('V8奖池余额','奖池收益余额',-155),('V8累计提取','累计提取',155)]
        try:group(p,r+'/统计')
        except KeyError:pass
        for path,title,x in stats:
            if '/' in path:
                parts=path.split('/')[:-1];group(p,r+'/'+('/'.join(parts)))
            lt(p,r+'/'+path,'—' if path.startswith('V8') else None,summary_top+62,x=x,w=192,h=53,size=36,number=True)
            lt(p,r+'/V8标题'+title,title,summary_top+14,x=x,w=280 if len(stats)==2 else 202,h=40,size=23 if len(title)>9 else 25,sub=True)
        top=333 if name=='我的业绩' else 255
        if name=='总业绩':top=340
        path=r+'/列表';art(p,path,'list',w=640,h=800,sliced=True);pin(p,path,top=top,bottom=174,stretch=True,left=55,right=55)
        view=path+'/view';loc(p,view,0,0,624,740);pin(p,view,top=62,bottom=10,stretch=True,left=8,right=8)
        mask=p.component(p.node(view),'cc.Mask')[1];mask['_enabled']=True
        content=view+'/content';loc(p,content,0,0,624,1);p.data[p.node(content)]['_anchorPoint']['y']=1
        wg=ensure_widget(p,p.node(content));wg.update(_enabled=True,alignMode=1,_alignFlags=17,_top=0,_horizontalCenter=0)
        lay=p.component(p.node(content),'cc.Layout')[1]
        if lay:lay.update(_enabled=True,**{'_N$spacingY':11,'_N$paddingTop':0,'_N$paddingBottom':0})
        for ref in p.data[p.node(content)]['_children']:p.data[ref['__id__']]['_active']=False
        art(p,r+'/标题','table_base',w=640,h=52,sliced=True);pin(p,r+'/标题',top=top)
        if name=='我的玩家':cols=[('ID',-232,130),('昵称',-70,180),('手数',90,118),('授权',239,144)]
        elif name=='我的盟主':cols=[('ID',-232,130),('昵称',-70,170),('玩家数',90,123),('比例',239,132)]
        elif name=='我的业绩':cols=[('玩家信息',-209,202),('今日贡献',0,188),('累计贡献',208,188)]
        elif name=='总业绩':cols=[('ID',-216,164),('昵称',0,236),('授权',230,142)]
        else:cols=[('时间',-210,204),('金额',0,180),('状态',210,180)]
        for title,x,w in cols:label(p,r+'/标题/V8'+title,title,x=x,w=w,h=46,size=28,bold=True)
        if name=='总业绩':
            edit(p,r+'/标题/用户ID',-76,70,345,59,'请输入用户ID')
            button(p,r+'/标题/授权总业绩','button_base',222,70,170,59,'授权')
        if name=='我的业绩':
            art(p,r+'/条件','row',w=612,h=63,sliced=True);pin(p,r+'/条件',top=111)
            for k,key in enumerate(['我的玩家','二级代理','三级代理']):
                path=r+'/条件/'+key;loc(p,path,(k-1)*202,0,200,61)
                label(p,path+'/V8文字',key,w=188,h=49,size=27,bold=True)
                art(p,path+'/checkmark','tab_active',w=198,h=54,sliced=True)
                label(p,path+'/checkmark/V8文字',key,w=188,h=49,size=27,bold=True)
                p.set_active(p.node(path+'/checkmark'),k==0)
        pagination(p,r+'/分页')
        # Background/summary must precede live stats, list, title and paging.
        refs=p.data[p.node(r)]['_children'];front=[p.node(r+'/'+x) for x in ['V8大厅背景','V8概况底框']]
        refs[:]=[{'__id__':n} for n in front]+[v for v in refs if v['__id__'] not in front]

def popups(p):
    for name,key in POPS:
        r='panelHongli/'+name;group(p,r);msk=r+'/msk';art(p,msk,'solid',w=750,h=1334)
        p.data[p.node(msk)]['_color']={'__type__':'cc.Color','r':0,'g':0,'b':0,'a':255};p.data[p.node(msk)]['_opacity']=145
        pin(p,msk,top=0,bottom=0,stretch=True)
        bk=r+'/bk';h=574 if key=='ratio' else 542 if key=='pool' else 506
        art(p,bk,'ratio_popup' if key=='ratio' else 'popup',w=574 if key=='add' else 552,h=h,sliced=True)
        ensure_widget(p,p.node(bk)).update(_enabled=True,alignMode=1,_alignFlags=18,_horizontalCenter=0,_verticalCenter=0)
        art(p,bk+'/V8标题','title_'+key,y=h/2-52,w=190 if key=='add' else 169)
        art(p,bk+'/V8标题分隔','settlement_row_exact.png',y=h/2-91,w=464,h=1.4)
        art(p,bk+'/V8盾牌','shield',y=h/2-177,w=112 if key!='add' else 133)
        cancel=bk+'/关闭上上层'
        if key in ['leader','region']:
            button(p,cancel,'button_ok',0,-h/2+57,302)
        else:button(p,cancel,'button_cancel',-125,-h/2+57,219)
        values=[]
        if key in ['leader','region']:values=[('今日收益','今日收益',-34),('累计收益','累计收益',-75)]
        elif key=='pool':values=[('今日收益','今日收益',-8),('累计收益','累计收益',-47),('累计提取','累计提取',-86),('奖池收益余额','奖池余额',-125)]
        elif name=='总业绩2':values=[('所占比例','当前所占比例',-52)]
        for field,title,y in values:
            label(p,bk+'/V8字段'+field,title+'：',x=-63,y=y,w=216,h=40,size=25,align=2)
            label(p,bk+'/'+field,None,x=119,y=y,w=156,h=40,size=28,align=0,number=True)
        confirmations={'奖池收益':('提取奖池收益','income'),'总业绩2':('我的分红',None),
            '添加代理面板':('确认添加代理','add'),'删除总业绩对象面板':('确认删除总业绩对象','delete'),
            '提取红利面板':('确认提取红利','withdraw'),'提取奖池收益面板':('确认提取奖池收益','withdraw'),
            '提取分红面板':('确认提取分红','withdraw'),'添加盟主面板':('确认添加盟主','ratio'),'修改盟主面板':('确认修改盟主','ratio')}
        if name in confirmations:
            target,asset=confirmations[name]
            try:button(p,bk+'/'+target,'button_'+asset if asset else 'button_base',125,-h/2+57,219,70 if asset is None else None,'提取分红' if asset is None else None)
            except KeyError:pass
        if key in ['add','delete','withdraw'] or name=='提取分红面板':
            text=None
            if key=='withdraw':text='是否确认提取所有'+('奖池收益？' if name=='提取奖池收益面板' else '红利？')
            if name=='提取分红面板':text='是否确认提取分红？'
            label(p,bk+'/msg',text,y=-68,w=496,h=105,size=26,wrap=True)
            if key=='delete':label(p,bk+'/id',None,y=-126,w=460,h=40,size=27)
            elif key=='add':p.set_active(p.node(bk+'/id'),False)
            else:label(p,bk+'/V8可提取金额','可提取金额：—',y=-132,w=472,h=38,size=25)
        if key=='ratio':
            if name=='修改盟主面板':
                label(p,bk+'/name',None,x=-60,y=-8,w=240,h=41,size=27)
                label(p,bk+'/id',None,x=153,y=-8,w=161,h=41,size=25)
                p.set_active(p.node(bk+'/msg'),False)
            else:
                label(p,bk+'/msg',None,y=-2,w=488,h=95,size=24,wrap=True);p.set_active(p.node(bk+'/id'),False)
            edit(p,bk+'/比例',0,-97,425,62,'请输入盟主分成比例')
            label(p,bk+'/V8提示','注意：盟主分成比例只能提升不能降低',y=-157,w=508,h=49,size=22,sub=True)
        # Pool extraction history was an invisible button, kept as a clear link.
        if key=='pool':
            button(p,bk+'/提取奖池记录','transparent.png',0,-h/2+20,240,28,'查看提取记录')
            label(p,bk+'/提取奖池记录/V8文字','查看提取记录',w=235,h=27,size=19,sub=True)
        p.set_active(p.node(r),False)

def promotion(p):
    # Retired: both entrances now use panelMain/推广二维码 and its live handlers.
    # Keep old UUID/node contracts, but never rebuild or enable the duplicate UI.
    p.set_active(p.node('panelHongli/推广二维码'),False)


def row_apply(p,root=None,name=None):
    r=root or p.data[p.root]['_name'];name=name or r
    art(p,r,'row',w=624,h=74,sliced=True)
    # Existing item Buttons dynamically change active state in set*Item.
    cols={'玩家对象':[('id',-232,124),('name',-70,181),('count',90,113),('type',239,139)],
        '盟主对象':[('id',-232,124),('name',-70,181),('玩家数',90,113),('比例',239,139)],
        '总业绩对象':[('id',-216,162),('name',0,232)],
        '红利提取记录对象':[('time',-210,210),('count',0,178),('state',210,174)]}
    if name=='贡献对象':
        label(p,r+'/name',None,x=-209,y=15,w=197,h=31,size=25,align=0,bold=True)
        label(p,r+'/id',None,x=-209,y=-16,w=197,h=27,size=21,align=0,sub=True)
        for fld,x in [('today',0),('all',208)]:label(p,r+'/'+fld,None,x=x,w=184,h=53,size=27,number=True)
    else:
        for fld,x,w in cols[name]:label(p,r+'/'+fld,None,x=x,w=w,h=57,size=25 if fld!='time' else 22,number=fld in ['id','count','玩家数','比例'])
    if name=='玩家对象':button(p,r+'/授权代理','transparent.png',239,0,143,66,'添加代理')
    if name=='盟主对象':
        button(p,r+'/授权盟主','transparent.png',239,0,143,66,'授权盟主')
        loc(p,r+'/设置盟主',239,0,143,66)
    if name=='总业绩对象':button(p,r+'/删除授权总业绩','button_base',230,0,132,49,'删除')

def main():
    before=OUT/'before';before.mkdir(parents=True,exist_ok=True)
    files=[PAGE,'assets/scripts/UI/panelHongli.ts']+['assets/resources/Prefabs/'+x+'.prefab' for x in ROWS]
    for f in files:
        dest=before/f.split('/')[-1]
        if not dest.exists():dest.write_bytes((ROOT/f).read_bytes())
    p=Prefab(PAGE);clear(p);home(p);lists(p);popups(p);promotion(p)
    for page,name in [('我的玩家','玩家对象'),('我的业绩','贡献对象'),('我的盟主','盟主对象'),('总业绩','总业绩对象'),('提取记录','红利提取记录对象'),('奖池提取记录','红利提取记录对象')]:
        content='panelHongli/'+page+'/列表/view/content'
        for ref in p.data[p.node(content)]['_children']:
            n=p.data[ref['__id__']]
            if n['_name']==name:row_apply(p,content+'/'+name,name);n['_active']=False
    p.save()
    for name in ROWS:
        q=Prefab('assets/resources/Prefabs/'+name+'.prefab');clear(q);row_apply(q);q.save()
    print('V8 agent: home, six lists, shared main promotion entry, eleven dialogs and five real row prefabs authored.')

if __name__=='__main__':main()
