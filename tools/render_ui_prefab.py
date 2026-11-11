#!/usr/bin/env python3
"""Render a Cocos 2.4 UI prefab to PNG for visual review (no engine needed).

Supports the subset used by the 我的红利 panels: cc.Node, cc.Sprite (plain and
9-sliced), cc.Label (TTF and bitmap font), cc.Mask clipping and node offsets.
Widgets are ignored because the serialized positions already target 750x1334.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "assets/V7"
TTF = str(ROOT / "assets/font/PingFF.ttf")
W, H = 750, 1334


def load_meta_index():
    tex, frame = {}, {}
    for meta_path in (ROOT / "assets").glob("**/*.png.meta"):
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            continue
        png = Path(str(meta_path)[:-5])
        for sm in (meta.get("subMetas") or {}).values():
            if sm.get("importer") == "sprite-frame":
                frame[sm["uuid"]] = (png, sm)
        tex[meta.get("uuid")] = png
    return frame


FRAMES = load_meta_index()


class Digits:
    cache = {}

    def __init__(self, png: Path, fnt: Path):
        self.img = Image.open(png).convert("RGBA")
        self.base = 128
        self.chars = {}
        for line in fnt.read_text().splitlines():
            if line.startswith("char id="):
                kv = dict(p.split("=", 1) for p in line.split() if "=" in p)
                self.chars[int(kv["id"])] = tuple(int(kv[k]) for k in
                                                  ("x", "y", "width", "height", "xoffset", "yoffset", "xadvance"))
        self.base = int(re.search(r"size=(\d+)", fnt.read_text()).group(1))

    @classmethod
    def get(cls, fnt_path: Path):
        key = str(fnt_path)
        if key not in cls.cache:
            png = fnt_path.with_suffix(".png")
            cls.cache[key] = cls(png, fnt_path)
        return cls.cache[key]

    def draw(self, canvas, text, cx, cy, size):
        scale = size / self.base
        glyphs = [self.chars.get(ord(c)) for c in text]
        total = sum(g[6] for g in glyphs if g) * scale
        top = min((g[5] for g in glyphs if g), default=0)
        bottom = max((g[5] + g[3] for g in glyphs if g), default=self.base)
        vc = (top + bottom) / 2 * scale
        x = cx - total / 2
        for g in glyphs:
            if not g:
                x += size * 0.3
                continue
            gx, gy, gw, gh, ox, oy, adv = g
            crop = self.img.crop((gx, gy, gx + gw, gy + gh))
            crop = crop.resize((max(1, round(gw * scale)), max(1, round(gh * scale))), Image.LANCZOS)
            canvas.alpha_composite(crop, (round(x + ox * scale), round(cy - vc + oy * scale)))
            x += adv * scale


def nine(img, size, border):
    b = 32
    w, h = size
    l, r, t, bo = border
    l, r, t, bo = max(l, 1), max(r, 1), max(t, 1), max(bo, 1)
    out = Image.new("RGBA", (round(w), round(h)), (0, 0, 0, 0))
    xs = [0, l, img.width - r, img.width]
    ys = [0, t, img.height - bo, img.height]
    dx = [0, l, w - r, w]
    dy = [0, t, h - bo, h]
    for row in range(3):
        for col in range(3):
            if dx[col + 1] - dx[col] <= 0 or dy[row + 1] - dy[row] <= 0:
                continue
            part = img.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
            part = part.resize((round(dx[col + 1] - dx[col]), round(dy[row + 1] - dy[row])), Image.LANCZOS)
            out.paste(part, (round(dx[col]), round(dy[row])))
    return out


FNT_CACHE = {}


def fnt_for(uuid):
    if uuid in FNT_CACHE:
        return FNT_CACHE[uuid]
    for p in ASSET.glob("*.fnt"):
        meta = Path(str(p) + ".meta")
        if meta.exists() and json.loads(meta.read_text())["uuid"] == uuid:
            FNT_CACHE[uuid] = p
            return p
    FNT_CACHE[uuid] = None
    return None


def color_of(node):
    c = node.get("_color") or {}
    return (c.get("r", 255), c.get("g", 255), c.get("b", 255), node.get("_opacity", 255))


def main(prefab_path):
    global H
    if len(sys.argv) > 3:
        H = int(sys.argv[3])
    data = json.loads(Path(prefab_path).read_text())
    canvas = Image.new("RGBA", (W, H), (5, 18, 34, 255))

    def comps(node):
        return [data[r["__id__"]] for r in node.get("_components", [])]

    rows = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    def walk(node_id, ox, oy, clip=None, pw=W, ph=H):
        node = data[node_id]
        if not node.get("_active", True):
            if node.get("_name") == "记录行" and rows:
                arr0 = node["_trs"]["array"][1]
                node["_active"] = True
                for i in range(rows):
                    node["_trs"]["array"][1] = -42 - 96 * i
                    walk(node_id, ox, oy, clip, pw, ph)
                node["_trs"]["array"][1] = arr0
                node["_active"] = False
            return
        arr = node["_trs"]["array"]
        w = node["_contentSize"]["width"]
        h = node["_contentSize"]["height"]
        lx, ly = arr[0], arr[1]
        for comp in comps(node):
            if comp.get("__type__") == "cc.Widget" and comp.get("_enabled", True) and comp.get("_alignMode", 1) == 1:
                f = comp.get("_alignFlags", 0)
                top, bottom = comp.get("_top", 0), comp.get("_bottom", 0)
                left, right = comp.get("_left", 0), comp.get("_right", 0)
                if (f & 1) and (f & 4):
                    h = ph - top - bottom
                    ly = (bottom - top) / 2
                elif f & 1:
                    ly = ph / 2 - top - h / 2
                elif f & 4:
                    ly = -ph / 2 + bottom + h / 2
                if (f & 8) and (f & 32):
                    w = pw - left - right
                    lx = (left - right) / 2
                elif f & 8:
                    lx = -pw / 2 + left + w / 2
                elif f & 32:
                    lx = pw / 2 - right - w / 2
        if node_id == root:
            x, y = W / 2, H / 2
        else:
            x, y = ox + lx, oy - ly
        ap = node.get("_anchorPoint") or {"x": .5, "y": .5}
        left, top = x - ap["x"] * w, y - (1 - ap["y"]) * h
        node_clip = clip
        for comp in comps(node):
            t = comp.get("__type__")
            if t == "cc.Sprite" and comp.get("_enabled", True):
                ref = comp.get("_spriteFrame") or {}
                info = FRAMES.get(ref.get("__uuid__"))
                if not info:
                    continue
                png, sm = info
                img = Image.open(png).convert("RGBA")
                if comp.get("_type") == 1:
                    border = (sm.get("borderLeft", 0), sm.get("borderRight", 0),
                              sm.get("borderTop", 0), sm.get("borderBottom", 0))
                    img = nine(img, (w, h), border)
                else:
                    img = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
                layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                layer.alpha_composite(img, (round(left), round(top)))
                if clip:
                    m = Image.new("L", (W, H), 0)
                    ImageDraw.Draw(m).rectangle(clip, fill=255)
                    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (W, H), 0), m))
                canvas.alpha_composite(layer)
            elif t == "cc.Label" and comp.get("_enabled", True):
                value = comp.get("_N$string", comp.get("_string", ""))
                size = comp.get("_fontSize", 24)
                col = color_of(node)
                font_ref = (comp.get("_N$file") or {}).get("__uuid__")
                fnt = fnt_for(font_ref)
                layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                if fnt:
                    Digits.get(fnt).draw(layer, value, x, y, size)
                else:
                    d = ImageDraw.Draw(layer)
                    font = ImageFont.truetype(TTF, size)
                    d.text((x, y), value, font=font, fill=col, anchor="mm")
                if clip:
                    m = Image.new("L", (W, H), 0)
                    ImageDraw.Draw(m).rectangle(clip, fill=255)
                    layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (W, H), 0), m))
                canvas.alpha_composite(layer)
            elif t == "cc.Mask":
                node_clip = (round(left), round(top), round(left + w), round(top + h))
        for child in node.get("_children", []):
            walk(child["__id__"], x, y, node_clip, w, h)

    root = next(i for i, o in enumerate(data) if o.get("__type__") == "cc.Node" and o.get("_parent") is None)
    walk(root, W / 2, H / 2, None, W, H)
    out = ROOT / "temp" / f"{Path(prefab_path).stem}-render-{H}.png"
    canvas.convert("RGB").save(out)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/resources/UI/panelMyHongli.prefab")
