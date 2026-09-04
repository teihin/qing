#!/usr/bin/env python3
"""Serialize the approved V7 Mine composition into panelMain.prefab."""

from __future__ import annotations

from apply_v7_prefab_skin import Prefab
from apply_v7_lobby_exact import style_label, untint
from repair_v7_responsive_layout import bottom, ensure_widget, top


def set_full_inset_widget(p: Prefab, node_id: int, inset: float) -> None:
    widget = ensure_widget(p, node_id)
    node = p.data[node_id]
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": inset, "_right": inset, "_top": inset, "_bottom": inset,
        "_originalWidth": node["_contentSize"]["width"],
        "_originalHeight": node["_contentSize"]["height"],
    })


def apply() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    mine = p.node("Main/我的")
    p.sprite(mine, "mine_bg_exact.png")
    untint(p, mine)

    # The approved header, background scene, CASINO wordmark and large 8L
    # shield are one exact top asset.  No runtime skin or shield stretching.
    title = p.node("Main/我的/Title")
    p.art(title, "mine_hero_exact.png", 0, 0, 750, 334, hide=True)
    untint(p, title)
    top(p, "Main/我的/Title", 0, width=750, height=334, stretch_x=True)
    p.set_active(p.node("Main/我的/V7我的盾牌"), False)

    # Exact approved panel material and baked static captions.  Only real
    # account data remains as live labels above this sprite.
    info = p.node("Main/我的/信息")
    p.art(info, "mine_profile_exact.png", 0, 0, 671, 314)
    untint(p, info)
    top(p, "Main/我的/信息", 334, width=671, height=314)
    for name in ("TXT", "金币框", "测试", "管理", "VIP"):
        p.set_active(p.node(f"Main/我的/信息/{name}"), False)

    avatar = p.node("Main/我的/信息/头像")
    p.art(avatar, "mine_avatar_ring_exact.png", -243, 85, 118, 118)
    untint(p, avatar)
    # Hide the old ‘修改个人资料’ art while retaining the parent Button hit area.
    p.set_active(p.node("Main/我的/信息/头像/头像"), False)
    p.set_active(p.node("Main/我的/信息/头像/New Label"), False)
    mask = p.node("Main/我的/信息/头像/mask")
    p.set_pos(mask, 0, 0, 118, 118)
    set_full_inset_widget(p, mask, 7)
    image = p.node("Main/我的/信息/头像/mask/img")
    p.set_pos(image, 0, 0, 104, 104)
    set_full_inset_widget(p, image, 0)

    style_label(p, "Main/我的/信息/name",
                x=-53, y=103, width=220, height=42, size=29,
                preview="两棵树", align=0)
    style_label(p, "Main/我的/信息/id",
                x=175, y=103, width=105, height=40, size=23,
                preview="157710", align=0)
    style_label(p, "Main/我的/信息/gold",
                x=-55, y=61, width=130, height=38, size=24,
                preview="0.95", align=0)

    # Independent transparent hit area over the baked copy pictogram. It is a
    # real Prefab Button and panelMain.ts performs the clipboard action.
    try:
        copy_id = p.node("Main/我的/信息/复制ID")
    except KeyError:
        copy_id = p.clone_subtree(avatar, info, "复制ID")
    p.set_active(copy_id, True)
    p.art(copy_id, "transparent.png", 303, 102, 64, 60, hide=True)
    untint(p, copy_id)

    # Keep only the five live summary values in the old Data node.  Its own
    # panel and captions are superseded by mine_profile_exact.png.
    data = p.node("Main/我的/数据")
    p.set_active(data, True)
    p.art(data, "transparent.png", 0, 0, 671, 314)
    untint(p, data)
    top(p, "Main/我的/数据", 334, width=671, height=314)
    dynamic = {
        "总手数": (-228, -10, 48, "0"),
        "总胜率": (-79, -10, 96, "0.00%"),
        "获胜手数": (58, -10, 48, "0"),
        "平局手数": (171, -10, 48, "0"),
        "失败手数": (273, -10, 48, "0"),
    }
    dynamic_ids = {p.node(f"Main/我的/数据/{name}") for name in dynamic}
    for ref in p.data[data].get("_children", []):
        p.set_active(ref["__id__"], ref["__id__"] in dynamic_ids)
    for name, (x, y, width, preview) in dynamic.items():
        p.set_active(p.node(f"Main/我的/数据/{name}"), True)
        style_label(p, f"Main/我的/数据/{name}",
                    x=x, y=y, width=width, height=36, size=22,
                    preview=preview)

    # Six accepted bitmap buttons retain their existing Button components and
    # node names, so all implemented actions continue to work in the editor.
    ops = p.node("Main/我的/操作")
    p.set_active(ops, True)
    p.disable(ops, "cc.Layout")
    p.data[ops]["_anchorPoint"]["y"] = 0.5
    top(p, "Main/我的/操作", 664, width=700, height=317)
    specs = (
        ("代理", "mine_agent_exact.png", -172, 111, 326, 95),
        ("推广二维码", "mine_promotion_exact.png", 170, 111, 333, 95),
        ("资金明细", "mine_money_exact.png", -172, 0, 326, 94),
        ("赠送", "mine_gift_exact.png", 170, 0, 333, 94),
        ("战绩", "mine_record_exact.png", -172, -111, 326, 97),
        ("设置", "mine_settings_exact.png", 170, -111, 333, 97),
    )
    for name, asset, x, y, width, height in specs:
        node_id = p.node(f"Main/我的/操作/{name}")
        p.set_active(node_id, True)
        p.art(node_id, asset, x, y, width, height, hide=True)
        untint(p, node_id)

    # Prefab default is the non-agent composition: hide My Agent and move every
    # later action forward one slot. Runtime permission logic restores all six
    # slots only for real agent accounts.
    agent_nodes = [ref["__id__"] for ref in p.data[ops].get("_children", [])
                   if p.data[ref["__id__"]].get("_name") == "代理"]
    for agent_node in agent_nodes:
        p.set_active(agent_node, False)
    for name, x, y in (
        ("推广二维码", -172, 111),
        ("资金明细", 170, 111),
        ("赠送", -172, 0),
        ("战绩", 170, 0),
        ("设置", -172, -111),
    ):
        p.data[p.node(f"Main/我的/操作/{name}")]["_trs"]["array"][0:2] = [x, y]

    # Reuse the already accepted shared bottom bar.  Only the Mine selection
    # underline differs, matching the cyan line in 03-我的.png exactly.
    down = p.node("Down")
    p.art(down, "nav_bar_exact.png", 0, 0, 750, 155)
    untint(p, down)
    bottom(p, "Down", 0, width=750, height=155, stretch_x=True)
    mine_mark = p.node("Down/我的/checkmark")
    p.art(mine_mark, "nav_mine_selected_overlay.png", 0, 0, 130, 134, hide=True)
    untint(p, mine_mark)

    p.save()


if __name__ == "__main__":
    apply()
