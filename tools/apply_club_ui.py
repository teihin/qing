"""Add the approved club home and two dialogs to panelMain.prefab (Cocos 2.4)."""

import copy
import json
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"
A = json.loads(PREFAB.read_text())


def frame(name):
    meta = json.loads((ROOT / f"assets/V7/{name}.png.meta").read_text())
    return meta["subMetas"][name]["uuid"]


def append(value):
    A.append(value)
    return len(A) - 1


def file_info():
    value = copy.deepcopy(A[126])
    value["fileId"] = uuid.uuid4().hex[:22]
    return append(value)


def node(name, parent, x=0, y=0, w=100, h=100, active=True, color=None, opacity=255):
    value = copy.deepcopy(A[2459])
    value["_name"] = name
    value["_parent"] = {"__id__": parent}
    value["_children"] = []
    value["_components"] = []
    value["_active"] = active
    value["_contentSize"]["width"] = w
    value["_contentSize"]["height"] = h
    value["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    value["_trs"]["array"][0:2] = [x, y]
    value["_opacity"] = opacity
    value["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255} if color else {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    value["_prefab"] = {"__id__": file_info()}
    idx = append(value)
    A[parent]["_children"].append({"__id__": idx})
    return idx


def component(target, template):
    value = copy.deepcopy(A[template])
    value["node"] = {"__id__": target}
    idx = append(value)
    A[target]["_components"].append({"__id__": idx})
    return idx


def sprite(name, parent, source, x, y, w, h, sliced=False, active=True, opacity=255, color=None):
    idx = node(name, parent, x, y, w, h, active, color, opacity)
    ci = component(idx, 124)
    A[ci]["_spriteFrame"] = {"__uuid__": frame(source)}
    A[ci]["_type"] = 1 if sliced else 0
    A[ci]["_sizeMode"] = 0
    return idx


def label(name, parent, value, x, y, w, h, size=30, color=(255, 238, 197), outline=False):
    idx = node(name, parent, x, y, w, h, color=color)
    ci = component(idx, 2460)
    text = A[ci]
    text["_string"] = value
    text["_N$string"] = value
    text["_fontSize"] = size
    text["_lineHeight"] = size + 7
    text["_spacingX"] = 0
    text["_N$file"] = None
    text["_isSystemFontUsed"] = True
    text["_N$fontFamily"] = "Arial"
    text["_N$horizontalAlign"] = 1
    text["_N$verticalAlign"] = 1
    text["_N$overflow"] = 2
    if outline:
        component(idx, 2461)
    return idx


def button(target):
    component(target, 304)
    return target


def widget(target, template, flags, top=0, bottom=0):
    ci = component(target, template)
    w = A[ci]
    w["_alignFlags"] = flags
    w["_top"] = top
    w["_bottom"] = bottom
    w["_horizontalCenter"] = 0
    w["_originalWidth"] = A[target]["_contentSize"]["width"]
    w["_originalHeight"] = A[target]["_contentSize"]["height"]
    return ci


def clone_input(parent, name, x, y, width, placeholder, max_length, numeric=False):
    # Copy the existing real EditBox and all its text/background children.
    nodes = [1940, 1941, 1945, 1950]
    order = []
    for old in nodes:
        order.append(old)
        order.extend(c["__id__"] for c in A[old].get("_components", []))
        order.append(A[old]["_prefab"]["__id__"])
    remap = {old: len(A) + index for index, old in enumerate(order)}

    def replace(v):
        if isinstance(v, dict):
            if set(v) == {"__id__"}:
                return {"__id__": remap.get(v["__id__"], v["__id__"])}
            return {k: replace(x) for k, x in v.items()}
        if isinstance(v, list):
            return [replace(x) for x in v]
        return v

    for old in order:
        value = replace(copy.deepcopy(A[old]))
        if value.get("__type__") == "cc.PrefabInfo":
            value["fileId"] = uuid.uuid4().hex[:22]
        append(value)
    root = remap[1940]
    A[root]["_parent"] = {"__id__": parent}
    A[parent]["_children"].append({"__id__": root})
    A[root]["_name"] = name
    A[root]["_trs"]["array"][0:2] = [x, y]
    for old in nodes:
        cur = A[remap[old]]
        cur["_contentSize"]["width"] = width if old in (1940, 1941) else width - 20
    for old in (1945, 1950):
        text_node = A[remap[old]]
        text_node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
        text_node["_trs"]["array"][0:2] = [0, 0]
        text_node["_components"] = [{"__id__": remap[old + 1]}]
    A[remap[1941]]["_components"] = [{"__id__": remap[1942]}]
    A[remap[1942]]["_spriteFrame"] = {"__uuid__": frame("popup_join_room_input_exact")}
    A[remap[1942]]["_type"] = 1
    edit = next(A[c["__id__"]] for c in A[root]["_components"] if A[c["__id__"]]["__type__"] == "cc.EditBox")
    edit["maxLength"] = max_length
    edit["_N$inputFlag"] = 5
    edit["_N$inputMode"] = 3 if numeric else 6
    for old in (1946, 1951):
        comp = A[remap[old]]
        comp["_N$file"] = None
        comp["_isSystemFontUsed"] = True
        comp["_N$horizontalAlign"] = 1
        comp["_N$verticalAlign"] = 1
        comp["_fontSize"] = 27
    A[remap[1951]]["_string"] = placeholder
    A[remap[1951]]["_N$string"] = placeholder
    return root


def full_root(name, parent, active):
    idx = node(name, parent, 0, 0, 750, 1334, active)
    widget(idx, 322, 45)
    return idx


def dialog(name, title, height):
    root = full_root(name, 1, False)
    shade = sprite("遮罩", root, "nav_bar", 0, 0, 750, 1334, color=(0, 7, 16), opacity=190)
    widget(shade, 322, 45)
    blocker = {"__type__": "cc.BlockInputEvents", "_name": "", "_objFlags": 0,
               "node": {"__id__": shade}, "_enabled": True, "_id": ""}
    A[shade]["_components"].append({"__id__": append(blocker)})
    panel = sprite("面板", root, "original_dialog_panel", 0, 0, 620, height, sliced=True)
    title_bg = sprite("标题底", panel, "original_dialog_title", 0, height / 2 - 9, 390, 76, sliced=True)
    label("标题", title_bg, title, 0, 0, 360, 60, 36, outline=True)
    close = sprite("关闭俱乐部弹窗", panel, "popup_close_exact", 270, height / 2 - 38, 54, 54)
    button(close)
    return root, panel


assert not any(x.get("__type__") == "cc.Node" and x.get("_name") == "俱乐部" for x in A), "club UI already exists"

# Keep existing controls; the replacement strip contains the club slot itself.
wallet = A[728]
wallet["_name"] = "俱乐部"
A[747]["_enabled"] = False
nav_art = node("俱乐部导航底图", 701, 0, 0, 750, A[701]["_contentSize"]["height"])
component(nav_art, 851)
sprite("完整导航图", nav_art, "club_nav_bar_v8", 0, 0, 750, 250)
A[701]["_children"] = [{"__id__": nav_art}] + [c for c in A[701]["_children"] if c["__id__"] != nav_art]

# Club home uses the same lobby background sprite frame UUID, no duplicate PNG.
page = full_root("俱乐部", 2, False)
bg = sprite("V8大厅完整背景", page, "lobby_scene_long_v8", 0, -270.699256, 750, 1875.398512)
widget(bg, 125, 17)
shield = sprite("8L盾牌", page, "lobby_shield_v8_exact", 0, 452, 200, 240)
widget(shield, 125, 17, top=95)
heading = label("俱乐部标题", page, "俱乐部", 0, 268, 440, 65, 48, outline=True)
widget(heading, 125, 17, top=367)
subtitle = label("俱乐部副标题", page, "与牌友一起 享受更精彩的扑克之旅", 0, 222, 630, 38, 22)
widget(subtitle, 125, 17, top=426)

for name, x, art, caption in (
    ("创建俱乐部", -171, "club_trophy_v8", "邀请好友 共建牌友圈"),
    ("加入俱乐部", 171, "club_members_v8", "输入俱乐部ID 加入牌友"),
):
    card = sprite(name, page, "original_dialog_panel", x, -15, 325, 435, sliced=True)
    button(card)
    sprite("主视觉", card, art, 0, 64, 274, 264)
    label("名称", card, name, 0, -138, 302, 54, 35, outline=True)
    label("说明", card, caption, 0, -186, 308, 32, 19, color=(199, 228, 239))

my_title = label("我的俱乐部标题", page, "我的俱乐部", 0, -292, 500, 55, 38, outline=True)
widget(my_title, 748, 20, bottom=348)
list_node = node("俱乐部列表", page, 0, -414, 680, 178)
widget(list_node, 748, 20, bottom=164)
view = node("view", list_node, 0, 0, 680, 178)
component(view, 851)
content = node("content", view, 0, 89, 680, 178)
A[content]["_anchorPoint"]["y"] = 1
scroll = component(list_node, 856)
A[scroll]["_N$content"] = {"__id__": content}
A[scroll]["content"] = {"__id__": content}
row = sprite("俱乐部条目模板", content, "original_dialog_panel", 0, -63, 660, 118, sliced=True, active=False)
A[row]["_anchorPoint"]["y"] = 1
button(row)
sprite("徽记", row, "club_members_v8", -260, -59, 83, 76)
label("俱乐部名称", row, "", -57, -42, 340, 45, 29, outline=True)
label("俱乐部ID", row, "", -100, -86, 250, 34, 23, color=(210, 229, 241))
label("身份", row, "", 183, -86, 120, 32, 21, color=(255, 224, 169))
label("箭头", row, "›", 293, -59, 40, 56, 43)
empty = label("空状态", page, "暂无俱乐部，点击上方创建或加入", 0, -413, 650, 50, 25, color=(217, 233, 238))
widget(empty, 748, 20, bottom=229)

# Create modal: name is a real EditBox; fee is deliberately absent from the API.
create_root, create_panel = dialog("创建俱乐部弹窗", "创建俱乐部", 450)
label("名称标题", create_panel, "俱乐部名称", 0, 107, 500, 46, 30)
clone_input(create_panel, "名称输入", 0, 25, 500, "请输入俱乐部名称", 20)
create_ok = sprite("确认创建俱乐部", create_panel, "original_dialog_button_gold", 0, -93, 330, 76, sliced=True)
button(create_ok)
label("确定文字", create_ok, "确认创建", 0, 0, 300, 62, 31, color=(14, 46, 74))
label("说明", create_panel, "创建后可邀请好友加入", 0, -174, 500, 35, 21, color=(198, 225, 236))

# Join modal: independently clickable keypad and an editable 6-digit display.
join_root, join_panel = dialog("加入俱乐部弹窗", "加入俱乐部", 790)
field = sprite("俱乐部ID输入框", join_panel, "popup_join_room_input_exact", 0, 284, 510, 76, sliced=True)
label("俱乐部ID显示", field, "请输入俱乐部ID", 0, 0, 480, 60, 29, color=(207, 224, 235))
keypad = node("俱乐部键盘", join_panel, 0, -12, 540, 420)
for i, key in enumerate(["1", "2", "3", "4", "5", "6", "7", "8", "9", "重输", "0", "删除"]):
    x = (-178, 0, 178)[i % 3]
    y = 148 - (i // 3) * 98
    key_node = sprite(key, keypad, "original_dialog_button_blue", x, y, 160, 78, sliced=True)
    button(key_node)
    label("键值", key_node, key, 0, 0, 150, 66, 30, outline=True)
join_ok = sprite("申请加入俱乐部", join_panel, "original_dialog_button_gold", 0, -321, 450, 76, sliced=True)
button(join_ok)
label("确定文字", join_ok, "申请加入俱乐部", 0, 0, 420, 60, 31, color=(14, 46, 74))

PREFAB.write_text(json.dumps(A, ensure_ascii=False, indent=2) + "\n")
print(f"club UI written: {len(A)} serialized objects")
