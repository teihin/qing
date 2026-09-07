#!/usr/bin/env python3
"""Read-only validation for the V7 quick-registration Prefab skin."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from apply_v7_prefab_skin import Prefab, frame_uuid


ROOT = Path(__file__).resolve().parents[1]
V7 = ROOT / "assets/resources/V7"
HEIGHTS = (1334, 1500, 1624, 1778)


def require(ok: bool, message: str) -> None:
    if not ok:
        raise AssertionError(message)


def sprite_is(p: Prefab, path: str, asset: str) -> None:
    _, sprite = p.component(p.node(path), "cc.Sprite")
    require(sprite is not None, f"{path} 缺少 Sprite")
    require(sprite.get("_spriteFrame", {}).get("__uuid__") == frame_uuid(asset),
            f"{path} 没有使用 {asset}")


def widget_is(p: Prefab, path: str, flags: int) -> None:
    _, widget = p.component(p.node(path), "cc.Widget")
    require(widget is not None and widget.get("_enabled") is True,
            f"{path} 缺少启用的 Widget")
    require(widget.get("_alignFlags") == flags,
            f"{path} Widget={widget.get('_alignFlags')}，预期 {flags}")


def editbox_component(p: Prefab, node_id: int):
    _, component = p.component(node_id, "cc.EditBox")
    if component is not None:
        return component
    for ref in p.data[node_id].get("_components", []):
        candidate = p.data[ref["__id__"]]
        if "_N$textLabel" in candidate and "_N$placeholderLabel" in candidate:
            return candidate
    return None


def main() -> None:
    assets = (
        "register_modal_panel_exact.png", "register_title_exact.png",
        "register_subtitle_exact.png", "register_avatar_prompt_exact.png",
        "register_header_rule_exact.png", "register_shield_exact.png",
        "register_row_invite_exact.png", "register_row_nickname_exact.png",
        "register_row_account_exact.png", "register_row_password_exact.png",
        "register_row_confirm_exact.png", "register_anti_theft_exact.png",
        "register_submit_exact.png", "register_avatar_ring_exact.png",
        "register_toggle_off_exact.png", "register_toggle_on_exact.png",
        "register_avatar_picker_panel_exact.png",
        "register_avatar_item_ring_exact.png",
        "register_avatar_refresh_exact.png",
        "register_close_exact.png", "register_arrow_left_exact.png",
        "register_arrow_right_exact.png",
        "register_status_icon_exact.png", "register_status_clean_exact.png",
        "register_safety_exact.png",
    )
    for asset in assets:
        path = V7 / asset
        require(path.is_file(), f"缺少资源 {asset}")
        require(Image.open(path).width >= 24 and Image.open(path).height >= 24,
                f"资源尺寸异常 {asset}")
        meta = json.loads((V7 / f"{asset}.meta").read_text(encoding="utf-8"))
        require(meta.get("packable") is False, f"高清资源不应进入动态图集: {asset}")

    p = Prefab("assets/resources/UI/panelLogin.prefab")
    widget_is(p, "注册弹窗", 45)
    widget_is(p, "注册弹窗/遮罩", 45)
    widget_is(p, "注册弹窗/注册资料框", 18)
    dialog = p.data[p.node("注册弹窗/注册资料框")]
    require((dialog["_contentSize"]["width"], dialog["_contentSize"]["height"]) == (583, 1035),
            "注册资料框不是确认稿等比映射后的固定 583×1035")
    _, dialog_widget = p.component(p.node("注册弹窗/注册资料框"), "cc.Widget")
    require(dialog_widget.get("_horizontalCenter") == 0 and
            dialog_widget.get("_verticalCenter") == 0,
            "注册资料框没有作为固定构图整体居中")
    for height in HEIGHTS:
        require((height - 1035) / 2 >= 149,
                f"{height} 高度下固定注册弹窗超出安全区")

    sprite_is(p, "注册弹窗/注册资料框", "register_modal_panel_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/8L徽标", "register_shield_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册标题美术", "register_title_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册副标题美术", "register_subtitle_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册标题分隔", "register_header_rule_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/关闭注册/关闭图标", "register_close_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/头像选择/V7头像圆环", "register_avatar_ring_exact.png")
    avatar_node = p.data[p.node("注册弹窗/注册资料框/头像选择/头像预览")]
    require((avatar_node["_contentSize"]["width"], avatar_node["_contentSize"]["height"]) ==
            (174, 174), "动态头像没有铺满确认稿圆环内沿")
    ring_node = p.data[p.node("注册弹窗/注册资料框/头像选择/V7头像圆环")]
    require((ring_node["_contentSize"]["width"], ring_node["_contentSize"]["height"]) ==
            (180, 180), "头像圆环不是确认稿对应的 180×180")
    sprite_is(p, "注册弹窗/注册资料框/头像选择/V7头像提示美术",
              "register_avatar_prompt_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/防盗号", "register_anti_theft_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/确认注册", "register_submit_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册状态图标",
              "register_status_icon_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册动态状态底",
              "register_status_clean_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/V7注册安全提示美术",
              "register_safety_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/防盗号/防盗号开关/Background",
              "register_toggle_off_exact.png")
    sprite_is(p, "注册弹窗/注册资料框/防盗号/防盗号开关/checkmark",
              "register_toggle_on_exact.png")
    dialog_children = [ref["__id__"] for ref in
                       p.data[p.node("注册弹窗/注册资料框")]["_children"]]
    status_bg_id = p.node("注册弹窗/注册资料框/V7注册动态状态底")
    status_id = p.node("注册弹窗/注册资料框/注册状态")
    status_icon_id = p.node("注册弹窗/注册资料框/V7注册状态图标")
    require(dialog_children.index(status_bg_id) < dialog_children.index(status_id) <
            dialog_children.index(status_icon_id),
            "动态状态蓝底覆盖了防盗号切换后的提示文字")
    status_bg = p.data[status_bg_id]
    submit = p.data[p.node("注册弹窗/注册资料框/确认注册")]
    status_bg_bottom = status_bg["_trs"]["array"][1] - status_bg["_contentSize"]["height"] / 2
    submit_top = submit["_trs"]["array"][1] + submit["_contentSize"]["height"] / 2
    require(status_bg_bottom > submit_top,
            "动态状态清底与确认注册按钮上边框重叠")

    rows = (
        ("邀请码", "register_row_invite_exact.png"),
        ("昵称", "register_row_nickname_exact.png"),
        ("账号", "register_row_account_exact.png"),
        ("密码", "register_row_password_exact.png"),
        ("确认密码", "register_row_confirm_exact.png"),
    )
    for name, asset in rows:
        path = f"注册弹窗/注册资料框/{name}"
        sprite_is(p, path, asset)
        _, row_sprite = p.component(p.node(path), "cc.Sprite")
        require(row_sprite is not None and row_sprite.get("_enabled") is False,
                f"{name} 默认态没有使用确认稿内置美术")
        require(p.data[p.node(path + "/字段名称")].get("_active") is False,
                f"{name} 旧字段标题仍显示")
        require(p.data[p.node(path + "/分割线")].get("_active") is False,
                f"{name} 旧分隔线仍显示")
        for child in ("TEXT_LABEL", "PLACEHOLDER_LABEL"):
            _, label = p.component(p.node(path + "/输入/" + child), "cc.Label")
            label_node = p.data[p.node(path + "/输入/" + child)]
            require(label.get("_fontSize") == 22 and label.get("_N$horizontalAlign") == 0,
                    f"{name}/{child} 字号或左对齐不正确")
            require(tuple(label_node["_trs"]["array"][:2]) == (-155, 33),
                    f"{name}/{child} 没有按 EditBox 左上角锚点定位")
        edit = editbox_component(p, p.node(path + "/输入"))
        placeholder_node = p.data[p.node(path + "/输入/PLACEHOLDER_LABEL")]
        _, placeholder_label = p.component(
            p.node(path + "/输入/PLACEHOLDER_LABEL"), "cc.Label"
        )
        require(edit is not None and edit.get("_N$placeholder") == "" and
                placeholder_node.get("_active") is False and
                placeholder_label.get("_enabled") is False,
                f"{name} 仍会把原生占位文字叠到确认稿美术上")

    for arrow, asset in (("上一头像", "register_arrow_left_exact.png"),
                         ("下一头像", "register_arrow_right_exact.png")):
        arrow_path = "注册弹窗/注册资料框/头像选择/" + arrow
        require(p.data[p.node(arrow_path)].get("_active") is True,
                f"{arrow} 未显示")
        sprite_is(p, arrow_path + "/V7头像箭头美术", asset)
    source = (ROOT / "assets/scripts/UI/panelLogin.ts").read_text(encoding="utf-8")
    for token in ('button.node.name === "上一头像"', 'button.node.name === "下一头像"'):
        require(token in source, f"头像箭头缺少实际交互: {token}")
    for token in ('editing-did-began', 'editing-did-ended',
                  'refreshRegisterInputArt(key)', 'useApprovedDefault'):
        require(token in source, f"注册动态层缺少逻辑: {token}")

    widget_is(p, "注册弹窗/头像选择弹窗", 45)
    widget_is(p, "注册弹窗/头像选择弹窗/头像弹窗遮罩", 45)
    widget_is(p, "注册弹窗/头像选择弹窗/头像选择框", 18)
    sprite_is(p, "注册弹窗/头像选择弹窗/头像选择框",
              "register_avatar_picker_panel_exact.png")
    sprite_is(
        p,
        "注册弹窗/头像选择弹窗/头像选择框/V7关闭头像选择显示",
        "register_close_exact.png",
    )
    sprite_is(p, "注册弹窗/头像选择弹窗/头像选择框/V7换一批头像底板",
              "register_avatar_refresh_exact.png")
    _, refresh_label = p.component(
        p.node("注册弹窗/头像选择弹窗/头像选择框/V7换一批头像文字"),
        "cc.Label",
    )
    require(refresh_label is not None and refresh_label.get("_enabled") is True,
            "头像刷新按钮文字未显示")
    for index in range(1, 21):
        sprite_is(
            p,
            f"注册弹窗/头像选择弹窗/头像选择框/头像列表/头像选项{index:02d}/V7头像选中环",
            "register_avatar_item_ring_exact.png",
        )

    print("V7 快速注册校验通过：确认稿整图底、固定居中构图、动态输入层和头像交互均正常。")


if __name__ == "__main__":
    main()
