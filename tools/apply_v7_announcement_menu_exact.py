#!/usr/bin/env python3
"""Serialize the approved tall V7 announcement image into panelMain.prefab.

The approved page is one immutable, top-anchored bitmap layer. Existing nodes
remain real transparent Buttons, keeping the original four business routes
without any runtime layout or skin code.
"""

from __future__ import annotations

from apply_v7_lobby_exact import untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import ensure_widget, top


PREFAB = "assets/resources/UI/panelMain.prefab"
LONG_ASSET = "announcement_menu_long_exact.png"

# Mockup-space button rectangles scaled from 941x1672 to the 750x1334 Cocos
# design canvas.  Their node names are intentionally unchanged because
# panelMain.ts routes announcement actions by those names.
BUTTONS = (
    ("公告6", 241, 371, 144),
    ("公告1", 82, 371, 140),
    ("公告2", -75, 371, 140),
    ("公告5", -235, 371, 142),
)
BUTTON_X = 162


def apply() -> None:
    p = Prefab(PREFAB)
    announcement = p.node("Main/公告")

    # Keep a full-screen fallback behind the approved body.  It is normally
    # covered, but prevents an exposed strip while Creator updates Widgets.
    p.sprite(announcement, "casino_bg_exact.png")
    untint(p, announcement)

    try:
        floor = p.node("Main/公告/V7公告长屏补底")
    except KeyError:
        floor = p.clone_subtree(
            p.node("Main/公告/title copy"), announcement, "V7公告长屏补底"
        )
    # Kept only so existing prefab IDs remain stable; the approved runtime page
    # no longer stitches a second image under the artwork.
    p.art(floor, "transparent.png", 0, 0, 1, 1, hide=True)
    untint(p, floor)
    p.set_active(floor, False)

    try:
        body = p.node("Main/公告/V7公告菜单高清母版")
    except KeyError:
        body = p.clone_subtree(
            p.node("Main/公告/title copy"), announcement, "V7公告菜单高清母版"
        )
    p.set_active(body, True)
    p.art(body, LONG_ASSET, 0, 0, 750, 1800, hide=True)
    untint(p, body)
    top(p, "Main/公告/V7公告菜单高清母版", 0, width=750, height=1800)

    # The body must render before the transparent interaction layer.
    children = p.data[announcement].get("_children", [])
    children[:] = ([{"__id__": body}, {"__id__": floor}] +
                   [ref for ref in children
                    if ref.get("__id__") not in (floor, body)])

    # The approved bitmap already contains the title and every button visual.
    p.set_active(p.node("Main/公告/title copy"), False)
    home = p.node("Main/公告/主页")
    p.disable(home, "cc.Sprite")
    p.disable(home, "cc.Layout")
    p.set_pos(home, 0, 0, 750, 1334)
    home_widget = ensure_widget(p, home)
    home_widget.update({
        "_enabled": True,
        "alignMode": 1,
        "_alignFlags": 45,
        "_left": 0,
        "_right": 0,
        "_top": 0,
        "_bottom": 0,
        "_originalWidth": 750,
        "_originalHeight": 1334,
    })

    for name, y, width, height in BUTTONS:
        node = p.node(f"Main/公告/主页/{name}")
        p.set_active(node, True)
        p.art(node, "transparent.png", BUTTON_X, y, width, height, hide=True)
        untint(p, node)
        top_px = 667 - y - height / 2
        top(p, f"Main/公告/主页/{name}", top_px,
            x=BUTTON_X, width=width, height=height)

    for name in ("惩罚列表", "公告8", "公告3", "公告4"):
        p.set_active(p.node(f"Main/公告/主页/{name}"), False)

    p.save()


if __name__ == "__main__":
    apply()
