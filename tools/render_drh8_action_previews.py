#!/usr/bin/env python3
"""Render isolated drh8 in-table action states without mutating the project.

The scene is loaded into memory, unrelated top-level game states are hidden,
and one operation state is forced visible at a time.  Run once with serialized
node sizes and once with ``--simulate-creator-size-mode`` to expose runtime
``cc.Sprite._applySpriteSize`` resets caused by RAW/TRIMMED Sprite SizeMode.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageChops

from render_drh8_scene_preview import (
    DEFAULT_CREATOR_ASSETS,
    DEFAULT_SCENE,
    PreviewRenderer,
    ref_id,
)


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[1]
DEFAULT_SERIALIZED_DIR = REPO_ROOT / "art_sources" / "drh8" / "action_previews"
DEFAULT_CREATOR_SIZE_DIR = (
    REPO_ROOT / "art_sources" / "drh8" / "action_previews_creator_size"
)
ACTION_ROOT_PATH = "Canvas/Normal/panelGameView"


@dataclass(frozen=True)
class ActionSpec:
    key: str
    title: str
    filename: str
    top_target: str
    focus_path: str
    keep_top: Tuple[str, ...] = ("BK", "RoomFrame", "UserInfo")
    activate: Tuple[str, ...] = ()
    deactivate: Tuple[str, ...] = ()
    positions: Tuple[Tuple[str, float, float], ...] = ()
    note: str = ""


CMD1_POSITIONS: Tuple[Tuple[str, float, float], ...] = (
    ("cmd1/丢", -131, 0),
    ("cmd1/休", 131, 0),
    ("cmd1/敲", 0, 150),
    ("cmd1/大", 0, 150),
    ("cmd1/跟", 131, 0),
)


ACTION_SPECS: Tuple[ActionSpec, ...] = (
    ActionSpec(
        "cmd1_drop_rest_knock",
        "主操作－丢、休、敲与倍率",
        "01_cmd1_丢休敲与倍率.png",
        "cmd1",
        "cmd1",
        activate=("cmd1/丢", "cmd1/休", "cmd1/敲"),
        deactivate=("cmd1/大", "cmd1/跟"),
        positions=CMD1_POSITIONS,
    ),
    ActionSpec(
        "cmd1_drop_rest_raise",
        "主操作－丢、休、大与倍率",
        "02_cmd1_丢休大与倍率.png",
        "cmd1",
        "cmd1",
        activate=("cmd1/丢", "cmd1/休", "cmd1/大"),
        deactivate=("cmd1/敲", "cmd1/跟"),
        positions=CMD1_POSITIONS,
    ),
    ActionSpec(
        "cmd1_drop_follow_knock",
        "主操作－丢、跟、敲与倍率",
        "03_cmd1_丢跟敲与倍率.png",
        "cmd1",
        "cmd1",
        activate=("cmd1/丢", "cmd1/跟", "cmd1/敲"),
        deactivate=("cmd1/休", "cmd1/大"),
        positions=CMD1_POSITIONS,
        note="跟按钮使用场景内序列化的示例倍率文字。",
    ),
    ActionSpec(
        "cmd1_drop_follow_raise",
        "主操作－丢、跟、大与倍率",
        "04_cmd1_丢跟大与倍率.png",
        "cmd1",
        "cmd1",
        activate=("cmd1/丢", "cmd1/跟", "cmd1/大"),
        deactivate=("cmd1/休", "cmd1/敲"),
        positions=CMD1_POSITIONS,
        note="跟按钮使用场景内序列化的示例倍率文字。",
    ),
    ActionSpec(
        "cmd2_split",
        "分牌操作",
        "05_cmd2_分牌.png",
        "cmd2",
        "cmd2",
        deactivate=(
            "cmd2/目标/扯1",
            "cmd2/目标/扯2",
            "cmd2/牌型1",
            "cmd2/牌型2",
        ),
        note="牌值由 PKCardInfoScript 运行时写入，离线图显示序列化占位牌面。",
    ),
    ActionSpec(
        "cmd3_preoperation",
        "预操作－休或丢、自动休",
        "06_cmd3_预操作.png",
        "cmd3",
        "cmd3",
        activate=("cmd3/休或丢", "cmd3/自动休"),
        positions=(("cmd3/休或丢", -131, 0), ("cmd3/自动休", 131, 0)),
        note="选中态由业务代码运行时换 SpriteFrame；本图显示场景当前未选中态。",
    ),
    ActionSpec(
        "cmd5_drop_knock",
        "预操作－丢、敲",
        "07_cmd5_丢敲.png",
        "cmd5",
        "cmd5",
        positions=(("cmd5/丢", -131, 0), ("cmd5/敲", 131, 0)),
    ),
    ActionSpec(
        "cmd6_show_cards",
        "结算操作－强制秀牌、看剩余牌",
        "08_cmd6_结算查看.png",
        "cmd6",
        "cmd6",
    ),
    ActionSpec(
        "sit_buttons",
        "空座坐下按钮",
        "09_坐下按钮.png",
        "坐下控制",
        "坐下控制",
        keep_top=("BK", "RoomFrame"),
        note="显示八个座位的全部坐下按钮；实际运行按空座逐个显隐。",
    ),
    ActionSpec(
        "spectator_badge",
        "玩家观战状态",
        "10_玩家观战状态.png",
        "UserInfo",
        "UserInfo/player1/PlayerInfo/扩展状态",
        activate=("UserInfo/player1/PlayerInfo/扩展状态",),
        note="使用 player1 展示观战标记，可暴露非主座位的 RAW 尺寸重置。",
    ),
    ActionSpec(
        "remote_voice",
        "远端玩家语音状态",
        "11_玩家语音状态.png",
        "UserInfo",
        "UserInfo/player1/TalkPad",
        activate=("UserInfo/player1/TalkPad", "UserInfo/player1/TalkPad/KJ"),
        deactivate=("UserInfo/player1/TalkPad/BQ",),
        note="cc.Animation 时间轴无法离线播放，仅显示 KJ 当前序列化帧。",
    ),
    ActionSpec(
        "local_recording",
        "本机录音状态",
        "12_本机录音状态.png",
        "TalkShow",
        "TalkShow",
        note="cc.Animation 时间轴无法离线播放，仅显示 TalkShow 当前序列化帧。",
    ),
)


def _full_path(relative_path: str) -> str:
    relative_path = relative_path.strip("/")
    return ACTION_ROOT_PATH if not relative_path else f"{ACTION_ROOT_PATH}/{relative_path}"


def _path_index(renderer: PreviewRenderer) -> Dict[str, List[int]]:
    result: Dict[str, List[int]] = {}
    for node_id in renderer.nodes:
        result.setdefault(renderer.node_path(node_id), []).append(node_id)
    return result


def _resolve_unique(
    index: Dict[str, List[int]], relative_path: str, errors: List[str]
) -> Optional[int]:
    full_path = _full_path(relative_path)
    matches = index.get(full_path, [])
    if len(matches) == 1:
        return matches[0]
    if not matches:
        errors.append(f"未找到节点：{full_path}")
    else:
        errors.append(f"节点路径不唯一：{full_path} -> {matches}")
    return None


def _set_active_with_ancestors(
    renderer: PreviewRenderer, node_id: int, active: bool, stop_at: int
) -> None:
    renderer.nodes[node_id]["_active"] = active
    if not active:
        return
    current_id = node_id
    seen: set[int] = set()
    while current_id in renderer.nodes and current_id not in seen:
        seen.add(current_id)
        renderer.nodes[current_id]["_active"] = True
        if current_id == stop_at:
            break
        parent_id = ref_id(renderer.nodes[current_id].get("_parent"))
        if parent_id is None:
            break
        current_id = parent_id


def _set_position(node: Dict[str, Any], x: float, y: float) -> None:
    transform = node.get("_trs") or {}
    array = transform.get("array") or []
    if len(array) >= 2:
        array[0] = x
        array[1] = y
        return
    position = node.setdefault("_position", {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0})
    position["x"] = x
    position["y"] = y


def isolate_action(renderer: PreviewRenderer, spec: ActionSpec) -> List[str]:
    errors: List[str] = []
    index = _path_index(renderer)
    root_id = _resolve_unique(index, "", errors)
    if root_id is None:
        return errors

    root_node = renderer.nodes[root_id]
    for child_ref in root_node.get("_children") or []:
        child_id = ref_id(child_ref)
        if child_id in renderer.nodes:
            renderer.nodes[child_id]["_active"] = False

    for top_name in (*spec.keep_top, spec.top_target):
        node_id = _resolve_unique(index, top_name, errors)
        if node_id is not None:
            _set_active_with_ancestors(renderer, node_id, True, root_id)

    for relative_path in spec.activate:
        node_id = _resolve_unique(index, relative_path, errors)
        if node_id is not None:
            _set_active_with_ancestors(renderer, node_id, True, root_id)
    for relative_path in spec.deactivate:
        node_id = _resolve_unique(index, relative_path, errors)
        if node_id is not None:
            renderer.nodes[node_id]["_active"] = False
    for relative_path, x, y in spec.positions:
        node_id = _resolve_unique(index, relative_path, errors)
        if node_id is not None:
            _set_position(renderer.nodes[node_id], x, y)
    return errors


def _effectively_active(renderer: PreviewRenderer, node_id: int) -> bool:
    seen: set[int] = set()
    current_id = node_id
    while current_id in renderer.nodes and current_id not in seen:
        seen.add(current_id)
        node = renderer.nodes[current_id]
        if not bool(node.get("_active", True)):
            return False
        parent_id = ref_id(node.get("_parent"))
        if parent_id is None:
            break
        current_id = parent_id
    return True


def _active_animation_components(renderer: PreviewRenderer) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for node_id, components in renderer.components_by_node.items():
        if not _effectively_active(renderer, node_id):
            continue
        for component_id, component in components:
            component_type = str(component.get("__type__", ""))
            if component_type in ("cc.Animation", "dragonBones.ArmatureDisplay", "sp.Skeleton"):
                result.append(
                    {
                        "node_id": node_id,
                        "component_id": component_id,
                        "path": renderer.node_path(node_id),
                        "type": component_type,
                    }
                )
    return result


def _compare_images(reference_path: Path, output_path: Path) -> Optional[Dict[str, Any]]:
    if not reference_path.exists() or not output_path.exists():
        return None
    reference = Image.open(reference_path).convert("RGB")
    output = Image.open(output_path).convert("RGB")
    if reference.size != output.size:
        return {"reference": str(reference_path), "size_mismatch": [reference.size, output.size]}
    difference = ImageChops.difference(reference, output)
    bbox = difference.getbbox()
    histogram = difference.convert("L").histogram()
    return {
        "reference": str(reference_path),
        "visibly_changed": bbox is not None,
        "changed_pixels": int(sum(histogram[1:])),
        "difference_bbox": list(bbox) if bbox is not None else None,
    }


def _entry(
    spec: ActionSpec,
    renderer: PreviewRenderer,
    output_path: Path,
    isolation_errors: Iterable[str],
    serialized_reference_dir: Optional[Path],
) -> Dict[str, Any]:
    focus_prefix = _full_path(spec.focus_path)
    visible_size_changes = [
        adjustment
        for adjustment in renderer.sprite_size_adjustments
        if adjustment["changed"]
        and _effectively_active(renderer, int(adjustment["node_id"]))
    ]
    focus_size_changes = [
        adjustment
        for adjustment in visible_size_changes
        if adjustment["path"] == focus_prefix
        or adjustment["path"].startswith(f"{focus_prefix}/")
    ]
    comparison = (
        _compare_images(serialized_reference_dir / output_path.name, output_path)
        if serialized_reference_dir is not None
        else None
    )
    return {
        "key": spec.key,
        "title": spec.title,
        "file": output_path.name,
        "focus": focus_prefix,
        "resolution": [renderer.width, renderer.height],
        "note": spec.note,
        "isolation_errors": list(isolation_errors),
        "statistics": dict(renderer.stats),
        "visible_creator_size_mode_changes": visible_size_changes,
        "focus_creator_size_mode_changes": focus_size_changes,
        "creator_size_mode_errors": list(renderer.sprite_size_mode_errors),
        "comparison_to_serialized": comparison,
        "active_nonstatic_components": _active_animation_components(renderer),
        "unresolved_uuids": dict(sorted(renderer.unresolved_uuids.items())),
        "unresolved_assets": dict(sorted(renderer.unresolved_assets.items())),
        "unsupported_visual_components": dict(sorted(renderer.unsupported_types.items())),
    }


def render_actions(
    scene_path: Path,
    output_dir: Path,
    creator_assets: Optional[Path],
    background: Tuple[int, int, int, int],
    simulate_creator_size_mode: bool,
    serialized_reference_dir: Optional[Path],
    selected_keys: Optional[set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    scene_before = scene_path.read_bytes()
    output_dir.mkdir(parents=True, exist_ok=True)
    entries: List[Dict[str, Any]] = []
    all_errors: List[str] = []

    for spec in ACTION_SPECS:
        if selected_keys is not None and spec.key not in selected_keys:
            continue
        output_path = output_dir / spec.filename
        renderer = PreviewRenderer(
            scene_path,
            output_path,
            creator_assets,
            background,
            simulate_creator_size_mode=simulate_creator_size_mode,
        )
        isolation_errors = isolate_action(renderer, spec)
        if isolation_errors:
            all_errors.extend(f"{spec.title}: {message}" for message in isolation_errors)
            entries.append(
                _entry(spec, renderer, output_path, isolation_errors, serialized_reference_dir)
            )
            continue
        renderer.render()
        if (renderer.width, renderer.height) != (750, 1334):
            all_errors.append(
                f"{spec.title}: 输出尺寸为 {renderer.width}x{renderer.height}，预期 750x1334"
            )
        entries.append(
            _entry(spec, renderer, output_path, isolation_errors, serialized_reference_dir)
        )
        print(
            f"[{spec.key}] {spec.title}: {output_path.name} "
            f"({renderer.stats['sprites_rendered']} sprites, "
            f"{renderer.stats['labels_rendered']} labels)"
        )

    scene_after = scene_path.read_bytes()
    if scene_before != scene_after:
        raise RuntimeError("drh8.fire changed while rendering; refusing to report success")

    report = {
        "purpose": "drh8 桌内动态操作状态只读基线预览",
        "scene": str(scene_path),
        "scene_sha256": hashlib.sha256(scene_before).hexdigest(),
        "canvas": [750, 1334],
        "simulate_creator_size_mode": simulate_creator_size_mode,
        "sprite_size_mode_behavior": (
            "RAW 使用 rawWidth/rawHeight，TRIMMED 使用 meta width/height，CUSTOM 保持序列化尺寸。"
            if simulate_creator_size_mode
            else "关闭；全部节点沿用 drh8.fire 序列化 contentSize。"
        ),
        "known_limitations": [
            "PKCardInfoScript 的动态牌值、牌型和分牌移动不由离线渲染器执行。",
            "cc.Animation 只显示当前序列化 SpriteFrame，不播放时间轴。",
            "DragonBones 仅尝试绘制图集代表帧，不复现骨骼姿态或运行时动画。",
            "动态倍率、玩家名称、积分、座位占用和语音时长只显示场景占位状态。",
        ],
        "outputs": entries,
        "errors": all_errors,
    }
    (output_dir / "baseline_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return entries, all_errors


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
    parser.add_argument("--output-dir", type=Path)
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
    parser.add_argument("--simulate-creator-size-mode", action="store_true")
    parser.add_argument(
        "--serialized-reference-dir",
        type=Path,
        default=DEFAULT_SERIALIZED_DIR,
        help="serialized-size preview directory used for pixel comparison",
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=[spec.key for spec in ACTION_SPECS],
        help="render only one action key; repeat to select multiple keys",
    )
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(argv)

    if args.list:
        for spec in ACTION_SPECS:
            print(f"{spec.key:28s} {spec.title:22s} {spec.filename}")
        return 0

    scene_path = args.scene.resolve()
    if not scene_path.exists():
        parser.error(f"scene does not exist: {scene_path}")
    output_dir = (
        args.output_dir.resolve()
        if args.output_dir
        else DEFAULT_CREATOR_SIZE_DIR
        if args.simulate_creator_size_mode
        else DEFAULT_SERIALIZED_DIR
    )
    creator_assets = args.creator_assets.resolve() if args.creator_assets else None
    serialized_reference_dir = (
        args.serialized_reference_dir.resolve()
        if args.simulate_creator_size_mode and args.serialized_reference_dir
        else None
    )
    entries, errors = render_actions(
        scene_path,
        output_dir,
        creator_assets,
        args.background,
        args.simulate_creator_size_mode,
        serialized_reference_dir,
        selected_keys=set(args.only) if args.only else None,
    )
    print(f"Rendered action states: {sum(not entry['isolation_errors'] for entry in entries)}")
    print(f"Report: {output_dir / 'baseline_report.json'}")
    if errors:
        print("Isolation or output errors:")
        for message in errors:
            print(f"  - {message}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
