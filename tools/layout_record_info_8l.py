#!/usr/bin/env python3
"""Apply the approved 8L battle-detail composition to the Cocos prefab.

The script only changes presentation values and the four honor portrait-frame
SpriteFrames. Node names, hierarchy, buttons, script components and data paths
stay intact so ``panelRecordInfo.ts`` continues to work without special cases.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelRecordInfo.prefab"
HONOR_FRAME_UUID = "b0006eea-f516-4a53-9c4d-c88d17fd23c7"


def load_prefab() -> list[dict]:
    return json.loads(PREFAB.read_text(encoding="utf-8"))


def node_paths(document: list[dict]) -> dict[str, int]:
    nodes = {
        index: item
        for index, item in enumerate(document)
        if isinstance(item, dict) and item.get("__type__") == "cc.Node"
    }

    def resolve(index: int) -> str:
        names: list[str] = []
        visited: set[int] = set()
        while index in nodes and index not in visited:
            visited.add(index)
            node = nodes[index]
            names.append(node["_name"])
            parent = (node.get("_parent") or {}).get("__id__")
            if parent is None:
                break
            index = parent
        return "/".join(reversed(names))

    return {resolve(index): index for index in nodes}


def set_transform(node: dict, *, x: float | None = None, y: float | None = None,
                  scale_x: float | None = None, scale_y: float | None = None) -> None:
    values = node["_trs"]["array"]
    if x is not None:
        values[0] = x
    if y is not None:
        values[1] = y
    if scale_x is not None:
        values[7] = scale_x
    if scale_y is not None:
        values[8] = scale_y
    values[9] = 1


def set_label(document: list[dict], node: dict, *, font_size: int,
              line_height: int, color: tuple[int, int, int]) -> None:
    node["_color"].update({"r": color[0], "g": color[1], "b": color[2], "a": 255})
    for ref in node.get("_components", []):
        component = document[ref["__id__"]]
        if component.get("__type__") == "cc.Label":
            component["_fontSize"] = font_size
            component["_lineHeight"] = line_height
            return
    raise RuntimeError(f"missing cc.Label on {node.get('_name')}")


def widget_component(document: list[dict], node: dict) -> dict:
    for ref in node.get("_components", []):
        component = document[ref["__id__"]]
        if component.get("__type__") == "cc.Widget":
            return component
    raise RuntimeError(f"missing cc.Widget on {node.get('_name')}")


def sprite_component(document: list[dict], node: dict) -> dict:
    for ref in node.get("_components", []):
        component = document[ref["__id__"]]
        if component.get("__type__") == "cc.Sprite":
            return component
    raise RuntimeError(f"missing cc.Sprite on {node.get('_name')}")


def apply_layout(document: list[dict]) -> None:
    paths = node_paths(document)

    required = [
        "panelRecordInfo/title/战局详情",
        "panelRecordInfo/title/牌局回顾",
        "panelRecordInfo/title/牌局回顾/pjhg",
        "panelRecordInfo/排行",
        "panelRecordInfo/基本",
        "panelRecordInfo/扩展",
        "panelRecordInfo/战绩列表",
    ]
    required.extend(f"panelRecordInfo/排行/{honor}" for honor in ("土豪", "MVP", "大鱼", "劳模"))
    missing = [path for path in required if path not in paths]
    if missing:
        raise RuntimeError(f"prefab hierarchy changed; missing: {missing}")

    # The art title and the review action use the same visual proportions as
    # the approved sheet. Their hit targets remain generous and unchanged in
    # behavior.
    set_transform(document[paths["panelRecordInfo/title/战局详情"]], scale_x=2.08, scale_y=2.08)
    review_button = document[paths["panelRecordInfo/title/牌局回顾"]]
    review_button["_contentSize"].update({"width": 220, "height": 90})
    set_transform(review_button, x=275, y=1)
    set_transform(document[paths["panelRecordInfo/title/牌局回顾/pjhg"]], x=0, y=0, scale_x=1.65, scale_y=1.65)

    # Match the direction sheet vertically: a large honor showcase, followed
    # by room information, aggregate statistics, then the scrollable rows.
    ranking = document[paths["panelRecordInfo/排行"]]
    set_transform(ranking, y=330)
    widget_component(document, ranking)["_top"] = 153.5

    honor_positions = {
        "土豪": (-232, 40),
        "MVP": (-77, 40),
        "大鱼": (77, 40),
        "劳模": (232, 40),
    }
    for honor, (x, y) in honor_positions.items():
        prefix = f"panelRecordInfo/排行/{honor}"
        root = document[paths[prefix]]
        root["_opacity"] = 255
        set_transform(root, x=x, y=y, scale_x=0.84, scale_y=0.84)
        sprite_component(document, root)["_spriteFrame"] = {"__uuid__": HONOR_FRAME_UUID}

        badge = document[paths[f"{prefix}/th"]]
        set_transform(badge, x=0, y=-78, scale_x=1.15, scale_y=1.15)

        name = document[paths[f"{prefix}/name"]]
        set_transform(name, x=0, y=-145, scale_x=1, scale_y=1)
        set_label(document, name, font_size=24, line_height=26, color=(205, 226, 235))

        mask = document[paths[f"{prefix}/mask"]]
        set_transform(mask, x=0, y=-1)

    room_info = document[paths["panelRecordInfo/基本"]]
    set_transform(room_info, y=120, scale_x=1.05, scale_y=1)
    room_name = document[paths["panelRecordInfo/基本/房间名"]]
    set_label(document, room_name, font_size=21, line_height=23, color=(73, 205, 219))
    time_label = document[paths["panelRecordInfo/基本/时长"]]
    set_label(document, time_label, font_size=20, line_height=22, color=(179, 207, 218))

    aggregate = document[paths["panelRecordInfo/扩展"]]
    set_transform(aggregate, y=32, scale_x=0.98, scale_y=1)
    for leaf in ("底皮", "奖池", "总手数", "总带入"):
        path = f"panelRecordInfo/扩展/{leaf}"
        node = document[paths[path]]
        color = (225, 237, 242) if leaf != "奖池" else (97, 213, 218)
        set_label(document, node, font_size=22, line_height=24, color=color)

    record_list = document[paths["panelRecordInfo/战绩列表"]]
    record_list["_contentSize"]["height"] = 655
    set_transform(record_list, y=-346.2)
    list_widget = widget_component(document, record_list)
    list_widget["_top"] = 680
    list_widget["_bottom"] = -1


def main() -> None:
    document = load_prefab()
    apply_layout(document)
    PREFAB.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"updated layout: {PREFAB.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
