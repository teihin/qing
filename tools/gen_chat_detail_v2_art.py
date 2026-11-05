#!/usr/bin/env python3
"""生成私聊详情 V2 皮肤资源。

只替换下列既有 PNG（尺寸与 .meta/UUID 不变），另新增「清除聊天」图标：
  消息左气泡 384x128(九宫格30) / 消息右气泡 384x128 / 系统消息底 1240x208
  输入框 129x84(左右42) / 发送按钮 153x102 / 返回箭头 96x96 / 删除图标 96x96
  清除聊天 128x128（新增，需配套 .meta）

绘制统一 4 倍超采样后缩放，避免细边发虚。
"""

import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "ImagesLuck", "聊天")
SS = 4

GOLD = (245, 196, 106)
GOLD_LIGHT = (255, 236, 190)
GOLD_DEEP = (198, 141, 61)


def canvas(size):
    return Image.new("RGBA", (size[0] * SS, size[1] * SS), (0, 0, 0, 0))


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255
    )
    return mask


def vertical_gradient(size, stops):
    """stops: [(pos, (r,g,b,a)), ...] pos 0..1"""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    h = size[1]
    for y in range(h):
        t = 0 if h <= 1 else y / (h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                color = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(4))
                draw.line([(0, y), (size[0], y)], fill=color)
                break
    return img


def panel(size, radius, stops, border, border_w=3, highlight=None, gloss=None):
    body = vertical_gradient(size, stops)
    mask = rounded_mask(size, radius)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(body, (0, 0), mask)
    if gloss:
        # 顶部柔和反光：大椭圆 + 高斯模糊，避免出现明显的弧线。
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        gx0, gx1 = -size[0] * 0.25, size[0] * 1.25
        gy0, gy1 = -size[1] * 1.05, size[1] * 0.28
        ld.ellipse([gx0, gy0, gx1, gy1], fill=gloss)
        layer = layer.filter(ImageFilter.GaussianBlur(radius=size[1] * 0.06))
        layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", size, 0), mask))
        out = Image.alpha_composite(out, layer)
    if border:
        draw = ImageDraw.Draw(out)
        draw.rounded_rectangle(
            [border_w // 2, border_w // 2, size[0] - 1 - border_w // 2, size[1] - 1 - border_w // 2],
            radius=radius, outline=border, width=border_w,
        )
    return out


def save(img, name, size):
    out = img.resize(size, Image.LANCZOS)
    out.save(os.path.join(OUT, name))


def bubble_left():
    size = (384 * SS, 128 * SS)
    img = panel(
        size, 18 * SS,
        [(0.0, (24, 72, 116, 255)), (0.45, (13, 46, 78, 255)), (1.0, (7, 26, 46, 255))],
        border=(84, 162, 226, 140), border_w=3 * SS,
        gloss=(150, 210, 255, 46),
    )
    save(img, "消息左气泡.png", (384, 128))


def bubble_right():
    size = (384 * SS, 128 * SS)
    img = panel(
        size, 18 * SS,
        [(0.0, (255, 238, 198, 255)), (0.3, (250, 208, 132, 255)),
         (0.68, (232, 172, 82, 255)), (1.0, (206, 141, 50, 255))],
        border=(255, 238, 196, 200), border_w=3 * SS,
        gloss=(255, 255, 255, 40),
    )
    save(img, "消息右气泡.png", (384, 128))


def bubble_system():
    size = (1240 * SS, 208 * SS)
    img = panel(
        size, 30 * SS,
        [(0.0, (18, 58, 96, 250)), (0.55, (10, 34, 58, 250)), (1.0, (6, 22, 40, 250))],
        border=(110, 180, 250, 90), border_w=2 * SS,
        gloss=(150, 210, 255, 34),
    )
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [16 * SS, 18 * SS, 26 * SS, (208 - 18) * SS], radius=5 * SS,
        fill=(246, 205, 128, 255),
    )
    save(img, "系统消息底.png", (1240, 208))


def input_box():
    size = (129 * SS, 84 * SS)
    img = panel(
        size, 17 * SS,
        [(0.0, (3, 13, 24, 255)), (1.0, (5, 18, 32, 255))],
        border=(96, 160, 225, 90), border_w=2 * SS,
        gloss=(120, 190, 245, 26),
    )
    save(img, "输入框.png", (129, 84))


def send_button():
    size = (153 * SS, 102 * SS)
    img = panel(
        size, 24 * SS,
        [(0.0, (255, 236, 194, 255)), (0.3, (250, 208, 132, 255)),
         (0.72, (234, 174, 84, 255)), (1.0, (204, 140, 49, 255))],
        border=(255, 240, 200, 230), border_w=3 * SS,
        gloss=(255, 255, 255, 40),
    )
    save(img, "发送按钮.png", (153, 102))


def circle_button(name, icon):
    size = (96 * SS, 96 * SS)
    img = panel(
        size, 44 * SS,
        [(0.0, (30, 70, 108, 250)), (0.55, (13, 40, 66, 250)), (1.0, (7, 24, 42, 250))],
        border=(246, 205, 128, 170), border_w=2 * SS,
        gloss=(150, 210, 255, 46),
    )
    draw = ImageDraw.Draw(img)
    icon(draw, 96 * SS)
    save(img, name, (96, 96))


def draw_back(draw, s):
    w = int(3.2 * SS)
    pts = [(58 * SS, 28 * SS), (38 * SS, 48 * SS), (58 * SS, 68 * SS)]
    draw.line(pts, fill=GOLD, width=w, joint="curve")
    draw.ellipse([pts[0][0] - w // 2, pts[0][1] - w // 2, pts[0][0] + w // 2, pts[0][1] + w // 2], fill=GOLD)
    draw.ellipse([pts[2][0] - w // 2, pts[2][1] - w // 2, pts[2][0] + w // 2, pts[2][1] + w // 2], fill=GOLD)


def draw_trash(draw, s):
    w = int(2.4 * SS)
    draw.line([(31 * SS, 33 * SS), (65 * SS, 33 * SS)], fill=GOLD, width=w)
    draw.rounded_rectangle([43 * SS, 25 * SS, 53 * SS, 33 * SS], radius=2 * SS, outline=GOLD, width=w)
    draw.rounded_rectangle([36 * SS, 39 * SS, 60 * SS, 72 * SS], radius=4 * SS, outline=GOLD, width=w)
    draw.line([(44 * SS, 47 * SS), (44 * SS, 64 * SS)], fill=GOLD, width=w)
    draw.line([(52 * SS, 47 * SS), (52 * SS, 64 * SS)], fill=GOLD, width=w)


def clear_tile():
    size = (128 * SS, 128 * SS)
    img = panel(
        size, 18 * SS,
        [(0.0, (48, 66, 94, 255)), (0.5, (39, 54, 79, 255)), (1.0, (28, 40, 59, 255))],
        border=(245, 196, 106, 190), border_w=int(2.2 * SS),
        gloss=(150, 200, 245, 40),
    )
    draw = ImageDraw.Draw(img)
    w = int(2.6 * SS)
    # 对话气泡 + 清除叉
    draw.rounded_rectangle([30 * SS, 34 * SS, 98 * SS, 82 * SS], radius=15 * SS, outline=GOLD, width=w)
    draw.line([(44 * SS, 81 * SS), (44 * SS, 96 * SS), (58 * SS, 81 * SS)], fill=GOLD, width=w, joint="curve")
    draw.line([(54 * SS, 48 * SS), (74 * SS, 68 * SS)], fill=GOLD, width=w)
    draw.line([(74 * SS, 48 * SS), (54 * SS, 68 * SS)], fill=GOLD, width=w)
    save(img, "清除聊天.png", (128, 128))


def main():
    os.makedirs(OUT, exist_ok=True)
    bubble_left()
    bubble_right()
    bubble_system()
    input_box()
    send_button()
    circle_button("返回圆钮.png", draw_back)
    circle_button("删除图标.png", draw_trash)
    clear_tile()
    print("written to", OUT)


if __name__ == "__main__":
    main()
