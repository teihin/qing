#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""大厅右上角「游戏设置」入口：文字按钮（可重复执行）。

- 节点名 `游戏设置入口`，默认 active=false，由 panelMain 按身份决定是否显示。
- 168×58 胶囊底图 +「游戏设置」文字。
"""
import json, os, base64, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets", "resources", "UI", "panelMain.prefab")
META = os.path.join(ROOT, "assets", "V8", "game_settings", "gs_entry_btn.png.meta")
MAT = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
FONT = "fd7307b2-666e-4c26-963d-59f787cad6fb"
ENTRY = "游戏设置入口"
W, H = 168, 58


def fid():
    return base64.b64encode(bytes(random.getrandbits(8) for _ in range(16))).decode()[:22]


def make_label_node(d, parent_id, size):
    nid = len(d)
    pidx = nid + 1
    lid = nid + 2
    oid = nid + 3
    d.append({
        "__type__": "cc.Node", "_name": "文字", "_objFlags": 0,
        "_parent": {"__id__": parent_id}, "_children": [], "_active": True,
        "_components": [{"__id__": lid}, {"__id__": oid}],
        "_prefab": {"__id__": pidx}, "_opacity": 255,
        "_color": {"__type__": "cc.Color", "r": 242, "g": 214, "b": 156, "a": 255},
        "_contentSize": {"__type__": "cc.Size", "width": size[0], "height": size[1]},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                 "array": [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0,
        "groupIndex": 0, "_id": ""
    })
    d.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
              "asset": {"__id__": 0}, "fileId": fid(), "sync": False})
    d.append({"__type__": "cc.Label", "_name": "", "_objFlags": 0, "_enabled": True,
              "node": {"__id__": nid}, "_materials": [{"__uuid__": MAT}],
              "_srcBlendFactor": 770, "_dstBlendFactor": 771,
              "_string": "游戏设置", "_N$string": "游戏设置",
              "_fontSize": 26, "_lineHeight": 31, "_enableWrapText": False,
              "_N$file": {"__uuid__": FONT}, "_isSystemFontUsed": False,
              "_spacingX": 0, "_batchAsBitmap": False, "_styleFlags": 1,
              "_underlineHeight": 2, "_N$horizontalAlign": 1,
              "_N$verticalAlign": 1, "_N$fontFamily": "Arial",
              "_N$overflow": 2, "_N$cacheMode": 0, "_id": ""})
    d.append({"__type__": "cc.LabelOutline", "_name": "", "_objFlags": 0,
              "_enabled": True, "node": {"__id__": nid},
              "_color": {"__type__": "cc.Color", "r": 2, "g": 18, "b": 31, "a": 255},
              "_width": 1.5, "_id": ""})
    return nid


def main():
    d = json.load(open(PREFAB, encoding="utf-8"))
    frame = list(json.load(open(META, encoding="utf-8"))["subMetas"].values())[0]["uuid"]

    nid = None
    for i, o in enumerate(d):
        if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") == ENTRY:
            nid = i
            break

    if nid is None:
        nid = len(d)
        pidx, sid, bid, wid = nid + 1, nid + 2, nid + 3, nid + 4
        d.append({
            "__type__": "cc.Node", "_name": ENTRY, "_objFlags": 0,
            "_parent": {"__id__": 111}, "_children": [], "_active": False,
            "_components": [{"__id__": sid}, {"__id__": bid}, {"__id__": wid}],
            "_prefab": {"__id__": pidx}, "_opacity": 255,
            "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_contentSize": {"__type__": "cc.Size", "width": W, "height": H},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                     "array": [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0,
            "groupIndex": 0, "_id": ""
        })
        d.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                  "asset": {"__id__": 0}, "fileId": fid(), "sync": False})
        d.append({"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "_enabled": True,
                  "node": {"__id__": nid}, "_materials": [{"__uuid__": MAT}],
                  "_srcBlendFactor": 770, "_dstBlendFactor": 771,
                  "_spriteFrame": {"__uuid__": frame}, "_type": 1, "_sizeMode": 0,
                  "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
                  "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": False,
                  "_atlas": None, "_id": ""})
        d.append({
            "__type__": "cc.Button", "_name": "", "_objFlags": 0, "_enabled": True,
            "_normalMaterial": {"__uuid__": MAT}, "_grayMaterial": None,
            "duration": 0.1, "zoomScale": 0.94, "clickEvents": [],
            "_N$interactable": True, "_N$enableAutoGrayEffect": False,
            "_N$transition": 3, "transition": 3,
            "_N$normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "_N$hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
            "_N$normalSprite": None, "_N$pressedSprite": None, "pressedSprite": None,
            "_N$hoverSprite": None, "_N$disabledSprite": None, "_N$target": None,
            "_id": "", "node": {"__id__": nid}})
        d.append({"__type__": "cc.Widget", "_name": "", "_objFlags": 0, "_enabled": True,
                  "alignMode": 1, "_target": None, "_alignFlags": 33,
                  "_left": 0, "_right": 16, "_top": 12, "_bottom": 0,
                  "_verticalCenter": 0, "_horizontalCenter": 0,
                  "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True,
                  "_isAbsBottom": True, "_isAbsHorizontalCenter": True,
                  "_isAbsVerticalCenter": True,
                  "_originalWidth": W, "_originalHeight": H, "_id": "",
                  "node": {"__id__": nid}})
        d[111]["_children"].append({"__id__": nid})

    node = d[nid]
    node["_contentSize"] = {"__type__": "cc.Size", "width": W, "height": H}
    node["_active"] = False
    for c in node["_components"]:
        comp = d[c["__id__"]]
        t = comp.get("__type__")
        if t == "cc.Sprite":
            comp["_spriteFrame"] = {"__uuid__": frame}
            comp["_type"] = 1
        elif t == "cc.Widget":
            comp["_right"] = 16
            comp["_top"] = 12
            comp["_originalWidth"] = W
            comp["_originalHeight"] = H

    if not any(d[c["__id__"]].get("_name") == "文字" for c in node["_children"]):
        lid = make_label_node(d, nid, (W, H))
        node["_children"].append({"__id__": lid})

    with open(PREFAB, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print("entry node", nid, "size", W, H, "frame", frame)


if __name__ == "__main__":
    main()
