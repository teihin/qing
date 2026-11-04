#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 panelGameSettings.prefab（游戏设置 · 奖池设置）。

只写 assets/resources/UI/panelGameSettings.prefab(.meta)；
SpriteFrame 全部复用既有 V7 资源与本目录 gs_* 切图。

当前正式布局：单页签「奖池设置」内用滚动区容纳 5 档牌型比例 + 8 个底皮奖池数量；
Prefab UUID 固定沿用现有正式文件，避免资源引用漂移。不要用其它随机 UUID 覆盖。
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
CYAN = (120, 220, 250, 255)
RED = (255, 176, 162, 255)

# 创建游戏规则只开放 1/3 起到底皮 20/40；0.1/0.2 与 50/100 不在前台提供。
DIPI_OPTIONS = (
    ("1", "1/3", 50),
    ("2", "2/5", 100),
    ("5", "5/10", 250),
    ("10", "10/20", 500),
    ("20", "20/40", 1000),
)

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
    "badge": gs("gs_badge_star"),
    "tab_on": gs("gs_tab_on"),
    "tab_off": gs("gs_tab_off"),
    "chip": gs("gs_chip"),
    "input": gs("gs_input"),
    "btn_gold": gs("gs_btn_gold"),
    "back": gs("gs_back"),
}

PREFAB_UUID = "1d247d66-a2b2-4c04-a530-99d156851e8b"
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


def label(n, text, fs, color, h_align=1, bold=True, outline=None, ow=1,
          wrap=False, lh=None, overflow=None):
    n.color = color
    n.comps.append({"kind": "label", "text": text, "fs": fs, "color": color,
                    "h": h_align, "bold": bold, "outline": outline,
                    "wrap": wrap, "lh": lh, "overflow": overflow})
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
                         "_fontSize": comp["fs"],
                         "_lineHeight": comp["lh"] or int(comp["fs"] * 1.18),
                         "_enableWrapText": bool(comp.get("wrap")), "_N$file": {"__uuid__": FONT},
                         "_isSystemFontUsed": False, "_spacingX": 0,
                         "_batchAsBitmap": False, "_styleFlags": 1 if comp["bold"] else 0,
                         "_underlineHeight": 2, "_N$horizontalAlign": comp["h"],
                         "_N$verticalAlign": 1, "_N$fontFamily": "Arial",
                         "_N$overflow": comp.get("overflow") or 2, "_N$cacheMode": 0, "_id": ""}
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
        elif k == "scrollview":
            objs[cid] = {
                "__type__": "cc.ScrollView", "_name": "", "_objFlags": 0,
                "_enabled": True, "node": {"__id__": n.nid},
                "horizontal": False, "vertical": True, "inertia": True, "brake": 0.5,
                "elastic": True, "bounceDuration": 1, "scrollEvents": [],
                "cancelInnerEvents": True, "_N$content": None, "content": None,
                "_N$horizontalScrollBar": None, "_N$verticalScrollBar": None, "_id": ""
            }
        elif k == "mask":
            objs[cid] = {
                "__type__": "cc.Mask", "_name": "", "_objFlags": 0,
                "node": {"__id__": n.nid}, "_enabled": True,
                "_materials": [{"__uuid__": MAT}], "_spriteFrame": None,
                "_type": 0, "_segments": 64, "_N$alphaThreshold": 0,
                "_N$inverted": False, "_id": ""
            }
        elif k == "block":
            objs[cid] = {"__type__": "cc.BlockInputEvents", "_name": "", "_objFlags": 0,
                         "_enabled": True, "node": {"__id__": n.nid}, "_id": ""}
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
              bold=True, outline=None, wrap=False, lh=None, overflow=None):
    n = N(name, pos, size, anchor)
    label(n, text, fs, color, h_align, bold, outline, wrap=wrap, lh=lh,
          overflow=overflow)
    return n


def info_chip(name, text, pos, size=(300, 64), fs=22, color=CREAM):
    n = N(name, pos, size)
    sprite(n, SPR["chip"], sliced=True)
    n.add(text_node("文字", text, fs, color, (0, 0), size))
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
    names = ["游戏规则", "奖池设置", "牌桌设置", "提示音设置", "其他设置"]
    for i, name in enumerate(names):
        tab = N("页签_%d" % i, (-282 + i * 141, 0), (136, 64))
        sprite(tab, SPR["tab_on"] if i == 0 else SPR["tab_off"], sliced=True)
        button(tab)
        tab.add(text_node("文字", name, 24, DARK if i == 0 else (169, 192, 214, 255),
                          (0, 0), (136, 64)))
        tabs.add(tab)
    root.add(tabs)

    card = N("卡片", (0, -68), (702, 1118), active=False)
    sprite(card, SPR["panel"], sliced=True)
    widget(card, 45, 24, 24, 176, 40, 0, 0, 702, 1118)
    card_title = text_node("卡片标题", "奖池设置", 32, GOLD, (-254, 508), (320, 46),
                           0, (0, 0.5), True, (DARKOUT, 1))
    widget(card_title, 9, 76, 0, 22, 0, 0, 0, 320, 46)
    card.add(card_title)
    card_sub = text_node("卡片说明", "各牌型比例与底皮奖池数量", 22, GRAY, (-254, 464),
                         (420, 32), 0, (0, 0.5))
    widget(card_sub, 9, 76, 0, 70, 0, 0, 0, 420, 32)
    card.add(card_sub)
    badge = N("卡片图标", (-286, 506), (44, 44))
    sprite(badge, SPR["badge"])
    widget(badge, 9, 28, 0, 25, 0, 0, 0, 44, 44)
    card.add(badge)

    pool_row = N("池总开关行", (0, 0), (654, 64))
    sprite(pool_row, SPR["row"], sliced=True)
    widget(pool_row, 41, 0, 0, 110, 0, 0, 0, 654, 64)
    pool_row.add(text_node("名称", "奖池总开关", 26, GOLD, (-246, 12), (300, 34),
                           0, (0, 0.5), True, (DARKOUT, 1)))
    pool_row.add(text_node("说明", "关闭后不进池、不派奖、不提留", 16, GRAY, (-246, -18),
                           (300, 22), 0, (0, 0.5), False))
    pool_sw = N("池总开关", (122, 0), (104, 52))
    button(pool_sw)
    pool_on = N("开", (0, 0), (104, 52), active=False)
    sprite(pool_on, SPR["toggle_on"])
    pool_on.add(text_node("文字", "开", 20, (255, 242, 216, 255), (-24, 0), (38, 38),
                          1, (0.5, 0.5), True, (DARKOUT, 1)))
    pool_off = N("关", (0, 0), (104, 52), active=True)
    sprite(pool_off, SPR["toggle_off"])
    pool_off.add(text_node("文字", "关", 20, (255, 242, 216, 255), (24, 0), (38, 38),
                           1, (0.5, 0.5), True, (DARKOUT, 1)))
    pool_sw.add(pool_on)
    pool_sw.add(pool_off)
    pool_row.add(pool_sw)
    card.add(pool_row)

    # 单页滚动区：5 档牌型比例 + 8 个底皮奖池数量放在同一张卡片里。
    # 滚动区用 top+bottom Widget 随卡片高度拉伸，长屏不会在底部留空。
    scroll = N("滚动", (0, -22), (654, 870))
    scroll.comps.append({"kind": "scrollview"})
    widget(scroll, 45, 0, 0, 182, 66, 0, 0, 654, 870)
    view = N("view", (0, 0), (654, 870))
    view.comps.append({"kind": "mask"})
    widget(view, 45, 0, 0, 0, 0, 0, 0, 654, 870)
    content = N("content", (0, 435), (654, 1604), anchor=(0.5, 1))
    content.comps.append({"kind": "layout", "sy": 12})
    widget(content, 17, 0, 0, 0, 0, 0, 0, 654, 1604)

    content.add(text_node("牌型标题", "牌型比例", 28, GOLD, (0, 0), (654, 44),
                          0, (0.5, 0.5), True, (DARKOUT, 1)))
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
        content.add(row)

    content.add(text_node("底皮标题", "底皮奖池数量（元 · 覆盖写入，上下滑动查看全部）", 28, GOLD, (0, 0),
                          (654, 44), 0, (0.5, 0.5), True, (DARKOUT, 1)))
    dipis = ["0.1/0.3", "0.2/0.5", "1/3", "2/5", "5/10", "10/20", "20/40", "50/100"]
    for i, dipi in enumerate(dipis):
        row = N("底皮行_%d" % i, (0, 0), (654, 96))
        sprite(row, SPR["row"], sliced=True)
        b = N("徽章", (-288, 0), (48, 48))
        sprite(b, SPR["badge"])
        row.add(b)
        row.add(text_node("名称", "底皮 " + dipi, 26, GOLD, (-246, 0), (300, 44),
                          0, (0, 0.5), True, (DARKOUT, 1)))
        chip = N("数量_%d" % i, (200, 8), (200, 52))
        sprite(chip, SPR["chip"], sliced=True)
        button(chip)
        chip.add(text_node("数值", "0 元", 24, CREAM, (0, 0), (200, 52)))
        row.add(chip)
        row.add(text_node("提示", "点击修改", 16, GRAY, (200, -30), (200, 18),
                          1, (0.5, 0.5), False))
        content.add(row)

    view.add(content)
    scroll.add(view)
    card.add(scroll)

    total = text_node("合计", "合计 44% · 各档独立按底皮奖池计算", 22, GRAY, (0, -529),
                      (654, 32))
    widget(total, 44, 0, 0, 0, 14, 0, 0, 654, 32)
    card.add(total)
    root.add(card)

    # ---------------------------------------------------------------- 游戏规则
    rules = N("规则卡片", (0, -68), (702, 1118), active=True)
    sprite(rules, SPR["panel"], sliced=True)
    widget(rules, 45, 24, 24, 176, 40, 0, 0, 702, 1118)
    rules_title = text_node("卡片标题", "游戏规则", 32, GOLD, (-254, 508), (320, 46),
                            0, (0, 0.5), True, (DARKOUT, 1))
    widget(rules_title, 9, 76, 0, 22, 0, 0, 0, 320, 46)
    rules.add(rules_title)
    rules_sub = text_node("卡片说明", "创建后自动开房 · 满员/开局自动补房", 22, GRAY,
                          (-254, 464), (500, 32), 0, (0, 0.5))
    widget(rules_sub, 9, 76, 0, 70, 0, 0, 0, 500, 32)
    rules.add(rules_sub)
    rules_badge = N("卡片图标", (-286, 506), (44, 44))
    sprite(rules_badge, SPR["badge"])
    widget(rules_badge, 9, 28, 0, 25, 0, 0, 0, 44, 44)
    rules.add(rules_badge)
    rules_summary = text_node("汇总", "正在读取游戏规则…", 22, GRAY, (0, 416), (654, 34))
    widget(rules_summary, 41, 24, 24, 126, 0, 0, 0, 654, 34)
    rules.add(rules_summary)

    rules_scroll = N("滚动", (0, -27), (654, 830))
    rules_scroll.comps.append({"kind": "scrollview"})
    widget(rules_scroll, 45, 0, 0, 171, 117, 0, 0, 654, 830)
    rules_view = N("view", (0, 0), (654, 830))
    rules_view.comps.append({"kind": "mask"})
    widget(rules_view, 45, 0, 0, 0, 0, 0, 0, 654, 830)
    rules_content = N("content", (0, 415), (654, 830), anchor=(0.5, 1))

    rule_row = N("规则行", (0, 0), (654, 250), active=False)
    sprite(rule_row, SPR["row"], sliced=True)
    rule_badge = N("徽章", (-304, 84), (32, 32))
    sprite(rule_badge, SPR["badge"])
    rule_row.add(rule_badge)
    rule_row.add(text_node("底皮", "底皮 1/3", 30, GOLD, (-276, 84), (180, 40),
                           0, (0, 0.5), True, (DARKOUT, 1)))
    rule_row.add(text_node("类型", "地九王", 21, CYAN, (-90, 86), (120, 30),
                           0, (0, 0.5), True))
    rule_row.add(chip_btn("删除", "删除", (262, 84), (96, 48), "chip", 22, RED))
    rule_row.add(text_node("准入", "准入 50 · 8 人 · 30 分钟", 21, GRAY, (-306, 42),
                           (420, 30), 0, (0, 0.5), False))
    rule_row.add(info_chip("抽水", "抽水 5%", (-166, -8), (300, 64), 23))
    rule_row.add(info_chip("暗抽", "暗抽 1% · 仅群主", (166, -8), (300, 64), 22))
    rule_row.add(text_node("房间", "房间 3 个 · 满员/开局自动补房", 21, GRAY,
                           (-306, -64), (560, 30), 0, (0, 0.5), False))
    rules_content.add(rule_row)

    rules_view.add(rules_content)
    rules_scroll.add(rules_view)
    rules.add(rules_scroll)

    rules.add(text_node("空提示", "暂无游戏规则，点击下方创建", 22, GRAY, (0, -27), (654, 120)))
    create_entry = chip_btn("创建游戏规则", "＋ 创建游戏规则", (0, -505), (654, 92),
                            "btn_gold", 30, DARK, True)
    widget(create_entry, 44, 24, 24, 10, 0, 0, 0, 654, 92)
    rules.add(create_entry)
    root.add(rules)

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

    # ---------------------------------------------------------------- 创建规则弹窗
    create_modal = N("创建规则弹窗", (0, 0), (750, 1334), active=False)
    widget(create_modal, 45, 0, 0, 0, 0)
    create_mask = N("创建规则遮罩", (0, 0), (750, 1334), color=(0, 0, 0, 255), opacity=160)
    sprite(create_mask, BLACK)
    button(create_mask)
    widget(create_mask, 45, 0, 0, 0, 0)
    create_modal.add(create_mask)

    create_pane = N("面板", (0, 0), (702, 1020))
    sprite(create_pane, SPR["panel"], sliced=True)
    create_pane.comps.append({"kind": "block"})
    widget(create_pane, 18, 0, 0, 0, 0, 0, 0, 702, 1020)
    create_modal.add(create_pane)
    create_pane.add(text_node("标题", "创建游戏规则", 34, GOLD, (0, 460), (600, 48),
                              1, (0.5, 0.5), True, (DARKOUT, 1.5)))
    create_pane.add(text_node("副标题", "可按底皮创建多条规则 · 创建后自动开房", 20, GRAY,
                              (0, 424), (600, 30)))
    create_pane.add(text_node("底皮标题", "底皮", 26, GOLD, (-320, 380), (200, 34),
                              0, (0, 0.5), True, (DARKOUT, 1)))
    create_pane.add(text_node("底皮说明", "准入由底皮自动推导", 18, GRAY, (-228, 380),
                              (300, 26), 0, (0, 0.5), False))
    for i, (key, dipi_label, admit) in enumerate(DIPI_OPTIONS):
        chip = N("底皮_%d" % i, (-256 + i * 128, 322), (116, 76))
        sprite(chip, SPR["tab_on"] if i == 0 else SPR["chip"], sliced=True)
        button(chip)
        chip.add(text_node("名称", dipi_label, 24, DARK if i == 0 else CREAM,
                           (0, 12), (116, 34)))
        chip.add(text_node("准入", "准入 %d" % admit, 17, DARK if i == 0 else GRAY,
                           (0, -20), (116, 24), 1, (0.5, 0.5), False))
        create_pane.add(chip)

    nine_row = N("地九王行", (0, 230), (654, 76))
    sprite(nine_row, SPR["row"], sliced=True)
    nine_row.add(text_node("名称", "地九王", 26, GOLD, (-300, 14), (300, 34),
                           0, (0, 0.5), True, (DARKOUT, 1)))
    nine_row.add(text_node("说明", "开启后按地九王规则结算", 18, GRAY, (-300, -16),
                           (400, 24), 0, (0, 0.5), False))
    nine_sw = N("地九王开关", (268, 0), (104, 52))
    button(nine_sw)
    nine_on = N("开", (0, 0), (104, 52), active=True)
    sprite(nine_on, SPR["toggle_on"])
    nine_on.add(text_node("文字", "开", 20, (255, 242, 216, 255), (-24, 0), (38, 38),
                          1, (0.5, 0.5), True, (DARKOUT, 1)))
    nine_off = N("关", (0, 0), (104, 52), active=False)
    sprite(nine_off, SPR["toggle_off"])
    nine_off.add(text_node("文字", "关", 20, (255, 242, 216, 255), (24, 0), (38, 38),
                           1, (0.5, 0.5), True, (DARKOUT, 1)))
    nine_sw.add(nine_on)
    nine_sw.add(nine_off)
    nine_row.add(nine_sw)
    create_pane.add(nine_row)

    create_pane.add(text_node("抽水标题", "抽水比例", 26, GOLD, (-320, 174), (200, 34),
                              0, (0, 0.5), True, (DARKOUT, 1)))
    create_pane.add(text_node("抽水说明", "房间总水率 0~20%", 18, GRAY, (-200, 174),
                              (260, 26), 0, (0, 0.5), False))
    create_pane.add(text_node("抽水右侧", "0 = 不抽水", 18, GRAY, (320, 174),
                              (200, 26), 1, (1, 0.5), False))
    create_pane.add(chip_btn("抽水减", "－", (-270, 120), (64, 64), "chip", 36, CREAM))
    water_box = N("抽水值", (0, 120), (360, 64))
    sprite(water_box, SPR["chip"], sliced=True)
    water_box.add(text_node("数值", "5%", 36, GOLD, (0, 0), (360, 64)))
    create_pane.add(water_box)
    create_pane.add(chip_btn("抽水加", "＋", (270, 120), (64, 64), "chip", 36, CREAM))
    for i, value in enumerate((0, 2, 3, 5, 10)):
        create_pane.add(chip_btn("抽水快捷_%d" % i, "%d%%" % value,
                                 (-256 + i * 128, 62), (116, 48),
                                 "tab_on" if value == 5 else "chip", 22,
                                 DARK if value == 5 else CREAM, value == 5))
    create_pane.add(text_node("抽水提示", "抽水从每手输赢中按比例提取，进入代理分账。",
                              18, GRAY, (0, 20), (654, 26), 1, (0.5, 0.5), False))

    create_pane.add(text_node("暗抽标题", "暗抽比例", 26, GOLD, (-320, -36), (200, 34),
                              0, (0, 0.5), True, (DARKOUT, 1)))
    create_pane.add(text_node("暗抽说明", "按玩家输赢 · 仅群主可见", 18, GRAY, (-200, -36),
                              (300, 26), 0, (0, 0.5), False))
    create_pane.add(text_node("暗抽右侧", "0 = 不暗抽", 18, GRAY, (320, -36),
                              (200, 26), 1, (1, 0.5), False))
    create_pane.add(chip_btn("暗抽减", "－", (-270, -88), (64, 64), "chip", 36, CREAM))
    dark_box = N("暗抽值", (0, -88), (360, 64))
    sprite(dark_box, SPR["chip"], sliced=True)
    dark_box.add(text_node("数值", "0%", 36, GOLD, (0, 0), (360, 64)))
    create_pane.add(dark_box)
    create_pane.add(chip_btn("暗抽加", "＋", (270, -88), (64, 64), "chip", 36, CREAM))
    for i, value in enumerate((0, 1, 2, 3, 5)):
        create_pane.add(chip_btn("暗抽快捷_%d" % i, "%d%%" % value,
                                 (-256 + i * 128, -150), (116, 48),
                                 "tab_on" if value == 0 else "chip", 22,
                                 DARK if value == 0 else CREAM, value == 0))
    create_pane.add(text_node("暗抽提示", "不能大于抽水比例；代理单独覆盖，玩家与代理不可见。",
                              18, GRAY, (0, -188), (654, 26), 1, (0.5, 0.5), False))

    auto_bar = N("自动信息", (0, -238), (654, 76))
    sprite(auto_bar, SPR["row"], sliced=True)
    for name, key, value, x in (("准入", "准入", "50 分", -218),
                                ("人数", "人数", "8 人", 0),
                                ("时长", "时长", "30 分钟", 218)):
        auto_bar.add(text_node(name, key, 18, GRAY, (x, 14), (180, 24),
                               1, (0.5, 0.5), False))
        auto_bar.add(text_node(name + "值", value, 26, GOLD, (x, -13), (180, 32)))
    create_pane.add(auto_bar)
    create_pane.add(text_node("创建提示", "创建后自动开 1 个可加入房，满员/开局补房。",
                              18, GRAY, (0, -292), (654, 26), 1, (0.5, 0.5), False))
    create_pane.add(chip_btn("创建规则取消", "取消", (-160, -400), (300, 80),
                             "chip", 30, GRAY))
    create_pane.add(chip_btn("创建规则确认", "创建并开房", (160, -400), (300, 80),
                             "btn_gold", 30, DARK, True))
    root.add(create_modal)

    # ---------------------------------------------------------------- 删除规则弹窗
    delete_modal = N("删除规则弹窗", (0, 0), (750, 1334), active=False)
    widget(delete_modal, 45, 0, 0, 0, 0)
    delete_mask = N("删除规则遮罩", (0, 0), (750, 1334), color=(0, 0, 0, 255), opacity=160)
    sprite(delete_mask, BLACK)
    button(delete_mask)
    widget(delete_mask, 45, 0, 0, 0, 0)
    delete_modal.add(delete_mask)

    delete_pane = N("面板", (0, 0), (620, 470))
    sprite(delete_pane, SPR["panel"], sliced=True)
    delete_pane.comps.append({"kind": "block"})
    widget(delete_pane, 18, 0, 0, 0, 0, 0, 0, 620, 470)
    delete_modal.add(delete_pane)
    delete_pane.add(text_node("标题", "删除游戏规则", 32, GOLD, (0, 180), (560, 46),
                              1, (0.5, 0.5), True, (DARKOUT, 1.5)))
    delete_pane.add(text_node("副标题", "删除后该规则的房间不再补房", 20, GRAY,
                              (0, 142), (560, 30)))
    summary = N("规则摘要", (0, 68), (560, 100))
    sprite(summary, SPR["chip"], sliced=True)
    summary.add(text_node("名称", "底皮 1/3 · 地九王", 24, GOLD, (0, 30), (520, 34)))
    summary.add(text_node("准入摘要", "准入 50 · 8 人 · 30 分钟", 18, GRAY,
                          (0, -2), (520, 24), 1, (0.5, 0.5), False))
    summary.add(text_node("收益摘要", "抽水 5% · 暗抽 1% · 3 个房间", 18, GRAY,
                          (0, -30), (520, 24), 1, (0.5, 0.5), False))
    delete_pane.add(summary)
    delete_pane.add(text_node("警告", "未开局的房间立即关闭；正在进行的牌局会在本局结算后关闭；不再补该规则的新房。",
                              18, (240, 200, 150, 255), (0, -58), (540, 80),
                              1, (0.5, 0.5), False, wrap=True, lh=24, overflow=1))
    delete_pane.add(text_node("提示", "", 18, RED, (0, -120), (540, 24),
                              1, (0.5, 0.5), False))
    delete_pane.add(chip_btn("删除规则取消", "取消", (-130, -176), (240, 72),
                             "chip", 28, GRAY))
    delete_pane.add(chip_btn("删除规则确认", "确认删除", (130, -176), (240, 72),
                             "btn_gold", 28, DARK, True))
    root.add(delete_modal)
    return root


def node_file_ids(objs):
    """node id -> 路径 -> PrefabInfo.fileId；用于重建时保留既有节点身份。"""
    paths = {}

    def walk(index, parent_path):
        node = objs[index]
        if not isinstance(node, dict) or node.get("__type__") != "cc.Node":
            return
        path = (parent_path + "/" + node["_name"]) if parent_path else node["_name"]
        paths[path] = node
        for child in node.get("_children", []):
            walk(child["__id__"], path)

    root = next(index for index, obj in enumerate(objs)
                if isinstance(obj, dict) and obj.get("__type__") == "cc.Node"
                and obj.get("_parent") is None)
    walk(root, "")
    return paths


def reuse_existing_file_ids(objs, out_path):
    if not os.path.exists(out_path):
        return
    try:
        old = json.load(open(out_path, encoding="utf-8"))
    except Exception:
        return
    old_paths = node_file_ids(old)
    new_paths = node_file_ids(objs)
    kept = 0
    for path, node in new_paths.items():
        old_node = old_paths.get(path)
        if old_node is None:
            continue
        old_ref = old_node.get("_prefab")
        new_ref = node.get("_prefab")
        if not old_ref or not new_ref:
            continue
        old_info = old[old_ref["__id__"]]
        new_info = objs[new_ref["__id__"]]
        if old_info.get("fileId"):
            new_info["fileId"] = old_info["fileId"]
            kept += 1
    print("kept fileIds:", kept)


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

    # 每个 ScrollView 绑定自己 view 下的 content；两张卡片各有一套滚动区。
    for o in objs:
        if not isinstance(o, dict) or o.get("__type__") != "cc.ScrollView":
            continue
        scroll_node = objs[o["node"]["__id__"]]
        view_id = scroll_node["_children"][0]["__id__"]
        content_id = objs[view_id]["_children"][0]["__id__"]
        o["_N$content"] = {"__id__": content_id}
        o["content"] = {"__id__": content_id}

    out = os.path.join(ROOT, "assets", "resources", "UI", "panelGameSettings.prefab")
    reuse_existing_file_ids(objs, out)
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
