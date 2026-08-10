#!/usr/bin/env python3
"""Read-only checks for the local numbered-avatar flow."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AVATAR_DIR = ROOT / "assets/resources/avatars"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        require(stream.read(8) == b"\x89PNG\r\n\x1a\n", f"not PNG: {path}")
        require(stream.read(4) == b"\x00\x00\x00\r", f"missing IHDR: {path}")
        require(stream.read(4) == b"IHDR", f"missing IHDR: {path}")
        return struct.unpack(">II", stream.read(8))


def validate_assets() -> None:
    frame_uuids: set[str] = set()
    for index in range(1, 101):
        stem = f"头像{index:02d}"
        png = AVATAR_DIR / f"{stem}.png"
        meta_path = AVATAR_DIR / f"{stem}.png.meta"
        require(png.is_file(), f"missing avatar: {png}")
        require(meta_path.is_file(), f"missing meta: {meta_path}")
        require(png_size(png) == (256, 256), f"wrong PNG size: {png}")

        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        require((meta.get("width"), meta.get("height")) == (256, 256), f"wrong meta size: {meta_path}")
        frame_uuid = meta["subMetas"][stem]["uuid"]
        require(frame_uuid not in frame_uuids, f"duplicate SpriteFrame UUID: {frame_uuid}")
        frame_uuids.add(frame_uuid)


def validate_code() -> None:
    image_manager = read("assets/scripts/logic/ImageManager.ts")
    panel_main = read("assets/scripts/UI/panelMain.ts")
    game_def = read("assets/scripts/common/GameDef.ts")
    mobile = read("assets/scripts/mobile/MobileManager.ts")
    drh_logic = read("assets/scripts/logic/DrhLogicMgr.ts")

    for token in ("XMLHttpRequest", "WEB_IP_PIC", "PIC_UPDATE_URL", "getWritablePath", "cc.loader.load({url"):
        require(token not in image_manager, f"network avatar code remains in ImageManager: {token}")
    for token in ("IMG_URL", "PIC_UPDATE_URL", "OpenGally", "onGetPic", "uploadImage", "fileCut", "cc.loader.load({url"):
        require(token not in panel_main, f"legacy avatar code remains in panelMain: {token}")
    for token in ("WEB_IP_PIC", "WEB_PORT_PIC", "PIC_UPDATE_URL"):
        require(token not in game_def, f"obsolete avatar-server constant remains: {token}")
    for token in ("onGetPic", "headimgurl"):
        require(token not in mobile, f"obsolete native/network avatar bridge remains: {token}")

    require('AVATAR_COUNT:number = 100' in image_manager, "avatar count is not fixed at 100")
    require('AVATAR_ROOT:string = "avatars/头像"' in image_manager, "local avatar resource root missing")
    require('return "1";' in image_manager, "invalid-field fallback to avatar 1 missing")
    require('Math.random() * this.AVATAR_COUNT' in image_manager, "random 1-100 initialization missing")
    require('RandomAvatarBatch(count:number = 20' in image_manager, "random 20-avatar batch helper missing")
    require('cc.loader.loadRes(this.GetAvatarResourcePath' in image_manager, "resources avatar load missing")
    require('rawText == "" ? imageManager.RandomAvatarIndex() : "1"' in panel_main, "empty/random and legacy/fallback split missing")
    require('new cc.Node("本地头像列表")' in panel_main, "20-slot avatar selector container missing")
    require('let batch = imageManager.RandomAvatarBatch(20,previousBatch)' in panel_main,
            "in-game selector does not refresh a random batch of 20")
    require('item.on("click"' in panel_main and 'this.SetEditAvatar(editNode, slotMap[slotName])' in panel_main,
            "avatar selector click-to-preview flow missing")
    require('currentIndex >= ImageManager.getInstance().AVATAR_COUNT' not in panel_main,
            "legacy click-to-cycle avatar flow still remains")
    require('ImageManager.IsAvatarIndex' not in panel_main and 'ImageManager.NormalizeAvatarIndex' not in panel_main,
            "Creator-incompatible avatar static method call remains")
    require('this.strPhoto = "";' in game_def, "PlayerInfoBase.ResetAll does not clear avatar index")
    require('one.hasOwnProperty("photo")' in drh_logic, "PlayerList avatar-index parsing missing")

    all_scripts = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (ROOT / "assets/scripts").rglob("*.ts")
    )
    writes = re.findall(r'reqSetProperty\("photo",([^\n;]+)', all_scripts)
    require(writes, "no avatar field writes found")
    for expression in writes:
        require("http" not in expression and ".jpg" not in expression and "IMG_URL" not in expression,
                f"non-index avatar write remains: {expression.strip()}")


def validate_normalization_contract() -> None:
    def normalize(value: object) -> str:
        text = "" if value is None else str(value).strip()
        if not re.fullmatch(r"\d+", text):
            return "1"
        number = int(text)
        return str(number) if 1 <= number <= 100 else "1"

    cases = {
        None: "1",
        "": "1",
        "old-avatar.jpg": "1",
        "https://legacy/avatar.png": "1",
        "0": "1",
        "101": "1",
        "01": "1",
        "20": "20",
        "100": "100",
    }
    for value, expected in cases.items():
        require(normalize(value) == expected, f"normalization contract failed: {value!r}")


def main() -> None:
    validate_assets()
    validate_code()
    validate_normalization_contract()
    print("PASS: 100 local avatars and random-20 numbered-avatar flow validated")


if __name__ == "__main__":
    main()
