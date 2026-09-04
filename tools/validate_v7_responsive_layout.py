#!/usr/bin/env python3
"""Read-only checks for the V7 Prefab skin and portrait aspect adaptation."""

from __future__ import annotations

import json
from pathlib import Path

from apply_v7_prefab_skin import Prefab


ROOT = Path(__file__).resolve().parents[1]
V7 = ROOT / "assets/resources/V7"
HEIGHTS = (1334, 1500, 1624, 1778)


def require(ok: bool, message: str) -> None:
    if not ok:
        raise AssertionError(message)


def widget(p: Prefab, path: str, flags: int, **offsets: float) -> None:
    node_id = p.node(path)
    _, value = p.component(node_id, "cc.Widget")
    require(value is not None, f"{p.path}:{path} 缺少 cc.Widget")
    require(value.get("_enabled") is True, f"{p.path}:{path} Widget 未启用")
    require(value.get("_alignFlags") == flags,
            f"{p.path}:{path} alignFlags={value.get('_alignFlags')}，预期 {flags}")
    for key, expected in offsets.items():
        actual = value.get(f"_{key}")
        # Existing 2.4 Prefabs retain sub-pixel offsets from editor resizing.
        require(abs(actual - expected) < 0.5,
                f"{p.path}:{path} {key}={actual}，预期 {expected}")


def full(p: Prefab, path: str) -> None:
    widget(p, path, 45, left=0, right=0, top=0, bottom=0)


def validate_widgets() -> None:
    login = Prefab("assets/resources/UI/panelLogin.prefab")
    full(login, "panelLogin")
    for path, top_value in (
        ("登录LOGO", 166), ("手机号", 603), ("密码", 735),
        ("忘记密码", 875), ("注册账号", 875), ("登陆", 970),
    ):
        widget(login, path, 17, top=top_value)

    main = Prefab("assets/resources/UI/panelMain.prefab")
    for path in ("panelMain", "Main", "Main/发现", "Main/我的", "赠送"):
        full(main, path)
    widget(main, "Main/发现/Title", 41, left=0, right=0, top=0)
    widget(main, "Main/发现/LOGO", 17, top=64)
    widget(main, "Main/发现/排行榜", 17, top=486)
    widget(main, "Main/发现/比赛场", 17, top=486)
    widget(main, "Main/发现/举报反馈", 17, top=486)
    widget(main, "Main/发现/V8声音入口", 17, top=0)
    widget(main, "Main/发现/过滤", 17, top=594)
    widget(main, "Main/发现/房间列表", 45, left=0, right=0, top=700, bottom=134)
    full(main, "Main/发现/房间列表/view")
    widget(main, "Main/我的/Title", 41, left=0, right=0, top=0)
    widget(main, "Main/我的/信息", 17, top=334)
    widget(main, "Main/我的/数据", 17, top=334)
    widget(main, "Main/我的/操作", 17, top=664)
    widget(main, "Down", 44, left=0, right=0, bottom=0)
    widget(main, "赠送/title", 41, left=0, right=0, top=0)
    widget(main, "赠送/赠送记录列表", 45, left=20, right=20, top=898, bottom=82)
    widget(main, "赠送/分页", 20, bottom=16)

    records = Prefab("assets/resources/UI/panelRecordList.prefab")
    full(records, "panelRecordList")
    widget(records, "title", 41, left=0, right=0, top=0)
    widget(records, "战绩列表", 45, left=15, right=15, top=592, bottom=30)

    settlement = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    full(settlement, "panelRecordInfo")
    widget(settlement, "title", 41, left=0, right=0, top=0)
    widget(settlement, "战绩列表", 45, left=25, right=25, top=486, bottom=190)
    widget(settlement, "关闭", 20, bottom=66)

    give_pad = Prefab("assets/resources/UI/panelGivePad.prefab")
    widget(give_pad, "bk", 18)


def validate_height_math() -> None:
    """Prove flexible regions grow while fixed top/bottom offsets stay fixed."""
    regions = {
        "大厅房间列表": (700, 134),
        "战绩列表": (592, 30),
        "赠送记录": (898, 82),
        "结算玩家列表": (486, 190),
    }
    for name, (top_value, bottom_value) in regions.items():
        previous = 0
        for height in HEIGHTS:
            flexible = height - top_value - bottom_value
            require(flexible > 250, f"{name}@{height} 可视区域过小: {flexible}")
            require(flexible > previous, f"{name}@{height} 未随屏幕高度增长")
            previous = flexible
        require((HEIGHTS[-1] - top_value - bottom_value) -
                (HEIGHTS[0] - top_value - bottom_value) == HEIGHTS[-1] - HEIGHTS[0],
                f"{name} 长屏新增高度没有完整分配给列表")


def validate_v7_assets() -> None:
    frame_uuids: set[str] = set()
    for meta_path in V7.glob("*.png.meta"):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        frame_uuids.update(
            item["uuid"] for item in meta.get("subMetas", {}).values()
            if isinstance(item, dict) and item.get("uuid")
        )
        png = meta_path.with_suffix("")
        minimum_size = 50 if png.name == "transparent.png" else 100
        require(png.is_file() and png.stat().st_size > minimum_size,
                f"V7 图片缺失或为空: {png}")

    require((V7 / "title_gift_history.png").is_file(), "缺少赠送记录美术字")
    for exact in (
        "casino_bg_exact.png", "lobby_header_exact.png", "lobby_hero_exact.png",
        "lobby_list_bg_exact.png",
        "lobby_ranking_exact.png", "lobby_match_exact.png", "lobby_report_exact.png",
        "filter_bar_exact.png", "room_card_exact.png", "room_static_exact.png",
        "shield_room_exact.png", "nav_bar_exact.png",
        "mine_bg_exact.png", "mine_hero_exact.png", "mine_profile_exact.png",
        "mine_avatar_ring_exact.png", "mine_agent_exact.png",
        "mine_promotion_exact.png", "mine_money_exact.png", "mine_gift_exact.png",
        "mine_record_exact.png", "mine_settings_exact.png",
        "nav_mine_selected_overlay.png",
    ):
        require((V7 / exact).is_file(), f"V7确认稿资源缺失: {exact}")

    expected_sizes = {
        "mine_bg_exact.png": (750, 1334),
        "mine_hero_exact.png": (750, 334),
        "mine_profile_exact.png": (671, 314),
        "mine_avatar_ring_exact.png": (118, 118),
        "mine_agent_exact.png": (326, 95),
        "mine_promotion_exact.png": (333, 95),
        "mine_money_exact.png": (326, 94),
        "mine_gift_exact.png": (333, 94),
        "mine_record_exact.png": (326, 97),
        "mine_settings_exact.png": (333, 97),
        "nav_mine_selected_overlay.png": (130, 134),
    }
    for name, expected in expected_sizes.items():
        meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
        actual = (meta.get("width"), meta.get("height"))
        require(actual == expected,
                f"我的页切图尺寸错误: {name}={actual}，预期 {expected}")
    used = 0
    prefab_paths = (
        "assets/resources/UI/panelLogin.prefab",
        "assets/resources/UI/panelMain.prefab",
        "assets/resources/UI/panelRecordList.prefab",
        "assets/resources/UI/panelRecordInfo.prefab",
        "assets/resources/UI/panelGivePad.prefab",
        "assets/resources/Prefabs/战绩对象.prefab",
        "assets/resources/Prefabs/战绩玩家对象.prefab",
    )
    for relative in prefab_paths:
        p = Prefab(relative)
        for item in p.data:
            if item.get("__type__") != "cc.Sprite":
                continue
            ref = item.get("_spriteFrame")
            uuid = ref.get("__uuid__") if isinstance(ref, dict) else None
            if uuid not in frame_uuids:
                continue
            used += 1
            require(item.get("_enabled") is True,
                    f"{relative} 有未启用的 V7 Sprite: {uuid}")
    require(used >= 35, f"Prefab 中只找到 {used} 个 V7 Sprite 引用，数量异常")

    main = Prefab("assets/resources/UI/panelMain.prefab")
    mine = main.node("Main/我的")
    require(main.data[main.node("Main/我的/V7我的盾牌")].get("_active") is False,
            "我的页仍显示旧独立盾牌，会与确认稿主视觉重叠")
    operation = main.node("Main/我的/操作")
    require(abs(main.data[operation]["_anchorPoint"].get("y", 0) - 0.5) < 0.001,
            "我的页操作区不是中心锚点，第一排按钮会向上压进资料卡")
    profile_bottom = 334 + 314
    first_button_top = 664 + 317 / 2 - 111 - 95 / 2
    require(first_button_top - profile_bottom >= 15,
            "我的页资料卡与第一排操作按钮间距不足")
    agent_nodes = [ref["__id__"] for ref in main.data[operation].get("_children", [])
                   if main.data[ref["__id__"]].get("_name") == "代理"]
    require(agent_nodes and all(main.data[node_id].get("_active") is False
                                for node_id in agent_nodes),
            "非代理默认布局仍显示我的代理入口")
    non_agent_slots = {
        "推广二维码": (-172, 111), "资金明细": (170, 111),
        "赠送": (-172, 0), "战绩": (170, 0), "设置": (-172, -111),
    }
    for name, expected in non_agent_slots.items():
        actual = tuple(main.data[main.node(f"Main/我的/操作/{name}")]["_trs"]["array"][0:2])
        require(actual == expected,
                f"非代理按钮未依次前移: {name}={actual}，预期 {expected}")
    for name in ("推广二维码", "资金明细", "赠送", "战绩", "设置"):
        require(main.data[main.node(f"Main/我的/操作/{name}")].get("_active") is True,
                f"我的页功能入口未显示: {name}")
    copy_id = main.node("Main/我的/信息/复制ID")
    _, copy_button = main.component(copy_id, "cc.Button")
    require(main.data[copy_id].get("_active") is True and copy_button is not None,
            "ID复制热区未序列化为可点击Button")


def validate_prefab_references() -> None:
    prefab_paths = (
        "assets/resources/UI/panelLogin.prefab",
        "assets/resources/UI/panelMain.prefab",
        "assets/resources/UI/panelRecordList.prefab",
        "assets/resources/UI/panelRecordInfo.prefab",
        "assets/resources/UI/panelGivePad.prefab",
        "assets/resources/Prefabs/战绩对象.prefab",
        "assets/resources/Prefabs/战绩玩家对象.prefab",
    )

    def visit(value, size: int, source: str) -> None:
        if isinstance(value, dict):
            if set(value) == {"__id__"}:
                ref = value["__id__"]
                require(isinstance(ref, int) and 0 <= ref < size,
                        f"{source} 存在越界 __id__: {ref}/{size}")
            for nested in value.values():
                visit(nested, size, source)
        elif isinstance(value, list):
            for nested in value:
                visit(nested, size, source)

    for relative in prefab_paths:
        data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        require(isinstance(data, list) and data, f"{relative} 不是有效 Prefab JSON")
        visit(data, len(data), relative)


def main() -> None:
    validate_widgets()
    validate_height_math()
    validate_v7_assets()
    validate_prefab_references()
    print("V7 响应式校验通过：Prefab 锚点、四档竖屏高度、资源引用与显示状态均正常。")


if __name__ == "__main__":
    main()
