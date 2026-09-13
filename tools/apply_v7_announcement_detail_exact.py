#!/usr/bin/env python3
"""Serialize the approved V7 announcement-detail artwork into panelMain.

All visible fixed copy is baked into editor-visible Sprite assets.  Runtime code
continues to handle only the server-driven latest-announcement string and the
existing close/scroll interactions.
"""

from __future__ import annotations

import json
from pathlib import Path

from apply_v7_lobby_exact import untint
from apply_v7_prefab_skin import Prefab
from apply_v8_login import update_meta
from repair_v7_responsive_layout import ensure_widget, stretch, top


PREFAB = "assets/resources/UI/panelMain.prefab"
BACKGROUND = "announcement_detail_bg_long_exact.png"
HEADER = "announcement_detail_header_exact.png"
BODY_HEIGHT = 1900
LATEST_ART_HEIGHT = 1253
SCALE = 750 / 941
ART_HEIGHT = 1672 * SCALE

PAGE_ART = {
    "公告6": "announcement_detail_latest_exact.png",
    "公告1": "announcement_detail_rules_body_v8.png",
    "公告2": "announcement_detail_bonus_body_v8.png",
    "公告5": "announcement_detail_penalty_body_v8.png",
}
PAGE_FIXED = {
    "公告1": "announcement_detail_plain_bg_v8.png",
    "公告2": "announcement_detail_plain_bg_v8.png",
    "公告5": "announcement_detail_plain_bg_v8.png",
}

STATIC_PAGES = (
    ("公告1", "1", "announcement_detail_rules_body_v8.png"),
    ("公告2", "2", "announcement_detail_bonus_body_v8.png"),
    ("公告5", "1", "announcement_detail_penalty_body_v8.png"),
)


def full_view(p: Prefab, path: str) -> None:
    node = p.node(path)
    p.set_pos(node, 0, 0, 750, 1253)
    widget = ensure_widget(p, node)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": 1253,
    })


def prepare_page(p: Prefab, page: str, clone_source: str) -> None:
    root = p.node(page)
    is_static_page = page in {"公告1", "公告2", "公告5"}
    if is_static_page:
        # Static detail pages keep only the fixed top nav at the root; the
        # enlarged body image scrolls below it on the pure lounge background.
        p.disable(root, "cc.Sprite")
    else:
        p.sprite(root, "casino_bg_exact.png")
        untint(p, root)

    try:
        background = p.node(f"{page}/V7公告详情长背景")
    except KeyError:
        background = p.clone_subtree(
            p.node("公告1/list/view/content/1"),
            root,
            "V7公告详情长背景",
        )
    p.set_active(background, True)
    fixed_asset = PAGE_FIXED.get(page, PAGE_ART.get(page, BACKGROUND))
    fixed_height = 1334 if is_static_page else ART_HEIGHT
    p.art(background, fixed_asset, 0, 0, 750, fixed_height, hide=True)
    untint(p, background)
    if is_static_page:
        stretch(p, f"{page}/V7公告详情长背景", 0, 0)
    else:
        top(p, f"{page}/V7公告详情长背景", 0, width=750, height=fixed_height)

    title = p.node(f"{page}/title")
    # Header lettering and panel frame are already part of the approved
    # screenshot. Keep the close Button hierarchy live, but remove the old
    # stretched title sprite so it cannot double-render over the bitmap.
    if is_static_page:
        p.art(title, "announcement_detail_nav_v8.png", 0, 0, 750, 81, hide=False)
        untint(p, title)
        # `top()` writes both the transform and the editor/runtime Widget
        # anchors.  A plain alignFlags override previously sent this bar to
        # the bottom on tall devices.
        top(p, f"{page}/title", 0, width=750, height=81, stretch_x=True)
    else:
        p.disable(title, "cc.Sprite")
    p.disable(title, "cc.Label")
    p.set_active(p.node(f"{page}/title/公告 "), False)
    close = p.node(f"{page}/title/关闭上上层")
    p.set_active(close, True)
    p.set_pos(close, -325, 0, 100, 81)
    p.set_active(p.node(f"{page}/title/关闭上上层/关闭"), False)

    list_node = p.node(f"{page}/list")
    p.disable(list_node, "cc.Sprite")
    stretch(p, f"{page}/list", 81, 0, left=0, right=0)
    full_view(p, f"{page}/list/view")
    _, scroll = p.component(list_node, "cc.ScrollView")
    scroll["horizontal"] = False
    scroll["vertical"] = True
    scroll["inertia"] = True
    scroll["elastic"] = True

    content = p.node(f"{page}/list/view/content")
    content_data = p.data[content]
    content_data["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 1}
    # A taller content node gives the long-phone viewport a real scroll range.
    p.set_pos(content, 0, 626.5 if is_static_page else 800,
              750 if is_static_page else 620,
              1800 if is_static_page else 1600)
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 40,
        "_top": 0, "_horizontalCenter": 0,
        "_originalWidth": 750 if is_static_page else 620,
        "_originalHeight": 1800 if is_static_page else 1600,
    })
    p.disable(content, "cc.Layout")


def apply_static_page(p: Prefab, page: str, old_child: str, asset: str) -> None:
    prepare_page(p, page, old_child)
    art = p.node(f"{page}/list/view/content/{old_child}")
    # Only the body band moves inside the ScrollView. The top nav remains fixed,
    # so dragging cannot move the whole interface.
    p.set_active(art, True)
    # The body plate starts immediately below the fixed nav bar.
    # Leave a 62.5px logical safety gap below the fixed nav so the first
    # heading/card border can never be clipped by the viewport edge.
    p.art(art, asset, 0, -700, 750, 1525, hide=False)
    p.data[art]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    p.disable(art, "cc.Widget")
    view = p.node(f"{page}/list/view")
    p.set_pos(view, 0, 0, 750, 1253)
    view_widget = ensure_widget(p, view)
    view_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": 1253,
    })
    # The ScrollView spans the area below the nav; its content node is taller
    # than the viewport so only this lower region scrolls.
    content = p.node(f"{page}/list/view/content")
    p.data[content]["_contentSize"] = {"__type__": "cc.Size", "width": 750, "height": 1800}
    content_widget = ensure_widget(p, content)
    # Keep the content top anchored to the adaptive viewport.  The viewport
    # itself may become taller on long phones, but the scroll origin remains
    # immediately below the fixed nav instead of drifting into the body.
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 20,
        "_top": 0, "_horizontalCenter": 0,
        "_originalWidth": 750, "_originalHeight": 1800,
    })
    content = p.node(f"{page}/list/view/content")
    p.data[content]["_children"] = [{"__id__": art}] + [
        ref for ref in p.data[content].get("_children", [])
        if ref.get("__id__") != art
    ]
    # Keep the live close button above the moving artwork.
    root = p.node(page)
    background = p.node(f"{page}/V7公告详情长背景")
    list_node = p.node(f"{page}/list")
    title = p.node(f"{page}/title")
    p.data[root]["_children"] = ([{"__id__": background}, {"__id__": list_node}, {"__id__": title}] + [
        ref for ref in p.data[root].get("_children", [])
        if ref.get("__id__") not in (background, list_node, title)
    ])


def apply_latest(p: Prefab) -> None:
    page = "公告6"
    prepare_page(p, page, "msg")
    list_node = p.node(f"{page}/list")
    view = p.node(f"{page}/list/view")
    content = p.node(f"{page}/list/view/content")
    message = p.node(f"{page}/list/view/content/msg")
    try:
        art = p.node(f"{page}/list/V7公告正文高清母版")
    except KeyError:
        art = None
        for old_path in (
            f"{page}/list/view/V7公告正文高清母版",
            f"{page}/list/view/content/V7公告正文高清母版",
        ):
            try:
                art = p.node(old_path)
                break
            except KeyError:
                continue
        if art is None:
            art = p.clone_subtree(
                p.node("公告1/list/view/content/1"),
                list_node,
                "V7公告正文高清母版",
            )
        else:
            old_parent = p.data[art]["_parent"]["__id__"]
            p.data[old_parent]["_children"] = [
                ref for ref in p.data[old_parent].get("_children", [])
                if ref.get("__id__") != art
            ]
            p.data[art]["_parent"] = {"__id__": list_node}
            p.data[list_node].setdefault("_children", []).append({"__id__": art})
    # The exact latest-announcement screenshot supplies the fixed frame. The
    # live message label below remains responsible for server text.
    p.set_active(art, False)

    # The frame is a fixed sibling of the clipped viewport.  Only the content
    # node moves, so text can never slide over the title or outside the inner
    # blue rectangle.
    list_children = p.data[list_node].get("_children", [])
    list_children[:] = ([{"__id__": art}, {"__id__": view}] +
                        [ref for ref in list_children
                         if ref.get("__id__") not in (art, view)])
    p.set_pos(view, 0, -37.5, 620, 1068)
    view_widget = ensure_widget(p, view)
    view_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 65, "_right": 65, "_top": 130, "_bottom": 55,
        "_originalWidth": 620, "_originalHeight": 1068,
    })
    _, view_mask = p.component(view, "cc.Mask")
    if view_mask is not None:
        view_mask["_enabled"] = True
    content_children = p.data[content].get("_children", [])
    content_children[:] = ([{"__id__": message}] +
                            [ref for ref in content_children
                             if ref.get("__id__") not in (art, message)])
    p.set_pos(content, 0, 534, 620, 1068)
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 40,
        "_top": 0, "_horizontalCenter": 0,
        "_originalWidth": 620, "_originalHeight": 1068,
    })

    msg = p.data[message]
    msg["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 1}
    p.set_pos(message, 0, -25, 570, 44)
    msg["_color"] = {
        "__type__": "cc.Color", "r": 231, "g": 224, "b": 210, "a": 255
    }
    _, label = p.component(message, "cc.Label")
    label["_fontSize"] = 24
    label["_lineHeight"] = 38
    label["_enableWrapText"] = True
    label["_N$horizontalAlign"] = 0
    label["_N$verticalAlign"] = 0
    label["_N$overflow"] = 3
    msg_widget = ensure_widget(p, message)
    msg_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 40,
        "_top": 25, "_horizontalCenter": 0,
        "_originalWidth": 570, "_originalHeight": 44,
    })
    p.set_active(p.node(f"{page}/最新公告标题"), False)


def apply() -> None:
    p = Prefab(PREFAB)
    for stem in ("rules", "bonus", "penalty"):
        update_meta("announcement_detail_plain_bg_v8.png")
        update_meta("announcement_detail_nav_v8.png")
        update_meta(f"announcement_detail_{stem}_body_v8.png")
    manifest = Path("tools/v8_announcement_detail_crops.json")
    if manifest.exists():
        for cut in json.loads(manifest.read_text()):
            update_meta(Path(cut["output"]).name)
    for page, child, asset in STATIC_PAGES:
        apply_static_page(p, page, child, asset)
    apply_latest(p)
    p.save()


if __name__ == "__main__":
    apply()
    print("已把公告详情V2高清正文与赠送同款顶部栏写入panelMain.prefab。")
