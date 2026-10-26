#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""俱乐部列表「去掉俱乐部金币」落地脚本。

做三件事：
1. 两张俱乐部条目底图（普通 / 老板代理版）擦掉下半行左侧的金币堆、上半行右侧的
   「票券 + 邀请码」字样 —— 擦除用左右像素水平线性插值，其余像素原样保留。
2. 把票券图标从底图抠成独立透明 PNG（club_ticket_v8.png），供下半行复用。
3. 不碰 .meta：尺寸不变，UUID 保持。

输入固定取 HEAD 版本，避免二次处理。"""
import os, subprocess
import numpy as np
from PIL import Image, ImageFilter

ROOT = "/Volumes/SSD/qing"
TMP = os.path.join(ROOT, ".workbuddy/tmp/clubcoins")

# 底图像素坐标擦除区（x0, x1, y0, y1，闭区间）
ERASES = [
    (145, 285, 252, 368),   # 下半行左侧金币堆
    (775, 885, 78, 178),    # 上半行右侧票券图标
    (910, 1020, 70, 125),   # 上半行右侧「邀请码」三字
    (704, 726, 34, 214),    # 上半行那条分隔竖线（原来分隔名称与邀请码）
]

SRC = {
    "plain": ("assets/V7/club_row_v8_exact.png", "club_row_v8_exact.png"),
    "role": ("assets/V7/club_row_role_v8_exact.png", "club_row_role_v8_exact.png"),
}


def erase_h(im, x0, x1, y0, y1):
    a = np.array(im).astype(np.float32)
    L = a[y0:y1 + 1, x0 - 1].copy()
    R = a[y0:y1 + 1, x1 + 1].copy()
    n = x1 - x0 + 1
    for i in range(n):
        t = (i + 1) / (n + 1)
        a[y0:y1 + 1, x0 + i] = L * (1 - t) + R * t
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    band = out.crop((x0 - 8, y0 - 3, x1 + 9, y1 + 4)).filter(ImageFilter.GaussianBlur(2.5))
    out.paste(band, (x0 - 8, y0 - 3))
    return out


def grab_ticket(src):
    """以票券中心为基准裁 100×100 正方形，按亮度/暖色分离出 alpha（票券居中占满）。"""
    box = (779, 77, 879, 177)
    t = src.crop(box).copy()
    a = np.array(t).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    lum = (r + g + b) / 3
    mask = ((lum > 105) | ((r - b) > 18)).astype(np.uint8) * 255
    m = Image.fromarray(mask).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    t.putalpha(m)
    return t


def main():
    os.makedirs(TMP, exist_ok=True)
    ticket_saved = False
    for kind, (rel, fname) in SRC.items():
        # 从 HEAD 取原图，防二次处理
        blob = subprocess.run(["git", "show", "HEAD:" + rel], cwd=ROOT,
                              capture_output=True, check=True).stdout
        src_path = os.path.join(TMP, kind + "_src.png")
        with open(src_path, "wb") as f:
            f.write(blob)
        im = Image.open(src_path).convert("RGBA")
        if not ticket_saved:
            grab_ticket(im).save(os.path.join(ROOT, "assets/V7/club_ticket_v8.png"))
            ticket_saved = True
        out = im
        for e in ERASES:
            out = erase_h(out, *e)
        dst = os.path.join(ROOT, rel)
        out.save(dst, optimize=True)
        print("wrote", rel, out.size, os.path.getsize(dst))


if __name__ == "__main__":
    main()
