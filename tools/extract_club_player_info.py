#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 panelMain.prefab 里的「俱乐部玩家设置弹窗」整棵子树提取成独立 Prefab。

- 只搬实际在用的节点，顺手丢掉确认废弃的（玩家资料卡旧底图、行内已强制隐藏的
  「成员删除/成员赠予/设置」）。
- 组件、贴图/字体 uuid、Widget 参数原样保留，逻辑层（ClubManagementView）不用改节点名。
- 用法：python3 tools/extract_club_player_info.py <脚本uuid>
"""
import copy, json, os, random, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/resources/UI/panelMain.prefab")
OUT = os.path.join(ROOT, "assets/resources/UI/panelClubPlayerInfo.prefab")
OUT_META = OUT + ".meta"
SCRIPT_UUID = sys.argv[1] if len(sys.argv) > 1 else ""
SRC_ROOT_NAME = "俱乐部玩家设置弹窗"
DROP_NAMES = {"玩家资料卡", "成员删除", "成员赠予", "设置"}

B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
MATERIAL = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"


def compressed_uuid(u):
    h = u.replace("-", "")
    out = h[:5]
    for i in range(5, len(h), 3):
        v = int(h[i:i + 3], 16)
        out += B64[v >> 6] + B64[v & 63]
    return out


def file_id(seed):
    rnd = random.Random(seed)
    return "".join(rnd.choice(B64) for _ in range(22))


def main():
    if not SCRIPT_UUID:
        raise SystemExit("需要传入脚本 uuid")
    src = json.load(open(SRC, encoding="utf-8"))
    src_root = next(i for i, o in enumerate(src)
                    if o.get("__type__") == "cc.Node" and o.get("_name") == SRC_ROOT_NAME)

    out = [{"__type__": "cc.Prefab", "_name": "", "_objFlags": 0, "_native": "",
            "data": {"__id__": 1}, "optimizationPolicy": 0,
            "asyncLoadAssets": False, "readonly": False}, None]
    seed = [2000]

    def add(obj):
        out.append(obj)
        return len(out) - 1

    def new_file_id():
        seed[0] += 1
        return file_id(seed[0])

    # 根节点 panelClubPlayerInfo（全屏），占 index 1
    root = 1
    out[1] = {
        "__type__": "cc.Node", "_name": "panelClubPlayerInfo", "_objFlags": 0,
        "_parent": None, "_children": [], "_active": True, "_components": [], "_prefab": None,
        "_opacity": 255, "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_contentSize": {"__type__": "cc.Size", "width": 750, "height": 1334},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                 "array": [375, 667, 0, 0, 0, 0, 1, 1, 1, 1]},
        "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_skewX": 0, "_skewY": 0, "_is3DNode": False, "_groupIndex": 0, "groupIndex": 0, "_id": "",
    }

    def attach_prefab(nid):
        pid = add({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                   "asset": {"__id__": 0}, "fileId": new_file_id(), "sync": False})
        out[nid]["_prefab"] = {"__id__": pid}

    attach_prefab(root)

    def comp(nid, obj):
        cid = add(obj)
        out[nid]["_components"].append({"__id__": cid})
        return cid

    comp(root, {"__type__": "cc.Widget", "_name": "", "_objFlags": 0, "node": {"__id__": root},
                "_enabled": True, "alignMode": 1, "_target": None, "_alignFlags": 45,
                "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
                "_verticalCenter": 0, "_horizontalCenter": 0,
                "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True, "_isAbsBottom": True,
                "_isAbsHorizontalCenter": True, "_isAbsVerticalCenter": True,
                "_originalWidth": 750, "_originalHeight": 1334, "_id": ""})
    comp(root, {"__type__": "cc.BlockInputEvents", "_name": "", "_objFlags": 0,
                "node": {"__id__": root}, "_enabled": True, "_id": ""})
    comp(root, {"__type__": compressed_uuid(SCRIPT_UUID), "_name": "", "_objFlags": 0,
                "node": {"__id__": root}, "_enabled": True, "_id": ""})

    mapping = {}   # 源节点索引 -> 新节点索引
    comp_map = {}  # 源组件索引 -> 新组件索引

    def clone(idx, parent_id):
        n = src[idx]
        if n.get("_name") in DROP_NAMES:
            return None
        nid = add(None)
        mapping[idx] = nid
        obj = copy.deepcopy(n)
        obj["_parent"] = {"__id__": parent_id}
        obj["_prefab"] = None
        out[nid] = obj
        # 组件
        new_comps = []
        for c in n.get("_components") or []:
            cobj = copy.deepcopy(src[c["__id__"]])
            cobj["node"] = {"__id__": nid}
            # 指向外部的引用一律清空（Widget 目标、ScrollView content 在子树内则保留）
            for k in ("_target", "_N$target"):
                if isinstance(cobj.get(k), dict) and "__uuid__" not in cobj[k]:
                    cobj[k] = None
            ccid = add(cobj)
            comp_map[c["__id__"]] = ccid
            new_comps.append({"__id__": ccid})
        obj["_components"] = new_comps
        # 子节点
        kids = []
        for ch in n.get("_children") or []:
            r = clone(ch["__id__"], nid)
            if r is not None:
                kids.append({"__id__": r})
        obj["_children"] = kids
        attach_prefab(nid)
        return nid

    # 保留原根这一层：ClubManagementView 里按名字 at("俱乐部玩家设置弹窗") 找它。
    top = clone(src_root, root)
    out[root]["_children"] = [{"__id__": top}]

    # 修正子树内的 __id__ 引用（ScrollView.content 等指向未克隆对象）
    valid = set(range(len(out)))
    def fix(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == "__id__":
                    if v not in mapping.values() and v != root and v != 0 and v != 1:
                        # 指向源文件里的对象：尝试按映射替换，否则置空
                        o[k] = None
                else:
                    fix(v)
        elif isinstance(o, list):
            for x in o:
                fix(x)

    # 先做映射替换：组件里 content 可能指向源索引
    def remap(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == "__id__":
                    if isinstance(v, int):
                        if v in mapping:
                            o[k] = mapping[v]
                        elif v in comp_map:
                            o[k] = comp_map[v]
                else:
                    remap(v)
        elif isinstance(o, list):
            for x in o:
                remap(x)
    for i in range(2, len(out)):
        remap(out[i])

    # ScrollView 的 content 必须指向子树里的 content 节点
    for o in out:
        if isinstance(o, dict) and o.get("__type__") == "cc.ScrollView":
            c = o.get("_N$content")
            if isinstance(c, dict) and c.get("__id__") is None:
                o["_N$content"] = None
                o["content"] = None

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if not os.path.exists(OUT_META):
        json.dump({"ver": "1.0.7", "uuid": str(uuid.uuid4()), "importer": "prefab",
                   "optimizationPolicy": 0, "asyncLoadAssets": False, "readonly": False,
                   "subMetas": {}}, open(OUT_META, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
    nodes = sum(1 for o in out if isinstance(o, dict) and o.get("__type__") == "cc.Node")
    print("生成:", OUT, "对象数:", len(out), "节点数:", nodes)


if __name__ == "__main__":
    main()
