#!/usr/bin/env python3
"""把大厅房间行改成：筹码+底皮值 / 时钟+时长 / 人数+人数 / 剩余时间 12:12，并加入独立图标节点。"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"
ROW_Y = -33
FONT = 24
# (节点名, x 左边界或图标中心, 类型)
LABELS = [("底皮", -172.0), ("时间", -78.0), ("人数", 68.0), ("倒计时", 130.0)]
ICONS = [("筹码图标", "room_icon_chip", -202.0, 30.0), ("时钟图标", "room_icon_clock", -100.0, 30.0),
         ("人数图标", "room_icon_player", 45.0, 30.0)]


def frame_uuid(name):
    meta = json.loads((ROOT / f"assets/V7/{name}.png.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][name]["uuid"]


def main():
    data = json.loads(PREFAB.read_text(encoding="utf-8"))
    tmpl = next(i for i, o in enumerate(data)
                if o.get("_name") == "房间对象" and o.get("_parent", {}).get("__id__") == 142)
    children = data[tmpl]["_children"]
    by_name = {data[c["__id__"]].get("_name"): c["__id__"] for c in children}

    # 1) 四个动态数字：左对齐、字号统一、落到同一行
    for name, x in LABELS:
        idx = by_name[name]
        node = data[idx]
        node["_trs"]["array"][0] = x
        node["_trs"]["array"][1] = ROW_Y
        node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0, "y": 0.5}
        node["_contentSize"] = {"__type__": "cc.Size", "width": 120, "height": 34}
        for cref in node["_components"]:
            comp = data[cref["__id__"]]
            if comp.get("__type__") == "cc.Label":
                comp["_fontSize"] = FONT
                comp["_N$fontSize"] = FONT
                comp["_N$horizontalAlign"] = 0
                comp["_string"] = comp["_N$string"] = {"底皮": "1/3", "时间": "45分钟", "人数": "0/8",
                                                       "倒计时": "剩余时间 12:12"}[name]

    # 2) 克隆一个纯 Sprite 子节点作为图标模板
    src = by_name["img"]
    src_node = data[src]
    assert len(src_node["_children"]) == 0, "图标模板节点不应有子节点"

    for name, res, x, size in ICONS:
        new_node = copy.deepcopy(src_node)
        comps = [copy.deepcopy(data[c["__id__"]]) for c in src_node["_components"]]
        new_node["_name"] = name
        new_node["_active"] = True
        new_node["_parent"] = {"__id__": tmpl}
        new_node["_trs"]["array"][0] = x
        new_node["_trs"]["array"][1] = ROW_Y
        new_node["_contentSize"] = {"__type__": "cc.Size", "width": size, "height": size}
        comp_ids = []
        for comp in comps:
            if comp.get("__type__") == "cc.Sprite":
                comp["_spriteFrame"] = {"__uuid__": frame_uuid(res)}
                comp["_sizeMode"] = 0
                comp["_type"] = 0
            comp_ids.append({"__id__": len(data)})
            data.append(comp)
        new_node["_components"] = comp_ids
        new_node["_id"] = ""
        children.append({"__id__": len(data)})
        data.append(new_node)
        print("added", name, "spriteFrame", frame_uuid(res))

    PREFAB.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("saved", PREFAB, "objects", len(data))


if __name__ == "__main__":
    main()
