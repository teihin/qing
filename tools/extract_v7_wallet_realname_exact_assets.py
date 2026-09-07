#!/usr/bin/env python3
"""Extract the approved V7 wallet real-name mockup into formal Cocos assets.

Only static art is sampled from the accepted effect image.  Editable field
values remain live EditBox labels in the Prefab, while the 8L shield continues
to use the existing independent high-definition V7 asset.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from extract_v7_wallet_exact_assets import clean_panel, crop, erase_horizontal, rounded
from generate_v7_runtime_skin import OUT, ROOT, save


PREVIEW = (
    ROOT
    / "design-previews/2026-09-06-V7钱包实名认证首次进入效果图-v1"
    / "01-实名认证与交易密码设置.png"
)
FONT = ROOT / "assets/font/PingFF.ttf"
SS = 4
GOLD = (235, 203, 151, 255)
GOLD_HI = (249, 226, 181, 255)
TEXT = (205, 213, 216, 255)


def save_crisp(image: Image.Image, name: str, sliced: bool = False) -> None:
    """Save UI lettering outside the dynamic atlas to avoid resampling blur."""
    save(image, name, sliced=sliced)
    meta_path = OUT / f"{name}.meta"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["packable"] = False
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size * SS)


def highres(image: Image.Image) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    work = image.resize((image.width * SS, image.height * SS), Image.Resampling.BICUBIC)
    return work, ImageDraw.Draw(work, "RGBA")


def finish(image: Image.Image) -> Image.Image:
    return image.resize(
        (image.width // SS, image.height // SS), Image.Resampling.LANCZOS
    )


def draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str,
              size: int, fill: tuple[int, int, int, int] = GOLD,
              anchor: str = "mm", stroke: int = 0) -> None:
    x, y = xy
    draw.text(
        (x * SS, y * SS), text, font=font(size), fill=fill, anchor=anchor,
        stroke_width=stroke * SS, stroke_fill=(61, 41, 25, 210),
    )


def text_asset(text: str, size: tuple[int, int], font_size: int,
               fill: tuple[int, int, int, int] = GOLD_HI) -> Image.Image:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    work, draw = highres(image)
    draw_text(draw, (size[0] // 2 + 1, size[1] // 2 + 2), text,
              font_size, (0, 8, 18, 125), stroke=0)
    draw_text(draw, (size[0] // 2, size[1] // 2), text,
              font_size, fill, stroke=1)
    return finish(work)


def light_cutout(image: Image.Image) -> Image.Image:
    """Keep warm/neutral lettering while removing the dark-blue photograph."""
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    value = rgb.max(axis=2)
    neutral_or_warm = np.clip((red - blue + 18) / 18.0, 0.0, 1.0)
    alpha = np.clip((value - 68) * 4.2, 0, 255) * neutral_or_warm
    rgba[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def clean_input_row(source: Image.Image, box: tuple[int, int, int, int],
                    icon_box: tuple[int, int, int, int], label: str) -> Image.Image:
    row = clean_panel(source, box, (602, 78))
    work, draw = highres(row)
    icon = light_cutout(crop(source, icon_box, (44, 44))).resize(
        (44 * SS, 44 * SS), Image.Resampling.LANCZOS
    )
    work.alpha_composite(icon, (24 * SS, 17 * SS))
    draw_text(draw, (88, 39), label, 28, GOLD_HI, anchor="lm", stroke=0)
    draw.line((214 * SS, 14 * SS, 214 * SS, 64 * SS),
              fill=(141, 168, 176, 180), width=1 * SS)
    return finish(work)


def warning_card(source: Image.Image) -> Image.Image:
    image = clean_panel(source, (85, 1203, 855, 1531), (614, 300))
    work, draw = highres(image)
    draw.line((26 * SS, 45 * SS, 188 * SS, 45 * SS), fill=(174, 146, 99, 210), width=1 * SS)
    draw.line((426 * SS, 45 * SS, 588 * SS, 45 * SS), fill=(174, 146, 99, 210), width=1 * SS)
    draw_text(draw, (307, 39), "◇  重要提示  ◇", 26, GOLD_HI, stroke=0)
    items = (
        ("请填写真实姓名且保证名字准确，设置后名字不能修改。", "名字错误充值可能损失，同时无法提现。"),
        ("只能添加实名对应名下银行卡，其他姓名银行卡无法提现，", "损失自负。"),
        ("交易密码请牢记，一旦忘记无法重置。",),
        ("交易密码需和登录密码不相同。",),
    )
    y = 80
    for index, lines in enumerate(items, start=1):
        radius = 14 * SS
        cx, cy = 37 * SS, (y + 8) * SS
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
                     outline=GOLD, width=2 * SS)
        draw_text(draw, (37, y + 8), str(index), 18, GOLD_HI, stroke=0)
        for line_index, line in enumerate(lines):
            draw_text(draw, (68, y + line_index * 25), line, 19, TEXT,
                      anchor="la", stroke=0)
        y += 61 if len(lines) == 2 else 39
    return finish(work)


def picker_panel(source: Image.Image) -> Image.Image:
    image = clean_panel(source, (76, 442, 864, 1052), (646, 920))
    work, draw = highres(image)
    draw_text(draw, (323, 48), "选择银行", 36, GOLD_HI, stroke=1)
    draw_text(draw, (323, 82), "请选择收款银行卡所属银行", 20, TEXT, stroke=0)
    draw.rounded_rectangle(
        (28 * SS, 112 * SS, 618 * SS, 892 * SS), radius=18 * SS,
        fill=(2, 27, 48, 118), outline=(116, 100, 72, 150), width=1 * SS,
    )
    return finish(work)


def picker_row(source: Image.Image) -> Image.Image:
    image = clean_panel(source, (103, 591, 838, 678), (560, 78))
    work, draw = highres(image)
    icon = light_cutout(crop(source, (130, 614, 174, 656), (40, 40))).resize(
        (40 * SS, 40 * SS), Image.Resampling.LANCZOS
    )
    work.alpha_composite(icon, (22 * SS, 19 * SS))
    draw_text(draw, (526, 39), "›", 39, GOLD_HI, stroke=0)
    return finish(work)


def close_icon() -> Image.Image:
    image = Image.new("RGBA", (58, 58), (0, 0, 0, 0))
    work, draw = highres(image)
    draw.ellipse((2 * SS, 2 * SS, 56 * SS, 56 * SS),
                 fill=(5, 37, 61, 245), outline=GOLD, width=1 * SS)
    draw.line((19 * SS, 19 * SS, 39 * SS, 39 * SS), fill=GOLD_HI, width=3 * SS)
    draw.line((39 * SS, 19 * SS, 19 * SS, 39 * SS), fill=GOLD_HI, width=3 * SS)
    return finish(work)


def join_panel(source: Image.Image) -> Image.Image:
    image = clean_panel(source, (76, 442, 864, 1052), (600, 690))
    work, draw = highres(image)
    draw_text(draw, (300, 47), "加入房间", 36, GOLD_HI, stroke=1)
    draw_text(draw, (300, 82), "请输入六位房间号", 20, TEXT, stroke=0)
    return finish(work)


def join_input(source: Image.Image) -> Image.Image:
    return clean_panel(source, (103, 478, 838, 568), (480, 82))


def keypad_key(source: Image.Image, label: str) -> Image.Image:
    image = clean_panel(source, (103, 478, 838, 568), (150, 78))
    work, draw = highres(image)
    draw_text(draw, (75, 39), label, 30 if len(label) == 1 else 24,
              GOLD_HI, stroke=0)
    return finish(work)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(PREVIEW).convert("RGB")
    if source.size != (941, 1672):
        raise RuntimeError(f"实名认证效果图尺寸异常: {source.size}")

    save_crisp(crop(source, (0, 0, 941, 104), (750, 83)),
               "wallet_realname_header_exact.png")
    save_crisp(text_asset("实名认证与交易密码设置", (540, 68), 43),
               "wallet_realname_hero_title_exact.png")
    save_crisp(text_asset("◇  请准确填写身份与收款信息  ◇", (500, 48), 24, TEXT),
               "wallet_realname_hero_subtitle_exact.png")

    shield = Image.open(OUT / "shield_hd.png").convert("RGBA").resize(
        (284, 298), Image.Resampling.LANCZOS
    )
    save_crisp(shield, "wallet_realname_shield_exact.png")

    save(clean_panel(source, (76, 442, 864, 1052), (642, 492)),
         "wallet_realname_form_panel_exact.png", sliced=True)
    rows = {
        "name": ((103, 478, 838, 568), (129, 503, 172, 546), "姓名"),
        "bank": ((103, 591, 838, 678), (130, 614, 174, 656), "银行名称"),
        "card": ((103, 705, 838, 790), (130, 728, 174, 770), "银行卡号"),
        "password": ((103, 816, 838, 901), (131, 838, 173, 880), "交易密码"),
        "confirm": ((103, 928, 838, 1013), (131, 950, 173, 992), "确认密码"),
    }
    for key, (box, icon_box, label) in rows.items():
        save_crisp(clean_input_row(source, box, icon_box, label),
                   f"wallet_realname_row_{key}_exact.png")

    save_crisp(rounded(source, (197, 1083, 711, 1175), (430, 82), 18),
               "wallet_realname_submit_exact.png")
    save_crisp(warning_card(source), "wallet_realname_warning_exact.png")

    save_crisp(picker_panel(source), "wallet_bank_picker_panel_exact.png")
    save_crisp(picker_row(source), "wallet_bank_picker_row_exact.png")
    save_crisp(close_icon(), "popup_close_exact.png")
    save_crisp(join_panel(source), "popup_join_room_panel_exact.png")
    save_crisp(join_input(source), "popup_join_room_input_exact.png")
    for label in tuple("123456789") + ("重置", "0", "删除"):
        safe = {"重置": "reset", "删除": "delete"}.get(label, label)
        save_crisp(keypad_key(source, label), f"popup_key_{safe}_exact.png")

    print("已提取钱包首次实名认证页 V7 分层资源。")


if __name__ == "__main__":
    main()
