#!/usr/bin/env python3
"""Serialize the approved V7 quick-registration modal into panelLogin.prefab.

This is an editor-time Prefab migration.  It keeps all established node names,
EditBoxes, Toggles, Buttons and dynamic avatar Sprite bindings intact; only
formal artwork references, sizes, anchors and label styling are changed.
"""

from __future__ import annotations

import copy

from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import ensure_widget


WHITE = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
GOLD = {"__type__": "cc.Color", "r": 236, "g": 202, "b": 149, "a": 255}
GOLD_HI = {"__type__": "cc.Color", "r": 249, "g": 226, "b": 181, "a": 255}
COOL = {"__type__": "cc.Color", "r": 191, "g": 203, "b": 209, "a": 255}
MASK = {"__type__": "cc.Color", "r": 0, "g": 9, "b": 18, "a": 255}
BASE_DIALOG_W = 583
BASE_DIALOG_H = 1035


def untint(p: Prefab, node_id: int) -> None:
    p.data[node_id]["_color"] = copy.deepcopy(WHITE)
    p.data[node_id]["_opacity"] = 255


def center_anchor(p: Prefab, node_id: int) -> None:
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


def centered_widget(p: Prefab, node_id: int, width: float, height: float) -> None:
    center_anchor(p, node_id)
    p.set_pos(node_id, 0, 0, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 18,
        "_horizontalCenter": 0, "_verticalCenter": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def set_label(
    p: Prefab,
    path: str,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    size: int,
    color=GOLD,
    align: int = 1,
    overflow: int = 2,
) -> None:
    node_id = p.node(path)
    p.set_pos(node_id, x, y, width, height, disable_widget=True)
    p.data[node_id]["_color"] = copy.deepcopy(color)
    _, label = p.component(node_id, "cc.Label")
    if label is not None:
        label["_fontSize"] = size
        label["_lineHeight"] = size + 6
        label["_N$horizontalAlign"] = align
        label["_N$verticalAlign"] = 1
        label["_N$overflow"] = overflow
    _, outline = p.component(node_id, "cc.LabelOutline")
    if outline is not None:
        outline["_enabled"] = False


def ensure_art(p: Prefab, parent_id: int, path: str, name: str) -> int:
    try:
        node_id = p.node(path)
    except KeyError:
        source = p.node("注册弹窗/注册资料框/关闭注册/关闭图标")
        node_id = p.clone_subtree(source, parent_id, name)
    p.set_active(node_id, True)
    return node_id


def ensure_label_node(p: Prefab, parent_id: int, path: str, name: str) -> int:
    try:
        node_id = p.node(path)
    except KeyError:
        source = p.node("注册弹窗/头像选择弹窗/头像选择框/头像弹窗标题")
        node_id = p.clone_subtree(source, parent_id, name)
    p.set_active(node_id, True)
    return node_id


def editbox_component(p: Prefab, node_id: int):
    """Return native EditBox or the project's password EditBox subclass."""
    component_id, component = p.component(node_id, "cc.EditBox")
    if component is not None:
        return component_id, component
    for ref in p.data[node_id].get("_components", []):
        candidate = p.data[ref["__id__"]]
        if "_N$textLabel" in candidate and "_N$placeholderLabel" in candidate:
            return ref["__id__"], candidate
    return None, None


def set_input(p: Prefab, row_path: str) -> None:
    edit_path = row_path + "/输入"
    edit_id = p.node(edit_path)
    p.set_pos(edit_id, 96, 0, 310, 66, disable_widget=True)
    _, edit = editbox_component(p, edit_id)
    if edit is not None:
        edit["_N$fontSize"] = 22
        edit["_N$lineHeight"] = 29
        edit["_N$fontColor"] = copy.deepcopy(GOLD_HI)
        edit["_N$placeholderFontColor"] = copy.deepcopy(COOL)
        # The accepted full-panel crop already contains the exact empty-state
        # placeholder lettering.  Native placeholder text would draw a second
        # copy over it; keep only the live TEXT_LABEL for actual user input.
        edit["_N$placeholder"] = ""

    for child, color in (("TEXT_LABEL", GOLD_HI), ("PLACEHOLDER_LABEL", COOL)):
        set_label(
            p, edit_path + "/" + child,
            # Cocos EditBox labels use a left/top anchor.  Their origin must
            # therefore be the EditBox's top-left, not its center.
            x=-155, y=33, width=310, height=66, size=22,
            color=color, align=0, overflow=1,
        )
    placeholder_id = p.node(edit_path + "/PLACEHOLDER_LABEL")
    p.set_active(placeholder_id, False)
    _, placeholder = p.component(placeholder_id, "cc.Label")
    if placeholder is not None:
        placeholder["_enabled"] = False
        placeholder["_string"] = ""
        placeholder["_N$string"] = ""


def style_main_dialog(p: Prefab) -> None:
    popup = p.node("注册弹窗")
    mask = p.node("注册弹窗/遮罩")
    dialog = p.node("注册弹窗/注册资料框")
    full_widget(p, popup, 750, 1334)
    full_widget(p, mask, 750, 1334)
    p.data[mask]["_color"] = copy.deepcopy(MASK)
    p.data[mask]["_opacity"] = 198

    # The accepted dialog is a fixed composition.  Scale it uniformly from the
    # 941 px effect image to the 750 logical-width game and center the complete
    # block on every phone.  Tall screens add space outside the dialog only;
    # they must never stretch its internal spacing or leather pattern.
    centered_widget(p, dialog, BASE_DIALOG_W, BASE_DIALOG_H)
    p.sprite(dialog, "register_modal_panel_exact.png", sliced=False)
    untint(p, dialog)

    logo = p.node("注册弹窗/注册资料框/8L徽标")
    p.set_active(logo, False)

    title = p.node("注册弹窗/注册资料框/注册标题")
    p.set_active(title, False)
    title_art = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册标题美术", "V7注册标题美术"
    )
    p.art(title_art, "register_title_exact.png", 0, 425, 330, 58)
    p.set_active(title_art, False)

    subtitle = p.node("注册弹窗/注册资料框/注册副标题")
    p.set_active(subtitle, False)
    subtitle_art = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册副标题美术", "V7注册副标题美术"
    )
    p.art(subtitle_art, "register_subtitle_exact.png", 0, 388, 350, 31)
    p.set_active(subtitle_art, False)
    rule = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册标题分隔", "V7注册标题分隔"
    )
    p.art(rule, "register_header_rule_exact.png", 0, 365, 335, 19)
    p.set_active(rule, False)

    close = p.node("注册弹窗/注册资料框/关闭注册")
    p.set_pos(close, 247, 478, 60, 60)
    close_icon = p.node("注册弹窗/注册资料框/关闭注册/关闭图标")
    p.art(close_icon, "register_close_exact.png", 0, 0, 56, 56)
    p.set_active(close_icon, False)

    avatar_group = p.node("注册弹窗/注册资料框/头像选择")
    p.set_pos(avatar_group, 0, 254, 540, 205)
    avatar = p.node("注册弹窗/注册资料框/头像选择/头像预览")
    # Fill through the transparent inner edge of the direct-cut ring.  The
    # small overlap is hidden by the ring and prevents the baked reference
    # avatar in the full-panel artwork from leaking around live avatars.
    p.set_pos(avatar, 0, 0, 174, 174, disable_widget=True)
    untint(p, avatar)
    ring = ensure_art(
        p, avatar_group, "注册弹窗/注册资料框/头像选择/V7头像圆环", "V7头像圆环"
    )
    p.art(ring, "register_avatar_ring_exact.png", 0, 0, 180, 180)
    untint(p, ring)

    for name, x, glyph in (("上一头像", -140, "‹"), ("下一头像", 140, "›")):
        button_path = f"注册弹窗/注册资料框/头像选择/{name}"
        button = p.node(button_path)
        p.set_active(button, True)
        p.set_pos(button, x, 2, 52, 62, disable_widget=True)
        p.set_active(p.node(button_path + "/箭头"), False)
        art_path = button_path + "/V7头像箭头美术"
        arrow_art = ensure_art(p, button, art_path, "V7头像箭头美术")
        p.art(
            arrow_art,
            "register_arrow_left_exact.png" if glyph == "‹" else "register_arrow_right_exact.png",
            0, 0, 46, 52,
        )
        p.set_active(arrow_art, False)

    avatar_prompt = p.node("注册弹窗/注册资料框/头像选择/头像序号")
    p.set_active(avatar_prompt, False)
    avatar_prompt_art = ensure_art(
        p, avatar_group,
        "注册弹窗/注册资料框/头像选择/V7头像提示美术",
        "V7头像提示美术",
    )
    p.art(avatar_prompt_art, "register_avatar_prompt_exact.png", 0, -100, 190, 40)
    p.set_active(avatar_prompt_art, False)

    row_specs = (
        ("邀请码", "register_row_invite_exact.png", 98),
        ("昵称", "register_row_nickname_exact.png", 21),
        ("账号", "register_row_account_exact.png", -56),
        ("密码", "register_row_password_exact.png", -133),
        ("确认密码", "register_row_confirm_exact.png", -210),
    )
    for name, asset, y in row_specs:
        path = "注册弹窗/注册资料框/" + name
        row = p.node(path)
        p.art(row, asset, 0, y, 540, 70)
        untint(p, row)
        # The full accepted panel already contains the exact empty-state row,
        # including its art lettering.  Keep this clean dynamic layer authored
        # in the Prefab but disabled until the user focuses or fills the field.
        _, row_sprite = p.component(row, "cc.Sprite")
        if row_sprite is not None:
            row_sprite["_enabled"] = False
        p.set_active(p.node(path + "/字段名称"), False)
        p.set_active(p.node(path + "/分割线"), False)
        set_input(p, path)

    anti_path = "注册弹窗/注册资料框/防盗号"
    anti = p.node(anti_path)
    p.art(anti, "register_anti_theft_exact.png", 0, -287, 540, 74)
    untint(p, anti)
    for child in ("防盗号文字", "防盗号说明"):
        p.set_active(p.node(anti_path + "/" + child), False)
    toggle = p.node(anti_path + "/防盗号开关")
    p.set_pos(toggle, 212, 0, 87, 45, disable_widget=True)
    p.art(p.node(anti_path + "/防盗号开关/Background"),
          "register_toggle_off_exact.png", 0, 0, 87, 45)
    check = p.node(anti_path + "/防盗号开关/checkmark")
    p.art(check, "register_toggle_on_exact.png", 0, 0, 87, 45)
    p.data[check]["_opacity"] = 255
    untint(p, p.node(anti_path + "/防盗号开关/Background"))
    untint(p, check)

    set_label(
        p, "注册弹窗/注册资料框/注册状态",
        x=22, y=-355, width=410, height=32, size=20,
        color=GOLD_HI, align=1, overflow=1,
    )
    status = p.node("注册弹窗/注册资料框/注册状态")
    p.set_active(status, False)
    status_bg = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册动态状态底", "V7注册动态状态底"
    )
    # Keep a real gap above the submit button.  The previous 47 px strip
    # reached 1.5 logical pixels into its top edge and erased a segment of the
    # gold border when anti-theft status became visible.
    p.art(status_bg, "register_status_clean_exact.png", 0, -352, 447, 42)
    p.set_active(status_bg, False)
    status_icon = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册状态图标", "V7注册状态图标"
    )
    p.art(status_icon, "register_status_icon_exact.png", -122, -355, 38, 40)
    p.set_active(status_icon, False)
    # The clean status strip erases the baked default sentence only while a
    # live message is shown.  Keep it below both dynamic text and icon;
    # otherwise checking the anti-theft toggle activates an opaque blue layer
    # on top of the new sentence.
    children = p.data[dialog]["_children"]
    status_ids = (status_bg, status, status_icon)
    children[:] = [ref for ref in children if ref.get("__id__") not in status_ids]
    insert_at = next(
        (index for index, ref in enumerate(children)
         if ref.get("__id__") == p.node("注册弹窗/注册资料框/确认注册")),
        len(children),
    )
    children[insert_at:insert_at] = [
        {"__id__": status_bg}, {"__id__": status}, {"__id__": status_icon},
    ]
    submit = p.node("注册弹窗/注册资料框/确认注册")
    p.art(submit, "register_submit_exact.png", 0, -416, 540, 78)
    untint(p, submit)
    p.set_active(p.node("注册弹窗/注册资料框/确认注册/确认注册文字"), False)

    safety = p.node("注册弹窗/注册资料框/注册安全提示")
    p.set_active(safety, False)
    safety_art = ensure_art(
        p, dialog, "注册弹窗/注册资料框/V7注册安全提示美术",
        "V7注册安全提示美术",
    )
    p.art(safety_art, "register_safety_exact.png", 0, -484, 422, 48)
    p.set_active(safety_art, False)


def style_avatar_picker(p: Prefab) -> None:
    popup = p.node("注册弹窗/头像选择弹窗")
    mask = p.node("注册弹窗/头像选择弹窗/头像弹窗遮罩")
    dialog = p.node("注册弹窗/头像选择弹窗/头像选择框")
    full_widget(p, popup, 750, 1334)
    full_widget(p, mask, 750, 1334)
    p.data[mask]["_color"] = copy.deepcopy(MASK)
    p.data[mask]["_opacity"] = 215
    centered_widget(p, dialog, 650, 760)
    p.sprite(dialog, "register_avatar_picker_panel_exact.png", sliced=True)
    untint(p, dialog)

    set_label(
        p, "注册弹窗/头像选择弹窗/头像选择框/头像弹窗标题",
        x=0, y=328, width=380, height=54, size=38,
        color=GOLD_HI, align=1, overflow=2,
    )
    set_label(
        p, "注册弹窗/头像选择弹窗/头像选择框/头像弹窗副标题",
        x=0, y=280, width=460, height=36, size=22,
        color=COOL, align=1, overflow=2,
    )
    close = p.node("注册弹窗/头像选择弹窗/头像选择框/关闭头像选择")
    p.set_pos(close, 280, 323, 64, 64, disable_widget=True)
    symbol = p.node("注册弹窗/头像选择弹窗/头像选择框/关闭头像选择/关闭符号")
    p.set_active(symbol, False)
    old_close_art = "注册弹窗/头像选择弹窗/头像选择框/关闭头像选择/V7关闭头像选择图标"
    try:
        p.set_active(p.node(old_close_art), False)
    except KeyError:
        pass
    close_art = ensure_art(
        p, dialog,
        "注册弹窗/头像选择弹窗/头像选择框/V7关闭头像选择显示",
        "V7关闭头像选择显示",
    )
    p.art(close_art, "register_close_exact.png", 280, 323, 58, 58)
    untint(p, close_art)

    avatar_list = p.node("注册弹窗/头像选择弹窗/头像选择框/头像列表")
    p.set_pos(avatar_list, 0, 5, 600, 480, disable_widget=True)
    for index in range(1, 21):
        item_name = f"头像选项{index:02d}"
        item_path = f"注册弹窗/头像选择弹窗/头像选择框/头像列表/{item_name}"
        item = p.node(item_path)
        p.set_pos(item, p.data[item]["_trs"]["array"][0],
                  p.data[item]["_trs"]["array"][1], 104, 104,
                  disable_widget=True)
        untint(p, item)
        ring_path = item_path + "/V7头像选中环"
        ring = ensure_art(p, item, ring_path, "V7头像选中环")
        p.art(ring, "register_avatar_item_ring_exact.png", 0, 0, 112, 112)
        untint(p, ring)
        selected = p.node(item_path + "/选中")
        p.set_pos(selected, 34, -34, 40, 40, disable_widget=True)
        p.data[selected]["_color"] = copy.deepcopy(GOLD_HI)
        # Keep the dynamic check above the decorative ring.
        children = p.data[item].setdefault("_children", [])
        order = [ref for ref in children if ref.get("__id__") not in (ring, selected)]
        order.extend(({"__id__": ring}, {"__id__": selected}))
        p.data[item]["_children"] = order

    refresh_path = "注册弹窗/头像选择弹窗/头像选择框/换一批头像"
    refresh = p.node(refresh_path)
    p.set_active(refresh, True)
    p.set_pos(refresh, 0, -330, 300, 62, disable_widget=True)
    _, refresh_sprite = p.component(refresh, "cc.Sprite")
    if refresh_sprite is not None:
        refresh_sprite["_enabled"] = False
        refresh_sprite["_spriteFrame"] = None
    old_child = refresh_path + "/V7换一批头像美术"
    try:
        p.set_active(p.node(old_child), False)
    except KeyError:
        pass
    refresh_bg_path = "注册弹窗/头像选择弹窗/头像选择框/V7换一批头像底板"
    refresh_bg = ensure_art(p, dialog, refresh_bg_path, "V7换一批头像底板")
    p.art(refresh_bg, "register_avatar_refresh_exact.png", 0, -330, 300, 62)
    untint(p, refresh_bg)
    _, refresh_label = p.component(refresh, "cc.Label")
    if refresh_label is not None:
        refresh_label["_enabled"] = False
    old_refresh_text = refresh_path + "/V7换一批头像文字"
    try:
        p.set_active(p.node(old_refresh_text), False)
    except KeyError:
        pass
    refresh_text_path = "注册弹窗/头像选择弹窗/头像选择框/V7换一批头像文字"
    refresh_text = ensure_label_node(p, dialog, refresh_text_path, "V7换一批头像文字")
    set_label(
        p, refresh_text_path, x=0, y=-330, width=280, height=58,
        size=25, color=GOLD_HI, align=1, overflow=2,
    )
    _, refresh_text_label = p.component(refresh_text, "cc.Label")
    if refresh_text_label is not None:
        refresh_text_label["_enabled"] = True
        refresh_text_label["_string"] = "换一批头像"
        refresh_text_label["_N$string"] = "换一批头像"
    # Background sibling first, live Button/Label second.
    children = p.data[dialog].setdefault("_children", [])
    order = [ref for ref in children if ref.get("__id__") not in
             (close_art, close, refresh_bg, refresh, refresh_text)]
    order.extend((
        {"__id__": close_art}, {"__id__": close},
        {"__id__": refresh_bg}, {"__id__": refresh}, {"__id__": refresh_text},
    ))
    p.data[dialog]["_children"] = order


def apply() -> None:
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    style_main_dialog(p)
    style_avatar_picker(p)
    p.save()
    print("已把 V7 快速注册弹窗写入 panelLogin.prefab。")


if __name__ == "__main__":
    apply()
