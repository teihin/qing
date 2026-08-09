#!/usr/bin/env python3
"""Archive, verify and restore versioned Cocos raster skins.

The archive keeps every file under its original project-relative path, for
example ``HisImg/qing/assets/ImagesLuck/大厅/房间框.png``.  Cocos ``.meta``
files are deliberately not overwritten: their hashes are recorded in the
manifest and checked before restore so UUID/slice contracts stay stable.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "HisImg"
MANIFEST_NAME = "skin-manifest.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class SkinError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def version_dir(version: str) -> Path:
    if not VERSION_RE.fullmatch(version):
        raise SkinError(f"版本名不合法：{version!r}")
    return HISTORY / version


def read_targets(path: Path) -> list[Path]:
    if not path.is_file():
        raise SkinError(f"目标清单不存在：{path}")
    targets: list[Path] = []
    seen: set[Path] = set()
    for line_no, raw in enumerate(path.read_text("utf-8-sig").splitlines(), 1):
        value = raw.strip()
        if not value or value.startswith("#"):
            continue
        candidate = (ROOT / value).resolve()
        try:
            candidate.relative_to((ROOT / "assets").resolve())
        except ValueError as exc:
            raise SkinError(f"第 {line_no} 行越出 assets：{value}") from exc
        if candidate.suffix.lower() not in IMAGE_SUFFIXES:
            raise SkinError(f"第 {line_no} 行不是支持的图片：{value}")
        if not candidate.is_file():
            raise SkinError(f"第 {line_no} 行图片不存在：{value}")
        if candidate not in seen:
            targets.append(candidate)
            seen.add(candidate)
    if not targets:
        raise SkinError("目标清单为空")
    return sorted(targets, key=rel)


def load_manifest(directory: Path) -> dict:
    path = directory / MANIFEST_NAME
    if not path.is_file():
        raise SkinError(f"版本缺少 {MANIFEST_NAME}：{directory}")
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SkinError(f"版本清单损坏：{path}: {exc}") from exc
    if data.get("schema") != 1 or not isinstance(data.get("files"), list):
        raise SkinError(f"不支持的版本清单：{path}")
    return data


def build_entry(source: Path) -> dict:
    meta = source.with_suffix(source.suffix + ".meta")
    return {
        "path": rel(source),
        "sha256": sha256(source),
        "bytes": source.stat().st_size,
        "meta_path": rel(meta) if meta.is_file() else None,
        "meta_sha256": sha256(meta) if meta.is_file() else None,
    }


def snapshot(args: argparse.Namespace) -> None:
    destination = version_dir(args.version)
    if destination.exists():
        raise SkinError(f"版本已存在，拒绝覆盖：{destination}")
    targets = read_targets(Path(args.targets_file))
    HISTORY.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f".{args.version}-", dir=HISTORY))
    try:
        entries: list[dict] = []
        total = len(targets)
        for index, source in enumerate(targets, 1):
            relative = Path(rel(source))
            archived = temp / relative
            archived.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, archived)
            entry = build_entry(source)
            if sha256(archived) != entry["sha256"]:
                raise SkinError(f"归档复制校验失败：{relative}")
            entries.append(entry)
            if args.verbose:
                print(f"[{index}/{total}] {relative}")
        manifest = {
            "schema": 1,
            "version": args.version,
            "description": args.description or "",
            "created_at": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
            "project": ROOT.name,
            "file_count": len(entries),
            "files": entries,
        }
        (temp / MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8"
        )
        os.replace(temp, destination)
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise
    print(f"已归档美术版本 {args.version}：{len(targets)} 张 -> {destination}")


def extend(args: argparse.Namespace) -> None:
    """Add previously untracked originals to an existing immutable snapshot.

    Existing archived paths are never replaced.  This is intended for a scope
    audit that discovers extra UI rasters after the initial snapshot; only new
    target paths are copied from the still-unmodified workspace.
    """
    destination = version_dir(args.version)
    manifest = load_manifest(destination)
    preflight(destination, manifest, check_workspace=False)
    targets = read_targets(Path(args.targets_file))
    entries_by_path = {entry["path"]: entry for entry in manifest["files"]}
    new_targets = [target for target in targets if rel(target) not in entries_by_path]
    if not new_targets:
        print(f"版本 {args.version} 无需扩展：仍为 {len(entries_by_path)} 张")
        return

    staged: list[tuple[Path, Path, dict]] = []
    try:
        for index, source in enumerate(new_targets, 1):
            relative = Path(rel(source))
            archived = destination / relative
            if archived.exists():
                raise SkinError(f"版本目录存在未登记文件，拒绝覆盖：{relative}")
            archived.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                prefix=f".{archived.name}.", suffix=".skin-extend", dir=archived.parent, delete=False
            ) as handle:
                temp = Path(handle.name)
            shutil.copy2(source, temp)
            entry = build_entry(source)
            if sha256(temp) != entry["sha256"]:
                raise SkinError(f"扩展归档复制校验失败：{relative}")
            staged.append((temp, archived, entry))
            if args.verbose:
                print(f"[{index}/{len(new_targets)}] {relative}")

        for temp, archived, entry in staged:
            os.replace(temp, archived)
            entries_by_path[entry["path"]] = entry
        entries = [entries_by_path[key] for key in sorted(entries_by_path)]
        manifest["files"] = entries
        manifest["file_count"] = len(entries)
        manifest["extended_at"] = dt.datetime.now(dt.timezone.utc).astimezone().isoformat()
        manifest["description"] = args.description or manifest.get("description", "")
        with tempfile.NamedTemporaryFile(
            prefix=f".{MANIFEST_NAME}.", suffix=".tmp", dir=destination, delete=False, mode="w", encoding="utf-8"
        ) as handle:
            manifest_temp = Path(handle.name)
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(manifest_temp, destination / MANIFEST_NAME)
    finally:
        for temp, _, _ in staged:
            temp.unlink(missing_ok=True)
    prepared = preflight(destination, load_manifest(destination), check_workspace=False)
    print(f"已扩展美术版本 {args.version}：新增 {len(new_targets)} 张，共 {len(prepared)} 张")


def preflight(directory: Path, manifest: dict, *, check_workspace: bool) -> list[tuple[Path, Path, dict]]:
    prepared: list[tuple[Path, Path, dict]] = []
    seen: set[str] = set()
    for entry in manifest["files"]:
        relative = entry.get("path")
        if not isinstance(relative, str) or relative in seen:
            raise SkinError(f"版本清单含无效或重复路径：{relative!r}")
        seen.add(relative)
        target = (ROOT / relative).resolve()
        archive = (directory / relative).resolve()
        try:
            target.relative_to((ROOT / "assets").resolve())
            archive.relative_to(directory.resolve())
        except ValueError as exc:
            raise SkinError(f"版本路径越界：{relative}") from exc
        if not archive.is_file() or sha256(archive) != entry.get("sha256"):
            raise SkinError(f"归档文件缺失或哈希错误：{relative}")
        meta_path = entry.get("meta_path")
        meta_hash = entry.get("meta_sha256")
        if meta_path and meta_hash:
            meta = ROOT / meta_path
            if not meta.is_file() or sha256(meta) != meta_hash:
                raise SkinError(f"当前 .meta 已变化，拒绝恢复以避免 UUID/切片错位：{meta_path}")
        if check_workspace and (not target.is_file() or sha256(target) != entry.get("sha256")):
            raise SkinError(f"工作区与版本不一致：{relative}")
        prepared.append((archive, target, entry))
    if len(prepared) != manifest.get("file_count"):
        raise SkinError("版本 file_count 与实际条目不一致")
    return prepared


def verify(args: argparse.Namespace) -> None:
    directory = version_dir(args.version)
    manifest = load_manifest(directory)
    prepared = preflight(directory, manifest, check_workspace=args.workspace)
    scope = "归档与工作区" if args.workspace else "归档"
    print(f"{scope}校验通过：{args.version}，{len(prepared)} 张")


def restore(args: argparse.Namespace) -> None:
    directory = version_dir(args.version)
    manifest = load_manifest(directory)
    prepared = preflight(directory, manifest, check_workspace=False)
    if args.dry_run:
        print(f"恢复预检通过（未写入）：{args.version}，{len(prepared)} 张")
        return
    total = len(prepared)
    for index, (archive, target, _) in enumerate(prepared, 1):
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=f".{target.name}.", suffix=".skin-restore", dir=target.parent, delete=False
        ) as handle:
            temp = Path(handle.name)
        try:
            shutil.copy2(archive, temp)
            if sha256(temp) != sha256(archive):
                raise SkinError(f"恢复临时文件校验失败：{rel(target)}")
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        if args.verbose:
            print(f"[{index}/{total}] {rel(target)}")
    preflight(directory, manifest, check_workspace=True)
    print(f"已恢复美术版本 {args.version}：{total} 张")


def list_versions(_: argparse.Namespace) -> None:
    if not HISTORY.is_dir():
        print("暂无历史美术版本")
        return
    found = 0
    for directory in sorted(path for path in HISTORY.iterdir() if path.is_dir() and not path.name.startswith(".")):
        try:
            manifest = load_manifest(directory)
        except SkinError as exc:
            print(f"{directory.name}\t损坏\t{exc}")
            continue
        found += 1
        print(
            f"{manifest.get('version')}\t{manifest.get('file_count')} 张\t"
            f"{manifest.get('created_at')}\t{manifest.get('description', '')}"
        )
    if not found:
        print("暂无历史美术版本")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="管理 HisImg 下的可恢复美术版本")
    sub = result.add_subparsers(dest="command", required=True)

    snap = sub.add_parser("snapshot", help="按目标清单创建不可覆盖的版本快照")
    snap.add_argument("version")
    snap.add_argument("--targets-file", required=True)
    snap.add_argument("--description")
    snap.add_argument("--verbose", action="store_true")
    snap.set_defaults(func=snapshot)

    grow = sub.add_parser("extend", help="只向现有版本补充尚未归档的目标，不覆盖旧文件")
    grow.add_argument("version")
    grow.add_argument("--targets-file", required=True)
    grow.add_argument("--description")
    grow.add_argument("--verbose", action="store_true")
    grow.set_defaults(func=extend)

    check = sub.add_parser("verify", help="校验历史版本，可选同时校验当前工作区")
    check.add_argument("version")
    check.add_argument("--workspace", action="store_true")
    check.set_defaults(func=verify)

    recover = sub.add_parser("restore", help="一键恢复指定版本，仅覆盖图片字节")
    recover.add_argument("version")
    recover.add_argument("--dry-run", action="store_true")
    recover.add_argument("--verbose", action="store_true")
    recover.set_defaults(func=restore)

    listing = sub.add_parser("list", help="列出全部历史版本")
    listing.set_defaults(func=list_versions)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        args.func(args)
    except SkinError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
