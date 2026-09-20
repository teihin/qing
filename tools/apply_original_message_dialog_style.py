#!/usr/bin/env python3
"""Restore the compact legacy message-dialog art in the specified live assets.

This only changes serialized presentation fields.  Button components, their
clickEvents, custom components, and every existing node path stay in place.
"""
from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PANEL_MSGVIEW_BASELINE = "23a17226cb03b506650ff09fbd9068165cc45d0c"
SINGLE = "6f230ed9-33c6-5835-b1c5-be16254a193d"
DUAL = "3030ef1d-2f02-54ea-94c8-cf3dbb2a46b9"
DIM = "a23235d1-15db-4b95-8439-a2e005bfff91"
MSG_COLOR = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}

TARGETS = (
    ("assets/resources/UI/panelGameView.prefab", "panelGameView"),
    ("assets/Scenes/drh8.fire", "panelGameView"),
)
DIALOGS = {
    # The double-art has 取消 on the left and 确定 on the right.  Ordering here
    # controls only transparent hot zones; it must match that embedded text.
    "扣费提示": ("关闭上层", "确认延时"),
    "芒果提示": ("关闭上层", "确认芒果"),
    "解散房间": ("关闭上层", "确认解散"),
    "GPS警告": ("返回大厅",),
    "举报扣费提示": ("关闭上层", "确认举报"),
}


def node(data, root, path):
    current = root
    for name in filter(None, path.split("/")):
        current = next(ref["__id__"] for ref in data[current].get("_children", [])
                       if data[ref["__id__"]].get("_name") == name)
    return current


def component(data, node_id, typ):
    for ref in data[node_id].get("_components", []):
        obj = data[ref["__id__"]]
        if obj.get("__type__") == typ:
            return obj
    return None


def set_box(data, node_id, x, y, width, height, active=None):
    obj = data[node_id]
    obj["_trs"]["array"][0:2] = [x, y]
    # Scene instances can retain a stale zero z scale after editor edits;
    # flattened message hot zones must use the Prefab's normal scale.
    obj["_trs"]["array"][9] = 1
    obj["_contentSize"] = {"__type__": "cc.Size", "width": width, "height": height}
    if active is not None:
        obj["_active"] = active


def set_sprite(data, node_id, frame, enabled=True):
    sprite = component(data, node_id, "cc.Sprite")
    if sprite is None:
        raise ValueError(f"missing Sprite on {data[node_id].get('_name')}")
    sprite.update(_enabled=enabled, _spriteFrame={"__uuid__": frame}, _type=0,
                  _sizeMode=0, _isTrimmedMode=False)
    data[node_id]["_color"] = copy.deepcopy(MSG_COLOR)
    data[node_id]["_opacity"] = 255


def hide_v8_nodes(data, root_id):
    for ref in data[root_id].get("_children", []):
        child = ref["__id__"]
        # This is the existing semi-transparent fullscreen dimmer.  Retain it
        # while retiring only title/text additions from the rejected V8 style.
        if data[child].get("_name", "").startswith("V8") and data[child].get("_name") != "V8遮罩":
            data[child]["_active"] = False
        hide_v8_nodes(data, child)


def apply_dialog(data, root_id, name, actions):
    dialog = node(data, root_id, name)
    set_box(data, dialog, 0, 0, 750, 1334)
    # The original shared semi-transparent fullscreen dimmer remains first.
    dim = node(data, dialog, "V8遮罩")
    data[dim]["_active"] = True
    if name == "举报扣费提示":
        data[node(data, dialog, "bk copy")]["_active"] = False

    bk = node(data, dialog, "bk")
    dual = len(actions) == 2
    set_box(data, bk, 0, 13, 532, 366)
    set_sprite(data, bk, DUAL if dual else SINGLE)

    msg = node(data, dialog, "msg")
    # These roots hold bk/msg/buttons as siblings, so their coordinates include
    # bk's +13 centre offset from the original panelMsgView composition.
    set_box(data, msg, 0, 48 if name != "芒果提示" else 63, 450, 132 if name != "芒果提示" else 104)
    label = component(data, msg, "cc.Label")
    if label is None:
        raise ValueError(f"missing msg Label in {name}")
    label.update(_enabled=True, _fontSize=30, _lineHeight=40, _enableWrapText=True,
                 _overflow=2, **{"_N$overflow": 2, "_N$horizontalAlign": 1,
                                   "_N$verticalAlign": 1})
    data[msg]["_color"] = copy.deepcopy(MSG_COLOR)

    if name == "芒果提示":
        info = node(data, dialog, "name")
        set_box(data, info, 0, -7, 450, 32)
        info_label = component(data, info, "cc.Label")
        if info_label is not None:
            info_label.update(_fontSize=24, _lineHeight=30, _enableWrapText=False,
                              _overflow=1, **{"_N$overflow": 1, "_N$horizontalAlign": 1,
                                                "_N$verticalAlign": 1})
        data[info]["_color"] = copy.deepcopy(MSG_COLOR)

    positions = (0,) if not dual else (-135, 135)
    for action, x in zip(actions, positions):
        button = node(data, dialog, action)
        set_box(data, button, x, -81 if not dual else -99, 210 if not dual else 200, 64)
        # Button lettering is already embedded in the 532x366 original art;
        # retain only a transparent hot zone and its existing event callback.
        sprite = component(data, button, "cc.Sprite")
        if sprite is not None:
            sprite["_enabled"] = False
        hide_v8_nodes(data, button)
    hide_v8_nodes(data, dialog)


def apply_vip():
    path = ROOT / "assets/resources/UI/panelVipInfo.prefab"
    data = json.loads(path.read_text(encoding="utf-8"))
    root = next(i for i, obj in enumerate(data)
                if obj.get("__type__") == "cc.Node" and obj.get("_parent") is None)
    panel = node(data, root, "确认购买面板")
    bk = node(data, panel, "bk")
    set_box(data, bk, 0, 13, 532, 366)
    set_sprite(data, bk, DUAL)
    msg = node(data, bk, "msg")
    set_box(data, msg, 0, 35, 450, 132)
    label = component(data, msg, "cc.Label")
    label.update(_enabled=True, _fontSize=30, _lineHeight=40, _enableWrapText=True,
                 _overflow=2, **{"_N$overflow": 2, "_N$horizontalAlign": 1,
                                   "_N$verticalAlign": 1})
    data[msg]["_color"] = copy.deepcopy(MSG_COLOR)
    for action, x in (("关闭上上层", -135), ("确认购买VIP", 135)):
        button = node(data, bk, action)
        set_box(data, button, x, -112, 200, 64)
        sprite = component(data, button, "cc.Sprite")
        if sprite is not None:
            sprite["_enabled"] = False
        hide_v8_nodes(data, button)
    hide_v8_nodes(data, panel)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def restore_panel_msgview():
    target = ROOT / "assets/resources/UI/panelMsgView.prefab"
    blob = subprocess.run(
        ["git", "show", f"{PANEL_MSGVIEW_BASELINE}:assets/resources/UI/panelMsgView.prefab"], cwd=ROOT,
        check=True, stdout=subprocess.PIPE).stdout
    target.write_bytes(blob)


def main():
    restore_panel_msgview()
    for relative, root_name in TARGETS:
        path = ROOT / relative
        data = json.loads(path.read_text(encoding="utf-8"))
        root = next(i for i, obj in enumerate(data)
                    if obj.get("__type__") == "cc.Node" and obj.get("_name") == root_name)
        for name, actions in DIALOGS.items():
            apply_dialog(data, root, name, actions)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    apply_vip()


if __name__ == "__main__":
    main()
