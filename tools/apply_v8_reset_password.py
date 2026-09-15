#!/usr/bin/env python3
"""Author the approved V8 reset-password modal into the existing login Prefab."""
import base64
import copy
import uuid

from apply_v7_prefab_skin import Prefab
from apply_v7_login_register_exact import centered_widget, full_widget, untint
from repair_v7_responsive_layout import ensure_widget
from apply_v8_login import update_meta

SCALE = 750 / 941
CENTER = (472.0, 903.5)
PANEL = "reset_panel_bg_exact.png"
PANEL_RECT = (101, 303, 843, 1504)
BADGE = ("reset_badge_exact.png", (334, 168, 606, 358))
TITLE = ("reset_title_exact.png", (255, 402, 690, 498))
SUBTITLE = ("reset_subtitle_exact.png", (338, 496, 606, 530))
RULE = ("reset_rule_exact.png", (190, 528, 752, 566))
SAFETY = ("reset_safety_exact.png", (140, 1330, 802, 1430))
CLOSE_ART = ("reset_close_exact.png", (730, 320, 836, 416))
CLOSE = (752, 342, 818, 408)
SUBMIT = (129, 1140, 807, 1266)
ROWS = [
    ("账号", "account", (128, 583, 812, 687), (470, 602, 806, 668), "中文、英文或数字", None),
    ("新密码", "password", (128, 716, 812, 818), (470, 734, 806, 800), "请勿使用与其他平台相同密码!!!", (236, 103, 88)),
    ("确认密码", "confirm", (128, 842, 812, 945), (470, 860, 806, 927), "请再次输入新密码", None),
    ("交易密码", "trade", (128, 966, 812, 1073), (470, 986, 806, 1053), "请输入交易密码", None),
]

def geo(rect):
    x0, y0, x1, y1 = rect
    return (((x0 + x1) / 2 - CENTER[0]) * SCALE,
            (CENTER[1] - (y0 + y1) / 2) * SCALE,
            (x1 - x0) * SCALE, (y1 - y0) * SCALE)

def reid(p, node_id, tag):
    stack = [node_id]
    n = 0
    while stack:
        cur = stack.pop()
        ref = p.data[cur].get("_prefab")
        if isinstance(ref, dict):
            u = uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-reset/%s/%d" % (tag, n))
            p.data[ref["__id__"]]["fileId"] = u.hex[:2] + base64.b64encode(u.bytes[1:]).decode("ascii")
        n += 1
        for c in p.data[cur].get("_children", []):
            stack.append(c["__id__"])

def main():
    update_meta(PANEL)
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    root = p.root
    # 重新生成前先移除上一次的弹窗，保证工具可重复执行。
    kids = p.data[root].get("_children", [])
    p.data[root]["_children"] = [r for r in kids
                                if p.data[r["__id__"]].get("_name") != "重置密码弹窗"]
    mask_t = p.node("注册弹窗/遮罩")
    leaf_t = p.node("注册弹窗/注册资料框/关闭注册/关闭图标")
    row_t = p.node("注册弹窗/注册资料框/账号")
    shell = p.clone_subtree(mask_t, root, "重置密码弹窗")
    p.disable(shell, "cc.Sprite")
    full_widget(p, shell, 750, 1334)
    p.set_active(shell, False)
    mask = p.clone_subtree(mask_t, shell, "遮罩")
    full_widget(p, mask, 750, 1334)
    # 弹窗背后的场景压得更暗，避免登录页背景透出来干扰阅读。
    p.data[mask]["_opacity"] = 225
    reid(p, mask, "mask")
    panel = p.clone_subtree(leaf_t, shell, "重置资料框")
    px, py, pw, ph = geo(PANEL_RECT)
    p.set_pos(panel, px, py, pw, ph)
    p.sprite(panel, PANEL)
    p.set_active(panel, True)
    centered_widget(p, panel, pw, ph)
    p.set_pos(panel, px, py, pw, ph)
    untint(p, panel)
    reid(p, panel, "panel")

    arts = [("徽章", BADGE), ("标题", TITLE), ("副标题", SUBTITLE),
            ("装饰线", RULE), ("安全提示", SAFETY)]
    for tag, (asset, rect) in arts:
        n = p.clone_subtree(leaf_t, panel, tag)
        reid(p, n, "art-" + tag)
        ax, ay, aw, ah = geo(rect)
        p.art(n, asset, ax, ay, aw, ah)
        p.set_active(n, True)
        untint(p, n)

    base = "重置密码弹窗/重置资料框"
    for name, key, rect, input_rect, placeholder, color in ROWS:
        row = p.clone_subtree(row_t, panel, name)
        reid(p, row, "row-" + name)
        p.disable(row, "cc.Widget")
        rx, ry, rw, rh = geo(rect)
        p.art(row, "reset_row_%s_exact.png" % key, rx, ry, rw, rh)
        untint(p, row)
        for child in ("字段名称", "分割线"):
            p.set_active(p.node(base + "/" + name + "/" + child), False)
        edit = p.node(base + "/" + name + "/输入")
        p.set_active(edit, True)
        ix, iy, iw, ih = geo(input_rect)
        p.set_pos(edit, ix - rx, iy - ry, iw, ih, disable_widget=True)
        p.data[edit]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": .5, "y": .5}
        _, ebc = p.component(edit, "cc.EditBox")
        if ebc:
            ebc.update({"_N$fontSize": 26, "_N$lineHeight": 32, "_N$placeholder": ""})
        for child in ("TEXT_LABEL", "PLACEHOLDER_LABEL"):
            lid = p.node(base + "/" + name + "/输入/" + child)
            p.set_pos(lid, -iw / 2, ih / 2, iw - 16, ih, disable_widget=True)
            p.data[lid]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0, "y": 1}
            p.data[lid]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 242, "b": 216, "a": 255}
            _, lab = p.component(lid, "cc.Label")
            long_one = child == "PLACEHOLDER_LABEL" and len(placeholder) > 10
            lab.update({"_fontSize": 17 if long_one else 26,
                        "_lineHeight": 24 if long_one else 32,
                        "_enableWrapText": False,
                        "_N$horizontalAlign": 0, "_N$verticalAlign": 1, "_N$overflow": 1})
            p.disable(lid, "cc.LabelOutline")
            # cc.EditBox 会把内部两个 Label 的 anchor 升级为 (0,1) 并在聚焦时重排，
            # 这里用原生 Widget 固定左右内边距，保证输入内容与占位文字始终落在同一位置。
            ensure_widget(p, lid).update(_enabled=True, alignMode=1, _target=None, _alignFlags=45,
                _left=10, _right=10, _top=0, _bottom=0, _isAbsLeft=True, _isAbsRight=True,
                _isAbsTop=True, _isAbsBottom=True)
            if child == "PLACEHOLDER_LABEL":
                lab["_string"] = lab["_N$string"] = placeholder
                p.set_active(lid, True)
                if color:
                    p.data[lid]["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}

    close = p.clone_subtree(p.node("注册弹窗/注册资料框/关闭注册"), panel, "关闭重置")
    reid(p, close, "close")
    cx, cy, cw, ch = geo(CLOSE)
    p.set_pos(close, cx, cy, cw, ch, disable_widget=True)
    p.hide_children(close)
    art_node = p.clone_subtree(leaf_t, panel, "关闭美术")
    reid(p, art_node, "close-art")
    ax, ay, aw, ah = geo(CLOSE_ART[1])
    p.art(art_node, CLOSE_ART[0], ax, ay, aw, ah)
    p.set_active(art_node, True)
    untint(p, art_node)

    submit = p.clone_subtree(p.node("注册弹窗/注册资料框/确认注册"), panel, "确认修改")
    reid(p, submit, "submit")
    sx, sy, sw, sh = geo(SUBMIT)
    p.set_pos(submit, sx, sy, sw, sh, disable_widget=True)
    p.disable(submit, "cc.Widget")
    p.sprite(submit, "reset_submit_exact.png")
    untint(p, submit)
    p.hide_children(submit)
    for node in (close, submit):
        _, btn = p.component(node, "cc.Button")
        if btn:
            btn["_N$transition"] = btn["transition"] = 0
    p.save()
    print("V8 reset-password modal authored:", shell)


if __name__ == "__main__":
    main()
