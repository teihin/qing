#!/usr/bin/env python3
"""Apply the original panelMsgView visual language to large dialog roots only.

This editor-time migration deliberately changes SpriteFrame references in the
formal Prefabs/Scene.  It never creates business nodes or changes events,
lists, anchors, masks, EditBoxes, toggles, or the system-settings subtree.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "V7"

# Existing V8 components are deliberately mapped only while walking the roots
# below; agent_v8_popup remains untouched everywhere else in the project.
REPLACEMENTS = {
    "agent_v8_popup": "original_dialog_panel",
    "ingame_dialog_v8_header": "original_dialog_title",
    "agent_v8_button_base": "original_dialog_button_blue",
    "ingame_dialog_v8_gold_button": "original_dialog_button_gold",
}

# These two legacy frames survive only in the queue table heading/template.
# Keeping them produces a black input-like strip inside an otherwise original
# blue panel, so scope their replacement to the same roots as the main chrome.
LEGACY_BLUE_FRAMES = {
    "68875994-36f1-4dbf-b6da-97119c03e094",  # player_info_v8_stats
    "0c8831a8-abf2-55bb-ac9b-30c12d6a15ac",  # 公用/输入框
}

TARGETS = {
    "assets/resources/UI/panelQueueMatch.prefab": (("排队面板",), ()),
    # VIP purchase confirmation intentionally belongs to the separate
    # confirmation-dialog pass and must retain its own visual treatment.
    "assets/resources/UI/panelVipInfo.prefab": (("",), ("确认购买面板",)),
    "assets/resources/UI/panelTalk.prefab": (("bk",), ()),
    # Root names are kept in sync with migrate_v8_ingame_dialogs.py.  The
    # system-settings root is purposefully absent.
    "assets/resources/UI/panelGameView.prefab": (("排队弹窗", "举报窗口", "牌型提示"), ()),
    "assets/Scenes/drh8.fire": (("排队弹窗", "举报窗口", "牌型提示"), ()),
}


def sprite_uuid(name: str) -> str:
    meta = json.loads((ASSETS / f"{name}.png.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][name]["uuid"]


def node_index(data: list[dict], root: int, path: str) -> int:
    if not path:
        return root
    node = root
    for part in path.split("/"):
        node = next(
            ref["__id__"] for ref in data[node].get("_children", [])
            if data[ref["__id__"]].get("_name") == part
        )
    return node


def file_root(data: list[dict], relative: str) -> int:
    # A .fire is a scene serialization and can contain several root objects;
    # its visual target is the instantiated panelGameView, not the first scene
    # root record.
    if relative.endswith("panelGameView.prefab") or relative.endswith("drh8.fire"):
        return next(i for i, item in enumerate(data)
                    if item.get("__type__") == "cc.Node" and item.get("_name") == "panelGameView")
    return next(i for i, item in enumerate(data)
                if item.get("__type__") == "cc.Node" and item.get("_parent") is None)


def subtree(data: list[dict], node: int, excluded: set[int]) -> list[int]:
    if node in excluded:
        return []
    result = [node]
    for ref in data[node].get("_children", []):
        result.extend(subtree(data, ref["__id__"], excluded))
    return result


def changed_sprite_ids(data: list[dict], nodes: list[int], old: dict[str, str], new: dict[str, str]) -> int:
    changed = 0
    for node in nodes:
        for ref in data[node].get("_components", []):
            component = data[ref["__id__"]]
            if component.get("__type__") != "cc.Sprite":
                continue
            frame = component.get("_spriteFrame") or {}
            prior = frame.get("__uuid__")
            if prior in set(new.values()):
                # A few reused table sprites carried a black node tint from
                # their former input-box art.  Original chrome is authored in
                # its final colours and must not inherit that tint.
                if data[node].get("_color") != {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}:
                    data[node]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
                    changed += 1
                continue
            if prior in LEGACY_BLUE_FRAMES:
                component["_spriteFrame"] = {"__uuid__": new["agent_v8_button_base"]}
                component["_type"] = 1
                component["_sizeMode"] = 0
                component["_isTrimmedMode"] = False
                data[node]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
                changed += 1
                continue
            if prior in old:
                component["_spriteFrame"] = {"__uuid__": new[old[prior]]}
                component["_type"] = 1
                component["_sizeMode"] = 0
                component["_isTrimmedMode"] = False
                data[node]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
                # Some V8 subheaders were serialized at 52px high.  The
                # original plate needs its full rounded shoulder, so restore
                # the minimum 76px art height while retaining its anchor and
                # centre position.  Existing title labels remain children and
                # therefore cannot double-render with an obsolete glyph Sprite.
                if old[prior] == "ingame_dialog_v8_header":
                    data[node]["_contentSize"]["height"] = max(
                        76, data[node]["_contentSize"]["height"])
                changed += 1
    return changed


def selected_nodes(data: list[dict], relative: str, roots: tuple[str, ...], excluded: tuple[str, ...]) -> list[int]:
    root = file_root(data, relative)
    excluded_ids = {node_index(data, root, path) for path in excluded}
    nodes: list[int] = []
    for path in roots:
        nodes.extend(subtree(data, node_index(data, root, path), excluded_ids))
    return nodes


def verify_asset(name: str) -> None:
    png = ASSETS / f"{name}.png"
    meta = ASSETS / f"{name}.png.meta"
    if not png.is_file() or not meta.is_file():
        raise FileNotFoundError(f"missing original dialog art: {name}")
    # Read each meta now, so a malformed SpriteFrame UUID fails before any
    # Prefab is written.
    sprite_uuid(name)


def apply(relative: str, write: bool) -> int:
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    roots, excluded = TARGETS[relative]
    nodes = selected_nodes(data, relative, roots, excluded)
    old = {sprite_uuid(source): source for source in REPLACEMENTS}
    new = {source: sprite_uuid(destination)
           for source, destination in REPLACEMENTS.items()}
    changed = changed_sprite_ids(data, nodes, old, new)
    if relative == "assets/resources/UI/panelRoomInvite.prefab":
        # Keep the subtitle clear of the 76px original title plate shoulder.
        subtitle = node_index(data, file_root(data, relative), "卡片/副标题")
        if data[subtitle]["_trs"]["array"][1] != 195:
            data[subtitle]["_trs"]["array"][1] = 195
            changed += 1
    if write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def check() -> None:
    for name in REPLACEMENTS.values():
        verify_asset(name)
    # A dry pass must deserialize every selected root without modifying it.
    # It also ensures no excluded confirmation subtree is traversed.
    for relative, (_, excluded) in TARGETS.items():
        data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        roots = file_root(data, relative)
        selected = set(selected_nodes(data, relative, TARGETS[relative][0], excluded))
        for path in excluded:
            forbidden = set(subtree(data, node_index(data, roots, path), set()))
            if selected & forbidden:
                raise AssertionError(f"excluded subtree selected: {relative}:{path}")
        apply(relative, write=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate resources and target traversal only")
    args = parser.parse_args()
    check()
    if args.check:
        print("Original large-dialog style check passed (no Prefabs written).")
        return
    total = sum(apply(relative, write=True) for relative in TARGETS)
    print(f"Applied original large-dialog style to {len(TARGETS)} serialized files; {total} SpriteFrame references changed.")


if __name__ == "__main__":
    main()
