#!/usr/bin/env python3
"""按大厅房间列表的实际行尺寸重建房间底框 room_card_exact.png。

背景：列表模板「房间对象」高 130、卡片「房间底框」宽 712.77（约 5.483:1），
旧底框是 886×136（6.51:1）的定稿切图，被非等比压扁。本脚本用 Seedream 候选
（以旧底框为风格基准重绘）按 712.77×130 的比例输出，并把烤在图里的静态元素
搬到与「底皮 1/3 / 45分钟 / 0/8 / 剩余时间 12:12」新排布对应的位置。

已核对的实测位置（分数，相对卡面宽/高，见 gen/cand1.png）：
  底皮文字 0.2399~0.3093、时钟 0.4559~0.4952、双人 0.7980~0.8412，行中心约 0.610
本脚本把它们统一下移到行中心 0.754（与现有 Prefab 里 y=-33 的下排版心一致），
并把时钟、双人左移，右侧留出「剩余时间 12:12」的位置。
"""

import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "art_sources/v8-repairs/lobby-room-card-2/gen/cand1.png"
DST = ROOT / "assets/V7/room_card_exact.png"
BOX = (6, 7, 4917, 862)          # 候选图里的卡片外框（含 1px 描边内缩）
SIZE = (1426, 260)               # 712.77×130 的 2 倍
S = 2                            # 遮罩超采样倍率
ROW_CENTER = 0.754               # 下排信息行的纵向中心（分数）
PAD = 48                         # 搬运元素时的外扩像素（原生尺度，须远大于羽化）
FEATHER = 36                     # 贴回时的羽化像素
BG_COLOR = np.array([252.0, 252.0, 252.0])   # 候选图卡片之外的颜色

# name: (bbox 原生像素, 新左边界分数, 补背景的取样 x 起点)
MOVES = {
    "底皮": ((1178, 434, 1519, 610), 0.2399, 1560),
    "时钟": ((2239, 426, 2432, 625), 0.4000, 2500),
    "双人": ((3919, 413, 4131, 610), 0.5900, 3400),
}


def ring_mean(a, box, pad=6):
    """取 box 外围 pad 像素的背景均值（必须排除 box 内部的元素本体）。"""
    x0, y0, x1, y1 = box
    px0, py0 = max(0, x0 - pad), max(0, y0 - pad)
    px1, py1 = min(a.shape[1], x1 + pad), min(a.shape[0], y1 + pad)
    reg = a[py0:py1, px0:px1].copy()
    reg[y0 - py0:y1 - py0, x0 - px0:x1 - px0] = np.nan
    return float(np.nanmean(reg))


def feather_mask(w, h, radius=FEATHER):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rectangle((radius, radius, w - radius - 1, h - radius - 1), fill=255)
    return m.filter(ImageFilter.GaussianBlur(radius * 0.6))


def clean_interior(rgb):
    """压平 AI 生成图内部的斜向噪纹，保留徽章/文字/图标细节。"""
    soft = np.asarray(Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(1.5))).astype(float)
    detail = np.abs(rgb.astype(float) - soft).sum(axis=2) > 26
    keep = np.asarray(Image.fromarray((detail * 255).astype(np.uint8), "L")
                      .filter(ImageFilter.MaxFilter(11))).astype(float) / 255.0
    base = np.asarray(Image.fromarray(rgb).filter(ImageFilter.MedianFilter(9))
                      .filter(ImageFilter.GaussianBlur(4.0))).astype(float)
    return np.where(keep[..., None] > 0.5, rgb, base)


def update_meta(path: Path):
    width, height = struct.unpack(">II", path.read_bytes()[16:24])
    meta_path = path.with_suffix(path.suffix + ".meta")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    frame = next(iter(meta["subMetas"].values()))
    meta.update(width=width, height=height, packable=False, premultiplyAlpha=False)
    frame.update(width=width, height=height, rawWidth=width, rawHeight=height,
                 trimType="none", trimX=0, trimY=0, offsetX=0, offsetY=0,
                 borderTop=0, borderBottom=0, borderLeft=0, borderRight=0)
    meta["subMetas"] = {path.stem: frame}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def move_static_layer(card: Image.Image) -> Image.Image:
    img = card.copy()
    W, H = img.size
    arr = np.asarray(img).astype(float)
    lum = arr.mean(axis=2)

    patches = {}
    for name, (bbox, new_left, fill_x) in MOVES.items():
        x0, y0, x1, y1 = bbox
        src_box = (max(0, x0 - PAD), max(0, y0 - PAD), min(W, x1 + PAD + 1), min(H, y1 + PAD + 1))
        w, h = src_box[2] - src_box[0], src_box[3] - src_box[1]
        dy = int(round(ROW_CENTER * H)) - int(round(0.5 * (y0 + y1)))
        # 目标左边界按元素本体（不含外扩）对齐，保证元素落在 new_left 处
        dst_x = src_box[0] + int(round(new_left * W)) - x0
        dst_box = (dst_x, src_box[1] + dy, dst_x + w, src_box[3] + dy)
        fill_box = (int(fill_x), src_box[1], int(fill_x) + w, src_box[3])
        assert fill_box[2] <= W and dst_box[2] <= W and dst_box[3] <= H, (name, src_box, dst_box)
        patches[name] = (img.crop(src_box), src_box, dst_box, fill_box, ring_mean(lum, src_box))

    # 先补掉原位，再用羽化遮罩把元素贴到新位置
    for name, (patch, src_box, dst_box, fill_box, src_ring) in patches.items():
        w, h = src_box[2] - src_box[0], src_box[3] - src_box[1]
        fill = np.asarray(img.crop(fill_box)).astype(float)
        fill += ring_mean(np.asarray(img).astype(float).mean(axis=2), src_box) - ring_mean(
            np.asarray(img).astype(float).mean(axis=2), fill_box)
        img.paste(Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8)), (src_box[0], src_box[1]),
                  feather_mask(w, h))

    arr = np.asarray(img).astype(float).mean(axis=2)
    for name, (patch, src_box, dst_box, fill_box, src_ring) in patches.items():
        w, h = dst_box[2] - dst_box[0], dst_box[3] - dst_box[1]
        data = np.asarray(patch).astype(float)
        data += ring_mean(arr, dst_box) - src_ring
        img.paste(Image.fromarray(np.clip(data, 0, 255).astype(np.uint8)), (dst_box[0], dst_box[1]),
                  feather_mask(w, h))
    return img


def main():
    raw = Image.open(SRC).convert("RGB").crop(BOX)
    moved = move_static_layer(raw)
    moved.save(ROOT / "art_sources/v8-repairs/lobby-room-card-2/gen/stage_moved.png")
    card = moved.resize(SIZE, Image.LANCZOS)

    a = np.asarray(card).astype(float)
    d = np.abs(a - BG_COLOR).sum(axis=2)
    w, h = SIZE
    up = card.resize((w * S, h * S), Image.BICUBIC)
    ink = np.abs(np.asarray(up).astype(float) - BG_COLOR).sum(axis=2) > 30
    solid = np.zeros_like(ink)
    for r in range(ink.shape[0]):
        c = np.flatnonzero(ink[r])
        if c.size:
            solid[r, c[0]:c[-1] + 1] = True
    cov = Image.fromarray((solid * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(S * 0.55))
    body = np.asarray(cov.resize(SIZE, Image.BOX)).astype(float) / 255.0
    alpha = np.clip((body - 0.10) / 0.80, 0, 1)
    out = np.dstack([clean_interior(np.asarray(card)).astype(np.uint8),
                     np.rint(alpha * 255).astype(np.uint8)])
    Image.fromarray(out, "RGBA").save(DST, optimize=True)
    update_meta(DST)
    print(DST, DST.stat().st_size, "size", SIZE, "opaque%%", round(float((alpha > 0.98).mean()) * 100, 1))


if __name__ == "__main__":
    main()
