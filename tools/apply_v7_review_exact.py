#!/usr/bin/env python3
"""Serialize the V7 settlement hand-review composition into formal Prefabs."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import BASE_H, bottom, ensure_widget, stretch, top


GOLD = {"__type__": "cc.Color", "r": 232, "g": 194, "b": 141, "a": 255}
WHITE = {"__type__": "cc.Color", "r": 235, "g": 238, "b": 235, "a": 255}


def fill_parent(p: Prefab, path: str, width: float, height: float) -> None:
    node = p.node(path)
    p.set_pos(node, 0, 0, width, height)
    widget = ensure_widget(p, node)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def transparent_hotspot(p: Prefab, path: str, x: float, y: float,
                        width: float, height: float) -> None:
    node = p.node(path)
    p.art(node, "transparent.png", x, y, width, height, hide=True)
    p.disable(node, "cc.Widget")
    untint(p, node)


def set_children_order(p: Prefab, parent: int, order: list[int]) -> None:
    existing = [ref["__id__"] for ref in p.data[parent].get("_children", [])]
    if set(existing) != set(order):
        raise RuntimeError("重新排列Prefab层级时节点集合发生变化")
    p.data[parent]["_children"] = [{"__id__": node} for node in order]


def apply_page() -> None:
    p = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    review = p.node("牌局回顾")
    p.set_active(review, False)
    p.sprite(review, "transparent.png")
    untint(p, review)
    stretch(p, "牌局回顾", 0, 0)

    # A fixed 750x1800 master covers all supported portrait heights without
    # stretching the casino furniture or creating a visible stitched seam.
    try:
        background = p.node("牌局回顾/V7回顾长背景")
    except KeyError:
        background = p.clone_subtree(p.node("牌局回顾/title/line"), review,
                                     "V7回顾长背景")
    p.set_active(background, True)
    p.art(background, "wallet_bg_exact.png", 0, 0, 750, 1800, hide=True)
    untint(p, background)
    top(p, "牌局回顾/V7回顾长背景", 0, width=750, height=1800)

    title = p.node("牌局回顾/title")
    p.set_active(title, True)
    p.art(title, "review_header_exact.png", 0, 0, 750, 72)
    untint(p, title)
    top(p, "牌局回顾/title", 0, width=750, height=72, stretch_x=True)

    transparent_hotspot(p, "牌局回顾/title/关闭上上层", -330, 0, 90, 72)
    info = p.node("牌局回顾/title/line")
    p.set_active(info, True)
    p.art(info, "review_info_bar_exact.png", 0, -70, 708, 64, hide=True)
    p.disable(info, "cc.Widget")
    untint(p, info)
    style_label(p, "牌局回顾/title/平台", x=-170, y=-70,
                width=300, height=42, size=24, preview="", align=0)
    mode = p.node("牌局回顾/title/地九王")
    p.set_pos(mode, 110, -70, 108, 38, disable_widget=True)
    for path in ("牌局回顾/title/图例1", "牌局回顾/title/图例2",
                 "牌局回顾/title/战局详情"):
        p.set_active(p.node(path), False)

    # The only flexible area is the central content well.  Header, tabs and
    # pager remain fixed to their respective edges on 1334-1800px screens.
    for path in ("牌局回顾/回顾列表", "牌局回顾/文字牌谱"):
        node = p.node(path)
        p.sprite(node, "settlement_list_panel_exact.png", sliced=True)
        untint(p, node)
        stretch(p, path, 150, 205, left=21, right=21)
        fill_parent(p, path + "/view", 708, BASE_H - 355)

    content = p.node("牌局回顾/回顾列表/view/content")
    p.data[content]["_contentSize"]["width"] = 708
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0,
        "_originalWidth": 708,
    })
    _, content_layout = p.component(content, "cc.Layout")
    content_layout["_enabled"] = True
    content_layout["_N$paddingTop"] = 8
    content_layout["_N$paddingBottom"] = 8
    content_layout["_N$spacingY"] = 6

    text_content = p.node("牌局回顾/文字牌谱/view/content")
    p.data[text_content]["_contentSize"]["width"] = 704
    text_widget = ensure_widget(p, text_content)
    text_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 2, "_right": 2, "_top": 0,
        "_originalWidth": 704,
    })
    _, text_layout = p.component(text_content, "cc.Layout")
    text_layout["_enabled"] = True
    text_layout["_N$paddingTop"] = 8
    text_layout["_N$paddingBottom"] = 8
    text_layout["_N$spacingY"] = 8

    for section in ("1", "2", "3"):
        section_path = f"牌局回顾/文字牌谱/view/content/{section}"
        section_node = p.node(section_path)
        p.data[section_node]["_contentSize"]["width"] = 704
        p.disable(section_node, "cc.Widget")
        _, section_layout = p.component(section_node, "cc.Layout")
        section_layout["_enabled"] = True
        section_layout["_N$spacingY"] = 4
        heading = p.node(section_path + "/标题")
        p.set_active(heading, True)
        p.art(heading, "review_section_header_exact.png", 0, 0, 704, 60,
              sliced=True)
        p.disable(heading, "cc.Widget")
        untint(p, heading)
        style_label(p, section_path + "/标题/New Label", x=-225, y=0,
                    width=220, height=42, size=25,
                    preview=f"第{('一','二','三')[int(section)-1]}轮", align=0)
        style_label(p, section_path + "/标题/New Label copy", x=245, y=0,
                    width=190, height=42, size=22, preview="剩余钵钵", align=1)
        rows = p.node(section_path + "/list")
        p.data[rows]["_contentSize"]["width"] = 704
        p.disable(rows, "cc.Widget")
        _, row_layout = p.component(rows, "cc.Layout")
        row_layout["_enabled"] = True
        row_layout["_N$spacingY"] = 4

    controls = p.node("牌局回顾/操作")
    p.disable(controls, "cc.Layout")
    bottom(p, "牌局回顾/操作", 117, width=516, height=64)
    for name, x, off_asset, on_asset in (
        ("牌局回顾", -129, "review_tab_cards_off_exact.png", "review_tab_cards_on_exact.png"),
        ("文字牌谱", 129, "review_tab_text_off_exact.png", "review_tab_text_on_exact.png"),
    ):
        toggle = p.node(f"牌局回顾/操作/{name}")
        p.set_pos(toggle, x, 0, 248, 62, disable_widget=True)
        background_node = p.node(f"牌局回顾/操作/{name}/Background")
        p.art(background_node, off_asset, 0, 0, 248, 62, hide=True)
        untint(p, background_node)
        checkmark = p.node(f"牌局回顾/操作/{name}/checkmark")
        p.art(checkmark, on_asset, 0, 0, 248, 62, hide=True)
        untint(p, checkmark)

    pager = p.node("牌局回顾/分页")
    p.art(pager, "gift_pagination_exact.png", 0, 0, 708, 107)
    untint(p, pager)
    p.disable(pager, "cc.Layout")
    bottom(p, "牌局回顾/分页", 8, width=708, height=107)
    for path, x in (("首页", -270), ("上一页", -158),
                    ("下一页", 158), ("尾页", 270)):
        transparent_hotspot(p, f"牌局回顾/分页/{path}", x, 0, 88, 92)
    style_label(p, "牌局回顾/分页/页码", x=0, y=0,
                width=180, height=62, size=31, preview="1/2", align=1)

    # This page must render after all settlement siblings.  It fixes the
    # previous parent table header and 返回大厅 button showing through.
    root_children = [ref["__id__"] for ref in p.data[p.root]["_children"]]
    set_children_order(p, p.root,
                       [node for node in root_children if node != review] + [review])
    review_children = [ref["__id__"] for ref in p.data[review]["_children"]]
    set_children_order(p, review,
                       [background] + [node for node in review_children if node != background])
    p.save()


def apply_review_row() -> None:
    p = Prefab("assets/resources/Prefabs/回顾对象2.prefab")
    p.art(p.root, "review_row_exact.png", 0, 0, 708, 184, sliced=True)
    p.disable(p.root, "cc.Widget")
    untint(p, p.root)

    head = p.node("head")
    p.set_pos(head, -292, 24, 104, 104, disable_widget=True)
    _, mask = p.component(head, "cc.Mask")
    if mask is not None:
        mask["_type"] = 1
    image = p.node("head/img")
    p.set_pos(image, 0, 0, 104, 104, disable_widget=True)
    untint(p, image)

    try:
        ring = p.node("V7头像框")
    except KeyError:
        ring = p.clone_subtree(p.node("line"), p.root, "V7头像框")
    p.set_active(ring, True)
    p.art(ring, "review_avatar_ring_exact.png", -292, 24, 118, 118, hide=True)
    untint(p, ring)

    style_label(p, "name", x=-292, y=-66, width=160, height=34,
                size=24, preview="天外飞仙", align=1)
    p.set_active(p.node("id"), False)
    p.set_pos(p.node("庄"), -334, 72, 34, 34, disable_widget=True)
    p.set_pos(p.node("state"), -292, -30, 72, 32, disable_widget=True)

    hands = p.node("手牌")
    p.set_pos(hands, -20, -8, 374, 172, disable_widget=True)
    p.disable(hands, "cc.Layout")
    for group, gx in (("牌组1", -100), ("牌组2", 100)):
        group_node = p.node(f"手牌/{group}")
        p.set_pos(group_node, gx, -8, 144, 126, disable_widget=True)
        p.disable(group_node, "cc.Layout")
        for card, cx in (("handbig", -37), ("handbig copy", 37)):
            card_node = p.node(f"手牌/{group}/{card}")
            p.set_pos(card_node, cx, -2, 70, 98, disable_widget=True)
            for face in ("BK1", "BK0"):
                face_node = p.node(f"手牌/{group}/{card}/{face}")
                p.set_pos(face_node, 0, 0, 70, 98, disable_widget=True)
                untint(p, face_node)
            p.set_active(p.node(f"手牌/{group}/{card}/line"), False)
    style_label(p, "手牌/牌型1", x=-100, y=62, width=150, height=34,
                size=25, preview="7点", align=1)
    style_label(p, "手牌/牌型2", x=100, y=62, width=150, height=34,
                size=25, preview="9点", align=1)
    style_label(p, "三花", x=-20, y=62, width=180, height=34,
                size=25, preview="三花", align=1)
    p.set_active(p.node("score"), False)

    stats = p.node("list")
    p.set_pos(stats, 270, 0, 160, 174, disable_widget=True)
    p.disable(stats, "cc.Layout")
    for name, y, preview in (("1", 54, "芒果:9"),
                             ("2", 0, "+78"),
                             ("3", -54, "下注:24")):
        style_label(p, f"list/{name}", x=0, y=y, width=160, height=40,
                    size=24, preview=preview, align=1)
        p.data[p.node(f"list/{name}")]["_color"] = copy.deepcopy(WHITE)
    p.set_active(p.node("line"), False)

    # The frame is deliberately last so the dynamic portrait is visually
    # clipped under a complete, smooth metal circle.
    children = [ref["__id__"] for ref in p.data[p.root]["_children"]]
    set_children_order(p, p.root,
                       [node for node in children if node != ring] + [ring])
    p.save()


def apply_text_row() -> None:
    p = Prefab("assets/resources/Prefabs/文字牌谱对象2.prefab")
    p.art(p.root, "review_text_row_exact.png", 0, 0, 704, 52, sliced=True)
    untint(p, p.root)
    style_label(p, "name", x=-185, y=0, width=320, height=38,
                size=22, preview="天外飞仙(237737)", align=0)
    decision = p.node("决策")
    p.set_pos(decision, 42, 0, 42, 42, disable_widget=True)
    style_label(p, "操作", x=150, y=0, width=150, height=38,
                size=22, preview="下注24", align=1)
    style_label(p, "剩余", x=283, y=0, width=100, height=38,
                size=22, preview="58", align=1)
    p.save()


def main() -> None:
    apply_page()
    apply_review_row()
    apply_text_row()
    print("已把牌局回顾统一风格、放大牌面和响应式布局写入正式Prefab。")


if __name__ == "__main__":
    main()
