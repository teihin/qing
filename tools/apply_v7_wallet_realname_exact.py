#!/usr/bin/env python3
"""Serialize the accepted wallet real-name design into 钱包.prefab.

This is an editor-time Prefab migration.  Runtime TypeScript keeps only the
existing validation, bank selection and submit behavior.
"""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import BASE_H, center_anchor, ensure_art, full_widget, root_top, transparent
from repair_v7_responsive_layout import ensure_widget


GOLD = {"__type__": "cc.Color", "r": 231, "g": 197, "b": 145, "a": 255}
PLACEHOLDER = {"__type__": "cc.Color", "r": 182, "g": 180, "b": 177, "a": 255}


def fixed_top(p: Prefab, node_id: int, top_px: float, width: float,
              height: float, x: float = 0) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, x, BASE_H / 2 - top_px - height / 2, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 17,
        "_top": top_px, "_horizontalCenter": x,
        "_originalWidth": width, "_originalHeight": height,
    })


def style_input(p: Prefab, row_path: str, asset: str,
                screen_top: float, placeholder: str) -> None:
    row = p.node(row_path)
    p.sprite(row, asset)
    untint(p, row)
    fixed_top(p, row, screen_top, 602, 78)

    edit_path = row_path + "/input"
    edit = p.node(edit_path)
    center_anchor(p, edit)
    p.disable(edit, "cc.Widget")
    p.set_pos(edit, 125, 0, 360, 70)

    bg = p.node(edit_path + "/BACKGROUND_SPRITE")
    center_anchor(p, bg)
    p.disable(bg, "cc.Widget")
    transparent(p, bg, 360, 70)

    for suffix, color, preview in (
        ("TEXT_LABEL", GOLD, None),
        ("PLACEHOLDER_LABEL", PLACEHOLDER, placeholder),
    ):
        path = edit_path + "/" + suffix
        node = p.node(path)
        p.set_active(node, True)
        center_anchor(p, node)
        p.disable(node, "cc.Widget")
        style_label(p, path, x=0, y=0, width=350, height=54,
                    size=28, preview=preview, align=0)
        p.data[node]["_color"] = copy.deepcopy(color)
        p.data[node]["_opacity"] = 255
        _, outline = p.component(node, "cc.LabelOutline")
        if outline is not None:
            outline["_enabled"] = False


def move_to_back(p: Prefab, parent_id: int, node_id: int) -> None:
    children = p.data[parent_id].setdefault("_children", [])
    children[:] = [ref for ref in children if ref.get("__id__") != node_id]
    children.insert(0, {"__id__": node_id})


def apply_realname() -> None:
    p = Prefab("assets/resources/Prefabs/钱包.prefab")
    page = p.node("钱包/实名")
    full_widget(p, page, 750, BASE_H)

    background = p.node("钱包/实名/bk")
    p.art(background, "wallet_bg_exact.png", 0, 0, 750, 1800)
    untint(p, background)
    root_top(p, background, 0, 750, 1800)

    title = p.node("钱包/实名/Title")
    p.art(title, "wallet_realname_header_exact.png", 0, 0, 750, 83)
    untint(p, title)
    root_top(p, title, 0, 750, 83, stretch_x=True)
    p.set_active(p.node("钱包/实名/Title/客服"), False)
    p.set_active(p.node("钱包/实名/Title/钱包"), False)
    close = p.node("钱包/实名/Title/关闭")
    p.set_active(close, True)
    transparent(p, close, 122, 83, hide_children=True)
    p.set_pos(close, -314, 0, 122, 83, disable_widget=True)

    info = p.node("钱包/实名/信息")
    full_widget(p, info, 750, BASE_H)
    p.disable(info, "cc.Layout")

    form = ensure_art(p, info, "钱包/实名/信息/V7实名表单底",
                      source_path="钱包/实名/信息/钱包-实名认证", first=True)
    p.sprite(form, "wallet_realname_form_panel_exact.png", sliced=True)
    untint(p, form)
    fixed_top(p, form, 385, 642, 490)
    move_to_back(p, info, form)

    shield = p.node("钱包/实名/信息/钱包-实名认证")
    p.art(shield, "wallet_realname_shield_exact.png", 0, 0, 142, 149, hide=True)
    untint(p, shield)
    fixed_top(p, shield, 104, 142, 149)

    hero_title = ensure_art(p, info, "钱包/实名/信息/V7实名主标题",
                            source_path="钱包/实名/信息/钱包-实名认证")
    p.art(hero_title, "wallet_realname_hero_title_exact.png", 0, 0, 540, 68,
          hide=True)
    untint(p, hero_title)
    fixed_top(p, hero_title, 261, 540, 68)

    hero_subtitle = ensure_art(p, info, "钱包/实名/信息/V7实名副标题",
                               source_path="钱包/实名/信息/钱包-实名认证")
    p.art(hero_subtitle, "wallet_realname_hero_subtitle_exact.png", 0, 0,
          500, 48, hide=True)
    untint(p, hero_subtitle)
    fixed_top(p, hero_subtitle, 327, 500, 48)

    rows = (
        ("姓名", "wallet_realname_row_name_exact.png", 401, "请输入姓名"),
        ("银行", "wallet_realname_row_bank_exact.png", 493, "请输入银行"),
        ("卡号", "wallet_realname_row_card_exact.png", 585, "请输入卡号"),
        ("交易密码", "wallet_realname_row_password_exact.png", 677, "请输入交易密码"),
        ("确认密码", "wallet_realname_row_confirm_exact.png", 769, "请确认交易密码"),
    )
    for name, asset, top_px, placeholder in rows:
        row_path = f"钱包/实名/信息/{name}"
        style_input(p, row_path, asset, top_px, placeholder)

    # Labels/icons are already part of each exact row bitmap.  Keep only the
    # live EditBox and the existing bank selection hit area above the art.
    p.set_active(p.node("钱包/实名/信息/姓名/姓名"), False)
    p.set_active(p.node("钱包/实名/信息/卡号/银行卡号"), False)
    p.set_active(p.node("钱包/实名/信息/交易密码/img"), False)
    p.set_active(p.node("钱包/实名/信息/确认密码/img"), False)
    p.set_active(p.node("钱包/实名/信息/银行/银行名称"), False)
    bank_hit = p.node("钱包/实名/信息/银行/银行")
    p.set_active(bank_hit, True)
    transparent(p, bank_hit, 602, 78, hide_children=True)
    p.set_pos(bank_hit, 0, 0, 602, 78, disable_widget=True)

    submit = p.node("钱包/实名/信息/提交实名信息")
    p.art(submit, "wallet_realname_submit_exact.png", 0, 0, 430, 82,
          hide=True)
    untint(p, submit)
    fixed_top(p, submit, 887, 430, 82)

    warning = ensure_art(p, info, "钱包/实名/信息/V7实名重要提示",
                         source_path="钱包/实名/信息/钱包-实名认证")
    p.art(warning, "wallet_realname_warning_exact.png", 0, 0, 614, 300,
          hide=True)
    untint(p, warning)
    fixed_top(p, warning, 997, 614, 300)

    # The approved warning copy is static in the exact warning asset.  Keep
    # the old dynamic/default nodes serialized but hidden so business paths
    # are not deleted and a later product decision can restore them safely.
    p.set_active(p.node("钱包/实名/信息/实名文本"), False)
    p.set_active(p.node("钱包/实名/信息/null copy"), False)
    for ref in p.data[info].get("_children", []):
        child = ref["__id__"]
        if p.data[child].get("_name") == "New Node":
            p.set_active(child, False)

    style_bank_picker(p, "钱包/选择银行")
    p.save()
    print("已把钱包首次实名认证确认稿写入 钱包.prefab。")


def style_bank_picker(p: Prefab, root_path: str) -> None:
    overlay = p.node(root_path)
    full_widget(p, overlay, 750, BASE_H)

    mask = p.node(root_path + "/mask")
    full_widget(p, mask, 750, BASE_H)
    p.data[mask]["_color"] = {
        "__type__": "cc.Color", "r": 0, "g": 7, "b": 16, "a": 255,
    }
    p.data[mask]["_opacity"] = 190

    panel = p.node(root_path + "/bk")
    p.art(panel, "wallet_bank_picker_panel_exact.png", 0, 0, 646, 920)
    untint(p, panel)
    center_anchor(p, panel)
    p.disable(panel, "cc.Widget")
    p.set_pos(panel, 0, 0, 646, 920, disable_widget=True)

    listing = p.node(root_path + "/bk/列表")
    center_anchor(p, listing)
    p.disable(listing, "cc.Widget")
    p.set_pos(listing, 0, -50, 580, 760, disable_widget=True)
    view = p.node(root_path + "/bk/列表/view")
    center_anchor(p, view)
    p.disable(view, "cc.Widget")
    p.set_pos(view, 0, 0, 580, 760, disable_widget=True)
    content = p.node(root_path + "/bk/列表/view/content")
    p.disable(content, "cc.Widget")
    p.set_pos(content, 0, 380, 560, 90, disable_widget=True)
    _, layout = p.component(content, "cc.Layout")
    if layout is not None:
        layout["_layoutSize"] = {"__type__": "cc.Size", "width": 560, "height": 90}
        layout["_N$paddingTop"] = 10
        layout["_N$paddingBottom"] = 10
        layout["_N$spacingY"] = 10

    close = p.node(root_path + "/bk/关闭上上层")
    p.set_active(close, True)
    p.set_pos(close, 280, 418, 68, 68, disable_widget=True)
    close_art = p.node(root_path + "/bk/关闭上上层/btn_4")
    p.art(close_art, "popup_close_exact.png", 0, 0, 58, 58, hide=True)
    untint(p, close_art)


def style_bank_row() -> None:
    p = Prefab("assets/resources/Prefabs/银行对象.prefab")
    p.art(p.root, "wallet_bank_picker_row_exact.png", 0, 0, 560, 78)
    untint(p, p.root)
    label = p.node("银行对象/txt")
    style_label(p, "银行对象/txt", x=8, y=0, width=370, height=52,
                size=28, preview="-", align=0)
    p.data[label]["_color"] = copy.deepcopy(GOLD)
    _, outline = p.component(label, "cc.LabelOutline")
    if outline is not None:
        outline["_enabled"] = False
    p.set_active(p.node("银行对象/right"), False)
    p.save()


if __name__ == "__main__":
    apply_realname()
    style_bank_row()
