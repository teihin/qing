#!/usr/bin/env python3
"""Apply the accepted V7 ranking artwork and responsive list layout."""

from __future__ import annotations

import copy

from apply_v7_followup_main_exact import (
    BASE_H, add_master, center_anchor, fixed_top, full_screen,
    hide_legacy_visuals, pagination, stretch_box,
)
from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import transparent
from repair_v7_responsive_layout import ensure_widget


GOLD = {"__type__": "cc.Color", "r": 232, "g": 198, "b": 145, "a": 255}


def ensure_button(p: Prefab, node_id: int) -> None:
    if p.component(node_id, "cc.Button")[1] is not None:
        return
    source_id = p.node("排行榜/title/关闭上上层")
    _, source = p.component(source_id, "cc.Button")
    button = copy.deepcopy(source)
    button["node"] = {"__id__": node_id}
    button["target"] = {"__id__": node_id}
    button["_N$target"] = {"__id__": node_id}
    p.data.append(button)
    p.data[node_id].setdefault("_components", []).append({"__id__": len(p.data) - 1})


def label(p: Prefab, path: str, x: float, y: float, width: float,
          height: float, size: int, preview: str | None = None,
          align: int = 1) -> None:
    node = p.node(path)
    p.set_active(node, True)
    center_anchor(p, node)
    style_label(p, path, x=x, y=y, width=width, height=height,
                size=size, preview=preview, align=align)
    p.data[node]["_color"] = copy.deepcopy(GOLD)


def top_tabs(p: Prefab) -> None:
    path = "排行榜/条件"
    group = p.node(path)
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    fixed_top(p, group, 312, 638, 69)
    specs = (("玩家手数榜", -213, 0), ("玩家赢分榜", 0, 1),
             ("代理红利榜", 213, 2))
    for name, x, index in specs:
        node = p.node(f"{path}/{name}")
        p.set_active(node, True)
        center_anchor(p, node)
        p.set_pos(node, x, 0, 213, 69, disable_widget=True)
        bg = p.node(f"{path}/{name}/Background")
        transparent(p, bg, 213, 69, hide_children=True)
        check = p.node(f"{path}/{name}/checkmark")
        p.set_active(check, True)
        p.art(check, f"followup_ranking_tabs_{index}_exact.png",
              -x, 0, 638, 69, hide=True)
        untint(p, check)
        _, toggle = p.component(node, "cc.Toggle")
        toggle["_N$isChecked"] = index == 0


def stake_tabs(p: Prefab) -> None:
    path = "排行榜/容器/玩家手数榜/选择手数"
    group = p.node(path)
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    fixed_top(p, group, 399, 610, 67)
    names = ("1皮", "2皮", "5皮", "10皮", "20皮")
    for index, name in enumerate(names):
        x = -244 + index * 122
        toggle_node = p.node(f"{path}/{name}")
        p.set_active(toggle_node, True)
        center_anchor(p, toggle_node)
        p.set_pos(toggle_node, x, 0, 122, 67, disable_widget=True)
        try:
            bg = p.node(f"{path}/{name}/Background")
            transparent(p, bg, 122, 67, hide_children=True)
        except KeyError:
            pass
        check = p.node(f"{path}/{name}/checkmark")
        p.set_active(check, True)
        p.art(check, f"followup_ranking_stakes_{index}_exact.png",
              -x, 0, 610, 67, hide=True)
        untint(p, check)
        _, toggle = p.component(toggle_node, "cc.Toggle")
        toggle["_N$isChecked"] = index == 0
    try:
        p.set_active(p.node(f"{path}/50皮"), False)
    except KeyError:
        pass


def list_page(p: Prefab, name: str, key: str, table_top: int) -> None:
    root_path = f"排行榜/容器/{name}"
    root = p.node(root_path)
    p.set_active(root, name == "玩家手数榜")
    full_screen(p, root)
    listing = p.node(f"{root_path}/列表")
    p.set_active(listing, True)
    p.sprite(listing, "followup_ranking_list_panel_exact.png", sliced=True)
    untint(p, listing)
    stretch_box(p, listing, table_top, 107, 56, 56)
    view = p.node(f"{root_path}/列表/view")
    p.set_active(view, True)
    center_anchor(p, view)
    widget = ensure_widget(p, view)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 8, "_right": 8, "_top": 51, "_bottom": 8,
        "_originalWidth": 622,
    })
    content = p.node(f"{root_path}/列表/view/content")
    p.set_active(content, True)
    center_anchor(p, content)
    p.data[content]["_anchorPoint"]["y"] = 1
    p.data[content]["_contentSize"]["width"] = 622
    cwidget = ensure_widget(p, content)
    cwidget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0, "_originalWidth": 622,
    })
    _, layout = p.component(content, "cc.Layout")
    if layout is not None:
        layout["_enabled"] = True
        layout["_N$paddingTop"] = 0
        layout["_N$paddingBottom"] = 0
        layout["_N$spacingY"] = 11

    header = p.node(f"{root_path}/标题")
    p.set_active(header, True)
    p.art(header, f"followup_ranking_{key}_header_exact.png", 0, 0, 638, 51,
          hide=True)
    untint(p, header)
    fixed_top(p, header, table_top, 638, 51)
    pagination(p, f"{root_path}/分页")
    try:
        p.set_active(p.node(f"{root_path}/文本"), False)
    except KeyError:
        pass

    children = p.data[root].setdefault("_children", [])
    page = p.node(f"{root_path}/分页")
    ids = (listing, header, page)
    children[:] = [ref for ref in children if ref.get("__id__") not in ids]
    children.extend({"__id__": node_id} for node_id in ids)


def hero(p: Prefab) -> None:
    group = p.node("排行榜/广告")
    p.set_active(group, True)
    center_anchor(p, group)
    fixed_top(p, group, 0, 750, BASE_H)
    label(p, "排行榜/广告/开始时间", -35, BASE_H / 2 - 183,
          210, 34, 18, preview="-")
    label(p, "排行榜/广告/结束时间", 190, BASE_H / 2 - 183,
          210, 34, 18, preview="-")
    label(p, "排行榜/广告/我的信息", 60, BASE_H / 2 - 215,
          430, 42, 20, preview="")

    claim = p.node("排行榜/广告/领取奖励")
    p.sprite(claim, "followup_ranking_claim_exact.png")
    untint(p, claim)
    p.set_pos(claim, 225, BASE_H / 2 - 222 - 56 / 2, 124, 56,
              disable_widget=True)
    ensure_button(p, claim)
    received = p.node("排行榜/广告/已领取")
    label(p, "排行榜/广告/已领取", 225, BASE_H / 2 - 250,
          124, 40, 20, preview="已领取")
    # Runtime ranking data decides whether the reward has already been claimed.
    # Keep the editor default neutral rather than displaying a fake state.
    p.set_active(received, False)


def style_row_prefab() -> None:
    p = Prefab("assets/resources/Prefabs/排行榜对象.prefab")
    center_anchor(p, p.root)
    p.set_pos(p.root, 0, -37, 622, 73)
    p.sprite(p.root, "followup_ranking_row_exact.png", sliced=True)
    untint(p, p.root)
    try:
        p.set_active(p.node("排行榜对象/line"), False)
    except KeyError:
        pass
    for name, x, width, size in (
        ("idx", -264, 75, 19), ("name", -92, 230, 17),
        ("played_count", 104, 120, 18), ("user_reward", 239, 120, 18),
        ("proxy_guuid", 104, 120, 18), ("proxy_reward", 239, 120, 18),
    ):
        path = f"排行榜对象/{name}"
        node = p.node(path)
        style_label(p, path, x=x, y=0, width=width, height=46,
                    size=size, align=1)
        p.data[node]["_color"] = copy.deepcopy(GOLD)
    p.save()


def style_embedded_row(p: Prefab) -> None:
    root = p.node("排行榜/排行榜对象")
    p.set_active(root, False)
    center_anchor(p, root)
    p.set_pos(root, 0, -37, 622, 73, disable_widget=True)
    p.sprite(root, "followup_ranking_row_exact.png", sliced=True)
    untint(p, root)
    try:
        p.set_active(p.node("排行榜/排行榜对象/line"), False)
    except KeyError:
        pass
    for name, x, width, size in (
        ("idx", -264, 75, 19), ("name", -92, 230, 17),
        ("played_count", 104, 120, 18), ("user_reward", 239, 120, 18),
        ("proxy_guuid", 104, 120, 18), ("proxy_reward", 239, 120, 18),
    ):
        path = f"排行榜/排行榜对象/{name}"
        node = p.node(path)
        style_label(p, path, x=x, y=0, width=width, height=46,
                    size=size, align=1)
        p.data[node]["_color"] = copy.deepcopy(GOLD)


def apply() -> None:
    p = Prefab("assets/resources/Prefabs/排行榜.prefab")
    hide_legacy_visuals(p, p.root)
    master = add_master(p, p.root, "排行榜/V7排行榜母版",
                        "followup_ranking_hands_master_long.png")
    transparent(p, p.node("排行榜/title/关闭上上层"), 100, 84, hide_children=True)
    fixed_top(p, p.node("排行榜/title/关闭上上层"), 0, 100, 84, -325)
    hero(p)
    top_tabs(p)
    container = p.node("排行榜/容器")
    center_anchor(p, container)
    full_screen(p, container)
    list_page(p, "玩家手数榜", "hands", 485)
    list_page(p, "玩家赢分榜", "wins", 399)
    list_page(p, "代理红利榜", "bonus", 399)
    stake_tabs(p)
    style_embedded_row(p)
    children = p.data[p.root].setdefault("_children", [])
    children[:] = [ref for ref in children if ref.get("__id__") != master]
    children.insert(0, {"__id__": master})
    p.save()
    style_row_prefab()
    print("V7 排行榜 Prefab 已完成")


if __name__ == "__main__":
    apply()
