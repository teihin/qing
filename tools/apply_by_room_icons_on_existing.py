#!/usr/bin/env python3
"""改用模板里已有的 img / img copy 节点当图标（不再新增节点），并清理上次新增的三个节点。

新增节点在编辑器里不渲染，这里复用 V7 时期就存在的图标占位节点：
  img        -> 筹码图标
  img copy#1 -> 时钟图标
  img copy#2 -> 人数图标
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"
DROP_NAMES = ("筹码图标", "时钟图标", "人数图标")
SLOTS = [("img", "room_icon_chip", -202.0), ("img copy", "room_icon_clock", -100.0),
         ("img copy", "room_icon_player", 45.0)]
SIZE = 30.0
ROW_Y = -33.0


def frame_uuid(name):
    meta = json.loads((ROOT / f"assets/V7/{name}.png.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][name]["uuid"]


data = json.loads(PREFAB.read_text(encoding="utf-8"))
tmpl = next(i for i, o in enumerate(data)
            if o.get("_name") == "房间对象" and o.get("_parent", {}).get("__id__") == 142)
children = data[tmpl]["_children"]

drop = set()
for c in list(children):
    n = data[c["__id__"]]
    if n.get("_name") in DROP_NAMES:
        drop.add(c["__id__"])
        drop.update(comp["__id__"] for comp in n["_components"])
        children.remove(c)
print("drop objects:", sorted(drop))

used = {}
for name, res, x in SLOTS:
    idx = used.get(name, 0)
    targets = [c["__id__"] for c in children if data[c["__id__"]].get("_name") == name]
    node_id = targets[idx]
    used[name] = idx + 1
    node = data[node_id]
    node["_active"] = True
    node["_trs"]["array"][0] = x
    node["_trs"]["array"][1] = ROW_Y
    node["_contentSize"] = {"__type__": "cc.Size", "width": SIZE, "height": SIZE}
    for cref in node["_components"]:
        comp = data[cref["__id__"]]
        if comp.get("__type__") == "cc.Sprite":
            comp["node"] = {"__id__": node_id}
            comp["_spriteFrame"] = {"__uuid__": frame_uuid(res)}
            comp["_sizeMode"] = 0
            comp["_type"] = 0
    print("slot", node_id, name, "->", res, frame_uuid(res)[:8])

keep = [i for i in range(len(data)) if i not in drop]
remap = {old: new for new, old in enumerate(keep)}


def fix(obj):
    if isinstance(obj, dict):
        if len(obj) == 1 and "__id__" in obj:
            return {"__id__": remap[obj["__id__"]]}
        return {k: fix(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fix(v) for v in obj]
    return obj


out = [fix(data[i]) for i in keep]
PREFAB.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("objects", len(out))
