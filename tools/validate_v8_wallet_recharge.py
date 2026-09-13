#!/usr/bin/env python3
"""Read-only checks for the componentized V8 wallet recharge page."""

import json
import hashlib
from pathlib import Path
from PIL import Image
import numpy as np

from apply_v7_prefab_skin import Prefab, frame_uuid


ROOT = Path(__file__).resolve().parents[1]


def require(value, message):
    if not value:
        raise AssertionError(message)


def sprite(prefab, path):
    _, component = prefab.component(prefab.node(path), "cc.Sprite")
    require(component is not None, f"{path}: missing Sprite")
    return component


def main():
    prefab = Prefab("assets/resources/Prefabs/钱包.prefab")

    background = prefab.node("钱包/bk")
    background_sprite = sprite(prefab, "钱包/bk")
    scene = Image.open(ROOT / "assets/resources/V7/lobby_scene_long_v8.png")
    expected_height = scene.height * 750 / scene.width
    require(background_sprite["_spriteFrame"]["__uuid__"] ==
            frame_uuid("lobby_scene_long_v8.png"),
            "wallet background does not reuse lobby_scene_long_v8.png")
    require(background_sprite["_type"] == 0,
            "the complete lobby scene must not be nine-sliced")
    require(abs(prefab.data[background]["_contentSize"]["height"] -
                expected_height) < 1e-5,
            "wallet background aspect ratio changed")
    _, background_widget = prefab.component(background, "cc.Widget")
    require(background_widget and background_widget["_enabled"] and
            background_widget["_alignFlags"] == 17 and
            background_widget["_top"] == 0,
            "wallet background is not fixed to the top")
    require(expected_height >= 1778,
            "shared background does not cover the supported long screen")

    expected = {
        "钱包/Title": "wallet_header_exact.png",
        "钱包/选项/充值/checkmark": "wallet_tabs_recharge_exact.png",
        "钱包/容器/充值/根/V7选择充值渠道":
            "wallet_recharge_channel_title_exact.png",
        "钱包/容器/充值/根/V7选择充值金额":
            "wallet_recharge_amount_title_exact.png",
        "钱包/容器/充值/根/V7充值提示框":
            "wallet_recharge_notice_exact.png",
        "钱包/容器/充值/根/确认充值":
            "wallet_recharge_confirm_exact.png",
    }
    for path, asset in expected.items():
        component = sprite(prefab, path)
        require(component["_spriteFrame"]["__uuid__"] == frame_uuid(asset),
                f"{path}: incorrect V8 SpriteFrame")
        require(component["_type"] == 0,
                f"{path}: fixed artwork must keep its original ratio")

    panel = sprite(prefab, "钱包/容器/充值/根/V7充值面板")
    require(panel["_spriteFrame"]["__uuid__"] ==
            frame_uuid("wallet_recharge_panel_exact.png") and
            panel["_type"] == 1,
            "recharge panel must use the dedicated nine-slice material")
    panel_meta = json.loads((ROOT / "assets/resources/V7/"
                             "wallet_recharge_panel_exact.png.meta").read_text())
    panel_frame = panel_meta["subMetas"]["wallet_recharge_panel_exact"]
    for name in ['V7充值面板','通道视口','V7选择充值金额','金额',
                 'V7充值提示框','充值提示','V8默认充值提示','确认充值']:
        _,widget=prefab.component(prefab.node('钱包/容器/充值/根/'+name),'cc.Widget')
        require(widget and widget['_enabled'] and widget['_alignFlags'] & 1
                and not widget['_alignFlags'] & 6,
                name+': dynamic channel flow must be top-anchored, not stretched or bottom-pinned')
    require(all(panel_frame[key] == 32 for key in
                ("borderTop", "borderBottom", "borderLeft", "borderRight")),
            "recharge panel is missing safe nine-slice borders")

    for name, asset in (("支付1", "wallet_channel_bank_exact.png"),
                        ("支付2", "wallet_channel_alipay_exact.png"),
                        ("支付5", "wallet_channel_wechat_exact.png"),
                        ("支付6", "wallet_channel_other_exact.png")):
        path = f"钱包/容器/充值/根/通道视口/充值渠道/{name}"
        require(sprite(prefab, path + "/Background")["_spriteFrame"]["__uuid__"] ==
                frame_uuid(asset), f"{name}: incorrect channel card")
        _, toggle = prefab.component(prefab.node(path), "cc.Toggle")
        require(toggle is not None, f"{name}: missing channel Toggle")

    for amount in ("50", "100", "500", "1000", "2000", "5000"):
        path = f"钱包/容器/充值/根/金额/{amount}"
        require(sprite(prefab, path + "/Background")["_spriteFrame"]["__uuid__"] ==
                frame_uuid("wallet_amount_off_exact.png"),
                f"{amount}: incorrect normal amount card")
        require(sprite(prefab, path + "/checkmark")["_spriteFrame"]["__uuid__"] ==
                frame_uuid("wallet_amount_on_exact.png"),
                f"{amount}: incorrect selected amount card")
        _, toggle = prefab.component(prefab.node(path), "cc.Toggle")
        require(toggle is not None, f"{amount}: missing amount Toggle")

    require(not (ROOT / "assets/resources/V7/wallet_v8_body_exact.png").exists(),
            "flattened wallet effect image is still packaged")
    require((panel_frame['width'],panel_frame['height']) == (180,256),
            'panel must use the compact clean V8 frame, not the old full-height plate')

    # UUID presence alone passed the old V7 art. Compare approved image pixels
    # directly, so keeping old assets with unchanged UUIDs cannot pass again.
    source_path=ROOT/'design-previews/效果图V8-new/03-钱包/01-充值.png'
    source=Image.open(source_path).convert('RGBA')
    direct_cuts={
        'wallet_channel_bank_exact.png': (102,408,460,576),
        'wallet_channel_alipay_exact.png': (480,408,839,576),
        'wallet_channel_wechat_exact.png': (102,595,460,763),
        'wallet_channel_other_exact.png': (480,595,839,763),
        'wallet_recharge_confirm_exact.png': (104,1436,837,1573),
        'wallet_recharge_channel_title_exact.png': (103,329,839,383),
        'wallet_recharge_amount_title_exact.png': (103,810,839,865),
        'wallet_recharge_notice_text_v8.png': (240,1260,810,1370),
    }
    for name,box in direct_cuts.items():
        actual=np.asarray(Image.open(ROOT/'assets/resources/V7'/name).convert('RGBA'))
        reference=np.asarray(source.crop(box))
        require(actual.shape==reference.shape, name+': wrong V8 source crop')
        visible=actual[:,:,3]>0
        require(np.array_equal(actual[:,:,:3][visible],reference[:,:,:3][visible]),
                name+': pixels differ from the V8-new reference')
    for name in ['wallet_recharge_channel_title_exact.png','wallet_recharge_amount_title_exact.png']:
        alpha=np.asarray(Image.open(ROOT/'assets/resources/V7'/name).getchannel('A'))
        require(np.mean(alpha==0)>.55,name+': opaque title backdrop remains')

    manifest=json.loads((ROOT/'art_sources/v8-repairs/wallet-recharge/cuts.json').read_text())
    require(manifest['source_sha256']==hashlib.sha256(source_path.read_bytes()).hexdigest(),
            'V8 source changed after extraction')
    for name,entry in manifest['assets'].items():
        file=ROOT/'assets/resources/V7'/name
        require(hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256'],name+': asset changed after extraction')
        meta=json.loads(Path(str(file)+'.meta').read_text());fr=next(iter(meta['subMetas'].values()))
        require((fr['width'],fr['height'])==Image.open(file).size,name+': stale SpriteFrame dimensions')
        require(fr['trimType']=='none',name+': automatic trimming would shift artwork')

    # Check actual serialized widget rectangles at the four supported heights.
    from render_v8_wallet_recharge import render
    root='钱包/容器/充值/根'
    for height in [1334,1500,1624,1778]:
        _,boxes=render(height)
        sequences=['V7选择充值渠道','通道视口','V7选择充值金额','金额','V7充值提示框','确认充值']
        for upper,lower in zip(sequences,sequences[1:]):
            require(boxes[root+'/'+upper][3]<=boxes[root+'/'+lower][1],
                    f'{height}: {upper} overlaps {lower}')
        frame=boxes[root+'/V7充值面板']
        for name in sequences:
            r=boxes[root+'/'+name]
            require(frame[0]<=r[0] and frame[1]<=r[1] and frame[2]>=r[2] and frame[3]>=r[3],
                    f'{height}: {name} escapes the panel')
        require(boxes['钱包/bk'][3]>=height,f'{height}: background leaves a bottom gap')
    print('PASS: V8-new source pixels, transparent titles, compact panel, formal bindings and four screen heights.')


if __name__ == "__main__":
    main()
