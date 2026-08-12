#!/usr/bin/env python3
"""Generate the translucent table spotlight used by the betting turn indicator."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/resources/other/drh/下注聚光灯.png"
WIDTH = 220
HEIGHT = 560


def make_cone() -> Image.Image:
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    body = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    center_x = (WIDTH - 1) / 2

    glow_pixels = glow.load()
    body_pixels = body.load()
    for y in range(HEIGHT):
        # The node anchor is on the texture's bottom edge. In Cocos, that
        # bottom edge is the table-center origin and the PNG top faces the
        # player, so the cone must be narrow at the bottom and wide at the top.
        progress = (HEIGHT - 1 - y) / (HEIGHT - 1)
        # Keep the player-facing end close to the 90px avatar diameter instead
        # of covering a large part of the table.
        half_width = 6 + 54 * (progress ** 0.9)
        glow_width = half_width + 14
        vertical = 0.28 + 0.72 * (progress ** 0.68)
        # Fade the last 52px into the avatar so the wide end has no horizontal
        # cut line. y=0 is the player-facing edge of the PNG.
        end_fade_t = min(1.0, max(0.0, y / 52.0))
        end_fade = end_fade_t * end_fade_t * (3 - 2 * end_fade_t)

        for x in range(WIDTH):
            distance = abs(x - center_x)
            if distance <= glow_width:
                glow_edge = max(0.0, 1.0 - distance / glow_width)
                glow_alpha = int(42 * vertical * (glow_edge ** 1.8) * end_fade)
                glow_pixels[x, y] = (38, 196, 236, glow_alpha)

            if distance <= half_width:
                edge = max(0.0, 1.0 - distance / half_width)
                soft_edge = edge * edge * (3 - 2 * edge)
                center_ray = max(0.0, 1.0 - distance / max(9.0, half_width * 0.22))
                alpha = int(((32 + 66 * vertical) * soft_edge + 30 * center_ray * vertical) * end_fade)
                red = int(100 + 95 * center_ray)
                green = int(218 + 29 * center_ray)
                blue = 255
                body_pixels[x, y] = (red, green, blue, min(alpha, 148))

    glow = glow.filter(ImageFilter.GaussianBlur(radius=8))
    result = Image.alpha_composite(glow, body)

    origin = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(origin)
    origin_y = HEIGHT - 4
    for radius, alpha in ((28, 18), (18, 36), (10, 82), (4, 170)):
        draw.ellipse(
            (center_x - radius, origin_y - radius, center_x + radius, origin_y + radius),
            fill=(132, 239, 255, alpha),
        )
    origin = origin.filter(ImageFilter.GaussianBlur(radius=4))
    return Image.alpha_composite(result, origin)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    make_cone().save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
