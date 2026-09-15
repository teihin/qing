#!/usr/bin/env python3
import numpy as np
from PIL import Image, ImageFilter
from apply_v7_prefab_skin import ROOT, ASSET_DIR
from apply_v8_login import update_meta

GEN = ROOT / 'art_sources/v8-repairs/lobby-room-card/gen/cand2.png'
BOX = (496, 325, 3343, 765)
SIZE = (886, 136)
S = 4


def clean_interior(rgb):
    """AI 生成图内部有斜向噪纹；在保留徽章/文字/图标的前提下压平背景。"""
    soft = np.asarray(Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(1.5))).astype(float)
    detail = np.abs(rgb.astype(float) - soft).sum(axis=2) > 26
    keep = np.asarray(Image.fromarray((detail * 255).astype(np.uint8), 'L')
                      .filter(ImageFilter.MaxFilter(11))).astype(float) / 255.0
    base = np.asarray(Image.fromarray(rgb).filter(ImageFilter.MedianFilter(9))
                      .filter(ImageFilter.GaussianBlur(4.0))).astype(float)
    return np.where(keep[..., None] > 0.5, rgb, base)


def main():
    card = Image.open(GEN).convert('RGB').crop(BOX).resize(SIZE, Image.LANCZOS)
    a = np.asarray(card).astype(float)
    ring = [a[:2, :2], a[:2, -2:], a[-2:, :2], a[-2:, -2:]]
    bg = np.median(np.concatenate([r.reshape(-1, 3) for r in ring]), axis=0)
    d = np.abs(a - bg).sum(axis=2)
    w, h = SIZE
    up = card.resize((w * S, h * S), Image.BICUBIC)
    ink = np.abs(np.asarray(up).astype(float) - bg).sum(axis=2) > 30
    solid = np.zeros_like(ink)
    for r in range(ink.shape[0]):
        c = np.flatnonzero(ink[r])
        if c.size:
            solid[r, c[0]:c[-1] + 1] = True
    cov = Image.fromarray((solid * 255).astype(np.uint8), 'L').filter(
        ImageFilter.GaussianBlur(S * 0.55))
    body = np.asarray(cov.resize(SIZE, Image.BOX)).astype(float) / 255.0
    body = np.clip((body - 0.10) / 0.80, 0, 1)
    glow = np.clip((d - 24) / 160.0, 0, 1)
    alpha = np.maximum(body, glow)
    body_rgb = clean_interior(np.asarray(card))
    out = np.dstack([body_rgb.astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)])
    target = ASSET_DIR / 'room_card_exact.png'
    Image.fromarray(out, 'RGBA').save(target, optimize=True)
    update_meta(target.name)
    print(target, target.stat().st_size, 'alpha ramp',
          int(((alpha > 0.02) & (alpha < 0.98)).sum()))


if __name__ == '__main__':
    main()
