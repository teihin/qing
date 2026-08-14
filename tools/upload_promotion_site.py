#!/usr/bin/env python3
"""Package WebHome and deploy it safely to the promotion-site directory."""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import plistlib
import re
import shlex
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import upload_web_mobile as upload_common


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "WebHome"
DEFAULT_CONFIG = PROJECT_ROOT / ".hot-update-upload-config.json"
DEFAULT_APK_DIR = (
    PROJECT_ROOT
    / "build"
    / "jsb-link"
    / "frameworks"
    / "runtime-src"
    / "proj.android-studio"
    / "app"
    / "release"
)
REMOTE_PARENT = PurePosixPath("/www/html")
REMOTE_TARGET = REMOTE_PARENT / "webhome"
REMOTE_PREVIOUS = REMOTE_PARENT / ".webhome.previous"
SAFE_UPLOAD_NAME_RE = re.compile(r"^\.webhome-upload-[0-9]+-[0-9]+\.zip$")
REQUIRED_SITE_FILES = {
    "index.html",
    "styles.css",
    "app.js",
    "site-config.json",
    "assets/8l-logo.png",
    "assets/8l-app-icon.png",
    "assets/8l-login-background.png",
    "downloads/8L.mobileconfig",
}
PUBLIC_EXCLUDED_NAMES = {"Caddyfile.example"}
PUBLIC_EXCLUDED_SUFFIXES = {".md"}


@dataclasses.dataclass(frozen=True)
class ArchiveEntry:
    source: Path
    archive_name: str


def run_profile_generator(source_dir: Path) -> None:
    generator = source_dir / "scripts" / "generate_mobileconfig.py"
    if source_dir != DEFAULT_SOURCE_DIR.resolve():
        return
    if not generator.is_file():
        raise RuntimeError(f"苹果描述文件生成脚本不存在: {generator}")
    result = subprocess.run([sys.executable, str(generator)], cwd=PROJECT_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"苹果描述文件重新生成失败，退出码: {result.returncode}")


def relative_download_path(url: object, config_key: str) -> str:
    if not isinstance(url, str) or not url.strip():
        raise RuntimeError(f"site-config.json 缺少有效字段: {config_key}")
    parsed = urlsplit(url.strip())
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise RuntimeError(f"{config_key} 必须指向推广站内的相对文件: {url}")
    normalized = unquote(parsed.path).replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    posix_path = PurePosixPath(normalized)
    if not normalized or posix_path.is_absolute() or ".." in posix_path.parts:
        raise RuntimeError(f"{config_key} 相对路径不安全: {url}")
    return posix_path.as_posix()


def validate_android_apk(apk_path: Path) -> None:
    if apk_path.stat().st_size < 1024 * 1024:
        raise RuntimeError(f"Android APK体积异常（小于1MB）: {apk_path}")
    if not zipfile.is_zipfile(apk_path):
        raise RuntimeError(f"Android下载文件不是有效APK/ZIP: {apk_path}")
    try:
        with zipfile.ZipFile(apk_path, "r") as archive:
            names = set(archive.namelist())
            bad_file = archive.testzip()
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"Android APK已损坏: {apk_path}") from exc
    if bad_file is not None:
        raise RuntimeError(f"Android APK内容校验失败: {bad_file}")
    if "AndroidManifest.xml" not in names:
        raise RuntimeError(f"Android下载文件缺少AndroidManifest.xml: {apk_path}")


def find_release_apk(apk_dir: Path) -> Path:
    if not apk_dir.is_dir():
        raise RuntimeError(f"Android正式生成目录不存在: {apk_dir}")
    candidates = [
        path
        for path in apk_dir.glob("*.apk")
        if path.is_file() and not path.name.startswith("._")
    ]
    if not candidates:
        raise RuntimeError(f"Android正式生成目录没有APK: {apk_dir}")
    if len(candidates) != 1:
        names = "、".join(sorted(path.name for path in candidates))
        raise RuntimeError(
            f"Android正式生成目录应当只有一个APK，当前发现{len(candidates)}个: {names}\n"
            "请清理旧APK后重试，脚本不会按文件名或时间猜测。"
        )
    apk_path = candidates[0]
    validate_android_apk(apk_path)
    return apk_path


def create_promotion_archive(
    entries: list[ArchiveEntry], archive_path: Path
) -> None:
    with zipfile.ZipFile(
        archive_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
        allowZip64=True,
    ) as archive:
        for entry in entries:
            archive.write(entry.source, entry.archive_name)

    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            bad_file = archive.testzip()
            names = [info.filename for info in archive.infolist() if not info.is_dir()]
    except zipfile.BadZipFile as exc:
        raise RuntimeError(f"生成的推广网站ZIP已损坏: {archive_path}") from exc
    if bad_file is not None:
        raise RuntimeError(f"生成的推广网站ZIP校验失败: {bad_file}")
    expected_names = [entry.archive_name for entry in entries]
    if len(names) != len(set(names)) or set(names) != set(expected_names):
        raise RuntimeError("生成的推广网站ZIP内容与预期文件不一致")
    if "index.html" not in names or "downloads/8L.mobileconfig" not in names:
        raise RuntimeError("生成的推广网站ZIP缺少入口页或苹果描述文件")


def validate_mobileconfig(profile_path: Path, expected_game_url: str) -> None:
    try:
        with profile_path.open("rb") as stream:
            profile = plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException) as exc:
        raise RuntimeError(f"苹果描述文件格式错误: {profile_path}") from exc

    payloads = profile.get("PayloadContent")
    if not isinstance(payloads, list) or len(payloads) != 1 or not isinstance(payloads[0], dict):
        raise RuntimeError("苹果描述文件必须只包含一个有效Web Clip Payload")
    payload = payloads[0]
    checks = {
        "PayloadType": "com.apple.webClip.managed",
        "URL": expected_game_url,
        "FullScreen": True,
        "IgnoreManifestScope": True,
        "IsRemovable": True,
    }
    for key, expected in checks.items():
        if payload.get(key) != expected:
            raise RuntimeError(
                f"苹果描述文件字段不一致: {key}={payload.get(key)!r}，期望 {expected!r}"
            )
    icon = payload.get("Icon")
    if not isinstance(icon, bytes) or len(icon) < 1024:
        raise RuntimeError("苹果描述文件没有内嵌有效的8L桌面图标")


def collect_source_files(source_dir: Path) -> tuple[list[ArchiveEntry], dict, str]:
    if not source_dir.is_dir():
        raise RuntimeError(f"推广网站目录不存在: {source_dir}")

    config_path = source_dir / "site-config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"推广网站配置读取失败 {config_path}: {exc}") from exc
    if not isinstance(config, dict):
        raise RuntimeError(f"推广网站配置格式错误: {config_path}")

    apk_relative = relative_download_path(config.get("androidApkUrl"), "androidApkUrl")
    profile_relative = relative_download_path(config.get("iosProfileUrl"), "iosProfileUrl")
    game_url = config.get("iosGameUrl")
    public_url = config.get("promotionSiteUrl")
    if not isinstance(game_url, str) or urlsplit(game_url).scheme not in {"http", "https"}:
        raise RuntimeError("site-config.json 的 iosGameUrl 必须是完整HTTP/HTTPS地址")
    if not isinstance(public_url, str) or urlsplit(public_url).scheme not in {"http", "https"}:
        raise RuntimeError("site-config.json 的 promotionSiteUrl 必须是完整HTTP/HTTPS地址")

    expected_files = set(REQUIRED_SITE_FILES)
    expected_files.add(profile_relative)
    missing = sorted(name for name in expected_files if not (source_dir / name).is_file())
    if missing:
        raise RuntimeError("推广网站文件不完整，缺少: " + ", ".join(missing))

    profile_path = source_dir / profile_relative
    validate_mobileconfig(profile_path, game_url.strip())

    entries: list[ArchiveEntry] = []
    for path in sorted(source_dir.rglob("*")):
        relative_path = path.relative_to(source_dir)
        if (
            upload_common.should_skip(relative_path)
            or "__pycache__" in relative_path.parts
            or relative_path.parts[0] == "scripts"
            or path.name in PUBLIC_EXCLUDED_NAMES
            or path.suffix.lower() in PUBLIC_EXCLUDED_SUFFIXES
        ):
            continue
        if path.is_symlink():
            raise RuntimeError(f"推广网站不允许包含符号链接: {relative_path}")
        if path.is_file():
            if relative_path.as_posix() == apk_relative:
                continue
            entries.append(ArchiveEntry(path, relative_path.as_posix()))

    relative_names = {entry.archive_name for entry in entries}
    if profile_relative not in relative_names:
        raise RuntimeError(f"推广网站归档缺少苹果描述文件: {profile_relative}")
    return entries, config, apk_relative


def read_remote_apk_sha256(
    host: str,
    port: int,
    user: str,
    identity_file: Path,
) -> str | None:
    remote_apk = REMOTE_TARGET / "downloads" / "8L.apk"
    command = (
        "set -eu\n"
        f"if [ -f {shlex.quote(str(remote_apk))} ]; then\n"
        f"    sha256sum {shlex.quote(str(remote_apk))} | awk '{{print $1}}'\n"
        "fi\n"
    )
    result = subprocess.run(
        [
            *upload_common.ssh_base_command(identity_file, port),
            f"{user}@{host}",
            "sh",
            "-s",
        ],
        input=command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "无法读取服务器现有APK哈希，已停止上传以避免误判和重复传输。"
            f"SSH退出码: {result.returncode}"
        )
    remote_sha = result.stdout.strip().lower()
    if not remote_sha:
        return None
    if not re.fullmatch(r"[0-9a-f]{64}", remote_sha):
        raise RuntimeError(f"服务器返回的APK SHA-256格式不正确: {remote_sha!r}")
    return remote_sha


def build_remote_deploy_script(
    remote_archive: PurePosixPath,
    archive_sha256: str,
    index_sha256: str,
    config_sha256: str,
    profile_sha256: str,
    apk_sha256: str,
    expected_file_count: int,
    apk_in_archive: bool,
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
        "config_sha256": config_sha256,
        "profile_sha256": profile_sha256,
        "apk_sha256": apk_sha256,
        "file_count": str(expected_file_count),
        "apk_in_archive": "1" if apk_in_archive else "0",
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
[ "$target" = "/www/html/webhome" ]
[ "$previous" = "/www/html/.webhome.previous" ]
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
[ -f "$stage/site-config.json" ]
[ -f "$stage/downloads/8L.mobileconfig" ]
if [ "$apk_in_archive" = "1" ]; then
    [ -f "$stage/downloads/8L.apk" ]
else
    [ -f "$target/downloads/8L.apk" ]
    [ "$(sha256sum "$target/downloads/8L.apk" | awk '{{print $1}}')" = "$apk_sha256" ]
    mkdir -p "$stage/downloads"
    cp -- "$target/downloads/8L.apk" "$stage/downloads/8L.apk"
fi

find "$stage" -type d -exec chmod 755 {{}} +
find "$stage" -type f -exec chmod 644 {{}} +
unreadable_count=$(find "$stage" -type f ! -perm -004 | wc -l | tr -d ' ')
unsearchable_dir_count=$(find "$stage" -type d ! -perm -005 | wc -l | tr -d ' ')
[ "$unreadable_count" = "0" ]
[ "$unsearchable_dir_count" = "0" ]

actual_file_count=$(find "$stage" -type f | wc -l | tr -d ' ')
[ "$actual_file_count" = "$file_count" ]
[ "$(sha256sum "$stage/index.html" | awk '{{print $1}}')" = "$index_sha256" ]
[ "$(sha256sum "$stage/site-config.json" | awk '{{print $1}}')" = "$config_sha256" ]
[ "$(sha256sum "$stage/downloads/8L.mobileconfig" | awk '{{print $1}}')" = "$profile_sha256" ]
[ "$(sha256sum "$stage/downloads/8L.apk" | awk '{{print $1}}')" = "$apk_sha256" ]

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
[ "$deployed_file_count" = "$file_count" ]
[ "$(sha256sum "$target/index.html" | awk '{{print $1}}')" = "$index_sha256" ]
[ "$(sha256sum "$target/site-config.json" | awk '{{print $1}}')" = "$config_sha256" ]
[ "$(sha256sum "$target/downloads/8L.mobileconfig" | awk '{{print $1}}')" = "$profile_sha256" ]
[ "$(sha256sum "$target/downloads/8L.apk" | awk '{{print $1}}')" = "$apk_sha256" ]

rm -f -- "$archive"
trap - EXIT HUP INT TERM
printf 'PROMOTION_SITE_DEPLOY_OK files=%s index_sha256=%s\n' "$deployed_file_count" "$index_sha256"
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="上传8L推广下载网站到正式网页目录")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--apk-dir", type=Path, default=DEFAULT_APK_DIR)
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    parser.add_argument("--user")
    parser.add_argument("--identity-file")
    parser.add_argument("--yes", action="store_true", help="跳过上传确认")
    parser.add_argument("--dry-run", action="store_true", help="只生成、打包和校验，不连接服务器")
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    run_profile_generator(source_dir)
    entries, site_config, apk_relative = collect_source_files(source_dir)
    apk_path = find_release_apk(args.apk_dir.resolve())
    apk_sha256 = upload_common.sha256_file(apk_path)
    host, port, user, identity_file = upload_common.resolve_connection(args)
    index_sha256 = upload_common.sha256_file(source_dir / "index.html")
    config_sha256 = upload_common.sha256_file(source_dir / "site-config.json")
    profile_sha256 = upload_common.sha256_file(source_dir / "downloads" / "8L.mobileconfig")
    public_url = str(site_config["promotionSiteUrl"]).strip()

    remote_apk_sha256: str | None = None
    apk_in_archive = True
    if not args.dry_run:
        print("\n[预检] 比较本地与服务器APK版本...", flush=True)
        remote_apk_sha256 = read_remote_apk_sha256(host, port, user, identity_file)
        apk_in_archive = remote_apk_sha256 != apk_sha256
    if apk_in_archive:
        entries.append(ArchiveEntry(apk_path, apk_relative))

    total_bytes = sum(entry.source.stat().st_size for entry in entries)
    final_file_count = len(entries) if apk_in_archive else len(entries) + 1

    with tempfile.TemporaryDirectory(prefix="qing-promotion-site-") as temp_dir:
        archive_path = Path(temp_dir) / "webhome.zip"
        create_promotion_archive(entries, archive_path)
        archive_sha256 = upload_common.sha256_file(archive_path)

        print("\n准备上传推广网站：")
        print(f"  本地目录: {source_dir}")
        print(f"  生成时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(source_dir.stat().st_mtime))}")
        print(f"  本地APK: {apk_path}")
        print(f"  APK SHA-256: {apk_sha256}")
        if args.dry_run:
            print("  APK上传策略: dry-run不连接服务器，按需要上传新APK演练")
        elif apk_in_archive:
            print("  APK上传策略: 服务器没有相同APK，本次包含APK")
        else:
            print("  APK上传策略: SHA-256与服务器一致，本次跳过APK并沿用服务器文件")
        print(f"  ZIP文件数量: {len(entries)}")
        print(f"  部署后文件数量: {final_file_count}")
        print(f"  原始大小: {total_bytes / 1024 / 1024:.2f} MB")
        print(f"  ZIP大小: {archive_path.stat().st_size / 1024 / 1024:.2f} MB")
        print(f"  SSH目标: {user}@{host}:{port}")
        print(f"  部署目录: {REMOTE_TARGET}")
        print(f"  回滚目录: {REMOTE_PREVIOUS}")
        print(f"  公网地址: {public_url}")
        if args.dry_run:
            print("\n推广网站生成、文件检查与ZIP完整性校验通过（dry-run，未连接服务器）。")
            return 0
        if not args.yes and not upload_common.confirm_upload(str(REMOTE_TARGET)):
            print("\n已取消上传，服务器未发生变化。")
            return 2

        remote_name = f".webhome-upload-{int(time.time())}-{os.getpid()}.zip"
        if not SAFE_UPLOAD_NAME_RE.fullmatch(remote_name):
            raise RuntimeError(f"内部上传文件名校验失败: {remote_name}")
        remote_archive = REMOTE_PARENT / remote_name
        destination = f"{user}@{host}:{remote_archive}"

        print("\n[1/2] 断点续传推广网站ZIP到服务器临时文件...", flush=True)
        upload_returncode = 1
        for attempt in range(1, upload_common.UPLOAD_MAX_ATTEMPTS + 1):
            print(f"  上传尝试 {attempt}/{upload_common.UPLOAD_MAX_ATTEMPTS}", flush=True)
            upload = subprocess.run(
                [*upload_common.rsync_command(identity_file, port), str(archive_path), destination],
                check=False,
            )
            upload_returncode = upload.returncode
            if upload_returncode == 0:
                break
            if attempt < upload_common.UPLOAD_MAX_ATTEMPTS:
                print(
                    f"  连接中断，{upload_common.UPLOAD_RETRY_DELAY_SECONDS}秒后从已传位置继续...",
                    flush=True,
                )
                time.sleep(upload_common.UPLOAD_RETRY_DELAY_SECONDS)

        if upload_returncode != 0:
            subprocess.run(
                [
                    *upload_common.ssh_base_command(identity_file, port),
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
                f"断点续传已重试{upload_common.UPLOAD_MAX_ATTEMPTS}次仍失败，退出码: "
                f"{upload_returncode}"
            )

        print("\n[2/2] 校验、解压并切换webhome目录...", flush=True)
        remote_script = build_remote_deploy_script(
            remote_archive,
            archive_sha256,
            index_sha256,
            config_sha256,
            profile_sha256,
            apk_sha256,
            final_file_count,
            apk_in_archive=apk_in_archive,
        )
        deploy = subprocess.run(
            [
                *upload_common.ssh_base_command(identity_file, port),
                f"{user}@{host}",
                "sh",
                "-s",
            ],
            input=remote_script,
            text=True,
            check=False,
        )
        if deploy.returncode != 0:
            raise RuntimeError(
                "服务器解压或目录切换失败；脚本已尝试恢复旧目录并删除临时ZIP，"
                f"退出码: {deploy.returncode}"
            )

    print("\n推广网站上传成功：")
    print(f"  已部署: {REMOTE_TARGET}")
    print(f"  公网地址: {public_url}")
    print("  服务器ZIP: 已删除")
    print(f"  上一版本: {REMOTE_PREVIOUS}")
    print("  请用真实Android和iPhone网络分别打开公网地址完成最终检查。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"\n上传失败: {exc}", file=sys.stderr)
        raise SystemExit(1)
