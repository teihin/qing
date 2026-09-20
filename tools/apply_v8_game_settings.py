#!/usr/bin/env python3
"""Apply the V8 game-settings visual tree to its two formal Cocos files.

This is an editor-time, narrowly scoped migration.  It only changes
``panelGameView/系统设置`` in the formal Prefab and drh8 Scene.  Names, parentage
and every Button/Toggle/ToggleContainer component that panelGameView.ts uses
are treated as an immutable contract.

The final art is intentionally supplied as small transparent components rather
than a page screenshot.  ``extract_v8_game_settings_assets.py`` creates the
PNG files and their Cocos meta files before this tool is run.
"""
from __future__ import annotations

import copy
import base64
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set, Tuple

import apply_v7_prefab_skin as prefab_skin


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "V7"
PAGES = (
    "assets/resources/UI/panelGameView.prefab",
    "assets/Scenes/drh8.fire",
)
SETTINGS_ROOT = "系统设置"

# Names are deliberately explicit: the extractor is the single producer of
# these transparent visual components.  They are not game-table textures or
# the runtime card-back assets loaded by Tool.GetCardBackIndex().
ASSETS = {
    "frame": "settings_v8_frame.png",
    "title": "settings_v8_title.png",
    "table_1": "settings_v8_table_1.png",
    "table_2": "settings_v8_table_2.png",
    "table_3": "settings_v8_table_3.png",
    "table_4": "settings_v8_table_4.png",
    "table_5": "settings_v8_table_5.png",
    "table_1_selected": "settings_v8_table_1_selected.png",
    "table_2_selected": "settings_v8_table_2_selected.png",
    "table_3_selected": "settings_v8_table_3_selected.png",
    "table_4_selected": "settings_v8_table_4_selected.png",
    "table_5_selected": "settings_v8_table_5_selected.png",
    "back_0": "settings_v8_back_0.png",
    "back_1": "settings_v8_back_1.png",
    "back_2": "settings_v8_back_2.png",
    "back_0_selected": "settings_v8_back_0_selected.png",
    "back_1_selected": "settings_v8_back_1_selected.png",
    "back_2_selected": "settings_v8_back_2_selected.png",
    "selection": "settings_v8_selection.png",
    "check": "settings_v8_check.png",
    "close": "settings_v8_close.png",
    "toggle_off": "settings_v8_toggle_off.png",
    "toggle_on": "settings_v8_toggle_on.png",
    "rule": "settings_v8_rule.png",
    "controls_frame": "settings_v8_controls_frame.png",
    "table_icon": "settings_v8_table_icon.png",
    "top_cards": "settings_v8_top_cards.png",
    "back_icon": "settings_v8_back_icon.png",
    "sound_icon": "settings_v8_sound_icon.png",
    "voice_icon": "settings_v8_voice_icon.png",
    "spotlight_icon": "settings_v8_spotlight_icon.png",
}

FONT = {"__uuid__": "fd7307b2-666e-4c26-963d-59f787cad6fb"}
GOLD = (255, 239, 205)
PALE = (222, 237, 244)
SUB = (151, 199, 224)

Prefab = prefab_skin.Prefab
prefab_skin.ASSET_DIR = ASSET_DIR


def load(relative: str) -> Prefab:
    prefab = Prefab.__new__(Prefab)
    prefab.path = ROOT / relative
    prefab.data = json.loads(prefab.path.read_text(encoding="utf-8"))
    prefab.root = next(
        index for index, item in enumerate(prefab.data)
        if item.get("__type__") == "cc.Node" and item.get("_name") == "panelGameView"
    )
    return prefab


def scope(prefab: Prefab, node_id: int) -> Set[int]:
    result: Set[int] = set()

    def visit(current: int) -> None:
        if current in result:
            return
        result.add(current)
        node = prefab.data[current]
        prefab_info = node.get("_prefab")
        if isinstance(prefab_info, dict) and "__id__" in prefab_info:
            result.add(prefab_info["__id__"])
        for ref in node.get("_components", []):
            result.add(ref["__id__"])
        for ref in node.get("_children", []):
            visit(ref["__id__"])

    visit(node_id)
    return result


def outside_snapshot(prefab: Prefab, node_id: int) -> Dict[int, Any]:
    in_scope = scope(prefab, node_id)
    return {index: copy.deepcopy(item) for index, item in enumerate(prefab.data) if index not in in_scope}


def business_snapshot(prefab: Prefab, node_id: int) -> Dict[str, Any]:
    """Capture every operational component in the settings tree verbatim."""
    result: Dict[str, Any] = {}
    for index in scope(prefab, node_id):
        item = prefab.data[index]
        if item.get("__type__") not in {"cc.Button", "cc.Toggle", "cc.ToggleContainer"}:
            continue
        owner = item.get("node", {}).get("__id__")
        if owner is None:
            raise AssertionError(f"business component {index} has no node")
        result[f"{item['__type__']}:{node_path(prefab, owner)}"] = copy.deepcopy(item)
    return result


def assert_unchanged_outside(prefab: Prefab, before: Dict[int, Any]) -> None:
    # Compare exactly the indices that were outside before migration.  Visual
    # renderer components detached inside the target tree intentionally become
    # orphaned serialized objects, so deriving a new outside-scope set would
    # incorrectly classify those old target objects as unrelated changes.
    changed = [index for index, item in before.items() if prefab.data[index] != item]
    if changed:
        raise AssertionError(f"{prefab.path}: settings migration touched outside objects {changed[:12]}")


def component(prefab: Prefab, node_id: int, type_name: str) -> Dict[str, Any] | None:
    _, item = prefab.component(node_id, type_name)
    return item


def node_path(prefab: Prefab, node_id: int) -> str:
    parts: List[str] = []
    current: int | None = node_id
    while current is not None:
        node = prefab.data[current]
        if node.get("__type__") != "cc.Node":
            break
        parts.append(node["_name"])
        parent = node.get("_parent")
        current = parent.get("__id__") if isinstance(parent, dict) else None
    return "/".join(reversed(parts))


def detach_component(prefab: Prefab, node_id: int, type_name: str) -> None:
    """Remove a superseded renderer from the node's live component list."""
    refs = prefab.data[node_id].get("_components", [])
    prefab.data[node_id]["_components"] = [
        ref for ref in refs if prefab.data[ref["__id__"]].get("__type__") != type_name
    ]


def reset_node(prefab: Prefab, node_id: int) -> None:
    node = prefab.data[node_id]
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    node["_trs"]["array"][3:7] = [0, 0, 0, 1]
    node["_trs"]["array"][7:10] = [1, 1, 1]
    node["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    node["_opacity"] = 255
    prefab.disable(node_id, "cc.Widget")


def place(prefab: Prefab, path: str, x: float, y: float, width: float, height: float,
          active: bool | None = None) -> int:
    node_id = prefab.node(path)
    reset_node(prefab, node_id)
    prefab.set_pos(node_id, x, y, width, height)
    if active is not None:
        prefab.set_active(node_id, active)
    return node_id


def set_art(prefab: Prefab, path: str, asset: str, x: float, y: float,
            width: float, height: float, *, sliced: bool = False,
            active: bool | None = None) -> int:
    node_id = place(prefab, path, x, y, width, height, active)
    prefab.sprite(node_id, asset, sliced=sliced)
    return node_id


def template(prefab: Prefab, type_name: str) -> Dict[str, Any]:
    return copy.deepcopy(next(item for item in prefab.data if item.get("__type__") == type_name))


def new_visual_node(prefab: Prefab, parent_path: str, name: str) -> int:
    path = f"{parent_path}/{name}"
    identity = uuid.uuid5(uuid.NAMESPACE_URL, f"qing/v8-game-settings/{prefab.path}/{path}")
    file_id = identity.hex[:2] + base64.b64encode(identity.bytes[1:]).decode("ascii")
    try:
        node_id = prefab.node(path)
        info_ref = prefab.data[node_id].get("_prefab")
        if isinstance(info_ref, dict) and "__id__" in info_ref:
            prefab.data[info_ref["__id__"]]["fileId"] = file_id
        return node_id
    except KeyError:
        pass
    parent = prefab.node(parent_path)
    node = copy.deepcopy(prefab.data[prefab.root])
    node_id = len(prefab.data)
    info_id = node_id + 1
    node.update(_name=name, _parent={"__id__": parent}, _children=[], _components=[],
                _active=True, _prefab={"__id__": info_id}, _id="")
    node["_contentSize"] = {"__type__": "cc.Size", "width": 100, "height": 100}
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    node["_trs"]["array"] = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
    info = copy.deepcopy(prefab.data[prefab.data[prefab.root]["_prefab"]["__id__"]])
    info.update(
        root={"__id__": prefab.root}, sync=False,
        fileId=file_id, _id="",
    )
    prefab.data.extend((node, info))
    prefab.data[parent].setdefault("_children", []).append({"__id__": node_id})
    return node_id


def add_art(prefab: Prefab, parent: str, name: str, asset: str, x: float, y: float,
            width: float, height: float, *, sliced: bool = False) -> int:
    node_id = new_visual_node(prefab, parent, name)
    reset_node(prefab, node_id)
    prefab.set_pos(node_id, x, y, width, height)
    prefab.sprite(node_id, asset, sliced=sliced)
    return node_id


def ensure_label(prefab: Prefab, node_id: int) -> Dict[str, Any]:
    label = component(prefab, node_id, "cc.Label")
    if label is not None:
        return label
    label = template(prefab, "cc.Label")
    label.update(node={"__id__": node_id}, _enabled=True, _id="")
    label_id = len(prefab.data)
    prefab.data.append(label)
    prefab.data[node_id].setdefault("_components", []).append({"__id__": label_id})
    return label


def label(prefab: Prefab, path: str, text: str, x: float, y: float, width: float,
          height: float, size: int, color: Tuple[int, int, int], *, bold: bool = False,
          secondary: bool = False) -> None:
    node_id = place(prefab, path, x, y, width, height)
    detach_component(prefab, node_id, "cc.Sprite")
    item = ensure_label(prefab, node_id)
    item.update({
        "_string": text, "_N$string": text, "_fontSize": size,
        "_lineHeight": round(size * 1.25), "_enableWrapText": False,
        "_N$file": FONT, "_isSystemFontUsed": False,
        "_styleFlags": 1 if bold else 0, "_N$horizontalAlign": 1,
        "_N$verticalAlign": 1, "_N$overflow": 1, "_id": "",
    })
    prefab.data[node_id]["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
    if secondary:
        item["_fontSize"] = size


def visual_contract(prefab: Prefab) -> Dict[str, Any]:
    """Stable navigation paths that panelGameView.ts dereferences."""
    paths = (
        "系统设置/关闭上层",
        *(f"系统设置/设置/桌面/桌面{index}" for index in range(1, 6)),
        *(f"系统设置/设置/牌背/牌背{index}" for index in range(3)),
        "系统设置/设置/声音/音效/音效开关",
        "系统设置/设置/声音/语音/语音开关",
        "系统设置/设置/聚光灯/聚光灯开关",
    )
    return {path: prefab.node(path) for path in paths}


def apply(prefab: Prefab) -> None:
    root_id = prefab.node(SETTINGS_ROOT)
    before_outside = outside_snapshot(prefab, root_id)
    before_business = business_snapshot(prefab, root_id)
    before_paths = visual_contract(prefab)
    active = prefab.data[root_id]["_active"]

    # The overlay remains responsive, while the visual card stays fixed and
    # centered.  This mirrors the approved long-screen composition.
    # Keep the pre-existing root/mask Widgets enabled: they make this overlay
    # cover both short and tall Creator canvases.  Inner art is fixed-size.
    root = root_id
    prefab.set_pos(root, 0, 0, 750, 1334)
    mask = prefab.node(f"{SETTINGS_ROOT}/mask")
    prefab.set_pos(mask, 0, 0, 750, 1800)
    prefab.data[mask]["_opacity"] = 190
    prefab.data[mask]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 10, "b": 22, "a": 255}

    # Existing business nodes are retained.  Component art is filled in after
    # the art extractor supplies the final dimensions, then this layout block
    # is deliberately the only place that may adjust their visuals.
    set_art(prefab, f"{SETTINGS_ROOT}/bk", ASSETS["frame"], 0, -8, 690, 1035)
    set_art(prefab, f"{SETTINGS_ROOT}/bk/牌局设置", ASSETS["title"], 0, 402, 280, 68)
    detach_component(prefab, prefab.node(f"{SETTINGS_ROOT}/bk/牌局设置"), "cc.Label")
    title_label = prefab.node(f"{SETTINGS_ROOT}/bk/牌局设置/V8文字")
    detach_component(prefab, title_label, "cc.Label")
    prefab.set_active(title_label, False)
    add_art(prefab, f"{SETTINGS_ROOT}/bk", "V8顶牌饰", ASSETS["top_cards"], 0, 510, 180, 122)
    set_art(prefab, f"{SETTINGS_ROOT}/关闭上层/btn_4", ASSETS["close"], 0, 0, 68, 68)
    place(prefab, f"{SETTINGS_ROOT}/关闭上层", 296, 440, 86, 86)

    group = f"{SETTINGS_ROOT}/设置"
    place(prefab, group, 0, -42, 630, 830)

    desktop = f"{group}/桌面"
    place(prefab, desktop, 0, 260, 630, 275)
    label(prefab, f"{desktop}/选择桌面", "选择桌面", -120, 104, 250, 52, 34, GOLD, bold=True)
    add_art(prefab, desktop, "V8桌面图标", ASSETS["table_icon"], -246, 105, 48, 48)
    add_art(prefab, desktop, "V8桌面分隔线", ASSETS["rule"], 144, 105, 282, 4, sliced=True)
    for index, x in enumerate((-240, -120, 0, 120, 240), 1):
        toggle = f"{desktop}/桌面{index}"
        place(prefab, toggle, x, -26, 108, 178)
        set_art(prefab, f"{toggle}/Background", ASSETS[f"table_{index}"], 0, 0, 102, 170)
        set_art(prefab, f"{toggle}/checkmark", ASSETS[f"table_{index}_selected"], 0, 0, 116, 184)

    backs = f"{group}/牌背"
    place(prefab, backs, 0, 3, 630, 220)
    label(prefab, f"{backs}/选择牌面", "选择牌背", -120, 80, 250, 52, 34, GOLD, bold=True)
    add_art(prefab, backs, "V8牌背图标", ASSETS["back_icon"], -246, 80, 48, 48)
    add_art(prefab, backs, "V8牌背分隔线", ASSETS["rule"], 144, 80, 282, 4, sliced=True)
    for index, x in enumerate((-175, 0, 175)):
        toggle = f"{backs}/牌背{index}"
        place(prefab, toggle, x, -48, 155, 208)
        set_art(prefab, f"{toggle}/Background", ASSETS[f"back_{index}"], 0, 0, 145, 200)
        set_art(prefab, f"{toggle}/checkmark", ASSETS[f"back_{index}_selected"], 0, 0, 155, 208)

    sound = f"{group}/声音"
    place(prefab, sound, 0, -236, 630, 105)
    for branch, title, icon, x in (("音效", "游戏音效", "sound_icon", -155), ("语音", "语音聊天", "voice_icon", 155)):
        path = f"{sound}/{branch}"
        place(prefab, path, x, 0, 290, 90)
        add_art(prefab, path, "V8图标", ASSETS[icon], -104, 0, 52, 52)
        label(prefab, f"{path}/{'游戏音效' if branch == '音效' else '语音聊天'}", title, -35, 0, 158, 42, 28, PALE, bold=True)
        switch = f"{path}/{branch}开关"
        place(prefab, switch, 104, 0, 100, 62)
        set_art(prefab, f"{switch}/Background", ASSETS["toggle_off"], 0, 0, 94, 58)
        set_art(prefab, f"{switch}/checkmark", ASSETS["toggle_on"], 0, 0, 94, 58)

    spotlight = f"{group}/聚光灯"
    place(prefab, spotlight, 0, -342, 630, 112)
    add_art(prefab, spotlight, "V8图标", ASSETS["spotlight_icon"], -247, 0, 58, 58)
    label(prefab, f"{spotlight}/标题", "下注聚光灯", -125, 18, 250, 42, 29, PALE, bold=True)
    label(prefab, f"{spotlight}/说明", "聚焦当前操作位置", -116, -24, 270, 32, 22, SUB)
    switch = f"{spotlight}/聚光灯开关"
    place(prefab, switch, 236, 0, 100, 62)
    set_art(prefab, f"{switch}/Background", ASSETS["toggle_off"], 0, 0, 94, 58)
    set_art(prefab, f"{switch}/checkmark", ASSETS["toggle_on"], 0, 0, 94, 58)

    add_art(prefab, group, "V8控制区底框", ASSETS["controls_frame"], 0, -289, 610, 280)
    add_art(prefab, group, "V8控制区分隔线", ASSETS["rule"], 0, -288, 560, 3, sliced=True)

    prefab.set_active(root, active)
    assert_unchanged_outside(prefab, before_outside)
    if business_snapshot(prefab, root) != before_business:
        raise AssertionError(f"{prefab.path}: settings Button/Toggle contract changed")
    if visual_contract(prefab) != before_paths:
        raise AssertionError(f"{prefab.path}: settings business path changed")


def validate_assets() -> None:
    missing = [name for name in ASSETS.values() if not (ASSET_DIR / name).is_file() or not (ASSET_DIR / f"{name}.meta").is_file()]
    if missing:
        raise FileNotFoundError("missing extracted V8 settings component assets: " + ", ".join(missing))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    validate_assets()
    for relative in PAGES:
        prefab = load(relative)
        apply(prefab)
        prefab.save()
    # Scene and Prefab serialize different object IDs; compare the exposed
    # operational tree rather than byte identity.
    contracts = [visual_contract(load(relative)) for relative in PAGES]
    if tuple(contracts[0]) != tuple(contracts[1]):
        raise AssertionError("Prefab/Scene settings path contracts differ")
    print("V8 game settings applied to the formal Prefab and Scene.")


if __name__ == "__main__":
    main()
