#!/usr/bin/env python3
"""Rebuild and statically validate the complete Qin skin used by drh8."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

import generate_qin_drh8_atlases as atlases
import generate_qin_drh8_skin as skin
from render_drh8_scene_preview import (
    DEFAULT_CREATOR_ASSETS,
    DEFAULT_OUTPUT,
    DEFAULT_SCENE,
    PreviewRenderer,
)


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art_sources" / "drh8"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(paths: list[Path]) -> dict[Path, str]:
    return {path: digest(path) for path in paths if path.exists()}


def sprite_meta(path: Path) -> dict:
    data = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    return next(iter(data["subMetas"].values()))


def validate_png_against_meta(path: Path) -> None:
    meta = sprite_meta(path)
    image = Image.open(path).convert("RGBA")
    expected_size = (int(meta["rawWidth"]), int(meta["rawHeight"]))
    if image.size != expected_size:
        raise RuntimeError(f"尺寸与 meta 不一致：{path} {image.size} != {expected_size}")
    expected_bbox = (
        int(meta["trimX"]),
        int(meta["trimY"]),
        int(meta["trimX"]) + int(meta["width"]),
        int(meta["trimY"]) + int(meta["height"]),
    )
    if image.getchannel("A").getbbox() != expected_bbox:
        raise RuntimeError(
            f"透明裁剪与 meta 不一致：{path} "
            f"{image.getchannel('A').getbbox()} != {expected_bbox}"
        )


def render_preview() -> PreviewRenderer:
    renderer = PreviewRenderer(
        DEFAULT_SCENE,
        DEFAULT_OUTPUT,
        DEFAULT_CREATOR_ASSETS,
        (4, 4, 5, 255),
    )
    renderer.render()
    return renderer


def main() -> int:
    protected = [ROOT / "assets" / "Scenes" / "drh8.fire"]
    protected.extend((ROOT / "assets" / "resources" / "Prefabs").glob("*.prefab"))
    protected_before = snapshot(protected)

    first_skin = skin.build()
    first_atlas = atlases.build()
    first_renderer = render_preview()
    art_outputs = [
        ART / "qin_drh8_style_source.png",
        ART / "qin_drh8_asset_sheet.png",
        DEFAULT_OUTPUT,
    ]
    outputs = list(dict.fromkeys(first_skin + first_atlas + art_outputs))
    first_hashes = snapshot(outputs)

    second_skin = skin.build()
    second_atlas = atlases.build()
    second_renderer = render_preview()
    if first_skin != second_skin or first_atlas != second_atlas:
        raise RuntimeError("两次构建返回的资源清单不一致")
    second_hashes = snapshot(outputs)
    changed = [path for path in outputs if first_hashes.get(path) != second_hashes.get(path)]
    if changed:
        raise RuntimeError("重复构建不确定：" + ", ".join(str(path) for path in changed))

    protected_after = snapshot(protected)
    if protected_before != protected_after:
        raise RuntimeError("验证过程中场景或 Prefab 被修改")

    png_outputs = [path for path in dict.fromkeys(first_skin + first_atlas) if path.suffix == ".png"]
    for path in png_outputs:
        validate_png_against_meta(path)

    for renderer in (first_renderer, second_renderer):
        if renderer.stats["sprites_unresolved"] or renderer.stats["labels_failed"]:
            raise RuntimeError("场景预览存在未解析 Sprite 或失败 Label")
        if renderer.stats["unsupported_components"]:
            raise RuntimeError("场景预览存在未支持的活动视觉组件")

    print(f"drh8 黑金换皮静态校验通过：{len(png_outputs)} 张运行 PNG")
    print(f"核心换皮：{len(first_skin)} 张；牌背/图集/补图：{len(first_atlas)} 项")
    print("重复构建：全部哈希一致")
    print("场景/Prefab：验证前后哈希一致")
    print(
        "真实场景预览："
        f"{second_renderer.stats['sprites_rendered']} 个 Sprite、"
        f"{second_renderer.stats['labels_rendered']} 个 Label，"
        "未解析 0"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
