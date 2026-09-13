#!/usr/bin/env python3
"""Skin the second personal-information page with reusable UI parts.

The page keeps its existing avatar, EditBox and button node names so the
panelMain business code remains unchanged.  Only the visual chrome and the
fixed layout are serialized here; the page background stays the shared plain
casino background already used by the announcement/detail pages.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from apply_v7_followup_main_exact import BASE_H, fixed_top, full_screen
from apply_v7_lobby_exact import style_label, untint
from apply_v7_prefab_skin import Prefab, frame_uuid
from apply_v7_wallet_exact import center_anchor, transparent
from repair_v7_responsive_layout import ensure_widget


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets/resources/V7"
HEADER = "personal_info2_header_bg_v8.png"
BUTTON = "personal_info2_confirm_button_v8.png"
ARROW = "personal_info2_back_arrow_v8.png"
TITLE = "personal_info2_title_v8.png"
GOLD = {"__type__": "cc.Color", "r": 235, "g": 207, "b": 159, "a": 255}
WHITE = {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255}


def make_header_asset() -> None:
    """Create a text-free reusable header from the approved V8 header art."""
    from PIL import Image, ImageDraw

    source = Image.open(ASSET_DIR / "followup_password_login_v8_full_exact.png").convert("RGB")
    # The first 90 pixels are the common navy/gold header.  Remove only the
    # page-specific title; keep the left arrow, diagonal ornament and gold rule.
    header = source.crop((0, 0, 941, 91))
    # Interpolate each row between clean pixels on either side of the title.
    # This keeps the existing horizontal lighting continuous and avoids a
    # visible rectangular patch behind the live title label.
    px = header.load()
    for y in range(4, 84):
        left = px[103, y]
        right = px[483, y]
        span = max(1, 480 - 108)
        for x in range(108, 480):
            t = (x - 108) / span
            px[x, y] = tuple(int(left[c] * (1 - t) + right[c] * t) for c in range(3))
        left = px[12, y]
        right = px[104, y]
        span = max(1, 96 - 18)
        for x in range(18, 96):
            t = (x - 18) / span
            px[x, y] = tuple(int(left[c] * (1 - t) + right[c] * t) for c in range(3))
    header = header.resize((750, 100), Image.Resampling.LANCZOS)
    header.save(ASSET_DIR / HEADER, optimize=True)
    # Creator 2.4 texture metadata is kept explicit so the formal SpriteFrame
    # can be resolved without a runtime-generated asset.
    import uuid
    raw_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8/personal_info2_header_bg_v8/raw"))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8/personal_info2_header_bg_v8/frame"))
    meta = {
        "ver": "2.3.7", "uuid": raw_uuid, "importer": "texture",
        "type": "sprite", "wrapMode": "clamp", "filterMode": "bilinear",
        "premultiplyAlpha": False, "genMipmaps": False, "packable": True,
        "width": 750, "height": 100, "platformSettings": {},
        "subMetas": {Path(HEADER).stem: {
            "ver": "1.0.6", "uuid": frame, "importer": "sprite-frame",
            "rawTextureUuid": raw_uuid, "trimType": "none",
            "trimThreshold": 1, "rotated": False, "offsetX": 0,
            "offsetY": 0, "trimX": 0, "trimY": 0, "width": 750,
            "height": 100, "rawWidth": 750, "rawHeight": 100,
            "borderTop": 0, "borderBottom": 0, "borderLeft": 0,
            "borderRight": 0, "subMetas": {},
        }},
    }
    (ASSET_DIR / f"{HEADER}.meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_sprite_meta(name: str, width: int, height: int, seed: str) -> None:
    import uuid
    raw_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qing/v8/{seed}/raw"))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qing/v8/{seed}/frame"))
    meta = {
        "ver": "2.3.7", "uuid": raw_uuid, "importer": "texture",
        "type": "sprite", "wrapMode": "clamp", "filterMode": "bilinear",
        "premultiplyAlpha": False, "genMipmaps": False, "packable": True,
        "width": width, "height": height, "platformSettings": {},
        "subMetas": {Path(name).stem: {
            "ver": "1.0.6", "uuid": frame, "importer": "sprite-frame",
            "rawTextureUuid": raw_uuid, "trimType": "none",
            "trimThreshold": 1, "rotated": False, "offsetX": 0,
            "offsetY": 0, "trimX": 0, "trimY": 0, "width": width,
            "height": height, "rawWidth": width, "rawHeight": height,
            "borderTop": 0, "borderBottom": 0, "borderLeft": 0,
            "borderRight": 0, "subMetas": {},
        }},
    }
    (ASSET_DIR / f"{name}.meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_arrow_asset() -> None:
    from PIL import Image

    source = Image.open(ASSET_DIR / "followup_password_login_v8_full_exact.png").convert("RGBA")
    crop = source.crop((28, 12, 100, 84))
    px = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            r, g, b, _ = px[x, y]
            # Keep the gold arrow/glow while making the navy header transparent.
            strength = max(0, min(255, int((r - b - 10) * 4)))
            px[x, y] = (r, g, b, strength)
    crop.save(ASSET_DIR / ARROW, optimize=True)
    write_sprite_meta(ARROW, crop.width, crop.height, "personal_info2_back_arrow")


def make_title_asset() -> None:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGBA", (330, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("/System/Library/Fonts/STHeiti Medium.ttc", 42, index=0)
    text = "修改个人信息"
    box = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    x = (image.width - (box[2] - box[0])) // 2
    y = (image.height - (box[3] - box[1])) // 2 - 5
    draw.text((x + 1, y + 3), text, font=font, fill=(15, 35, 46, 220),
              stroke_width=2, stroke_fill=(15, 35, 46, 220))
    draw.text((x, y), text, font=font, fill=(241, 207, 150, 255),
              stroke_width=1, stroke_fill=(255, 231, 182, 255))
    image.save(ASSET_DIR / TITLE, optimize=True)
    write_sprite_meta(TITLE, image.width, image.height, "personal_info2_title")


def make_button_asset() -> None:
    """Extract the reusable gold confirmation button from the V8 page art."""
    from PIL import Image, ImageDraw
    import uuid

    source = Image.open(ASSET_DIR / "followup_password_login_v8_full_exact.png").convert("RGBA")
    # Exact authored button bounds in the 941px V8 composition.
    crop = source.crop((169, 1185, 775, 1306))
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, crop.width - 1, crop.height - 1), radius=25, fill=255)
    crop.putalpha(mask)
    crop.save(ASSET_DIR / BUTTON, optimize=True)
    raw_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8/personal_info2_confirm_button/raw"))
    frame = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v8/personal_info2_confirm_button/frame"))
    meta = {
        "ver": "2.3.7", "uuid": raw_uuid, "importer": "texture",
        "type": "sprite", "wrapMode": "clamp", "filterMode": "bilinear",
        "premultiplyAlpha": False, "genMipmaps": False, "packable": True,
        "width": crop.width, "height": crop.height, "platformSettings": {},
        "subMetas": {Path(BUTTON).stem: {
            "ver": "1.0.6", "uuid": frame, "importer": "sprite-frame",
            "rawTextureUuid": raw_uuid, "trimType": "none",
            "trimThreshold": 1, "rotated": False, "offsetX": 0,
            "offsetY": 0, "trimX": 0, "trimY": 0, "width": crop.width,
            "height": crop.height, "rawWidth": crop.width,
            "rawHeight": crop.height, "borderTop": 0, "borderBottom": 0,
            "borderLeft": 0, "borderRight": 0, "subMetas": {},
        }},
    }
    (ASSET_DIR / f"{BUTTON}.meta").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply() -> None:
    make_header_asset()
    make_button_asset()
    make_arrow_asset()
    make_title_asset()
    p = Prefab("assets/resources/UI/panelMain.prefab")
    root = p.node("修改个人信息2")
    p.set_active(root, False)  # opened by existing panelMain flow
    full_screen(p, root)

    # Keep the existing shared detail background; it is a reusable, clean
    # 750x1334 scene layer rather than a page screenshot.
    bg_id, bg = p.component(root, "cc.Sprite")
    if bg is None:
        raise RuntimeError("修改个人信息2 缺少背景 Sprite")
    bg["_enabled"] = True
    bg["_spriteFrame"] = {"__uuid__": frame_uuid("announcement_detail_plain_bg_v8.png")}
    bg["_type"] = 0

    title = p.node("修改个人信息2/title")
    p.set_active(title, True)
    p.art(title, HEADER, 0, 0, 750, 100, hide=False)
    untint(p, title)
    fixed_top(p, title, 0, 750, 100)
    # The legacy title Sprite contains page-specific artwork.  Keep its node
    # for prefab compatibility, but replace it with a live Label below.
    old_title = p.node("修改个人信息2/title/title")
    p.set_active(old_title, False)
    try:
        live = p.node("修改个人信息2/title/V8个人信息标题")
    except KeyError:
        live = p.clone_subtree(p.node("修改个人信息2/头像收费提示"), title,
                               "V8个人信息标题")
    p.set_active(live, True)
    p.art(live, TITLE, 0, 0, 330, 64, hide=False)
    untint(p, live)
    _, live_label = p.component(live, "cc.Label")
    if live_label is not None:
        live_label["_enabled"] = False
    _, live_outline = p.component(live, "cc.LabelOutline")
    if live_outline is not None:
        live_outline["_enabled"] = False
    center_anchor(p, live)
    p.set_pos(live, 48, 0, 330, 64, disable_widget=True)
    style_label(p, "修改个人信息2/title/V8个人信息标题", x=48, y=0,
                width=330, height=64, size=34, preview="修改个人信息", align=0)
    p.data[live]["_color"] = copy.deepcopy(GOLD)
    _, label = p.component(live, "cc.Label")
    if label is not None:
        label["_enableWrapText"] = False

    close = p.node("修改个人信息2/title/关闭上上层")
    p.set_active(close, True)
    transparent(p, close, 100, 84, hide_children=False)
    center_anchor(p, close)
    p.set_pos(close, -325, 0, 100, 84, disable_widget=True)
    arrow = p.node("修改个人信息2/title/关闭上上层/关闭")
    p.set_active(arrow, True)
    p.art(arrow, ARROW, 0, 0, 72, 72)
    untint(p, arrow)
    center_anchor(p, arrow)
    p.set_pos(arrow, 0, 0, 72, 72, disable_widget=True)

    avatar = p.node("修改个人信息2/头像")
    p.set_active(avatar, True)
    fixed_top(p, avatar, 126, 182, 182)
    choose = p.node("修改个人信息2/选择头像")
    p.set_active(choose, True)
    p.art(choose, "register_avatar_prompt_exact.png", 0, 0, 190, 40,
           hide=True)
    untint(p, choose)
    fixed_top(p, choose, 462, 190, 40)
    change = p.node("修改个人信息2/换一批头像")
    p.set_active(change, True)
    p.art(change, "register_avatar_refresh_exact.png", 0, 0, 220, 58)
    untint(p, change)
    fixed_top(p, change, 453, 220, 58, x=160)
    label = p.node("修改个人信息2/换一批头像/New Label")
    style_label(p, "修改个人信息2/换一批头像/New Label", x=0, y=0,
                width=220, height=42, size=24, preview="换一批头像", align=1)

    # Reuse the standard blue input panel and keep the real EditBox and clear
    # button live on top of it.
    backing = p.node("修改个人信息2/垫底长")
    p.set_active(backing, True)
    p.art(backing, "ingame_buyin_amount_box_exact.png", 0, 0, 586, 100,
           sliced=True)
    untint(p, backing)
    fixed_top(p, backing, 332, 586, 100, x=32.861)

    # The dynamic avatar slots live above a formal, reusable picker panel.
    # Keeping this panel in the Prefab prevents the runtime selector from
    # manufacturing a screenshot-like background or stretching a button.
    try:
        picker = p.node("修改个人信息2/头像选择面板")
    except KeyError:
        picker = p.clone_subtree(backing, root, "头像选择面板")
    p.set_active(picker, True)
    p.art(picker, "register_avatar_picker_panel_exact.png", 0, 0, 650, 760)
    untint(p, picker)
    # Keep the picker frame below the nickname row.  The dynamic list keeps
    # its own -90 local position, so the refresh/title buttons remain visible
    # in the gap between the nickname row and the frame.
    fixed_top(p, picker, 527, 650, 760)
    nickname = p.node("修改个人信息2/昵称")
    p.set_active(nickname, True)
    fixed_top(p, nickname, 346, 520, 72, x=32.861)
    _, row_sprite = p.component(nickname, "cc.Sprite")
    if row_sprite is not None:
        row_sprite["_enabled"] = False
    bg_node = p.node("修改个人信息2/昵称/BACKGROUND_SPRITE")
    p.set_active(bg_node, False)
    edit_label = p.node("修改个人信息2/昵称/TEXT_LABEL")
    placeholder = p.node("修改个人信息2/昵称/PLACEHOLDER_LABEL")
    for node, text in ((edit_label, None), (placeholder, "请输入昵称")):
        p.set_active(node, True)
        center_anchor(p, node)
        p.set_pos(node, 0, 0, 430, 58, disable_widget=True)
        style_label(p, f"修改个人信息2/昵称/{p.data[node]['_name']}",
                    x=0, y=0, width=430, height=58, size=24,
                    preview=text, align=0)
        p.data[node]["_color"] = copy.deepcopy(
            GOLD if text is None else {"__type__": "cc.Color", "r": 177,
                                       "g": 196, "b": 213, "a": 255})

    hint = p.node("修改个人信息2/头像收费提示")
    p.set_active(hint, True)
    fixed_top(p, hint, 997, 520, 40)
    style_label(p, "修改个人信息2/头像收费提示", x=0, y=0,
                width=520, height=40, size=20,
                preview="更换头像每次收取10元", align=1)
    p.data[hint]["_color"] = copy.deepcopy(GOLD)

    ok = p.node("修改个人信息2/修改个人信息2")
    p.set_active(ok, True)
    p.art(ok, BUTTON, 0, 0, 380, 76, hide=True)
    untint(p, ok)
    fixed_top(p, ok, 1039, 380, 76, x=-2.187)

    # Stable draw order: shared background, title, avatar controls, input,
    # hint, and the live button hit area at the front.
    ordered = [root, title, avatar, choose, change, picker, backing, nickname, hint, ok]
    children = p.data[root].setdefault("_children", [])
    ids = {i for i in ordered[1:]}
    children[:] = [ref for ref in children if ref["__id__"] not in ids]
    children[:] = [{"__id__": i} for i in ordered[1:]] + children
    p.save()


if __name__ == "__main__":
    apply()
    print("修改个人信息2 已完成组件化换皮")
