"""把 panelClubGoldPad.prefab 的节点树离线渲染成设计预览图（用于视觉验收，不参与运行）。

用法：python tools/preview_chat_gold_pad.py <输出png> [背景图]
背景图默认用 1 对 1 聊天页实机截图，缺失时用纯色。
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFAB = os.path.join(ROOT, "assets/resources/UI/panelClubGoldPad.prefab")
FONT = os.path.join(ROOT, "assets/font/PingFF.ttf")
W, H = 750, 1334

import sys as _sys
data = json.load(open(_sys.argv[3] if len(_sys.argv) > 3 else PREFAB))
idx_by_uuid = {}
for base, _dirs, files in os.walk(os.path.join(ROOT, "assets")):
    for f in files:
        if not f.endswith(".meta"):
            continue
        p = os.path.join(base, f)
        try:
            meta = json.load(open(p))
        except Exception:
            continue
        for _k, v in (meta.get("subMetas") or {}).items():
            if v.get("uuid"):
                idx_by_uuid[v["uuid"]] = p[:-5]
        if meta.get("uuid"):
            idx_by_uuid[meta["uuid"]] = p[:-5]


def trs(node):
    t = node.get("_trs") or {}
    a = t.get("array") if isinstance(t, dict) else None
    return a or [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]


def comps(node, kind):
    out = []
    for c in node.get("_components") or []:
        o = data[c["__id__"]]
        if o.get("__type__") == kind:
            out.append(o)
    return out


def nine_slice(img, tw, th, borders):
    l, r, t, bt = borders
    if l + r <= 0 or t + bt <= 0:
        return img.resize((tw, th), Image.LANCZOS)
    w, h = img.size
    xs_src = [0, l, w - r, w]
    ys_src = [0, t, h - bt, h]
    xs_dst = [0, l, tw - r, tw]
    ys_dst = [0, t, th - bt, th]
    out = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    for i in range(3):
        for j in range(3):
            sw = xs_src[i + 1] - xs_src[i]
            sh = ys_src[j + 1] - ys_src[j]
            dw = xs_dst[i + 1] - xs_dst[i]
            dh = ys_dst[j + 1] - ys_dst[j]
            if sw <= 0 or sh <= 0 or dw <= 0 or dh <= 0:
                continue
            piece = img.crop((xs_src[i], ys_src[j], xs_src[i + 1], ys_src[j + 1]))
            out.alpha_composite(piece.resize((dw, dh), Image.LANCZOS), (xs_dst[i], ys_dst[j]))
    return out


def draw_node(im, node_id, ox, oy, pax, pay, parent_w, parent_h):
    node = data[node_id]
    a = trs(node)
    w, h = node["_contentSize"]["width"], node["_contentSize"]["height"]
    ax, ay = node["_anchorPoint"]["x"], node["_anchorPoint"]["y"]
    px = ox + a[0]
    py = oy - a[1]
    left = px - ax * w
    top = py - (1 - ay) * h
    # Widget 四边拉伸（EditBox 的 textLabel/placeholderLabel 靠它铺满输入框）
    for wd in comps(node, "cc.Widget"):
        if wd.get("_alignFlags") == 45:
            pl, pt = ox - pax * parent_w, oy - (1 - pay) * parent_h
            left = pl + wd.get("_left", 0)
            top = pt + wd.get("_top", 0)
            w = parent_w - wd.get("_left", 0) - wd.get("_right", 0)
            h = parent_h - wd.get("_top", 0) - wd.get("_bottom", 0)
            break
    if not node.get("_active", True):
        return
    for sp in comps(node, "cc.Sprite"):
        if not sp.get("_enabled", True):
            continue
        uid = (sp.get("_spriteFrame") or {}).get("__uuid__")
        path = idx_by_uuid.get(uid)
        col = node.get("_color") or {}
        if not path or not os.path.exists(path):
            # builtin 白图（如全屏遮罩）：按节点色 + 透明度铺一块纯色
            if not col:
                continue
            solid = Image.new("RGBA", (max(int(w), 1), max(int(h), 1)),
                              (col.get("r", 255), col.get("g", 255), col.get("b", 255),
                               int(node.get("_opacity", 255))))
            im.alpha_composite(solid, (int(round(left)), int(round(top))))
            continue
        src = Image.open(path).convert("RGBA")
        if sp.get("_type") == 1:
            meta = json.load(open(path + ".meta"))
            sub = list(meta["subMetas"].values())[0]
            img = nine_slice(src, max(int(w), 1), max(int(h), 1),
                             (sub["borderLeft"], sub["borderRight"], sub["borderTop"], sub["borderBottom"]))
        else:
            img = src.resize((max(int(w), 1), max(int(h), 1)), Image.LANCZOS)
        col = node.get("_color") or {}
        if col and (col.get("r", 255), col.get("g", 255), col.get("b", 255)) != (255, 255, 255):
            tint = Image.new("RGBA", img.size, (col.get("r", 255), col.get("g", 255), col.get("b", 255), 255))
            img = Image.composite(tint, Image.new("RGBA", img.size, (0, 0, 0, 0)), img.split()[-1])
        alpha = node.get("_opacity", 255) / 255.0
        if alpha < 1:
            al = img.split()[-1].point(lambda v: int(v * alpha))
            img.putalpha(al)
        im.alpha_composite(img, (int(round(left)), int(round(top))))

    for lb in comps(node, "cc.Label"):
        text = lb.get("_string") or ""
        if not text:
            continue
        fs = int(lb.get("_fontSize") or 24)
        font = ImageFont.truetype(FONT, fs)
        col = node.get("_color") or {}
        rgb = (col.get("r", 255), col.get("g", 255), col.get("b", 255), 255)
        d = ImageDraw.Draw(im)
        bbox = d.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        align = lb.get("_N$horizontalAlign", 1)
        if align == 0:
            tx = left
        elif align == 2:
            tx = left + w - tw - bbox[0]
        else:
            tx = left + (w - tw) / 2 - bbox[0]
        ty = top + (h - th) / 2 - bbox[1]
        alpha = node.get("_opacity", 255) / 255.0
        fill = rgb if alpha >= 1 else (rgb[0], rgb[1], rgb[2], int(255 * alpha))
        d.text((tx, ty), text, font=font, fill=fill)

    for ch in node.get("_children") or []:
        draw_node(im, ch["__id__"], px, py, ax, ay, w, h)


def render(bg_path=None, out="preview.png"):
    if bg_path and os.path.exists(bg_path):
        bg = Image.open(bg_path).convert("RGBA").resize((W, H), Image.LANCZOS)
    else:
        bg = Image.new("RGBA", (W, H), (10, 16, 28, 255))
    root = 1
    # 根节点锚点落在画布左下角，_trs 再偏移到画布中心
    draw_node(bg, root, 0, H, 0, 0, W, H)
    bg.save(out)
    print("preview ->", out)
    return out


if __name__ == "__main__":
    render(sys.argv[2] if len(sys.argv) > 2 else None,
           sys.argv[1] if len(sys.argv) > 1 else "/tmp/gd/preview.png")
