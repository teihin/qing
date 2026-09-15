#!/usr/bin/env python3
"""检查 Creator 导入后的三个图标贴图是否真的有内容。"""
import numpy as np
from PIL import Image

UUIDS = {
    "chip": "2f0f7acf-f3fc-5c45-8a6f-31d08ff1d02f",
    "clock": "9633fd53-4c57-528f-8e29-fec7ec37c563",
    "player": "7d31eafc-0a8b-5b1b-88e0-14ab6399cba4",
}
for name, u in UUIDS.items():
    p = f"library/imports/{u[:2]}/{u}.png"
    im = Image.open(p)
    a = np.asarray(im.convert("RGBA"))
    print(name, im.mode, im.size, "alpha mean", round(float(a[..., 3].mean()), 1), "max", int(a[..., 3].max()))
