#!/usr/bin/env python3
"""Enable every Sprite that directly references a V7 SpriteFrame.

Some legacy prefab nodes intentionally had their Sprite component disabled.
After assigning new V7 art those components must be enabled in the serialized
Prefab itself, otherwise the editor/runtime shows labels but no panel artwork.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
V7_DIR = ROOT / "assets/resources/V7"
PREFABS = [
    "assets/resources/UI/panelLogin.prefab",
    "assets/resources/UI/panelMain.prefab",
    "assets/resources/UI/panelRecordList.prefab",
    "assets/resources/UI/panelRecordInfo.prefab",
    "assets/resources/UI/panelGivePad.prefab",
    "assets/resources/Prefabs/战绩对象.prefab",
    "assets/resources/Prefabs/战绩玩家对象.prefab",
]


def v7_frames() -> set[str]:
    frames: set[str] = set()
    for meta_path in V7_DIR.glob("*.png.meta"):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        for sub_meta in meta.get("subMetas", {}).values():
            uuid = sub_meta.get("uuid")
            if uuid:
                frames.add(uuid)
    return frames


def main() -> None:
    frames = v7_frames()
    for relative in PREFABS:
        path = ROOT / relative
        data = json.loads(path.read_text(encoding="utf-8"))
        changed = 0
        for item in data:
            if item.get("__type__") != "cc.Sprite":
                continue
            frame = item.get("_spriteFrame")
            if not isinstance(frame, dict) or frame.get("__uuid__") not in frames:
                continue
            if item.get("_enabled") is not True:
                item["_enabled"] = True
                changed += 1
        if changed:
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print(f"{relative}: enabled {changed} V7 Sprite component(s)")


if __name__ == "__main__":
    main()
