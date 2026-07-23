#!/usr/bin/env python3
"""Read-only static validation for the Qin panelUserInfo reskin."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PREFAB = ASSETS / "resources" / "UI" / "panelUserInfo.prefab"
PANEL_SCRIPT = ASSETS / "scripts" / "UI" / "panelUserInfo.ts"
GENERATOR = ROOT / "tools" / "generate_qin_user_info_skin.py"
PREVIEW = ROOT / "art_sources" / "user_info" / "qin_user_info_runtime_preview.png"

INTERACTION = ASSETS / "ImagesLuck" / "互动"

EXPECTED_ASSETS = {
    INTERACTION / "用户信息框.png": ((623, 880), "7bc0a310-3849-4718-96e5-1ab22a69c99e", "16e1036d-1390-4cbb-88a8-e82e02c2f6e9"),
    INTERACTION / "玩家信息.png": ((134, 37), "e1439ccf-f1b7-4f31-a7c7-4342b513f737", "902642e9-c029-4fe9-a398-1a2b70e2692a"),
    INTERACTION / "开通VIP.png": ((125, 32), "cde5d962-15ba-4277-8fee-41014998d90b", "500f81a4-66de-4b21-b095-0d157fdf2525"),
    INTERACTION / "语音回放.png": ((202, 54), "2ced2b01-a8c0-423a-bf9b-5e9a789c3f70", "263c14ad-c5af-4567-8dec-69c009959504"),
    INTERACTION / "赠送.png": ((196, 54), "0c595052-a658-4425-a030-1b229fcf0d77", "31bcace6-1f9d-4322-9e56-e46b730f09cb"),
    INTERACTION / "语音聊天.png": ((104, 29), "ce7483db-dc4f-4b69-b012-ce91d0a777a4", "e45c9a8d-771c-4896-a1bb-a4c963869651"),
    INTERACTION / "数值底框.png": ((561, 254), "fa75333b-a339-4df9-8517-ab02c04ed326", "2b80b9c1-7a24-403b-8cd8-316a82eb0271"),
    INTERACTION / "表情框.png": ((139, 136), "a773af98-45d9-4fec-8b9d-00278e2355e6", "23dc1b33-0047-4f5c-aa12-576e8e421854"),
    INTERACTION / "总手数.png": ((78, 29), "823e1cc5-d0aa-4ef9-8d0c-a77da57e3716", "1b460675-4bf7-454e-9d0f-eb3f5bec9b2f"),
    INTERACTION / "总胜率.png": ((78, 29), "fe33aaa9-9f02-47d8-8e9f-16e8e5c6e85b", "016ce02d-a234-481c-a92e-661e79cb1549"),
    INTERACTION / "失败率.png": ((78, 29), "b114ea7b-4117-49a3-9631-b9a8815f3cac", "ef6918a0-2eca-4e16-b686-3d55b3303309"),
    INTERACTION / "胜利.png": ((81, 29), "b0e92214-c1c1-4610-af42-8ec0d9f65728", "e267da5b-6db3-45c1-a5ca-957972e8c78e"),
    INTERACTION / "平局.png": ((81, 28), "246b9525-3a0c-4fa7-a4fe-f3723ceef2f8", "b33896eb-e688-403a-8596-d79de801f5ba"),
    INTERACTION / "失败.png": ((77, 29), "7b830e21-6838-4e53-ac9c-fd3c8fcc7115", "6b374914-a76a-432a-b373-656e2a8453ce"),
    INTERACTION / "入池率.png": ((79, 29), "8c359e69-d551-45a8-9f8d-ee5f1daec3e5", "749a2082-67ff-4fe3-934c-12879768cc3c"),
    INTERACTION / "翻牌率.png": ((79, 29), "67ba7f64-d794-4b82-8b1b-60c88e20f32e", "61215ede-5fbf-4a19-8a50-404cfc25e579"),
    INTERACTION / "翻牌胜率.png": ((88, 30), "0ba4fc93-687c-4ad6-949b-017afb403e4a", "bbee19f0-e2f1-4543-8ea4-986c8b85c0f4"),
}

PROP_HASHES = {
    INTERACTION / "吻.png": "23c068bbd5d253408081bc8b7c2ef44cefe1951d5cf0d201d45b52677ef5f896",
    INTERACTION / "鸡.png": "dd38a17b27eb72365a23f53d2200ef0f32cdb887fc5de9aa4add7643a4a39dc6",
    INTERACTION / "啤酒.png": "23740b879cf62f63da88282bb5ede3b38a95d1d578255a518071fbb20e2ae779",
    INTERACTION / "拇指.png": "97655a2dcbc7e72256388d301c6114e18fc6280f0fa4e14ee14f4b41ba10454b",
    INTERACTION / "炸弹.png": "6f8bcf9a9655ee6b682af11c4e649160ee54e1aa0faf5969ead4e261f848d04c",
    INTERACTION / "枪.png": "33e854ea37e1257ace409303796f5d5edab10fd1cb919fc7a1d3d1e52e38ab28",
    ASSETS / "Images" / "道具" / "x1.png": "5a4164d896b27f3b5d818b924d57728971a12825f6a900edee8153a0f1ab21fa",
    ASSETS / "Images" / "道具" / "x3.png": "3147d2b24466ec465b6cfc864bea6a9000680fa9c2cff53fef4fd9a51a5923e5",
    ASSETS / "Images" / "道具" / "x7.png": "661f6f6ef78c97694d0b0d70ddc3be65a25d9fd5018e99204681b1cc61444d08",
    ASSETS / "Images" / "道具" / "x8.png": "84dc3b0b05233fe88285b3bb30355d719f9e8e8a7c9cdab4bc9371e4848f5e6c",
    ASSETS / "Images" / "道具" / "机枪" / "item15_1.png": "05fe4538cd62cf400721ef321b91804248f756c91873d1f466ecb3355c95569a",
}

PANEL_SCRIPT_HASH = "5393ec841d48d9676e69d18023ae16aa441fe75403a5b5a7958f5c24299727cc"
OLD_FRAME = "e92694a7-bab9-463e-84a2-ad38bee64974"
NEW_FRAME = "16e1036d-1390-4cbb-88a8-e82e02c2f6e9"

GOLD = (223, 172, 82, 255)
GOLD_HI = (255, 237, 181, 255)
IVORY = (235, 218, 181, 255)
COPPER = (188, 76, 54, 255)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def ref_id(value: Any) -> int | None:
    return value.get("__id__") if isinstance(value, dict) and isinstance(value.get("__id__"), int) else None


def load_generator_targets() -> set[Path]:
    spec = importlib.util.spec_from_file_location("qin_user_info_generator", GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to import generator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {Path(path).resolve() for path in module.TARGETS}


class Prefab:
    def __init__(self, path: Path) -> None:
        self.data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(self.data, list):
            raise RuntimeError("Prefab root must be a JSON array")
        self.nodes = {
            index: item
            for index, item in enumerate(self.data)
            if isinstance(item, dict) and item.get("__type__") == "cc.Node"
        }
        roots = [index for index, node in self.nodes.items() if ref_id(node.get("_parent")) is None]
        if len(roots) != 1:
            raise RuntimeError(f"Expected one root node, found {len(roots)}")
        self.paths: dict[str, list[int]] = {}
        self._walk(roots[0], "", set())

    def _walk(self, node_id: int, parent: str, ancestors: set[int]) -> None:
        if node_id in ancestors:
            raise RuntimeError(f"Prefab hierarchy cycle at node {node_id}")
        node = self.nodes[node_id]
        name = node.get("_name")
        if not isinstance(name, str) or not name:
            raise RuntimeError(f"Invalid node name at {node_id}")
        path = f"{parent}/{name}" if parent else name
        self.paths.setdefault(path, []).append(node_id)
        descendants = set(ancestors)
        descendants.add(node_id)
        for child_ref in node.get("_children") or []:
            child_id = ref_id(child_ref)
            if child_id not in self.nodes or ref_id(self.nodes[child_id].get("_parent")) != node_id:
                raise RuntimeError(f"Broken hierarchy below {path}")
            self._walk(child_id, path, descendants)

    def unique(self, path: str) -> tuple[int, dict[str, Any]]:
        matches = self.paths.get(path, [])
        if len(matches) != 1:
            raise RuntimeError(f"Expected one node at {path}, found {len(matches)}")
        return matches[0], self.nodes[matches[0]]

    def components(self, node_id: int, kind: str) -> list[dict[str, Any]]:
        result = []
        for component_ref in self.nodes[node_id].get("_components") or []:
            component_id = ref_id(component_ref)
            if component_id is None:
                continue
            component = self.data[component_id]
            if isinstance(component, dict) and component.get("__type__") == kind:
                result.append(component)
        return result


def colour_tuple(node: dict[str, Any]) -> tuple[int, int, int, int]:
    colour = node.get("_color") or {}
    return tuple(int(colour.get(key, -1)) for key in ("r", "g", "b", "a"))  # type: ignore[return-value]


def trs_xy(node: dict[str, Any]) -> tuple[float, float]:
    array = (node.get("_trs") or {}).get("array") or []
    if len(array) < 2:
        raise RuntimeError(f"Node {node.get('_name')} has no 2D transform")
    return float(array[0]), float(array[1])


def validate_assets(errors: list[str]) -> None:
    targets = load_generator_targets()
    expected_targets = {path.resolve() for path in EXPECTED_ASSETS}
    if targets != expected_targets:
        errors.append("Generator target set differs from the 17 panelUserInfo chrome assets")
    if targets & {path.resolve() for path in PROP_HASHES}:
        errors.append("Generator target set includes a prop image")

    for path, (size, texture_uuid, sprite_uuid) in EXPECTED_ASSETS.items():
        if not path.exists():
            errors.append(f"Missing runtime image: {relative(path)}")
            continue
        with Image.open(path) as image:
            if image.size != size:
                errors.append(f"Wrong size for {relative(path)}: {image.size} != {size}")
            if image.mode != "RGBA":
                errors.append(f"Wrong image mode for {relative(path)}: {image.mode}")
            rgba = image.convert("RGBA")
            alpha_box = rgba.getchannel("A").getbbox()
            if alpha_box != (0, 0, size[0], size[1]):
                errors.append(f"Alpha trim drift for {relative(path)}: {alpha_box}")
            strong_blue = sum(1 for red, green, blue, alpha in rgba.get_flattened_data() if alpha > 24 and blue > red + 45 and blue > green + 20)
            if strong_blue:
                errors.append(f"Legacy blue pixels remain in {relative(path)}: {strong_blue}")

        meta_path = path.with_suffix(path.suffix + ".meta")
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            sub_meta = next(iter(meta["subMetas"].values()))
        except Exception as exc:
            errors.append(f"Unreadable metadata for {relative(path)}: {exc}")
            continue
        if (meta.get("width"), meta.get("height")) != size:
            errors.append(f"Metadata size drift for {relative(path)}")
        if meta.get("uuid") != texture_uuid or sub_meta.get("uuid") != sprite_uuid:
            errors.append(f"UUID drift for {relative(path)}")
        trim = (sub_meta.get("trimX"), sub_meta.get("trimY"), sub_meta.get("width"), sub_meta.get("height"))
        if trim != (0, 0, size[0], size[1]):
            errors.append(f"Metadata trim drift for {relative(path)}: {trim}")

    for path, expected_hash in PROP_HASHES.items():
        if not path.exists():
            errors.append(f"Missing preserved prop image: {relative(path)}")
        elif digest(path) != expected_hash:
            errors.append(f"Prop image changed unexpectedly: {relative(path)}")

    if not PREVIEW.exists() or Image.open(PREVIEW).size != (750, 1334):
        errors.append("Missing or invalid 750x1334 runtime preview")


def validate_prefab(errors: list[str]) -> None:
    document = Prefab(PREFAB)
    raw_text = PREFAB.read_text(encoding="utf-8")
    if raw_text.count(NEW_FRAME) != 1 or OLD_FRAME in raw_text:
        errors.append("panelUserInfo is not exclusively bound to its dedicated Qin frame")

    transforms = {
        "panelUserInfo/bk copy": (-54.0, -27.0),
        "panelUserInfo/bk copy/玩家信息": (0.0, 378.69),
        "panelUserInfo/数据": (-52.0, -29.0),
        "panelUserInfo/数据/头像": (-149.0, 241.908),
        "panelUserInfo/数据/语音回放": (145.0, 218.818),
        "panelUserInfo/数据/赠送": (145.0, 136.826),
        "panelUserInfo/数据/充值": (207.897, 473.624),
        "panelUserInfo/数据/屏蔽语音": (181.165, 305.258),
        "panelUserInfo/数据/统计": (0.0, -14.245),
        "panelUserInfo/数据/道具": (24.98, -261.808),
    }
    for path, expected in transforms.items():
        _, node = document.unique(path)
        actual = trs_xy(node)
        if any(abs(left - right) > 0.001 for left, right in zip(actual, expected)):
            errors.append(f"Layout changed at {path}: {actual} != {expected}")

    for path in ("panelUserInfo/数据/语音回放", "panelUserInfo/数据/赠送", "panelUserInfo/数据/充值"):
        node_id, _ = document.unique(path)
        if len(document.components(node_id, "cc.Button")) != 1:
            errors.append(f"Button contract changed at {path}")
    toggle_id, _ = document.unique("panelUserInfo/数据/屏蔽语音")
    if len(document.components(toggle_id, "cc.Toggle")) != 1:
        errors.append("Voice toggle contract changed")

    expected_colours = {
        "panelUserInfo/数据/txt": GOLD,
        "panelUserInfo/数据/id": IVORY,
        "panelUserInfo/数据/name": GOLD_HI,
        "panelUserInfo/数据/统计/总手数": IVORY,
        "panelUserInfo/数据/统计/总胜率": IVORY,
        "panelUserInfo/数据/统计/失败率": COPPER,
        "panelUserInfo/数据/统计/胜利": IVORY,
        "panelUserInfo/数据/统计/平局": IVORY,
        "panelUserInfo/数据/统计/失败": COPPER,
        "panelUserInfo/数据/统计/入池率": IVORY,
        "panelUserInfo/数据/统计/翻牌率": IVORY,
        "panelUserInfo/数据/统计/翻牌胜率": IVORY,
    }
    for path, expected in expected_colours.items():
        _, node = document.unique(path)
        if colour_tuple(node) != expected:
            errors.append(f"Dynamic label colour drift at {path}: {colour_tuple(node)}")

    prop_frame_uuid = EXPECTED_ASSETS[INTERACTION / "表情框.png"][2]
    if raw_text.count(prop_frame_uuid) != 6:
        errors.append("Visible prop-card frame count changed")


def validate_script(errors: list[str]) -> None:
    if digest(PANEL_SCRIPT) != PANEL_SCRIPT_HASH:
        errors.append("panelUserInfo.ts changed during the art-only task")
    source = PANEL_SCRIPT.read_text(encoding="utf-8")
    for contract in ("数据/赠送", "数据/充值", "数据/头像/mask/img", "数据/屏蔽语音", "reqGameCommand"):
        if contract not in source:
            errors.append(f"Missing runtime contract in panelUserInfo.ts: {contract}")


def main() -> None:
    errors: list[str] = []
    validate_assets(errors)
    validate_prefab(errors)
    validate_script(errors)
    if errors:
        print("panelUserInfo Qin validation failed:")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)
    print("panelUserInfo Qin validation passed")
    print(f"- 17 panel-specific black/gold runtime images verified")
    print(f"- 11 prop images verified byte-for-byte unchanged")
    print(f"- prefab hierarchy, transforms, buttons, toggle and script contracts preserved")


if __name__ == "__main__":
    main()
