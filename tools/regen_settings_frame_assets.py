#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重绘游戏设置页的底板/胶囊切图，去掉低分辨率边缘锯齿。

只覆盖既有 PNG 与 .meta 的像素/尺寸字段，沿用原 UUID、名称和九宫格 border，
因此 Prefab 引用不变。row 底板同时被奖池行、规则行和自动信息栏复用。

用法：python3 tools/regen_settings_frame_assets.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SS = 8


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


def rounded_frame(size, radius, fill_stops, border, border_w=1.4, glow=None,
                  top_highlight=None, bottom_highlight=None):
    w, h = size
    W, H = w * SS, h * SS
    r = radius * SS
    img = vgrad(W, H, fill_stops)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=r, fill=255)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if glow:
        gcolor, galpha, gwidth, gblur = glow
        glow_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow_img).rounded_rectangle(
            [0, 0, W - 1, H - 1], radius=r, outline=gcolor + (galpha,),
            width=max(1, int(round(gwidth * SS))))
        glow_img = glow_img.filter(ImageFilter.GaussianBlur(gblur * SS))
        layer = Image.alpha_composite(layer, glow_img)

    border_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(border_img).rounded_rectangle(
        [0, 0, W - 1, H - 1], radius=r, outline=border + (255,),
        width=max(1, int(round(border_w * SS))))
    layer = Image.alpha_composite(layer, border_img)

    for spec, at_top in ((top_highlight, True), (bottom_highlight, False)):
        if not spec:
            continue
        color, alpha, thickness, blur = spec
        hl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(hl)
        t = max(1, int(round(thickness * SS)))
        if at_top:
            d.rounded_rectangle([r, 0, W - 1 - r, t], radius=t // 2, fill=color + (alpha,))
        else:
            d.rounded_rectangle([r, H - 1 - t, W - 1 - r, H - 1], radius=t // 2, fill=color + (alpha,))
        hl = hl.filter(ImageFilter.GaussianBlur(blur * SS))
        layer = Image.alpha_composite(layer, hl)

    # 把边框/高光裁进圆角内，避免外扩像素在九宫格边缘出现硬边。
    clip = Image.new("L", (W, H), 0)
    ImageDraw.Draw(clip).rounded_rectangle(
        [0, 0, W - 1, H - 1], radius=r, fill=255)
    layer.putalpha(Image.composite(layer.split()[3], Image.new("L", (W, H), 0), clip))
    img = Image.alpha_composite(img, layer)
    img.putalpha(mask)
    return img.resize((w, h), Image.Resampling.BOX)


def write_asset(rel_path, image):
    path = ROOT / rel_path
    meta_path = path.with_suffix(path.suffix + ".meta")
    old = json.loads(meta_path.read_text(encoding="utf-8"))
    image.save(path, optimize=True)

    sub_name, sub = next(iter(old["subMetas"].items()))
    w, h = image.size
    old["width"], old["height"] = w, h
    sub["width"], sub["height"] = w, h
    sub["rawWidth"], sub["rawHeight"] = w, h
    meta_path.write_text(json.dumps(old, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("regen", rel_path, image.size, "border", sub.get("borderTop"), sub.get("borderBottom"),
          sub.get("borderLeft"), sub.get("borderRight"))


def main():
    # 行底板：奖池行 / 规则行 / 自动信息栏共用；九宫格 25，圆角控制在 22。
    row = rounded_frame(
        (256, 320), 22,
        [(11, 58, 96), (6, 42, 72), (5, 34, 60), (4, 29, 50)],
        border=(116, 190, 228), border_w=1.4,
        glow=((92, 174, 222), 30, 3.0, 2.4),
        top_highlight=((150, 225, 255), 80, 1.6, 1.2),
        bottom_highlight=((118, 200, 236), 60, 1.6, 1.2),
    )
    write_asset("assets/V7/settlement_v8_list_panel.png", row)

    # 小胶囊：抽水/暗抽值、快捷项、取消等。
    chip = rounded_frame(
        (124, 56), 10,
        [(24, 64, 100), (13, 42, 70), (8, 29, 50)],
        border=(226, 184, 104), border_w=1.2,
        glow=((226, 184, 104), 22, 2.0, 1.4),
        top_highlight=((170, 220, 250), 40, 1.0, 0.8),
    )
    write_asset("assets/V8/game_settings/gs_chip.png", chip)

    tab_on = rounded_frame(
        (160, 64), 12,
        [(255, 249, 232), (250, 229, 179), (232, 191, 114)],
        border=(255, 240, 196), border_w=1.6,
        glow=((255, 232, 170), 30, 2.4, 1.6),
        top_highlight=((255, 255, 248), 90, 1.4, 0.9),
    )
    write_asset("assets/V8/game_settings/gs_tab_on.png", tab_on)

    tab_off = rounded_frame(
        (160, 64), 12,
        [(20, 60, 98), (10, 34, 56), (7, 26, 46)],
        border=(120, 174, 216), border_w=1.0,
        glow=((90, 160, 210), 18, 2.0, 1.4),
        top_highlight=((150, 210, 244), 40, 1.0, 0.8),
    )
    write_asset("assets/V8/game_settings/gs_tab_off.png", tab_off)

    btn_gold = rounded_frame(
        (240, 68), 12,
        [(255, 249, 232), (250, 229, 179), (232, 191, 114)],
        border=(255, 240, 196), border_w=1.6,
        glow=((255, 232, 170), 30, 2.4, 1.6),
        top_highlight=((255, 255, 248), 90, 1.4, 0.9),
    )
    write_asset("assets/V8/game_settings/gs_btn_gold.png", btn_gold)


if __name__ == "__main__":
    main()
