#!/usr/bin/env python3
"""Read-only validation for the V7 startup and loading prefabs."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
V7 = ROOT / "assets/resources/V7"


def frame_uuid(name: str) -> str:
    meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][Path(name).stem]["uuid"]


class CheckPrefab:
    def __init__(self, relative: str):
        self.path = ROOT / relative
        self.data = json.loads(self.path.read_text(encoding="utf-8"))
        self.root = next(i for i, obj in enumerate(self.data)
                         if obj.get("__type__") == "cc.Node" and obj.get("_parent") is None)

    def node(self, path: str) -> int:
        parts = [part for part in path.split("/") if part]
        current = self.root
        if parts and self.data[current].get("_name") == parts[0]:
            parts.pop(0)
        for part in parts:
            children = [ref["__id__"] for ref in self.data[current].get("_children", [])]
            current = next(node for node in children if self.data[node].get("_name") == part)
        return current

    def component(self, node_id: int, type_name: str):
        for ref in self.data[node_id].get("_components", []):
            comp = self.data[ref["__id__"]]
            if comp.get("__type__") == type_name:
                return comp
        raise AssertionError(f"{self.path.name}: {self.data[node_id].get('_name')} missing {type_name}")

    def assert_sprite(self, path: str, asset: str, *, sliced: bool | None = None) -> None:
        node = self.node(path)
        sprite = self.component(node, "cc.Sprite")
        assert sprite.get("_enabled", True), f"{path} Sprite disabled"
        assert sprite.get("_spriteFrame", {}).get("__uuid__") == frame_uuid(asset), (path, asset)
        if sliced is not None:
            assert sprite.get("_type") == (1 if sliced else 0), (path, sprite.get("_type"))


def check_assets() -> None:
    sizes = {
        "startup_title_exact.png": (430, 68),
        "startup_subtitle_exact.png": (520, 36),
        "startup_tip_exact.png": (420, 38),
        "startup_progress_track_exact.png": (600, 30),
        "startup_progress_fill_exact.png": (594, 20),
        "startup_loading_ring_exact.png": (160, 160),
        "startup_retry_panel_exact.png": (560, 360),
        "startup_retry_button_exact.png": (300, 84),
        "startup_loading_card_exact.png": (260, 210),
    }
    for name, expected in sizes.items():
        path = V7 / name
        assert path.exists() and path.with_suffix(path.suffix + ".meta").exists(), name
        with Image.open(path) as image:
            assert image.size == expected, (name, image.size)

    splash = ROOT / "build-templates/web-mobile/splash.png"
    with Image.open(splash) as image:
        assert image.size == (256, 256)
        assert image.mode == "RGBA"
        assert image.getchannel("A").getbbox() is not None


def check_update() -> None:
    p = CheckPrefab("assets/resources/UI/panelUpdate.prefab")
    root_sprite = p.component(p.root, "cc.Sprite")
    assert root_sprite["_enabled"] is False
    children = [ref["__id__"] for ref in p.data[p.root]["_children"]]
    assert p.data[children[0]]["_name"] == "V7启动背景"
    p.assert_sprite("V7启动背景", "announcement_detail_bg_long_exact.png", sliced=False)
    p.assert_sprite("V7启动盾牌", "shield_hd.png", sliced=False)
    p.assert_sprite("V7启动标题", "startup_title_exact.png", sliced=False)
    p.assert_sprite("V7启动副标题", "startup_subtitle_exact.png", sliced=False)
    p.assert_sprite("V7启动分隔", "register_header_rule_exact.png", sliced=False)
    p.assert_sprite("V7启动安全提示", "startup_tip_exact.png", sliced=False)
    p.assert_sprite("bk/大小进度", "startup_progress_track_exact.png", sliced=True)
    p.assert_sprite("bk/大小进度/bar", "startup_progress_fill_exact.png", sliced=True)
    p.assert_sprite("网络异常/bk", "startup_retry_panel_exact.png", sliced=True)
    p.assert_sprite("网络异常/bk/重试", "startup_retry_button_exact.png", sliced=False)

    bg = p.data[p.node("V7启动背景")]
    assert bg["_contentSize"] == {"__type__": "cc.Size", "width": 750, "height": 1800}
    assert bg["_anchorPoint"]["y"] == 1
    logo = p.data[p.node("V7启动盾牌")]
    assert logo["_contentSize"]["width"] == 340 and logo["_contentSize"]["height"] == 358

    visible = p.node("bk/大小进度")
    hidden = p.node("bk/文件进度")
    assert p.data[visible]["_active"] is True
    assert p.data[hidden]["_active"] is False
    assert p.component(visible, "cc.ProgressBar")["_N$totalLength"] == 594
    assert p.data[p.node("bk/日志")]["_opacity"] == 255

    custom = next(obj for obj in p.data if obj.get("__type__") == "1c6efTd2s1HEq4QL3AGA5m0")
    assert p.data[custom["fileLabel"]["__id__"]]["node"]["__id__"] == p.node("bk/大小进度/大小计数")
    assert p.data[custom["byteLabel"]["__id__"]]["node"]["__id__"] == p.node("bk/文件进度/文件计数")
    # Current project contract deliberately points byteProgressNode to the
    # visible 大小进度 and fileProgressNode to hidden 文件进度.
    assert custom["fileProgressNode"]["__id__"] == p.node("bk/文件进度")
    assert custom["byteProgressNode"]["__id__"] == p.node("bk/大小进度")
    assert custom["info"]["__id__"] == p.data[p.node("bk/日志")]["_components"][0]["__id__"]
    assert p.data[p.node("启动动画")]["_active"] is False


def check_overlay() -> None:
    p = CheckPrefab("assets/resources/UI/panelLoading.prefab")
    assert p.component(p.root, "cc.Sprite")["_enabled"] is False
    p.assert_sprite("msk/V7加载底板", "startup_loading_card_exact.png", sliced=True)
    p.assert_sprite("msk/loading", "startup_loading_ring_exact.png", sliced=False)
    assert p.data[p.node("msk/label")]["_active"] is True
    label = p.component(p.node("msk/label"), "cc.Label")
    assert label["_string"] == "加载中…" and label["_fontSize"] == 26
    children = [ref["__id__"] for ref in p.data[p.node("msk")]["_children"]]
    assert p.data[children[0]]["_name"] == "V7加载底板"


def main() -> None:
    check_assets()
    check_update()
    check_overlay()
    print("V7 startup/loading validation passed")


if __name__ == "__main__":
    main()
