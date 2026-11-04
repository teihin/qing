#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 panelGameSettings.prefab 追加池级总开关 reward_on 行。

内容：卡片顶部「奖池总开关」行（名称 / 说明 / 开关），牌型比例列表下移到 top 182。
只做增量补丁：保留既有节点、组件与 Prefab UUID，新节点追加到 objs 末尾。
模板组件全部从现有节点深拷贝，避免手写 JSON 结构漂移。
"""
import copy, json, os, random, string

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets", "resources", "UI", "panelGameSettings.prefab")

p = json.load(open(PREFAB, encoding="utf-8"))
if any(o.get("__type__") == "cc.Node" and o.get("_name") == "池总开关行" for o in p):
    raise SystemExit("panelGameSettings.prefab 已包含总开关行，跳过重复补丁")
ROOT_ASSET = copy.deepcopy(p[2]["asset"])
ALPHABET = string.ascii_letters + string.digits + "+/"


def fid():
    return "".join(random.choice(ALPHABET) for _ in range(22))


def node_by_path(path):
    cur = 1
    for name in path.split("/"):
        found = None
        for c in p[cur]["_children"]:
            if p[c["__id__"]]["_name"] == name:
                found = c["__id__"]
                break
        if found is None:
            raise KeyError(path + " -> " + name)
        cur = found
    return cur


def comp_of(nid, tname):
    for c in p[nid]["_components"]:
        if p[c["__id__"]]["__type__"] == tname:
            return c["__id__"]
    return None


def add_node(name, parent, size, pos=(0, 0), anchor=(0.5, 0.5), active=True,
             opacity=255, color=(255, 255, 255, 255)):
    nid = len(p)
    p.append(None)
    pidx = len(p)
    p.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
              "asset": copy.deepcopy(ROOT_ASSET), "fileId": fid(), "sync": False})
    p[nid] = {
        "__type__": "cc.Node", "_name": name, "_objFlags": 0,
        "_parent": {"__id__": parent},
        "_children": [], "_active": active,
        "_components": [], "_prefab": {"__id__": pidx},
        "_opacity": opacity,
        "_color": {"__type__": "cc.Color", "r": color[0], "g": color[1],
                   "b": color[2], "a": color[3]},
        "_contentSize": {"__type__": "cc.Size", "width": size[0], "height": size[1]},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": anchor[0], "y": anchor[1]},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                 "array": [pos[0], pos[1], 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0,
        "groupIndex": 0, "_id": "",
    }
    p[parent]["_children"].append({"__id__": nid})
    return nid


def add_comp(nid, template_id, **overrides):
    cid = len(p)
    p.append(copy.deepcopy(p[template_id]))
    p[cid]["node"] = {"__id__": nid}
    p[cid].update(overrides)
    p[nid]["_components"].append({"__id__": cid})
    return cid


def add_label(name, parent, text, fs, color, pos, size, anchor=(0.5, 0.5),
              template_path="卡片/列表/行_0/名称", outline=False, bold=True):
    nid = add_node(name, parent, size, pos, anchor, color=color)
    mid = node_by_path(template_path)
    add_comp(nid, comp_of(mid, "cc.Label"), _string=text, **{
        "_N$string": text, "_fontSize": fs, "_lineHeight": int(fs * 1.18),
        "_styleFlags": 1 if bold else 0})
    if outline:
        oid = comp_of(mid, "cc.LabelOutline")
        if oid:
            add_comp(nid, oid)
    return nid


def add_sprite(name, parent, size, pos, frame_uuid, sliced=True, anchor=(0.5, 0.5),
               active=True, template_path="卡片/列表/行_0"):
    nid = add_node(name, parent, size, pos, anchor, active=active)
    add_comp(nid, comp_of(node_by_path(template_path), "cc.Sprite"),
             _spriteFrame={"__uuid__": frame_uuid}, _type=1 if sliced else 0)
    return nid


card = node_by_path("卡片")
bili_list = node_by_path("卡片/列表")
row0 = node_by_path("卡片/列表/行_0")
switch_tpl = node_by_path("卡片/列表/行_0/开关_0")
toggle_on_frame = p[comp_of(node_by_path("卡片/列表/行_0/开关_0/开"), "cc.Sprite")]["_spriteFrame"]["__uuid__"]
toggle_off_frame = p[comp_of(node_by_path("卡片/列表/行_0/开关_0/关"), "cc.Sprite")]["_spriteFrame"]["__uuid__"]

GOLD = (242, 214, 156, 255)
CREAM = (255, 240, 214, 255)
GRAY = (143, 166, 186, 255)

# ---------------------------------------------------------------- 池级总开关 reward_on
bili_widget = comp_of(bili_list, "cc.Widget")
p[bili_widget]["_top"] = 182  # 顶部让出总开关行
pool_row = add_node("池总开关行", card, (654, 64), (0, 0))
add_comp(pool_row, comp_of(row0, "cc.Sprite"))
add_comp(pool_row, bili_widget, _top=110, _originalWidth=654, _originalHeight=64)
add_label("名称", pool_row, "奖池总开关", 26, GOLD, (-246, 12), (300, 34),
          (0, 0.5), outline=True)
add_label("说明", pool_row, "关闭后不进池、不派奖、不提留", 16, GRAY, (-246, -18),
          (300, 22), (0, 0.5), bold=False)
pool_sw = add_node("池总开关", pool_row, (104, 52), (122, 0))
add_comp(pool_sw, comp_of(switch_tpl, "cc.Button"))
on = add_sprite("开", pool_sw, (104, 52), (0, 0), toggle_on_frame,
                template_path="卡片/列表/行_0/开关_0/开", active=False)
add_label("文字", on, "开", 20, CREAM, (-24, 0), (38, 38),
          template_path="卡片/列表/行_0/开关_0/开/文字", outline=True)
off = add_sprite("关", pool_sw, (104, 52), (0, 0), toggle_off_frame,
                 template_path="卡片/列表/行_0/开关_0/关", active=True)
add_label("文字", off, "关", 20, CREAM, (24, 0), (38, 38),
          template_path="卡片/列表/行_0/开关_0/关/文字", outline=True)

json.dump(p, open(PREFAB, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("patched:", PREFAB)
print("objects:", len(p))
