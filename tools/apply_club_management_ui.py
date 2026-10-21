"""Append formal club management UI, reusing existing art; no positional template IDs."""
import copy
import json
import uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'assets/resources/UI/panelMain.prefab'
A=json.loads(p.read_text())
def template(t): return next(copy.deepcopy(x) for x in A if x.get('__type__')==t)
def path(s):
 i=1
 for name in s.split('/'):
  i=next(c['__id__'] for c in A[i]['_children'] if A[c['__id__']]['_name']==name)
 return i
def add(v): A.append(v);return len(A)-1
def comp(i,t,**kw):
 v=template(t);v.update(kw);v['node']={'__id__':i};v['_id']='';j=add(v);A[i]['_components'].append({'__id__':j});return j
def node(name,parent,x=0,y=0,w=100,h=100,active=True,color=(255,255,255)):
 v=template('cc.Node');v.update(_name=name,_parent={'__id__':parent},_children=[],_components=[],_active=active,_opacity=255,_id='')
 v['_contentSize'].update(width=w,height=h);v['_anchorPoint'].update(x=.5,y=.5)
 v['_trs']['array']=[x,y,0,0,0,0,1,1,1,1];v['_color'].update(r=color[0],g=color[1],b=color[2],a=255)
 v['_prefab']={'__id__':add({'__type__':'cc.PrefabInfo','root':{'__id__':1},'asset':{'__id__':0},'fileId':uuid.uuid4().hex[:22],'sync':False})}
 i=add(v);A[parent]['_children'].append({'__id__':i});return i
def sprite(name,parent,art,x,y,w,h,sliced=True):
 i=node(name,parent,x,y,w,h);meta=json.loads((ROOT/f'assets/V7/{art}.png.meta').read_text())
 comp(i,'cc.Sprite',_spriteFrame={'__uuid__':meta['subMetas'][art]['uuid']},_type=1 if sliced else 0,_sizeMode=0);return i
def label(name,parent,text,x,y,w,h,size=26,color=(255,238,197)):
 i=node(name,parent,x,y,w,h,color=color);kw={'_string':text,'_N$string':text,'_fontSize':size,'_lineHeight':size+7,'_N$file':None,'_isSystemFontUsed':True,'_N$fontFamily':'Arial','_N$horizontalAlign':1,'_N$verticalAlign':1,'_N$overflow':2,'_spacingX':0}
 comp(i,'cc.Label',**kw);return i
def button(name,parent,text,x,y,w=180,h=60,gold=False):
 i=sprite(name,parent,'original_dialog_button_gold' if gold else 'original_dialog_button_blue',x,y,w,h)
 comp(i,'cc.Button',clickEvents=[])
 # Serialized Cocos target must not reference the source button.
 A[-1]['_N$target']=None
 label('文字',i,text,0,0,w-16,h-8,22 if h < 50 else 25,(14,46,74) if gold else (255,238,197));return i
def dot(parent,x,y):
 i=label('红点',parent,'●',x,y,30,30,28,(246,73,72));A[i]['_active']=False
 return i
def widget(i,flags,top=0): comp(i,'cc.Widget',_alignFlags=flags,_top=top,_bottom=0,_left=0,_right=0,_horizontalCenter=0,_verticalCenter=0,_target=None)
def modal(name,title,height):
 r=node(name,1,w=750,h=1334,active=False);widget(r,45)
 s=sprite('遮罩',r,'nav_bar',0,0,750,1334,False);A[s]['_color'].update(r=0,g=7,b=16);A[s]['_opacity']=190;widget(s,45)
 comp(s,'cc.BlockInputEvents')
 panel=sprite('面板',r,'original_dialog_panel',0,0,660,height)
 tb=sprite('标题底',panel,'original_dialog_title',0,height/2-9,390,76)
 label('标题',tb,title,0,0,350,60,34)
 close=sprite('管理关闭',panel,'popup_close_exact',289,height/2-39,50,50,False);comp(close,'cc.Button',clickEvents=[]);A[-1]['_N$target']=None
 return panel
assert not any(x.get('_name')=='当前俱乐部' for x in A),'already applied'
card=sprite('当前俱乐部',path('Main/我的'),'original_dialog_panel',0,-432,680,190)
widget(card,17,top=1004)
label('栏目',card,'当前俱乐部',-235,56,175,40,24,(195,220,235))
label('名称',card,'暂无俱乐部',65,56,390,42,29)
label('ID',card,'从俱乐部选择后查看信息',-65,13,410,34,23,(201,225,237))
label('身份',card,'',238,13,135,34,23)
member=button('管理成员',card,'俱乐部成员',-216,-48,198);dot(member,88,25)
button('管理退出',card,'退出俱乐部',0,-48,198)
button('管理解散',card,'解散俱乐部',216,-48,198)
# A subtle badge is also visible on the Mine tab before opening it.
dot(path('Down/我的'),32,35)
for kind,title in [('成员','俱乐部成员'),('申请','入会申请')]:
 panel=modal('俱乐部'+kind+'弹窗',title,940)
 label('俱乐部信息',panel,'当前俱乐部',0,386,570,42,25)
 if kind=='成员':
  b=button('管理申请',panel,'入会申请',185,324,205,58);dot(b,89,22)
  label('统计',panel,'成员列表',-150,324,230,40,25,(197,224,237))
 else:
  button('管理返回成员',panel,'返回成员',-185,324,205,58)
  label('统计',panel,'待审批申请',150,324,250,40,25,(197,224,237))
 listnode=node('列表',panel,0,-16,590,594)
 view=node('view',listnode,w=590,h=594);comp(view,'cc.Mask',_type=0,_spriteFrame=None)
 content=node('content',view,0,297,590,594);A[content]['_anchorPoint']['y']=1
 ci=comp(listnode,'cc.ScrollView',horizontal=False,vertical=True,scrollEvents=[],inertia=True)
 A[ci]['_N$content']={'__id__':content};A[ci]['content']={'__id__':content}
 A[ci]['_N$horizontalScrollBar']=None;A[ci]['_N$verticalScrollBar']=None
 row=sprite('行模板',content,'original_dialog_panel',0,-70,570,132);A[row]['_active']=False
 avatar=node('头像',row,-235,14,66,66)
 src=A[path('Main/我的/信息/头像/mask')]['_children'][0]['__id__']
 sf=next(A[c['__id__']]['_spriteFrame'] for c in A[src]['_components'] if A[c['__id__']]['__type__']=='cc.Sprite')
 comp(avatar,'cc.Sprite',_spriteFrame=copy.deepcopy(sf),_sizeMode=0)
 label('姓名',row,'玩家昵称',-26,28,320,40,28)
 label('玩家ID',row,'ID: 000000',-26,-11,320,32,23,(200,226,239))
 if kind=='成员':label('身份',row,'成员',207,8,100,40,23)
 else:
  button('管理拒绝',row,'拒绝',60,-35,115,46)
  button('管理同意',row,'同意',197,-35,115,46,True)
 label('空状态',panel,'暂无成员信息' if kind=='成员' else '暂无入会申请',0,-12,530,65,27,(199,225,238))
 button('管理上一页',panel,'上一页',-190,-386,170,60)
 label('页码',panel,'1 / 1',0,-386,160,44,25)
 button('管理下一页',panel,'下一页',190,-386,170,60)
 button('管理刷新',panel,'刷新列表',0,-445,180,44)
panel=modal('俱乐部操作确认','操作确认',410)
label('内容',panel,'确认操作？',0,28,555,134,28)
button('管理取消',panel,'取消',-151,-124,234,68)
button('管理确认',panel,'确认',151,-124,234,68,True)
p.write_text(json.dumps(A,ensure_ascii=False,indent=2)+'\n')
print('Objects:',len(A))
