#!/usr/bin/env python3
"""Apply the confirmed V7 in-room menu and shortcut art to the formal Prefab."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ROOT / "assets" / "resources" / "UI" / "panelGameView.prefab",
    ROOT / "assets" / "Scenes" / "drh8.fire",
)
V7 = ROOT / "assets" / "resources" / "V7"

MENU_BUTTONS = {
    "站起围观": ("ingame_menu_watch_exact.png", -96, 130),
    "补充钵钵": ("ingame_menu_chips_exact.png", 104, 130),
    "留座离桌": ("ingame_menu_seat_exact.png", -96, 26),
    "牌型展示": ("ingame_menu_cards_exact.png", 104, 26),
    "牌局设置": ("ingame_menu_settings_exact.png", -96, -78),
    "解散房间": ("ingame_menu_dissolve_exact.png", 104, -78),
    "联系客服": ("ingame_menu_service_exact.png", -96, -182),
    "退出房间": ("ingame_menu_exit_exact.png", 104, -182),
}


def ref_id(value: Any) -> int | None:
    if isinstance(value, dict) and isinstance(value.get("__id__"), int):
        return value["__id__"]
    return None


def frame_uuid(name: str) -> str:
    meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][Path(name).stem]["uuid"]


def child(objects: list[dict[str, Any]], parent_id: int, name: str) -> int:
    parent = objects[parent_id]
    for reference in parent.get("_children") or []:
        index = ref_id(reference)
        if index is not None and objects[index].get("_name") == name:
            return index
    raise KeyError(f"{parent.get('_name')}/{name}")


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
    matches = [
        index
        for index, item in enumerate(objects)
        if isinstance(item, dict)
        and item.get("__type__") == "cc.Node"
        and item.get("_name") == name
        and ("/" + node_path(objects, index)).endswith(suffix)
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one root child {name}, found {matches}")
    return matches[0]


def component(objects: list[dict[str, Any]], node_id: int, kind: str) -> dict[str, Any]:
    for reference in objects[node_id].get("_components") or []:
        index = ref_id(reference)
        if index is not None and objects[index].get("__type__") == kind:
            return objects[index]
    raise KeyError(f"{objects[node_id].get('_name')}:{kind}")


def set_position(node: dict[str, Any], x: float, y: float) -> None:
    node["_trs"]["array"][0] = x
    node["_trs"]["array"][1] = y


def set_scale(node: dict[str, Any], x: float = 1, y: float = 1) -> None:
    node["_trs"]["array"][7] = x
    node["_trs"]["array"][8] = y


def set_size(node: dict[str, Any], width: float, height: float) -> None:
    node["_contentSize"]["width"] = width
    node["_contentSize"]["height"] = height


def set_sprite(objects: list[dict[str, Any]], node_id: int, asset: str) -> None:
    sprite = component(objects, node_id, "cc.Sprite")
    sprite["_spriteFrame"] = {"__uuid__": frame_uuid(asset)}
    sprite["_type"] = 0
    sprite["_sizeMode"] = 0
    sprite["_isTrimmedMode"] = True


def set_widget(widget: dict[str, Any], *, left=None, right=None, top=None, bottom=None) -> None:
    flags = 0
    if left is not None:
        flags |= 8
        widget["_left"] = left
    if right is not None:
        flags |= 32
        widget["_right"] = right
    if top is not None:
        flags |= 1
        widget["_top"] = top
    if bottom is not None:
        flags |= 4
        widget["_bottom"] = bottom
    widget["_alignFlags"] = flags
    widget["_enabled"] = True
    widget["alignMode"] = 1


def apply_menu(objects: list[dict[str, Any]]) -> None:
    menu_id = find_root(objects, "ConfigMain")
    menu = objects[menu_id]
    set_size(menu, 420, 502)
    menu["_anchorPoint"]["x"] = 0.5
    menu["_anchorPoint"]["y"] = 0.5
    set_position(menu, -152, 295)
    set_scale(menu)
    set_sprite(objects, menu_id, "ingame_menu_panel_exact.png")
    set_widget(component(objects, menu_id, "cc.Widget"), left=13, top=121)

    layout = component(objects, menu_id, "cc.Layout")
    # GRID deliberately handles active children.  panelGameView.ts only toggles
    # the permission-specific menu entries' active state, so inactive entries
    # now disappear without leaving a blank and all later actions pack forward.
    layout["_enabled"] = True
    layout["_resize"] = 0
    layout["_N$layoutType"] = 3
    layout["_N$startAxis"] = 0
    layout["_N$cellSize"] = {"__type__": "cc.Size", "width": 193, "height": 97}
    layout["_N$paddingLeft"] = 17
    layout["_N$paddingRight"] = 10
    layout["_N$paddingTop"] = 72
    layout["_N$paddingBottom"] = 21
    layout["_N$spacingX"] = 7
    layout["_N$spacingY"] = 7
    layout["_N$horizontalDirection"] = 0
    layout["_N$verticalDirection"] = 1
    layout["_N$affectedByScale"] = False
    layout["_layoutSize"] = {"__type__": "cc.Size", "width": 420, "height": 502}

    for node_name, (asset, x, y) in MENU_BUTTONS.items():
        node_id = child(objects, menu_id, node_name)
        node = objects[node_id]
        set_size(node, 193, 97)
        set_position(node, x, y)
        set_scale(node)
        set_sprite(objects, node_id, asset)


def apply_empty_seats(objects: list[dict[str, Any]]) -> None:
    seat_control_id = find_root(objects, "坐下控制")
    for index in range(8):
        seat_id = child(objects, seat_control_id, f"坐下{index}")
        set_size(objects[seat_id], 96, 96)
        set_scale(objects[seat_id])
        set_sprite(objects, seat_id, "ingame_empty_seat_exact.png")


def apply_shortcuts(objects: list[dict[str, Any]]) -> None:
    room_id = find_root(objects, "RoomFrame")

    config_id = child(objects, room_id, "ConfigBT")
    set_size(objects[config_id], 84, 84)
    set_scale(objects[config_id])
    set_sprite(objects, config_id, "ingame_icon_menu_exact.png")
    set_widget(component(objects, config_id, "cc.Widget"), left=7, top=14)
    set_position(objects[config_id], -326, 611)
    for reference in objects[config_id].get("_children") or []:
        nested = ref_id(reference)
        if nested is not None:
            objects[nested]["_active"] = False

    review_id = child(objects, room_id, "信息")
    set_size(objects[review_id], 78, 78)
    set_scale(objects[review_id])
    set_sprite(objects, review_id, "ingame_icon_review_exact.png")
    set_widget(component(objects, review_id, "cc.Widget"), right=12, top=14)
    set_position(objects[review_id], 324, 614)

    record_id = child(objects, room_id, "记录")
    set_size(objects[record_id], 78, 78)
    set_scale(objects[record_id])
    set_sprite(objects, record_id, "ingame_icon_record_exact.png")
    set_widget(component(objects, record_id, "cc.Widget"), left=12, bottom=37)
    set_position(objects[record_id], -324, -591)

    cards_id = child(objects, room_id, "切牌")
    set_size(objects[cards_id], 78, 78)
    set_scale(objects[cards_id])
    set_sprite(objects, cards_id, "ingame_icon_cards_exact.png")
    set_widget(component(objects, cards_id, "cc.Widget"), left=12, bottom=218)
    set_position(objects[cards_id], -324, -410)

    chat_id = child(objects, room_id, "表情")
    set_size(objects[chat_id], 78, 78)
    set_scale(objects[chat_id])
    set_widget(component(objects, chat_id, "cc.Widget"), left=12, bottom=127)
    set_position(objects[chat_id], -324, -501)
    chat_icon_id = child(objects, chat_id, "聊天")
    set_size(objects[chat_icon_id], 78, 78)
    set_position(objects[chat_icon_id], 0, 0)
    set_scale(objects[chat_icon_id])
    set_sprite(objects, chat_icon_id, "ingame_icon_chat_exact.png")

    say_id = child(objects, room_id, "SayBT")
    say_icon_id = child(objects, say_id, "SayBT")
    set_size(objects[say_icon_id], 78, 78)
    set_scale(objects[say_icon_id])
    set_position(objects[say_icon_id], 40, -22)
    set_sprite(objects, say_icon_id, "ingame_icon_voice_exact.png")


def main() -> None:
    for target in TARGETS:
        objects = json.loads(target.read_text(encoding="utf-8"))
        apply_menu(objects)
        apply_shortcuts(objects)
        apply_empty_seats(objects)
        target.write_text(
            json.dumps(objects, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"applied V7 in-room menu, shortcut and empty-seat art to "
            f"{target.relative_to(ROOT)}"
        )


if __name__ == "__main__":
    main()
