#!/usr/bin/env python3
"""Serialize the approved V7 gift composition into the Cocos Prefabs."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import bottom, ensure_widget, stretch, top


PLACEHOLDER = {"__type__": "cc.Color", "r": 169, "g": 157, "b": 151, "a": 255}
GREEN = {"__type__": "cc.Color", "r": 55, "g": 220, "b": 47, "a": 255}


def fill_parent(p: Prefab, node_id: int, width: float, height: float) -> None:
    p.set_pos(node_id, 0, 0, width, height)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def style_editbox(p: Prefab, path: str, asset: str, *,
                  y: float,
                  placeholder_x: float, text_x: float,
                  placeholder: str, max_length: int,
                  input_mode: int, password: bool = False) -> None:
    field = p.node(path)
    p.set_active(field, True)
    try:
        background = p.node(path + "/BACKGROUND_SPRITE")
        p.set_pos(field, 0, y, 660, 82)
        p.art(background, asset, 0, 0, 660, 82)
    except KeyError:
        # Creator 2.4会把EditBox背景规范化为输入节点之前的同级Sprite；
        # 保留它生成的真实输入热区，只重新写入整行确认稿背景。
        parent = p.data[field]["_parent"]["__id__"]
        siblings = [ref["__id__"] for ref in p.data[parent].get("_children", [])]
        index = siblings.index(field)
        background = next(
            node_id for node_id in reversed(siblings[:index])
            if p.data[node_id].get("_name") == "BACKGROUND_SPRITE"
        )
        field_x = p.data[field]["_trs"]["array"][0]
        field_width = p.data[field]["_contentSize"]["width"]
        p.set_pos(field, field_x, y, field_width, 82)
        p.art(background, asset, 0, y, 660, 82)
    untint(p, background)

    for suffix, x, preview, color in (
        ("TEXT_LABEL", text_x, None, None),
        ("PLACEHOLDER_LABEL", placeholder_x, placeholder, PLACEHOLDER),
    ):
        node_id = p.node(path + "/" + suffix)
        p.set_active(node_id, True)
        p.disable(node_id, "cc.Widget")
        style_label(p, path + "/" + suffix, x=x, y=18,
                    width=390, height=44, size=21,
                    preview=preview, align=0)
        if color is not None:
            p.data[node_id]["_color"] = copy.deepcopy(color)
        _, outline = p.component(node_id, "cc.LabelOutline")
        if outline is not None:
            outline["_enabled"] = False

    _, edit = p.component(field, "cc.EditBox")
    edit["maxLength"] = max_length
    edit["_N$inputMode"] = input_mode
    edit["_N$inputFlag"] = 0 if password else 5


def import_avatar_subtree(p: Prefab, parent_id: int) -> int:
    """Copy the project's existing circular avatar/mask structure into a row."""
    source = Prefab("assets/resources/Prefabs/头像.prefab")
    ids: set[int] = set()

    def collect(node_id: int) -> None:
        if node_id in ids:
            return
        ids.add(node_id)
        node = source.data[node_id]
        for ref in node.get("_components", []):
            ids.add(ref["__id__"])
        if isinstance(node.get("_prefab"), dict):
            ids.add(node["_prefab"]["__id__"])
        for ref in node.get("_children", []):
            collect(ref["__id__"])

    collect(source.root)
    mapping = {old: len(p.data) + offset for offset, old in enumerate(sorted(ids))}

    def remap(value):
        if isinstance(value, dict):
            if set(value) == {"__id__"} and value["__id__"] in mapping:
                return {"__id__": mapping[value["__id__"]]}
            return {key: remap(item) for key, item in value.items()}
        if isinstance(value, list):
            return [remap(item) for item in value]
        return value

    for old in sorted(ids):
        p.data.append(remap(copy.deepcopy(source.data[old])))
    avatar = mapping[source.root]
    p.data[avatar]["_parent"] = {"__id__": parent_id}
    p.data[avatar]["_name"] = "头像"
    p.data[parent_id].setdefault("_children", []).append({"__id__": avatar})
    return avatar


def apply_page() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    give = p.node("赠送")
    p.sprite(give, "gift_bg_exact.png")
    untint(p, give)

    header = p.node("赠送/title")
    p.art(header, "gift_header_exact.png", 0, 0, 750, 81, hide=True)
    untint(p, header)
    top(p, "赠送/title", 0, width=750, height=81, stretch_x=True)

    hero = p.node("赠送/V7赠送主视觉")
    p.art(hero, "gift_hero_exact.png", 0, 0, 750, 300, hide=True)
    untint(p, hero)
    top(p, "赠送/V7赠送主视觉", 81, width=750, height=300)

    operation = p.node("赠送/操作")
    top(p, "赠送/操作", 380, width=750, height=378, stretch_x=True)
    p.set_active(p.node("赠送/操作/垫底长"), False)
    field_specs = (
        ("用户id", "gift_input_id_exact.png", 148, -158, -158,
         "请输入对方ID", 6, 2, False),
        ("金额", "gift_input_amount_exact.png", 51, -71, -71,
         "请输入赠送金额", 12, 3, False),
        ("V7交易密码", "gift_input_password_exact.png", -46, -71, -71,
         "请输入交易密码", 8, 2, True),
    )
    for name, asset, y, placeholder_x, text_x, placeholder, max_len, mode, secret in field_specs:
        style_editbox(p, "赠送/操作/" + name, asset,
                      y=y,
                      placeholder_x=placeholder_x, text_x=text_x,
                      placeholder=placeholder, max_length=max_len,
                      input_mode=mode, password=secret)

    confirm = p.node("赠送/操作/提交赠送")
    p.art(confirm, "gift_confirm_exact.png", 0, -148, 414, 84, hide=True)
    untint(p, confirm)

    history = p.node("赠送/标题")
    p.art(history, "gift_history_header_exact.png", 0, 0, 708, 106, hide=True)
    untint(p, history)
    top(p, "赠送/标题", 784, width=708, height=106)
    p.set_active(p.node("赠送/V7赠送记录标题"), False)

    record_list = p.node("赠送/赠送记录列表")
    p.sprite(record_list, "gift_list_panel_exact.png", sliced=True)
    untint(p, record_list)
    stretch(p, "赠送/赠送记录列表", 890, 167, left=21, right=21)
    view = p.node("赠送/赠送记录列表/view")
    fill_parent(p, view, 708, 277)
    content = p.node("赠送/赠送记录列表/view/content")
    p.data[content]["_contentSize"]["width"] = 708
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0,
        "_originalWidth": 708,
    })
    _, layout = p.component(content, "cc.Layout")
    layout["_N$paddingTop"] = 0
    layout["_N$paddingBottom"] = 0
    layout["_N$spacingY"] = 0

    pagination = p.node("赠送/分页")
    p.art(pagination, "gift_pagination_exact.png", 0, 0, 708, 107)
    untint(p, pagination)
    p.disable(pagination, "cc.Layout")
    bottom(p, "赠送/分页", 59, width=708, height=107)
    page_positions = {
        "首页": -272, "上一页": -158, "下一页": 150, "尾页": 265,
    }
    for name, x in page_positions.items():
        button = p.node("赠送/分页/" + name)
        p.set_active(button, True)
        p.set_pos(button, x, -4, 78, 78)
        p.hide_children(button)
    style_label(p, "赠送/分页/页码", x=0, y=-5,
                width=150, height=52, size=31,
                preview="1/2", align=1)

    p.save()


def apply_row() -> None:
    p = Prefab("assets/resources/Prefabs/赠送记录对象.prefab")
    p.art(p.root, "gift_record_row_exact.png", 0, -46, 706, 93)
    untint(p, p.root)
    p.disable(p.root, "cc.Widget")
    p.set_active(p.node("line"), False)

    style_label(p, "type", x=-275, y=0, width=92, height=38,
                size=23, preview="赠送", align=1)
    p.data[p.node("type")]["_color"] = copy.deepcopy(GREEN)
    style_label(p, "id", x=-122, y=1, width=245, height=62,
                size=21, preview="小小羊\nID:659348", align=0)
    style_label(p, "count", x=86, y=0, width=105, height=42,
                size=27, preview="88", align=1)
    style_label(p, "time", x=258, y=0, width=190, height=42,
                size=21, preview="08/17 22:31", align=1)

    try:
        avatar = p.node("头像")
    except KeyError:
        avatar = import_avatar_subtree(p, p.root)
    p.set_active(avatar, True)
    p.art(avatar, "gift_avatar_ring_exact.png", -169, 0, 70, 70)
    untint(p, avatar)
    p.disable(avatar, "cc.Button")
    mask = p.node("头像/mask")
    p.set_pos(mask, 0, 0, 64, 64)
    _, mask_comp = p.component(mask, "cc.Mask")
    mask_comp["_type"] = 1
    mask_comp["_segments"] = 96
    image = p.node("头像/mask/img")
    p.set_pos(image, 0, 0, 64, 64)
    image_widget = ensure_widget(p, image)
    image_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 64, "_originalHeight": 64,
    })
    p.save()


def main() -> None:
    apply_page()
    apply_row()
    print("已把赠送确认稿精确写入页面和赠送记录行Prefab。")


if __name__ == "__main__":
    main()
