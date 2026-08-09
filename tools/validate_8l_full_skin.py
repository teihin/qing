#!/usr/bin/env python3
"""Validate the applied 8L skin against the immutable qing archive.

The check is deliberately structural: it proves every archived runtime image
still has the original dimensions and alpha trim, every Cocos ``.meta`` hash
is unchanged, and all modified raster files belong to the audited target set.
It also reports residual strong red/purple pixels as a palette QA signal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = ROOT / "reports" / "8l-skin-runtime-targets.txt"
DEFAULT_OUTPUT = ROOT / "reports" / "8l-skin-validation.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_targets(path: Path) -> list[str]:
    return sorted(
        {
            line.strip()
            for line in path.read_text("utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
    )


def image_contract(path: Path) -> tuple[tuple[int, int], tuple[int, int, int, int] | None]:
    with Image.open(path) as opened:
        opened.load()
        size = opened.size
        rgba = opened.convert("RGBA")
    alpha = rgba.getchannel("A")
    # Compare the visible trim rectangle, not whether the file happens to use
    # an alpha channel internally.  A fully opaque alpha plane and an RGB
    # image are equivalent for Creator's trim contract.
    return size, alpha.getbbox()


def palette_counts(path: Path) -> tuple[int, int, int]:
    with Image.open(path) as opened:
        rgba = np.asarray(opened.convert("RGBA"), dtype=np.uint16)
    visible = rgba[..., 3] > 16
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    red = visible & (r > 150) & (r * 100 > g * 145) & (r * 100 > b * 125)
    purple = visible & (r > 100) & (b > 100) & (r * 100 > g * 135) & (b * 100 > g * 125)
    return int(visible.sum()), int(red.sum()), int(purple.sum())


def git_names(*patterns: str) -> list[str]:
    command = ["git", "-c", "core.quotePath=false", "diff", "--name-only", "--", *patterns]
    completed = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True)
    return [line for line in completed.stdout.splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, default=DEFAULT_TARGETS)
    parser.add_argument("--base-version", default="qing")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    target_paths = read_targets(args.targets)
    target_set = set(target_paths)
    version_dir = ROOT / "HisImg" / args.base_version
    manifest_path = version_dir / "skin-manifest.json"
    manifest: dict[str, Any] = json.loads(manifest_path.read_text("utf-8"))
    entries = {entry["path"]: entry for entry in manifest["files"]}

    missing_targets = sorted(target_set - entries.keys())
    extra_archive = sorted(entries.keys() - target_set)
    missing_current: list[str] = []
    archive_hash_errors: list[str] = []
    meta_hash_errors: list[str] = []
    dimension_errors: list[dict[str, Any]] = []
    alpha_bbox_errors: list[dict[str, Any]] = []
    unreadable: list[dict[str, str]] = []
    palette_rows: list[dict[str, Any]] = []
    total_visible = total_red = total_purple = 0

    for relative in sorted(entries):
        entry = entries[relative]
        current = ROOT / relative
        archived = version_dir / relative
        if not current.is_file():
            missing_current.append(relative)
            continue
        if not archived.is_file() or sha256(archived) != entry["sha256"]:
            archive_hash_errors.append(relative)
            continue
        meta_path = entry.get("meta_path")
        meta_hash = entry.get("meta_sha256")
        if meta_path and meta_hash:
            meta = ROOT / meta_path
            if not meta.is_file() or sha256(meta) != meta_hash:
                meta_hash_errors.append(meta_path)
        try:
            old_size, old_bbox = image_contract(archived)
            new_size, new_bbox = image_contract(current)
            if old_size != new_size:
                dimension_errors.append({"path": relative, "old": old_size, "new": new_size})
            if old_bbox != new_bbox:
                alpha_bbox_errors.append({"path": relative, "old": old_bbox, "new": new_bbox})
            visible, red, purple = palette_counts(current)
            total_visible += visible
            total_red += red
            total_purple += purple
            if red or purple:
                palette_rows.append(
                    {
                        "path": relative,
                        "visible_pixels": visible,
                        "strong_red_pixels": red,
                        "strong_purple_pixels": purple,
                        "ratio": round((red + purple) / max(1, visible), 8),
                    }
                )
        except Exception as exc:  # image decoder errors must be in the report
            unreadable.append({"path": relative, "error": str(exc)})

    modified_assets = git_names("assets")
    modified_images = sorted(path for path in modified_assets if Path(path).suffix.lower() in IMAGE_SUFFIXES)
    modified_images_outside_targets = sorted(set(modified_images) - target_set)
    modified_meta = git_names("*.meta")
    modified_layout_or_code = git_names("*.prefab", "*.fire", "*.ts")
    modified_poker_faces = sorted(
        path
        for path in modified_images
        if path.startswith("assets/resources/pk2/")
        and Path(path).name not in {"bigbig.png", "bigbi1.png"}
    )
    modified_payment_brand_icons = sorted(
        path
        for path in modified_images
        if path in {"assets/ImagesLuck/钱包/微信.png", "assets/ImagesLuck/钱包/支付宝.png"}
    )

    palette_rows.sort(key=lambda row: row["ratio"], reverse=True)
    structural_errors = {
        "missing_targets": missing_targets,
        "extra_archive": extra_archive,
        "missing_current": missing_current,
        "archive_hash_errors": archive_hash_errors,
        "meta_hash_errors": meta_hash_errors,
        "dimension_errors": dimension_errors,
        "alpha_bbox_errors": alpha_bbox_errors,
        "unreadable": unreadable,
        "modified_images_outside_targets": modified_images_outside_targets,
        "modified_meta": modified_meta,
        "modified_layout_or_code": modified_layout_or_code,
        "modified_standard_poker_faces": modified_poker_faces,
        "modified_payment_brand_icons": modified_payment_brand_icons,
    }
    passed = all(not value for value in structural_errors.values()) and len(entries) == len(target_paths)
    report = {
        "schema": 1,
        "passed": passed,
        "base_version": args.base_version,
        "target_count": len(target_paths),
        "archive_count": len(entries),
        "modified_runtime_images": len(modified_images),
        "checks": structural_errors,
        "palette": {
            "visible_pixels": total_visible,
            "strong_red_pixels": total_red,
            "strong_purple_pixels": total_purple,
            "strong_red_purple_ratio": round((total_red + total_purple) / max(1, total_visible), 10),
            "top_residual_images": palette_rows[:20],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(
        f"8L美术校验：{'通过' if passed else '失败'}；"
        f"目标 {len(target_paths)}；已修改 {len(modified_images)}；"
        f"强红/紫比例 {report['palette']['strong_red_purple_ratio']:.6%}"
    )
    print(f"报告：{args.output}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
