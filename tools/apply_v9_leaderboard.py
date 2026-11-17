#!/usr/bin/env python3
"""Apply the approved V9 leaderboard visual treatment to formal Prefabs.

This is an editor-time asset/Prefab migration. It keeps the existing board
names, dynamic row contract, infinite scroll and server data bindings intact.
"""

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

from apply_v7_prefab_skin import Prefab, MATERIAL_UUID, ROOT


ASSET_DIR = ROOT / "assets/V7"
AVATAR_DIR = ROOT / "assets/resources/avatars"
PAGE = "assets/resources/Prefabs/排行榜.prefab"
ROW = "assets/resources/Prefabs/排行榜对象.prefab"
AVATAR_PREFAB = ROOT / "assets/resources/Prefabs/头像.prefab"
OUT = ROOT / "art_sources/v8-repairs/leaderboard"
REFERENCE_TABS_SOURCE = OUT / "reference-tabs-v1.png"
FILTER_IMAGEGEN_SOURCE_DIR = OUT / "filter-imagegen-text-v2"
ROW_ASSET = "leaderboard_v9_row.png"
TABLE_ASSET = "leaderboard_v9_table.png"
AVATAR_RING_ASSET = "leaderboard_v9_avatar_ring.png"
# The current game branding is BF. Reuse the existing formal BF shield so the
# leaderboard cannot continue displaying the old BL/8L concept mark.
SHIELD_ASSET = "leaderboard_v8_shield.png"
BOARD_TAB_ASSETS = {
    "玩家手数榜": ("leaderboard_v9_tab_hands_off.png", "leaderboard_v9_tab_hands_on.png"),
    "玩家赢分榜": ("leaderboard_v9_tab_win_off.png", "leaderboard_v9_tab_win_on.png"),
    "代理红利榜": ("leaderboard_v9_tab_agent_off.png", "leaderboard_v9_tab_agent_on.png"),
}
FILTER_OFF_ASSET = "leaderboard_v9_filter_off.png"
FILTER_ON_ASSET = "leaderboard_v9_filter_on.png"
FILTER_TAB_ASSETS = {
    "1皮": ("leaderboard_v9_filter_1_off.png", "leaderboard_v9_filter_1_on.png"),
    "2皮": ("leaderboard_v9_filter_2_off.png", "leaderboard_v9_filter_2_on.png"),
    "5皮": ("leaderboard_v9_filter_5_off.png", "leaderboard_v9_filter_5_on.png"),
    "10皮": ("leaderboard_v9_filter_10_off.png", "leaderboard_v9_filter_10_on.png"),
    "20皮": ("leaderboard_v9_filter_20_off.png", "leaderboard_v9_filter_20_on.png"),
}


def meta_for(name: str, width: int, height: int, borders=(0, 0, 0, 0)) -> None:
    """Create a stable Cocos sprite-frame meta beside a generated PNG."""
    png = ASSET_DIR / name
    meta_path = png.with_suffix(png.suffix + ".meta")
    old = json.loads((ASSET_DIR / "leaderboard_v8_list.png.meta").read_text())
    texture_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v9-leaderboard/texture/" + name))
    frame_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, "qing/v9-leaderboard/frame/" + name))
    frame = copy.deepcopy(next(iter(old["subMetas"].values())))
    frame.update(
        uuid=frame_uuid,
        rawTextureUuid=texture_uuid,
        width=width,
        height=height,
        rawWidth=width,
        rawHeight=height,
        trimType="none",
        trimX=0,
        trimY=0,
        offsetX=0,
        offsetY=0,
        borderTop=borders[0],
        borderBottom=borders[1],
        borderLeft=borders[2],
        borderRight=borders[3],
        subMetas={},
    )
    meta = copy.deepcopy(old)
    meta.update(
        uuid=texture_uuid,
        width=width,
        height=height,
        packable=False,
        premultiplyAlpha=False,
        filterMode="bilinear",
        subMetas={png.stem: frame},
    )
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")


def frame_uuid_at(path: Path) -> str:
    meta = json.loads(path.with_suffix(path.suffix + ".meta").read_text(encoding="utf-8"))
    return meta["subMetas"][path.stem]["uuid"]


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (2, 2, size[0] - 3, size[1] - 3), radius=radius, fill=255
    )
    return mask


def generate_row() -> None:
    """Create an opaque-looking glass row with transparent rounded corners."""
    width, height = 705, 96
    scale = 4
    size = (width * scale, height * scale)
    mask = rounded_mask(size, 18 * scale)

    # Deep blue glass gradient, brighter along the top edge and center.
    grad = Image.new("RGBA", size)
    pixels = grad.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        for x in range(size[0]):
            edge = min(x, size[0] - 1 - x) / max(1, size[0] / 2)
            lift = max(0.0, 1.0 - abs(t - 0.28) * 2.2)
            pixels[x, y] = (
                int(8 + 9 * lift + 5 * edge),
                int(35 + 30 * lift + 14 * edge),
                int(75 + 57 * lift + 30 * edge),
                255,
            )
    grad.putalpha(mask)

    # Cyan bloom behind the rim creates the stronger depth seen in the
    # approved concept without affecting the live data labels.
    rim = mask.filter(ImageFilter.MaxFilter(17))
    glow = Image.new("RGBA", size, (8, 164, 255, 0))
    glow.putalpha(rim.filter(ImageFilter.GaussianBlur(13)))
    glow_alpha = glow.getchannel("A").point(lambda a: int(a * 0.62))
    glow.putalpha(glow_alpha)

    edge = Image.new("RGBA", size, (44, 194, 255, 0))
    inner = mask.filter(ImageFilter.MinFilter(17))
    edge_mask = ImageChops.subtract(mask, inner)
    edge.putalpha(edge_mask)

    top = Image.new("RGBA", size, (190, 239, 255, 0))
    top_mask = Image.new("L", size, 0)
    ImageDraw.Draw(top_mask).rounded_rectangle(
        (9 * scale, 5 * scale, size[0] - 10 * scale, 15 * scale),
        radius=7 * scale,
        fill=105,
    )
    top.putalpha(top_mask.filter(ImageFilter.GaussianBlur(3 * scale)))

    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.alpha_composite(glow)
    out.alpha_composite(grad)
    out.alpha_composite(edge)
    out.alpha_composite(top)
    out.putalpha(ImageChops.multiply(out.getchannel("A"), mask))
    out.resize((width, height), Image.Resampling.LANCZOS).save(ASSET_DIR / ROW_ASSET, optimize=True)
    meta_for(ROW_ASSET, width, height)


def generate_table() -> None:
    """Add a restrained inner bevel to the existing table surface."""
    source = Image.open(ASSET_DIR / "leaderboard_v8_list.png").convert("RGBA")
    width, height = source.size
    alpha = source.getchannel("A")
    overlay = Image.new("RGBA", source.size, (0, 0, 0, 0))
    px = overlay.load()
    for y in range(height):
        t = y / max(1, height - 1)
        for x in range(width):
            center = 1.0 - abs(x / max(1, width - 1) - 0.5) * 1.2
            px[x, y] = (
                16,
                82,
                138,
                int(24 * center + 12 * (1.0 - t)),
            )
    overlay.putalpha(Image.composite(overlay.getchannel("A"), Image.new("L", source.size, 0), alpha))

    rim = Image.new("RGBA", source.size, (132, 229, 255, 0))
    rim_mask = ImageChops.subtract(alpha, alpha.filter(ImageFilter.MinFilter(9)))
    rim_mask = Image.eval(rim_mask, lambda a: int(a * 0.72))
    rim.putalpha(rim_mask.filter(ImageFilter.GaussianBlur(2)))

    out = Image.alpha_composite(source, overlay)
    out = Image.alpha_composite(out, rim)
    out.save(ASSET_DIR / TABLE_ASSET, optimize=True)
    meta_for(TABLE_ASSET, width, height, borders=(27, 27, 27, 27))


def generate_tab_surface(name: str, width: int, height: int, selected: bool, text: str | None = None) -> None:
    """Generate the deep-blue/gold tab surfaces used by the approved layout."""
    scale = 4
    size = (width * scale, height * scale)
    mask = rounded_mask(size, 16 * scale)
    top_color, bottom_color = ((255, 253, 214), (224, 157, 18)) if selected else ((28, 145, 229), (5, 48, 112))
    border_color = (255, 249, 205) if selected else (113, 235, 255)

    gradient = Image.new("RGBA", size)
    pixels = gradient.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        lift = max(0.0, 1.0 - abs(t - 0.18) * 2.1)
        color = tuple(int(top_color[i] * (1 - t) + bottom_color[i] * t + (16 if i == 2 else 0) * lift) for i in range(3))
        for x in range(size[0]):
            pixels[x, y] = (*color, 255)
    gradient.putalpha(mask)

    glow = Image.new("RGBA", size, (255, 215, 75, 0) if selected else (0, 157, 255, 0))
    glow.putalpha(mask.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(9)).point(lambda a: int(a * (0.75 if selected else 0.58))))
    rim = Image.new("RGBA", size, (*border_color, 0))
    inner = mask.filter(ImageFilter.MinFilter(13))
    rim.putalpha(ImageChops.subtract(mask, inner))
    highlight = Image.new("RGBA", size, (255, 255, 255, 0))
    highlight_mask = Image.new("L", size, 0)
    ImageDraw.Draw(highlight_mask).rounded_rectangle((8 * scale, 4 * scale, size[0] - 9 * scale, 12 * scale), radius=5 * scale, fill=105)
    highlight.putalpha(highlight_mask.filter(ImageFilter.GaussianBlur(2 * scale)))

    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.alpha_composite(glow)
    out.alpha_composite(gradient)
    out.alpha_composite(rim)
    out.alpha_composite(highlight)
    if text:
        font = ImageFont.truetype(str(ROOT / "assets/font/PingFF.ttf"), 27 * scale)
        draw = ImageDraw.Draw(out)
        bbox = draw.textbbox((0, 0), text, font=font, stroke_width=0)
        tx = (size[0] - (bbox[2] - bbox[0])) / 2 - bbox[0]
        ty = (size[1] - (bbox[3] - bbox[1])) / 2 - bbox[1] - 1 * scale
        draw.text((tx + 1 * scale, ty - 2 * scale), text, font=font, fill=(0, 20, 48, 220) if selected else (0, 22, 54, 190))
        draw.text((tx, ty), text, font=font, fill=(24, 16, 8, 255) if selected else (255, 250, 235, 255))
    out.putalpha(ImageChops.multiply(out.getchannel("A"), mask))
    out.resize((width, height), Image.Resampling.LANCZOS).save(ASSET_DIR / name, optimize=True)
    meta_for(name, width, height)


def reference_cut(source: Image.Image, box: tuple[int, int, int, int], size: tuple[int, int], radius: int) -> Image.Image:
    """Cut a finished button from the approved reference and keep its corners transparent."""
    crop = source.crop(box).convert("RGBA")
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (2, 2, crop.width - 3, crop.height - 3), radius=radius, fill=255
    )
    out = Image.new("RGBA", crop.size, (0, 0, 0, 0))
    out.paste(crop, (0, 0), mask)
    return out.resize(size, Image.Resampling.LANCZOS)


def gold_filter_variant(blue: Image.Image, gold: Image.Image) -> Image.Image:
    """Reuse the reference gold surface and replace only its label with a reference glyph mask."""
    base = gold.convert("RGBA").copy()
    width, height = base.size
    pixels = base.load()

    # Remove the reference 10皮 glyph by interpolating the gold surface from
    # the clean left/right bands. This keeps the reference's own light band,
    # border and glow instead of drawing a new gradient.
    left_band = max(6, width // 6)
    right_band = max(6, width // 6)
    for y in range(5, height - 5):
        left = [sum(pixels[x, y][i] for x in range(5, left_band + 5)) // left_band for i in range(3)]
        right_start = width - right_band - 5
        right = [sum(pixels[x, y][i] for x in range(right_start, width - 5)) // right_band for i in range(3)]
        for x in range(left_band + 5, right_start):
            t = (x - (left_band + 5)) / max(1, right_start - (left_band + 5) - 1)
            pixels[x, y] = tuple(int(left[i] * (1 - t) + right[i] * t) for i in range(3)) + (255,)

    # The blue reference label is white with a dark edge. Keep its glyph face
    # shape, then use the black face required by the selected gold reference.
    glyph = Image.new("L", blue.size, 0)
    gp = blue.convert("RGB").load()
    gm = glyph.load()
    for y in range(6, height - 5):
        for x in range(8, width - 8):
            r, g, b = gp[x, y]
            if min(r, g, b) >= 165 and max(r, g, b) - min(r, g, b) <= 105:
                gm[x, y] = min(255, max(0, (r + g + b) // 3 - 120) * 3)
    glyph = glyph.filter(ImageFilter.MaxFilter(3))
    text = Image.new("RGBA", blue.size, (8, 7, 4, 0))
    text.putalpha(glyph)
    base.alpha_composite(text)
    return base


def blue_filter_variant(blue: Image.Image, gold: Image.Image) -> Image.Image:
    """Reuse the reference blue surface and replace its label with 10皮."""
    base = blue.convert("RGBA").copy()
    width, height = base.size
    pixels = base.load()
    left_band = max(6, width // 6)
    right_band = max(6, width // 6)
    for y in range(5, height - 5):
        left = [sum(pixels[x, y][i] for x in range(5, left_band + 5)) // left_band for i in range(3)]
        right_start = width - right_band - 5
        right = [sum(pixels[x, y][i] for x in range(right_start, width - 5)) // right_band for i in range(3)]
        for x in range(left_band + 5, right_start):
            t = (x - (left_band + 5)) / max(1, right_start - (left_band + 5) - 1)
            pixels[x, y] = tuple(int(left[i] * (1 - t) + right[i] * t) for i in range(3)) + (255,)

    glyph = Image.new("L", gold.size, 0)
    gp = gold.convert("RGB").load()
    gm = glyph.load()
    # Detect the black 10皮 glyph as pixels that are much darker than the
    # same-row gold surface on either side. This avoids picking up the broad
    # amber highlight band as text.
    for y in range(7, height - 6):
        for x in range(14, width - 14):
            r, g, b = gp[x, y]
            # The reference black glyph has a much lower luminance than the
            # amber band. Restricting the mask to the glyph's central box
            # avoids turning the gold rim into white text.
            if r < 60 and g < 60 and b < 60:
                gm[x, y] = 255
    glyph = glyph.filter(ImageFilter.MaxFilter(3))
    text = Image.new("RGBA", gold.size, (255, 255, 253, 0))
    text.putalpha(glyph)
    base.alpha_composite(text)
    return base


def generate_reference_tab_assets() -> None:
    """Extract the confirmed tab artwork instead of redrawing it with a system font."""
    if not REFERENCE_TABS_SOURCE.exists():
        raise FileNotFoundError(f"missing approved leaderboard reference: {REFERENCE_TABS_SOURCE}")
    source = Image.open(REFERENCE_TABS_SOURCE).convert("RGBA")
    # The complete reference has three equal panels. Each panel's tab strip
    # starts at these x offsets and y=240; its local coordinates are stable.
    panel_x = [25, 615, 1205]
    tab_y = 240
    board_boxes = {
        "hands": (8, 6, 190, 61),
        "win": (188, 6, 365, 61),
        "agent": (364, 6, 538, 61),
    }
    board_states = {
        "玩家手数榜": (1, 0),
        "玩家赢分榜": (0, 1),
        "代理红利榜": (0, 2),
    }
    for board, (off_panel, on_panel) in board_states.items():
        key = {"玩家手数榜": "hands", "玩家赢分榜": "win", "代理红利榜": "agent"}[board]
        off_name, on_name = BOARD_TAB_ASSETS[board]
        rel = board_boxes[key]
        for panel, name in [(off_panel, off_name), (on_panel, on_name)]:
            box = (panel_x[panel] + rel[0], tab_y + rel[1], panel_x[panel] + rel[2], tab_y + rel[3])
            reference_cut(source, box, (220, 64), 15).save(ASSET_DIR / name, optimize=True)
            meta_for(name, 220, 64)

    # Filter buttons are complete imagegen outputs. Keep the generated
    # Chinese art lettering intact; only the formal copy and Cocos metadata
    # are refreshed here. This prevents the previous low-resolution reference
    # crops and programmatic glyph reconstruction from returning on rerun.
    expected = [asset for pair in FILTER_TAB_ASSETS.values() for asset in pair]
    missing = [asset for asset in expected if not (FILTER_IMAGEGEN_SOURCE_DIR / asset).exists()]
    if missing:
        raise FileNotFoundError(
            "missing imagegen leaderboard filter assets: " + ", ".join(missing)
        )
    for asset in expected:
        image = Image.open(FILTER_IMAGEGEN_SOURCE_DIR / asset).convert("RGBA")
        if image.size != (132, 54):
            raise ValueError(f"leaderboard filter must be 132x54: {asset} -> {image.size}")
        image.save(ASSET_DIR / asset, optimize=True)
        meta_for(asset, 132, 54)


def generate_tab_assets() -> None:
    generate_reference_tab_assets()


def generate_avatar_ring() -> None:
    """Create the gold circular frame used by every live player avatar."""
    width = height = 88
    scale = 4
    size = (width * scale, height * scale)
    out = Image.new("RGBA", size, (0, 0, 0, 0))

    glow_mask = Image.new("L", size, 0)
    ImageDraw.Draw(glow_mask).ellipse(
        (5 * scale, 5 * scale, size[0] - 6 * scale, size[1] - 6 * scale),
        outline=210,
        width=5 * scale,
    )
    glow = Image.new("RGBA", size, (255, 190, 63, 0))
    glow.putalpha(glow_mask.filter(ImageFilter.GaussianBlur(5 * scale)))
    out.alpha_composite(glow)

    ring = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ring)
    draw.ellipse(
        (5 * scale, 5 * scale, size[0] - 6 * scale, size[1] - 6 * scale),
        outline=(255, 221, 123, 255),
        width=3 * scale,
    )
    draw.ellipse(
        (9 * scale, 9 * scale, size[0] - 10 * scale, size[1] - 10 * scale),
        outline=(133, 73, 17, 230),
        width=2 * scale,
    )
    out.alpha_composite(ring)
    out.resize((width, height), Image.Resampling.LANCZOS).save(ASSET_DIR / AVATAR_RING_ASSET, optimize=True)
    meta_for(AVATAR_RING_ASSET, width, height)


def frame_uuid(name: str) -> str:
    return frame_uuid_at(ASSET_DIR / name)


def sprite(p: Prefab, node_id: int, asset: str, sliced=False) -> None:
    _, comp = p.component(node_id, "cc.Sprite")
    if comp is None:
        comp = {
            "__type__": "cc.Sprite",
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": node_id},
            "_enabled": True,
            "_materials": [{"__uuid__": MATERIAL_UUID}],
            "_srcBlendFactor": 770,
            "_dstBlendFactor": 771,
            "_spriteFrame": None,
            "_type": 0,
            "_sizeMode": 0,
            "_fillType": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0,
            "_fillRange": 0,
            "_isTrimmedMode": False,
            "_atlas": None,
            "_id": "",
        }
        cid = len(p.data)
        p.data.append(comp)
        p.data[node_id].setdefault("_components", []).insert(0, {"__id__": cid})
    comp.update(
        _enabled=True,
        _spriteFrame={"__uuid__": frame_uuid(asset)},
        _type=1 if sliced else 0,
        _sizeMode=0,
        _isTrimmedMode=False,
    )


def add_external_subtree(p: Prefab, source_path: Path, source_root: int, parent_id: int, new_name: str) -> int:
    """Copy a small prefab subtree into a formal prefab and remap local IDs."""
    source = json.loads(source_path.read_text(encoding="utf-8"))
    ids = set()

    def collect(node_id: int):
        if node_id in ids:
            return
        ids.add(node_id)
        node = source[node_id]
        for ref in node.get("_components", []):
            ids.add(ref["__id__"])
        if isinstance(node.get("_prefab"), dict):
            ids.add(node["_prefab"]["__id__"])
        for ref in node.get("_children", []):
            collect(ref["__id__"])

    collect(source_root)
    mapping = {old: len(p.data) + offset for offset, old in enumerate(sorted(ids))}

    def remap(value):
        if isinstance(value, dict):
            if set(value.keys()) == {"__id__"} and value["__id__"] in mapping:
                return {"__id__": mapping[value["__id__"]]}
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        return value

    for old in sorted(ids):
        copied = remap(copy.deepcopy(source[old]))
        # The avatar prefab is embedded into the row as ordinary static nodes.
        # Keeping its source PrefabInfo would leave __id__:0 pointing at the
        # target prefab's root asset after the copy.
        if copied.get("__type__") == "cc.Node":
            copied.pop("_prefab", None)
        p.data.append(copied)
    new_id = mapping[source_root]
    p.data[new_id]["_parent"] = {"__id__": parent_id}
    p.data[new_id]["_name"] = new_name
    p.data[parent_id].setdefault("_children", []).append({"__id__": new_id})
    return new_id


def strip_prefab_links(p: Prefab, node_id: int) -> None:
    p.data[node_id].pop("_prefab", None)
    for ref in p.data[node_id].get("_children", []):
        strip_prefab_links(p, ref["__id__"])


def style_row(p: Prefab, root_path: str) -> None:
    root = p.node(root_path)
    node = p.data[root]
    node["_contentSize"].update(width=701.3815090329438, height=95.64293304994694)
    sprite(p, root, ROW_ASSET)

    avatar_path = root_path + "/头像"
    try:
        avatar = p.node(avatar_path)
    except KeyError:
        avatar = add_external_subtree(p, AVATAR_PREFAB, 1, root, "头像")
    for avatar_node in [avatar, p.node(avatar_path + "/mask"), p.node(avatar_path + "/mask/img")]:
        p.data[avatar_node].pop("_prefab", None)
    _, avatar_button = p.component(avatar, "cc.Button")
    if avatar_button is not None:
        avatar_button["_enabled"] = False
    p.set_pos(avatar, -198, 0, 88, 88)
    sprite(p, avatar, AVATAR_RING_ASSET)
    mask = p.node(avatar_path + "/mask")
    p.set_pos(mask, 0, 0, 72, 72)
    image = p.node(avatar_path + "/mask/img")
    p.set_pos(image, 0, 0, 72, 72)
    _, image_sprite = p.component(image, "cc.Sprite")
    if image_sprite is not None:
        image_sprite.update(_enabled=True, _sizeMode=0, _isTrimmedMode=False)

    # The card rim replaces the old flat horizontal rule. Keep the two inner
    # column rules because they are part of the approved data grid.
    line = p.node(root_path + "/line")
    p.set_active(line, False)
    p.disable(line, "cc.Sprite")

    gold = {"__type__": "cc.Color", "r": 255, "g": 238, "b": 190, "a": 255}
    white = {"__type__": "cc.Color", "r": 255, "g": 249, "b": 232, "a": 255}
    cyan = {"__type__": "cc.Color", "r": 201, "g": 230, "b": 245, "a": 255}
    outline = {"__type__": "cc.Color", "r": 1, "g": 17, "b": 36, "a": 230}
    for name, color in [
        ("idx", gold),
        ("name", white),
        ("V8玩家ID", cyan),
        ("played_count", gold),
        ("user_reward", white),
    ]:
        n = p.node(root_path + "/" + name)
        p.data[n]["_color"] = color
        _, label = p.component(n, "cc.Label")
        if label is not None:
            label["_styleFlags"] = 1 if name == "name" else 0
        _, out = p.component(n, "cc.LabelOutline")
        if out is not None:
            out.update(_enabled=True, _width=1, _color=outline)
        _, sh = p.component(n, "cc.LabelShadow")
        if sh is not None:
            sh.update(
                _enabled=True,
                _color={"__type__": "cc.Color", "r": 0, "g": 10, "b": 25, "a": 220},
                _offset={"__type__": "cc.Vec2", "x": 1.5, "y": -2.5},
                _blur=2,
            )

    # The concept reserves a compact avatar/name block between rank and the
    # metric column. Keep the live label names and protocol fields unchanged.
    for name, x, width, font in [("name", -77, 160, 28), ("V8玩家ID", -77, 160, 22)]:
        n = p.node(root_path + "/" + name)
        p.set_pos(n, x, 17.5 if name == "name" else -20.5, width, 38 if name == "name" else 30)
        _, label = p.component(n, "cc.Label")
        if label is not None:
            label["_fontSize"] = font
            label["_lineHeight"] = font + 5


def style_page(p: Prefab) -> None:
    root = "排行榜"
    for board in ["玩家手数榜", "玩家赢分榜", "代理红利榜"]:
        tab = p.node(f"{root}/条件/{board}")
        off_asset, on_asset = BOARD_TAB_ASSETS[board]
        tab_node = p.data[tab]
        tab_x, tab_y = tab_node["_trs"]["array"][:2]
        p.set_pos(tab, tab_x, tab_y, 220, 64)
        background = p.node(f"{root}/条件/{board}/Background")
        checkmark = p.node(f"{root}/条件/{board}/checkmark")
        p.set_pos(background, 0, 0, 220, 64)
        p.set_pos(checkmark, 0, 0, 220, 64)
        sprite(p, background, off_asset)
        sprite(p, checkmark, on_asset)
        selected = board == "玩家手数榜"
        p.set_active(checkmark, selected)
        toggle = p.component(tab, "cc.Toggle")[1]
        if toggle is not None:
            toggle["_N$isChecked"] = selected
            toggle["isChecked"] = selected

        path = f"{root}/容器/{board}/V8表格底框"
        n = p.node(path)
        sprite(p, n, TABLE_ASSET, sliced=True)
        # The new row cards need a small breathing gap between entries.
        content = p.node(f"{root}/容器/{board}/列表/view/content")
        _, layout = p.component(content, "cc.Layout")
        if layout is not None:
            layout["_N$spacingY"] = 5
            layout["_N$paddingTop"] = 4
            layout["_N$paddingBottom"] = 4

    # Give the live header values the same crisp gold/white depth as the
    # concept while keeping their strings and protocol bindings untouched.
    for path in [
        f"{root}/广告/V8排名",
        f"{root}/广告/V8奖励",
        f"{root}/广告/V8本人指标",
    ]:
        try:
            n = p.node(path)
        except KeyError:
            continue
        p.data[n]["_color"] = {"__type__": "cc.Color", "r": 255, "g": 242, "b": 206, "a": 255}
        _, shadow = p.component(n, "cc.LabelShadow")
        if shadow is not None:
            shadow.update(
                _enabled=True,
                _color={"__type__": "cc.Color", "r": 0, "g": 12, "b": 28, "a": 220},
                _offset={"__type__": "cc.Vec2", "x": 1, "y": -2},
                _blur=2,
            )

    # Match the approved concept's compact hero: the BF shield, two date lines
    # and enlarged rank/reward line carry the header; the old BF 荣耀榜 title
    # and extra metric line are hidden while their runtime nodes remain.
    shield = p.node(f"{root}/广告/V8盾牌")
    sprite(p, shield, SHIELD_ASSET)
    p.set_pos(shield, -253, -2, 155, 178)
    p.set_active(p.node(f"{root}/广告/V8荣耀标题"), False)
    p.set_active(p.node(f"{root}/广告/V8本人指标"), False)
    p.set_active(p.node(f"{root}/广告/结束时间"), True)
    p.set_pos(p.node(f"{root}/广告/开始时间"), 56, 42, 480, 38)
    p.set_pos(p.node(f"{root}/广告/结束时间"), 56, 4, 480, 38)
    label_value(p, f"{root}/广告/开始时间", "开始时间 2026/11/17 00:00")
    label_value(p, f"{root}/广告/结束时间", "截止时间 2026/11/24 23:59")
    p.set_pos(p.node(f"{root}/广告/V8排名标题"), -115, -66, 130, 42)
    p.set_pos(p.node(f"{root}/广告/V8排名"), -15, -66, 70, 48)
    p.set_pos(p.node(f"{root}/广告/V8奖励标题"), 85, -66, 130, 42)
    p.set_pos(p.node(f"{root}/广告/V8奖励"), 195, -66, 80, 48)
    p.set_pos(p.node(f"{root}/广告/领取奖励"), 295, -60, 115, 58)
    p.set_pos(p.node(f"{root}/广告/已领取"), 295, -60, 115, 48)
    label_value(p, f"{root}/广告/V8排名", "2")
    label_value(p, f"{root}/广告/V8奖励", "500")
    # The current club board screenshot does not show a claim button. The
    # runtime still enables it for the existing hall reward condition.
    p.set_active(p.node(f"{root}/广告/领取奖励"), False)
    for name, font, line_height in [
        ("开始时间", 28, 34),
        ("结束时间", 28, 34),
        ("V8排名标题", 30, 36),
        ("V8排名", 38, 44),
        ("V8奖励标题", 30, 36),
        ("V8奖励", 38, 44),
    ]:
        label = p.component(p.node(f"{root}/广告/{name}"), "cc.Label")[1]
        if label is not None:
            label["_fontSize"] = font
            label["_lineHeight"] = line_height
            label["_N$horizontalAlign"] = 1
            label["_N$verticalAlign"] = 1

    # The live default is 1皮; each filter gets the same regenerated surface.
    for name in ["1皮", "2皮", "5皮", "10皮", "20皮"]:
        tab = p.node(f"{root}/容器/玩家手数榜/选择手数/{name}")
        toggle = p.component(tab, "cc.Toggle")[1]
        selected = name == "1皮"
        tab_node = p.data[tab]
        tab_x, tab_y = tab_node["_trs"]["array"][:2]
        p.set_pos(tab, tab_x, tab_y, 132, 54)
        background = p.node(f"{root}/容器/玩家手数榜/选择手数/{name}/Background")
        checkmark = p.node(f"{root}/容器/玩家手数榜/选择手数/{name}/checkmark")
        p.set_pos(background, 0, 0, 132, 54)
        p.set_pos(checkmark, 0, 0, 132, 54)
        off_asset, on_asset = FILTER_TAB_ASSETS[name]
        sprite(p, background, off_asset)
        sprite(p, checkmark, on_asset)
        # The approved reference already contains the finished label glyph;
        # do not draw a second Cocos Label over it.
        p.hide_children(background)
        p.hide_children(checkmark)
        p.set_active(checkmark, selected)
        if toggle is not None:
            toggle["_N$isChecked"] = selected
            toggle["isChecked"] = selected

def label_value(p: Prefab, path: str, value: str) -> None:
    node = p.node(path)
    _, label = p.component(node, "cc.Label")
    if label is not None:
        label["_string"] = label["_N$string"] = value


def seed_editor_rows(p: Prefab, board: str, metrics: list[str]) -> None:
    """Keep six preview rows in the Prefab and reuse them at runtime.

    panelPaihangbang.clearPage() deactivates every existing content child
    before the first server response. LeaderboardScrollView.renderPage() then
    reuses those children by index, so the editor sample cannot leak into live
    data.
    """
    content_path = f"排行榜/容器/{board}/列表/view/content"
    content = p.node(content_path)
    preview = [
        r["__id__"]
        for r in p.data[content].get("_children", [])
        if p.data[r["__id__"]].get("_name", "").startswith("V9预览行")
    ]
    template = p.node("排行榜/排行榜对象")
    while len(preview) < 6:
        row = p.clone_subtree(template, content, f"V9预览行{len(preview) + 1}")
        preview.append(row)

    names = ["五哥", "欢乐马123", "体面", "小虾米", "速搏家", "信贷黄经理"]
    ids = ["157710", "531344", "659348", "541507", "182771", "411973"]
    rewards = ["3,000", "2,000", "1,000", "500", "300", "200"]
    row_height = 95.64293304994694
    spacing = 5
    padding = 4
    content_height = padding * 2 + row_height * 6 + spacing * 5
    p.data[content]["_contentSize"]["height"] = content_height
    _, layout = p.component(content, "cc.Layout")
    if layout is not None:
        layout["_layoutSize"]["height"] = content_height
    for rank, row in enumerate(preview[:6], 1):
        p.set_active(row, True)
        # Layout will recalculate this at runtime. Serializing the same
        # vertical positions also makes the six sample rows visible as soon
        # as the Prefab opens in Creator, before an editor layout refresh.
        y = content_height / 2 - padding - row_height / 2 - (rank - 1) * (row_height + spacing)
        p.set_pos(row, 0, y)
        root = f"{content_path}/V9预览行{rank}"
        strip_prefab_links(p, p.node(root + "/头像"))
        label_value(p, root + "/idx", str(rank))
        label_value(p, root + "/name", names[rank - 1])
        label_value(p, root + "/V8玩家ID", "ID:" + ids[rank - 1])
        label_value(p, root + "/played_count", metrics[rank - 1])
        label_value(p, root + "/user_reward", rewards[rank - 1])
        avatar_image = p.node(root + "/头像/mask/img")
        _, avatar_sprite = p.component(avatar_image, "cc.Sprite")
        if avatar_sprite is not None:
            avatar_sprite["_spriteFrame"] = {"__uuid__": frame_uuid_at(AVATAR_DIR / ("头像%02d.png" % rank))}
        for medal in range(1, 4):
            p.set_active(p.node(root + "/V8皇冠" + str(medal)), medal == rank)
        p.set_active(p.node(root + "/idx"), rank > 3)


def apply() -> None:
    generate_row()
    generate_table()
    generate_tab_assets()
    generate_avatar_ring()

    page = Prefab(PAGE)
    style_page(page)
    style_row(page, "排行榜/排行榜对象")
    seed_editor_rows(page, "玩家手数榜", ["1,286", "986", "882", "728", "615", "542"])
    seed_editor_rows(page, "玩家赢分榜", ["+90,630", "+82,400", "+75,260", "+61,800", "+58,950", "+52,680"])
    seed_editor_rows(page, "代理红利榜", ["18,630", "15,200", "12,860", "9,800", "8,950", "7,320"])
    page.save()

    row = Prefab(ROW)
    style_row(row, "排行榜对象")
    row.save()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "v9-implementation.json").write_text(
        json.dumps(
            {
                "design": "design-previews/排行榜-V9-待确认/排行榜-V9-三榜统一效果图-待确认.png",
                "assets": [ROW_ASSET, TABLE_ASSET, AVATAR_RING_ASSET, SHIELD_ASSET,
                           *[asset for pair in BOARD_TAB_ASSETS.values() for asset in pair],
                           *[asset for pair in FILTER_TAB_ASSETS.values() for asset in pair]],
                "scope": [PAGE, ROW],
                "referenceSource": str(REFERENCE_TABS_SOURCE.relative_to(ROOT)),
                "filterSource": str(FILTER_IMAGEGEN_SOURCE_DIR.relative_to(ROOT)),
                "notes": "Board tabs are cut directly from the confirmed three-board reference. The ten filter states are complete imagegen button assets with generated Chinese art lettering; board tabs are 220x64 and filter tabs 132x54. Original dynamic data, avatar binding, toggle events, default 1皮 and infinite scroll remain intact.",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print("Applied V9 leaderboard row cards, table bevel and live-label depth.")


if __name__ == "__main__":
    apply()
