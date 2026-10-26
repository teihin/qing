#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「我的俱乐部」列表卡片的邀请码挪到原金币行（去掉俱乐部金币）。

只改 panelMain.prefab 里「俱乐部条目模板」这四个子节点：
  俱乐部名称  -> 加宽到 470、字号 38、整体左移对齐头像右侧
  邀请码图标  -> 换成票券独立图 club_ticket_v8，启用，挪到下半行左侧
  邀请码      -> 挪到下半行左侧、字号 31
  金币        -> 隐藏（节点保留，脚本仍在给它赋值，不需要改代码）
坐标均为相对卡片中心的游戏坐标；卡片为 700x231、anchor(0.5,1)。"""
import json, sys

PREFAB = "/Volumes/SSD/qing/assets/resources/UI/panelMain.prefab"
TICKET_UUID = "f99d5019-7578-48dd-852e-4b3e00ef8f6d"   # club_ticket_v8.png 的 sprite-frame uuid

# name -> (x, y, width, height, fontSize, active)
PLAN = {
    "俱乐部名称": (35.5, -75, 470, 50, 38, None),
    "邀请码图标": (-296, -175, 46, 46, None, True),
    "邀请码":     (-258, -175, 300, 44, 31, None),
    "金币":       (None, None, None, None, None, False),
}


def main():
    with open(PREFAB, encoding="utf-8") as f:
        d = json.load(f)

    tpl = next(i for i, o in enumerate(d)
               if o.get("__type__") == "cc.Node" and o.get("_name") == "俱乐部条目模板")

    touched = []
    for child in d[tpl]["_children"]:
        node = d[child["__id__"]]
        name = node.get("_name")
        if name not in PLAN:
            continue
        x, y, w, h, fs, active = PLAN[name]
        trs = node["_trs"]
        arr = trs["array"]
        if x is not None:
            arr[0], arr[1] = x, y
        if w is not None:
            node["_contentSize"]["width"] = w
            node["_contentSize"]["height"] = h
        if active is not None:
            node["_active"] = active
        for c in node["_components"]:
            comp = d[c["__id__"]]
            t = comp.get("__type__")
            if t == "cc.Label" and fs:
                comp["_fontSize"] = fs
            if t == "cc.Sprite" and name == "邀请码图标":
                comp["_spriteFrame"] = {"__uuid__": TICKET_UUID}
                comp["_sizeMode"] = 0
                comp["_isTrimmedMode"] = False
        touched.append(name)

    missing = set(PLAN) - set(touched)
    if missing:
        print("!! 未找到节点:", missing)
        sys.exit(1)

    with open(PREFAB, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print("patched:", touched)


if __name__ == "__main__":
    main()
