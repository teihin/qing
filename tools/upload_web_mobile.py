#!/usr/bin/env python3
"""Package build/web-mobile and deploy it safely to the game web server."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "build" / "web-mobile"
DEFAULT_CONFIG = PROJECT_ROOT / ".hot-update-upload-config.json"
WEB_IMAGE_PROTECTION_SCRIPT = PROJECT_ROOT / "tools" / "protect_web_images.js"
DEFAULTS = {
    "host": "154.37.155.17",
    "port": 2233,
    "user": "client_update",
    "identity_file": "~/.ssh/id_ed25519_newserver",
}
REMOTE_PARENT = PurePosixPath("/www/html")
REMOTE_TARGET = REMOTE_PARENT / "web-mobile"
REMOTE_PREVIOUS = REMOTE_PARENT / ".web-mobile.previous"
SAFE_UPLOAD_NAME_RE = re.compile(r"^\.web-mobile-upload-[0-9]+-[0-9]+\.zip$")
UPLOAD_MAX_ATTEMPTS = 4
UPLOAD_RETRY_DELAY_SECONDS = 3


def find_node_executable() -> Path:
    candidates: list[Path] = []
    path_node = shutil.which("node")
    if path_node:
        candidates.append(Path(path_node))
    candidates.extend(
        [
            Path("/opt/homebrew/bin/node"),
            Path("/usr/local/bin/node"),
        ]
    )
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        candidates.extend(
            version_dir / "bin" / "node"
            for version_dir in sorted(nvm_root.iterdir(), reverse=True)
            if version_dir.is_dir()
        )

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_file() and os.access(resolved, os.X_OK):
            return resolved
    raise RuntimeError("找不到Node.js，无法执行网页版图片保护")


def protect_web_images(source_dir: Path) -> None:
    if not WEB_IMAGE_PROTECTION_SCRIPT.is_file():
        raise RuntimeError(f"网页版图片保护脚本不存在: {WEB_IMAGE_PROTECTION_SCRIPT}")
    node = find_node_executable()
    print("\n[上传前] 加密并校验网页版图片资源...", flush=True)
    result = subprocess.run(
        [str(node), str(WEB_IMAGE_PROTECTION_SCRIPT), "--source-dir", str(source_dir)],
        cwd=PROJECT_ROOT,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"网页版图片保护失败，退出码: {result.returncode}")


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


def resolve_connection(args: argparse.Namespace) -> tuple[str, int, str, Path]:
    stored = {**DEFAULTS, **load_config(args.config.resolve())}
    host = str(args.host or stored["host"]).strip()
    user = str(args.user or stored["user"]).strip()
    identity_text = str(args.identity_file or stored["identity_file"]).strip()
    port_value = args.port if args.port is not None else stored["port"]

    if not host or any(char.isspace() for char in host):
        raise ValueError(f"SSH服务器地址不正确: {host!r}")
    if not user or any(char.isspace() for char in user):
        raise ValueError(f"SSH用户不正确: {user!r}")
    try:
        port = int(port_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"SSH端口必须是数字: {port_value}") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"SSH端口超出范围: {port}")

    identity_file = Path(os.path.expanduser(identity_text)).resolve()
    if not identity_file.is_file():
        raise RuntimeError(f"SSH密钥不存在: {identity_file}")
    return host, port, user, identity_file


def should_skip(relative_path: Path) -> bool:
    return any(part == ".DS_Store" or part.startswith("._") for part in relative_path.parts)


def collect_source_files(source_dir: Path) -> list[Path]:
    if not source_dir.is_dir():
        raise RuntimeError(f"网页版构建目录不存在，请先用Creator构建Web Mobile: {source_dir}")

    files: list[Path] = []
    for path in sorted(source_dir.rglob("*")):
        relative_path = path.relative_to(source_dir)
        if should_skip(relative_path):
            continue
        if path.is_symlink():
            raise RuntimeError(f"构建目录不允许包含符号链接: {relative_path}")
        if path.is_file():
            files.append(path)

    relative_names = {path.relative_to(source_dir).as_posix() for path in files}
    if "index.html" not in relative_names:
        raise RuntimeError(f"网页版构建不完整，缺少 index.html: {source_dir}")
    if not any(name.startswith("main.") and name.endswith(".js") for name in relative_names):
        raise RuntimeError(f"网页版构建不完整，缺少 main.*.js: {source_dir}")
    if not any(name.startswith("src/settings.") and name.endswith(".js") for name in relative_names):
        raise RuntimeError(f"网页版构建不完整，缺少 src/settings.*.js: {source_dir}")
    return files


def create_archive(source_dir: Path, files: list[Path], archive_path: Path) -> None:
    with zipfile.ZipFile(
        archive_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
        allowZip64=True,
    ) as archive:
        for path in files:
            archive.write(path, path.relative_to(source_dir).as_posix())

    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            bad_file = archive.testzip()
            names = {info.filename for info in archive.infolist() if not info.is_dir()}
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"生成的ZIP文件已损坏: {archive_path}") from exc
    if bad_file is not None:
        raise RuntimeError(f"生成的ZIP校验失败: {bad_file}")
    if "index.html" not in names or len(names) != len(files):
        raise RuntimeError("生成的ZIP内容与本地构建目录不一致")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ssh_base_command(identity_file: Path, port: int) -> list[str]:
    return [
        "ssh",
        "-i",
        str(identity_file),
        "-p",
        str(port),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=12",
        "-o",
        "ServerAliveInterval=15",
    ]


def rsync_command(identity_file: Path, port: int) -> list[str]:
    remote_shell = shlex.join(ssh_base_command(identity_file, port))
    return [
        "rsync",
        "--partial",
        "--append",
        "--progress",
        "--timeout=60",
        "-e",
        remote_shell,
    ]


def build_remote_deploy_script(
    remote_archive: PurePosixPath,
    archive_sha256: str,
    index_sha256: str,
    expected_file_count: int,
) -> str:
    stage = REMOTE_PARENT / f".{remote_archive.stem}.staging"
    values = {
        "parent": str(REMOTE_PARENT),
        "target": str(REMOTE_TARGET),
        "previous": str(REMOTE_PREVIOUS),
        "archive": str(remote_archive),
        "stage": str(stage),
        "archive_sha256": archive_sha256,
        "index_sha256": index_sha256,
        "file_count": str(expected_file_count),
    }
    assignments = "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())
    return f"""set -eu
{assignments}
old_moved=0
new_moved=0

cleanup_on_exit() {{
    status=$?
    trap - EXIT HUP INT TERM
    if [ "$status" -ne 0 ]; then
        rm -rf -- "$stage"
        if [ "$new_moved" -eq 1 ]; then
            rm -rf -- "$target"
        fi
        if [ "$old_moved" -eq 1 ] && [ -e "$previous" ]; then
            mv -- "$previous" "$target" || true
        fi
    fi
    rm -f -- "$archive"
    exit "$status"
}}
trap cleanup_on_exit EXIT
trap 'exit 130' HUP INT TERM

[ "$parent" = "/www/html" ]
[ "$target" = "/www/html/web-mobile" ]
[ -d "$parent" ]
[ -f "$archive" ]
command -v unzip >/dev/null 2>&1
command -v sha256sum >/dev/null 2>&1
command -v chmod >/dev/null 2>&1
command -v find >/dev/null 2>&1

actual_archive_sha=$(sha256sum "$archive" | awk '{{print $1}}')
[ "$actual_archive_sha" = "$archive_sha256" ]

rm -rf -- "$stage"
mkdir -- "$stage"
unzip -q "$archive" -d "$stage"
[ -f "$stage/index.html" ]

# ZIP会保留Creator构建文件原有的600/700权限；统一为网页服务可读取的权限。
find "$stage" -type d -exec chmod 755 {{}} +
find "$stage" -type f -exec chmod 644 {{}} +
unreadable_count=$(find "$stage" -type f ! -perm -004 | wc -l | tr -d ' ')
unsearchable_dir_count=$(find "$stage" -type d ! -perm -005 | wc -l | tr -d ' ')
[ "$unreadable_count" = "0" ]
[ "$unsearchable_dir_count" = "0" ]

actual_file_count=$(find "$stage" -type f | wc -l | tr -d ' ')
[ "$actual_file_count" = "$file_count" ]
actual_index_sha=$(sha256sum "$stage/index.html" | awk '{{print $1}}')
[ "$actual_index_sha" = "$index_sha256" ]

if [ -e "$target" ] && [ ! -d "$target" ]; then
    echo "目标路径存在但不是目录: $target" >&2
    exit 1
fi
rm -rf -- "$previous"
if [ -d "$target" ]; then
    old_moved=1
    mv -- "$target" "$previous"
fi
new_moved=1
mv -- "$stage" "$target"

deployed_file_count=$(find "$target" -type f | wc -l | tr -d ' ')
deployed_index_sha=$(sha256sum "$target/index.html" | awk '{{print $1}}')
[ "$deployed_file_count" = "$file_count" ]
[ "$deployed_index_sha" = "$index_sha256" ]

rm -f -- "$archive"
trap - EXIT HUP INT TERM
printf 'WEB_MOBILE_DEPLOY_OK files=%s index_sha256=%s\\n' "$deployed_file_count" "$deployed_index_sha"
"""


def confirm_upload(target: str) -> bool:
    if not sys.stdin.isatty():
        return False
    answer = input(f"\n确认上传并替换 {target} 吗？[y/N]: ").strip().lower()
    return answer in {"y", "yes"}


def main() -> int:
    parser = argparse.ArgumentParser(description="上传Creator Web Mobile构建到正式网页目录")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--user")
    parser.add_argument("--identity-file")
    parser.add_argument("--yes", action="store_true", help="跳过上传确认")
    parser.add_argument("--dry-run", action="store_true", help="只打包和校验，不连接服务器")
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    protect_web_images(source_dir)
    files = collect_source_files(source_dir)
    host, port, user, identity_file = resolve_connection(args)
    total_bytes = sum(path.stat().st_size for path in files)
    index_sha256 = sha256_file(source_dir / "index.html")

    with tempfile.TemporaryDirectory(prefix="qing-web-mobile-") as temp_dir:
        archive_path = Path(temp_dir) / "web-mobile.zip"
        create_archive(source_dir, files, archive_path)
        archive_sha256 = sha256_file(archive_path)

        print("\n准备上传网页版：")
        print(f"  本地目录: {source_dir}")
        print(f"  构建时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(source_dir.stat().st_mtime))}")
        print(f"  文件数量: {len(files)}")
        print(f"  原始大小: {total_bytes / 1024 / 1024:.2f} MB")
        print(f"  ZIP大小: {archive_path.stat().st_size / 1024 / 1024:.2f} MB")
        print(f"  SSH目标: {user}@{host}:{port}")
        print(f"  部署目录: {REMOTE_TARGET}")
        print(f"  回滚目录: {REMOTE_PREVIOUS}")

        if args.dry_run:
            print("\n本地打包与ZIP完整性校验通过（dry-run，未连接服务器）。")
            return 0
        if not args.yes and not confirm_upload(str(REMOTE_TARGET)):
            print("\n已取消上传，服务器未发生变化。")
            return 2

        remote_name = f".web-mobile-upload-{int(time.time())}-{os.getpid()}.zip"
        if not SAFE_UPLOAD_NAME_RE.fullmatch(remote_name):
            raise RuntimeError(f"内部上传文件名校验失败: {remote_name}")
        remote_archive = REMOTE_PARENT / remote_name
        destination = f"{user}@{host}:{remote_archive}"

        print("\n[1/2] 断点续传ZIP到服务器临时文件...", flush=True)
        upload_returncode = 1
        for attempt in range(1, UPLOAD_MAX_ATTEMPTS + 1):
            print(f"  上传尝试 {attempt}/{UPLOAD_MAX_ATTEMPTS}", flush=True)
            upload = subprocess.run(
                [*rsync_command(identity_file, port), str(archive_path), destination],
                check=False,
            )
            upload_returncode = upload.returncode
            if upload_returncode == 0:
                break
            if attempt < UPLOAD_MAX_ATTEMPTS:
                print(
                    f"  连接中断，{UPLOAD_RETRY_DELAY_SECONDS}秒后从已传位置继续...",
                    flush=True,
                )
                time.sleep(UPLOAD_RETRY_DELAY_SECONDS)

        if upload_returncode != 0:
            subprocess.run(
                [
                    *ssh_base_command(identity_file, port),
                    f"{user}@{host}",
                    "rm",
                    "-f",
                    "--",
                    str(remote_archive),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            raise RuntimeError(
                f"断点续传已重试{UPLOAD_MAX_ATTEMPTS}次仍失败，退出码: {upload_returncode}"
            )

        print("\n[2/2] 校验、解压并切换web-mobile目录...", flush=True)
        remote_script = build_remote_deploy_script(
            remote_archive,
            archive_sha256,
            index_sha256,
            len(files),
        )
        deploy = subprocess.run(
            [*ssh_base_command(identity_file, port), f"{user}@{host}", "sh", "-s"],
            input=remote_script,
            text=True,
            check=False,
        )
        if deploy.returncode != 0:
            raise RuntimeError(
                "服务器解压或目录切换失败；脚本已尝试恢复旧目录并删除临时ZIP，"
                f"退出码: {deploy.returncode}"
            )

    print("\n网页版上传成功：")
    print(f"  已部署: {REMOTE_TARGET}")
    print("  服务器ZIP: 已删除")
    print(f"  上一版本: {REMOTE_PREVIOUS}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"\n上传失败: {exc}", file=sys.stderr)
        raise SystemExit(1)
