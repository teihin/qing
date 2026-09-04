#!/usr/bin/env python3
"""Serialize the approved V7 lobby composition directly into panelMain.prefab.

All visible static typography, metal borders, icons and the lower navigation are
bitmap crops from the accepted 02-lobby mockup.  This script is editor-time
only; it does not add runtime skin/layout code.
"""

from __future__ import annotations

import copy

from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import BASE_H, BASE_W, bottom, ensure_widget, stretch, top


GOLD = {"__type__": "cc.Color", "r": 224, "g": 181, "b": 134, "a": 255}
DARK_OUTLINE = {"__type__": "cc.Color", "r": 2, "g": 22, "b": 37, "a": 210}
WHITE = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}


def untint(p: Prefab, node_id: int) -> None:
    p.data[node_id]["_color"] = copy.deepcopy(WHITE)
    p.data[node_id]["_opacity"] = 255


def transparent_art(p: Prefab, path: str, w: float, h: float) -> None:
    node_id = p.node(path)
    p.art(node_id, "transparent.png", 0, 0, w, h, hide=True)
    untint(p, node_id)


def style_label(p: Prefab, path: str, *, x: float, y: float, width: float,
                height: float, size: int, preview: str | None = None,
                align: int = 1) -> None:
    node_id = p.node(path)
    p.set_pos(node_id, x, y, width, height)
    p.data[node_id]["_color"] = copy.deepcopy(GOLD)
    _, label = p.component(node_id, "cc.Label")
    if label is None:
        return
    label["_fontSize"] = size
    label["_lineHeight"] = size + 4
    label["_N$horizontalAlign"] = align
    label["_N$verticalAlign"] = 1
    label["_N$overflow"] = 2
    if preview is not None:
        label["_string"] = preview
        label["_N$string"] = preview

    _, outline = p.component(node_id, "cc.LabelOutline")
    if outline is None:
        outline = {
            "__type__": "cc.LabelOutline", "_name": "", "_objFlags": 0,
            "node": {"__id__": node_id}, "_enabled": True,
            "_color": copy.deepcopy(DARK_OUTLINE), "_width": 1, "_id": "",
        }
        p.data.append(outline)
        p.data[node_id].setdefault("_components", []).append({"__id__": len(p.data) - 1})
    else:
        outline["_enabled"] = True
        outline["_color"] = copy.deepcopy(DARK_OUTLINE)
        outline["_width"] = 1


def fill_parent(p: Prefab, path: str, width: float, height: float) -> None:
    node_id = p.node(path)
    p.set_pos(node_id, 0, 0, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def apply() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    lobby = p.node("Main/发现")
    p.sprite(lobby, "casino_bg_exact.png")
    untint(p, lobby)

    # Header and hero are complete accepted artwork slices.  Keeping them as
    # independent top-anchored sprites prevents the shield or its curves from
    # being stretched on tall screens.
    title = p.node("Main/发现/Title")
    p.art(title, "lobby_header_exact.png", 0, 0, 750, 64, hide=True)
    untint(p, title)
    top(p, "Main/发现/Title", 0, width=750, height=64, stretch_x=True)

    hero = p.node("Main/发现/LOGO")
    p.art(hero, "lobby_hero_exact.png", 0, 0, 750, 530, hide=True)
    untint(p, hero)
    top(p, "Main/发现/LOGO", 64, width=750, height=530)

    buttons = (
        ("排行榜", "lobby_ranking_exact.png", -241),
        ("比赛场", "lobby_match_exact.png", 0),
        ("举报反馈", "lobby_report_exact.png", 241),
    )
    for name, asset, x in buttons:
        node_id = p.node(f"Main/发现/{name}")
        p.art(node_id, "transparent.png", x, 0, 226, 91, hide=True)
        untint(p, node_id)
        top(p, f"Main/发现/{name}", 486, x=x, width=226, height=91)

    # The sound icon is already baked into the exact header.  Preserve a real
    # transparent Button hit area in the Prefab for its later implementation.
    try:
        sound = p.node("Main/发现/V8声音入口")
    except KeyError:
        sound = p.clone_subtree(p.node("Main/发现/举报反馈"), lobby, "V8声音入口")
    p.set_active(sound, True)
    p.art(sound, "transparent.png", -333, 0, 84, 64, hide=True)
    untint(p, sound)
    top(p, "Main/发现/V8声音入口", 0, x=-333, width=84, height=64)

    # Filter bar: the unselected labels and future-action icons are one exact
    # accepted bitmap; Toggle checkmark sprites only add the selected gold pill.
    filt = p.node("Main/发现/过滤")
    p.art(filt, "filter_bar_exact.png", 0, 0, 706, 94)
    untint(p, filt)
    p.disable(filt, "cc.Layout")
    top(p, "Main/发现/过滤", 594, width=706, height=94)
    p.set_active(p.node("Main/发现/过滤/New Node"), False)
    transparent_art(p, "Main/发现/过滤/加入房间", 184, 70)
    p.set_pos(p.node("Main/发现/过滤/加入房间"), 205, 0, 184, 70)

    toggles = (
        ("全", "all", -294),
        ("小", "small", -190),
        ("中", "middle", -101),
        ("大", "large", -13),
    )
    for name, key, x in toggles:
        toggle = p.node(f"Main/发现/过滤/{name}")
        p.set_pos(toggle, x, 0, 95, 65)
        transparent_art(p, f"Main/发现/过滤/{name}/Background", 95, 65)
        checkmark = p.node(f"Main/发现/过滤/{name}/checkmark")
        p.art(checkmark, f"filter_{key}_exact_sel.png", 0, 0, 95, 65, hide=True)
        untint(p, checkmark)

    free = p.node("Main/发现/过滤/空位条件")
    p.set_pos(free, 295, 0, 112, 70)
    free_toggle = p.node("Main/发现/过滤/空位条件/有空位")
    p.set_pos(free_toggle, 0, 0, 112, 70)
    transparent_art(p, "Main/发现/过滤/空位条件/有空位/Background", 32, 32)
    p.set_pos(p.node("Main/发现/过滤/空位条件/有空位/Background"), -44, 0, 32, 32)
    check = p.node("Main/发现/过滤/空位条件/有空位/checkmark")
    p.art(check, "filter_check_exact.png", -44, 0, 32, 32, hide=True)
    untint(p, check)
    p.set_active(p.node("Main/发现/过滤/空位条件/有空位/空位文字"), False)

    # Dynamic room values stay as real labels, while the card material, shield,
    # static captions/icons and status words use exact accepted bitmaps.
    room_list = p.node("Main/发现/房间列表")
    p.sprite(room_list, "lobby_list_bg_exact.png", sliced=True)
    untint(p, room_list)
    stretch(p, "Main/发现/房间列表", 700, 134)
    fill_parent(p, "Main/发现/房间列表/view", 750, BASE_H - 700 - 134)
    room = p.node("Main/发现/房间列表/房间对象")
    p.set_pos(room, -770.654, 295.158, 710, 135)
    p.art(p.node("Main/发现/房间列表/房间对象/房间底框"),
          "room_card_exact.png", 0, 0, 706, 135)
    p.art(p.node("Main/发现/房间列表/房间对象/大图标"),
          "shield_room_exact.png", -281, 0, 100, 116)

    try:
        static = p.node("Main/发现/房间列表/房间对象/V8静态信息")
    except KeyError:
        static = p.clone_subtree(
            p.node("Main/发现/房间列表/房间对象/房间底框"), room, "V8静态信息")
    p.set_active(static, True)
    p.art(static, "room_static_exact.png", 0, 0, 706, 135, hide=True)
    untint(p, static)

    for child in ("img", "img copy"):
        # The legacy prefab contains two nodes named img copy.  All old neon
        # pictograms are superseded by room_static_exact.png.
        for ref in p.data[room].get("_children", []):
            node_id = ref["__id__"]
            if p.data[node_id].get("_name") == child:
                p.set_active(node_id, False)
    p.set_active(p.node("Main/发现/房间列表/房间对象/地九王"), False)

    style_label(p, "Main/发现/房间列表/房间对象/name",
                x=-42, y=23, width=300, height=42, size=30,
                preview="房间 888621", align=0)
    style_label(p, "Main/发现/房间列表/房间对象/底皮",
                x=-125, y=-32, width=54, height=40, size=25, preview="1")
    style_label(p, "Main/发现/房间列表/房间对象/倒计时",
                x=40, y=-32, width=70, height=40, size=25, preview="1/3")
    style_label(p, "Main/发现/房间列表/房间对象/时间",
                x=162, y=-32, width=108, height=40, size=25, preview="45分钟")
    style_label(p, "Main/发现/房间列表/房间对象/人数",
                x=287, y=-32, width=72, height=40, size=25, preview="6/8")
    p.set_pos(p.node("Main/发现/房间列表/房间对象/状态"), 284, 23, 96, 32)

    _, virtual_list = p.component(room_list, "55af2sKFClD1pPk4h4O5dyV")
    if virtual_list is not None:
        virtual_list["paddingTop"] = 0
        virtual_list["paddingBottom"] = 10
        virtual_list["spaceY"] = 14

    # The bottom bar is a single accepted image, so its height, icons, text and
    # smooth center shield cannot drift. Existing Toggle/Button nodes remain as
    # transparent interaction hit areas above it.
    down = p.node("Down")
    p.art(down, "nav_bar_exact.png", 0, 0, 750, 155)
    untint(p, down)
    bottom(p, "Down", 0, width=750, height=155, stretch_x=True)
    service = p.node("Down/客服")
    p.set_pos(service, -158, -10.5, 130, 134)
    p.sprite(service, "transparent.png")
    untint(p, service)

    nav = (("公告", -299), ("发现", 0), ("钱包", 153), ("我的", 289))
    for name, x in nav:
        node = p.node(f"Down/{name}")
        p.set_pos(node, x, -10.5, 130 if name != "发现" else 150, 134)
        transparent_art(p, f"Down/{name}/Background", 130 if name != "发现" else 150, 134)
        if name == "发现":
            transparent_art(p, f"Down/{name}/checkmark", 150, 134)
            try:
                p.set_active(p.node(f"Down/{name}/New Node"), False)
            except KeyError:
                pass
        else:
            mark = p.node(f"Down/{name}/checkmark")
            p.art(mark, "nav_selected_overlay.png", 0, 0, 130, 134, hide=True)
            untint(p, mark)

    p.save()


if __name__ == "__main__":
    apply()
