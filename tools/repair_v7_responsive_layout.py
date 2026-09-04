#!/usr/bin/env python3
"""Repair V7 Prefab layout for short and tall portrait screens.

The approved art is authored against 750x1334.  Runtime roots stretch to the
visible canvas, so fixed child coordinates drift on 19.5:9 devices.  This tool
serializes the original project convention back into the Prefabs: top sections
use top Widgets, bottom actions use bottom Widgets, and data lists stretch only
through the flexible middle region.
"""

from __future__ import annotations

import copy

from apply_v7_prefab_skin import MATERIAL_UUID, Prefab


BASE_W = 750
BASE_H = 1334


def ensure_widget(p: Prefab, node_id: int):
    _, widget = p.component(node_id, "cc.Widget")
    if widget is not None:
        return widget
    node = p.data[node_id]
    widget = {
        "__type__": "cc.Widget", "_name": "", "_objFlags": 0,
        "node": {"__id__": node_id}, "_enabled": True,
        "alignMode": 1, "_target": None, "_alignFlags": 0,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_verticalCenter": 0, "_horizontalCenter": 0,
        "_isAbsLeft": True, "_isAbsRight": True,
        "_isAbsTop": True, "_isAbsBottom": True,
        "_isAbsHorizontalCenter": True, "_isAbsVerticalCenter": True,
        "_originalWidth": node["_contentSize"]["width"],
        "_originalHeight": node["_contentSize"]["height"], "_id": ""
    }
    p.data.append(widget)
    node.setdefault("_components", []).append({"__id__": len(p.data) - 1})
    return widget


def _anchor(p: Prefab, node_id: int):
    a = p.data[node_id]["_anchorPoint"]
    return a["x"], a["y"]


def top(p: Prefab, path: str, top_px: float, *, x: float = 0,
        width: float | None = None, height: float | None = None,
        stretch_x: bool = False, left: float = 0, right: float = 0):
    node_id = p.node(path)
    node = p.data[node_id]
    if width is not None:
        node["_contentSize"]["width"] = width
    if height is not None:
        node["_contentSize"]["height"] = height
    w = node["_contentSize"]["width"]
    h = node["_contentSize"]["height"]
    ax, ay = _anchor(p, node_id)
    node["_trs"]["array"][0] = (-BASE_W / 2 + left + w * ax) if stretch_x else x
    node["_trs"]["array"][1] = BASE_H / 2 - top_px - h * (1 - ay)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1,
        "_alignFlags": 41 if stretch_x else 17,
        "_left": left, "_right": right, "_top": top_px,
        "_horizontalCenter": x,
        "_originalWidth": w, "_originalHeight": h,
    })


def bottom(p: Prefab, path: str, bottom_px: float, *, x: float = 0,
           width: float | None = None, height: float | None = None,
           stretch_x: bool = False, left: float = 0, right: float = 0):
    node_id = p.node(path)
    node = p.data[node_id]
    if width is not None:
        node["_contentSize"]["width"] = width
    if height is not None:
        node["_contentSize"]["height"] = height
    w = node["_contentSize"]["width"]
    h = node["_contentSize"]["height"]
    ax, ay = _anchor(p, node_id)
    node["_trs"]["array"][0] = (-BASE_W / 2 + left + w * ax) if stretch_x else x
    node["_trs"]["array"][1] = -BASE_H / 2 + bottom_px + h * ay
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1,
        "_alignFlags": 44 if stretch_x else 20,
        "_left": left, "_right": right, "_bottom": bottom_px,
        "_horizontalCenter": x,
        "_originalWidth": w, "_originalHeight": h,
    })


def stretch(p: Prefab, path: str, top_px: float, bottom_px: float,
            *, left: float = 0, right: float = 0):
    node_id = p.node(path)
    node = p.data[node_id]
    ax, ay = _anchor(p, node_id)
    w = BASE_W - left - right
    h = BASE_H - top_px - bottom_px
    node["_contentSize"]["width"] = w
    node["_contentSize"]["height"] = h
    node["_trs"]["array"][0] = -BASE_W / 2 + left + w * ax
    node["_trs"]["array"][1] = -BASE_H / 2 + bottom_px + h * ay
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": left, "_right": right, "_top": top_px,
        "_bottom": bottom_px, "_originalWidth": w,
        "_originalHeight": h,
    })


def set_label(p: Prefab, path: str, value: str):
    node_id = p.node(path)
    for ref in p.data[node_id].get("_components", []):
        component = p.data[ref["__id__"]]
        if component.get("__type__") == "cc.Label":
            component["_string"] = value
            component["_N$string"] = value


def repair_login():
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    top(p, "登录LOGO", 166, width=360, height=379)
    top(p, "手机号", 603, width=620, height=112)
    top(p, "密码", 735, width=620, height=112)
    top(p, "忘记密码", 875, x=-210, width=210, height=54)
    top(p, "注册账号", 875, x=210, width=210, height=54)
    top(p, "登陆", 970, width=550, height=100)
    p.save()


def repair_main():
    p = Prefab("assets/resources/UI/panelMain.prefab")

    top(p, "Main/发现/Title", 0, width=750, height=64, stretch_x=True)
    top(p, "Main/发现/LOGO", 64, width=750, height=530)
    for name, x in (("排行榜", -241), ("比赛场", 0), ("举报反馈", 241)):
        top(p, f"Main/发现/{name}", 486, x=x, width=226, height=91)
    try:
        top(p, "Main/发现/V8声音入口", 0, x=-333, width=84, height=64)
    except KeyError:
        pass
    top(p, "Main/发现/过滤", 594, width=706, height=94)
    stretch(p, "Main/发现/房间列表", 700, 134)
    room_view = p.node("Main/发现/房间列表/view")
    p.set_pos(room_view, 0, 0, 750, BASE_H - 700 - 134)
    view_widget = ensure_widget(p, room_view)
    view_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": 750, "_originalHeight": BASE_H - 700 - 134,
    })

    # Mine uses one immutable top slice from the accepted mockup.  The profile
    # panel and its six related actions stay together at the top; the shared nav
    # remains bottom-anchored. Tall devices therefore add breathing room below
    # the action group instead of tearing the profile/action composition apart.
    top(p, "Main/我的/Title", 0, width=750, height=334, stretch_x=True)
    top(p, "Main/我的/信息", 334, width=671, height=314)
    top(p, "Main/我的/数据", 334, width=671, height=314)
    p.data[p.node("Main/我的/操作")]["_anchorPoint"]["y"] = 0.5
    top(p, "Main/我的/操作", 664, width=700, height=317)

    # The navigation artwork is 155px tall because the center 8L shield rises
    # 21px above the 134px bar body. Keep the room list's 134px bottom inset so
    # this crown overlaps the list instead of being cropped away.
    bottom(p, "Down", 0, width=750, height=155, stretch_x=True)

    top(p, "赠送/title", 0, width=750, height=82, stretch_x=True)
    top(p, "赠送/V7赠送主视觉", 82, width=750, height=323)
    top(p, "赠送/操作", 360, width=750, height=430, stretch_x=True)
    p.set_pos(p.node("赠送/操作/用户id"), 0, 140, 660, 92)
    p.set_pos(p.node("赠送/操作/金额"), 0, 35, 660, 92)
    try:
        password = p.node("赠送/操作/V7交易密码")
    except KeyError:
        password = p.clone_subtree(p.node("赠送/操作/金额"), p.node("赠送/操作"), "V7交易密码")
    p.set_active(password, True)
    p.set_pos(password, 0, -70, 660, 92)
    p.art(p.node("赠送/操作/V7交易密码/BACKGROUND_SPRITE"), "give_password.png", 0, 0, 660, 92)
    set_label(p, "赠送/操作/V7交易密码/PLACEHOLDER_LABEL", "请输入交易密码")
    p.set_pos(p.node("赠送/操作/提交赠送"), 0, -147, 420, 92)
    try:
        history = p.node("赠送/V7赠送记录标题")
    except KeyError:
        history = p.clone_subtree(p.node("赠送/title/赠送_受赠记录"), p.node("赠送"), "V7赠送记录标题")
    p.set_active(history, True)
    p.art(history, "title_gift_history.png", 0, 0, 300, 58, hide=True)
    top(p, "赠送/V7赠送记录标题", 778, width=300, height=58)
    top(p, "赠送/标题", 828, width=710, height=70)
    stretch(p, "赠送/赠送记录列表", 898, 82, left=20, right=20)
    bottom(p, "赠送/分页", 16, width=710, height=66)
    p.save()


def repair_records():
    p = Prefab("assets/resources/UI/panelRecordList.prefab")
    top(p, "title", 0, width=750, height=82, stretch_x=True)
    top(p, "统计", 120, width=310, height=327)
    top(p, "条件", 439, width=670, height=72)
    top(p, "标题", 520, width=720, height=72)
    stretch(p, "战绩列表", 592, 30, left=15, right=15)
    stretch(p, "战绩列表/view", 0, 0)
    p.save()


def repair_settlement():
    p = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    top(p, "title", 0, width=750, height=78, stretch_x=True)
    top(p, "排行", 78, width=700, height=330)
    top(p, "基本", 411, width=700, height=62)
    top(p, "扩展", 411, width=700, height=62)
    p.disable(p.node("扩展"), "cc.Sprite")
    p.set_active(p.node("扩展/底皮"), True)
    p.set_pos(p.node("基本/房间名"), -245, 0, 190, 40)
    p.set_pos(p.node("基本/时长"), 265, 0, 150, 40)
    p.set_pos(p.node("扩展/底皮"), -85, 0, 130, 40)
    p.set_pos(p.node("扩展/txt copy"), 55, 0)
    p.set_pos(p.node("扩展/奖池"), 105, 0, 90, 40)
    p.set_active(p.node("扩展/txt"), False)
    # There are two legacy nodes named txt. Hide both hand-count/carry-in
    # labels from the one-line summary used by the approved settlement art.
    for ref in p.data[p.node("扩展")].get("_children", []):
        child = p.data[ref["__id__"]]
        if child.get("_name") == "txt":
            child["_active"] = False
    p.set_active(p.node("扩展/总手数"), False)
    p.set_active(p.node("扩展/总带入"), False)
    stretch(p, "战绩列表", 486, 190, left=25, right=25)
    stretch(p, "战绩列表/view", 0, 0)
    bottom(p, "关闭", 66, width=360, height=88)
    p.save()


def repair_give_pad():
    p = Prefab("assets/resources/UI/panelGivePad.prefab")
    node_id = p.node("bk")
    p.set_pos(node_id, -60, 0, 700, 650)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 18,
        "_horizontalCenter": -60, "_verticalCenter": 0,
        "_originalWidth": 700, "_originalHeight": 650,
    })
    p.save()


def main():
    repair_login()
    repair_main()
    repair_records()
    repair_settlement()
    repair_give_pad()


if __name__ == "__main__":
    main()
