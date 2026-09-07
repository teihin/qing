#!/usr/bin/env python3
"""Apply the shared V7 popup language to the remaining lobby overlays."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import BASE_H, center_anchor, full_widget, transparent
from apply_v7_wallet_realname_exact import GOLD, style_bank_picker


def style_mask(p: Prefab, path: str) -> None:
    node = p.node(path)
    full_widget(p, node, 750, BASE_H)
    p.data[node]["_color"] = {
        "__type__": "cc.Color", "r": 0, "g": 7, "b": 16, "a": 255,
    }
    p.data[node]["_opacity"] = 190


def style_confirm(p: Prefab, root_path: str, confirm_name: str) -> None:
    root = p.node(root_path)
    full_widget(p, root, 750, BASE_H)
    style_mask(p, root_path + "/msk")

    panel = p.node(root_path + "/bk")
    center_anchor(p, panel)
    p.art(panel, "popup_message_dual_exact.png", 0, 0, 532, 366)
    untint(p, panel)

    msg_path = root_path + "/bk/msg"
    msg = p.node(msg_path)
    style_label(p, msg_path, x=0, y=28, width=450, height=128,
                size=28, preview=None, align=1)
    p.data[msg]["_color"] = copy.deepcopy(GOLD)

    cancel = p.node(root_path + "/bk/关闭上上层")
    p.set_active(cancel, True)
    transparent(p, cancel, 200, 64, hide_children=True)
    p.set_pos(cancel, -115, -110, 200, 64, disable_widget=True)
    confirm = p.node(root_path + "/bk/" + confirm_name)
    p.set_active(confirm, True)
    transparent(p, confirm, 200, 64, hide_children=True)
    p.set_pos(confirm, 115, -110, 200, 64, disable_widget=True)

    # The old corner-close node used a mismatched legacy texture and was
    # already inactive.  Keep its event node serialized but invisible.
    for ref in p.data[panel].get("_children", []):
        child = ref["__id__"]
        if p.data[child].get("_name") == "关闭上上层" and child != cancel:
            p.set_active(child, False)


def style_join_room(p: Prefab) -> None:
    root_path = "加入房间"
    root = p.node(root_path)
    full_widget(p, root, 750, BASE_H)
    style_mask(p, root_path + "/msk")

    panel = p.node(root_path + "/bk")
    center_anchor(p, panel)
    p.art(panel, "popup_join_room_panel_exact.png", 0, 0, 600, 690)
    untint(p, panel)
    p.set_active(p.node(root_path + "/bk/加入房间"), False)

    input_frame = p.node(root_path + "/bk/加入房间框")
    p.art(input_frame, "popup_join_room_input_exact.png", 0, 205, 480, 82)
    untint(p, input_frame)
    room_path = root_path + "/bk/房号"
    room = p.node(room_path)
    style_label(p, room_path, x=0, y=205, width=410, height=55,
                size=36, preview="", align=1)
    p.data[room]["_color"] = copy.deepcopy(GOLD)

    keyboard = p.node(root_path + "/bk/键盘")
    p.disable(keyboard, "cc.Layout")
    p.set_pos(keyboard, 0, -80, 556, 360, disable_widget=True)
    specs = (
        ("1", -170, 125), ("2", 0, 125), ("3", 170, 125),
        ("4", -170, 40), ("5", 0, 40), ("6", 170, 40),
        ("7", -170, -45), ("8", 0, -45), ("9", 170, -45),
        ("重置", -170, -130), ("0", 0, -130), ("删除", 170, -130),
    )
    for label, x, y in specs:
        safe = {"重置": "reset", "删除": "delete"}.get(label, label)
        key = p.node(root_path + "/bk/键盘/" + label)
        p.art(key, f"popup_key_{safe}_exact.png", x, y, 150, 78, hide=True)
        untint(p, key)

    close = p.node(root_path + "/bk/关闭上上层")
    p.set_active(close, True)
    p.set_pos(close, 265, 300, 68, 68, disable_widget=True)
    close_art = p.node(root_path + "/bk/关闭上上层/img")
    p.art(close_art, "popup_close_exact.png", 0, 0, 58, 58, hide=True)
    untint(p, close_art)


def apply() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    style_confirm(p, "确定修改个人信息", "确认修改个人信息")
    style_confirm(p, "确定随机头像提示面板", "确认随机头像")
    style_join_room(p)
    # This legacy overlay is currently not opened by panelMain.ts, but styling
    # it prevents an old skin from surfacing if a serialized event activates it.
    style_bank_picker(p, "选择银行")
    p.save()
    print("大厅遗留覆盖弹窗已统一为 V7 蓝金风格。")


if __name__ == "__main__":
    apply()
