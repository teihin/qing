"""Use the agent members page layout for the formal club members view."""
from pathlib import Path
exec((Path(__file__).with_name('apply_club_management_ui.py')).read_text().split("assert not any")[0])
base='俱乐部成员弹窗/面板'
def n(s):return path(base+'/'+s)
def size(i,x,y,w,h):A[i]['_trs']['array'][:2]=[x,y];A[i]['_contentSize'].update(width=w,height=h)
def frame(art):return json.loads((ROOT/f'assets/V7/{art}.png.meta').read_text())['subMetas'][art]['uuid']
def sf(i,art,typ=1):
 for c in A[i]['_components']:
  v=A[c['__id__']]
  if v['__type__']=='cc.Sprite':v['_spriteFrame']={'__uuid__':frame(art)};v['_type']=typ;v['_sizeMode']=0
def align(i,flags,top=0,bottom=0):
 old=next((c['__id__'] for c in A[i]['_components'] if A[c['__id__']]['__type__']=='cc.Widget'),None)
 if old is None:old=comp(i,'cc.Widget')
 A[old].update(_alignFlags=flags,_top=top,_bottom=bottom,_left=0,_right=0,_horizontalCenter=0,_verticalCenter=0,_target=None)
shade=path('俱乐部成员弹窗/遮罩');sf(shade,'lobby_scene_long_v8',0)
size(shade,0,-270.699,750,1875.398);A[shade]['_opacity']=255;A[shade]['_color'].update(r=255,g=255,b=255);align(shade,17)
panel=path(base);size(panel,0,0,750,1334);align(panel,45)
for c in A[panel]['_components']:
 if A[c['__id__']]['__type__']=='cc.Sprite':A[c['__id__']]['_enabled']=False
sf(n('标题底'),'nav_bar');size(n('标题底'),0,625,750,84);align(n('标题底'),17)
size(n('标题底/标题'),0,0,440,62)
close=n('管理关闭');size(close,-323,625,88,76);align(close,1,4)
for c in A[close]['_components']:
 if A[c['__id__']]['__type__']=='cc.Sprite':A[c['__id__']]['_enabled']=False
label('返回文字',close,'‹',0,0,78,70,52)
size(n('俱乐部信息'),0,538,690,48);align(n('俱乐部信息'),17,105)
size(n('统计'),-224,468,260,44);align(n('统计'),1,177)
size(n('管理申请'),220,468,235,64);align(n('管理申请'),1,167)
size(n('列表'),0,-38,714,930);align(n('列表'),21,240,164)
# The view stretches with the full-screen list on tall displays.
size(n('列表/view'),0,0,714,930);align(n('列表/view'),45)
content=n('列表/view/content');size(content,0,465,714,930);align(content,17)
row=n('列表/view/content/行模板');size(row,0,-55,690,100);sf(row,'agent_v8_button_base')
size(n('列表/view/content/行模板/头像'),-286,0,66,66)
size(n('列表/view/content/行模板/姓名'),-44,21,370,42)
size(n('列表/view/content/行模板/玩家ID'),-44,-21,370,32)
size(n('列表/view/content/行模板/身份'),257,0,130,40)
for name,x,w in [('管理上一页',-220,190),('管理下一页',220,190),('页码',0,170)]:
 size(n(name),x,-563,w,64);align(n(name),4,bottom=72)
size(n('管理刷新'),0,-633,180,44);align(n('管理刷新'),20,bottom=12)
p.write_text(json.dumps(A,ensure_ascii=False,indent=2)+'\n')
print('Full-screen club members updated')
