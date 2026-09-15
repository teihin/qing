#!/usr/bin/env python3
"""Check the authored V8 reset-password modal: nodes, art and live input areas."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from apply_v7_prefab_skin import Prefab, ASSET_DIR
from apply_v8_reset_password import CENTER, PANEL, PANEL_RECT, ROWS, geo

SCRIPT = ROOT / "assets/scripts/UI/panelLogin.ts"
fails = []


def check(ok, message):
    print(("ok   " if ok else "FAIL ") + message)
    if not ok:
        fails.append(message)


def main():
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    base = "重置密码弹窗/重置资料框"
    paths = [base, base + "/关闭重置", base + "/关闭美术", base + "/确认修改",
             base + "/徽章", base + "/标题", base + "/副标题", base + "/装饰线", base + "/安全提示"]
    for name, key, rect, input_rect, placeholder, color in ROWS:
        paths.append(base + "/" + name + "/输入")
    for path in paths:
        try:
            p.node(path)
            check(True, "node " + path)
        except KeyError:
            check(False, "node " + path)
    meta = json.loads((ASSET_DIR / (PANEL + ".meta")).read_text())
    frame = next(iter(meta["subMetas"].values()))["uuid"]
    _, sprite = p.component(p.node(base), "cc.Sprite")
    check(sprite["_spriteFrame"]["__uuid__"] == frame, "重置资料框 uses " + PANEL)
    check(sprite.get("_type") == 0 and p.data[p.node(base)].get("_opacity") == 255,
          "面板背景为不透明整图")
    for tag in ["徽章", "标题", "副标题", "装饰线", "安全提示", "关闭美术"]:
        check(p.data[p.node(base + "/" + tag)]["_active"], tag + " 可见")
    for name, key, rect, input_rect, placeholder, color in ROWS:
        path = ASSET_DIR / ("reset_row_%s_exact.png" % key)
        img = np.array(Image.open(path).convert("RGB")).astype(float)
        h = img.shape[0] // 2
        box = img[h - 26:h + 26, 392 - rect[0]:810 - rect[0]]
        std = float(box.reshape(-1, 3).std(axis=0).max())
        check(std < 14, "%s live area has no baked text (std %.1f)" % (name, std))
    ts = SCRIPT.read_text(encoding="utf-8")
    for needle in ["openResetPanel()", "closeResetPanel()", "onResetSubmit()",
                   "重置密码弹窗", "重置资料框"]:
        check(needle in ts, "panelLogin.ts has " + needle)
    check("resetPwdUrl" not in ts, "忘记密码 no longer opens the old reset URL")
    print("check complete: %d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
