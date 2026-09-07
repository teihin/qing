#!/usr/bin/env python3
"""Read-only validation for the final approved V7 main login art."""

from __future__ import annotations

import json
from pathlib import Path

from apply_v7_prefab_skin import Prefab, frame_uuid


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = (
    ROOT
    / "design-previews/2026-09-04-V7确认风格六页统一版"
    / "01-登录.png"
)
V7 = ROOT / "assets/resources/V7"


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def sprite(p: Prefab, path: str, asset: str) -> None:
    _, comp = p.component(p.node(path), "cc.Sprite")
    require(comp is not None, f"{path} 缺少 Sprite")
    require(
        comp.get("_spriteFrame", {}).get("__uuid__") == frame_uuid(asset),
        f"{path} 未引用最终登录切图 {asset}",
    )


def main() -> None:
    require(REFERENCE.exists(), "最终 V7 登录确认稿不存在")
    for asset in (
        "login_input_account_exact.png",
        "login_input_password_exact.png",
        "login_hint_account_exact.png",
        "login_hint_password_exact.png",
        "login_link_reset_exact.png",
        "login_link_register_exact.png",
        "login_button_exact.png",
    ):
        path = V7 / asset
        require(path.exists(), f"缺少登录正式切图：{asset}")
        meta = json.loads((V7 / f"{asset}.meta").read_text(encoding="utf-8"))
        require(meta.get("packable") is False, f"登录高清切图不应动态打包：{asset}")

    p = Prefab("assets/resources/UI/panelLogin.prefab")
    sprite(p, "手机号/BACKGROUND_SPRITE", "login_input_account_exact.png")
    sprite(p, "密码/BACKGROUND_SPRITE", "login_input_password_exact.png")
    sprite(p, "手机号/V7账号占位美术字", "login_hint_account_exact.png")
    sprite(p, "密码/V7密码占位美术字", "login_hint_password_exact.png")
    sprite(p, "忘记密码", "login_link_reset_exact.png")
    sprite(p, "注册账号", "login_link_register_exact.png")
    sprite(p, "登陆", "login_button_exact.png")

    for path, size in (
        ("手机号", (527, 112)),
        ("密码", (527, 112)),
        ("登陆", (527, 100)),
    ):
        node = p.data[p.node(path)]
        actual = (node["_contentSize"]["width"], node["_contentSize"]["height"])
        require(actual == size, f"{path} 尺寸错误：{actual} != {size}")

    for path in ("手机号", "密码"):
        _, placeholder = p.component(p.node(f"{path}/PLACEHOLDER_LABEL"), "cc.Label")
        _, text = p.component(p.node(f"{path}/TEXT_LABEL"), "cc.Label")
        require(placeholder.get("_string") == "", f"{path} 仍叠加系统占位文字")
        require(text.get("_fontSize") == 29, f"{path} 动态输入字号不正确")
        clear_name = "清除用户" if path == "手机号" else "清除密码"
        clear_icon = p.data[p.node(f"{path}/{clear_name}/CHACHA")]
        require(clear_icon.get("_active") is False, f"{path} 仍显示确认稿没有的清除叉号")

    source = (ROOT / "tools/extract_v7_login_exact_assets.py").read_text(encoding="utf-8")
    require("2026-09-04-V7确认风格六页统一版" in source, "登录切图工具引用了错误效果图目录")
    require("01-登录.png" in source, "登录切图工具没有锁定最终登录确认稿")
    print("V7 登录页校验通过：最终确认稿、直接切图、Prefab 尺寸和动态输入层均正确。")


if __name__ == "__main__":
    main()
