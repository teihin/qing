#!/usr/bin/env python3
"""Apply the confirmed V7 in-room buy-in popup to Prefab and Scene."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ROOT / "assets" / "resources" / "UI" / "panelGameView.prefab",
    ROOT / "assets" / "Scenes" / "drh8.fire",
)
V7 = ROOT / "assets" / "resources" / "V7"


def ref_id(value: Any) -> int | None:
    if isinstance(value, dict) and isinstance(value.get("__id__"), int):
        return value["__id__"]
    return None


def frame_uuid(name: str) -> str:
    meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][Path(name).stem]["uuid"]


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


def children(objects: list[dict[str, Any]], parent_id: int, name: str | None = None) -> list[int]:
    result: list[int] = []
    for reference in objects[parent_id].get("_children") or []:
        node_id = ref_id(reference)
        if node_id is None:
            continue
        if name is None or objects[node_id].get("_name") == name:
            result.append(node_id)
    return result


def child(objects: list[dict[str, Any]], parent_id: int, name: str) -> int:
    matches = children(objects, parent_id, name)
    if len(matches) != 1:
        raise KeyError(f"{objects[parent_id].get('_name')}/{name}: {matches}")
    return matches[0]


def component_or_none(
    objects: list[dict[str, Any]], node_id: int, kind: str
) -> tuple[int | None, dict[str, Any] | None]:
    for reference in objects[node_id].get("_components") or []:
        component_id = ref_id(reference)
        if component_id is not None and objects[component_id].get("__type__") == kind:
            return component_id, objects[component_id]
    return None, None


def component(objects: list[dict[str, Any]], node_id: int, kind: str) -> dict[str, Any]:
    _, result = component_or_none(objects, node_id, kind)
    if result is None:
        raise KeyError(f"{node_path(objects, node_id)}:{kind}")
    return result


def set_position(node: dict[str, Any], x: float, y: float) -> None:
    node["_trs"]["array"][0] = x
    node["_trs"]["array"][1] = y


def set_scale(node: dict[str, Any], x: float = 1, y: float = 1) -> None:
    node["_trs"]["array"][7] = x
    node["_trs"]["array"][8] = y


def set_size(node: dict[str, Any], width: float, height: float) -> None:
    node["_contentSize"]["width"] = width
    node["_contentSize"]["height"] = height


def set_color(node: dict[str, Any], red: int, green: int, blue: int, alpha: int = 255) -> None:
    node["_color"] = {
        "__type__": "cc.Color",
        "r": red,
        "g": green,
        "b": blue,
        "a": alpha,
    }


def set_sprite(objects: list[dict[str, Any]], node_id: int, asset: str, *, sliced=False) -> None:
    sprite = component(objects, node_id, "cc.Sprite")
    sprite["_enabled"] = True
    sprite["_spriteFrame"] = {"__uuid__": frame_uuid(asset)}
    sprite["_type"] = 1 if sliced else 0
    sprite["_sizeMode"] = 0
    sprite["_isTrimmedMode"] = True


def set_button_frame(objects: list[dict[str, Any]], node_id: int, asset: str) -> None:
    button = component(objects, node_id, "cc.Button")
    frame = {"__uuid__": frame_uuid(asset)}
    button["_N$target"] = {"__id__": node_id}
    button["_N$transition"] = 3
    button["transition"] = 3
    button["zoomScale"] = 0.96
    for key in (
        "_N$normalSprite",
        "_N$pressedSprite",
        "pressedSprite",
        "_N$hoverSprite",
        "hoverSprite",
        "_N$disabledSprite",
    ):
        button[key] = frame.copy()


def clone_button_component(
    objects: list[dict[str, Any]], source_node_id: int, target_node_id: int
) -> None:
    existing_id, existing = component_or_none(objects, target_node_id, "cc.Button")
    if existing is not None:
        existing["node"] = {"__id__": target_node_id}
        existing["_N$target"] = {"__id__": target_node_id}
        return
    source = copy.deepcopy(component(objects, source_node_id, "cc.Button"))
    source["node"] = {"__id__": target_node_id}
    source["_N$target"] = {"__id__": target_node_id}
    source["clickEvents"] = []
    source["_id"] = ""
    new_id = len(objects)
    objects.append(source)
    objects[target_node_id].setdefault("_components", []).append({"__id__": new_id})


def make_slider_child(
    objects: list[dict[str, Any]], slider_id: int, name: str
) -> int:
    matches = children(objects, slider_id, name)
    if matches:
        return matches[0]

    background_id = child(objects, slider_id, "Background")
    background = objects[background_id]
    sprite_id, source_sprite = component_or_none(objects, background_id, "cc.Sprite")
    if sprite_id is None or source_sprite is None:
        raise RuntimeError("Slider/Background has no Sprite")

    node = copy.deepcopy(background)
    node["_name"] = name
    node["_children"] = []
    node["_parent"] = {"__id__": slider_id}
    node["_components"] = []
    node["_prefab"] = None
    node["_id"] = ""
    node_id = len(objects)
    objects.append(node)

    sprite = copy.deepcopy(source_sprite)
    sprite["node"] = {"__id__": node_id}
    sprite["_id"] = ""
    new_sprite_id = len(objects)
    objects.append(sprite)
    objects[node_id]["_components"] = [{"__id__": new_sprite_id}]

    slider_children = objects[slider_id].setdefault("_children", [])
    handle_id = child(objects, slider_id, "Handle")
    insert_at = next(
        (index for index, reference in enumerate(slider_children) if ref_id(reference) == handle_id),
        len(slider_children),
    )
    slider_children.insert(insert_at, {"__id__": node_id})
    return node_id


def configure_label(
    objects: list[dict[str, Any]],
    node_id: int,
    *,
    font_size: int,
    line_height: int,
    horizontal: int,
    overflow: int,
) -> None:
    label = component(objects, node_id, "cc.Label")
    label["_fontSize"] = font_size
    label["_lineHeight"] = line_height
    label["_N$horizontalAlign"] = horizontal
    label["_N$verticalAlign"] = 1
    label["_N$overflow"] = overflow
    label["_enableWrapText"] = False


def apply_buyin(objects: list[dict[str, Any]]) -> None:
    root_id = find_root(objects, "带入窗口")
    root = objects[root_id]
    set_size(root, 750, 1334)
    set_position(root, 0, 0)
    set_scale(root)

    mask_id = child(objects, root_id, "mask")
    set_size(objects[mask_id], 750, 1334)
    objects[mask_id]["_opacity"] = 180

    panel_id = child(objects, root_id, "bk")
    panel = objects[panel_id]
    set_size(panel, 590, 756)
    set_position(panel, 0, 9)
    set_scale(panel)
    set_sprite(objects, panel_id, "ingame_buyin_panel_exact.png")

    close_matches = children(objects, panel_id, "带入积分") or children(
        objects, panel_id, "关闭上上层"
    )
    if len(close_matches) != 1:
        raise RuntimeError(f"buy-in close/title node mismatch: {close_matches}")
    close_id = close_matches[0]
    objects[close_id]["_name"] = "关闭上上层"
    set_size(objects[close_id], 61, 61)
    set_position(objects[close_id], 243, 273)
    set_scale(objects[close_id])
    set_sprite(objects, close_id, "ingame_buyin_close_exact.png")

    cancel_id = child(objects, root_id, "关闭上层")
    clone_button_component(objects, cancel_id, close_id)
    set_button_frame(objects, close_id, "ingame_buyin_close_exact.png")

    value_boxes = children(objects, root_id, "数值底框")
    if len(value_boxes) != 2:
        raise RuntimeError(f"expected two buy-in value boxes, got {value_boxes}")
    amount_id = max(value_boxes, key=lambda node_id: objects[node_id]["_trs"]["array"][1])
    info_id = min(value_boxes, key=lambda node_id: objects[node_id]["_trs"]["array"][1])

    set_size(objects[amount_id], 496, 135)
    set_position(objects[amount_id], 0, 139)
    set_scale(objects[amount_id])
    set_sprite(objects, amount_id, "ingame_buyin_amount_box_exact.png")

    topup_id = child(objects, amount_id, "充值")
    set_size(objects[topup_id], 132, 63)
    set_position(objects[topup_id], 147, -1)
    set_scale(objects[topup_id])
    set_sprite(objects, topup_id, "ingame_buyin_topup_exact.png")
    set_button_frame(objects, topup_id, "ingame_buyin_topup_exact.png")

    amount_label_id = child(objects, root_id, "msg")
    set_size(objects[amount_label_id], 230, 76)
    set_position(objects[amount_label_id], -52, 140)
    set_scale(objects[amount_label_id])
    set_color(objects[amount_label_id], 242, 207, 148)
    configure_label(
        objects,
        amount_label_id,
        font_size=64,
        line_height=68,
        horizontal=1,
        overflow=2,
    )
    amount_label = component(objects, amount_label_id, "cc.Label")
    amount_label["_isSystemFontUsed"] = True
    amount_label["_N$file"] = None
    amount_label["_N$fontFamily"] = "Times New Roman"

    slider_id = child(objects, root_id, "Slider")
    set_size(objects[slider_id], 494, 34)
    set_position(objects[slider_id], 0, 2)
    set_scale(objects[slider_id])

    background_id = child(objects, slider_id, "Background")
    set_size(objects[background_id], 494, 35)
    set_position(objects[background_id], 0, 0)
    set_scale(objects[background_id])
    set_sprite(objects, background_id, "ingame_buyin_slider_track_exact.png", sliced=True)
    _, background_widget = component_or_none(objects, background_id, "cc.Widget")
    if background_widget is not None:
        background_widget["_enabled"] = False

    fill_id = make_slider_child(objects, slider_id, "Fill")
    fill = objects[fill_id]
    fill["_active"] = True
    fill["_anchorPoint"]["x"] = 0
    fill["_anchorPoint"]["y"] = 0.5
    set_size(fill, 2, 19)
    set_position(fill, -235, 0)
    set_scale(fill)
    set_sprite(objects, fill_id, "ingame_buyin_slider_fill_exact.png", sliced=True)

    copy_id = make_slider_child(objects, slider_id, "SliderCopy")
    slider_copy = objects[copy_id]
    slider_copy["_active"] = True
    slider_copy["_anchorPoint"]["x"] = 0.5
    slider_copy["_anchorPoint"]["y"] = 0.5
    set_size(slider_copy, 518, 76)
    set_position(slider_copy, 0, -58)
    set_scale(slider_copy)
    set_sprite(objects, copy_id, "ingame_buyin_slider_copy_exact.png")

    handle_id = child(objects, slider_id, "Handle")
    set_size(objects[handle_id], 79, 79)
    set_scale(objects[handle_id])
    set_sprite(objects, handle_id, "ingame_buyin_slider_handle_exact.png")
    set_button_frame(objects, handle_id, "ingame_buyin_slider_handle_exact.png")
    handle_glyph_id = child(objects, handle_id, "lg1")
    objects[handle_glyph_id]["_active"] = False

    set_size(objects[info_id], 500, 100)
    set_position(objects[info_id], 0, -162)
    set_scale(objects[info_id])
    set_sprite(objects, info_id, "ingame_buyin_info_box_exact.png")
    baked_info_id = child(objects, info_id, "已带入")
    objects[baked_info_id]["_active"] = False

    live_info_id = child(objects, root_id, "已带入")
    set_size(objects[live_info_id], 152, 42)
    set_position(objects[live_info_id], 142, -162)
    set_scale(objects[live_info_id])
    set_color(objects[live_info_id], 242, 207, 148)
    configure_label(
        objects,
        live_info_id,
        font_size=28,
        line_height=32,
        horizontal=0,
        overflow=2,
    )

    confirm_id = child(objects, root_id, "确认带入")
    set_size(objects[confirm_id], 234, 83)
    set_position(objects[confirm_id], 133, -279)
    set_scale(objects[confirm_id])
    set_sprite(objects, confirm_id, "ingame_buyin_confirm_exact.png")
    set_button_frame(objects, confirm_id, "ingame_buyin_confirm_exact.png")

    set_size(objects[cancel_id], 226, 83)
    set_position(objects[cancel_id], -136, -279)
    set_scale(objects[cancel_id])
    set_sprite(objects, cancel_id, "ingame_buyin_cancel_exact.png")
    set_button_frame(objects, cancel_id, "ingame_buyin_cancel_exact.png")

    # Hidden business state nodes and the balance-insufficient secondary layer
    # are intentionally retained unchanged.


def main() -> None:
    for target in TARGETS:
        objects = json.loads(target.read_text(encoding="utf-8"))
        apply_buyin(objects)
        target.write_text(
            json.dumps(objects, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"applied exact V7 buy-in popup to {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
