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

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from apply_v7_prefab_skin import Prefab, MATERIAL_UUID, ROOT


ASSET_DIR = ROOT / "assets/V7"
PAGE = "assets/resources/Prefabs/排行榜.prefab"
ROW = "assets/resources/Prefabs/排行榜对象.prefab"
OUT = ROOT / "art_sources/v8-repairs/leaderboard"
ROW_ASSET = "leaderboard_v9_row.png"
TABLE_ASSET = "leaderboard_v9_table.png"


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


def frame_uuid(name: str) -> str:
    meta = json.loads((ASSET_DIR / f"{name}.meta").read_text())
    return meta["subMetas"][Path(name).stem]["uuid"]


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


def style_row(p: Prefab, root_path: str) -> None:
    root = p.node(root_path)
    node = p.data[root]
    node["_contentSize"].update(width=701.3815090329438, height=95.64293304994694)
    sprite(p, root, ROW_ASSET)

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


def style_page(p: Prefab) -> None:
    root = "排行榜"
    for board in ["玩家手数榜", "玩家赢分榜", "代理红利榜"]:
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


def apply() -> None:
    generate_row()
    generate_table()

    page = Prefab(PAGE)
    style_page(page)
    style_row(page, "排行榜/排行榜对象")
    page.save()

    row = Prefab(ROW)
    style_row(row, "排行榜对象")
    row.save()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "v9-implementation.json").write_text(
        json.dumps(
            {
                "design": "design-previews/排行榜-V9-待确认/排行榜-V9-三榜统一效果图-待确认.png",
                "assets": [ROW_ASSET, TABLE_ASSET],
                "scope": [PAGE, ROW],
                "notes": "Keeps the existing three boards, live data labels and infinite scroll.",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print("Applied V9 leaderboard row cards, table bevel and live-label depth.")


if __name__ == "__main__":
    apply()
