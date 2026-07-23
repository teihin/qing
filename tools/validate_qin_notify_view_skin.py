#!/usr/bin/env python3
"""Read-only static validation for the Qin ``panelNotifyView`` family.

The validator never calls the art generator and never writes runtime assets,
prefabs, previews, or metadata.  It validates the four panel-specific PNG
targets, Creator metadata, and the serialized/runtime contracts shared by
``panelNotifyView``, ``panelNotifyViewCZ``, and ``panelNotifyViewHD``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


# Importing the optional generator is only used to read its TARGETS constant.
# Prevent that import from leaving __pycache__ in the workspace.
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
GENERATOR = ROOT / "tools" / "generate_qin_notify_view_skin.py"
PANEL_SCRIPT = ASSETS / "scripts" / "UI" / "panelMsgView.ts"

PREFABS = (
    ASSETS / "resources" / "UI" / "panelNotifyView.prefab",
    ASSETS / "resources" / "UI" / "panelNotifyViewCZ.prefab",
    ASSETS / "resources" / "UI" / "panelNotifyViewHD.prefab",
)

BACKGROUND = ASSETS / "ImagesLuck" / "公告" / "秦_通知弹窗底.png"
LATEST_TITLE = ASSETS / "ImagesLuck" / "公告" / "标题" / "最新公告.png"
RECHARGE_TITLE = ASSETS / "ImagesLuck" / "公告" / "标题" / "充值公告.png"
ACTIVITY_TITLE = ASSETS / "ImagesLuck" / "公告" / "标题" / "活动公告.png"

TARGETS = (
    BACKGROUND,
    LATEST_TITLE,
    RECHARGE_TITLE,
    ACTIVITY_TITLE,
)

SHARED_CONFIRM = ASSETS / "imagesKK" / "公用" / "确定.png"
SHARED_CLOSE = ASSETS / "ImagesLuck" / "公用" / "btn_4.png"
LEGACY_BACKGROUND = ASSETS / "ImagesLuck" / "公告" / "弹窗公告底.png"
FORBIDDEN_GENERATOR_TARGETS = {
    SHARED_CONFIRM.resolve(),
    SHARED_CLOSE.resolve(),
    LEGACY_BACKGROUND.resolve(),
}

BACKGROUND_SPRITEFRAME_UUID = "3169545c-2899-4189-8457-2c724f5f7032"
CLOSE_SPRITEFRAME_UUID = "4b0b32f6-1d5b-431a-9999-b22e3a7e9604"
CONFIRM_SPRITEFRAME_UUID = "51b0da6f-6189-47d8-8f72-b94fa7996a30"
LEGACY_BACKGROUND_SPRITEFRAME_UUID = "f14e6fdc-f07b-4e20-a027-afd5be66a91d"

TITLE_SPRITEFRAME_UUIDS = {
    "最新公告": "033c6545-b226-4206-b7e3-988c832c3fb1",
    "充值公告": "21971346-a2ba-407b-b0ef-034b6258a196",
    "活动公告": "1a8eb882-e246-4528-8d43-b2f7a1e54ca8",
}

EXPECTED_SIZES = {
    BACKGROUND.resolve(): (633, 880),
    LATEST_TITLE.resolve(): (134, 38),
    RECHARGE_TITLE.resolve(): (133, 37),
    ACTIVITY_TITLE.resolve(): (134, 38),
}

EXPECTED_ACTIVE_TITLES = {
    PREFABS[0].resolve(): "最新公告",
    PREFABS[1].resolve(): "充值公告",
    PREFABS[2].resolve(): "活动公告",
}

EXPECTED_MESSAGE_COLOUR = (232, 215, 180, 255)
BUILTIN_WHITE_SPRITEFRAME_UUID = "a23235d1-15db-4b95-8439-a2e005bfff91"


def relative(path: Path | None) -> str:
    if path is None:
        return "未解析"
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
    """Structural reader for Creator 2.4's JSON-array prefab format."""

    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Prefab JSON 无法读取：{relative(path)} ({exc})") from exc
        if not isinstance(value, list) or not value:
            raise RuntimeError(f"Prefab JSON 根结构异常：{relative(path)}")
        self.data: list[Any] = value
        self.nodes: dict[int, dict[str, Any]] = {
            index: item
            for index, item in enumerate(value)
            if isinstance(item, dict) and item.get("__type__") == "cc.Node"
        }
        if not self.nodes:
            raise RuntimeError(f"Prefab 不含 cc.Node：{relative(path)}")

        for identifier in iter_serialized_ids(value):
            if not 0 <= identifier < len(value):
                raise RuntimeError(
                    f"Prefab 存在越界 __id__ 引用：{relative(path)} -> {identifier}"
                )

        roots = [
            node_id
            for node_id, node in self.nodes.items()
            if ref_id(node.get("_parent")) is None
        ]
        if len(roots) != 1:
            raise RuntimeError(
                f"Prefab 根节点数量异常：{relative(path)} -> {len(roots)}"
            )
        self.root_id = roots[0]
        self.paths: dict[str, list[int]] = {}
        self._walk(self.root_id, "", set())

        reachable = {node_id for values in self.paths.values() for node_id in values}
        unreachable = sorted(set(self.nodes) - reachable)
        if unreachable:
            raise RuntimeError(
                f"Prefab 存在未连接节点：{relative(path)} -> {unreachable[:8]}"
            )

    def _walk(self, node_id: int, parent_path: str, ancestors: set[int]) -> None:
        if node_id in ancestors:
            raise RuntimeError(f"Prefab 节点层级成环：{relative(self.path)} -> {node_id}")
        node = self.nodes.get(node_id)
        if node is None:
            raise RuntimeError(f"Prefab child 不是 cc.Node：{relative(self.path)} -> {node_id}")
        name = node.get("_name")
        if not isinstance(name, str) or not name:
            raise RuntimeError(f"Prefab 节点名为空：{relative(self.path)} -> {node_id}")
        node_path = f"{parent_path}/{name}" if parent_path else name
        self.paths.setdefault(node_path, []).append(node_id)

        next_ancestors = set(ancestors)
        next_ancestors.add(node_id)
        for child_ref in node.get("_children") or []:
            child_id = ref_id(child_ref)
            child = self.nodes.get(child_id) if child_id is not None else None
            if child is None or ref_id(child.get("_parent")) != node_id:
                raise RuntimeError(
                    f"Prefab 父子引用不一致：{relative(self.path)} -> {node_path}"
                )
            self._walk(child_id, node_path, next_ancestors)

    def require_node(self, path: str) -> tuple[int, dict[str, Any]]:
        matches = self.paths.get(path, [])
        if len(matches) != 1:
            raise RuntimeError(
                f"关键节点路径异常：{relative(self.path)} -> {path} "
                f"(匹配 {len(matches)} 个)"
            )
        node_id = matches[0]
        return node_id, self.nodes[node_id]

    def descendants(self, ancestor_id: int) -> set[int]:
        result: set[int] = set()
        pending = [ancestor_id]
        while pending:
            parent_id = pending.pop()
            for child_ref in self.nodes[parent_id].get("_children") or []:
                child_id = ref_id(child_ref)
                if child_id is None or child_id in result:
                    continue
                result.add(child_id)
                pending.append(child_id)
        return result

    def components(self, node_id: int, component_type: str) -> list[dict[str, Any]]:
        node = self.nodes[node_id]
        matches: list[dict[str, Any]] = []
        for component_ref in node.get("_components") or []:
            component_id = ref_id(component_ref)
            if component_id is None:
                continue
            component = self.data[component_id]
            if isinstance(component, dict) and component.get("__type__") == component_type:
                matches.append(component)
        return matches

    def component(self, node_id: int, component_type: str) -> dict[str, Any]:
        matches = self.components(node_id, component_type)
        if len(matches) != 1:
            raise RuntimeError(
                f"关键组件异常：{relative(self.path)} -> node {node_id} "
                f"需要一个 {component_type}，实际 {len(matches)} 个"
            )
        return matches[0]

    def sprite_uuid(self, node_id: int) -> str | None:
        sprites = self.components(node_id, "cc.Sprite")
        if len(sprites) > 1:
            raise RuntimeError(
                f"节点存在多个 cc.Sprite：{relative(self.path)} -> node {node_id}"
            )
        return uuid_of(sprites[0].get("_spriteFrame")) if sprites else None


def read_meta(path: Path) -> dict[str, Any]:
    meta_path = path.with_suffix(path.suffix + ".meta")
    try:
        value = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Meta 无法读取：{relative(meta_path)} ({exc})") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Meta 根结构异常：{relative(meta_path)}")
    return value


def sprite_sub_meta(path: Path, meta: dict[str, Any]) -> dict[str, Any]:
    sub_metas = meta.get("subMetas") or {}
    if not isinstance(sub_metas, dict) or len(sub_metas) != 1:
        raise RuntimeError(f"目标 SpriteFrame 数量异常：{relative(path)}")
    value = next(iter(sub_metas.values()))
    if not isinstance(value, dict) or value.get("importer") != "sprite-frame":
        raise RuntimeError(f"目标 SpriteFrame Meta 异常：{relative(path)}")
    return value


def build_uuid_map() -> dict[str, Path]:
    result: dict[str, Path] = {}
    for meta_path in ASSETS.rglob("*.meta"):
        if meta_path.name.startswith("._"):
            continue
        try:
            value = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        asset_path = Path(str(meta_path)[:-5]).resolve()
        uuids: list[str] = []
        if isinstance(value.get("uuid"), str):
            uuids.append(value["uuid"])
        sub_metas = value.get("subMetas") or {}
        if isinstance(sub_metas, dict):
            for sub_meta in sub_metas.values():
                if isinstance(sub_meta, dict) and isinstance(sub_meta.get("uuid"), str):
                    uuids.append(sub_meta["uuid"])
        for value_uuid in uuids:
            previous = result.get(value_uuid)
            if previous is not None and previous != asset_path:
                raise RuntimeError(
                    f"UUID 重复映射：{value_uuid} -> "
                    f"{relative(previous)}, {relative(asset_path)}"
                )
            result[value_uuid] = asset_path
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
    """Read only ``TARGETS``; never call the generator's build or main."""

    if not GENERATOR.exists():
        return None
    module_name = "_qin_notify_view_generator_targets"
    spec = importlib.util.spec_from_file_location(module_name, GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法读取生成脚本：{relative(GENERATOR)}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(module_name, None)
    raw_targets = getattr(module, "TARGETS", None)
    if raw_targets is None:
        raise RuntimeError("generate_qin_notify_view_skin.py 缺少 TARGETS")
    values = list(raw_targets.keys()) if isinstance(raw_targets, dict) else list(raw_targets)
    targets = {normalize_target(value) for value in values}
    if len(values) != len(targets):
        raise RuntimeError("generate_qin_notify_view_skin.py 的 TARGETS 含重复路径")
    return targets


def strong_blue_cyan_count(image: Image.Image) -> int:
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
    sub_meta = sprite_sub_meta(path, meta)
    if sub_meta.get("rawTextureUuid") != meta.get("uuid"):
        raise RuntimeError(f"目标 SpriteFrame 纹理 UUID 不一致：{relative(path)}")

    with Image.open(path) as source:
        source.load()
        if source.mode != "RGBA":
            raise RuntimeError(f"目标 PNG 模式不是 RGBA：{relative(path)} -> {source.mode}")
        image = source.copy()

    expected_size = EXPECTED_SIZES[path.resolve()]
    texture_size = (int(meta.get("width", -1)), int(meta.get("height", -1)))
    raw_size = (int(sub_meta.get("rawWidth", -1)), int(sub_meta.get("rawHeight", -1)))
    if image.size != expected_size or texture_size != expected_size or raw_size != expected_size:
        raise RuntimeError(
            f"目标 PNG/Meta 尺寸错误：{relative(path)} "
            f"PNG={image.size}, texture={texture_size}, raw={raw_size}, "
            f"预期={expected_size}"
        )

    trim_x = int(sub_meta.get("trimX", -1))
    trim_y = int(sub_meta.get("trimY", -1))
    trim_width = int(sub_meta.get("width", -1))
    trim_height = int(sub_meta.get("height", -1))
    expected_bbox = (trim_x, trim_y, trim_x + trim_width, trim_y + trim_height)
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


def validate_uuid_assets(uuid_map: dict[str, Path]) -> None:
    expected = {
        BACKGROUND_SPRITEFRAME_UUID: BACKGROUND.resolve(),
        CLOSE_SPRITEFRAME_UUID: SHARED_CLOSE.resolve(),
        CONFIRM_SPRITEFRAME_UUID: SHARED_CONFIRM.resolve(),
        LEGACY_BACKGROUND_SPRITEFRAME_UUID: LEGACY_BACKGROUND.resolve(),
        TITLE_SPRITEFRAME_UUIDS["最新公告"]: LATEST_TITLE.resolve(),
        TITLE_SPRITEFRAME_UUIDS["充值公告"]: RECHARGE_TITLE.resolve(),
        TITLE_SPRITEFRAME_UUIDS["活动公告"]: ACTIVITY_TITLE.resolve(),
    }
    for value_uuid, expected_path in expected.items():
        actual_path = uuid_map.get(value_uuid)
        if actual_path != expected_path:
            raise RuntimeError(
                f"关键 UUID 映射错误：{value_uuid} -> {relative(actual_path)}，"
                f"预期 {relative(expected_path)}"
            )


def node_colour(node: dict[str, Any]) -> tuple[int, int, int, int]:
    colour = node.get("_color") or {}
    return tuple(int(colour.get(channel, -1)) for channel in ("r", "g", "b", "a"))


def node_size(node: dict[str, Any]) -> tuple[float, float]:
    size = node.get("_contentSize") or {}
    return (float(size.get("width", -1)), float(size.get("height", -1)))


def validate_prefab(document: PrefabDocument) -> None:
    root = document.nodes[document.root_id]
    if root.get("_name") != "panelNotifyView":
        raise RuntimeError(
            f"通知 Prefab 根节点名错误：{relative(document.path)} -> {root.get('_name')}"
        )
    if node_size(root) != (750.0, 1334.0):
        raise RuntimeError(
            f"通知 Prefab 根尺寸错误：{relative(document.path)} -> {node_size(root)}"
        )

    mask_id, mask = document.require_node("panelNotifyView/msk")
    if mask.get("_active") is not True or document.sprite_uuid(mask_id) != BUILTIN_WHITE_SPRITEFRAME_UUID:
        raise RuntimeError(f"全屏遮罩契约错误：{relative(document.path)}")

    bk_id, bk = document.require_node("panelNotifyView/bk")
    if bk.get("_active") is not True or node_size(bk) != (700.0, 880.0):
        raise RuntimeError(
            f"公告主体尺寸/显隐错误：{relative(document.path)} -> "
            f"active={bk.get('_active')} size={node_size(bk)}"
        )
    background_uuid = document.sprite_uuid(bk_id)
    if background_uuid != BACKGROUND_SPRITEFRAME_UUID:
        raise RuntimeError(
            f"通知背景绑定错误：{relative(document.path)} -> "
            f"{background_uuid} != {BACKGROUND_SPRITEFRAME_UUID}"
        )
    if background_uuid == LEGACY_BACKGROUND_SPRITEFRAME_UUID:
        raise RuntimeError(f"仍绑定旧弹窗公告底：{relative(document.path)}")

    msg_id, msg = document.require_node("panelNotifyView/bk/msg")
    document.component(msg_id, "cc.Label")
    if msg.get("_active") is not True or node_size(msg) != (574.0, 660.0):
        raise RuntimeError(
            f"公告正文节点尺寸/显隐错误：{relative(document.path)} -> "
            f"active={msg.get('_active')} size={node_size(msg)}"
        )
    colour = node_colour(msg)
    if colour != EXPECTED_MESSAGE_COLOUR:
        raise RuntimeError(
            f"公告正文颜色错误：{relative(document.path)} -> "
            f"{colour} != {EXPECTED_MESSAGE_COLOUR}"
        )

    # The new visible close icon may be a direct bk child or a child of the
    # existing top-right button hit target, but its node name and binding are
    # fixed so it remains auditable.
    bk_descendants = document.descendants(bk_id)
    close_nodes = [
        node_id
        for node_id in bk_descendants
        if document.nodes[node_id].get("_name") == "关闭图标"
    ]
    if len(close_nodes) != 1:
        raise RuntimeError(
            f"关闭图标节点数量错误：{relative(document.path)} -> {len(close_nodes)}"
        )
    if document.nodes[close_nodes[0]].get("_active") is not True:
        raise RuntimeError(f"关闭图标未启用：{relative(document.path)}")
    close_uuid = document.sprite_uuid(close_nodes[0])
    if close_uuid != CLOSE_SPRITEFRAME_UUID:
        raise RuntimeError(
            f"关闭图标绑定错误：{relative(document.path)} -> "
            f"{close_uuid} != {CLOSE_SPRITEFRAME_UUID}"
        )

    title_nodes: dict[str, int] = {}
    for title_name, expected_uuid in TITLE_SPRITEFRAME_UUIDS.items():
        node_id, node = document.require_node(f"panelNotifyView/bk/{title_name}")
        title_nodes[title_name] = node_id
        title_uuid = document.sprite_uuid(node_id)
        if title_uuid != expected_uuid:
            raise RuntimeError(
                f"标题绑定错误：{relative(document.path)} -> {title_name} "
                f"{title_uuid} != {expected_uuid}"
            )

    active_title = EXPECTED_ACTIVE_TITLES[document.path]
    for title_name, node_id in title_nodes.items():
        actual = document.nodes[node_id].get("_active") is True
        expected = title_name == active_title
        if actual != expected:
            raise RuntimeError(
                f"标题 active 状态错误：{relative(document.path)} -> "
                f"{title_name}={actual}，预期 {expected}"
            )

    # There are intentionally two direct children named “确定”: the visible
    # bottom action and the top-right close hit target.  The visible one must
    # keep the shared confirm art and Button component because panelMsgView
    # dispatches exclusively by node name.
    confirm_candidates: list[int] = []
    for child_ref in bk.get("_children") or []:
        child_id = ref_id(child_ref)
        if child_id is None or document.nodes[child_id].get("_name") != "确定":
            continue
        if document.components(child_id, "cc.Button"):
            confirm_candidates.append(child_id)
    if len(confirm_candidates) != 2:
        raise RuntimeError(
            f"bk 下“确定”按钮数量错误：{relative(document.path)} -> "
            f"{len(confirm_candidates)}"
        )
    visible_confirm = [
        node_id
        for node_id in confirm_candidates
        if document.sprite_uuid(node_id) == CONFIRM_SPRITEFRAME_UUID
    ]
    if len(visible_confirm) != 1:
        raise RuntimeError(
            f"共享确定按钮绑定数量错误：{relative(document.path)} -> "
            f"{len(visible_confirm)}"
        )
    if document.nodes[visible_confirm[0]].get("_active") is not True:
        raise RuntimeError(f"底部确定按钮未启用：{relative(document.path)}")

    cancel_id, cancel = document.require_node("panelNotifyView/bk/取消")
    document.component(cancel_id, "cc.Button")
    if cancel.get("_active") is not False:
        raise RuntimeError(f"历史取消按钮不应被意外启用：{relative(document.path)}")


def require_source_pattern(source: str, pattern: str, description: str) -> None:
    if re.search(pattern, source, flags=re.MULTILINE | re.DOTALL) is None:
        raise RuntimeError(f"panelMsgView 硬编码契约缺失：{description}")


def validate_panel_script_contract() -> None:
    try:
        source = PANEL_SCRIPT.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"无法读取 {relative(PANEL_SCRIPT)} ({exc})") from exc

    require_source_pattern(
        source,
        r'this\.node\.name\.indexOf\(\s*["\']panelNotifyView["\']\s*\)\s*>=\s*0',
        "根节点名包含 panelNotifyView 时解码",
    )
    require_source_pattern(
        source,
        r'this\.strUserData\s*=\s*Tool\.Base64Decode\(\s*this\.strUserData\s*\)',
        "Base64Decode(this.strUserData)",
    )
    require_source_pattern(
        source,
        r'getChildByName\(\s*["\']bk["\']\s*\)\s*\.\s*getChildByName\(\s*["\']msg["\']\s*\)\s*\.\s*getComponent\(\s*cc\.Label\s*\)\s*\.\s*string\s*=\s*this\.strUserData',
        "bk/msg 动态正文写入路径",
    )
    require_source_pattern(
        source,
        r'button\.node\.name\s*==={0,1}\s*["\']取消["\']\s*\|\|\s*button\.node\.name\s*==={0,1}\s*["\']确定["\']',
        "取消或确定关闭弹窗",
    )
    require_source_pattern(
        source,
        r'closePanelByName\(\s*this\.node\.name\s*\)',
        "按当前面板名关闭",
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(paths: Iterable[Path]) -> dict[Path, str | None]:
    result: dict[Path, str | None] = {}
    for path in paths:
        resolved = path.resolve()
        result[resolved] = digest(path) if path.is_file() else None
    return result


def main() -> int:
    protected = list(TARGETS) + list(PREFABS) + [
        path.with_suffix(path.suffix + ".meta") for path in TARGETS
    ]
    protected.extend((SHARED_CONFIRM, SHARED_CLOSE, LEGACY_BACKGROUND, PANEL_SCRIPT))
    before = snapshot(protected)

    generator_targets = read_generator_targets()
    expected_targets = {path.resolve() for path in TARGETS}
    if generator_targets is None:
        checked_targets = expected_targets
        target_source = "校验脚本固定 TARGETS（生成器尚不存在）"
    else:
        checked_targets = generator_targets
        target_source = "generate_qin_notify_view_skin.py::TARGETS"

    forbidden = checked_targets & FORBIDDEN_GENERATOR_TARGETS
    if forbidden:
        raise RuntimeError(
            "通知生成 TARGETS 误包含共享/旧资源："
            + ", ".join(relative(path) for path in sorted(forbidden))
        )
    if checked_targets != expected_targets:
        missing = expected_targets - checked_targets
        extra = checked_targets - expected_targets
        details: list[str] = []
        if missing:
            details.append("缺少 " + ", ".join(relative(path) for path in sorted(missing)))
        if extra:
            details.append("越界 " + ", ".join(relative(path) for path in sorted(extra)))
        raise RuntimeError("通知生成 TARGETS 必须恰好为 4 张专用图片：" + "；".join(details))

    for path in TARGETS:
        validate_png(path)

    uuid_map = build_uuid_map()
    validate_uuid_assets(uuid_map)

    documents = [PrefabDocument(path) for path in PREFABS]
    for document in documents:
        validate_prefab(document)
    validate_panel_script_contract()

    after = snapshot(protected)
    changed = [path for path in before if before[path] != after[path]]
    if changed:
        raise RuntimeError(
            "只读校验过程中资源/Prefab 发生变化："
            + ", ".join(relative(path) for path in changed)
        )

    print("panelNotifyView 黑金换皮静态校验通过：4 张专用运行 PNG")
    print(f"目标清单来源：{target_source}")
    print("PNG/Meta：固定尺寸、RGBA、透明裁剪一致，强蓝/青像素 0")
    print("Prefab：panelNotifyView/CZ/HD 背景、关闭图标、正文色与标题状态正确")
    print("共享保护：确定、btn_4、旧弹窗公告底均未进入 TARGETS")
    print("运行契约：panelMsgView 的 Base64、bk/msg 与确定/取消关闭路径完整")
    print("只读性：校验前后目标资源、Meta、Prefab 和脚本哈希一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
