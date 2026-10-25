#!/usr/bin/env python3
"""Apply the club-branch quick-registration layout without an invitation row."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image

from apply_v7_prefab_skin import Prefab


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets/V7"
SOURCE = ASSET_DIR / "register_modal_panel_exact.png"
CLUB_BACKGROUND = ASSET_DIR / "register_modal_panel_club_exact.png"
PREFAB = ROOT / "assets/resources/UI/panelLogin.prefab"
SOURCE_W, SOURCE_H = 734, 1304
LOGICAL_W, LOGICAL_H = 583, 1035
SCALE = SOURCE_W / LOGICAL_W


def write_texture_meta(path: Path, texture_uuid: str, sprite_uuid: str) -> None:
    meta = {
        "ver": "2.3.7",
        "uuid": texture_uuid,
        "importer": "texture",
        "type": "sprite",
        "wrapMode": "clamp",
        "filterMode": "bilinear",
        "premultiplyAlpha": False,
        "genMipmaps": False,
        "packable": False,
        "width": SOURCE_W,
        "height": SOURCE_H,
        "platformSettings": {},
        "subMetas": {
            path.stem: {
                "ver": "1.0.6",
                "uuid": sprite_uuid,
                "importer": "sprite-frame",
                "rawTextureUuid": texture_uuid,
                "trimType": "none",
                "trimThreshold": 1,
                "rotated": False,
                "offsetX": 0,
                "offsetY": 0,
                "trimX": 0,
                "trimY": 0,
                "width": SOURCE_W,
                "height": SOURCE_H,
                "rawWidth": SOURCE_W,
                "rawHeight": SOURCE_H,
                "borderTop": 0,
                "borderBottom": 0,
                "borderLeft": 0,
                "borderRight": 0,
                "subMetas": {},
            }
        },
    }
    path.with_suffix(path.suffix + ".meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def source_center_y(logical_y: float) -> float:
    return SOURCE_H / 2 - logical_y * SCALE


def paste_logical_asset(canvas: Image.Image, name: str, logical_x: float,
                        logical_y: float, logical_w: float, logical_h: float) -> None:
    asset = Image.open(ASSET_DIR / name).convert("RGBA")
    size = (round(logical_w * SCALE), round(logical_h * SCALE))
    asset = asset.resize(size, Image.Resampling.LANCZOS)
    left = round(SOURCE_W / 2 + logical_x * SCALE - size[0] / 2)
    top = round(source_center_y(logical_y) - size[1] / 2)
    canvas.alpha_composite(asset, (left, top))


def build_club_background() -> None:
    base = Image.open(SOURCE).convert("RGBA")
    canvas = base.copy()

    # Keep the approved outer frame and the avatar/header section. The clean
    # blue strip is taken from the same approved artwork, away from text and
    # icons, and fills the old five-row area before the new four-row stack is
    # composited below.
    clean_strip = base.crop((45, 400, 155, 480)).resize(
        (687, 790), Image.Resampling.BICUBIC
    )
    canvas.alpha_composite(clean_strip, (24, 486))

    paste_logical_asset(canvas, "register_row_nickname_exact.png", 0, 98, 540, 70)
    paste_logical_asset(canvas, "register_row_account_exact.png", 0, 21, 540, 70)
    paste_logical_asset(canvas, "register_row_password_exact.png", 0, -56, 540, 70)
    paste_logical_asset(canvas, "register_row_confirm_exact.png", 0, -133, 540, 70.5)
    paste_logical_asset(canvas, "register_anti_theft_exact.png", 0, -210, 540, 74)
    paste_logical_asset(canvas, "register_submit_exact.png", 0, -339, 540, 78)
    paste_logical_asset(canvas, "register_safety_exact.png", 0, -407, 422, 48)

    canvas.save(CLUB_BACKGROUND)
    texture_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing://assets/V7/register_modal_panel_club_exact.png"))
    sprite_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing://assets/V7/register_modal_panel_club_exact.png#sprite"))
    write_texture_meta(CLUB_BACKGROUND, texture_uuid, sprite_uuid)


def disable_sprite(prefab: Prefab, node_id: int) -> None:
    _, sprite = prefab.component(node_id, "cc.Sprite")
    if sprite is not None:
        sprite["_enabled"] = False


def local_frame_uuid(name: str) -> str:
    meta = json.loads((ASSET_DIR / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][Path(name).stem]["uuid"]


def set_sprite(prefab: Prefab, node_id: int, asset: str, sliced: bool = False) -> None:
    _, sprite = prefab.ensure_sprite(node_id)
    sprite["_enabled"] = True
    sprite["_spriteFrame"] = {"__uuid__": local_frame_uuid(asset)}
    sprite["_type"] = 1 if sliced else 0
    sprite["_sizeMode"] = 0
    sprite["_isTrimmedMode"] = False


def art(prefab: Prefab, node_id: int, asset: str, x: float, y: float,
        width: float, height: float, sliced: bool = False) -> None:
    prefab.set_pos(node_id, x, y, width, height)
    set_sprite(prefab, node_id, asset, sliced)


def apply_prefab() -> None:
    p = Prefab(str(PREFAB.relative_to(ROOT)))
    dialog = p.node("注册弹窗/注册资料框")
    set_sprite(p, dialog, "register_modal_panel_club_exact.png")

    invite = p.node("注册弹窗/注册资料框/邀请码")
    p.set_active(invite, False)

    avatar = p.node("注册弹窗/注册资料框/头像选择/头像预览")
    p.set_pos(avatar, 0, 0, 180, 180, disable_widget=True)
    ring = p.node("注册弹窗/注册资料框/头像选择/V7头像圆环")
    p.set_pos(ring, 0, 0, 180, 180, disable_widget=True)

    row_specs = (
        ("昵称", "register_row_nickname_exact.png", 98, 70),
        ("账号", "register_row_account_exact.png", 21, 70),
        ("密码", "register_row_password_exact.png", -56, 70),
        ("确认密码", "register_row_confirm_exact.png", -133, 70.5),
    )
    for name, asset, y, height in row_specs:
        row = p.node("注册弹窗/注册资料框/" + name)
        art(p, row, asset, 0, y, 540, height)
        disable_sprite(p, row)

    anti = p.node("注册弹窗/注册资料框/防盗号")
    art(p, anti, "register_anti_theft_exact.png", 0, -210, 540, 74)
    disable_sprite(p, anti)

    status_bg = p.node("注册弹窗/注册资料框/V7注册动态状态底")
    art(p, status_bg, "register_status_clean_exact.png", 0, -275, 447, 42)
    p.set_active(status_bg, True)
    status = p.node("注册弹窗/注册资料框/注册状态")
    p.set_pos(status, 22, -278, 410, 32, disable_widget=True)
    p.set_active(status, True)
    status_icon = p.node("注册弹窗/注册资料框/V7注册状态图标")
    art(p, status_icon, "register_status_icon_exact.png", -122, -278, 38, 40)
    p.set_active(status_icon, True)

    submit = p.node("注册弹窗/注册资料框/确认注册")
    art(p, submit, "register_submit_exact.png", 0, -339, 540, 78)
    p.set_active(submit, True)

    safety = p.node("注册弹窗/注册资料框/V7注册安全提示美术")
    art(p, safety, "register_safety_exact.png", 0, -407, 422, 48)
    p.set_active(safety, False)

    p.save()


if __name__ == "__main__":
    build_club_background()
    apply_prefab()
    print("已把俱乐部模式快速注册改为无邀请码四行布局。")
