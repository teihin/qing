#!/usr/bin/env python3
"""V8 gift source composition, editable values, and native scrolling records."""
import json
from pathlib import Path
from apply_v7_prefab_skin import Prefab
from apply_v7_lobby_exact import untint,style_label
from apply_v7_gift_exact import fill_parent
from apply_v8_login import update_meta
from apply_v8_mine import unique_clone
from repair_v7_responsive_layout import top,bottom,stretch,ensure_widget
S=750/941
ROOT='赠送'

def main():
    for c in json.loads(Path('tools/v8_gift_crops.json').read_text()):update_meta(Path(c['output']).name)
    p=Prefab('assets/resources/UI/panelMain.prefab');root=p.node(ROOT)
    # The source lower field begins at y=509. It must be top-anchored as its
    # own natural-ratio slice rather than centered as a short root background.
    p.disable(root,'cc.Sprite')
    try: lower=p.node(ROOT+'/V8赠送中下背景')
    except KeyError: lower=unique_clone(p,p.node(ROOT+'/V7赠送主视觉'),root,'V8赠送中下背景')
    p.hide_children(lower);p.set_active(lower,True)
    p.art(lower,'gift_bg_exact.png',0,0,750,(1672-509)*S,hide=True);untint(p,lower);p.disable(lower,'cc.Widget')
    top(p,ROOT+'/V8赠送中下背景',509*S,width=750,height=(1672-509)*S)
    children=p.data[root].get('_children',[])
    try: extend=p.node(ROOT+'/V8赠送延展底纹')
    except KeyError: extend=unique_clone(p,lower,root,'V8赠送延展底纹')
    p.hide_children(extend);p.set_active(extend,True)
    p.art(extend,'lobby_floor_tile_v8.png',0,0,750,1100*S,hide=True);untint(p,extend);p.disable(extend,'cc.Widget')
    _,tile_sprite=p.component(extend,'cc.Sprite');tile_sprite['_type']=2;tile_sprite['_sizeMode']=0
    bottom(p,ROOT+'/V8赠送延展底纹',0,width=750,height=1100*S)
    children[:]=[{'__id__':extend},{'__id__':lower}]+[r for r in children if r.get('__id__') not in (extend,lower)]
    try:back=p.node(ROOT+'/V8表单背景')
    except KeyError:back=unique_clone(p,p.node(ROOT+'/V7赠送主视觉'),root,'V8表单背景')
    p.hide_children(back);p.set_active(back,True)
    # The source's subtle table texture is fixed behind the fixed-height form.
    children=p.data[root]['_children'];children[:]=[{'__id__':back}]+[r for r in children if r['__id__']!=back]
    for path,asset,y,w,h in [('title','gift_header_exact.png',0,941,97),('V7赠送主视觉','gift_hero_exact.png',97,941,412),('V8表单背景','v8_gift_form_backdrop.png',509,941,632),('标题','gift_history_header_exact.png',1008,886,133)]:
        n=p.node(ROOT+'/'+path);p.sprite(n,asset);untint(p,n);top(p,ROOT+'/'+path,y*S,width=w*S,height=h*S)
    close=p.node(ROOT+'/title/关闭上上层');p.set_active(close,True);p.art(close,'transparent.png',(57-470.5)*S,0,114*S,97*S,hide=True);p.disable(close,'cc.Widget')
    p.set_active(p.node(ROOT+'/title/赠送_受赠记录'),False)
    p.set_active(p.node(ROOT+'/V7赠送记录标题'),False)
    p.set_active(p.node(ROOT+'/操作/垫底长'),False)
    op=ROOT+'/操作';top(p,op,509*S,width=750,height=473*S)
    specs=[('用户id','id',509,611,262,[262,541,438,584],6,2,False),('金额','amount',629,733,365,[365,663,567,707],12,3,False),('V7交易密码','password',751,856,365,[365,785,567,829],8,2,True)]
    for name,key,y0,y1,left,hint,maxlen,mode,password in specs:
        path=op+'/'+name;n=p.node(path);cy=(509+473/2-(y0+y1)/2)*S
        # Keep Creator's serialized sibling background and narrow input hot area.
        try:bg=p.node(path+'/BACKGROUND_SPRITE');inside=True
        except KeyError:
            siblings=[r['__id__'] for r in p.data[p.node(op)]['_children']];idx=siblings.index(n)
            bg=next(i for i in reversed(siblings[:idx]) if p.data[i]['_name']=='BACKGROUND_SPRITE');inside=False
        width=(858-left)*S;height=(y1-y0)*S;fx=((left+858)/2-470.5)*S
        p.set_pos(n,fx,cy,width,height,disable_widget=True);p.set_active(n,True)
        p.art(bg,f'gift_input_{key}_exact.png',-fx if inside else 0,0 if inside else cy,827*S,height);p.disable(bg,'cc.Widget');untint(p,bg)
        for ref in p.data[n]['_children']:
            child=p.data[ref['__id__']]
            if child['_name'] not in ['TEXT_LABEL','PLACEHOLDER_LABEL','BACKGROUND_SPRITE']:child['_active']=False
        for suffix in ['TEXT_LABEL','PLACEHOLDER_LABEL']:
            label=p.node(path+'/'+suffix);p.set_active(label,True);p.set_pos(label,-width/2,height/2,width,height,disable_widget=True)
            p.data[label]['_anchorPoint']={'__type__':'cc.Vec2','x':0,'y':1}
            _,c=p.component(label,'cc.Label');c.update(_fontSize=round(29*S),_lineHeight=round(40*S),_enableWrapText=False);c['_N$horizontalAlign']=0;c['_N$verticalAlign']=1;c['_overflow']=1
            p.disable(label,'cc.LabelOutline');p.data[label]['_color']={'__type__':'cc.Color','r':255,'g':255,'b':255,'a':255}
            if suffix=='PLACEHOLDER_LABEL':
                # EditBox already toggles its placeholder node for typing/clear.
                # Its child carries the exact source lettering, with no runtime art code.
                c['_string']=c['_N$string']=''
                try:a=p.node(path+'/'+suffix+'/V8占位图')
                except KeyError:a=unique_clone(p,p.node(ROOT+'/V7赠送主视觉'),label,'V8占位图')
                p.hide_children(a);p.set_active(a,True)
                x0,hy0,x1,hy1=hint
                p.art(a,f'v8_gift_hint_{key}.png',((x0+x1)/2-left)*S,(y0-(hy0+hy1)/2)*S,(x1-x0)*S,(hy1-hy0)*S);p.disable(a,'cc.Widget');untint(p,a)
        _,e=p.component(n,'cc.EditBox');e['maxLength']=maxlen;e['_N$inputMode']=mode;e['_N$inputFlag']=0 if password else 5
    confirm=p.node(op+'/提交赠送');p.art(confirm,'gift_confirm_exact.png',0,(745.5-930.5)*S,511*S,103*S,hide=True);p.disable(confirm,'cc.Widget');untint(p,confirm)
    view=ROOT+'/赠送记录列表';p.sprite(p.node(view),'gift_list_panel_exact.png');untint(p,p.node(view));stretch(p,view,1141*S,187*S,left=27*S,right=28*S)
    fill_parent(p,p.node(view+'/view'),886*S,344*S)
    content=p.node(view+'/view/content');p.data[content]['_contentSize']['width']=886*S
    w=ensure_widget(p,content);w.update(_enabled=True,_alignFlags=41,_left=0,_right=0,_top=0,alignMode=1)
    _,layout=p.component(content,'cc.Layout');layout['_N$paddingTop']=layout['_N$paddingBottom']=layout['_N$spacingY']=0
    pager=ROOT+'/分页';p.sprite(p.node(pager),'v8_gift_pagination.png');untint(p,p.node(pager));bottom(p,pager,59*S,width=886*S,height=128*S)
    p.disable(p.node(pager),'cc.Layout')
    for name,x in [('首页',132),('上一页',273),('下一页',665),('尾页',808)]:
        n=p.node(pager+'/'+name);p.art(n,'transparent.png',(x-470)*S,-2*S,100*S,104*S,hide=True);p.disable(n,'cc.Widget');p.set_active(n,True)
    style_label(p,pager+'/页码',x=0,y=-3*S,width=215*S,height=82*S,size=round(48*S),preview='1/1',align=1)
    p.save()
    r=Prefab('assets/resources/Prefabs/赠送记录对象.prefab');r.art(r.root,'gift_record_row_exact.png',0,0,882*S,113*S);r.disable(r.root,'cc.Widget');untint(r,r.root)
    for name,x,y,w,h,size,text,align in [('type',128,0,110,65,32,'赠送',1),('id',318,0,194,91,29,'小小羊\nID:659348',0),('count',576,0,132,68,40,'88',1),('time',789,0,200,68,31,'08/17 22:31',1)]:
        style_label(r,name,x=(x-470)*S,y=y,width=w*S,height=h*S,size=round(size*S),preview=text,align=align);r.disable(r.node(name),'cc.Widget')
    r.data[r.node('type')]['_color']={'__type__':'cc.Color','r':136,'g':237,'b':0,'a':255}
    a=r.node('头像');r.art(a,'transparent.png',(259.5-470)*S,0,87*S,88*S);r.disable(a,'cc.Widget')
    m=r.node('头像/mask');r.set_pos(m,0,0,81*S,82*S,disable_widget=True);_,mc=r.component(m,'cc.Mask');mc['_type']=1
    fill_parent(r,r.node('头像/mask/img'),81*S,82*S)
    try:front=r.node('头像/V8头像前框')
    except KeyError:front=unique_clone(r,r.root,a,'V8头像前框');r.hide_children(front)
    r.art(front,'gift_avatar_ring_exact.png',0,0,87*S,88*S,hide=True);r.disable(front,'cc.Widget');untint(r,front)
    r.save()
if __name__=='__main__':main()
