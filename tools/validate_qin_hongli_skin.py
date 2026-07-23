#!/usr/bin/env python3
"""Read-only static validation for the Qin skin used by ``panelHongli``.

The validator deliberately does not call the generator's build functions and
does not write previews or runtime assets.  It checks the serialized UI
contracts, the generator target boundary, and every generated PNG against its
existing Creator 2.4.13 metadata.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
GENERATOR = ROOT / "tools" / "generate_qin_hongli_skin.py"
PANEL = ASSETS / "resources" / "UI" / "panelHongli.prefab"

ITEM_PREFABS = (
    ASSETS / "resources" / "Prefabs" / "玩家对象.prefab",
    ASSETS / "resources" / "Prefabs" / "贡献对象.prefab",
    ASSETS / "resources" / "Prefabs" / "红利提取记录对象.prefab",
    ASSETS / "resources" / "Prefabs" / "盟主对象.prefab",
    ASSETS / "resources" / "Prefabs" / "总业绩对象.prefab",
)

TARGET_DIRS = (
    ASSETS / "ImagesLuck" / "代理",
    ASSETS / "ImagesXYPK" / "代理",
)

SHARED_DIRS = (
    ASSETS / "ImagesLuck" / "公用",
    ASSETS / "ImagesLuck" / "公用1",
    ASSETS / "imagesKK" / "公用",
)

EXPECTED_PROMOTION_BACKGROUND_UUID = "6be6ddd4-59de-4a8d-af01-ef99c7dda714"
EXPECTED_MENGZHU_TYPE_UUID = "7c3dc7c0-5a97-4307-9ac3-d58e0d3a1a23"
EXPECTED_GENERATOR_TARGET_COUNT = 58

EXPECTED_LABEL_COLOURS = {
    (231, 215, 184, 255),  # ivory body text
    (240, 212, 154, 255),  # bright gold values and identifiers
    (157, 144, 123, 255),  # muted placeholder text
    (198, 107, 79, 255),   # copper-red warning/accent
    (92, 156, 111, 255),   # restrained success state
}
LABEL_COMPONENT_TYPES = {"cc.Label", "cc.LabelAtlas", "cc.RichText"}

# Creator's built-in single-color SpriteFrame used for masks and empty list
# surfaces; it has no project-side .meta file by design.
ALLOWED_EXTERNAL_SPRITEFRAME_UUIDS = {
    "a23235d1-15db-4b95-8439-a2e005bfff91",
}

EXPECTED_UUID_ASSETS = {
    EXPECTED_PROMOTION_BACKGROUND_UUID: ASSETS / "ImagesXYPK" / "推广" / "背景.png",
    EXPECTED_MENGZHU_TYPE_UUID: ASSETS / "ImagesLuck" / "代理" / "盟主徽标.png",
}

EXPECTED_ASSET_SIZES = {
    (ASSETS / "ImagesLuck" / "代理" / "盟主徽标.png").resolve(): (82, 27),
}

KEY_NODE_PATHS = {
    PANEL: (
        "panelHongli/bg",
        "panelHongli/title/关闭",
        "panelHongli/title/代理标题",
        "panelHongli/红利余额/num",
        "panelHongli/统计/累计总红利/num",
        "panelHongli/统计/累计总提取/num",
        "panelHongli/统计/提取红利",
        "panelHongli/操作/我的玩家",
        "panelHongli/操作/我的业绩",
        "panelHongli/操作/我的盟主",
        "panelHongli/操作/提取记录",
        "panelHongli/操作/推广",
        "panelHongli/操作/总业绩",
        "panelHongli/我的玩家/列表",
        "panelHongli/我的盟主/列表",
        "panelHongli/总业绩/列表",
        "panelHongli/我的业绩/列表",
        "panelHongli/提取记录/列表",
        "panelHongli/奖池提取记录/列表",
        "panelHongli/提取红利面板/bk",
        "panelHongli/提取奖池收益面板/bk",
        "panelHongli/添加盟主面板/bk/比例",
        "panelHongli/推广二维码",
        "panelHongli/推广二维码/二维码/img",
    ),
    ITEM_PREFABS[0]: (
        "玩家对象/垫底长",
        "玩家对象/id",
        "玩家对象/name",
        "玩家对象/count",
        "玩家对象/time",
        "玩家对象/type",
        "玩家对象/授权代理",
    ),
    ITEM_PREFABS[1]: (
        "贡献对象/垫底长",
        "贡献对象/id",
        "贡献对象/name",
        "贡献对象/today",
        "贡献对象/all",
        "贡献对象/分割线",
    ),
    ITEM_PREFABS[2]: (
        "红利提取记录对象/time",
        "红利提取记录对象/count",
        "红利提取记录对象/state",
        "红利提取记录对象/分割线",
    ),
    ITEM_PREFABS[3]: (
        "盟主对象/id",
        "盟主对象/name",
        "盟主对象/玩家数",
        "盟主对象/比例",
        "盟主对象/type",
        "盟主对象/授权盟主",
        "盟主对象/line",
        "盟主对象/设置盟主",
    ),
    ITEM_PREFABS[4]: (
        "总业绩对象/id",
        "总业绩对象/name",
        "总业绩对象/删除授权总业绩",
        "总业绩对象/删除授权总业绩/btn_4",
        "总业绩对象/line",
    ),
}


def relative(path: Path) -> str:
    """Return a stable project-relative path for diagnostics."""

    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def ref_id(value: Any) -> int | None:
    if isinstance(value, dict) and isinstance(value.get("__id__"), int):
        return value["__id__"]
    return None


def uuid_of(value: Any) -> str | None:
    if isinstance(value, dict) and isinstance(value.get("__uuid__"), str):
        return value["__uuid__"]
    return None


def iter_serialized_ids(value: Any) -> Iterable[int]:
    if isinstance(value, dict):
        identifier = value.get("__id__")
        if isinstance(identifier, int):
            yield identifier
        for child in value.values():
            yield from iter_serialized_ids(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_serialized_ids(child)


class PrefabDocument:
    """Small structural reader for Creator's JSON-array prefab format."""

    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Prefab JSON 无法读取：{relative(path)} ({exc})") from exc
        if not isinstance(data, list) or not data:
            raise RuntimeError(f"Prefab JSON 根结构异常：{relative(path)}")
        self.data: list[Any] = data
        self.nodes: dict[int, dict[str, Any]] = {
            index: value
            for index, value in enumerate(data)
            if isinstance(value, dict) and value.get("__type__") == "cc.Node"
        }
        if not self.nodes:
            raise RuntimeError(f"Prefab 不含 cc.Node：{relative(path)}")

        for identifier in iter_serialized_ids(data):
            if not 0 <= identifier < len(data):
                raise RuntimeError(
                    f"Prefab 存在越界 __id__ 引用：{relative(path)} -> {identifier}"
                )

        roots = [
            identifier
            for identifier, node in self.nodes.items()
            if ref_id(node.get("_parent")) is None
        ]
        if len(roots) != 1:
            raise RuntimeError(
                f"Prefab 根节点数量异常：{relative(path)} -> {len(roots)}"
            )
        self.root_id = roots[0]
        self.paths: dict[str, list[int]] = {}
        self._walk(self.root_id, "", set())
        unreachable = sorted(set(self.nodes) - {item for items in self.paths.values() for item in items})
        if unreachable:
            raise RuntimeError(
                f"Prefab 存在未连接节点：{relative(path)} -> {unreachable[:8]}"
            )

    def _walk(self, node_id: int, parent_path: str, ancestors: set[int]) -> None:
        if node_id in ancestors:
            raise RuntimeError(f"Prefab 节点层级成环：{relative(self.path)} -> {node_id}")
        node = self.nodes.get(node_id)
        if node is None:
            raise RuntimeError(
                f"Prefab child 不是 cc.Node：{relative(self.path)} -> {node_id}"
            )
        name = node.get("_name")
        if not isinstance(name, str) or not name:
            raise RuntimeError(f"Prefab 节点名为空：{relative(self.path)} -> {node_id}")
        node_path = f"{parent_path}/{name}" if parent_path else name
        self.paths.setdefault(node_path, []).append(node_id)

        next_ancestors = set(ancestors)
        next_ancestors.add(node_id)
        for child_ref in node.get("_children") or []:
            child_id = ref_id(child_ref)
            if child_id is None:
                raise RuntimeError(
                    f"Prefab child 引用格式异常：{relative(self.path)} -> {node_path}"
                )
            child = self.nodes.get(child_id)
            if child is None or ref_id(child.get("_parent")) != node_id:
                raise RuntimeError(
                    f"Prefab 父子引用不一致：{relative(self.path)} -> {node_path}/{child_id}"
                )
            self._walk(child_id, node_path, next_ancestors)

    def require_node(self, node_path: str) -> tuple[int, dict[str, Any]]:
        matches = self.paths.get(node_path, [])
        if len(matches) != 1:
            raise RuntimeError(
                f"关键节点路径异常：{relative(self.path)} -> {node_path} "
                f"(匹配 {len(matches)} 个)"
            )
        node_id = matches[0]
        return node_id, self.nodes[node_id]

    def component(self, node_path: str, component_type: str) -> dict[str, Any]:
        _, node = self.require_node(node_path)
        matches: list[dict[str, Any]] = []
        for component_ref in node.get("_components") or []:
            component_id = ref_id(component_ref)
            if component_id is None:
                continue
            component = self.data[component_id]
            if isinstance(component, dict) and component.get("__type__") == component_type:
                matches.append(component)
        if len(matches) != 1:
            raise RuntimeError(
                f"关键组件异常：{relative(self.path)} -> {node_path} "
                f"需要一个 {component_type}，实际 {len(matches)} 个"
            )
        return matches[0]

    def sprite_frame_uuid(self, node_path: str) -> str:
        component = self.component(node_path, "cc.Sprite")
        value = uuid_of(component.get("_spriteFrame"))
        if value is None:
            raise RuntimeError(
                f"关键 SpriteFrame 为空：{relative(self.path)} -> {node_path}"
            )
        return value

    def sprite_frame_uuids(self) -> set[str]:
        result: set[str] = set()
        for value in self.data:
            if not isinstance(value, dict) or value.get("__type__") != "cc.Sprite":
                continue
            value_uuid = uuid_of(value.get("_spriteFrame"))
            if value_uuid:
                result.add(value_uuid)
        return result


def read_meta(path: Path) -> dict[str, Any]:
    meta_path = path.with_suffix(path.suffix + ".meta")
    try:
        value = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Meta 无法读取：{relative(meta_path)} ({exc})") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Meta 根结构异常：{relative(meta_path)}")
    return value


def build_uuid_map() -> dict[str, Path]:
    result: dict[str, Path] = {}
    for meta_path in ASSETS.rglob("*.meta"):
        if meta_path.name.startswith("._"):
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        asset_path = Path(str(meta_path)[:-5]).resolve()
        candidates: list[str] = []
        if isinstance(meta.get("uuid"), str):
            candidates.append(meta["uuid"])
        for sub_meta in (meta.get("subMetas") or {}).values():
            if isinstance(sub_meta, dict) and isinstance(sub_meta.get("uuid"), str):
                candidates.append(sub_meta["uuid"])
        for candidate in candidates:
            previous = result.get(candidate)
            if previous is not None and previous != asset_path:
                raise RuntimeError(
                    f"UUID 重复映射：{candidate} -> {relative(previous)}, {relative(asset_path)}"
                )
            result[candidate] = asset_path
    return result


def normalize_target(value: Any) -> Path:
    if not isinstance(value, (str, Path)):
        raise RuntimeError(f"TARGETS 含非路径项目：{value!r}")
    path = Path(value)
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    try:
        path.relative_to(ROOT)
    except ValueError as exc:
        raise RuntimeError(f"TARGETS 越出项目目录：{path}") from exc
    return path


def read_generator_targets() -> set[Path] | None:
    """Import constants only; never invoke build_assets(), validate(), or main()."""

    if not GENERATOR.exists():
        return None
    spec = importlib.util.spec_from_file_location("_qin_hongli_generator_targets", GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法读取生成脚本：{relative(GENERATOR)}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    raw_targets = getattr(module, "TARGETS", None)
    if raw_targets is None:
        return None
    try:
        values = list(raw_targets)
    except TypeError as exc:
        raise RuntimeError("generate_qin_hongli_skin.py 的 TARGETS 不是可迭代清单") from exc
    targets = {normalize_target(value) for value in values}
    if len(targets) != len(values):
        raise RuntimeError("generate_qin_hongli_skin.py 的 TARGETS 含重复路径")
    if not targets:
        raise RuntimeError("generate_qin_hongli_skin.py 的 TARGETS 为空")
    return targets


def referenced_proxy_targets(
    documents: Iterable[PrefabDocument], uuid_map: dict[str, Path]
) -> set[Path]:
    target_dirs = {path.resolve() for path in TARGET_DIRS}
    targets: set[Path] = set()
    unresolved: set[str] = set()
    for document in documents:
        for sprite_uuid in document.sprite_frame_uuids():
            asset_path = uuid_map.get(sprite_uuid)
            if asset_path is None:
                unresolved.add(sprite_uuid)
                continue
            if asset_path.parent in target_dirs:
                targets.add(asset_path)
    unexpected_unresolved = unresolved - ALLOWED_EXTERNAL_SPRITEFRAME_UUIDS
    if unexpected_unresolved:
        raise RuntimeError(
            "Prefab 含未解析的项目 SpriteFrame UUID："
            + ", ".join(sorted(unexpected_unresolved))
        )
    if not targets:
        raise RuntimeError("未从 panelHongli 与动态条目中找到代理目录目标图片")
    return targets


def border_values(meta: dict[str, Any]) -> tuple[int, int, int, int]:
    sub_metas = meta.get("subMetas") or {}
    if not isinstance(sub_metas, dict) or not sub_metas:
        return (0, 0, 0, 0)
    sub_meta = next(iter(sub_metas.values()))
    if not isinstance(sub_meta, dict):
        return (0, 0, 0, 0)
    return tuple(
        int(sub_meta.get(key, 0) or 0)
        for key in ("borderLeft", "borderRight", "borderTop", "borderBottom")
    )


def shared_nine_slice_assets() -> set[Path]:
    protected: set[Path] = set()
    for directory in SHARED_DIRS:
        for path in directory.rglob("*.png"):
            if path.name.startswith("._"):
                continue
            if any(border_values(read_meta(path))):
                protected.add(path.resolve())
    return protected


def strong_blue_cyan_count(image: Image.Image) -> int:
    """Count saturated legacy blue as well as cyan/teal pixels."""

    count = 0
    pixels = (
        image.get_flattened_data()
        if hasattr(image, "get_flattened_data")
        else image.getdata()
    )
    for red, green, blue, alpha in pixels:
        if alpha <= 32:
            continue
        strong_blue = blue > 145 and blue > red * 1.45 and blue > green * 1.15
        strong_cyan = (
            green > 145
            and blue > 145
            and max(green, blue) > red * 1.60
            and blue >= green * 0.68
            and green >= blue * 0.62
        )
        if strong_blue or strong_cyan:
            count += 1
    return count


def validate_png(path: Path) -> None:
    if path.suffix.lower() != ".png" or not path.is_file():
        raise RuntimeError(f"目标不是现有 PNG：{relative(path)}")
    meta = read_meta(path)
    if meta.get("importer") != "texture" or meta.get("type") != "sprite":
        raise RuntimeError(f"目标 Meta 不是 texture/sprite：{relative(path)}")

    sub_metas = meta.get("subMetas") or {}
    if not isinstance(sub_metas, dict) or len(sub_metas) != 1:
        raise RuntimeError(f"目标 SpriteFrame 数量异常：{relative(path)}")
    sub_meta = next(iter(sub_metas.values()))
    if not isinstance(sub_meta, dict) or sub_meta.get("importer") != "sprite-frame":
        raise RuntimeError(f"目标 SpriteFrame Meta 异常：{relative(path)}")
    if sub_meta.get("rawTextureUuid") != meta.get("uuid"):
        raise RuntimeError(f"目标 SpriteFrame 纹理 UUID 不一致：{relative(path)}")

    with Image.open(path) as source:
        source.load()
        if source.mode != "RGBA":
            raise RuntimeError(f"目标 PNG 模式不是 RGBA：{relative(path)} -> {source.mode}")
        image = source.copy()

    size = image.size
    meta_size = (int(meta.get("width", -1)), int(meta.get("height", -1)))
    raw_size = (int(sub_meta.get("rawWidth", -1)), int(sub_meta.get("rawHeight", -1)))
    if size != meta_size or size != raw_size:
        raise RuntimeError(
            f"目标 PNG 尺寸与 Meta 不一致：{relative(path)} "
            f"PNG={size}, texture={meta_size}, raw={raw_size}"
        )
    explicit_size = EXPECTED_ASSET_SIZES.get(path.resolve())
    if explicit_size is not None and size != explicit_size:
        raise RuntimeError(
            f"目标 PNG 固定尺寸错误：{relative(path)} {size} != {explicit_size}"
        )

    trim_x = int(sub_meta.get("trimX", -1))
    trim_y = int(sub_meta.get("trimY", -1))
    trim_width = int(sub_meta.get("width", -1))
    trim_height = int(sub_meta.get("height", -1))
    expected_bbox = (
        trim_x,
        trim_y,
        trim_x + trim_width,
        trim_y + trim_height,
    )
    actual_bbox = image.getchannel("A").getbbox()
    if actual_bbox != expected_bbox:
        raise RuntimeError(
            f"目标 PNG 透明裁剪与 Meta 不一致：{relative(path)} "
            f"alpha={actual_bbox}, meta={expected_bbox}"
        )

    legacy_pixels = strong_blue_cyan_count(image)
    if legacy_pixels:
        raise RuntimeError(
            f"目标 PNG 仍含强蓝/青像素：{relative(path)} -> {legacy_pixels}"
        )


def validate_key_paths(documents: dict[Path, PrefabDocument]) -> None:
    for path, expected_paths in KEY_NODE_PATHS.items():
        document = documents[path]
        for node_path in expected_paths:
            document.require_node(node_path)


def validate_label_colours(documents: dict[Path, PrefabDocument]) -> None:
    for document in documents.values():
        for node_id, node in document.nodes.items():
            component_types: set[str] = set()
            for component_ref in node.get("_components") or []:
                component_id = ref_id(component_ref)
                if component_id is None:
                    continue
                component = document.data[component_id]
                if isinstance(component, dict) and isinstance(component.get("__type__"), str):
                    component_types.add(component["__type__"])
            if not (component_types & LABEL_COMPONENT_TYPES):
                continue
            colour = node.get("_color") or {}
            value = tuple(int(colour.get(channel, -1)) for channel in ("r", "g", "b", "a"))
            if value not in EXPECTED_LABEL_COLOURS:
                raise RuntimeError(
                    "动态文字颜色未统一："
                    f"{relative(document.path)} -> node {node_id} {node.get('_name')} = {value}"
                )


def validate_bindings(
    documents: dict[Path, PrefabDocument], uuid_map: dict[str, Path]
) -> None:
    panel_uuid = documents[PANEL].sprite_frame_uuid("panelHongli/推广二维码")
    if panel_uuid != EXPECTED_PROMOTION_BACKGROUND_UUID:
        raise RuntimeError(
            "推广背景绑定错误："
            f"{panel_uuid} != {EXPECTED_PROMOTION_BACKGROUND_UUID}"
        )
    mengzhu_uuid = documents[ITEM_PREFABS[3]].sprite_frame_uuid("盟主对象/type")
    if mengzhu_uuid != EXPECTED_MENGZHU_TYPE_UUID:
        raise RuntimeError(
            "盟主对象/type 绑定错误："
            f"{mengzhu_uuid} != {EXPECTED_MENGZHU_TYPE_UUID}"
        )
    for expected_uuid, expected_path in EXPECTED_UUID_ASSETS.items():
        actual_path = uuid_map.get(expected_uuid)
        if actual_path != expected_path.resolve():
            raise RuntimeError(
                f"关键 UUID 资源映射错误：{expected_uuid} -> "
                f"{relative(actual_path) if actual_path else '未解析'}，"
                f"预期 {relative(expected_path)}"
            )


def main() -> int:
    prefab_paths = (PANEL,) + ITEM_PREFABS
    documents = {path: PrefabDocument(path) for path in prefab_paths}
    validate_key_paths(documents)
    validate_label_colours(documents)

    uuid_map = build_uuid_map()
    validate_bindings(documents, uuid_map)

    referenced_targets = referenced_proxy_targets(documents.values(), uuid_map)
    generator_targets = read_generator_targets()
    if generator_targets is None:
        targets = referenced_targets
        target_source = "Prefab 实际引用回退清单"
    else:
        targets = generator_targets
        target_source = "generate_qin_hongli_skin.py::TARGETS"
        if len(targets) != EXPECTED_GENERATOR_TARGET_COUNT:
            raise RuntimeError(
                "生成目标数量异常："
                f"{len(targets)} != {EXPECTED_GENERATOR_TARGET_COUNT}"
            )
        missing = referenced_targets - targets
        if missing:
            raise RuntimeError(
                "生成目标遗漏实际代理图片引用："
                + ", ".join(relative(path) for path in sorted(missing))
            )

    allowed_target_dirs = {path.resolve() for path in TARGET_DIRS}
    outside_proxy_dirs = {
        path for path in targets if path.resolve().parent not in allowed_target_dirs
    }
    if outside_proxy_dirs:
        raise RuntimeError(
            "生成目标越出两个代理专用目录："
            + ", ".join(relative(path) for path in sorted(outside_proxy_dirs))
        )

    protected_nine_slice = shared_nine_slice_assets()
    accidental_shared = targets & protected_nine_slice
    if accidental_shared:
        raise RuntimeError(
            "生成目标误包含共享九宫格资源："
            + ", ".join(relative(path) for path in sorted(accidental_shared))
        )

    for path in sorted(targets):
        validate_png(path)

    print(f"panelHongli 黑金换皮静态校验通过：{len(targets)} 张运行 PNG")
    print(f"目标清单来源：{target_source}")
    print("Prefab JSON：panelHongli + 5 个动态条目结构有效")
    print("关键节点路径：全部存在且唯一")
    print("动态文字：暖金/象牙/灰金/铜红/成功绿色板统一")
    print("关键绑定：推广背景与盟主对象/type UUID 正确")
    print(
        f"共享九宫格保护：{len(protected_nine_slice)} 张均未进入生成目标"
    )
    print("PNG/Meta：尺寸、RGBA、透明裁剪一致，强蓝/青像素 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
