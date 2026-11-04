#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给房间奖池弹窗「奖池」页追加可配置的牌型比例列表。

- 隐藏原先写死的 3 行（含扑克牌）V8牌型行0..2；
- 新增「牌型列表」+ 5 行（天皇/地皇/朵皇/朵朵/单独丁儿皇），只保留名称和比例；
- 脚本按 reward_card_bili 显示比例 > 0 的行，并重排可见行。
同时修改运行场景 drh8.fire 和 panelGameView.prefab。
"""
import copy, json, os, random, string

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [
    (os.path.join(ROOT, "assets", "Scenes", "drh8.fire"), 6),
    (os.path.join(ROOT, "assets", "resources", "UI", "panelGameView.prefab"), 1),
]
ROW_FRAME = "f5615488-849d-52f2-a291-d4c0fa7ba873"  # V7 settlement_v8_list_panel
GOLD = (242, 214, 156, 255)
CREAM = (255, 240, 214, 255)
ALPHABET = string.ascii_letters + string.digits + "+/"
HANDS = ["天皇", "地皇", "朵皇", "朵朵", "单独丁儿皇"]


def fid():
    return "".join(random.choice(ALPHABET) for _ in range(22))


def find_path(d, root, path):
    cur = root
    for name in path.split("/"):
        nxt = [c["__id__"] for c in d[cur].get("_children", [])
               if d[c["__id__"]].get("_name") == name]
        if not nxt:
            return None
        cur = nxt[0]
    return cur


def comp_of(d, nid, tname):
    for c in d[nid].get("_components", []):
        if d[c["__id__"]].get("__type__") == tname:
            return c["__id__"]
    return None


def add_node(d, name, parent, size, pos=(0, 0), anchor=(0.5, 0.5), active=True,
             color=(255, 255, 255, 255), prefab_template=None):
    nid = len(d)
    d.append(None)
    # 直接深拷贝一个兄弟节点的 PrefabInfo，保证场景实例和 Prefab 内部都合法。
    tpl = d[prefab_template]["_prefab"]["__id__"]
    pidx = len(d)
    p = copy.deepcopy(d[tpl])
    p["fileId"] = fid()
    d.append(p)
    d[nid] = {
        "__type__": "cc.Node", "_name": name, "_objFlags": 0,
        "_parent": {"__id__": parent},
        "_children": [], "_active": active,
        "_components": [], "_prefab": {"__id__": pidx},
        "_opacity": 255,
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
    d[parent]["_children"].append({"__id__": nid})
    return nid


def add_comp(d, nid, template_id, **overrides):
    cid = len(d)
    d.append(copy.deepcopy(d[template_id]))
    d[cid]["node"] = {"__id__": nid}
    d[cid].update(overrides)
    d[nid]["_components"].append({"__id__": cid})
    return cid


def patch(path, root):
    d = json.load(open(path, encoding="utf-8"))
    view = find_path(d, root, "奖池面板/容器/奖池")
    if view is None:
        raise SystemExit("找不到奖池面板/容器/奖池: " + path)
    if find_path(d, root, "奖池面板/容器/奖池/牌型列表") is not None:
        print("skip (already patched):", path)
        return

    # 旧的写死行和扑克牌整行隐藏；比例区等配置回包后再显示。
    for i in range(3):
        old = find_path(d, root, "奖池面板/容器/奖池/V8牌型行%d" % i)
        if old is not None:
            d[old]["_active"] = False
    for c in d[view].get("_children", []):
        if str(d[c["__id__"]].get("_name", "")).startswith("V8原始牌面"):
            d[c["__id__"]]["_active"] = False
    for name in ["V8牌型表头", "V8规则", "V8分节标题"]:
        node = find_path(d, root, "奖池面板/容器/奖池/" + name)
        if node is not None:
            d[node]["_active"] = False

    current = find_path(d, root, "奖池面板/容器/奖池/当前级别")
    label_tpl = comp_of(d, current, "cc.Label")
    shadow_tpl = comp_of(d, current, "cc.LabelShadow")
    amount_bg = find_path(d, root, "奖池面板/容器/奖池/V8金额底板")
    sprite_tpl = comp_of(d, amount_bg, "cc.Sprite")
    content = find_path(d, root, "奖池面板/容器/奖池记录/记录列表/view/content")
    layout_tpl = comp_of(d, content, "cc.Layout")
    prefab_tpl = find_path(d, root, "奖池面板/容器/奖池/V8规则")

    container = add_node(d, "牌型列表", view, (855, 452), (0.5, -90), (0.5, 1),
                         active=False, prefab_template=prefab_tpl)
    add_comp(d, container, layout_tpl, **{
        "_layoutSize": {"__type__": "cc.Size", "width": 855, "height": 452},
        "_resize": 0, "_N$layoutType": 2, "_N$spacingY": 8,
        "_N$paddingTop": 0, "_N$paddingBottom": 0,
        "_N$verticalDirection": 1, "_N$horizontalDirection": 0})

    for i, name in enumerate(HANDS):
        row = add_node(d, "牌型_%d" % i, container, (855, 84), (0, 0), (0.5, 0.5),
                       active=False, prefab_template=prefab_tpl)
        add_comp(d, row, sprite_tpl,
                 _spriteFrame={"__uuid__": ROW_FRAME}, _type=1, _sizeMode=0)
        name_node = add_node(d, "名称", row, (320, 50), (-382, 0), (0, 0.5),
                             color=GOLD, prefab_template=prefab_tpl)
        add_comp(d, name_node, label_tpl, _string=name, **{
            "_N$string": name, "_fontSize": 34, "_lineHeight": 40,
            "_N$horizontalAlign": 0, "_N$overflow": 2, "_styleFlags": 1})
        if shadow_tpl is not None:
            add_comp(d, name_node, shadow_tpl)
        ratio = add_node(d, "比例", row, (220, 50), (384, 0), (1, 0.5),
                         color=CREAM, prefab_template=prefab_tpl)
        add_comp(d, ratio, label_tpl, _string="0%", **{
            "_N$string": "0%", "_fontSize": 38, "_lineHeight": 44,
            "_N$horizontalAlign": 2, "_N$overflow": 2, "_styleFlags": 1})
        if shadow_tpl is not None:
            add_comp(d, ratio, shadow_tpl)

    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("patched:", path, "objects:", len(d))


for path, root in FILES:
    patch(path, root)
