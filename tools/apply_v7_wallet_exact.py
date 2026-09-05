#!/usr/bin/env python3
"""Serialize the accepted V7 wallet artwork into Cocos Prefabs.

This is an editor-time migration.  It writes SpriteFrame references, widgets,
coordinates, text styles and transparent interaction hit areas directly into
the Prefabs; no runtime skin or layout construction is introduced.
"""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import ensure_widget
from repair_v7_wallet_channel_selection import apply_channel_selection, apply_channel_viewport, CHANNEL_PATH


BASE_H = 1334
PAGE_TOP = 198
PAGE_H = BASE_H - PAGE_TOP
GOLD = {"__type__": "cc.Color", "r": 231, "g": 197, "b": 145, "a": 255}
PLACEHOLDER = {"__type__": "cc.Color", "r": 171, "g": 158, "b": 156, "a": 255}
NAVY = {"__type__": "cc.Color", "r": 4, "g": 34, "b": 57, "a": 255}


def center_anchor(p: Prefab, node_id: int) -> None:
    """Normalize legacy top/left anchors before applying center-based coordinates."""
    p.data[node_id]["_anchorPoint"] = {
        "__type__": "cc.Vec2", "x": 0.5, "y": 0.5,
    }


def full_widget(p: Prefab, node_id: int, width: float, height: float) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, 0, 0, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def root_top(p: Prefab, node_id: int, top_px: float, width: float,
             height: float, x: float = 0, stretch_x: bool = False) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, x, BASE_H / 2 - top_px - height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1,
        "_alignFlags": 41 if stretch_x else 17,
        "_left": 0, "_right": 0, "_top": top_px,
        "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def page_top(p: Prefab, node_id: int, screen_top: float, width: float,
             height: float, x: float = 0) -> None:
    top_px = screen_top - PAGE_TOP
    center_anchor(p, node_id)
    p.set_pos(node_id, x, PAGE_H / 2 - top_px - height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 17,
        "_top": top_px, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def page_bottom(p: Prefab, node_id: int, bottom_px: float, width: float,
                height: float, x: float = 0) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, x, -PAGE_H / 2 + bottom_px + height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 20,
        "_bottom": bottom_px, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def page_fixed_top(p: Prefab, node_id: int, top_px: float, width: float,
                   height: float, x: float = 0) -> None:
    """Keep a fixed-height legacy group pinned to the page top on tall screens."""
    center_anchor(p, node_id)
    p.set_pos(node_id, x, PAGE_H / 2 - top_px - height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 17,
        "_top": top_px, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def page_stretch(p: Prefab, node_id: int, screen_top: float, bottom_px: float,
                 left: float, right: float) -> None:
    top_px = screen_top - PAGE_TOP
    width = 750 - left - right
    height = PAGE_H - top_px - bottom_px
    center_anchor(p, node_id)
    p.set_pos(node_id, -375 + left + width / 2,
              -PAGE_H / 2 + bottom_px + height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": left, "_right": right, "_top": top_px,
        "_bottom": bottom_px, "_originalWidth": width,
        "_originalHeight": height,
    })


def transparent(p: Prefab, node_id: int, width: float, height: float,
                *, hide_children: bool = False) -> None:
    p.art(node_id, "transparent.png", 0, 0, width, height,
          hide=hide_children)
    untint(p, node_id)


def ensure_art(p: Prefab, parent_id: int, name: str,
               source_path: str = "钱包/Title/钱包", first: bool = False) -> int:
    try:
        node_id = p.node(name)
    except KeyError:
        node_id = p.clone_subtree(p.node(source_path), parent_id, name.split("/")[-1])
    p.set_active(node_id, True)
    if first:
        children = p.data[parent_id].setdefault("_children", [])
        children[:] = [ref for ref in children if ref.get("__id__") != node_id]
        children.insert(0, {"__id__": node_id})
    return node_id


def toggle_checked(p: Prefab, node_id: int, value: bool) -> None:
    _, toggle = p.component(node_id, "cc.Toggle")
    toggle["_N$isChecked"] = value


def style_tab_bar(p: Prefab) -> None:
    options = p.node("钱包/选项")
    p.disable(options, "cc.Layout")
    root_top(p, options, 102, 666, 66)
    specs = (
        ("充值", -222, "wallet_tabs_recharge_exact.png", 222, True),
        ("提现", 0, "wallet_tabs_withdraw_exact.png", 0, False),
        ("记录", 222, "wallet_tabs_record_exact.png", -222, False),
    )
    for name, x, asset, art_x, checked in specs:
        node = p.node(f"钱包/选项/{name}")
        p.set_pos(node, x, 0, 222, 66, disable_widget=True)
        transparent(p, p.node(f"钱包/选项/{name}/Background"), 222, 66)
        check = p.node(f"钱包/选项/{name}/checkmark")
        p.art(check, asset, art_x, 0, 666, 66, hide=True)
        untint(p, check)
        toggle_checked(p, node, checked)


def style_recharge(p: Prefab) -> None:
    page = p.node("钱包/容器/充值")
    root = p.node("钱包/容器/充值/根")
    full_widget(p, page, 750, PAGE_H)
    full_widget(p, root, 750, PAGE_H)

    panel = ensure_art(p, root, "钱包/容器/充值/根/V7充值面板", first=True)
    p.sprite(panel, "wallet_recharge_panel_exact.png", sliced=True)
    untint(p, panel)
    page_stretch(p, panel, 223, 49, 54, 54)

    title1 = ensure_art(p, root, "钱包/容器/充值/根/V7选择充值渠道")
    p.art(title1, "wallet_recharge_channel_title_exact.png", 0, 0, 584, 49, hide=True)
    page_top(p, title1, 247, 584, 49)
    title2 = ensure_art(p, root, "钱包/容器/充值/根/V7选择充值金额")
    p.art(title2, "wallet_recharge_amount_title_exact.png", 0, 0, 584, 49, hide=True)
    page_top(p, title2, 638, 584, 49)

    channels = apply_channel_viewport(p)
    channel_specs = {
        "支付1": (-151, 385, "wallet_channel_bank_exact.png"),
        "支付3": (-151, 385, "wallet_channel_bank_exact.png"),
        "支付2": (151, 385, "wallet_channel_alipay_exact.png"),
        "支付4": (151, 385, "wallet_channel_alipay_exact.png"),
        "支付5": (-151, 237, "wallet_channel_wechat_exact.png"),
        "支付6": (151, 237, "wallet_channel_other_exact.png"),
        "支付7": (-151, 89, "wallet_channel_other_exact.png"),
        "VIP充值": (151, 89, "wallet_channel_other_exact.png"),
        "VIP充值2": (-151, -59, "wallet_channel_other_exact.png"),
    }
    for name, (x, y, asset) in channel_specs.items():
        toggle = p.node(f"{CHANNEL_PATH}/{name}")
        p.set_pos(toggle, x, y, 284, 129, disable_widget=True)
        background = p.node(f"{CHANNEL_PATH}/{name}/Background")
        p.set_active(background, True)
        p.art(background, asset, 0, 0, 284, 129, hide=True)
        untint(p, background)
        mark = p.node(f"{CHANNEL_PATH}/{name}/checkmark")
        selected_asset = "wallet_channel_selected_overlay.png"
        p.set_active(mark, True)
        p.art(mark, selected_asset, 0, 0, 284, 129, hide=True)
        untint(p, mark)
        overlay_path = f"{CHANNEL_PATH}/{name}/V7通道卡片"
        overlay = ensure_art(p, toggle, overlay_path,
                             source_path="钱包/Title/钱包")
        p.set_active(overlay, False)
        # Draw the normal card first and Toggle checkmark last.  Several old
        # channel nodes serialized checkmark before Background, which hid the
        # selected frame even though Toggle state itself changed correctly.
        children = p.data[toggle].setdefault("_children", [])
        front = (background, mark)
        children[:] = [ref for ref in children if ref.get("__id__") not in front]
        children.insert(0, {"__id__": background})
        children.append({"__id__": mark})
        try:
            p.set_active(p.node(f"{CHANNEL_PATH}/{name}/New Label"), False)
        except KeyError:
            pass

    amounts = p.node("钱包/容器/充值/根/金额")
    p.disable(amounts, "cc.Layout")
    page_fixed_top(p, amounts, 0, 750, PAGE_H)
    names = ("50", "100", "500", "1000", "2000", "5000")
    for index, name in enumerate(names):
        node = p.node(f"钱包/容器/充值/根/金额/{name}")
        x = (-200, 0, 200)[index % 3]
        y = 4 if index < 3 else -132
        p.set_pos(node, x, y, 182, 116, disable_widget=True)
        background = p.node(f"钱包/容器/充值/根/金额/{name}/Background")
        p.art(background, "wallet_amount_off_exact.png", 0, 0, 182, 116, hide=True)
        untint(p, background)
        check = p.node(f"钱包/容器/充值/根/金额/{name}/checkmark")
        p.art(check, "wallet_amount_on_exact.png", 0, 0, 186, 116, hide=True)
        untint(p, check)
        toggle_checked(p, node, name == "500")
        label = p.node(f"钱包/容器/充值/根/金额/{name}/txt")
        style_label(p, f"钱包/容器/充值/根/金额/{name}/txt",
                    x=0, y=0, width=170, height=64, size=31,
                    preview=name + "元", align=1)
        p.data[label]["_color"] = copy.deepcopy(NAVY if name == "500" else GOLD)

    notice = ensure_art(p, root, "钱包/容器/充值/根/V7充值提示框")
    p.art(notice, "wallet_recharge_notice_exact.png", 0, 0, 588, 120, hide=True)
    untint(p, notice)
    page_bottom(p, notice, 226, 588, 120)

    for path in ("钱包/容器/充值/根/充值提示 copy",):
        try:
            p.set_active(p.node(path), False)
        except KeyError:
            pass
    # The Prefab has two siblings with the same legacy name; hide both copies.
    for ref in p.data[root].get("_children", []):
        child = ref["__id__"]
        if p.data[child].get("_name") == "充值提示 copy":
            p.set_active(child, False)
    dynamic_notice = p.node("钱包/容器/充值/根/充值提示")
    p.set_active(dynamic_notice, True)
    # Keep the live copy to the right of the baked warning icon.
    page_bottom(p, dynamic_notice, 244, 430, 84, x=45)
    style_label(p, "钱包/容器/充值/根/充值提示",
                x=45, y=p.data[dynamic_notice]["_trs"]["array"][1],
                width=430, height=84, size=24,
                preview="请使用实名认证名下的银行卡充值，\n准确按照订单金额进行转账。", align=0)
    p.data[dynamic_notice]["_color"] = copy.deepcopy(GOLD)

    # The opaque notice shell must render behind its live explanatory label.
    root_children = p.data[root].setdefault("_children", [])
    notice_ids = (notice, dynamic_notice)
    root_children[:] = [ref for ref in root_children
                        if ref.get("__id__") not in notice_ids]
    root_children.append({"__id__": notice})
    root_children.append({"__id__": dynamic_notice})

    confirm = p.node("钱包/容器/充值/根/确认充值")
    p.art(confirm, "wallet_recharge_confirm_exact.png", 0, 0, 582, 103,
          hide=True)
    untint(p, confirm)
    page_bottom(p, confirm, 84, 582, 103)
    p.set_active(p.node("钱包/容器/充值/根/充值提示按钮"), False)


def style_editbox(p: Prefab, row_path: str, asset: str,
                  screen_top: float, placeholder: str) -> None:
    row = p.node(row_path)
    p.sprite(row, asset)
    untint(p, row)
    page_top(p, row, screen_top, 602, 79)

    edit_path = row_path + "/input"
    edit = p.node(edit_path)
    center_anchor(p, edit)
    p.disable(edit, "cc.Widget")
    p.set_pos(edit, 125, 0, 370, 70)
    bg = p.node(edit_path + "/BACKGROUND_SPRITE")
    center_anchor(p, bg)
    p.disable(bg, "cc.Widget")
    transparent(p, bg, 370, 70)

    for suffix, color, preview in (
        ("TEXT_LABEL", GOLD, None),
        ("PLACEHOLDER_LABEL", PLACEHOLDER, placeholder),
    ):
        path = edit_path + "/" + suffix
        node = p.node(path)
        p.set_active(node, True)
        center_anchor(p, node)
        p.disable(node, "cc.Widget")
        style_label(p, path, x=0, y=0, width=365, height=52,
                    size=25, preview=preview, align=0)
        p.data[node]["_color"] = copy.deepcopy(color)
        _, outline = p.component(node, "cc.LabelOutline")
        if outline is not None:
            outline["_enabled"] = False


def style_withdraw(p: Prefab) -> None:
    page = p.node("钱包/容器/提现")
    full_widget(p, page, 750, PAGE_H)

    balance = p.node("钱包/容器/提现/余额")
    p.art(balance, "wallet_withdraw_balance_exact.png", 0, 0, 642, 267)
    untint(p, balance)
    page_top(p, balance, 223, 642, 267)
    for child in ("金币", "New Label"):
        try:
            p.set_active(p.node(f"钱包/容器/提现/余额/{child}"), False)
        except KeyError:
            pass
    style_label(p, "钱包/容器/提现/余额/num",
                x=0, y=7, width=520, height=82, size=56,
                preview="8,888.00", align=1)
    center_anchor(p, p.node("钱包/容器/提现/余额/num"))
    p.data[p.node("钱包/容器/提现/余额/num")]["_color"] = copy.deepcopy(GOLD)

    all_button = p.node("钱包/容器/提现/全部提现")
    transparent(p, all_button, 202, 66, hide_children=True)
    page_top(p, all_button, 401, 202, 66)

    type_group = p.node("钱包/容器/提现/类型选择")
    p.disable(type_group, "cc.Layout")
    p.sprite(type_group, "wallet_withdraw_types_base_exact.png")
    untint(p, type_group)
    page_top(p, type_group, 522, 602, 60)
    type_specs = (
        ("银行卡提现", -200, "wallet_withdraw_type_bank_exact.png", True),
        ("支付宝提现", 0, "wallet_withdraw_type_alipay_exact.png", False),
        ("USDT提现", 200, "wallet_withdraw_type_usdt_exact.png", False),
    )
    for name, x, asset, checked in type_specs:
        node = p.node(f"钱包/容器/提现/类型选择/{name}")
        p.set_pos(node, x, 0, 202, 60, disable_widget=True)
        transparent(p, p.node(f"钱包/容器/提现/类型选择/{name}/Background"), 202, 60)
        check = p.node(f"钱包/容器/提现/类型选择/{name}/checkmark")
        p.art(check, asset, 0, 0, 204, 60, hide=True)
        untint(p, check)
        toggle_checked(p, node, checked)

    options = p.node("钱包/容器/提现/提现选项")
    full_widget(p, options, 750, PAGE_H)
    p.disable(options, "cc.Layout")
    panel = ensure_art(p, options, "钱包/容器/提现/提现选项/V7提现表单", first=True)
    p.sprite(panel, "wallet_withdraw_form_exact.png", sliced=True)
    untint(p, panel)
    page_stretch(p, panel, 507, 43, 54, 54)

    default_rows = (
        ("金额", "wallet_withdraw_input_amount_exact.png", 604, "请输入金额"),
        ("姓名", "wallet_withdraw_input_name_exact.png", 703, "请输入姓名"),
        ("银行", "wallet_withdraw_input_bank_exact.png", 802, "请选择银行"),
        ("卡号", "wallet_withdraw_input_card_exact.png", 899, "请输入卡号"),
        ("密码", "wallet_withdraw_input_password_exact.png", 998, "请输入交易密码"),
    )
    for name, asset, top_px, placeholder in default_rows:
        p.set_active(p.node(f"钱包/容器/提现/提现选项/{name}"), True)
        style_editbox(p, f"钱包/容器/提现/提现选项/{name}",
                      asset, top_px, placeholder)
        # Static label/icon already exists in the accepted row bitmap.
        for ref in p.data[p.node(f"钱包/容器/提现/提现选项/{name}")].get("_children", []):
            child = ref["__id__"]
            child_name = p.data[child].get("_name")
            if child_name not in ("input", "只读", "银行"):
                p.set_active(child, False)

    # Alternate payout fields retain the same approved card material and real
    # input behavior; they occupy the same vertical slots used by each mode.
    alternate_rows = (
        ("支付宝", 802, "请输入支付宝账号"),
        ("支行", 899, "请输入支行"),
        ("RMB金额", 604, "请输入RMB金额"),
        ("USDT数量", 703, "请输入USDT数量"),
        ("TRC20地址", 802, "请输入TRC20地址"),
    )
    for name, top_px, placeholder in alternate_rows:
        p.set_active(p.node(f"钱包/容器/提现/提现选项/{name}"), False)
        style_editbox(p, f"钱包/容器/提现/提现选项/{name}",
                      "wallet_withdraw_input_generic_exact.png", top_px, placeholder)

    # The rate row is data-only in USDT mode; keep it above the converted inputs.
    rate = p.node("钱包/容器/提现/提现选项/汇率")
    p.set_active(rate, False)
    page_top(p, rate, 576, 602, 42)
    style_label(p, "钱包/容器/提现/提现选项/汇率/txt copy",
                x=-100, y=0, width=180, height=42, size=23,
                preview="当前汇率", align=1)
    style_label(p, "钱包/容器/提现/提现选项/汇率/txt",
                x=100, y=0, width=180, height=42, size=23,
                preview="1", align=1)

    notice = p.node("钱包/容器/提现/提现选项/提现文本")
    p.set_active(notice, True)
    page_bottom(p, notice, 185, 620, 48)
    style_label(p, "钱包/容器/提现/提现选项/提现文本",
                x=0, y=p.data[notice]["_trs"]["array"][1],
                width=620, height=48, size=23,
                preview="请核对提现信息，提交后不可修改。", align=1)
    p.data[notice]["_color"] = copy.deepcopy(GOLD)

    submit = p.node("钱包/容器/提现/提现选项/申请提现")
    p.art(submit, "wallet_withdraw_submit_exact.png", 0, 0, 590, 100,
          hide=True)
    untint(p, submit)
    page_bottom(p, submit, 78, 590, 100)
    for name in ("null", "充值提示按钮", "null copy"):
        for ref in p.data[options].get("_children", []):
            child = ref["__id__"]
            if p.data[child].get("_name") == name:
                p.set_active(child, False)


def style_record(p: Prefab) -> None:
    page = p.node("钱包/容器/记录")
    full_widget(p, page, 750, PAGE_H)

    listing = p.node("钱包/容器/记录/列表")
    p.sprite(listing, "wallet_record_panel_exact.png", sliced=True)
    untint(p, listing)
    page_stretch(p, listing, 223, 128, 54, 54)

    header = p.node("钱包/容器/记录/标题")
    p.art(header, "wallet_record_header_exact.png", 0, 0, 604, 70,
          hide=True)
    untint(p, header)
    page_top(p, header, 264, 604, 70)

    # The legacy order placed the stretchable list after the header, so its
    # opaque panel covered the table title.  Keep the panel at the back and
    # both fixed overlays above it in the serialized Prefab draw order.
    page_children = p.data[page].setdefault("_children", [])
    overlay_ids = (listing, header)
    page_children[:] = [ref for ref in page_children
                        if ref.get("__id__") not in overlay_ids]
    page_children.insert(0, {"__id__": listing})
    page_children.append({"__id__": header})

    view = p.node("钱包/容器/记录/列表/view")
    p.set_pos(view, 0, 0, 610, 691)
    view_widget = ensure_widget(p, view)
    view_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 16, "_right": 16, "_top": 126, "_bottom": 166,
        "_originalWidth": 610, "_originalHeight": 691,
    })
    content = p.node("钱包/容器/记录/列表/view/content")
    p.data[content]["_contentSize"]["width"] = 610
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0,
        "_originalWidth": 610,
    })
    _, layout = p.component(content, "cc.Layout")
    layout["_N$paddingTop"] = 0
    layout["_N$paddingBottom"] = 0
    layout["_N$spacingY"] = 18

    pagination = p.node("钱包/容器/记录/分页")
    p.art(pagination, "wallet_record_pagination_exact.png", 0, 0, 604, 112)
    untint(p, pagination)
    p.disable(pagination, "cc.Layout")
    page_bottom(p, pagination, 151, 604, 112)
    for name, x in (("首页", -228), ("上一页", -122),
                    ("下一页", 122), ("尾页", 228)):
        button = p.node(f"钱包/容器/记录/分页/{name}")
        p.set_pos(button, x, 0, 74, 74, disable_widget=True)
        p.hide_children(button)
    style_label(p, "钱包/容器/记录/分页/页码",
                x=0, y=0, width=118, height=52, size=31,
                preview="1/3", align=1)
    p.data[p.node("钱包/容器/记录/分页/页码")]["_color"] = copy.deepcopy(GOLD)


def apply_wallet() -> None:
    p = Prefab("assets/resources/Prefabs/钱包.prefab")
    full_widget(p, p.root, 750, BASE_H)
    background = p.node("钱包/bk")
    p.art(background, "wallet_bg_exact.png", 0, 0, 750, 1800)
    untint(p, background)
    root_top(p, background, 0, 750, 1800)

    title = p.node("钱包/Title")
    p.art(title, "wallet_header_exact.png", 0, 0, 750, 84)
    untint(p, title)
    root_top(p, title, 0, 750, 84, stretch_x=True)
    p.art(p.node("钱包/Title/客服"), "transparent.png", 0, 0, 200, 84,
          hide=True)
    p.set_pos(p.node("钱包/Title/客服"), 273, 0, 200, 84)
    p.art(p.node("钱包/Title/关闭"), "transparent.png", 0, 0, 120, 84,
          hide=True)
    p.set_pos(p.node("钱包/Title/关闭"), -315, 0, 120, 84)
    p.set_active(p.node("钱包/Title/钱包"), False)

    style_tab_bar(p)
    container = p.node("钱包/容器")
    p.set_pos(container, 0, -PAGE_TOP / 2, 750, PAGE_H)
    widget = ensure_widget(p, container)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": PAGE_TOP, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": PAGE_H,
    })
    style_recharge(p)
    style_withdraw(p)
    style_record(p)
    apply_channel_selection(p)
    p.save()


def apply_record_row() -> None:
    p = Prefab("assets/resources/Prefabs/交易查询对象.prefab")
    p.set_pos(p.root, 0, -60.5, 610, 121, disable_widget=True)
    p.sprite(p.root, "wallet_record_row_exact.png")
    untint(p, p.root)

    style_label(p, "交易查询对象/type", x=-204, y=0,
                width=120, height=48, size=24,
                preview="充值", align=0)
    style_label(p, "交易查询对象/count", x=-72, y=0,
                width=145, height=48, size=25,
                preview="+500.00", align=1)
    style_label(p, "交易查询对象/time", x=95, y=0,
                width=190, height=48, size=23,
                preview="09/04 18:26", align=1)
    style_label(p, "交易查询对象/状态文字", x=244, y=0,
                width=125, height=48, size=24,
                preview="已完成", align=1)
    for path in ("交易查询对象/id", "交易查询对象/txt",
                 "交易查询对象/line", "交易查询对象/状态",
                 "交易查询对象/生成订单"):
        p.set_active(p.node(path), False)

    icon_in = ensure_art(p, p.root, "交易查询对象/V7充值图标",
                         source_path="交易查询对象/状态")
    p.art(icon_in, "wallet_record_icon_in_exact.png", -270, 0, 52, 54,
          hide=True)
    untint(p, icon_in)
    icon_out = ensure_art(p, p.root, "交易查询对象/V7提现图标",
                          source_path="交易查询对象/状态")
    p.art(icon_out, "wallet_record_icon_out_exact.png", -270, 0, 52, 53,
          hide=True)
    untint(p, icon_out)
    p.set_active(icon_out, False)
    p.save()


def main() -> None:
    apply_wallet()
    apply_record_row()
    print("已把钱包充值、提现、记录确认稿写入钱包及交易记录Prefab。")


if __name__ == "__main__":
    main()
