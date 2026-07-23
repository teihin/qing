#!/usr/bin/env python3
"""Render a deterministic, best-effort preview of the Cocos Creator drh8 scene.

The renderer intentionally reads the serialized scene and the project's real
SpriteFrame source files.  It never opens Creator and never mutates scene,
prefab, meta, or runtime art assets.

Supported visual features:
  * active node hierarchy and sibling draw order
  * translation, z rotation, scale, anchor and cascading opacity
  * optional Creator Sprite SizeMode preload simulation
  * SpriteFrame trim metadata, SIMPLE, SLICED, TILED and FILLED sprites
  * rectangular Mask clipping
  * TTF/system labels and LabelAtlas digits
  * a representative real atlas region for active DragonBones displays

This is not a replacement for Creator runtime validation.  Unsupported and
unresolved components are counted and printed after every run.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:  # pragma: no cover - friendly CLI failure path
    raise SystemExit(
        "Pillow is required. Run this script with the bundled Codex Python, "
        "for example:\n"
        "/Users/yy/.cache/codex-runtimes/codex-primary-runtime/"
        "dependencies/python/bin/python3 tools/render_drh8_scene_preview.py"
    ) from exc


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[1]
DEFAULT_SCENE = REPO_ROOT / "assets" / "Scenes" / "drh8.fire"
DEFAULT_OUTPUT = REPO_ROOT / "art_sources" / "drh8" / "qin_drh8_runtime_preview.png"
DEFAULT_CREATOR_ASSETS = Path(
    "/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/"
    "static/default-assets"
)

Affine = Tuple[float, float, float, float, float, float]
Rect = Tuple[int, int, int, int]


def ref_id(value: Any) -> Optional[int]:
    if isinstance(value, dict) and isinstance(value.get("__id__"), int):
        return value["__id__"]
    return None


def uuid_of(value: Any) -> Optional[str]:
    if isinstance(value, dict) and isinstance(value.get("__uuid__"), str):
        return value["__uuid__"]
    return None


def mat_mul(left: Affine, right: Affine) -> Affine:
    """Return left * right for column-vector affine matrices."""

    la, lb, lc, ld, ltx, lty = left
    ra, rb, rc, rd, rtx, rty = right
    return (
        la * ra + lc * rb,
        lb * ra + ld * rb,
        la * rc + lc * rd,
        lb * rc + ld * rd,
        la * rtx + lc * rty + ltx,
        lb * rtx + ld * rty + lty,
    )


def mat_apply(matrix: Affine, x: float, y: float) -> Tuple[float, float]:
    a, b, c, d, tx, ty = matrix
    return a * x + c * y + tx, b * x + d * y + ty


def mat_inverse(matrix: Affine) -> Optional[Affine]:
    a, b, c, d, tx, ty = matrix
    determinant = a * d - b * c
    if abs(determinant) < 1e-10:
        return None
    inv_det = 1.0 / determinant
    ia = d * inv_det
    ib = -b * inv_det
    ic = -c * inv_det
    identity = a * inv_det
    return (
        ia,
        ib,
        ic,
        identity,
        -(ia * tx + ic * ty),
        -(ib * tx + identity * ty),
    )


def node_local_matrix(node: Dict[str, Any]) -> Affine:
    array = ((node.get("_trs") or {}).get("array") or [])
    if len(array) >= 10:
        x, y = float(array[0]), float(array[1])
        qz, qw = float(array[5]), float(array[6])
        scale_x, scale_y = float(array[7]), float(array[8])
        angle = 2.0 * math.atan2(qz, qw)
    else:
        position = node.get("_position") or {}
        scale = node.get("_scale") or {}
        x, y = float(position.get("x", 0)), float(position.get("y", 0))
        scale_x = float(scale.get("x", 1))
        scale_y = float(scale.get("y", 1))
        angle = math.radians(float(node.get("_rotationZ", 0)))
    cosine, sine = math.cos(angle), math.sin(angle)
    return (
        cosine * scale_x,
        sine * scale_x,
        -sine * scale_y,
        cosine * scale_y,
        x,
        y,
    )


def intersect_rect(left: Optional[Rect], right: Optional[Rect]) -> Optional[Rect]:
    if left is None:
        return right
    if right is None:
        return left
    result = (
        max(left[0], right[0]),
        max(left[1], right[1]),
        min(left[2], right[2]),
        min(left[3], right[3]),
    )
    if result[2] <= result[0] or result[3] <= result[1]:
        return (0, 0, 0, 0)
    return result


def color_tuple(value: Any, default: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
    if not isinstance(value, dict):
        return default
    return tuple(
        max(0, min(255, int(value.get(key, default[index]))))
        for index, key in enumerate(("r", "g", "b", "a"))
    )  # type: ignore[return-value]


@dataclass(frozen=True)
class AssetInfo:
    uuid: str
    path: Path
    meta_path: Path
    importer: str
    meta: Dict[str, Any]
    root_meta: Dict[str, Any]
    is_sub_meta: bool = False
    sub_name: str = ""


class AssetResolver:
    def __init__(self, project_assets: Path, creator_assets: Optional[Path]) -> None:
        self.project_assets = project_assets
        self.creator_assets = creator_assets
        self.by_uuid: Dict[str, AssetInfo] = {}
        self.meta_errors: List[str] = []
        self._scan(project_assets)
        if creator_assets and creator_assets.exists():
            self._scan(creator_assets, only_missing=True)

    def _scan(self, root: Path, only_missing: bool = False) -> None:
        for meta_path in root.rglob("*.meta"):
            if meta_path.name.startswith("._"):
                continue
            parts = set(meta_path.parts)
            if {"library", "temp"} & parts:
                continue
            try:
                root_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                self.meta_errors.append(f"{meta_path}: {exc}")
                continue
            asset_path = Path(str(meta_path)[:-5])
            root_uuid = root_meta.get("uuid")
            if isinstance(root_uuid, str) and (not only_missing or root_uuid not in self.by_uuid):
                self.by_uuid[root_uuid] = AssetInfo(
                    root_uuid,
                    asset_path,
                    meta_path,
                    str(root_meta.get("importer", "")),
                    root_meta,
                    root_meta,
                )
            for sub_name, sub_meta in (root_meta.get("subMetas") or {}).items():
                if not isinstance(sub_meta, dict):
                    continue
                sub_uuid = sub_meta.get("uuid")
                if not isinstance(sub_uuid, str) or (only_missing and sub_uuid in self.by_uuid):
                    continue
                self.by_uuid[sub_uuid] = AssetInfo(
                    sub_uuid,
                    asset_path,
                    meta_path,
                    str(sub_meta.get("importer", "")),
                    sub_meta,
                    root_meta,
                    True,
                    str(sub_name),
                )

    def get(self, uuid: Optional[str]) -> Optional[AssetInfo]:
        return self.by_uuid.get(uuid or "")


class PreviewRenderer:
    def __init__(
        self,
        scene_path: Path,
        output_path: Path,
        creator_assets: Optional[Path],
        background: Tuple[int, int, int, int],
        simulate_creator_size_mode: bool = False,
    ) -> None:
        self.scene_path = scene_path
        self.output_path = output_path
        self.scene: List[Any] = json.loads(scene_path.read_text(encoding="utf-8"))
        self.nodes: Dict[int, Dict[str, Any]] = {
            index: value
            for index, value in enumerate(self.scene)
            if isinstance(value, dict) and value.get("__type__") == "cc.Node"
        }
        self.components_by_node: Dict[int, List[Tuple[int, Dict[str, Any]]]] = {}
        self.component_owner: Dict[int, int] = {}
        for node_id, node in self.nodes.items():
            components: List[Tuple[int, Dict[str, Any]]] = []
            for reference in node.get("_components") or []:
                component_id = ref_id(reference)
                if component_id is None or not (0 <= component_id < len(self.scene)):
                    continue
                component = self.scene[component_id]
                if not isinstance(component, dict):
                    continue
                components.append((component_id, component))
                self.component_owner[component_id] = node_id
            self.components_by_node[node_id] = components

        self.resolver = AssetResolver(REPO_ROOT / "assets", creator_assets)
        self.simulate_creator_size_mode = simulate_creator_size_mode
        self.sprite_size_adjustments: List[Dict[str, Any]] = []
        self.sprite_size_mode_errors: List[str] = []
        if simulate_creator_size_mode:
            self._apply_creator_sprite_size_modes()
        self.width, self.height = self._design_size()
        self.canvas = Image.new("RGBA", (self.width, self.height), background)
        self.image_cache: Dict[Path, Image.Image] = {}
        self.frame_cache: Dict[str, Image.Image] = {}
        self.font_cache: Dict[Tuple[Path, int], ImageFont.FreeTypeFont] = {}
        self.default_font_path = REPO_ROOT / "assets" / "font" / "PingFF.ttf"
        self.stats: Dict[str, int] = {
            "nodes_total": len(self.nodes),
            "nodes_active": 0,
            "nodes_inactive": 0,
            "sprites_total": 0,
            "sprites_rendered": 0,
            "sprites_inactive": 0,
            "sprites_unresolved": 0,
            "sprites_empty": 0,
            "labels_total": 0,
            "labels_rendered": 0,
            "labels_empty": 0,
            "labels_failed": 0,
            "dragonbones_total": 0,
            "dragonbones_rendered": 0,
            "dragonbones_inactive": 0,
            "dragonbones_failed": 0,
            "masks_active": 0,
            "masks_approximate": 0,
            "unsupported_components": 0,
            "sprite_size_mode_applied": len(self.sprite_size_adjustments),
            "sprite_size_nodes_changed": sum(
                bool(adjustment["changed"]) for adjustment in self.sprite_size_adjustments
            ),
            "sprite_size_mode_unresolved": len(self.sprite_size_mode_errors),
        }
        self.unresolved_uuids: Dict[str, int] = {}
        self.unresolved_assets: Dict[str, int] = {}
        self.unsupported_types: Dict[str, int] = {}

    def _design_size(self) -> Tuple[int, int]:
        for node_id, node in self.nodes.items():
            for _, component in self.components_by_node.get(node_id, []):
                if component.get("__type__") == "cc.Canvas":
                    size = node.get("_contentSize") or {}
                    return max(1, round(float(size.get("width", 750)))), max(
                        1, round(float(size.get("height", 1334)))
                    )
        for node in self.nodes.values():
            if node.get("_name") == "Canvas":
                size = node.get("_contentSize") or {}
                return int(round(size.get("width", 750))), int(round(size.get("height", 1334)))
        return 750, 1334

    def node_path(self, node_id: int) -> str:
        names: List[str] = []
        seen: set[int] = set()
        while node_id in self.nodes and node_id not in seen:
            seen.add(node_id)
            node = self.nodes[node_id]
            names.append(str(node.get("_name", "?")))
            parent_id = ref_id(node.get("_parent"))
            if parent_id is None:
                break
            node_id = parent_id
        return "/".join(reversed(names))

    def _apply_creator_sprite_size_modes(self) -> None:
        """Reproduce ``cc.Sprite._applySpriteSize`` against imported metadata.

        Creator 2.4 applies Sprite SizeMode while SpriteFrames are preloaded:
        CUSTOM keeps the serialized node size, TRIMMED uses the frame rectangle,
        and RAW uses the frame's original untrimmed size.  A scene can therefore
        look correct in the editor serialization but expand and overlap at
        runtime when a RAW/TRIMMED SpriteFrame has since been replaced by a
        differently sized source image.
        """

        mode_names = {1: "TRIMMED", 2: "RAW"}
        for node_id, components in self.components_by_node.items():
            node = self.nodes[node_id]
            for component_id, component in components:
                if component.get("__type__") != "cc.Sprite":
                    continue
                size_mode = int(component.get("_sizeMode", 0) or 0)
                if size_mode == 0:
                    continue
                uuid = uuid_of(component.get("_spriteFrame"))
                if not uuid:
                    # Empty SpriteFrames cannot apply a size at preload time.
                    continue
                info = self.resolver.get(uuid)
                if info is None:
                    self.sprite_size_mode_errors.append(
                        f"{self.node_path(node_id)}: cannot resolve SpriteFrame {uuid}"
                    )
                    continue

                meta = info.meta
                root_meta = info.root_meta
                if size_mode == 1:  # TRIMMED: SpriteFrame rect size
                    width = meta.get("width")
                    height = meta.get("height")
                elif size_mode == 2:  # RAW: SpriteFrame originalSize
                    width = meta.get("rawWidth", root_meta.get("width"))
                    height = meta.get("rawHeight", root_meta.get("height"))
                else:
                    self.sprite_size_mode_errors.append(
                        f"{self.node_path(node_id)}: unsupported Sprite SizeMode {size_mode}"
                    )
                    continue

                try:
                    applied_width = float(width)
                    applied_height = float(height)
                except (TypeError, ValueError):
                    self.sprite_size_mode_errors.append(
                        f"{self.node_path(node_id)}: {mode_names[size_mode]} metadata has no size"
                    )
                    continue
                if applied_width <= 0 or applied_height <= 0:
                    self.sprite_size_mode_errors.append(
                        f"{self.node_path(node_id)}: {mode_names[size_mode]} metadata size "
                        f"is {applied_width}x{applied_height}"
                    )
                    continue

                serialized_size = node.get("_contentSize") or {}
                old_width = float(serialized_size.get("width", 0) or 0)
                old_height = float(serialized_size.get("height", 0) or 0)
                changed = (
                    abs(old_width - applied_width) > 1e-6
                    or abs(old_height - applied_height) > 1e-6
                )
                node["_contentSize"] = {
                    "__type__": "cc.Size",
                    "width": applied_width,
                    "height": applied_height,
                }
                try:
                    asset_path = str(info.path.relative_to(REPO_ROOT))
                except ValueError:
                    asset_path = str(info.path)
                self.sprite_size_adjustments.append(
                    {
                        "node_id": node_id,
                        "component_id": component_id,
                        "path": self.node_path(node_id),
                        "uuid": uuid,
                        "asset": asset_path,
                        "mode": mode_names[size_mode],
                        "serialized_size": [old_width, old_height],
                        "applied_size": [applied_width, applied_height],
                        "changed": changed,
                    }
                )

    def _root_nodes(self) -> List[int]:
        return [
            node_id
            for node_id, node in self.nodes.items()
            if ref_id(node.get("_parent")) not in self.nodes
        ]

    def _load_image(self, path: Path) -> Optional[Image.Image]:
        if path in self.image_cache:
            return self.image_cache[path].copy()
        if not path.exists():
            self.unresolved_assets[str(path)] = self.unresolved_assets.get(str(path), 0) + 1
            return None
        try:
            image = Image.open(path).convert("RGBA")
            image.load()
        except (OSError, ValueError) as exc:
            key = f"{path} ({exc})"
            self.unresolved_assets[key] = self.unresolved_assets.get(key, 0) + 1
            return None
        self.image_cache[path] = image
        return image.copy()

    def _load_frame(self, uuid: str) -> Tuple[Optional[Image.Image], Optional[AssetInfo]]:
        if uuid in self.frame_cache:
            return self.frame_cache[uuid].copy(), self.resolver.get(uuid)
        info = self.resolver.get(uuid)
        if info is None:
            self.unresolved_uuids[uuid] = self.unresolved_uuids.get(uuid, 0) + 1
            return None, None
        image = self._load_image(info.path)
        if image is None:
            return None, info
        meta = info.meta
        if info.is_sub_meta:
            raw_width = int(meta.get("rawWidth", info.root_meta.get("width", image.width)) or image.width)
            raw_height = int(meta.get("rawHeight", info.root_meta.get("height", image.height)) or image.height)
            trim_x = int(meta.get("trimX", 0) or 0)
            trim_y = int(meta.get("trimY", 0) or 0)
            trim_width = int(meta.get("width", raw_width) or raw_width)
            trim_height = int(meta.get("height", raw_height) or raw_height)
            if meta.get("rotated"):
                trim_width, trim_height = trim_height, trim_width

            # Source files are normally still raw, but crop/rebuild explicitly so
            # the preview follows SpriteFrame trim metadata and also supports
            # externally cropped source textures.
            if image.width >= trim_x + trim_width and image.height >= trim_y + trim_height:
                trimmed = image.crop((trim_x, trim_y, trim_x + trim_width, trim_y + trim_height))
            elif image.size == (trim_width, trim_height):
                trimmed = image
            else:
                trimmed = image.resize((trim_width, trim_height), Image.Resampling.LANCZOS)
            if meta.get("rotated"):
                trimmed = trimmed.transpose(Image.Transpose.ROTATE_90)
            rebuilt = Image.new("RGBA", (max(1, raw_width), max(1, raw_height)), (0, 0, 0, 0))
            offset_x = trim_x
            offset_y = trim_y
            rebuilt.alpha_composite(trimmed, (offset_x, offset_y))
            image = rebuilt
        self.frame_cache[uuid] = image
        return image.copy(), info

    @staticmethod
    def _resize(image: Image.Image, width: int, height: int) -> Image.Image:
        if image.size == (width, height):
            return image.copy()
        return image.resize((max(1, width), max(1, height)), Image.Resampling.LANCZOS)

    def _nine_slice(self, image: Image.Image, size: Tuple[int, int], info: AssetInfo) -> Image.Image:
        width, height = size
        meta = info.meta
        left = max(0, int(meta.get("borderLeft", 0) or 0))
        right = max(0, int(meta.get("borderRight", 0) or 0))
        top = max(0, int(meta.get("borderTop", 0) or 0))
        bottom = max(0, int(meta.get("borderBottom", 0) or 0))
        source_width, source_height = image.size
        left, right = min(left, source_width), min(right, source_width - min(left, source_width))
        top, bottom = min(top, source_height), min(bottom, source_height - min(top, source_height))
        if not any((left, right, top, bottom)):
            return self._resize(image, width, height)

        if left + right > width and left + right:
            factor = width / float(left + right)
            left, right = round(left * factor), width - round(left * factor)
        if top + bottom > height and top + bottom:
            factor = height / float(top + bottom)
            top, bottom = round(top * factor), height - round(top * factor)

        source_x = (0, left, source_width - right, source_width)
        source_y = (0, top, source_height - bottom, source_height)
        target_x = (0, left, width - right, width)
        target_y = (0, top, height - bottom, height)
        result = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        for row in range(3):
            for column in range(3):
                source_box = (
                    source_x[column],
                    source_y[row],
                    source_x[column + 1],
                    source_y[row + 1],
                )
                target_box = (
                    target_x[column],
                    target_y[row],
                    target_x[column + 1],
                    target_y[row + 1],
                )
                target_width = target_box[2] - target_box[0]
                target_height = target_box[3] - target_box[1]
                if target_width <= 0 or target_height <= 0:
                    continue
                patch = image.crop(source_box)
                if patch.size != (target_width, target_height):
                    patch = patch.resize((target_width, target_height), Image.Resampling.LANCZOS)
                result.alpha_composite(patch, (target_box[0], target_box[1]))
        return result

    @staticmethod
    def _tile(image: Image.Image, size: Tuple[int, int]) -> Image.Image:
        width, height = size
        result = Image.new("RGBA", size, (0, 0, 0, 0))
        for y in range(0, height, max(1, image.height)):
            for x in range(0, width, max(1, image.width)):
                result.alpha_composite(image, (x, y))
        return result

    @staticmethod
    def _filled(image: Image.Image, component: Dict[str, Any]) -> Image.Image:
        fill_type = int(component.get("_fillType", 0) or 0)
        fill_start = float(component.get("_fillStart", 0) or 0)
        fill_range = float(component.get("_fillRange", 0) or 0)
        if abs(fill_range) >= 0.9999:
            return image
        mask = Image.new("L", image.size, 0)
        draw = ImageDraw.Draw(mask)
        width, height = image.size
        if fill_type == 0:  # horizontal
            start = fill_start
            end = fill_start + fill_range
            left, right = sorted((round(start * width), round(end * width)))
            draw.rectangle((left, 0, right, height), fill=255)
        elif fill_type == 1:  # vertical, Cocos origin is bottom-left
            start = height - round(fill_start * height)
            end = height - round((fill_start + fill_range) * height)
            top, bottom = sorted((start, end))
            draw.rectangle((0, top, width, bottom), fill=255)
        else:  # radial approximation using the serialized center
            start_angle = -360.0 * fill_start
            end_angle = start_angle - 360.0 * fill_range
            draw.pieslice((0, 0, width, height), start=min(start_angle, end_angle), end=max(start_angle, end_angle), fill=255)
        alpha = ImageChops.multiply(image.getchannel("A"), mask)
        image.putalpha(alpha)
        return image

    def _sprite_image(
        self,
        component: Dict[str, Any],
        size: Tuple[int, int],
    ) -> Optional[Image.Image]:
        uuid = uuid_of(component.get("_spriteFrame"))
        if not uuid:
            self.stats["sprites_empty"] += 1
            return None
        source, info = self._load_frame(uuid)
        if source is None or info is None:
            self.stats["sprites_unresolved"] += 1
            return None
        sprite_type = int(component.get("_type", 0) or 0)
        if sprite_type == 1:
            result = self._nine_slice(source, size, info)
        elif sprite_type == 2:
            result = self._tile(source, size)
        else:
            result = self._resize(source, size[0], size[1])
        if sprite_type == 3:
            result = self._filled(result, component)
        return result

    @staticmethod
    def _tint(image: Image.Image, color: Tuple[int, int, int, int], opacity: float) -> Image.Image:
        red, green, blue, color_alpha = color
        if (red, green, blue) != (255, 255, 255):
            r, g, b, a = image.split()
            r = r.point(lambda value: value * red // 255)
            g = g.point(lambda value: value * green // 255)
            b = b.point(lambda value: value * blue // 255)
            image = Image.merge("RGBA", (r, g, b, a))
        alpha_factor = max(0.0, min(1.0, opacity * color_alpha / 255.0))
        if alpha_factor < 0.9999:
            image.putalpha(image.getchannel("A").point(lambda value: round(value * alpha_factor)))
        return image

    def _node_to_output(self, world: Affine, width: int, height: int, anchor: Dict[str, Any]) -> Affine:
        anchor_x = float(anchor.get("x", 0.5))
        anchor_y = float(anchor.get("y", 0.5))
        pixel_to_local: Affine = (1, 0, 0, -1, -anchor_x * width, anchor_y * height)
        world_to_output: Affine = (1, 0, 0, -1, 0, self.height)
        return mat_mul(world_to_output, mat_mul(world, pixel_to_local))

    def _rect_for_node(self, node: Dict[str, Any], world: Affine) -> Rect:
        size = node.get("_contentSize") or {}
        width = max(1, round(float(size.get("width", 0) or 0)))
        height = max(1, round(float(size.get("height", 0) or 0)))
        matrix = self._node_to_output(world, width, height, node.get("_anchorPoint") or {})
        corners = [
            mat_apply(matrix, 0, 0),
            mat_apply(matrix, width, 0),
            mat_apply(matrix, width, height),
            mat_apply(matrix, 0, height),
        ]
        return (
            math.floor(min(point[0] for point in corners)),
            math.floor(min(point[1] for point in corners)),
            math.ceil(max(point[0] for point in corners)),
            math.ceil(max(point[1] for point in corners)),
        )

    def _composite_local(
        self,
        local_image: Image.Image,
        node: Dict[str, Any],
        world: Affine,
        clip_rect: Optional[Rect],
    ) -> bool:
        width, height = local_image.size
        matrix = self._node_to_output(world, width, height, node.get("_anchorPoint") or {})
        corners = [
            mat_apply(matrix, 0, 0),
            mat_apply(matrix, width, 0),
            mat_apply(matrix, width, height),
            mat_apply(matrix, 0, height),
        ]
        bounds: Rect = (
            math.floor(min(point[0] for point in corners)),
            math.floor(min(point[1] for point in corners)),
            math.ceil(max(point[0] for point in corners)),
            math.ceil(max(point[1] for point in corners)),
        )
        bounds = intersect_rect(bounds, (0, 0, self.width, self.height)) or (0, 0, 0, 0)
        bounds = intersect_rect(bounds, clip_rect) or (0, 0, 0, 0)
        if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
            return False
        inverse = mat_inverse(matrix)
        if inverse is None:
            return False
        ia, ib, ic, identity, itx, ity = inverse
        offset_x, offset_y = bounds[0], bounds[1]
        transform_data = (
            ia,
            ic,
            itx + ia * offset_x + ic * offset_y,
            ib,
            identity,
            ity + ib * offset_x + identity * offset_y,
        )
        patch = local_image.transform(
            (bounds[2] - bounds[0], bounds[3] - bounds[1]),
            Image.Transform.AFFINE,
            transform_data,
            resample=Image.Resampling.BICUBIC,
        )
        self.canvas.alpha_composite(patch, (bounds[0], bounds[1]))
        return True

    def _font_for_label(self, component: Dict[str, Any], font_size: int) -> ImageFont.ImageFont:
        info = self.resolver.get(uuid_of(component.get("_N$file")))
        path = info.path if info and info.path.suffix.lower() in {".ttf", ".otf"} else self.default_font_path
        if not path.exists():
            return ImageFont.load_default()
        key = (path, font_size)
        if key not in self.font_cache:
            self.font_cache[key] = ImageFont.truetype(str(path), font_size)
        return self.font_cache[key]

    @staticmethod
    def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
        if max_width <= 0:
            return text
        result: List[str] = []
        for original_line in text.splitlines() or [""]:
            current = ""
            for character in original_line:
                candidate = current + character
                box = draw.textbbox((0, 0), candidate, font=font)
                if current and box[2] - box[0] > max_width:
                    result.append(current)
                    current = character
                else:
                    current = candidate
            result.append(current)
        return "\n".join(result)

    def _label_atlas_image(
        self,
        text: str,
        component: Dict[str, Any],
        size: Tuple[int, int],
        info: AssetInfo,
    ) -> Optional[Image.Image]:
        root_meta = info.root_meta
        texture = self.resolver.get(root_meta.get("rawTextureUuid"))
        if texture is None:
            return None
        source = self._load_image(texture.path)
        if source is None:
            return None
        item_width = max(1, int(root_meta.get("itemWidth", 1) or 1))
        item_height = max(1, int(root_meta.get("itemHeight", 1) or 1))
        start_char = str(root_meta.get("startChar", "0") or "0")[0]
        scale = max(0.01, float(component.get("_fontSize", item_height) or item_height) / item_height)
        glyph_width, glyph_height = max(1, round(item_width * scale)), max(1, round(item_height * scale))
        line_width = glyph_width * len(text)
        result = Image.new("RGBA", size, (0, 0, 0, 0))
        horizontal = int(component.get("_N$horizontalAlign", 0) or 0)
        vertical = int(component.get("_N$verticalAlign", 0) or 0)
        x = 0 if horizontal == 0 else (size[0] - line_width) // 2 if horizontal == 1 else size[0] - line_width
        y = 0 if vertical == 0 else (size[1] - glyph_height) // 2 if vertical == 1 else size[1] - glyph_height
        for character in text:
            index = ord(character) - ord(start_char)
            source_x = index * item_width
            if index >= 0 and source_x + item_width <= source.width:
                glyph = source.crop((source_x, 0, source_x + item_width, min(item_height, source.height)))
                glyph = glyph.resize((glyph_width, glyph_height), Image.Resampling.LANCZOS)
                result.alpha_composite(glyph, (x, y))
            x += glyph_width
        return result

    def _label_image(
        self,
        component_id: int,
        component: Dict[str, Any],
        node: Dict[str, Any],
        size: Tuple[int, int],
    ) -> Optional[Image.Image]:
        text = str(component.get("_N$string", component.get("_string", "")) or "")
        if not text:
            self.stats["labels_empty"] += 1
            return None
        file_info = self.resolver.get(uuid_of(component.get("_N$file")))
        if file_info and file_info.importer == "label-atlas":
            atlas = self._label_atlas_image(text, component, size, file_info)
            if atlas is not None:
                return self._tint(
                    atlas,
                    color_tuple(node.get("_color"), (255, 255, 255, 255)),
                    1.0,
                )

        result = Image.new("RGBA", size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(result)
        font_size = max(1, round(float(component.get("_fontSize", 20) or 20)))
        font = self._font_for_label(component, font_size)
        if component.get("_enableWrapText", True):
            text = self._wrap_text(draw, text, font, size[0])
        spacing = max(0, round(float(component.get("_lineHeight", font_size) or font_size) - font_size))

        bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, align="left")
        text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
        horizontal = int(component.get("_N$horizontalAlign", 0) or 0)
        vertical = int(component.get("_N$verticalAlign", 0) or 0)
        x = -bbox[0] if horizontal == 0 else (size[0] - text_width) / 2 - bbox[0] if horizontal == 1 else size[0] - text_width - bbox[0]
        y = -bbox[1] if vertical == 0 else (size[1] - text_height) / 2 - bbox[1] if vertical == 1 else size[1] - text_height - bbox[1]

        node_color = color_tuple(node.get("_color"), (255, 255, 255, 255))
        owner_id = self.component_owner.get(component_id, -1)
        outline = next(
            (
                item
                for _, item in self.components_by_node.get(owner_id, [])
                if item.get("__type__") == "cc.LabelOutline" and item.get("_enabled", True)
            ),
            None,
        )
        shadow = next(
            (
                item
                for _, item in self.components_by_node.get(owner_id, [])
                if item.get("__type__") == "cc.LabelShadow" and item.get("_enabled", True)
            ),
            None,
        )
        stroke_width = int((outline or {}).get("_width", 0) or 0)
        stroke_fill = color_tuple((outline or {}).get("_color"), (0, 0, 0, 255))
        if shadow:
            shadow_layer = Image.new("RGBA", size, (0, 0, 0, 0))
            shadow_draw = ImageDraw.Draw(shadow_layer)
            shadow_offset = shadow.get("_offset") or {}
            shadow_color = color_tuple(shadow.get("_color"), (0, 0, 0, 255))
            shadow_draw.multiline_text(
                (x + float(shadow_offset.get("x", 0)), y - float(shadow_offset.get("y", 0))),
                text,
                font=font,
                fill=shadow_color,
                spacing=spacing,
                align=("left", "center", "right")[max(0, min(2, horizontal))],
            )
            blur = max(0, float(shadow.get("_blur", 0) or 0))
            if blur:
                shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))
            result.alpha_composite(shadow_layer)
            draw = ImageDraw.Draw(result)
        draw.multiline_text(
            (x, y),
            text,
            font=font,
            fill=node_color,
            spacing=spacing,
            align=("left", "center", "right")[max(0, min(2, horizontal))],
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        return result

    def _dragon_image(
        self,
        component: Dict[str, Any],
        node_size: Tuple[int, int],
    ) -> Optional[Image.Image]:
        atlas_info = self.resolver.get(uuid_of(component.get("_N$dragonAtlasAsset")))
        if atlas_info is None or not atlas_info.path.exists():
            return None
        try:
            atlas = json.loads(atlas_info.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        image_path = atlas.get("imagePath")
        if not isinstance(image_path, str):
            return None
        texture = self._load_image(atlas_info.path.parent / image_path)
        if texture is None:
            return None
        sub_textures = atlas.get("SubTexture") or []
        if not sub_textures:
            return None
        priorities = ("db_00000", "fs_001 (4)", "底部手", "顶部手", "zi_00000")
        selected = next(
            (item for name in priorities for item in sub_textures if item.get("name") == name),
            sub_textures[0],
        )
        try:
            x, y = int(selected["x"]), int(selected["y"])
            width, height = int(selected["width"]), int(selected["height"])
        except (KeyError, TypeError, ValueError):
            return None
        crop = texture.crop((x, y, x + width, y + height))
        target_width = node_size[0] if node_size[0] > 1 else int(selected.get("frameWidth", width) or width)
        target_height = node_size[1] if node_size[1] > 1 else int(selected.get("frameHeight", height) or height)
        return self._resize(crop, max(1, target_width), max(1, target_height))

    def _render_component(
        self,
        component_id: int,
        component: Dict[str, Any],
        node: Dict[str, Any],
        world: Affine,
        opacity: float,
        clip_rect: Optional[Rect],
    ) -> None:
        component_type = str(component.get("__type__", ""))
        if not component.get("_enabled", True):
            return
        size_value = node.get("_contentSize") or {}
        width = max(1, round(float(size_value.get("width", 0) or 0)))
        height = max(1, round(float(size_value.get("height", 0) or 0)))
        size = (width, height)

        if component_type == "cc.Sprite":
            self.stats["sprites_total"] += 1
            image = self._sprite_image(component, size)
            if image is None:
                return
            image = self._tint(image, color_tuple(node.get("_color"), (255, 255, 255, 255)), opacity)
            if self._composite_local(image, node, world, clip_rect):
                self.stats["sprites_rendered"] += 1
            return

        if component_type == "cc.Label":
            self.stats["labels_total"] += 1
            try:
                image = self._label_image(component_id, component, node, size)
            except Exception as exc:  # Keep preview generation robust and report it.
                key = f"label {self.node_path(self.component_owner.get(component_id, -1))}: {exc}"
                self.unresolved_assets[key] = self.unresolved_assets.get(key, 0) + 1
                self.stats["labels_failed"] += 1
                return
            if image is None:
                return
            image = self._tint(image, (255, 255, 255, 255), opacity)
            if self._composite_local(image, node, world, clip_rect):
                self.stats["labels_rendered"] += 1
            return

        if component_type == "dragonBones.ArmatureDisplay":
            self.stats["dragonbones_total"] += 1
            image = self._dragon_image(component, size)
            if image is None:
                self.stats["dragonbones_failed"] += 1
                return
            image = self._tint(image, color_tuple(node.get("_color"), (255, 255, 255, 255)), opacity)
            if self._composite_local(image, node, world, clip_rect):
                self.stats["dragonbones_rendered"] += 1
            return

        visual_or_effect_types = {
            "cc.Graphics",
            "cc.ParticleSystem",
            "cc.RichText",
            "cc.MotionStreak",
            "sp.Skeleton",
        }
        if component_type in visual_or_effect_types:
            self.stats["unsupported_components"] += 1
            self.unsupported_types[component_type] = self.unsupported_types.get(component_type, 0) + 1

    def _render_node(
        self,
        node_id: int,
        parent_world: Affine,
        parent_opacity: float,
        parent_clip: Optional[Rect],
        parent_active: bool,
    ) -> None:
        node = self.nodes[node_id]
        active = parent_active and bool(node.get("_active", True))
        if not active:
            self.stats["nodes_inactive"] += 1
            # Count inactive visual components without descending into pixels.
            for _, component in self.components_by_node.get(node_id, []):
                component_type = component.get("__type__")
                if component_type == "cc.Sprite":
                    self.stats["sprites_inactive"] += 1
                elif component_type == "dragonBones.ArmatureDisplay":
                    self.stats["dragonbones_inactive"] += 1
            for child in node.get("_children") or []:
                child_id = ref_id(child)
                if child_id in self.nodes:
                    self._count_inactive_subtree(child_id)
            return

        self.stats["nodes_active"] += 1
        world = mat_mul(parent_world, node_local_matrix(node))
        opacity = parent_opacity * max(0, min(255, int(node.get("_opacity", 255) or 0))) / 255.0

        components = self.components_by_node.get(node_id, [])
        for component_id, component in components:
            self._render_component(component_id, component, node, world, opacity, parent_clip)

        child_clip = parent_clip
        mask_component = next(
            (
                component
                for _, component in components
                if component.get("__type__") == "cc.Mask" and component.get("_enabled", True)
            ),
            None,
        )
        if mask_component is not None:
            self.stats["masks_active"] += 1
            mask_type = int(mask_component.get("_type", 0) or 0)
            if mask_type != 0 or mask_component.get("_N$inverted", False):
                self.stats["masks_approximate"] += 1
            child_clip = intersect_rect(child_clip, self._rect_for_node(node, world))

        for child in node.get("_children") or []:
            child_id = ref_id(child)
            if child_id in self.nodes:
                self._render_node(child_id, world, opacity, child_clip, True)

    def _count_inactive_subtree(self, node_id: int) -> None:
        node = self.nodes[node_id]
        self.stats["nodes_inactive"] += 1
        for _, component in self.components_by_node.get(node_id, []):
            component_type = component.get("__type__")
            if component_type == "cc.Sprite":
                self.stats["sprites_inactive"] += 1
            elif component_type == "dragonBones.ArmatureDisplay":
                self.stats["dragonbones_inactive"] += 1
        for child in node.get("_children") or []:
            child_id = ref_id(child)
            if child_id in self.nodes:
                self._count_inactive_subtree(child_id)

    def render(self) -> None:
        identity: Affine = (1, 0, 0, 1, 0, 0)
        for root_id in self._root_nodes():
            self._render_node(root_id, identity, 1.0, None, True)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.canvas.save(self.output_path, format="PNG", optimize=True)

    def print_report(self) -> None:
        print(f"Rendered: {self.output_path}")
        print(f"Canvas: {self.width}x{self.height}")
        print("Statistics:")
        for key in (
            "nodes_total",
            "nodes_active",
            "nodes_inactive",
            "sprites_total",
            "sprites_rendered",
            "sprites_inactive",
            "sprites_unresolved",
            "sprites_empty",
            "labels_total",
            "labels_rendered",
            "labels_empty",
            "labels_failed",
            "dragonbones_total",
            "dragonbones_rendered",
            "dragonbones_inactive",
            "dragonbones_failed",
            "masks_active",
            "masks_approximate",
            "unsupported_components",
            "sprite_size_mode_applied",
            "sprite_size_nodes_changed",
            "sprite_size_mode_unresolved",
        ):
            print(f"  {key}: {self.stats[key]}")
        if self.unresolved_uuids:
            print("Unresolved UUIDs:")
            for uuid, count in sorted(self.unresolved_uuids.items(), key=lambda item: (-item[1], item[0])):
                print(f"  {count:4d}  {uuid}")
        if self.unresolved_assets:
            print("Unreadable or unresolved assets:")
            for asset, count in sorted(self.unresolved_assets.items(), key=lambda item: (-item[1], item[0])):
                print(f"  {count:4d}  {asset}")
        if self.unsupported_types:
            print("Unsupported active visual component types:")
            for component_type, count in sorted(self.unsupported_types.items()):
                print(f"  {count:4d}  {component_type}")
        if self.resolver.meta_errors:
            print(f"Meta files skipped because they were unreadable: {len(self.resolver.meta_errors)}")
        if self.sprite_size_mode_errors:
            print("Sprite SizeMode simulation errors:")
            for message in self.sprite_size_mode_errors:
                print(f"  {message}")


def parse_color(value: str) -> Tuple[int, int, int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) not in (6, 8):
        raise argparse.ArgumentTypeError("background must be RRGGBB or RRGGBBAA")
    if len(raw) == 6:
        raw += "ff"
    try:
        return tuple(int(raw[index : index + 2], 16) for index in range(0, 8, 2))  # type: ignore[return-value]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("background must be hexadecimal") from exc


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=Path, default=DEFAULT_SCENE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--creator-assets",
        type=Path,
        default=DEFAULT_CREATOR_ASSETS,
        help="optional Creator built-in assets root used to resolve default SpriteFrames",
    )
    parser.add_argument(
        "--background",
        type=parse_color,
        default=(4, 4, 5, 255),
        help="fallback canvas color as RRGGBB or RRGGBBAA",
    )
    parser.add_argument(
        "--simulate-creator-size-mode",
        action="store_true",
        help=(
            "simulate cc.Sprite._applySpriteSize during preload: RAW uses "
            "rawWidth/rawHeight, TRIMMED uses frame width/height, and CUSTOM "
            "keeps the serialized node size"
        ),
    )
    args = parser.parse_args(argv)
    scene = args.scene.resolve()
    output = args.output.resolve()
    creator_assets = args.creator_assets.resolve() if args.creator_assets else None
    if not scene.exists():
        parser.error(f"scene does not exist: {scene}")
    renderer = PreviewRenderer(
        scene,
        output,
        creator_assets,
        args.background,
        simulate_creator_size_mode=args.simulate_creator_size_mode,
    )
    renderer.render()
    renderer.print_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
