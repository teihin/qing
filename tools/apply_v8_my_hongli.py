#!/usr/bin/env python3
"""Apply the approved V8 "我的红利" skin to the formal club and union prefabs.

Editor-time migration only: every SpriteFrame, 9-slice flag and Label font is
serialized into the Prefab so the result is visible in Cocos Creator without
running the game. Node names, event bindings and script contracts are untouched.
"""
from __future__ import annotations

import base64
import copy
import json
import uuid
from pathlib import Path

from PIL import Image

import apply_v7_prefab_skin as skin
from apply_v7_prefab_skin import Prefab, ROOT

ASSET_DIR = ROOT / "assets/V7"

PAGES = ["assets/resources/UI/panelMyHongli.prefab",
         "assets/resources/UI/panelUnionHongli.prefab"]
OUT = ROOT / "art_sources/v8-repairs/my-hongli"

GOLD = {"__type__": "cc.Color", "r": 255, "g": 233, "b": 180, "a": 255}
WHITE = {"__type__": "cc.Color", "r": 240, "g": 247, "b": 253, "a": 255}
MUTED = {"__type__": "cc.Color", "r": 202, "g": 223, "b": 238, "a": 255}
TINT = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
DIGITS = "_N$file"
SPRITES = [
    ("统计", "hongli_v8_stats_card", False),
    ("未领取底", "hongli_v8_claim_bar", False),
    ("提取红利", "hongli_v8_btn_extract", False),
    ("记录", "hongli_v8_btn_extract", False),
    ("列表面板", "hongli_v8_list_frame", True),
    ("表头", "hongli_v8_table_header", False),
    ("列表/视口/内容/记录行", "hongli_v8_row", False),
    ("分页", "hongli_v8_pager", False),
    ("分页/页码底", "hongli_v8_page_value", False),
]


def frame_uuid(name: str) -> str:
    stem = name[:-4] if name.endswith(".png") else name
    meta = json.loads((ASSET_DIR / f"{stem}.png.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][stem]["uuid"]


skin.ASSET_DIR = ASSET_DIR
skin.frame_uuid = frame_uuid


def new(p: Prefab, parent: str, name: str) -> str:
    path = f"{parent}/{name}"
    try:
        p.node(path)
        return path
    except KeyError:
        pass
    template = copy.deepcopy(p.data[p.root])
    ident = uuid.uuid5(uuid.NAMESPACE_URL, f"qing/v8-my-hongli/{p.path.name}/{path}")
    i = len(p.data)
    template.update(_name=name, _parent={"__id__": p.node(parent)}, _children=[], _components=[],
                    _active=True, _prefab={"__id__": i + 1})
    template["_trs"] = copy.deepcopy(template["_trs"])
    template["_trs"]["array"] = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
    template["_contentSize"] = {"__type__": "cc.Size", "width": 100, "height": 100}
    template["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    template["_opacity"] = 255
    template["_color"] = copy.deepcopy(TINT)
    info = copy.deepcopy(p.data[p.data[p.root]["_prefab"]["__id__"]])
    info.update(fileId=ident.hex[:2] + base64.b64encode(ident.bytes[1:]).decode())
    p.data.extend([template, info])
    p.data[p.node(parent)]["_children"].append({"__id__": i})
    return path


def add_sprite(p: Prefab, parent: str, name: str, asset: str, x, y, w, h, sliced=False) -> str:
    path = new(p, parent, name)
    n = p.node(path)
    node = p.data[n]
    node["_contentSize"] = {"__type__": "cc.Size", "width": w, "height": h}
    node["_trs"]["array"][0:2] = [x, y]
    p.sprite(n, asset, sliced)
    return path


def label_of(p: Prefab, path: str):
    n = p.node(path)
    cid, comp = p.component(n, "cc.Label")
    return n, cid, comp


def set_text_label(p: Prefab, path: str, *, size=None, color=None, active=None, keep_shadow=True):
    n, cid, comp = label_of(p, path)
    if size is not None:
        comp["_fontSize"] = size
        comp["_lineHeight"] = size + 5
    if color is not None:
        p.data[n]["_color"] = copy.deepcopy(color)
    if active is not None:
        p.data[n]["_active"] = active
    if not keep_shadow:
        p.disable(n, "cc.LabelShadow")
    return n


def set_bitmap_label(p: Prefab, path: str, *, size, color=None, w=None, h=None, x=None, y=None):
    n, cid, comp = label_of(p, path)
    comp.update(_enabled=True, _string="-", _fontSize=size, _lineHeight=int(size * 1.12), _styleFlags=0,
                _isSystemFontUsed=False, _enableWrapText=False, **{"_N$overflow": 2},
                **{DIGITS: {"__uuid__": frame_font_uuid}, "_N$string": "-"})
    if color is not None:
        p.data[n]["_color"] = copy.deepcopy(color)
    p.disable(n, "cc.LabelShadow")
    p.disable(n, "cc.LabelOutline")
    node = p.data[n]
    if w is not None:
        node["_contentSize"]["width"] = w
    if h is not None:
        node["_contentSize"]["height"] = h
    if x is not None or y is not None:
        arr = node["_trs"]["array"]
        arr[0] = arr[0] if x is None else x
        arr[1] = arr[1] if y is None else y
    return n


def art_size(asset: str):
    w, h = Image.open(ASSET_DIR / f"{asset}.png").size
    return w / 2, h / 2


def art_on_label(p: Prefab, path: str, asset: str, x=None, y=None):
    """Swap a static text label for art text.

    The art lives on a child node (same shape as the already-working 标题/美术字)
    instead of sharing the node with the disabled Label component.
    """
    n, cid, comp = label_of(p, path)
    comp["_enabled"] = False
    p.disable(n, "cc.LabelShadow")
    p.disable(n, "cc.LabelOutline")
    node = p.data[n]
    if x is not None or y is not None:
        arr = node["_trs"]["array"]
        arr[0] = arr[0] if x is None else x
        arr[1] = arr[1] if y is None else y
    if "美术字" not in child_names(p, path):
        w, h = art_size(asset)
        add_sprite(p, path, "美术字", asset, 0, 0, round(w), round(h))
    return n


def child_names(p: Prefab, path: str):
    return [p.data[r["__id__"]]["_name"] for r in p.data[p.node(path)].get("_children", [])]


def apply_page(relative: str):
    p = Prefab(relative)
    before = OUT / "before"
    before.mkdir(parents=True, exist_ok=True)
    dest = before / (Path(relative).name + ".bak")
    if not dest.exists():
        dest.write_bytes((ROOT / relative).read_bytes())

    for node_path, asset, sliced in SPRITES:
        p.sprite(p.node(node_path), asset, sliced)

    # ---- header title: static art text, business nodes untouched
    p.disable(p.node("标题栏/标题"), "cc.Label")
    p.disable(p.node("标题栏/标题"), "cc.LabelOutline")
    p.disable(p.node("标题栏/标题"), "cc.LabelShadow")
    if "美术字" not in child_names(p, "标题栏/标题"):
        tw, th = art_size("hongli_v8_txt_title")
        add_sprite(p, "标题栏/标题", "美术字", "hongli_v8_txt_title", 0, 0, round(tw), round(th))

    # ---- statistics card
    # The stats plate is 638 wide and its baked separators sit at ±212.5.
    # Keep each 190px content cell centered on those separators instead of
    # inheriting the old left-shifted positions used by the laurel layout.
    for col, x, tag in (("今日红利", -212.5, "1"), ("昨日红利", 0, "2"), ("累计红利", 212.5, "3")):
        p.data[p.node(f"统计/{col}")]["_trs"]["array"][0] = x
        set_text_label(p, f"统计/{col}/title", color=GOLD, size=22)
        set_bitmap_label(p, f"统计/{col}/num", size=52, color=TINT, w=190, h=56, y=-21)
        # The previous B3 pass added outer laurel sprites. Keep their nodes
        # harmless for prefab compatibility, but remove them from rendering.
        for name in (f"桂冠左{tag}", f"桂冠右{tag}"):
            if name in child_names(p, "统计"):
                p.data[p.node(f"统计/{name}")]["_active"] = False

    # ---- unclaimed row
    if "金币" not in child_names(p, "未领取底"):
        add_sprite(p, "未领取底", "金币", "hongli_v8_coin", -173, 2, 34, 34)
    art_on_label(p, "未领取红利/title", "hongli_v8_txt_unclaimed", x=-69)
    # Center the amount inside the new right-hand amount bay.
    set_bitmap_label(p, "未领取红利/num", size=46, color=TINT, w=150, h=50, x=128)

    # ---- extract button art text + gift
    for btn in ("提取红利", "记录"):
        p.data[p.node(btn)]["_contentSize"]["width"] = 170
        p.data[p.node(btn)]["_contentSize"]["height"] = 62
    if "礼盒" not in child_names(p, "提取红利"):
        add_sprite(p, "提取红利", "礼盒", "hongli_v8_gift", -64, 0, 28, 28)
    art_on_label(p, "提取红利/V8文字", "hongli_v8_txt_extract", x=19)

    # ---- ledger header
    for name, x in (("玩家", -256.5), ("类型", -85.5), ("金额", 85.5), ("时间", 256.5)):
        set_text_label(p, f"表头/{name}", color=GOLD, size=24, active=True)
        p.data[p.node(f"表头/{name}")]["_trs"]["array"][0] = x
    dividers = [r["__id__"] for r in p.data[p.node("表头")]["_children"]
                if p.data[r["__id__"]]["_name"] == "列分隔"]
    for idx, nid in enumerate(dividers):
        p.sprite(nid, "hongli_v8_rule_v", False)
        p.data[nid]["_contentSize"] = {"__type__": "cc.Size", "width": 2, "height": 44}
        p.data[nid]["_trs"]["array"][0] = (-171, 0, 171)[idx]

    # ---- ledger row template
    row = "列表/视口/内容/记录行"
    for name in ("玩家", "类型", "时间"):
        set_text_label(p, f"{row}/{name}", color=WHITE, size=24, keep_shadow=False)
    set_bitmap_label(p, f"{row}/金额", size=34, color=TINT, w=171, h=44)
    row_dividers = [r["__id__"] for r in p.data[p.node(row)]["_children"]
                    if p.data[r["__id__"]]["_name"] == "列分隔"]
    for idx, nid in enumerate(row_dividers):
        p.sprite(nid, "hongli_v8_rule_v", False)
        p.data[nid]["_contentSize"] = {"__type__": "cc.Size", "width": 2, "height": 40}
        p.data[nid]["_trs"]["array"][0] = (-171, 0, 171)[idx]

    # hidden 记录 button keeps readable text on the gold plate
    if "记录" in [p.data[r["__id__"]]["_name"] for r in p.data[p.data[p.node("记录")]["_parent"]["__id__"]]["_children"]]:
        set_text_label(p, "记录/V8文字", color={"__type__": "cc.Color", "r": 72, "g": 44, "b": 12, "a": 255},
                       size=23, keep_shadow=False)

    # ---- paging + hint
    set_text_label(p, "分页/页码", color=GOLD, size=26)

    p.save()
    return relative


frame_font_uuid = json.loads((ASSET_DIR / "hongli_v8_digits.fnt.meta").read_text())["uuid"]

if __name__ == "__main__":
    for page in PAGES:
        print("patched", apply_page(page))
