#!/usr/bin/env python3
"""Render panelMain/发现 with four real cloned dynamic room templates.

The preview mutates an in-memory copy of ``panelMain.prefab`` only.  It finds
the hidden 733x146 ``房间对象`` used by ``scrollview2.itemPrefab``, clones its
serialized node/component subtree, and places rows using the live 156px pitch
(146px item + 10px spacing).  Runtime prefab, scripts, metas and art are never
written.
"""

from __future__ import annotations

import argparse
import copy
import json
import tempfile
from pathlib import Path
from typing import Any

from render_drh8_scene_preview import DEFAULT_CREATOR_ASSETS, PreviewRenderer, ref_id


ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets" / "resources" / "UI" / "panelMain.prefab"
DEFAULT_OUTPUT = ROOT / "art_sources" / "8l" / "qa" / "panelMain-discovery-rooms-750x1334.png"


ROOMS = (
    {"name": "8L-1-100001", "countdown": "剩余:29:48", "stake": "1", "players": "1/2", "duration": "30分钟"},
    {"name": "8L-1-100002", "countdown": "剩余:18:36", "stake": "2", "players": "3/8", "duration": "30分钟"},
    {"name": "8L-1-100003", "countdown": "剩余:05:12", "stake": "5", "players": "5/8", "duration": "30分钟"},
    {"name": "8L-1-100004", "countdown": "剩余:12:45", "stake": "10", "players": "2/8", "duration": "30分钟"},
)


def node_map(scene: list[Any]) -> dict[int, dict[str, Any]]:
    return {
        index: value
        for index, value in enumerate(scene)
        if isinstance(value, dict) and value.get("__type__") == "cc.Node"
    }


def subtree(scene: list[Any], root: int) -> tuple[list[int], list[int]]:
    nodes = node_map(scene)
    stack = [root]
    node_ids: list[int] = []
    component_ids: list[int] = []
    while stack:
        node_id = stack.pop()
        node_ids.append(node_id)
        node = nodes[node_id]
        stack.extend(
            child_id
            for child in node.get("_children") or []
            if (child_id := ref_id(child)) is not None and child_id in nodes
        )
        component_ids.extend(
            component_id
            for reference in node.get("_components") or []
            if (component_id := ref_id(reference)) is not None
        )
    return node_ids, component_ids


def remap_ids(value: Any, mapping: dict[int, int]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"__id__"} and isinstance(value["__id__"], int):
            return {"__id__": mapping.get(value["__id__"], value["__id__"])}
        return {key: remap_ids(item, mapping) for key, item in value.items()}
    if isinstance(value, list):
        return [remap_ids(item, mapping) for item in value]
    return value


def clone_subtree(scene: list[Any], root: int) -> tuple[int, dict[int, int]]:
    node_ids, component_ids = subtree(scene, root)
    closure = node_ids + component_ids
    mapping = {old: len(scene) + index for index, old in enumerate(closure)}
    for old in closure:
        scene.append(remap_ids(copy.deepcopy(scene[old]), mapping))
    new_root = mapping[root]
    parent = ref_id(scene[new_root].get("_parent"))
    if parent is None:
        raise RuntimeError("房间对象缺少父节点")
    scene[parent].setdefault("_children", []).append({"__id__": new_root})
    return new_root, mapping


def set_room(scene: list[Any], root: int, row: int, values: dict[str, str]) -> None:
    nodes = node_map(scene)
    root_node = nodes[root]
    root_node["_active"] = True
    transform = root_node.setdefault("_trs", {}).setdefault("array", [0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
    transform[0] = 0
    transform[1] = 295.158 - row * 156
    node_ids, _ = subtree(scene, root)
    field_by_name = {
        "name": values["name"],
        "倒计时": values["countdown"],
        "底皮": values["stake"],
        "人数": values["players"],
        "时间": values["duration"],
    }
    for node_id in node_ids:
        node = nodes[node_id]
        text = field_by_name.get(str(node.get("_name")))
        if text is None:
            continue
        for component_ref in node.get("_components") or []:
            component_id = ref_id(component_ref)
            if component_id is None:
                continue
            component = scene[component_id]
            if isinstance(component, dict) and component.get("__type__") == "cc.Label":
                component["_string"] = text
                # Creator 2.4 serializes the editor-facing value in
                # ``_N$string``; the renderer (like Creator) prefers it over
                # the legacy ``_string`` field when both are present.
                component["_N$string"] = text


def build_scene() -> list[Any]:
    scene: list[Any] = json.loads(PREFAB.read_text("utf-8"))
    nodes = node_map(scene)
    candidates = [
        node_id
        for node_id, node in nodes.items()
        if node.get("_name") == "房间对象"
        and round(float((node.get("_contentSize") or {}).get("width", 0))) == 733
        and round(float((node.get("_contentSize") or {}).get("height", 0))) == 146
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"应找到唯一房间对象，实际 {len(candidates)} 个")
    roots = [candidates[0]]
    for _ in range(1, len(ROOMS)):
        cloned, _ = clone_subtree(scene, candidates[0])
        roots.append(cloned)
    for index, (root, values) in enumerate(zip(roots, ROOMS)):
        set_room(scene, root, index, values)
    return scene


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--simulate-creator-size-mode", action="store_true")
    args = parser.parse_args()
    scene = build_scene()
    with tempfile.NamedTemporaryFile("w", suffix=".prefab", encoding="utf-8", delete=False) as handle:
        temp = Path(handle.name)
        json.dump(scene, handle, ensure_ascii=False)
    try:
        renderer = PreviewRenderer(
            temp,
            args.output.resolve(),
            DEFAULT_CREATOR_ASSETS,
            (2, 8, 18, 255),
            simulate_creator_size_mode=args.simulate_creator_size_mode,
        )
        renderer.render()
        renderer.print_report()
    finally:
        temp.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
