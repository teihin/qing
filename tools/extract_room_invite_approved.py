#!/usr/bin/env python3
"""Cut approved room-invite art into formal fixed Cocos assets.

The panel base is copied from the approved clean source, whose dynamic copy,
room number, values and description have been removed.  Fixed lettering and
decoration are direct rectangular pixel cuts from the approved original.
No Prefab or gameplay file is changed by this tool.
"""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / 'design-previews/效果图V8-new/04-登录与弹窗/房间邀请-20260920.png'
OUT = ROOT / 'assets/V7/游戏内'
SOURCE = PREVIEW
CLEAN = ROOT / 'art_sources/room-invite-approved/room_invite_approved_clean_dynamic_holes.png'
# Only used once to place the user-approved clean input in the repository.
BOOTSTRAP_CLEAN = Path('/Users/yy/.codex/generated_images/01a0bcc5-7ec5-76a0-8480-997ec234f045/exec-b2d3e0f6-4b27-48f9-9ca6-2cb5017870d3.png')

# x, y, width, height in the 940x1672 approved composition.
SLICES = {
    'panel_clean': ((59, 321, 822, 934), 'clean', 'modal frame and all cleaned dynamic holes'),
    'header': ((187, 351, 565, 130), 'original', 'fixed title, subtitle and two ornaments'),
    'close': ((806, 353, 42, 39), 'original', 'close art'),
    'info_card': ((120, 597, 700, 318), 'clean', 'card decoration, labels and empty dynamic value holes'),
    'checkbox_ring': ((334, 1009, 47, 47), 'original', 'unselected circle'),
    'checkbox_label': ((399, 1012, 230, 39), 'original', 'fixed checkbox label'),
    'button_ignore': ((126, 1088, 324, 96), 'original', 'fixed ignore button with lettering'),
    'button_go_room': ((476, 1088, 339, 96), 'original', 'fixed go-room button with lettering'),
}
DYNAMIC_HOLES = {
    'invite_text': (218, 516, 507, 71),
    'room_number': (296, 665, 352, 105),
    'stake_value': (273, 824, 106, 69),
    'player_value': (617, 824, 108, 69),
    'description': (221, 927, 499, 70),
}

def meta(path: Path, key: str, size: tuple[int, int]) -> None:
    texture = str(uuid.uuid5(uuid.NAMESPACE_URL, 'qing/room-invite-approved/texture/' + key))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, 'qing/room-invite-approved/frame/' + key))
    w, h = size
    sub = {
        'ver': '1.0.6', 'uuid': frame, 'importer': 'sprite-frame',
        'rawTextureUuid': texture, 'trimType': 'none', 'trimThreshold': 1,
        'rotated': False, 'offsetX': 0, 'offsetY': 0, 'trimX': 0, 'trimY': 0,
        'width': w, 'height': h, 'rawWidth': w, 'rawHeight': h,
        'borderTop': 0, 'borderBottom': 0, 'borderLeft': 0, 'borderRight': 0,
        'subMetas': {},
    }
    data = {
        'ver': '2.3.7', 'uuid': texture, 'importer': 'texture', 'type': 'sprite',
        'wrapMode': 'clamp', 'filterMode': 'bilinear', 'premultiplyAlpha': False,
        'genMipmaps': False, 'packable': True, 'width': w, 'height': h,
        'platformSettings': {}, 'subMetas': {path.stem: sub},
    }
    path.with_suffix('.png.meta').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def patch_dynamic_holes(image: Image.Image, origin: tuple[int, int], clean: Image.Image,
                        keys: tuple[str, ...], feather: bool = False) -> Image.Image:
    """Replace only dynamic-copy rectangles; every other source pixel stays exact."""
    ox, oy = origin
    left, top, right, bottom = ox, oy, ox + image.width, oy + image.height
    for key in keys:
        x, y, w, h = DYNAMIC_HOLES[key]
        ix0, iy0, ix1, iy1 = max(left, x), max(top, y), min(right, x + w), min(bottom, y + h)
        if ix0 < ix1 and iy0 < iy1:
            patch = clean.crop((ix0, iy0, ix1, iy1))
            if feather:
                # The 20px expanded slot has a 10px feathered perimeter: clean
                # in the center removes every sample glyph, while original pixels
                # smoothly resume at the boundary.
                mask = Image.new('L', patch.size, 255)
                draw = ImageDraw.Draw(mask)
                for inset in range(11):
                    draw.rectangle((inset, inset, patch.width - 1 - inset, patch.height - 1 - inset),
                                   fill=round(255 * inset / 10))
                image.paste(patch, (ix0 - ox, iy0 - oy), mask)
            else:
                image.alpha_composite(patch, (ix0 - ox, iy0 - oy))
    return image

def main() -> None:
    if not CLEAN.is_file() and BOOTSTRAP_CLEAN.is_file():
        CLEAN.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BOOTSTRAP_CLEAN, CLEAN)
    if not SOURCE.is_file() or not CLEAN.is_file():
        raise FileNotFoundError('approved original or clean source is unavailable')
    original, clean = Image.open(SOURCE).convert('RGBA'), Image.open(CLEAN).convert('RGBA')
    if original.size != (940, 1672) or clean.size != original.size:
        raise ValueError(f'expected matching 940x1672 sources, got {original.size} and {clean.size}')
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {'source_size': list(original.size), 'panel_bbox': [59, 321, 822, 934],
                'dynamic_holes': DYNAMIC_HOLES, 'slices': {}}
    # The base owns only the frame/decorative background and dynamic holes.
    # Rectangular transparent holes make the original-pixel fixed slices the
    # sole owner of their areas, avoiding double compositing in the Prefab.
    panel = patch_dynamic_holes(original.crop((59, 321, 881, 1255)), (59, 321), clean,
                                ('invite_text', 'description'), feather=True)
    alpha = panel.getchannel('A')
    # Remove screenshot/table pixels outside the rounded panel perimeter.
    perimeter = Image.new('L', panel.size, 0)
    ImageDraw.Draw(perimeter).rounded_rectangle((0, 0, 821, 933), radius=38, fill=255)
    alpha = Image.composite(alpha, Image.new('L', panel.size, 0), perimeter)
    for key in ('header', 'close', 'info_card', 'checkbox_ring', 'checkbox_label',
                'button_ignore', 'button_go_room'):
        x, y, w, h = SLICES[key][0]
        ImageDraw.Draw(alpha).rectangle((x - 59, y - 321, x - 59 + w - 1, y - 321 + h - 1), fill=0)
    panel.putalpha(alpha)
    for key, (bbox, source_name, note) in SLICES.items():
        x, y, w, h = bbox
        image = panel if key == 'panel_clean' else original.crop((x, y, x + w, y + h))
        if source_name == 'clean' and key != 'panel_clean':
            image = patch_dynamic_holes(image, (x, y), clean,
                                        ('room_number', 'stake_value', 'player_value'))
        path = OUT / f'room_invite_approved_{key}.png'
        image.save(path, optimize=True)
        meta(path, key, image.size)
        manifest['slices'][key] = {'path': str(path.relative_to(ROOT)), 'bbox': list(bbox),
                                  'source': source_name, 'note': note}
    (OUT / 'room_invite_approved_manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    # A 1:1 assembly check for the intended fixed layer stack.  It intentionally
    # leaves the five runtime text/value holes transparent-to-base as supplied
    # by CLEAN, so Prefab labels can occupy them without covering reference art.
    assembled = Image.new('RGBA', original.size, (0, 0, 0, 0))
    assembled.alpha_composite(Image.open(OUT / 'room_invite_approved_panel_clean.png'), (59, 321))
    for key in ('header', 'close', 'info_card', 'checkbox_ring',
                'checkbox_label', 'button_ignore', 'button_go_room'):
        x, y, _, _ = SLICES[key][0]
        assembled.alpha_composite(Image.open(OUT / f'room_invite_approved_{key}.png'), (x, y))
    preview_dir = ROOT / 'art_sources/room-invite-approved'
    preview_dir.mkdir(parents=True, exist_ok=True)
    assembled.save(preview_dir / 'room_invite_approved_composite_dynamic_holes.png', optimize=True)
    # A prior pre-component extraction included this redundant slice.  Remove
    # it on rerun so the formal asset set has exactly one owner for the tag.
    for stale in ('room_invite_approved_room_label.png', 'room_invite_approved_room_label.png.meta'):
        (OUT / stale).unlink(missing_ok=True)
    print('wrote', len(SLICES), 'fixed assets and manifest')

if __name__ == '__main__':
    main()
