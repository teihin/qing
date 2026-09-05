#!/usr/bin/env python3
"""Apply accepted V7 agent pages to panelHongli and its list Prefabs."""

from __future__ import annotations

import copy

from apply_v7_followup_main_exact import (
    BASE_H, add_master, center_anchor, fixed_bottom, fixed_top, full_screen,
    hide_legacy_visuals, pagination, stretch_box, transparent_button,
)
from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import transparent
from repair_v7_responsive_layout import ensure_widget


GOLD = {"__type__": "cc.Color", "r": 232, "g": 198, "b": 145, "a": 255}
GREEN = {"__type__": "cc.Color", "r": 155, "g": 207, "b": 59, "a": 255}


def place_group_label(p: Prefab, group_path: str, label_path: str,
                      x: float, screen_y: float, width: float = 150,
                      height: float = 44, size: int = 25) -> None:
    group = p.node(group_path)
    p.set_active(group, True)
    center_anchor(p, group)
    p.set_pos(group, x, BASE_H / 2 - screen_y, width, height,
              disable_widget=True)
    label = p.node(label_path)
    p.set_active(label, True)
    center_anchor(p, label)
    style_label(p, label_path, x=0, y=0, width=width, height=height,
                size=size, align=1)
    p.data[label]["_color"] = copy.deepcopy(GOLD)


def home(p: Prefab) -> None:
    hide_legacy_visuals(p, p.root)
    master = add_master(p, p.root, "panelHongli/V7代理首页母版",
                        "followup_agent_home_master_long.png")
    transparent_button(p, "panelHongli/title/关闭", -325, 0, 100, 84)

    # Every legacy container is normalized to the same 750x1334 top-fixed
    # coordinate space before its dynamic labels are placed.
    for path in ("panelHongli/红利余额", "panelHongli/统计",
                 "panelHongli/数据", "panelHongli/红利统计",
                 "panelHongli/操作"):
        node = p.node(path)
        p.set_active(node, True)
        center_anchor(p, node)
        p.disable(node, "cc.Layout")
        fixed_top(p, node, 0, 750, BASE_H)

    place_group_label(p, "panelHongli/红利余额",
                      "panelHongli/红利余额/num", 0, 199, 280, 58, 38)
    place_group_label(p, "panelHongli/统计/累计总红利",
                      "panelHongli/统计/累计总红利/num", -212, 384, 150, 42, 25)
    place_group_label(p, "panelHongli/统计/累计总提取",
                      "panelHongli/统计/累计总提取/num", 0, 384, 150, 42, 25)
    # The current-day amount already has a live label in 红利统计.
    today = p.node("panelHongli/红利统计/今日红利")
    p.set_active(today, True)
    style_label(p, "panelHongli/红利统计/今日红利",
                x=211, y=BASE_H / 2 - 384, width=150, height=42,
                size=25, align=1)
    p.data[today]["_color"] = copy.deepcopy(GOLD)

    data_specs = (
        ("上级ID", -232), ("我的ID", -64),
        ("下级玩家", 103), ("今日新增", 255),
    )
    for name, x in data_specs:
        label = p.node(f"panelHongli/数据/{name}")
        p.set_active(label, True)
        style_label(p, f"panelHongli/数据/{name}", x=x,
                    y=BASE_H / 2 - 845, width=145, height=40,
                    size=22, align=1)
        p.data[label]["_color"] = copy.deepcopy(GOLD)

    for name, x in (("今日红利", -200), ("昨日红利", 0), ("前日红利", 200)):
        label = p.node(f"panelHongli/红利统计/{name}")
        p.set_active(label, True)
        style_label(p, f"panelHongli/红利统计/{name}", x=x,
                    y=BASE_H / 2 - 937, width=150, height=38,
                    size=21, align=1)
        p.data[label]["_color"] = copy.deepcopy(GOLD)

    actions = (
        ("我的玩家", -227, 495, 214, 88),
        ("我的业绩", 22, 495, 214, 88),
        ("我的盟主", 228, 495, 168, 88),
        ("提取记录", -227, 602, 214, 88),
        ("推广", 22, 602, 214, 88),
        ("总业绩", 228, 602, 168, 88),
    )
    for name, x, top, width, height in actions:
        button = p.node(f"panelHongli/操作/{name}")
        p.set_active(button, True)
        transparent(p, button, width, height, hide_children=True)
        p.set_pos(button, x, BASE_H / 2 - top - height / 2,
                  width, height, disable_widget=True)

    # Draw home below every full-page child, preserving the original page stack.
    children = p.data[p.root].setdefault("_children", [])
    children[:] = [ref for ref in children if ref.get("__id__") != master]
    children.insert(0, {"__id__": master})


def normalize_page_group(p: Prefab, path: str) -> None:
    node = p.node(path)
    p.set_active(node, True)
    center_anchor(p, node)
    p.set_pos(node, 0, 0, 750, BASE_H, disable_widget=True)


def list_page(p: Prefab, root_name: str, key: str, table_top: int,
              stats: tuple[tuple[str, float], ...] = ()) -> None:
    root_path = f"panelHongli/{root_name}"
    root = p.node(root_path)
    full_screen(p, root)
    master = add_master(p, root, f"{root_path}/V7{root_name}母版",
                        f"followup_agent_{key}_master_long.png")
    transparent_button(p, f"{root_path}/title/关闭上上层", -325, 0, 100, 84)

    if stats:
        stats_root = p.node(f"{root_path}/统计")
        center_anchor(p, stats_root)
        fixed_top(p, stats_root, 0, 750, BASE_H)
        count = len(stats)
        xs = {2: (-152, 152), 3: (-202, 0, 202)}[count]
        screen_y = 190 if table_top == 255 else 269
        for (sub, _), x in zip(stats, xs):
            place_group_label(p, f"{root_path}/统计/{sub}",
                              f"{root_path}/统计/{sub}/num", x, screen_y,
                              170, 44, 25)

    listing = p.node(f"{root_path}/列表")
    p.set_active(listing, True)
    p.sprite(listing, "followup_agent_list_panel_exact.png", sliced=True)
    untint(p, listing)
    stretch_box(p, listing, table_top, 107, 56, 56)
    view = p.node(f"{root_path}/列表/view")
    p.set_active(view, True)
    center_anchor(p, view)
    widget = ensure_widget(p, view)
    widget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 45,
        "_left": 8, "_right": 8, "_top": 51, "_bottom": 8,
        "_originalWidth": 622,
    })
    content = p.node(f"{root_path}/列表/view/content")
    p.set_active(content, True)
    center_anchor(p, content)
    p.data[content]["_anchorPoint"]["y"] = 1
    p.data[content]["_contentSize"]["width"] = 622
    cwidget = ensure_widget(p, content)
    cwidget.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": 41,
        "_left": 0, "_right": 0, "_top": 0, "_originalWidth": 622,
    })
    _, layout = p.component(content, "cc.Layout")
    if layout is not None:
        layout["_enabled"] = True
        layout["_N$paddingTop"] = 0
        layout["_N$paddingBottom"] = 0
        layout["_N$spacingY"] = 11

    header = p.node(f"{root_path}/标题")
    p.set_active(header, True)
    p.art(header, f"followup_agent_{key}_header_exact.png", 0, 0, 638, 51,
          hide=True)
    untint(p, header)
    fixed_top(p, header, table_top, 638, 51)
    pagination(p, f"{root_path}/分页")

    children = p.data[root].setdefault("_children", [])
    page = p.node(f"{root_path}/分页")
    ids = (master, listing, header, page)
    children[:] = [ref for ref in children if ref.get("__id__") not in ids]
    children.insert(0, {"__id__": master})
    children.extend({"__id__": node_id} for node_id in ids[1:])


def performance_tabs(p: Prefab) -> None:
    path = "panelHongli/我的业绩/条件"
    group = p.node(path)
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    fixed_top(p, group, 112, 607, 60)
    specs = (("我的玩家", -202, 0), ("二级代理", 0, 1), ("三级代理", 202, 2))
    for name, x, index in specs:
        toggle = p.node(f"{path}/{name}")
        p.set_active(toggle, True)
        center_anchor(p, toggle)
        p.set_pos(toggle, x, 0, 202, 60, disable_widget=True)
        try:
            bg = p.node(f"{path}/{name}/Background")
            transparent(p, bg, 202, 60, hide_children=True)
        except KeyError:
            pass
        check = p.node(f"{path}/{name}/checkmark")
        p.set_active(check, True)
        offset = -x
        p.art(check, f"followup_agent_tabs_{index}_exact.png",
              offset, 0, 607, 60, hide=True)
        untint(p, check)


def promo(p: Prefab) -> None:
    root_path = "panelHongli/推广二维码"
    root = p.node(root_path)
    full_screen(p, root)
    add_master(p, root, f"{root_path}/V7代理推广母版",
               "followup_agent_promo_master_long.png")
    transparent_button(p, f"{root_path}/title/关闭上上层", -325, 0, 100, 84)
    qr = p.node(f"{root_path}/二维码")
    p.set_active(qr, True)
    p.art(qr, "followup_qr_card_exact.png", 0, 0, 282, 282)
    untint(p, qr)
    fixed_top(p, qr, 371, 282, 282)
    graph = p.node(f"{root_path}/二维码/img")
    p.set_active(graph, True)
    center_anchor(p, graph)
    p.set_pos(graph, 0, 0, 245, 245, disable_widget=True)

    try:
        label = p.node(f"{root_path}/V7推广ID")
    except KeyError:
        label = p.clone_subtree(p.node("panelHongli/红利余额/num"), root,
                                "V7推广ID")
    p.set_active(label, True)
    style_label(p, f"{root_path}/V7推广ID", x=0, y=0,
                width=420, height=44, size=24,
                preview="推广ID：--", align=1)
    p.data[label]["_color"] = copy.deepcopy(GOLD)
    fixed_top(p, label, 667, 420, 44)

    try:
        link = p.node(f"{root_path}/V7推广链接")
    except KeyError:
        link = p.clone_subtree(label, root, "V7推广链接")
    p.set_active(link, True)
    style_label(p, f"{root_path}/V7推广链接", x=82, y=0,
                width=350, height=46, size=18,
                preview="https://--", align=0)
    p.data[link]["_color"] = copy.deepcopy(GOLD)
    _, link_component = p.component(link, "cc.Label")
    if link_component is not None:
        link_component["_enableWrapText"] = False
        link_component["_N$overflow"] = 2
    fixed_top(p, link, 741, 350, 46, x=82)
    transparent_button(p, f"{root_path}/分享二维码", 0, 894, 360, 79)


def popup(p: Prefab, root_name: str, asset_key: str,
          labels: tuple[str, ...], confirm: str | None = None,
          single: bool = False) -> None:
    root_path = f"panelHongli/{root_name}"
    root = p.node(root_path)
    full_screen(p, root)
    # The home-page legacy cleanup disables descendant sprites. Restore the
    # modal mask explicitly so every confirmation card remains visually modal.
    mask = p.node(f"{root_path}/msk")
    p.set_active(mask, True)
    full_screen(p, mask)
    _, mask_sprite = p.component(mask, "cc.Sprite")
    if mask_sprite is not None:
        mask_sprite["_enabled"] = True
    p.data[mask]["_color"] = {
        "__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255,
    }
    p.data[mask]["_opacity"] = 166
    bk = p.node(f"{root_path}/bk")
    p.set_active(bk, True)
    p.art(bk, f"followup_agent_popup_{asset_key}_exact.png", 0, 0, 543, 494)
    untint(p, bk)
    fixed_top(p, bk, 407, 543, 494)

    for index, name in enumerate(labels):
        path = f"{root_path}/bk/{name}"
        try:
            label = p.node(path)
        except KeyError:
            continue
        p.set_active(label, True)
        screen_y = round((840 + index * 48) * 750 / 941)
        local_y = (BASE_H / 2 - screen_y) - (BASE_H / 2 - 407 - 247)
        style_label(p, path, x=0, y=local_y, width=470, height=40,
                    size=21, align=1)
        p.data[label]["_color"] = copy.deepcopy(GOLD)

    close_path = f"{root_path}/bk/关闭上上层"
    try:
        close = p.node(close_path)
        p.set_active(close, True)
        x = 0 if single else -122
        transparent(p, close, 211 if not single else 289, 65, hide_children=True)
        p.set_pos(close, x, -184, 211 if not single else 289, 65,
                  disable_widget=True)
    except KeyError:
        pass
    if confirm:
        path = f"{root_path}/bk/{confirm}"
        try:
            button = p.node(path)
            p.set_active(button, True)
            transparent(p, button, 211, 65, hide_children=True)
            p.set_pos(button, 122, -184, 211, 65, disable_widget=True)
        except KeyError:
            pass


def style_row(prefab: str, fields: tuple[tuple[str, float, float, float], ...],
              hidden: tuple[str, ...] = ()) -> None:
    p = Prefab(f"assets/resources/Prefabs/{prefab}.prefab")
    center_anchor(p, p.root)
    p.set_pos(p.root, 0, -37, 622, 73)
    p.sprite(p.root, "followup_agent_row_exact.png", sliced=True)
    untint(p, p.root)
    for name in hidden:
        try:
            p.set_active(p.node(f"{prefab}/{name}"), False)
        except KeyError:
            pass
    for name, x, y, width in fields:
        path = f"{prefab}/{name}"
        try:
            node = p.node(path)
        except KeyError:
            continue
        p.set_active(node, True)
        style_label(p, path, x=x, y=y, width=width, height=36,
                    size=18, align=1)
        p.data[node]["_color"] = copy.deepcopy(GOLD)
    p.save()


def rows() -> None:
    style_row("玩家对象", (("id", -230, 0, 120), ("name", -77, 0, 145),
                             ("count", 76, 0, 100), ("type", 230, 0, 140)),
              ("垫底长", "time"))
    style_row("贡献对象", (("name", -205, 10, 220), ("id", -205, -14, 220),
                            ("today", 0, 0, 130), ("all", 204, 0, 150)),
              ("垫底长", "分割线"))
    style_row("盟主对象", (("id", -230, 0, 110), ("name", -77, 0, 140),
                            ("玩家数", 76, 0, 90), ("比例", 230, 0, 90)),
              ("line",))
    style_row("总业绩对象", (("id", -230, 0, 110), ("name", -77, 0, 140)),
              ("line",))
    style_row("红利提取记录对象", (("time", -205, 0, 210),
                                    ("count", 0, 0, 150),
                                    ("state", 204, 0, 150)),
              ("分割线",))


def apply() -> None:
    p = Prefab("assets/resources/UI/panelHongli.prefab")
    home(p)
    list_page(p, "我的玩家", "players", 255)
    # The first page only has one real statistic; place it explicitly and hide
    # the unavailable effect-image sample rather than baking fake data.
    place_group_label(p, "panelHongli/我的玩家/统计/下级玩家数量",
                      "panelHongli/我的玩家/统计/下级玩家数量/num",
                      -152, 190, 170, 44, 25)
    list_page(p, "我的业绩", "performance", 335,
              (("总人数", 0), ("今日总贡献", 0), ("累计总贡献", 0)))
    performance_tabs(p)
    list_page(p, "我的盟主", "leader", 255,
              (("今日贡献", 0), ("累计贡献", 0)))
    list_page(p, "总业绩", "total", 255,
              (("昨日贡献", 0), ("所占比例", 0)))
    list_page(p, "提取记录", "bonus_history", 255)
    list_page(p, "奖池提取记录", "pool_history", 255)
    promo(p)

    popup(p, "盟主收益", "leader_income", ("今日收益", "累计收益"), single=True)
    popup(p, "奖池收益", "pool_income",
          ("今日收益", "累计收益", "累计提取", "奖池收益余额"),
          confirm="提取奖池收益")
    popup(p, "大区收益", "region_income", ("今日收益", "累计收益"), single=True)
    popup(p, "总业绩2", "share_income", ("所占比例",), confirm="我的分红")
    popup(p, "添加代理面板", "add_agent", ("msg", "id"), confirm="确认添加代理")
    popup(p, "删除总业绩对象面板", "delete_agent", ("msg", "id"),
          confirm="确认删除总业绩对象")
    popup(p, "提取红利面板", "withdraw_bonus", ("msg", "id"),
          confirm="确认提取红利")
    popup(p, "提取奖池收益面板", "withdraw_bonus", ("msg", "id"),
          confirm="确认提取奖池收益")
    popup(p, "提取分红面板", "share_income", ("msg", "id"),
          confirm="确认提取分红")
    popup(p, "添加盟主面板", "ratio", ("msg", "id", "比例"),
          confirm="确认添加盟主")
    popup(p, "修改盟主面板", "ratio", ("msg", "id", "比例"),
          confirm="确认修改盟主")
    p.save()
    rows()
    print("V7 代理模块 Prefab 已完成")


if __name__ == "__main__":
    apply()
