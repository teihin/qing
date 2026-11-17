"""俱乐部「我的成员」上半区新增：整线积分 / 未提红利 汇总条。

- 复用历史遗留的「成员概况底板」节点，换成本次 AI 出的胶囊底框；
- 子节点：金币 + 美术字 + 位图数字、分隔线、钱袋 + 美术字 + 位图数字；
- 成员列表整体下移 104，为汇总条让位（上下都按 Widget 贴边，长屏自动适配）。
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'assets/resources/UI/panelMain.prefab'
A = json.loads(p.read_text())


def template(t):
    return next(copy.deepcopy(x) for x in A if x.get('__type__') == t)


def path(s):
    i = 1
    for name in s.split('/'):
        i = next(c['__id__'] for c in A[i]['_children'] if A[c['__id__']]['_name'] == name)
    return i


def add(v):
    A.append(v)
    return len(A) - 1


def comp(i, t, **kw):
    v = template(t)
    v.update(kw)
    v['node'] = {'__id__': i}
    v['_id'] = ''
    j = add(v)
    A[i]['_components'].append({'__id__': j})
    return j


def node(name, parent, x=0, y=0, w=100, h=100, active=True, color=(255, 255, 255)):
    v = template('cc.Node')
    v.update(_name=name, _parent={'__id__': parent}, _children=[], _components=[],
             _active=active, _opacity=255, _id='')
    v['_contentSize'].update(width=w, height=h)
    v['_anchorPoint'].update(x=.5, y=.5)
    v['_trs']['array'] = [x, y, 0, 0, 0, 0, 1, 1, 1, 1]
    v['_color'].update(r=color[0], g=color[1], b=color[2], a=255)
    v['_prefab'] = {'__id__': add({'__type__': 'cc.PrefabInfo', 'root': {'__id__': 1},
                                   'asset': {'__id__': 0}, 'fileId': uuid.uuid4().hex[:22], 'sync': False})}
    i = add(v)
    A[parent]['_children'].append({'__id__': i})
    return i


def sprite(name, parent, art, x, y, w, h, sliced=False):
    i = node(name, parent, x, y, w, h)
    meta = json.loads((ROOT / f'assets/V7/{art}.png.meta').read_text())
    comp(i, 'cc.Sprite', _spriteFrame={'__uuid__': meta['subMetas'][art]['uuid']},
         _type=1 if sliced else 0, _sizeMode=0)
    return i


def digits(name, parent, text, x, y, w, h, size=52):
    i = node(name, parent, x, y, w, h)
    comp(i, 'cc.Label', **{
        '_string': text, '_N$string': text, '_fontSize': size, '_lineHeight': int(size * 1.12),
        '_N$file': {'__uuid__': '204a1055-7dc3-5fc0-8da6-8ad6816bf68e'}, '_isSystemFontUsed': False,
        '_enableWrapText': False, '_N$horizontalAlign': 1, '_N$verticalAlign': 1,
        '_N$overflow': 2, '_spacingX': 0})
    return i


def widget(i, flags, top=0, bottom=0):
    comp(i, 'cc.Widget', _alignFlags=flags, _top=top, _bottom=bottom, _left=0, _right=0,
         _horizontalCenter=0, _verticalCenter=0, _target=None)


base = '俱乐部成员弹窗/面板'
bar = path(base + '/成员概况底板')
if A[bar].get('_contentSize', {}).get('height') == 100:
    raise SystemExit('already applied')

# ---- 汇总条本体 -------------------------------------------------------
A[bar]['_contentSize'].update(width=690, height=100)
A[bar]['_trs']['array'][:2] = [0, 364]
bar_meta = json.loads((ROOT / 'assets/V7/club_v8_summary_bar.png.meta').read_text())
for c in A[bar]['_components']:
    v = A[c['__id__']]
    if v['__type__'] == 'cc.Sprite':
        v['_spriteFrame'] = {'__uuid__': bar_meta['subMetas']['club_v8_summary_bar']['uuid']}
        v['_type'] = 0
        v['_sizeMode'] = 0
    elif v['__type__'] == 'cc.Widget':
        v['_top'] = 253
        v['_isAbsTop'] = True

sprite('积分图标', bar, 'club_v8_summary_coin', -286, 2, 66, 60)
sprite('积分标题', bar, 'club_v8_summary_t1', -140, 22, 114, 30)
digits('积分数值', bar, '0', -124, -20, 240, 56)
sprite('分隔线', bar, 'agent_v8_solid', 5, 0, 2, 60)
A[path(base + '/成员概况底板/分隔线')]['_color'].update(r=176, g=222, b=255)
sprite('红利图标', bar, 'club_v8_summary_bag', 111, 0, 64, 70)
sprite('红利标题', bar, 'club_v8_summary_t2', 235, 22, 114, 30)
digits('红利数值', bar, '0', 241, -20, 240, 56)

# ---- 列表下移 104 让位（Widget 上贴 364 / 364.5，下贴边不变） ----------
for name, top, y, h in [('成员列表底板', 364, -136, 878), ('列表', 364.5, -125, 855)]:
    i = path(base + '/' + name)
    A[i]['_trs']['array'][1] = y
    A[i]['_contentSize']['height'] = h
    for c in A[i]['_components']:
        v = A[c['__id__']]
        if v['__type__'] == 'cc.Widget':
            v['_top'] = top
# 空状态跟着列表中心一起下移
A[path(base + '/空状态')]['_trs']['array'][1] -= 52

p.write_text(json.dumps(A, ensure_ascii=False, indent=2) + '\n')
print('summary bar added:', bar)
