#!/usr/bin/env python3
"""把「大牌没点」牌面导入 assets/resources/pk2np，供搓牌揭开前使用。

源目录默认 ~/Desktop/扑克牌3_大牌没点，按 pk2 的 <类型>_<点数>d 命名输出，
尺寸逐张对齐 assets/resources/pk2 里同名有点牌面，避免切换牌面时缩放跳动。
已在 pk2np 中存在且 meta 完整的文件不覆盖；新增文件自动生成 Cocos 2.4 的
texture + sprite-frame meta（uuid 随机生成）。
"""

import argparse
import json
import os
import re
import unicodedata
import uuid
import numpy as np
from PIL import Image, ImageFilter

RANK_VALUE = {"A": 1, "J": 11, "Q": 12, "K": 13}
SUIT_TYPE = {"方块": 0, "梅花": 1, "红桃": 2, "黑桃": 3}

DEFAULT_SRC = os.path.expanduser("~/Desktop/扑克牌3_大牌没点")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PK2_DIR = os.path.join(ROOT, "assets", "resources", "pk2")
NP_DIR = os.path.join(ROOT, "assets", "resources", "pk2np")


def parse_name(name):
    m = re.match(r"(\d+)_(方块|梅花|红桃|黑桃)(A|[2-9]|10|J|Q|K)\.png$", name)
    if m:
        suit, rank = m.group(2), m.group(3)
        num = RANK_VALUE.get(rank)
        if num is None:
            num = int(rank)
        return SUIT_TYPE[suit], num
    if "JOKER_彩色" in name:
        return 4, 1
    if "JOKER_黑白" in name:
        return 4, 2
    return None


def resize_premultiplied(im, size):
    """先乘 alpha 再缩放，避免透明边缘发黑/白边；输出仍是直通 alpha。"""
    im = im.convert("RGBA")
    arr = np.asarray(im, dtype=np.float32) / 255.0
    rgb = arr[:, :, :3] * arr[:, :, 3:4]
    rgb_img = Image.fromarray((rgb * 255.0).clip(0, 255).astype(np.uint8), "RGB")
    alpha_img = im.split()[3]
    rgb_img = rgb_img.resize(size, Image.LANCZOS)
    alpha_img = alpha_img.resize(size, Image.LANCZOS)
    out_rgb = np.asarray(rgb_img, dtype=np.float32) / 255.0
    out_a = np.asarray(alpha_img, dtype=np.float32) / 255.0
    out = np.zeros((size[1], size[0], 4), dtype=np.float32)
    out[:, :, :3] = out_rgb / np.maximum(out_a[:, :, None], 1e-4)
    out[:, :, 3] = out_a
    return Image.fromarray((out * 255.0).clip(0, 255).astype(np.uint8), "RGBA")


def make_meta(path, width, height):
    texture_uuid = str(uuid.uuid4())
    stem = os.path.splitext(os.path.basename(path))[0]
    return {
        "ver": "2.3.7",
        "uuid": texture_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": True,
        "width": width,
        "height": height,
        "platformSettings": {},
        "subMetas": {
            stem: {
                "ver": "1.0.6",
                "uuid": str(uuid.uuid4()),
                "importer": "sprite-frame",
                "rawTextureUuid": texture_uuid,
                "trimType": "auto",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": width,
                "height": height,
                "rawWidth": width,
                "rawHeight": height,
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {},
            }
        },
    }


def make_folder_meta(path):
    return {
        "ver": "1.1.3",
        "uuid": str(uuid.uuid4()),
        "importer": "folder",
        "isBundle": False,
        "bundleName": "",
        "priority": 1,
        "compressionType": {},
        "optimizeHotUpdate": {},
        "inlineSpriteFrames": {},
        "isRemoteBundle": {},
        "subMetas": {},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--force", action="store_true", help="覆盖已存在的 pk2np 图片")
    args = ap.parse_args()

    os.makedirs(NP_DIR, exist_ok=True)
    folder_meta = NP_DIR + ".meta"
    if not os.path.exists(folder_meta):
        with open(folder_meta, "w", encoding="utf-8") as f:
            json.dump(make_folder_meta(NP_DIR), f, ensure_ascii=False, indent=2)

    done, skipped, missing = [], [], []
    for name in sorted(os.listdir(args.src)):
        if not name.endswith(".png"):
            continue
        key = parse_name(unicodedata.normalize("NFC", name))
        if key is None:
            continue
        suit, num = key
        stem = "%d_%dd" % (suit, num)
        ref_path = os.path.join(PK2_DIR, stem + ".png")
        if not os.path.exists(ref_path):
            missing.append((name, stem))
            continue
        out_path = os.path.join(NP_DIR, stem + ".png")
        if os.path.exists(out_path) and not args.force:
            skipped.append(stem)
            continue
        with Image.open(os.path.join(args.src, name)) as src:
            size = Image.open(ref_path).size
            out = resize_premultiplied(src, size)
        out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
        out.save(out_path, optimize=True)
        if not os.path.exists(out_path + ".meta"):
            with open(out_path + ".meta", "w", encoding="utf-8") as f:
                json.dump(make_meta(out_path, out.width, out.height), f, ensure_ascii=False, indent=2)
        done.append(stem)

    print("导入 %d 张，跳过 %d 张，缺少对照 %d 张" % (len(done), len(skipped), len(missing)))
    if missing:
        for name, stem in missing:
            print("  缺少 pk2/%s.png（源 %s）" % (stem, name))
    if done:
        print("新导入:", ", ".join(done))


if __name__ == "__main__":
    main()
