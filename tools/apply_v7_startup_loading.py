#!/usr/bin/env python3
"""Apply the V7 startup/loading art directly to the formal Cocos prefabs."""

from __future__ import annotations

from apply_v7_prefab_skin import Prefab


GOLD = {"__type__": "cc.Color", "r": 240, "g": 213, "b": 164, "a": 255}
GOLD_SOFT = {"__type__": "cc.Color", "r": 218, "g": 191, "b": 145, "a": 255}
NAVY_MASK = {"__type__": "cc.Color", "r": 2, "g": 18, "b": 32, "a": 255}


def set_anchor(p: Prefab, node_id: int, x: float, y: float) -> None:
    p.data[node_id]["_anchorPoint"] = {"__type__": "cc.Vec2", "x": x, "y": y}


def set_widget(p: Prefab, node_id: int, flags: int, *, top=0, bottom=0,
               left=0, right=0, horizontal=0, vertical=0) -> None:
    _, widget = p.component(node_id, "cc.Widget")
    if widget is None:
        return
    widget["_enabled"] = True
    widget["alignMode"] = 1
    widget["_alignFlags"] = flags
    widget["_top"] = top
    widget["_bottom"] = bottom
    widget["_left"] = left
    widget["_right"] = right
    widget["_horizontalCenter"] = horizontal
    widget["_verticalCenter"] = vertical


def set_label(p: Prefab, node_id: int, *, text: str | None = None,
              size: int, line_height: int, color=GOLD, overflow=1,
              horizontal=1, vertical=1, wrap=False) -> None:
    _, label = p.component(node_id, "cc.Label")
    if label is None:
        raise ValueError(f"{p.path.name}: {p.data[node_id].get('_name')} has no Label")
    if text is not None:
        label["_string"] = text
        label["_N$string"] = text
    label["_fontSize"] = size
    label["_lineHeight"] = line_height
    label["_enableWrapText"] = wrap
    label["_N$overflow"] = overflow
    label["_N$horizontalAlign"] = horizontal
    label["_N$verticalAlign"] = vertical
    p.data[node_id]["_color"] = color.copy()
    p.data[node_id]["_opacity"] = 255


def first_node(p: Prefab, *paths: str) -> int:
    for path in paths:
        try:
            return p.node(path)
        except KeyError:
            pass
    raise KeyError(f"{p.path.name}: none of these nodes exist: {paths}")


def add_root_art(p: Prefab, source: int, name: str, asset: str,
                 width: float, height: float, top: float) -> int:
    try:
        node = p.node(name)
    except KeyError:
        node = p.clone_subtree(source, p.root, name)
    p.set_active(node, True)
    set_anchor(p, node, 0.5, 0.5)
    p.art(node, asset, 0, 0, width, height)
    set_widget(p, node, 1 | 16, top=top, horizontal=0)
    return node


def style_progress(p: Prefab, path: str, label_name: str, *, visible: bool) -> None:
    node = p.node(path)
    p.set_active(node, visible)
    set_anchor(p, node, 0.5, 0.5)
    p.set_pos(node, 0, 0, 600, 30)
    p.sprite(node, "startup_progress_track_exact.png", sliced=True)
    p.data[node]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}
    set_widget(p, node, 16, horizontal=0)

    bar = p.node(path + "/bar")
    set_anchor(p, bar, 0, 0.5)
    # A partial width keeps the visual visible in Creator. Runtime progress
    # immediately resets this node to zero and then drives the real value.
    p.set_pos(bar, -297, 0, 214, 20, disable_widget=True)
    p.sprite(bar, "startup_progress_fill_exact.png", sliced=True)
    p.data[bar]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}

    _, progress = p.component(node, "cc.ProgressBar")
    progress["_N$totalLength"] = 594
    progress["_N$progress"] = 0.36
    progress["_N$barSprite"] = {"__id__": p.component(bar, "cc.Sprite")[0]}

    label_node = p.node(path + "/" + label_name)
    p.set_pos(label_node, 0, 64, 600, 44, disable_widget=True)
    set_label(p, label_node, text="0%", size=32, line_height=38, overflow=1)


def skin_update() -> None:
    p = Prefab("assets/resources/UI/panelUpdate.prefab")
    p.disable(p.root, "cc.Sprite")

    old_logo = first_node(p, "V7启动盾牌", "秦_登录LOGO")
    try:
        background = p.node("V7启动背景")
    except KeyError:
        background = p.clone_subtree(old_logo, p.root, "V7启动背景")
    p.art(background, "announcement_detail_bg_long_exact.png", 0, 0, 750, 1800)
    set_anchor(p, background, 0.5, 1)
    set_widget(p, background, 1 | 16, top=0, horizontal=0)
    # clone_subtree appends; the background must be the first render sibling.
    children = p.data[p.root]["_children"]
    children[:] = [{"__id__": background}] + [ref for ref in children if ref["__id__"] != background]

    p.rename(old_logo, "V7启动盾牌")
    p.art(old_logo, "shield_hd.png", 0, 0, 340, 358)
    set_anchor(p, old_logo, 0.5, 0.5)
    set_widget(p, old_logo, 1 | 16, top=170, horizontal=0)

    add_root_art(p, old_logo, "V7启动标题", "startup_title_exact.png", 430, 68, 548)
    add_root_art(p, old_logo, "V7启动副标题", "startup_subtitle_exact.png", 520, 36, 614)
    add_root_art(p, old_logo, "V7启动分隔", "register_header_rule_exact.png", 335, 24, 657)
    tip = add_root_art(p, old_logo, "V7启动安全提示", "startup_tip_exact.png", 420, 38, 0)
    set_widget(p, tip, 4 | 16, bottom=92, horizontal=0)

    container = p.node("bk")
    set_anchor(p, container, 0.5, 0.5)
    p.set_pos(container, 0, 0, 750, 230)
    set_widget(p, container, 4 | 16, bottom=190, horizontal=0)

    style_progress(p, "bk/大小进度", "大小计数", visible=True)
    style_progress(p, "bk/文件进度", "文件计数", visible=False)

    status = p.node("bk/日志")
    p.set_pos(status, 0, -62, 620, 50, disable_widget=True)
    set_label(p, status, text="正在检查资源完整性", size=24, line_height=32,
              color=GOLD_SOFT, overflow=1)

    cache = p.node("bk/缓存目录")
    p.set_active(cache, False)

    version = p.node("ver")
    set_label(p, version, size=20, line_height=24, color=GOLD_SOFT,
              overflow=0, horizontal=2)
    p.data[version]["_opacity"] = 175
    set_widget(p, version, 4 | 32, bottom=28, right=28)

    error = p.node("网络异常")
    set_anchor(p, error, 0.5, 0.5)
    p.set_pos(error, 0, 0, 750, 1334)
    set_widget(p, error, 1 | 4 | 8 | 32, top=0, bottom=0, left=0, right=0)
    mask = p.node("网络异常/msk")
    set_anchor(p, mask, 0.5, 0.5)
    p.set_pos(mask, 0, 0, 750, 1334)
    set_widget(p, mask, 1 | 4 | 8 | 32, top=0, bottom=0, left=0, right=0)
    p.data[mask]["_color"] = NAVY_MASK.copy()
    p.data[mask]["_opacity"] = 208

    error_panel = p.node("网络异常/bk")
    set_anchor(p, error_panel, 0.5, 0.5)
    p.art(error_panel, "startup_retry_panel_exact.png", 0, 0, 560, 360, sliced=True)
    message = p.node("网络异常/bk/msg")
    p.set_pos(message, 0, 16, 470, 110)
    set_label(p, message, size=28, line_height=38, overflow=2, wrap=True)
    retry = p.node("网络异常/bk/重试")
    p.art(retry, "startup_retry_button_exact.png", 0, -112, 300, 84)
    p.data[retry]["_trs"]["array"][7:9] = [1, 1]
    p.set_active(p.node("网络异常/bk/重试"), True)
    # Keep the legacy duplicate hidden; the first same-name node owns the
    # UIPanelViewBase click binding and preserves the existing retry behavior.
    error_children = [ref["__id__"] for ref in p.data[error_panel].get("_children", [])]
    retry_nodes = [nid for nid in error_children if p.data[nid].get("_name") == "重试"]
    if len(retry_nodes) > 1:
        p.set_active(retry_nodes[1], False)

    p.set_active(p.node("启动动画"), False)
    p.save()


def skin_overlay_loader() -> None:
    p = Prefab("assets/resources/UI/panelLoading.prefab")
    p.disable(p.root, "cc.Sprite")
    set_anchor(p, p.root, 0.5, 0.5)

    mask = p.node("msk")
    set_anchor(p, mask, 0.5, 0.5)
    p.set_pos(mask, 0, 0, 750, 1334)
    set_widget(p, mask, 1 | 4 | 8 | 32, top=0, bottom=0, left=0, right=0)
    p.data[mask]["_color"] = NAVY_MASK.copy()
    p.data[mask]["_opacity"] = 188

    card = first_node(p, "msk/V7加载底板", "msk/1")
    p.rename(card, "V7加载底板")
    p.set_active(card, True)
    p.art(card, "startup_loading_card_exact.png", 0, 0, 260, 210, sliced=True)
    _, empty_animation = p.component(card, "cc.Animation")
    if empty_animation is not None:
        empty_animation["_enabled"] = False

    mask_children = p.data[mask]["_children"]
    mask_children[:] = [{"__id__": card}] + [ref for ref in mask_children if ref["__id__"] != card]

    ring = p.node("msk/loading")
    p.art(ring, "startup_loading_ring_exact.png", 0, 24, 124, 124)
    p.data[ring]["_trs"]["array"][7:9] = [1, 1]

    label = p.node("msk/label")
    p.set_active(label, True)
    p.set_pos(label, 0, -67, 190, 42)
    set_label(p, label, text="加载中…", size=26, line_height=32, overflow=1)
    p.save()


def main() -> None:
    skin_update()
    skin_overlay_loader()


if __name__ == "__main__":
    main()
