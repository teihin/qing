#!/usr/bin/env python3
"""Migrate legacy in-room dialogs to the approved V8 blue/gold skin.

The migration is editor-time only.  It writes the same visual tree into the
formal panelGameView Prefab and drh8 Scene while retaining every business node,
Button, Toggle, Slider, EditBox, dynamic Label and custom component in place.
"""
from __future__ import annotations

import base64
import copy
import json
import uuid
from pathlib import Path

import apply_v7_prefab_skin as prefab_skin


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets/V7"
PAGES = (
    "assets/resources/UI/panelGameView.prefab",
    "assets/Scenes/drh8.fire",
)

# apply_v7_prefab_skin predates the move from resources/V7 to assets/V7.  Keep
# its mature Sprite serializer, but point it at the current formal asset home.
prefab_skin.ASSET_DIR = ASSET_DIR
Prefab = prefab_skin.Prefab

FONT = {"__uuid__": "fd7307b2-666e-4c26-963d-59f787cad6fb"}
MATERIAL = {"__uuid__": "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"}
DIM_FRAME = "a23235d1-15db-4b95-8439-a2e005bfff91"
GOLD = (255, 239, 205)
PALE = (222, 237, 244)
SUB = (151, 199, 224)
DARK = (5, 40, 64)
PANEL = "agent_v8_popup.png"
BLUE_BUTTON = "agent_v8_button_base.png"
GOLD_BUTTON = "ingame_dialog_v8_gold_button.png"
HEADER = "ingame_dialog_v8_header.png"
CLOSE = "player_info_v8_close.png"
TOGGLE_ON = "player_info_v8_toggle_on.png"
TOGGLE_OFF = "player_info_v8_toggle_off.png"


def load(relative: str) -> Prefab:
    p = Prefab.__new__(Prefab)
    p.path = ROOT / relative
    p.data = json.loads(p.path.read_text(encoding="utf-8"))
    p.root = next(
        i for i, obj in enumerate(p.data)
        if obj.get("__type__") == "cc.Node" and obj.get("_name") == "panelGameView"
    )
    return p


def reset_node(p: Prefab, node_id: int) -> None:
    node = p.data[node_id]
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    node["_trs"]["array"][3:7] = [0, 0, 0, 1]
    node["_trs"]["array"][7:10] = [1, 1, 1]
    node["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    node["_opacity"] = 255
    p.disable(node_id, "cc.Widget")


def place(p: Prefab, path: str, x: float, y: float, w: float, h: float,
          active: bool = True) -> int:
    node_id = p.node(path)
    reset_node(p, node_id)
    p.set_pos(node_id, x, y, w, h)
    p.set_active(node_id, active)
    return node_id


def fullscreen(p: Prefab, path: str, active: bool) -> int:
    """Keep overlay roots stretched on both 1334 and 1624-height screens."""
    node_id = place(p, path, 0, 0, 750, 1334, active)
    _, widget = p.component(node_id, "cc.Widget")
    if widget is None:
        widget = component_template(p, "cc.Widget")
        widget.update(node={"__id__": node_id}, _id="")
        widget_id = len(p.data)
        p.data.append(widget)
        p.data[node_id].setdefault("_components", []).append({"__id__": widget_id})
    widget.update(
        _enabled=True, alignMode=1, _alignFlags=45,
        _left=0, _right=0, _top=0, _bottom=0,
        _horizontalCenter=0, _verticalCenter=0,
        _isAbsLeft=True, _isAbsRight=True, _isAbsTop=True, _isAbsBottom=True,
        _originalWidth=750, _originalHeight=1334,
    )
    return node_id


def new_node(p: Prefab, parent_path: str, name: str) -> int:
    path = parent_path + "/" + name
    try:
        return p.node(path)
    except KeyError:
        pass
    parent_id = p.node(parent_path)
    root = p.data[p.root]
    node_id = len(p.data)
    info_id = node_id + 1
    node = copy.deepcopy(root)
    node.update(
        _name=name,
        _parent={"__id__": parent_id},
        _children=[],
        _components=[],
        _active=True,
        _prefab={"__id__": info_id},
        _id="",
    )
    node["_contentSize"] = {"__type__": "cc.Size", "width": 100, "height": 100}
    node["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    node["_trs"]["array"] = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
    # The Prefab uses asset.__id__:0; the Scene instance uses the formal Prefab
    # UUID.  Cloning the actual root PrefabInfo preserves that distinction.
    info = copy.deepcopy(p.data[root["_prefab"]["__id__"]])
    identity = uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8-ingame-dialog/" + str(p.path) + "/" + path)
    info.update(
        root={"__id__": p.root},
        fileId=identity.hex[:2] + base64.b64encode(identity.bytes[1:]).decode("ascii"),
        sync=False,
    )
    p.data.extend((node, info))
    p.data[parent_id].setdefault("_children", []).append({"__id__": node_id})
    return node_id


def component_template(p: Prefab, type_name: str) -> dict:
    return copy.deepcopy(next(obj for obj in p.data if obj.get("__type__") == type_name))


def ensure_label(p: Prefab, node_id: int) -> dict:
    _, label = p.component(node_id, "cc.Label")
    if label is not None:
        return label
    label = component_template(p, "cc.Label")
    label.update(node={"__id__": node_id}, _enabled=True, _id="")
    label_id = len(p.data)
    p.data.append(label)
    p.data[node_id].setdefault("_components", []).append({"__id__": label_id})
    return label


def detach_component(p: Prefab, node_id: int, type_name: str) -> None:
    """Detach a superseded component without deleting its serialized object.

    Cocos Creator 2.4 only allows one RenderComponent per node.  Merely setting
    the old renderer to disabled still makes it win node._renderComponent after
    deserialization, so converted Sprite/Label nodes must remove the old
    component reference from node._components.
    """
    refs = p.data[node_id].get("_components", [])
    kept = []
    for ref in refs:
        component = p.data[ref["__id__"]]
        if component.get("__type__") == type_name:
            component["_enabled"] = False
            continue
        kept.append(ref)
    refs[:] = kept


def style_label(p: Prefab, path: str, text: str | None = None, *,
                x: float | None = None, y: float | None = None,
                w: float | None = None, h: float | None = None,
                size: int = 28, color: tuple[int, int, int] | None = PALE,
                align: int = 1, bold: bool = False, wrap: bool = False,
                active: bool | None = None, disable_sprite: bool = False) -> int:
    node_id = p.node(path)
    node = p.data[node_id]
    old_active = node["_active"]
    px, py = node["_trs"]["array"][0:2]
    width, height = node["_contentSize"]["width"], node["_contentSize"]["height"]
    place(p, path, px if x is None else x, py if y is None else y,
          width if w is None else w, height if h is None else h,
          old_active if active is None else active)
    label = ensure_label(p, node_id)
    if text is not None:
        label["_string"] = label["_N$string"] = text
    label.update(
        _enabled=True,
        _fontSize=size,
        _lineHeight=size + (7 if wrap else 4),
        _enableWrapText=wrap,
        _isSystemFontUsed=False,
        _styleFlags=1 if bold else 0,
        _spacingX=0,
        _overflow=2,
        **{
            "_N$overflow": 2,
            "_N$file": copy.deepcopy(FONT),
            "_N$horizontalAlign": align,
            "_N$verticalAlign": 1,
        },
    )
    if color is not None:
        node["_color"] = {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255}
    p.disable(node_id, "cc.LabelOutline")
    p.disable(node_id, "cc.LabelShadow")
    if disable_sprite:
        detach_component(p, node_id, "cc.Sprite")
    return node_id


def art(p: Prefab, path: str, asset: str, x: float, y: float,
        w: float, h: float, sliced: bool = False, active: bool = True) -> int:
    node_id = place(p, path, x, y, w, h, active)
    p.sprite(node_id, asset, sliced=sliced)
    return node_id


def add_art(p: Prefab, parent_path: str, name: str, asset: str,
            x: float, y: float, w: float, h: float,
            sliced: bool = False) -> int:
    new_node(p, parent_path, name)
    return art(p, parent_path + "/" + name, asset, x, y, w, h, sliced)


def add_label(p: Prefab, parent_path: str, name: str, text: str, *,
              x: float = 0, y: float = 0, w: float = 180, h: float = 48,
              size: int = 28, color: tuple[int, int, int] = GOLD,
              bold: bool = False, align: int = 1) -> int:
    new_node(p, parent_path, name)
    return style_label(p, parent_path + "/" + name, text, x=x, y=y, w=w, h=h,
                       size=size, color=color, bold=bold, align=align, active=True)


def move_first(p: Prefab, parent_path: str, node_id: int) -> None:
    children = p.data[p.node(parent_path)]["_children"]
    children[:] = [{"__id__": node_id}] + [ref for ref in children if ref["__id__"] != node_id]


def set_sprite_frame(p: Prefab, node_id: int, frame_uuid: str, sliced: bool = False) -> None:
    _, sprite = p.ensure_sprite(node_id)
    sprite.update(
        _enabled=True,
        _spriteFrame={"__uuid__": frame_uuid},
        _type=1 if sliced else 0,
        _sizeMode=0,
        _isTrimmedMode=False,
        _materials=[copy.deepcopy(MATERIAL)],
    )


def add_dim(p: Prefab, root_path: str) -> int:
    node_id = new_node(p, root_path, "V8遮罩")
    place(p, root_path + "/V8遮罩", 0, 0, 750, 1800)
    set_sprite_frame(p, node_id, DIM_FRAME)
    p.data[node_id]["_opacity"] = 190
    p.data[node_id]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 10, "b": 22, "a": 255}
    move_first(p, root_path, node_id)
    return node_id


def header(p: Prefab, path: str, title: str, x: float, y: float,
           w: float = 340, h: float = 74) -> None:
    art(p, path, HEADER, x, y, w, h, sliced=True)
    detach_component(p, p.node(path), "cc.Label")
    add_label(p, path, "V8文字", title, w=w - 24, h=h - 8, size=36, bold=True)


def button(p: Prefab, path: str, title: str, x: float, y: float,
           w: float = 220, h: float = 72, primary: bool = False) -> None:
    art(p, path, GOLD_BUTTON if primary else BLUE_BUTTON, x, y, w, h, sliced=True)
    _, comp = p.component(p.node(path), "cc.Button")
    if comp is not None:
        # Keep the original click target/events and retain a tactile scale press.
        comp["_N$interactable"] = True
        comp["_N$transition"] = comp["transition"] = 3
        comp["zoomScale"] = 0.94
    add_label(p, path, "V8文字", title, w=w - 18, h=h - 8, size=30,
              color=DARK if primary else GOLD, bold=True)


def close_art(p: Prefab, path: str, x: float, y: float,
              size: float = 60, sprite_child: str | None = None) -> None:
    target = path + "/" + sprite_child if sprite_child else path
    place(p, path, x, y, max(size, 72), max(size, 72))
    art(p, target, CLOSE, 0 if sprite_child else x, 0 if sprite_child else y,
        size, size)
    _, comp = p.component(p.node(path), "cc.Button")
    if comp is not None:
        comp["_N$transition"] = comp["transition"] = 3
        comp["zoomScale"] = 0.92


def simple_dialog(p: Prefab, root: str, title: str,
                  actions: tuple[tuple[str, str, bool], ...], *,
                  panel_height: int = 420) -> None:
    root_id = p.node(root)
    root_active = p.data[root_id]["_active"]
    fullscreen(p, root, root_active)
    add_dim(p, root)
    if root == "举报扣费提示":
        # Superseded full-screen legacy dimmer; retaining it active would draw
        # another old material between the V8 dimmer and the new panel.
        p.set_active(p.node(root + "/bk copy"), False)
    centre_y = -55
    art(p, root + "/bk", PANEL, 0, centre_y, 620, panel_height, sliced=True)
    header_path = root + "/V8标题"
    new_node(p, root, "V8标题")
    header(p, header_path, title, 0, centre_y + panel_height / 2 - 5)
    msg_path = root + "/msg"
    if root == "芒果提示":
        style_label(p, msg_path, x=0, y=-27, w=540, h=150, size=29,
                    color=PALE, bold=False, wrap=True)
        # Context is controlled by business code and intentionally starts hidden.
        style_label(p, root + "/name", x=0, y=-92, w=520, h=44, size=24,
                    color=SUB, wrap=False, active=False)
    else:
        style_label(p, msg_path, x=0, y=-35, w=540, h=165, size=29,
                    color=PALE, bold=False, wrap=True)
    if len(actions) == 1:
        positions = (0,)
    else:
        positions = (-135, 135)
    for x, (name, label_text, primary) in zip(positions, actions):
        button(p, root + "/" + name, label_text, x, centre_y - panel_height / 2 + 70,
               primary=primary)
    p.set_active(root_id, root_active)


def switch(p: Prefab, path: str) -> None:
    node_id = place(p, path, p.data[p.node(path)]["_trs"]["array"][0],
                    p.data[p.node(path)]["_trs"]["array"][1], 116, 62)
    for child, asset in (("Background", TOGGLE_OFF), ("checkmark", TOGGLE_ON)):
        child_id = p.node(path + "/" + child)
        was_active = p.data[child_id]["_active"]
        art(p, path + "/" + child, asset, 0, 0, 84, 56, active=was_active)
    _, toggle = p.component(node_id, "cc.Toggle")
    if toggle is not None:
        toggle["_N$transition"] = toggle["transition"] = 0


def settings_dialog(p: Prefab) -> None:
    root = "系统设置"
    root_id = p.node(root)
    active = p.data[root_id]["_active"]
    fullscreen(p, root, active)
    mask = p.node(root + "/mask")
    place(p, root + "/mask", 0, 0, 750, 1800)
    set_sprite_frame(p, mask, DIM_FRAME)
    p.data[mask]["_opacity"] = 190
    p.data[mask]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 10, "b": 22, "a": 255}

    art(p, root + "/bk", PANEL, 0, -15, 650, 900, sliced=True)
    header(p, root + "/bk/牌局设置", "牌局设置", 0, 410, 350, 76)
    close_art(p, root + "/关闭上层", 280, 395, 60, "btn_4")

    group = root + "/设置"
    place(p, group, 0, -65, 610, 715)
    p.disable(p.node(group), "cc.Layout")

    desktop = group + "/桌面"
    place(p, desktop, 0, 220, 610, 260)
    style_label(p, desktop + "/选择桌面", "选择桌面", x=0, y=105, w=240, h=50,
                size=31, color=GOLD, bold=True, disable_sprite=True)
    for index, x in enumerate((-200, -100, 0, 100, 200), 1):
        place(p, desktop + f"/桌面{index}", x, -20, 104, 184)

    backs = group + "/牌背"
    place(p, backs, 0, -30, 610, 220)
    style_label(p, backs + "/选择牌面", "选择牌背", x=0, y=78, w=240, h=50,
                size=31, color=GOLD, bold=True, disable_sprite=True)
    for name, x in (("牌背0", -155), ("牌背1", 0), ("牌背2", 155)):
        place(p, backs + "/" + name, x, -42, 118, 158)

    sound = group + "/声音"
    place(p, sound, 0, -225, 610, 100)
    for branch, title, x in (("音效", "游戏音效", -150), ("语音", "语音聊天", 150)):
        path = sound + "/" + branch
        place(p, path, x, 0, 270, 88)
        title_node = "游戏音效" if branch == "音效" else "语音聊天"
        style_label(p, path + "/" + title_node, title, x=-55, y=0, w=150, h=42,
                    size=27, color=PALE, bold=True, disable_sprite=True)
        sw = path + "/" + branch + "开关"
        place(p, sw, 75, 0, 116, 62)
        switch(p, sw)

    spot = group + "/聚光灯"
    place(p, spot, 0, -330, 610, 90)
    style_label(p, spot + "/标题", "下注聚光灯", x=-178, y=16, w=220, h=40,
                size=28, color=PALE, bold=True)
    style_label(p, spot + "/说明", "聚焦当前操作位置", x=-178, y=-22, w=260, h=32,
                size=22, color=SUB)
    place(p, spot + "/聚光灯开关", 220, 0, 116, 62)
    switch(p, spot + "/聚光灯开关")
    p.set_active(root_id, active)


def queue_dialog(p: Prefab) -> None:
    root = "排队弹窗"
    root_id = p.node(root)
    active = p.data[root_id]["_active"]
    fullscreen(p, root, active)
    mask = p.node(root + "/遮罩")
    place(p, root + "/遮罩", 0, 0, 750, 1800)
    set_sprite_frame(p, mask, DIM_FRAME)
    p.data[mask]["_opacity"] = 190
    p.data[mask]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 10, "b": 22, "a": 255}

    panel = root + "/排队面板"
    art(p, panel, PANEL, 0, 0, 650, 1100, sliced=True)
    header(p, panel + "/标题", "排队", 0, 500, 340, 74)
    style_label(p, panel + "/排队状态", x=0, y=412, w=560, h=50,
                size=29, color=PALE, bold=True)

    heading = panel + "/人员标题"
    art(p, heading, BLUE_BUTTON, 0, 350, 590, 58, sliced=True)
    for name, color in (("玩家信息", GOLD), ("已排队时长", GOLD),
                        ("底皮", GOLD), ("状态", GOLD)):
        style_label(p, heading + "/" + name, size=23, color=color, bold=True)
    for name in ("分隔线-18", "分隔线112", "分隔线205"):
        style_label(p, heading + "/" + name, "|", size=22, color=SUB)

    list_root = panel + "/排队人员列表"
    place(p, list_root, 0, 4, 590, 626)
    place(p, list_root + "/列表视口", 0, 0, 590, 626)
    style_label(p, list_root + "/列表视口/列表内容/空状态",
                x=0, y=-313, w=560, h=80, size=27, color=SUB)
    row = list_root + "/列表视口/列表内容/玩家行模板"
    row_active = p.data[p.node(row)]["_active"]
    place(p, row, 0, 0, 580, 106, row_active)
    art(p, row + "/卡片背景", BLUE_BUTTON, 0, 0, 580, 98, sliced=True)
    for name in ("序号", "排队时长", "底皮"):
        style_label(p, row + "/" + name, size=23, color=PALE)
    for name in ("昵称", "玩家ID"):
        style_label(p, row + "/玩家信息/" + name,
                    size=22 if name == "昵称" else 18,
                    color=PALE if name == "昵称" else SUB,
                    align=0)
    # 状态/在线状态 carry semantic runtime colors, so only typography changes.
    for name in ("状态", "在线状态"):
        style_label(p, row + "/" + name, size=21, color=None)
    p.set_active(p.node(row), row_active)

    button(p, panel + "/申请或取消排队", "", 0, -392, 330, 76, primary=True)
    # The live label switches between 申请排队/取消排队; keep its serialized value.
    p.set_active(p.node(panel + "/申请或取消排队/V8文字"), False)
    style_label(p, panel + "/申请或取消排队/文字", x=0, y=1, w=300, h=60,
                size=30, color=DARK, bold=True)
    close_art(p, panel + "/关闭排队", 276, 505, 58)
    try:
        p.set_active(p.node(panel + "/关闭排队/文字"), False)
    except KeyError:
        pass
    style_label(p, panel + "/温馨提示", x=0, y=-480, w=570, h=64,
                size=22, color=SUB, wrap=True)
    p.set_active(root_id, active)


def report_dialog(p: Prefab) -> None:
    root = "举报窗口"
    root_id = p.node(root)
    active = p.data[root_id]["_active"]
    fullscreen(p, root, active)
    mask = p.node(root + "/mask")
    place(p, root + "/mask", 0, 0, 750, 1800)
    set_sprite_frame(p, mask, DIM_FRAME)
    p.data[mask]["_opacity"] = 190
    p.data[mask]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 10, "b": 22, "a": 255}

    art(p, root + "/bk", PANEL, 0, -40, 680, 1000, sliced=True)
    header(p, root + "/bk/举 报", "举报", 0, 450, 330, 74)
    style_label(p, root + "/bk/New Label", "请输入举报原因", x=0, y=72,
                w=300, h=44, size=28, color=GOLD, bold=True)
    style_label(p, root + "/bk/New Label copy", x=0, y=-300, w=600, h=76,
                size=20, color=SUB, wrap=True)
    line = p.node(root + "/bk/line")
    place(p, root + "/bk/line", 0, 337, 610, 2)
    p.data[line]["_color"] = {"__type__": "cc.Color", "r": SUB[0], "g": SUB[1], "b": SUB[2], "a": 120}

    close_art(p, root + "/关闭上层", 296, 410, 60, "gb")
    avatars = root + "/头像列表"
    art(p, avatars, BLUE_BUTTON, 0, 225, 610, 285, sliced=True)
    place(p, avatars + "/view", 0, 0, 596, 273)
    content = avatars + "/view/举报content"
    place(p, content, 0, 0, 596, 270)
    for ref in p.data[p.node(content)].get("_children", []):
        avatar_id = ref["__id__"]
        p.data[avatar_id]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
        name_id = next((child["__id__"] for child in p.data[avatar_id].get("_children", [])
                        if p.data[child["__id__"]].get("_name") == "name"), None)
        if name_id is not None:
            _, label = p.component(name_id, "cc.Label")
            if label is not None:
                label.update(_enabled=True, _fontSize=20, _lineHeight=24,
                             _isSystemFontUsed=False, _styleFlags=0,
                             **{"_N$file": copy.deepcopy(FONT), "_N$overflow": 2})
                p.data[name_id]["_color"] = {
                    "__type__": "cc.Color", "r": PALE[0], "g": PALE[1], "b": PALE[2], "a": 255
                }

    edit = root + "/公告文本"
    place(p, edit, 0, -85, 600, 210)
    art(p, edit + "/BACKGROUND_SPRITE", BLUE_BUTTON, 0, 0, 600, 210, sliced=True)
    style_label(p, edit + "/TEXT_LABEL", x=0, y=0, w=550, h=180,
                size=25, color=PALE, align=0, wrap=True)
    style_label(p, edit + "/PLACEHOLDER_LABEL", x=0, y=0, w=550, h=180,
                size=24, color=SUB, align=0, wrap=True)
    button(p, root + "/提交举报", "提交举报", 0, -405, 320, 78, primary=True)
    p.set_active(root_id, active)


def card_types_dialog(p: Prefab) -> None:
    root = "牌型提示"
    root_id = p.node(root)
    active = p.data[root_id]["_active"]
    fullscreen(p, root, active)
    add_dim(p, root)
    art(p, root + "/bg", PANEL, 0, 0, 620, 1240, sliced=True)
    header(p, root + "/bg/New Sprite", "牌型展示", 0, 570, 350, 76)
    # Preserve the complete game-specific card chart, only scale it uniformly
    # into the new frame.  No rank, suit or terminology is replaced.
    place(p, root + "/paixingtishi_03", 0, -32, 503, 1080)
    # Preserve the original game-specific chart frame after changing geometry.
    _, sprite = p.component(p.node(root + "/paixingtishi_03"), "cc.Sprite")
    sprite["_spriteFrame"] = {"__uuid__": "4f4f9e84-3ed8-4566-8cd7-5f8670987ac4"}
    sprite["_type"] = 0
    sprite["_sizeMode"] = 0
    p.set_active(root_id, active)


def migrate(relative: str) -> None:
    p = load(relative)
    settings_dialog(p)
    simple_dialog(p, "扣费提示", "延时确认",
                  (("关闭上层", "取消", False), ("确认延时", "确定", True)))
    simple_dialog(p, "芒果提示", "芒果提示",
                  (("关闭上层", "取消", False), ("确认芒果", "确定", True)))
    simple_dialog(p, "解散房间", "解散房间",
                  (("关闭上层", "取消", False), ("确认解散", "确定", True)),
                  panel_height=450)
    simple_dialog(p, "GPS警告", "温馨提示",
                  (("返回大厅", "返回大厅", True),), panel_height=430)
    simple_dialog(p, "举报扣费提示", "举报确认",
                  (("关闭上层", "取消", False), ("确认举报", "确定", True)))
    report_dialog(p)
    queue_dialog(p)
    card_types_dialog(p)
    p.save()


VISUAL_COMPONENTS = {
    "cc.Sprite", "cc.Label", "cc.Button", "cc.Toggle", "cc.Widget",
    "cc.Layout", "cc.Mask", "cc.ScrollView", "cc.EditBox",
}


def visual_signature(p: Prefab, node_id: int):
    node = p.data[node_id]
    result = {
        "name": node.get("_name"),
        "active": node.get("_active"),
        "opacity": node.get("_opacity"),
        "color": node.get("_color"),
        "size": node.get("_contentSize"),
        "anchor": node.get("_anchorPoint"),
        "trs": node.get("_trs", {}).get("array"),
        "components": [],
        "children": [],
    }
    for ref in node.get("_components", []):
        comp = p.data[ref["__id__"]]
        if comp.get("__type__") not in VISUAL_COMPONENTS:
            continue
        ctype = comp["__type__"]
        if not comp.get("_enabled", True):
            result["components"].append((ctype, {"_enabled": False}))
            continue
        keys = {
            "cc.Sprite": ("_enabled", "_spriteFrame", "_type", "_sizeMode", "_fillType",
                          "_fillCenter", "_fillStart", "_fillRange", "_isTrimmedMode"),
            "cc.Label": ("_enabled", "_string", "_N$string", "_fontSize", "_lineHeight",
                         "_enableWrapText", "_N$file", "_isSystemFontUsed", "_styleFlags",
                         "_spacingX", "_N$horizontalAlign", "_N$verticalAlign", "_N$overflow"),
            "cc.Button": ("_enabled", "_N$interactable", "_N$transition", "transition", "zoomScale"),
            "cc.Toggle": ("_enabled", "_N$isChecked", "_N$transition", "transition"),
            "cc.Widget": ("_enabled", "alignMode", "_alignFlags", "_top", "_bottom", "_left",
                          "_right", "_horizontalCenter", "_verticalCenter"),
            "cc.Layout": ("_enabled", "_resize", "_N$layoutType", "_N$cellSize",
                          "_N$paddingLeft", "_N$paddingRight", "_N$paddingTop", "_N$paddingBottom",
                          "_N$spacingX", "_N$spacingY"),
            "cc.Mask": ("_enabled", "_type", "_segments", "_inverted"),
            "cc.ScrollView": ("_enabled", "horizontal", "vertical", "inertia", "elastic"),
            "cc.EditBox": ("_enabled", "_N$placeholder", "_N$maxLength", "_N$returnType",
                           "_N$inputFlag", "_N$inputMode"),
        }[ctype]
        cleaned = {key: comp.get(key) for key in keys}
        result["components"].append((comp["__type__"], cleaned))
    result["children"] = [visual_signature(p, ref["__id__"]) for ref in node.get("_children", [])]
    return result


def verify_pair() -> None:
    left, right = (load(relative) for relative in PAGES)
    targets = (
        "牌型提示", "系统设置", "扣费提示", "芒果提示",
        "解散房间", "GPS警告", "举报窗口", "举报扣费提示", "排队弹窗",
    )
    for path in targets:
        a = visual_signature(left, left.node(path))
        b = visual_signature(right, right.node(path))
        if a != b:
            raise AssertionError(f"Prefab/Scene visual subtree mismatch: {path}")


def main() -> None:
    for asset in (PANEL, BLUE_BUTTON, GOLD_BUTTON, HEADER, CLOSE, TOGGLE_ON, TOGGLE_OFF):
        if not (ASSET_DIR / asset).exists() or not (ASSET_DIR / (asset + ".meta")).exists():
            raise FileNotFoundError(f"missing V8 dialog asset or meta: {asset}")
    for relative in PAGES:
        migrate(relative)
    verify_pair()
    print("V8 in-game dialogs migrated; Prefab/Scene visual subtrees match.")


if __name__ == "__main__":
    # The original-message style supersedes this historical V8 migration.
    # Keep its helpers for other tools, but never reapply the rejected skin
    # or overwrite the separately approved system-settings artwork.
    from apply_original_message_dialog_style import main as apply_messages
    from apply_original_large_dialog_style import main as apply_large_dialogs
    apply_messages()
    apply_large_dialogs()
