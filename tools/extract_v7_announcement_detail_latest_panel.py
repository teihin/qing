#!/usr/bin/env python3
"""Extract the approved latest-announcement viewport panel at runtime size.

The source is the user-approved V2 effect image.  We only remove its separate
100-pixel title bar and resize the remaining panel to the 750-wide Cocos
design space; no text or visual element is redrawn.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design-previews/2026-09-04-V7公告详情四页效果图-v2/01-最新公告.png"
OUTPUT = ROOT / "assets/resources/V7/announcement_detail_latest_exact.png"
META = OUTPUT.with_suffix(OUTPUT.suffix + ".meta")
OUTPUT_SIZE = (750, 1253)


def main() -> None:
    with Image.open(SOURCE).convert("RGBA") as source:
        if source.size != (941, 1672):
            raise RuntimeError(f"Unexpected approved preview size: {source.size}")
        panel = source.crop((0, 100, 941, 1672))
        panel = panel.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)
        panel.save(OUTPUT, optimize=True)

    meta = json.loads(META.read_text(encoding="utf-8"))
    meta["width"], meta["height"] = OUTPUT_SIZE
    frame = meta["subMetas"][OUTPUT.stem]
    frame.update({
        "width": OUTPUT_SIZE[0],
        "height": OUTPUT_SIZE[1],
        "rawWidth": OUTPUT_SIZE[0],
        "rawHeight": OUTPUT_SIZE[1],
        # Keep the title and faint shield undistorted.  Only the plain lower
        # part of the inner blue panel grows on taller phones.
        "borderTop": 760,
        "borderBottom": 40,
        "borderLeft": 35,
        "borderRight": 35,
    })
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} {OUTPUT_SIZE[0]}x{OUTPUT_SIZE[1]}")


if __name__ == "__main__":
    main()
