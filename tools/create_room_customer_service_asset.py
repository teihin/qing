#!/usr/bin/env python3
"""Create the room-menu customer-service button with stable Cocos metadata."""

from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path

from PIL import Image

import generate_8l_full_skin as skin
import generate_qin_drh8_panel_fix as panel_fix


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "ImagesLuck" / "游戏内" / "退出房间.png"
TARGET = ROOT / "assets" / "ImagesLuck" / "游戏内" / "联系客服.png"
TEXTURE_UUID = "b36ab7de-5ef1-4a37-99ac-39c60ad9ee95"
SPRITE_UUID = "7fe79ef8-57c0-4e84-b854-90665e728517"


def atomic_write(path: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    context = panel_fix.context_for(SOURCE)
    image = panel_fix.draw_clean_button(context, "联系客服", (216, 57), False, 20)
    image = skin.recolor_8l(image)
    with Image.open(SOURCE) as source:
        image.putalpha(source.convert("RGBA").getchannel("A"))
    with tempfile.NamedTemporaryFile(prefix=f".{TARGET.name}.", suffix=".png", dir=TARGET.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        image.save(temporary, optimize=True)
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)

    source_meta = json.loads(SOURCE.with_suffix(".png.meta").read_text("utf-8"))
    target_meta = copy.deepcopy(source_meta)
    target_meta["uuid"] = TEXTURE_UUID
    source_sub_meta = next(iter(target_meta["subMetas"].values()))
    source_sub_meta["uuid"] = SPRITE_UUID
    source_sub_meta["rawTextureUuid"] = TEXTURE_UUID
    target_meta["subMetas"] = {"联系客服": source_sub_meta}
    atomic_write(
        TARGET.with_suffix(".png.meta"),
        (json.dumps(target_meta, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    print(f"已生成房间菜单客服按钮：{TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
