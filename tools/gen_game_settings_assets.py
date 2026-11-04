#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「游戏设置 · 奖池设置」所需切图与 .meta（九宫格参数）。

用法：python3 tools/gen_game_settings_assets.py
输出：assets/V8/game_settings/*.png + .meta
只写本目录；不改动既有资源与 Prefab。
"""
import json, os, random, uuid

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "V8", "game_settings")
SS = 4  # 超采样倍数

GOLD_HI = (255, 247, 226)
GOLD_1 = (246, 220, 164)
GOLD_2 = (232, 191, 114)
GOLD_3 = (207, 157, 69)
GOLD_4 = (140, 94, 28)
NAVY_1 = (14, 54, 90)
NAVY_2 = (6, 26, 46)
NAVY_3 = (4, 16, 30)
CYAN = (95, 227, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def vgrad(w, h, stops):
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        seg = min(len(stops) - 2, int(t * (len(stops) - 1)))
        local = t * (len(stops) - 1) - seg
        d.line([(0, y), (w, y)], fill=lerp(stops[seg], stops[seg + 1], local) + (255,))
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size[0] * SS, size[1] * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size[0] * SS - 1, size[1] * SS - 1], radius=int(radius * SS), fill=255
    )
    return m.resize(size, Image.LANCZOS)


def panel(w, h, radius, top, bottom, border, border_w=1.5, inner_glow=None):
    img = vgrad(w, h, [top, bottom])
    mask = rounded_mask((w, h), radius)
    img.putalpha(mask)
    if inner_glow:
        glow = Image.new("RGBA", (w, h), inner_glow)
        glow.putalpha(Image.composite(glow.split()[3], Image.new("L", (w, h), 0), mask))
        img = Image.alpha_composite(img, glow)
    if border:
        b = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(b).rounded_rectangle(
            [0, 0, w - 1, h - 1], radius=radius, outline=border + (255,), width=max(1, int(border_w))
        )
        b.putalpha(Image.composite(b.split()[3], Image.new("L", (w, h), 0), mask))
        img = Image.alpha_composite(img, b)
    return img


def save(img, name, border=(0, 0, 0, 0), width=None, height=None):
    path = os.path.join(OUT, name + ".png")
    img.save(path)
    w, h = img.size
    # 已存在就沿用 UUID，避免重跑生成器把 Prefab 引用打断。
    uid, sf_uid = str(uuid.uuid4()), str(uuid.uuid4())
    old = path + ".meta"
    if os.path.exists(old):
        try:
            oj = json.load(open(old, encoding="utf-8"))
            uid = oj.get("uuid") or uid
            subs = oj.get("subMetas") or {}
            if subs:
                sf_uid = list(subs.values())[0].get("uuid") or sf_uid
        except Exception:
            pass
    meta = {
        "ver": "2.3.7",
        "uuid": uid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": w,
        "height": h,
        "platformSettings": {},
        "subMetas": {
            name: {
                "ver": "1.0.6",
                "uuid": sf_uid,
                "importer": "sprite-frame",
                "rawTextureUuid": uid,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": w,
                "height": h,
                "rawWidth": w,
                "rawHeight": h,
                "borderTop": border[0],
                "borderBottom": border[1],
                "borderLeft": border[2],
                "borderRight": border[3],
                "subMetas": {},
            }
        },
    }
    with open(path + ".meta", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("write", path, img.size)


def star_badge(size=56):
    import math
    img = panel(size, size, size * 0.30, (22, 66, 104), (8, 28, 48), GOLD_2)
    d = ImageDraw.Draw(img)
    c = size / 2
    R, r = size * 0.30, size * 0.126
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rad = R if i % 2 == 0 else r
        pts.append((c + math.cos(a) * rad, c + math.sin(a) * rad))
    d.polygon(pts, fill=GOLD_1 + (255,))
    d.line(pts + [pts[0]], fill=GOLD_4 + (255,), width=1)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    folder_meta = os.path.join(OUT + ".meta")
    if not os.path.exists(folder_meta):
        with open(folder_meta, "w", encoding="utf-8") as f:
            json.dump({
                "ver": "1.1.3", "uuid": str(uuid.uuid4()), "importer": "folder",
                "isBundle": False, "bundleName": "", "priority": 1,
                "compressionType": {}, "optimizeHotUpdate": {}, "inlineSpriteFrames": {},
                "isRemoteBundle": {}, "subMetas": {},
            }, f, ensure_ascii=False, indent=2)

    save(star_badge(56), "gs_badge_star", width=56, height=56)

    save(panel(160, 64, 12, GOLD_HI, GOLD_2, GOLD_1, 1.6), "gs_tab_on", border=(4, 4, 20, 20))
    save(panel(160, 64, 12, (18, 56, 92), (7, 26, 46), (120, 170, 215), 1.0),
         "gs_tab_off", border=(4, 4, 20, 20))
    save(panel(124, 56, 10, (28, 66, 102), (10, 30, 52), GOLD_3, 1.2), "gs_chip", border=(4, 4, 16, 16))
    save(panel(400, 84, 12, (4, 20, 36), (4, 16, 30), (95, 227, 255), 1.2), "gs_input", border=(6, 6, 18, 18))
    save(panel(240, 68, 12, GOLD_HI, GOLD_2, GOLD_1, 1.6), "gs_btn_gold", border=(4, 4, 22, 22))
    save(panel(168, 58, 29, (16, 52, 86), (6, 24, 42), GOLD_1, 1.6), "gs_entry_btn",
         border=(4, 4, 26, 26))

    back = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(back)
    d.line([(26, 9), (14, 20), (26, 31)], fill=GOLD_1 + (255,), width=4, joint="curve")
    save(back, "gs_back", width=40, height=40)


if __name__ == "__main__":
    main()
