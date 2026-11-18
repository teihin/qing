#!/usr/bin/env python3
"""排行榜数字列改为右对齐（配合等宽基线数字字体 leaderboard_v8_digits）。

只动数字 Label：played_count（手数/赢分/红利）与 user_reward（奖励）。
把这两列的 horizontalAlign 改成 RIGHT，并把节点中心左移，让右边缘统一落在
「列分隔线 / 行卡片右边」内侧 8px 处——这样不同位数的数字右边缘齐平。
文字框宽度不变，最长的 "+18,630" 仍在框内，不会触发 CLAMP 裁字。

用法：python3 tools/apply_leaderboard_number_align.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFABS = [ROOT / "assets/resources/Prefabs/排行榜.prefab",
           ROOT / "assets/resources/Prefabs/排行榜对象.prefab"]
DIGIT_FONT = "b7d5889d-1164-5b1c-a090-17e956e90fb8"
RIGHT_PAD = 8
TARGETS = ("played_count", "user_reward")


def node_of(data, obj):
    return data[obj["node"]["__id__"]]


def main():
    changed = 0
    for prefab in PREFABS:
        text = prefab.read_text()
        data = json.loads(text)
        eol = "\n" if text.endswith("\n") else ""
        if json.dumps(data, indent=2, ensure_ascii=False) + eol != text:
            raise SystemExit(f"{prefab.name} 无法无损往返，停止")
        rows = 0
        for obj in data:
            if obj.get("__type__") != "cc.Label":
                continue
            if ((obj.get("_N$file") or {}).get("__uuid__") or "") != DIGIT_FONT:
                continue
            node = node_of(data, obj)
            name = node.get("_name")
            if name not in TARGETS:
                continue
            parent = data[node["_parent"]["__id__"]] if node.get("_parent") else None
            if parent is None:
                raise SystemExit(f"{prefab.name}:{name} 没有父节点")
            if name == "played_count":
                divider = None
                for child in parent.get("_children", []):
                    c = data[child["__id__"]]
                    if c.get("_name") == "V8列分隔1":
                        divider = c["_trs"]["array"][0]
                if divider is None:
                    raise SystemExit(f"{prefab.name}:{name} 找不到 V8列分隔1")
                right = divider - RIGHT_PAD
            else:
                right = parent["_contentSize"]["width"] / 2 - RIGHT_PAD
            # 放宽文本框，给 "−18,630" 这类最长串留余量（右对齐时不影响视觉位置）
            width = 200.0 if name == "played_count" else 160.0
            x = round(right - width / 2, 6)
            arr = node["_trs"]["array"]
            if (obj.get("_N$horizontalAlign") == 2 and abs(arr[0] - x) < 1e-4
                    and abs(node["_contentSize"]["width"] - width) < 1e-4):
                continue
            obj["_N$horizontalAlign"] = 2
            node["_contentSize"]["width"] = width
            arr[0] = x
            rows += 1
            print(f"  {prefab.name} {name} x {arr[0]:.2f}  右边缘 {right:.2f} 框宽 {width:.2f}")
        prefab.write_text(json.dumps(data, indent=2, ensure_ascii=False) + eol)
        print(f"{prefab.name}: 调整 {rows} 个数字 Label")
        changed += rows
    print(f"合计 {changed} 个")
    return 0 if changed else 1


if __name__ == "__main__":
    raise SystemExit(main())
