#!/usr/bin/env python3
"""Generate Cocos Creator 2.4.x hot-update manifests and a deployment ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = PROJECT_ROOT / ".hot-update-config.json"
DEFAULT_BUILD_DIR = PROJECT_ROOT / "build" / "jsb-link"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "hot-update-output"
RESOURCE_MANIFEST_DIR = PROJECT_ROOT / "assets" / "resources"
RESOURCE_MANIFEST_UUIDS = {
    "project.manifest": "2523d19d-954c-4e34-a61a-67d75715f063",
    "version.manifest": "360a744b-cd8f-42ff-9aa6-e918a653fab2",
}
VERSION_RE = re.compile(r"^\d+(?:\.\d+)*$")
IGNORED_NAMES = {".DS_Store"}
PNG_SIGNATURE = bytes((0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))
PNG_IEND = bytes((0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82))
LEGACY_PNG_MARKER = b"q" * 7
LEGACY_PNG_KEY = b"test" + b"0" * 6
MAIN_JS_PATCH_BEGIN = "// QING_HOT_UPDATE_SEARCH_PATHS_BEGIN"
MAIN_JS_PATCH_END = "// QING_HOT_UPDATE_SEARCH_PATHS_END"
MAIN_JS_PATCH = f"""{MAIN_JS_PATCH_BEGIN}
(function () {{
    if (!window.jsb) {{
        return;
    }}

    var value = localStorage.getItem('HotUpdateSearchPaths');
    if (!value) {{
        return;
    }}

    try {{
        var paths = JSON.parse(value);
        if (Array.isArray(paths) && paths.length > 0) {{
            jsb.fileUtils.setSearchPaths(paths);
            console.log('[main.js] 恢复热更新搜索路径:', paths);
        }}
    }} catch (error) {{
        console.error('[main.js] 搜索路径解析失败:', error);
    }}
}})();
{MAIN_JS_PATCH_END}

"""


def prompt_value(label: str, current: str | None = None) -> str:
    if not sys.stdin.isatty():
        raise RuntimeError(f"缺少{label}；请在交互终端首次运行，或使用命令行参数填写")
    while True:
        suffix = f" [{current}]" if current else ""
        value = input(f"{label}{suffix}（直接回车保持不变）: ").strip()
        if not value and current:
            return current
        if value:
            return value


def normalize_server_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        raise ValueError("服务器地址不能为空")
    if not re.match(r"^https?://", value, re.IGNORECASE):
        value = "http://" + value
    if not re.match(r"^https?://[^/\s]+(?:/[^\s]*)?$", value, re.IGNORECASE):
        raise ValueError(f"服务器地址格式不正确: {value}")
    return value


def validate_version(value: str) -> str:
    value = value.strip()
    if not VERSION_RE.fullmatch(value):
        raise ValueError("版本号只能由数字和点组成，例如 1.0.25")
    return value


def increment_version(value: str) -> str:
    parts = value.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def load_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"配置文件读取失败 {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"配置文件格式错误: {path}")
    return data


def write_json(path: Path, data: dict, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        data,
        ensure_ascii=False,
        separators=(",", ":") if compact else None,
        indent=None if compact else 2,
    )
    path.write_text(text + ("" if compact else "\n"), encoding="utf-8")


def sync_native_build_manifests(build_dir: Path, manifests: dict[str, dict]) -> list[Path]:
    """Replace the already-imported RawAsset copies used by Android Studio."""
    native_dir = build_dir / "assets" / "resources" / "native"
    if not native_dir.is_dir():
        raise RuntimeError(f"Native 构建目录缺少 resources/native: {native_dir}")

    updated = []
    for file_name, uuid in RESOURCE_MANIFEST_UUIDS.items():
        candidates = list(native_dir.rglob(f"{uuid}.manifest"))
        candidates.extend(native_dir.rglob(f"{uuid}.*.manifest"))
        candidates = sorted(set(candidates))
        if len(candidates) != 1:
            raise RuntimeError(
                f"无法唯一定位 {file_name} 的 Native 构建文件（找到 {len(candidates)} 个）: {uuid}"
            )
        write_json(candidates[0], manifests[file_name], compact=True)
        updated.append(candidates[0])
    return updated


def validate_official_hot_update_build(build_dir: Path) -> None:
    """Reject MD5-versioned output that cannot be overlaid by search paths."""
    main_js = build_dir / "main.js"
    if not main_js.is_file():
        raise RuntimeError(f"Native 构建目录缺少 main.js: {main_js}")

    source = main_js.read_text(encoding="utf-8")
    hashed_settings = re.search(r"require\(['\"]src/settings\.[0-9a-f]+\.js['\"]\)", source)
    hashed_bundle_configs = sorted((build_dir / "assets").glob("*/config.*.json"))
    if hashed_settings or hashed_bundle_configs:
        examples = []
        if hashed_settings:
            examples.append(hashed_settings.group(0))
        examples.extend(str(path.relative_to(build_dir)) for path in hashed_bundle_configs[:3])
        raise RuntimeError(
            "当前 Native 构建仍是 MD5 哈希产物，不符合 Cocos 官方 searchPaths 热更新方式。\n"
            "请在 Creator 构建面板确认关闭“MD5 Cache”后重新构建；当前原生目录有项目定制，"
            "不要手动删除整个 build/jsb-link。"
            "确认生成 settings.js/config.json 等稳定文件名后再运行。\n"
            "检测到: " + ", ".join(examples)
        )

    main_bundle_script = build_dir / "assets" / "main" / "index.jsc"
    project_scripts = list((PROJECT_ROOT / "assets" / "scripts").rglob("*.ts"))
    if main_bundle_script.is_file() and project_scripts:
        newest_script = max(project_scripts, key=lambda path: path.stat().st_mtime)
        if newest_script.stat().st_mtime > main_bundle_script.stat().st_mtime:
            raise RuntimeError(
                "Creator 构建中的 assets/main/index.jsc 早于项目脚本，说明脚本编译产物未刷新，"
                "拒绝生成热更新包。\n"
                f"最新源码: {newest_script.relative_to(PROJECT_ROOT)}\n"
                "请等待 Creator 脚本编译完成后重新构建。"
            )


def patch_native_main_js(build_dir: Path) -> str:
    """Apply only the search-path bootstrap recommended by Cocos."""
    main_js = build_dir / "main.js"
    if not main_js.is_file():
        raise RuntimeError(f"Native 构建目录缺少 main.js: {main_js}")

    source = main_js.read_text(encoding="utf-8")
    has_begin = MAIN_JS_PATCH_BEGIN in source
    has_end = MAIN_JS_PATCH_END in source
    if has_begin != has_end:
        raise RuntimeError(f"main.js 中的热更新搜索路径标记不完整，拒绝自动修改: {main_js}")

    if has_begin:
        if source.index(MAIN_JS_PATCH_BEGIN) > source.find("window.boot"):
            raise RuntimeError(f"main.js 搜索路径恢复代码位置过晚，必须位于 window.boot 之前: {main_js}")
        patch_start = source.index(MAIN_JS_PATCH_BEGIN)
        patch_end = source.index(MAIN_JS_PATCH_END) + len(MAIN_JS_PATCH_END)
        source = MAIN_JS_PATCH.rstrip() + source[patch_end:]
    else:
        boot_index = source.find("window.boot")
        if boot_index < 0:
            raise RuntimeError(f"main.js 中未找到 window.boot，无法确认安全插入位置: {main_js}")
        source = MAIN_JS_PATCH + source
    bundle_begin = "    // QING_HOT_UPDATE_RESOURCES_BUNDLE_BEGIN"
    bundle_end = "    // QING_HOT_UPDATE_RESOURCES_BUNDLE_END"
    if (bundle_begin in source) != (bundle_end in source):
        raise RuntimeError(f"main.js 中的旧 Bundle 补丁标记不完整，拒绝自动修改: {main_js}")
    if bundle_begin in source:
        start = source.index(bundle_begin)
        end = source.index(bundle_end) + len(bundle_end)
        source = source[:start] + "    settings.hasResourcesBundle && bundleRoot.push(RESOURCES);" + source[end:]

    temporary = main_js.with_suffix(main_js.suffix + ".tmp")
    try:
        temporary.write_text(source, encoding="utf-8")
        os.replace(temporary, main_js)
    finally:
        if temporary.exists():
            temporary.unlink()
    return "已使用 Cocos 官方搜索路径恢复方式"


def should_ignore(path: Path) -> bool:
    return path.name in IGNORED_NAMES or path.name.startswith("._") or path.name.startswith(".")


def iter_runtime_files(build_dir: Path):
    for folder_name in ("src", "assets"):
        root = build_dir / folder_name
        if not root.is_dir():
            raise RuntimeError(f"Native 构建目录缺少 {folder_name}/: {build_dir}")
        for path in sorted(root.rglob("*")):
            if path.is_file() and not any(should_ignore(part) for part in path.relative_to(build_dir).parents) and not should_ignore(path):
                yield path


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_manifests(version: str, server_url: str, runtime_dir: Path) -> tuple[dict, dict]:
    assets = {}
    for path in iter_runtime_files(runtime_dir):
        relative = path.relative_to(runtime_dir).as_posix()
        key = quote(relative, safe="/._-~")
        item = {"size": path.stat().st_size, "md5": md5_file(path)}
        if path.suffix.lower() == ".zip":
            item["compressed"] = True
        assets[key] = item

    base = {
        "version": version,
        "packageUrl": server_url,
        "remoteManifestUrl": f"{server_url}/project.manifest",
        "remoteVersionUrl": f"{server_url}/version.manifest",
    }
    project = {**base, "assets": assets, "searchPaths": []}
    return project, base


def encrypt_legacy_png(data: bytes) -> tuple[bytes, str]:
    if data.startswith(LEGACY_PNG_MARKER):
        return data, "already_encrypted"
    if not data.startswith(PNG_SIGNATURE):
        return data, "invalid_png"
    payload = data[len(PNG_SIGNATURE) :]
    # 与旧 tool.py 保持一致：有标准 IEND 时移除；经外部工具处理后
    # 没有该尾块时仍加密剩余数据，Native 解密端会统一补回 IEND。
    if payload.endswith(PNG_IEND):
        payload = payload[: -len(PNG_IEND)]
    encrypted = bytes(value ^ LEGACY_PNG_KEY[index % len(LEGACY_PNG_KEY)] for index, value in enumerate(payload))
    return LEGACY_PNG_MARKER + encrypted, "encrypted"


def copy_runtime_files(build_dir: Path, destination: Path, encrypt_images: bool) -> dict:
    stats = {"encrypted": 0, "already_encrypted": 0, "invalid_png": 0, "copied": 0}
    runtime_files = list(iter_runtime_files(build_dir))
    png_total = sum(1 for path in runtime_files if path.suffix.lower() == ".png") if encrypt_images else 0
    png_current = 0
    if encrypt_images:
        print(f"\n开始加密 PNG，共 {png_total} 张...")

    for path in runtime_files:
        target = destination / path.relative_to(build_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        if encrypt_images and path.suffix.lower() == ".png":
            png_current += 1
            percent = png_current * 100 / png_total if png_total else 100
            relative = path.relative_to(build_dir).as_posix()
            print(
                f"\r  [{png_current}/{png_total}  {percent:6.2f}%] {relative[:90]:<90}",
                end="",
                flush=True,
            )
            source_data = path.read_bytes()
            encrypted_data, status = encrypt_legacy_png(source_data)
            target.write_bytes(encrypted_data)
            shutil.copystat(path, target)
            stats[status] += 1
        else:
            shutil.copy2(path, target)
            stats["copied"] += 1
    if encrypt_images:
        print("\nPNG 加密处理完成。", flush=True)
    return stats


def zip_directory(source: Path, zip_path: Path) -> None:
    temporary = zip_path.with_suffix(zip_path.suffix + ".tmp")
    if temporary.exists():
        temporary.unlink()
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for path in sorted(source.rglob("*")):
                relative = path.relative_to(source)
                if path.is_file() and not any(
                    part == ".DS_Store" or part.startswith("._")
                    for part in relative.parts
                ):
                    archive.write(path, relative.as_posix())
        os.replace(temporary, zip_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def parse_yes_no(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"yes", "y", "1", "true", "是"}:
        return True
    if normalized in {"no", "n", "0", "false", "否"}:
        return False
    raise ValueError("请输入 yes 或 no")


def choose_boolean(label: str, cli_value: str | None, current: bool) -> bool:
    if cli_value is not None:
        return parse_yes_no(cli_value)
    if not sys.stdin.isatty():
        return current
    current_text = "是" if current else "否"
    while True:
        try:
            value = input(f"{label} [{current_text}]（直接回车保持不变，输入 y/n 修改）: ").strip()
            return current if not value else parse_yes_no(value)
        except ValueError as exc:
            print(exc)


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 Cocos Creator 2.4.x 热更新清单和 ZIP 包")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="本机配置文件路径")
    parser.add_argument("--version", help="本次版本号；不传则使用配置里的 next_version")
    parser.add_argument("--server", help="热更新资源根地址，例如 http://154.37.155.17")
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR, help="Creator Native 构建目录")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="输出目录")
    parser.add_argument("--update-resources", metavar="yes|no", help="是否覆盖 assets/resources 下两个 manifest")
    parser.add_argument("--encrypt-images", metavar="yes|no", help="是否用项目旧格式加密输出包中的 PNG")
    args = parser.parse_args()

    config_path = args.config.resolve()
    config = load_config(config_path)
    configured_version = config.get("next_version")
    configured_server = config.get("server_url")
    if args.version is not None:
        version_input = args.version
    elif sys.stdin.isatty():
        version_input = prompt_value("本次版本号", configured_version)
    else:
        version_input = configured_version or prompt_value("本次版本号")
    if args.server is not None:
        server_input = args.server
    elif sys.stdin.isatty():
        server_input = prompt_value("热更新服务器根地址", configured_server)
    else:
        server_input = configured_server or prompt_value("热更新服务器根地址")
    version = validate_version(version_input)
    server_url = normalize_server_url(server_input)
    build_dir = args.build_dir.resolve()
    output_dir = args.output_dir.resolve()
    update_resources = choose_boolean(
        "是否同步更新 assets/resources 里的两个 manifest？",
        args.update_resources,
        bool(config.get("update_resources", False)),
    )
    encrypt_images = choose_boolean(
        "是否加密热更新包中的 PNG 图片？",
        args.encrypt_images,
        bool(config.get("encrypt_images", True)),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    final_version_dir = output_dir / version
    if final_version_dir.exists():
        raise RuntimeError(f"版本输出已存在，拒绝覆盖: {final_version_dir}")

    validate_official_hot_update_build(build_dir)
    main_js_patch_status = patch_native_main_js(build_dir)

    stage = Path(tempfile.mkdtemp(prefix=f".hot-update-{version}-", dir=output_dir))
    try:
        copy_stats = copy_runtime_files(build_dir, stage, encrypt_images)
        project_manifest, version_manifest = make_manifests(version, server_url, stage)
        write_json(stage / "project.manifest", project_manifest, compact=True)
        write_json(stage / "version.manifest", version_manifest, compact=True)
        os.replace(stage, final_version_dir)
    finally:
        if stage.exists():
            shutil.rmtree(stage)

    zip_name = "ver_" + version.replace(".", "_") + ".zip"
    zip_path = output_dir / zip_name
    if zip_path.exists():
        raise RuntimeError(f"ZIP 已存在，拒绝覆盖: {zip_path}")
    zip_directory(final_version_dir, zip_path)

    if update_resources:
        write_json(RESOURCE_MANIFEST_DIR / "project.manifest", project_manifest, compact=True)
        write_json(RESOURCE_MANIFEST_DIR / "version.manifest", version_manifest, compact=True)
        synced_build_manifests = sync_native_build_manifests(
            build_dir,
            {
                "project.manifest": project_manifest,
                "version.manifest": version_manifest,
            },
        )
    else:
        synced_build_manifests = []

    next_version = increment_version(version)
    write_json(
        config_path,
        {
            "server_url": server_url,
            "next_version": next_version,
            "update_resources": update_resources,
            "encrypt_images": encrypt_images,
        },
    )

    print("\n热更新包生成成功")
    print(f"  本次版本: {version}")
    print(f"  下次版本: {next_version}")
    print(f"  服务器地址: {server_url}")
    print(f"  ZIP: {zip_path}")
    print(f"  解压目录: {final_version_dir}")
    print(f"  main.js 搜索路径恢复: {main_js_patch_status}")
    print("  注意: main.js 不进入热更新 ZIP，只对之后打出的基础原生包生效")
    if encrypt_images:
        print(
            f"  PNG 加密: 新加密 {copy_stats['encrypted']} 张"
            f"，已是加密格式 {copy_stats['already_encrypted']} 张"
            f"，无效PNG跳过 {copy_stats['invalid_png']} 张"
        )
    else:
        print("  PNG 加密: 未启用")
    print(f"  resources 清单: {'已更新' if update_resources else '未更新'}")
    if synced_build_manifests:
        print("  Native 构建清单: 已同步，Android Studio 可直接重新打包")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"\n生成失败: {exc}", file=sys.stderr)
        raise SystemExit(1)
