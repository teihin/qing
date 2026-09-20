#!/usr/bin/env python3
"""Apply the shared original dialog chrome to the buy-in insufficient-funds child."""
from migrate_v8_ingame_dialogs import (load, PAGES, reset_node, add_label, GOLD, PALE, DARK, visual_signature)

PATH = '带入窗口/余额不足提示'

def apply(relative):
    p = load(relative)
    root = p.node(PATH)
    before_events = [o.copy() for o in p.data if o.get('__type__') == 'cc.ClickEvent']
    active = p.data[root]['_active']
    reset_node(p, root)
    p.set_pos(root, 0, 0, 532, 366)
    p.sprite(root, 'original_dialog_panel.png', sliced=True)
    p.data[root]['_active'] = active
    title = p.node(PATH + '/带入积分')
    reset_node(p, title)
    p.set_pos(title, 0, 174, 320, 76)
    p.sprite(title, 'original_dialog_title.png', sliced=True)
    add_label(p, PATH + '/带入积分', '统一标题文字', '温馨提示', w=290, h=52, size=32, bold=True)
    msg = p.node(PATH + '/txt')
    reset_node(p, msg)
    p.set_pos(msg, 0, 24, 450, 124)
    _, label = p.component(msg, 'cc.Label')
    label.update(_fontSize=30, _lineHeight=40, _enableWrapText=True,
                 _overflow=2, **{'_N$overflow': 2, '_N$horizontalAlign': 1, '_N$verticalAlign': 1})
    p.data[msg]['_color'].update(r=255,g=239,b=205)
    p.disable(msg, 'cc.LabelShadow')
    # There are two identically named close nodes. Identify the bottom action
    # by its existing negative Y coordinate, never by an ambiguous name lookup.
    for ref in p.data[root]['_children']:
        i = ref['__id__']; n = p.data[i]
        if n['_name'] not in ('充值', '关闭上上层'): continue
        y = n['_trs']['array'][1]
        reset_node(p, i)
        if n['_name'] == '充值':
            p.set_pos(i, 130, -112, 208, 66)
            p.sprite(i, 'original_dialog_button_gold.png', sliced=True)
        elif y < 0:
            p.set_pos(i, -130, -112, 208, 66)
            p.sprite(i, 'original_dialog_button_blue.png', sliced=True)
        else:
            p.set_pos(i, 231, 143, 44, 44)
            p.sprite(i, 'player_info_v8_close.png')
    add_label(p, PATH, '统一取消文字', '取消', x=-130, y=-112, w=180, h=48, size=30, color=GOLD)
    add_label(p, PATH, '统一充值文字', '充值', x=130, y=-112, w=180, h=48, size=30, color=DARK)
    assert before_events == [o for o in p.data if o.get('__type__') == 'cc.ClickEvent']
    p.save()

if __name__ == '__main__':
    for relative in PAGES: apply(relative)
    left, right = (load(relative) for relative in PAGES)
    assert visual_signature(left, left.node(PATH)) == visual_signature(right, right.node(PATH))
    print('Insufficient-funds dialog updated; Prefab/Scene match; click events preserved.')
