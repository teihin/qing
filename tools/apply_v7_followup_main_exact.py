#!/usr/bin/env python3
"""Apply the accepted V7 follow-up main/settings pages to panelMain Prefab.

All static chrome is serialized as exact artwork.  QR, EditBox text, list rows
and toggle states stay as Prefab-owned live nodes.  No runtime skin/layout code
is introduced.
"""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import center_anchor, transparent
from repair_v7_responsive_layout import ensure_widget


BASE_H = 1334
GOLD = {"__type__": "cc.Color", "r": 232, "g": 198, "b": 145, "a": 255}
PLACEHOLDER = {"__type__": "cc.Color", "r": 184, "g": 177, "b": 166, "a": 255}
COOL_WHITE = {"__type__": "cc.Color", "r": 224, "g": 239, "b": 250, "a": 255}
ICE_BLUE = {"__type__": "cc.Color", "r": 164, "g": 207, "b": 237, "a": 255}


def full_screen(p: Prefab, node_id: int) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, 0, 0, 750, BASE_H)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": BASE_H,
    })


def fixed_top(p: Prefab, node_id: int, top: float, width: float,
              height: float, x: float = 0) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, x, BASE_H / 2 - top - height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 17,
        "_top": top, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def vertical_center(p: Prefab, node_id: int, y: float, width: float,
                    height: float, x: float = 0) -> None:
    """Center a fixed-size foreground element against the visible screen."""
    center_anchor(p, node_id)
    p.set_pos(node_id, x, y, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 18,
        "_horizontalCenter": x, "_verticalCenter": y,
        "_originalWidth": width, "_originalHeight": height,
    })


def fixed_bottom(p: Prefab, node_id: int, bottom: float, width: float,
                 height: float, x: float = 0) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, x, -BASE_H / 2 + bottom + height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 20,
        "_bottom": bottom, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def stretch_box(p: Prefab, node_id: int, top: float, bottom: float,
                left: float, right: float) -> None:
    width = 750 - left - right
    height = BASE_H - top - bottom
    center_anchor(p, node_id)
    p.set_pos(node_id, -375 + left + width / 2,
              -BASE_H / 2 + bottom + height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": left, "_right": right, "_top": top, "_bottom": bottom,
        "_originalWidth": width, "_originalHeight": height,
    })


def walk_nodes(p: Prefab, node_id: int):
    yield node_id
    for ref in p.data[node_id].get("_children", []):
        yield from walk_nodes(p, ref["__id__"])


def hide_legacy_visuals(p: Prefab, root_id: int) -> None:
    """Keep behavior components alive while removing the superseded skin."""
    for node_id in walk_nodes(p, root_id):
        _, sprite = p.component(node_id, "cc.Sprite")
        if sprite is not None:
            sprite["_enabled"] = False
        _, label = p.component(node_id, "cc.Label")
        if label is not None:
            p.set_active(node_id, False)


def add_master(p: Prefab, root_id: int, path: str, asset: str) -> int:
    try:
        master = p.node(path)
    except KeyError:
        source = next(
            node_id for node_id in walk_nodes(p, root_id)
            if node_id != root_id
            and p.component(node_id, "cc.Sprite")[1] is not None
            and not p.data[node_id].get("_children")
        )
        master = p.clone_subtree(source, root_id, path.split("/")[-1])
    p.set_active(master, True)
    children = p.data[root_id].setdefault("_children", [])
    children[:] = [ref for ref in children if ref.get("__id__") != master]
    children.insert(0, {"__id__": master})
    p.art(master, asset, 0, 0, 750, 1800, hide=True)
    untint(p, master)
    fixed_top(p, master, 0, 750, 1800)
    return master


def transparent_button(p: Prefab, path: str, x: float, top: float,
                       width: float, height: float) -> None:
    node = p.node(path)
    transparent(p, node, width, height, hide_children=True)
    fixed_top(p, node, top, width, height, x)


def style_promotion(p: Prefab) -> None:
    root = p.node("推广二维码")
    # The promotion page is an on-demand overlay, never the lobby default.
    p.set_active(root, False)
    full_screen(p, root)
    hide_legacy_visuals(p, root)
    master = add_master(p, root, "推广二维码/V7游戏推广母版",
                        "followup_promo_master_long.png")

    title = p.node("推广二维码/title")
    p.set_active(title, True)
    p.art(title, "followup_promo_header_exact.png", 0, 0, 750, 81)
    untint(p, title)
    fixed_top(p, title, 0, 750, 81)
    close = p.node("推广二维码/title/关闭上上层")
    p.set_active(close, True)
    transparent(p, close, 100, 81, hide_children=True)
    center_anchor(p, close)
    p.set_pos(close, -325, 0, 100, 81, disable_widget=True)

    try:
        shield = p.node("推广二维码/V7游戏推广盾牌")
    except KeyError:
        shield = p.clone_subtree(p.node("推广二维码/title/推广"), root,
                                 "V7游戏推广盾牌")
    p.set_active(shield, True)
    p.art(shield, "shield_hd.png", 0, 0, 188, 198, hide=True)
    untint(p, shield)
    fixed_top(p, shield, 100, 188, 198)

    try:
        headline = p.node("推广二维码/V7推广主标题")
    except KeyError:
        headline = p.clone_subtree(master, root, "V7推广主标题")
    p.set_active(headline, True)
    p.art(headline, "followup_promo_headline_exact.png", 0, 0, 640, 78,
          hide=True)
    untint(p, headline)
    fixed_top(p, headline, 320, 640, 78)

    try:
        label = p.node("推广二维码/V7推广ID")
    except KeyError:
        label = p.clone_subtree(p.node("资金明细/标题/说明"), root,
                                "V7推广ID")

    try:
        subtitle = p.node("推广二维码/V7推广说明")
    except KeyError:
        subtitle = p.clone_subtree(label, root, "V7推广说明")
    p.set_active(subtitle, True)
    style_label(p, "推广二维码/V7推广说明", x=0, y=0,
                width=520, height=38, size=24,
                preview="扫描二维码，加入 8L", align=1)
    p.data[subtitle]["_color"] = copy.deepcopy(COOL_WHITE)
    vertical_center(p, subtitle, 196, 520, 38)

    qr = p.node("推广二维码/二维码")
    p.set_active(qr, True)
    p.art(qr, "followup_promo_qr_frame_exact.png", 0, 0, 350, 374)
    untint(p, qr)
    vertical_center(p, qr, -30, 350, 374)
    qr_graphics = p.node("推广二维码/二维码/img")
    p.set_active(qr_graphics, True)
    center_anchor(p, qr_graphics)
    p.set_pos(qr_graphics, 0, -18, 260, 260, disable_widget=True)

    try:
        info = p.node("推广二维码/V7推广信息卡")
    except KeyError:
        info = p.clone_subtree(master, root, "V7推广信息卡")
    p.set_active(info, True)
    p.art(info, "followup_promo_info_panel_exact.png", 0, 0, 640, 190,
          hide=True)
    untint(p, info)
    vertical_center(p, info, -358, 640, 190)

    p.set_active(label, True)
    style_label(p, "推广二维码/V7推广ID", x=0, y=0,
                width=440, height=42, size=26, preview="推广ID：--", align=1)
    p.data[label]["_color"] = copy.deepcopy(COOL_WHITE)
    vertical_center(p, label, -313, 440, 42, x=-45)

    try:
        address_title = p.node("推广二维码/V7推广地址标题")
    except KeyError:
        address_title = p.clone_subtree(label, root, "V7推广地址标题")
    p.set_active(address_title, True)
    style_label(p, "推广二维码/V7推广地址标题", x=0, y=0,
                width=200, height=34, size=22,
                preview="游戏下载地址", align=0)
    p.data[address_title]["_color"] = copy.deepcopy(GOLD)
    vertical_center(p, address_title, -368, 200, 34, x=-165)

    try:
        link = p.node("推广二维码/V7推广链接")
    except KeyError:
        link = p.clone_subtree(label, root, "V7推广链接")
    p.set_active(link, True)
    style_label(p, "推广二维码/V7推广链接", x=0, y=0,
                width=440, height=44, size=22,
                preview="https://--", align=0)
    p.data[link]["_color"] = copy.deepcopy(ICE_BLUE)
    _, link_component = p.component(link, "cc.Label")
    if link_component is not None:
        link_component["_enableWrapText"] = False
        link_component["_N$overflow"] = 2
    vertical_center(p, link, -416, 440, 44, x=-45)

    share = p.node("推广二维码/分享二维码")
    try:
        copy_id = p.node("推广二维码/复制推广ID")
    except KeyError:
        copy_id = p.clone_subtree(share, root, "复制推广ID")
    p.set_active(copy_id, True)
    p.art(copy_id, "followup_promo_copy_button_exact.png", 0, 0, 86, 40,
          hide=True)
    untint(p, copy_id)
    vertical_center(p, copy_id, -313, 86, 40, x=265)

    try:
        copy_link = p.node("推广二维码/复制推广地址")
    except KeyError:
        copy_link = p.clone_subtree(share, root, "复制推广地址")
    p.set_active(copy_link, True)
    p.art(copy_link, "followup_promo_copy_button_exact.png", 0, 0, 86, 40,
          hide=True)
    untint(p, copy_link)
    vertical_center(p, copy_link, -416, 86, 40, x=265)

    p.set_active(share, True)
    p.art(share, "followup_promo_share_button_exact.png", 0, 0, 270, 82,
          hide=True)
    untint(p, share)
    vertical_center(p, share, -544, 270, 82, x=-145)

    try:
        save_button = p.node("推广二维码/保存二维码")
    except KeyError:
        save_button = p.clone_subtree(share, root, "保存二维码")
    p.set_active(save_button, True)
    p.art(save_button, "followup_promo_save_button_exact.png", 0, 0, 270, 82,
          hide=True)
    untint(p, save_button)
    vertical_center(p, save_button, -544, 270, 82, x=145)

    # Keep deterministic draw order while preserving unrelated legacy nodes.
    ordered = (master, shield, headline, subtitle, qr, info, label,
               address_title, link, copy_id, copy_link, share, save_button,
               title)
    children = p.data[root].setdefault("_children", [])
    ordered_ids = set(ordered)
    children[:] = [ref for ref in children if ref.get("__id__") not in ordered_ids]
    children.extend({"__id__": node_id} for node_id in ordered)


def pagination(p: Prefab, path: str) -> None:
    node = p.node(path)
    p.set_active(node, True)
    # Reuse the gift-page art but fit it to the list width, instead of making
    # it look like an unrelated full-width bottom bar.
    p.art(node, "gift_pagination_exact.png", 0, 0, 636, 96)
    untint(p, node)
    p.disable(node, "cc.Layout")
    fixed_bottom(p, node, 6, 636, 96)
    for name, x in (("首页", -241), ("上一页", -128),
                    ("下一页", 128), ("尾页", 241)):
        button = p.node(f"{path}/{name}")
        p.set_active(button, True)
        p.set_pos(button, x, 0, 65, 65, disable_widget=True)
        p.hide_children(button)
    page = p.node(f"{path}/页码")
    p.set_active(page, True)
    center_anchor(p, page)
    style_label(p, f"{path}/页码", x=0, y=0,
                width=118, height=46, size=26, preview="1/1", align=1)
    p.data[page]["_color"] = copy.deepcopy(GOLD)


def style_money(p: Prefab) -> None:
    root = p.node("资金明细")
    full_screen(p, root)
    hide_legacy_visuals(p, root)
    master = add_master(p, root, "资金明细/V7金币流向母版",
                        "followup_money_master_long.png")
    transparent_button(p, "资金明细/title copy/关闭上上层", -325, 0, 100, 84)

    listing = p.node("资金明细/资金明细列表")
    p.set_active(listing, True)
    p.sprite(listing, "followup_money_list_panel_exact.png", sliced=True)
    untint(p, listing)
    stretch_box(p, listing, 310, 107, 57, 57)
    view = p.node("资金明细/资金明细列表/view")
    p.set_active(view, True)
    center_anchor(p, view)
    p.set_pos(view, 0, 0, 620, 657 - 51)
    widget = ensure_widget(p, view)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 8, "_right": 8, "_top": 51, "_bottom": 8,
        "_originalWidth": 620, "_originalHeight": 598,
    })
    content = p.node("资金明细/资金明细列表/view/content")
    center_anchor(p, content)
    p.data[content]["_anchorPoint"]["y"] = 1
    p.data[content]["_contentSize"]["width"] = 620
    cwidget = ensure_widget(p, content)
    cwidget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0, "_originalWidth": 620,
    })
    _, layout = p.component(content, "cc.Layout")
    if layout is not None:
        layout["_enabled"] = True
        layout["_N$paddingTop"] = 0
        layout["_N$paddingBottom"] = 0
        layout["_N$spacingY"] = 11

    header = p.node("资金明细/标题")
    p.set_active(header, True)
    p.art(header, "followup_money_list_header_exact.png", 0, 0, 636, 51,
          hide=True)
    untint(p, header)
    fixed_top(p, header, 310, 636, 51)
    pagination(p, "资金明细/分页")

    # Ensure draw order: master, stretch panel, fixed header, pagination.
    children = p.data[root].setdefault("_children", [])
    ids = (master, listing, header, p.node("资金明细/分页"))
    children[:] = [ref for ref in children if ref.get("__id__") not in ids]
    children.insert(0, {"__id__": master})
    children.extend({"__id__": node_id} for node_id in ids[1:])


def style_money_row() -> None:
    p = Prefab("assets/resources/Prefabs/资金明细对象.prefab")
    center_anchor(p, p.root)
    p.set_pos(p.root, 0, -37, 620, 73)
    p.sprite(p.root, "followup_money_row_exact.png", sliced=True)
    untint(p, p.root)
    try:
        p.set_active(p.node("资金明细对象/line"), False)
    except KeyError:
        pass
    for path, x, width in (("type", -210, 180), ("count", -70, 105),
                           ("now", 55, 115), ("time", 200, 210)):
        full = f"资金明细对象/{path}"
        p.set_active(p.node(full), True)
        style_label(p, full, x=x, y=0, width=width, height=58,
                    size=19, align=1)
        node_id = p.node(full)
        p.data[node_id]["_color"] = copy.deepcopy(GOLD)
        _, component = p.component(node_id, "cc.Label")
        if component is not None:
            component["_enableWrapText"] = False
            component["_N$overflow"] = 2
    p.save()


def style_toggle(p: Prefab, path: str, screen_y: float) -> None:
    node = p.node(path)
    p.set_active(node, True)
    center_anchor(p, node)
    p.set_pos(node, 250, 0, 58, 35, disable_widget=True)
    bg = p.node(path + "/Background")
    p.set_active(bg, True)
    p.art(bg, "followup_switch_off_exact.png", 0, 0, 58, 35, hide=True)
    untint(p, bg)
    check = p.node(path + "/checkmark")
    p.set_active(check, True)
    p.art(check, "followup_switch_on_exact.png", 0, 0, 58, 35, hide=True)
    untint(p, check)
    parent = p.data[node]["_parent"]["__id__"]
    center_anchor(p, parent)
    p.set_pos(parent, 0, BASE_H / 2 - screen_y, 750, 80, disable_widget=True)


def style_settings(p: Prefab) -> None:
    root = p.node("设置")
    full_screen(p, root)
    hide_legacy_visuals(p, root)
    add_master(p, root, "设置/V7系统设置母版",
               "followup_settings_master_long.png")
    transparent_button(p, "设置/title/关闭上上层", -325, 0, 100, 84)

    group = p.node("设置/列表")
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    fixed_top(p, group, 0, 750, BASE_H)
    item = p.node("设置/列表/item")
    p.set_active(item, True)
    center_anchor(p, item)
    p.set_pos(item, 0, 0, 750, BASE_H, disable_widget=True)

    style_toggle(p, "设置/列表/item/聊天语音/聊天语音", 348)
    style_toggle(p, "设置/列表/item/游戏音效/游戏音效", 441)
    style_toggle(p, "设置/列表/item/防盗号/防盗号开关", 534)

    button_specs = (
        ("切换账号", -159, 641, 297, 93),
        ("修改登陆密码", 159, 641, 297, 93),
        ("修改交易密码", -159, 753, 297, 93),
        ("修改预留信息", 159, 753, 297, 93),
    )
    for name, x, top, width, height in button_specs:
        node = p.node(f"设置/列表/{name}")
        p.set_active(node, True)
        transparent(p, node, width, height, hide_children=True)
        p.set_pos(node, x, BASE_H / 2 - top - height / 2,
                  width, height, disable_widget=True)


def style_editbox(p: Prefab, row_path: str, placeholder: str) -> None:
    row = p.node(row_path)
    p.set_active(row, True)
    _, row_sprite = p.component(row, "cc.Sprite")
    if row_sprite is not None:
        row_sprite["_enabled"] = False
    edit_path = row_path + "/txt"
    edit = p.node(edit_path)
    p.set_active(edit, True)
    center_anchor(p, edit)
    p.set_pos(edit, 96, 0, 335, 62, disable_widget=True)
    bg = p.node(edit_path + "/BACKGROUND_SPRITE")
    p.set_active(bg, True)
    center_anchor(p, bg)
    transparent(p, bg, 335, 62)
    for suffix, color, text in (("TEXT_LABEL", GOLD, None),
                                ("PLACEHOLDER_LABEL", PLACEHOLDER, placeholder)):
        child_path = edit_path + "/" + suffix
        child = p.node(child_path)
        p.set_active(child, True)
        center_anchor(p, child)
        p.set_pos(child, 0, 0, 330, 50, disable_widget=True)
        style_label(p, child_path, x=0, y=0, width=330, height=50,
                    size=22, preview=text, align=0)
        p.data[child]["_color"] = copy.deepcopy(color)
        _, outline = p.component(child, "cc.LabelOutline")
        if outline is not None:
            outline["_enabled"] = False


def style_password_page(p: Prefab, root_name: str, asset: str,
                        rows: tuple[tuple[str, str], ...],
                        ok_name: str) -> None:
    root = p.node(root_name)
    full_screen(p, root)
    hide_legacy_visuals(p, root)
    add_master(p, root, f"{root_name}/V7密码页面母版", asset)
    transparent_button(p, f"{root_name}/title copy/关闭上上层", -325, 0, 100, 84)

    group = p.node(f"{root_name}/列表")
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    fixed_top(p, group, 0, 750, BASE_H)
    start_y = 369
    for index, (name, placeholder) in enumerate(rows):
        row = p.node(f"{root_name}/列表/{name}")
        center_anchor(p, row)
        top = start_y + index * 101
        p.set_pos(row, 0, BASE_H / 2 - top - 73 / 2, 542, 73,
                  disable_widget=True)
        style_editbox(p, f"{root_name}/列表/{name}", placeholder)

    ok = p.node(f"{root_name}/列表/ok/{ok_name}")
    p.set_active(ok, True)
    transparent(p, ok, 438, 83, hide_children=True)
    p.set_pos(ok, 0, BASE_H / 2 - 965 - 83 / 2, 438, 83,
              disable_widget=True)


def apply() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    style_promotion(p)
    style_money(p)
    style_settings(p)
    style_password_page(
        p, "修改登陆密码", "followup_password_login_master_long.png",
        (("原有密码", "请输入目前使用的密码"),
         ("新密码1", "请输入新密码"),
         ("新密码2", "请再次输入新密码")),
        "确定修改登陆密码",
    )
    style_password_page(
        p, "修改交易密码", "followup_password_trade_master_long.png",
        (("原有密码", "请输入目前使用的密码"),
         ("新密码1", "请输入新密码"),
         ("新密码2", "请再次输入新密码")),
        "确定修改交易密码",
    )
    style_password_page(
        p, "初始化交易密码", "followup_password_init_master_long.png",
        (("新密码1", "请输入新密码"),
         ("新密码2", "请再次输入新密码")),
        "确定初始化交易密码",
    )
    p.save()
    style_money_row()
    print("V7 后续主功能 Prefab 已完成")


if __name__ == "__main__":
    apply()
