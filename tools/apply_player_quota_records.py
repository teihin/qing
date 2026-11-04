"""玩家信息弹窗：游戏设置同款页签 + 额度记录页（上下分流水/牌局流水）。"""
from pathlib import Path
import json
import uuid
import copy

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"

exec((Path(__file__).with_name("apply_club_management_ui.py")).read_text().split("assert not any")[0])

A = json.loads(PREFAB.read_text())
assert not any(isinstance(o, dict) and o.get("_name") == "玩家设置额度记录" for o in A), "already applied"

TAB_ON = "91a341b0-c173-4455-8c97-e470fc1cda87"
TAB_OFF = "88253e0e-4413-48f2-bf36-2742948efc1f"
LIST_BG = "99cd0818-b86a-4975-b44f-11173e52f20e"
ROW_BG = "cf841cf4-06c0-4610-8568-3246e3faed43"
LINE = "agent_v8_rule_horizontal"

ACTIVE_TEXT = (48, 30, 8)
IDLE_TEXT = (169, 192, 214)
HEADER_TEXT = (139, 170, 194)
IVORY = (231, 240, 246)
MUTED = (170, 202, 224)
GOLD = (255, 227, 117)


def child_index(parent, name):
    for c in A[parent]["_children"]:
        if A[c["__id__"]]["_name"] == name:
            return c["__id__"]
    return None


def geometry(index, x, y, width, height):
    A[index]["_trs"]["array"][:2] = [x, y]
    A[index]["_contentSize"].update(width=width, height=height)


def sprite_component(index):
    for c in A[index]["_components"]:
        co = A[c["__id__"]]
        if co["__type__"] == "cc.Sprite":
            return co
    return None


def set_sprite(index, frame_uuid, sliced=True):
    co = sprite_component(index)
    if co is None:
        comp(index, "cc.Sprite", _spriteFrame={"__uuid__": frame_uuid},
             _type=1 if sliced else 0, _sizeMode=0)
        # 先加在 Label 之前，保证底板绘制在文字下面。
        A[index]["_components"].insert(0, A[index]["_components"].pop())
        co = sprite_component(index)
    co["_spriteFrame"] = {"__uuid__": frame_uuid}
    co["_type"] = 1 if sliced else 0
    co["_sizeMode"] = 0


def label_component(index):
    for c in A[index]["_components"]:
        co = A[c["__id__"]]
        if co["__type__"] == "cc.Label":
            return co
    return None


def style_label(index, text, size, color):
    A[index]["_color"].update(r=color[0], g=color[1], b=color[2], a=255)
    co = label_component(index)
    if co is not None:
        co["_string"] = text
        co["_N$string"] = text
        co["_fontSize"] = size
        co["_lineHeight"] = size + 7
        co["_enableWrapText"] = False
        co["_N$overflow"] = 2


def text_child(index, name="文字"):
    return child_index(index, name)


panel = path("俱乐部玩家设置弹窗/面板")

# 三个主页签：统一成游戏设置的胶囊底，宽度按 3 等分。
tab_names = ["成员设置", "成员设置非激活", "下级成员", "下级成员激活"]
tabs = {}
for name in tab_names:
    index = child_index(panel, name)
    assert index is not None, name
    tabs[name] = index

# 下级成员原来的 Label 直接挂在按钮节点上；拆成子节点，避免底色被文字颜色染色。
downline = tabs["下级成员"]
old_label = label_component(downline)
if old_label is not None and child_index(downline, "文字") is None:
    text_node = node("文字", downline, 0, 0, 180, 50)
    A[downline]["_components"] = [c for c in A[downline]["_components"]
                                  if A[c["__id__"]]["__type__"] != "cc.Label"]
    old_label["node"] = {"__id__": text_node}
    A[text_node]["_components"].append({"__id__": A.index(old_label)})

for name, x, frame in [
        ("成员设置", -204, TAB_ON), ("成员设置非激活", -204, TAB_OFF),
        ("下级成员", 0, TAB_OFF), ("下级成员激活", 0, TAB_ON)]:
    index = tabs[name]
    geometry(index, x, 271, 196, 56)
    A[index]["_color"].update(r=255, g=255, b=255, a=255)
    set_sprite(index, frame)
    text_index = text_child(index)
    if text_index is not None:
        geometry(text_index, 0, 0, 180, 50)
        style_label(text_index, "下级成员" if name.startswith("下级") else "成员设置",
                    24, ACTIVE_TEXT if name.endswith("激活") or name == "成员设置" else IDLE_TEXT)


def add_tab(name, text, x, frame, active, color):
    index = sprite(name, panel, "club_settings_row_v8", x, 271, 196, 56)
    set_sprite(index, frame)
    A[index]["_color"].update(r=255, g=255, b=255, a=255)
    A[index]["_active"] = active
    comp(index, "cc.Button", clickEvents=[])
    A[-1]["_N$target"] = None
    label_index = label("文字", index, text, 0, 0, 180, 50, 24, color)
    return index


quota_idle = add_tab("额度记录", "额度记录", 204, TAB_OFF, True, IDLE_TEXT)
quota_active = add_tab("额度记录激活", "额度记录", 204, TAB_ON, False, ACTIVE_TEXT)

# 旧的下划线和菱形装饰不再需要；保留节点名但隐藏，避免旧引用失效。
for name in ["成员设置选中线", "成员设置选中菱形", "下级成员选中线", "下级成员选中菱形"]:
    index = child_index(panel, name)
    if index is not None:
        A[index]["_active"] = False

# 额度记录内容容器
records = node("玩家设置额度记录", panel, 0, -150, 640, 700, active=False)
comp(records, "cc.Sprite", _spriteFrame={"__uuid__": LIST_BG}, _type=1, _sizeMode=0)
A[records]["_color"].update(r=255, g=255, b=255, a=255)


def add_record_tab(name, text, x, frame, active, color):
    index = sprite(name, records, "club_settings_row_v8", x, 313, 160, 46)
    set_sprite(index, frame)
    A[index]["_color"].update(r=255, g=255, b=255, a=255)
    A[index]["_active"] = active
    comp(index, "cc.Button", clickEvents=[])
    A[-1]["_N$target"] = None
    label("文字", index, text, 0, 0, 148, 42, 21, color)
    return index


add_record_tab("记录_上下分", "上下分流水", -88, TAB_OFF, True, IDLE_TEXT)
add_record_tab("记录_上下分激活", "上下分流水", -88, TAB_ON, False, ACTIVE_TEXT)
add_record_tab("记录_牌局", "牌局流水", 88, TAB_OFF, True, IDLE_TEXT)
add_record_tab("记录_牌局激活", "牌局流水", 88, TAB_ON, False, ACTIVE_TEXT)

# 表头
header = node("记录表头", records, 0, 252, 600, 30)
columns = [("时间", -228, 150), ("类型", -105, 80), ("金额", -5, 90),
           ("余额", 90, 100), ("说明", 222, 160)]
for text_value, x, width in columns:
    label("表头_" + text_value, header, text_value, x, 0, width, 28, 18, HEADER_TEXT)
line = sprite("记录分隔线", records, LINE, 0, 232, 600, 2, False)
A[line]["_opacity"] = 120

# 列表（每页最多 20 条，纵向滚动）
list_node = node("玩家设置记录列表", records, 0, -25, 600, 450)
view = node("view", list_node, 0, 0, 600, 450)
comp(view, "cc.Mask", _type=0, _spriteFrame=None)
content = node("content", view, 0, 225, 600, 450)
A[content]["_anchorPoint"]["y"] = 1
scroll = comp(list_node, "cc.ScrollView", horizontal=False, vertical=True, scrollEvents=[],
              inertia=True, cancelInnerEvents=True)
A[scroll]["_N$horizontalScrollBar"] = None
A[scroll]["_N$verticalScrollBar"] = None
A[scroll]["content"] = {"__id__": content}
A[scroll]["_N$content"] = {"__id__": content}

row = sprite("记录行模板", content, "club_settings_row_v8", 0, -42, 600, 80)
A[row]["_active"] = False
for text_value, x, width, color in [
        ("时间", -228, 150, MUTED), ("类型", -105, 80, IVORY),
        ("金额", -5, 90, GOLD), ("余额", 90, 100, IVORY),
        ("说明", 222, 160, MUTED)]:
    label(text_value, row, "—", x, 0, width, 26, 18, color)

empty = label("记录空状态", records, "暂无记录", 0, -25, 420, 40, 22, MUTED)

# 分页
prev = button("记录上一页", records, "上一页", -98, -312, 132, 48)
next_button = button("记录下一页", records, "下一页", 98, -312, 132, 48)
label("记录页码", records, "1 / 1", 0, -312, 110, 40, 20, IVORY)

PREFAB.write_text(json.dumps(A, ensure_ascii=False, indent=2) + "\n")
print("objects:", len(A))
print("tabs:", quota_idle, quota_active)
