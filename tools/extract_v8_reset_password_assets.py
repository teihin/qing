#!/usr/bin/env python3
"""Slice the approved V8 reset-password modal into adjustable components."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from apply_v7_prefab_skin import ASSET_DIR
from apply_v8_login import update_meta

SRC = ROOT / "design-previews/效果图V8-new/04-登录与弹窗/04-重置密码弹窗.png"
PANEL = (101, 303, 843, 1504)
BADGE_POLY = [(440, 180), (468, 189), (492, 199), (512, 211), (530, 226), (546, 243),
              (558, 262), (566, 282), (572, 300), (582, 352), (338, 352), (348, 300),
              (354, 282), (362, 262), (374, 243), (390, 226), (408, 211), (428, 199),
              (452, 189)]
ROW_BANDS = [(583, 687), (716, 818), (842, 945), (966, 1073)]
BADGE_BOX = (334, 168, 606, 358)
SUBMIT = (129, 1140, 807, 1266)
CLEAR_X = (392, 810)
ROWS = ["account", "password", "confirm", "trade"]

ART = [
    ("reset_title_exact.png", (255, 402, 690, 498), "warm"),
    ("reset_subtitle_exact.png", (338, 496, 606, 530), "lum"),
    ("reset_rule_exact.png", (190, 528, 752, 566), "warm"),
    ("reset_close_exact.png", (730, 320, 836, 416), "warm"),
    ("reset_safety_exact.png", (140, 1330, 802, 1430), "warm"),
]


def load():
    img = Image.open(SRC).convert("RGB").resize((941, 1672), Image.LANCZOS)
    return np.array(img).astype(float)

def box(a, rect):
    x0, y0, x1, y1 = rect
    return a[y0:y1, x0:x1]

def save_rgba(name, rgb, alpha):
    path = ASSET_DIR / name
    Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA").save(path)
    update_meta(name)
    print("wrote", name)

def sliced_meta(name, border):
    path = ASSET_DIR / (name + ".meta")
    meta = json.loads(path.read_text())
    frame = next(iter(meta["subMetas"].values()))
    top, bottom, left, right = border
    frame.update(borderTop=top, borderBottom=bottom, borderLeft=left, borderRight=right)
    meta["subMetas"] = {Path(name).stem: frame}
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")


def build_panel(a):
    p = box(a, PANEL)
    h, w, _ = p.shape
    bt, bb, bl, m = 140, 70, 60, 180
    out = np.zeros((bt + m + bb, bl + m + bl, 3))

    def rs(part, size):
        return np.array(Image.fromarray(part.astype(np.uint8)).resize(size))

    tl = p[0:bt, 0:bl]
    bk = p[h - bb:, 0:bl]
    out[0:bt, 0:bl] = tl
    out[0:bt, bl + m:] = np.fliplr(tl)
    out[bt + m:, 0:bl] = bk
    out[bt + m:, bl + m:] = np.fliplr(bk)
    out[0:bt, bl:bl + m] = rs(p[0:bt, 80:110], (m, bt))
    out[bt + m:, bl:bl + m] = rs(p[h - bb:, 80:110], (m, bb))
    strip = rs(p[60:1180, 716:730], (m, m))
    side = np.repeat(strip.mean(axis=1, keepdims=True), bl, axis=1)
    out[bt:bt + m, bl:bl + m] = strip
    out[bt:bt + m, 0:bl] = side
    out[bt:bt + m, bl + m:] = side
    return out


def main():
    a = load()
    panel = box(a, PANEL)
    small = np.array(Image.fromarray(panel.astype(np.uint8)).resize((371, 601), Image.LANCZOS))
    pm = Image.new("L", (371, 601), 0)
    ImageDraw.Draw(pm).rounded_rectangle([1, 1, 370, 600], 22, fill=255)
    save_rgba("reset_panel_bg_exact.png", small, np.array(pm).astype(float))
    badge = box(a, BADGE_BOX)
    mask = Image.new("L", (badge.shape[1], badge.shape[0]), 0)
    ImageDraw.Draw(mask).polygon(
        [(x - BADGE_BOX[0], y - BADGE_BOX[1]) for x, y in BADGE_POLY], fill=255)
    save_rgba("reset_badge_exact.png", badge, np.array(mask).astype(float))
    for name, rect, mode in ART:
        rgb = box(a, rect)
        if mode == "warm":
            # 暖色文字/描边与深蓝底分离，保留笔画外的深色描边。
            alpha = (np.clip((rgb[:, :, 0] - rgb[:, :, 2] - 15) / 50, 0, 1)
                     * np.clip((rgb.max(axis=2) - 120) / 55, 0, 1) * 255)
        else:
            alpha = np.clip((rgb.max(axis=2) - 130) / 65, 0, 1) * 255
        save_rgba(name, rgb, alpha)
    for key, (y0, y1) in zip(ROWS, ROW_BANDS):
        rect = (128, y0 - 2, 812, y1 + 2)
        rgb = box(a, rect).copy()
        c = rgb.shape[0] // 2
        start = 386 if key == "password" else CLEAR_X[0]
        for x in range(start - rect[0], CLEAR_X[1] - rect[0]):
            top = rgb[c - 45:c - 38, x].mean(axis=0)
            bot = rgb[c + 38:c + 45, x].mean(axis=0)
            for i in range(68):
                t = (i + 1) / 69
                rgb[c - 34 + i, x] = top * (1 - t) + bot * t
        save_rgba("reset_row_%s_exact.png" % key, rgb, np.full(rgb.shape[:2], 255.0))

    submit = box(a, SUBMIT)
    save_rgba("reset_submit_exact.png", submit, np.full(submit.shape[:2], 255.0))
    print("reset-password components extracted")


if __name__ == "__main__":
    main()
