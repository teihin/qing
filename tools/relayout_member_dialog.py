#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 panelBossPlayerInfo 的「分组弹窗」改成两套版式共用一个骨架。

预制体里存的是**大版式**（组内成员列表用），运行时 `LayoutDialog()` 会按模式
把 面板/标题/提示/列表/按钮 缩回小版式（新建 / 加人 / 选组 / 删除确认）。

大版式（成员列表）            小版式（其余，运行时设置）
  面板  740x1180               面板  740x800
  标题  y=540                  标题  y=340
  提示  y=484 (h=80)           提示  y=286 (h=66)
  列表  y=-6  690x872          列表  y=20  690x430（仅 pick 显示）
  输入框 y=55                  输入框 y=55（仅 create/addMember）
  按钮  y=-524                 按钮  y=-330

成员行不再是「选项模板」那一行文字，而是运行时克隆玩家信息的 `行模板`
（690x240 的表行：头像/姓名/ID/身份/俱乐部/积分 + 9 项统计 + 一排按钮），
所以这里只要把 ScrollView 撑到 690 宽，并保证 `选项模板` 仍可给选组用。

用法：python3 tools/relayout_member_dialog.py [--check]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets/resources/UI/panelBossPlayerInfo.prefab")

PANEL_W, PANEL_H = 740, 1180
LIST_W, LIST_H = 690, 872

# (路径, x, y, w, h) —— 只动这几处，其余（输入框、按钮文案等）保持原样
LAYOUT = [
    ("面板", 0, 0, PANEL_W, PANEL_H),
    ("标题", 0, 540, 680, 44),
    ("提示", 0, 482, 680, 64),
    ("选项列表", 0, -6, LIST_W, LIST_H),
    ("view", 0, 0, LIST_W, LIST_H),
    ("content", 0, LIST_H / 2, LIST_W, LIST_H),
    # 选组用的那一行也跟着撑宽，否则在大弹窗里显得瘦
    ("选项模板", 0, -40, LIST_W, 80),
    ("取消", -170, -524, 224, 76),
    ("确定", 170, -524, 224, 76),
]


def load():
    with open(PREFAB, encoding="utf-8") as handle:
        return json.load(handle)


def find(d, name, parent_name):
    for index, obj in enumerate(d):
        if obj.get("__type__") != "cc.Node" or obj.get("_name") != name:
            continue
        parent = obj.get("_parent")
        if parent and d[parent["__id__"]].get("_name") == parent_name:
            return index
    raise SystemExit("找不到 %s/%s" % (parent_name, name))


def path(d, *names):
    """从根节点按名字逐级下钻。

    注意：`view` / `content` 这两个名字在玩家信息列表里也有一份，
    按「父节点名」去找会命中错的子树，所以必须走完整路径。
    """
    index = None
    for name in names:
        if index is None:
            for candidate, obj in enumerate(d):
                if obj.get("__type__") == "cc.Node" and obj.get("_name") == name:
                    index = candidate
                    break
            else:
                raise SystemExit("找不到根节点 %s" % name)
            continue
        for ref in d[index].get("_children", []):
            if d[ref["__id__"]].get("_name") == name:
                index = ref["__id__"]
                break
        else:
            raise SystemExit("找不到 %s 下的 %s" % (names[0], name))
    return index


def set_trs(node, x, y):
    node["_trs"]["array"][0] = float(x)
    node["_trs"]["array"][1] = float(y)


def set_size(node, w, h):
    node["_contentSize"] = {"__type__": "cc.Size", "width": float(w), "height": float(h)}


def label_of(d, node):
    for ref in node.get("_components", []):
        comp = d[ref["__id__"]]
        if comp.get("__type__") == "cc.Label":
            return comp
    return None


DIALOG = ("分组弹窗", "面板")
LIST_PATH = DIALOG + ("选项列表",)
VIEW_PATH = LIST_PATH + ("view",)
CONTENT_PATH = VIEW_PATH + ("content",)
OPTION_PATH = CONTENT_PATH + ("选项模板",)

NODE_PATH = {
    "面板": DIALOG,
    "标题": DIALOG + ("标题",),
    "提示": DIALOG + ("提示",),
    "选项列表": LIST_PATH,
    "view": VIEW_PATH,
    "content": CONTENT_PATH,
    "选项模板": OPTION_PATH,
    "取消": DIALOG + ("取消",),
    "确定": DIALOG + ("确定",),
}


def apply(d):
    nodes = {}
    for name, x, y, w, h in LAYOUT:
        index = path(d, *NODE_PATH[name])
        node = d[index]
        set_trs(node, x, y)
        set_size(node, w, h)
        nodes[name] = index
        # 标题/提示 的 Label 就在节点自己身上，尺寸要一起放大，
        # 否则 SHRINK(overflow=2) 会把 32 号标题压成 20 号。
        if name in ("标题", "提示"):
            label = label_of(d, node)
            if label:
                label["_contentSize"] = {"__type__": "cc.Size",
                                         "width": float(w - 20), "height": float(h - 8)}

    # 取消/确定的「文字」子节点跟着按钮宽度走
    for name in ("取消", "确定"):
        button = d[nodes[name]]
        for ref in button.get("_children", []):
            child = d[ref["__id__"]]
            if child.get("_name") != "文字":
                continue
            set_trs(child, 0, 0)
            set_size(child, 224 - 8, 76 - 12)
            label = label_of(d, child)
            if label:
                label["_contentSize"] = {"__type__": "cc.Size", "width": 216.0, "height": 64.0}

    # 选项模板里的那行文字
    option = d[nodes["选项模板"]]
    for ref in option.get("_children", []):
        child = d[ref["__id__"]]
        if child.get("_name") != "文字":
            continue
        set_trs(child, 0, 0)
        set_size(child, LIST_W - 30, 52)
        label = label_of(d, child)
        if label:
            label["_contentSize"] = {"__type__": "cc.Size",
                                     "width": float(LIST_W - 30), "height": 52.0}
    return nodes


def check(d):
    """只有「面板」的直接子节点才用面板坐标系判断越界，view/content 是嵌套的。"""
    problems = []
    panel = path(d, *DIALOG)
    half_w = d[panel]["_contentSize"]["width"] / 2
    half_h = d[panel]["_contentSize"]["height"] / 2
    children = {d[ref["__id__"]]["_name"]: ref["__id__"] for ref in d[panel]["_children"]}
    for name, _x, _y, w, h in LAYOUT:
        index = children.get(name)
        if index is None:
            continue
        node = d[index]
        x, y = node["_trs"]["array"][0], node["_trs"]["array"][1]
        if x - w / 2 < -half_w - 0.5 or x + w / 2 > half_w + 0.5:
            problems.append("%s 横向越界 (%.0f..%.0f) 面板半宽 %.0f"
                            % (name, x - w / 2, x + w / 2, half_w))
        if y - h / 2 < -half_h - 0.5 or y + h / 2 > half_h + 0.5:
            problems.append("%s 纵向越界 (%.0f..%.0f) 面板半高 %.0f"
                            % (name, y - h / 2, y + h / 2, half_h))
    # 标题/提示/列表/按钮 不能互相压
    boxes = {}
    for name in ("标题", "提示", "选项列表", "取消", "确定"):
        node = d[children[name]]
        x, y = node["_trs"]["array"][0], node["_trs"]["array"][1]
        w, h = node["_contentSize"]["width"], node["_contentSize"]["height"]
        boxes[name] = (x - w / 2, x + w / 2, y - h / 2, y + h / 2)
    order = ["标题", "提示", "选项列表", "取消"]
    for upper, lower in zip(order, order[1:]):
        if boxes[upper][2] < boxes[lower][3] + 2:
            problems.append("%s 和 %s 贴太近/重叠" % (upper, lower))
    return problems


def dump(d):
    panel = find(d, "面板", "分组弹窗")
    print("面板 %0.fx%0.f" % (d[panel]["_contentSize"]["width"], d[panel]["_contentSize"]["height"]))
    for ref in d[panel]["_children"]:
        node = d[ref["__id__"]]
        print("  %-8s (%6.0f,%6.0f) %4.0fx%4.0f%s"
              % (node["_name"], node["_trs"]["array"][0], node["_trs"]["array"][1],
                 node["_contentSize"]["width"], node["_contentSize"]["height"],
                 "" if node.get("_active", True) else " [off]"))


def main():
    d = load()
    apply(d)
    problems = check(d)
    dump(d)
    if problems:
        print("\n自检问题：")
        for one in problems:
            print("  -", one)
        raise SystemExit(1)
    print("\n自检通过（无越界/重叠）")
    if "--check" in sys.argv:
        print("--check 模式：不写回")
        return
    with open(PREFAB, "w", encoding="utf-8") as handle:
        json.dump(d, handle, ensure_ascii=False, separators=(",", ":"))
    print("已写回", PREFAB, "（对象 %d）" % len(d))


if __name__ == "__main__":
    main()
