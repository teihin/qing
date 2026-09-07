#!/usr/bin/env python3
"""Validate the fixed V7 in-room menu geometry and formal asset references."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ROOT / "assets/resources/UI/panelGameView.prefab",
    ROOT / "assets/Scenes/drh8.fire",
)
V7 = ROOT / "assets/resources/V7"

BUTTONS = {
    "站起围观": ("ingame_menu_watch_exact.png", (-96, 130)),
    "补充钵钵": ("ingame_menu_chips_exact.png", (104, 130)),
    "留座离桌": ("ingame_menu_seat_exact.png", (-96, 26)),
    "牌型展示": ("ingame_menu_cards_exact.png", (104, 26)),
    "牌局设置": ("ingame_menu_settings_exact.png", (-96, -78)),
    "解散房间": ("ingame_menu_dissolve_exact.png", (104, -78)),
    "联系客服": ("ingame_menu_service_exact.png", (-96, -182)),
    "退出房间": ("ingame_menu_exit_exact.png", (104, -182)),
}


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def ref_id(value: Any) -> int | None:
    return value.get("__id__") if isinstance(value, dict) else None


def node_path(objects: list[dict[str, Any]], node_id: int) -> str:
    parts: list[str] = []
    seen: set[int] = set()
    while node_id not in seen and 0 <= node_id < len(objects):
        seen.add(node_id)
        node = objects[node_id]
        if not isinstance(node, dict) or node.get("__type__") != "cc.Node":
            break
        parts.append(node.get("_name", "?"))
        parent_id = ref_id(node.get("_parent"))
        if parent_id is None:
            break
        node_id = parent_id
    return "/".join(reversed(parts))


def find_root(objects: list[dict[str, Any]], name: str) -> int:
    suffix = f"/panelGameView/{name}"
    result = [
        i
        for i, item in enumerate(objects)
        if isinstance(item, dict)
        and item.get("__type__") == "cc.Node"
        and item.get("_name") == name
        and ("/" + node_path(objects, i)).endswith(suffix)
    ]
    require(len(result) == 1, f"root {name}: {result}")
    return result[0]


def child(objects: list[dict[str, Any]], parent_id: int, name: str) -> int:
    result = []
    for reference in objects[parent_id].get("_children") or []:
        index = ref_id(reference)
        if index is not None and objects[index].get("_name") == name:
            result.append(index)
    require(len(result) == 1, f"child {objects[parent_id].get('_name')}/{name}: {result}")
    return result[0]


def component(objects: list[dict[str, Any]], node_id: int, kind: str) -> dict[str, Any]:
    found = []
    for reference in objects[node_id].get("_components") or []:
        index = ref_id(reference)
        if index is not None and objects[index].get("__type__") == kind:
            found.append(objects[index])
    require(len(found) == 1, f"component {objects[node_id].get('_name')}:{kind}")
    return found[0]


def frame_uuid(name: str) -> str:
    meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
    frame = meta["subMetas"][Path(name).stem]
    require(meta.get("packable") is False, f"{name} must stay unpacked")
    return frame["uuid"]


def position(node: dict[str, Any]) -> tuple[float, float]:
    array = node["_trs"]["array"]
    return array[0], array[1]


def validate_sprite(objects: list[dict[str, Any]], node_id: int, asset: str) -> None:
    actual = component(objects, node_id, "cc.Sprite").get("_spriteFrame", {}).get("__uuid__")
    require(actual == frame_uuid(asset), f"{objects[node_id].get('_name')} sprite mismatch")


def validate(target: Path) -> None:
    objects = json.loads(target.read_text(encoding="utf-8"))
    menu_id = find_root(objects, "ConfigMain")
    menu = objects[menu_id]
    require(menu["_contentSize"] == {"__type__": "cc.Size", "width": 420, "height": 502}, "menu size")
    require(menu["_anchorPoint"]["x"] == 0.5 and menu["_anchorPoint"]["y"] == 0.5, "menu anchor")
    validate_sprite(objects, menu_id, "ingame_menu_panel_exact.png")
    layout = component(objects, menu_id, "cc.Layout")
    require(layout.get("_enabled") is True, "menu active-item packing layout")
    require(layout.get("_N$layoutType") == 3, "menu must use grid layout")
    require(layout.get("_N$startAxis") == 0, "menu must pack by rows")
    require(
        layout.get("_N$cellSize")
        == {"__type__": "cc.Size", "width": 193, "height": 97},
        "menu grid cell size",
    )
    require(layout.get("_N$spacingX") == 7 and layout.get("_N$spacingY") == 7, "menu grid spacing")

    names = [objects[ref_id(ref)].get("_name") for ref in menu.get("_children") or []]
    require(set(BUTTONS) <= set(names), "menu business buttons changed")
    for name, (asset, expected_position) in BUTTONS.items():
        node_id = child(objects, menu_id, name)
        require(tuple(position(objects[node_id])) == expected_position, f"{name} position")
        require(component(objects, node_id, "cc.Button").get("_enabled") is True, f"{name} click area")
        validate_sprite(objects, node_id, asset)

    room_id = find_root(objects, "RoomFrame")
    shortcuts = {
        "ConfigBT": "ingame_icon_menu_exact.png",
        "信息": "ingame_icon_review_exact.png",
        "记录": "ingame_icon_record_exact.png",
        "切牌": "ingame_icon_cards_exact.png",
    }
    for name, asset in shortcuts.items():
        node_id = child(objects, room_id, name)
        validate_sprite(objects, node_id, asset)
        require(component(objects, node_id, "cc.Button").get("_enabled") is True, f"{name} click area")
    chat_id = child(objects, child(objects, room_id, "表情"), "聊天")
    validate_sprite(objects, chat_id, "ingame_icon_chat_exact.png")
    say_id = child(objects, child(objects, room_id, "SayBT"), "SayBT")
    validate_sprite(objects, say_id, "ingame_icon_voice_exact.png")

    seat_control_id = find_root(objects, "坐下控制")
    for index in range(8):
        seat_id = child(objects, seat_control_id, f"坐下{index}")
        require(
            objects[seat_id]["_contentSize"]
            == {"__type__": "cc.Size", "width": 96, "height": 96},
            f"坐下{index} size",
        )
        validate_sprite(objects, seat_id, "ingame_empty_seat_exact.png")
        require(
            component(objects, seat_id, "cc.Button").get("_enabled") is True,
            f"坐下{index} click area",
        )

    print(f"V7 in-room menu validation passed: {target.relative_to(ROOT)}")


def main() -> None:
    for target in TARGETS:
        validate(target)


if __name__ == "__main__":
    main()
