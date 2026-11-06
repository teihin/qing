#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「数据统计」行模板：在「查看 / 代理链」后面加「战绩」按钮，并把底部一排按钮重新排好。

背景：同一行底部还会出现「添加到分组」（俱乐部玩家分组功能），原来的坐标
（统计口径 -166 / 查看 -63 / 代理链 66 / 添加到分组 245）加进「战绩」会压在一起，
所以这里统一按「统计口径 | 查看 | 代理链 | 战绩 | 添加到分组」从左到右排一遍。

按钮是纯 Sprite（同「代理链」用同一张九宫格底图 dc06eaa9），没有 cc.Button：
行模板是运行时克隆的，事件由 panelBossPlayerInfo.FillInfoRow / FillRow 手动挂触摸。

可重复执行：按钮已存在就只重排坐标。
"""

import json
import os
import random
import string

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT_DIR, "assets/resources/UI/panelBossPlayerInfo.prefab")

SPRITE_BUTTON = "dc06eaa9-fee3-59d8-aff6-d12c4002d6d9"
MATERIAL = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"

# 底部一排：(节点名, 中心 x, 宽, 高)
BUTTON_ROW = [
    ("统计口径", -280, 96, 28),
    ("查看", -76, 88, 36),
    ("代理链", 26, 96, 36),
    ("战绩", 126, 84, 36),
    ("添加到分组", 253, 150, 36),
]
ROW_Y = -74

data = json.load(open(PREFAB, encoding="utf-8"))

ROW_TEMPLATE = None
for i, item in enumerate(data):
    if item.get("__type__") == "cc.Node" and item.get("_name") == "行模板":
        ROW_TEMPLATE = i
if ROW_TEMPLATE is None:
    raise SystemExit("找不到行模板节点")

children = {data[ref["__id__"]]["_name"]: ref["__id__"] for ref in data[ROW_TEMPLATE]["_children"]}

# 本 prefab 的 PrefabInfo.asset 是 {"__id__": 0}（指向 cc.Prefab 对象），照抄这个写法
PREFAB_ASSET = data[data[ROW_TEMPLATE]["_prefab"]["__id__"]]["asset"]
FILE_IDS = {item["fileId"] for item in data
            if item.get("__type__") == "cc.PrefabInfo" and item.get("fileId")}


def new_file_id():
    alphabet = string.ascii_letters + string.digits + "+/"
    while True:
        fid = "".join(random.choice(alphabet) for _ in range(22))
        if fid not in FILE_IDS:
            FILE_IDS.add(fid)
            return fid


def add_node(name, parent_id, x, y, width, height, color=(255, 255, 255, 255)):
    node_id = len(data)
    data.append({
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "_parent": {"__id__": parent_id},
        "_children": [],
        "_active": True,
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
        "root": {"__id__": 1},
        "asset": dict(PREFAB_ASSET),
        "fileId": new_file_id(),
        "sync": False,
    })
    data[node_id]["_prefab"] = {"__id__": info_id}
    data[parent_id]["_children"].append({"__id__": node_id})
    return node_id


def add_sprite(node_id):
    data.append({
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "_materials": [{"__uuid__": MATERIAL}],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_spriteFrame": {"__uuid__": SPRITE_BUTTON},
        "_type": 1,
        "_sizeMode": 0,
        "_fillType": 0,
        "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": True,
        "_atlas": None,
        "_id": "",
    })
    data[node_id]["_components"].append({"__id__": len(data) - 1})


def add_label(node_id, text, font_size, line_height):
    data.append({
        "__type__": "cc.Label",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "_materials": [{"__uuid__": MATERIAL}],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_string": text,
        "_N$string": text,
        "_fontSize": font_size,
        "_lineHeight": line_height,
        "_enableWrapText": False,
        "_N$file": None,
        "_isSystemFontUsed": True,
        "_spacingX": 0,
        "_batchAsBitmap": False,
        "_styleFlags": 0,
        "_underlineHeight": 0,
        "_N$horizontalAlign": 1,
        "_N$verticalAlign": 1,
        "_N$fontFamily": "Arial",
        "_N$overflow": 2,
        "_N$cacheMode": 0,
        "_id": "",
    })
    data[node_id]["_components"].append({"__id__": len(data) - 1})


if "战绩" not in children:
    btn = add_node("战绩", ROW_TEMPLATE, 80, ROW_Y, 96, 36)
    add_sprite(btn)
    label = add_node("文字", btn, 0, 0, 96, 34, color=(255, 238, 197, 255))
    add_label(label, "战绩", 20, 26)
    children["战绩"] = btn
    print("新增「战绩」按钮")

# 统一重排底部一排（存在的节点才动；「战绩」的文字子节点宽度跟着父节点）
for name, center_x, width, height in BUTTON_ROW:
    node_id = children.get(name)
    if node_id is None:
        continue
    data[node_id]["_trs"]["array"][0] = center_x
    data[node_id]["_trs"]["array"][1] = ROW_Y
    data[node_id]["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height}
    if name != "统计口径":
        # 按钮里的「文字」跟按钮同宽，文字本身是居中的，不会因为缩窄被切
        for ref in data[node_id]["_children"]:
            child = data[ref["__id__"]]
            if child["_name"] == "文字":
                child["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height - 2}

# 结构自检：新追加的对象引用必须类型正确
N = len(data)
for i, item in enumerate(data):
    if item.get("__type__") == "cc.Node":
        for ref in item.get("_children", []):
            assert data[ref["__id__"]].get("__type__") == "cc.Node", ("child", i)
        for ref in item.get("_components", []):
            comp = data[ref["__id__"]]
            assert comp.get("__type__") not in ("cc.Node", "cc.PrefabInfo"), ("comp", i)
            assert comp["node"]["__id__"] == i, ("comp node", i)
        assert data[item["_prefab"]["__id__"]].get("__type__") == "cc.PrefabInfo", ("prefab", i)
for item in data:
    if item.get("__type__") == "cc.PrefabInfo":
        root = item.get("root", {})
        if "__id__" in root:
            assert root["__id__"] < N, "越界引用"

with open(PREFAB, "w", encoding="utf-8") as f:
    f.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

print("行模板底部按钮已重排；objects:", len(data))

# 重叠自检（同一排，按矩形比较）
rects = []
for name, center_x, width, height in BUTTON_ROW:
    node_id = children.get(name)
    if node_id is None:
        continue
    left = center_x - width / 2
    rects.append((name, left, left + width))
for i in range(len(rects)):
    for j in range(i + 1, len(rects)):
        a, b = rects[i], rects[j]
        if a[1] < b[2] and b[1] < a[2]:
            raise AssertionError("按钮重叠: %s / %s" % (a[0], b[0]))
print("按钮横向位置:", ", ".join("%s[%.0f,%.0f]" % r for r in rects))
