#!/usr/bin/env python3
"""把排行榜数字位图字体重排成「等宽 + 等基线 + 等字高」的表格数字。

原 leaderboard_v8_digits.fnt 里 0-9 的 xadvance 是 33~40 的连字宽度，字高 54~56、
基线相差 3px，所以列表里的数字左右不齐、上下也抖。这里只重排度量与字形位置，
不改画风：把每个数字按各自墨迹裁切后统一缩放到 56px 高、底部对齐到同一基线，
水平居中放进固定 43px advance 的格子。贴图尺寸、UUID、.meta 全部不变。

用法：python3 tools/apply_leaderboard_tabular_digits.py [--check]
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "assets/V7"
PNG = ASSET / "leaderboard_v8_digits.png"
FNT = ASSET / "leaderboard_v8_digits.fnt"
BACKUP = ROOT / "art_sources/v8-repairs/leaderboard/digits-tabular-before"

ATLAS_SIZE = (1024, 128)
DIGIT_ADV = 43
DIGIT_HEIGHT = 56
BASELINE_BOTTOM = 3 + DIGIT_HEIGHT          # 字格顶 3、底 59
INK_THRESHOLD = 6

# id -> (目标墨迹高度, 墨迹底部 y, advance)
METRICS = {
    44: (26, BASELINE_BOTTOM, 24),          # ,
    46: (17, BASELINE_BOTTOM, 24),          # .
    43: (28, 31 + 14, 27),                  # + 竖中线与数字同高
    45: (8, 31 + 4, DIGIT_ADV),             # -
    8212: (8, 31 + 4, DIGIT_ADV),           # —
    8722: (8, 31 + 4, DIGIT_ADV),           # −
    47: (56, BASELINE_BOTTOM, 26),          # /
}.copy()
for _d in range(10):
    METRICS[48 + _d] = (DIGIT_HEIGHT, BASELINE_BOTTOM, DIGIT_ADV)


def parse_fnt(text: str):
    header = []
    chars = {}
    for line in text.splitlines():
        if line.startswith("char id="):
            kv = dict(p.split("=", 1) for p in line.split() if "=" in p)
            cid = int(kv["id"])
            chars[cid] = {k: int(kv[k]) for k in
                          ("x", "y", "width", "height", "xoffset", "yoffset", "xadvance")}
        elif line.startswith(("info ", "common ", "page ", "chars ")):
            header.append(line)
    return header, chars


def ink_bbox(tile: Image.Image):
    alpha = tile.getchannel("A").point(lambda v: 255 if v > INK_THRESHOLD else 0)
    return alpha.getbbox()


def build():
    _, chars = parse_fnt(FNT.read_text())
    src = Image.open(PNG).convert("RGBA")
    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    out_chars = {}
    order = sorted(chars)
    for i, cid in enumerate(order):
        if cid not in METRICS:
            raise SystemExit(f"未定义度量的字形 id={cid}")
        g = chars[cid]
        tile = src.crop((g["x"], g["y"], g["x"] + g["width"], g["y"] + g["height"]))
        bb = ink_bbox(tile)
        if not bb:
            raise SystemExit(f"字形 id={cid} 是空图")
        ink = tile.crop(bb)

        target_h, bottom, adv = METRICS[cid]
        scale = target_h / ink.height
        w = max(1, round(ink.width * scale))
        h = target_h
        glyph = ink.resize((w, h), Image.LANCZOS)
        if w > adv:
            raise SystemExit(f"字形 {chr(cid)!r} 宽 {w} 超过 advance {adv}")

        xoff = (adv - w) // 2
        ytop = bottom - h
        cell_x = 4 + i * 46
        cell_y = 3
        atlas.alpha_composite(glyph, (cell_x + 2, cell_y + (ytop - 3)))
        out_chars[cid] = {
            "x": cell_x + 2, "y": cell_y + (ytop - 3), "width": w, "height": h,
            "xoffset": xoff, "yoffset": ytop, "xadvance": adv,
        }
    return chars, atlas, out_chars, order


def write_fnt(orig_chars, out_chars, order):
    header, _ = parse_fnt(FNT.read_text())
    lines = []
    for line in FNT.read_text().splitlines():
        if line.startswith("char id="):
            continue
        if line.startswith("chars count="):
            lines.append(f"chars count={len(order)}")
            continue
        lines.append(line)
    for cid in order:
        c = out_chars[cid]
        lines.append(
            f"char id={cid} x={c['x']} y={c['y']} width={c['width']} height={c['height']} "
            f"xoffset={c['xoffset']} yoffset={c['yoffset']} xadvance={c['xadvance']} "
            f"page=0 chnl=15"
        )
    text = "\n".join(lines) + "\n"
    FNT.write_text(text)


def verify():
    _, chars = parse_fnt(FNT.read_text())
    digits = [chars[48 + d] for d in range(10)]
    advances = {c["xadvance"] for c in digits}
    bottoms = {c["yoffset"] + c["height"] for c in digits}
    tops = {c["yoffset"] for c in digits}
    heights = {c["height"] for c in digits}
    ok = True
    for label, s in (("advance", advances), ("基线", bottoms), ("顶线", tops), ("字高", heights)):
        status = "OK" if len(s) == 1 else "FAIL"
        print(f"数字{label}={sorted(s)} {status}")
        ok &= len(s) == 1
    for d in range(10):
        c = chars[48 + d]
        print(f"  {d}: w={c['width']} h={c['height']} adv={c['xadvance']} "
              f"ox={c['xoffset']} oy={c['yoffset']} 基线={c['yoffset']+c['height']}")
    return ok


def main():
    if "--check" in sys.argv:
        raise SystemExit(0 if verify() else 1)
    BACKUP.mkdir(parents=True, exist_ok=True)
    for p in (PNG, FNT):
        dst = BACKUP / p.name
        if not dst.exists():
            shutil.copy2(p, dst)
    orig_chars, atlas, out_chars, order = build()
    atlas.save(PNG)
    write_fnt(orig_chars, out_chars, order)
    print(f"重排 {len(order)} 个字形 -> {PNG.relative_to(ROOT)}, 备份 {BACKUP.relative_to(ROOT)}")
    raise SystemExit(0 if verify() else 1)


if __name__ == "__main__":
    main()
