#!/usr/bin/env python3
"""Serialize the approved compact menu into both formal room assets.

The image is split into a panel, eight independent controls and the trigger.
Business names/components/UUIDs are retained; there is no runtime skin code.
"""
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from apply_v7_prefab_skin import Prefab, ROOT, ASSET_DIR
from apply_v8_agent import new, loc
from apply_v8_login import update_meta
from apply_v8_wallet_recharge import rounded
from repair_v7_responsive_layout import ensure_widget

SOURCE = ROOT / 'design-previews/效果图V8-new/06-桌内界面/09-左上角牌局菜单.png'
OUT = ROOT / 'art_sources/v8-repairs/ingame-menu'
PANEL = (28, 210, 642, 1059)
S = 440 / (PANEL[2] - PANEL[0])
ITEMS = [
    ('站起围观', 'watch', (53, 355, 328, 512)),
    ('补充钵钵', 'chips', (342, 355, 617, 512)),
    ('留座离桌', 'seat', (53, 530, 328, 687)),
    ('牌型展示', 'cards', (342, 530, 617, 687)),
    ('牌局设置', 'settings', (53, 704, 328, 861)),
    ('解散房间', 'dissolve', (342, 704, 617, 861)),
    ('联系客服', 'service', (53, 878, 328, 1035)),
    ('退出房间', 'exit', (342, 878, 617, 1035)),
]


def save(key, im, box):
    name = 'ingame_menu_v8_' + key + '.png'
    path = ASSET_DIR / name
    im.save(path, optimize=True)
    update_meta(name)
    mp = path.with_suffix('.png.meta')
    meta = json.loads(mp.read_text())
    meta['packable'] = True
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    return dict(name=name, source_box=box, size=im.size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest())


def extract():
    source = Image.open(SOURCE).convert('RGBA')
    assert source.size == (948, 1660)
    panel = source.crop(PANEL)
    a = np.asarray(panel).copy()
    # A clean blue gutter supplies a smooth vertical profile. Averaging across
    # the gutter removes horizontal texture instead of magnifying it into stripes.
    profile = np.median(a[:, 8:20, :3], axis=1).astype('uint8')
    profile = np.asarray(Image.fromarray(profile[:, None, :]).filter(ImageFilter.GaussianBlur(7)))[:, 0]
    for _, _, box in ITEMS:
        x0, y0, x1, y1 = box
        x0 -= PANEL[0]; x1 -= PANEL[0]; y0 -= PANEL[1]; y1 -= PANEL[1]
        # Clear the original control and its glow completely; the independent
        # control goes back here. A permission-hidden action leaves plain blue.
        a[y0-6:y1+6, x0-5:x1+5, :3] = profile[y0-6:y1+6, None, :]
    panel = Image.fromarray(a)
    mask = Image.new('L', (panel.width * 4, panel.height * 4))
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 19*4, panel.width*4-1, panel.height*4-1), radius=34*4, fill=255)
    d.polygon([(25*4, 22*4), (43*4, 1*4), (62*4, 22*4)], fill=255)
    panel.putalpha(mask.resize(panel.size, Image.Resampling.LANCZOS))
    cuts = [save('panel', panel, PANEL)]
    for _, key, box in ITEMS:
        cuts.append(save(key, rounded(source.crop(box), 21), box))
    cuts.append(save('trigger', rounded(source.crop((28, 128, 111, 212)), 17), (28, 128, 111, 212)))
    (OUT / 'cuts.json').write_text(json.dumps(cuts, ensure_ascii=False, indent=2) + '\n')


def pin_top_left(p, node, left, top):
    n = p.data[node]
    parent = p.data[n['_parent']['__id__']]
    w, h = n['_contentSize']['width'], n['_contentSize']['height']
    pw, ph = parent['_contentSize']['width'], parent['_contentSize']['height']
    p.set_pos(node, -pw * parent['_anchorPoint']['x'] + left + w/2,
              ph * (1-parent['_anchorPoint']['y']) - top - h/2)
    ensure_widget(p, node).update(_enabled=True, alignMode=1, _alignFlags=9,
                                  _left=left, _top=top)


def apply(relative):
    p = Prefab.__new__(Prefab)
    p.path = ROOT / relative
    p.data = json.loads(p.path.read_text())
    p.root = next(i for i, n in enumerate(p.data)
                  if n.get('__type__') == 'cc.Node' and n.get('_name') == 'panelGameView')
    menu = p.node('ConfigMain')
    active = p.data[menu]['_active']
    w, h = (PANEL[2]-PANEL[0])*S, (PANEL[3]-PANEL[1])*S
    loc(p, 'ConfigMain', 0, 0, w, h)
    p.sprite(menu, 'ingame_menu_v8_panel.png')
    # Native Grid observes active-in-hierarchy-changed and skips hidden actions.
    # Keep all eight business nodes directly under ConfigMain: existing paths
    # and button.node.parent.active=false continue to refer to this menu.
    _, layout = p.component(menu, 'cc.Layout')
    layout.update(_enabled=True, _resize=0,
                  _layoutSize={'__type__':'cc.Size', 'width':w, 'height':h},
                  **{'_N$layoutType':3, '_N$startAxis':0,
                     '_N$cellSize':{'__type__':'cc.Size', 'width':275*S, 'height':157*S},
                     '_N$paddingLeft':25*S, '_N$paddingRight':25*S-0.01,
                     '_N$paddingTop':145*S, '_N$paddingBottom':24*S,
                     '_N$spacingX':14*S, '_N$spacingY':17.5*S,
                     '_N$verticalDirection':1, '_N$horizontalDirection':0,
                     '_N$affectedByScale':False})
    pin_top_left(p, menu, 13, 100)
    for name, key, box in ITEMS:
        x0, y0, x1, y1 = box
        x = ((x0+x1)/2 - (PANEL[0]+PANEL[2])/2)*S
        y = ((PANEL[1]+PANEL[3])/2 - (y0+y1)/2)*S
        node = loc(p, 'ConfigMain/'+name, x, y, (x1-x0)*S, (y1-y0)*S)
        p.sprite(node, 'ingame_menu_v8_'+key+'.png')
        _, button = p.component(node, 'cc.Button')
        button['_N$transition'] = button['transition'] = 0
    # Header/blank-panel clicks use the existing ConfigMain hide branch. The
    # panel Button receives the close glyph hit, while child Buttons consume
    # their own touches. This keeps non-action children out of the native Grid.
    close = new(p, 'ConfigMain', '关闭上层')
    loc(p, 'ConfigMain/关闭上层', (588-335)*S, (634.5-283)*S, 62*S, 62*S)
    p.disable(close, 'cc.Sprite')
    p.set_active(close, False)
    if p.component(menu, 'cc.Button')[1] is None:
        button = copy.deepcopy(p.component(p.node('ConfigMain/退出房间'), 'cc.Button')[1])
        button.update(node={'__id__':menu}, clickEvents=[], _id='', **{'_N$target':{'__id__':menu}})
        p.data[menu]['_components'].append({'__id__':len(p.data)})
        p.data.append(button)
    trigger = p.node('RoomFrame/ConfigBT')
    # Preserve the existing 84px touch area and top-left alignment.
    p.sprite(trigger, 'ingame_menu_v8_trigger.png')
    p.data[trigger]['_trs']['array'][7:10] = [1, 1, 1]
    p.set_active(menu, active)
    p.save()


if __name__ == '__main__':
    extract()
    for relative in ['assets/resources/UI/panelGameView.prefab', 'assets/Scenes/drh8.fire']:
        apply(relative)
    print('Applied V8 menu: panel, 8 independent actions, close target, existing trigger.')
