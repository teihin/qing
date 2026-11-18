#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
实时战绩 新美术落地：同步改写
  assets/Scenes/drh8.fire            (游戏运行时读取的节点树)
  assets/resources/UI/panelGameView.prefab
  assets/resources/Prefabs/带入记录.prefab  (战绩行模板)
  assets/resources/Prefabs/观战对象.prefab  (围观行模板)

只改表现层结构与 SpriteFrame；保留脚本引用的节点名/路径。
"""
import json, os, random, string, copy

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = json.load(open(os.path.join(ROOT_DIR, 'vibe_images/2026-11-18-realtime-record/frames.json')))
ASSET_DIR = 'assets/V8/realtime_record/'

TOP, MID, BOT, LEFT, CENTER, RIGHT = 1, 2, 4, 8, 16, 32

ID_CHARS = string.ascii_letters + string.digits + '+/'


def new_id(n=22):
    return ''.join(random.choice(ID_CHARS) for _ in range(n))


def frame(name):
    return FRAMES[name]


class Doc:
    def __init__(self, path, root_name=None):
        self.path = path
        self.d = json.load(open(path, encoding='utf-8'))
        self.root_name = root_name
        self.root = self._find_root() if root_name else 1
        # prefab info template：优先用根节点自身，保证 asset 指向当前 prefab/场景
        self.prefab_info = None
        root_info = self.d[self.root].get('_prefab')
        if root_info:
            self.prefab_info = copy.deepcopy(self.d[root_info['__id__']])
            self.prefab_info['fileId'] = new_id()
        if self.prefab_info is None:
            for child in self.d[self.root].get('_children', []):
                node = self.d[child['__id__']]
                if node.get('_prefab'):
                    self.prefab_info = copy.deepcopy(self.d[node['_prefab']['__id__']])
                    self.prefab_info['fileId'] = new_id()
                    break
        if self.prefab_info is None:
            self.prefab_info = {"__type__": "cc.PrefabInfo", "root": {"__id__": self.root},
                                "asset": None, "fileId": new_id(), "sync": False}

    # ---------- lookup ----------
    def _find_root(self):
        for i, o in enumerate(self.d):
            if o.get('__type__') == 'cc.Node' and o.get('_name') == self.root_name:
                return i
        raise RuntimeError('root node not found: ' + self.root_name)

    def child(self, parent, name):
        for c in self.d[parent].get('_children', []):
            if self.d[c['__id__']].get('_name') == name:
                return c['__id__']
        return None

    def find(self, path, root=None):
        cur = self.root if root is None else root
        for name in [p for p in path.split('/') if p]:
            cur = self.child(cur, name)
            if cur is None:
                return None
        return cur

    def comp(self, node, typ):
        for c in self.d[node].get('_components', []):
            o = self.d[c['__id__']]
            if o.get('__type__') == typ:
                return c['__id__']
        return None

    # ---------- build ----------
    def add_obj(self, obj):
        self.d.append(obj)
        return len(self.d) - 1

    def add_node(self, parent, name, x=0, y=0, w=0, h=0, active=True, opacity=255, color=None):
        info = copy.deepcopy(self.prefab_info)
        info['fileId'] = new_id()
        info_idx = self.add_obj(info)
        node = {
            "__type__": "cc.Node", "_name": name, "_objFlags": 0,
            "_parent": {"__id__": parent}, "_children": [], "_active": active,
            "_components": [], "_prefab": {"__id__": info_idx},
            "_opacity": opacity,
            "_color": color or {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_contentSize": {"__type__": "cc.Size", "width": w, "height": h},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                     "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_skewX": 0, "_skewY": 0, "_is3DNode": False,
            "_groupIndex": 0, "groupIndex": 0, "_id": new_id()
        }
        idx = self.add_obj(node)
        self.d[parent].setdefault('_children', []).append({"__id__": idx})
        return idx

    def add_sprite(self, node, frame_name, w=None, h=None):
        comp = {
            "__type__": "cc.Sprite", "_name": "", "_objFlags": 0,
            "node": {"__id__": node}, "_enabled": True,
            "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_spriteFrame": {"__uuid__": frame(frame_name)},
            "_type": 0, "_sizeMode": 0, "_fillType": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0,
            "_isTrimmedMode": False, "_atlas": None, "_id": new_id()
        }
        cidx = self.add_obj(comp)
        self.d[node].setdefault('_components', []).append({"__id__": cidx})
        if w is not None:
            self.d[node]['_contentSize']['width'] = w
            self.d[node]['_contentSize']['height'] = h
        return cidx

    def add_widget(self, node, flags, l=0, r=0, t=0, b=0, ow=0, oh=0):
        comp = {
            "__type__": "cc.Widget", "_name": "", "_objFlags": 0,
            "node": {"__id__": node}, "_enabled": True, "alignMode": 1,
            "_target": None, "_alignFlags": flags,
            "_left": l, "_right": r, "_top": t, "_bottom": b,
            "_verticalCenter": 0, "_horizontalCenter": 0,
            "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True,
            "_isAbsBottom": True, "_isAbsHorizontalCenter": True,
            "_isAbsVerticalCenter": True, "_originalWidth": ow,
            "_originalHeight": oh, "_id": new_id()
        }
        cidx = self.add_obj(comp)
        self.d[node].setdefault('_components', []).append({"__id__": cidx})
        return cidx

    def add_mask(self, node):
        comp = {
            "__type__": "cc.Mask", "_name": "", "_objFlags": 0,
            "node": {"__id__": node}, "_enabled": True,
            "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}],
            "_spriteFrame": None, "_type": 1, "_segments": 64,
            "_N$alphaThreshold": 0, "_N$inverted": False,
            "_id": new_id()
        }
        cidx = self.add_obj(comp)
        self.d[node].setdefault('_components', []).append({"__id__": cidx})
        return cidx

    def label_template(self, root=None):
        base = self.root if root is None else root
        stack = [base]
        while stack:
            cur = stack.pop()
            for c in self.d[cur].get('_components', []):
                o = self.d[c['__id__']]
                if o.get('__type__') == 'cc.Label':
                    return copy.deepcopy(o)
            for ch in self.d[cur].get('_children', []):
                stack.append(ch['__id__'])
        raise RuntimeError('no label template')

    def add_label(self, node, text, size=26, align=1, width=None, height=None,
                  color=None, line_height=None, overflow=1):
        comp = copy.deepcopy(self.template_label)
        comp['node'] = {"__id__": node}
        comp['_string'] = text
        comp['_N$string'] = text
        comp['_fontSize'] = size
        comp['_lineHeight'] = line_height or size + 4
        comp['_enableWrapText'] = False
        comp['_N$horizontalAlign'] = align
        comp['_N$verticalAlign'] = 1
        comp['_N$overflow'] = overflow
        comp['_N$cacheMode'] = 0
        comp['_id'] = new_id()
        cidx = self.add_obj(comp)
        self.d[node].setdefault('_components', []).append({"__id__": cidx})
        if width is not None:
            self.d[node]['_contentSize']['width'] = width
        if height is not None:
            self.d[node]['_contentSize']['height'] = height
        if color is not None:
            self.d[node]['_color'] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
        return cidx

    # ---------- mutate ----------
    def set_node(self, node, x=None, y=None, w=None, h=None, active=None, opacity=None, name=None):
        o = self.d[node]
        if x is not None:
            o['_trs']['array'][0] = x
        if y is not None:
            o['_trs']['array'][1] = y
        if w is not None:
            o['_contentSize']['width'] = w
        if h is not None:
            o['_contentSize']['height'] = h
        if active is not None:
            o['_active'] = active
        if opacity is not None:
            o['_opacity'] = opacity
        if name is not None:
            o['_name'] = name
        return o

    def set_sprite(self, node, frame_name, w=None, h=None, color=None):
        c = self.comp(node, 'cc.Sprite')
        if c is None:
            return self.add_sprite(node, frame_name, w, h)
        o = self.d[c]
        o['_enabled'] = True
        o['_spriteFrame'] = {"__uuid__": frame(frame_name)}
        o['_type'] = 0
        o['_sizeMode'] = 0
        if w is not None:
            self.d[node]['_contentSize']['width'] = w
        if h is not None:
            self.d[node]['_contentSize']['height'] = h
        if color is not None:
            self.d[node]['_color'] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
        return c

    def set_widget(self, node, flags=None, l=0, r=0, t=0, b=0, ow=None, oh=None):
        c = self.comp(node, 'cc.Widget')
        if c is None:
            return self.add_widget(node, flags if flags is not None else 0, l, r, t, b, ow or 0, oh or 0)
        o = self.d[c]
        if flags is not None:
            o['_alignFlags'] = flags
        o['_left'], o['_right'], o['_top'], o['_bottom'] = l, r, t, b
        o['alignMode'] = 1
        if ow is not None:
            o['_originalWidth'] = ow
        if oh is not None:
            o['_originalHeight'] = oh
        return c

    def set_label(self, node, text=None, size=None, align=None, width=None,
                  height=None, color=None, line_height=None):
        c = self.comp(node, 'cc.Label')
        if c is None:
            return None
        o = self.d[c]
        if text is not None:
            o['_string'] = text
            o['_N$string'] = text
        if size is not None:
            o['_fontSize'] = size
            o['_lineHeight'] = line_height or size + 4
        if align is not None:
            o['_N$horizontalAlign'] = align
        if width is not None:
            self.d[node]['_contentSize']['width'] = width
        if height is not None:
            self.d[node]['_contentSize']['height'] = height
        if color is not None:
            self.d[node]['_color'] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
        return c

    def drop_sprite(self, node):
        comps = self.d[node].get('_components', [])
        keep = []
        for c in comps:
            if self.d[c['__id__']].get('__type__') == 'cc.Sprite':
                continue
            keep.append(c)
        self.d[node]['_components'] = keep

    def reparent(self, node, new_parent, x, y):
        old = self.d[node].get('_parent', {}).get('__id__')
        if old is not None:
            kids = self.d[old].get('_children', [])
            self.d[old]['_children'] = [c for c in kids if c['__id__'] != node]
        self.d[new_parent].setdefault('_children', []).append({"__id__": node})
        self.d[node]['_parent'] = {"__id__": new_parent}
        self.d[node]['_trs']['array'][0] = x
        self.d[node]['_trs']['array'][1] = y

    def reorder(self, order_names):
        root = self.d[self.root]
        named = []
        for c in root['_children']:
            named.append((self.d[c['__id__']].get('_name'), c['__id__']))
        out = []
        by_name = {}
        for n, i in named:
            by_name.setdefault(n, []).append(i)
        for n in order_names:
            if n in by_name and by_name[n]:
                out.append({"__id__": by_name[n].pop(0)})
        for n, i in named:
            if i not in [x['__id__'] for x in out]:
                out.append({"__id__": i})
        root['_children'] = out

    def save(self):
        json.dump(self.d, open(self.path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


OBSCURE = [
    'bk', 'V8战绩底板', 'V8围观底板', 'label', 'txt', '总带入', '奖池',
    'txt copy', '总得分', 'title', 'V8标题线', 'V8标题线右', 'V8奖池标题',
    'V8概况横线', 'V8总带入标题', 'V8总得分标题', 'V8概况竖线',
    'V8表头nickname', 'V8表头buyin', 'V8表头score', 'V8表头countdown',
    'V8表头横线'
]


def layout_panel(doc):
    root = doc.root
    d = doc.d
    doc.template_label = doc.label_template()

    # 1) 底板
    bg = doc.find('bg')
    doc.set_sprite(bg, 'record_bg.png', 594, 1262)
    doc.set_node(bg, opacity=170, x=0)
    doc.set_widget(bg, TOP | BOT | LEFT, l=78, r=36, t=36, b=36, ow=594, oh=1262)

    for name in OBSCURE:
        n = doc.child(root, name)
        if n is not None:
            doc.set_node(n, active=False)

    # 2) 标题
    title = doc.child(root, '战绩标题')
    if title is None:
        title = doc.add_node(root, '战绩标题', x=-10, y=562, w=466, h=124)
    doc.set_node(title, x=-10, y=562, w=466, h=124, active=True)
    doc.set_sprite(title, 'record_title.png', 466, 124)
    doc.set_widget(title, TOP, t=68, ow=466, oh=124)

    # 3) 关闭按钮
    close = doc.child(root, '关闭上层')
    doc.set_node(close, x=252, y=592, w=56, h=56, active=True)
    doc.set_sprite(close, 'record_close.png', 58, 58)
    doc.set_widget(close, TOP, t=80, ow=56, oh=56)

    # 4) 表头
    header = doc.child(root, '表头')
    if header is None:
        header = doc.add_node(root, '表头', x=0, y=445, w=570, h=64)
    doc.set_node(header, x=0, y=445, w=570, h=64, active=True)
    if doc.comp(header, 'cc.Sprite') is None:
        doc.add_sprite(header, 'record_header.png', 570, 64)
    else:
        doc.set_sprite(header, 'record_header.png', 570, 64)
    doc.set_widget(header, TOP, t=212, ow=570, oh=64)

    cols = [('表头昵称', '昵称', -158), ('表头带入', '带入', -15),
            ('表头积分', '积分', 100), ('表头倒计时', '倒计时', 214)]
    for name, text, x in cols:
        n = doc.child(header, name)
        if n is None:
            n = doc.add_node(header, name, x=x, y=0, w=84, h=34)
            doc.add_label(n, text, size=26, align=1, width=84, height=34,
                          color=(255, 255, 255), overflow=1)
        else:
            doc.set_node(n, x=x, y=0, w=84, h=34)
            doc.set_label(n, text=text, size=26, align=1, width=84, height=34,
                          color=(255, 255, 255))

    for i, x in enumerate([-80, 45, 158]):
        name = '表头分隔%d' % (i + 1)
        n = doc.child(header, name)
        if n is None:
            n = doc.add_node(header, name, x=x, y=0, w=2, h=34)
            doc.add_sprite(n, 'record_v_divider.png', 2, 34)
        else:
            doc.set_node(n, x=x, y=0, w=2, h=34)
            doc.set_sprite(n, 'record_v_divider.png', 2, 34)

    # 5) 战绩列表
    lst = doc.child(root, '战绩列表')
    doc.set_node(lst, x=0, w=552, active=True)
    doc.set_widget(lst, TOP | BOT, t=292, b=352, ow=552, oh=690)
    d[lst]['_contentSize']['height'] = 690
    d[lst]['_trs']['array'][1] = 38

    lview = doc.child(lst, 'view')
    if lview is not None:
        doc.set_node(lview, w=552, h=690)
    lcontent = doc.child(lview, 'content') if lview is not None else None
    if lcontent is not None:
        clay = doc.comp(lcontent, 'cc.Layout')
        if clay is not None:
            o = d[clay]
            o['_N$layoutType'] = 2
            o['_resize'] = 1
            o['_N$cellSize'] = {"__type__": "cc.Size", "width": 552, "height": 70}
            o['_N$spacingY'] = 0
            o['_N$spacingX'] = 0
            o['_N$paddingTop'] = 0
            o['_N$paddingBottom'] = 0

    state = doc.child(root, 'V8列表状态')
    doc.set_node(state, x=0, y=87, w=480, h=40, active=True)
    doc.set_widget(state, TOP, t=616, ow=480, oh=40)
    doc.set_label(state, size=24, align=1, color=(160, 186, 208))

    # 6) 围观底板
    box = doc.child(root, '围观底板')
    if box is None:
        box = doc.add_node(root, '围观底板', x=0, y=-447, w=546, h=200)
        doc.add_sprite(box, 'record_watch_box.png', 546, 200)
        doc.add_widget(box, BOT, b=120, ow=546, oh=200)
    else:
        doc.set_node(box, x=0, y=-447, w=546, h=190, active=True)
        doc.set_sprite(box, 'record_watch_box.png', 546, 190)
        doc.set_widget(box, BOT, b=150, ow=546, oh=190)

    # 7) 围观标题行 (title2)
    t2 = doc.child(root, 'title2')
    doc.set_node(t2, x=0, y=-371, w=546, h=35, active=True)
    doc.set_widget(t2, BOT, b=290, ow=546, oh=35)
    doc.drop_sprite(t2)

    wt = doc.child(t2, '围观')
    doc.set_node(wt, x=-199, y=0, w=76, h=35, active=True)
    doc.set_sprite(wt, 'record_title_watch.png', 76, 35)

    line = doc.child(t2, 'V8分隔')
    doc.set_node(line, x=65, y=0, w=370, h=2, active=True)
    doc.set_sprite(line, 'record_gold_line.png', 370, 2)

    clock = doc.child(t2, 'V8时钟')
    if clock is not None:
        doc.set_node(clock, active=False)

    cd = doc.child(t2, '倒计时')
    doc.set_node(cd, x=228, y=0, w=90, h=30, active=False)
    doc.set_label(cd, size=20, align=2, width=90, color=(214, 230, 245))

    # 8) 围观列表：顶部对齐的网格列表，纵向滚动（行满自动换行，内容高度跟着 Layout 长）
    wl = doc.child(root, '围观列表')
    doc.set_node(wl, x=0, y=-476, w=500, h=122, active=True)
    doc.set_widget(wl, BOT, b=164, ow=500, oh=122)

    view = doc.child(wl, 'view')
    if view is not None:
        doc.set_node(view, w=500, h=122)
        mask = doc.comp(view, 'cc.Mask')
        if mask is not None:
            d[mask]['_enabled'] = True
            d[mask]['_type'] = 0
    content = doc.child(view, 'content')
    doc.set_node(content, y=61, w=500, h=0)
    d[content]['_anchorPoint']['y'] = 1
    lay = doc.comp(content, 'cc.Layout')
    if lay is not None:
        o = d[lay]
        o['_N$layoutType'] = 3
        o['_resize'] = 1
        o['_N$cellSize'] = {"__type__": "cc.Size", "width": 152, "height": 80}
        o['_N$spacingX'] = 6
        o['_N$spacingY'] = 6
        o['_N$paddingLeft'] = 16
        o['_N$paddingRight'] = 16
        o['_N$paddingTop'] = 2
        o['_N$paddingBottom'] = 2
        o['_N$startAxis'] = 0
        o['_N$verticalDirection'] = 1
        o['_N$horizontalDirection'] = 0
        o['_N$affectedByScale'] = False

    sb = doc.child(wl, 'V8滚动条')
    if sb is not None:
        doc.set_node(sb, active=False)

    # 9) 搓牌行：标题 + 金线 + 开关
    cuo_title = doc.child(root, '搓牌字')
    if cuo_title is None:
        cuo_title = doc.add_node(root, '搓牌字', x=-199, y=-611, w=76, h=33)
        doc.add_sprite(cuo_title, 'record_title_cuo.png', 76, 33)
        doc.add_widget(cuo_title, BOT, b=76, ow=76, oh=33)
    else:
        doc.set_node(cuo_title, x=-199, y=-611, w=76, h=33, active=True)
        doc.set_sprite(cuo_title, 'record_title_cuo.png', 76, 33)
        doc.set_widget(cuo_title, BOT, b=76, ow=76, oh=33)

    cuo_line = doc.child(root, '搓牌线')
    if cuo_line is None:
        cuo_line = doc.add_node(root, '搓牌线', x=-47, y=-611, w=204, h=5)
        doc.add_sprite(cuo_line, 'record_gold_line.png', 204, 5)
        doc.add_widget(cuo_line, BOT, b=94, ow=204, oh=5)
    else:
        doc.set_node(cuo_line, x=-47, y=-611, w=204, h=5, active=True)
        doc.set_sprite(cuo_line, 'record_gold_line.png', 204, 5)
        doc.set_widget(cuo_line, BOT, b=94, ow=204, oh=5)

    tog = doc.child(root, '搓牌开关')
    doc.set_node(tog, x=119, y=-611, w=100, h=50, active=True)
    doc.set_widget(tog, BOT, b=76, ow=100, oh=50)

    track = doc.child(tog, 'Background')
    doc.set_node(track, x=0, y=0, w=96, h=48, active=True)
    doc.set_sprite(track, 'record_toggle_track.png', 96, 48, color=(255, 255, 255))

    check = doc.child(tog, 'checkmark')
    if check is not None:
        doc.set_node(check, active=False)

    for old_name in ('搓牌', 'V8分隔'):
        oldn = doc.child(tog, old_name)
        if oldn is not None:
            doc.set_node(oldn, active=False)

    knob = doc.child(tog, '滑块')
    if knob is None:
        knob = doc.add_node(tog, '滑块', x=24, y=0, w=40, h=40)
        doc.add_sprite(knob, 'record_toggle_knob.png', 40, 40)
    else:
        doc.set_node(knob, x=24, y=0, w=40, h=40, active=True)
        doc.set_sprite(knob, 'record_toggle_knob.png', 40, 40)

    st = doc.child(tog, 'V8状态')
    doc.set_node(st, x=119, y=10, w=96, h=30, active=True)
    doc.set_label(st, size=20, align=1, width=96, color=(214, 230, 245))

    pr = doc.child(tog, 'V8价格')
    doc.set_node(pr, x=119, y=-12, w=110, h=24, active=True)
    doc.set_label(pr, size=16, align=1, width=110, color=(160, 190, 215))

    # 10) 层级：遮罩/底板在下，关闭键最上
    doc.reorder(['V8遮罩', 'bg', '围观底板', '表头', '战绩标题', '战绩列表',
                 'title2', '围观列表', 'V8列表状态', '搓牌字', '搓牌线',
                 '搓牌开关', '关闭上层'])


def build_row_prefab(path):
    doc = Doc(path)
    d = doc.d
    root = doc.root
    doc.template_label = doc.label_template()
    doc.set_node(root, w=552, h=60, active=True)
    wc = doc.comp(root, 'cc.Widget')
    if wc is not None:
        o = d[wc]
        o['_alignFlags'] = LEFT | RIGHT
        o['_left'] = 0
        o['_right'] = 0
        o['_originalWidth'] = 552
        o['_originalHeight'] = 60

    def ensure(name, x, y, w, h):
        n = doc.child(root, name)
        if n is None:
            n = doc.add_node(root, name, x=x, y=y, w=w, h=h)
        else:
            doc.set_node(n, x=x, y=y, w=w, h=h)
        return n

    base = ensure('底', 0, 0, 552, 60)
    if doc.comp(base, 'cc.Sprite') is None:
        doc.add_sprite(base, 'record_row.png', 552, 60)
    else:
        doc.set_sprite(base, 'record_row.png', 552, 60)

    alt = doc.child(root, 'V8隔行')
    if alt is not None:
        doc.drop_sprite(alt)
        doc.set_node(alt, active=False)

    selfbg = doc.child(root, 'V8本人底')
    doc.set_node(selfbg, x=0, y=0, w=552, h=60, active=False)
    doc.set_sprite(selfbg, 'record_row_self.png', 552, 60)

    dim = doc.child(root, 'V8结算底')
    if dim is None:
        dim = doc.add_node(root, 'V8结算底', x=0, y=0, w=552, h=60, active=False)
        doc.add_sprite(dim, 'record_row_dim.png', 552, 60)
    else:
        doc.set_node(dim, x=0, y=0, w=552, h=60, active=False)
        doc.set_sprite(dim, 'record_row_dim.png', 552, 60)

    head = doc.child(root, 'head')
    if head is None:
        head = doc.add_node(root, 'head', x=-251, y=0, w=44, h=44)
    doc.set_node(head, x=-251, y=0, w=44, h=44, active=True)
    if doc.comp(head, 'cc.Mask') is None:
        doc.add_mask(head)
    img = doc.child(head, 'img')
    if img is None:
        img = doc.add_node(head, 'img', x=0, y=0, w=44, h=44)
    doc.set_node(img, x=0, y=0, w=44, h=44, active=True)
    if doc.comp(img, 'cc.Sprite') is None:
        doc.add_sprite(img, 'record_avatar_ring.png', 44, 44)
    isp = doc.comp(img, 'cc.Sprite')
    d[isp]['_spriteFrame'] = {"__uuid__": "3200ca5e-29f4-43ba-8407-fa039dbaed6e"}

    ring = doc.child(root, 'ring')
    if ring is None:
        ring = doc.child(head, 'ring')
        if ring is not None:
            doc.reparent(ring, root, -238, 0)
    if ring is None:
        ring = doc.add_node(root, 'ring', x=-251, y=0, w=72, h=72)
        doc.add_sprite(ring, 'record_avatar_ring.png', 72, 72)
    else:
        doc.set_node(ring, x=-251, y=0, w=72, h=72, active=True)
        doc.set_sprite(ring, 'record_avatar_ring.png', 72, 72)

    name = doc.child(root, 'name')
    doc.set_node(name, x=-158, y=0, w=140, h=34, active=True)
    doc.set_label(name, size=24, align=0, width=140, color=(244, 248, 255))

    inl = doc.child(root, 'in')
    doc.set_node(inl, x=-15, y=0, w=110, h=34, active=True)
    doc.set_label(inl, size=26, align=2, width=110, color=(244, 248, 255))

    score = doc.child(root, 'score')
    doc.set_node(score, x=100, y=0, w=120, h=34, active=True)
    doc.set_label(score, size=27, align=2, width=120, color=(255, 112, 117))

    cd = doc.child(root, 'countdown')
    doc.set_node(cd, x=214, y=0, w=96, h=34, active=True)
    doc.set_label(cd, size=26, align=2, width=96, color=(244, 248, 255))

    me = doc.child(root, 'V8本人')
    if me is not None:
        doc.set_node(me, active=False)
        doc.drop_sprite(me)

    left = doc.child(root, 'V8离桌')
    doc.set_node(left, x=-158, y=-24, w=140, h=18, active=False)
    doc.set_label(left, size=12, align=0, width=140, color=(133, 158, 179))

    # 分隔线不再需要
    sep = doc.child(root, 'V8分隔')
    if sep is not None:
        doc.set_node(sep, active=False)
        doc.drop_sprite(sep)

    alt = doc.child(root, 'V8隔行')
    if alt is not None:
        doc.set_node(alt, w=552, h=60)

    # 子节点顺序
    order = ['底', 'V8隔行', 'V8本人底', 'V8结算底', 'head', 'ring', 'name', 'in',
             'score', 'countdown', 'V8本人', 'V8离桌', 'V8分隔']
    named = {d[c['__id__']].get('_name'): c['__id__'] for c in d[root]['_children']}
    d[root]['_children'] = [{"__id__": named[n]} for n in order if n in named]
    for c in d[root]['_children']:
        if c['__id__'] not in [named[n] for n in order if n in named]:
            d[root]['_children'].append(c)

    doc.save()
    print('row prefab ok', path)


def build_watch_prefab(path):
    doc = Doc(path)
    d = doc.d
    root = doc.root
    doc.template_label = doc.label_template()
    doc.set_node(root, w=150, h=78, active=True)

    def ensure(name, x, y, w, h):
        n = doc.child(root, name)
        if n is None:
            n = doc.add_node(root, name, x=x, y=y, w=w, h=h)
        else:
            doc.set_node(n, x=x, y=y, w=w, h=h)
        return n

    head = ensure('head', -38, 0, 62, 62)
    if doc.comp(head, 'cc.Mask') is None:
        doc.add_mask(head)
    img = doc.child(head, 'img')
    if img is None:
        img = doc.add_node(head, 'img', x=0, y=0, w=62, h=62)
    doc.set_node(img, x=0, y=0, w=62, h=62)
    if doc.comp(img, 'cc.Sprite') is None:
        doc.add_sprite(img, 'record_avatar_ring.png', 62, 62)

    # 优先复用已经指向 record_avatar_ring 的那个环；根下还有旧版 92×92 同名节点，
    # 直接用 child() 可能选中旧环，把新环留成第二个叠着画。
    ring = None
    for c in d[root]['_children']:
        if d[c['__id__']].get('_name') != 'V8头像框':
            continue
        sp = doc.comp(c['__id__'], 'cc.Sprite')
        if sp is not None and (d[sp].get('_spriteFrame') or {}).get('__uuid__') == frame('record_avatar_ring.png'):
            ring = c['__id__']
            break
    if ring is None:
        ring = doc.child(root, 'V8头像框')
    if ring is None:
        ring = doc.child(head, 'V8头像框')
        if ring is not None:
            doc.reparent(ring, root, -38, 0)
    if ring is None:
        ring = doc.add_node(root, 'V8头像框', x=-38, y=0, w=100, h=100)
        doc.add_sprite(ring, 'record_avatar_ring.png', 100, 100)
    else:
        doc.set_node(ring, x=-38, y=0, w=100, h=100)
        doc.set_sprite(ring, 'record_avatar_ring.png', 100, 100)

    # 根下还有一个旧版 92×92「V8头像框」（V7 环，位置 y=17），和新环叠着画会让头像发糊；
    # 只保留 record_avatar_ring 的那个，其余同名节点隐藏但留在文件里便于回退。
    ring_uuid = frame('record_avatar_ring.png')
    for c in d[root]['_children']:
        cid = c['__id__']
        if d[cid].get('_name') != 'V8头像框' or cid == ring:
            continue
        sp = doc.comp(cid, 'cc.Sprite')
        keep = sp is not None and (d[sp].get('_spriteFrame') or {}).get('__uuid__') == ring_uuid
        if not keep:
            doc.set_node(cid, active=False)

    name = ensure('name', 32, 0, 74, 34)
    doc.set_label(name, size=22, align=0, width=74, color=(233, 242, 252))

    order_ids = []
    for n in ['head', 'V8头像框', 'name']:
        for c in d[root]['_children']:
            if d[c['__id__']].get('_name') == n and c['__id__'] not in order_ids:
                order_ids.append(c['__id__'])
                break
    rest = [c for c in d[root]['_children'] if c['__id__'] not in order_ids]
    d[root]['_children'] = [{"__id__": i} for i in order_ids] + rest

    doc.save()
    print('watch prefab ok', path)


if __name__ == '__main__':
    scene = Doc(os.path.join(ROOT_DIR, 'assets/Scenes/drh8.fire'), 'panelGameView')
    # 定位实时战绩子树
    panel = scene.find('实时战绩')
    scene.root = panel
    layout_panel(scene)
    scene.save()
    print('scene ok')

    prefab = Doc(os.path.join(ROOT_DIR, 'assets/resources/UI/panelGameView.prefab'), 'panelGameView')
    prefab.root = prefab.find('实时战绩')
    layout_panel(prefab)
    prefab.save()
    print('panelGameView prefab ok')

    build_row_prefab(os.path.join(ROOT_DIR, 'assets/resources/Prefabs/带入记录.prefab'))
    build_watch_prefab(os.path.join(ROOT_DIR, 'assets/resources/Prefabs/观战对象.prefab'))
