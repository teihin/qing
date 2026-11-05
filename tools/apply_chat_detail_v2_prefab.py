#!/usr/bin/env python3
"""把私聊详情改造成 V2 蓝金皮肤：头部圆钮、气泡模板、系统条、底部五入口。

只改 panelMessageChat.prefab 的节点尺寸/位置/颜色和新增「清除聊天」节点；
业务行为在 panelMessageChat.ts 中实现，不在美术 Prefab 里写逻辑。
"""

import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets", "resources", "UI", "panelMessageChat.prefab")
CLEAR_SF_UUID = "e88f0fa6-3e87-4c8c-bbf7-95153a91c47b"


def find_node(d, name):
    """优先返回挂在根节点下的同名节点（气泡模板里也有「语音」「文字」等同名节点）。"""
    matches = [i for i, o in enumerate(d)
               if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") == name]
    for i in matches:
        if (d[i].get("_parent") or {}).get("__id__") == 1:
            return i
    if matches:
        return matches[0]
    raise KeyError(name)


def child_by_name(d, node_id, name):
    for ch in d[node_id].get("_children", []):
        if d[ch["__id__"]].get("_name") == name:
            return ch["__id__"]
    raise KeyError(name)


def set_size(obj, w, h):
    obj["_contentSize"] = {"__type__": "cc.Size", "width": w, "height": h}


def set_pos(node, x, y):
    node["_trs"]["array"][0] = x
    node["_trs"]["array"][1] = y


def set_widget(d, node_id, **kwargs):
    for c in d[node_id].get("_components", []):
        comp = d[c["__id__"]]
        if comp.get("__type__") == "cc.Widget":
            comp.update(kwargs)
            return
    raise KeyError("widget not found: " + d[node_id].get("_name", str(node_id)))


def set_node_color(node, r, g, b, a=255):
    node["_color"] = {"__type__": "cc.Color", "r": r, "g": g, "b": b, "a": a}


def set_label_font(d, node_id, size):
    for c in d[node_id].get("_components", []):
        comp = d[c["__id__"]]
        if comp.get("__type__") == "cc.Label":
            comp["_fontSize"] = size


def new_file_id():
    return "".join(random.choice("0123456789abcdef") for _ in range(24))


def main():
    with open(PREFAB, encoding="utf-8") as f:
        d = json.load(f)

    # ---------- 头部 ----------
    back = find_node(d, "返回")
    set_size(d[back], 76, 76)
    set_pos(d[back], -321, 607)
    set_widget(d, back, _left=16, _top=22)

    delete = find_node(d, "删除")
    set_size(d[delete], 76, 76)
    set_pos(d[delete], 321, 607)
    set_widget(d, delete, _right=16, _top=22)

    set_pos(d[find_node(d, "标题")], 0, 609)

    # ---------- 列表区域 ----------
    set_widget(d, find_node(d, "列表"), _top=112, _bottom=300)
    set_widget(d, find_node(d, "顶部提示"), _top=118)

    # ---------- 气泡模板 ----------
    for name in ("消息-左", "消息-右"):
        row = find_node(d, name)
        set_size(d[child_by_name(d, row, "头像")], 64, 64)
        set_size(d[child_by_name(d, row, "气泡")], 240, 68)

    divider = find_node(d, "时间条")
    set_label_font(d, child_by_name(d, divider, "时间"), 20)

    # ---------- 底部输入区 ----------
    voice = find_node(d, "语音")
    set_size(d[voice], 88, 88)
    set_widget(d, voice, _left=26, _bottom=196)

    input_node = find_node(d, "输入")
    set_size(d[input_node], 482, 88)
    set_widget(d, input_node, _left=128, _right=140, _bottom=196)

    send = find_node(d, "发送")
    set_size(d[send], 132, 88)
    set_widget(d, send, _right=16, _bottom=196)
    send_label = child_by_name(d, send, "文字")
    set_label_font(d, send_label, 30)
    set_node_color(d[send_label], 44, 26, 6)

    # ---------- 底部五入口 ----------
    order = ["拍照上传", "发送图片", "赠送积分", "上下分"]
    xs = [-274, -137, 0, 137, 274]
    for name, x in zip(order, xs):
        node_id = find_node(d, name)
        set_size(d[node_id], 108, 108)
        set_pos(d[node_id], x, -537)
        set_widget(d, node_id, _bottom=76)

    # ---------- 新增「清除聊天」 ----------
    src = find_node(d, "上下分")
    src_node = d[src]
    src_sprite = d[src_node["_components"][0]["__id__"]]
    src_button = d[src_node["_components"][1]["__id__"]]
    src_widget = d[src_node["_components"][2]["__id__"]]
    src_info = d[src_node["_prefab"]["__id__"]]
    src_label_node_id = child_by_name(d, src, "文字")
    src_label_node = d[src_label_node_id]
    src_label = d[src_label_node["_components"][0]["__id__"]]
    src_label_info = d[src_label_node["_prefab"]["__id__"]]

    base = len(d)
    node_id = base
    sprite_id = base + 1
    button_id = base + 2
    info_node_id = base + 3
    label_node_id = base + 4
    label_id = base + 5
    info_label_id = base + 6
    widget_id = base + 7

    node = json.loads(json.dumps(src_node))
    node["_name"] = "清除聊天"
    node["_parent"] = {"__id__": 1}
    node["_children"] = [{"__id__": label_node_id}]
    node["_components"] = [{"__id__": sprite_id}, {"__id__": button_id}, {"__id__": widget_id}]
    node["_prefab"] = {"__id__": info_node_id}
    node["_active"] = True
    set_size(node, 108, 108)
    set_pos(node, 274, -537)
    d.append(node)

    sprite = json.loads(json.dumps(src_sprite))
    sprite["node"] = {"__id__": node_id}
    sprite["_spriteFrame"] = {"__uuid__": CLEAR_SF_UUID, "__expectedType__": "cc.SpriteFrame"}
    d.append(sprite)

    button = json.loads(json.dumps(src_button))
    button["node"] = {"__id__": node_id}
    d.append(button)

    info_node = json.loads(json.dumps(src_info))
    info_node["fileId"] = new_file_id()
    d.append(info_node)

    label_node = json.loads(json.dumps(src_label_node))
    label_node["_parent"] = {"__id__": node_id}
    label_node["_components"] = [{"__id__": label_id}]
    label_node["_prefab"] = {"__id__": info_label_id}
    d.append(label_node)

    label = json.loads(json.dumps(src_label))
    label["node"] = {"__id__": label_node_id}
    label["_string"] = "清除聊天"
    d.append(label)

    info_label = json.loads(json.dumps(src_label_info))
    info_label["fileId"] = new_file_id()
    d.append(info_label)

    widget = json.loads(json.dumps(src_widget))
    widget["node"] = {"__id__": node_id}
    widget["_bottom"] = 76
    d.append(widget)

    d[1]["_children"].append({"__id__": node_id})

    with open(PREFAB, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    print("新增 清除聊天 node=%d sprite=%d label=%d" % (node_id, sprite_id, label_id))


if __name__ == "__main__":
    main()
