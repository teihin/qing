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


def center(p: Prefab, path: str, *, x: float = 0, y: float = 0,
           width: float | None = None, height: float | None = None):
    """Keep a fixed element centered against the current visible canvas."""
    node_id = p.node(path)
    node = p.data[node_id]
    if width is not None:
        node["_contentSize"]["width"] = width
    if height is not None:
        node["_contentSize"]["height"] = height
    p.set_pos(node_id, x, y)
    widget = ensure_widget(p, node_id)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 18,
        "_horizontalCenter": x, "_verticalCenter": y,
        "_originalWidth": node["_contentSize"]["width"],
        "_originalHeight": node["_contentSize"]["height"],
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

    # 游戏推广顶部固定，中段前景相对可视屏幕中心定位。这样长屏新增
    # 高度会平均分配到内容组上下方，而不是全部堆成底部空白。
    try:
        p.set_active(p.node("推广二维码"), False)
        top(p, "推广二维码/V7游戏推广母版", 0, width=750, height=1800)
        top(p, "推广二维码/title", 0, width=750, height=81,
            stretch_x=True)
        top(p, "推广二维码/V7游戏推广盾牌", 100, width=188, height=198)
        top(p, "推广二维码/V7推广主标题", 320, width=640, height=78)
        for path, x, y, width, height in (
            ("V7推广说明", 0, 196, 520, 38),
            ("二维码", 0, -30, 350, 374),
            ("V7推广信息卡", 0, -358, 640, 190),
            ("V7推广ID", -45, -313, 440, 42),
            ("V7推广地址标题", -165, -368, 200, 34),
            ("V7推广链接", -45, -416, 440, 44),
            ("复制推广ID", 265, -313, 86, 40),
            ("复制推广地址", 265, -416, 86, 40),
            ("分享二维码", -145, -544, 270, 82),
            ("保存二维码", 145, -544, 270, 82),
        ):
            center(p, f"推广二维码/{path}", x=x, y=y,
                   width=width, height=height)
    except KeyError:
        pass

    # 公告使用一张750x1800完整长图并顶部定位；短屏裁掉底部空桌面，
    # 长屏显示更多同一张图。禁止九切、纵向缩放或第二张背景拼接。
    try:
        p.set_active(p.node("Main/公告/V7公告长屏补底"), False)
        top(p, "Main/公告/V7公告菜单高清母版", 0,
            width=750, height=1800)
        announcement_home = p.node("Main/公告/主页")
        p.set_pos(announcement_home, 0, 0, 750, 1334)
        announcement_widget = ensure_widget(p, announcement_home)
        announcement_widget.update({
            "_enabled": True, "alignMode": 1, "_alignFlags": 45,
            "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
            "_originalWidth": 750, "_originalHeight": 1334,
        })
        for name, y, width, height in (
            ("公告6", 241, 371, 144),
            ("公告1", 82, 371, 140),
            ("公告2", -75, 371, 140),
            ("公告5", -235, 371, 142),
        ):
            top_px = 667 - y - height / 2
            top(p, f"Main/公告/主页/{name}", top_px,
                x=162, width=width, height=height)
    except KeyError:
        pass

    # 公告详情页使用同一张1800高的顶部定位背景，以及固定81像素的赠送页
    # 同款标题栏。三个固定页滚动完整正文；最新公告则固定屏内底框，只让
    # 服务端正文在框内滚动，避免出现3000像素空框且无法拉到底。
    try:
        for page in ("公告1", "公告2", "公告5", "公告6"):
            top(p, f"{page}/V7公告详情长背景", 0,
                width=750, height=1800)
            top(p, f"{page}/title", 0,
                width=750, height=81, stretch_x=True)
            stretch(p, f"{page}/list", 81, 0, left=0, right=0)
            detail_view = p.node(f"{page}/list/view")
            if page == "公告6":
                p.set_pos(detail_view, 0, -37.5, 620, 1068)
            else:
                p.set_pos(detail_view, 0, 0, 750, 1253)
            detail_view_widget = ensure_widget(p, detail_view)
            if page == "公告6":
                detail_view_widget.update({
                    "_enabled": True, "alignMode": 1, "_alignFlags": 45,
                    "_left": 65, "_right": 65, "_top": 130, "_bottom": 55,
                    "_originalWidth": 620, "_originalHeight": 1068,
                })
                _, detail_mask = p.component(detail_view, "cc.Mask")
                if detail_mask is not None:
                    detail_mask["_enabled"] = True
            else:
                detail_view_widget.update({
                    "_enabled": True, "alignMode": 1, "_alignFlags": 45,
                    "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
                    "_originalWidth": 750, "_originalHeight": 1253,
                })
            detail_content = p.node(f"{page}/list/view/content")
            content_height = 1068 if page == "公告6" else 1719
            content_width = 620 if page == "公告6" else 750
            p.data[detail_content]["_contentSize"].update({
                "width": content_width, "height": content_height,
            })
            p.data[detail_content]["_trs"]["array"][0:2] = [0, content_height / 2]
            detail_content_widget = ensure_widget(p, detail_content)
            detail_content_widget.update({
                "_enabled": True, "alignMode": 1, "_alignFlags": 40,
                "_top": 0, "_horizontalCenter": 0,
                "_originalWidth": content_width, "_originalHeight": content_height,
            })
        latest_panel = p.node("公告6/list/V7公告正文高清母版")
        latest_panel_widget = ensure_widget(p, latest_panel)
        latest_panel_widget.update({
            "_enabled": True, "alignMode": 1, "_alignFlags": 45,
            "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
            "_originalWidth": 750, "_originalHeight": 1253,
        })
    except KeyError:
        pass

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

    # 赠送页沿用确认稿的750x1334基准切分；长屏新增空间全部给记录列表。
    top(p, "赠送/title", 0, width=750, height=81, stretch_x=True)
    top(p, "赠送/V7赠送主视觉", 81, width=750, height=300)
    top(p, "赠送/操作", 380, width=750, height=378, stretch_x=True)
    for path, y in (("赠送/操作/用户id", 148), ("赠送/操作/金额", 51)):
        field = p.node(path)
        field_x = p.data[field]["_trs"]["array"][0]
        field_width = p.data[field]["_contentSize"]["width"]
        p.set_pos(field, field_x, y, field_width, 82)
    try:
        password = p.node("赠送/操作/V7交易密码")
    except KeyError:
        password = p.clone_subtree(p.node("赠送/操作/金额"), p.node("赠送/操作"), "V7交易密码")
    p.set_active(password, True)
    password_x = p.data[password]["_trs"]["array"][0]
    password_width = p.data[password]["_contentSize"]["width"]
    p.set_pos(password, password_x, -46, password_width, 82)
    set_label(p, "赠送/操作/V7交易密码/PLACEHOLDER_LABEL", "请输入交易密码")
    p.set_pos(p.node("赠送/操作/提交赠送"), 0, -148, 414, 84)
    p.set_active(p.node("赠送/V7赠送记录标题"), False)
    top(p, "赠送/标题", 784, width=708, height=106)
    stretch(p, "赠送/赠送记录列表", 890, 167, left=21, right=21)
    bottom(p, "赠送/分页", 59, width=708, height=107)
    p.save()


def repair_records():
    p = Prefab("assets/resources/UI/panelRecordList.prefab")
    top(p, "title", 0, width=750, height=72, stretch_x=True)
    top(p, "统计", 72, width=750, height=368)
    top(p, "条件", 440, width=656, height=68)
    top(p, "标题", 520, width=722, height=63)
    stretch(p, "战绩列表", 583, 107, left=14, right=14)
    stretch(p, "战绩列表/view", 0, 0)
    bottom(p, "分页", 0, width=708, height=107)
    p.save()


def repair_settlement():
    p = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    top(p, "title", 0, width=750, height=72, stretch_x=True)
    top(p, "排行", 72, width=750, height=290)
    top(p, "基本", 376, width=704, height=53)
    top(p, "扩展", 376, width=704, height=53)
    try:
        top(p, "V7结算表头", 439, width=708, height=65)
    except KeyError:
        pass
    stretch(p, "战绩列表", 504, 140, left=21, right=21)
    stretch(p, "战绩列表/view", 0, 0)
    bottom(p, "关闭", 55, width=300, height=67)
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


def repair_wallet():
    """Keep the accepted wallet composition stable on 1334-1778px screens."""
    p = Prefab("assets/resources/Prefabs/钱包.prefab")
    stretch(p, "钱包", 0, 0)
    top(p, "钱包/bk", 0, width=750, height=1800)
    top(p, "钱包/Title", 0, width=750, height=84, stretch_x=True)
    top(p, "钱包/选项", 102, width=666, height=66)
    stretch(p, "钱包/容器", 198, 0)

    page_height = BASE_H - 198

    def full_child(path: str):
        node_id = p.node(path)
        p.data[node_id]["_anchorPoint"] = {
            "__type__": "cc.Vec2", "x": 0.5, "y": 0.5,
        }
        p.set_pos(node_id, 0, 0, 750, page_height)
        value = ensure_widget(p, node_id)
        value.update({
            "_enabled": True, "alignMode": 1, "_alignFlags": 45,
            "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
            "_originalWidth": 750, "_originalHeight": page_height,
        })

    def fixed_page_top(path: str, top_px: float, width: float, height: float):
        node_id = p.node(path)
        p.data[node_id]["_anchorPoint"] = {
            "__type__": "cc.Vec2", "x": 0.5, "y": 0.5,
        }
        p.set_pos(node_id, 0, page_height / 2 - top_px - height / 2,
                  width, height)
        value = ensure_widget(p, node_id)
        value.update({
            "_enabled": True, "alignMode": 1, "_alignFlags": 17,
            "_top": top_px, "_horizontalCenter": 0,
            "_originalWidth": width, "_originalHeight": height,
        })

    for path in (
        "钱包/容器/充值", "钱包/容器/充值/根",
        "钱包/容器/提现", "钱包/容器/提现/提现选项",
        "钱包/容器/记录",
    ):
        full_child(path)

    # These two fixed-coordinate legacy groups previously stayed vertically
    # centered inside the growing page. Pinning their 1136px design box to the
    # top prevents channels and amount cards drifting downward on tall phones.
    from repair_v7_wallet_channel_selection import apply_channel_viewport
    apply_channel_viewport(p)
    fixed_page_top("钱包/容器/充值/根/金额", 0, 750, page_height)

    p.save()


def main():
    repair_login()
    repair_main()
    repair_records()
    repair_settlement()
    repair_give_pad()
    repair_wallet()


if __name__ == "__main__":
    main()
