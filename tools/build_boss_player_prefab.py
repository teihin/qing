#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「BOSS 玩家数据」全屏面板 Prefab（代理链页签）。

素材全部复用现有工程资源：
  - 背景/标题栏/返回：panelMyHongli.prefab
  - 列表底板：panelMain.prefab 的「成员列表底板」
  - 行模板：panelMain.prefab 的「俱乐部成员弹窗/面板/列表/view/content/行模板」

只做结构和文案调整，不新增贴图。运行后需让 Creator 重新导入。
"""
import copy
import json
import os
import random
import string
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "assets/resources/UI/panelMain.prefab")
MYHONGLI = os.path.join(ROOT, "assets/resources/UI/panelMyHongli.prefab")
OUT = os.path.join(ROOT, "assets/resources/UI/panelBossPlayerInfo.prefab")
OUT_META = OUT + ".meta"

# 新脚本 meta 里的 uuid（由 build 脚本参数传入，缺省则生成）
SCRIPT_UUID = sys.argv[1] if len(sys.argv) > 1 else ""

B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

MATERIAL = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
FONT_BG_MASK = "a23235d1-15db-4b95-8439-a2e005bfff91"  # 纯色遮罩（半透明看得到桌面）
FONT_TITLEBAR = "5414d11a-1a02-5138-a2d2-e36386d6ef3d"  # 标题栏
FONT_BACK = "9136cacd-2829-52af-a9c6-bc8f0bf7ea68"     # 返回
FONT_PANEL = "56a8e1b0-c86f-5531-9cd5-50ecfb20846d"   # 成员列表底板
FONT_TAB_ON = "91a341b0-c173-4455-8c97-e470fc1cda87"  # 金色胶囊（激活）
FONT_TAB_OFF = "88253e0e-4413-48f2-bf36-2742948efc1f"  # 金色胶囊（非激活）
FONT_BTN = "dc06eaa9-fee3-59d8-aff6-d12c4002d6d9"     # 通用按钮底
FONT_DIVIDER = "5ebf634b-9789-5c22-8f20-aaa292819e83"  # 竖分隔线
FONT_TITLE_ART = "9a833a00-83b5-43ac-935c-5e140c916c27"  # 标题美术字「玩家数据」（imagegen 生成）

LABEL_COLOR = {"__type__": "cc.Color", "r": 229, "g": 248, "b": 252, "a": 255}
GOLD_COLOR = {"__type__": "cc.Color", "r": 255, "g": 231, "b": 112, "a": 255}
DIM_COLOR = {"__type__": "cc.Color", "r": 160, "g": 190, "b": 205, "a": 255}
WHITE_COLOR = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}


def compressed_uuid(u):
    h = u.replace("-", "")
    out = h[:5]
    for i in range(5, len(h), 3):
        v = int(h[i:i + 3], 16)
        out += B64[v >> 6] + B64[v & 63]
    return out


def file_id(seed):
    rnd = random.Random(seed)
    return "".join(rnd.choice(B64) for _ in range(22))


class Builder:
    def __init__(self):
        self.objs = [
            {"__type__": "cc.Prefab", "_name": "", "_objFlags": 0, "_native": "",
             "data": {"__id__": 1}, "optimizationPolicy": 0, "asyncLoadAssets": False,
             "readonly": False},
        ]
        self.objs.append(None)  # root placeholder
        self.seed = 1000

    def add(self, obj):
        self.objs.append(obj)
        return len(self.objs) - 1

    def next_seed(self):
        self.seed += 1
        return self.seed

    # ---------- node ----------
    def node(self, name, parent=None, w=100, h=100, x=0, y=0, active=True,
             color=None, opacity=255, anchor=(0.5, 0.5)):
        # 根节点占 index 1（Prefab.data 指向它）。
        if parent is None and self.objs[1] is None:
            nid = 1
        else:
            nid = self.add(None)
        p = {"__id__": parent} if parent is not None else None
        obj = {
            "__type__": "cc.Node", "_name": name, "_objFlags": 0, "_parent": p,
            "_children": [], "_active": active, "_components": [], "_prefab": None,
            "_opacity": opacity, "_color": color or dict(WHITE_COLOR),
            "_contentSize": {"__type__": "cc.Size", "width": w, "height": h},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": anchor[0], "y": anchor[1]},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                     "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0,
            "groupIndex": 0, "_id": "",
        }
        self.objs[nid] = obj
        if parent is not None:
            self.objs[parent]["_children"].append({"__id__": nid})
        self.attach_prefab(nid)
        return nid

    def attach_prefab(self, nid):
        pid = self.add({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                        "asset": {"__id__": 0}, "fileId": file_id(self.next_seed()),
                        "sync": False})
        self.objs[nid]["_prefab"] = {"__id__": pid}

    def comp(self, nid, obj):
        cid = self.add(obj)
        self.objs[nid]["_components"].append({"__id__": cid})
        return cid

    def widget(self, nid, flags=45, l=0, r=0, t=0, b=0, ow=750, oh=1334):
        return self.comp(nid, {
            "__type__": "cc.Widget", "_name": "", "_objFlags": 0, "node": {"__id__": nid},
            "_enabled": True, "alignMode": 1, "_target": None, "_alignFlags": flags,
            "_left": l, "_right": r, "_top": t, "_bottom": b,
            "_verticalCenter": 0, "_horizontalCenter": 0,
            "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True, "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True, "_isAbsVerticalCenter": True,
            "_originalWidth": ow, "_originalHeight": oh, "_id": "",
        })

    def sprite(self, nid, frame, stype=0, size_mode=0):
        return self.comp(nid, {
            "__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": nid},
            "_enabled": True, "_materials": [{"__uuid__": MATERIAL}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_spriteFrame": {"__uuid__": frame}, "_type": stype, "_sizeMode": size_mode,
            "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": True, "_atlas": None, "_id": "",
        })

    def label(self, nid, text, size=24, color=None, align=1, line=None, wrap=False,
              bold=False):
        if color:
            self.objs[nid]["_color"] = dict(color)
        return self.comp(nid, {
            "__type__": "cc.Label", "_name": "", "_objFlags": 0, "node": {"__id__": nid},
            "_enabled": True, "_materials": [{"__uuid__": MATERIAL}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_string": text, "_N$string": text, "_fontSize": size,
            "_lineHeight": line or int(size * 1.25), "_enableWrapText": wrap,
            "_N$file": None, "_isSystemFontUsed": True, "_spacingX": 0,
            "_batchAsBitmap": False, "_styleFlags": 1 if bold else 0,
            "_underlineHeight": 0, "_N$horizontalAlign": align, "_N$verticalAlign": 1,
            "_N$fontFamily": "Arial", "_N$overflow": 1, "_N$cacheMode": 0, "_id": "",
        })

    def block(self, nid):
        return self.comp(nid, {"__type__": "cc.BlockInputEvents", "_name": "", "_objFlags": 0,
                               "node": {"__id__": nid}, "_enabled": True, "_id": ""})

    def button(self, nid, zoom=0.9):
        return self.comp(nid, {
            "__type__": "cc.Button", "_name": "", "_objFlags": 0, "node": {"__id__": nid},
            "_enabled": True, "_normalMaterial": {"__uuid__": MATERIAL},
            "_grayMaterial": None, "duration": 0.1, "zoomScale": zoom, "clickEvents": [],
            "_N$interactable": True, "_N$enableAutoGrayEffect": False,
            "_N$transition": 0, "transition": 0,
            "_N$normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "_N$hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
            "_N$normalSprite": None, "_N$pressedSprite": None, "pressedSprite": None,
            "_N$hoverSprite": None, "hoverSprite": None, "_N$disabledSprite": None,
            "_N$target": None, "_id": "",
        })

    def scroll(self, nid, content_id):
        return self.comp(nid, {
            "__type__": "cc.ScrollView", "_name": "", "_objFlags": 0, "node": {"__id__": nid},
            "_enabled": True, "horizontal": False, "vertical": True, "inertia": True,
            "brake": 0.5, "elastic": True, "bounceDuration": 1, "scrollEvents": [],
            "cancelInnerEvents": True, "_N$content": {"__id__": content_id},
            "content": {"__id__": content_id}, "_N$horizontalScrollBar": None,
            "_N$verticalScrollBar": None, "_id": "",
        })

    def mask(self, nid):
        return self.comp(nid, {
            "__type__": "cc.Mask", "_name": "", "_objFlags": 0,
            "node": {"__id__": nid}, "_enabled": True, "_materials": [{"__uuid__": MATERIAL}],
            "_spriteFrame": None, "_type": 0, "_segments": 64,
            "_N$alphaThreshold": 0, "_N$inverted": False, "_id": "",
        })


def get_node_index(doc, name):
    def nm(n):
        v = n.get("_name")
        return doc[v["__id__"]].get("_string", "") if isinstance(v, dict) else v

    def walk(i):
        n = doc[i]
        if nm(n) == name:
            return i
        for ch in n.get("_children", []):
            r = walk(ch["__id__"])
            if r is not None:
                return r
        return None
    return walk(1)


def copy_row(b, src, src_idx, parent_id, name=None):
    """把源 prefab 的行模板整棵拷贝到目标 content 下。"""
    mapping = {}

    def clone_node(idx, parent):
        n = src[idx]
        nid = b.add(None)
        mapping[idx] = nid
        obj = copy.deepcopy(n)
        obj["_parent"] = {"__id__": parent}
        b.objs[nid] = obj
        # children
        new_children = []
        for ch in n.get("_children", []):
            new_children.append({"__id__": clone_node(ch["__id__"], nid)})
        obj["_children"] = new_children
        # components
        new_comps = []
        for c in n.get("_components", []):
            co = copy.deepcopy(src[c["__id__"]])
            co["node"] = {"__id__": nid}
            if "_N$target" in co:
                co["_N$target"] = None
            if "_target" in co and co.get("__type__") == "cc.Widget":
                co["_target"] = None
            cid = b.add(co)
            new_comps.append({"__id__": cid})
        obj["_components"] = new_comps
        # prefab info
        pi = b.add({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                    "asset": {"__id__": 0}, "fileId": file_id(b.next_seed()), "sync": False})
        obj["_prefab"] = {"__id__": pi}
        return nid

    first = [None]
    root = clone_node(src_idx, parent_id)
    first[0] = root
    if name is not None:
        b.objs[root]["_name"] = name
    b.objs[parent_id]["_children"].append({"__id__": root})
    return root


def child_by_name(b, nid, name):
    for ch in b.objs[nid]["_children"]:
        if b.objs[ch["__id__"]]["_name"] == name:
            return ch["__id__"]
    return None


def set_pos(b, nid, x, y):
    b.objs[nid]["_trs"]["array"][0] = x
    b.objs[nid]["_trs"]["array"][1] = y


def set_size(b, nid, w, h):
    b.objs[nid]["_contentSize"]["width"] = w
    b.objs[nid]["_contentSize"]["height"] = h


def set_label(b, nid, text):
    for c in b.objs[nid]["_components"]:
        co = b.objs[c["__id__"]]
        if co.get("__type__") == "cc.Label":
            co["_string"] = text
            co["_N$string"] = text


def main():
    main_doc = json.load(open(MAIN))
    row_idx = get_node_index(main_doc, "行模板")
    if row_idx is None:
        raise SystemExit("找不到行模板")

    if not SCRIPT_UUID:
        raise SystemExit("需要传入脚本 uuid")
    script_type = compressed_uuid(SCRIPT_UUID)

    b = Builder()
    root = b.node("panelBossPlayerInfo", None, 750, 1334, 375, 667)
    b.widget(root, 45, 0, 0, 0, 0, 750, 1334)
    b.block(root)
    b.comp(root, {"__type__": script_type, "_name": "", "_objFlags": 0,
                  "node": {"__id__": root}, "_enabled": True, "_id": ""})

    bg = b.node("背景", root, 750, 1334, 0, 0, opacity=130)
    b.objs[bg]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255}
    b.sprite(bg, FONT_BG_MASK)
    b.widget(bg, 45, 0, 0, 0, 0, 750, 1334)

    bar = b.node("标题栏", root, 750, 72, 0, 631)
    b.sprite(bar, FONT_TITLEBAR)
    b.widget(bar, 41, 0, 0, 0, 0, 750, 72)
    title = b.node("标题美术字", bar, 210, 54, -140, 0)
    b.sprite(title, FONT_TITLE_ART)

    back = b.node("返回", root, 96, 72, -326, 631)
    b.sprite(back, FONT_BACK)
    b.button(back)
    b.widget(back, 9, 1, 0, 0, 0, 96, 72)

    # 顶部玩家资料
    head = b.node("玩家资料", root, 690, 104, 0, 536)
    b.widget(head, 1, 0, 0, 79, 0, 690, 104)
    head_bg = b.node("玩家资料底", head, 690, 104, 0, 0, opacity=230)
    b.objs[head_bg]["_color"] = {"__type__": "cc.Color", "r": 18, "g": 48, "b": 78, "a": 255}
    b.sprite(head_bg, FONT_PANEL, 1)
    avatar = b.node("头像", head, 84, 84, -270, 0)
    b.sprite(avatar, "3200ca5e-29f4-43ba-8407-fa039dbaed6e")

    pname = b.node("玩家姓名", head, 280, 36, -72, 22)
    b.label(pname, "玩家昵称", 28, dict(LABEL_COLOR), 0, 32)
    pid = b.node("玩家ID", head, 260, 28, -72, -18)
    b.label(pid, "ID: 000000", 22, dict(DIM_COLOR), 0, 26)
    pident = b.node("玩家身份", head, 150, 30, 210, 6)
    b.label(pident, "成员", 22, dict(GOLD_COLOR), 1, 26)

    # 页签
    tabs = b.node("页签", root, 690, 56, 0, 455)
    b.widget(tabs, 1, 0, 0, 184, 0, 690, 56)
    tab_defs = [("代理链", -215), ("输赢详情", 0), ("牌局详情", 215)]
    for text, x in tab_defs:
        t = b.node("页签_" + text, tabs, 196, 56, x, 0)
        b.button(t)
        on = b.node("底激活", t, 196, 56, 0, 0, active=(text == "代理链"))
        b.sprite(on, FONT_TAB_ON, 1)
        off = b.node("底非激活", t, 196, 56, 0, 0, active=(text != "代理链"))
        b.sprite(off, FONT_TAB_OFF, 1)
        lab = b.node("文字", t, 180, 50, 0, 0)
        b.label(lab, text, 26, dict({"__type__": "cc.Color", "r": 48, "g": 30, "b": 8, "a": 255}
                                    if text == "代理链" else
                                    {"__type__": "cc.Color", "r": 169, "g": 192, "b": 214, "a": 255}), 1, 30)

    # 列表
    panel = b.node("列表面板", root, 714, 990, 0, -80, opacity=70)
    b.sprite(panel, FONT_PANEL, 1)
    b.widget(panel, 45, 18, 18, 252, 92, 714, 990)

    lst = b.node("列表", root, 690, 960, 0, -80)
    b.widget(lst, 45, 30, 30, 267, 107, 690, 960)
    view = b.node("view", lst, 690, 960, 0, 0)
    b.mask(view)
    b.widget(view, 45, 0, 0, 0, 0, 690, 960)
    content = b.node("content", view, 690, 0, 0, 480, anchor=(0.5, 1))
    b.scroll(lst, content)

    row = copy_row(b, main_doc, row_idx, content, "行模板")
    b.objs[row]["_active"] = False
    set_size(b, row, 690, 204)
    set_pos(b, row, 0, -102)
    root_sprite = None
    for c in b.objs[row]["_components"]:
        co = b.objs[c["__id__"]]
        if co.get("__type__") == "cc.Sprite":
            root_sprite = co
    # 链路行只读：去掉从俱乐部成员行带过来的按钮，避免点头像无效却播按键音。
    def strip_buttons(nid):
        n = b.objs[nid]
        n["_components"] = [c for c in n.get("_components", [])
                            if b.objs[c["__id__"]].get("__type__") != "cc.Button"]
        for ch in n.get("_children", []):
            strip_buttons(ch["__id__"])
    strip_buttons(row)

    # 行内字段重排：玩家 / 身份 / 总输赢 / 总贡献 / 总红利
    layout = {
        "头像": (-296, 46, 70, 70),
        "姓名": (-166, 59, 170, 32),
        "玩家ID": (-166, 23, 170, 26),
        "身份": (-300, -9, 110, 28),
        "团队人数": (-183, -16, 90, 28),
        "团队人数值": (-99, -16, 72, 28),
        "今日输赢": (-4.86, 66, 130, 28),
        "今日输赢值": (87, 66, 100, 28),
        "昨日输赢": (-4.86, 18, 130, 28),
        "昨日输赢值": (87, 18, 100, 28),
        "总输赢": (-4.86, -31, 130, 28),
        "总输赢值": (87, -31, 100, 28),
        "今日贡献": (202, 66, 130, 28),
        "今日贡献值": (295, 66, 100, 28),
        "昨日贡献": (202, 18, 130, 28),
        "昨日贡献值": (295, 18, 100, 28),
        "总贡献": (202, -31, 130, 28),
        "总贡献值": (295, -31, 100, 28),
        "资料分隔线": (-103, 31, 2, 116),
        "盟主底色": (0, 0, 690, 204),
    }
    hide = ["余额", "积分值", "比例", "比例值", "状态底", "状态",
            "指标分隔线", "成员删除", "成员赠予", "设置", "对话", "额度", "额度值", "玩家热区"]
    keep_visible = ["头像", "姓名", "玩家ID", "身份", "团队人数", "团队人数值",
                    "今日输赢", "今日输赢值", "昨日输赢", "昨日输赢值",
                    "总输赢", "总输赢值", "今日贡献", "今日贡献值",
                    "昨日贡献", "昨日贡献值", "总贡献", "总贡献值", "资料分隔线"]
    for name, (x, y, w, h) in layout.items():
        nid = child_by_name(b, row, name)
        if nid is None:
            continue
        set_pos(b, nid, x, y)
        set_size(b, nid, w, h)
    for name in hide:
        nid = child_by_name(b, row, name)
        if nid is not None:
            b.objs[nid]["_active"] = False
    for name in keep_visible:
        nid = child_by_name(b, row, name)
        if nid is not None:
            b.objs[nid]["_active"] = True
    # 所有统计标签/数值统一字号；标签在上、数值在右
    metric_labels = ["团队人数", "今日输赢", "昨日输赢", "总输赢", "今日贡献", "昨日贡献", "总贡献"]
    metric_values = ["团队人数值", "今日输赢值", "昨日输赢值", "总输赢值", "今日贡献值", "昨日贡献值", "总贡献值"]
    for name in metric_labels:
        nid = child_by_name(b, row, name)
        for c in b.objs[nid]["_components"]:
            co = b.objs[c["__id__"]]
            if co.get("__type__") == "cc.Label":
                co["_fontSize"] = 21
                co["_lineHeight"] = 24
                co["_N$horizontalAlign"] = 1
    for name in metric_values:
        nid = child_by_name(b, row, name)
        for c in b.objs[nid]["_components"]:
            co = b.objs[c["__id__"]]
            if co.get("__type__") == "cc.Label":
                co["_fontSize"] = 23
                co["_lineHeight"] = 27
                co["_N$horizontalAlign"] = 1

    # 总红利只由链路接口下发，补在右列第 4 行
    bonus_label = b.node("总红利", row, 130, 28, 202, -79)
    b.label(bonus_label, "总红利", 21, dict(LABEL_COLOR), 1, 24)
    bonus_value = b.node("总红利值", row, 100, 30, 295, -79)
    b.label(bonus_value, "—", 23, dict(GOLD_COLOR), 1, 27)
    # 姓名左对齐
    nid = child_by_name(b, row, "姓名")
    for c in b.objs[nid]["_components"]:
        co = b.objs[c["__id__"]]
        if co.get("__type__") == "cc.Label":
            co["_N$horizontalAlign"] = 0
    nid = child_by_name(b, row, "玩家ID")
    for c in b.objs[nid]["_components"]:
        co = b.objs[c["__id__"]]
        if co.get("__type__") == "cc.Label":
            co["_N$horizontalAlign"] = 0
    # 身份左对齐并加金色
    nid = child_by_name(b, row, "身份")
    b.objs[nid]["_color"] = dict(GOLD_COLOR)
    for c in b.objs[nid]["_components"]:
        co = b.objs[c["__id__"]]
        if co.get("__type__") == "cc.Label":
            co["_N$horizontalAlign"] = 1
            co["_fontSize"] = 22
            co["_lineHeight"] = 26

    note = b.node("说明", root, 690, 30, 0, -612)
    b.label(note, "代理/群主行按当前俱乐部统计，总群主行按全联盟统计", 18, dict(DIM_COLOR), 1, 22)
    b.widget(note, 4, 0, 0, 0, 40, 690, 30)

    # 多链分块用的俱乐部标题；运行时按 chains[] 克隆
    # 俱乐部条：蓝玻璃底 + 上下金色细线 + 左侧金菱形，和 V8 其它分组头一致
    group_head = b.node("链标题", content, 690, 56, 0, 0, active=False, opacity=240)
    b.sprite(group_head, FONT_PANEL, 1)
    for line_name, line_y in (("顶线", 26), ("底线", -26)):
        line = b.node(line_name, group_head, 660, 2, 0, line_y, opacity=210)
        b.objs[line]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 214, "b": 130, "a": 255}
        b.sprite(line, "a23235d1-15db-4b95-8439-a2e005bfff91")
    diamond = b.node("菱形", group_head, 20, 20, -325, 0)
    b.sprite(diamond, "5e4f2693-b61b-4d11-94e3-477a46ecdd56")
    group_name = b.node("名称", group_head, 600, 32, -5, 0)
    b.label(group_name, "俱乐部", 24, dict(GOLD_COLOR), 0, 28)

    group_empty = b.node("链空", content, 690, 50, 0, 0, active=False)
    b.label(group_empty, "无上级代理", 22, dict(DIM_COLOR), 1, 26)

    # 空态 / 加载 / 错误
    empty = b.node("空状态", root, 500, 60, 0, -110, active=False)
    b.label(empty, "无上级代理", 26, dict(DIM_COLOR), 1, 30)

    loading = b.node("加载", root, 400, 60, 0, -110, active=False)
    b.label(loading, "加载中…", 24, dict(DIM_COLOR), 1, 28)

    err = b.node("错误", root, 560, 220, 0, -110, active=False)
    err_text = b.node("文案", err, 520, 90, 0, 50)
    b.label(err_text, "网络异常，请稍后重试", 24, dict(LABEL_COLOR), 1, 28, wrap=True)
    retry = b.node("重试", err, 190, 64, 0, -60)
    b.sprite(retry, FONT_BTN, 1)
    b.button(retry)
    retry_text = b.node("文字", retry, 170, 56, 0, 0)
    b.label(retry_text, "重试", 24, dict(GOLD_COLOR), 1, 28)

    # 去掉未引用的孤儿对象（例如被移除的行内按钮组件），并重排 __id__。
    def compact(objs):
        mapping = {}
        kept = []

        def visit(idx):
            if idx in mapping:
                return
            mapping[idx] = len(kept)
            kept.append(objs[idx])
            walk(objs[idx])

        def walk(obj):
            if isinstance(obj, dict):
                if "__id__" in obj:
                    visit(obj["__id__"])
                else:
                    for value in obj.values():
                        walk(value)
            elif isinstance(obj, list):
                for value in obj:
                    walk(value)

        def rewrite(obj):
            if isinstance(obj, dict):
                if "__id__" in obj:
                    obj["__id__"] = mapping[obj["__id__"]]
                else:
                    for value in obj.values():
                        rewrite(value)
            elif isinstance(obj, list):
                for value in obj:
                    rewrite(value)

        visit(0)
        for idx in list(mapping):
            rewrite(kept[mapping[idx]])
        return kept

    b.objs = compact(b.objs)

    # 输出
    data = json.dumps(b.objs, ensure_ascii=False, indent=2)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(data)
    if not os.path.exists(OUT_META):
        with open(OUT_META, "w", encoding="utf-8") as f:
            json.dump({
                "ver": "1.3.2", "uuid": str(uuid.uuid4()), "importer": "prefab",
                "optimizationPolicy": "AUTO", "asyncLoadAssets": False,
                "readonly": False, "subMetas": {},
            }, f, ensure_ascii=False, indent=2)
    print("written", OUT, len(b.objs), "objects")


if __name__ == "__main__":
    main()
