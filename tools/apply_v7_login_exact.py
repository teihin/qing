#!/usr/bin/env python3
"""Apply the final approved V7 login composition directly to panelLogin."""

from __future__ import annotations

from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import top


GOLD = {"__type__": "cc.Color", "r": 235, "g": 207, "b": 159, "a": 255}


def sprite_child(p: Prefab, parent_path: str, name: str, asset: str) -> int:
    try:
        node_id = p.node(f"{parent_path}/{name}")
    except KeyError:
        parent_id = p.node(parent_path)
        node_id = p.clone_subtree(
            p.node(f"{parent_path}/BACKGROUND_SPRITE"),
            parent_id,
            name,
        )
    p.set_active(node_id, True)
    p.art(node_id, asset, -58, 0, 220, 54, hide=True)
    p.disable(node_id, "cc.Widget")
    return node_id


def style_edit_label(p: Prefab, path: str, *, placeholder: bool) -> None:
    node_id = p.node(path)
    node = p.data[node_id]
    node["_contentSize"]["width"] = 310
    node["_contentSize"]["height"] = 112
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0, "y": 0.5}
    node["_trs"]["array"][0:2] = [-127, 0]
    node["_color"] = dict(GOLD)
    p.disable(node_id, "cc.Widget")
    _, label = p.component(node_id, "cc.Label")
    if label is None:
        raise RuntimeError(f"登录输入文字节点不是 Label：{path}")
    label["_fontSize"] = 29
    label["_lineHeight"] = 36
    label["_enableWrapText"] = False
    label["_N$horizontalAlign"] = 0
    label["_N$verticalAlign"] = 1
    label["_N$overflow"] = 1
    if placeholder:
        label["_string"] = ""
        label["_N$string"] = ""


def apply_field(
    p: Prefab,
    path: str,
    asset: str,
    placeholder_name: str,
    placeholder_asset: str,
    top_value: int,
) -> None:
    top(p, path, top_value, width=527, height=112)
    p.art(p.node(f"{path}/BACKGROUND_SPRITE"), asset, 0, 0, 527, 112)
    placeholder = sprite_child(p, path, placeholder_name, placeholder_asset)
    style_edit_label(p, f"{path}/TEXT_LABEL", placeholder=False)
    style_edit_label(p, f"{path}/PLACEHOLDER_LABEL", placeholder=True)

    for child_ref in p.data[p.node(path)].get("_children", []):
        child_id = child_ref["__id__"]
        child_name = p.data[child_id].get("_name")
        if child_name in ("线条", "线条 copy", "sj", "mm", "V8精确清底"):
            p.set_active(child_id, False)
    clear_path = "清除用户" if path == "手机号" else "清除密码"
    try:
        p.set_active(p.node(f"{path}/{clear_path}/CHACHA"), False)
    except KeyError:
        pass

    children = p.data[p.node(path)].get("_children", [])
    placeholder_ref = next(ref for ref in children if ref["__id__"] == placeholder)
    children.remove(placeholder_ref)
    background_index = next(
        index
        for index, ref in enumerate(children)
        if p.data[ref["__id__"]].get("_name") == "BACKGROUND_SPRITE"
    )
    children.insert(background_index + 1, placeholder_ref)


def main() -> None:
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    p.sprite(p.root, "casino_bg.png")
    top(p, "登录LOGO", 166, width=360, height=379)
    p.sprite(p.node("登录LOGO"), "shield_hd.png")

    apply_field(
        p,
        "手机号",
        "login_input_account_exact.png",
        "V7账号占位美术字",
        "login_hint_account_exact.png",
        603,
    )
    apply_field(
        p,
        "密码",
        "login_input_password_exact.png",
        "V7密码占位美术字",
        "login_hint_password_exact.png",
        735,
    )

    top(p, "忘记密码", 875, x=-190, width=210, height=54)
    p.art(
        p.node("忘记密码"),
        "login_link_reset_exact.png",
        -190,
        p.data[p.node("忘记密码")]["_trs"]["array"][1],
        210,
        54,
        hide=True,
    )
    top(p, "注册账号", 875, x=190, width=210, height=54)
    p.art(
        p.node("注册账号"),
        "login_link_register_exact.png",
        190,
        p.data[p.node("注册账号")]["_trs"]["array"][1],
        210,
        54,
        hide=True,
    )
    top(p, "登陆", 970, width=527, height=100)
    p.art(
        p.node("登陆"),
        "login_button_exact.png",
        0,
        p.data[p.node("登陆")]["_trs"]["array"][1],
        527,
        100,
        hide=True,
    )
    p.save()
    print("已把 V7 最终确认稿登录控件写入 panelLogin.prefab。")


if __name__ == "__main__":
    main()
