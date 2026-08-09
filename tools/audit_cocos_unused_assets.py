#!/usr/bin/env python3
"""
Conservative unused-asset audit for the qing Cocos Creator 2.4 project.

The tool never deletes or moves project files. It starts from the login scene,
hall prefab and active game scene, follows serialized UUID references and local
script imports, then adds resources referenced through the project's known
dynamic-loading conventions. Current build output files are mapped back to
source UUIDs so the report uses logical package bytes instead of exFAT disk
allocation.
"""

from __future__ import annotations

import csv
import json
import posixpath
import re
import zipfile
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ASSETS_ROOT = PROJECT_ROOT / "assets"
BUILD_ASSETS_ROOT = PROJECT_ROOT / "build/jsb-link/assets"
REPORTS_ROOT = PROJECT_ROOT / "reports"

PACKAGE_SNAPSHOTS = (
    (
        "Android Release APK",
        PROJECT_ROOT
        / "build/jsb-link/frameworks/runtime-src/proj.android-studio/app/release/qing-release.apk",
    ),
    (
        "iOS 未签名 IPA",
        PROJECT_ROOT / "build/ios-unsigned/qing-ios-voice-unsigned.ipa",
    ),
)

ROOT_ASSETS = (
    "assets/Scenes/login.fire",
    "assets/resources/UI/panelMain.prefab",
    "assets/Scenes/drh8.fire",
    "assets/resources/UI/panelGameView.prefab",
)

TEXT_EXTENSIONS = {
    ".anim",
    ".atlas",
    ".fire",
    ".fnt",
    ".js",
    ".json",
    ".labelatlas",
    ".manifest",
    ".plist",
    ".prefab",
    ".ts",
    ".txt",
    ".xml",
}

SERIALIZED_UUID_EXTENSIONS = {
    ".anim",
    ".atlas",
    ".fire",
    ".fnt",
    ".labelatlas",
    ".plist",
    ".prefab",
}

SCRIPT_EXTENSIONS = {".ts", ".js"}

UUID_RE = re.compile(
    r"(?<![0-9a-fA-F])"
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"(?![0-9a-fA-F])"
)
COMPRESSED_UUID_RE = re.compile(r"(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{22})(?![A-Za-z0-9+/])")
SCRIPT_CLASS_UUID_RE = re.compile(
    r"(?<![A-Za-z0-9+/])([0-9a-fA-F]{5}[A-Za-z0-9+/]{18})(?![A-Za-z0-9+/])"
)
STRING_RE = re.compile(
    r"""(?P<quote>["'`])(?P<value>(?:\\.|(?!\1).)*?)(?P=quote)""",
    re.DOTALL,
)
IMPORT_RE = re.compile(
    r"""(?:from\s*|import\s*|require\s*\(\s*)["']([^"']+)["']"""
)

BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
BASE64_VALUES = {char: index for index, char in enumerate(BASE64_ALPHABET)}
HEX_CHARS = "0123456789abcdef"
UUID_TEMPLATE = list("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
UUID_INDICES = [index for index, char in enumerate(UUID_TEMPLATE) if char != "-"]


@dataclass
class Asset:
    path: Path
    relative: str
    extension: str
    category: str
    source_bytes: int
    importer: str = ""
    uuids: Set[str] = field(default_factory=set)
    resource_key: Optional[str] = None
    references: Set[str] = field(default_factory=set)
    built_bytes: int = 0
    built_bundle: str = ""


def logical_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def human_bytes(value: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    amount = float(value)
    for unit in units:
        if amount < 1024.0 or unit == units[-1]:
            if unit == "B":
                return f"{int(amount)} {unit}"
            return f"{amount:.2f} {unit}"
        amount /= 1024.0
    return f"{value} B"


def category_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return "image"
    if suffix in {".mp3", ".wav", ".m4a", ".ogg"}:
        return "audio"
    if suffix == ".prefab":
        return "prefab"
    if suffix == ".fire":
        return "scene"
    if suffix in SCRIPT_EXTENSIONS:
        return "script"
    if suffix in {".ttf", ".otf"}:
        return "font"
    if suffix in {".anim"}:
        return "animation"
    if suffix in {".json", ".txt", ".plist", ".xml", ".manifest"}:
        return "data"
    return suffix.lstrip(".") or "other"


def normalize_uuid(value: str) -> str:
    return value.lower()


def decode_compressed_uuid(value: str) -> str:
    if len(value) != 22:
        return value
    output = list(UUID_TEMPLATE)
    output[0] = value[0]
    output[1] = value[1]
    target_index = 2
    try:
        for source_index in range(2, 22, 2):
            lhs = BASE64_VALUES[value[source_index]]
            rhs = BASE64_VALUES[value[source_index + 1]]
            output[UUID_INDICES[target_index]] = HEX_CHARS[lhs >> 2]
            target_index += 1
            output[UUID_INDICES[target_index]] = HEX_CHARS[((lhs & 3) << 2) | (rhs >> 4)]
            target_index += 1
            output[UUID_INDICES[target_index]] = HEX_CHARS[rhs & 0xF]
            target_index += 1
    except (KeyError, IndexError):
        return value
    return "".join(output).lower()


def decode_script_class_uuid(value: str) -> str:
    """Decode Creator 2.4's 23-character serialized script class id."""
    if len(value) != 23:
        return value
    output = list(value[:5].lower())
    try:
        for source_index in range(5, 23, 2):
            lhs = BASE64_VALUES[value[source_index]]
            rhs = BASE64_VALUES[value[source_index + 1]]
            output.append(HEX_CHARS[lhs >> 2])
            output.append(HEX_CHARS[((lhs & 3) << 2) | (rhs >> 4)])
            output.append(HEX_CHARS[rhs & 0xF])
    except (KeyError, IndexError):
        return value
    raw = "".join(output)
    return (
        f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-"
        f"{raw[16:20]}-{raw[20:]}"
    )


def extract_uuid_values(value: object) -> Set[str]:
    results: Set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "uuid" and isinstance(child, str):
                results.add(normalize_uuid(child))
            results.update(extract_uuid_values(child))
    elif isinstance(value, list):
        for child in value:
            results.update(extract_uuid_values(child))
    return results


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def extract_referenced_uuids(text: str, known_uuids: Set[str]) -> Set[str]:
    results = {normalize_uuid(match) for match in UUID_RE.findall(text)}
    for compressed in COMPRESSED_UUID_RE.findall(text):
        decoded = decode_compressed_uuid(compressed)
        if decoded in known_uuids:
            results.add(decoded)
    for compressed in SCRIPT_CLASS_UUID_RE.findall(text):
        decoded = decode_script_class_uuid(compressed)
        if decoded in known_uuids:
            results.add(decoded)
    return results & known_uuids


def iter_source_assets() -> Iterable[Path]:
    for path in ASSETS_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.name.startswith("._") or path.name == ".DS_Store":
            continue
        if path.suffix == ".meta":
            continue
        yield path


def build_inventory() -> Tuple[Dict[str, Asset], Dict[str, str], List[str]]:
    assets: Dict[str, Asset] = {}
    uuid_owner: Dict[str, str] = {}
    warnings: List[str] = []

    for path in iter_source_assets():
        relative = path.relative_to(PROJECT_ROOT).as_posix()
        resource_key = None
        try:
            resource_relative = path.relative_to(ASSETS_ROOT / "resources")
            resource_key = resource_relative.with_suffix("").as_posix()
        except ValueError:
            pass

        asset = Asset(
            path=path,
            relative=relative,
            extension=path.suffix.lower(),
            category=category_for(path),
            source_bytes=logical_size(path),
            resource_key=resource_key,
        )

        meta_path = Path(f"{path}.meta")
        if meta_path.exists():
            try:
                meta_data = json.loads(read_text(meta_path))
                asset.uuids = extract_uuid_values(meta_data)
                importer = meta_data.get("importer")
                if isinstance(importer, str):
                    asset.importer = importer
            except json.JSONDecodeError:
                warnings.append(f"无法解析 meta: {meta_path.relative_to(PROJECT_ROOT).as_posix()}")
        else:
            warnings.append(f"缺少 meta: {relative}")

        assets[relative] = asset
        for uuid in asset.uuids:
            existing = uuid_owner.get(uuid)
            if existing and existing != relative:
                warnings.append(f"UUID 重复: {uuid} -> {existing}, {relative}")
            else:
                uuid_owner[uuid] = relative

    known_uuids = set(uuid_owner)
    for asset in assets.values():
        if asset.extension not in TEXT_EXTENSIONS:
            continue
        refs: Set[str] = set()
        if asset.extension in SERIALIZED_UUID_EXTENSIONS:
            refs.update(extract_referenced_uuids(read_text(asset.path), known_uuids))
        meta_path = Path(f"{asset.path}.meta")
        if meta_path.exists():
            refs.update(extract_referenced_uuids(read_text(meta_path), known_uuids))
        asset.references = {
            uuid_owner[uuid]
            for uuid in refs
            if uuid in uuid_owner and uuid_owner[uuid] != asset.relative
        }

        # DragonBones atlas JSON refers to its texture by sibling file name,
        # not UUID. Without this edge a live atlas texture looks orphaned.
        if asset.importer == "dragonbones-atlas":
            try:
                atlas_data = json.loads(read_text(asset.path))
            except json.JSONDecodeError:
                atlas_data = {}
            image_path = atlas_data.get("imagePath") if isinstance(atlas_data, dict) else None
            if isinstance(image_path, str):
                sibling = (asset.path.parent / image_path).resolve()
                try:
                    sibling_relative = sibling.relative_to(PROJECT_ROOT).as_posix()
                except ValueError:
                    sibling_relative = ""
                if sibling_relative in assets and sibling_relative != asset.relative:
                    asset.references.add(sibling_relative)

    return assets, uuid_owner, warnings


def build_script_indexes(
    assets: Dict[str, Asset],
) -> Tuple[Dict[str, str], Dict[str, List[str]], Dict[str, List[str]]]:
    path_index: Dict[str, str] = {}
    basename_index: Dict[str, List[str]] = defaultdict(list)
    stem_index: Dict[str, List[str]] = defaultdict(list)
    for relative, asset in assets.items():
        if asset.extension not in SCRIPT_EXTENSIONS:
            continue
        asset_path = Path(relative)
        without_suffix = asset_path.with_suffix("").as_posix()
        path_index[relative] = relative
        path_index[without_suffix] = relative
        basename_index[asset_path.name].append(relative)
        stem_index[asset_path.stem].append(relative)
    return path_index, basename_index, stem_index


def resolve_script_imports(
    asset: Asset,
    assets: Dict[str, Asset],
    path_index: Dict[str, str],
    basename_index: Dict[str, List[str]],
    stem_index: Dict[str, List[str]],
) -> Set[str]:
    if asset.extension not in SCRIPT_EXTENSIONS:
        return set()
    results: Set[str] = set()
    text = read_text(asset.path)
    for specifier in IMPORT_RE.findall(text):
        if specifier.startswith("."):
            base = (Path(asset.relative).parent / specifier).as_posix()
            candidates = (
                base,
                f"{base}.ts",
                f"{base}.js",
                f"{base}/index.ts",
                f"{base}/index.js",
            )
            for candidate in candidates:
                normalized = posixpath.normpath(candidate)
                if normalized in path_index:
                    results.add(path_index[normalized])
                    break
                if normalized in assets and assets[normalized].extension in SCRIPT_EXTENSIONS:
                    results.add(normalized)
                    break
        else:
            name = Path(specifier).name
            matches = basename_index.get(name, [])
            if not matches:
                matches = stem_index.get(Path(name).stem, [])
            if len(matches) == 1:
                results.add(matches[0])
    return results


def build_resource_indexes(
    assets: Dict[str, Asset],
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    key_index: Dict[str, List[str]] = defaultdict(list)
    basename_index: Dict[str, List[str]] = defaultdict(list)
    for relative, asset in assets.items():
        if asset.resource_key is None:
            continue
        key_index[asset.resource_key].append(relative)
        key_index[f"resources/{asset.resource_key}"].append(relative)
        basename_index[Path(asset.resource_key).name].append(relative)
    return key_index, basename_index


def unescape_string_literal(value: str) -> str:
    value = value.replace(r"\/", "/")
    value = value.replace(r"\\", "\\")
    value = value.replace(r"\"", '"').replace(r"\'", "'")
    return value


def dynamic_literal_assets(
    script: Asset,
    assets: Dict[str, Asset],
    key_index: Dict[str, List[str]],
    basename_index: Dict[str, List[str]],
) -> Dict[str, str]:
    results: Dict[str, str] = {}
    text = read_text(script.path)
    for match in STRING_RE.finditer(text):
        value = unescape_string_literal(match.group("value")).strip()
        if not value or "${" in value:
            continue
        normalized = value.replace("\\", "/").lstrip("/")
        if normalized.startswith("assets/resources/"):
            normalized = normalized[len("assets/resources/") :]
        normalized_without_suffix = str(Path(normalized).with_suffix("")) if Path(normalized).suffix else normalized

        exact_matches = key_index.get(normalized_without_suffix, [])
        if len(exact_matches) == 1:
            results[exact_matches[0]] = f"动态字面量 {value}"
            continue

        # Existing UIManager/ObjPoolManager/ScrollViewEx APIs commonly pass only
        # a prefab basename. Only accept a unique prefab/UI match.
        basename_matches = [
            relative
            for relative in basename_index.get(normalized, [])
            if assets[relative].extension == ".prefab"
            and (
                "/resources/UI/" in f"/{relative}"
                or "/resources/Prefabs/" in f"/{relative}"
            )
        ]
        if len(basename_matches) == 1:
            results[basename_matches[0]] = f"动态 prefab 名 {value}"
    return results


def dynamic_family_assets(script: Asset, assets: Dict[str, Asset]) -> Dict[str, str]:
    relative = script.relative
    rules: List[Tuple[str, str]] = []

    if relative.endswith("/logic/ImageManager.ts"):
        rules.append(("avatars/", "头像编号动态加载"))
    if relative.endswith("/logic/PKCardInfoScript.ts") or relative.endswith(
        "/logic/DrhPlayerLogic.ts"
    ):
        rules.extend(
            (
                ("pk2/", "牌值动态加载"),
                ("zuotype/", "牌型/牌背动态加载"),
            )
        )
    if relative.endswith("/logic/DrhPlayerLogic.ts"):
        rules.extend(
            (
                ("表情2/", "表情编号动态加载"),
                ("other/状态_", "房间状态动态加载"),
                ("other/背景_", "房间状态背景动态加载"),
                ("other/drh/", "牌桌操作名称动态图片"),
            )
        )
    if relative.endswith("/UI/panelGameView.ts") or relative.endswith(
        "/UI/panelRecordInfo.ts"
    ):
        rules.append(("other/牌谱/", "牌谱状态值动态图片"))
    if relative.endswith("/logic/DaojuManager.ts"):
        rules.extend(
            (
                ("道具/", "道具名称动态加载"),
                ("Audio/道具声音/", "道具名称动态音效"),
            )
        )
    if relative.endswith("/logic/DrhLogicMgr.ts") or relative.endswith(
        "/logic/DrhPlayerLogic.ts"
    ):
        rules.append(("Audio/eff/", "牌局动作名称动态音效"))
    if relative.endswith("/common/UIViewBase.ts"):
        rules.append(("Audio/按键", "通用按钮音效"))

    results: Dict[str, str] = {}
    for asset_relative, asset in assets.items():
        if asset.resource_key is None:
            continue
        if (
            (
                relative.endswith("/UI/panelGameView.ts")
                or relative.endswith("/UI/panelRecordInfo.ts")
            )
            and asset.resource_key.startswith("other/")
            and asset.resource_key.count("/") == 1
        ):
            results[asset_relative] = "牌局记录状态值动态图片"
            continue
        for prefix, reason in rules:
            if asset.resource_key.startswith(prefix):
                results[asset_relative] = reason
                break
    return results


def compute_reachability(
    assets: Dict[str, Asset],
) -> Tuple[Set[str], Set[str], Dict[str, Set[str]], List[str]]:
    roots = [root for root in ROOT_ASSETS if root in assets]
    missing_roots = [root for root in ROOT_ASSETS if root not in assets]

    path_index, script_basename_index, script_stem_index = build_script_indexes(assets)
    resource_key_index, resource_basename_index = build_resource_indexes(assets)

    reachable: Set[str] = set()
    dynamic_roots: Set[str] = set()
    reasons: Dict[str, Set[str]] = defaultdict(set)
    queue: deque[str] = deque()

    def add(relative: str, reason: str, dynamic: bool = False) -> None:
        if relative not in assets:
            return
        reasons[relative].add(reason)
        if dynamic:
            dynamic_roots.add(relative)
        if relative not in reachable:
            reachable.add(relative)
            queue.append(relative)

    for root in roots:
        add(root, "审计入口")

    while queue:
        relative = queue.popleft()
        asset = assets[relative]

        for dependency in asset.references:
            add(dependency, f"UUID 引用自 {relative}")

        if asset.extension not in SCRIPT_EXTENSIONS:
            continue

        for imported in resolve_script_imports(
            asset,
            assets,
            path_index,
            script_basename_index,
            script_stem_index,
        ):
            add(imported, f"脚本导入自 {relative}")

        if relative.endswith("/GameDataManager.ts") or relative.endswith(
            "/kbe_scripts/kbengine.js"
        ):
            for script_relative, script_asset in assets.items():
                if (
                    "/scripts/kbe_scripts/" in f"/{script_relative}"
                    and script_asset.extension in SCRIPT_EXTENSIONS
                ):
                    add(
                        script_relative,
                        f"KBEngine 实体类型按名称动态装载，来自 {relative}",
                        dynamic=True,
                    )

        for dynamic_relative, reason in dynamic_literal_assets(
            asset,
            assets,
            resource_key_index,
            resource_basename_index,
        ).items():
            add(dynamic_relative, f"{reason}，来自 {relative}", dynamic=True)

        for dynamic_relative, reason in dynamic_family_assets(asset, assets).items():
            add(dynamic_relative, f"{reason}，来自 {relative}", dynamic=True)

    # Creator 2.4 merges project scripts into its script bundle, and this
    # project also contains global-style JS modules (QR code, CryptoJS and
    # KBEngine entity classes) that are not reliably represented by ES import
    # edges. Keep every script out of the deletion candidate set, but do not
    # execute dynamic-resource rules from otherwise unreachable components.
    for script_relative, script_asset in assets.items():
        if script_asset.extension in SCRIPT_EXTENSIONS and script_relative not in reachable:
            reachable.add(script_relative)
            dynamic_roots.add(script_relative)
            reasons[script_relative].add("Cocos 脚本合包或全局模块，保守保留")

    return reachable, dynamic_roots, reasons, missing_roots


def map_build_bytes(
    assets: Dict[str, Asset],
    uuid_owner: Dict[str, str],
) -> Tuple[int, int, List[Tuple[str, int]]]:
    if not BUILD_ASSETS_ROOT.exists():
        return 0, 0, []

    total = 0
    attributed = 0
    unattributed: List[Tuple[str, int]] = []
    for path in BUILD_ASSETS_ROOT.rglob("*"):
        if not path.is_file() or path.name.startswith("._") or path.name == ".DS_Store":
            continue
        size = logical_size(path)
        total += size
        relative_build = path.relative_to(BUILD_ASSETS_ROOT).as_posix()
        owner = None
        for uuid in UUID_RE.findall(relative_build):
            owner = uuid_owner.get(normalize_uuid(uuid))
            if owner:
                break
        if owner:
            assets[owner].built_bytes += size
            bundle = relative_build.split("/", 1)[0]
            existing = assets[owner].built_bundle
            assets[owner].built_bundle = bundle if not existing else existing
            attributed += size
        else:
            unattributed.append((relative_build, size))
    return total, attributed, unattributed


def group_key(relative: str) -> str:
    parts = Path(relative).parts
    if len(parts) >= 3 and parts[0] == "assets" and parts[1] == "resources":
        return "/".join(parts[:3])
    if (
        len(parts) >= 3
        and parts[0] == "assets"
        and parts[1] == "Images"
        and parts[2] in {"表情", "表情kk"}
    ):
        return "/".join(parts[:3])
    if len(parts) >= 2 and parts[0] == "assets":
        return "/".join(parts[:2])
    return parts[0] if parts else relative


def write_csv(
    path: Path,
    rows: Iterable[Tuple[str, Asset, str]],
) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            (
                "状态",
                "源文件",
                "类型",
                "源文件字节",
                "当前构建归属字节",
                "构建分包",
                "判定说明",
            )
        )
        for status, asset, reason in rows:
            writer.writerow(
                (
                    status,
                    asset.relative,
                    asset.category,
                    asset.source_bytes,
                    asset.built_bytes,
                    asset.built_bundle,
                    reason,
                )
            )


def render_table(headers: List[str], rows: List[List[str]]) -> str:
    output = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    output.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(output)


def package_snapshot_rows(
    assets: Dict[str, Asset],
    packaged_candidates: List[Asset],
) -> List[List[str]]:
    uuid_owner = {
        uuid: asset.relative for asset in assets.values() for uuid in asset.uuids
    }
    candidate_paths = {asset.relative for asset in packaged_candidates}
    rows: List[List[str]] = []
    for label, path in PACKAGE_SNAPSHOTS:
        if not path.exists():
            continue
        asset_compressed = 0
        native_code_compressed = 0
        candidate_compressed = 0
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                archive_path = info.filename
                is_asset = archive_path.startswith("assets/") or ".app/assets/" in archive_path
                if is_asset:
                    asset_compressed += info.compress_size
                if archive_path.startswith("lib/") or re.search(
                    r"\.app/(?:Qing-mobile|qing-mobile)$", archive_path
                ):
                    native_code_compressed += info.compress_size
                owner = None
                for uuid in UUID_RE.findall(archive_path):
                    owner = uuid_owner.get(normalize_uuid(uuid))
                    if owner:
                        break
                if owner in candidate_paths:
                    candidate_compressed += info.compress_size
        rows.append(
            [
                label,
                human_bytes(logical_size(path)),
                human_bytes(asset_compressed),
                human_bytes(native_code_compressed),
                human_bytes(candidate_compressed),
            ]
        )
    return rows


def generate_reports(
    assets: Dict[str, Asset],
    reachable: Set[str],
    dynamic_roots: Set[str],
    reasons: Dict[str, Set[str]],
    warnings: List[str],
    missing_roots: List[str],
    build_total: int,
    build_attributed: int,
    unattributed: List[Tuple[str, int]],
) -> Tuple[Path, Path, Path]:
    REPORTS_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    markdown_path = REPORTS_ROOT / f"cocos-unused-assets-audit-{stamp}.md"
    candidates_path = REPORTS_ROOT / f"cocos-unused-assets-candidates-{stamp}.csv"
    retained_path = REPORTS_ROOT / f"cocos-dynamic-assets-retained-{stamp}.csv"

    candidates = [asset for relative, asset in assets.items() if relative not in reachable]
    packaged_candidates = [asset for asset in candidates if asset.built_bytes > 0]
    source_only_candidates = [asset for asset in candidates if asset.built_bytes == 0]
    static_reachable = [
        asset
        for relative, asset in assets.items()
        if relative in reachable and relative not in dynamic_roots
    ]
    dynamic_retained = [assets[relative] for relative in dynamic_roots]

    candidate_rows = []
    for asset in sorted(
        candidates,
        key=lambda item: (item.built_bytes, item.source_bytes, item.relative),
        reverse=True,
    ):
        status = "疑似未用-当前已打包" if asset.built_bytes else "疑似未用-源码残留"
        reason = "未被入口 UUID 依赖、可达脚本字面量或已知动态资源族命中"
        candidate_rows.append((status, asset, reason))
    write_csv(candidates_path, candidate_rows)

    retained_rows = []
    for asset in sorted(
        dynamic_retained,
        key=lambda item: (item.built_bytes, item.source_bytes, item.relative),
        reverse=True,
    ):
        retained_rows.append(
            (
                "动态保留",
                asset,
                "；".join(sorted(reasons.get(asset.relative, {"动态规则"}))),
            )
        )
    write_csv(retained_path, retained_rows)

    source_total = sum(asset.source_bytes for asset in assets.values())
    packaged_candidate_bytes = sum(asset.built_bytes for asset in packaged_candidates)
    packaged_candidate_source_bytes = sum(asset.source_bytes for asset in packaged_candidates)
    source_only_candidate_bytes = sum(asset.source_bytes for asset in source_only_candidates)
    dynamic_built_bytes = sum(asset.built_bytes for asset in dynamic_retained)
    static_built_bytes = sum(asset.built_bytes for asset in static_reachable)

    legacy_emotion_prefixes = (
        "assets/Images/表情/",
        "assets/Images/表情kk/",
        "assets/resources/表情/",
        "assets/resources/表情---/",
        "assets/resources/表情声音/",
    )
    legacy_emotion_candidates = [
        asset
        for asset in packaged_candidates
        if asset.relative.startswith(legacy_emotion_prefixes)
    ]
    legacy_emotion_bytes = sum(asset.built_bytes for asset in legacy_emotion_candidates)
    packaged_misc_candidates = [
        asset for asset in packaged_candidates if asset not in legacy_emotion_candidates
    ]
    packaged_misc_bytes = sum(asset.built_bytes for asset in packaged_misc_candidates)
    package_rows = package_snapshot_rows(assets, packaged_candidates)

    summary_rows = [
        [
            "静态可达（含脚本依赖）",
            str(len(static_reachable)),
            human_bytes(sum(asset.source_bytes for asset in static_reachable)),
            human_bytes(static_built_bytes),
        ],
        [
            "动态加载保留",
            str(len(dynamic_retained)),
            human_bytes(sum(asset.source_bytes for asset in dynamic_retained)),
            human_bytes(dynamic_built_bytes),
        ],
        [
            "疑似未用、当前构建中存在",
            str(len(packaged_candidates)),
            human_bytes(packaged_candidate_source_bytes),
            human_bytes(packaged_candidate_bytes),
        ],
        [
            "疑似未用、当前构建中未归属",
            str(len(source_only_candidates)),
            human_bytes(source_only_candidate_bytes),
            "0 B（当前快照未独立归属）",
        ],
    ]

    directory_counts: Counter[str] = Counter()
    directory_source: Counter[str] = Counter()
    directory_built: Counter[str] = Counter()
    for asset in packaged_candidates:
        key = group_key(asset.relative)
        directory_counts[key] += 1
        directory_source[key] += asset.source_bytes
        directory_built[key] += asset.built_bytes
    directory_rows = [
        [
            key,
            str(directory_counts[key]),
            human_bytes(directory_source[key]),
            human_bytes(directory_built[key]),
        ]
        for key, _ in directory_built.most_common()
    ]

    category_counts: Counter[str] = Counter()
    category_source: Counter[str] = Counter()
    category_built: Counter[str] = Counter()
    for asset in packaged_candidates:
        category_counts[asset.category] += 1
        category_source[asset.category] += asset.source_bytes
        category_built[asset.category] += asset.built_bytes
    category_rows = [
        [
            category,
            str(category_counts[category]),
            human_bytes(category_source[category]),
            human_bytes(category_built[category]),
        ]
        for category, _ in category_built.most_common()
    ]

    largest_rows = [
        [
            asset.relative,
            asset.category,
            human_bytes(asset.source_bytes),
            human_bytes(asset.built_bytes),
        ]
        for asset in sorted(
            packaged_candidates,
            key=lambda item: (item.built_bytes, item.source_bytes),
            reverse=True,
        )[:80]
    ]

    source_only_directory_counts: Counter[str] = Counter()
    source_only_directory_bytes: Counter[str] = Counter()
    for asset in source_only_candidates:
        key = group_key(asset.relative)
        source_only_directory_counts[key] += 1
        source_only_directory_bytes[key] += asset.source_bytes
    source_only_directory_rows = [
        [
            key,
            str(source_only_directory_counts[key]),
            human_bytes(source_only_directory_bytes[key]),
        ]
        for key, _ in source_only_directory_bytes.most_common()
    ]

    source_only_largest_rows = [
        [asset.relative, asset.category, human_bytes(asset.source_bytes)]
        for asset in sorted(
            source_only_candidates,
            key=lambda item: (item.source_bytes, item.relative),
            reverse=True,
        )[:50]
    ]

    dynamic_directory_counts: Counter[str] = Counter()
    dynamic_directory_built: Counter[str] = Counter()
    for asset in dynamic_retained:
        key = group_key(asset.relative)
        dynamic_directory_counts[key] += 1
        dynamic_directory_built[key] += asset.built_bytes
    dynamic_rows = [
        [
            key,
            str(dynamic_directory_counts[key]),
            human_bytes(dynamic_directory_built[key]),
        ]
        for key, _ in dynamic_directory_built.most_common()
    ]

    retained_directory_counts: Counter[str] = Counter()
    retained_directory_built: Counter[str] = Counter()
    for relative in reachable:
        asset = assets[relative]
        if asset.built_bytes <= 0:
            continue
        key = group_key(relative)
        retained_directory_counts[key] += 1
        retained_directory_built[key] += asset.built_bytes
    retained_directory_rows = [
        [
            key,
            str(retained_directory_counts[key]),
            human_bytes(retained_directory_built[key]),
        ]
        for key, _ in retained_directory_built.most_common(15)
    ]

    unattributed_rows = [
        [path, human_bytes(size)]
        for path, size in sorted(unattributed, key=lambda item: item[1], reverse=True)[:20]
    ]

    lines = [
        f"# Cocos 未使用资源保守审计（{stamp}）",
        "",
        "本报告只做整理，没有删除、移动或改名任何资源。判定入口为登录场景、大",
        "厅 `panelMain.prefab`、牌桌 `drh8.fire` 与 `panelGameView.prefab`；在此",
        "基础上递归跟踪场景/Prefab/动画等序列化文件中的 UUID、组件脚本的本地",
        "导入，以及项目现有的动态加载路径。",
        "",
        "## 结论摘要",
        "",
        f"- 当前 `build/jsb-link/assets` 逻辑体积：**{human_bytes(build_total)}**。",
        f"- 已反向归属到源资源 UUID：**{human_bytes(build_attributed)}**；其余主要是",
        "  `index.jsc`、分包配置和引擎内置资源，不能直接归到单个源文件。",
        f"- 高置信度“疑似未用且已进入当前构建”的资源：**{len(packaged_candidates)} 个，",
        f"  当前构建归属体积合计 {human_bytes(packaged_candidate_bytes)}**。",
        f"- 另有 **{len(source_only_candidates)} 个 / {human_bytes(source_only_candidate_bytes)}**",
        "  疑似源码残留没有独立映射到当前构建文件，所以这一部分不能直接当作",
        "  可节省包体。",
        f"- 两类候选合计 **{len(candidates)} 个源文件 / "
        f"{human_bytes(sum(asset.source_bytes for asset in candidates))} 源文件体积**；",
        "  其中真正与当前资源包体直接相关的仍以前一项构建归属体积为准。",
        "",
        render_table(
            ["分类", "文件数", "源文件逻辑体积", "当前构建归属体积"],
            summary_rows,
        ),
        "",
        "## 关键发现",
        "",
        f"- 最大的一组是旧表情系统：**{len(legacy_emotion_candidates)} 个 / "
        f"{human_bytes(legacy_emotion_bytes)} 构建归属体积**。当前牌桌代码实际按",
        "  `表情2/<编号>` 加载，新版 `表情2` 已整体保留；旧 `表情`、",
        "  `表情---`、两套 DragonBones 表情资源和 `表情声音` 未被当前链命中，",
        "  且旧表情音效加载代码已注释。",
        f"- 除旧表情系统外，已打包候选还有 **{len(packaged_misc_candidates)} 个 / "
        f"{human_bytes(packaged_misc_bytes)}**，主要是旧奖励/红利列表对象、",
        "  `handbig.prefab`、资源目录图标、旧 `DefCtl` 和 inspector 配置。",
        "- 动态牌面、牌背、头像、道具、动作音效、服务端状态图、牌桌操作图、",
        "  牌谱图、KBEngine 动态脚本均已主动排除，不计入候选。",
        "",
        "## 对现有安装包快照的影响",
        "",
        render_table(
            [
                "安装包快照",
                "文件大小",
                "资源条目压缩后",
                "原生库/主程序压缩后",
                "候选条目压缩后",
            ],
            package_rows,
        )
        if package_rows
        else "当前没有可读取的 APK/IPA 快照。",
        "",
        "“候选条目压缩后”是直接读取现有 ZIP 条目的压缩字节，并非删除后重打包",
        "的承诺值；中央目录、资源配置和对齐方式也会随重建变化。它比源文件体积",
        "更接近最终可节省量，但最终数字仍必须以隔离清理后的新包为准。",
        "",
        "当前保留资源的主要体积来源：",
        "",
        render_table(
            ["目录", "文件数", "当前构建归属体积"],
            retained_directory_rows,
        ),
        "",
        "`assets/font` 主要是 10.34 MiB 的 `PingFF.ttf`，它当前确实被界面使用，",
        "所以没有列为未使用资源；若后续继续减包，做字体子集化通常比继续寻找零散",
        "孤儿图更有收益，但必须覆盖全部客户端固定文字和服务端可能下发的中文字符。",
        "",
        "这里的“当前构建归属体积”是未压缩构建资源的逻辑字节数，不是 exFAT 的",
        "`du` 占用，也不是最终 APK/IPA 的精确压缩后节省量；真正删除前仍要做一次",
        "隔离构建才能得到最终包体差值。",
        "",
        "## 疑似未用资源按目录汇总",
        "",
        render_table(
            ["目录", "文件数", "源文件体积", "当前构建归属体积"],
            directory_rows,
        )
        if directory_rows
        else "没有发现已进入构建的疑似未用资源。",
        "",
        "## 疑似未用资源按类型汇总",
        "",
        render_table(
            ["类型", "文件数", "源文件体积", "当前构建归属体积"],
            category_rows,
        )
        if category_rows
        else "没有发现已进入构建的疑似未用资源。",
        "",
        "## 体积最大的疑似未用资源（前 80 个）",
        "",
        render_table(
            ["源文件", "类型", "源文件体积", "当前构建归属体积"],
            largest_rows,
        )
        if largest_rows
        else "无。",
        "",
        "完整名单见：",
        "",
        f"- `{candidates_path.relative_to(PROJECT_ROOT).as_posix()}`",
        "",
        "## 未进入当前资源构建的源码残留",
        "",
        "这些文件适合后续整理仓库，但当前没有独立构建文件归属，不能把它们的",
        "源文件体积直接算成 APK/IPA 可节省体积。所有 TypeScript/JavaScript",
        "已因 Cocos 合包、全局模块和 KBEngine 动态类机制而保守保留，不在候选中。",
        "",
        render_table(["目录", "文件数", "源文件体积"], source_only_directory_rows)
        if source_only_directory_rows
        else "无。",
        "",
        "体积最大的源码残留（前 50 个）：",
        "",
        render_table(["源文件", "类型", "源文件体积"], source_only_largest_rows)
        if source_only_largest_rows
        else "无。",
        "",
        "## 已按动态加载保留的资源",
        "",
        "下列资源即使没有被场景/Prefab UUID 直接引用，也不会列入待清理名单：",
        "",
        "- `UI/<面板名>`、`Prefabs/<对象名>` 等可达脚本中的字面量加载；",
        "- `avatars/头像01..20`；",
        "- `pk2/*` 牌面、`zuotype/*` 牌型/牌背；",
        "- `表情2/*`、`道具/*`、`Audio/道具声音/*`；",
        "- `Audio/eff/*` 牌局动作音效；",
        "- `other/<服务端状态值>`、`other/状态_*`、`other/背景_*` 房间/记录状态图；",
        "- `other/drh/*` 牌桌操作图、`other/牌谱/*` 回顾牌谱图。",
        "- 全部 TypeScript/JavaScript（Cocos 合包、全局 QR/CryptoJS 与 KBEngine 动态类）。",
        "",
        render_table(["目录", "文件数", "当前构建归属体积"], dynamic_rows)
        if dynamic_rows
        else "没有命中动态保留规则。",
        "",
        f"动态保留完整名单及触发原因：`{retained_path.relative_to(PROJECT_ROOT).as_posix()}`",
        "",
        "## 审计边界与风险",
        "",
        "- `assets/resources` 会被 Cocos 整包构建；因此其中未被运行链命中的文件仍会",
        "  真实进入包体，是本次最主要的候选来源。",
        "- 已处理当前代码中可见的字符串拼接和编号型动态加载，但服务端如果能下发任意",
        "  新资源名、或原生层通过文件名直接访问资源，静态审计无法百分之百证明未用。",
        "- `login - 001.fire` 被视为测试/备用场景，不作为产品入口；只被它引用的资源",
        "  可能进入候选名单。",
        "- 当前结果对应现有 `build/jsb-link/assets` 快照。以后重新构建、改大厅或改牌桌",
        "  后应重新运行脚本。",
        "- 下一步若要清理，建议先把候选移到项目外隔离目录，再完整构建并回归登录、",
        "  大厅所有入口、牌桌、战绩、钱包、管理功能、表情/道具/音效和三端语音；不要",
        "  直接永久删除。",
        "",
        "## 构建中未归属到单个源文件的主要内容",
        "",
        render_table(["构建文件", "逻辑体积"], unattributed_rows)
        if unattributed_rows
        else "全部构建文件都已归属。",
        "",
        "## 工具与复查方式",
        "",
        "重新审计：",
        "",
        "```bash",
        "python3 tools/audit_cocos_unused_assets.py",
        "```",
        "",
        f"扫描到源资源总计 **{len(assets)} 个 / {human_bytes(source_total)}**。",
    ]

    if missing_roots or warnings:
        lines.extend(("", "## 扫描警告", ""))
        for warning in missing_roots:
            lines.append(f"- 缺少审计入口：`{warning}`")
        for warning in warnings[:100]:
            lines.append(f"- {warning}")
        if len(warnings) > 100:
            lines.append(f"- 其余 {len(warnings) - 100} 条警告已省略。")

    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return markdown_path, candidates_path, retained_path


def main() -> int:
    assets, uuid_owner, warnings = build_inventory()
    reachable, dynamic_roots, reasons, missing_roots = compute_reachability(assets)
    build_total, build_attributed, unattributed = map_build_bytes(assets, uuid_owner)
    markdown_path, candidates_path, retained_path = generate_reports(
        assets,
        reachable,
        dynamic_roots,
        reasons,
        warnings,
        missing_roots,
        build_total,
        build_attributed,
        unattributed,
    )

    packaged_candidates = [
        asset
        for relative, asset in assets.items()
        if relative not in reachable and asset.built_bytes > 0
    ]
    print(f"Report: {markdown_path.relative_to(PROJECT_ROOT)}")
    print(f"Candidates: {candidates_path.relative_to(PROJECT_ROOT)}")
    print(f"Dynamic retained: {retained_path.relative_to(PROJECT_ROOT)}")
    print(
        "Packaged candidates: "
        f"{len(packaged_candidates)} files, "
        f"{human_bytes(sum(asset.built_bytes for asset in packaged_candidates))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
