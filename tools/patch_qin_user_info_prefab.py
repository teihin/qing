#!/usr/bin/env python3
"""Bind panelUserInfo to its Qin frame and recolour dynamic labels.

The patch is intentionally limited to one SpriteFrame UUID and node colours;
node names, hierarchy, transforms, sizes, buttons, toggles and scripts are not
changed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets" / "resources" / "UI" / "panelUserInfo.prefab"

OLD_FRAME = "e92694a7-bab9-463e-84a2-ad38bee64974"
NEW_FRAME = "16e1036d-1390-4cbb-88a8-e82e02c2f6e9"

GOLD = (223, 172, 82, 255)
GOLD_HI = (255, 237, 181, 255)
IVORY = (235, 218, 181, 255)
COPPER = (188, 76, 54, 255)


def ref_id(value: Any) -> int | None:
    return value.get("__id__") if isinstance(value, dict) and isinstance(value.get("__id__"), int) else None


def node_paths(data: list[Any]) -> tuple[dict[str, list[int]], dict[int, dict[str, Any]]]:
    nodes = {
        index: item
        for index, item in enumerate(data)
        if isinstance(item, dict) and item.get("__type__") == "cc.Node"
    }
    roots = [index for index, node in nodes.items() if ref_id(node.get("_parent")) is None]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one prefab root, found {len(roots)}")
    paths: dict[str, list[int]] = {}

    def walk(node_id: int, parent: str) -> None:
        node = nodes[node_id]
        name = node.get("_name")
        if not isinstance(name, str) or not name:
            raise RuntimeError(f"Invalid node name at {node_id}")
        path = f"{parent}/{name}" if parent else name
        paths.setdefault(path, []).append(node_id)
        for child in node.get("_children") or []:
            child_id = ref_id(child)
            if child_id not in nodes:
                raise RuntimeError(f"Broken child reference below {path}")
            walk(child_id, path)

    walk(roots[0], "")
    return paths, nodes


def unique(paths: dict[str, list[int]], path: str) -> int:
    matches = paths.get(path, [])
    if len(matches) != 1:
        raise RuntimeError(f"Expected one node at {path}, found {len(matches)}")
    return matches[0]


def set_colour(node: dict[str, Any], colour: tuple[int, int, int, int]) -> bool:
    expected = {"__type__": "cc.Color", "r": colour[0], "g": colour[1], "b": colour[2], "a": colour[3]}
    if node.get("_color") == expected:
        return False
    node["_color"] = expected
    return True


def main() -> None:
    data = json.loads(PREFAB.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise RuntimeError("panelUserInfo prefab root is not a JSON array")
    paths, nodes = node_paths(data)
    changed = False

    frame_node_id = unique(paths, "panelUserInfo/bk copy")
    frame_components = []
    for component_ref in nodes[frame_node_id].get("_components") or []:
        component_id = ref_id(component_ref)
        if component_id is not None and data[component_id].get("__type__") == "cc.Sprite":
            frame_components.append(data[component_id])
    if len(frame_components) != 1:
        raise RuntimeError(f"Expected one frame Sprite, found {len(frame_components)}")
    current_frame = frame_components[0].get("_spriteFrame", {}).get("__uuid__")
    if current_frame not in (OLD_FRAME, NEW_FRAME):
        raise RuntimeError(f"Unexpected panel frame UUID: {current_frame}")
    if current_frame != NEW_FRAME:
        frame_components[0]["_spriteFrame"] = {"__uuid__": NEW_FRAME}
        changed = True

    colour_paths = {
        "panelUserInfo/数据/txt": GOLD,
        "panelUserInfo/数据/id": IVORY,
        "panelUserInfo/数据/name": GOLD_HI,
        "panelUserInfo/数据/统计/总手数": IVORY,
        "panelUserInfo/数据/统计/总胜率": IVORY,
        "panelUserInfo/数据/统计/失败率": COPPER,
        "panelUserInfo/数据/统计/胜利": IVORY,
        "panelUserInfo/数据/统计/平局": IVORY,
        "panelUserInfo/数据/统计/失败": COPPER,
        "panelUserInfo/数据/统计/入池率": IVORY,
        "panelUserInfo/数据/统计/翻牌率": IVORY,
        "panelUserInfo/数据/统计/翻牌胜率": IVORY,
    }
    for prop in ("亲嘴", "抓鸡", "干杯", "大拇指", "炸弹", "机枪", "鲨鱼", "Nice", "钓鱼", "屎"):
        label = "label" if prop == "Nice" else "label copy"
        colour_paths[f"panelUserInfo/数据/道具/{prop}/{label}"] = GOLD

    for path, colour in colour_paths.items():
        changed |= set_colour(nodes[unique(paths, path)], colour)

    if changed:
        PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Patched panelUserInfo frame and dynamic label colours")
    else:
        print("panelUserInfo prefab already matches Qin bindings")


if __name__ == "__main__":
    main()
