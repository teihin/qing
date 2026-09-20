#!/usr/bin/env python3
"""Static contract and Creator-import audit for the approved panelGivePad reskin."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelGivePad.prefab"
ASSETS = ROOT / "assets/V7"
NAMES = ("panel", "title", "divider", "recipient", "amount", "password", "id_prefix", "close", "lock", "avatar_ring", "input", "button")
BUSINESS = ("bk/name", "bk/id", "bk/头像/mask/img", "bk/输入金额", "bk/金额", "bk/密码", "bk/确定赠送", "bk/关闭")


def main() -> None:
    data = json.loads(PREFAB.read_text(encoding="utf-8"))
    nodes = {}
    def walk(index: int, path: str) -> None:
        node = data[index]; current = f"{path}/{node['_name']}" if path else node["_name"]
        nodes[current] = index
        for child in node.get("_children", []): walk(child["__id__"], current)
    walk(1, "")
    missing = [f"panelGivePad/{path}" for path in BUSINESS if f"panelGivePad/{path}" not in nodes]
    if missing: raise RuntimeError(f"missing preserved business nodes: {missing}")
    for path in ("panelGivePad/bk/name", "panelGivePad/bk/id", "panelGivePad/bk/金额"):
        if not any(data[ref["__id__"]].get("__type__") == "cc.Label" for ref in data[nodes[path]]["_components"]):
            raise RuntimeError(f"live label replaced: {path}")
    for path in ("panelGivePad/bk/输入金额", "panelGivePad/bk/密码"):
        if not any(data[ref["__id__"]].get("__type__") == "cc.EditBox" for ref in data[nodes[path]]["_components"]):
            raise RuntimeError(f"live input replaced: {path}")
    root = nodes["panelGivePad"]
    if data[root]["_anchorPoint"] != {"__type__": "cc.Vec2", "x": .5, "y": .5}:
        raise RuntimeError("root anchor is not centered")
    button = next(data[r["__id__"]] for r in data[nodes["panelGivePad/bk/确定赠送"]]["_components"] if data[r["__id__"]].get("__type__") == "cc.Sprite")
    if button["_type"] != 0: raise RuntimeError("approved button must use cc.Sprite.Type.SIMPLE")
    asset_uuids = set()
    for name in NAMES:
        meta = json.loads((ASSETS / f"give_pad_approved_{name}.png.meta").read_text(encoding="utf-8"))
        frame = meta["subMetas"][f"give_pad_approved_{name}"]
        if frame["trimType"] != "none": raise RuntimeError(f"trimmed art: {name}")
        asset_uuids.add(frame["uuid"])
    refs = {(component.get("_spriteFrame") or {}).get("__uuid__") for component in data if isinstance(component, dict) and component.get("__type__") == "cc.Sprite"}
    absent = asset_uuids - refs
    if absent: raise RuntimeError(f"unbound formal sprite UUIDs: {sorted(absent)}")
    imports = ROOT / "library/imports"
    missing_imports = []
    for frame in asset_uuids:
        if not list(imports.rglob(f"*{frame}*")):
            missing_imports.append(frame)
    print(f"static contract passed: {len(asset_uuids)} asset metas, {len(BUSINESS)} business paths")
    if missing_imports:
        raise RuntimeError(f"Creator library imports missing: {missing_imports}")
    print(f"Creator imports found: {len(asset_uuids)} sprite-frame UUIDs")


if __name__ == "__main__":
    main()
