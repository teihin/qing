#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""结算/战绩详情页的「牌局回顾」标题行补上「奖池」「芒果」。

牌桌内右上角的牌局回顾（drh8.fire 的 panelGameView）早就有这两个信息，
但 panelRecordInfo（结算进入 / 我的战绩 / 大厅历史战绩 共用）没有。
这里在「底牌 尾飞」图例右边补三个 Label：

    牌局回顾/title/奖池标题   "奖池:"
    牌局回顾/title/奖池       数值（红加绿减）
    牌局回顾/title/芒池       服务端原样字符串

- 位置取自 title 内部坐标（title 自身贴顶、高 72，内部坐标在长屏上稳定），
  同时补 cc.Widget（只对齐 TOP），遵守项目的可变画布约定。
- 幂等：同名节点已存在则只更新文案/尺寸。
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "assets/resources/UI/panelRecordInfo.prefab"

TITLE = ("牌局回顾", "title")

CREAM = {"__type__": "cc.Color", "r": 255, "g": 242, "b": 216, "a": 255}
OUTLINE = {"__type__": "cc.Color", "r": 2, "g": 18, "b": 31, "a": 255}
LABEL_MATERIAL = {"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}
FONT = {"__uuid__": "fd7307b2-666e-4c26-963d-59f787cad6fb"}

# name, preview text, 左边缘 x, 宽度, fileId
# 图例2 的 label 右边界在 -122.5；奖池块从 20 起，避开居中显示的「平台」文字。
ITEMS = (
    ("奖池标题", "奖池:", 20.0, 68, "aZ1Pq5cRkFMb2uTn8wLxYd"),
    ("奖池", "", 88.0, 96, "bK2rS6dTmGNc3vUo9xMyZe"),
    ("芒池", "", 190.0, 160, "dM4tU8fVoHPd5wWq1yNaBf"),
)

TITLE_HEIGHT = 72
NODE_HEIGHT = 36
NODE_Y = -70
# Widget TOP：父上边界(+36) - 本节点上边界(-70+18) = 88
WIDGET_TOP = TITLE_HEIGHT / 2 - (NODE_Y + NODE_HEIGHT / 2)


def load() -> list:
    return json.loads(TARGET.read_text(encoding="utf-8"))


def node_by_path(data: list, path: tuple[str, ...]) -> int:
    cur = next(
        i for i, obj in enumerate(data)
        if obj.get("__type__") == "cc.Node" and obj.get("_parent") is None
    )
    for part in path:
        if data[cur].get("_name") == part:
            continue
        nxt = None
        for ref in data[cur].get("_children", []):
            if data[ref["__id__"]].get("_name") == part:
                nxt = ref["__id__"]
                break
        if nxt is None:
            raise KeyError(f"missing node {part} in {'/'.join(path)}")
        cur = nxt
    return cur


def find_child(data: list, parent: int, name: str):
    for ref in data[parent].get("_children", []):
        if data[ref["__id__"]].get("_name") == name:
            return ref["__id__"]
    return None


def make_label(data: list, parent: int, name: str, text: str,
               centre_x: float, width: float, file_id: str) -> int:
    node = {
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "_parent": {"__id__": parent},
        "_children": [],
        "_active": False,
        "_components": [],
        "_prefab": None,
        "_opacity": 255,
        "_color": dict(CREAM),
        "_contentSize": {"__type__": "cc.Size", "width": width, "height": NODE_HEIGHT},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {
            "__type__": "TypedArray",
            "ctor": "Float64Array",
            "array": [centre_x, NODE_Y, 0, 0, 0, 0, 1, 1, 1, 1],
        },
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0,
        "_skewY": 0,
        "_is3DNode": False,
        "_groupIndex": 0,
        "groupIndex": 0,
        "_id": "",
    }
    node_id = len(data)
    data.append(node)

    label = {
        "__type__": "cc.Label",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "_materials": [dict(LABEL_MATERIAL)],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_string": text,
        "_N$string": text,
        "_fontSize": 24,
        "_lineHeight": 26,
        "_enableWrapText": False,
        "_N$file": dict(FONT),
        "_isSystemFontUsed": False,
        "_spacingX": 0,
        "_batchAsBitmap": False,
        "_styleFlags": 0,
        "_underlineHeight": 0,
        "_N$horizontalAlign": 0,
        "_N$verticalAlign": 1,
        "_N$fontFamily": "Arial",
        "_N$overflow": 2,
        "_N$cacheMode": 0,
        "_id": "",
    }
    data.append(label)
    node["_components"].append({"__id__": len(data) - 1})

    outline = {
        "__type__": "cc.LabelOutline",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "_color": dict(OUTLINE),
        "_width": 1,
        "_id": "",
    }
    data.append(outline)
    node["_components"].append({"__id__": len(data) - 1})

    widget = {
        "__type__": "cc.Widget",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "alignMode": 1,
        "_target": None,
        "_alignFlags": 1,
        "_left": 0,
        "_right": 0,
        "_top": WIDGET_TOP,
        "_bottom": 0,
        "_verticalCenter": 0,
        "_horizontalCenter": 0,
        "_isAbsLeft": True,
        "_isAbsRight": True,
        "_isAbsTop": True,
        "_isAbsBottom": True,
        "_isAbsHorizontalCenter": True,
        "_isAbsVerticalCenter": True,
        "_originalWidth": width,
        "_originalHeight": NODE_HEIGHT,
        "_id": "",
    }
    data.append(widget)
    node["_components"].append({"__id__": len(data) - 1})

    prefab_info = {
        "__type__": "cc.PrefabInfo",
        "root": {"__id__": 1},
        "asset": {"__id__": 0},
        "fileId": file_id,
        "sync": False,
    }
    data.append(prefab_info)
    node["_prefab"] = {"__id__": len(data) - 1}

    data[parent].setdefault("_children", []).append({"__id__": node_id})
    return node_id


def update_existing(data: list, node_id: int, centre_x: float, width: float,
                    text: str) -> None:
    node = data[node_id]
    node["_active"] = False
    node["_trs"]["array"][0:2] = [centre_x, NODE_Y]
    node["_contentSize"]["width"] = width
    node["_contentSize"]["height"] = NODE_HEIGHT
    for ref in node.get("_components", []):
        comp = data[ref["__id__"]]
        if comp.get("__type__") == "cc.Label":
            comp["_string"] = text
            comp["_N$string"] = text
        elif comp.get("__type__") == "cc.Widget":
            comp["_enabled"] = True
            comp["_alignFlags"] = 1
            comp["_top"] = WIDGET_TOP
            comp["_originalWidth"] = width
            comp["_originalHeight"] = NODE_HEIGHT


def main() -> None:
    data = load()
    title = node_by_path(data, TITLE)
    for name, text, left, width, file_id in ITEMS:
        centre_x = left + width / 2
        existing = find_child(data, title, name)
        if existing is not None:
            update_existing(data, existing, centre_x, width, text)
            print(f"updated {name}")
        else:
            make_label(data, title, name, text, centre_x, width, file_id)
            print(f"added {name}")

    TARGET.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
