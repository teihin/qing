"""我的红利：业绩股列表加「盟主授权」按钮（正式 Prefab，编辑器可见）。

v6 下发列表新增 leaders（总群主视角的联盟盟主节点），需要在行内直接授权。
按业务要求只授权、不提供取消；已授权时按钮显示不可点的「已授权」。
本脚本只给 记录行 模板追加一个 授权按钮，行内容与按钮状态由 panelMyHongli.ts 控制。
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMyHongli.prefab"

A = json.loads(PREFAB.read_text())


def path(s):
    i = 1
    for name in s.split("/"):
        i = next(c["__id__"] for c in A[i]["_children"] if A[c["__id__"]]["_name"] == name)
    return i


# 注意：红利列表和业绩股列表各有一个「记录行」，这里必须取业绩股页下的模板。
ROW = path("业绩股页/业绩列表/视口/内容/记录行")
assert any(A[c["__id__"]].get("_name") == "头像" for c in A[ROW]["_children"]), \
    "业绩股记录行结构不符合预期"
assert not any(A[c["__id__"]].get("_name") == "授权按钮" for c in A[ROW]["_children"]), \
    "already applied"

TAB_ON = "V8/game_settings/gs_tab_on"
IVORY = (231, 240, 246)
ACTIVE_TEXT = (48, 30, 8)


def template(t):
    return next(copy.deepcopy(x) for x in A if x.get("__type__") == t)


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


def sprite(name, parent, art, x, y, w, h):
    i = node(name, parent, x, y, w, h)
    comp(i, "cc.Sprite", _spriteFrame={"__uuid__": frame_uuid(art)}, _type=1, _sizeMode=0)
    return i


def label(name, parent, text, x, y, w, h, size=22, color=IVORY):
    i = node(name, parent, x, y, w, h, color=color)
    comp(i, "cc.Label", **{"_string": text, "_N$string": text, "_fontSize": size,
                           "_lineHeight": size + 6, "_N$file": None, "_isSystemFontUsed": True,
                           "_N$fontFamily": "Arial", "_N$horizontalAlign": 1, "_N$verticalAlign": 1,
                           "_N$overflow": 2, "_spacingX": 0, "_enableWrapText": False})
    return i


btn = sprite("授权按钮", ROW, TAB_ON, 270, 0, 96, 44)
comp(btn, "cc.Button", clickEvents=[])
label("文字", btn, "授权", 0, 0, 80, 36, 22, ACTIVE_TEXT)

# 模板行现在是盟主行样式：占比左移，给右侧授权按钮让位（普通成员行由脚本运行时复位）。
PERCENT = path("业绩股页/业绩列表/视口/内容/记录行/占比")
A[PERCENT]["_trs"]["array"][0] = 155

# 总群主既要能填下级代理，也要能填联盟盟主 ID。
PLACEHOLDER = path("业绩股页/输入区/代理ID输入/PLACEHOLDER_LABEL")
for c in A[PLACEHOLDER]["_components"]:
    item = A[c["__id__"]]
    if item.get("__type__") == "cc.Label":
        item["_string"] = item["_N$string"] = "请输入代理ID/盟主ID"

PREFAB.write_text(json.dumps(A, ensure_ascii=False, indent=2))
print(f"added 授权按钮 under 记录行 ({ROW}); objects={len(A)}")
