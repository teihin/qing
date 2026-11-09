"""生成牌桌内「牌局优化」全屏面板 prefab（V8 贴图，正式资源引用）。

只新建 assets/resources/UI/panelGameOptimize.prefab 与 .meta，不改其它 prefab。
节点/组件模板取自现有 V8 面板，保证编辑器里直接可见、可编辑。
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/resources/UI/panelBossPlayerInfo.prefab"
SRC_PROGRESS = ROOT / "assets/resources/UI/panelGameView.prefab"
OUT = ROOT / "assets/resources/UI/panelGameOptimize.prefab"
META = ROOT / "assets/resources/UI/panelGameOptimize.prefab.meta"

SCRIPT_UUID = "8e4c1f2a-7b6d-4c58-9a31-6f0d2e5b8c74"
PREFAB_UUID = "c2f5a91e-3d47-4b82-8e60-1a9c7b4d2f35"

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
TITLE = "5414d11a-1a02-5138-a2d2-e36386d6ef3d"
BACK = "9136cacd-2829-52af-a9c6-bc8f0bf7ea68"
TAB_ON = "91a341b0-c173-4455-8c97-e470fc1cda87"
TAB_OFF = "88253e0e-4413-48f2-bf36-2742948efc1f"
PANEL = "56a8e1b0-c86f-5531-9cd5-50ecfb20846d"
BTN = "dc06eaa9-fee3-59d8-aff6-d12c4002d6d9"
ROW = "386e8835-90d7-5209-9403-938e4375fe43"
MODAL = "58adb709-a639-5853-ba6b-271f5aac7429"
BAR_SF = "14394789-5686-5222-a1a7-54cea1b48da1"
GOLD_BTN = "3e2b0c62-6ee2-5f85-9b82-1c22365fc6b6"

IVORY = (231, 240, 246)
MUTED = (170, 202, 224)
PLACEHOLDER = (78, 98, 118)
GOLD = (255, 227, 117)
DARK = (48, 30, 8)
GREEN = (120, 235, 150)

# ---- 根 ----
root = new_node("panelGameOptimize", None, 0, 0, 750, 1334)
widget(root, 45)
component(root, "cc.BlockInputEvents")
component(root, compress_uuid(SCRIPT_UUID))

bg = sprite("背景", root, BG, 0, 0, 750, 1334, False, (0, 0, 0), 130)
widget(bg, 45)

# ---- 标题栏 ----
title = sprite("标题栏", root, TITLE, 0, 631, 750, 72, False)
widget(title, 41)
label("标题文字", title, "牌局优化", 0, 0, 420, 52, 40, IVORY)
back = sprite("返回", title, BACK, -327, 0, 96, 72, False)
component(back, "cc.Button", {"_N$target": None, "_N$transition": 0}, clickEvents=[])
widget(back, 9, left=1)

# ---- 页签 ----
tabs = new_node("页签", root, 0, 545, 690, 56)
widget(tabs, 41, top=94)
chip("页签_运维优化", tabs, "运维优化", -260, 0, 170, 56, True)

# ---- 设置区 ----
settings = sprite("设置区", root, PANEL, 0, 317, 714, 360, True)
widget(settings, 41, left=18, right=18, top=170)
label("设置标题", settings, "设置玩家优化", -240, 148, 220, 32, 28, GOLD, 0)
label("范围标签", settings, "范围", -295, 102, 100, 32, 24, MUTED, 0)
chip("范围_个人", settings, "个人", -170, 102, 120, 46, True)
chip("范围_分组", settings, "分组", -40, 102, 120, 46, False)
label("说明", settings, "可选本房玩家或手动输入ID", 150, 102, 240, 30, 18, MUTED, 0)
label("对象标签", settings, "对象", -295, 46, 100, 32, 24, MUTED, 0)
button("对象选择", settings, "选择玩家", 40, 46, 520, 50)
label("概率标签", settings, "优化概率", -295, -8, 100, 30, 24, MUTED, 0)
editbox("概率输入", settings, -180, -8, 130, 44, "1-100", 3)
label("概率单位", settings, "%", -95, -8, 30, 30, 24, MUTED)
label("方向标签", settings, "目标方向", 0, -8, 110, 30, 24, MUTED)
chip("目标_赢", settings, "赢", 110, -8, 100, 44, True)
chip("目标_输", settings, "输", 220, -8, 100, 44, False)
label("金额标签", settings, "目标金额", -295, -62, 100, 30, 24, MUTED, 0)
editbox("金额输入", settings, -140, -62, 200, 44, "目标分数", 9)
label("金额单位", settings, "分", -25, -62, 30, 30, 24, MUTED)
button("提交", settings, "提交设置", 0, -124, 240, 54, True)
label("提示", settings, "", 0, -166, 660, 20, 19, MUTED)

# ---- 列表区 ----
list_area = sprite("列表区", root, PANEL, 0, -258, 714, 770, True)
widget(list_area, 45, left=18, right=18, top=540, bottom=24)
filters = [
    ("筛选_全部", "全部", -195, 107, 110, True),
    ("筛选_进行中", "进行中", -65, 237, 110, False),
    ("筛选_已达成", "已达成", 65, 367, 110, False),
    ("筛选_已停止", "已停止", 195, 497, 110, False),
    ("筛选_历史", "历史", 300, 612, 90, False),
]
for name, text, x, left, width, active in filters:
    chip_id = chip(name, list_area, text, x, 355, width, 44, active)
    widget(chip_id, 9, left=left, top=8)
list_scroll = scroll("列表", list_area, 0, -25, 694, 700)
widget(list_scroll, 45, left=10, right=10, top=60, bottom=10)
pager = new_node("分页", list_area, 0, -355, 690, 44, False)
widget(pager, 44, left=12, right=12, bottom=8)
button("历史上一页", pager, "上一页", -220, 0, 120, 42)
label("历史页码", pager, "第 1 / 1 页 · 共 0 条", 0, 0, 300, 40, 20, MUTED)
button("历史下一页", pager, "下一页", 220, 0, 120, 42)
label("空状态", list_area, "暂无优化记录", 0, -20, 520, 60, 26, MUTED)
label("加载", list_area, "加载中…", 0, -20, 400, 60, 24, MUTED)

content = None
for item in P[list_scroll]["_components"]:
    if P[item["__id__"]]["__type__"] == "cc.ScrollView":
        content = P[item["__id__"]]["content"]["__id__"]
row = sprite("行模板", content, ROW, 0, -52, 660, 104, True)
P[row]["_active"] = False
label("名字", row, "玩家昵称", -205, 30, 220, 30, 25, IVORY, 0)
label("副标题", row, "ID 000000 · 测试组", -205, 0, 220, 24, 18, MUTED, 0)
label("目标", row, "目标 赢500", 30, 30, 250, 30, 23, GOLD, 0)
label("概率", row, "概率 100%", 30, 0, 150, 24, 20, IVORY, 0)
label("进度", row, "进度 +320 / +500 · 剩 180 · 12局 · 已生效", -30, -24, 480, 24, 18, MUTED, 0)
progress_bar("进度条", row, -30, -44, 480, 10)
label("状态", row, "进行中", 250, 30, 120, 26, 21, GOLD, 1)
stop = button("停止", row, "停止", 250, -24, 110, 40)
stop_text = None
for item in P[stop]["_children"]:
    if P[item["__id__"]]["_name"] == "文字":
        stop_text = item["__id__"]
if stop_text is not None:
    P[stop_text]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 170, "b": 160, "a": 255}

# ---- 输出 ----
OUT.write_text(json.dumps(P, ensure_ascii=False, indent=2) + "\n")
META.write_text(json.dumps({
    "ver": "1.3.2", "uuid": PREFAB_UUID, "importer": "prefab",
    "optimizationPolicy": "AUTO", "asyncLoadAssets": False, "readonly": False, "subMetas": {}
}, ensure_ascii=False, indent=2) + "\n")
print("Objects:", len(P))
print("Root:", root, "ScriptType:", compress_uuid(SCRIPT_UUID))
