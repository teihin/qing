#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「玩家战绩」面板 prefab（assets/resources/UI/panelPlayerRecord.prefab）。

版式取自「我的战绩」(panelRecordList.prefab)：保留背景 / 今日-昨日-前天切换 /
表头 / 滚动列表 / 分页，去掉顶部盾牌统计区（BF POKER 徽章）和旧的标题条贴图，
标题栏换成无字底图 + Label「玩家战绩」，今日/昨日紧跟标题，列表吃满剩余高度。

可重复执行：每次都从 panelRecordList.prefab 重新生成，结果只取决于本脚本。
"""

import json
import os
import random
import string

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT_DIR, "assets/resources/UI/panelRecordList.prefab")
OUT = os.path.join(ROOT_DIR, "assets/resources/UI/panelPlayerRecord.prefab")

def _prefab_uuid():
    """Creator 会先给新 prefab 生成 .meta；有就沿用它的 uuid，避免引用对不上。"""
    meta_path = OUT + ".meta"
    if os.path.exists(meta_path):
        try:
            return json.load(open(meta_path, encoding="utf-8"))["uuid"]
        except Exception:
            pass
    return "931b0b8a-8656-4e23-b271-e73ae491ba57"


PREFAB_UUID = _prefab_uuid()
# panelPlayerRecord.ts 的压缩 uuid（脚本 uuid 1976cd11-6d75-45b2-88cc-791d24108b94）
SCRIPT_TYPE = "1976c0RbXVFsojMeR0kEIuU"
OLD_SCRIPT_TYPE = "c651dbSzpdNq7BAn+wLaKrt"  # panelRecordList
OLD_PREFAB_UUID = "e0ecc58a-8672-4191-926a-eab34730e3f1"

MATERIAL = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
SPRITE_TITLE_BAR = "5414d11a-1a02-5138-a2d2-e36386d6ef3d"  # personal_info2_header_bg_v8（无字标题条）
SPRITE_BACK = "9136cacd-2829-52af-a9c6-bc8f0bf7ea68"      # wallet_header_back_v8（金色返回箭头）
SPRITE_HEADER = "b17dc8ee-8289-55c3-a838-073f4cb21b36"    # record_table_header_exact
SPRITE_LIST_BG = "56a8e1b0-c86f-5531-9cd5-50ecfb20846d"   # record_list_panel_exact
SPRITE_TABS = "54009b5d-d0a2-547a-ab55-4ff0394079b9"      # v8_record_tabs_base
SPRITE_PAGER = "cc25c331-fa78-5974-a393-a7c3768a371d"     # 分页条

BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def compress_uuid(uuid_str):
    hex_str = uuid_str.replace("-", "")
    out = hex_str[:5]
    for i in range(5, 32, 3):
        value = int(hex_str[i:i + 3], 16)
        out += BASE64[value >> 6] + BASE64[value & 63]
    return out


data = json.load(open(SRC, encoding="utf-8"))
FILE_IDS = set()


def new_file_id():
    alphabet = string.ascii_letters + string.digits + "+/"
    while True:
        fid = "".join(random.choice(alphabet) for _ in range(22))
        if fid not in FILE_IDS:
            FILE_IDS.add(fid)
            return fid


def collect_prefab_file_ids():
    for item in data:
        if item.get("__type__") == "cc.PrefabInfo" and item.get("fileId"):
            FILE_IDS.add(item["fileId"])


collect_prefab_file_ids()


def find_node(name):
    for i, item in enumerate(data):
        if item.get("__type__") == "cc.Node" and item.get("_name") == name:
            return i
    raise KeyError("找不到节点: " + name)


# ----------------------------------------------------------------------
# 1. 删掉盾牌区、旧标题条贴图和三个隐藏的备用背景
# ----------------------------------------------------------------------
def subtree_ids(node_id, acc):
    acc.add(node_id)
    node = data[node_id]
    for ref in node.get("_components", []):
        acc.add(ref["__id__"])
    if node.get("_prefab"):
        acc.add(node["_prefab"]["__id__"])
    for ref in node.get("_children", []):
        subtree_ids(ref["__id__"], acc)


remove = set()
for name in ("统计", "V8战绩延展底纹", "V8战绩中下背景", "V8保留提示"):
    subtree_ids(find_node(name), remove)


def remap(value, mapping):
    if isinstance(value, dict):
        if len(value) == 1 and "__id__" in value:
            old = value["__id__"]
            return None if old in remove else {"__id__": mapping[old]}
        return {k: remap(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [remap(v, mapping) for v in value]
    return value


kept = [i for i in range(len(data)) if i not in remove]
mapping = {old: new for new, old in enumerate(kept)}
data = [remap(data[old], mapping) for old in kept]

for item in data:
    if item.get("__type__") == "cc.Node":
        item["_children"] = [ref for ref in item.get("_children", []) if ref is not None]
        item["_components"] = [ref for ref in item.get("_components", []) if ref is not None]


def node_index(name):
    return find_node(name)


ROOT = find_node("panelRecordList")
data[ROOT]["_name"] = "panelPlayerRecord"

# 脚本组件换成 panelPlayerRecord
for item in data:
    if item.get("__type__") == OLD_SCRIPT_TYPE:
        item["__type__"] = SCRIPT_TYPE
        break
else:
    raise RuntimeError("没找到 panelRecordList 脚本组件")

# 所有 PrefabInfo.asset 指向新 prefab；cc.Prefab 名字同步
for item in data:
    if item.get("__type__") == "cc.PrefabInfo":
        asset = item.get("asset")
        if isinstance(asset, dict) and asset.get("__uuid__") == OLD_PREFAB_UUID:
            item["asset"] = {"__uuid__": PREFAB_UUID}
    if item.get("__type__") == "cc.Prefab":
        item["_name"] = "panelPlayerRecord"


# ----------------------------------------------------------------------
# 2. 小工具：改节点 / 加节点
# ----------------------------------------------------------------------
def set_size(node_id, width, height):
    data[node_id]["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height}


def set_pos(node_id, x, y):
    trs = data[node_id]["_trs"]
    trs["array"][0] = x
    trs["array"][1] = y


def find_component(node_id, comp_type):
    for ref in data[node_id].get("_components", []):
        comp = data[ref["__id__"]]
        if comp.get("__type__") == comp_type:
            return ref["__id__"]
    return None


def set_widget(node_id, **kwargs):
    comp_id = find_component(node_id, "cc.Widget")
    if comp_id is None:
        raise KeyError("节点没有 Widget: " + data[node_id]["_name"])
    comp = data[comp_id]
    for key, value in kwargs.items():
        comp[key] = value


def add_node(name, parent_id, x, y, width, height, color=(255, 255, 255, 255), active=True):
    node_id = len(data)
    data.append({
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "_parent": {"__id__": parent_id},
        "_children": [],
        "_active": active,
        "_components": [],
        "_prefab": None,
        "_opacity": 255,
        "_color": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": color[3]},
        "_contentSize": {"__type__": "cc.Size", "width": width, "height": height},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                 "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0,
        "_skewY": 0,
        "_is3DNode": False,
        "_groupIndex": 0,
        "groupIndex": 0,
        "_id": "",
    })
    info_id = len(data)
    data.append({
        "__type__": "cc.PrefabInfo",
        "root": {"__id__": ROOT},
        "asset": {"__uuid__": PREFAB_UUID},
        "fileId": new_file_id(),
        "sync": False,
    })
    data[node_id]["_prefab"] = {"__id__": info_id}
    data[parent_id]["_children"].append({"__id__": node_id})
    return node_id


def add_component(node_id, comp):
    comp["node"] = {"__id__": node_id}
    data.append(comp)
    data[node_id]["_components"].append({"__id__": len(data) - 1})
    return len(data) - 1


def add_sprite(node_id, sprite_uuid, size_mode=0, sprite_type=0, trimmed=False):
    return add_component(node_id, {
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "node": None,
        "_enabled": True,
        "_materials": [{"__uuid__": MATERIAL}],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_spriteFrame": {"__uuid__": sprite_uuid},
        "_type": sprite_type,
        "_sizeMode": size_mode,
        "_fillType": 0,
        "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": trimmed,
        "_atlas": None,
        "_id": "",
    })


def add_label(node_id, text, font_size, line_height, align=1, overflow=1, wrap=True, outline=None):
    comp_id = add_component(node_id, {
        "__type__": "cc.Label",
        "_name": "",
        "_objFlags": 0,
        "node": None,
        "_enabled": True,
        "_materials": [{"__uuid__": MATERIAL}],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_useOriginalSize": False,
        "_string": text,
        "_N$string": text,
        "_fontSize": font_size,
        "_lineHeight": line_height,
        "_enableWrapText": wrap,
        "_N$file": None,
        "_isSystemFontUsed": True,
        "_spacingX": 0,
        "_batchAsBitmap": False,
        "_N$horizontalAlign": align,
        "_N$verticalAlign": 1,
        "_N$fontFamily": "Arial",
        "_N$overflow": overflow,
        "_N$cacheMode": 0,
        "_id": "",
    })
    if outline:
        add_component(node_id, {
            "__type__": "cc.LabelOutline",
            "_name": "",
            "_objFlags": 0,
            "node": None,
            "_enabled": True,
            "_color": {"__type__": "cc.Color", "r": outline[0], "g": outline[1],
                       "b": outline[2], "a": outline[3]},
            "_width": outline[4],
            "_id": "",
        })
    return comp_id


def add_widget(node_id, align_flags, left=0, right=0, top=0, bottom=0,
               vertical_center=0, horizontal_center=0):
    node = data[node_id]
    return add_component(node_id, {
        "__type__": "cc.Widget",
        "_name": "",
        "_objFlags": 0,
        "node": None,
        "_enabled": True,
        "alignMode": 1,
        "_target": None,
        "_alignFlags": align_flags,
        "_left": left,
        "_right": right,
        "_top": top,
        "_bottom": bottom,
        "_verticalCenter": vertical_center,
        "_horizontalCenter": horizontal_center,
        "_isAbsLeft": True,
        "_isAbsRight": True,
        "_isAbsTop": True,
        "_isAbsBottom": True,
        "_isAbsHorizontalCenter": True,
        "_isAbsVerticalCenter": True,
        "_originalWidth": node["_contentSize"]["width"],
        "_originalHeight": node["_contentSize"]["height"],
        "_id": "",
    })



# ----------------------------------------------------------------------
# 3. 标题栏：无字底图 + 返回箭头 + 标题文字 + 玩家名
# ----------------------------------------------------------------------
title = node_index("title")
data[title]["_name"] = "标题栏"
set_size(title, 750, 72)
set_pos(title, 0, 631)
sprite = find_component(title, "cc.Sprite")
data[sprite]["_spriteFrame"] = {"__uuid__": SPRITE_TITLE_BAR}
data[sprite]["_sizeMode"] = 2
set_widget(title, _top=0, _bottom=0, _originalWidth=750, _originalHeight=72)

back = None
for ref in list(data[title]["_children"]):
    child = data[ref["__id__"]]
    if child["_name"] == "关闭":
        back = ref["__id__"]
    else:
        # 「客服」和「我的战绩」美术字都不需要了
        child["_active"] = False
if back is None:
    raise RuntimeError("标题栏里没找到关闭按钮")

data[back]["_name"] = "返回"
set_size(back, 80, 76)
set_pos(back, -326, 0)
back_sprite = find_component(back, "cc.Sprite")
data[back_sprite]["_spriteFrame"] = {"__uuid__": SPRITE_BACK}
data[back_sprite]["_sizeMode"] = 2

title_label = add_node("标题文字", title, 0, 0, 420, 52, color=(255, 231, 112, 255))
add_label(title_label, "玩家战绩", 36, 46, align=1, overflow=1, wrap=False,
          outline=(12, 44, 74, 255, 3))

# 昵称+ID 一起右对齐，150 宽放不下（会被 CLAMP 掐掉前半截），放宽到 236 并降字号。
player_label = add_node("玩家", title, 246, 0, 236, 40, color=(169, 192, 214, 255))
add_label(player_label, "", 18, 24, align=2, overflow=1, wrap=False)

# ----------------------------------------------------------------------
# 4. 条件（今日/昨日/前天）贴到标题下面，列表吃满剩余高度
# ----------------------------------------------------------------------
# 条件行离标题栏留出 24px 空隙：原来 82 只差 10px，真机上看起来是贴着/被标题栏压住。
COND_TOP = 96
cond = node_index("条件")
set_pos(cond, -0.797, 667 - COND_TOP - data[cond]["_contentSize"]["height"] / 2)
set_widget(cond, _top=COND_TOP)

HEADER_TOP = 172
header = node_index("标题")
set_pos(header, 0, 667 - HEADER_TOP - data[header]["_contentSize"]["height"] / 2)
set_widget(header, _top=HEADER_TOP)

LIST_TOP = 238
LIST_BOTTOM = 102
LIST_WIDTH = 721.307120085016
LIST_HEIGHT = 1334 - LIST_TOP - LIST_BOTTOM
list_node = node_index("战绩列表")
set_size(list_node, LIST_WIDTH, LIST_HEIGHT)
set_pos(list_node, 0, 667 - LIST_TOP - LIST_HEIGHT / 2)
set_widget(list_node, _top=LIST_TOP, _bottom=LIST_BOTTOM,
           _originalWidth=LIST_WIDTH, _originalHeight=LIST_HEIGHT)

view = node_index("view")
set_size(view, LIST_WIDTH, LIST_HEIGHT)
set_pos(view, 0, 0)

FRAME_TOP = 234
FRAME_BOTTOM = 30
FRAME_HEIGHT = 1334 - FRAME_TOP - FRAME_BOTTOM
frame = node_index("V8战绩列表底框")
set_size(frame, LIST_WIDTH, FRAME_HEIGHT)
set_pos(frame, 0, 667 - FRAME_TOP - FRAME_HEIGHT / 2)
set_widget(frame, _top=FRAME_TOP, _bottom=FRAME_BOTTOM,
           _originalWidth=LIST_WIDTH, _originalHeight=FRAME_HEIGHT)

pager = node_index("分页")
set_pos(pager, 0, -667 + 35.86609989373007 + 58.18278427205101 / 2)

# ----------------------------------------------------------------------
# 5. 加载 / 空态 / 错误：铺在列表区域里居中
# ----------------------------------------------------------------------
STATE_COLOR = (214, 226, 238, 255)
ERROR_COLOR = (240, 130, 110, 255)
for name, text, color, font in (
        ("加载", "正在查询战绩…", STATE_COLOR, 28),
        ("空状态", "该玩家暂无战绩", STATE_COLOR, 28),
        ("错误", "查询失败，请稍后重试", ERROR_COLOR, 26),
):
    node_id = add_node(name, ROOT, 0, 667 - LIST_TOP - LIST_HEIGHT / 2, 690, LIST_HEIGHT,
                       color=color, active=(name == "加载"))
    add_label(node_id, text, font, font + 6, align=1, overflow=1, wrap=True)
    add_widget(node_id, 45, left=30, right=30, top=LIST_TOP, bottom=LIST_BOTTOM)

# ----------------------------------------------------------------------
# 6. 输出
# ----------------------------------------------------------------------
with open(OUT, "w", encoding="utf-8") as f:
    f.write(json.dumps(data, ensure_ascii=False, indent=2))
    f.write("\n")

print("written", OUT, len(data), "objects")
