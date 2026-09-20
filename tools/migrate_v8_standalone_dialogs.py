#!/usr/bin/env python3
"""Serialize the V8 standalone in-game dialog skin into the five live Prefabs.

This is deliberately an editor-time migration: request state, button events,
toggle state, list templates and message layout remain owned by their existing
TypeScript components.
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "V7"
GOLD = {"__type__": "cc.Color", "r": 255, "g": 239, "b": 208, "a": 255}
SUB = {"__type__": "cc.Color", "r": 218, "g": 230, "b": 239, "a": 255}
NAVY = {"__type__": "cc.Color", "r": 5, "g": 45, "b": 76, "a": 255}


def frame(name):
    meta = json.loads((ASSETS / f"{name}.png.meta").read_text())
    return meta["subMetas"][name]["uuid"]


FRAMES = {name: frame(name) for name in [
    "agent_v8_popup", "agent_v8_button_base", "player_info_v8_close",
    "player_info_v8_toggle_on", "player_info_v8_toggle_off",
    "player_info_v8_stats", "ingame_dialog_v8_gold_button",
    "ingame_dialog_v8_header",
]}


class Prefab:
    def __init__(self, relative):
        self.path = ROOT / relative
        self.data = json.loads(self.path.read_text())
        self.root = next(i for i, o in enumerate(self.data)
                         if o.get("__type__") == "cc.Node" and o.get("_parent") is None)

    def node(self, path):
        cur = self.root
        for part in [p for p in path.split("/") if p]:
            cur = next(r["__id__"] for r in self.data[cur].get("_children", [])
                       if self.data[r["__id__"]].get("_name") == part)
        return cur

    def component(self, node, typ):
        for ref in self.data[node].get("_components", []):
            comp = self.data[ref["__id__"]]
            if comp.get("__type__") == typ:
                return ref["__id__"], comp
        return None, None

    def remove_component(self, node, typ):
        """Detach a stale renderer while retaining its serialized object ID."""
        self.data[node]["_components"] = [
            ref for ref in self.data[node].get("_components", [])
            if self.data[ref["__id__"]].get("__type__") != typ
        ]

    def pos(self, node, x=None, y=None, w=None, h=None, keep_widget=False):
        obj = self.data[node]
        trs = obj["_trs"]["array"]
        if x is not None: trs[0] = x
        if y is not None: trs[1] = y
        if w is not None: obj["_contentSize"]["width"] = w
        if h is not None: obj["_contentSize"]["height"] = h
        # Fixed dialog art must not be re-stretched by an inherited Widget at
        # runtime. Full-screen overlays and Talk's bottom sheet opt out.
        if not keep_widget:
            _, widget = self.component(node, "cc.Widget")
            if widget is not None:
                widget["_enabled"] = False

    def sprite(self, node, asset, sliced=False):
        _, comp = self.component(node, "cc.Sprite")
        if comp is None:
            source = next(o for o in self.data if o.get("__type__") == "cc.Sprite")
            comp = copy.deepcopy(source)
            comp.update(node={"__id__": node}, _id="", _enabled=True)
            cid = len(self.data); self.data.append(comp)
            self.data[node]["_components"].insert(0, {"__id__": cid})
        comp.update(_enabled=True, _spriteFrame={"__uuid__": FRAMES[asset]},
                    _type=1 if sliced else 0, _sizeMode=0, _isTrimmedMode=False)
        # Reused nodes carried old state tints (notably the invitation's green
        # primary action); V8 source art is authored at its intended color.
        self.data[node]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
        self.data[node]["_trs"]["array"][7:10] = [1, 1, 1]

    def label(self, node, text=None, size=30, bold=False, color=GOLD):
        _, comp = self.component(node, "cc.Label")
        if comp is None:
            source = next((o for o in self.data if o.get("__type__") == "cc.Label"), None)
            if source is None:
                comp = {"__type__": "cc.Label", "_name": "", "_objFlags": 0,
                        "node": {"__id__": node}, "_enabled": True, "_id": "",
                        "_useOriginalSize": False, "_actualFontSize": size,
                        "_fontSize": size, "_lineHeight": size + 6,
                        "_enableWrapText": False, "_isSystemFontUsed": True,
                        "_fontFamily": "Arial", "_string": "", "_N$string": "",
                        "_styleFlags": 0, "_overflow": 1, "_N$overflow": 1,
                        "_N$horizontalAlign": 1, "_N$verticalAlign": 1}
            else:
                comp = copy.deepcopy(source)
                comp.update(node={"__id__": node}, _id="", _enabled=True)
            cid = len(self.data); self.data.append(comp)
            self.data[node]["_components"].append({"__id__": cid})
        comp.update(_enabled=True, _fontSize=size, _lineHeight=size + 6,
                    _styleFlags=1 if bold else 0, _overflow=1,
                    **{"_N$overflow": 1, "_N$horizontalAlign": 1, "_N$verticalAlign": 1})
        if text is not None:
            comp["_string"] = comp["_N$string"] = text
        self.data[node]["_color"] = copy.deepcopy(color)

    def add_node(self, parent, name, x=0, y=0, w=100, h=100):
        parent_id = self.node(parent)
        existing = next((r["__id__"] for r in self.data[parent_id].get("_children", [])
                         if self.data[r["__id__"]].get("_name") == name), None)
        if existing is not None:
            return existing
        nid = len(self.data)
        node = {"__type__": "cc.Node", "_name": name, "_objFlags": 0,
                "_parent": {"__id__": parent_id}, "_children": [], "_active": True,
                "_components": [], "_prefab": {"__id__": nid + 1}, "_opacity": 255,
                "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
                "_contentSize": {"__type__": "cc.Size", "width": w, "height": h},
                "_anchorPoint": {"__type__": "cc.Vec2", "x": .5, "y": .5},
                "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                         "array": [x, y, 0, 0, 0, 0, 1, 1, 1, 1]}, "_id": ""}
        root_info = next(o for o in self.data if o.get("__type__") == "cc.PrefabInfo")
        token = uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-dialog/" + str(self.path) + "/" + parent + "/" + name)
        info = copy.deepcopy(root_info)
        info.update(fileId=token.hex[:2] + token.hex[2:])
        self.data.extend([node, info])
        self.data[parent_id]["_children"].append({"__id__": nid})
        return nid

    def put_title(self, parent, node, text, x, y, w=330):
        plate = self.add_node(parent, node + "牌", x, y, w, 66)
        self.sprite(plate, "ingame_dialog_v8_header", True)
        title = self.add_node(parent + "/" + node + "牌", "文字", 0, 0, w - 20, 52)
        self.label(title, text, 36, True)
        # Place the new plate behind all existing business labels in the card.
        pid = self.node(parent); refs = self.data[pid]["_children"]
        refs[:] = [{"__id__": plate}] + [r for r in refs if r["__id__"] != plate]

    def button_text(self, parent, text, size=30, color=NAVY):
        label = self.add_node(parent, "V8文字", 0, 0, self.data[self.node(parent)]["_contentSize"]["width"] - 12,
                              self.data[self.node(parent)]["_contentSize"]["height"] - 8)
        self.label(label, text, size, True, color)

    def subtree_nodes(self, root):
        node = self.node(root)
        result = [node]
        for ref in self.data[node].get("_children", []):
            child = ref["__id__"]
            result.extend(self.subtree_nodes_by_id(child))
        return result

    def subtree_nodes_by_id(self, node):
        result = [node]
        for ref in self.data[node].get("_children", []):
            result.extend(self.subtree_nodes_by_id(ref["__id__"]))
        return result

    def clear_label_effects(self, root, size=28):
        for node in self.subtree_nodes(root):
            _, label = self.component(node, "cc.Label")
            if label is not None:
                label.update(_enabled=True, _fontSize=size, _lineHeight=size + 6,
                             _styleFlags=1, **{"_N$horizontalAlign": 1, "_N$verticalAlign": 1})
                self.data[node]["_color"] = copy.deepcopy(GOLD)
            for ref in self.data[node].get("_components", []):
                effect = self.data[ref["__id__"]]
                if effect.get("__type__") in ("cc.LabelOutline", "cc.LabelShadow"):
                    effect["_enabled"] = False

    def title_on_existing_sprite(self, path, text):
        node = self.node(path)
        self.pos(node, 0, self.data[node]["_trs"]["array"][1], 320, 52)
        self.sprite(node, "ingame_dialog_v8_header", True)
        label = self.add_node(path, "V8文字", 0, 0, 300, 46)
        self.label(label, text, 28, True)

    def replace_embedded_headers(self, parent, node_names, texts, y):
        """Replace old heading glyph Sprites while retaining their node paths."""
        parent_id = self.node(parent)
        headings = [r["__id__"] for r in self.data[parent_id].get("_children", [])
                    if self.data[r["__id__"]].get("_name") in node_names and
                    abs(self.data[r["__id__"]]["_trs"]["array"][1] - y) < 1]
        assert len(headings) == len(texts), (parent, node_names, headings)
        for node, text, x in zip(headings, texts, [-250, -50, 150]):
            _, sprite = self.component(node, "cc.Sprite")
            if sprite is not None:
                sprite["_enabled"] = False
                sprite["_spriteFrame"] = None
                self.remove_component(node, "cc.Sprite")
            self.pos(node, x, y, 100, 34)
            self.label(node, text, 25, False)
            _, label = self.component(node, "cc.Label")
            label.update(**{"_N$horizontalAlign": 0, "_N$verticalAlign": 1})

    def set_dynamic_columns(self, parent, names, y):
        for name, x in zip(names, [-150, 50, 250]):
            node = self.node(parent + "/" + name)
            self.pos(node, x, y, 70, 34)
            self.label(node, size=27, color=GOLD)
            _, label = self.component(node, "cc.Label")
            label.update(_styleFlags=0, **{"_N$horizontalAlign": 0, "_N$verticalAlign": 1})
            for ref in self.data[node].get("_components", []):
                effect = self.data[ref["__id__"]]
                if effect.get("__type__") in ("cc.LabelOutline", "cc.LabelShadow"):
                    effect["_enabled"] = False

    def style_all_labels(self):
        for index, obj in enumerate(self.data):
            if obj.get("__type__") != "cc.Node": continue
            _, label = self.component(index, "cc.Label")
            if label is not None:
                label["_enabled"] = True
                obj["_color"] = copy.deepcopy(GOLD)

    def save(self):
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n")


def queue():
    p = Prefab("assets/resources/UI/panelQueueMatch.prefab")
    panel = p.node("排队面板"); p.pos(panel, 0, 0, 650, 1100); p.sprite(panel, "agent_v8_popup", True)
    p.put_title("排队面板", "V8标题", "排队匹配", 0, 495, 330)
    p.data[p.node("排队面板/标题")]["_active"] = False
    p.pos(p.node("排队面板/排队状态"), y=412, w=560, h=52); p.label(p.node("排队面板/排队状态"), size=28)
    p.sprite(p.node("排队面板/排队人员列表/列表视口/列表内容/玩家行模板/卡片背景"), "player_info_v8_stats", True)
    p.sprite(p.node("排队面板/申请或取消排队"), "ingame_dialog_v8_gold_button", True)
    p.pos(p.node("排队面板/申请或取消排队"), y=-380, w=320, h=72)
    p.label(p.node("排队面板/申请或取消排队/文字"), size=31, bold=True)
    close = p.node("排队面板/关闭排队"); p.pos(close, 267, 495, 52, 52); p.sprite(close, "player_info_v8_close")
    p.style_all_labels()
    p.data[p.node("排队面板/申请或取消排队/文字")]["_color"] = copy.deepcopy(NAVY)
    p.save()


def message():
    p = Prefab("assets/resources/UI/panelMsgView.prefab")
    card = p.node("bk"); p.pos(card, 0, 13, 600, 470); p.sprite(card, "agent_v8_popup", True)
    p.put_title("bk", "V8标题", "温馨提示", 0, 215, 330)
    p.pos(p.node("bk/msg"), 0, 35, 500, 140); p.label(p.node("bk/msg"), size=30)
    confirm = p.node("bk/确定"); p.pos(confirm, 0, -94, 220, 70); p.sprite(confirm, "ingame_dialog_v8_gold_button", True)
    cancel = p.node("bk/取消"); p.pos(cancel, -135, -112, 220, 70); p.sprite(cancel, "agent_v8_button_base", True)
    p.button_text("bk/确定", "确定", 31)
    p.button_text("bk/取消", "取消", 31)
    # Kept for script compatibility but no longer supplies visible V7 art.
    old = p.node("bk/V7双按钮底"); p.data[old]["_active"] = False
    _, old_sprite = p.component(old, "cc.Sprite")
    if old_sprite is not None: old_sprite["_enabled"] = False; old_sprite["_spriteFrame"] = None
    p.style_all_labels()
    p.data[p.node("bk/确定/V8文字")]["_color"] = copy.deepcopy(NAVY)
    p.save()


def invite():
    p = Prefab("assets/resources/UI/panelRoomInvite.prefab")
    card = p.node("卡片"); p.pos(card, 0, 8, 650, 650); p.sprite(card, "agent_v8_popup", True)
    p.put_title("卡片", "V8标题", "房间邀请", 0, 250, 330)
    p.data[p.node("卡片/标题")]["_active"] = False
    p.label(p.node("卡片/副标题"), "好友正在等你入座", 26, False, SUB)
    p.sprite(p.node("卡片/房间信息"), "player_info_v8_stats", True)
    # 邀请文案是动态 Label；底框必须放到独立子节点，避免 Cocos 2.4
    # 在同一节点上因禁用 Sprite 而漏绘 Label。
    # player_info_v8_stats has 32px top/bottom borders, so keep this no
    # smaller than 64px or nine-slice geometry folds over itself.
    text_base = p.add_node("卡片", "V8邀请文案底", 0, -72, 560, 64)
    p.pos(text_base, 0, -72, 560, 64)
    p.sprite(text_base, "player_info_v8_stats", True)
    invite_text = p.node("卡片/邀请文案")
    p.remove_component(invite_text, "cc.Sprite")
    # A previous migration version used a child under the Label and therefore
    # painted the base after the text. Keep its object but hide it.
    try: p.data[p.node("卡片/邀请文案/V8底框")]["_active"] = False
    except StopIteration: pass
    card_refs = p.data[p.node("卡片")]["_children"]
    invite_ref = p.node("卡片/邀请文案")
    card_refs[:] = ([{"__id__": text_base}] +
                    [ref for ref in card_refs if ref["__id__"] not in (text_base, invite_ref)] +
                    [{"__id__": invite_ref}])
    p.sprite(p.node("卡片/忽略"), "agent_v8_button_base", True)
    forward = p.node("卡片/前往"); p.sprite(forward, "ingame_dialog_v8_gold_button", True)
    p.data[forward]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    for path in ["卡片/忽略/文字", "卡片/前往/文字"]: p.label(p.node(path), size=31, bold=True)
    for path, asset in [("卡片/本次登录不再弹出/Background", "player_info_v8_toggle_off"),
                        ("卡片/本次登录不再弹出/checkmark", "player_info_v8_toggle_on")]:
        node = p.node(path); p.pos(node, -140, 0, 51, 34); p.sprite(node, asset)
    p.style_all_labels()
    p.data[p.node("卡片/前往/文字")]["_color"] = copy.deepcopy(NAVY)
    p.save()


def vip():
    p = Prefab("assets/resources/UI/panelVipInfo.prefab")
    base = p.add_node("", "V8弹窗底", 0, 110, 660, 1000); p.sprite(base, "agent_v8_popup", True)
    refs = p.data[p.root]["_children"]; refs[:] = [{"__id__": base}] + [r for r in refs if r["__id__"] != base]
    title = p.node("title"); p.pos(title, 0, 530, 340, 66); p.sprite(title, "ingame_dialog_v8_header", True)
    title_text = p.add_node("title", "V8文字", 0, 0, 320, 52); p.label(title_text, "会员数据", 36, True)
    p.data[p.node("title/个人数据")]["_active"] = False
    p.pos(p.node("基础数据"), y=300, w=610, h=205); p.sprite(p.node("基础数据"), "player_info_v8_stats", True)
    p.pos(p.node("VIP数据"), y=75, w=610, h=220); p.sprite(p.node("VIP数据"), "player_info_v8_stats", True)
    p.title_on_existing_sprite("基础数据/个人基础数据", "个人基础数据")
    p.title_on_existing_sprite("VIP数据/img", "个人VIP数据")
    p.clear_label_effects("基础数据", 28)
    p.clear_label_effects("VIP数据", 28)
    p.replace_embedded_headers("基础数据", ["img"], ["总手数", "总胜率", "失败率"], 0)
    p.set_dynamic_columns("基础数据", ["总手数", "总胜率", "失败率"], 0)
    p.replace_embedded_headers("VIP数据", ["img"], ["胜利", "平局", "失败"], 24)
    p.set_dynamic_columns("VIP数据", ["胜利", "平局", "失败"], 24)
    p.replace_embedded_headers("VIP数据", ["img copy"], ["入池率", "翻牌率", "翻牌胜率"], -34)
    p.set_dynamic_columns("VIP数据", ["入池率", "翻牌率", "翻牌胜率"], -34)
    for name, x in [("VIP1", -210), ("VIP2", 0), ("VIP3", 210)]:
        n = p.node(name); p.pos(n, x, -170, 180, 72); p.sprite(n, "ingame_dialog_v8_gold_button", True)
    for name, text in [("VIP1", "月卡\n30金币"), ("VIP2", "半年卡\n120金币"), ("VIP3", "年卡\n180金币")]:
        p.button_text(name, text, 22)
    p.pos(p.node("info"), y=-300, w=600, h=34); p.label(p.node("info"), size=26, color=SUB)
    close = p.node("title/关闭/关闭"); p.pos(close, 0, 0, 52, 52); p.sprite(close, "player_info_v8_close")
    overlay = p.node("确认购买面板"); p.pos(overlay, 0, 0, 750, 1334, keep_widget=True)
    p.pos(p.node("确认购买面板/msk"), 0, 0, 750, 1334, keep_widget=True)
    buy = p.node("确认购买面板/bk"); p.pos(buy, 0, 0, 600, 470); p.sprite(buy, "agent_v8_popup", True)
    p.put_title("确认购买面板/bk", "V8标题", "确认购买", 0, 190, 330)
    p.sprite(p.node("确认购买面板/bk/确认购买VIP"), "ingame_dialog_v8_gold_button", True)
    p.sprite(p.node("确认购买面板/bk/关闭上上层"), "agent_v8_button_base", True)
    p.button_text("确认购买面板/bk/确认购买VIP", "确定", 30)
    p.button_text("确认购买面板/bk/关闭上上层", "取消", 30)
    p.style_all_labels()
    for name in ["VIP1", "VIP2", "VIP3"]:
        p.data[p.node(name + "/V8文字")]["_color"] = copy.deepcopy(NAVY)
    p.data[p.node("确认购买面板/bk/确认购买VIP/V8文字")]["_color"] = copy.deepcopy(NAVY)
    p.save()


def talk():
    p = Prefab("assets/resources/UI/panelTalk.prefab")
    bk = p.node("bk"); p.pos(bk, 0, -667, 700, 428, keep_widget=True); p.sprite(bk, "agent_v8_popup", True)
    title = p.node("bk/title"); p.pos(title, 0, 384, 330, 66); p.sprite(title, "ingame_dialog_v8_header", True)
    title_text = p.add_node("bk/title", "V8文字", 0, 0, 310, 52); p.label(title_text, "表情互动", 36, True)
    listing = p.node("bk/list"); p.pos(listing, 0, 187.507, 680, 320); p.sprite(listing, "player_info_v8_stats", True)
    for row, y in enumerate([87.5, -77.5]):
        for col, x in enumerate([-272, -136, 0, 136, 272]):
            button = p.node("bk/list/" + str(row * 5 + col + 1))
            p.pos(button, x, y, 126, 135)
            p.data[button]["_trs"]["array"][7:10] = [1, 1, 1]
    # Do not replace the ten recently refreshed emoji SpriteFrames.
    p.save()


if __name__ == "__main__":
    # User restored panelMsgView and selected its original style for dialogs.
    from apply_original_message_dialog_style import main as apply_messages
    from apply_original_large_dialog_style import main as apply_large_dialogs
    apply_messages()
    apply_large_dialogs()
