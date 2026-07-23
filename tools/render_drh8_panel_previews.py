#!/usr/bin/env python3
"""Render isolated baseline previews for every hidden drh8 visual panel.

The script operates on an in-memory copy of ``assets/Scenes/drh8.fire``.  It
forces one hidden panel (or one panel tab) visible at a time, keeps only the
table background that is needed for context, and writes 750x1334 PNG files to
``art_sources/drh8/panel_previews``.  The scene, prefabs, metas and runtime art
are never modified.

Mask and Sliced Sprite rendering are provided by
``render_drh8_scene_preview.PreviewRenderer``.  Widget positions use the
serialized post-alignment coordinates from Creator.  This is exact for this
fixed 750x1334 design preview because neither the parent sizes nor the design
resolution are changed by this tool.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from render_drh8_scene_preview import (
    DEFAULT_CREATOR_ASSETS,
    DEFAULT_SCENE,
    PreviewRenderer,
    ref_id,
)


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "art_sources" / "drh8" / "panel_previews"
PANEL_ROOT_PATH = "Canvas/Normal/panelGameView"


@dataclass(frozen=True)
class PanelSpec:
    """One isolated panel state to render."""

    key: str
    title: str
    filename: str
    target: str
    activate: Tuple[str, ...] = ()
    deactivate: Tuple[str, ...] = ()
    note: str = ""


PANEL_SPECS: Tuple[PanelSpec, ...] = (
    PanelSpec("realtime_record", "实时战绩", "01_实时战绩.png", "实时战绩"),
    PanelSpec(
        "buy_in",
        "带入窗口",
        "02_带入窗口.png",
        "带入窗口",
        deactivate=("带入窗口/余额不足提示",),
    ),
    PanelSpec(
        "buy_in_insufficient",
        "带入窗口－余额不足",
        "03_带入窗口_余额不足.png",
        "带入窗口",
        activate=("带入窗口/余额不足提示",),
        note="嵌套在带入窗口内的二级提示状态。",
    ),
    PanelSpec(
        "round_review",
        "牌局回顾",
        "04_牌局回顾.png",
        "牌局回顾",
        activate=(
            "牌局回顾/回顾列表",
            "牌局回顾/操作/牌局回顾/checkmark",
        ),
        deactivate=(
            "牌局回顾/文字牌谱",
            "牌局回顾/操作/文字牌谱/checkmark",
        ),
        note="回顾列表由运行时数据填充，基线图只显示场景中已序列化内容。",
    ),
    PanelSpec(
        "text_record",
        "文字牌谱",
        "05_文字牌谱.png",
        "牌局回顾",
        activate=(
            "牌局回顾/文字牌谱",
            "牌局回顾/操作/文字牌谱/checkmark",
        ),
        deactivate=(
            "牌局回顾/回顾列表",
            "牌局回顾/操作/牌局回顾/checkmark",
        ),
    ),
    PanelSpec("hand_type_tip", "牌型提示", "06_牌型提示.png", "牌型提示"),
    PanelSpec("settings", "系统设置", "07_系统设置.png", "系统设置"),
    PanelSpec("config_menu", "配置菜单", "08_配置菜单.png", "ConfigMain"),
    PanelSpec("report", "举报窗口", "09_举报窗口.png", "举报窗口"),
    PanelSpec(
        "jackpot_overview",
        "奖池－总览",
        "10_奖池_总览.png",
        "奖池面板",
        activate=(
            "奖池面板/容器/奖池总览",
            "奖池面板/条件/奖池总览/checkmark",
        ),
        deactivate=(
            "奖池面板/容器/奖池",
            "奖池面板/容器/奖池记录",
            "奖池面板/条件/奖池/checkmark",
            "奖池面板/条件/奖池记录/checkmark",
        ),
    ),
    PanelSpec(
        "jackpot_current",
        "奖池－当前奖池",
        "11_奖池_当前奖池.png",
        "奖池面板",
        activate=(
            "奖池面板/容器/奖池",
            "奖池面板/条件/奖池/checkmark",
        ),
        deactivate=(
            "奖池面板/容器/奖池总览",
            "奖池面板/容器/奖池记录",
            "奖池面板/条件/奖池总览/checkmark",
            "奖池面板/条件/奖池记录/checkmark",
        ),
    ),
    PanelSpec(
        "jackpot_record",
        "奖池－奖池记录",
        "12_奖池_奖池记录.png",
        "奖池面板",
        activate=(
            "奖池面板/容器/奖池记录",
            "奖池面板/条件/奖池记录/checkmark",
        ),
        deactivate=(
            "奖池面板/容器/奖池总览",
            "奖池面板/容器/奖池",
            "奖池面板/条件/奖池总览/checkmark",
            "奖池面板/条件/奖池/checkmark",
        ),
        note="奖池记录列表由运行时数据填充。",
    ),
    PanelSpec("generic_tip", "通用提示", "13_通用提示.png", "提示"),
    PanelSpec("start_tip", "开局提示", "14_开局提示.png", "开局提示"),
    PanelSpec("charge_tip", "扣费提示", "15_扣费提示.png", "扣费提示"),
    PanelSpec("mango_tip", "芒果提示", "16_芒果提示.png", "芒果提示"),
    PanelSpec("dissolve", "解散房间", "17_解散房间.png", "解散房间"),
    PanelSpec("gps_warning", "GPS警告", "18_GPS警告.png", "GPS警告"),
    PanelSpec(
        "report_charge_tip",
        "举报扣费提示",
        "19_举报扣费提示.png",
        "举报扣费提示",
    ),
    PanelSpec("rub_card", "搓牌窗口", "20_搓牌窗口.png", "搓牌窗口"),
)


def _path_index(renderer: PreviewRenderer) -> Dict[str, List[int]]:
    result: Dict[str, List[int]] = {}
    for node_id in renderer.nodes:
        result.setdefault(renderer.node_path(node_id), []).append(node_id)
    return result


def _full_path(relative_path: str) -> str:
    relative_path = relative_path.strip("/")
    if not relative_path:
        return PANEL_ROOT_PATH
    return f"{PANEL_ROOT_PATH}/{relative_path}"


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


def isolate_panel(renderer: PreviewRenderer, spec: PanelSpec) -> List[str]:
    """Mutate only the renderer's in-memory scene copy for one panel state."""

    errors: List[str] = []
    index = _path_index(renderer)
    panel_root_id = _resolve_unique(index, "", errors)
    target_id = _resolve_unique(index, spec.target, errors)
    background_id = _resolve_unique(index, "BK", errors)
    if panel_root_id is None or target_id is None or background_id is None:
        return errors

    # Hide every top-level game view child, then restore only the fixed table
    # background and the requested panel.  This prevents unrelated live table
    # controls from obscuring the visual audit of the target panel.
    root_node = renderer.nodes[panel_root_id]
    for child_ref in root_node.get("_children") or []:
        child_id = ref_id(child_ref)
        if child_id in renderer.nodes:
            renderer.nodes[child_id]["_active"] = False

    _set_active_with_ancestors(renderer, background_id, True, panel_root_id)
    _set_active_with_ancestors(renderer, target_id, True, panel_root_id)

    for relative_path in spec.activate:
        node_id = _resolve_unique(index, relative_path, errors)
        if node_id is not None:
            _set_active_with_ancestors(renderer, node_id, True, panel_root_id)
    for relative_path in spec.deactivate:
        node_id = _resolve_unique(index, relative_path, errors)
        if node_id is not None:
            renderer.nodes[node_id]["_active"] = False
    return errors


def _report_entry(
    spec: PanelSpec,
    renderer: PreviewRenderer,
    output_path: Path,
    isolation_errors: Iterable[str],
) -> Dict[str, Any]:
    def effectively_active(node_id: int) -> bool:
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

    target_prefix = _full_path(spec.target)
    target_size_changes = [
        adjustment
        for adjustment in renderer.sprite_size_adjustments
        if adjustment["changed"]
        and (
            adjustment["path"] == target_prefix
            or adjustment["path"].startswith(f"{target_prefix}/")
        )
    ]
    visible_size_changes = [
        adjustment
        for adjustment in target_size_changes
        if effectively_active(int(adjustment["node_id"]))
    ]
    return {
        "key": spec.key,
        "title": spec.title,
        "file": output_path.name,
        "target": _full_path(spec.target),
        "resolution": [renderer.width, renderer.height],
        "note": spec.note,
        "isolation_errors": list(isolation_errors),
        "statistics": dict(renderer.stats),
        "unresolved_uuids": dict(sorted(renderer.unresolved_uuids.items())),
        "unresolved_assets": dict(sorted(renderer.unresolved_assets.items())),
        "unsupported_visual_components": dict(sorted(renderer.unsupported_types.items())),
        "creator_size_mode_changes": visible_size_changes,
        "creator_size_mode_changes_including_inactive": target_size_changes,
        "creator_size_mode_errors": list(renderer.sprite_size_mode_errors),
    }


def render_all(
    scene_path: Path,
    output_dir: Path,
    creator_assets: Optional[Path],
    background: Tuple[int, int, int, int],
    simulate_creator_size_mode: bool = False,
    selected_keys: Optional[set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    scene_before = scene_path.read_bytes()
    output_dir.mkdir(parents=True, exist_ok=True)
    entries: List[Dict[str, Any]] = []
    all_errors: List[str] = []

    for spec in PANEL_SPECS:
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
        isolation_errors = isolate_panel(renderer, spec)
        if isolation_errors:
            all_errors.extend(f"{spec.title}: {message}" for message in isolation_errors)
            # Do not write a misleading image when the requested state could not
            # be isolated deterministically.
            entries.append(_report_entry(spec, renderer, output_path, isolation_errors))
            continue
        renderer.render()
        if (renderer.width, renderer.height) != (750, 1334):
            all_errors.append(
                f"{spec.title}: 输出尺寸为 {renderer.width}x{renderer.height}，预期 750x1334"
            )
        entries.append(_report_entry(spec, renderer, output_path, isolation_errors))
        print(
            f"[{spec.key}] {spec.title}: {output_path.name} "
            f"({renderer.stats['sprites_rendered']} sprites, "
            f"{renderer.stats['labels_rendered']} labels)"
        )

    scene_after = scene_path.read_bytes()
    if scene_before != scene_after:
        raise RuntimeError("drh8.fire changed while rendering; refusing to report success")

    report = {
        "purpose": (
            "drh8 隐藏弹层 Creator Sprite SizeMode 预加载问题基线预览"
            if simulate_creator_size_mode
            else "drh8 隐藏弹层当前美术问题基线预览"
        ),
        "scene": str(scene_path),
        "scene_sha256": hashlib.sha256(scene_before).hexdigest(),
        "canvas": [750, 1334],
        "isolation": "只保留 panelGameView/BK、目标弹层及其必要子状态",
        "simulate_creator_size_mode": simulate_creator_size_mode,
        "sprite_size_mode_behavior": (
            "RAW 使用 SpriteFrame rawWidth/rawHeight，TRIMMED 使用 meta width/height，"
            "CUSTOM 保持 drh8.fire 序列化 contentSize。"
            if simulate_creator_size_mode
            else "关闭；全部节点沿用 drh8.fire 序列化 contentSize。"
        ),
        "widget_handling": (
            "使用 Creator 在 750x1334 设计分辨率下已序列化的 Widget 对齐后坐标；"
            "Sprite SizeMode 只覆盖节点 contentSize，并沿用序列化锚点和位置。"
        ),
        "known_limitations": [
            "ScrollView 中由业务脚本运行时创建的数据条目不会出现在静态场景基线图中。",
            "非矩形、椭圆或反向 cc.Mask 仍按轴对齐矩形近似裁剪。",
            "粒子、Graphics、Spine 和运行时动画状态不由离线渲染器复现。",
            "动态 Label 只显示 drh8.fire 当前序列化的占位值。",
        ],
        "outputs": entries,
        "errors": all_errors,
    }
    report_path = output_dir / "baseline_report.json"
    report_path.write_text(
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
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
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
            "rawWidth/rawHeight and TRIMMED uses frame width/height"
        ),
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=[spec.key for spec in PANEL_SPECS],
        help="render only a named panel key; repeat to select multiple keys",
    )
    parser.add_argument("--list", action="store_true", help="list panel keys and exit")
    args = parser.parse_args(argv)

    if args.list:
        for spec in PANEL_SPECS:
            print(f"{spec.key:24s} {spec.title:16s} {spec.filename}")
        return 0

    scene_path = args.scene.resolve()
    output_dir = args.output_dir.resolve()
    creator_assets = args.creator_assets.resolve() if args.creator_assets else None
    if not scene_path.exists():
        parser.error(f"scene does not exist: {scene_path}")
    entries, errors = render_all(
        scene_path,
        output_dir,
        creator_assets,
        args.background,
        simulate_creator_size_mode=args.simulate_creator_size_mode,
        selected_keys=set(args.only) if args.only else None,
    )
    print(f"Rendered panel states: {sum(not entry['isolation_errors'] for entry in entries)}")
    print(f"Report: {output_dir / 'baseline_report.json'}")
    if errors:
        print("Isolation or output errors:")
        for message in errors:
            print(f"  - {message}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
