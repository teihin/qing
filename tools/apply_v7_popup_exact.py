#!/usr/bin/env python3
"""Serialize the approved V7 announcement and message popup art into Prefabs."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import ensure_widget


GOLD = {"__type__": "cc.Color", "r": 232, "g": 195, "b": 146, "a": 255}
BLACK = {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255}


def normalize_fullscreen(p: Prefab) -> None:
    root = p.data[p.root]
    root["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    p.set_pos(p.root, 375, 667, 750, 1334)
    root["_trs"]["array"][6:9] = [1, 1, 1]
    widget = ensure_widget(p, p.root)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": 1334,
    })

    mask = p.node("msk")
    p.set_pos(mask, 0, 0, 750, 1334)
    p.data[mask]["_color"] = copy.deepcopy(BLACK)
    p.data[mask]["_opacity"] = 155
    mask_widget = ensure_widget(p, mask)
    mask_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": 1334,
    })


def direct_children(p: Prefab, parent: int, name: str) -> list[int]:
    return [ref["__id__"] for ref in p.data[parent].get("_children", [])
            if p.data[ref["__id__"]].get("_name") == name]


def clone_subtree_between(source: Prefab, source_id: int, target: Prefab,
                          parent_id: int, name: str) -> int:
    """Copy a complete node subtree between two serialized Prefabs."""
    ids: set[int] = set()

    def collect(node_id: int) -> None:
        if node_id in ids:
            return
        ids.add(node_id)
        node = source.data[node_id]
        for ref in node.get("_components", []):
            ids.add(ref["__id__"])
        if isinstance(node.get("_prefab"), dict):
            ids.add(node["_prefab"]["__id__"])
        for ref in node.get("_children", []):
            collect(ref["__id__"])

    collect(source_id)
    mapping = {old: len(target.data) + offset for offset, old in enumerate(sorted(ids))}

    def remap(value):
        if isinstance(value, dict):
            if set(value.keys()) == {"__id__"} and value["__id__"] in mapping:
                return {"__id__": mapping[value["__id__"]]}
            return {key: remap(child) for key, child in value.items()}
        if isinstance(value, list):
            return [remap(child) for child in value]
        return value

    for old in sorted(ids):
        target.data.append(remap(copy.deepcopy(source.data[old])))
    new_id = mapping[source_id]
    target.data[new_id]["_parent"] = {"__id__": parent_id}
    target.data[new_id]["_name"] = name
    target.data[parent_id].setdefault("_children", []).append({"__id__": new_id})
    return new_id


def ensure_announcement_scroll(p: Prefab, bk: int) -> int:
    """Upgrade legacy fixed-label announcements to the approved scroll area."""
    current = direct_children(p, bk, "msg")
    if current and p.component(current[0], "cc.ScrollView")[1] is not None:
        return current[0]
    if current:
        p.rename(current[0], "旧公告文本")
        p.set_active(current[0], False)

    source = Prefab("assets/resources/UI/panelNotifyView.prefab")
    source_scroll = source.node("bk/msg")
    scroll = clone_subtree_between(source, source_scroll, p, bk, "msg")
    children = p.data[bk]["_children"]
    children[:] = ([{"__id__": scroll}] +
                   [ref for ref in children if ref["__id__"] != scroll])
    return scroll


def style_dynamic_label(p: Prefab, node_id: int, *, width: int, height: int,
                        font_size: int, line_height: int, align: int,
                        vertical: int, overflow: int, preview: str) -> None:
    node = p.data[node_id]
    node["_color"] = copy.deepcopy(GOLD)
    _, label = p.component(node_id, "cc.Label")
    if label is None:
        raise RuntimeError(f"{p.path.name}:{node.get('_name')} 缺少Label")
    node["_contentSize"]["width"] = width
    node["_contentSize"]["height"] = height
    label["_fontSize"] = font_size
    label["_lineHeight"] = line_height
    label["_enableWrapText"] = True
    label["_N$horizontalAlign"] = align
    label["_N$verticalAlign"] = vertical
    label["_N$overflow"] = overflow
    label["_string"] = preview
    label["_N$string"] = preview


def transparent_button(p: Prefab, node_id: int, x: float, y: float,
                       width: float, height: float) -> None:
    p.art(node_id, "transparent.png", x, y, width, height)
    untint(p, node_id)
    _, button = p.component(node_id, "cc.Button")
    if button is not None:
        button["transition"] = 0
        button["_N$transition"] = 0


def apply_announcement(relative: str, asset: str, preview: str) -> None:
    p = Prefab(relative)
    normalize_fullscreen(p)
    bk = p.node("bk")
    p.art(bk, asset, 0, -28, 632, 840)
    untint(p, bk)
    p.data[bk]["_trs"]["array"][6:9] = [1, 1, 1]

    scroll = ensure_announcement_scroll(p, bk)
    p.set_pos(scroll, 0, 13, 586, 644)
    p.data[scroll]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    view = p.node("bk/msg/view")
    p.set_pos(view, 0, 0, 586, 644)
    content = p.node("bk/msg/view/content")
    p.set_pos(content, 0, 322, 586, 644)
    p.data[content]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 1}
    label_node = p.node("bk/msg/view/content/msg")
    p.set_pos(label_node, 0, -24, 530, 45)
    p.data[label_node]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 1}
    style_dynamic_label(
        p, label_node, width=530, height=45, font_size=26, line_height=44,
        align=0, vertical=0, overflow=3, preview=preview,
    )

    controls = [ref["__id__"] for ref in p.data[bk].get("_children", [])
                if p.data[ref["__id__"]].get("_name") in ("确定", "关闭") and
                p.component(ref["__id__"], "cc.Button")[1] is not None]
    if len(controls) != 2:
        raise RuntimeError(f"{p.path.name}: 公告应有底部确定和右上关闭两个热区")
    controls.sort(key=lambda node_id: p.data[node_id]["_trs"]["array"][1])
    confirm, close = controls
    p.rename(confirm, "确定")
    p.rename(close, "关闭")
    transparent_button(p, confirm, 0, -361, 220, 72)
    transparent_button(p, close, 270, 370, 72, 72)
    p.data[confirm]["_active"] = True
    p.data[close]["_active"] = True

    p.set_active(p.node("bk/取消"), False)
    for name in ("充值公告", "最新公告", "活动公告", "关闭图标"):
        p.set_active(p.node("bk/" + name), False)
    p.save()


def ensure_dual_overlay(p: Prefab, bk: int) -> int:
    matches = direct_children(p, bk, "V7双按钮底")
    if matches:
        return matches[0]
    source = direct_children(p, bk, "确定")[0]
    overlay = p.clone_subtree(source, bk, "V7双按钮底")
    p.disable(overlay, "cc.Button")
    children = p.data[bk]["_children"]
    children[:] = [{"__id__": overlay}] + [ref for ref in children if ref["__id__"] != overlay]
    return overlay


def apply_message() -> None:
    p = Prefab("assets/resources/UI/panelMsgView.prefab")
    normalize_fullscreen(p)
    bk = p.node("bk")
    p.art(bk, "popup_message_single_exact.png", 0, 13, 532, 366)
    untint(p, bk)
    p.data[bk]["_trs"]["array"][6:9] = [1, 1, 1]

    overlay = ensure_dual_overlay(p, bk)
    p.art(overlay, "popup_message_dual_exact.png", 0, 0, 532, 366)
    untint(p, overlay)
    p.disable(overlay, "cc.Button")
    p.set_active(overlay, False)

    message = p.node("bk/msg")
    p.set_pos(message, 0, 35, 450, 132)
    style_dynamic_label(
        p, message, width=450, height=132, font_size=30, line_height=40,
        align=1, vertical=1, overflow=2, preview="操作成功！",
    )

    confirm = p.node("bk/确定")
    cancel = p.node("bk/取消")
    transparent_button(p, confirm, 0, -94, 210, 64)
    transparent_button(p, cancel, -135, -112, 200, 64)
    p.set_active(confirm, True)
    p.set_active(cancel, False)
    p.save()


def main() -> None:
    preview = "健康游戏提示\n理性娱乐  适度游戏\n\n请合理安排游戏时间，避免沉迷。\n请勿修改充值金额。"
    apply_announcement(
        "assets/resources/UI/panelNotifyView.prefab",
        "popup_announcement_latest_exact_nobar.png", preview,
    )
    apply_announcement(
        "assets/resources/UI/panelNotifyViewCZ.prefab",
        "popup_announcement_recharge_exact_nobar.png", preview,
    )
    apply_announcement(
        "assets/resources/UI/panelNotifyViewHD.prefab",
        "popup_announcement_activity_exact_nobar.png", preview,
    )
    apply_message()
    print("已把V7长公告和普通弹窗单双按钮两套状态写入Prefab。")


if __name__ == "__main__":
    main()
