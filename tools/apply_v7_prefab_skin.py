#!/usr/bin/env python3
"""Write the approved V7 skin directly into Cocos prefabs.

This is an editor-time migration tool, not runtime UI code.  The resulting
Prefab files contain all SpriteFrame references, 9-slice modes, positions and
sizes, so the final composition is visible in Cocos Creator without running the
game.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets/resources/V7"
MATERIAL_UUID = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432"
GOLD = {"__type__": "cc.Color", "r": 235, "g": 207, "b": 159, "a": 255}


def frame_uuid(name: str) -> str:
    meta = json.loads((ASSET_DIR / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][Path(name).stem]["uuid"]


class Prefab:
    def __init__(self, relative: str):
        self.path = ROOT / relative
        self.data = json.loads(self.path.read_text(encoding="utf-8"))
        self.root = next(i for i, obj in enumerate(self.data)
                         if obj.get("__type__") == "cc.Node" and obj.get("_parent") is None)

    def save(self):
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def node(self, path: str) -> int:
        parts = [p for p in path.split("/") if p]
        cur = self.root
        if parts and self.data[cur].get("_name") == parts[0]:
            parts.pop(0)
        for part in parts:
            children = [r["__id__"] for r in self.data[cur].get("_children", [])]
            match = next((i for i in children if self.data[i].get("_name") == part), None)
            if match is None:
                raise KeyError(f"{self.path.name}: missing node {path} at {part}")
            cur = match
        return cur

    def component(self, node_id: int, type_name: str):
        for ref in self.data[node_id].get("_components", []):
            comp = self.data[ref["__id__"]]
            if comp.get("__type__") == type_name:
                return ref["__id__"], comp
        return None, None

    def disable(self, node_id: int, type_name: str):
        _, comp = self.component(node_id, type_name)
        if comp is not None:
            comp["_enabled"] = False

    def set_pos(self, node_id: int, x: float, y: float, w=None, h=None, disable_widget=False):
        node = self.data[node_id]
        node["_trs"]["array"][0:2] = [x, y]
        if w is not None and h is not None:
            node["_contentSize"]["width"] = w
            node["_contentSize"]["height"] = h
        # Keep the project's established Widget-based screen adaptation by
        # default.  Fixed 750x1334 coordinates alone drift on tall phones.
        if disable_widget:
            self.disable(node_id, "cc.Widget")

    def set_active(self, node_id: int, value: bool):
        self.data[node_id]["_active"] = value

    def hide_children(self, node_id: int):
        for ref in self.data[node_id].get("_children", []):
            self.data[ref["__id__"]]["_active"] = False

    def ensure_sprite(self, node_id: int):
        comp_id, comp = self.component(node_id, "cc.Sprite")
        if comp is not None:
            return comp_id, comp
        comp = {
            "__type__": "cc.Sprite", "_name": "", "_objFlags": 0,
            "node": {"__id__": node_id}, "_enabled": True,
            "_materials": [{"__uuid__": MATERIAL_UUID}],
            "_srcBlendFactor": 770, "_dstBlendFactor": 771,
            "_spriteFrame": None, "_type": 0, "_sizeMode": 0,
            "_fillType": 0, "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
            "_fillStart": 0, "_fillRange": 0, "_isTrimmedMode": True,
            "_atlas": None, "_id": ""
        }
        comp_id = len(self.data)
        self.data.append(comp)
        self.data[node_id].setdefault("_components", []).insert(0, {"__id__": comp_id})
        return comp_id, comp

    def sprite(self, node_id: int, asset: str, sliced=False):
        _, comp = self.ensure_sprite(node_id)
        # Reused legacy nodes may carry a disabled Sprite component.  A new
        # SpriteFrame alone does not make those nodes visible in Creator.
        comp["_enabled"] = True
        comp["_spriteFrame"] = {"__uuid__": frame_uuid(asset)}
        comp["_type"] = 1 if sliced else 0
        comp["_sizeMode"] = 0
        comp["_isTrimmedMode"] = False

    def art(self, node_id: int, asset: str, x, y, w, h, hide=False, sliced=False):
        self.set_pos(node_id, x, y, w, h)
        self.sprite(node_id, asset, sliced)
        if hide:
            self.hide_children(node_id)

    def rename(self, node_id: int, name: str):
        self.data[node_id]["_name"] = name

    def style_labels(self):
        for obj in self.data:
            if obj.get("__type__") != "cc.Node":
                continue
            for ref in obj.get("_components", []):
                comp = self.data[ref["__id__"]]
                if comp.get("__type__") in ("cc.Label", "cc.RichText"):
                    obj["_color"] = copy.deepcopy(GOLD)

    def clone_subtree(self, source_id: int, parent_id: int, new_name: str) -> int:
        ids = set()

        def collect_node(node_id: int):
            if node_id in ids:
                return
            ids.add(node_id)
            node = self.data[node_id]
            for ref in node.get("_components", []): ids.add(ref["__id__"])
            if isinstance(node.get("_prefab"), dict): ids.add(node["_prefab"]["__id__"])
            for ref in node.get("_children", []): collect_node(ref["__id__"])

        collect_node(source_id)
        mapping = {old: len(self.data) + offset for offset, old in enumerate(sorted(ids))}

        def remap(value):
            if isinstance(value, dict):
                if set(value.keys()) == {"__id__"} and value["__id__"] in mapping:
                    return {"__id__": mapping[value["__id__"]]}
                return {k: remap(v) for k, v in value.items()}
            if isinstance(value, list):
                return [remap(v) for v in value]
            return value

        for old in sorted(ids):
            self.data.append(remap(copy.deepcopy(self.data[old])))
        new_id = mapping[source_id]
        self.data[new_id]["_parent"] = {"__id__": parent_id}
        self.data[new_id]["_name"] = new_name
        self.data[parent_id].setdefault("_children", []).append({"__id__": new_id})
        return new_id


def skin_login():
    p = Prefab("assets/resources/UI/panelLogin.prefab")
    p.sprite(p.root, "casino_bg.png")
    p.art(p.node("登录LOGO"), "shield_hd.png", 0, 350, 360, 379)
    for path, asset, y in [("手机号", "input_user.png", 70), ("密码", "input_password.png", -55)]:
        field = p.node(path)
        p.set_pos(field, 0, y, 620, 112)
        bg = p.node(path + "/BACKGROUND_SPRITE")
        p.art(bg, asset, 0, 0, 620, 112)
        for child in p.data[field].get("_children", []):
            name = p.data[child["__id__"]].get("_name")
            if name in ("线条", "线条 copy", "sj", "mm"):
                p.set_active(child["__id__"], False)
    p.art(p.node("登陆"), "login_button.png", 0, -240, 550, 100, hide=True)
    forgot = p.node("忘记密码"); p.set_active(forgot, True)
    p.art(forgot, "link_reset.png", -210, -145, 210, 54, hide=True)
    p.art(p.node("注册账号"), "link_register.png", 210, -145, 210, 54, hide=True)
    p.style_labels(); p.save()


def skin_main():
    p = Prefab("assets/resources/UI/panelMain.prefab")
    lobby = p.node("Main/发现"); mine = p.node("Main/我的"); give = p.node("赠送")
    for node in (lobby, mine, give): p.sprite(node, "casino_bg.png")

    title = p.node("Main/发现/Title")
    p.art(title, "nav_bar.png", 0, 633, 750, 68, hide=True)
    title_copy = p.clone_subtree(p.node("Main/发现/Title/大厅"), title, "V7健康提示")
    p.set_active(title_copy, True); p.art(title_copy, "title_lobby.png", 0, 0, 610, 64)
    p.art(p.node("Main/发现/LOGO"), "shield_hd.png", 0, 397, 330, 347, hide=True)

    # Visible editor-time top actions. The shared UIPanelViewBase binds Buttons
    # by node name; 排行榜 therefore keeps its existing behavior, while the two
    # future functions remain deliberately inert until their logic is added.
    source = p.node("Main/发现/过滤/加入房间")
    for name, asset, x in [("排行榜", "lobby_ranking.png", -245),
                           ("比赛场", "lobby_match.png", 0),
                           ("举报反馈", "lobby_report.png", 245)]:
        button = p.clone_subtree(source, lobby, name)
        p.set_active(button, True); p.art(button, asset, x, 160, 220, 86, hide=True)

    filt = p.node("Main/发现/过滤")
    p.art(filt, "panel_slice.png", 0, 65, 710, 84, sliced=True)
    p.disable(filt, "cc.Layout")
    join = p.node("Main/发现/过滤/加入房间")
    p.art(join, "filter_join.png", 220, 0, 180, 62, hide=True)
    toggle_specs = [("全", "all", -294), ("小", "small", -192),
                    ("中", "middle", -90), ("大", "large", 12)]
    for name, asset, x in toggle_specs:
        node = p.node("Main/发现/过滤/" + name); p.set_pos(node, x, 0, 102, 62)
        p.art(p.node(f"Main/发现/过滤/{name}/Background"), f"filter_{asset}.png", 0, 0, 102, 62)
        p.art(p.node(f"Main/发现/过滤/{name}/checkmark"), f"filter_{asset}_sel.png", 0, 0, 102, 62)
    free = p.node("Main/发现/过滤/空位条件")
    p.set_pos(free, 315, 0, 90, 62)

    room_list = p.node("Main/发现/房间列表")
    p.set_pos(room_list, 0, -287, 750, 620)
    p.set_pos(p.node("Main/发现/房间列表/view"), 0, 0, 750, 620)
    room = p.node("Main/发现/房间列表/房间对象")
    p.set_pos(room, -770.654, 295.158, 720, 138, disable_widget=False)
    p.art(p.node("Main/发现/房间列表/房间对象/房间底框"), "room_card_slice.png", 0, 0, 710, 132, sliced=True)
    p.art(p.node("Main/发现/房间列表/房间对象/大图标"), "shield_room.png", -287, 0, 92, 97)

    mine_title = p.node("Main/我的/Title")
    p.art(mine_title, "nav_bar.png", 0, 633, 750, 68, hide=True)
    mt = p.clone_subtree(p.node("Main/我的/Title/我的"), mine_title, "V7健康提示")
    p.set_active(mt, True); p.art(mt, "title_lobby.png", 0, 0, 610, 64)
    mine_logo = p.clone_subtree(p.node("Main/发现/LOGO"), mine, "V7我的盾牌")
    p.set_active(mine_logo, True); p.art(mine_logo, "shield_hd.png", 0, 445, 255, 268, hide=True)
    info = p.node("Main/我的/信息"); p.art(info, "profile_panel_slice.png", 0, 225, 650, 330, sliced=True)
    p.set_pos(p.node("Main/我的/信息/头像"), -235, 42, 132, 132)
    p.set_pos(p.node("Main/我的/信息/name"), -100, 72)
    p.set_pos(p.node("Main/我的/信息/id"), 165, 72)
    p.set_pos(p.node("Main/我的/信息/金币框"), -85, 15, 210, 44)
    data = p.node("Main/我的/数据"); p.set_active(data, True)
    p.art(data, "profile_panel_slice.png", 0, 25, 650, 172, sliced=True)
    ops = p.node("Main/我的/操作"); p.disable(ops, "cc.Layout"); p.set_pos(ops, 0, -282, 720, 360)
    specs = [("代理", "mine_agent.png", -180, 115), ("个人数据", "mine_promotion.png", 180, 115),
             ("资金明细", "mine_money.png", -180, 0), ("赠送", "mine_gift.png", 180, 0),
             ("战绩", "mine_record.png", -180, -115), ("设置", "mine_settings.png", 180, -115)]
    for name, asset, x, y in specs:
        node = p.node("Main/我的/操作/" + name); p.set_active(node, True)
        p.art(node, asset, x, y, 340, 94, hide=True)
    p.rename(p.node("Main/我的/操作/个人数据"), "推广二维码")

    down = p.node("Down"); p.art(down, "nav_bar.png", 0, -589.5, 750, 155)
    service = p.node("Down/排行榜"); p.rename(service, "客服"); p.set_active(service, True)
    p.art(service, "nav_service.png", -150, -4, 130, 132)
    specs = [("公告", -300, "announcement"), ("钱包", 150, "wallet"), ("我的", 300, "mine")]
    for name, x, asset in specs:
        node = p.node("Down/" + name); p.set_pos(node, x, -4, 130, 132)
        p.art(p.node(f"Down/{name}/Background"), f"nav_{asset}.png", 0, 0, 130, 132)
        p.art(p.node(f"Down/{name}/checkmark"), f"nav_{asset}_sel.png", 0, 0, 130, 132)
    center = p.node("Down/发现"); p.set_pos(center, 0, -4, 150, 154)
    p.art(p.node("Down/发现/Background"), "shield_nav.png", 0, 0, 146, 154)
    p.art(p.node("Down/发现/checkmark"), "shield_nav.png", 0, 0, 146, 154)
    p.set_active(p.node("Down/发现/New Node"), False)

    give_title = p.node("赠送/title"); p.art(give_title, "nav_bar.png", 0, 626, 750, 82)
    p.art(p.node("赠送/title/赠送_受赠记录"), "title_gift.png", 0, 0, 360, 72)
    hero = p.clone_subtree(p.node("Main/发现/LOGO"), give, "V7赠送主视觉")
    p.set_active(hero, True); p.art(hero, "gift_hero.png", 0, 410, 750, 323, hide=True)
    operation = p.node("赠送/操作"); p.set_pos(operation, 0, 113, 750, 285)
    user = p.node("赠送/操作/用户id"); p.set_pos(user, 0, 72, 660, 92)
    p.art(p.node("赠送/操作/用户id/BACKGROUND_SPRITE"), "give_user.png", 0, 0, 660, 92)
    amount = p.node("赠送/操作/金额"); p.set_active(amount, True); p.set_pos(amount, 0, -33, 660, 92)
    p.art(p.node("赠送/操作/金额/BACKGROUND_SPRITE"), "give_amount.png", 0, 0, 660, 92)
    p.set_active(p.node("赠送/操作/垫底长"), False)
    p.art(p.node("赠送/操作/提交赠送"), "gift_confirm.png", 0, -142, 420, 92, hide=True)
    p.art(p.node("赠送/标题"), "panel_slice.png", 0, -90, 710, 70, sliced=True)
    p.art(p.node("赠送/赠送记录列表"), "panel_slice.png", 0, -380, 710, 500, sliced=True)
    p.set_pos(p.node("赠送/分页"), 0, -610, 710, 66)
    p.style_labels(); p.save()


def skin_record_list():
    p = Prefab("assets/resources/UI/panelRecordList.prefab")
    p.sprite(p.root, "casino_bg.png"); p.set_active(p.node("bg"), False)
    p.art(p.node("title"), "nav_bar.png", 0, 626, 750, 82)
    p.art(p.node("title/我的战绩"), "title_records.png", 0, 0, 360, 72)
    stats = p.node("统计"); p.hide_children(stats); p.art(stats, "shield_hd.png", 0, 402, 310, 327)
    cond = p.node("条件"); p.disable(cond, "cc.Layout"); p.set_pos(cond, 0, 210, 670, 72)
    for name, key, x in [("-2", "today", -220), ("-1", "yesterday", 0), ("0", "before", 220)]:
        n=p.node("条件/"+name); p.set_pos(n,x,0,210,62)
        p.art(p.node(f"条件/{name}/Background"),f"date_{key}.png",0,0,210,62)
        p.art(p.node(f"条件/{name}/checkmark"),f"date_{key}_sel.png",0,0,210,62)
    p.art(p.node("标题"), "panel_slice.png", 0, 130, 720, 72, sliced=True)
    p.art(p.node("战绩列表"), "panel_slice.png", 0, -245, 720, 665, sliced=True)
    p.style_labels(); p.save()


def skin_record_row():
    p=Prefab("assets/resources/Prefabs/战绩对象.prefab")
    p.art(p.root,"row_slice.png",0,-48,710,112,sliced=True)
    p.set_active(p.node("垫底长"),False)
    for name in ("s房间","s筹码","s时间","s分数"): p.set_active(p.node(name),False)
    p.style_labels();p.save()


def skin_give_pad():
    p=Prefab("assets/resources/UI/panelGivePad.prefab")
    bk=p.node("bk");p.art(bk,"panel_slice.png",-60,80,700,650,sliced=True)
    p.art(p.node("bk/img"),"give_amount.png",0,-1,660,92)
    p.art(p.node("bk/img copy"),"give_password.png",0,-106,660,92)
    p.art(p.node("bk/确定赠送"),"gift_confirm.png",130,-235,420,92,hide=True)
    p.style_labels();p.save()


def skin_settlement():
    p=Prefab("assets/resources/UI/panelRecordInfo.prefab")
    p.sprite(p.root,"casino_bg.png");p.set_active(p.node("bg"),False)
    p.art(p.node("title"),"nav_bar.png",0,628,750,78)
    p.art(p.node("title/战局详情"),"title_settlement.png",0,0,360,72)
    ranks=p.node("排行");p.disable(ranks,"cc.Layout");p.art(ranks,"panel_slice.png",0,390,700,330,sliced=True)
    for name,asset,x in [("土豪","rank_runner.png",-235),("MVP","rank_mvp.png",0),("大鱼","rank_third.png",235)]:
        p.art(p.node("排行/"+name),asset,x,0,180,210)
    p.set_active(p.node("排行/劳模"),False)
    p.set_pos(p.node("排行/排队"),0,-145)
    p.art(p.node("基本"),"panel_slice.png",0,202,700,62,sliced=True)
    p.art(p.node("扩展"),"panel_slice.png",0,132,700,62,sliced=True)
    p.art(p.node("战绩列表"),"panel_slice.png",0,-232,700,620,sliced=True)
    p.set_active(p.node("title/关闭"),False);p.set_active(p.node("title/牌局回顾"),False)
    close=p.clone_subtree(p.node("title/关闭"),p.root,"关闭")
    p.set_active(close,True);p.art(close,"settlement_return.png",0,-602,360,88,hide=True)
    p.style_labels();p.save()


def skin_settlement_row():
    p=Prefab("assets/resources/Prefabs/战绩玩家对象.prefab")
    p.art(p.root,"row_slice.png",375,-70,680,110,sliced=True)
    p.set_active(p.node("line"),False)
    p.style_labels();p.save()


def main():
    skin_login()
    skin_main()
    skin_record_list()
    skin_record_row()
    skin_give_pad()
    skin_settlement()
    skin_settlement_row()


if __name__ == "__main__":
    main()
