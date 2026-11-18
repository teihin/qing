#!/usr/bin/env python3
"""把 Cocos 2.x prefab 近似渲染成 PNG，用于对比设计稿。仅临时调试用。"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Volumes/SSD/qing"
FONT = os.path.join(ROOT, "assets/font/PingFF.ttf")


def build_uuid_map():
    u2p = {}
    for base in ("assets",):
        for r, _, files in os.walk(os.path.join(ROOT, base)):
            for f in files:
                if not f.endswith(".meta"):
                    continue
                try:
                    m = json.load(open(os.path.join(r, f)))
                except Exception:
                    continue
                p = os.path.join(r, f[:-5])
                if m.get("uuid"):
                    u2p[m["uuid"]] = p
                for k, v in (m.get("subMetas") or {}).items():
                    if v.get("uuid"):
                        u2p[v["uuid"]] = p
    return u2p


U2P = build_uuid_map()
IMG_CACHE = {}


def load_img(path):
    if path in IMG_CACHE:
        return IMG_CACHE[path]
    try:
        im = Image.open(path).convert("RGBA")
    except Exception:
        im = None
    IMG_CACHE[path] = im
    return im


class Ctx:
    def __init__(self, data):
        self.d = data

    def comp(self, idx):
        return self.d[idx]


def color_of(c):
    if not isinstance(c, dict):
        return (255, 255, 255, 255)
    return (c.get("r", 255), c.get("g", 255), c.get("b", 255), c.get("a", 255))


def render(prefab, out, size=(750, 1334), bg=(0, 0, 0, 255), root_id=1):
    data = json.load(open(prefab))
    canvas = Image.new("RGBA", size, bg)

    def draw_node(idx, ox, oy, sx, sy, clip):
        node = data[idx]
        trs = node.get("_trs", {}).get("array", [0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
        if node.get("_parent") is None:
            x, y = ox, oy
        else:
            x = ox + trs[0] * sx
            y = oy - trs[1] * sy
        cs = node.get("_contentSize", {})
        w = cs.get("width", 0) * sx * trs[7]
        h = cs.get("height", 0) * sy * trs[8]
        if not node.get("_active", True):
            return
        ax = node.get("_anchorPoint", {}).get("x", 0.5)
        ay = node.get("_anchorPoint", {}).get("y", 0.5)
        left = x - w * ax
        top = y - h * (1 - ay)
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        newclip = clip

        for c in node.get("_components", []):
            comp = data[c["__id__"]]
            if not comp.get("_enabled", True):
                continue
            t = comp.get("__type__")
            if t == "cc.Sprite":
                sf = comp.get("_spriteFrame")
                if not sf:
                    continue
                p = U2P.get(sf.get("__uuid__"))
                im = load_img(p) if p else None
                if im is None:
                    continue
                tw, th = im.size
                mode = comp.get("_sizeMode", 0)
                if mode == 1:  # TRIMMED -> node follows texture
                    w2, h2, l2, t2 = tw * sx * trs[7], th * sy * trs[8], x - tw * ax, y - th * (1 - ay)
                else:
                    w2, h2, l2, t2 = w, h, left, top
                if w2 < 0.5 or h2 < 0.5:
                    continue
                im2 = im.resize((max(1, int(round(w2))), max(1, int(round(h2)))), Image.LANCZOS)
                col = comp.get("_color") or {}
                if col and (col.get("r", 255), col.get("g", 255), col.get("b", 255)) != (255, 255, 255):
                    arr = np.array(im2)
                    mul = np.array([col.get("r", 255), col.get("g", 255), col.get("b", 255), 255]) / 255.0
                    arr = (arr * mul).astype(np.uint8)
                    im2 = Image.fromarray(arr, "RGBA")
                op = comp.get("_N$opacity", 255)
                if op < 255:
                    a = np.array(im2)
                    a[..., 3] = (a[..., 3].astype(np.float32) * op / 255).astype(np.uint8)
                    im2 = Image.fromarray(a, "RGBA")
                layer.alpha_composite(im2, (int(round(l2)), int(round(t2))))
            elif t == "cc.Label":
                s = comp.get("_N$string", comp.get("_string", ""))
                if not s:
                    continue
                fs = comp.get("_fontSize", 20)
                fnt = ImageFont.truetype(FONT, int(round(fs * sy * trs[8])))
                col = color_of(comp.get("_color"))
                outline = None
                for c2 in node.get("_components", []):
                    cc2 = data[c2["__id__"]]
                    if cc2.get("__type__") == "cc.LabelOutline":
                        outline = (color_of(cc2.get("_color")), max(1, int(round(cc2.get("_width", 1) * sy))))
                d = ImageDraw.Draw(layer)
                fl = comp.get("_N$horizontalAlign", 1)
                fva = comp.get("_N$verticalAlign", 1)
                bb = d.textbbox((0, 0), s, font=fnt, stroke_width=(outline[1] if outline else 0))
                tw2, th2 = bb[2] - bb[0], bb[3] - bb[1]
                if fl == 0:
                    px = left
                elif fl == 1:
                    px = left + (w - tw2) / 2 - bb[0]
                else:
                    px = left + w - tw2 - bb[0]
                if fva == 0:
                    py = top
                elif fva == 1:
                    py = top + (h - th2) / 2 - bb[1]
                else:
                    py = top + h - th2 - bb[1]
                d.text((px, py), s, font=fnt, fill=col,
                       stroke_width=(outline[1] if outline else 0),
                       stroke_fill=(outline[0] if outline else None))
            elif t == "cc.Mask":
                typ = comp.get("_type", 0)
                ellipse = typ != 0
                newclip = (left, top, left + w, top + h, ellipse)

        if clip is not None:
            m = Image.new("L", size, 0)
            dm = ImageDraw.Draw(m)
            cl, ct, cr, cb, ell = clip
            if ell:
                dm.ellipse([cl, ct, cr, cb], fill=255)
            else:
                dm.rectangle([cl, ct, cr, cb], fill=255)
            a = np.array(layer)
            a[..., 3] = (a[..., 3].astype(np.float32) * (np.array(m) / 255)).astype(np.uint8)
            layer = Image.fromarray(a, "RGBA")

        canvas.alpha_composite(layer)

        for ch in node.get("_children", []):
            draw_node(ch["__id__"], x, y, sx * trs[7], sy * trs[8], newclip)

    draw_node(root_id, size[0] / 2, size[1] / 2, 1, 1, None)
    if bg[3] < 255:
        canvas.save(out)
    else:
        canvas.convert("RGB").save(out)
    return out


if __name__ == "__main__":
    p = sys.argv[1]
    o = sys.argv[2] if len(sys.argv) > 2 else "/tmp/prefab.png"
    render(p, o)
    print(o)
