#!/usr/bin/env python3
"""Author the settlement review with shared V8-new materials, leaving cards intact."""
import copy
import argparse
from pathlib import Path
from apply_v7_prefab_skin import Prefab, ROOT
from apply_v7_lobby_exact import style_label, untint
from apply_v8_mine import unique_clone
from repair_v8_record_art import child, reset
from repair_v7_responsive_layout import top, bottom

PAGE='assets/resources/UI/panelRecordInfo.prefab'
ROW='assets/resources/Prefabs/回顾对象2.prefab'
TEXT_ROW='assets/resources/Prefabs/文字牌谱对象2.prefab'
OUT=ROOT/'art_sources/v8-repairs/review'
FONT={'__uuid__':'fd7307b2-666e-4c26-963d-59f787cad6fb'}
GOLD={'__type__':'cc.Color','r':255,'g':242,'b':216,'a':255}
DARK={'__type__':'cc.Color','r':6,'g':34,'b':53,'a':255}
PANEL='settlement_v8_list_panel.png'


def text(p,path,x,y,w,h,size,value=None,align=1,bold=False,dark=False):
    n=p.node(path);reset(p,n);p.disable(n,'cc.Widget')
    style_label(p,path,x=x,y=y,width=w,height=h,size=size,preview=value,align=align)
    p.component(n,'cc.Label')[1].update(_enabled=True,_lineHeight=size+2,
        _enableWrapText=False,_isSystemFontUsed=False,_styleFlags=1 if bold else 0,
        **{'_N$file':copy.deepcopy(FONT)})
    p.data[n]['_color']=copy.deepcopy(DARK if dark else GOLD)
    outline=p.component(n,'cc.LabelOutline')[1]
    outline.update(_enabled=not dark,_width=1,_color={'__type__':'cc.Color','r':2,'g':18,'b':31,'a':255})


def new_text(p,parent,name,template):
    try:return p.node(parent+'/'+name)
    except KeyError:return unique_clone(p,p.node(template),p.node(parent),name)


def art(p,path,asset,x,y,w,h,sliced=False):
    n=p.node(path);reset(p,n);p.art(n,asset,x,y,w,h,sliced=sliced);p.disable(n,'cc.Widget')


def apply():
    # Keep the entry state and all unaffected settlement data for review/QA.
    before=OUT/'before';before.mkdir(parents=True,exist_ok=True)
    for file in [PAGE,ROW,TEXT_ROW,'assets/scripts/UI/panelRecordInfo.ts']:
        dest=before/Path(file).name
        if not dest.exists():dest.write_bytes((ROOT/file).read_bytes())
    p=Prefab(PAGE);r='牌局回顾'
    bg=p.node(r+'/V7回顾长背景');reset(p,bg)
    p.sprite(bg,'lobby_scene_long_v8.png');top(p,r+'/V7回顾长背景',0,width=750,height=2353*750/941)
    title=p.node(r+'/title');reset(p,title);p.sprite(title,'personal_info2_header_bg_v8.png')
    top(p,r+'/title',0,width=750,height=72,stretch_x=True)
    art(p,r+'/title/关闭上上层/关闭','wallet_header_back_v8.png',0,0,45,43)
    p.set_active(p.node(r+'/title/关闭上上层/关闭'),True)
    new_text(p,r+'/title','V8标题文字',r+'/title/平台')
    text(p,r+'/title/V8标题文字',-205,0,210,52,34,'牌局回顾',bold=True)
    art(p,r+'/title/line',PANEL,0,-70,708,64,True)
    text(p,r+'/title/平台',-80,-70,270,42,26,align=0)
    p.set_pos(p.node(r+'/title/地九王'),-280,-70,100,38,disable_widget=True)
    # The legend follows the existing card highlights (yellow / coral).
    for key,x,color in [('图例1',142,(236,255,20)),('图例2',270,(255,79,49))]:
        n=p.node(r+'/title/'+key);reset(p,n);p.set_active(n,True)
        p.set_pos(n,x,-70,26,4,disable_widget=True)
        p.data[n]['_color']={'__type__':'cc.Color',**dict(zip('rgb',color)),'a':255}
        text(p,r+'/title/'+key+'/label',46,0,64,36,24)
    # Place the blank information plate behind its live labels and legend.
    ids=p.data[title]['_children'];plate=p.node(r+'/title/line')
    ids[:]=[{'__id__':plate}]+[ref for ref in ids if ref['__id__']!=plate]
    for path in [r+'/回顾列表',r+'/文字牌谱']:
        n=p.node(path);p.sprite(n,PANEL,sliced=True);untint(p,n)
    for section in ['1','2','3']:
        path=r+'/文字牌谱/view/content/'+section+'/标题'
        art(p,path,'money_v8_page_value.png',0,0,704,60,True)
        text(p,path+'/New Label',-225,0,220,42,28,bold=True,align=0)
        text(p,path+'/New Label copy',265,0,170,42,24)
    for name in ['牌局回顾','文字牌谱']:
        path=r+'/操作/'+name
        for state,asset,selected in [('Background',PANEL,False),('checkmark','wallet_v8_gold_button.png',True)]:
            art(p,path+'/'+state,asset,0,0,248,62,True)
            new_text(p,path+'/'+state,'V8标签文字',r+'/title/平台')
            text(p,path+'/'+state+'/V8标签文字',0,0,226,48,29,name,bold=True,dark=selected)
    pager=p.node(r+'/分页');p.disable(pager,'cc.Sprite');bottom(p,r+'/分页',25,width=708,height=80)
    for name,key,x in [('首页','first',-270),('上一页','prev',-158),('下一页','next',158),('尾页','last',270)]:
        p.set_pos(p.node(r+'/分页/'+name),x,0,88,84,disable_widget=True)
        art(p,r+'/分页/'+name+'/11','money_v8_page_'+key+'.png',0,0,72,72)
        p.set_active(p.node(r+'/分页/'+name+'/11'),True)
    n=child(p,pager,'V8页码底框');p.art(n,'money_v8_page_value.png',0,0,180,64,sliced=True)
    text(p,r+'/分页/页码',0,0,168,52,30)
    num=p.node(r+'/分页/页码');ids=p.data[pager]['_children']
    ids[:]=[ref for ref in ids if ref['__id__']!=num]+[{'__id__':num}]
    p.save()

    p=Prefab(ROW);p.sprite(p.root,PANEL,sliced=True);untint(p,p.root)
    # Correct the old inherited bottom-stretch Widget on the circular frame.
    for path,size in [('head',104),('V7头像框',118)]:
        p.set_pos(p.node(path),-277,24,size,size,disable_widget=True)
    p.set_pos(p.node('state'),-277,-30,72,32,disable_widget=True)
    text(p,'name',-277,-66,152,38,26,bold=True)
    for path,x in [('手牌/牌型1',-100),('手牌/牌型2',100)]:
        text(p,path,x,62,150,38,27)
    text(p,'三花',-20,62,180,38,27)
    for name,y in [('1',54),('2',0),('3',-54)]:
        text(p,'list/'+name,0,y,160,42,26)
    p.save()
    apply_text_rows()


def apply_text_rows():
    p=Prefab(TEXT_ROW)
    # Operation rows are transparent; round headings keep their blue panels.
    p.disable(p.root,'cc.Sprite')
    p.data[p.root]['_contentSize']['height']=58
    for path,x,w,align in [('name',-185,320,0),('操作',150,150,1),('剩余',283,100,1)]:
        text(p,path,x,0,w,40,24,align=align)
    n=child(p,p.root,'V8操作分隔线');reset(p,n)
    p.art(n,'settlement_row_exact.png',0,-28,676,2)
    p.disable(n,'cc.Widget')
    # Dynamic badges are 49x36, not square. RAW keeps every action's native ratio.
    n=p.node('决策');reset(p,n);p.set_pos(n,42,0,49,36,disable_widget=True)
    p.component(n,'cc.Sprite')[1].update(_type=0,_sizeMode=2,_isTrimmedMode=False)
    p.save()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--text-rows-only',action='store_true')
    args=parser.parse_args()
    (apply_text_rows if args.text_rows_only else apply)()
    print('V8-new settlement review saved; poker card nodes untouched.')
