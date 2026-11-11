"""我的红利：加「业绩股」页签（正式 Prefab，编辑器可见）。

页签沿用游戏设置的胶囊底；业绩股页由输入区、下级代理列表、底部合计组成。
所有新增/挪动节点都带 cc.Widget，按 1334 设计稿写 top/bottom 偏移。
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMyHongli.prefab"
GOLD_PAD = ROOT / "assets/resources/UI/panelClubGoldPad.prefab"

A = json.loads(PREFAB.read_text())
assert not any(isinstance(x, dict) and x.get("_name") == "页签_业绩股" for x in A), "already applied"

TAB_ON = "91a341b0-c173-4455-8c97-e470fc1cda87"
TAB_OFF = "88253e0e-4413-48f2-bf36-2742948efc1f"
LIST_FRAME = "V7/hongli_v8_list_frame"
TABLE_HEADER = "V7/hongli_v8_table_header"
CLAIM_BAR = "V7/club_settings_row_v8"
ROW_BG = "V7/agent_v8_row"
RULE_V = "V7/hongli_v8_rule_v"
BTN_EXTRACT = "V7/hongli_v8_btn_extract"
AVATAR_FRAME = "V7/player_info_v8_avatar_frame"
DEFAULT_AVATAR_UUID = "3200ca5e-29f4-43ba-8407-fa039dbaed6e"

IVORY = (231, 240, 246)
MUTED = (170, 202, 224)
GOLD = (255, 227, 117)
ACTIVE_TEXT = (48, 30, 8)
IDLE_TEXT = (169, 192, 214)


def template(t):
    return next(copy.deepcopy(x) for x in A if x.get("__type__") == t)


def path(s):
    i = 1
    for name in s.split("/"):
        i = next(c["__id__"] for c in A[i]["_children"] if A[c["__id__"]]["_name"] == name)
    return i


def add(v):
    A.append(v)
    return len(A) - 1


def comp(i, t, **kw):
    v = template(t)
    v.update(kw)
    v["_enabled"] = True
    v["node"] = {"__id__": i}
    v["_id"] = ""
    j = add(v)
    A[i]["_components"].append({"__id__": j})
    return j


def node(name, parent, x=0, y=0, w=100, h=100, active=True, color=(255, 255, 255)):
    v = template("cc.Node")
    v.update(_name=name, _parent={"__id__": parent}, _children=[], _components=[],
             _active=active, _opacity=255, _id="")
    v["_contentSize"].update(width=w, height=h)
    v["_anchorPoint"].update(x=.5, y=.5)
    v["_trs"]["array"] = [x, y, 0, 0, 0, 0, 1, 1, 1, 1]
    v["_color"].update(r=color[0], g=color[1], b=color[2], a=255)
    v["_prefab"] = {"__id__": add({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                                   "asset": {"__id__": 0}, "fileId": uuid.uuid4().hex[:22],
                                   "sync": False})}
    i = add(v)
    A[parent]["_children"].append({"__id__": i})
    return i


def frame_uuid(art):
    meta = json.loads((ROOT / f"assets/{art}.png.meta").read_text())
    return meta["subMetas"][Path(art).name]["uuid"]


def sprite(name, parent, art, x, y, w, h, sliced=True):
    i = node(name, parent, x, y, w, h)
    comp(i, "cc.Sprite", _spriteFrame={"__uuid__": frame_uuid(art)},
         _type=1 if sliced else 0, _sizeMode=0)
    return i


def label(name, parent, text, x, y, w, h, size=26, color=IVORY):
    i = node(name, parent, x, y, w, h, color=color)
    comp(i, "cc.Label", **{"_string": text, "_N$string": text, "_fontSize": size,
                           "_lineHeight": size + 7, "_N$file": None, "_isSystemFontUsed": True,
                           "_N$fontFamily": "Arial", "_N$horizontalAlign": 1, "_N$verticalAlign": 1,
                           "_N$overflow": 2, "_spacingX": 0, "_enableWrapText": False})
    return i


def button(name, parent, text, art, x, y, w, h, text_color=IVORY, size=26):
    i = sprite(name, parent, art, x, y, w, h, False)
    comp(i, "cc.Button", clickEvents=[])
    label("文字", i, text, 0, 0, w - 16, h - 12, size, text_color)
    return i


def widget(i, flags, top=0, bottom=0, left=0, right=0, hc=0, vc=0):
    comp(i, "cc.Widget", _alignFlags=flags, _top=top, _bottom=bottom, _left=left, _right=right,
         _horizontalCenter=hc, _verticalCenter=vc, _target=None, _originalWidth=0, _originalHeight=0)


# ---------------------------------------------------------------- 红页签内容下移
# 页签占 84~140，红利内容整体下移 55，列表区域靠上下拉伸吸收。
SHIFT = 55
for name, key, old in [
        ("统计", "_top", 94.5),
        ("未领取底", "_top", 203),
        ("未领取红利", "_top", 216.262),
        ("提取红利", "_top", 212.093),
        ("记录", "_top", 212.093),
        ("列表面板", "_top", 293),
        ("表头", "_top", 300.263),
        ("列表", "_top", 390.263)]:
    i = path(name)
    for c in A[i]["_components"]:
        co = A[c["__id__"]]
        if co.get("__type__") == "cc.Widget":
            assert abs(co[key] - old) < 0.01, f"{name} widget changed: {co[key]}"
            co[key] = old + SHIFT

# ---------------------------------------------------------------- 页签
tab_root = node("页签", 1, 0, 555, 460, 56)
widget(tab_root, 17, top=84)
for name, text, x, art, color in [
        ("页签_我的红利", "我的红利", -106, TAB_ON, ACTIVE_TEXT),
        ("页签_业绩股", "业绩股", 106, TAB_OFF, IDLE_TEXT)]:
    i = node(name, tab_root, x, 0, 200, 56)
    comp(i, "cc.Sprite", _spriteFrame={"__uuid__": art}, _type=1, _sizeMode=0)
    comp(i, "cc.Button", clickEvents=[])
    label("文字", i, text, 0, 0, 180, 50, 26, color)

# ---------------------------------------------------------------- 业绩股页
perf = node("业绩股页", 1, 0, 0, 750, 1334, active=False)
widget(perf, 45)

input_row = node("输入区", perf, 0, 0, 680, 100)
widget(input_row, 17, top=148)

# 输入框（复制上下分弹窗的 EditBox 结构，保留原生输入能力），「ID」叠在框内左侧。
src = json.loads(GOLD_PAD.read_text())
src_map = {}


def clone_node(sid, parent):
    s = src[sid]
    n = copy.deepcopy(s)
    n["_children"] = []
    n["_components"] = []
    n["_parent"] = {"__id__": parent}
    n["_id"] = ""
    n["_prefab"] = {"__id__": add({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                                   "asset": {"__id__": 0}, "fileId": uuid.uuid4().hex[:22],
                                   "sync": False})}
    nid = add(n)
    src_map[sid] = nid
    for c in s.get("_components") or []:
        co = copy.deepcopy(src[c["__id__"]])
        co["node"] = {"__id__": nid}
        co["_id"] = ""
        cid = add(co)
        src_map[c["__id__"]] = cid
        A[nid]["_components"].append({"__id__": cid})
    for c in s.get("_children") or []:
        child = clone_node(c["__id__"], nid)
        A[nid]["_children"].append({"__id__": child})
    return nid


def remap(v):
    if isinstance(v, dict):
        if "__id__" in v and v["__id__"] in src_map:
            v["__id__"] = src_map[v["__id__"]]
            return
        for x in v.values():
            remap(x)
    elif isinstance(v, list):
        for x in v:
            remap(x)


clone_start = len(A)
edit_root = clone_node(46, input_row)
A[input_row]["_children"].append({"__id__": edit_root})
for cloned in range(clone_start, len(A)):
    remap(A[cloned])
A[edit_root]["_name"] = "代理ID输入"
A[edit_root]["_contentSize"].update(width=680, height=96)
A[edit_root]["_trs"]["array"][:2] = [0, 0]

for nid in [src_map[56], src_map[48], src_map[52]]:
    A[nid]["_contentSize"].update(width=680, height=96)
    A[nid]["_trs"]["array"][:2] = [0, 0]
label("ID文字", input_row, "ID", -280, 0, 60, 50, 30, GOLD)

edit_comp = next(A[c["__id__"]] for c in A[edit_root]["_components"]
                 if A[c["__id__"]].get("__type__") == "cc.EditBox")
edit_comp.update({"maxLength": 12, "_N$inputMode": 2, "_N$inputFlag": 5,
                  "_N$fontSize": 26, "fontSize": 26,
                  "_N$placeholderFontSize": 24, "placeholderFontSize": 24,
                  "_N$fontColor": {"__type__": "cc.Color", "r": 255, "g": 244, "b": 220, "a": 255},
                  "fontColor": {"__type__": "cc.Color", "r": 255, "g": 244, "b": 220, "a": 255},
                  "_N$placeholderFontColor": {"__type__": "cc.Color", "r": 120, "g": 154, "b": 182, "a": 255},
                  "placeholderFontColor": {"__type__": "cc.Color", "r": 120, "g": 154, "b": 182, "a": 255}})
placeholder = next(A[c["__id__"]] for c in A[src_map[52]]["_components"]
                   if A[c["__id__"]].get("__type__") == "cc.Label")
placeholder.update({"_string": "请输入下级代理ID", "_N$string": "请输入下级代理ID",
                    "_fontSize": 24, "_lineHeight": 31, "_N$horizontalAlign": 1, "_N$overflow": 2})
text_label = next(A[c["__id__"]] for c in A[src_map[48]]["_components"]
                  if A[c["__id__"]].get("__type__") == "cc.Label")
text_label.update({"_fontSize": 26, "_lineHeight": 33, "_N$horizontalAlign": 1, "_N$overflow": 2})

button("确认添加业绩", perf, "确认添加", BTN_EXTRACT, 0, 0, 220, 80, ACTIVE_TEXT)
btn = path("业绩股页/确认添加业绩")
widget(btn, 17, top=262)

# 列表底/表头/列表/合计条：统一用顶部偏移，列表靠上下拉伸。
frame = sprite("业绩列表底", perf, LIST_FRAME, 0, 0, 660, 700, True)
widget(frame, 45, top=350, bottom=192, left=45, right=45)

header = sprite("业绩表头", perf, TABLE_HEADER, 0, 0, 640, 70, False)
widget(header, 17, top=360)
label("下级代理", header, "下级代理", -160, 0, 240, 44, 26, IVORY)
label("昨日占比", header, "昨日占比", 215, 0, 200, 44, 26, IVORY)
rule = sprite("列分隔", header, RULE_V, 15, 0, 2, 40, False)
A[rule]["_color"].update(r=207, g=177, b=112)

list_node = node("业绩列表", perf, 0, 0, 646, 700)
widget(list_node, 45, top=438, bottom=196, left=52, right=52)
comp(list_node, "cc.ScrollView", horizontal=False, vertical=True, scrollEvents=[], inertia=True)
view = node("视口", list_node, 0, 0, 646, 700)
widget(view, 45)
comp(view, "cc.Mask", _type=0, _spriteFrame=None)
content = node("内容", view, 0, 350, 646, 700)
A[content]["_anchorPoint"]["y"] = 1
sv = next(A[c["__id__"]] for c in A[list_node]["_components"]
          if A[c["__id__"]].get("__type__") == "cc.ScrollView")
sv["_N$content"] = {"__id__": content}
sv["content"] = {"__id__": content}
sv["_N$horizontalScrollBar"] = None
sv["_N$verticalScrollBar"] = None

row = sprite("记录行", content, ROW_BG, 0, -48, 646, 96, True)
A[row]["_active"] = False
avatar = node("头像", row, -275, 0, 64, 64)
comp(avatar, "cc.Sprite", _spriteFrame={"__uuid__": frame_uuid(AVATAR_FRAME)}, _type=0, _sizeMode=0)
mask = node("mask", avatar, 0, 0, 56, 56)
comp(mask, "cc.Mask", _type=1, _spriteFrame=None)
widget(mask, 45)
img = node("img", mask, 0, 0, 56, 56)
comp(img, "cc.Sprite", _spriteFrame={"__uuid__": DEFAULT_AVATAR_UUID}, _type=0, _sizeMode=0)
widget(img, 45)
label("昵称", row, "玩家昵称", -70, 18, 300, 38, 26, IVORY)
label("玩家ID", row, "ID:000000", -70, -19, 300, 32, 20, MUTED)
label("占比", row, "0.00%", 245, 0, 130, 44, 28, GOLD)

hint = label("业绩提示", perf, "", 0, -119, 520, 60, 26, MUTED)
A[hint]["_active"] = False
widget(hint, 18, vc=-119)

total_bar = sprite("业绩合计", perf, CLAIM_BAR, 0, 0, 660, 64, False)
widget(total_bar, 20, bottom=132)
label("合计标题", total_bar, "业绩总比例", -270, 0, 140, 44, 22, MUTED)
label("我的占比", total_bar, "我 0.00%", -125, 0, 120, 44, 24, IVORY)
label("下放占比", total_bar, "下放 0.00%", 30, 0, 150, 44, 24, IVORY)
label("剩余占比", total_bar, "剩 0.00%", 185, 0, 120, 44, 24, GOLD)

# 提取确认弹窗必须在最上层，不能被后加的页签/业绩股页盖住。
claim = path("提取红利面板")
children = A[1]["_children"]
children.append(children.pop(next(k for k, c in enumerate(children) if c["__id__"] == claim)))

PREFAB.write_text(json.dumps(A, ensure_ascii=False, indent=2) + "\n")
print("Objects:", len(A))
