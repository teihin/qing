#!/usr/bin/env python3
"""把房间行三个图标节点放大到 36x36，并把人数数字右移一点留出间距。"""
import json
from pathlib import Path

PREFAB = Path(__file__).resolve().parents[1] / "assets/resources/UI/panelMain.prefab"
data = json.loads(PREFAB.read_text(encoding="utf-8"))
tmpl = next(i for i, o in enumerate(data)
            if o.get("_name") == "房间对象" and isinstance(o.get("_parent"), dict)
            and data[o["_parent"]["__id__"]].get("_name") == "房间列表")

for c in data[tmpl]["_children"]:
    n = data[c["__id__"]]
    if n["_name"] == "img":
        n["_contentSize"] = {"__type__": "cc.Size", "width": 36, "height": 36}
        n["_trs"]["array"][0] = -204.0
    elif n["_name"] == "img copy" and n["_trs"]["array"][0] < 0:
        n["_contentSize"] = {"__type__": "cc.Size", "width": 36, "height": 36}
        n["_trs"]["array"][0] = -102.0
    elif n["_name"] == "img copy":
        n["_contentSize"] = {"__type__": "cc.Size", "width": 36, "height": 36}
        n["_trs"]["array"][0] = 44.0
    elif n["_name"] == "人数":
        n["_trs"]["array"][0] = 74.0
    print(n["_name"], n["_contentSize"]["width"], n["_trs"]["array"][0])

PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
