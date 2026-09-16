# -*- coding: utf-8 -*-
"""
把 hh-poker-assets 的 EMOJI 表情动画（VP9 webm，黑底无 Alpha）转换为
本项目 Cocos Creator 2.4 的序列帧表情动画资源。

写入副作用（会直接改写工程美术文件，不是只读检查工具）：
  assets/ImagesLuck/表情/<中文名>/<prefix>_0.png        表情面板图标（保留原 uuid）
  assets/ImagesLuck/表情/<中文名>/<prefix>_1..N.png     动画序列帧（trimType=none，固定画布）
  assets/ImagesLuck/表情/<中文名>/<中文名>.anim          动画剪辑（保留原 uuid）

处理要点：
  1. webm 为 yuv420p，背景是纯黑；用「阈值 + 形态学膨胀 + 从边界洪泛」重建剪影，
     保住原画自带的黑色描边（描边与背景同为纯黑，无法按颜色区分，只能按形状还原）。
  2. 所有帧共用同一裁剪框与同一画布，且写 trimType=none，保证逐帧显示尺寸不跳动。
  3. 剪影按「最大连通块」估算表情主体尺寸，统一缩放到 TARGET_BODY 像素，
     保证 10 个表情在牌桌上的视觉大小一致（原表情内容约 99x101）。
  4. 按帧间差异去重，保留原始 30fps 时间轴上的关键帧位置，兼顾清晰度与资源体积。

用法：
    python3 tools/convert_hh_emoji_anim.py            # 执行转换
    python3 tools/convert_hh_emoji_anim.py --check    # 只统计不写文件
"""
import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = '/Users/yy/CodeBuddy/20260915173634/hh-poker-assets'
PROJECT = '/Volumes/SSD/qing'
ASSETS = os.path.join(PROJECT, 'assets')
EMOJI_DIR = os.path.join(ASSETS, 'ImagesLuck', '表情')

# (面板槽位, 现有目录名, 新表情名)
MAPPING = [
    (1, '冰冷', 'cold'),
    (2, '发怒', 'enraged'),
    (3, '囧', 'explode'),
    (4, '困', 'no'),
    (5, '大笑', 'joy'),
    (6, '微笑', 'beaming'),
    (7, '感动', 'cry1'),
    (8, '拇指', 'biceps'),
    (9, '拜拜', 'devil'),
    (10, '色心', 'hot'),
]

FPS = 30                 # 源视频帧率，保留原始时间轴
TARGET_BODY = 100.0      # 表情主体目标像素（原表情内容 99x101）
DILATE = 6               # 描边还原半径（源 240 画布下描边约 6px）
LUM_THRESHOLD = 45       # 前景判定阈值
PAD = 12                 # 处理前留白，避免剪影贴边导致洪泛泄漏
MAX_FRAMES = 45          # 单个表情最多保留帧数
DIFF_CANDIDATES = [6.0, 8.0, 10.0, 13.0, 16.0, 20.0]


def new_uuid():
    return str(uuid.uuid4())


# --------------------------------------------------------------------------- #
# 抠底
# --------------------------------------------------------------------------- #
def silhouette(rgb):
    """返回 0/255 剪影：膨胀前景后，把「与画布边界连通的暗区」判为背景。"""
    h, w, _ = rgb.shape
    lum = rgb.max(axis=2)
    mask = (lum > LUM_THRESHOLD).astype(np.uint8) * 255
    canvas = np.zeros((h + 2 * PAD, w + 2 * PAD), np.uint8)
    canvas[PAD:PAD + h, PAD:PAD + w] = mask
    dilated = np.array(Image.fromarray(canvas, 'L').filter(ImageFilter.MaxFilter(2 * DILATE + 1))) > 0

    H, W = dilated.shape
    reach = np.zeros((H, W), bool)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if not dilated[y, x] and not reach[y, x]:
                reach[y, x] = True
                q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if not dilated[y, x] and not reach[y, x]:
                reach[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and not dilated[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True
                q.append((ny, nx))

    sil = ((~reach) * 255).astype(np.uint8)
    return sil[PAD:PAD + h, PAD:PAD + w]


def bbox(mask):
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def biggest_component_bbox(mask):
    m = mask > 0
    h, w = m.shape
    seen = np.zeros_like(m, bool)
    best, best_area = None, 0
    for y0, x0 in zip(*np.where(m)):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        x1 = x2 = x0
        y1 = y2 = y0
        area = 0
        while q:
            y, x = q.popleft()
            area += 1
            x1, x2 = min(x1, x), max(x2, x)
            y1, y2 = min(y1, y), max(y2, y)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if area > best_area:
            best_area, best = area, (x1, y1, x2 + 1, y2 + 1)
    return best


# --------------------------------------------------------------------------- #
# 抽帧 / 缩放
# --------------------------------------------------------------------------- #
def extract_frames(name, tmpdir):
    out = os.path.join(tmpdir, name)
    os.makedirs(out, exist_ok=True)
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i',
         os.path.join(SRC, 'video-fx', 'emoji', name + '.webm'),
         os.path.join(out, '%04d.png')],
        check=True)
    return sorted(glob.glob(os.path.join(out, '*.png')))


def binarize(mask):
    return (mask > 0).astype(np.uint8) * 255


def build_frames(name, paths):
    """返回 (rgba 帧列表, 画布尺寸, 主体尺寸)"""
    rgbs = [np.array(Image.open(p).convert('RGB')) for p in paths]
    masks = [binarize(silhouette(rgb)) for rgb in rgbs]

    ux0 = min(bbox(m)[0] for m in masks)
    uy0 = min(bbox(m)[1] for m in masks)
    ux1 = max(bbox(m)[2] for m in masks)
    uy1 = max(bbox(m)[3] for m in masks)

    bodies = [b for b in (biggest_component_bbox(m) for m in masks) if b]
    bw = sorted(b[2] - b[0] for b in bodies)[len(bodies) // 2]
    bh = sorted(b[3] - b[1] for b in bodies)[len(bodies) // 2]
    body = int(max(bw, bh))

    # 以「表情主体中心」而不是整段包围盒中心对齐，保证表情始终在头像正中
    fcx = int(round(np.median([(b[0] + b[2]) / 2.0 for b in bodies])))
    fcy = int(round(np.median([(b[1] + b[3]) / 2.0 for b in bodies])))
    hw = max(fcx - ux0, ux1 - fcx)
    hh = max(fcy - uy0, uy1 - fcy)
    ux0, uy0, ux1, uy1 = fcx - hw, fcy - hh, fcx + hw, fcy + hh

    scale = TARGET_BODY / body
    iw = max(2, int(round((ux1 - ux0) * scale)))
    ih = max(2, int(round((uy1 - uy0) * scale)))

    frames = []
    for rgb, m in zip(rgbs, masks):
        alpha = Image.fromarray(m, 'L').filter(ImageFilter.GaussianBlur(0.7))
        a = np.asarray(alpha, dtype=np.float32) / 255.0
        rgb_f = rgb.astype(np.float32) * a[..., None]          # 预乘，避免透明区黑边渗色
        planes = [Image.fromarray(rgb_f[..., c], 'F') for c in range(3)]
        planes = [p.crop((ux0, uy0, ux1, uy1)).resize((iw, ih), Image.LANCZOS) for p in planes]
        alpha_small = alpha.crop((ux0, uy0, ux1, uy1)).resize((iw, ih), Image.LANCZOS)
        a_small = np.asarray(alpha_small, dtype=np.float32) / 255.0
        out = np.zeros((ih, iw, 4), np.uint8)
        solid = a_small > 0.03
        for c in range(3):
            ch = np.asarray(planes[c], dtype=np.float32)
            rgb_c = np.clip(ch / np.maximum(a_small, 1e-3), 0, 255)
            out[..., c] = np.where(solid, rgb_c, 0).astype(np.uint8)
        out[..., 3] = np.asarray(alpha_small, dtype=np.uint8)
        # 去噪 + 轻量量化：原视频有压缩噪点，处理后画面更干净、PNG 体积更小
        arr = np.array(Image.fromarray(out, 'RGBA').filter(ImageFilter.MedianFilter(3)))
        arr[..., 3] = out[..., 3]                     # 保留原 alpha 边缘
        arr[..., :3] = (np.round(arr[..., :3] / 4.0) * 4).clip(0, 255).astype(np.uint8)
        out = arr
        # 外围 1px 极低透明度，保证自动裁剪时裁剪框恒等于整张画布
        out[0, :, 3] = np.maximum(out[0, :, 3], 3)
        out[-1, :, 3] = np.maximum(out[-1, :, 3], 3)
        out[:, 0, 3] = np.maximum(out[:, 0, 3], 3)
        out[:, -1, 3] = np.maximum(out[:, -1, 3], 3)
        frames.append(out)
    return frames, (iw, ih), body


def frame_diff(a, b):
    """只在表情覆盖到的区域内比较，避免大片透明区域稀释差异。"""
    region = (a[..., 3] > 0) | (b[..., 3] > 0)
    n = int(region.sum())
    if n == 0:
        return 0.0
    d = np.abs(a.astype(np.int16) - b.astype(np.int16))
    return float(d[region].mean())


def select_keys(frames):
    """按帧间差异去重，返回保留的下标（含首帧），帧数超过上限时放宽阈值。"""
    for thresh in DIFF_CANDIDATES:
        keep = [0]
        last = frames[0]
        for i in range(1, len(frames)):
            if frame_diff(frames[i], last) >= thresh:
                keep.append(i)
                last = frames[i]
        if len(keep) <= MAX_FRAMES:
            return keep, thresh
    return keep, DIFF_CANDIDATES[-1]


# --------------------------------------------------------------------------- #
# meta 写入
# --------------------------------------------------------------------------- #
def texture_meta(tex_uuid, frame_uuid, fname, w, h, trim=None):
    trim = trim or dict(trimX=0, trimY=0, width=w, height=h, offsetX=0, offsetY=0,
                        trimType='none')
    return {
        "ver": "2.3.7",
        "uuid": tex_uuid,
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
            fname: {
                "ver": "1.0.6",
                "uuid": frame_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": tex_uuid,
                "trimType": trim['trimType'],
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": trim['offsetX'],
                "offsetY": trim['offsetY'],
                "trimX": trim['trimX'],
                "trimY": trim['trimY'],
                "width": trim['width'],
                "height": trim['height'],
                "rawWidth": w,
                "rawHeight": h,
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {}
            }
        }
    }


def read_meta(path):
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    return None


def write_png(path, arr):
    Image.fromarray(arr, 'RGBA').save(path, optimize=True)


def convert_one(slot, folder, name, tmpdir, apply):
    paths = extract_frames(name, tmpdir)
    frames, (cw, ch), body = build_frames(name, paths)
    keep, thresh = select_keys(frames)
    folder_dir = os.path.join(EMOJI_DIR, folder)
    icons = sorted(glob.glob(os.path.join(folder_dir, '*_0.png')))
    if not icons:
        raise RuntimeError('找不到图标文件 <prefix>_0.png：%s' % folder_dir)
    icon_path = icons[0]
    prefix = os.path.basename(icon_path)[:-len('_0.png')]
    anim_path = os.path.join(folder_dir, '%s.anim' % folder)
    duration = len(paths) / float(FPS)
    print('%-8s -> %-9s 帧 %d/%d (阈值%.1f)  画布 %dx%d  主体 %dpx  时长 %.2fs  前缀 %s'
          % (folder, name, len(keep), len(paths), thresh, cw, ch, body, duration, prefix))
    if not apply:
        return

    # 1) 图标：沿用 <prefix>_0.png 与其 uuid，内容换成新表情静帧
    icon_meta = read_meta(icon_path + '.meta')
    tex_uuid = icon_meta['uuid'] if icon_meta else new_uuid()
    frame_uuid = list(icon_meta['subMetas'].values())[0]['uuid'] if icon_meta else new_uuid()
    still = Image.open(os.path.join(SRC, 'images', 'emoji', name + '.webp')).convert('RGBA')
    sw, sh = still.size
    a = np.array(still)[:, :, 3]
    ys, xs = np.where(a > 1)
    x0, y0 = int(xs.min()), int(ys.min())
    tw, th = int(xs.max()) + 1 - x0, int(ys.max()) + 1 - y0
    trim = dict(trimType='auto', trimX=x0, trimY=y0, width=tw, height=th,
                offsetX=round((x0 + tw / 2.0) - sw / 2.0, 4),
                offsetY=round(sh / 2.0 - (y0 + th / 2.0), 4))
    still.save(icon_path)
    with open(icon_path + '.meta', 'w', encoding='utf-8') as f:
        json.dump(texture_meta(tex_uuid, frame_uuid, '%s_0' % prefix, sw, sh, trim),
                  f, ensure_ascii=False, indent=2)

    # 2) 序列帧：<prefix>_1..N，全部同尺寸、trimType=none
    old = glob.glob(os.path.join(folder_dir, '%s_*.png' % prefix))
    used = set()
    for n, idx in enumerate(keep):
        fname = '%s_%d' % (prefix, n + 1)
        path = os.path.join(folder_dir, fname + '.png')
        meta = read_meta(path + '.meta')
        t_uuid = meta['uuid'] if meta else new_uuid()
        f_uuid = list(meta['subMetas'].values())[0]['uuid'] if meta else new_uuid()
        write_png(path, frames[idx])
        with open(path + '.meta', 'w', encoding='utf-8') as f:
            json.dump(texture_meta(t_uuid, f_uuid, fname, cw, ch), f,
                      ensure_ascii=False, indent=2)
        used.add(os.path.abspath(path))
        used.add(os.path.abspath(path + '.meta'))
    for p in old:
        if os.path.abspath(p) == os.path.abspath(icon_path):
            continue
        if os.path.abspath(p) not in used:
            os.remove(p)
            if os.path.exists(p + '.meta'):
                os.remove(p + '.meta')

    # 3) 动画剪辑：沿用原 uuid / 文件名，重写 spriteFrame 关键帧（原始时间轴）
    clip_meta = read_meta(anim_path + '.meta')
    clip = json.load(open(anim_path, encoding='utf-8')) if os.path.exists(anim_path) else None
    curves = []
    for n, idx in enumerate(keep):
        fname = '%s_%d' % (prefix, n + 1)
        meta = read_meta(os.path.join(folder_dir, fname + '.png.meta'))
        curves.append({
            "frame": round(idx / float(FPS), 4),
            "value": {"__uuid__": list(meta['subMetas'].values())[0]['uuid']}
        })
    data = {
        "__type__": "cc.AnimationClip",
        "_name": folder,
        "_objFlags": 0,
        "_native": "",
        "_duration": round(duration, 4),
        "sample": FPS,
        "speed": 1,
        "wrapMode": 2,          # cc.WrapMode.Loop（引擎枚举 Loop = 2）
        "curveData": {"comps": {"cc.Sprite": {"spriteFrame": curves}}},
        "events": []
    }
    with open(anim_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if clip_meta is None:
        with open(anim_path + '.meta', 'w', encoding='utf-8') as f:
            json.dump({
                "ver": "1.1.3", "uuid": new_uuid(), "importer": "animation-clip",
                "isBundle": False, "bundleName": "", "priority": 1,
                "compressionType": {}, "optimizeHotUpdate": {},
                "inlineSpriteFrames": {}, "isRemoteBundle": {}, "subMetas": {}
            }, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只统计不写文件')
    args = ap.parse_args()
    apply = not args.check
    tmpdir = tempfile.mkdtemp(prefix='hh-emoji-')
    try:
        for slot, folder, name in MAPPING:
            convert_one(slot, folder, name, tmpdir, apply)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    print('done%s' % ('' if apply else ' (check only)'))


if __name__ == '__main__':
    main()
