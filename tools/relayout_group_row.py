#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 panelBossPlayerInfo 的「分组模板」排成「历史战绩」那种卡片（9 项统计全展示）。

    690x250，左侧 分组名 / 预警 / 备注 / 成员数，
    右侧 3 列（输赢 / 贡献 / 红利）× 3 行（今日 / 昨日 / 累计），
    底部一排按钮（成员 / 加人 / 删除分组）。

坐标（模板节点原点在中心，都相对它）：
  左栏    x=-222 宽 200 居中：分组名 y=84(fs30) / 预警 y=44(fs24) /
          备注 y=4(fs20) / 成员数值 y=-36(fs20)
  分隔线  x=-104, 2x214
  表头    y=84：输赢 x=18 / 贡献 145 / 红利 272，118 宽 fs18 灰
  行标签  x=-70 宽 52：今日 y=44 / 昨日 y=4 / 累计 y=-36，fs20 灰
  数值    同上三列，118x34，fs24；输赢格白字（运行时 SetScore 上红/绿），
          贡献/红利金
  按钮    成员(-225) / 加人(0) / 删除分组(225)，200x56，y=-86，文案 fs26

接口口径（《俱乐部玩家分组-客户端与后台接口文档》2026-11-06 修订 §1.3）：
  9 项统计都是**分组成员本人**的扁平求和，不递归下线；
  成员列表的输赢/贡献是「本人 + 整条下线」，两者不要互相对账。

注意：
  * 卡片底图是「行模板」同一条 `record_row_exact`（九宫格 inset 20），
    左右两侧要留 20px，别再往外撑。
  * 区间/备注走「备注」那行（SubText），别塞回「预警」行——13 个字会被 SHRINK 压到 16 号。
  * 可重复跑：按名字复用旧节点，跑完回收不可达对象。

用法：python3 tools/relayout_group_row.py [--check]
"""
import json
import os
import random
import string
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets/resources/UI/panelBossPlayerInfo.prefab")
ROW_NAME = "分组模板"
ROW_W, ROW_H = 690, 250

COLORS = {
    "white": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
    "gray": {"__type__": "cc.Color", "r": 150, "g": 168, "b": 186, "a": 255},
    "dim": {"__type__": "cc.Color", "r": 176, "g": 196, "b": 216, "a": 255},
    "gold": {"__type__": "cc.Color", "r": 255, "g": 231, "b": 112, "a": 255},
    "green": {"__type__": "cc.Color", "r": 151, "g": 211, "b": 57, "a": 255},
}

COL = (18, 145, 272)
# (节点名, x, y, w, h, fontSize, lineHeight, 水平对齐, 颜色, 初始文案)
SPEC = [
    ("分组名", -222, 84, 200, 40, 30, 39, 1, "gold", "分组名称"),
    ("预警", -222, 44, 200, 32, 24, 31, 1, "green", "预警 未设置"),
    ("备注", -222, 4, 200, 26, 20, 26, 1, "dim", "—"),
    ("成员数值", -222, -36, 200, 26, 20, 26, 1, "gray", "成员 0 人"),

    ("表头_输赢", COL[0], 84, 118, 26, 18, 24, 1, "gray", "输赢"),
    ("表头_贡献", COL[1], 84, 118, 26, 18, 24, 1, "gray", "贡献"),
    ("表头_红利", COL[2], 84, 118, 26, 18, 24, 1, "gray", "红利"),

    ("标签_今日", -70, 44, 52, 24, 20, 26, 1, "gray", "今日"),
    ("标签_昨日", -70, 4, 52, 24, 20, 26, 1, "gray", "昨日"),
    ("标签_累计", -70, -36, 52, 24, 20, 26, 1, "gray", "累计"),

    ("今日输赢值", COL[0], 44, 118, 34, 24, 31, 0, "white", "—"),
    ("昨日输赢值", COL[0], 4, 118, 34, 24, 31, 0, "white", "—"),
    ("累计输赢值", COL[0], -36, 118, 34, 24, 31, 0, "white", "—"),

    ("今日贡献值", COL[1], 44, 118, 34, 24, 31, 0, "gold", "—"),
    ("昨日贡献值", COL[1], 4, 118, 34, 24, 31, 0, "gold", "—"),
    ("累计贡献值", COL[1], -36, 118, 34, 24, 31, 0, "gold", "—"),

    ("今日红利值", COL[2], 44, 118, 34, 24, 31, 0, "gold", "—"),
    ("昨日红利值", COL[2], 4, 118, 34, 24, 31, 0, "gold", "—"),
    ("累计红利值", COL[2], -36, 118, 34, 24, 31, 0, "gold", "—"),
]

DIVIDER = ("资料分隔线", -104, 6, 2, 214)
# 一排三个，每个 200 宽、间隔 25、两侧各留 20
BUTTONS = [("成员", -225, -86, 200, 56, "成员"),
           ("加人", 0, -86, 200, 56, "＋ 加人"),
           ("删除分组", 225, -86, 200, 56, "删除分组")]
BUTTON_FONT = (26, 34)


def new_file_id():
    alphabet = string.ascii_letters + string.digits + "+/"
    return "c" + "".join(random.choice(alphabet) for _ in range(21))


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


def find_child(d, parent, name):
    for ref in parent.get("_children", []):
        if d[ref["__id__"]].get("_name") == name:
            return ref["__id__"]
    return None


def clone_node(d, src, parent, name):
    """复制 src 子树挂到 parent 下；name 为空时保留原子节点名。"""

    def build(index):
        d.append(json.loads(json.dumps(d[index])))
        return len(d) - 1

    root = build(src)
    comps = []
    for ref in d[src].get("_components", []):
        new_comp = build(ref["__id__"])
        d[new_comp]["node"] = {"__id__": root}
        comps.append({"__id__": new_comp})
    d[root]["_components"] = comps
    d[root]["_children"] = [{"__id__": clone_node(d, ref["__id__"], root, None)}
                            for ref in d[src].get("_children", [])]
    d[root]["_parent"] = {"__id__": parent}
    if name is not None:
        d[root]["_name"] = name
    d[root]["_id"] = ""
    info = build(d[src]["_prefab"]["__id__"])
    d[info]["fileId"] = new_file_id()
    d[root]["_prefab"] = {"__id__": info}
    return root


def collect_refs(obj):
    if isinstance(obj, dict):
        if len(obj) == 1 and "__id__" in obj:
            return [obj["__id__"]]
        out = []
        for value in obj.values():
            out.extend(collect_refs(value))
        return out
    if isinstance(obj, list):
        out = []
        for one in obj:
            out.extend(collect_refs(one))
        return out
    return []


def gc(d):
    seen, stack = set(), [0, 1]
    while stack:
        index = stack.pop()
        if index in seen or not (0 <= index < len(d)):
            continue
        seen.add(index)
        stack.extend(collect_refs(d[index]))
    dead = [i for i in range(len(d)) if i not in seen]
    if not dead:
        return d, 0
    keep = [i for i in range(len(d)) if i in seen]
    remap = {old: new for new, old in enumerate(keep)}

    def fix(obj):
        if isinstance(obj, dict):
            if len(obj) == 1 and "__id__" in obj:
                return {"__id__": remap[obj["__id__"]]}
            return {key: fix(value) for key, value in obj.items()}
        if isinstance(obj, list):
            return [fix(one) for one in obj]
        return obj

    return [fix(d[i]) for i in keep], len(dead)


def main():
    check_only = "--check" in sys.argv
    with open(PREFAB, encoding="utf-8") as handle:
        d = json.load(handle)

    row_index = None
    row_source = None
    for index, obj in enumerate(d):
        if obj.get("__type__") != "cc.Node":
            continue
        if obj.get("_name") == ROW_NAME:
            row_index = index
        if obj.get("_name") == "行模板":
            row_source = index
    if row_index is None or row_source is None:
        raise SystemExit("找不到 %s / 行模板" % ROW_NAME)

    row = d[row_index]
    old_children = {d[ref["__id__"]].get("_name"): ref["__id__"] for ref in row.get("_children", [])}
    template_label = old_children.get("备注") or old_children.get("分组名")
    if template_label is None:
        raise SystemExit("找不到可复制的 Label 节点")

    pool = dict(old_children)
    ordered = []
    for name, x, y, w, h, font, line, align, color, text in SPEC:
        index = pool.pop(name, None)
        if index is None:
            index = clone_node(d, template_label, row_index, name)
        node = d[index]
        node["_name"] = name
        node["_active"] = True
        set_trs(node, x, y)
        set_size(node, w, h)
        label = label_of(d, node)
        if label is None:
            raise SystemExit("%s 不是 Label 节点" % name)
        label["_string"] = text
        label["_N$string"] = text
        label["_fontSize"] = float(font)
        label["_lineHeight"] = float(line)
        label["_N$horizontalAlign"] = align
        label["_N$verticalAlign"] = 1
        label["_N$overflow"] = 2
        label["_enableWrapText"] = False
        label["_N$enableWrapText"] = False
        label["_contentSize"] = {"__type__": "cc.Size", "width": float(w), "height": float(h)}
        if color is None:
            label.pop("_color", None)
        else:
            label["_color"] = dict(COLORS[color])
        node["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
        ordered.append({"__id__": index})

    # 竖分隔线：优先复用已有的，**不要每次都 clone**（旧版这么干每跑一次多一份残留）
    div_name, dx, dy, dw, dh = DIVIDER
    divider = pool.pop(div_name, None)
    if divider is None:
        source = find_child(d, d[row_source], div_name)
        if source is None:
            raise SystemExit("行模板里没有 %s" % div_name)
        divider = clone_node(d, source, row_index, div_name)
    set_trs(d[divider], dx, dy)
    set_size(d[divider], dw, dh)
    d[divider]["_active"] = True
    ordered.append({"__id__": divider})

    # 底部按钮：沿用原按钮节点，只改尺寸位置
    for name, x, y, w, h, caption in BUTTONS:
        index = old_children.get(name)
        if index is None:
            raise SystemExit("找不到按钮 %s" % name)
        node = d[index]
        set_trs(node, x, y)
        set_size(node, w, h)
        node["_active"] = True
        text_index = find_child(d, node, "文字")
        if text_index is None:
            raise SystemExit("%s 缺少 文字 子节点" % name)
        text_node = d[text_index]
        set_trs(text_node, 0, 0)
        set_size(text_node, w - 10, h - 12)
        label = label_of(d, text_node)
        if label:
            label["_string"] = caption
            label["_N$string"] = caption
            label["_fontSize"] = float(BUTTON_FONT[0])
            label["_lineHeight"] = float(BUTTON_FONT[1])
            label["_contentSize"] = {"__type__": "cc.Size",
                                     "width": float(w - 10), "height": float(h - 12)}
        ordered.append({"__id__": index})

    row["_children"] = ordered
    set_size(row, ROW_W, ROW_H)

    leftovers = [name for name, index in old_children.items()
                 if index not in [ref["__id__"] for ref in ordered]]
    if leftovers:
        print("已退出布局（会被 gc 回收）->", leftovers)

    names = [d[ref["__id__"]]["_name"] for ref in row["_children"]]
    dup = {n for n in names if names.count(n) > 1}
    problems = []
    if dup:
        problems.append("重名节点: %s" % sorted(dup))
    boxes = {}
    for ref in row["_children"]:
        node = d[ref["__id__"]]
        x, y = node["_trs"]["array"][0], node["_trs"]["array"][1]
        w, h = node["_contentSize"]["width"], node["_contentSize"]["height"]
        boxes[node["_name"]] = (x - w / 2, x + w / 2, y - h / 2, y + h / 2)
        if x - w / 2 < -ROW_W / 2 - 0.5 or x + w / 2 > ROW_W / 2 + 0.5:
            problems.append("%s 横向越界 (%.0f..%.0f)" % (node["_name"], x - w / 2, x + w / 2))
        if y - h / 2 < -ROW_H / 2 - 0.5 or y + h / 2 > ROW_H / 2 + 0.5:
            problems.append("%s 纵向越界 (%.0f..%.0f)" % (node["_name"], y - h / 2, y + h / 2))

    def overlap(a, b):
        return a[0] < b[1] and b[0] < a[1] and a[2] < b[3] and b[2] < a[3]

    for name, _x, _y, _w, _h, _c in BUTTONS:
        for other in ("累计输赢值", "累计贡献值", "累计红利值", "成员数值", "标签_累计"):
            if name in boxes and other in boxes and overlap(boxes[name], boxes[other]):
                problems.append("%s 压到 %s" % (name, other))

    print("%s 子节点 %d 个：" % (ROW_NAME, len(row["_children"])))
    for ref in row["_children"]:
        node = d[ref["__id__"]]
        x, y = node["_trs"]["array"][0], node["_trs"]["array"][1]
        w, h = node["_contentSize"]["width"], node["_contentSize"]["height"]
        print("  %-10s x=%7.1f y=%7.1f w=%5.1f h=%5.1f" % (node["_name"], x, y, w, h))
    if problems:
        print("\n自检问题：")
        for one in problems:
            print("  -", one)
        raise SystemExit(1)
    print("\n自检通过（无重名/越界/按钮压数据）")

    if check_only:
        print("--check 模式：不写回")
        return

    d, removed = gc(d)
    if removed:
        print("已回收不可达对象 %d 个" % removed)
    with open(PREFAB, "w", encoding="utf-8") as handle:
        json.dump(d, handle, ensure_ascii=False, separators=(",", ":"))
    print("已写回", PREFAB, "（对象 %d）" % len(d))


if __name__ == "__main__":
    main()
