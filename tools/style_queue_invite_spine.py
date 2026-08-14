#!/usr/bin/env python3
"""将排队/一键邀请 Spine 图集统一为 8L 深蓝银青风格。

脚本只改写 PNG 像素，不改变图集尺寸、区域坐标、Spine JSON 或动画时间轴。
首次运行会把竞品原始资源备份到 HisImg，便于随时回滚和重新调整。
"""

from __future__ import annotations

import shutil
import json
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter
except ModuleNotFoundError as exc:
    raise SystemExit("缺少 Pillow；请使用项目图像运行环境或先执行 python3 -m pip install Pillow") from exc


ROOT = Path(__file__).resolve().parents[1]
QUEUE_PNG = ROOT / "assets/动画/排队/pd.png"
QUEUE_ATLAS = ROOT / "assets/动画/排队/pd.atlas"
QUEUE_JSON = ROOT / "assets/动画/排队/pd.json"
INVITE_PNG = ROOT / "assets/动画/邀请/yaoqing.png"
BACKUP_DIR = ROOT / "HisImg/20260814-queue-invite-competitor-original"


def ensure_backup() -> None:
    for source, relative in (
        (ROOT / "assets/动画/排队", Path("排队")),
        (ROOT / "assets/动画/邀请", Path("邀请")),
    ):
        target = BACKUP_DIR / relative
        if not target.exists():
            shutil.copytree(source, target)


def lerp(a: int, b: int, amount: float) -> int:
    return round(a + (b - a) * amount)


def mix(first: tuple[int, int, int], second: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    amount = max(0.0, min(1.0, amount))
    return tuple(lerp(a, b, amount) for a, b in zip(first, second))


def recolor_luminance(
    image: Image.Image,
    dark: tuple[int, int, int],
    middle: tuple[int, int, int],
    bright: tuple[int, int, int],
    alpha_scale: float = 1.0,
) -> Image.Image:
    source = image.convert("RGBA")
    output = Image.new("RGBA", source.size)
    pixels = []
    for red, green, blue, alpha in source.get_flattened_data():
        if alpha == 0:
            pixels.append((0, 0, 0, 0))
            continue
        luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255.0
        if luminance < 0.55:
            color = mix(dark, middle, luminance / 0.55)
        else:
            color = mix(middle, bright, (luminance - 0.55) / 0.45)
        pixels.append((*color, max(0, min(255, round(alpha * alpha_scale)))))
    output.putdata(pixels)
    return output


def parse_atlas(path: Path) -> dict[str, dict[str, str]]:
    regions: dict[str, dict[str, str]] = {}
    current: str | None = None
    header_keys = ("size:", "format:", "filter:", "repeat:")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line and not raw_line.startswith(" ") and not raw_line.startswith(header_keys) and not raw_line.endswith(".png"):
            current = raw_line.strip()
            regions[current] = {}
        elif current is not None and ":" in raw_line:
            key, value = raw_line.strip().split(":", 1)
            regions[current][key] = value.strip()
    return regions


def atlas_region_box(region: dict[str, str]) -> tuple[int, int, int, int]:
    x, y = (int(value) for value in region["xy"].split(","))
    width, height = (int(value) for value in region["size"].split(","))
    if region.get("rotate") == "true":
        width, height = height, width
    return x, y, x + width, y + height


def unpack_atlas_region(image: Image.Image, region: dict[str, str]) -> Image.Image:
    packed = image.crop(atlas_region_box(region))
    return packed.rotate(-90, expand=True) if region.get("rotate") == "true" else packed


def pack_atlas_region(image: Image.Image, region: dict[str, str]) -> Image.Image:
    return image.rotate(90, expand=True) if region.get("rotate") == "true" else image


def make_queue_ring_mask() -> Image.Image:
    """生成与218x86按钮外缘一致的抗锯齿圆角环遮罩。"""
    scale = 4
    size = (218 * scale, 86 * scale)
    glow = Image.new("L", size, 0)
    core = Image.new("L", size, 0)
    glow_draw = ImageDraw.Draw(glow)
    core_draw = ImageDraw.Draw(core)
    # 与按钮底板使用同一圆角轮廓，亮弧沿边框运动，不再按胶囊形轨迹绕行。
    box = (4 * scale, 4 * scale, 214 * scale, 82 * scale)
    radius = 22 * scale
    glow_draw.rounded_rectangle(box, radius=radius, outline=210, width=5 * scale)
    glow = glow.filter(ImageFilter.GaussianBlur(1.5 * scale))
    core_draw.rounded_rectangle(box, radius=radius, outline=255, width=2 * scale)
    mask = ImageChops.lighter(glow, core)
    return mask.resize((218, 86), Image.Resampling.LANCZOS)


def isolate_queue_ring(
    image: Image.Image,
    region: dict[str, str],
    attachment: dict[str, float],
    ring_mask: Image.Image,
) -> Image.Image:
    """移除 Unity 图集中随亮弧一起导出的深蓝矩形，只保留旋转外圈。"""
    source = image.convert("RGBA")
    output = Image.new("RGBA", source.size)
    pixels = []
    orig_width, orig_height = (int(value) for value in region["orig"].split(","))
    offset_x, offset_y = (int(value) for value in region["offset"].split(","))
    trim_top = orig_height - offset_y - source.height
    attachment_width = float(attachment.get("width", orig_width))
    attachment_height = float(attachment.get("height", orig_height))
    attachment_x = float(attachment.get("x", 0))
    attachment_y = float(attachment.get("y", 0))
    global_left = 109 + attachment_x - attachment_width / 2
    global_top = 43 - attachment_y - attachment_height / 2
    mask_pixels = ring_mask.load()

    for index, (red, green, blue, alpha) in enumerate(source.get_flattened_data()):
        if alpha == 0:
            pixels.append((0, 0, 0, 0))
            continue

        local_x = index % source.width
        local_y = index // source.width
        global_x = round(global_left + offset_x + local_x)
        global_y = round(global_top + trim_top + local_y)
        if global_x < 0 or global_y < 0 or global_x >= ring_mask.width or global_y >= ring_mask.height:
            pixels.append((0, 0, 0, 0))
            continue

        # 原帧alpha负责亮弧在30帧中的移动，相同尺寸的圆角环遮罩负责剔除内部矩形。
        mask_strength = mask_pixels[global_x, global_y] / 255.0
        source_strength = (alpha / 255.0) ** 0.72
        strength = mask_strength * source_strength
        if strength <= 0.002:
            pixels.append((0, 0, 0, 0))
            continue

        color = mix((10, 119, 167), (233, 250, 255), source_strength)
        new_alpha = round(255 * min(1.0, strength * 1.25))
        pixels.append((*color, new_alpha))
    output.putdata(pixels)
    return output


def make_queue_button() -> Image.Image:
    """生成 218x86 无字按钮；文字继续由场景 Label 显示。"""
    scale = 4
    width, height = 218 * scale, 86 * scale
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # 深蓝玻璃底：中部略亮、上下压暗，避免竞品原图的大面积亮青色。
    for y in range(height):
        normalized = y / max(1, height - 1)
        center_light = 1.0 - abs(normalized - 0.5) * 2.0
        top_bottom = mix((2, 13, 25), (6, 42, 61), center_light)
        line = Image.new("RGBA", (width, 1), (*top_bottom, 248))
        gradient.alpha_composite(line, (0, y))

    # 底色本身必须经过圆角透明遮罩；只画圆角边线会让四角仍保留矩形底色。
    fill_mask = Image.new("L", (width, height), 0)
    fill_draw = ImageDraw.Draw(fill_mask)
    fill_box = (3 * scale, 3 * scale, width - 3 * scale - 1, height - 3 * scale - 1)
    fill_draw.rounded_rectangle(fill_box, radius=22 * scale, fill=255)
    gradient.putalpha(fill_mask)
    canvas.alpha_composite(gradient)

    draw = ImageDraw.Draw(canvas)
    outer = fill_box
    radius = 22 * scale
    # 只保留银色主边和内侧青蓝细线；删除会形成黑边的外部暗影。
    draw.rounded_rectangle(outer, radius=radius, outline=(142, 174, 191, 245), width=3 * scale)
    inner = (8 * scale, 8 * scale, width - 8 * scale - 1, height - 8 * scale - 1)
    draw.rounded_rectangle(inner, radius=17 * scale, outline=(12, 84, 116, 205), width=2 * scale)

    canvas = canvas.resize((218, 86), Image.Resampling.LANCZOS)
    # 图集对该区域裁掉了四周 1px。
    return canvas.crop((1, 1, 217, 85))


def make_invite_disc() -> Image.Image:
    """生成 171x171 深蓝银青邀请底盘，再按图集 offset 裁剪。"""
    scale = 4
    size = 171 * scale
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    center = (size - 1) / 2
    max_radius = 82 * scale
    pixels = canvas.load()
    for y in range(size):
        for x in range(size):
            dx, dy = x - center, y - center
            radius = (dx * dx + dy * dy) ** 0.5
            if radius > max_radius:
                continue
            normalized = radius / max_radius
            # 中心保持深色，靠边稍亮，确保文字清晰。
            color = mix((2, 17, 32), (7, 58, 79), normalized ** 1.7)
            pixels[x, y] = (*color, 252)

    draw = ImageDraw.Draw(canvas)
    outer = (3 * scale, 3 * scale, size - 3 * scale - 1, size - 3 * scale - 1)
    draw.ellipse(outer, outline=(222, 239, 247, 255), width=3 * scale)
    draw.ellipse((7 * scale, 7 * scale, size - 7 * scale - 1, size - 7 * scale - 1),
                 outline=(26, 162, 197, 240), width=2 * scale)
    draw.ellipse((13 * scale, 13 * scale, size - 13 * scale - 1, size - 13 * scale - 1),
                 outline=(117, 181, 206, 145), width=1 * scale)
    draw.arc((5 * scale, 4 * scale, size - 5 * scale, size - 5 * scale), 202, 338,
             fill=(247, 252, 255, 235), width=2 * scale)
    draw.arc((8 * scale, 8 * scale, size - 8 * scale, size - 8 * scale), 24, 152,
             fill=(15, 119, 156, 205), width=2 * scale)
    canvas = canvas.resize((171, 171), Image.Resampling.LANCZOS)
    return canvas.crop((2, 2, 169, 169))


def style_queue() -> None:
    # 每次都从首次备份生成，保证脚本可重复执行而不会累计染色。
    image = Image.open(BACKUP_DIR / "排队/pd.png").convert("RGBA")
    if image.size != (156, 3078):
        raise RuntimeError(f"排队图集尺寸异常：{image.size}")

    regions = parse_atlas(QUEUE_ATLAS)
    queue_data = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
    attachments = queue_data["skins"][0]["attachments"]["pd_0000"]
    ring_mask = make_queue_ring_mask()
    # Unity 原图的每一帧包含一块深蓝色矩形。Cocos 的 additive 混合会把矩形也叠加出来，
    # 视觉上像左右摆动；逐帧只保留边缘青色亮弧，原30帧顺序和atlas几何完全不动。
    for frame_index in range(30):
        region = regions[f"pd_{frame_index:04d}"]
        frame = unpack_atlas_region(image, region)
        frame_name = f"pd_{frame_index:04d}"
        frame = isolate_queue_ring(frame, region, attachments[frame_name], ring_mask)
        packed = pack_atlas_region(frame, region)
        box = atlas_region_box(region)
        image.paste((0, 0, 0, 0), box)
        image.paste(packed, box[:2])

    queue_button = make_queue_button()
    # btn 在 atlas 中 rotate:true，正确方向存储为逆时针旋转后的 84x216。
    packed = queue_button.rotate(90, expand=True)
    image.paste((0, 0, 0, 0), (2, 2553, 86, 2769))
    image.paste(packed, (2, 2553))
    image.save(QUEUE_PNG, optimize=True)


def style_invite() -> None:
    # 每次都从首次备份生成，保证脚本可重复执行而不会累计染色。
    image = Image.open(BACKUP_DIR / "邀请/yaoqing.png").convert("RGBA")
    if image.size != (450, 265):
        raise RuntimeError(f"邀请图集尺寸异常：{image.size}")

    # 外环 q：保留原有颗粒、光晕和旋转形状，仅改为银蓝青色并收敛亮度。
    q_region = image.crop((2, 2, 279, 263))
    q_region = recolor_luminance(
        q_region,
        dark=(0, 17, 34),
        middle=(18, 113, 157),
        bright=(215, 242, 251),
        alpha_scale=0.78,
    )
    image.paste((0, 0, 0, 0), (2, 2, 279, 263))
    image.paste(q_region, (2, 2))

    # 中心底盘替换为项目统一的深蓝玻璃与银青双环。
    disc = make_invite_disc()
    image.paste((0, 0, 0, 0), (281, 96, 448, 263))
    image.paste(disc, (281, 96))

    # 文字保留原字形和动画插槽，只把黑白竞品风调整为冰银字＋深蓝描边。
    font_region = image.crop((281, 3, 377, 94))
    font_region = recolor_luminance(
        font_region,
        dark=(0, 18, 34),
        middle=(63, 136, 168),
        bright=(238, 249, 253),
        alpha_scale=1.0,
    )
    image.paste((0, 0, 0, 0), (281, 3, 377, 94))
    image.paste(font_region, (281, 3))
    image.save(INVITE_PNG, optimize=True)


def main() -> None:
    ensure_backup()
    style_queue()
    style_invite()
    print(f"已更新：{QUEUE_PNG.relative_to(ROOT)}")
    print(f"已更新：{INVITE_PNG.relative_to(ROOT)}")
    print(f"原始资源备份：{BACKUP_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
