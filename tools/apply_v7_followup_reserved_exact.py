#!/usr/bin/env python3
"""Create the missing V7 reserved-information Prefab from formal art.

The legacy panelMain entry opens a resource named ``修改预留信息``, but the
repository did not contain that Prefab.  This editor-time migration reuses the
known-good password-page controls, serializes the accepted V7 layout into a
standalone Prefab and attaches the existing panelYLinfo business component.
No runtime node/layout generation is introduced.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path

from apply_v7_followup_main_exact import (
    BASE_H,
    GOLD,
    PLACEHOLDER,
    fixed_top,
    full_screen,
    style_editbox,
)
from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab
from apply_v7_wallet_exact import center_anchor, transparent


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/resources/UI/修改预留信息.prefab"
META = OUTPUT.with_suffix(".prefab.meta")
SCRIPT_TYPE = "9890bo02m9F+Zxrg1qWKhxw"


def move_row(p: Prefab, path: str, top: float) -> int:
    node = p.node(path)
    p.set_active(node, True)
    center_anchor(p, node)
    p.set_pos(node, 0, BASE_H / 2 - top - 73 / 2, 558, 73,
              disable_widget=True)
    _, sprite = p.component(node, "cc.Sprite")
    if sprite is not None:
        sprite["_enabled"] = False
    return node


def configure_editbox(p: Prefab, row_path: str, name: str,
                      placeholder: str, top: float, *,
                      x: float = 96, width: float = 335,
                      input_mode: int = 6, max_length: int = 16) -> int:
    move_row(p, row_path, top)
    style_editbox(p, row_path, placeholder)
    edit = p.node(row_path + "/txt")
    p.rename(edit, name)
    center_anchor(p, edit)
    p.set_pos(edit, x, 0, width, 62, disable_widget=True)
    _, component = p.component(edit, "cc.EditBox")
    component["maxLength"] = max_length
    component["_N$inputMode"] = input_mode
    component["_N$inputFlag"] = 5
    for suffix in ("BACKGROUND_SPRITE", "TEXT_LABEL", "PLACEHOLDER_LABEL"):
        child = p.node(f"{row_path}/{name}/{suffix}")
        p.set_pos(child, 0, 0, width - 5, 50, disable_widget=True)
        if suffix == "BACKGROUND_SPRITE":
            transparent(p, child, width, 62)
        else:
            style_label(p, f"{row_path}/{name}/{suffix}", x=0, y=0,
                        width=width - 5, height=50, size=22, align=0,
                        preview=(placeholder if suffix == "PLACEHOLDER_LABEL"
                                 else None))
            p.data[child]["_color"] = copy.deepcopy(
                PLACEHOLDER if suffix == "PLACEHOLDER_LABEL" else GOLD)
            _, outline = p.component(child, "cc.LabelOutline")
            if outline is not None:
                outline["_enabled"] = False
    return edit


def configure_account(p: Prefab, row_path: str, top: float) -> None:
    move_row(p, row_path, top)
    row = p.node(row_path)
    edit = p.node(row_path + "/txt")
    text_node = p.node(row_path + "/txt/TEXT_LABEL")
    label_id, label = p.component(text_node, "cc.Label")
    if label is None:
        raise RuntimeError("账号行缺少可复用 Label")
    p.rename(edit, "账号")
    p.data[edit]["_children"] = []
    p.data[edit]["_components"] = [{"__id__": label_id}]
    label["node"] = {"__id__": edit}
    p.set_active(edit, True)
    center_anchor(p, edit)
    p.set_pos(edit, 96, 0, 335, 54, disable_widget=True)
    style_label(p, row_path + "/账号", x=96, y=0, width=335,
                height=54, size=22, preview="--", align=0)
    p.data[edit]["_color"] = copy.deepcopy(GOLD)
    _, outline = p.component(edit, "cc.LabelOutline")
    if outline is not None:
        outline["_enabled"] = False


def collect_prefab(p: Prefab, root_id: int) -> list[dict]:
    ids: set[int] = set()

    def collect(node_id: int) -> None:
        if node_id in ids:
            return
        ids.add(node_id)
        node = p.data[node_id]
        for ref in node.get("_components", []):
            ids.add(ref["__id__"])
        if isinstance(node.get("_prefab"), dict):
            ids.add(node["_prefab"]["__id__"])
        for ref in node.get("_children", []):
            collect(ref["__id__"])

    collect(root_id)
    ordered = [root_id] + sorted(ids - {root_id})
    mapping = {0: 0, 1: 1,
               **{old: index + 1 for index, old in enumerate(ordered)}}

    def remap(value):
        if isinstance(value, dict):
            if set(value) == {"__id__"}:
                old = value["__id__"]
                if old in mapping:
                    return {"__id__": mapping[old]}
                raise RuntimeError(f"子树包含未收集的内部引用: {old}")
            return {key: remap(item) for key, item in value.items()}
        if isinstance(value, list):
            return [remap(item) for item in value]
        return value

    asset = copy.deepcopy(p.data[0])
    data = [asset] + [remap(copy.deepcopy(p.data[old])) for old in ordered]
    data[0]["data"] = {"__id__": 1}
    root = data[1]
    root["_parent"] = None
    root["_active"] = True
    root["_anchorPoint"] = {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5}
    root["_trs"]["array"][0:2] = [375, 667]
    for obj in data:
        if obj.get("__type__") == "cc.PrefabInfo":
            obj["root"] = {"__id__": 1}
            obj["asset"] = {"__id__": 0}
    script_id = len(data)
    data.append({
        "__type__": SCRIPT_TYPE,
        "_name": "",
        "_objFlags": 0,
        "node": {"__id__": 1},
        "_enabled": True,
        "_id": "",
    })
    root["_components"].append({"__id__": script_id})
    return data


def apply() -> None:
    p = Prefab("assets/resources/UI/panelMain.prefab")
    root = p.node("修改登陆密码")
    p.rename(root, "修改预留信息")
    full_screen(p, root)
    # Nested page resize helper belongs to panelMain and must not be attached
    # to the standalone Prefab root.
    p.data[root]["_components"] = [
        ref for ref in p.data[root]["_components"]
        if p.data[ref["__id__"]].get("__type__") != "c62d0KIf8xMmIRwTYVZlwGc"
    ]

    master = p.node("修改预留信息/V7密码页面母版")
    p.rename(master, "V7修改预留信息母版")
    p.art(master, "followup_reserved_master_long.png", 0, 0, 750, 1800,
          hide=True)
    untint(p, master)
    fixed_top(p, master, 0, 750, 1800)

    close = p.node("修改预留信息/title copy/关闭上上层")
    p.rename(close, "关闭")
    p.set_active(close, True)
    transparent(p, close, 100, 84, hide_children=True)
    fixed_top(p, close, 0, 100, 84, -325)

    group = p.node("修改预留信息/列表")
    p.set_active(group, True)
    center_anchor(p, group)
    p.disable(group, "cc.Layout")
    _, sprite = p.component(group, "cc.Sprite")
    if sprite is not None:
        sprite["_enabled"] = False
    fixed_top(p, group, 0, 750, BASE_H)

    account_row = p.node("修改预留信息/列表/原有密码")
    p.rename(account_row, "账号")
    configure_account(p, "修改预留信息/列表/账号", 355)

    configure_editbox(p, "修改预留信息/列表/新密码1",
                      "新密码1", "请输入新预留信息", 444)
    # Clone the untouched third source row before its inner ``txt`` node is
    # renamed; the verification-row helper then receives the same predictable
    # EditBox structure as the other rows.
    code_row = p.clone_subtree(
        p.node("修改预留信息/列表/新密码2"),
        group, "验证码")
    configure_editbox(p, "修改预留信息/列表/新密码2",
                      "新密码2", "请再次输入预留信息", 533)
    configure_editbox(p, "修改预留信息/列表/验证码",
                      "验证码", "请输入4位验证码", 622,
                      x=48, width=235, input_mode=3, max_length=4)

    button_source = p.node(
        "修改预留信息/列表/ok/确定修改登陆密码")
    get_code = p.clone_subtree(button_source, code_row, "获取验证码")
    p.set_active(get_code, True)
    transparent(p, get_code, 107, 53, hide_children=True)
    p.set_pos(get_code, 228, 0, 107, 53, disable_widget=True)

    time_source = p.node(
        "修改预留信息/列表/新密码1/新密码1/TEXT_LABEL")
    time = p.clone_subtree(time_source, code_row, "time")
    p.set_active(time, False)
    style_label(p, "修改预留信息/列表/验证码/time",
                x=228, y=0, width=107, height=48, size=22,
                preview="60", align=1)
    p.data[time]["_color"] = copy.deepcopy(GOLD)

    ok = button_source
    p.rename(ok, "确定修改预留信息")
    p.set_active(ok, True)
    transparent(p, ok, 438, 83, hide_children=True)
    p.set_pos(ok, 0, BASE_H / 2 - 877 - 83 / 2, 438, 83,
              disable_widget=True)

    data = collect_prefab(p, root)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    if not META.exists():
        prefab_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL,
                                    "qing://assets/resources/UI/修改预留信息.prefab"))
        META.write_text(json.dumps({
            "ver": "1.3.2",
            "uuid": prefab_uuid,
            "importer": "prefab",
            "optimizationPolicy": "AUTO",
            "asyncLoadAssets": False,
            "readonly": False,
            "subMetas": {},
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("已生成 V7 修改预留信息 Prefab：", OUTPUT)


if __name__ == "__main__":
    apply()
