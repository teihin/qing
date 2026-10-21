"""Refine the club identity card using existing sliced blue art."""
from pathlib import Path
exec((Path(__file__).with_name('apply_club_management_ui.py')).read_text().split("assert not any")[0])
card=path('Main/我的/当前俱乐部')
assert not any(A[c['__id__']]['_name']=='操作' for c in A[card]['_children']), 'already refined'
def frame(art):return json.loads((ROOT/f'assets/V7/{art}.png.meta').read_text())['subMetas'][art]['uuid']
def setnode(i,x,y,w,h):
 A[i]['_trs']['array'][:2]=[x,y];A[i]['_contentSize'].update(width=w,height=h)
def restyle(i,art):
 for c in A[i]['_components']:
  v=A[c['__id__']]
  if v['__type__']=='cc.Sprite':v['_spriteFrame']={'__uuid__':frame(art)};v['_type']=1
setnode(card,0,-437,670,200)
restyle(card,'agent_v8_button_base')
for c in A[card]['_components']:
 if A[c['__id__']]['__type__']=='cc.Widget':A[c['__id__']]['_top']=1004
for name,x,y,w,h,size in [('栏目',-60,77,290,28,19),('名称',-15,39,380,44,31),('ID',-60,1,290,28,21),('身份',238,43,140,38,23)]:
 i=path('Main/我的/当前俱乐部/'+name);setnode(i,x,y,w,h)
 for c in A[i]['_components']:
  v=A[c['__id__']]
  if v['__type__']=='cc.Label':v['_fontSize']=size;v['_lineHeight']=size+6;v['_N$horizontalAlign']=1 if name=='身份' else 0
sprite('俱乐部徽记',card,'club_members_v8',-270,35,76,74,False)
ops=node('操作',card,0,-55,616,64)
for name in ['管理成员','管理退出','管理解散']:
 i=path('Main/我的/当前俱乐部/'+name)
 A[card]['_children']=[c for c in A[card]['_children'] if c['__id__']!=i]
 A[ops]['_children'].append({'__id__':i});A[i]['_parent']={'__id__':ops}
 setnode(i,0,0,192,64);restyle(i,'agent_v8_button_base')
 for c in A[i]['_children']:
  child=A[c['__id__']]
  if child['_name']=='文字':
   child['_contentSize'].update(width=180,height=50)
   for co in child['_components']:
    t=A[co['__id__']]
    if t['__type__']=='cc.Label':t['_fontSize']=24;t['_lineHeight']=31
income=button('管理收益',ops,'我的收益',0,0,192,64)
restyle(income,'agent_v8_button_base')
A[ops]['_children'].sort(key=lambda c:['管理成员','管理收益','管理退出','管理解散'].index(A[c['__id__']]['_name']))
comp(ops,'cc.Layout',_enabled=True,_resize=1,**{'_N$layoutType':1,'_N$paddingLeft':0,'_N$paddingRight':0,'_N$paddingTop':0,'_N$paddingBottom':0,'_N$spacingX':16,'_N$spacingY':0,'_N$horizontalDirection':0})
# Owner is the editor preview; runtime switches by account permissions.
for c in A[ops]['_children']:A[c['__id__']]['_active']=A[c['__id__']]['_name']!='管理退出'
for c in A[path('Main/我的/操作')]['_children']:
 if A[c['__id__']]['_name']=='代理':A[c['__id__']]['_active']=False
p.write_text(json.dumps(A,ensure_ascii=False,indent=2)+'\n')
print('Refined club card:',len(A))
