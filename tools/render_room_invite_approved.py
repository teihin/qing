#!/usr/bin/env python3
"""Offline render of serialized panelRoomInvite Prefab; it is not Creator runtime."""
import sys
import re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from render_drh8_scene_preview import PreviewRenderer

PREFAB = ROOT / 'assets/resources/UI/panelRoomInvite.prefab'
OUT = ROOT / 'art_sources/room-invite-approved/previews'
VALUES = {'邀请人': '长名字牌友（ID：998877）邀请你加入', '房间号': '730564', '底皮值': '1/3', '人数值': '3/8'}

def find_node(renderer, name):
    return next(index for index, node in renderer.nodes.items() if node.get('_name') == name)

def draw_bmfont(renderer, name):
    """Draw the Prefab-selected bitmap font from its .fnt atlas, at its serialized size."""
    node_id = find_node(renderer, name)
    label = next(item for _, item in renderer.components_by_node[node_id] if item.get('__type__') == 'cc.Label')
    fnt = ROOT / 'assets/V7/jackpot_v8_serif_digits.fnt'
    atlas = Image.open(fnt.with_suffix('.png')).convert('RGBA')
    glyphs = {}
    for line in fnt.read_text().splitlines():
        if line.startswith('char '):
            values = dict(re.findall(r'(\w+)=(-?\d+)', line)); glyphs[chr(int(values['id']))] = {k:int(v) for k,v in values.items()}
    size = float(label['_fontSize']) / 124
    chars = [glyphs[c] for c in label['_string'] if c in glyphs]
    total = sum(g['xadvance'] * size for g in chars)
    # Resolve the actual serialized parent translations; all relevant nodes are unrotated in this Prefab.
    x = y = 0; current = node_id
    while current is not None:
        node = renderer.nodes[current]; trs = node['_trs']['array']; x += trs[0]; y += trs[1]
        parent = (node.get('_parent') or {}).get('__id__'); current = parent if parent in renderer.nodes else None
    cursor = 375 + x - total / 2
    baseline = renderer.height / 2 - y - (float(label['_lineHeight']) * size / 2)
    for g in chars:
        crop = atlas.crop((g['x'], g['y'], g['x']+g['width'], g['y']+g['height']))
        crop = crop.resize((round(g['width']*size), round(g['height']*size)), Image.Resampling.LANCZOS)
        renderer.canvas.alpha_composite(crop, (round(cursor + g['xoffset']*size), round(baseline + g['yoffset']*size)))
        cursor += g['xadvance'] * size

def render(height):
    output = OUT / f'panelRoomInvite-{height}.png'
    renderer = PreviewRenderer(PREFAB, output, None, (1, 12, 22, 255))
    renderer.width, renderer.height = 750, height
    renderer.canvas = Image.new('RGBA', (750, height), (1, 12, 22, 255))
    for name, value in VALUES.items():
        node = find_node(renderer, name)
        component = next(item for _, item in renderer.components_by_node[node] if item.get('__type__') == 'cc.Label')
        component['_string'] = component['_N$string'] = value
    # PreviewRenderer handles TTF labels. Its generic fallback cannot rasterize Cocos BMFont, so draw this one from
    # the exact .fnt/atlas selected by the formal room-number Label.
    next(item for _, item in renderer.components_by_node[find_node(renderer, '房间号')] if item.get('__type__') == 'cc.Label')['_enabled'] = False
    renderer._render_node(find_node(renderer, 'panelRoomInvite'), (1, 0, 0, 1, 375, height / 2), 1, None, True)
    draw_bmfont(renderer, '房间号')
    output.parent.mkdir(parents=True, exist_ok=True)
    renderer.canvas.convert('RGB').save(output, quality=95)
    return renderer

OUT.mkdir(parents=True, exist_ok=True)
for target_height in (1334, 1624):
    result = render(target_height)
    print(f'offline Prefab render {target_height}: sprites={result.stats["sprites_rendered"]}, labels={result.stats["labels_rendered"]}')
