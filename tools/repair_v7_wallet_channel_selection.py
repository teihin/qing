#!/usr/bin/env python3
"""Patch only wallet channel art references; preserves all layout and bindings."""

import copy

from apply_v7_prefab_skin import Prefab, frame_uuid


OVERLAY = "wallet_channel_selected_overlay.png"
ICON_ASSETS = {
    "paymentAlipayIcon": "wallet_channel_alipay_exact.png",
    "paymentUnionPayIcon": "wallet_channel_bank_exact.png",
    "paymentWeChatIcon": "wallet_channel_wechat_exact.png",
    "paymentOtherIcon": "wallet_channel_other_exact.png",
}

CHANNEL_PATH = "钱包/容器/充值/根/通道视口/充值渠道"


def apply_channel_viewport(p: Prefab) -> int:
    parent = p.node("钱包/容器/充值/根")
    try:
        viewport = p.node("钱包/容器/充值/根/通道视口")
        content = p.node(CHANNEL_PATH)
    except KeyError:
        content = p.node("钱包/容器/充值/根/充值渠道")
        viewport = len(p.data)
        node = copy.deepcopy(p.data[content])
        node.update({"_name": "通道视口", "_children": [{"__id__": content}],
                     "_components": [], "_prefab": None})
        p.data.append(node)
        children = p.data[parent]["_children"]
        children[children.index({"__id__": content})] = {"__id__": viewport}
        p.data[content]["_parent"] = {"__id__": viewport}

    def component(kind, values):
        _, obj = p.component(viewport, kind)
        if obj is None:
            obj = {"__type__": kind, "_name": "", "_objFlags": 0,
                   "node": {"__id__": viewport}, "_enabled": True, "_id": ""}
            p.data[viewport]["_components"].append({"__id__": len(p.data)})
            p.data.append(obj)
        obj.update(values)

    # Match the accepted two visible rows, with native scrolling for extra rows.
    p.set_pos(viewport, 0, 291, 586, 318)
    p.data[viewport]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": .5, "y": .5}
    component("cc.Widget", {"alignMode": 1, "_target": None, "_alignFlags": 17,
              "_top": 118, "_horizontalCenter": 0, "_isAbsTop": True,
              "_isAbsHorizontalCenter": True, "_originalWidth": 586, "_originalHeight": 318})
    component("cc.Mask", {"_materials": [{"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}],
              "_spriteFrame": None, "_type": 0, "_segments": 64,
              "_N$alphaThreshold": 0, "_N$inverted": False})
    component("cc.ScrollView", {"horizontal": False, "vertical": True, "inertia": True,
              "brake": .6, "elastic": False, "bounceDuration": .23, "scrollEvents": [],
              "cancelInnerEvents": True, "_N$content": {"__id__": content},
              "content": {"__id__": content}})
    p.disable(content, "cc.Widget")
    p.set_pos(content, 0, 159, 586, 277)
    p.data[content]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": .5, "y": 1}
    _, layout = p.component(content, "cc.Layout")
    layout.update({"_enabled": True, "_resize": 1, "_N$layoutType": 3,
                   "_layoutSize": {"__type__": "cc.Size", "width": 586, "height": 277},
                   "_N$cellSize": {"__type__": "cc.Size", "width": 284, "height": 129},
                   "_N$paddingLeft": 0, "_N$paddingRight": 0, "_N$paddingTop": 0,
                   "_N$paddingBottom": 0, "_N$spacingX": 18, "_N$spacingY": 19,
                   "_N$startAxis": 0, "_N$horizontalDirection": 0,
                   "_N$verticalDirection": 1, "_N$affectedByScale": False})
    active = 0
    for ref in p.data[content]["_children"]:
        item = ref["__id__"]
        if p.data[item]["_active"]:
            p.set_pos(item, -151 + (active % 2) * 302, -64.5 - (active // 2) * 148)
            active += 1
    height = max(0, ((active + 1) // 2) * 148 - 19)
    p.data[content]["_contentSize"]["height"] = height
    layout["_layoutSize"]["height"] = height
    return content


def apply_channel_selection(p: Prefab) -> None:
    component = next(obj for obj in p.data if "paymentAlipayIcon" in obj)
    for field, asset in ICON_ASSETS.items():
        component[field] = {"__uuid__": frame_uuid(asset)}

    root = apply_channel_viewport(p)
    for ref in p.data[root]["_children"]:
        channel_id = ref["__id__"]
        _, toggle = p.component(channel_id, "cc.Toggle")
        if toggle is None:
            continue
        mark_sprite = p.data[toggle["checkMark"]["__id__"]]
        mark_id = mark_sprite["node"]["__id__"]
        p.sprite(mark_id, OVERLAY)
        # Creator 2.4.13 Toggle controls checkMark.node.active, not Sprite.enabled.
        mark_sprite["_enabled"] = True
        p.set_active(mark_id, bool(toggle["_N$isChecked"]))
        children = p.data[channel_id]["_children"]
        children[:] = [item for item in children if item["__id__"] != mark_id]
        children.append({"__id__": mark_id})


if __name__ == "__main__":
    prefab = Prefab("assets/resources/Prefabs/钱包.prefab")
    apply_channel_selection(prefab)
    prefab.save()
    print("Patched 9 wallet channel overlays and 4 V7 icon bindings.")
