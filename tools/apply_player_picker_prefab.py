"""生成通用「选择玩家 / 选择分组」弹窗 prefab（V8 贴图，正式资源引用）。

只新建 assets/resources/UI/panelPlayerPicker.prefab 与 .meta，不改其它 prefab。
节点/组件模板取自现有 V8 面板，保证编辑器里直接可见、可编辑。
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/resources/UI/panelBossPlayerInfo.prefab"
SRC_PROGRESS = ROOT / "assets/resources/UI/panelGameView.prefab"
OUT = ROOT / "assets/resources/UI/panelPlayerPicker.prefab"
META = ROOT / "assets/resources/UI/panelPlayerPicker.prefab.meta"

SCRIPT_UUID = "a7d3e5c9-2b48-4f16-9c7a-5e1d8b3a6f02"
PREFAB_UUID = "d9b4f6a2-8c31-4e75-b0d2-7a6c1e9f4b58"

BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def compress_uuid(value):
    value = value.replace("-", "")
    out = []
    for i in range(5, 32, 3):
        number = int(value[i:i + 3], 16)
        out.append(BASE64[number >> 6])
        out.append(BASE64[number & 63])
    return value[:5] + "".join(out)


SRC_DATA = json.loads(SRC.read_text())
PROGRESS_DATA = json.loads(SRC_PROGRESS.read_text())


def template(kind):
    pool = SRC_DATA if kind != "cc.ProgressBar" else PROGRESS_DATA
    return copy.deepcopy(next(x for x in pool if isinstance(x, dict) and x.get("__type__") == kind))


P = [{
    "__type__": "cc.Prefab", "_name": "", "_objFlags": 0, "_native": "",
    "data": {"__id__": 1}, "optimizationPolicy": 0, "asyncLoadAssets": False, "readonly": False
}]


def add(value):
    P.append(value)
    return len(P) - 1


def prefab_info():
    return {
        "__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__id__": 0},
        "fileId": uuid.uuid4().hex[:22], "sync": False
    }


def new_node(name, parent, x=0.0, y=0.0, w=100.0, h=100.0, active=True,
             color=(255, 255, 255), opacity=255, anchor=(0.5, 0.5)):
    value = template("cc.Node")
    value.update(
        _name=name,
        _parent=None if parent is None else {"__id__": parent},
        _children=[],
        _components=[],
        _active=active,
        _opacity=opacity,
        _id="",
    )
    value["_contentSize"] = {"__type__": "cc.Size", "width": w, "height": h}
    value["_anchorPoint"] = {"__type__": "cc.Vec2", "x": anchor[0], "y": anchor[1]}
    value["_trs"]["array"] = [x, y, 0, 0, 0, 0, 1, 1, 1, 1]
    value["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
    index = add(value)
    if parent is not None:
        P[parent]["_children"].append({"__id__": index})
    P[index]["_prefab"] = {"__id__": add(prefab_info())}
    return index


def component(index, kind, values=None, **kwargs):
    if kind == compress_uuid(SCRIPT_UUID):
        value = {"__type__": kind, "_name": "", "_objFlags": 0,
                 "node": {"__id__": index}, "_enabled": True, "_id": ""}
        comp_index = add(value)
        P[index]["_components"].append({"__id__": comp_index})
        return comp_index
    value = template(kind)
    if values:
        value.update(values)
    value.update(kwargs)
    value["node"] = {"__id__": index}
    value["_id"] = ""
    comp_index = add(value)
    P[index]["_components"].append({"__id__": comp_index})
    return comp_index


def widget(index, flags, left=0, right=0, top=0, bottom=0):
    size = P[index]["_contentSize"]
    component(
        index, "cc.Widget", _alignFlags=flags, _left=left, _right=right, _top=top,
        _bottom=bottom, _verticalCenter=0, _horizontalCenter=0, _target=None,
        _originalWidth=size["width"], _originalHeight=size["height"],
    )


def sprite(name, parent, frame, x, y, w, h, sliced=True, color=(255, 255, 255),
           opacity=255, active=True):
    index = new_node(name, parent, x, y, w, h, active, color, opacity)
    component(index, "cc.Sprite", _spriteFrame={"__uuid__": frame},
              _type=1 if sliced else 0, _sizeMode=0, _isTrimmedMode=not sliced)
    return index


def sprite_comp(index):
    for item in P[index]["_components"]:
        co = P[item["__id__"]]
        if co["__type__"] == "cc.Sprite":
            return item["__id__"]
    return None


def label(name, parent, text, x, y, w, h, size=24, color=(231, 240, 246), align=1):
    index = new_node(name, parent, x, y, w, h, color=color)
    component(index, "cc.Label",
              {"_N$string": text, "_N$file": None, "_N$fontFamily": "Arial",
               "_N$horizontalAlign": align, "_N$verticalAlign": 1, "_N$overflow": 2},
              _string=text, _fontSize=size, _lineHeight=size + 6,
              _enableWrapText=False, _isSystemFontUsed=True, _spacingX=0)
    return index


def label_comp(index):
    for item in P[index]["_components"]:
        co = P[item["__id__"]]
        if co["__type__"] == "cc.Label":
            return item["__id__"]
    return None


def button(name, parent, text, x, y, w, h, gold=False):
    index = sprite(name, parent, GOLD_BTN if gold else BTN, x, y, w, h, True)
    component(index, "cc.Button", {"_N$target": None, "_N$transition": 0}, clickEvents=[])
    label("文字", index, text, 0, 0, w - 16, h - 6, 24, DARK if gold else IVORY)
    return index


def chip(name, parent, text, x, y, w, h, active=False):
    index = new_node(name, parent, x, y, w, h)
    on_id = sprite("底激活", index, TAB_ON, 0, 0, w, h, True)
    off_id = sprite("底非激活", index, TAB_OFF, 0, 0, w, h, True)
    text_id = label("文字", index, text, 0, 0, w - 8, h - 6, 22,
                    DARK if active else MUTED)
    P[on_id]["_active"] = active
    P[off_id]["_active"] = not active
    component(index, "cc.Button", {"_N$target": None, "_N$transition": 0}, clickEvents=[])
    return index


def editbox(name, parent, x, y, w, h, placeholder, max_length=8):
    index = sprite(name, parent, BTN, x, y, w, h, True, (18, 40, 64))
    text = label("文字", index, "", 0, 0, w - 20, h - 8, 22, IVORY, 0)
    hint = label("提示", index, placeholder, 0, 0, w - 20, h - 8, 18, PLACEHOLDER, 0)
    P[hint]["_opacity"] = 145
    P[text]["_active"] = True
    component(index, "cc.EditBox",
              {"_N$textLabel": {"__id__": label_comp(text)},
               "_N$placeholderLabel": {"__id__": label_comp(hint)},
               "_N$background": None, "_N$inputFlag": 5, "_N$inputMode": 2,
               "_N$stayOnTop": False},
              _string="", returnType=0, maxLength=max_length)
    return index


def progress_bar(name, parent, x, y, w, h):
    index = sprite(name, parent, BTN, x, y, w, h, True, (18, 40, 64))
    bar = sprite("bar", index, BAR_SF, 0, 0, w - 4, h - 4, True, GREEN)
    component(index, "cc.ProgressBar",
              {"_N$totalLength": w - 4, "_N$barSprite": {"__id__": sprite_comp(bar)},
               "_N$mode": 0, "_N$progress": 1, "_N$reverse": False})
    return index


def scroll(name, parent, x, y, w, h):
    index = new_node(name, parent, x, y, w, h)
    component(index, "cc.ScrollView",
              {"_N$horizontalScrollBar": None, "_N$verticalScrollBar": None},
              horizontal=False, vertical=True, inertia=True, brake=0.5,
              elastic=True, bounceDuration=1, scrollEvents=[], cancelInnerEvents=True)
    view = new_node("view", index, 0, 0, w, h)
    widget(view, 45)
    component(view, "cc.Mask", {"_N$alphaThreshold": 0, "_N$inverted": False},
              _type=0, _spriteFrame=None)
    content = new_node("content", view, 0, h / 2, w, h, anchor=(0.5, 1.0))
    scroll_comp = None
    for item in P[index]["_components"]:
        if P[item["__id__"]]["__type__"] == "cc.ScrollView":
            scroll_comp = item["__id__"]
    P[scroll_comp]["_N$content"] = {"__id__": content}
    P[scroll_comp]["content"] = {"__id__": content}
    return index


# ---- 色板与贴图 ----
BG = "a23235d1-15db-4b95-8439-a2e005bfff91"
MODAL = "58adb709-a639-5853-ba6b-271f5aac7429"
BTN = "dc06eaa9-fee3-59d8-aff6-d12c4002d6d9"
ROW = "386e8835-90d7-5209-9403-938e4375fe43"
GOLD_BTN = "3e2b0c62-6ee2-5f85-9b82-1c22365fc6b6"

IVORY = (231, 240, 246)
MUTED = (170, 202, 224)
PLACEHOLDER = (78, 98, 118)
GOLD = (255, 227, 117)
DARK = (48, 30, 8)

# ---- 根 ----
root = new_node("panelPlayerPicker", None, 0, 0, 750, 1334)
widget(root, 45)
component(root, "cc.BlockInputEvents")
component(root, compress_uuid(SCRIPT_UUID))

mask = sprite("遮罩", root, BG, 0, 0, 750, 1334, False, (0, 0, 0), 190)
widget(mask, 45)
component(mask, "cc.BlockInputEvents")

panel = sprite("面板", root, MODAL, 0, 0, 660, 900, True)
label("标题", panel, "选择玩家", 0, 405, 420, 55, 32, IVORY)
button("关闭", panel, "关闭", 255, 405, 110, 50)

manual = new_node("手动区", panel, 0, 340, 620, 50)
label("标签", manual, "玩家ID", -270, 0, 100, 40, 22, MUTED, 0)
editbox("ID输入", manual, -50, 0, 300, 46, "输入数字ID", 20)
button("确定ID", manual, "确定", 210, 0, 120, 46, True)
hint = label("手动提示", panel, "", 0, 292, 600, 24, 18, MUTED)
P[hint]["_active"] = False

list_node = scroll("列表", panel, 0, -80, 620, 700)
widget(list_node, 45, left=20, right=20, top=180, bottom=20)
empty = label("空状态", panel, "", 0, -80, 520, 60, 26, MUTED)
loading = label("加载", panel, "加载中…", 0, -80, 400, 60, 24, MUTED)
P[empty]["_active"] = False
P[loading]["_active"] = False

content = None
for item in P[list_node]["_components"]:
    if P[item["__id__"]]["__type__"] == "cc.ScrollView":
        content = P[item["__id__"]]["content"]["__id__"]
option = sprite("选项行", content, ROW, 0, -42, 600, 84, True)
P[option]["_active"] = False
label("文字", option, "选项", 0, 0, 560, 50, 26, IVORY, 0)
component(option, "cc.Button", {"_N$target": None, "_N$transition": 0}, clickEvents=[])

# ---- 输出 ----
OUT.write_text(json.dumps(P, ensure_ascii=False, indent=2) + "\n")
META.write_text(json.dumps({
    "ver": "1.3.2", "uuid": PREFAB_UUID, "importer": "prefab",
    "optimizationPolicy": "AUTO", "asyncLoadAssets": False, "readonly": False, "subMetas": {}
}, ensure_ascii=False, indent=2) + "\n")
print("Objects:", len(P))
print("Root:", root, "ScriptType:", compress_uuid(SCRIPT_UUID))
