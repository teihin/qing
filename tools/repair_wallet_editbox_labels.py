#!/usr/bin/env python3
"""Repair wallet EditBox inner labels in the Prefab, without moving their rows."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WALLET = ROOT / 'assets/resources/Prefabs/钱包.prefab'


def repair(data):
    count = 0
    for edit in data:
        if edit.get('__type__') != 'cc.EditBox':
            continue
        owner = data[edit['node']['__id__']]
        width, height = (owner['_contentSize'][key] for key in ('width', 'height'))
        anchor = owner['_anchorPoint']
        for key in ('_N$textLabel', '_N$placeholderLabel'):
            label = data[edit[key]['__id__']]
            node = data[label['node']['__id__']]
            widget = next(data[ref['__id__']] for ref in node['_components']
                          if data[ref['__id__']]['__type__'] == 'cc.Widget')
            # Recharge-information rows include a static caption inside the input.
            # Preserve its reserved horizontal space, including on repeated runs.
            if widget['_enabled'] and widget['_alignFlags'] == 45 and not widget['_target']:
                left = max(0, widget['_left'])
                right = max(0, widget['_right'])
            else:
                left = right = 3
            assert width > left + right and height > 0
            # CCEditBox._updateTextLabel/_updatePlaceholderLabel use (0, 1).
            # Store the matching position too, so preload cannot shift the text.
            node['_anchorPoint'].update(x=0, y=1)
            node['_trs']['array'][:2] = [-anchor['x'] * width + left,
                                        (1 - anchor['y']) * height]
            node['_trs']['array'][7:10] = [1, 1, 1]
            node['_contentSize'].update(width=width-left-right, height=height)
            label['_N$horizontalAlign'] = 0
            label['_N$verticalAlign'] = 1
            label['_overflow'] = 1  # CLAMP; long values stay within the input.
            label['_enableWrapText'] = False
            # Native Widget follows the input's size on resolution changes.
            widget.update(_enabled=True, alignMode=1, _target=None, _alignFlags=45,
                          _left=left, _right=right, _top=0, _bottom=0,
                          _horizontalCenter=0, _verticalCenter=0)
            for edge in ('Left', 'Right', 'Top', 'Bottom'):
                widget['_isAbs'+edge] = True
            count += 1
    return count


def main():
    data = json.loads(WALLET.read_text())
    count = repair(data)
    WALLET.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    print(f'Repaired {count} text/placeholder labels; outer nodes and EditBox contracts preserved.')


if __name__ == '__main__':
    main()
