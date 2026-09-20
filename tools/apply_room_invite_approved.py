#!/usr/bin/env python3
"""Apply the approved room-invite art while keeping invitation data live."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelRoomInvite.prefab"
ASSET_DIR = ROOT / "assets/V7/游戏内"
CARD_WIDTH = 630
SCALE = CARD_WIDTH / 822


def sprite_uuid(name: str) -> str:
    meta = json.loads((ASSET_DIR / f"{name}.png.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][name]["uuid"]


def node_index(data: list[dict], root: int, path: str) -> int:
    node = root
    for part in path.split("/"):
        node = next(ref["__id__"] for ref in data[node]["_children"]
                    if data[ref["__id__"]]["_name"] == part)
    return node


def set_size(node: dict, width: float, height: float) -> None:
    node["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height}


def set_position(node: dict, x: float, y: float) -> None:
    node["_trs"]["array"][0] = x
    node["_trs"]["array"][1] = y


def set_label(data: list[dict], node: int, size: int, line_height: int, width: float, height: float) -> None:
    set_size(data[node], width, height)
    label = next(data[ref["__id__"]] for ref in data[node]["_components"]
                 if data[ref["__id__"]]["__type__"] == "cc.Label")
    label["_enabled"] = True
    label["_fontSize"] = size
    label["_lineHeight"] = line_height
    label["_enableWrapText"] = False
    label["_overflow"] = 2
    label["_N$overflow"] = 2


def set_sprite(data: list[dict], node: int, asset: str) -> None:
    component = next((data[ref["__id__"]] for ref in data[node]["_components"]
                      if data[ref["__id__"]]["__type__"] == "cc.Sprite"), None)
    if component is None:
        component_id = len(data)
        data[node]["_components"].append({"__id__": component_id})
        component = {"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": node}, "_enabled": True,
                     "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}], "_srcBlendFactor": 770, "_dstBlendFactor": 771,
                     "_spriteFrame": None, "_type": 0, "_sizeMode": 0, "_fillType": 0,
                     "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0}, "_fillStart": 0, "_fillRange": 0,
                     "_isTrimmedMode": False, "_atlas": None}
        data.append(component)
    component["_enabled"] = True
    component["_spriteFrame"] = {"__uuid__": sprite_uuid(asset)}
    component["_type"] = 0
    component["_sizeMode"] = 0
    component["_isTrimmedMode"] = False


def add_static_sprite(data: list[dict], card: int, name: str, asset: str, x: float, y: float, width: float, height: float) -> None:
    existing = next((ref["__id__"] for ref in data[card]["_children"] if data[ref["__id__"]]["_name"] == name), None)
    if existing is None:
        node_id = len(data)
        data.append({"__type__": "cc.Node", "_name": name, "_objFlags": 0, "_parent": {"__id__": card}, "_children": [], "_active": True,
                     "_components": [], "_prefab": None, "_opacity": 255,
                     "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
                     "_contentSize": {"__type__": "cc.Size", "width": width, "height": height},
                     "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
                     "_trs": {"__type__": "TypedArray", "ctor": "Float64Array", "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
                     "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0}, "_skewX": 0, "_skewY": 0,
                     "_is3DNode": False, "_groupIndex": 0, "groupIndex": 0})
        data[card]["_children"].append({"__id__": node_id})
        existing = node_id
    data[existing]["_active"] = True
    set_position(data[existing], x, y)
    set_size(data[existing], width, height)
    set_sprite(data, existing, asset)


def add_value_label(data: list[dict], card: int, name: str, x: float, y: float, width: float) -> None:
    if any(data[ref["__id__"]]["_name"] == name for ref in data[card]["_children"]):
        return
    node_id = len(data)
    label_id = node_id + 1
    data.append({
        "__type__": "cc.Node", "_name": name, "_objFlags": 0,
        "_parent": {"__id__": card}, "_children": [], "_active": True,
        "_components": [{"__id__": label_id}], "_prefab": None, "_opacity": 255,
        "_color": {"__type__": "cc.Color", "r": 255, "g": 226, "b": 159, "a": 255},
        "_contentSize": {"__type__": "cc.Size", "width": width, "height": 30},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array", "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0, "groupIndex": 0,
    })
    data.append({
        "__type__": "cc.Label", "_name": "", "_objFlags": 0, "node": {"__id__": node_id}, "_enabled": True,
        "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}], "_srcBlendFactor": 770, "_dstBlendFactor": 771,
        "_string": "--", "_N$string": "--", "_fontSize": 23, "_lineHeight": 30, "_enableWrapText": False,
        "_N$file": {"__uuid__": "fd7307b2-666e-4c26-963d-59f787cad6fb"}, "_isSystemFontUsed": False,
        "_spacingX": 0, "_batchAsBitmap": False, "_styleFlags": 0, "_underlineHeight": 0,
        "_N$horizontalAlign": 1, "_N$verticalAlign": 1, "_N$fontFamily": "Arial", "_N$overflow": 2, "_N$cacheMode": 0, "_overflow": 2,
    })
    data[card]["_children"].append({"__id__": node_id})


def add_close_button(data: list[dict], card: int) -> None:
    if any(data[ref["__id__"]]["_name"] == "关闭" for ref in data[card]["_children"]):
        return
    node_id, button_id = len(data), len(data) + 1
    data.append({
        "__type__": "cc.Node", "_name": "关闭", "_objFlags": 0, "_parent": {"__id__": card}, "_children": [], "_active": True,
        "_components": [{"__id__": button_id}, {"__id__": button_id + 1}], "_prefab": None, "_opacity": 255,
        "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_contentSize": {"__type__": "cc.Size", "width": 46 * SCALE, "height": 44 * SCALE},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array", "array": [357 * SCALE, 415.5 * SCALE, 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0, "groupIndex": 0,
    })
    data.append({"__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": node_id}, "_enabled": True,
                 "_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}], "_srcBlendFactor": 770, "_dstBlendFactor": 771,
                 "_spriteFrame": {"__uuid__": sprite_uuid("room_invite_approved_close")}, "_type": 0, "_sizeMode": 0, "_fillType": 0,
                 "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0}, "_fillStart": 0, "_fillRange": 0,
                 "_isTrimmedMode": False, "_atlas": None})
    data.append({
        "__type__": "cc.Button", "_name": "", "_objFlags": 0, "node": {"__id__": node_id}, "_enabled": True,
        "_normalMaterial": None, "_grayMaterial": None, "duration": 0.08, "zoomScale": 0.95, "clickEvents": [],
        "_N$interactable": True, "_N$enableAutoGrayEffect": False, "_N$transition": 0, "transition": 0,
        "_N$normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_N$pressedColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "pressedColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_N$hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_N$disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
        "_N$normalSprite": None, "_N$pressedSprite": None, "pressedSprite": None, "_N$hoverSprite": None,
        "hoverSprite": None, "_N$disabledSprite": None, "_N$target": None,
    })
    data[card]["_children"].append({"__id__": node_id})


def main() -> None:
    for name in ("room_invite_approved_panel_clean", "room_invite_approved_header", "room_invite_approved_close",
                 "room_invite_approved_info_card", "room_invite_approved_checkbox_ring",
                 "room_invite_approved_checkbox_label", "room_invite_approved_checkmark", "room_invite_approved_button_ignore", "room_invite_approved_button_go_room"):
        sprite_uuid(name)
    data = json.loads(PREFAB.read_text(encoding="utf-8"))
    root, card = 1, node_index(data, 1, "卡片")
    card_node = data[card]
    set_size(card_node, CARD_WIDTH, 934 * SCALE)
    set_position(card_node, 0, (836 - (321 + 934 / 2)) * SCALE)
    card_sprite = next(data[ref["__id__"]] for ref in card_node["_components"] if data[ref["__id__"]]["__type__"] == "cc.Sprite")
    card_sprite["_spriteFrame"] = {"__uuid__": sprite_uuid("room_invite_approved_panel_clean")}
    card_sprite["_type"] = 0
    card_sprite["_sizeMode"] = 0
    card_sprite["_isTrimmedMode"] = False

    # panel_clean deliberately has transparent fixed-art slots; each piece stays independently reusable and precise.
    for path in ("标题", "副标题", "V8邀请文案底"):
        data[node_index(data, root, "卡片/" + path)]["_active"] = False
    header = node_index(data, root, "卡片/V8标题牌")
    data[header]["_active"] = True
    set_position(data[header], 0, (321 + 934 / 2 - (351 + 130 / 2)) * SCALE)
    set_size(data[header], 565 * SCALE, 130 * SCALE)
    set_sprite(data, header, "room_invite_approved_header")
    data[node_index(data, root, "卡片/V8标题牌/文字")]["_active"] = False
    info = node_index(data, root, "卡片/房间信息")
    set_position(data[info], 0, (321 + 934 / 2 - (597 + 318 / 2)) * SCALE)
    set_size(data[info], 700 * SCALE, 318 * SCALE)
    set_sprite(data, info, "room_invite_approved_info_card")

    inviter = node_index(data, root, "卡片/邀请人")
    set_position(data[inviter], 0, (321 + 934 / 2 - (536 + 31 / 2)) * SCALE)
    set_label(data, inviter, 23, 30, 467 * SCALE, 31 * SCALE)
    room_number = node_index(data, root, "卡片/房间信息/房间号")
    set_position(data[room_number], 0, ((321 + 934 / 2 - (685 + 65 / 2)) * SCALE) - data[info]["_trs"]["array"][1])
    set_label(data, room_number, 64, 72, 312 * SCALE, 65 * SCALE)
    room_label = next(data[ref["__id__"]] for ref in data[room_number]["_components"] if data[ref["__id__"]]["__type__"] == "cc.Label")
    room_label["_N$file"] = {"__uuid__": "204a1055-7dc3-5fc0-8da6-8ad6816bf68e"}
    room_label["_styleFlags"] = 1
    room_label["_spacingX"] = 2
    data[room_number]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}

    details = node_index(data, root, "卡片/房间详情")
    data[details]["_active"] = False
    add_value_label(data, card, "底皮值", (326 - 470) * SCALE, (321 + 934 / 2 - (844 + 29 / 2)) * SCALE, 88 * SCALE)
    add_value_label(data, card, "人数值", (671 - 470) * SCALE, (321 + 934 / 2 - (844 + 29 / 2)) * SCALE, 90 * SCALE)
    data[node_index(data, root, "卡片/邀请文案")]["_active"] = False

    toggle = node_index(data, root, "卡片/本次登录不再弹出")
    set_position(data[toggle], (481.5 - 470) * SCALE, (321 + 934 / 2 - 1032.5) * SCALE)
    set_size(data[toggle], 295 * SCALE, 48 * SCALE)
    background = node_index(data, root, "卡片/本次登录不再弹出/Background")
    data[background]["_active"] = True
    set_position(data[background], (357.5 - 481.5) * SCALE, 0)
    set_size(data[background], 47 * SCALE, 47 * SCALE)
    set_sprite(data, background, "room_invite_approved_checkbox_ring")
    data[node_index(data, root, "卡片/本次登录不再弹出/文字")]["_active"] = False
    add_static_sprite(data, card, "本次登录不再弹出固定文案", "room_invite_approved_checkbox_label",
                      (514 - 470) * SCALE, (321 + 934 / 2 - (1012 + 39 / 2)) * SCALE, 230 * SCALE, 39 * SCALE)
    checkmark = node_index(data, root, "卡片/本次登录不再弹出/checkmark")
    set_position(data[checkmark], (357.5 - 481.5) * SCALE, 0)
    set_size(data[checkmark], 47 * SCALE, 47 * SCALE)
    set_sprite(data, checkmark, "room_invite_approved_checkmark")

    for path, x, width in (("忽略", 288, 324), ("前往", 645.5, 339)):
        button = node_index(data, root, "卡片/" + path)
        set_position(data[button], (x - 470) * SCALE, (321 + 934 / 2 - 1136) * SCALE)
        set_size(data[button], width * SCALE, 96 * SCALE)
        set_sprite(data, button, "room_invite_approved_button_ignore" if path == "忽略" else "room_invite_approved_button_go_room")
        button_component = next(data[ref["__id__"]] for ref in data[button]["_components"] if data[ref["__id__"]]["__type__"] == "cc.Button")
        button_component["_N$transition"] = 0
        button_component["transition"] = 0
        data[node_index(data, root, "卡片/" + path + "/文字")]["_active"] = False
    add_close_button(data, card)
    PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Applied approved room invitation prefab: {PREFAB.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
