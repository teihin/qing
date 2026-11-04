#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 panelGameSettings.prefab（游戏设置 · 奖池设置）。

只写 assets/resources/UI/panelGameSettings.prefab(.meta)；
SpriteFrame 全部复用既有 V7 资源与本目录 gs_* 切图。

注意：池级总开关行由 tools/patch_game_settings_pool_switch.py 追加；
重建后必须再运行该补丁，且本脚本会换 Prefab UUID（现有正式文件不要用它覆盖）。
"""
import json, os, uuid, base64, random, string

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAT = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
FONT = "fd7307b2-666e-4c26-963d-59f787cad6fb"
BLACK = "a23235d1-15db-4b95-8439-a2e005bfff91"
GOLD = (242, 214, 156, 255)
CREAM = (255, 240, 214, 255)
GRAY = (143, 166, 186, 255)
WHITE = (234, 242, 252, 255)
DARK = (48, 30, 8, 255)
DARKOUT = (2, 18, 31, 255)

BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def compress_uuid(u):
    s = u.replace("-", "")
    out = s[:5]
    for i in range(5, 32, 3):
        v = int(s[i:i + 3], 16)
        out += BASE64[v >> 6] + BASE64[v & 63]
    return out


def sf_uuid(meta_path):
    j = json.load(open(meta_path, encoding="utf-8"))
    return list(j["subMetas"].values())[0]["uuid"]


def gs(name):
    return sf_uuid(os.path.join(ROOT, "assets", "V8", "game_settings", name + ".png.meta"))


V7 = lambda n: sf_uuid(os.path.join(ROOT, "assets", "V7", n + ".png.meta"))

SPR = {
    "bg": V7("lobby_scene_long_v8"),
    "header": V7("personal_info2_header_bg_v8"),
    "row": V7("settlement_v8_list_panel"),
    "panel": V7("club_settings_panel_v8"),
    "toggle_on": V7("register_toggle_on_exact"),
    "toggle_off": V7("register_toggle_off_exact"),
    "gear_btn": gs("gs_gear_btn"),
    "badge": gs("gs_badge_star"),
    "tab_on": gs("gs_tab_on"),
    "tab_off": gs("gs_tab_off"),
    "chip": gs("gs_chip"),
    "input": gs("gs_input"),
    "btn_gold": gs("gs_btn_gold"),
    "back": gs("gs_back"),
}

PREFAB_UUID = str(uuid.uuid4())
SCRIPT_UUID = "9c1f7a3e-5b24-4d68-9e0f-2a7c4b8d6e51"
SCRIPT_TYPE = compress_uuid(SCRIPT_UUID)


class N:
    def __init__(self, name, pos=(0, 0), size=(100, 100), anchor=(0.5, 0.5),
                 active=True, opacity=255, color=(255, 255, 255, 255)):
        self.name, self.pos, self.size, self.anchor = name, pos, size, anchor
        self.active, self.opacity, self.color = active, opacity, color
        self.comps, self.children = [], []
        self.nid = -1

    def add(self, child):
        self.children.append(child)
        return child


def sprite(n, frame, sliced=False):
    n.comps.append({"kind": "sprite", "frame": frame, "sliced": sliced})
    return n


def widget(n, flags, left=0, right=0, top=0, bottom=0, hc=0, vc=0,
           ow=None, oh=None, align=1):
    n.comps.append({"kind": "widget", "flags": flags, "left": left, "right": right,
                    "top": top, "bottom": bottom, "hc": hc, "vc": vc,
                    "ow": ow if ow is not None else n.size[0],
                    "oh": oh if oh is not None else n.size[1], "align": align})
    return n


def label(n, text, fs, color, h_align=1, bold=True, outline=None, ow=1):
    n.color = color
    n.comps.append({"kind": "label", "text": text, "fs": fs, "color": color,
                    "h": h_align, "bold": bold, "outline": outline})
    if outline:
        n.comps.append({"kind": "outline", "color": outline[0], "width": outline[1]})
    return n


def button(n):
    n.comps.append({"kind": "button"})
    return n


def editbox(n, text, placeholder):
    n.comps.append({"kind": "editbox", "text": text, "placeholder": placeholder})
    return n


def fid():
    return base64.b64encode(bytes(random.getrandbits(8) for _ in range(16))).decode()[:22]


def build(n, parent_id=None, is_root=False, objs=None):
    if objs is None:
        objs = []
    n.nid = len(objs)
    objs.append(None)
    pidx = len(objs)
    objs.append(None)
    for c in n.children:
        build(c, n.nid, False, objs)
    comp_ids = []
    for c in n.comps:
        cid = len(objs)
        objs.append(None)
        comp_ids.append(cid)

    node = {
        "__type__": "cc.Node", "_name": n.name, "_objFlags": 0,
        "_parent": {"__id__": parent_id} if parent_id is not None else None,
        "_children": [{"__id__": c.nid} for c in n.children],
        "_active": n.active,
        "_components": [{"__id__": i} for i in comp_ids],
        "_prefab": {"__id__": pidx},
        "_opacity": n.opacity,
        "_color": {"__type__": "cc.Color", "r": n.color[0], "g": n.color[1],
                   "b": n.color[2], "a": n.color[3]},
        "_contentSize": {"__type__": "cc.Size", "width": n.size[0], "height": n.size[1]},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": n.anchor[0], "y": n.anchor[1]},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                 "array": [n.pos[0], n.pos[1], 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0,
        "groupIndex": 0, "_id": ""
    }
    objs[n.nid] = node
    objs[pidx] = {"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                  "asset": {"__uuid__": PREFAB_UUID}, "fileId": fid(), "sync": False}
    if is_root:
        node["_components"].append({"__id__": len(objs)})
        objs.append({"__type__": SCRIPT_TYPE, "_name": "", "_objFlags": 0,
                     "_enabled": True, "_id": "", "node": {"__id__": n.nid}})

    def at(name):
        for c in n.children:
            if c.name == name:
                return c.nid
        return None

    def comp_of(node_name, type_name):
        cid = at(node_name)
        if cid is None:
            return None
        for cc in objs[cid].get("_components", []):
            if objs[cc["__id__"]].get("__type__") == type_name:
                return cc["__id__"]
        return None

    for comp, cid in zip(n.comps, comp_ids):
        k = comp["kind"]
        if k == "sprite":
            objs[cid] = {"__type__": "cc.Sprite", "_name": "", "_objFlags": 0,
                         "_enabled": True, "node": {"__id__": n.nid},
                         "_materials": [{"__uuid__": MAT}],
                         "_srcBlendFactor": 770, "_dstBlendFactor": 771,
                         "_spriteFrame": {"__uuid__": comp["frame"]} if comp["frame"] else None,
                         "_type": 1 if comp["sliced"] else 0, "_sizeMode": 0,
                         "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
                         "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": False,
                         "_atlas": None, "_id": ""}
        elif k == "widget":
            objs[cid] = {"__type__": "cc.Widget", "_name": "", "_objFlags": 0,
                         "_enabled": True, "alignMode": comp["align"], "_target": None,
                         "_alignFlags": comp["flags"], "_left": comp["left"], "_right": comp["right"],
                         "_top": comp["top"], "_bottom": comp["bottom"],
                         "_verticalCenter": comp["vc"], "_horizontalCenter": comp["hc"],
                         "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True,
                         "_isAbsBottom": True, "_isAbsHorizontalCenter": True,
                         "_isAbsVerticalCenter": True,
                         "_originalWidth": comp["ow"], "_originalHeight": comp["oh"],
                         "_id": "", "node": {"__id__": n.nid}}
        elif k == "label":
            objs[cid] = {"__type__": "cc.Label", "_name": "", "_objFlags": 0,
                         "_enabled": True, "node": {"__id__": n.nid},
                         "_materials": [{"__uuid__": MAT}],
                         "_srcBlendFactor": 770, "_dstBlendFactor": 771,
                         "_string": comp["text"], "_N$string": comp["text"],
                         "_fontSize": comp["fs"], "_lineHeight": int(comp["fs"] * 1.18),
                         "_enableWrapText": False, "_N$file": {"__uuid__": FONT},
                         "_isSystemFontUsed": False, "_spacingX": 0,
                         "_batchAsBitmap": False, "_styleFlags": 1 if comp["bold"] else 0,
                         "_underlineHeight": 2, "_N$horizontalAlign": comp["h"],
                         "_N$verticalAlign": 1, "_N$fontFamily": "Arial",
                         "_N$overflow": 2, "_N$cacheMode": 0, "_id": ""}
        elif k == "outline":
            objs[cid] = {"__type__": "cc.LabelOutline", "_name__": "", "_objFlags": 0,
                         "_enabled": True, "node": {"__id__": n.nid},
                         "_color": {"__type__": "cc.Color", "r": comp["color"][0],
                                    "g": comp["color"][1], "b": comp["color"][2], "a": 255},
                         "_width": comp["width"], "_id": ""}
            objs[cid].pop("_name__", None)
            objs[cid]["_name"] = ""
        elif k == "button":
            objs[cid] = {
                "__type__": "cc.Button", "_name": "", "_objFlags": 0, "_enabled": True,
                "_normalMaterial": {"__uuid__": MAT}, "_grayMaterial": None,
                "duration": 0.1, "zoomScale": 0.94, "clickEvents": [],
                "_N$interactable": True, "_N$enableAutoGrayEffect": False,
                "_N$transition": 3, "transition": 3,
                "_N$normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
                "_N$pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
                "pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
                "_N$hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
                "hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
                "_N$disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
                "_N$normalSprite": None, "_N$pressedSprite": None, "pressedSprite": None,
                "_N$hoverSprite": None, "_N$disabledSprite": None, "_N$target": None,
                "_id": "", "node": {"__id__": n.nid}}
        elif k == "editbox":
            bg = at("BACKGROUND_SPRITE")
            tl = at("TEXT_LABEL")
            pl = at("PLACEHOLDER_LABEL")
            objs[cid] = {
                "__type__": "cc.EditBox", "_name": "", "_objFlags": 0, "_enabled": True,
                "_useOriginalSize": False, "_string": comp["text"], "returnType": 0,
                "maxLength": 3, "_tabIndex": 0, "editingDidBegan": [], "textChanged": [],
                "editingDidEnded": [], "editingReturn": [],
                "_N$textLabel": {"__id__": comp_of("TEXT_LABEL", "cc.Label")},
                "_N$placeholderLabel": {"__id__": comp_of("PLACEHOLDER_LABEL", "cc.Label")},
                "_N$background": {"__id__": None}, "_N$inputFlag": 5, "_N$inputMode": 2,
                "_N$stayOnTop": False, "_id": "", "_N$fontSize": 34, "fontSize": 34,
                "_N$placeholderFontSize": 28, "placeholderFontSize": 28,
                "_N$fontColor": {"__type__": "cc.Color", "r": 255, "g": 244, "b": 220, "a": 255},
                "fontColor": {"__type__": "cc.Color", "r": 255, "g": 244, "b": 220, "a": 255},
                "_N$placeholderFontColor": {"__type__": "cc.Color", "r": 120, "g": 154, "b": 182, "a": 255},
                "placeholderFontColor": {"__type__": "cc.Color", "r": 120, "g": 154, "b": 182, "a": 255},
                "node": {"__id__": n.nid}}
            objs[cid]["_N$background"] = {"__id__": None}
        elif k == "layout":
            objs[cid] = {"__type__": "cc.Layout", "_name": "", "_objFlags": 0,
                         "_enabled": True, "node": {"__id__": n.nid},
                         "_layoutSize": {"__type__": "cc.Size", "width": n.size[0], "height": n.size[1]},
                         "_resize": 0, "_N$layoutType": 2,
                         "_N$cellSize": {"__type__": "cc.Size", "width": 100, "height": 100},
                         "_N$startAxis": 0, "_N$paddingLeft": 0, "_N$paddingRight": 0,
                         "_N$paddingTop": comp.get("pt", 0), "_N$paddingBottom": 0,
                         "_N$spacingX": 0, "_N$spacingY": comp.get("sy", 16),
                         "_N$verticalDirection": 1, "_N$horizontalDirection": 0,
                         "_N$affectedByScale": False, "_id": ""}
    return n


BACKGROUND_SPRITE_COMP_ID = [0]


def text_node(name, text, fs, color, pos, size, h_align=1, anchor=(0.5, 0.5),
              bold=True, outline=None):
    n = N(name, pos, size, anchor)
    label(n, text, fs, color, h_align, bold, outline)
    return n


def chip_btn(name, text, pos, size=(124, 56), frame="chip", fs=26, color=CREAM,
             gold=False):
    n = N(name, pos, size)
    sprite(n, SPR[frame], sliced=True)
    button(n)
    lab = text_node("文字", text, fs, DARK if gold else color, (0, 0), size)
    n.add(lab)
    return n


def build_tree():
    root = N("panelGameSettings", (0, 0), (750, 1334))
    widget(root, 45, 0, 0, 0, 0, 0, 0, 750, 1334)

    bg = N("大厅背景", (0, -270), (750, 1875))
    sprite(bg, SPR["bg"])
    widget(bg, 17, 0, 0, 0, 0, 0, 0, 750, 1875)
    root.add(bg)

    dim = N("暗化", (0, 0), (750, 1334), color=(0, 0, 0, 255), opacity=105)
    sprite(dim, BLACK, sliced=False)
    widget(dim, 45, 0, 0, 0, 0)
    root.add(dim)

    head = N("顶栏", (0, 631), (750, 72))
    sprite(head, SPR["header"])
    widget(head, 41, 0, 0, 0, 0, 0, 0, 750, 72)
    back = N("返回", (-325, 0), (96, 72))
    button(back)
    widget(back, 17, 0, 0, 0, 0, -325, 0, 96, 72)
    arrow = N("箭头", (0, 0), (40, 40))
    sprite(arrow, SPR["back"])
    back.add(arrow)
    head.add(back)
    head.add(text_node("标题", "游戏设置", 38, GOLD, (0, 2), (320, 52), 1,
                       (0.5, 0.5), True, (DARKOUT, 1.5)))
    root.add(head)

    tabs = N("页签", (0, 554), (702, 64))
    widget(tabs, 41, 24, 24, 92, 0, 0, 0, 702, 64)
    names = ["奖池设置", "牌桌设置", "提示音设置", "其他设置"]
    for i, name in enumerate(names):
        tab = N("页签_%d" % i, (-258 + i * 172, 0), (160, 64))
        sprite(tab, SPR["tab_on"] if i == 0 else SPR["tab_off"], sliced=True)
        button(tab)
        tab.add(text_node("文字", name, 28, DARK if i == 0 else (169, 192, 214, 255),
                          (0, 0), (160, 64)))
        tabs.add(tab)
    root.add(tabs)

    card = N("卡片", (0, -68), (702, 1118))
    sprite(card, SPR["panel"], sliced=True)
    widget(card, 45, 24, 24, 176, 40, 0, 0, 702, 1118)
    card_title = text_node("卡片标题", "奖池设置", 32, GOLD, (-254, 508), (320, 46),
                           0, (0, 0.5), True, (DARKOUT, 1))
    widget(card_title, 9, 76, 0, 22, 0, 0, 0, 320, 46)
    card.add(card_title)
    card_sub = text_node("卡片说明", "各牌型奖池开关与分红比例", 22, GRAY, (-254, 464),
                         (420, 32), 0, (0, 0.5))
    widget(card_sub, 9, 76, 0, 70, 0, 0, 0, 420, 32)
    card.add(card_sub)
    badge = N("卡片图标", (-286, 506), (44, 44))
    sprite(badge, SPR["badge"])
    widget(badge, 9, 28, 0, 25, 0, 0, 0, 44, 44)
    card.add(badge)

    rows = N("列表", (0, -22), (654, 628))
    rows.comps.append({"kind": "layout", "sy": 12})
    widget(rows, 41, 0, 0, 110, 0, 0, 0, 654, 628)
    tiers = [("天皇", 20), ("地皇", 10), ("朵皇", 10), ("朵朵", 2), ("单独丁儿皇", 2)]
    for i, (name, pct) in enumerate(tiers):
        row = N("行_%d" % i, (0, 0), (654, 116))
        sprite(row, SPR["row"], sliced=True)
        b = N("徽章", (-288, 0), (48, 48))
        sprite(b, SPR["badge"])
        row.add(b)
        row.add(text_node("名称", name, 32, GOLD, (-246, 0), (280, 44), 0, (0, 0.5),
                          True, (DARKOUT, 1)))
        sw = N("开关_%d" % i, (122, 0), (104, 52))
        button(sw)
        on = N("开", (0, 0), (104, 52))
        sprite(on, SPR["toggle_on"])
        on.add(text_node("文字", "开", 20, (255, 242, 216, 255), (-24, 0), (38, 38),
                         1, (0.5, 0.5), True, (DARKOUT, 1)))
        off = N("关", (0, 0), (104, 52), active=False)
        sprite(off, SPR["toggle_off"])
        off.add(text_node("文字", "关", 20, (255, 242, 216, 255), (24, 0), (38, 38),
                          1, (0.5, 0.5), True, (DARKOUT, 1)))
        sw.add(on)
        sw.add(off)
        row.add(sw)
        pc = N("比例_%d" % i, (260, 0), (124, 52))
        sprite(pc, SPR["chip"], sliced=True)
        button(pc)
        pc.add(text_node("数值", "%d%%" % pct, 26, CREAM, (0, 0), (124, 52)))
        row.add(pc)
        rows.add(row)
    card.add(rows)

    total = text_node("合计", "合计 44% · 各档独立按底皮奖池计算", 22, GRAY, (0, -529),
                      (654, 32))
    widget(total, 44, 0, 0, 0, 14, 0, 0, 654, 32)
    card.add(total)
    root.add(card)

    modal = N("弹窗", (0, 0), (750, 1334), active=False)
    widget(modal, 45, 0, 0, 0, 0)
    mask = N("弹窗遮罩", (0, 0), (750, 1334), color=(0, 0, 0, 255), opacity=160)
    sprite(mask, BLACK)
    button(mask)
    widget(mask, 45, 0, 0, 0, 0)
    modal.add(mask)

    pane = N("面板", (0, 0), (620, 560))
    sprite(pane, SPR["panel"], sliced=True)
    modal.add(pane)
    pane.add(text_node("标题", "修改奖池比例", 34, GOLD, (0, 222), (500, 48), 1,
                       (0.5, 0.5), True, (DARKOUT, 1.5)))
    pane.add(text_node("副标题", "当前牌型：天皇", 24, GRAY, (0, 178), (500, 34)))

    eb = N("输入", (0, 100), (380, 84))
    eb_bg = N("BACKGROUND_SPRITE", (0, 0), (380, 84))
    sprite(eb_bg, SPR["input"], sliced=True)
    eb.add(eb_bg)
    eb_txt = N("TEXT_LABEL", (0, 0), (380, 84), anchor=(0, 1))
    label(eb_txt, "", 34, CREAM)
    widget(eb_txt, 45, 18, 8, 4, 4, 0, 0, 380, 84)
    eb.add(eb_txt)
    eb_ph = N("PLACEHOLDER_LABEL", (0, 0), (380, 84), anchor=(0, 1))
    label(eb_ph, "0-100", 28, (120, 154, 182, 255))
    widget(eb_ph, 45, 18, 8, 4, 4, 0, 0, 380, 84)
    eb.add(eb_ph)
    editbox(eb, "20", "0-100")
    pane.add(eb)

    for i, v in enumerate([5, 10, 20, 25]):
        pane.add(chip_btn("快捷%d" % v, "%d%%" % v, (-204 + i * 136, 14)))

    pane.add(text_node("提示", "其余牌型共占 80%，本项最多可改到 20%", 20, GRAY,
                       (0, -58), (540, 30)))
    pane.add(chip_btn("弹窗取消", "取消", (-125, -200), (220, 64), "chip", 30, GRAY))
    pane.add(chip_btn("弹窗确定", "确定", (125, -200), (220, 64), "btn_gold", 30, DARK, True))
    root.add(modal)
    return root


def main():
    root = build_tree()
    objs = [{"__type__": "cc.Prefab", "_name": "", "_objFlags": 0, "_native": "",
             "data": {"__id__": 1}, "optimizationPolicy": 0,
             "asyncLoadAssets": False, "readonly": False}]
    build(root, None, True, objs)

    # EditBox 的 background 指向 BACKGROUND_SPRITE 的 Sprite 组件 id
    # build 阶段无法提前知道，统一在成品里按节点名回填。
    node_by_name = {}
    for i, o in enumerate(objs):
        if isinstance(o, dict) and o.get("__type__") == "cc.Node":
            node_by_name.setdefault(o.get("_name"), i)
    bg_node = node_by_name.get("BACKGROUND_SPRITE")
    bg_comp = objs[bg_node]["_components"][0]["__id__"] if bg_node is not None else None
    for o in objs:
        if isinstance(o, dict) and o.get("__type__") == "cc.EditBox":
            o["_N$background"] = {"__id__": bg_comp}

    out = os.path.join(ROOT, "assets", "resources", "UI", "panelGameSettings.prefab")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(objs, f, ensure_ascii=False, indent=2)
    meta = {
        "ver": "1.3.2", "uuid": PREFAB_UUID, "importer": "prefab",
        "optimizationPolicy": "AUTO", "asyncLoadAssets": False,
        "readonly": False, "subMetas": {},
    }
    with open(out + ".meta", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("prefab:", out)
    print("prefab uuid:", PREFAB_UUID)
    print("script class id:", SCRIPT_TYPE, "len", len(SCRIPT_TYPE))


if __name__ == "__main__":
    main()
