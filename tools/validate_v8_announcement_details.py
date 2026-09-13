#!/usr/bin/env python3
"""Read-only checks for the three static announcement detail pages."""

from pathlib import Path
from PIL import Image

from apply_v7_prefab_skin import Prefab


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets/resources/V7"


def check_page(p: Prefab, page: str, child: str, asset: str) -> None:
    root = p.node(page)
    root_sprite = p.component(root, "cc.Sprite")[1]
    assert root_sprite["_enabled"] is False, f"{page}: root sprite must be disabled"
    background = p.node(f"{page}/V7公告详情长背景")
    assert p.data[background]["_active"] is True, f"{page}: fixed plate missing"
    root_children = [ref["__id__"] for ref in p.data[root]["_children"]]
    assert root_children[:2] == [background, p.node(f"{page}/list")], f"{page}: fixed plate/list order"
    list_node = p.node(f"{page}/list")
    view = p.node(f"{page}/list/view")
    content = p.node(f"{page}/list/view/content")
    art = p.node(f"{page}/list/view/content/{child}")
    _, scroll = p.component(list_node, "cc.ScrollView")
    assert scroll.get("horizontal") is False and scroll.get("vertical") is True
    list_widget = p.component(list_node, "cc.Widget")[1]
    assert list_widget["_top"] == 81, f"{page}: scroll viewport must start below fixed header geometry"
    title_widget = p.component(p.node(f"{page}/title"), "cc.Widget")[1]
    assert title_widget["_enabled"] is True and title_widget["_alignFlags"] == 41 and title_widget["_top"] == 0, f"{page}:公告顶部栏未固定"
    assert p.data[view]["_contentSize"]["width"] == 750 and p.data[view]["_contentSize"]["height"] == 1253, f"{page}: content viewport geometry"
    assert p.data[art]["_active"] is True, f"{page}:正文未激活"
    assert p.data[art]["_trs"]["array"][1] == -700, f"{page}:正文未避开固定头部"
    assert p.data[content]["_contentSize"]["width"] == 750 and p.data[content]["_contentSize"]["height"] == 1800, f"{page}:正文滚动容器尺寸"
    content_widget = p.component(content, "cc.Widget")[1]
    assert content_widget["_enabled"] is True and content_widget["_alignFlags"] == 20, f"{page}:正文未锚定到可视区顶部"
    assert p.data[content]["_contentSize"]["height"] > p.data[view]["_contentSize"]["height"]
    frame = p.component(art, "cc.Sprite")[1]["_spriteFrame"]["__uuid__"]
    fixed_frame = p.component(background, "cc.Sprite")[1]["_spriteFrame"]["__uuid__"]
    # The body and fixed SpriteFrame references must come from the formal split assets.
    import json
    meta = json.loads((ASSET_DIR / f"{asset}.meta").read_text(encoding="utf-8"))
    expected = next(iter(meta["subMetas"].values()))["uuid"]
    assert frame == expected, f"{page}: wrong正文资源"
    fixed_asset = "announcement_detail_plain_bg_v8.png"
    fixed_meta = json.loads((ASSET_DIR / f"{fixed_asset}.meta").read_text(encoding="utf-8"))
    assert fixed_frame == next(iter(fixed_meta["subMetas"].values()))["uuid"], f"{page}: wrong固定背景资源"
    with Image.open(ASSET_DIR / asset) as image:
        assert image.width == 1082 and image.height == 2200
        bbox = image.getchannel("A").getbbox()
        assert bbox is not None and bbox[3] < image.height, f"{page}:正文底部不应带空蓝底"
    with Image.open(ASSET_DIR / fixed_asset) as image:
        assert image.width == 750 and image.height == 1334
    with Image.open(ASSET_DIR / "announcement_detail_nav_v8.png") as image:
        assert image.width == 941 and image.height == 104
    with Image.open(ASSET_DIR / "announcement_detail_nav_v8.png") as image:
        assert image.width == 941 and image.height == 104


def main() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    for page, child, asset in (
        ("公告1", "1", "announcement_detail_rules_body_v8.png"),
        ("公告2", "2", "announcement_detail_bonus_body_v8.png"),
        ("公告5", "1", "announcement_detail_penalty_body_v8.png"),
    ):
        check_page(p, page, child, asset)
    print("V8 announcement detail validation passed")


if __name__ == "__main__":
    main()
