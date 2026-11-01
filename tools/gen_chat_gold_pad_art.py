"""生成 1 对 1 聊天「上下分」入口图标与上下分弹窗美术。

只产出 PNG 到 assets/ImagesLuck/聊天/ 与 assets/ImagesLuck/上下分/，不修改 .meta / prefab。
用法：python tools/gen_chat_gold_pad_art.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT_DIR = os.path.join(ROOT, "assets/ImagesLuck/聊天")
PAD_DIR = os.path.join(ROOT, "assets/ImagesLuck/上下分")


# ---------------- 基础工具 ----------------
def rrect_mask(W, H, r, feather=1.0):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    x += 0.5
    y += 0.5
    cx = np.clip(x, r, W - r)
    cy = np.clip(y, r, H - r)
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r
    return np.clip(0.5 - d / max(feather, 0.01), 0, 1)


def vgrad(W, H, stops):
    ys = np.linspace(0, 1, H).astype(np.float32)
    out = np.zeros((H, 3), np.float32)
    out[:] = stops[0][1]
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        seg = (ys >= p0) & (ys <= p1)
        t = np.zeros_like(ys)
        t[seg] = (ys[seg] - p0) / max(p1 - p0, 1e-6)
        for k in range(3):
            out[seg, k] = c0[k] + (c1[k] - c0[k]) * t[seg]
    return np.repeat(out[:, None, :], W, axis=1)


def blank(W, H):
    return np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32)


def over(dst, rgb, alpha):
    drgb, da = dst
    a = np.clip(alpha, 0, 1)[..., None]
    out = rgb * a + drgb * (1 - a)
    oa = np.clip(alpha, 0, 1) + da * (1 - np.clip(alpha, 0, 1))
    return out, oa


def flat(W, H, color):
    return np.ones((H, W, 3), np.float32) * np.array(color, np.float32)


def to_image(rgb, alpha):
    arr = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def save(img, path):
    img.save(path, optimize=True)
    print("%-40s %7d B" % (os.path.relpath(path, ROOT), os.path.getsize(path)))


def glow(mask, radius, strength=1.0):
    m = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), "L")
    b = np.array(m.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255
    return np.clip((b - mask) * strength, 0, 1)


def soft_light(W, H, cx_ratio, cy_ratio, rx, ry, strength):
    """椭圆形柔光，返回 alpha 蒙版。"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xx - W * cx_ratio) / rx
    ny = (yy - H * cy_ratio) / ry
    d = np.sqrt(nx ** 2 + ny ** 2)
    return np.clip(1 - d, 0, 1) ** 2 * strength


# ---------------- 配色 ----------------
CYAN = (122, 217, 247)
CYAN_SOFT = (58, 156, 204)
GOLD_LIGHT = (252, 231, 178)
GOLD = (235, 190, 102)
GOLD_DEEP = (196, 141, 55)


# ---------------- 1. 弹窗面板（九宫格，2x） ----------------
def panel(path, W=634, H=866, scale=2):
    w, h = W * scale, H * scale
    r = 36 * scale
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (13, 52, 88)), (0.28, (10, 45, 76)),
                                         (0.66, (8, 38, 66)), (1.0, (7, 30, 54))]), m)
    # 顶部柔光
    lt = soft_light(w, h, 0.5, 0.06, w * 0.62, h * 0.30, 0.30)
    rgb, a = over((rgb, a), flat(w, h, (150, 215, 255)), lt * m)
    # 底部轻微提亮（反射光）
    lb = soft_light(w, h, 0.5, 1.02, w * 0.55, h * 0.18, 0.16)
    rgb, a = over((rgb, a), flat(w, h, (96, 180, 226)), lb * m)
    # 描边内侧 3px 暗线，让边框更有层次
    band = np.clip(m - rrect_mask(w, h, r - 4.0 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (0, 10, 22)), band * 0.28)
    # 青色描边
    ring = np.clip(m - rrect_mask(w, h, r - 3.2 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, CYAN), ring)
    # 外发光
    rgb, a = over((rgb, a), flat(w, h, CYAN_SOFT), glow(m, 6 * scale) * 0.85)
    save(to_image(rgb, a), path)


# ---------------- 2. 输入框（九宫格，2x） ----------------
def input_box(path, W=400, H=74, scale=2):
    w, h = W * scale, H * scale
    r = 13 * scale
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (4, 28, 48)), (1.0, (7, 40, 66))]), m)
    ring = np.clip(m - rrect_mask(w, h, r - 2.8 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (112, 216, 246)), ring)
    save(to_image(rgb, a), path)


# ---------------- 3. 快捷金额胶囊（SIMPLE，2x） ----------------
def chip(path, W=170, H=58, scale=2):
    w, h = W * scale, H * scale
    r = h / 2
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (30, 88, 132)), (0.5, (18, 62, 98)), (1.0, (11, 42, 70))]), m)
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32) / h
    rgb, a = over((rgb, a), flat(w, h, (140, 200, 240)),
                  np.clip(1 - np.abs(yy - 0.16) / 0.30, 0, 1) ** 2 * m * 0.16)
    ring = np.clip(m - rrect_mask(w, h, r - 2.0 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (216, 172, 108)), ring * 0.95)
    save(to_image(rgb, a), path)


# ---------------- 4. 金色主按钮（SIMPLE，2x） ----------------
def btn_gold(path, W=268, H=78, scale=2):
    w, h = W * scale, H * scale
    r = h / 2
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, GOLD_LIGHT), (0.26, (247, 212, 143)),
                                         (0.60, GOLD), (1.0, GOLD_DEEP)]), m)
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32) / h
    hl = np.clip(1 - np.abs(yy - 0.18) / 0.22, 0, 1) ** 2 * m * 0.34
    rgb, a = over((rgb, a), flat(w, h, (255, 250, 226)), hl)
    # 下沿暗边增强体积
    dk = np.clip((yy - 0.80) / 0.20, 0, 1) ** 1.5 * m * 0.22
    rgb, a = over((rgb, a), flat(w, h, (150, 96, 30)), dk)
    # 内亮描边
    ring = np.clip(m - rrect_mask(w, h, r - 2.2 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (255, 244, 208)), ring * 0.5)
    # 外暗描边
    outer = np.clip(rrect_mask(w, h, r + 1.2) - rrect_mask(w, h, r - 1.4 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (116, 74, 24)), outer * 0.5)
    save(to_image(rgb, a), path)


# ---------------- 5. 描边次按钮（SIMPLE，2x） ----------------
def btn_line(path, W=268, H=78, scale=2):
    w, h = W * scale, H * scale
    r = h / 2
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (24, 72, 110)), (1.0, (10, 40, 66))]), m)
    ring = np.clip(m - rrect_mask(w, h, r - 2.4 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (222, 178, 110)), ring * 0.95)
    save(to_image(rgb, a), path)


# ---------------- 6. 关闭按钮（SIMPLE，2x） ----------------
def close_btn(path, D=64, scale=2):
    w = h = D * scale
    r = w / 2
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (20, 68, 104)), (1.0, (6, 30, 52))]), m)
    ring = np.clip(m - rrect_mask(w, h, r - 2.2 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (232, 190, 126)), ring)
    img = to_image(rgb, a)
    d = ImageDraw.Draw(img)
    col = (247, 222, 178, 255)
    cx = cy = w / 2
    L = 9.2 * scale
    wd = 2.8 * scale
    for sx, sy in ((1, 1), (1, -1)):
        d.line([cx - L, cy - L * sy, cx + L, cy + L * sy], fill=col, width=int(round(wd)))
    rr = wd / 2
    for px, py in ((cx - L, cy - L), (cx + L, cy + L), (cx - L, cy + L), (cx + L, cy - L)):
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col)
    save(img, path)


# ---------------- 7. 标题分割线（SIMPLE，2x） ----------------
def divider(path, W=520, H=30, scale=2):
    w, h = W * scale, H * scale
    rgb, a = blank(w, h)
    cy = h / 2
    half = w / 2
    gem = 8.0 * scale
    xs = np.arange(w, dtype=np.float32) + 0.5
    dist = np.abs(xs - half)
    fade = np.clip((dist - gem * 1.5) / (half * 0.62), 0, 1) ** 0.7 * 0.95
    ygrid = np.abs(np.mgrid[0:h, 0:w][0].astype(np.float32) + 0.5 - cy)
    line = fade[None, :] * np.clip(1 - ygrid / (1.3 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, GOLD), line)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    yy += 0.5
    xx += 0.5
    dia = np.abs(xx - half) / gem + np.abs(yy - cy) / (gem * 0.9)
    dm = np.clip((1.0 - dia) * gem, 0, 1)
    rgb, a = over((rgb, a), flat(w, h, GOLD_LIGHT), dm)
    save(to_image(rgb, a), path)


# ---------------- 8. 节标题金色竖条（SIMPLE，3x） ----------------
def bar(path, W=7, H=34, scale=3):
    w, h = W * scale, H * scale
    m = rrect_mask(w, h, w / 2)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, GOLD_LIGHT), (0.5, GOLD), (1.0, GOLD_DEEP)]), m)
    save(to_image(rgb, a), path)


# ---------------- 9. 锁图标（SIMPLE，2x） ----------------
def lock(path, D=40, scale=2):
    w = h = D * scale
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    col = GOLD + (255,)
    u = scale
    lw = int(round(2.6 * u))
    d.arc([12 * u, 5 * u, 28 * u, 24 * u], 180, 360, fill=col, width=lw)
    d.line([12 * u, 14 * u, 12 * u, 20 * u], fill=col, width=lw)
    d.line([28 * u, 14 * u, 28 * u, 20 * u], fill=col, width=lw)
    d.rounded_rectangle([8 * u, 19 * u, 32 * u, 35 * u], radius=3 * u, outline=col, width=lw)
    d.ellipse([18.2 * u, 23.4 * u, 21.8 * u, 27 * u], fill=col)
    d.line([20 * u, 25.8 * u, 20 * u, 30 * u], fill=col, width=int(round(2.2 * u)))
    save(img, path)


# ---------------- 10. 头像金环（SIMPLE，2x） ----------------
def avatar_ring(path, D=84, scale=2):
    w = h = D * scale
    r = w / 2
    ring = np.clip(rrect_mask(w, h, r) - rrect_mask(w, h, r - 2.8 * scale), 0, 1)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, GOLD_LIGHT), (0.5, GOLD), (1.0, GOLD_DEEP)]), ring)
    save(to_image(rgb, a), path)


# ---------------- 10c. 聊天页系统消息底图（上下分成功通知） ----------------
def system_notice(path, W=620, H=104, scale=2):
    """居中的系统通报条：深蓝底 + 暗金细边 + 左侧金色竖条，区别于左右聊天气泡。"""
    w, h = W * scale, H * scale
    r = 16 * scale
    m = rrect_mask(w, h, r)
    rgb, a = blank(w, h)
    rgb, a = over((rgb, a), vgrad(w, h, [(0.0, (14, 46, 78)), (0.45, (10, 36, 62)), (1.0, (6, 24, 42))]), m)
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32) / h
    rgb, a = over((rgb, a), flat(w, h, (150, 210, 250)),
                  np.clip(1 - yy / 0.32, 0, 1) ** 2 * m * 0.10)
    # 暗金描边
    ring = np.clip(m - rrect_mask(w, h, r - 1.6 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (214, 172, 104)), ring * 0.92)
    # 内侧压边阴影
    inner = np.clip(rrect_mask(w, h, r - 1.6 * scale) - rrect_mask(w, h, r - 4.0 * scale), 0, 1)
    rgb, a = over((rgb, a), flat(w, h, (0, 12, 24)), inner * 0.20)
    # 左侧金色竖条（上亮下暗，两端收圆）
    bar_w = 4.0 * scale
    bar_h = h * 0.52
    bx = 14 * scale
    by0 = (h - bar_h) / 2
    bm = np.zeros((h, w), np.float32)
    bm[int(by0):int(by0 + bar_h), int(bx):int(bx + bar_w)] = 1
    # 简易圆角：用圆角矩形蒙版裁
    bm *= rrect_mask(w, h, 0)  # 占位，保持形状
    ygrid = np.mgrid[0:h, 0:w][0].astype(np.float32)
    bm = bm * np.clip(1 - np.abs(ygrid - h / 2) / (bar_h / 2), 0, 1) ** 0.35
    rgb, a = over((rgb, a), flat(w, h, GOLD_LIGHT), bm)
    save(to_image(rgb, a), path)


# ---------------- 10b. 美术字（标题 / 按钮文案） ----------------
FONT_FILE = os.path.join(ROOT, "assets/font/PingFF.ttf")


def fancy_text(path, text, show_size, fill_stops, stroke_color, stroke_w=1.4,
               shadow=(0, 9, 22, 150), shadow_off=(0, 2), scale=2, super_ss=2,
               bold=1.8):
    """把文字渲染成带加粗 + 渐变填充 + 描边 + 投影的美术字贴图（输出 scale 倍贴图）。

    PingFF 只有常规字重，这里用同色 stroke 把字重顶上去（bold，设计像素），
    再额外加 stroke_w 的外描边，得到「粗 + 描边 + 金属渐变」的美术字。
    show_size 是设计稿里的 fontSize，贴图宽高 = 实际像素，节点尺寸取 1/scale。
    """
    from PIL import ImageFont
    render = show_size * scale * super_ss
    font = ImageFont.truetype(FONT_FILE, render)
    u = scale * super_ss
    sw_bold = bold * u
    sw_edge = stroke_w * u

    probe = ImageDraw.Draw(Image.new("L", (8, 8)))
    bbox = probe.textbbox((0, 0), text, font=font, stroke_width=int(round(sw_bold + sw_edge)))
    pad = int(round(sw_bold + sw_edge)) + int(5 * u)
    W = bbox[2] - bbox[0] + pad * 2
    H = bbox[3] - bbox[1] + pad * 2
    origin = (pad - bbox[0], pad - bbox[1])

    def text_layer(fill, stroke_fill, width):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text(origin, text, font=font, fill=fill,
                                   stroke_width=int(round(width)), stroke_fill=stroke_fill)
        return layer

    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # 投影（用最外轮廓）
    if shadow is not None and shadow[3] > 0:
        sc = (shadow[0], shadow[1], shadow[2], 255)
        sh = text_layer(sc, sc, sw_bold + sw_edge)
        sh = sh.filter(ImageFilter.GaussianBlur(1.2 * u))
        sh.putalpha(sh.split()[-1].point(lambda v: int(v * shadow[3] / 255)))
        canvas.alpha_composite(sh, (int(shadow_off[0] * u), int(shadow_off[1] * u)))
    # 外描边层（比字形大一圈）
    canvas.alpha_composite(text_layer(stroke_color + (255,), stroke_color + (255,), sw_bold + sw_edge))
    # 渐变填充层（加粗后的字形）
    glyph = text_layer((255, 255, 255, 255), (255, 255, 255, 255), sw_bold)
    mask = np.array(glyph.split()[-1]).astype(np.float32) / 255
    grad = vgrad(W, H, fill_stops)
    yy = np.linspace(0, 1, H).astype(np.float32)[:, None]
    shade = np.where(yy < 0.52, 1 + (0.52 - yy) * 0.26, 1 - (yy - 0.52) * 0.16)
    grad = np.clip(grad * shade[..., None], 0, 255)
    # 顶部高光带（金属反光）
    spec = np.clip(1 - np.abs(yy - 0.20) / 0.13, 0, 1) ** 2
    grad = np.clip(grad + spec[..., None] * 90 * mask[..., None], 0, 255)
    canvas.alpha_composite(to_image(grad, mask))

    if super_ss > 1:
        canvas = canvas.resize((W // super_ss, H // super_ss), Image.LANCZOS)
    save(canvas, path)



# ---------------- 11b. 赠送积分入口图标（同款底框 + 金色线稿礼盒） ----------------
def icon_give(path):
    gold = (224, 170, 68, 255)
    base_col = (40, 55, 80, 255)
    SS = 4
    W = 128
    S = W * SS
    ic = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ic)
    k = SS
    lw = int(round(3.2 * k))
    # 盖子
    d.rounded_rectangle([27 * k, 44 * k, 101 * k, 63 * k], radius=3 * k, outline=gold, width=lw)
    # 盒身
    d.rounded_rectangle([36 * k, 63 * k, 92 * k, 100 * k], radius=3 * k, outline=gold, width=lw)
    # 竖丝带
    d.line([64 * k, 63 * k, 64 * k, 100 * k], fill=gold, width=lw)
    # 蝴蝶结：两个环 + 中心结
    d.ellipse([45 * k, 27 * k, 63.5 * k, 45 * k], outline=gold, width=lw)
    d.ellipse([64.5 * k, 27 * k, 83 * k, 45 * k], outline=gold, width=lw)
    d.ellipse([60.5 * k, 34 * k, 67.5 * k, 41 * k], fill=gold)
    ic = ic.resize((W, W), Image.LANCZOS)

    base = Image.open(os.path.join(CHAT_DIR, "拍照上传.png")).convert("RGBA")
    tmp = base.copy()
    ImageDraw.Draw(tmp).rectangle([22, 22, 105, 105], fill=base_col)
    save(Image.alpha_composite(tmp, ic), path)


# ---------------- 11. 上下分入口图标（复用拍照上传底框像素） ----------------
def icon_entry(path):
    gold = (224, 170, 68, 255)
    base_col = (40, 55, 80, 255)
    SS = 4
    W = 128

    def thick_line(d, p0, p1, w, color):
        d.line([p0, p1], fill=color, width=int(round(w)))
        rr = w / 2
        for p in (p0, p1):
            d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=color)

    def arrow(d, x, y0, y1, w, head_w, head_h, color):
        dirn = -1 if y1 < y0 else 1
        ty = y1 - dirn * head_h
        thick_line(d, (x, y0), (x, ty), w, color)
        d.polygon([(x, y1), (x - head_w / 2, ty), (x + head_w / 2, ty)], fill=color)

    S = W * SS
    ic = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ic)
    k = SS
    wl = 3.4 * k
    cx, cy, R = 53 * k, 64 * k, 24 * k
    d.ellipse([cx - R + wl / 2, cy - R + wl / 2, cx + R - wl / 2, cy + R - wl / 2],
              outline=gold, width=int(round(wl)))
    hole = 8.8 * k
    d.rounded_rectangle([cx - hole, cy - hole, cx + hole, cy + hole],
                        radius=1.8 * k, outline=gold, width=int(wl * 0.92))
    ax = 90 * k
    arrow(d, ax, 55 * k, 26 * k, 4.0 * k, 16 * k, 8.5 * k, gold)
    arrow(d, ax, 73 * k, 102 * k, 4.0 * k, 16 * k, 8.5 * k, gold)
    ic = ic.resize((W, W), Image.LANCZOS)

    base = Image.open(os.path.join(CHAT_DIR, "拍照上传.png")).convert("RGBA")
    tmp = base.copy()
    ImageDraw.Draw(tmp).rectangle([22, 22, 105, 105], fill=base_col)
    save(Image.alpha_composite(tmp, ic), path)


def main():
    os.makedirs(PAD_DIR, exist_ok=True)
    panel(os.path.join(PAD_DIR, "gd_panel.png"))
    input_box(os.path.join(PAD_DIR, "gd_input.png"))
    chip(os.path.join(PAD_DIR, "gd_chip.png"))
    btn_gold(os.path.join(PAD_DIR, "gd_btn_gold.png"))
    btn_line(os.path.join(PAD_DIR, "gd_btn_line.png"))
    close_btn(os.path.join(PAD_DIR, "gd_close.png"))
    divider(os.path.join(PAD_DIR, "gd_divider.png"))
    bar(os.path.join(PAD_DIR, "gd_bar.png"))
    lock(os.path.join(PAD_DIR, "gd_lock.png"))
    avatar_ring(os.path.join(PAD_DIR, "gd_avatar_ring.png"))

    # 美术字：标题金色渐变 + 深蓝描边；上分为金底上的深蓝字；下分为深底上的金字
    fancy_text(os.path.join(PAD_DIR, "gd_txt_title.png"), "上下分", 48,
               [(0.0, (255, 253, 242)), (0.28, (253, 236, 187)),
                (0.55, (245, 206, 129)), (0.78, (230, 176, 88)), (1.0, (207, 146, 58))],
               (16, 44, 74), stroke_w=1.6, shadow=(3, 10, 22, 170), shadow_off=(0, 2.6), bold=2.4)
    fancy_text(os.path.join(PAD_DIR, "gd_txt_up.png"), "上分", 30,
               [(0.0, (36, 78, 120)), (0.50, (19, 50, 84)), (1.0, (9, 28, 50))],
               (245, 220, 168), stroke_w=0.6, shadow=None, bold=1.1)
    fancy_text(os.path.join(PAD_DIR, "gd_txt_give.png"), "赠送积分", 44,
               [(0.0, (255, 253, 242)), (0.28, (253, 236, 187)),
                (0.55, (245, 206, 129)), (0.78, (230, 176, 88)), (1.0, (207, 146, 58))],
               (16, 44, 74), stroke_w=1.0, shadow=(3, 10, 22, 170), shadow_off=(0, 1.8), bold=1.2)
    fancy_text(os.path.join(PAD_DIR, "gd_txt_give_btn.png"), "确认赠送", 30,
               [(0.0, (36, 78, 120)), (0.50, (19, 50, 84)), (1.0, (9, 28, 50))],
               (245, 220, 168), stroke_w=0.6, shadow=None, bold=1.1)
    fancy_text(os.path.join(PAD_DIR, "gd_txt_down.png"), "下分", 30,
               [(0.0, (255, 253, 242)), (0.28, (253, 236, 187)),
                (0.55, (245, 206, 129)), (1.0, (207, 146, 58))],
               (16, 44, 74), stroke_w=1.1, shadow=(3, 10, 22, 150), shadow_off=(0, 2), bold=1.8)
    system_notice(os.path.join(CHAT_DIR, "系统消息底.png"))
    icon_entry(os.path.join(CHAT_DIR, "上下分.png"))
    icon_give(os.path.join(CHAT_DIR, "赠送积分.png"))


if __name__ == "__main__":
    main()
