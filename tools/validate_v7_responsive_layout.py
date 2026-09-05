#!/usr/bin/env python3
"""Read-only checks for the V7 Prefab skin and portrait aspect adaptation."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageStat

from apply_v7_prefab_skin import Prefab


ROOT = Path(__file__).resolve().parents[1]
V7 = ROOT / "assets/resources/V7"
HEIGHTS = (1334, 1500, 1624, 1778)


def require(ok: bool, message: str) -> None:
    if not ok:
        raise AssertionError(message)


def widget(p: Prefab, path: str, flags: int, **offsets: float) -> None:
    node_id = p.node(path)
    _, value = p.component(node_id, "cc.Widget")
    require(value is not None, f"{p.path}:{path} 缺少 cc.Widget")
    require(value.get("_enabled") is True, f"{p.path}:{path} Widget 未启用")
    require(value.get("_alignFlags") == flags,
            f"{p.path}:{path} alignFlags={value.get('_alignFlags')}，预期 {flags}")
    for key, expected in offsets.items():
        actual = value.get(f"_{key}")
        # Existing 2.4 Prefabs retain sub-pixel offsets from editor resizing.
        require(abs(actual - expected) < 0.5,
                f"{p.path}:{path} {key}={actual}，预期 {expected}")


def full(p: Prefab, path: str) -> None:
    widget(p, path, 45, left=0, right=0, top=0, bottom=0)


def centered(p: Prefab, path: str) -> None:
    anchor = p.data[p.node(path)].get("_anchorPoint", {})
    require(abs(anchor.get("x", -1) - 0.5) < 0.001 and
            abs(anchor.get("y", -1) - 0.5) < 0.001,
            f"{p.path}:{path} 未使用中心锚点: {anchor}")


def sprite_uuid(name: str) -> str:
    meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
    return meta["subMetas"][name.removesuffix(".png")]["uuid"]


def validate_widgets() -> None:
    login = Prefab("assets/resources/UI/panelLogin.prefab")
    full(login, "panelLogin")
    for path, top_value in (
        ("登录LOGO", 166), ("手机号", 603), ("密码", 735),
        ("忘记密码", 875), ("注册账号", 875), ("登陆", 970),
    ):
        widget(login, path, 17, top=top_value)

    main = Prefab("assets/resources/UI/panelMain.prefab")
    require(main.data[main.node("推广二维码")].get("_active") is False,
            "游戏推广页不应在打开大厅时默认显示")
    for path in ("panelMain", "Main", "Main/发现", "Main/我的", "赠送"):
        full(main, path)
    widget(main, "Main/发现/Title", 41, left=0, right=0, top=0)
    widget(main, "Main/发现/LOGO", 17, top=64)
    widget(main, "Main/发现/排行榜", 17, top=486)
    widget(main, "Main/发现/比赛场", 17, top=486)
    widget(main, "Main/发现/举报反馈", 17, top=486)
    widget(main, "Main/发现/V8声音入口", 17, top=0)
    widget(main, "Main/发现/过滤", 17, top=594)
    for suffix in ("Background", "checkmark"):
        checkbox = main.data[main.node(
            f"Main/发现/过滤/空位条件/有空位/{suffix}")]
        checkbox_pos = tuple(checkbox["_trs"]["array"][:2])
        checkbox_size = checkbox["_contentSize"]
        require(checkbox_pos == (-60, 0) and
                (checkbox_size["width"], checkbox_size["height"]) == (32, 32),
                f"有空位复选框{suffix}没有对齐勾选框中心: {checkbox_pos}")
    widget(main, "Main/发现/房间列表", 45, left=0, right=0, top=700, bottom=134)
    full(main, "Main/发现/房间列表/view")
    widget(main, "Main/公告/V7公告菜单高清母版", 17, top=0)
    full(main, "Main/公告/主页")
    for path, top_value in (
        ("公告6", 354), ("公告1", 515),
        ("公告2", 672), ("公告5", 831),
    ):
        widget(main, f"Main/公告/主页/{path}", 17, top=top_value)
    for page in ("公告1", "公告2", "公告5", "公告6"):
        widget(main, f"{page}/V7公告详情长背景", 17, top=0)
        widget(main, f"{page}/title", 41, left=0, right=0, top=0)
        widget(main, f"{page}/list", 45,
               left=0, right=0, top=81, bottom=0)
        if page == "公告6":
            widget(main, f"{page}/list/view", 45,
                   left=65, right=65, top=130, bottom=55)
        else:
            full(main, f"{page}/list/view")
        widget(main, f"{page}/list/view/content", 40, top=0)
    full(main, "公告6/list/V7公告正文高清母版")
    widget(main, "Main/我的/Title", 41, left=0, right=0, top=0)
    widget(main, "Main/我的/信息", 17, top=334)
    widget(main, "Main/我的/数据", 17, top=334)
    widget(main, "Main/我的/操作", 17, top=664)
    widget(main, "Down", 44, left=0, right=0, bottom=0)
    widget(main, "赠送/title", 41, left=0, right=0, top=0)
    widget(main, "赠送/V7赠送主视觉", 17, top=81)
    widget(main, "赠送/操作", 41, left=0, right=0, top=380)
    widget(main, "赠送/标题", 17, top=784)
    widget(main, "赠送/赠送记录列表", 45, left=21, right=21, top=890, bottom=167)
    widget(main, "赠送/分页", 20, bottom=59)

    records = Prefab("assets/resources/UI/panelRecordList.prefab")
    full(records, "panelRecordList")
    widget(records, "title", 41, left=0, right=0, top=0)
    widget(records, "统计", 17, top=72)
    widget(records, "条件", 17, top=440)
    widget(records, "标题", 17, top=520)
    widget(records, "战绩列表", 45, left=14, right=14, top=583, bottom=107)
    full(records, "战绩列表/view")
    widget(records, "分页", 20, bottom=0)

    settlement = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    full(settlement, "panelRecordInfo")
    widget(settlement, "title", 41, left=0, right=0, top=0)
    widget(settlement, "排行", 17, top=72)
    widget(settlement, "基本", 17, top=376)
    widget(settlement, "扩展", 17, top=376)
    widget(settlement, "V7结算表头", 17, top=439)
    widget(settlement, "战绩列表", 45, left=21, right=21, top=504, bottom=140)
    full(settlement, "战绩列表/view")
    widget(settlement, "关闭", 20, bottom=55)

    give_pad = Prefab("assets/resources/UI/panelGivePad.prefab")
    widget(give_pad, "bk", 18)

    wallet = Prefab("assets/resources/Prefabs/钱包.prefab")
    full(wallet, "钱包")
    widget(wallet, "钱包/bk", 17, top=0)
    widget(wallet, "钱包/Title", 41, left=0, right=0, top=0)
    widget(wallet, "钱包/选项", 17, top=102)
    widget(wallet, "钱包/容器", 45, left=0, right=0, top=198, bottom=0)
    for path in (
        "钱包/容器/充值", "钱包/容器/充值/根",
        "钱包/容器/提现", "钱包/容器/提现/提现选项",
        "钱包/容器/记录",
    ):
        full(wallet, path)
    widget(wallet, "钱包/容器/充值/根/通道视口", 17, top=118)
    widget(wallet, "钱包/容器/充值/根/金额", 17, top=0)
    for path in (
        "钱包/容器/充值/根/通道视口",
        "钱包/容器/充值/根/金额",
        "钱包/容器/提现/提现选项",
        "钱包/容器/提现/余额/num",
        "钱包/容器/充值/根/充值提示",
    ):
        centered(wallet, path)
    for row in ("金额", "姓名", "银行", "卡号", "密码"):
        centered(wallet, f"钱包/容器/提现/提现选项/{row}/input/TEXT_LABEL")
        centered(wallet, f"钱包/容器/提现/提现选项/{row}/input/PLACEHOLDER_LABEL")
    widget(wallet, "钱包/容器/充值/根/V7充值面板", 45,
           left=54, right=54, top=25, bottom=49)
    widget(wallet, "钱包/容器/充值/根/V7充值提示框", 20, bottom=226)
    widget(wallet, "钱包/容器/充值/根/确认充值", 20, bottom=84)
    recharge_root = wallet.node("钱包/容器/充值/根")
    recharge_order = [ref["__id__"] for ref in wallet.data[recharge_root]["_children"]]
    require(recharge_order.index(wallet.node("钱包/容器/充值/根/V7充值提示框")) <
            recharge_order.index(wallet.node("钱包/容器/充值/根/充值提示")),
            "充值提示文字仍可能被提示框底图遮挡")
    widget(wallet, "钱包/容器/提现/提现选项/V7提现表单", 45,
           left=54, right=54, top=309, bottom=43)
    widget(wallet, "钱包/容器/提现/提现选项/申请提现", 20, bottom=78)
    widget(wallet, "钱包/容器/记录/列表", 45,
           left=54, right=54, top=25, bottom=128)
    widget(wallet, "钱包/容器/记录/分页", 20, bottom=151)
    record_page = wallet.node("钱包/容器/记录")
    draw_order = [ref["__id__"] for ref in wallet.data[record_page]["_children"]]
    require(draw_order.index(wallet.node("钱包/容器/记录/列表")) <
            draw_order.index(wallet.node("钱包/容器/记录/标题")),
            "钱包记录表头仍可能被列表底板遮挡")

    channel_assets = {
        "支付1": "wallet_channel_bank", "支付3": "wallet_channel_bank",
        "支付2": "wallet_channel_alipay", "支付4": "wallet_channel_alipay",
        "支付5": "wallet_channel_wechat",
        "支付6": "wallet_channel_other", "支付7": "wallet_channel_other",
        "VIP充值": "wallet_channel_other", "VIP充值2": "wallet_channel_other",
    }
    channel_viewport = wallet.node("钱包/容器/充值/根/通道视口")
    channel_content = wallet.node("钱包/容器/充值/根/通道视口/充值渠道")
    _, channel_scroll = wallet.component(channel_viewport, "cc.ScrollView")
    _, channel_mask = wallet.component(channel_viewport, "cc.Mask")
    _, channel_grid = wallet.component(channel_content, "cc.Layout")
    require(channel_scroll and channel_scroll.get("_enabled") is True and
            channel_scroll.get("content", {}).get("__id__") == channel_content and
            channel_scroll.get("vertical") is True and channel_scroll.get("horizontal") is False,
            "充值通道未绑定纵向滚动内容")
    require(channel_mask and channel_mask.get("_enabled") is True and
            wallet.data[channel_viewport]["_contentSize"] ==
            {"__type__": "cc.Size", "width": 586, "height": 318},
            "充值通道视口裁切范围错误")
    require(channel_grid and channel_grid.get("_enabled") is True and
            channel_grid.get("_resize") == 1 and channel_grid.get("_N$layoutType") == 3 and
            channel_grid.get("_N$spacingX") == 18 and channel_grid.get("_N$spacingY") == 19 and
            wallet.data[channel_content]["_anchorPoint"]["y"] == 1 and
            wallet.data[channel_content]["_contentSize"]["width"] == 586,
            "充值通道必须按可用项两列自动排列，不能恢复重叠的固定坐标")
    for name, asset in channel_assets.items():
        base = f"钱包/容器/充值/根/通道视口/充值渠道/{name}"
        toggle = wallet.node(base)
        background = wallet.node(base + "/Background")
        mark = wallet.node(base + "/checkmark")
        overlay = wallet.node(base + "/V7通道卡片")
        children = [ref["__id__"] for ref in wallet.data[toggle]["_children"]]
        _, toggle_component = wallet.component(toggle, "cc.Toggle")
        _, background_sprite = wallet.component(background, "cc.Sprite")
        _, mark_sprite = wallet.component(mark, "cc.Sprite")
        mark_components = [ref["__id__"] for ref in
                           wallet.data[mark].get("_components", [])]
        require(toggle_component.get("checkMark", {}).get("__id__") in
                mark_components,
                f"充值通道{name}选中图没有绑定Toggle")
        require(background_sprite.get("_spriteFrame", {}).get("__uuid__") ==
                sprite_uuid(asset + "_exact.png") and
                mark_sprite.get("_spriteFrame", {}).get("__uuid__") ==
                sprite_uuid("wallet_channel_selected_overlay.png"),
                f"充值通道{name}普通态或选中态美术引用错误")
        require(children.index(background) < children.index(mark) and
                wallet.data[mark].get("_active") is bool(toggle_component.get("_N$isChecked")) and
                mark_sprite.get("_enabled") is True and
                wallet.data[overlay].get("_active") is False,
                f"充值通道{name}选中边框仍可能被普通底图遮挡")

    wallet_component = next(obj for obj in wallet.data if "paymentAlipayIcon" in obj)
    for field, asset in {
        "paymentAlipayIcon": "wallet_channel_alipay_exact.png",
        "paymentUnionPayIcon": "wallet_channel_bank_exact.png",
        "paymentWeChatIcon": "wallet_channel_wechat_exact.png",
        "paymentOtherIcon": "wallet_channel_other_exact.png",
    }.items():
        require(wallet_component[field]["__uuid__"] == sprite_uuid(asset),
                f"{field}仍引用旧版通道图标")

    for relative, root_name in (
        ("assets/resources/UI/panelMsgView.prefab", "panelMsgView"),
        ("assets/resources/UI/panelNotifyView.prefab", "panelNotifyView"),
        ("assets/resources/UI/panelNotifyViewCZ.prefab", "panelNotifyView"),
        ("assets/resources/UI/panelNotifyViewHD.prefab", "panelNotifyView"),
    ):
        popup = Prefab(relative)
        full(popup, root_name)
        full(popup, "msk")


def validate_height_math() -> None:
    """Prove flexible regions grow while fixed top/bottom offsets stay fixed."""
    regions = {
        "大厅房间列表": (700, 134),
        "战绩列表": (583, 107),
        "赠送记录": (890, 167),
        "结算玩家列表": (504, 140),
        "钱包记录列表": (223, 128),
        "金币流向列表": (310, 107),
        "代理我的玩家列表": (255, 107),
        "代理我的业绩列表": (335, 107),
        "排行榜手数列表": (485, 107),
        "排行榜其他列表": (399, 107),
    }
    for name, (top_value, bottom_value) in regions.items():
        previous = 0
        for height in HEIGHTS:
            flexible = height - top_value - bottom_value
            require(flexible > 250, f"{name}@{height} 可视区域过小: {flexible}")
            require(flexible > previous, f"{name}@{height} 未随屏幕高度增长")
            previous = flexible
        require((HEIGHTS[-1] - top_value - bottom_value) -
                (HEIGHTS[0] - top_value - bottom_value) == HEIGHTS[-1] - HEIGHTS[0],
                f"{name} 长屏新增高度没有完整分配给列表")


def validate_followup_modules() -> None:
    """Guard V3 follow-up pages against prior anchor and draw-order faults."""
    followup_metas = sorted(V7.glob("followup_*.png.meta"))
    require(len(followup_metas) >= 57,
            f"后续模块资源数量异常: {len(followup_metas)}")
    for meta_path in followup_metas:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        png = meta_path.with_suffix("")
        require(png.is_file() and png.stat().st_size > 100,
                f"后续模块资源缺失或为空: {png.name}")
        if "master_long" in png.name:
            require((meta.get("width"), meta.get("height")) == (750, 1800),
                    f"长屏母版尺寸错误: {png.name}")
            sub = next(iter(meta.get("subMetas", {}).values()))
            require(all(sub.get(key) == 0 for key in
                        ("borderTop", "borderBottom", "borderLeft", "borderRight")),
                    f"固定母版不应使用九切拉伸: {png.name}")

    main = Prefab("assets/resources/UI/panelMain.prefab")
    for root in ("推广二维码", "资金明细", "设置",
                 "修改登陆密码", "修改交易密码", "初始化交易密码"):
        full(main, root)
    for path in (
        "推广二维码/V7游戏推广母版",
        "资金明细/V7金币流向母版",
        "设置/V7系统设置母版",
        "修改登陆密码/V7密码页面母版",
        "修改交易密码/V7密码页面母版",
        "初始化交易密码/V7密码页面母版",
    ):
        widget(main, path, 17, top=0)
        require(main.data[main.node(path)]["_contentSize"]["height"] == 1800,
                f"后续页面母版被拉伸或裁短: {path}")
    widget(main, "资金明细/资金明细列表", 45,
           left=57, right=57, top=310, bottom=107)
    widget(main, "资金明细/分页", 20, bottom=6)
    widget(main, "推广二维码/title", 17, top=0)
    widget(main, "推广二维码/V7游戏推广盾牌", 17, top=100)
    widget(main, "推广二维码/V7推广主标题", 17, top=320)
    for path, x, y in (
        ("V7推广说明", 0, 196),
        ("二维码", 0, -30),
        ("V7推广信息卡", 0, -358),
        ("V7推广ID", -45, -313),
        ("V7推广地址标题", -165, -368),
        ("V7推广链接", -45, -416),
        ("复制推广ID", 265, -313),
        ("复制推广地址", 265, -416),
        ("分享二维码", -145, -544),
        ("保存二维码", 145, -544),
    ):
        widget(main, f"推广二维码/{path}", 18,
               horizontalCenter=x, verticalCenter=y)

    for path in ("复制推广ID", "复制推广地址", "分享二维码", "保存二维码"):
        node_id = main.node(f"推广二维码/{path}")
        _, component = main.component(node_id, "cc.Button")
        require(main.data[node_id].get("_active") is True and
                component is not None and component.get("_enabled") is True,
                f"游戏推广交互按钮缺失或未启用: {path}")

    id_node = main.node("推广二维码/V7推广ID")
    link_node = main.node("推广二维码/V7推广链接")
    _, id_label = main.component(id_node, "cc.Label")
    _, link_label = main.component(link_node, "cc.Label")
    require(id_label is not None and id_label.get("_fontSize") == 26,
            "推广ID字号没有按修正版放大")
    require(link_label is not None and link_label.get("_fontSize") == 22 and
            main.data[link_node]["_contentSize"].get("width") == 440,
            "游戏下载地址字号或宽度没有按修正版调整")

    # Foreground actions use visible-screen center widgets: every taller
    # viewport contributes half its added height above and below the group.
    for height in HEIGHTS:
        positions = {}
        for path in ("V7推广说明", "二维码", "V7推广信息卡",
                     "分享二维码", "保存二维码"):
            node = main.data[main.node(f"推广二维码/{path}")]
            _, value = main.component(main.node(f"推广二维码/{path}"), "cc.Widget")
            center_y = value.get("_verticalCenter")
            item_height = node["_contentSize"]["height"]
            top_px = height / 2 - center_y - item_height / 2
            positions[path] = (top_px, top_px + item_height)
        require(positions["V7推广说明"][0] >= 430,
                f"推广说明@{height} 压到顶部主视觉")
        require(positions["二维码"][0] - positions["V7推广说明"][1] >= 15,
                f"推广说明与二维码@{height} 间距不足")
        require(positions["V7推广信息卡"][0] - positions["二维码"][1] >= 45,
                f"二维码与信息卡@{height} 间距不足")
        require(positions["分享二维码"][0] - positions["V7推广信息卡"][1] >= 45,
                f"信息卡与操作按钮@{height} 间距不足")
        require(positions["分享二维码"][1] <= height - 70,
                f"推广按钮@{height} 过低或被裁切")
    for page in ("修改登陆密码", "修改交易密码", "初始化交易密码"):
        centered(main, f"{page}/列表")

    reserved = Prefab("assets/resources/UI/修改预留信息.prefab")
    full(reserved, "修改预留信息")
    widget(reserved, "修改预留信息/V7修改预留信息母版", 17, top=0)
    require(reserved.data[reserved.node(
        "修改预留信息/V7修改预留信息母版")]["_contentSize"]["height"] == 1800,
            "修改预留信息长屏母版被拉伸或裁短")
    centered(reserved, "修改预留信息/列表")
    for path, component_type in (
        ("修改预留信息/列表/账号/账号", "cc.Label"),
        ("修改预留信息/列表/新密码1/新密码1", "cc.EditBox"),
        ("修改预留信息/列表/新密码2/新密码2", "cc.EditBox"),
        ("修改预留信息/列表/验证码/验证码", "cc.EditBox"),
        ("修改预留信息/列表/验证码/获取验证码", "cc.Button"),
        ("修改预留信息/列表/ok/确定修改预留信息", "cc.Button"),
        ("修改预留信息/title copy/关闭", "cc.Button"),
    ):
        _, component = reserved.component(reserved.node(path), component_type)
        require(component is not None and component.get("_enabled") is True,
                f"修改预留信息交互结构缺失: {path} / {component_type}")
    _, reserved_script = reserved.component(reserved.root,
                                             "9890bo02m9F+Zxrg1qWKhxw")
    require(reserved_script is not None and reserved_script.get("_enabled") is True,
            "修改预留信息 Prefab 没有绑定 panelYLinfo 业务组件")

    agent = Prefab("assets/resources/UI/panelHongli.prefab")
    widget(agent, "panelHongli/V7代理首页母版", 17, top=0)
    for page, top_value in (("我的玩家", 255), ("我的业绩", 335),
                            ("我的盟主", 255), ("总业绩", 255),
                            ("提取记录", 255), ("奖池提取记录", 255)):
        full(agent, f"panelHongli/{page}")
        widget(agent, f"panelHongli/{page}/列表", 45,
               left=56, right=56, top=top_value, bottom=107)
        widget(agent, f"panelHongli/{page}/分页", 20, bottom=6)
    widget(agent, "panelHongli/推广二维码/V7推广ID", 17, top=667)
    widget(agent, "panelHongli/推广二维码/V7推广链接", 17, top=741)
    for popup in ("盟主收益", "奖池收益", "大区收益", "总业绩2",
                  "添加代理面板", "删除总业绩对象面板", "提取红利面板",
                  "提取奖池收益面板", "提取分红面板", "添加盟主面板", "修改盟主面板"):
        full(agent, f"panelHongli/{popup}/msk")
        _, mask_sprite = agent.component(agent.node(f"panelHongli/{popup}/msk"), "cc.Sprite")
        require(mask_sprite is not None and mask_sprite.get("_enabled") is True,
                f"代理弹层遮罩未恢复: {popup}")

    ranking = Prefab("assets/resources/Prefabs/排行榜.prefab")
    widget(ranking, "排行榜/V7排行榜母版", 17, top=0)
    widget(ranking, "排行榜/条件", 17, top=312)
    for page, top_value in (("玩家手数榜", 485), ("玩家赢分榜", 399),
                            ("代理红利榜", 399)):
        full(ranking, f"排行榜/容器/{page}")
        widget(ranking, f"排行榜/容器/{page}/列表", 45,
               left=56, right=56, top=top_value, bottom=107)
        widget(ranking, f"排行榜/容器/{page}/分页", 20, bottom=6)
    require(ranking.data[ranking.node("排行榜/广告/已领取")].get("_active") is False,
            "排行榜编辑状态不应烘焙虚假的已领取")

    agent_source = (ROOT / "assets/scripts/UI/panelHongli.ts").read_text(encoding="utf-8")
    main_source = (ROOT / "assets/scripts/UI/panelMain.ts").read_text(encoding="utf-8")
    require('"推广ID："+strGuuid' in agent_source and
            '"推广ID：" + GameDataManager.getAccount().guuid' in main_source and
            '推广二维码/V7推广链接' in agent_source and
            '推广二维码/V7推广链接' in main_source and
            'linkLabel.getComponent(cc.Label).string = qrUrl;' in agent_source and
            'linkLabel.getComponent(cc.Label).string = qrUrl;' in main_source,
            "游戏或代理推广页没有同步显示实时推广ID与二维码地址")
    require('button.node.name === "复制推广ID"' in main_source and
            'button.node.name === "复制推广地址"' in main_source and
            'CopyToPhone(strID)' in main_source and
            'CopyToPhone(strUrl)' in main_source,
            "游戏推广页没有实现ID和下载地址复制逻辑")
    require(main_source.count('this.HidePromotionPanelOnLobbyOpen();') >= 2 and
            'promotionPanel.active = false;' in main_source,
            "大厅初始化/重新启用时没有强制关闭游戏推广页")


def validate_v7_assets() -> None:
    frame_uuids: set[str] = set()
    for meta_path in V7.glob("*.png.meta"):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        frame_uuids.update(
            item["uuid"] for item in meta.get("subMetas", {}).values()
            if isinstance(item, dict) and item.get("uuid")
        )
        png = meta_path.with_suffix("")
        minimum_size = 50 if png.name == "transparent.png" else 100
        require(png.is_file() and png.stat().st_size > minimum_size,
                f"V7 图片缺失或为空: {png}")

    require((V7 / "title_gift_history.png").is_file(), "缺少赠送记录美术字")
    require((ROOT / "art_sources/v7/gift/gift_hero_no_hands_v2_source.png").is_file(),
            "赠送页新版无手部主视觉源图缺失")
    for exact in (
        "casino_bg_exact.png", "lobby_header_exact.png", "lobby_hero_exact.png",
        "lobby_list_bg_exact.png",
        "lobby_ranking_exact.png", "lobby_match_exact.png", "lobby_report_exact.png",
        "filter_bar_exact.png", "room_card_exact.png", "room_static_exact.png",
        "shield_room_exact.png", "nav_bar_exact.png",
        "mine_bg_exact.png", "mine_hero_exact.png", "mine_profile_exact.png",
        "mine_avatar_ring_exact.png", "mine_agent_exact.png",
        "mine_promotion_exact.png", "mine_money_exact.png", "mine_gift_exact.png",
        "mine_record_exact.png", "mine_settings_exact.png",
        "nav_mine_selected_overlay.png",
        "gift_bg_exact.png", "gift_header_exact.png", "gift_hero_exact.png",
        "gift_input_id_exact.png", "gift_input_amount_exact.png",
        "gift_input_password_exact.png", "gift_confirm_exact.png",
        "gift_history_header_exact.png", "gift_list_panel_exact.png",
        "gift_record_row_exact.png", "gift_avatar_ring_exact.png",
        "gift_pagination_exact.png",
        "record_bg_exact.png", "record_header_exact.png", "record_hero_exact.png",
        "record_tabs_today_exact.png", "record_tabs_yesterday_exact.png",
        "record_tabs_before_exact.png", "record_table_header_exact.png",
        "record_list_panel_exact.png", "record_row_exact.png",
        "settlement_bg_exact.png", "settlement_header_exact.png",
        "settlement_hero_exact.png", "settlement_award_frames_exact.png",
        "settlement_summary_exact.png",
        "settlement_table_header_exact.png", "settlement_list_panel_exact.png",
        "settlement_row_exact.png", "settlement_return_exact.png",
        "settlement_review_exact.png",
        "popup_announcement_latest_exact_nobar.png",
        "popup_announcement_recharge_exact_nobar.png",
        "popup_announcement_activity_exact_nobar.png",
        "popup_message_single_exact.png", "popup_message_dual_exact.png",
        "announcement_menu_long_exact.png",
        "announcement_detail_bg_long_exact.png",
        "announcement_detail_header_exact.png",
        "announcement_detail_latest_exact.png",
        "announcement_detail_rules_exact.png",
        "announcement_detail_bonus_exact.png",
        "announcement_detail_penalty_exact.png",
        "wallet_bg_exact.png", "wallet_header_exact.png",
        "wallet_tabs_recharge_exact.png", "wallet_tabs_withdraw_exact.png",
        "wallet_tabs_record_exact.png", "wallet_recharge_panel_exact.png",
        "wallet_recharge_channel_title_exact.png",
        "wallet_recharge_amount_title_exact.png",
        "wallet_channel_bank_exact.png", "wallet_channel_alipay_exact.png",
        "wallet_channel_wechat_exact.png", "wallet_channel_other_exact.png",
        "wallet_channel_bank_selected_exact.png",
        "wallet_channel_alipay_selected_exact.png",
        "wallet_channel_wechat_selected_exact.png",
        "wallet_channel_other_selected_exact.png",
        "wallet_amount_off_exact.png", "wallet_amount_on_exact.png",
        "wallet_recharge_notice_exact.png", "wallet_recharge_confirm_exact.png",
        "wallet_withdraw_balance_exact.png", "wallet_withdraw_form_exact.png",
        "wallet_withdraw_types_base_exact.png",
        "wallet_withdraw_type_bank_exact.png",
        "wallet_withdraw_type_alipay_exact.png",
        "wallet_withdraw_type_usdt_exact.png",
        "wallet_withdraw_input_amount_exact.png",
        "wallet_withdraw_input_name_exact.png",
        "wallet_withdraw_input_bank_exact.png",
        "wallet_withdraw_input_card_exact.png",
        "wallet_withdraw_input_password_exact.png",
        "wallet_withdraw_input_generic_exact.png",
        "wallet_withdraw_submit_exact.png", "wallet_record_panel_exact.png",
        "wallet_record_header_exact.png", "wallet_record_row_exact.png",
        "wallet_record_icon_in_exact.png", "wallet_record_icon_out_exact.png",
        "wallet_record_pagination_exact.png",
    ):
        require((V7 / exact).is_file(), f"V7确认稿资源缺失: {exact}")

    expected_sizes = {
        "mine_bg_exact.png": (750, 1334),
        "mine_hero_exact.png": (750, 334),
        "mine_profile_exact.png": (671, 314),
        "mine_avatar_ring_exact.png": (118, 118),
        "mine_agent_exact.png": (326, 95),
        "mine_promotion_exact.png": (333, 95),
        "mine_money_exact.png": (326, 94),
        "mine_gift_exact.png": (333, 94),
        "mine_record_exact.png": (326, 97),
        "mine_settings_exact.png": (333, 97),
        "nav_mine_selected_overlay.png": (130, 134),
        "gift_bg_exact.png": (750, 1334),
        "gift_header_exact.png": (750, 81),
        "gift_hero_exact.png": (750, 300),
        "gift_input_id_exact.png": (660, 82),
        "gift_input_amount_exact.png": (660, 82),
        "gift_input_password_exact.png": (660, 82),
        "gift_confirm_exact.png": (414, 84),
        "gift_history_header_exact.png": (708, 106),
        "gift_list_panel_exact.png": (708, 280),
        "gift_record_row_exact.png": (706, 93),
        "gift_avatar_ring_exact.png": (70, 70),
        "gift_pagination_exact.png": (708, 107),
        "record_bg_exact.png": (750, 1334),
        "record_header_exact.png": (750, 72),
        "record_hero_exact.png": (750, 368),
        "record_tabs_today_exact.png": (656, 68),
        "record_tabs_yesterday_exact.png": (656, 68),
        "record_tabs_before_exact.png": (656, 68),
        "record_table_header_exact.png": (722, 63),
        "record_list_panel_exact.png": (722, 722),
        "record_row_exact.png": (708, 96),
        "settlement_bg_exact.png": (750, 1334),
        "settlement_header_exact.png": (750, 72),
        "settlement_hero_exact.png": (750, 290),
        "settlement_award_frames_exact.png": (750, 290),
        "settlement_summary_exact.png": (704, 53),
        "settlement_table_header_exact.png": (708, 65),
        "settlement_list_panel_exact.png": (708, 508),
        "settlement_row_exact.png": (680, 70),
        "settlement_return_exact.png": (300, 67),
        "settlement_review_exact.png": (178, 46),
        "popup_announcement_latest_exact_nobar.png": (632, 840),
        "popup_announcement_recharge_exact_nobar.png": (632, 840),
        "popup_announcement_activity_exact_nobar.png": (632, 840),
        "popup_message_single_exact.png": (532, 366),
        "popup_message_dual_exact.png": (532, 366),
        "announcement_menu_long_exact.png": (750, 1800),
        "announcement_detail_bg_long_exact.png": (750, 1800),
        "announcement_detail_header_exact.png": (750, 81),
        "announcement_detail_latest_exact.png": (750, 1253),
        "announcement_detail_rules_exact.png": (750, 1719),
        "announcement_detail_bonus_exact.png": (750, 1719),
        "announcement_detail_penalty_exact.png": (750, 1719),
        "wallet_bg_exact.png": (750, 1800),
        "wallet_header_exact.png": (750, 84),
        "wallet_tabs_recharge_exact.png": (666, 66),
        "wallet_tabs_withdraw_exact.png": (666, 66),
        "wallet_tabs_record_exact.png": (666, 66),
        "wallet_recharge_panel_exact.png": (642, 1063),
        "wallet_recharge_channel_title_exact.png": (584, 49),
        "wallet_recharge_amount_title_exact.png": (584, 49),
        "wallet_channel_bank_exact.png": (284, 129),
        "wallet_channel_alipay_exact.png": (284, 129),
        "wallet_channel_wechat_exact.png": (284, 129),
        "wallet_channel_other_exact.png": (284, 129),
        "wallet_channel_bank_selected_exact.png": (284, 129),
        "wallet_channel_alipay_selected_exact.png": (284, 129),
        "wallet_channel_wechat_selected_exact.png": (284, 129),
        "wallet_channel_other_selected_exact.png": (284, 129),
        "wallet_amount_off_exact.png": (182, 116),
        "wallet_amount_on_exact.png": (186, 116),
        "wallet_recharge_notice_exact.png": (588, 120),
        "wallet_recharge_confirm_exact.png": (582, 103),
        "wallet_withdraw_balance_exact.png": (642, 267),
        "wallet_withdraw_form_exact.png": (642, 778),
        "wallet_withdraw_types_base_exact.png": (602, 60),
        "wallet_withdraw_type_bank_exact.png": (204, 60),
        "wallet_withdraw_type_alipay_exact.png": (204, 60),
        "wallet_withdraw_type_usdt_exact.png": (204, 60),
        "wallet_withdraw_input_amount_exact.png": (602, 79),
        "wallet_withdraw_input_name_exact.png": (602, 79),
        "wallet_withdraw_input_bank_exact.png": (602, 79),
        "wallet_withdraw_input_card_exact.png": (602, 79),
        "wallet_withdraw_input_password_exact.png": (602, 79),
        "wallet_withdraw_input_generic_exact.png": (602, 79),
        "wallet_withdraw_submit_exact.png": (590, 100),
        "wallet_record_panel_exact.png": (642, 979),
        "wallet_record_header_exact.png": (604, 70),
        "wallet_record_row_exact.png": (610, 121),
        "wallet_record_icon_in_exact.png": (52, 54),
        "wallet_record_icon_out_exact.png": (52, 53),
        "wallet_record_pagination_exact.png": (604, 112),
    }
    for name, expected in expected_sizes.items():
        meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
        actual = (meta.get("width"), meta.get("height"))
        require(actual == expected,
                f"V7确认稿切图尺寸错误: {name}={actual}，预期 {expected}")

    # A large interior scan-line jump means baked sample-row dividers survived
    # the cleanup and will become visible bands after nine-slice stretching.
    gift_panel = Image.open(V7 / "gift_list_panel_exact.png").convert("RGB")
    row_levels = []
    for y in range(10, gift_panel.height - 10):
        row = gift_panel.crop((40, y, gift_panel.width - 40, y + 1))
        row_levels.append(sum(ImageStat.Stat(row).mean) / 3)
    max_row_jump = max(abs(right - left)
                       for left, right in zip(row_levels, row_levels[1:]))
    require(max_row_jump < 4,
            f"赠送列表底板仍有未清干净的横向分层: jump={max_row_jump:.2f}")
    used = 0
    prefab_paths = (
        "assets/resources/UI/panelLogin.prefab",
        "assets/resources/UI/panelMain.prefab",
        "assets/resources/UI/panelRecordList.prefab",
        "assets/resources/UI/panelRecordInfo.prefab",
        "assets/resources/UI/panelGivePad.prefab",
        "assets/resources/UI/panelMsgView.prefab",
        "assets/resources/UI/panelNotifyView.prefab",
        "assets/resources/UI/panelNotifyViewCZ.prefab",
        "assets/resources/UI/panelNotifyViewHD.prefab",
        "assets/resources/UI/panelHongli.prefab",
        "assets/resources/Prefabs/战绩对象.prefab",
        "assets/resources/Prefabs/战绩玩家对象.prefab",
        "assets/resources/Prefabs/赠送记录对象.prefab",
        "assets/resources/Prefabs/钱包.prefab",
        "assets/resources/Prefabs/交易查询对象.prefab",
        "assets/resources/Prefabs/资金明细对象.prefab",
        "assets/resources/Prefabs/玩家对象.prefab",
        "assets/resources/Prefabs/贡献对象.prefab",
        "assets/resources/Prefabs/盟主对象.prefab",
        "assets/resources/Prefabs/总业绩对象.prefab",
        "assets/resources/Prefabs/红利提取记录对象.prefab",
        "assets/resources/Prefabs/排行榜.prefab",
        "assets/resources/Prefabs/排行榜对象.prefab",
    )
    for relative in prefab_paths:
        p = Prefab(relative)
        for item in p.data:
            if item.get("__type__") != "cc.Sprite":
                continue
            ref = item.get("_spriteFrame")
            uuid = ref.get("__uuid__") if isinstance(ref, dict) else None
            if uuid not in frame_uuids:
                continue
            used += 1
            require(item.get("_enabled") is True,
                    f"{relative} 有未启用的 V7 Sprite: {uuid}")
    require(used >= 35, f"Prefab 中只找到 {used} 个 V7 Sprite 引用，数量异常")

    main = Prefab("assets/resources/UI/panelMain.prefab")
    announcement = main.node("Main/公告")
    announcement_children = [ref["__id__"] for ref in
                             main.data[announcement].get("_children", [])]
    floor = main.node("Main/公告/V7公告长屏补底")
    body = main.node("Main/公告/V7公告菜单高清母版")
    require(announcement_children[:2] == [body, floor],
            "公告完整长图没有位于透明点击层下方")
    require(main.data[floor].get("_active") is False,
            "公告仍启用了第二张长屏补底，运行时会出现拼接")
    _, body_sprite = main.component(body, "cc.Sprite")
    announcement_meta = json.loads(
        (V7 / "announcement_menu_long_exact.png.meta").read_text(encoding="utf-8")
    )
    body_frame = announcement_meta["subMetas"]["announcement_menu_long_exact"]
    require(body_sprite is not None and body_sprite.get("_type") == 0 and
            body_sprite.get("_spriteFrame", {}).get("__uuid__") == body_frame["uuid"],
            "公告确认稿母版没有以固定比例图片序列化进Prefab")
    require(all(body_frame.get(key) == 0 for key in
                ("borderTop", "borderBottom", "borderLeft", "borderRight")),
            "公告确认稿仍带九切边界，长屏会拉伸牌或筹码")
    require(main.data[main.node("Main/公告/title copy")].get("_active") is False,
            "公告页仍叠加旧标题")
    for name in ("公告6", "公告1", "公告2", "公告5"):
        node = main.node(f"Main/公告/主页/{name}")
        _, button = main.component(node, "cc.Button")
        _, sprite = main.component(node, "cc.Sprite")
        require(main.data[node].get("_active") is True and button is not None,
                f"公告业务按钮未保留: {name}")
        require(sprite is not None and
                sprite.get("_spriteFrame", {}).get("__uuid__") ==
                json.loads((V7 / "transparent.png.meta").read_text(encoding="utf-8"))
                    ["subMetas"]["transparent"]["uuid"],
                f"公告按钮没有改成透明交互热区: {name}")
    for name in ("惩罚列表", "公告8", "公告3", "公告4"):
        require(main.data[main.node(f"Main/公告/主页/{name}")].get("_active") is False,
                f"确认稿之外的旧公告入口仍在显示: {name}")

    def detail_frame_uuid(name: str) -> str:
        meta = json.loads((V7 / f"{name}.meta").read_text(encoding="utf-8"))
        return meta["subMetas"][Path(name).stem]["uuid"]

    detail_specs = (
        ("公告1", "1", "announcement_detail_rules_exact.png"),
        ("公告2", "2", "announcement_detail_bonus_exact.png"),
        ("公告5", "1", "announcement_detail_penalty_exact.png"),
    )
    for page, child_name, asset in detail_specs:
        page_node = main.node(page)
        children = [ref["__id__"] for ref in
                    main.data[page_node].get("_children", [])]
        background = main.node(f"{page}/V7公告详情长背景")
        require(children[0] == background,
                f"{page} 长背景没有位于正文和点击层下方")
        _, background_sprite = main.component(background, "cc.Sprite")
        require(background_sprite.get("_spriteFrame", {}).get("__uuid__") ==
                detail_frame_uuid("announcement_detail_bg_long_exact.png"),
                f"{page} 没有引用公告详情完整长背景")
        _, header_sprite = main.component(main.node(f"{page}/title"), "cc.Sprite")
        require(header_sprite.get("_spriteFrame", {}).get("__uuid__") ==
                detail_frame_uuid("announcement_detail_header_exact.png"),
                f"{page} 没有引用赠送页同款公告顶部栏")
        _, list_sprite = main.component(main.node(f"{page}/list"), "cc.Sprite")
        require(list_sprite is None or list_sprite.get("_enabled") is False,
                f"{page} 仍叠加旧列表底图")
        content = main.node(f"{page}/list/view/content")
        _, layout = main.component(content, "cc.Layout")
        require(layout is None or layout.get("_enabled") is False,
                f"{page} 旧Layout会重新排列高清正文图")
        art = main.node(f"{page}/list/view/content/{child_name}")
        _, art_sprite = main.component(art, "cc.Sprite")
        require(art_sprite.get("_spriteFrame", {}).get("__uuid__") ==
                detail_frame_uuid(asset),
                f"{page} 没有引用V2高清正文美术")

    latest_list = main.node("公告6/list")
    latest_view = main.node("公告6/list/view")
    latest_content = main.node("公告6/list/view/content")
    latest_art = main.node("公告6/list/V7公告正文高清母版")
    _, latest_sprite = main.component(latest_art, "cc.Sprite")
    require(latest_sprite.get("_spriteFrame", {}).get("__uuid__") ==
            detail_frame_uuid("announcement_detail_latest_exact.png"),
            "最新公告没有引用V2动态正文承载美术")
    require(latest_sprite.get("_type") == 1,
            "最新公告屏内底框没有使用九切适配长屏")
    latest_list_children = [ref["__id__"] for ref in
                            main.data[latest_list].get("_children", [])]
    require(latest_list_children[:2] == [latest_art, latest_view],
            "最新公告底框没有作为固定底层放在裁切视口下方")
    latest_view_children = [ref["__id__"] for ref in
                            main.data[latest_view].get("_children", [])]
    require(latest_view_children == [latest_content],
            "最新公告裁切视口内仍混入固定底框")
    _, latest_mask = main.component(latest_view, "cc.Mask")
    require(latest_mask is not None and latest_mask.get("_enabled") is True,
            "最新公告内层正文框没有启用裁切，文字会滚到框外")
    latest_meta = json.loads(
        (V7 / "announcement_detail_latest_exact.png.meta").read_text(encoding="utf-8")
    )["subMetas"]["announcement_detail_latest_exact"]
    require((latest_meta.get("borderTop"), latest_meta.get("borderBottom"),
             latest_meta.get("borderLeft"), latest_meta.get("borderRight")) ==
            (760, 40, 35, 35),
            "最新公告底框九切边界未保护标题、盾牌和四周描边")
    require(main.data[main.node("公告6/最新公告标题")].get("_active") is False,
            "最新公告仍叠加旧低清标题")
    latest_message = main.node("公告6/list/view/content/msg")
    _, latest_label = main.component(latest_message, "cc.Label")
    require(latest_label.get("_fontSize") == 24 and
            latest_label.get("_lineHeight") == 38 and
            latest_label.get("_N$overflow") == 3,
            "最新公告服务端正文没有使用V2高清排版参数")
    latest_message_size = main.data[latest_message]["_contentSize"]
    require(latest_message_size.get("width") == 570 and
            main.data[latest_message]["_trs"]["array"][1] == -25,
            "最新公告正文没有收进内层裁切框")
    source = (ROOT / "assets/scripts/UI/panelMain.ts").read_text(encoding="utf-8")
    require("Math.max(label.lineHeight, label.node.height, explicitLineHeight)" in source and
            "const v7MessageTop = 25;" in source and
            "content.parent.height" in source and
            "v7MessageTop + label.node.height + v7MessageBottomPadding" in source and
            "const v7BodyHeight" not in source,
            "最新公告没有按自动换行真实高度在固定底框内滚动")

    mine = main.node("Main/我的")
    require(main.data[main.node("Main/我的/V7我的盾牌")].get("_active") is False,
            "我的页仍显示旧独立盾牌，会与确认稿主视觉重叠")
    operation = main.node("Main/我的/操作")
    require(abs(main.data[operation]["_anchorPoint"].get("y", 0) - 0.5) < 0.001,
            "我的页操作区不是中心锚点，第一排按钮会向上压进资料卡")
    profile_bottom = 334 + 314
    first_button_top = 664 + 317 / 2 - 111 - 95 / 2
    require(first_button_top - profile_bottom >= 15,
            "我的页资料卡与第一排操作按钮间距不足")
    agent_nodes = [ref["__id__"] for ref in main.data[operation].get("_children", [])
                   if main.data[ref["__id__"]].get("_name") == "代理"]
    require(agent_nodes and all(main.data[node_id].get("_active") is False
                                for node_id in agent_nodes),
            "非代理默认布局仍显示我的代理入口")
    non_agent_slots = {
        "推广二维码": (-172, 111), "资金明细": (170, 111),
        "赠送": (-172, 0), "战绩": (170, 0), "设置": (-172, -111),
    }
    for name, expected in non_agent_slots.items():
        actual = tuple(main.data[main.node(f"Main/我的/操作/{name}")]["_trs"]["array"][0:2])
        require(actual == expected,
                f"非代理按钮未依次前移: {name}={actual}，预期 {expected}")
    for name in ("推广二维码", "资金明细", "赠送", "战绩", "设置"):
        require(main.data[main.node(f"Main/我的/操作/{name}")].get("_active") is True,
                f"我的页功能入口未显示: {name}")
    copy_id = main.node("Main/我的/信息/复制ID")
    _, copy_button = main.component(copy_id, "cc.Button")
    require(main.data[copy_id].get("_active") is True and copy_button is not None,
            "ID复制热区未序列化为可点击Button")

    # 赠送页的静态美术全部来自同一张确认稿，动态输入与数据只覆盖留白区。
    gift = main.node("赠送")
    require(main.data[main.node("赠送/V7赠送记录标题")].get("_active") is False,
            "赠送页仍显示旧的独立记录标题")
    input_specs = {"用户id": 148, "金额": 51, "V7交易密码": -46}
    for name, expected_y in input_specs.items():
        node = main.node("赠送/操作/" + name)
        trs = main.data[node]["_trs"]["array"]
        size = main.data[node]["_contentSize"]
        require(trs[1] == expected_y and size["height"] == 82,
                f"赠送输入框纵向位置/高度错误: {name}=({trs[1]},{size['height']})")
        require(size["width"] >= 360,
                f"赠送输入热区过窄: {name}={size['width']}")
    operation = main.node("赠送/操作")
    backgrounds = []
    for ref in main.data[operation].get("_children", []):
        node_id = ref["__id__"]
        if main.data[node_id].get("_name") != "BACKGROUND_SPRITE":
            continue
        trs = main.data[node_id]["_trs"]["array"]
        size = main.data[node_id]["_contentSize"]
        backgrounds.append((trs[0], trs[1], size["width"], size["height"]))
    if backgrounds:
        require(backgrounds == [(0, 148, 660, 82), (0, 51, 660, 82), (0, -46, 660, 82)],
                f"赠送输入框确认稿背景位置错误: {backgrounds}")
    _, password = main.component(main.node("赠送/操作/V7交易密码"), "cc.EditBox")
    require(password is not None and password.get("_N$inputFlag") == 0,
            "赠送交易密码未序列化为密码输入框")

    gift_row = Prefab("assets/resources/Prefabs/赠送记录对象.prefab")
    row_size = gift_row.data[gift_row.root]["_contentSize"]
    require((row_size["width"], row_size["height"]) == (706, 93),
            "赠送记录行不是确认稿尺寸706x93")
    avatar = gift_row.node("头像/mask")
    _, avatar_mask = gift_row.component(avatar, "cc.Mask")
    require(avatar_mask is not None and avatar_mask.get("_type") == 1,
            "赠送记录头像缺少圆形遮罩")

    records = Prefab("assets/resources/UI/panelRecordList.prefab")
    record_toggle_specs = (
        ("0", -218, True, "record_tabs_today_exact"),
        ("-1", 0, False, "record_tabs_yesterday_exact"),
        ("-2", 218, False, "record_tabs_before_exact"),
    )
    for name, expected_x, selected, asset_name in record_toggle_specs:
        toggle_node = records.node("条件/" + name)
        _, toggle = records.component(toggle_node, "cc.Toggle")
        checkmark = records.node("条件/" + name + "/checkmark")
        actual_x = records.data[toggle_node]["_trs"]["array"][0]
        asset_uuid = json.loads(
            (V7 / f"{asset_name}.png.meta").read_text(encoding="utf-8")
        )["subMetas"][asset_name]["uuid"]
        _, checkmark_sprite = records.component(checkmark, "cc.Sprite")
        require(actual_x == expected_x,
                f"战绩日期参数位置错误: {name}={actual_x}，预期 {expected_x}")
        require(toggle is not None and toggle.get("_N$isChecked") is selected,
                f"战绩日期默认状态错误: {name}")
        require(records.data[checkmark].get("_active") is selected,
                f"战绩日期选中图显示状态错误: {name}")
        require(checkmark_sprite.get("_spriteFrame", {}).get("__uuid__") == asset_uuid,
                f"战绩日期切换美术与参数不匹配: {name} 应使用 {asset_name}.png")
    pagination_uuid = json.loads(
        (V7 / "gift_pagination_exact.png.meta").read_text(encoding="utf-8")
    )["subMetas"]["gift_pagination_exact"]["uuid"]
    _, pagination_sprite = records.component(records.node("分页"), "cc.Sprite")
    require(pagination_sprite.get("_spriteFrame", {}).get("__uuid__") == pagination_uuid,
            "战绩翻页栏没有复用赠送页确认稿美术")

    record_row = Prefab("assets/resources/Prefabs/战绩对象.prefab")
    row_size = record_row.data[record_row.root]["_contentSize"]
    require((row_size["width"], row_size["height"]) == (708, 96),
            "战绩记录行不是确认稿尺寸708x96")
    require(record_row.data[record_row.node("时间")].get("_active") is False,
            "战绩确认稿不存在时间列，但时间节点仍在显示")
    expected_columns = {
        "房间号": (-193, 0), "底皮": (-63, 0),
        "带入": (95, 0), "输赢": (260, 0),
    }
    for name, expected in expected_columns.items():
        actual = tuple(record_row.data[record_row.node(name)]["_trs"]["array"][:2])
        require(actual == expected,
                f"战绩动态列未按确认稿对齐: {name}={actual}，预期 {expected}")

    record_source = (ROOT / "assets/scripts/UI/panelRecordList.ts").read_text(encoding="utf-8")
    require('private PAGE_PER_COUNT:string = "6";' in record_source,
            "战绩页每页条数不是确认稿的6条")
    require('let date:string = "0";' in record_source,
            "战绩页查询默认日期参数不是今日(0)")
    require("date = item.node.name;" in record_source,
            "战绩页没有按当前选中Toggle的日期参数查询")
    require("this.scrollRecordList.nTotlePage-1" in record_source,
            "战绩尾页仍存在越界一页问题")

    settlement = Prefab("assets/resources/UI/panelRecordInfo.prefab")
    review = settlement.node("title/牌局回顾")
    _, review_button = settlement.component(review, "cc.Button")
    _, review_sprite = settlement.component(review, "cc.Sprite")
    review_uuid = json.loads(
        (V7 / "settlement_review_exact.png.meta").read_text(encoding="utf-8")
    )["subMetas"]["settlement_review_exact"]["uuid"]
    require(settlement.data[review].get("_active") is True and review_button is not None,
            "结算页右上牌局回顾按钮未显示或不可点击")
    require(review_sprite.get("_spriteFrame", {}).get("__uuid__") == review_uuid,
            "结算页右上牌局回顾按钮未使用确认稿同系高清美术")
    require(settlement.data[settlement.node("牌局回顾")].get("_active") is False,
            "牌局回顾子页不应在结算页打开时默认遮挡主页面")

    queue = settlement.node("排行/排队")
    _, queue_button = settlement.component(queue, "cc.Button")
    _, queue_spine = settlement.component(settlement.node("排行/排队/pd"), "sp.Skeleton")
    require(settlement.data[queue].get("_active") is True and
            queue_button is not None and queue_spine is not None,
            "结算页原有排队按钮或Spine动画被删除")

    frames = settlement.node("排行/V7荣誉框前景")
    _, frames_sprite = settlement.component(frames, "cc.Sprite")
    frames_uuid = json.loads(
        (V7 / "settlement_award_frames_exact.png.meta").read_text(encoding="utf-8")
    )["subMetas"]["settlement_award_frames_exact"]["uuid"]
    require(settlement.data[frames].get("_active") is True and
            frames_sprite.get("_spriteFrame", {}).get("__uuid__") == frames_uuid,
            "结算页动态头像上方缺少完整荣誉金属框前景")
    require(tuple(settlement.data[frames]["_trs"]["array"][7:9]) == (1, 1),
            "结算页荣誉金属框前景仍继承旧节点缩放，运行时会出现错位双框")

    award_layout = {
        "土豪": ((-222, -14), (112, 112), -114),
        "MVP": ((0, 9), (160, 160), -145),
        "大鱼": ((221, -14), (112, 112), -114),
    }
    for award, (expected_pos, expected_size, expected_name_y) in award_layout.items():
        award_node = settlement.node("排行/" + award)
        award_data = settlement.data[award_node]
        actual_pos = tuple(award_data["_trs"]["array"][:2])
        actual_size = (award_data["_contentSize"]["width"],
                       award_data["_contentSize"]["height"])
        actual_name_y = settlement.data[
            settlement.node(f"排行/{award}/name")
        ]["_trs"]["array"][1]
        require(actual_pos == expected_pos and actual_size == expected_size,
                f"结算页{award}头像没有完整收在徽章圆环内")
        require(tuple(award_data["_trs"]["array"][7:9]) == (1, 1),
                f"结算页{award}头像仍继承旧缩放，无法和固定圆环对齐")
        for suffix in ("mask", "mask/img"):
            portrait_data = settlement.data[
                settlement.node(f"排行/{award}/{suffix}")
            ]
            portrait_size = (portrait_data["_contentSize"]["width"],
                             portrait_data["_contentSize"]["height"])
            require(tuple(portrait_data["_trs"]["array"][:2]) == (0, 0) and
                    tuple(portrait_data["_trs"]["array"][7:9]) == (1, 1) and
                    portrait_size == expected_size,
                    f"结算页{award}头像蒙版或图片仍有偏移/缩放残留")
        require(actual_name_y == expected_name_y,
                f"结算页{award}姓名与徽章名牌间距不正确")

    settlement_script = (ROOT / "assets/scripts/UI/panelRecordInfo.ts").read_text(
        encoding="utf-8"
    )
    require('"底皮:" + this.FormatBottomStake(this.strGameDipi)' in settlement_script,
            "结算页底皮汇总仍可能重复显示“底皮”前缀")
    require('node.getChildByName("idx").active = true' in settlement_script and
            'node.getChildByName("idx2").active = true' in settlement_script,
            "结算玩家行没有恢复动态名次数字")

    settlement_row = Prefab("assets/resources/Prefabs/战绩玩家对象.prefab")
    for rank_node in ("idx", "idx2"):
        rank_id = settlement_row.node(rank_node)
        rank_data = settlement_row.data[rank_id]
        require(rank_data["_trs"]["array"][0] == -317 and
                rank_data["_contentSize"]["width"] == 46,
                "结算玩家名次数字没有独立对齐在玩家信息列左侧")
    require(settlement_row.data[settlement_row.node("idx")].get("_active") is True and
            settlement_row.data[settlement_row.node("idx2")].get("_active") is False,
            "结算玩家行默认名次显示状态不正确")
    row_size = settlement_row.data[settlement_row.root]["_contentSize"]
    require((row_size["width"], row_size["height"]) == (680, 70),
            "结算玩家行不是确认稿尺寸680x70")
    for hidden in ("头像", "txt", "惩罚", "line"):
        require(settlement_row.data[settlement_row.node(hidden)].get("_active") is False,
                f"结算确认稿不存在旧卡片元素，但仍在显示: {hidden}")

    settlement_source = (ROOT / "assets/scripts/UI/panelRecordInfo.ts").read_text(encoding="utf-8")
    require('else if(button.node.name === "牌局回顾")' in settlement_source and
            'this.node.getChildByName("牌局回顾").active = true;' in settlement_source,
            "结算页牌局回顾按钮没有连接原有功能")
    require('"房间号:" + this.strRoomID' in settlement_source and
            '"总奖池:" + this.strGameJiangChi' in settlement_source,
            "结算汇总栏没有按确认稿显示房间号和总奖池")


def validate_popups() -> None:
    announcement_specs = (
        ("assets/resources/UI/panelNotifyView.prefab",
         "popup_announcement_latest_exact_nobar.png"),
        ("assets/resources/UI/panelNotifyViewCZ.prefab",
         "popup_announcement_recharge_exact_nobar.png"),
        ("assets/resources/UI/panelNotifyViewHD.prefab",
         "popup_announcement_activity_exact_nobar.png"),
    )
    for relative, asset in announcement_specs:
        popup = Prefab(relative)
        bk = popup.node("bk")
        bk_data = popup.data[bk]
        _, bk_sprite = popup.component(bk, "cc.Sprite")
        require(tuple(bk_data["_trs"]["array"][:2]) == (0, -28) and
                (bk_data["_contentSize"]["width"],
                 bk_data["_contentSize"]["height"]) == (632, 840),
                f"{relative} 公告框没有按大内容区确认稿居中")
        require(bk_sprite.get("_spriteFrame", {}).get("__uuid__") == sprite_uuid(asset),
                f"{relative} 没有引用对应V7公告美术")
        scroll = popup.data[popup.node("bk/msg")]
        require(tuple(scroll["_trs"]["array"][:2]) == (0, 13) and
                (scroll["_contentSize"]["width"],
                 scroll["_contentSize"]["height"]) == (586, 644),
                f"{relative} 公告滚动阅读区不够大")
        _, scroll_component = popup.component(popup.node("bk/msg"), "cc.ScrollView")
        require(scroll_component is not None and
                scroll_component.get("_N$verticalScrollBar") is None,
                f"{relative} 公告右侧仍绑定可见滚动条")
        _, label = popup.component(popup.node("bk/msg/view/content/msg"), "cc.Label")
        require(label.get("_fontSize") == 26 and label.get("_lineHeight") == 44 and
                label.get("_N$overflow") == 3,
                f"{relative} 长公告文字没有使用可增长的滚动布局")
        for hidden in ("充值公告", "最新公告", "活动公告", "关闭图标"):
            require(popup.data[popup.node("bk/" + hidden)].get("_active") is False,
                    f"{relative} 仍叠加旧公告美术: {hidden}")
        confirm = popup.node("bk/确定")
        close = popup.node("bk/关闭")
        require(popup.component(confirm, "cc.Button")[1] is not None and
                popup.component(close, "cc.Button")[1] is not None and
                popup.data[confirm].get("_active") is True and
                popup.data[close].get("_active") is True,
                f"{relative} 确定或关闭热区缺少可用Button")
        require(tuple(popup.data[confirm]["_trs"]["array"][:2]) == (0, -361) and
                tuple(popup.data[close]["_trs"]["array"][:2]) == (270, 370),
                f"{relative} 确定或关闭热区没有覆盖确认稿按钮位置")

    message = Prefab("assets/resources/UI/panelMsgView.prefab")
    bk = message.node("bk")
    _, single_sprite = message.component(bk, "cc.Sprite")
    require(tuple(message.data[bk]["_trs"]["array"][:2]) == (0, 13) and
            (message.data[bk]["_contentSize"]["width"],
             message.data[bk]["_contentSize"]["height"]) == (532, 366),
            "普通弹窗没有使用确认稿尺寸")
    require(single_sprite.get("_spriteFrame", {}).get("__uuid__") ==
            sprite_uuid("popup_message_single_exact.png"),
            "普通弹窗默认状态不是单确定美术")
    dual = message.node("bk/V7双按钮底")
    _, dual_sprite = message.component(dual, "cc.Sprite")
    require(message.data[dual].get("_active") is False and
            dual_sprite.get("_spriteFrame", {}).get("__uuid__") ==
            sprite_uuid("popup_message_dual_exact.png"),
            "普通弹窗缺少Prefab内预制的取消加确定状态")
    source = (ROOT / "assets/scripts/UI/panelMsgView.ts").read_text(encoding="utf-8")
    require('getChildByName("V7双按钮底")' in source and
            "dualButtonArt.active = isConfirmation" in source,
            "普通弹窗没有按回调类型切换Prefab预制的双按钮状态")
    require('let isAnnouncement = this.node.name.indexOf("panelNotifyView")>=0;' in source and
            "if(isAnnouncement)\n            return;" in source,
            "公告初始化仍会进入普通弹窗单双按钮排版")
    require('button.node.name == "关闭"' in source,
            "公告右上关闭热区没有接入关闭逻辑")


def validate_prefab_references() -> None:
    prefab_paths = (
        "assets/resources/UI/panelLogin.prefab",
        "assets/resources/UI/panelMain.prefab",
        "assets/resources/UI/panelRecordList.prefab",
        "assets/resources/UI/panelRecordInfo.prefab",
        "assets/resources/UI/panelGivePad.prefab",
        "assets/resources/UI/panelMsgView.prefab",
        "assets/resources/UI/panelNotifyView.prefab",
        "assets/resources/UI/panelNotifyViewCZ.prefab",
        "assets/resources/UI/panelNotifyViewHD.prefab",
        "assets/resources/Prefabs/战绩对象.prefab",
        "assets/resources/Prefabs/战绩玩家对象.prefab",
        "assets/resources/Prefabs/赠送记录对象.prefab",
        "assets/resources/Prefabs/钱包.prefab",
        "assets/resources/Prefabs/交易查询对象.prefab",
    )

    def visit(value, size: int, source: str) -> None:
        if isinstance(value, dict):
            if set(value) == {"__id__"}:
                ref = value["__id__"]
                require(isinstance(ref, int) and 0 <= ref < size,
                        f"{source} 存在越界 __id__: {ref}/{size}")
            for nested in value.values():
                visit(nested, size, source)
        elif isinstance(value, list):
            for nested in value:
                visit(nested, size, source)

    for relative in prefab_paths:
        data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        require(isinstance(data, list) and data, f"{relative} 不是有效 Prefab JSON")
        visit(data, len(data), relative)


def validate_gift_submit_flow() -> None:
    source = (ROOT / "assets/scripts/UI/panelMain.ts").read_text(encoding="utf-8")
    start = source.index('else if(button.node.name === "提交赠送")')
    end = source.index('else if(button.node.name === "关闭上层")', start)
    submit = source[start:end]
    require('V7交易密码' in submit, "赠送提交没有读取页面内交易密码")
    require('header:"调用_方法_Exchange2"' in submit,
            "赠送提交没有直接调用Exchange2")
    require('showPanel("panelGivePad"' not in submit,
            "赠送提交仍会打开二次密码弹窗")


def main() -> None:
    validate_widgets()
    validate_height_math()
    validate_v7_assets()
    validate_followup_modules()
    validate_popups()
    validate_prefab_references()
    validate_gift_submit_flow()
    print("V7 响应式校验通过：Prefab 锚点、四档竖屏高度、资源引用与显示状态均正常。")


if __name__ == "__main__":
    main()
