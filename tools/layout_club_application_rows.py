"""Separate application identity and action rows; preserve business node names."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'assets/resources/UI/panelMain.prefab'
A=json.loads(p.read_text())
def path(s):
 i=1
 for k in s.split('/'):i=next(c['__id__'] for c in A[i]['_children'] if A[c['__id__']]['_name']==k)
 return i
base='俱乐部申请弹窗/面板/列表/view/content/行模板'
def setnode(name,x,y,w,h):
 i=path(base+('/'+name if name else ''));n=A[i];n['_trs']['array'][:2]=[x,y];n['_contentSize'].update(width=w,height=h);return i
setnode('',0,-100,570,184)
setnode('头像',-226,35,72,72)
for name,y,h,size in [('姓名',57,40,28),('玩家ID',16,34,23)]:
 i=setnode(name,43,y,386,h)
 for c in A[i]['_components']:
  v=A[c['__id__']]
  if v['__type__']=='cc.Label':v['_N$horizontalAlign']=0;v['_fontSize']=size;v['_lineHeight']=size+7
for name,x in [('管理拒绝',-132),('管理同意',132)]:
 i=setnode(name,x,-53,230,54)
 for c in A[i]['_children']:
  n=A[c['__id__']]
  if n['_name']=='文字':
   n['_contentSize'].update(width=210,height=44)
   for co in n['_components']:
    v=A[co['__id__']]
    if v['__type__']=='cc.Label':v['_fontSize']=25;v['_lineHeight']=32
p.write_text(json.dumps(A,ensure_ascii=False,indent=2)+'\n')
