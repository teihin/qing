"""重排 1 对 1 聊天「上下分」弹窗（panelClubGoldPad）与聊天页底部三按钮布局。

配套美术由 tools/gen_chat_gold_pad_art.py 生成。
本脚本做三件事：
  1) 为 assets/ImagesLuck/上下分/ 与 聊天/上下分.png 补 .meta（固定 uuid，trimType=none）；
  2) 重建 assets/resources/UI/panelClubGoldPad.prefab 的节点树（干净布局 + Widget 居中 + 不溢出）；
  3) 修 assets/resources/UI/panelMessageChat.prefab：换新图标、三按钮改 left/center/right + bottom 的 Widget。
用法：python tools/apply_chat_gold_pad_layout.py
"""
import base64
import hashlib
import json
import os
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "assets/ImagesLuck/上下分")
CHAT_DIR = os.path.join(ROOT, "assets/ImagesLuck/聊天")
UI_DIR = os.path.join(ROOT, "assets/resources/UI")
PREFAB = os.path.join(UI_DIR, "panelClubGoldPad.prefab")
CHAT_PREFAB = os.path.join(UI_DIR, "panelMessageChat.prefab")

ASSET_UUID = "f9f2b5d6-0f7a-4d47-b4c1-7b3f2d9a6e80"   # panelClubGoldPad.prefab 自身 uuid
STD_MAT = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"      # builtin 2d-sprite 材质
DEFAULT_SPRITE = "a23235d1-15db-4b95-8439-a2e005bfff91"  # builtin 白图
MASK_SCRIPT = "c62d0KIf8xMmIRwTYVZlwGc"               # 弹窗外黑底点击关闭
PANEL_SCRIPT = "4f3d6tRktxP9p9kCg+PW30x"              # panelClubGoldPad
# cc.EditBox.InputFlag：注意 PASSWORD 是 0（不是 DEFAULT），DEFAULT 才是 5
INPUT_FLAG_PASSWORD = 0
INPUT_FLAG_DEFAULT = 5


# ---------------- .meta ----------------
def stable_uuid(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "qing-chat-goldpad/" + key))


def sprite_frame_uuid(key):
    return stable_uuid("sf/" + key)


def ensure_meta(path, borders=(0, 0, 0, 0)):
    """为新 PNG 生成 .meta；已存在则只校正尺寸/border。返回 spriteFrame uuid。"""
    name = os.path.splitext(os.path.basename(path))[0]
    meta_path = path + ".meta"
    w, h = Image.open(path).size
    sf_uuid = sprite_frame_uuid(name)
    tex_uuid = stable_uuid("tex/" + name)
    b_l, b_r, b_t, b_b = borders
    if os.path.exists(meta_path):
        meta = json.load(open(meta_path))
    else:
        meta = {
            "ver": "2.3.7",
            "uuid": tex_uuid,
            "importer": "texture",
            "type": "sprite",
            "wrapMode": "clamp",
            "filterMode": "bilinear",
            "premultiplyAlpha": False,
            "genMipmaps": False,
            "packable": True,
            "width": w,
            "height": h,
            "platformSettings": {},
            "subMetas": {},
        }
    meta["width"] = w
    meta["height"] = h
    meta["subMetas"] = {
        name: {
            "ver": "1.0.6",
            "uuid": sf_uuid,
            "importer": "sprite-frame",
            "rawTextureUuid": meta["uuid"],
            "trimType": "none",
            "trimThreshold": 1,
            "rotated": False,
            "offsetX": 0,
            "offsetY": 0,
            "trimX": 0,
            "trimY": 0,
            "width": w,
            "height": h,
            "rawWidth": w,
            "rawHeight": h,
            "borderTop": b_t,
            "borderBottom": b_b,
            "borderLeft": b_l,
            "borderRight": b_r,
            "subMetas": {},
        }
    }
    with open(meta_path, "w") as fp:
        json.dump(meta, fp, indent=2, ensure_ascii=False)
        fp.write("\n")
    print("meta  %-40s %dx%d border=%s" % (os.path.relpath(meta_path, ROOT), w, h, borders))
    return sf_uuid


# ---------------- prefab builder ----------------
class Builder:
    def __init__(self):
        self.data = [None]
        self.root = None
        self._seq = 0

    def _fid(self, name):
        self._seq += 1
        raw = hashlib.sha1(("%s#%d" % (name, self._seq)).encode()).digest()[:18]
        return base64.b64encode(raw).decode()

    def add(self, obj):
        self.data.append(obj)
        return len(self.data) - 1

    def node(self, name, parent, pos=(0, 0), size=(100, 100), anchor=(0.5, 0.5),
             color=(255, 255, 255), opacity=255, active=True):
        nid = len(self.data)
        node = {
            "__type__": "cc.Node",
            "_name": name,
            "_objFlags": 0,
            "_parent": {"__id__": parent} if parent is not None else None,
            "_children": [],
            "_active": active,
            "_components": [],
            "_prefab": None,
            "_opacity": opacity,
            "_color": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255},
            "_contentSize": {"__type__": "cc.Size", "width": size[0], "height": size[1]},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": anchor[0], "y": anchor[1]},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                     "array": [pos[0], pos[1], 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_skewX": 0,
            "_skewY": 0,
            "_is3DNode": False,
            "_groupIndex": 0,
            "groupIndex": 0,
            "_id": "",
        }
        self.data.append(node)
        if parent is not None:
            self.data[parent]["_children"].append({"__id__": nid})
        root_id = self.root if self.root is not None else nid
        pi = self.add({
            "__type__": "cc.PrefabInfo",
            "root": {"__id__": root_id},
            "asset": {"__uuid__": ASSET_UUID},
            "fileId": self._fid(name),
            "sync": False,
        })
        node["_prefab"] = {"__id__": pi}
        return nid

    def comp(self, node_id, obj):
        obj["node"] = {"__id__": node_id}
        cid = self.add(obj)
        self.data[node_id]["_components"].append({"__id__": cid})
        return cid

    def sprite(self, node_id, sf_uuid, sliced=False):
        return self.comp(node_id, {
            "__type__": "cc.Sprite",
            "_name": "",
            "_objFlags": 0,
            "_enabled": True,
            "_materials": [{"__uuid__": STD_MAT}],
            "_srcBlendFactor": 770,
            "_dstBlendFactor": 771,
            "_spriteFrame": {"__uuid__": sf_uuid},
            "_type": 1 if sliced else 0,
            "_sizeMode": 0,
            "_fillType": 0,
            "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0,
            "_fillRange": 0,
            "_isTrimmedMode": False,
            "_atlas": None,
            "_id": "",
        })

    def label(self, node_id, text, size, align=1, valign=1, overflow=2, line_height=None, bold=False):
        return self.comp(node_id, {
            "__type__": "cc.Label",
            "_name": "",
            "_objFlags": 0,
            "_enabled": True,
            "_materials": [{"__uuid__": STD_MAT}],
            "_srcBlendFactor": 770,
            "_dstBlendFactor": 771,
            "_string": text,
            "_N$string": text,
            "_fontSize": size,
            "_lineHeight": line_height or int(size * 1.25),
            "_enableWrapText": False,
            "_N$file": None,
            "_isSystemFontUsed": True,
            "_spacingX": 0,
            "_batchAsBitmap": False,
            "_styleFlags": 1 if bold else 0,
            "_underlineHeight": 0,
            "_N$horizontalAlign": align,
            "_N$verticalAlign": valign,
            "_N$fontFamily": "Arial",
            "_N$overflow": overflow,
            "_N$cacheMode": 0,
            "_id": "",
        })

    def button(self, node_id):
        return self.comp(node_id, {
            "__type__": "cc.Button",
            "_name": "",
            "_objFlags": 0,
            "_enabled": True,
            "_normalMaterial": {"__uuid__": STD_MAT},
            "_grayMaterial": None,
            "duration": 0.1,
            "zoomScale": 0.94,
            "clickEvents": [],
            "_N$interactable": True,
            "_N$enableAutoGrayEffect": False,
            "_N$transition": 3,
            "transition": 3,
            "_N$normalColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "pressedColor": {"__type__": "cc.Color", "r": 211, "g": 211, "b": 211, "a": 255},
            "_N$hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "hoverColor": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_N$disabledColor": {"__type__": "cc.Color", "r": 124, "g": 124, "b": 124, "a": 255},
            "_N$normalSprite": None,
            "_N$pressedSprite": None,
            "pressedSprite": None,
            "_N$hoverSprite": None,
            "_N$disabledSprite": None,
            "_N$target": None,
            "_id": "",
        })

    def widget(self, node_id, flags, left=0, right=0, top=0, bottom=0,
               hcenter=0, vcenter=0, align_mode=2, target_size=(0, 0)):
        return self.comp(node_id, {
            "__type__": "cc.Widget",
            "_name": "",
            "_objFlags": 0,
            "_enabled": True,
            "alignMode": align_mode,
            "_target": None,
            "_alignFlags": flags,
            "_left": left,
            "_right": right,
            "_top": top,
            "_bottom": bottom,
            "_verticalCenter": vcenter,
            "_horizontalCenter": hcenter,
            "_isAbsLeft": True,
            "_isAbsRight": True,
            "_isAbsTop": True,
            "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True,
            "_isAbsVerticalCenter": True,
            "_originalWidth": target_size[0],
            "_originalHeight": target_size[1],
            "_id": "",
        })

    def editbox(self, node_id, sf_uuid, size, placeholder, max_len=8,
                fs=28, color=(255, 244, 220), ph_color=(120, 154, 182),
                input_flag=INPUT_FLAG_DEFAULT):
        # Cocos 的 EditBox 不会自己排版 textLabel/placeholderLabel：
        # 必须像原 prefab 那样用 Widget 铺满输入框，靠 Label 的 verticalAlign 居中，
        # 只给固定 size + anchor 会偏到框外。
        w, h = size
        text_id = self.node("TEXT_LABEL", node_id, (0, 0), (w, h), anchor=(0, 1))
        self.label(text_id, "", fs, align=0, overflow=1)
        self.widget(text_id, 45, left=18, right=8, top=4, bottom=4)
        ph_id = self.node("PLACEHOLDER_LABEL", node_id, (0, 0), (w, h), anchor=(0, 1))
        self.label(ph_id, placeholder, fs, align=0, overflow=1)
        self.widget(ph_id, 45, left=18, right=8, top=4, bottom=4)
        self.data[ph_id]["_color"] = {"__type__": "cc.Color", "r": ph_color[0], "g": ph_color[1],
                                      "b": ph_color[2], "a": 255}
        self.data[ph_id]["_opacity"] = 220
        bg_id = self.node("BACKGROUND_SPRITE", node_id, (0, 0), (w, h))
        self.sprite(bg_id, sf_uuid)
        # 顺序：background 在最下 → 先创建的节点先渲染，这里手动挪到最前
        parent = self.data[node_id]
        kids = parent["_children"]
        kids.insert(0, kids.pop())
        text_label_comp = self.data[text_id]["_components"][0]["__id__"]
        ph_label_comp = self.data[ph_id]["_components"][0]["__id__"]
        bg_sprite_comp = self.data[bg_id]["_components"][0]["__id__"]
        return self.comp(node_id, {
            "__type__": "cc.EditBox",
            "_name": "",
            "_objFlags": 0,
            "_enabled": True,
            "_useOriginalSize": False,
            "_string": "",
            "returnType": 0,
            "maxLength": max_len,
            "_tabIndex": 0,
            "editingDidBegan": [],
            "textChanged": [],
            "editingDidEnded": [],
            "editingReturn": [],
            "_N$textLabel": {"__id__": text_label_comp},
            "_N$placeholderLabel": {"__id__": ph_label_comp},
            "_N$background": {"__id__": bg_sprite_comp},
            "_N$inputFlag": input_flag,
            "_N$inputMode": 2,
            "_N$stayOnTop": False,
            "_id": "",
            "_N$fontSize": fs,
            "fontSize": fs,
            "_N$placeholderFontSize": fs,
            "placeholderFontSize": fs,
            "_N$fontColor": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255},
            "fontColor": {"__type__": "cc.Color", "r": color[0], "g": color[1], "b": color[2], "a": 255},
            "_N$placeholderFontColor": {"__type__": "cc.Color", "r": ph_color[0], "g": ph_color[1],
                                        "b": ph_color[2], "a": 255},
            "placeholderFontColor": {"__type__": "cc.Color", "r": ph_color[0], "g": ph_color[1],
                                     "b": ph_color[2], "a": 255},
        })

    def dump(self):
        return json.dumps(self.data, ensure_ascii=False, indent=2)


PANEL_W, PANEL_H = 634, 870
CHIP_W, CHIP_H = 172, 58
BTN_W, BTN_H = 268, 78
ROW_Y = {"amount": 110, "pwd": 10}
CHIP_Y = (-118, -186, -254)
CHIP_X = (-192, 0, 192)
BTN_Y = -340


def tex_half(name):
    """美术字贴图按 2x 出图，节点尺寸取一半。"""
    from PIL import Image as PILImage
    w, h = PILImage.open(os.path.join(IMG_DIR, name + ".png")).size
    return (w / 2.0, h / 2.0)


def build_prefab(sf):
    b = Builder()
    root = b.node("panelClubGoldPad", None, (375, 667), (750, 1334))
    b.root = root
    b.widget(root, 45, 0, 0, 0, 0, align_mode=1)
    b.comp(root, {"__type__": PANEL_SCRIPT, "_name": "", "_objFlags": 0, "_enabled": True, "_id": ""})
    b.sprite(root, DEFAULT_SPRITE, sliced=True)  # 与原始一致：禁用状态的兜底 sprite
    # 关掉兜底 sprite
    for c in b.data[root]["_components"]:
        comp = b.data[c["__id__"]]
        if comp["__type__"] == "cc.Sprite":
            comp["_enabled"] = False

    # 遮罩
    msk = b.node("msk", root, (0, 0), (750, 1334))
    b.sprite(msk, DEFAULT_SPRITE)
    b.widget(msk, 45, 0, 0, 0, 0, align_mode=1)
    b.comp(msk, {"__type__": MASK_SCRIPT, "_name": "", "_objFlags": 0, "_enabled": True, "_id": ""})
    b.data[msk]["_opacity"] = 150
    b.data[msk]["_color"] = {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255}

    # 面板
    bk = b.node("bk", root, (0, 0), (PANEL_W, PANEL_H))
    b.sprite(bk, sf["gd_panel"])
    b.widget(bk, 18, 0, 0, 0, 0, align_mode=2)

    # 标题（美术字贴图）：上下分模式 / 赠送积分模式各一套，按 mode 切 active
    title = b.node("标题", bk, (0, 358), tex_half("gd_txt_title"))
    b.sprite(title, sf["gd_txt_title"])
    give_title = b.node("标题-赠送", bk, (0, 358), tex_half("gd_txt_give"), active=False)
    b.sprite(give_title, sf["gd_txt_give"])

    # 关闭
    close = b.node("关闭", bk, (262, 372), (64, 64))
    b.sprite(close, sf["gd_close"])
    b.button(close)
    b.widget(close, 33, right=23, top=31, align_mode=2)

    # 顶部分割线
    d1 = b.node("饰线-上", bk, (0, 306), (520, 30))
    b.sprite(d1, sf["gd_divider"])

    # 玩家区
    who_tag = b.node("目标标题", bk, (-274, 254), (200, 28), anchor=(0, 0.5), color=(201, 169, 106))
    b.label(who_tag, "操作玩家", 21, align=0, overflow=0, bold=True)
    who = b.node("目标", bk, (-274, 212), (540, 44), anchor=(0, 0.5), color=(255, 255, 255))
    b.label(who, "玩家名称", 32, align=0, overflow=2, bold=True)

    d2 = b.node("饰线-中", bk, (0, 164), (520, 30))
    b.sprite(d2, sf["gd_divider"])

    # 金额行
    amt_tag = b.node("金额标题", bk, (-274, ROW_Y["amount"]), (120, 40))
    bar1 = b.node("竖条", amt_tag, (0, 0), (7, 34))
    b.sprite(bar1, sf["gd_bar"])
    amt_tag_txt = b.node("文字", amt_tag, (14, 0), (110, 36), anchor=(0, 0.5), color=(232, 238, 246))
    b.label(amt_tag_txt, "数额", 26, align=0, overflow=0)

    amount = b.node("金额", bk, (78, ROW_Y["amount"]), (400, 74))
    b.editbox(amount, sf["gd_input"], (400, 74), "请输入金币数量", max_len=8)

    # 密码行
    pwd_tag = b.node("密码标题", bk, (-274, ROW_Y["pwd"]), (150, 40))
    bar2 = b.node("竖条", pwd_tag, (0, 0), (7, 34))
    b.sprite(bar2, sf["gd_bar"])
    pwd_tag_txt = b.node("文字", pwd_tag, (14, 0), (140, 36), anchor=(0, 0.5), color=(232, 238, 246))
    b.label(pwd_tag_txt, "交易密码", 26, align=0, overflow=0)

    pwd = b.node("密码", bk, (78, ROW_Y["pwd"]), (400, 74))
    b.editbox(pwd, sf["gd_input"], (400, 74), "请输入交易密码", max_len=8,
              input_flag=INPUT_FLAG_PASSWORD)

    # 提示
    hint = b.node("提示", bk, (0, -58), (560, 30), color=(143, 179, 204))
    b.label(hint, "请选择金额，或直接输入整数", 21, align=1)

    # 快捷金额
    steps = (100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000)
    for idx, val in enumerate(steps):
        cx = CHIP_X[idx % 3]
        cy = CHIP_Y[idx // 3]
        chip = b.node("金额_%d" % val, bk, (cx, cy), (CHIP_W, CHIP_H))
        b.sprite(chip, sf["gd_chip"])
        b.button(chip)
        txt = b.node("文字", chip, (0, 0), (CHIP_W - 16, CHIP_H - 8), color=(240, 206, 134))
        b.label(txt, str(val), 26, align=1)

    # 上下分按钮（文案走美术字贴图）
    up = b.node("上分", bk, (-142, BTN_Y), (BTN_W, BTN_H))
    b.sprite(up, sf["gd_btn_gold"])
    b.button(up)
    up_txt = b.node("文字", up, (0, 1), tex_half("gd_txt_up"))
    b.sprite(up_txt, sf["gd_txt_up"])

    down = b.node("下分", bk, (142, BTN_Y), (BTN_W, BTN_H))
    b.sprite(down, sf["gd_btn_line"])
    b.button(down)
    down_txt = b.node("文字", down, (0, 1), tex_half("gd_txt_down"))
    b.sprite(down_txt, sf["gd_txt_down"])

    # 赠送模式：只有一个居中的「确认赠送」
    give_btn = b.node("确认赠送", bk, (0, BTN_Y), (BTN_W, BTN_H), active=False)
    b.sprite(give_btn, sf["gd_btn_gold"])
    b.button(give_btn)
    give_txt = b.node("文字", give_btn, (0, 1), tex_half("gd_txt_give_btn"))
    b.sprite(give_txt, sf["gd_txt_give_btn"])

    data = [None] + b.data[1:]
    head = {"__type__": "cc.Prefab", "_name": "", "_objFlags": 0, "_native": "",
            "data": {"__id__": 1}, "optimizationPolicy": 0, "asyncLoadAssets": False,
            "readonly": False}
    data[0] = head
    with open(PREFAB, "w") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    print("prefab %-38s nodes=%d" % (os.path.relpath(PREFAB, ROOT), len(data)))


def ensure_system_template(data, asset_uuid, sf_notice):
    """在聊天列表 content 下保证有「消息-系统」模板节点（系统通报条）。"""
    content_id = None
    for i, o in enumerate(data):
        if not isinstance(o, dict) or o.get("__type__") != "cc.Node" or o.get("_name") != "content":
            continue
        parent = o.get("_parent") or {}
        pid = parent.get("__id__")
        if pid is not None and data[pid].get("_name") == "view":
            content_id = i
    if content_id is None:
        raise SystemExit("panelMessageChat.prefab 里找不到 列表/view/content")

    existing = None
    for c in data[content_id]["_children"]:
        if data[c["__id__"]].get("_name") == "消息-系统":
            existing = c["__id__"]

    def fid(key):
        return base64.b64encode(hashlib.sha1(key.encode()).digest()[:18]).decode()

    def add_node(name, parent, pos, size, active=True, fid_key=""):
        nid = len(data)
        node = {
            "__type__": "cc.Node", "_name": name, "_objFlags": 0,
            "_parent": {"__id__": parent}, "_children": [], "_active": active,
            "_components": [], "_prefab": None, "_opacity": 255,
            "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
            "_contentSize": {"__type__": "cc.Size", "width": size[0], "height": size[1]},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
            "_trs": {"__type__": "TypedArray", "ctor": "Float64Array",
                     "array": [pos[0], pos[1], 0, 0, 0, 0, 1, 1, 1, 1]},
            "_eulerAngles": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_skewX": 0, "_skewY": 0, "_is3DNode": False,
            "_groupIndex": 0, "groupIndex": 0, "_id": "",
        }
        data.append(node)
        data[parent]["_children"].append({"__id__": nid})
        pi = len(data)
        data.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                     "asset": {"__uuid__": asset_uuid},
                     "fileId": fid(fid_key or name), "sync": False})
        node["_prefab"] = {"__id__": pi}
        return nid

    def add_sprite(node_id, sf_uuid):
        cid = len(data)
        data.append({
            "__type__": "cc.Sprite", "_name": "", "_objFlags": 0, "node": {"__id__": node_id},
            "_enabled": True, "_materials": [{"__uuid__": STD_MAT}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_spriteFrame": {"__uuid__": sf_uuid}, "_type": 0, "_sizeMode": 0,
            "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": False,
            "_atlas": None, "_id": "",
        })
        data[node_id]["_components"].append({"__id__": cid})

    def add_label(node_id, text, fs, color):
        cid = len(data)
        data.append({
            "__type__": "cc.Label", "_name": "", "_objFlags": 0, "node": {"__id__": node_id},
            "_enabled": True, "_materials": [{"__uuid__": STD_MAT}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_string": text, "_N$string": text, "_fontSize": fs,
            "_lineHeight": int(fs * 1.3), "_enableWrapText": False,
            "_N$file": None, "_isSystemFontUsed": True, "_spacingX": 0,
            "_batchAsBitmap": False, "_styleFlags": 0, "_underlineHeight": 0,
            "_N$horizontalAlign": 1, "_N$verticalAlign": 1, "_N$fontFamily": "Arial",
            "_N$overflow": 2, "_N$cacheMode": 0, "_id": "",
        })
        data[node_id]["_components"].append({"__id__": cid})
        data[node_id]["_color"] = {"__type__": "cc.Color",
                                   "r": color[0], "g": color[1], "b": color[2], "a": 255}

    if existing is not None:
        root = data[existing]
        root["_active"] = False
        for c in root["_components"]:
            comp = data[c["__id__"]]
            if comp["__type__"] == "cc.Sprite":
                comp["_spriteFrame"] = {"__uuid__": sf_notice}
        print("patch 消息-系统 模板已存在，更新图引用")
        return

    root = add_node("消息-系统", content_id, (0, -60), (620, 104), active=False,
                    fid_key="chat-system-notice")
    add_sprite(root, sf_notice)
    time_node = add_node("时间", root, (0, 18), (620, 26), fid_key="chat-system-time")
    add_label(time_node, "2026-11-01 00:00:00", 20, (201, 169, 106))
    text_node = add_node("内容", root, (0, -16), (592, 34), fid_key="chat-system-text")
    add_label(text_node, "", 24, (240, 246, 255))
    print("patch 消息-系统 模板已创建")


def patch_chat(sf_entry, sf_notice, sf_give):
    data = json.load(open(CHAT_PREFAB))
    by_name = {}
    for i, o in enumerate(data):
        if isinstance(o, dict) and o.get("__type__") == "cc.Node":
            by_name.setdefault(o.get("_name"), i)

    # 赠送积分：克隆「上下分」整套节点（同尺寸/按钮/文字），放到第三列
    asset_uuid_chat = json.load(open(CHAT_PREFAB + ".meta"))["uuid"]

    def clone_node(src_id, parent_id, name, sprite_uuid=None, text=None, active=False):
        orig = data[src_id]
        nid = len(data)
        node = json.loads(json.dumps(orig))
        node["_name"] = name
        node["_parent"] = {"__id__": parent_id}
        node["_children"] = []
        node["_components"] = []
        node["_active"] = active
        data.append(node)
        data[parent_id]["_children"].append({"__id__": nid})
        pi = len(data)
        data.append({"__type__": "cc.PrefabInfo", "root": {"__id__": 1},
                     "asset": {"__uuid__": asset_uuid_chat},
                     "fileId": base64.b64encode(
                         hashlib.sha1(("give/" + name + "/" + str(nid)).encode()).digest()[:18]).decode(),
                     "sync": False})
        node["_prefab"] = {"__id__": pi}
        for c in orig["_components"]:
            comp = json.loads(json.dumps(data[c["__id__"]]))
            comp["node"] = {"__id__": nid}
            if comp["__type__"] == "cc.Sprite" and sprite_uuid:
                comp["_spriteFrame"] = {"__uuid__": sprite_uuid}
                comp["_type"] = 0
                comp["_sizeMode"] = 0
            if comp["__type__"] == "cc.Label" and text:
                comp["_string"] = text
                comp["_N$string"] = text
            if comp["__type__"] == "cc.Widget":
                comp.update({"_alignFlags": 20, "_left": 0, "_right": 0, "_top": 0,
                             "_bottom": 76, "_horizontalCenter": 85,
                             "_verticalCenter": 0, "alignMode": 2})
            cid = len(data)
            data.append(comp)
            node["_components"].append({"__id__": cid})
        for c in orig["_children"]:
            child = data[c["__id__"]]
            clone_node(c["__id__"], nid, child["_name"], None, text, active=True)
        return nid

    if "赠送积分" not in by_name:
        give_id = clone_node(by_name["上下分"], data[by_name["上下分"]]["_parent"]["__id__"],
                             "赠送积分", sf_give, "赠送积分", active=False)
        by_name["赠送积分"] = give_id
        print("patch 赠送积分 入口已创建")

    # 上下分：换图 + Widget（右下角，与拍照上传对称）
    node_id = by_name["上下分"]
    node = data[node_id]
    for c in node["_components"]:
        comp = data[c["__id__"]]
        if comp["__type__"] == "cc.Sprite":
            comp["_spriteFrame"] = {"__uuid__": sf_entry}
            comp["_type"] = 0
            comp["_sizeMode"] = 0
    gold_widget = next((data[c["__id__"]] for c in node["_components"]
                        if data[c["__id__"]]["__type__"] == "cc.Widget"), None)
    if gold_widget is None:
        wid = len(data)
        data.append({
            "__type__": "cc.Widget", "_name": "", "_objFlags": 0, "node": {"__id__": node_id},
            "_enabled": True, "alignMode": 2, "_target": None, "_alignFlags": 36,
            "_left": 0, "_right": 64, "_top": 0, "_bottom": 76,
            "_verticalCenter": 0, "_horizontalCenter": 0,
            "_isAbsLeft": True, "_isAbsRight": True, "_isAbsTop": True, "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True, "_isAbsVerticalCenter": True,
            "_originalWidth": 108, "_originalHeight": 108, "_id": "",
        })
        node["_components"].append({"__id__": wid})
    else:
        gold_widget.update({"_alignFlags": 36, "_left": 0, "_right": 64, "_top": 0,
                            "_bottom": 76, "_horizontalCenter": 0, "_verticalCenter": 0,
                            "alignMode": 2})

    # 底部四个入口：widget 只吃 BOTTOM，水平位置交给脚本按「实际显示几个」动态排，
    # 否则隐藏一两个按钮时会留下空洞。
    for name in ("拍照上传", "发送图片", "赠送积分", "上下分"):
        nid = by_name.get(name)
        if nid is None:
            continue
        for c in data[nid]["_components"]:
            comp = data[c["__id__"]]
            if comp["__type__"] == "cc.Widget":
                comp.update({"_alignFlags": 4, "_left": 0, "_right": 0, "_top": 0,
                             "_bottom": 76, "_horizontalCenter": 0, "_verticalCenter": 0,
                             "alignMode": 2})
        # 初始位置按四列摆好，脚本没跑时也不会叠在一起。
        col = ("拍照上传", "发送图片", "赠送积分", "上下分").index(name)
        data[nid]["_trs"]["array"][0] = -256 + col * 171

    asset_uuid = json.load(open(CHAT_PREFAB + ".meta"))["uuid"]
    ensure_system_template(data, asset_uuid, sf_notice)

    with open(CHAT_PREFAB, "w") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    print("patch %-38s ok" % os.path.relpath(CHAT_PREFAB, ROOT))


def main():
    sf = {}
    # 全部走 SIMPLE + CUSTOM：贴图 2x 等比缩放到节点，圆角/描边比例才不会被九宫格压扁
    slider = {}
    for name in ("gd_panel", "gd_input", "gd_chip", "gd_btn_gold", "gd_btn_line",
                 "gd_close", "gd_divider", "gd_bar", "gd_lock", "gd_avatar_ring",
                 "gd_txt_title", "gd_txt_up", "gd_txt_down",
                 "gd_txt_give", "gd_txt_give_btn"):
        path = os.path.join(IMG_DIR, name + ".png")
        sf[name] = ensure_meta(path, slider.get(name, (0, 0, 0, 0)))
    sf_entry = ensure_meta(os.path.join(CHAT_DIR, "上下分.png"))
    sf_notice = ensure_meta(os.path.join(CHAT_DIR, "系统消息底.png"))
    build_prefab(sf)
    sf_give = ensure_meta(os.path.join(CHAT_DIR, "赠送积分.png"))
    patch_chat(sf_entry, sf_notice, sf_give)


if __name__ == "__main__":
    main()
