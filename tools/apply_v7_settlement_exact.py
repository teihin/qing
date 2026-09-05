#!/usr/bin/env python3
"""Serialize the approved V7 settlement composition into Cocos Prefabs."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import BASE_H, bottom, ensure_widget, stretch, top


GOLD = {"__type__": "cc.Color", "r": 224, "g": 181, "b": 134, "a": 255}
GREEN = {"__type__": "cc.Color", "r": 139, "g": 188, "b": 25, "a": 255}


def fill_parent(p: Prefab, path: str, width: float, height: float) -> None:
    node = p.node(path)
    p.set_pos(node, 0, 0, width, height)
    widget = ensure_widget(p, node)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def transparent_node(p: Prefab, path: str, x: float, y: float,
                     width: float, height: float, hide: bool = False) -> int:
    node = p.node(path)
    p.art(node, "transparent.png", x, y, width, height, hide=hide)
    untint(p, node)
    return node


def apply_page() -> None:
    p = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    p.sprite(p.root, "settlement_bg_exact.png")
    untint(p, p.root)
    p.set_active(p.node("bg"), False)

    # Exact header includes the back icon and art title.  Both interactions are
    # real Prefab Buttons over the bitmap, so they are visible in the editor.
    title = p.node("title")
    p.art(title, "settlement_header_exact.png", 0, 0, 750, 72)
    untint(p, title)
    top(p, "title", 0, width=750, height=72, stretch_x=True)
    p.set_active(p.node("title/战局详情"), False)

    close = p.node("title/关闭")
    p.set_active(close, True)
    p.art(close, "transparent.png", -330, 0, 90, 72, hide=True)
    untint(p, close)

    review = p.node("title/牌局回顾")
    p.set_active(review, True)
    p.art(review, "settlement_review_exact.png", 276, 0, 178, 46, hide=True)
    untint(p, review)

    # The casino scene and all three award frames/titles are a single exact
    # fixed slice. The side captions retain the game's established 土豪/大鱼
    # semantics; only portraits and names remain dynamic.
    ranking = p.node("排行")
    p.art(ranking, "settlement_hero_exact.png", 0, 0, 750, 290)
    untint(p, ranking)
    p.disable(ranking, "cc.Layout")
    top(p, "排行", 72, width=750, height=290)
    rank_specs = (
        ("土豪", -222, -14, 112, -114, "体面"),
        ("MVP", 0, 9, 160, -145, "五哥"),
        ("大鱼", 221, -14, 112, -114, "欢乐马123"),
    )
    for name, x, y, avatar_size, name_y, preview in rank_specs:
        root = p.node("排行/" + name)
        p.set_active(root, True)
        p.art(root, "transparent.png", x, y, avatar_size, avatar_size)
        # Legacy award roots carried a 0.84 scale.  Reset it explicitly or the
        # live portraits shrink away from the fixed rings in the hero artwork.
        p.data[root]["_trs"]["array"][7:9] = [1, 1]
        untint(p, root)
        p.set_active(p.node(f"排行/{name}/th"), False)
        mask = p.node(f"排行/{name}/mask")
        p.set_pos(mask, 0, 0, avatar_size, avatar_size)
        _, mask_comp = p.component(mask, "cc.Mask")
        if mask_comp is not None:
            mask_comp["_type"] = 1
        image = p.node(f"排行/{name}/mask/img")
        p.set_pos(image, 0, 0, avatar_size, avatar_size)
        image_widget = ensure_widget(p, image)
        image_widget.update({
            "_enabled": True, "alignMode": 1, "_alignFlags": 45,
            "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
            "_originalWidth": avatar_size, "_originalHeight": avatar_size,
        })
        style_label(p, f"排行/{name}/name", x=0, y=name_y,
                    width=200, height=36, size=23, preview=preview, align=1)
    p.set_active(p.node("排行/劳模"), False)

    # Live avatars must sit behind the complete metal circles.  This separate
    # foreground sprite restores the lower arcs that a circular avatar would
    # otherwise cover; it contains no account-dependent portrait or name.
    try:
        frames = p.node("排行/V7荣誉框前景")
    except KeyError:
        frames = p.clone_subtree(p.node("排行/土豪/th"), ranking, "V7荣誉框前景")
    p.set_active(frames, True)
    p.art(frames, "settlement_award_frames_exact.png", 0, 0, 750, 290, hide=True)
    # The cloned legacy `th` node carries scale=1.15.  Leaving that value here
    # produces the doubled, offset circles seen in the real browser preview.
    p.data[frames]["_trs"]["array"][7:9] = [1, 1]
    untint(p, frames)

    # Preserve the existing animated queue entry and all of its behavior.  It
    # occupies the free upper-left area at a restrained scale, so it does not
    # cover an award portrait, name, summary value or the new review action.
    queue = p.node("排行/排队")
    p.set_active(queue, True)
    p.set_pos(queue, -288, 116, 150, 58)
    queue_anim = p.node("排行/排队/pd")
    p.set_pos(queue_anim, -8, 4, 218, 86)
    p.data[queue_anim]["_trs"]["array"][7:9] = [0.58, 0.58]

    summary = p.node("基本")
    p.art(summary, "settlement_summary_exact.png", 0, 0, 704, 53)
    untint(p, summary)
    top(p, "基本", 376, width=704, height=53)
    p.set_active(p.node("基本/地九王"), False)
    style_label(p, "基本/房间名", x=-235, y=0,
                width=210, height=42, size=22, preview="房间号:594741", align=1)
    style_label(p, "基本/时长", x=267, y=0,
                width=112, height=42, size=22, preview="15:55", align=1)

    aggregate = p.node("扩展")
    transparent_node(p, "扩展", 0, 0, 704, 53)
    top(p, "扩展", 376, width=704, height=53)
    for ref in p.data[aggregate].get("_children", []):
        p.set_active(ref["__id__"], False)
    for path in ("扩展/底皮", "扩展/奖池"):
        p.set_active(p.node(path), True)
    style_label(p, "扩展/底皮", x=-83, y=0,
                width=145, height=42, size=22, preview="底皮:1/3", align=1)
    style_label(p, "扩展/奖池", x=92, y=0,
                width=150, height=42, size=22, preview="总奖池:168", align=1)

    # Table header is immutable art; the list panel and view stretch on tall
    # screens, leaving every non-stretchable decoration at its exact scale.
    try:
        table = p.node("V7结算表头")
    except KeyError:
        table = p.clone_subtree(summary, p.root, "V7结算表头")
    p.set_active(table, True)
    p.art(table, "settlement_table_header_exact.png", 0, 0, 708, 65, hide=True)
    untint(p, table)
    top(p, "V7结算表头", 439, width=708, height=65)

    records = p.node("战绩列表")
    p.sprite(records, "settlement_list_panel_exact.png", sliced=True)
    untint(p, records)
    stretch(p, "战绩列表", 504, 140, left=21, right=21)
    fill_parent(p, "战绩列表/view", 708, BASE_H - 504 - 140)
    content = p.node("战绩列表/view/content")
    p.data[content]["_contentSize"]["width"] = 708
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0,
        "_originalWidth": 708,
    })
    _, layout = p.component(content, "cc.Layout")
    layout["_N$paddingTop"] = 0
    layout["_N$paddingBottom"] = 0
    layout["_N$spacingY"] = 0

    return_button = p.node("关闭")
    p.set_active(return_button, True)
    p.art(return_button, "settlement_return_exact.png", 0, 0, 300, 67, hide=True)
    untint(p, return_button)
    bottom(p, "关闭", 55, width=300, height=67)

    # The full-screen review child remains intact and hidden until the new
    # top-right Button invokes the existing business path.
    p.set_active(p.node("牌局回顾"), False)
    p.save()


def apply_row() -> None:
    p = Prefab("assets/resources/Prefabs/战绩玩家对象.prefab")
    p.art(p.root, "settlement_row_exact.png", 0, 0, 680, 70)
    untint(p, p.root)
    p.disable(p.root, "cc.Widget")
    for name in ("line", "头像", "txt", "惩罚"):
        p.set_active(p.node(name), False)

    # Keep the live rank number that existed in the product.  The first three
    # rows use `idx`, subsequent rows use `idx2`; both share the same aligned
    # typography and occupy their own narrow column before the player name.
    p.set_active(p.node("idx"), True)
    p.set_active(p.node("idx2"), False)
    style_label(p, "idx", x=-317, y=0, width=46, height=40,
                size=23, preview="1", align=1)
    style_label(p, "idx2", x=-317, y=0, width=46, height=40,
                size=23, preview="4", align=1)

    style_label(p, "名字", x=-252, y=13, width=190, height=31,
                size=21, preview="信贷黄经理", align=0)
    style_label(p, "id", x=-252, y=-14, width=190, height=27,
                size=16, preview="ID:411973", align=0)
    style_label(p, "带入", x=-87, y=0, width=110, height=40,
                size=21, preview="100", align=1)
    style_label(p, "手数", x=78, y=0, width=110, height=40,
                size=21, preview="38", align=1)
    style_label(p, "输赢", x=251, y=0, width=130, height=40,
                size=21, preview="-100", align=1)
    p.data[p.node("输赢")]["_color"] = copy.deepcopy(GREEN)
    p.save()


def main() -> None:
    apply_page()
    apply_row()
    print("已把06-结算确认稿及右上牌局回顾按钮写入结算Prefab。")


if __name__ == "__main__":
    main()
