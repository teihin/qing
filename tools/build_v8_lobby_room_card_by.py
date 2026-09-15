#!/usr/bin/env python3
"""Seedream 版大厅房间卡：卡面直接缩放（不抠图），图标去白底写回 assets/V7。"""
import json
import struct
import uuid
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "art_sources/v8-repairs/lobby-room-card-2/gen"
DST = ROOT / "assets/V7/room_card_exact.png"
SIZE = (1426, 260)
RADIUS = 18
ICONS = [("ic2_chip", "room_icon_chip.png", 128), ("ic2_clock", "room_icon_clock.png", 128), ("ic2_player", "room_icon_player.png", 128)]


def update_meta(path: Path):
    w, h = struct.unpack(">II", path.read_bytes()[16:24])
    mp = path.with_suffix(path.suffix + ".meta")
    if mp.exists():
        meta = json.loads(mp.read_text(encoding="utf-8"))
        frame = next(iter(meta["subMetas"].values()))
    else:
        meta = {"ver": "2.3.7", "uuid": str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/by/" + path.name)),
                "importer": "texture", "type": "sprite", "wrapMode": "clamp",
                "filterMode": "bilinear", "premultiplyAlpha": False, "genMipmaps": False,
                "platformSettings": {}}
        frame = {"ver": "1.0.6", "uuid": str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/by/frame/" + path.name)),
                 "importer": "sprite-frame", "rawTextureUuid": meta["uuid"]}
        meta["subMetas"] = {path.stem: frame}
    frame["rawTextureUuid"] = meta["uuid"]
    meta.update(width=w, height=h, packable=False, premultiplyAlpha=False)
    frame.update(width=w, height=h, rawWidth=w, rawHeight=h, trimType="none", trimX=0, trimY=0,
                 offsetX=0, offsetY=0, borderTop=0, borderBottom=0, borderLeft=0, borderRight=0)
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_card():
    card = Image.open(GEN / "card_by.png").convert("RGB").resize(SIZE, Image.LANCZOS)
    mask = Image.new("L", SIZE, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE[0] - 1, SIZE[1] - 1), radius=RADIUS, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    out = card.convert("RGBA")
    out.putalpha(mask)
    out.save(DST, optimize=True)
    update_meta(DST)
    print(DST, out.size, DST.stat().st_size)


def build_icon(src, name, box):
    im = Image.open(GEN / src).convert("RGB")
    a = np.asarray(im).astype(float)
    alpha = np.clip((250.0 - a.max(axis=2)) / 26.0, 0, 1)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6)))
    ys, xs = np.nonzero(alpha > 90)
    pad = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.02) + 1
    x0, x1 = max(0, xs.min() - pad), min(alpha.shape[1], xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(alpha.shape[0], ys.max() + pad)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    x0, y0 = cx - side // 2, cy - side // 2
    rgb = np.clip(a * 1.22 + 26, 0, 255)
    rgba = Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA").crop((x0, y0, x0 + side, y0 + side))
    out = rgba.resize((box, box), Image.LANCZOS)
    dst = ROOT / "assets/V7" / name
    out.save(dst, optimize=True)
    update_meta(dst)
    print(dst, out.size, dst.stat().st_size)


if __name__ == "__main__":
    build_card()
    for s, n, b in ICONS:
        build_icon(s + ".png", n, b)
