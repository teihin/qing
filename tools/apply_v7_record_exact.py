#!/usr/bin/env python3
"""Serialize the approved V7 record-list composition into Cocos Prefabs."""

from __future__ import annotations

import copy

from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from repair_v7_responsive_layout import bottom, ensure_widget, stretch, top


RED = {"__type__": "cc.Color", "r": 246, "g": 63, "b": 54, "a": 255}
GREEN = {"__type__": "cc.Color", "r": 139, "g": 188, "b": 25, "a": 255}


def full_view(p: Prefab, path: str, width: float, height: float) -> None:
    node = p.node(path)
    p.set_pos(node, 0, 0, width, height)
    widget = ensure_widget(p, node)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 0, "_right": 0, "_top": 0, "_bottom": 0,
        "_originalWidth": width, "_originalHeight": height,
    })


def apply_page() -> None:
    p = Prefab("assets/resources/UI/panelRecordList.prefab")
    p.sprite(p.root, "record_bg_exact.png")
    untint(p, p.root)
    p.set_active(p.node("bg"), False)

    title = p.node("title")
    p.art(title, "record_header_exact.png", 0, 0, 750, 72)
    untint(p, title)
    top(p, "title", 0, width=750, height=72, stretch_x=True)
    p.set_active(p.node("title/客服"), False)
    p.set_active(p.node("title/我的战绩"), False)
    close = p.node("title/关闭")
    p.art(close, "transparent.png", -330, 0, 90, 72, hide=True)
    untint(p, close)

    hero = p.node("统计")
    p.art(hero, "record_hero_exact.png", 0, 0, 750, 368, hide=True)
    untint(p, hero)
    top(p, "统计", 72, width=750, height=368)

    condition = p.node("条件")
    p.disable(condition, "cc.Layout")
    top(p, "条件", 440, width=656, height=68)
    # 服务端日期参数语义：0=今日、-1=昨日、-2=前日。
    # 每个 Toggle 的 checkmark 都是一张完整日期栏状态图；切换时由
    # ToggleContainer 只显示当前项，从而同步更新三枚按钮的选中/未选中美术。
    toggle_specs = (
        ("0", "record_tabs_today_exact.png", -218, True),
        ("-1", "record_tabs_yesterday_exact.png", 0, False),
        ("-2", "record_tabs_before_exact.png", 218, False),
    )
    for name, asset, x, selected in toggle_specs:
        toggle_node = p.node("条件/" + name)
        p.set_pos(toggle_node, x, 0, 219, 68)
        background = p.node(f"条件/{name}/Background")
        p.art(background, "transparent.png", 0, 0, 219, 68, hide=True)
        checkmark = p.node(f"条件/{name}/checkmark")
        p.art(checkmark, asset, -x, 0, 656, 68, hide=True)
        p.set_active(checkmark, selected)
        _, toggle = p.component(toggle_node, "cc.Toggle")
        toggle["_N$isChecked"] = selected

    table = p.node("标题")
    p.art(table, "record_table_header_exact.png", 0, 0, 722, 63, hide=True)
    untint(p, table)
    top(p, "标题", 520, width=722, height=63)

    record_list = p.node("战绩列表")
    p.sprite(record_list, "record_list_panel_exact.png", sliced=True)
    untint(p, record_list)
    stretch(p, "战绩列表", 583, 107, left=14, right=14)
    full_view(p, "战绩列表/view", 722, 644)
    content = p.node("战绩列表/view/content")
    p.data[content]["_contentSize"]["width"] = 722
    content_widget = ensure_widget(p, content)
    content_widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0,
        "_originalWidth": 722,
    })
    _, layout = p.component(content, "cc.Layout")
    layout["_N$paddingTop"] = 11
    layout["_N$paddingBottom"] = 0
    layout["_N$spacingY"] = 11

    pagination = p.node("分页")
    p.art(pagination, "gift_pagination_exact.png", 0, 0, 708, 107)
    untint(p, pagination)
    p.disable(pagination, "cc.Layout")
    bottom(p, "分页", 0, width=708, height=107)
    for name, x in (("首页", -272), ("上一页", -158), ("下一页", 150), ("尾页", 265)):
        button = p.node("分页/" + name)
        p.set_active(button, True)
        p.set_pos(button, x, -4, 78, 78)
        p.hide_children(button)
    style_label(p, "分页/页码", x=0, y=-5,
                width=150, height=52, size=31,
                preview="1/1", align=1)

    p.save()


def apply_row() -> None:
    p = Prefab("assets/resources/Prefabs/战绩对象.prefab")
    p.art(p.root, "record_row_exact.png", 0, -48, 708, 96)
    untint(p, p.root)
    p.disable(p.root, "cc.Widget")
    p.set_active(p.node("垫底长"), False)
    for name in ("s房间", "s筹码", "s时间", "s分数", "时间"):
        p.set_active(p.node(name), False)

    style_label(p, "房间号", x=-193, y=0, width=145, height=46,
                size=27, preview="496535", align=1)
    style_label(p, "底皮", x=-63, y=0, width=100, height=46,
                size=27, preview="20/40", align=1)
    style_label(p, "带入", x=95, y=0, width=120, height=46,
                size=27, preview="3000", align=1)
    style_label(p, "输赢", x=260, y=0, width=126, height=46,
                size=27, preview="-3000", align=1)
    p.data[p.node("输赢")]["_color"] = copy.deepcopy(GREEN)
    p.save()


def main() -> None:
    apply_page()
    apply_row()
    print("已把04-战绩确认稿和赠送页同款翻页栏写入战绩Prefab。")


if __name__ == "__main__":
    main()
