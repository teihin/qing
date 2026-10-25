"""Refine the formal club-member page with the approved V8 blue/gold language."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / "assets/resources/UI/panelMain.prefab"

# Reuse the project’s prefab helpers so every new node gets a valid PrefabInfo,
# UUID reference and Cocos 2.4-compatible component shape.
exec((Path(__file__).with_name("apply_club_management_ui.py")).read_text().split("assert not any")[0])

BASE = "俱乐部成员弹窗/面板"


def locate(relative):
    return path(BASE + ("/" + relative if relative else ""))


def set_geometry(index, x, y, width, height):
    A[index]["_trs"]["array"][:2] = [x, y]
    A[index]["_contentSize"].update(width=width, height=height)


def set_widget_top(index, top):
    for ref in A[index]["_components"]:
        component = A[ref["__id__"]]
        if component["__type__"] == "cc.Widget":
            component["_top"] = top
            return


def disable_widget(index):
    for ref in A[index]["_components"]:
        component = A[ref["__id__"]]
        if component["__type__"] == "cc.Widget":
            component["_enabled"] = False


def responsive_widget(index, flags, *, top=0, bottom=0, left=0, right=0,
                     horizontal_center=0, vertical_center=0):
    """Pin authored elements to the live canvas while retaining the 750-wide design."""
    component = next((A[ref["__id__"]] for ref in A[index]["_components"]
                      if A[ref["__id__"]]["__type__"] == "cc.Widget"), None)
    if component is None:
        widget(index, flags)
        component = next(A[ref["__id__"]] for ref in A[index]["_components"]
                         if A[ref["__id__"]]["__type__"] == "cc.Widget")
    component.update({
        "_enabled": True, "alignMode": 1, "_alignFlags": flags,
        "_left": left, "_right": right, "_top": top, "_bottom": bottom,
        "_horizontalCenter": horizontal_center, "_verticalCenter": vertical_center,
        "_target": None, "_originalWidth": A[index]["_contentSize"]["width"],
        "_originalHeight": A[index]["_contentSize"]["height"],
    })


def frame_uuid(art):
    meta = json.loads((ROOT / "assets/V7" / (art + ".png.meta")).read_text())
    return meta["subMetas"][art]["uuid"]


def set_sprite(index, art, sliced=True):
    for ref in A[index]["_components"]:
        component = A[ref["__id__"]]
        if component["__type__"] == "cc.Sprite":
            component["_spriteFrame"] = {"__uuid__": frame_uuid(art)}
            component["_type"] = 1 if sliced else 0
            component["_sizeMode"] = 0
            return
    comp(index, "cc.Sprite", _spriteFrame={"__uuid__": frame_uuid(art)},
         _type=1 if sliced else 0, _sizeMode=0)


def label_component(index):
    for ref in A[index]["_components"]:
        component = A[ref["__id__"]]
        if component["__type__"] == "cc.Label":
            return component
    return None


def style_label(index, size=None, color=None, align=0, text=None):
    component = label_component(index)
    if not component:
        return
    if size is not None:
        component["_fontSize"] = size
        component["_lineHeight"] = size + 6
    component["_N$horizontalAlign"] = align
    component["_N$verticalAlign"] = 1
    if text is not None:
        component["_string"] = text
        component["_N$string"] = text
    if color is not None:
        A[index]["_color"].update(r=color[0], g=color[1], b=color[2], a=255)


def set_button_art(index, text_size=18):
    set_sprite(index, "agent_v8_button_base", True)
    for ref in A[index]["_children"]:
        child = A[ref["__id__"]]
        if child["_name"] == "文字":
            style_label(ref["__id__"], size=text_size, color=(255, 238, 197), align=1)


def has_child(parent, name):
    return any(A[ref["__id__"]]["_name"] == name for ref in A[parent]["_children"])


def add_label_once(parent, name, text, x, y, width, height, size, color, align=0):
    if has_child(parent, name):
        index = next(ref["__id__"] for ref in A[parent]["_children"]
                     if A[ref["__id__"]]["_name"] == name)
        set_geometry(index, x, y, width, height)
        style_label(index, size=size, color=color, align=align, text=text)
        return index
    return label(name, parent, text, x, y, width, height, size, color)


def add_sprite_once(parent, name, art, x, y, width, height, sliced=True):
    if has_child(parent, name):
        index = next(ref["__id__"] for ref in A[parent]["_children"]
                     if A[ref["__id__"]]["_name"] == name)
        set_geometry(index, x, y, width, height)
        set_sprite(index, art, sliced)
        return index
    return sprite(name, parent, art, x, y, width, height, sliced)


def child_index(parent, name):
    return next((ref["__id__"] for ref in A[parent]["_children"]
                 if A[ref["__id__"]]["_name"] == name), None)


def button_component(index):
    for ref in A[index]["_components"]:
        if A[ref["__id__"]]["__type__"] == "cc.Button":
            return A[ref["__id__"]]
    return None


def add_v8_button_once(parent, name, text_value, x, y, width, height,
                       art="agent_v8_button_base", size=18):
    index = child_index(parent, name)
    if index is None:
        index = sprite(name, parent, art, x, y, width, height, True)
        comp(index, "cc.Button", clickEvents=[])
        A[-1]["_N$target"] = None
        label("文字", index, text_value, 0, 0, width - 12, height - 8, size,
              (255, 238, 197))
    else:
        set_geometry(index, x, y, width, height)
        set_sprite(index, art, True)
        if not button_component(index):
            comp(index, "cc.Button", clickEvents=[])
            A[-1]["_N$target"] = None
        text_node = child_index(index, "文字")
        if text_node is None:
            text_node = label("文字", index, text_value, 0, 0, width - 12, height - 8, size,
                              (255, 238, 197))
        else:
            set_geometry(text_node, 0, 0, width - 12, height - 8)
            style_label(text_node, size=size, color=(255, 238, 197), align=1, text=text_value)
    return index


def add_icon_button_once(parent, name, art, x, y, width, height):
    index = child_index(parent, name)
    if index is None:
        index = sprite(name, parent, art, x, y, width, height, False)
        comp(index, "cc.Button", clickEvents=[])
        A[-1]["_N$target"] = None
    else:
        set_geometry(index, x, y, width, height)
        set_sprite(index, art, False)
        if not button_component(index):
            comp(index, "cc.Button", clickEvents=[])
            A[-1]["_N$target"] = None
    for ref in A[index]["_children"]:
        A[ref["__id__"]]["_active"] = False
    return index


def label_component_id(index):
    for ref in A[index]["_components"]:
        if A[ref["__id__"]]["__type__"] == "cc.Label":
            return ref["__id__"]
    return None


def add_editbox_once(parent, name, placeholder, x, y, width, height, max_length=20):
    index = child_index(parent, name)
    if index is None:
        index = sprite(name, parent, "agent_v8_button_base", x, y, width, height, True)
        text_node = label("文字", index, "", 0, 0, width - 18, height - 8, 18,
                          (239, 249, 255))
        hint_node = label("提示", index, placeholder, 0, 0, width - 18, height - 8, 17,
                          (128, 185, 218))
        edit_id = comp(index, "cc.EditBox", _string="", maxLength=max_length,
                       **{"_N$textLabel": {"__id__": label_component_id(text_node)},
                          "_N$placeholderLabel": {"__id__": label_component_id(hint_node)},
                          "_N$background": None, "_N$inputFlag": 5, "_N$inputMode": 2})
        A[edit_id]["returnType"] = 0
    else:
        set_geometry(index, x, y, width, height)
        set_sprite(index, "agent_v8_button_base", True)
        text_node = child_index(index, "文字")
        hint_node = child_index(index, "提示")
        if text_node is None:
            text_node = label("文字", index, "", 0, 0, width - 18, height - 8, 18,
                              (239, 249, 255))
        else:
            set_geometry(text_node, 0, 0, width - 18, height - 8)
        if hint_node is None:
            hint_node = label("提示", index, placeholder, 0, 0, width - 18, height - 8, 17,
                              (128, 185, 218))
        else:
            set_geometry(hint_node, 0, 0, width - 18, height - 8)
            style_label(hint_node, size=17, color=(128, 185, 218), align=1, text=placeholder)
        edit_id = next((ref["__id__"] for ref in A[index]["_components"]
                        if A[ref["__id__"]]["__type__"] == "cc.EditBox"), None)
        if edit_id is None:
            edit_id = comp(index, "cc.EditBox", _string="", maxLength=max_length,
                           **{"_N$textLabel": {"__id__": label_component_id(text_node)},
                              "_N$placeholderLabel": {"__id__": label_component_id(hint_node)},
                              "_N$background": None, "_N$inputFlag": 5, "_N$inputMode": 2})
        else:
            A[edit_id]["_N$textLabel"] = {"__id__": label_component_id(text_node)}
            A[edit_id]["_N$placeholderLabel"] = {"__id__": label_component_id(hint_node)}
            A[edit_id]["maxLength"] = max_length
    return index


def add_toggle_button_once(parent, name, x, y):
    index = child_index(parent, name)
    if index is None:
        index = node(name, parent, x, y, 76, 40)
        comp(index, "cc.Button", clickEvents=[])
        A[-1]["_N$target"] = None
    else:
        set_geometry(index, x, y, 76, 40)
        if not button_component(index):
            comp(index, "cc.Button", clickEvents=[])
            A[-1]["_N$target"] = None
    add_sprite_once(index, "开", "settings_v8_toggle_on", 0, 0, 78, 44, False)
    add_sprite_once(index, "关", "settings_v8_toggle_off", 0, 0, 78, 44, False)
    return index


panel = locate("")
responsive_widget(panel, 45, top=0, bottom=0, left=0, right=0)
summary = locate("成员概况底板")
set_geometry(summary, 0, 528, 714, 86)
set_sprite(summary, "record_list_panel_exact", True)
responsive_widget(summary, 17, top=79, horizontal_center=0)

# Reuse the formal 我的战绩 header language: the record header supplies the
# deep-blue field, gold lower rule and curved divider. Its baked title and
# announcement area are covered by clean blue plates before the member title
# is drawn as an independent label.
title_bar = locate("标题底")
set_geometry(title_bar, 0, 631, 750, 72)
set_sprite(title_bar, "member_header_record_v8", False)
responsive_widget(title_bar, 41, top=0, left=0, right=0)
title = locate("标题底/标题")
A[title]["_active"] = False
header_cover_left = add_sprite_once(panel, "成员标题覆盖左", "nav_bar", -172, 631, 255, 72, False)
header_cover_right = add_sprite_once(panel, "成员标题覆盖右", "nav_bar", 175, 631, 400, 72, False)
header_title = add_label_once(panel, "成员标题字", "我的成员", -170, 631, 230, 60, 36,
                              (255, 239, 197), 0)
for header_node in (header_cover_left, header_cover_right):
    A[header_node]["_active"] = False
    disable_widget(header_node)
responsive_widget(header_title, 17, top=0, horizontal_center=-170)
close = locate("管理关闭")
set_geometry(close, -323, 631, 72, 60)
responsive_widget(close, 17, top=0, horizontal_center=-323)
set_sprite(close, "wallet_header_back_v8", False)
for ref in A[close]["_components"]:
    component = A[ref["__id__"]]
    if component["__type__"] == "cc.Sprite":
        # The record header already contains the approved back arrow. Keep
        # this node as the transparent click target so a second arrow cannot
        # stack on top of the title art.
        component["_enabled"] = False
return_text = next((ref["__id__"] for ref in A[close]["_children"]
                    if A[ref["__id__"]]["_name"] == "返回文字"), None)
if return_text is not None:
    A[return_text]["_active"] = False

# Summary/header: retain the existing dynamic node names used by the controller.
info = locate("俱乐部信息")
set_geometry(info, -70, 542, 400, 34)
responsive_widget(info, 17, top=108, horizontal_center=-70)
style_label(info, size=22, color=(239, 246, 255), align=0)
stats = locate("统计")
set_geometry(stats, 0, 520, 190, 28)
disable_widget(stats)
A[stats]["_active"] = False
style_label(stats, size=18, color=(203, 231, 246), align=1)
apply_button = locate("管理申请")
set_geometry(apply_button, 260, 542, 160, 58)
responsive_widget(apply_button, 17, top=96, horizontal_center=260)
set_button_art(apply_button, 18)

# Search stays in the member header; the application entry remains the
# top-right action requested by the product flow.
search = add_editbox_once(panel, "成员搜索输入", "请输入玩家ID或昵称", -150, 458, 300, 48)
query = add_v8_button_once(panel, "管理查询成员", "查询", 70, 458, 100, 48,
                           "agent_v8_button_base", 18)
reset = add_v8_button_once(panel, "管理重置成员搜索", "重置", 190, 458, 100, 48,
                           "agent_v8_button_base", 18)
for index in (search, query, reset):
    A[index]["_active"] = True
    responsive_widget(index, 17, top=194,
                     horizontal_center=A[index]["_trs"]["array"][0])

# The approved V8 members mark makes the summary visibly different from the
# old plain dialog while leaving the summary text and action nodes live.
emblem = add_sprite_once(panel, "成员徽记", "club_members_v8", -300, 494, 70, 58, False)
A[emblem]["_active"] = False

# A deep list panel gives the cards a clear container against the lobby scene.
list_panel = add_sprite_once(panel, "成员列表底板", "record_list_panel_exact",
                             0, 20, 714, 774, True)
responsive_widget(list_panel, 45, top=260, bottom=300, left=18, right=18)
children = A[panel]["_children"]
children.remove({"__id__": emblem})
summary_ref_index = next(i for i, ref in enumerate(children) if ref["__id__"] == summary)
children.insert(summary_ref_index + 1, {"__id__": emblem})
children.remove({"__id__": list_panel})
list_id = locate("列表")
list_ref_index = next(i for i, ref in enumerate(children) if ref["__id__"] == list_id)
children.insert(list_ref_index, {"__id__": list_panel})

# Keep the established scroll/pagination contract, but use a four-card viewport
# with enough vertical room for the competitor-style metrics.
list_id = locate("列表")
set_geometry(list_id, 0, 20, 714, 774)
responsive_widget(list_id, 45, top=260, bottom=300, left=18, right=18)
view = locate("列表/view")
set_geometry(view, 0, 0, 714, 774)
responsive_widget(view, 45, top=0, bottom=0, left=0, right=0)
content = locate("列表/view/content")
set_geometry(content, 0, 387, 714, 774)
disable_widget(content)
row = locate("列表/view/content/行模板")
set_geometry(row, 0, -94, 690, 188)
set_sprite(row, "record_row_exact", True)

# Left profile block.
avatar = locate("列表/view/content/行模板/头像")
set_geometry(avatar, -293, 46, 70, 70)
name = locate("列表/view/content/行模板/姓名")
set_geometry(name, -168, 69, 155, 32)
style_label(name, size=24, color=(255, 246, 222), align=0)
player_id = locate("列表/view/content/行模板/玩家ID")
set_geometry(player_id, -168, 41, 155, 25)
style_label(player_id, size=17, color=(201, 229, 243), align=0)
identity = locate("列表/view/content/行模板/身份")
set_geometry(identity, -293, -15, 96, 27)
style_label(identity, size=16, color=(255, 239, 194), align=1)
balance = locate("列表/view/content/行模板/余额")
set_geometry(balance, -168, -16, 78, 25)
style_label(balance, size=20, color=(229, 248, 252), align=0, text="积分")
add_label_once(row, "积分值", "—", -83, -16, 78, 25, 21, (255, 231, 112), 0)

# Status is optional in the wire response. It still has a reserved V8 slot.
status_back = add_sprite_once(row, "状态底", "agent_v8_button_base", -293, -48, 96, 28, True)
status = add_label_once(row, "状态", "状态 —", -293, -48, 96, 26, 16,
                        (194, 241, 252), 1)

# Competitor-style metrics. Names are stable so the controller can fill them
# without creating runtime UI nodes.
metric_color = (229, 248, 252)
for metric, x, y in [
    ("团队人数", -168, 12),
    ("今日输赢", -18, 51),
    ("昨日输赢", -18, 24),
    ("总输赢", -18, -3),
    ("今日贡献", 132, 51),
    ("昨日贡献", 132, 24),
    ("总贡献", 132, -3),
]:
    add_label_once(row, metric, metric, x, y, 82, 28, 20, metric_color, 0)
    add_label_once(row, metric + "值", "—", x + 84, y, 72, 28, 21, (255, 231, 112), 0)

# Small separators keep the dense card readable without introducing a new art
# family. They are independent decorative nodes, so the live labels remain live.
metric_rule = add_sprite_once(row, "指标分隔线", "agent_v8_rule_horizontal", 92, 38, 285, 2, False)
profile_rule = add_sprite_once(row, "资料分隔线", "agent_v8_rule_vertical", -103, 31, 2, 116, False)
A[metric_rule]["_active"] = False
A[profile_rule]["_active"] = False

# Preserve the current action names and the user’s existing 「设置」 rename.
for button_name, x in [("成员删除", -190), ("成员赠予", 0), ("设置", 190), ("成员设管理员", 190)]:
    if has_child(row, button_name):
        action = next(ref["__id__"] for ref in A[row]["_children"]
                      if A[ref["__id__"]]["_name"] == button_name)
        A[action]["_active"] = False

# A Button component on the avatar keeps the interaction discoverable in the
# formal Prefab; ClubManagementView binds the runtime callback to each clone.
if not button_component(avatar):
    comp(avatar, "cc.Button", clickEvents=[])
    A[-1]["_N$target"] = None

# Keep pagination in the established bottom-safe area, using the V8 first/last
# page icons from the competitor layout.
for node_name, x, y, width, height in [
    ("页码", 0, -563, 150, 44),
    ("管理刷新", 0, -633, 180, 44),
]:
    index = locate(node_name)
    set_geometry(index, x, y, width, height)
    if node_name == "管理刷新":
        set_button_art(index, 19)
    else:
        style_label(index, size=23, color=(255, 246, 222), align=1)

add_icon_button_once(panel, "管理第一页", "agent_v8_page_first", -285, -563, 64, 64)
add_icon_button_once(panel, "管理上一页", "agent_v8_page_prev", -200, -563, 64, 64)
add_icon_button_once(panel, "管理下一页", "agent_v8_page_next", 200, -563, 64, 64)
add_icon_button_once(panel, "管理最后一页", "agent_v8_page_last", 285, -563, 64, 64)
for node_name, x in [("页码", 0), ("管理第一页", -285), ("管理上一页", -200),
                     ("管理下一页", 200), ("管理最后一页", 285)]:
    responsive_widget(locate(node_name), 20, bottom=72, horizontal_center=x)
responsive_widget(locate("管理刷新"), 20, bottom=12, horizontal_center=0)


def add_node_once(parent, name, x, y, width, height, active=True):
    index = child_index(parent, name)
    if index is None:
        index = node(name, parent, x, y, width, height, active=active)
    else:
        set_geometry(index, x, y, width, height)
        A[index]["_active"] = active
    return index


def has_component(index, type_name):
    return any(A[ref["__id__"]]["__type__"] == type_name
               for ref in A[index]["_components"])


def ensure_widget(index):
    if not has_component(index, "cc.Widget"):
        widget(index, 45)


def add_settings_row(settings_panel, name, caption, y):
    card = add_sprite_once(settings_panel, name + "底", "player_info_v8_stats",
                           0, y, 626, 82, True)
    add_label_once(settings_panel, name, caption, -235, y, 150, 38, 22,
                   (222, 240, 244), 0)
    return card


# Player settings is a formal V8 modal, not a runtime-created layout. The
# documented score/proxy operations are wired in ClubManagementView; the
# competitor-only remark/ban rows remain visible but disabled until the server
# exposes commands for them.
settings_root = add_node_once(1, "俱乐部玩家设置弹窗", 0, 0, 750, 1334, active=False)
ensure_widget(settings_root)
mask = add_sprite_once(settings_root, "遮罩", "nav_bar", 0, 0, 750, 1334, False)
A[mask]["_color"].update(r=0, g=7, b=16, a=255)
A[mask]["_opacity"] = 205
ensure_widget(mask)
if not has_component(mask, "cc.BlockInputEvents"):
    comp(mask, "cc.BlockInputEvents")
settings_panel = add_sprite_once(settings_root, "面板", "agent_v8_popup", 0, -32, 674, 930, True)
title_art = add_sprite_once(settings_panel, "标题", "original_dialog_title", 0, -423, 434, 92, True)
add_label_once(settings_panel, "玩家信息标题", "玩家信息", 0, -423, 360, 60, 36,
               (239, 247, 255), 1)
close_settings = add_icon_button_once(settings_panel, "玩家设置关闭", "popup_close_exact", 290, -423, 56, 56)

avatar_frame = add_sprite_once(settings_panel, "头像框", "player_info_v8_avatar_frame", -249, -270, 132, 132, False)
avatar_settings = add_sprite_once(settings_panel, "头像", "club_members_v8", -249, -270, 104, 104, False)
add_label_once(settings_panel, "玩家姓名", "玩家昵称", -171, -309, 220, 40, 28,
               (239, 247, 255), 0)
add_label_once(settings_panel, "玩家ID", "ID: 000000", -171, -270, 210, 34, 22,
               (202, 231, 243), 0)
add_icon_button_once(settings_panel, "玩家设置复制ID", "player_info_v8_copy", -16, -270, 32, 34)
add_label_once(settings_panel, "玩家身份", "成员", -171, -235, 190, 30, 19,
               (255, 237, 190), 0)
add_label_once(settings_panel, "玩家状态", "在线", -171, -205, 190, 28, 18,
               (122, 229, 185), 0)
add_sprite_once(settings_panel, "积分底", "player_info_v8_stats", -168, -183, 250, 58, True)
add_label_once(settings_panel, "玩家积分值", "—", -168, -183, 220, 36, 24,
               (255, 231, 112), 0)
add_editbox_once(settings_panel, "玩家设置分数输入", "输入目标积分", 91, -350, 202, 42, 12)
add_v8_button_once(settings_panel, "玩家设置调整分数", "调整分数", 91, -292, 202, 58,
                   "original_dialog_button_blue", 19)
add_v8_button_once(settings_panel, "玩家设置踢出俱乐部", "踢出俱乐部", 91, -225, 202, 58,
                   "original_dialog_button_gold", 19)

member_tab = add_v8_button_once(settings_panel, "成员设置", "成员设置", -165, -86, 300, 78,
                                "original_dialog_button_blue", 25)
member_tab_inactive = add_v8_button_once(settings_panel, "成员设置非激活", "成员设置", -165, -86, 300, 78,
                                         "player_info_v8_stats", 25)
lower_tab = add_label_once(settings_panel, "下级成员", "下级成员", 130, -86, 230, 44, 25,
                           (143, 177, 199), 1)
if not button_component(lower_tab):
    comp(lower_tab, "cc.Button", clickEvents=[])
    A[-1]["_N$target"] = None
lower_tab_active = add_v8_button_once(settings_panel, "下级成员激活", "下级成员", 130, -86, 230, 78,
                                      "original_dialog_button_blue", 25)
for tab_index in (member_tab_inactive, lower_tab_active):
    A[tab_index]["_active"] = False

# The lower tab has a real, clean content surface. Its row template is hidden
# in the prefab and cloned by ClubManagementView after ClubAgentInfo arrives.
downline_list = add_sprite_once(settings_panel, "玩家设置下级列表", "player_info_v8_stats",
                                0, 105, 626, 300, True)
A[downline_list]["_active"] = False
add_label_once(downline_list, "下级成员空状态", "暂无下级成员", 0, 0, 460, 46, 24,
               (195, 225, 236), 1)
downline_template = add_sprite_once(downline_list, "下级成员行模板", "player_info_v8_stats",
                                    0, 105, 570, 58, True)
A[downline_template]["_active"] = False
add_label_once(downline_template, "姓名", "玩家昵称", -190, 0, 210, 34, 20,
               (239, 247, 255), 0)
add_label_once(downline_template, "玩家ID", "ID: 000000", 25, 0, 170, 34, 18,
               (202, 231, 243), 0)
add_label_once(downline_template, "比例", "0%", 190, 0, 90, 34, 20,
               (255, 231, 112), 1)

add_settings_row(settings_panel, "备注", "备注", 22)
add_label_once(settings_panel, "备注值", "未设置", -62, 22, 250, 38, 22,
               (222, 240, 244), 0)
add_v8_button_once(settings_panel, "玩家设置备注", "备注", 229, 22, 126, 54,
                   "original_dialog_button_blue", 18)

add_settings_row(settings_panel, "比例", "比例", 120)
add_label_once(settings_panel, "比例值", "未开通", -62, 120, 180, 38, 22,
               (222, 240, 244), 0)
add_editbox_once(settings_panel, "玩家设置比例输入", "0-100", 74, 120, 92, 42, 3)
add_v8_button_once(settings_panel, "玩家设置调整比例", "调整", 229, 120, 126, 54,
                   "original_dialog_button_blue", 18)

add_settings_row(settings_panel, "代理", "开通代理", 218)
add_label_once(settings_panel, "代理开关文字", "关", 172, 218, 52, 30, 20,
               (222, 240, 244), 1)
add_toggle_button_once(settings_panel, "玩家设置代理开关", 240, 218)

add_settings_row(settings_panel, "禁止游戏", "禁止游戏", 316)
add_toggle_button_once(settings_panel, "玩家设置禁止游戏", 240, 316)
add_settings_row(settings_panel, "禁止账号", "禁止账号", 414)
add_toggle_button_once(settings_panel, "玩家设置禁止账号", 240, 414)
for toggle_name in ["玩家设置代理开关", "玩家设置禁止游戏", "玩家设置禁止账号"]:
    toggle = child_index(settings_panel, toggle_name)
    if toggle is not None:
        on_node = child_index(toggle, "开")
        off_node = child_index(toggle, "关")
        if on_node is not None:
            A[on_node]["_active"] = False
        if off_node is not None:
            A[off_node]["_active"] = True

# The competitor layout currently omits these unsupported operations. Keep the
# old nodes serialized for callback compatibility, but remove both rows from
# the visible formal design until the server exposes their commands.
for hidden_name in ["禁止游戏", "禁止游戏底", "玩家设置禁止游戏",
                    "禁止账号", "禁止账号底", "玩家设置禁止账号"]:
    hidden = child_index(settings_panel, hidden_name)
    if hidden is not None:
        A[hidden]["_active"] = False

PREFAB.write_text(json.dumps(A, ensure_ascii=False, indent=2) + "\n")
print("V8 club member card refinement written")
