#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 panelGameSettings.prefab 按 Widget 规则离屏渲染成 PNG，用于布局自检。

不是游戏内渲染，只校验位置/尺寸/层级，输出到 /tmp/panelGameSettings_preview.png
"""
import json, os, glob
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets", "resources", "UI", "panelGameSettings.prefab")
W, H = 750, int(os.environ.get("PREVIEW_H", "1334"))
FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"

# uuid -> png
UUID2PNG = {}
for m in glob.glob(os.path.join(ROOT, "assets", "**", "*.png.meta"), recursive=True):
    try:
        j = json.load(open(m, encoding="utf-8"))
    except Exception:
        continue
    for k, v in (j.get("subMetas") or {}).items():
        UUID2PNG[v["uuid"]] = m[: -len(".meta")]

d = json.load(open(PREFAB, encoding="utf-8"))
SHOW = [name for name in os.environ.get("PREVIEW_SHOW", "").split(",") if name]
if SHOW:
    for o in d:
        if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") in (
                "卡片", "规则卡片", "弹窗", "创建规则弹窗", "删除规则弹窗"):
            o["_active"] = o.get("_name") in SHOW
if os.environ.get("PREVIEW_RULE_ROW"):
    for o in d:
        if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") == "规则行":
            o["_active"] = True
            o["_trs"]["array"][1] = -125
if os.environ.get("SHOW_MODAL"):
    for o in d:
        if isinstance(o, dict) and o.get("__type__") == "cc.Node" and o.get("_name") == "弹窗":
            o["_active"] = True
def comp(node, t):
    for c in node.get("_components", []):
        o = d[c["__id__"]]
        if o.get("__type__") == t:
            return o, c["__id__"]
    return None, None


def layout(node, px, py, pw, ph, parent_anchor=(0.5, 0.5)):
    """返回 (cx, cy, w, h)，坐标以画布左上为原点。"""
    x, y = node["_trs"]["array"][0], node["_trs"]["array"][1]
    w, h = node["_contentSize"]["width"], node["_contentSize"]["height"]
    ax, ay = node["_anchorPoint"]["x"], node["_anchorPoint"]["y"]
    ox = px + pw * parent_anchor[0]
    oy = py + ph * (1 - parent_anchor[1])
    left = ox + x - w * ax
    top = oy - y - h * (1 - ay)
    widg, _ = comp(node, "cc.Widget")
    if widg:
        f = widg["_alignFlags"]
        L, R = f & 8, f & 32
        T, B = f & 1, f & 4
        C, M = f & 16, f & 2
        if L and R:
            left = px + widg["_left"]
            w = pw - widg["_left"] - widg["_right"]
        elif L:
            left = px + widg["_left"]
        elif R:
            left = px + pw - widg["_right"] - w
        elif C:
            left = px + pw / 2 + widg["_horizontalCenter"] - w / 2
        if T and B:
            top = py + widg["_top"]
            h = ph - widg["_top"] - widg["_bottom"]
        elif T:
            top = py + widg["_top"]
        elif B:
            top = py + ph - widg["_bottom"] - h
        elif M:
            top = py + ph / 2 - widg["_verticalCenter"] - h / 2
    return left, top, w, h


def tint(img, color, opacity):
    img = img.convert("RGBA")
    r, g, b, a = img.split()
    from PIL import ImageEnhance
    solid = Image.new("RGBA", img.size, (color[0], color[1], color[2], 255))
    out = Image.composite(solid, Image.new("RGBA", img.size, (0, 0, 0, 0)), a.point(lambda v: 255 if v else 0))
    # 用乘法近似：保留原图明暗
    px = img.load()
    tx = out.load()
    # 简化：按 color/255 缩放
    scaled = img.point(lambda v: v)
    R = r.point(lambda v: v * color[0] // 255)
    G = g.point(lambda v: v * color[1] // 255)
    B = b.point(lambda v: v * color[2] // 255)
    A = a.point(lambda v: v * opacity // 255)
    return Image.merge("RGBA", (R, G, B, A))


canvas = Image.new("RGBA", (W, H), (3, 10, 20, 255))
draw = ImageDraw.Draw(canvas)


def render(nid, px, py, pw, ph, forced=None, clip_bottom=None, parent_anchor=(0.5, 0.5)):
    node = d[nid]
    if not node.get("_active", True):
        return
    left, top, w, h = forced if forced else layout(node, px, py, pw, ph, parent_anchor)
    left, top, w, h = int(round(left)), int(round(top)), max(1, int(round(w))), max(1, int(round(h)))
    sp, _ = comp(node, "cc.Sprite")
    if sp and sp.get("_spriteFrame"):
        path = UUID2PNG.get(sp["_spriteFrame"]["__uuid__"])
        if path and os.path.exists(path):
            img = Image.open(path)
            img = img.resize((w, h), Image.LANCZOS)
            col = node["_color"]
            img = tint(img, (col["r"], col["g"], col["b"]), node.get("_opacity", 255))
            canvas.alpha_composite(img, (left, top))
        else:
            draw.rectangle([left, top, left + w, top + h], outline=(255, 0, 0, 160))
    lb, _ = comp(node, "cc.Label")
    if lb and lb.get("_string"):
        size = int(lb["_fontSize"] * 1.0)
        try:
            font = ImageFont.truetype(FONT_PATH, size)
        except Exception:
            font = ImageFont.load_default()
        nc = node["_color"]
        col = (nc["r"], nc["g"], nc["b"], 255)
        txt = lb["_string"]
        tw = draw.textlength(txt, font=font)
        if lb["_N$horizontalAlign"] == 0:
            ox = left
        else:
            ox = left + (w - tw) / 2
        oy = top + (h - size * 1.25) / 2
        draw.text((ox, oy), txt, font=font, fill=col)
    has_mask = comp(node, "cc.Mask")[0] is not None
    child_clip = top + h if has_mask else clip_bottom
    lay, _ = comp(node, "cc.Layout")
    if lay:
        cy = top + lay.get("_N$paddingTop", 0)
        for c in node.get("_children", []):
            cw = d[c["__id__"]]["_contentSize"]["width"]
            ch = d[c["__id__"]]["_contentSize"]["height"]
            if child_clip is not None and cy + ch > child_clip:
                break
            render(c["__id__"], left, top, w, h, (left + (w - cw) / 2, cy, cw, ch), child_clip)
            cy += ch + lay.get("_N$spacingY", 0)
        return
    anchor = (node["_anchorPoint"]["x"], node["_anchorPoint"]["y"])
    for c in node.get("_children", []):
        render(c["__id__"], left, top, w, h, clip_bottom=child_clip, parent_anchor=anchor)


render(1, 0, 0, W, H)
out = os.environ.get("PREVIEW_OUT") or ("/tmp/panelGameSettings_preview_modal.png" if os.environ.get("SHOW_MODAL") else "/tmp/panelGameSettings_preview.png")
canvas.convert("RGB").save(out)
print("saved", out)
