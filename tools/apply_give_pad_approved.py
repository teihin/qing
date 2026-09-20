#!/usr/bin/env python3
"""Apply approved panelGivePad art while preserving every business node and event."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelGivePad.prefab"
ASSETS = ROOT / "assets/V7"
PREFAB_UUID = "5f6968c5-a5f0-464c-8a0b-15d3b8f94258"


def asset(name: str) -> tuple[str, int, int]:
    meta = json.loads((ASSETS / f"give_pad_approved_{name}.png.meta").read_text(encoding="utf-8"))
    frame = meta["subMetas"][f"give_pad_approved_{name}"]
    return frame["uuid"], frame["width"], frame["height"]


def paths(data):
    result = {}
    def walk(index, path):
        node = data[index]
        current = f"{path}/{node['_name']}" if path else node["_name"]
        result[current] = index
        for child in node.get("_children", []): walk(child["__id__"], current)
    walk(1, "")
    return result


def pos(node, x, y, w=None, h=None):
    node["_trs"]["array"][0:2] = [x, y]
    if w is not None: node["_contentSize"] = {"__type__": "cc.Size", "width": w, "height": h}


def sprite(data, index, name, sliced=False):
    frame, _, _ = asset(name)
    component = next(data[c["__id__"]] for c in data[index]["_components"] if data[c["__id__"]].get("__type__") == "cc.Sprite")
    component["_enabled"] = True
    component["_spriteFrame"] = {"__uuid__": frame}
    component["_type"] = 1 if sliced else 0
    component["_sizeMode"] = 0
    component["_isTrimmedMode"] = False


def disable_sprite(data, index):
    for ref in data[index]["_components"]:
        if data[ref["__id__"]].get("__type__") == "cc.Sprite": data[ref["__id__"]]["_enabled"] = False


def replace_label_with_sprite(data, index, name):
    frame, _, _ = asset(name)
    component_index = data[index]["_components"][0]["__id__"]
    data[component_index] = {"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": index}, "_enabled": True,
        "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}], "_srcBlendFactor": 770, "_dstBlendFactor": 771,
        "_spriteFrame": {"__uuid__": frame}, "_type": 0, "_sizeMode": 0, "_fillType": 0,
        "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0}, "_fillStart": 0, "_fillRange": 0,
        "_isTrimmedMode": False, "_atlas": None, "_id": ""}


def add_sprite(data, parent, name, image, x, y, w, h):
    existing = next((r["__id__"] for r in data[parent]["_children"] if data[r["__id__"]]["_name"] == name), None)
    if existing is None:
        existing, prefab, component = len(data), len(data) + 1, len(data) + 2
        data.append({"__type__": "cc.Node", "_name": name, "_objFlags": 0, "_parent": {"__id__": parent}, "_children": [], "_active": True,
            "_components": [{"__id__": component}], "_prefab": {"__id__": prefab}, "_opacity": 255,
            "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_contentSize": {"__type__": "cc.Size", "width": w, "height": h}, "_anchorPoint": {"__type__": "cc.Vec2", "x": .5, "y": .5},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array", "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0}, "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0, "groupIndex": 0, "_id": ""})
        data.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1}, "asset": {"__uuid__": PREFAB_UUID}, "fileId": "", "sync": False})
        data.append({"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": existing}, "_enabled": True,
            "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}], "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_spriteFrame": None, "_type": 0, "_sizeMode": 0, "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": False, "_atlas": None, "_id": ""})
        data[parent]["_children"].append({"__id__": existing})
    pos(data[existing], x, y, w, h); sprite(data, existing, image)


def set_dynamic_label(data, index, x, y, w, h, font_size, color):
    pos(data[index], x, y, w, h)
    data[index]["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
    component = next(data[c["__id__"]] for c in data[index]["_components"] if data[c["__id__"]].get("__type__") == "cc.Label")
    component["_fontSize"] = font_size; component["_lineHeight"] = font_size + 6
    component["_enableWrapText"] = False; component["_N$overflow"] = 2; component["_overflow"] = 2
    component["_N$horizontalAlign"] = 0; component["_horizontalAlign"] = 0


def set_editbox_style(data, node_id, left, password=False):
    """EditBox serializes its own font settings and otherwise overrides child Label styling."""
    node = data[node_id]
    editbox = next(data[r["__id__"]] for r in node["_components"] if data[r["__id__"]].get("__type__") == "cc.EditBox")
    live = data[editbox["_N$textLabel"]["__id__"]]
    placeholder = data[editbox["_N$placeholderLabel"]["__id__"]]
    live_color = {"__type__": "cc.Color", "r": 255, "g": 246, "b": 216, "a": 255}
    placeholder_color = {"__type__": "cc.Color", "r": 143, "g": 187, "b": 222, "a": 255}
    for label, color in ((live, live_color), (placeholder, placeholder_color)):
        label["_fontSize"] = 31; label["_lineHeight"] = 40; label["_N$horizontalAlign"] = 0; label["_horizontalAlign"] = 0
        label["_N$verticalAlign"] = 1; label["_verticalAlign"] = 1; label["_enableWrapText"] = False
    live_node = live["node"]["__id__"]
    placeholder_node = placeholder["node"]["__id__"]
    data[live_node]["_color"] = live_color
    data[placeholder_node]["_color"] = placeholder_color
    if password: editbox["_N$inputFlag"] = 0  # cc.EditBox.InputFlag.PASSWORD
    editbox["_N$fontSize"] = 31; editbox["fontSize"] = 31
    editbox["_N$placeholderFontSize"] = 31; editbox["placeholderFontSize"] = 31
    editbox["_N$fontColor"] = live_color; editbox["fontColor"] = live_color
    editbox["_N$placeholderFontColor"] = placeholder_color; editbox["placeholderFontColor"] = placeholder_color
    pos(data[live_node], left, 27, 320, 55); pos(data[placeholder_node], left, 30, 320, 60)


def main():
    for name in ("panel", "title", "divider", "recipient", "amount", "password", "id_prefix", "close", "lock", "avatar_ring", "input", "button"):
        asset(name)
    data = json.loads(PREFAB.read_text(encoding="utf-8")); p = paths(data)
    required = ("panelGivePad/bk", "panelGivePad/bk/name", "panelGivePad/bk/id", "panelGivePad/bk/头像/mask/img", "panelGivePad/bk/输入金额", "panelGivePad/bk/金额", "panelGivePad/bk/密码", "panelGivePad/bk/确定赠送", "panelGivePad/bk/关闭")
    missing = [key for key in required if key not in p]
    if missing: raise RuntimeError(f"missing business nodes: {missing}")
    root = p["panelGivePad"]
    data[root]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": .5, "y": .5}
    root_widget = next(data[r["__id__"]] for r in data[root]["_components"] if data[r["__id__"]].get("__type__") == "cc.Widget")
    for key in ("_left", "_right", "_top", "_bottom", "_horizontalCenter", "_verticalCenter"): root_widget[key] = 0
    msk = p["panelGivePad/msk"]; pos(data[msk], 0, 0)
    msk_widget = next(data[r["__id__"]] for r in data[msk]["_components"] if data[r["__id__"]].get("__type__") == "cc.Widget")
    for key in ("_left", "_right", "_top", "_bottom", "_horizontalCenter", "_verticalCenter"): msk_widget[key] = 0
    bk = p["panelGivePad/bk"]; pos(data[bk], 0, 0, 700, 805); sprite(data, bk, "panel")
    bk_widget = next(data[r["__id__"]] for r in data[bk]["_components"] if data[r["__id__"]].get("__type__") == "cc.Widget")
    bk_widget["_horizontalCenter"] = 0; bk_widget["_verticalCenter"] = 0; bk_widget["_originalWidth"] = 700; bk_widget["_originalHeight"] = 805
    # Approved fixed art; all names, ID, avatar pixels, edit values and placeholders remain live Cocos nodes.
    pos(data[p["panelGivePad/bk/赠送金币"]], 0, 306, 260, 68); sprite(data, p["panelGivePad/bk/赠送金币"], "title")
    add_sprite(data, bk, "V8顶部饰线", "divider", 0, 250, 560, 29)
    pos(data[p["panelGivePad/bk/名字垫底"]], -227, 217, 176, 47); sprite(data, p["panelGivePad/bk/名字垫底"], "recipient")
    disable_sprite(data, p["panelGivePad/bk/名字垫底 copy"])
    pos(data[p["panelGivePad/bk/头像"]], -190, 102, 160, 160); disable_sprite(data, p["panelGivePad/bk/头像"])
    pos(data[p["panelGivePad/bk/头像/mask"]], 0, 0, 144, 144); pos(data[p["panelGivePad/bk/头像/mask/img"]], 0, 0, 144, 144)
    mask = p["panelGivePad/bk/头像/mask"]
    mask_component = next(data[r["__id__"]] for r in data[mask]["_components"] if data[r["__id__"]].get("__type__") == "cc.Mask")
    mask_component["_type"] = 1; mask_component["_segments"] = 64  # cc.Mask.Type.ELLIPSE
    # Appending the foreground ring after mask makes the live avatar render beneath it.
    add_sprite(data, p["panelGivePad/bk/头像"], "V8头像框", "avatar_ring", 0, 0, 160, 160)
    set_dynamic_label(data, p["panelGivePad/bk/name"], -90, 130, 335, 52, 41, (255, 246, 216))
    pos(data[p["panelGivePad/bk/txt"]], -60, 67, 61, 40); replace_label_with_sprite(data, p["panelGivePad/bk/txt"], "id_prefix")
    set_dynamic_label(data, p["panelGivePad/bk/id"], -20, 67, 250, 40, 33, (255, 246, 216))
    add_sprite(data, bk, "V8中部饰线", "divider", 0, 4, 560, 29)
    # Reuse existing non-business art holders as fixed approved labels; their original node paths stay intact.
    # These two existing non-business holders own the persistent field art, including preset-amount mode.
    pos(data[p["panelGivePad/bk/img"]], 92, -79, 392, 78); sprite(data, p["panelGivePad/bk/img"], "input", True)
    pos(data[p["panelGivePad/bk/img/金额"]], -319, 0, 180, 47); sprite(data, p["panelGivePad/bk/img/金额"], "amount")
    pos(data[p["panelGivePad/bk/img copy"]], 92, -189, 392, 78); sprite(data, p["panelGivePad/bk/img copy"], "input", True)
    pos(data[p["panelGivePad/bk/img copy/img"]], -319, 0, 180, 47); sprite(data, p["panelGivePad/bk/img copy/img"], "password")
    amount_edit = p["panelGivePad/bk/输入金额"]; pos(data[amount_edit], 92, -79, 392, 78)
    password_edit = p["panelGivePad/bk/密码"]; pos(data[password_edit], 135, -189, 300, 78)
    for node_path, left in (("panelGivePad/bk/输入金额", -150), ("panelGivePad/bk/密码", -140)):
        background = node_path + "/BACKGROUND_SPRITE"
        data[p[background]]["_active"] = False
        disable_sprite(data, p[background])
        set_editbox_style(data, p[node_path], left, node_path.endswith("密码"))
    pos(data[p["panelGivePad/bk/金额"]], -70, -79, 320, 55); set_dynamic_label(data, p["panelGivePad/bk/金额"], -70, -79, 320, 55, 31, (255, 246, 216))
    add_sprite(data, bk, "V8交易密码锁", "lock", -70, -189, 49, 47)
    pos(data[p["panelGivePad/bk/确定赠送"]], 0, -316, 590, 88); sprite(data, p["panelGivePad/bk/确定赠送"], "button")
    # The complete gold button, including its fixed dark-blue lettering, is a single exact crop.
    button_copy = next((r["__id__"] for r in data[p["panelGivePad/bk/确定赠送"]]["_children"] if data[r["__id__"]]["_name"] == "V8确定赠送文字"), None)
    if button_copy is not None:
        data[button_copy]["_active"] = False
        sprite_component = next((data[r["__id__"]] for r in data[button_copy]["_components"] if data[r["__id__"]].get("__type__") == "cc.Sprite"), None)
        if sprite_component is not None: sprite_component["_spriteFrame"] = None
    pos(data[p["panelGivePad/bk/关闭"]], 278, 307, 64, 64); sprite(data, p["panelGivePad/bk/关闭"], "close")
    PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("applied approved panelGivePad prefab")


if __name__ == "__main__":
    main()
