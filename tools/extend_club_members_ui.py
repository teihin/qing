"""Readable member summary plus balance and member action controls."""
from pathlib import Path
exec((Path(__file__).with_name('apply_club_management_ui.py')).read_text().split("assert not any")[0])
base='俱乐部成员弹窗/面板'
def size(i,x,y,w,h):A[i]['_trs']['array'][:2]=[x,y];A[i]['_contentSize'].update(width=w,height=h)
assert not any(n.get('_name')=='成员概况底板' for n in A),'already applied'
panel=path(base)
bg=sprite('成员概况底板',panel,'agent_v8_button_base',0,507,714,150)
widget(bg,17,top=85)
children=A[panel]['_children'];children.remove({'__id__':bg});children.insert(2,{'__id__':bg})
info=path(base+'/俱乐部信息')
for c in A[info]['_components']:
 v=A[c['__id__']]
 if v['__type__']=='cc.Label':v['_fontSize']=28;v['_lineHeight']=35
row=path(base+'/列表/view/content/行模板');size(row,0,-89,690,166)
for name,x,y,w,h in [('头像',-280,25,70,70),('姓名',-43,42,360,42),('玩家ID',-43,1,360,32),('身份',240,45,170,36)]:
 size(path(base+'/列表/view/content/行模板/'+name),x,y,w,h)
label('余额',row,'余额 —',232,1,202,34,23)
for name,title,x in [('成员删除','删除',-222),('成员赠予','赠予',0),('成员设管理员','设为管理员',222)]:
 button(name,row,title,x,-53,202,46)
p.write_text(json.dumps(A,ensure_ascii=False,indent=2)+'\n')
print('Member summary and actions written')
