#!/usr/bin/env python3
"""修正房间行三个图标节点：Sprite 组件的 node 必须指向自身节点，尺寸改为方形。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"
SIZES = {"筹码图标": 30, "时钟图标": 30, "人数图标": 30}

import random
import string

data = json.loads(PREFAB.read_text(encoding="utf-8"))
ALPHA = string.ascii_letters + string.digits + "+/"
prefab_ids = {o.get("_prefab", {}).get("__id__") for o in data if o.get("__type__") == "cc.Node" and o.get("_prefab")}
for i, o in enumerate(data):
    if o.get("_name") in SIZES and o.get("_parent", {}).get("__id__") == 151:
        o["_contentSize"] = {"__type__": "cc.Size", "width": SIZES[o["_name"]], "height": SIZES[o["_name"]]}
        for c in o["_components"]:
            comp = data[c["__id__"]]
            comp["node"] = {"__id__": i}
            print(o["_name"], i, comp.get("__type__"), comp.get("_spriteFrame", {}).get("__uuid__", "")[:8])
        info = dict(data[o["_prefab"]["__id__"]])
        info["fileId"] = "".join(random.choice(ALPHA) for _ in range(22))
        o["_prefab"] = {"__id__": len(data)}
        data.append(info)
PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("prefabInfo ids in use:", sorted(prefab_ids))
