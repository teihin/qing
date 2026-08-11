#!/usr/bin/env python3
"""Upload the latest generated hot-update deployment directory through SFTP."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "hot-update-output"
DEFAULT_CONFIG = PROJECT_ROOT / ".hot-update-upload-config.json"
DEFAULTS = {
    "host": "154.37.155.17",
    "port": 2233,
    "user": "client_update",
    "identity_file": "~/.ssh/id_ed25519_newserver",
    "remote_dir": "/www/html/_incoming",
}
VERSION_RE = re.compile(r"^\d+(?:\.\d+)*$")
DEPLOY_VERIFY_TIMEOUT_SECONDS = 90
DEPLOY_VERIFY_INTERVAL_SECONDS = 3


def load_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"上传配置读取失败 {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"上传配置格式错误: {path}")
    return data


def write_config(path: Path, config: dict) -> None:
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prompt_value(label: str, current: str) -> str:
    if not sys.stdin.isatty():
        return current
    value = input(f"{label} [{current}]（直接回车保持不变）: ").strip()
    return value or current


def normalize_remote_dir(value: str) -> str:
    value = value.strip().replace("\\", "/")
    if not value.startswith("/"):
        value = "/" + value
    value = value.rstrip("/") or "/"
    if any(part in {"", ".", ".."} for part in value.split("/")[1:]):
        raise ValueError(f"服务器目录格式不正确: {value}")
    return value


def version_key(value: str) -> tuple[int, ...]:
    if not VERSION_RE.fullmatch(value):
        raise ValueError(f"版本号格式错误: {value}")
    return tuple(int(part) for part in value.split("."))


def find_latest_version(output_dir: Path) -> tuple[str, Path, dict]:
    candidates = []
    if not output_dir.is_dir():
        raise RuntimeError(f"热更新输出目录不存在，请先生成热更新包: {output_dir}")
    for directory in output_dir.iterdir():
        manifest_path = directory / "project.manifest"
        version_path = directory / "version.manifest"
        if not directory.is_dir() or not manifest_path.is_file() or not version_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            version = str(manifest["version"])
            key = version_key(version)
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
            continue
        if directory.name != version:
            continue
        if not (directory / "src").is_dir() or not (directory / "assets").is_dir():
            continue
        candidates.append((key, version, directory, manifest))
    if not candidates:
        raise RuntimeError(f"没有找到完整的热更新版本目录: {output_dir}")
    _, version, directory, manifest = max(candidates, key=lambda item: item[0])
    return version, directory, manifest


def sftp_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def find_and_validate_archive(output_dir: Path, version: str) -> tuple[Path, int, int]:
    archive_path = output_dir / f"ver_{version.replace('.', '_')}.zip"
    if not archive_path.is_file():
        raise RuntimeError(f"版本 ZIP 不存在，请重新生成热更新包: {archive_path}")
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            names = {info.filename for info in entries}
            unwanted = [
                info.filename
                for info in entries
                if any(
                    part == ".DS_Store" or part.startswith("._")
                    for part in PurePosixPath(info.filename).parts
                )
            ]
            if unwanted:
                raise RuntimeError(
                    f"版本 ZIP 含有 {len(unwanted)} 个 macOS 隐藏文件，请重新生成: {archive_path}"
                )
            required = {"project.manifest", "version.manifest"}
            if not required.issubset(names) or not any(name.startswith("src/") for name in names) or not any(
                name.startswith("assets/") for name in names
            ):
                raise RuntimeError(f"版本 ZIP 内容不完整: {archive_path}")
            return archive_path, len(entries), sum(info.file_size for info in entries)
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"版本 ZIP 已损坏: {archive_path}") from exc


def build_sftp_batch(archive_path: Path, version: str, remote_dir: str) -> str:
    remote_root = PurePosixPath(remote_dir)
    remote_name = f"ver_{version.replace('.', '_')}.zip"
    final_path = remote_root / remote_name
    temporary_path = remote_root / f".{remote_name}.uploading"
    lines = [
        f"ls {sftp_quote(str(remote_root))}",
        f"-rm {sftp_quote(str(temporary_path))}",
        f"put {sftp_quote(str(archive_path))} {sftp_quote(str(temporary_path))}",
        f"rename {sftp_quote(str(temporary_path))} {sftp_quote(str(final_path))}",
        "bye",
    ]
    return "\n".join(lines) + "\n"


def fetch_http(url: str, attempt: int) -> bytes:
    separator = "&" if "?" in url else "?"
    cache_busted_url = f"{url}{separator}_deploy_verify={time.time_ns()}-{attempt}"
    request = urllib.request.Request(
        cache_busted_url,
        headers={"User-Agent": "QingHotUpdateVerifier/1.0", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {url}")
        return response.read()


def choose_sample_assets(assets: dict, count: int = 5) -> list[str]:
    names = sorted(assets)
    if len(names) <= count:
        return names
    return [names[round(index * (len(names) - 1) / (count - 1))] for index in range(count)]


def verify_deployment(version: str, local_manifest: dict) -> None:
    package_url = str(local_manifest.get("packageUrl", "")).rstrip("/")
    if not package_url.startswith(("http://", "https://")):
        raise RuntimeError(f"Manifest packageUrl 不是有效 HTTP 地址: {package_url}")
    local_assets = local_manifest.get("assets")
    if not isinstance(local_assets, dict) or not local_assets:
        raise RuntimeError("本地 project.manifest 没有有效资源清单")

    deadline = time.monotonic() + DEPLOY_VERIFY_TIMEOUT_SECONDS
    attempt = 0
    last_error = "服务器尚未返回结果"
    print("\n开始校验服务器自动解压与文件替换：", flush=True)
    while time.monotonic() < deadline:
        attempt += 1
        try:
            version_data = json.loads(
                fetch_http(f"{package_url}/version.manifest", attempt).decode("utf-8")
            )
            if str(version_data.get("version")) != version:
                raise RuntimeError(
                    f"远端版本仍为 {version_data.get('version')}，等待替换为 {version}"
                )

            project_data = json.loads(
                fetch_http(f"{package_url}/project.manifest", attempt).decode("utf-8")
            )
            if str(project_data.get("version")) != version:
                raise RuntimeError(
                    f"远端 project.manifest 版本仍为 {project_data.get('version')}"
                )
            remote_assets = project_data.get("assets")
            if remote_assets != local_assets:
                remote_count = len(remote_assets) if isinstance(remote_assets, dict) else 0
                raise RuntimeError(
                    f"远端资源清单尚未完整替换（本地 {len(local_assets)}，远端 {remote_count}）"
                )

            sample_names = choose_sample_assets(local_assets)
            for sample_index, name in enumerate(sample_names, start=1):
                quoted_name = urllib.parse.quote(name, safe="/")
                content = fetch_http(
                    f"{package_url}/{quoted_name}", attempt * 10 + sample_index
                )
                expected = local_assets[name]
                actual_md5 = hashlib.md5(content).hexdigest()
                if len(content) != int(expected["size"]) or actual_md5 != expected["md5"]:
                    raise RuntimeError(f"远端抽检文件不一致: {name}")

            print(f"  版本清单: {version} ✓")
            print(f"  项目清单: {len(local_assets)} 项资源完全一致 ✓")
            print(f"  远端资源: 抽检 {len(sample_names)} 项大小与 MD5 一致 ✓")
            return
        except (
            OSError,
            RuntimeError,
            ValueError,
            KeyError,
            json.JSONDecodeError,
            urllib.error.URLError,
        ) as exc:
            last_error = str(exc)
            remaining = max(0, int(deadline - time.monotonic()))
            print(f"\r  等待服务器处理（剩余约 {remaining}s）：{last_error[:100]:<100}", end="", flush=True)
            time.sleep(min(DEPLOY_VERIFY_INTERVAL_SECONDS, max(0, deadline - time.monotonic())))

    print()
    raise RuntimeError(
        f"上传完成，但服务器在 {DEPLOY_VERIFY_TIMEOUT_SECONDS} 秒内未通过部署校验: {last_error}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="通过 SFTP 上传最新热更新部署文件")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--user")
    parser.add_argument("--identity-file")
    parser.add_argument("--remote-dir")
    args = parser.parse_args()

    config_path = args.config.resolve()
    stored = {**DEFAULTS, **load_config(config_path)}
    host = args.host or prompt_value("SFTP 服务器", str(stored["host"]))
    port_text = str(args.port) if args.port is not None else prompt_value("SFTP 端口", str(stored["port"]))
    user = args.user or prompt_value("SFTP 用户", str(stored["user"]))
    identity_text = args.identity_file or prompt_value("SSH 密钥", str(stored["identity_file"]))
    configured_remote_dir = str(stored["remote_dir"])
    if args.remote_dir is None and configured_remote_dir in {"/up", "/_incoming", "/html/_incoming"}:
        configured_remote_dir = "/www/html/_incoming"
    remote_dir = normalize_remote_dir(args.remote_dir or prompt_value("服务器上传目录", configured_remote_dir))

    try:
        port = int(port_text)
    except ValueError as exc:
        raise ValueError(f"SFTP 端口必须是数字: {port_text}") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"SFTP 端口超出范围: {port}")
    identity_file = Path(os.path.expanduser(identity_text)).resolve()
    if not identity_file.is_file():
        raise RuntimeError(f"SSH 密钥不存在: {identity_file}")

    version, version_dir, manifest = find_latest_version(args.output_dir.resolve())
    package_url = manifest.get("packageUrl", "")

    config = {
        "host": host,
        "port": port,
        "user": user,
        "identity_file": identity_text,
        "remote_dir": remote_dir,
    }
    write_config(config_path, config)

    batch_path = None
    try:
        archive_path, file_count, total_bytes = find_and_validate_archive(
            args.output_dir.resolve(), version
        )
        batch_text = build_sftp_batch(archive_path, version, remote_dir)

        print("\n准备上传最新热更新压缩包：")
        print(f"  版本: {version}")
        print(f"  本地目录: {version_dir}")
        print(f"  归档文件数: {file_count}")
        print(f"  原始总大小: {total_bytes / 1024 / 1024:.2f} MB")
        print(f"  ZIP 大小: {archive_path.stat().st_size / 1024 / 1024:.2f} MB")
        print(f"  Manifest 地址: {package_url}")
        print(f"  SFTP 目标: {user}@{host}:{remote_dir}")

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", prefix="qing-sftp-", suffix=".txt", delete=False) as stream:
            stream.write(batch_text)
            batch_path = Path(stream.name)
        command = [
            "sftp",
            "-b",
            str(batch_path),
            "-i",
            str(identity_file),
            "-P",
            str(port),
            f"{user}@{host}",
        ]
        print("\n开始上传 ZIP；完成后服务器会自动解压到 /up...\n", flush=True)
        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"SFTP 上传失败，退出码: {result.returncode}")
    finally:
        if batch_path is not None:
            batch_path.unlink(missing_ok=True)

    print("\n[上传 1/1  100.00%] ZIP 传输完成")
    verify_deployment(version, manifest)
    print(f"\n上传并部署成功：版本 {version} 已解压并替换到 {package_url}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"\n上传失败: {exc}", file=sys.stderr)
        raise SystemExit(1)
