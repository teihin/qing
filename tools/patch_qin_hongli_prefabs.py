#!/usr/bin/env python3
"""Apply the non-layout Qin visual bindings for panelHongli.

The resource generator replaces PNG pixels in place.  This companion patcher
only adjusts text colours and two missing/outdated SpriteFrame bindings while
preserving the Creator 2.4.13 JSON formatting, node order and business paths.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "assets" / "resources" / "UI" / "panelHongli.prefab"
PREFABS = [
    PANEL,
    ROOT / "assets" / "resources" / "Prefabs" / "玩家对象.prefab",
    ROOT / "assets" / "resources" / "Prefabs" / "盟主对象.prefab",
    ROOT / "assets" / "resources" / "Prefabs" / "贡献对象.prefab",
    ROOT / "assets" / "resources" / "Prefabs" / "总业绩对象.prefab",
    ROOT / "assets" / "resources" / "Prefabs" / "红利提取记录对象.prefab",
]

PROMOTION_BACKGROUND_OLD = "0fc9e589-d9d0-4371-90ba-38bf212e0b54"
PROMOTION_BACKGROUND_NEW = "6be6ddd4-59de-4a8d-af01-ef99c7dda714"
LEADER_BADGE_SPRITEFRAME = "7c3dc7c0-5a97-4307-9ac3-d58e0d3a1a23"
LEADER_BADGE_FALLBACK = "b63ac6c4-0e13-4b55-ac53-9274aade6f59"

IVORY = (231, 215, 184, 255)
GOLD_HI = (240, 212, 154, 255)
MUTED_GOLD = (157, 144, 123, 255)
COPPER_RED = (198, 107, 79, 255)
SUCCESS_GREEN = (92, 156, 111, 255)

LABEL_TYPES = {"cc.Label", "cc.LabelAtlas", "cc.RichText"}


def top_level_spans(text: str) -> list[tuple[int, int]]:
    """Return raw character spans for every item in a top-level JSON array."""
    decoder = json.JSONDecoder()
    position = text.find("[") + 1
    spans: list[tuple[int, int]] = []
    while True:
        while position < len(text) and text[position] in " \t\r\n,":
            position += 1
        if position >= len(text) or text[position] == "]":
            break
        _, end = decoder.raw_decode(text, position)
        spans.append((position, end))
        position = end
    return spans


def node_paths(data: list[dict]) -> dict[int, str]:
    nodes = {index: item for index, item in enumerate(data) if item.get("__type__") == "cc.Node"}

    def make_path(index: int) -> str:
        parts: list[str] = []
        visited: set[int] = set()
        while index in nodes and index not in visited:
            visited.add(index)
            node = nodes[index]
            parts.append(node.get("_name", "?"))
            parent = node.get("_parent")
            if not isinstance(parent, dict) or "__id__" not in parent:
                break
            index = parent["__id__"]
        return "/".join(reversed(parts))

    return {index: make_path(index) for index in nodes}


def components_for_node(data: list[dict], node: dict) -> list[tuple[int, dict]]:
    result: list[tuple[int, dict]] = []
    for reference in node.get("_components", []):
        component_id = reference.get("__id__")
        if isinstance(component_id, int) and 0 <= component_id < len(data):
            result.append((component_id, data[component_id]))
    return result


def desired_colour(path: str, strings: list[str], old: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    joined = " ".join(strings)
    leaf = path.rsplit("/", 1)[-1]

    if leaf == "PLACEHOLDER_LABEL":
        return MUTED_GOLD
    if leaf == "state":
        return SUCCESS_GREEN
    if "*注意" in joined or path.endswith("操作/我的盟主/我的比例"):
        return COPPER_RED

    # Amounts, identifiers and page indicators carry the brighter gold accent.
    accent_leaf_names = {
        "num", "id", "页码", "今日红利", "昨日红利", "前日红利",
        "今日收益", "累计收益", "累计提取", "奖池收益余额", "所占比例",
    }
    if leaf in accent_leaf_names or path.endswith("/用户ID/TEXT_LABEL"):
        return GOLD_HI

    r, g, b, _ = old
    if b > r + 35 or g > r + 60 or (r > 220 and g > 220 and b < 80):
        return GOLD_HI
    if r > 220 and g < 80 and b < 80:
        return COPPER_RED
    if g > 210 and r < 100:
        return COPPER_RED
    if r >= 230 and g >= 210 and b < 180:
        return GOLD_HI
    return IVORY


COLOR_PATTERN = re.compile(
    r'("_color":\s*\{\s*"__type__":\s*"cc\.Color",\s*"r":\s*)\d+'
    r'(,\s*"g":\s*)\d+(,\s*"b":\s*)\d+(,\s*"a":\s*)\d+(\s*\})',
    re.DOTALL,
)


def replace_node_colour(segment: str, colour: tuple[int, int, int, int]) -> str:
    match = COLOR_PATTERN.search(segment)
    if not match:
        raise RuntimeError("cc.Node colour block was not found")
    r, g, b, a = colour
    replacement = f"{match.group(1)}{r}{match.group(2)}{g}{match.group(3)}{b}{match.group(4)}{a}{match.group(5)}"
    return segment[: match.start()] + replacement + segment[match.end() :]


def patch_text_colours(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    data = json.loads(text)
    spans = top_level_spans(text)
    if len(spans) != len(data):
        raise RuntimeError(f"Top-level span mismatch in {path}")
    paths = node_paths(data)
    replacements: list[tuple[int, int, str]] = []

    for index, node in enumerate(data):
        if node.get("__type__") != "cc.Node":
            continue
        strings: list[str] = []
        label_found = False
        for _, component in components_for_node(data, node):
            if component.get("__type__") in LABEL_TYPES:
                label_found = True
                strings.append(component.get("_N$string", component.get("_string", "")) or "")
        if not label_found:
            continue
        old_color_data = node.get("_color", {})
        old = tuple(int(old_color_data.get(channel, 255)) for channel in ("r", "g", "b", "a"))
        new = desired_colour(paths[index], strings, old)
        start, end = spans[index]
        replacement = replace_node_colour(text[start:end], new)
        if replacement != text[start:end]:
            replacements.append((start, end, replacement))

    for start, end, replacement in reversed(replacements):
        text = text[:start] + replacement + text[end:]
    json.loads(text)
    path.write_text(text, encoding="utf-8")
    return len(replacements)


def patch_sprite_bindings() -> tuple[int, int]:
    panel_text = PANEL.read_text(encoding="utf-8")
    old_count = panel_text.count(PROMOTION_BACKGROUND_OLD)
    new_count = panel_text.count(PROMOTION_BACKGROUND_NEW)
    if old_count == 1:
        panel_text = panel_text.replace(PROMOTION_BACKGROUND_OLD, PROMOTION_BACKGROUND_NEW, 1)
    elif new_count != 1:
        raise RuntimeError("Could not uniquely identify the promotion background binding")
    json.loads(panel_text)
    PANEL.write_text(panel_text, encoding="utf-8")

    leader = ROOT / "assets" / "resources" / "Prefabs" / "盟主对象.prefab"
    text = leader.read_text(encoding="utf-8")
    data = json.loads(text)
    target_component_id: int | None = None
    for node in data:
        if node.get("__type__") != "cc.Node" or node.get("_name") != "type":
            continue
        for component_id, component in components_for_node(data, node):
            if component.get("__type__") == "cc.Sprite":
                target_component_id = component_id
                break
    if target_component_id is None:
        raise RuntimeError("盟主对象/type Sprite component was not found")

    spans = top_level_spans(text)
    start, end = spans[target_component_id]
    segment = text[start:end]
    expected = '"_spriteFrame": null'
    already = f'"_spriteFrame": {{\n      "__uuid__": "{LEADER_BADGE_SPRITEFRAME}"\n    }}'
    if expected in segment:
        segment = segment.replace(expected, already, 1)
        text = text[:start] + segment + text[end:]
    elif LEADER_BADGE_FALLBACK in segment:
        segment = segment.replace(LEADER_BADGE_FALLBACK, LEADER_BADGE_SPRITEFRAME, 1)
        text = text[:start] + segment + text[end:]
    elif LEADER_BADGE_SPRITEFRAME not in segment:
        raise RuntimeError("盟主对象/type has an unexpected SpriteFrame binding")
    json.loads(text)
    leader.write_text(text, encoding="utf-8")
    return old_count, 1


def main() -> None:
    colour_total = 0
    for prefab in PREFABS:
        colour_total += patch_text_colours(prefab)
    promotion_count, badge_count = patch_sprite_bindings()
    print(f"Updated {colour_total} label colours across {len(PREFABS)} prefabs")
    print(f"Promotion background bindings changed: {promotion_count}")
    print(f"Leader badge bindings present: {badge_count}")


if __name__ == "__main__":
    main()
