#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""牌桌「芒果」行左侧名称改为美术字图（休芒_100x60），替代之前的 Label 文字。

- 隐藏原「芒果_100x60」美术字节点（回退老协议时由代码 loadRes 换回芒果图）；
- 同位置新增「名称」Sprite 节点，规格与芒果图一致（100x60、scale 0.6、pos -68.2,0）；
- 场景 drh8.fire（运行生效）与 resources/UI/panelGameView.prefab 同步，fileId 共用；
- 幂等：已有「名称」节点则跳过。

配套资源：assets/V7/游戏内/{休芒,圈芒,揍芒}_100x60.png（imagegen 生成，风格对齐「皮池」）。
"""
import json
import random
import string
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENE_PATH = ROOT / "assets/Scenes/drh8.fire"
PREFAB_PATH = ROOT / "assets/resources/UI/panelGameView.prefab"

SPRITE_NAME_UUID = "2f8c185c-a55e-4a86-a41a-58fd60564fda"  # 休芒_100x60
MATERIAL_UUID = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
ALPHABET = string.ascii_letters + string.digits + "+/"


def rid(seed):
    rnd = random.Random(seed)
    return "".join(rnd.choice(ALPHABET) for _ in range(22))


def apply(path, mangchi_id, root_id, root_is_prefab, file_id, node_seed):
    data = json.loads(path.read_text(encoding="utf-8"))
    node = data[mangchi_id]
    if node.get("_name") != "芒池":
        raise SystemExit(f"{path}: id {mangchi_id} 不是芒池（实际 {node.get('_name')}）")

    names = [data[c["__id__"]].get("_name") for c in node["_children"]]
    if "名称" in names:
        print(f"{path.name}: 已有「名称」节点，跳过")
        return

    for c in node["_children"]:
        child = data[c["__id__"]]
        if child.get("_name") == "芒果_100x60":
            child["_active"] = False

    node_id = len(data)
    data.append({})
    comp_id = node_id + 1
    data.append({})
    prefab_id = node_id + 2
    data.append(
        {
            "__type__": "cc.PrefabInfo",
            "root": {"__id__": root_id},
            "asset": {"__id__": 0} if root_is_prefab else {"__uuid__": "1c485fb2-99c7-499b-a5e1-395955406b76"},
            "fileId": file_id,
            "sync": False,
        }
    )

    data[node_id] = {
        "__type__": "cc.Node",
        "_name": "名称",
        "_objFlags": 0,
        "_parent": {"__id__": mangchi_id},
        "_children": [],
        "_active": True,
        "_components": [{"__id__": comp_id}],
        "_prefab": {"__id__": prefab_id},
        "_opacity": 255,
        "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_contentSize": {"__type__": "cc.Size", "width": 100, "height": 60},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {
            "__type__": "TypedArray",
            "ctor": "Float64Array",
            "array": [-68.2, 0, 0, 0, 0, 0, 1, 0.6, 0.6, 1],
        },
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0,
        "_skewY": 0,
        "_is3DNode": False,
        "_groupIndex": 0,
        "groupIndex": 0,
        "_id": "" if root_is_prefab else rid(node_seed),
    }
    data[comp_id] = {
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": node_id},
        "_enabled": True,
        "_materials": [{"__uuid__": MATERIAL_UUID}],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_spriteFrame": {"__uuid__": SPRITE_NAME_UUID},
        "_type": 0,
        "_sizeMode": 1,
        "_fillType": 0,
        "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": True,
        "_atlas": None,
        "_id": rid(node_seed + 1),
    }

    node["_children"].append({"__id__": node_id})
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{path.name}: 已加「名称」Sprite 节点 id={node_id}")


def main():
    file_id = rid(20261118)
    apply(SCENE_PATH, 90, 6, False, file_id, 20261119)
    apply(PREFAB_PATH, 85, 1, True, file_id, 20261120)


if __name__ == "__main__":
    main()
