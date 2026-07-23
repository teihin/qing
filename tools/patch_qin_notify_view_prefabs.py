#!/usr/bin/env python3
"""Apply the Qin visual bindings shared by the three panelNotifyView prefabs.

Only the dedicated background binding, dynamic message colour and a visual
close-icon node are touched.  Existing button names, hit areas, title states,
layout values and panelMsgView behaviour remain unchanged.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREFABS = (
    ROOT / "assets" / "resources" / "UI" / "panelNotifyView.prefab",
    ROOT / "assets" / "resources" / "UI" / "panelNotifyViewCZ.prefab",
    ROOT / "assets" / "resources" / "UI" / "panelNotifyViewHD.prefab",
)

BACKGROUND_UUID = "3169545c-2899-4189-8457-2c724f5f7032"
CLOSE_ICON_UUID = "4b0b32f6-1d5b-431a-9999-b22e3a7e9604"
MESSAGE_COLOUR = {"__type__": "cc.Color", "r": 232, "g": 215, "b": 180, "a": 255}


def ref_id(value: object) -> int | None:
    if isinstance(value, dict) and isinstance(value.get("__id__"), int):
        return value["__id__"]
    return None


def components(data: list[dict], node: dict) -> list[tuple[int, dict]]:
    result: list[tuple[int, dict]] = []
    for reference in node.get("_components") or []:
        component_id = ref_id(reference)
        if component_id is not None:
            result.append((component_id, data[component_id]))
    return result


def child_id(data: list[dict], parent_id: int, name: str) -> int:
    parent = data[parent_id]
    matches = []
    for reference in parent.get("_children") or []:
        identifier = ref_id(reference)
        if identifier is not None and data[identifier].get("__type__") == "cc.Node" and data[identifier].get("_name") == name:
            matches.append(identifier)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one child {name!r} below node {parent_id}, found {matches}")
    return matches[0]


def sprite_component(data: list[dict], node_id: int) -> tuple[int, dict]:
    matches = [(identifier, value) for identifier, value in components(data, data[node_id]) if value.get("__type__") == "cc.Sprite"]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one cc.Sprite on node {node_id}, found {len(matches)}")
    return matches[0]


def prefab_info(data: list[dict], node_id: int) -> dict:
    info_id = ref_id(data[node_id].get("_prefab"))
    if info_id is None or data[info_id].get("__type__") != "cc.PrefabInfo":
        raise RuntimeError(f"Missing PrefabInfo for node {node_id}")
    return data[info_id]


def close_file_id(path: Path) -> str:
    return hashlib.sha1(f"{path.name}:qin-close-icon".encode("utf-8")).hexdigest()[:22]


def ensure_close_icon(path: Path, data: list[dict], bk_id: int, title_id: int) -> bool:
    existing = []
    for reference in data[bk_id].get("_children") or []:
        identifier = ref_id(reference)
        if identifier is not None and data[identifier].get("_name") == "关闭图标":
            existing.append(identifier)
    if len(existing) > 1:
        raise RuntimeError(f"Duplicate close-icon nodes in {path}")

    if existing:
        node_id = existing[0]
        _, sprite = sprite_component(data, node_id)
        sprite["_spriteFrame"] = {"__uuid__": CLOSE_ICON_UUID}
        node = data[node_id]
        node["_active"] = True
        node["_contentSize"] = {"__type__": "cc.Size", "width": 45, "height": 45}
        node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
        node["_trs"]["array"] = [288, 389, 0, 0, 0, 0, 1, 1, 1, 1]
        return False

    node_id = len(data)
    sprite_id = node_id + 1
    info_id = node_id + 2

    node = copy.deepcopy(data[title_id])
    node["_name"] = "关闭图标"
    node["_parent"] = {"__id__": bk_id}
    node["_children"] = []
    node["_active"] = True
    node["_components"] = [{"__id__": sprite_id}]
    node["_prefab"] = {"__id__": info_id}
    node["_opacity"] = 255
    node["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    node["_contentSize"] = {"__type__": "cc.Size", "width": 45, "height": 45}
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    node["_trs"] = {
        "__type__": "TypedArray",
        "ctor": "Float64Array",
        "array": [288, 389, 0, 0, 0, 0, 1, 1, 1, 1],
    }

    _, title_sprite = sprite_component(data, title_id)
    sprite = copy.deepcopy(title_sprite)
    sprite["node"] = {"__id__": node_id}
    sprite["_spriteFrame"] = {"__uuid__": CLOSE_ICON_UUID}
    sprite["_type"] = 0
    sprite["_sizeMode"] = 1
    sprite["_isTrimmedMode"] = True

    info = copy.deepcopy(prefab_info(data, title_id))
    info["root"] = {"__id__": 1}
    info["fileId"] = close_file_id(path)
    info["sync"] = False

    data.extend((node, sprite, info))
    data[bk_id].setdefault("_children", []).append({"__id__": node_id})
    return True


def patch_prefab(path: Path) -> tuple[bool, bool, bool]:
    original = path.read_text(encoding="utf-8")
    had_final_newline = original.endswith("\n")
    data = json.loads(original)

    root_nodes = [index for index, value in enumerate(data) if value.get("__type__") == "cc.Node" and ref_id(value.get("_parent")) is None]
    if len(root_nodes) != 1 or data[root_nodes[0]].get("_name") != "panelNotifyView":
        raise RuntimeError(f"Unexpected root in {path}")
    root_id = root_nodes[0]
    bk_id = child_id(data, root_id, "bk")
    msg_id = child_id(data, bk_id, "msg")
    title_id = child_id(data, bk_id, "最新公告")

    _, background_sprite = sprite_component(data, bk_id)
    old_background = background_sprite.get("_spriteFrame")
    background_sprite["_spriteFrame"] = {"__uuid__": BACKGROUND_UUID}

    old_colour = data[msg_id].get("_color")
    data[msg_id]["_color"] = copy.deepcopy(MESSAGE_COLOUR)
    close_added = ensure_close_icon(path, data, bk_id, title_id)

    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    if had_final_newline:
        serialized += "\n"
    json.loads(serialized)
    path.write_text(serialized, encoding="utf-8")
    return old_background != background_sprite["_spriteFrame"], old_colour != MESSAGE_COLOUR, close_added


def main() -> None:
    background_changes = 0
    colour_changes = 0
    close_additions = 0
    for path in PREFABS:
        changed_background, changed_colour, added_close = patch_prefab(path)
        background_changes += int(changed_background)
        colour_changes += int(changed_colour)
        close_additions += int(added_close)
    print(f"Patched {len(PREFABS)} panelNotifyView prefabs")
    print(f"Background bindings changed: {background_changes}")
    print(f"Message colours changed: {colour_changes}")
    print(f"Close-icon nodes added: {close_additions}")


if __name__ == "__main__":
    main()
