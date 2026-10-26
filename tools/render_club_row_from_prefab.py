#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读 panelMain.prefab 的真实节点数据，1:1 渲染「我的俱乐部」列表页（验证用）。
位置/尺寸/字号/贴图/显隐全部取自 prefab，改完 prefab 直接看效果。"""
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/Volumes/SSD/qing"
PREFAB = os.path.join(ROOT, "assets/resources/UI/panelMain.prefab")
W, H = 750, 1334
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
OUT = "/tmp/club_verify.png"

_fc, _ic = {}, {}
def font(size):
    if size not in _fc:
        _fc[size] = ImageFont.truetype(FONT, size, index=0)
    return _fc[size]

def load(p):
    if p not in _ic:
        _ic[p] = Image.open(p).convert("RGBA")
    return _ic[p]


def build_uuid_map():
    m = {}
    for dirpath, _, files in os.walk(os.path.join(ROOT, "assets")):
        for f in files:
            if not f.endswith(".meta"):
                continue
            p = os.path.join(dirpath, f)
            try:
                meta = json.load(open(p, encoding="utf-8"))
            except Exception:
                continue
            if meta.get("uuid") and meta.get("importer") == "texture":
                m[meta["uuid"]] = p[:-5]
            for v in (meta.get("subMetas") or {}).values():
                if v.get("uuid"):
                    m[v["uuid"]] = p[:-5]
    return m


U2P = build_uuid_map()


def sprite_path(node, d):
    for c in node.get("_components", []):
        comp = d[c["__id__"]]
        if comp.get("__type__") == "cc.Sprite" and comp.get("_enabled", True):
            u = (comp.get("_spriteFrame") or {}).get("__uuid__")
            p = U2P.get(u)
            if p and os.path.exists(p):
                return p
    return None


def label_of(node, d):
    for c in node.get("_components", []):
        if d[c["__id__"]].get("__type__") == "cc.Label":
            return d[c["__id__"]]
    return None


def blit(cv, path, node, anchor_screen):
    cs = node["_contentSize"]
    ap = node.get("_anchorPoint", {})
    w, h = cs["width"], cs["height"]
    arr = node["_trs"]["array"]
    left = anchor_screen[0] + arr[0] - ap.get("x", 0.5) * w
    top = anchor_screen[1] - arr[1] - (1 - ap.get("y", 0.5)) * h
    cv.alpha_composite(load(path).resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS),
                       (int(round(left)), int(round(top))))


def draw_card(cv, d, tpl, top, data):
    h = tpl["_contentSize"]["height"]
    anchor = (375, top)
    p = sprite_path(tpl, d)
    if p:
        cv.alpha_composite(load(p).resize((700, int(h)), Image.LANCZOS), (25, int(top)))
    for c in tpl["_children"]:
        n = d[c["__id__"]]
        nm = n.get("_name")
        if nm == "角色条目底图" and not data.get("role"):
            continue
        if not n.get("_active", True):
            continue
        cs = n["_contentSize"]
        ap = n.get("_anchorPoint", {})
        w, hh = cs["width"], cs["height"]
        arr = n["_trs"]["array"]
        left = anchor[0] + arr[0] - ap.get("x", 0.5) * w
        topn = anchor[1] - arr[1] - (1 - ap.get("y", 0.5)) * hh

        sp = sprite_path(n, d)
        if nm == "头像":
            sp = os.path.join(ROOT, "assets/resources/avatars/%s.png" % data["avatar"])
        if sp:
            cv.alpha_composite(load(sp).resize((max(1, int(w)), max(1, int(hh))), Image.LANCZOS),
                               (int(round(left)), int(round(topn))))
        lab = label_of(n, d)
        if lab:
            s = {"俱乐部名称": data["name"], "邀请码": ("邀请码 " + data["invite"]) if data["invite"] else "",
                 "金币": "128,500", "身份": data.get("role", "")}.get(nm, lab.get("_string", ""))
            if not s:
                continue
            f = font(lab.get("_fontSize", 24))
            dd = ImageDraw.Draw(cv)
            tw = dd.textlength(s, font=f)
            ha = lab.get("_N$horizontalAlign", 0)
            tx = left if ha == 0 else (left + (w - tw) / 2 if ha == 1 else left + w - tw)
            asc, desc = f.getmetrics()
            ty = topn + (hh - (asc + desc)) / 2
            dd.text((tx, ty), s, font=f, fill=(255, 255, 255, 255),
                    stroke_width=2, stroke_fill=(2, 22, 37, 210))


def main():
    d = json.load(open(PREFAB, encoding="utf-8"))

    def find(name):
        for i, o in enumerate(d):
            if o.get("__type__") == "cc.Node" and o.get("_name") == name:
                return i
        return None

    cv = Image.new("RGBA", (W, H), (6, 14, 26, 255))
    for nm in ("V8大厅完整背景", "俱乐部效果图标题", "俱乐部效果图主体"):
        i = find(nm)
        if i is None:
            continue
        n = d[i]
        p = sprite_path(n, d)
        if not p:
            continue
        cs, ap, arr = n["_contentSize"], n.get("_anchorPoint", {}), n["_trs"]["array"]
        w, h = cs["width"], cs["height"]
        left = 375 + arr[0] - ap.get("x", 0.5) * w
        top = 667 - arr[1] - (1 - ap.get("y", 0.5)) * h
        cv.alpha_composite(load(p).resize((int(w), int(h)), Image.LANCZOS),
                           (int(round(left)), int(round(top))))

    tpl = d[find("俱乐部条目模板")]
    rows = [
        {"role": "老板", "name": "天府壹号会所", "invite": "882613", "avatar": "头像05"},
        {"role": "代理", "name": "锦官城牌友会", "invite": "503928", "avatar": "头像12"},
        {"role": "", "name": "春熙龙门阵", "invite": "119477", "avatar": "头像21"},
    ]
    top = 667 + 368 - 377 / 2 + 27.7
    for r in rows:
        draw_card(cv, d, tpl, top, r)
        top += tpl["_contentSize"]["height"] + 24

    cv.convert("RGB").save(OUT)
    print("saved", OUT)


if __name__ == "__main__":
    main()
