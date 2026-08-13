#!/usr/bin/env python3
"""根据 WebHome/site-config.json 生成带8L图标的 Web Clip 描述文件。"""

from __future__ import annotations

import json
import plistlib
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse


WEB_HOME = Path(__file__).resolve().parents[1]
CONFIG_PATH = WEB_HOME / "site-config.json"
ICON_PATH = WEB_HOME / "assets" / "8l-app-icon.png"
OUTPUT_PATH = WEB_HOME / "downloads" / "8L.mobileconfig"
UUID_NAMESPACE = uuid.UUID("d922629f-d6a1-44a3-9498-1f373e8c5fb7")


def require_text(config: dict[str, object], key: str) -> str:
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"site-config.json 缺少有效字段: {key}")
    return value.strip()


def stable_uuid(name: str) -> str:
    return str(uuid.uuid5(UUID_NAMESPACE, name)).upper()


def main() -> int:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    game_name = require_text(config, "gameName")
    game_url = require_text(config, "iosGameUrl")
    identifier = require_text(config, "profileIdentifier")
    organization = require_text(config, "profileOrganization")
    description = require_text(config, "profileDescription")

    parsed_url = urlparse(game_url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise ValueError("iosGameUrl 必须是完整的 http:// 或 https:// 网页地址")
    if not ICON_PATH.is_file():
        raise FileNotFoundError(f"缺少桌面图标: {ICON_PATH}")

    profile_identifier = f"{identifier}.profile"
    webclip_identifier = f"{identifier}.payload"
    webclip_payload = {
        "FullScreen": True,
        "Icon": ICON_PATH.read_bytes(),
        "IgnoreManifestScope": False,
        "IsRemovable": True,
        "Label": game_name,
        "Precomposed": True,
        "URL": game_url,
        "PayloadDescription": description,
        "PayloadDisplayName": f"{game_name} 桌面入口",
        "PayloadIdentifier": webclip_identifier,
        "PayloadOrganization": organization,
        "PayloadType": "com.apple.webClip.managed",
        "PayloadUUID": stable_uuid(webclip_identifier),
        "PayloadVersion": 1,
    }
    profile = {
        "PayloadContent": [webclip_payload],
        "PayloadDescription": description,
        "PayloadDisplayName": f"{game_name} 游戏安装",
        "PayloadIdentifier": profile_identifier,
        "PayloadOrganization": organization,
        "PayloadRemovalDisallowed": False,
        "PayloadType": "Configuration",
        "PayloadUUID": stable_uuid(profile_identifier),
        "PayloadVersion": 1,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("wb") as output:
        plistlib.dump(profile, output, fmt=plistlib.FMT_XML, sort_keys=False)

    print(f"已生成: {OUTPUT_PATH}")
    print(f"桌面名称: {game_name}")
    print(f"打开地址: {game_url}")
    print(f"文件大小: {OUTPUT_PATH.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"生成失败: {error}", file=sys.stderr)
        raise SystemExit(1)
