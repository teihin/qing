"""Render a review-only club member redesign using the formal panelHongli art language.

This writes preview PNGs under temp/club-management.  It does not touch a Prefab.
The member rows use the same data slots that ClubManagementView already fills.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "assets" / "V7"
AVATARS = ROOT / "assets" / "resources" / "avatars"
OUT = ROOT / "temp" / "club-management"
FONT_PATH = ROOT / "assets" / "font" / "PingFF.ttf"
RECORD_HEADER = ASSET / "member_header_record_v8.png"
GOLD = (255, 239, 197, 255)
IVORY = (231, 240, 246, 255)
MUTED = (170, 202, 224, 255)
NUMBER = (255, 227, 117, 255)
GREEN = (129, 232, 177, 255)
RED = (237, 141, 113, 255)
NAVY = (7, 28, 52, 255)
CYAN = (62, 222, 245, 255)
PANEL = (12, 48, 79, 245)


def rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def art(name: str) -> Image.Image:
    return rgba(ASSET / name)


def frame(name: str) -> dict:
    meta = __import__("json").loads((ASSET / (name[:-4] + ".png.meta")).read_text())
    return meta["subMetas"].get(name[:-4], meta)


def nine_slice(image: Image.Image, size, borders: dict) -> Image.Image:
    width, height = image.size
    out_w, out_h = size
    left = int(borders.get("borderLeft", 0) or 0)
    right = int(borders.get("borderRight", 0) or 0)
    top = int(borders.get("borderTop", 0) or 0)
    bottom = int(borders.get("borderBottom", 0) or 0)
    if not any((left, right, top, bottom)):
        return image.resize(size, Image.Resampling.LANCZOS)
    xs = [0, left, width - right, width]
    ys = [0, top, height - bottom, height]
    dx = [0, left, out_w - right, out_w]
    dy = [0, top, out_h - bottom, out_h]
    result = Image.new("RGBA", size)
    for row in range(3):
        for col in range(3):
            part = image.crop((xs[col], ys[row], xs[col + 1], ys[row + 1]))
            target = (dx[col + 1] - dx[col], dy[row + 1] - dy[row])
            result.paste(part.resize(target, Image.Resampling.BILINEAR), (dx[col], dy[row]))
    return result


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def text(draw: ImageDraw.ImageDraw, xy, value: str, size: int, fill=IVORY,
         anchor="la", stroke=0):
    draw.text(xy, value, font=font(size), fill=fill, anchor=anchor,
              stroke_width=stroke, stroke_fill=(3, 17, 31, 230) if stroke else None)


def paste(canvas: Image.Image, image: Image.Image, box, sliced=False, asset_name=None):
    x, y, w, h = box
    resized = nine_slice(image, (round(w), round(h)), frame(asset_name)) if sliced else image.resize(
        (round(w), round(h)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized,
                           (round(x), round(y)))


def circle_avatar(canvas: Image.Image, path: Path, center, size: int):
    avatar = ImageOps.fit(rgba(path), (size, size), method=Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    avatar.putalpha(mask)
    canvas.alpha_composite(avatar, (round(center[0] - size / 2), round(center[1] - size / 2)))
    ring = Image.new("RGBA", (size + 8, size + 8), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse((2, 2, size + 5, size + 5), outline=GOLD, width=3)
    canvas.alpha_composite(ring, (round(center[0] - size / 2 - 4), round(center[1] - size / 2 - 4)))


def background() -> Image.Image:
    source = rgba(ASSET / "lobby_scene_long_v8.png")
    canvas = ImageOps.fit(source, (750, 1334), method=Image.Resampling.LANCZOS,
                          centering=(0.5, 0.36))
    dim = Image.new("RGBA", canvas.size, (0, 8, 22, 112))
    canvas.alpha_composite(dim)
    return canvas


def header(canvas: Image.Image, title: str):
    # The clean member header is derived from the formal 我的战绩 header:
    # same back arrow, curve, deep-blue material and champagne-gold rule,
    # with the record title and announcement copy removed.
    source = rgba(RECORD_HEADER).resize((750, 72), Image.Resampling.LANCZOS)
    canvas.alpha_composite(source, (0, 0))
    draw = ImageDraw.Draw(canvas)
    text(draw, (90, 36), title, 36, GOLD, anchor="lm", stroke=1)


def button(canvas: Image.Image, box, label: str, size=19, asset="agent_v8_button_base.png"):
    paste(canvas, art(asset), box, sliced=True, asset_name=asset)
    draw = ImageDraw.Draw(canvas)
    x, y, w, h = box
    text(draw, (x + w / 2, y + h / 2), label, size, GOLD, anchor="mm")


def dialog_button(canvas: Image.Image, box, label: str, size=20, gold=False):
    asset_name = "original_dialog_button_gold.png" if gold else "original_dialog_button_blue.png"
    paste(canvas, art(asset_name), box, sliced=True, asset_name=asset_name)
    x, y, w, h = box
    fill = NAVY if gold else IVORY
    text(ImageDraw.Draw(canvas), (x + w / 2, y + h / 2), label, size, fill, anchor="mm", stroke=1)


def gradient_box(canvas: Image.Image, box, top, bottom, outline, radius=18, width=2):
    x, y, w, h = [round(value) for value in box]
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pixels = layer.load()
    for row in range(h):
        ratio = row / max(1, h - 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(4))
        for col in range(w):
            pixels[col, row] = color
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    canvas.alpha_composite(Image.composite(layer, Image.new("RGBA", layer.size), mask), (x, y))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x, y, x + w - 1, y + h - 1), radius=radius,
                           outline=outline, width=width)


def action_button(canvas: Image.Image, box, label: str, accent="cyan"):
    if accent == "gold":
        gradient_box(canvas, box, (255, 190, 52, 255), (196, 103, 31, 255), (255, 226, 137, 255), radius=17)
        fill = (52, 33, 13, 255)
    else:
        gradient_box(canvas, box, (81, 222, 247, 255), (20, 143, 201, 255), (142, 244, 255, 255), radius=17)
        fill = NAVY
    x, y, w, h = box
    text(ImageDraw.Draw(canvas), (x + w / 2, y + h / 2), label, 21, fill, anchor="mm")


def badge(canvas: Image.Image, box, label: str, top, bottom, outline, fill=IVORY, size=16):
    gradient_box(canvas, box, top, bottom, outline, radius=12, width=1)
    x, y, w, h = box
    text(ImageDraw.Draw(canvas), (x + w / 2, y + h / 2), label, size, fill, anchor="mm", stroke=1)


def metric(draw: ImageDraw.ImageDraw, center_x: int, y: int, label: str, value: str):
    # Split label and number so both remain legible at the larger size and the
    # number can use the brighter data color without making the whole phrase
    # look washed out.
    text(draw, (center_x - 5, y), label, 20, (222, 247, 252, 255), anchor="rm", stroke=1)
    text(draw, (center_x + 5, y), value, 21, NUMBER, anchor="lm", stroke=1)


def setting_row(canvas: Image.Image, box, label: str, value: str, action: str = ""):
    x, y, w, h = box
    gradient_box(canvas, box, (18, 67, 99, 238), (8, 39, 66, 238), (45, 119, 158, 220), radius=14, width=1)
    draw = ImageDraw.Draw(canvas)
    text(draw, (x + 30, y + h / 2), label, 22, IVORY, anchor="lm")
    text(draw, (x + 250, y + h / 2), value, 22, NUMBER if value[:1].isdigit() else IVORY, anchor="lm")
    if action:
        dialog_button(canvas, (x + w - 148, y + 13, 126, h - 26), action, size=18)


def member_preview() -> Image.Image:
    canvas = background()
    header(canvas, "我的成员")
    draw = ImageDraw.Draw(canvas)

    paste(canvas, art("record_list_panel_exact.png"), (18, 99, 714, 86), sliced=True,
          asset_name="record_list_panel_exact.png")
    text(draw, (38, 142), "ddd   ID: 222697", 22, IVORY, anchor="lm", stroke=1)
    button(canvas, (555, 113, 160, 58), "入会申请", 18)

    paste(canvas, art("agent_v8_button_base.png"), (55, 198, 300, 48), sliced=True, asset_name="agent_v8_button_base.png")
    text(draw, (72, 222), "请输入玩家ID或昵称", 21, (177, 208, 229, 255), anchor="lm")
    button(canvas, (375, 198, 100, 48), "查询", 18)
    button(canvas, (495, 198, 100, 48), "重置", 18)

    # No separate table header: each card carries its complete metric label so
    # the meaning remains visible while scrolling and on small screens.
    paste(canvas, art("record_list_panel_exact.png"), (18, 260, 714, 774), sliced=True,
          asset_name="record_list_panel_exact.png")

    rows = [
        ("狐狸女", "639122", "馆主", "在线", "1", "1224", "+0", "0", "0", "0", "0", "0"),
        ("哈巴狗", "302007", "堂主", "离线", "0", "10", "0", "0", "0", "0", "0", "0"),
        ("天外飞仙", "237737", "成员", "在线", "3", "806", "+12", "43", "-8", "12", "+43", "86"),
    ]
    avatars = [AVATARS / "头像01.png", AVATARS / "头像14.png", AVATARS / "头像27.png"]
    for index, (name, player_id, role, state, team, points, today_win, today_contrib,
                yesterday_win, yesterday_contrib, total_win, total_contrib) in enumerate(rows):
        y = 260 + index * 204
        paste(canvas, art("record_row_exact.png"), (30, y, 690, 188), sliced=True, asset_name="record_row_exact.png")
        circle_avatar(canvas, avatars[index], (82, y + 70), 68)
        badge(canvas, (43, y + 106, 78, 27), role,
              (178, 79, 68, 245) if role == "馆主" else (202, 144, 41, 245),
              (118, 39, 39, 245) if role == "馆主" else (128, 79, 19, 245),
              (246, 179, 120, 220), fill=IVORY, size=15)
        badge(canvas, (43, y + 138, 78, 25), state,
              (24, 111, 91, 245) if state == "在线" else (33, 63, 86, 245),
              (10, 61, 61, 245) if state == "在线" else (18, 43, 64, 245),
              (66, 173, 156, 180) if state == "在线" else (65, 112, 140, 180),
              fill=GREEN if state == "在线" else MUTED, size=15)
        text(draw, (136, y + 34), name, 28, GOLD, anchor="la", stroke=1)
        text(draw, (136, y + 66), "ID: " + player_id, 20, IVORY, anchor="la")
        text(draw, (136, y + 101), "团队人数 " + team, 19, IVORY, anchor="la")
        text(draw, (136, y + 132), "积分 " + points, 21, NUMBER, anchor="la", stroke=1)
        metric(draw, 420, y + 48, "今日输赢", today_win)
        metric(draw, 635, y + 48, "今日贡献", today_contrib)
        metric(draw, 420, y + 88, "昨日输赢", yesterday_win)
        metric(draw, 635, y + 88, "昨日贡献", yesterday_contrib)
        metric(draw, 420, y + 128, "总输赢", total_win)
        metric(draw, 635, y + 128, "总贡献", total_contrib)

    paste(canvas, art("gift_pagination_exact.png"), (21, 1160, 708, 107), sliced=True,
          asset_name="gift_pagination_exact.png")
    text(draw, (375, 1213), "1 / 1", 29, IVORY, anchor="mm", stroke=1)
    return canvas


def settings_preview() -> Image.Image:
    canvas = member_preview()
    overlay = Image.new("RGBA", canvas.size, (0, 5, 15, 218))
    canvas.alpha_composite(overlay)
    draw = ImageDraw.Draw(canvas)
    popup = (38, 210, 674, 930)
    gradient_box(canvas, popup, (15, 58, 90, 252), (5, 27, 49, 252), (71, 164, 201, 255), radius=26, width=2)

    # Match the shared panelMsgView chrome: a centered title plaque, dark blue
    # panel body, warm gold edge and blue/gold action buttons.
    paste(canvas, art("original_dialog_title.png"), (158, 166, 434, 92),
          sliced=True, asset_name="original_dialog_title.png")
    text(draw, (375, 212), "玩家信息", 36, IVORY, anchor="mm", stroke=1)
    close = art("popup_close_exact.png").resize((56, 56), Image.Resampling.LANCZOS)
    canvas.alpha_composite(close, (638, 184))

    # Player identity and the two high-priority actions.
    circle_avatar(canvas, AVATARS / "头像14.png", (126, 365), 106)
    text(draw, (204, 319), "哈巴狗", 28, IVORY, anchor="la", stroke=1)
    text(draw, (204, 365), "ID: 302007", 22, IVORY, anchor="la")
    copy = art("player_info_v8_copy.png").resize((25, 27), Image.Resampling.LANCZOS)
    canvas.alpha_composite(copy, (348, 351))
    gradient_box(canvas, (82, 423, 250, 58), (6, 27, 52, 235), (16, 61, 93, 235),
                 (226, 189, 112, 230), radius=28, width=2)
    text(draw, (108, 452), "积分", 20, MUTED, anchor="lm")
    text(draw, (205, 452), "10", 29, NUMBER, anchor="mm", stroke=1)
    dialog_button(canvas, (466, 314, 202, 66), "调整分数", size=21)
    dialog_button(canvas, (466, 392, 202, 66), "踢出俱乐部", size=21, gold=True)

    # Minimal text tabs keep the common popup palette without adding another
    # framed panel on top of the clean body.
    text(draw, (210, 549), "成员设置", 25, IVORY, anchor="mm", stroke=1)
    draw.line((93, 581, 327, 581), fill=(224, 188, 112, 235), width=3)
    text(draw, (505, 549), "下级成员", 25, (143, 177, 199, 255), anchor="mm")
    draw.line((395, 581, 615, 581), fill=(58, 107, 139, 170), width=1)

    setting_row(canvas, (62, 616, 626, 82), "备注", "未设置", "备注")
    setting_row(canvas, (62, 714, 626, 82), "比例", "100%", "调整")

    x, y, w, h = (62, 812, 626, 82)
    gradient_box(canvas, (x, y, w, h), (18, 67, 99, 238), (8, 39, 66, 238),
                 (45, 119, 158, 220), radius=14, width=1)
    text(draw, (x + 30, y + h / 2), "开通代理", 22, IVORY, anchor="lm", stroke=1)
    text(draw, (x + w - 138, y + h / 2), "开", 21, GREEN, anchor="mm", stroke=1)
    toggle = art("settings_v8_toggle_on.png").resize((78, 44), Image.Resampling.LANCZOS)
    canvas.alpha_composite(toggle, (x + w - 106, y + 19))
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    member_preview().save(OUT / "members-hongli-preview-v11.png")
    settings_preview().save(OUT / "player-settings-hongli-preview-v11.png")
    print("Rendered larger high-contrast member metrics v10")


if __name__ == "__main__":
    main()
