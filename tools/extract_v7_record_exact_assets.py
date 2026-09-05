#!/usr/bin/env python3
"""Extract deterministic V7 record-list art from the approved 04 mockup."""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from extract_v7_gift_exact_assets import (
    clean_wide_panel,
    erase_horizontal,
    exact_background,
    scaled_crop,
)
from generate_v7_runtime_skin import FONT_PATH, OUT, ROOT, save


REFERENCE = ROOT / "design-previews/2026-09-04-V7确认风格六页统一版/04-战绩.png"


def centered_text(image: Image.Image, center_x: int, text: str,
                  fill: tuple[int, int, int, int]) -> None:
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT_PATH), 27)
    box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(
        (center_x - width / 2, 34 - height / 2 - box[1]),
        text,
        font=font,
        fill=fill,
        stroke_width=1,
        stroke_fill=(3, 29, 49, 180),
    )


def tab_states(reference: Image.Image) -> dict[str, Image.Image]:
    exact = scaled_crop(reference, (54, 550, 878, 636), (656, 68)).convert("RGBA")

    # The accepted mockup provides the exact yesterday-selected state.  Build
    # the two interaction states from the same sampled blue field and gold pill.
    base = erase_horizontal(exact, 209, 447, 3, 66)
    for x0, x1 in ((58, 157), (274, 382), (487, 594)):
        base = erase_horizontal(base, x0, x1, 14, 56)

    pill = exact.crop((218, 5, 438, 64))
    pill = erase_horizontal(pill, 66, 157, 10, 53)
    mask = Image.new("L", pill.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (1, 1, pill.width - 2, pill.height - 2), radius=16, fill=255
    )

    centers = (109, 328, 547)
    labels = ("今日", "昨日", "前日")
    positions = (0, 218, 436)
    states: dict[str, Image.Image] = {}
    for key, selected in (("today", 0), ("yesterday", 1), ("before", 2)):
        if selected == 1:
            states[key] = exact.copy()
            continue
        state = base.copy()
        state.paste(pill, (positions[selected], 5), mask)
        for index, label in enumerate(labels):
            color = (8, 45, 73, 255) if index == selected else (229, 190, 143, 255)
            centered_text(state, centers[index], label, color)
        states[key] = state
    return states


def clean_record_row(reference: Image.Image) -> Image.Image:
    row = scaled_crop(reference, (25, 745, 913, 866), (708, 96)).convert("RGBA")
    for x0, x1 in ((108, 221), (250, 345), (408, 500), (565, 680)):
        row = erase_horizontal(row, x0, x1, 19, 76)
    return row


def clean_record_panel(reference: Image.Image) -> Image.Image:
    """Keep the accepted outer silhouette without baking six fake data rows."""
    panel = scaled_crop(reference, (17, 729, 923, 1635), (722, 722)).convert("RGBA")
    cleaned = clean_wide_panel(panel)
    # Strong vertical blur removes the six baked row slots; real row Prefabs
    # restore those exact cards only for records that actually exist.
    interior = cleaned.filter(ImageFilter.GaussianBlur(34))
    draw = ImageDraw.Draw(interior)
    draw.rounded_rectangle(
        (1, 1, 720, 720), radius=17,
        outline=(137, 132, 111, 205), width=1,
    )
    draw.rounded_rectangle(
        (3, 3, 718, 718), radius=15,
        outline=(27, 61, 81, 225), width=1,
    )
    return interior


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    reference = Image.open(REFERENCE).convert("RGB")
    if reference.size != (941, 1672):
        raise RuntimeError(f"04-战绩.png 尺寸异常: {reference.size}")

    save(exact_background(reference), "record_bg_exact.png")
    save(scaled_crop(reference, (0, 0, 941, 90), (750, 72)),
         "record_header_exact.png")
    save(scaled_crop(reference, (0, 90, 941, 551), (750, 368)),
         "record_hero_exact.png")

    for key, image in tab_states(reference).items():
        save(image, f"record_tabs_{key}_exact.png")

    save(scaled_crop(reference, (17, 651, 923, 730), (722, 63)),
         "record_table_header_exact.png")
    save(clean_record_panel(reference), "record_list_panel_exact.png", sliced=True)
    save(clean_record_row(reference), "record_row_exact.png")

    print("已从04-战绩确认稿提取标题、主视觉、日期栏、表头、列表和记录行资源。")


if __name__ == "__main__":
    main()
