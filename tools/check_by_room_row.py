#!/usr/bin/env python3
"""打印大厅房间行模板的节点布局，便于人工核对。"""
import json
from pathlib import Path

d = json.loads((Path(__file__).resolve().parents[1] / "assets/resources/UI/panelMain.prefab")
               .read_text(encoding="utf-8"))
tmpl = next(i for i, o in enumerate(d)
            if o.get("_name") == "房间对象" and isinstance(o.get("_parent"), dict)
            and d[o["_parent"]["__id__"]].get("_name") == "房间列表")
print("template id", tmpl)
for c in d[tmpl]["_children"]:
    n = d[c["__id__"]]
    comps = [d[x["__id__"]] for x in n.get("_components", [])]
    sf = [c2.get("_spriteFrame", {}).get("__uuid__", "")[:8] for c2 in comps if c2.get("__type__") == "cc.Sprite"]
    lbl = [c2.get("_string") for c2 in comps if c2.get("__type__") == "cc.Label"]
    print("%-12s active=%-5s x=%-8s y=%-7s size=%sx%s sf=%s label=%s" % (
        n["_name"], n.get("_active"), n["_trs"]["array"][0], n["_trs"]["array"][1],
        n["_contentSize"]["width"], n["_contentSize"]["height"], sf, lbl))
