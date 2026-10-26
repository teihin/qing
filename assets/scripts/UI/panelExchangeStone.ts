import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import ImageManager from "../logic/ImageManager";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import { resolveRoomClubId } from "../logic/RoomClubContext";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

/**
 * 牌桌内「兑换钻石」弹窗（金币 → 钻石）。
 *
 * 协议走**方式 B**：`Account.reqExChange2(我的guuid, 金币数, "gold,非俱乐部")`，无密码，
 * 结果只认 `onExChange(0x200/0x301/0x302)`。见《俱乐部金币与钻石-客户端接口文档》§2.3。
 *
 * 角色只按本项目口径显示三种：**老板 / 代理 / 玩家**（没有「合伙人」）。
 * 判定优先用 `查询_俱乐部_代理_信息` 的 `is_creator` / `is_agent`，
 * 拿不到回包时退化成 `club_make` 判定；`club_manage`（管理员）不单列，按玩家显示。
 *
 * 兑换是单向的（金币换钻石，不可逆），点「确认兑换」不直接发协议，
 * 先弹通用二次确认框（`panelMsgView` 的双按钮版），点「确定」才真正发出去。
 */
@ccclass
export default class panelExchangeStone extends UIPanelViewBase
{
    /** 钻石档位，与服务器 `gold_to_stone=100` 配合：金币消耗 = 钻石 / 100。 */
    private static readonly TIER_STONE:number[] = [100,200,500,1000,2000,5000,10000,20000];
    /** 汇率。服务端配置在 `d_halls.gold_to_stone`，客户端没有查询接口，改配置要同批发版。 */
    private static readonly GOLD_TO_STONE:number = 100;

    private static readonly COLUMN:number = 4;
    private static readonly CELL_W:number = 142;
    private static readonly CELL_H:number = 180;
    private static readonly GAP_X:number = 14;
    private static readonly GAP_Y:number = 14;

    private cards:cc.Node[] = [];
    private selectIndex:number = 0;
    /** 防连点：方式 B 服务端不限额，只能界面挡。 */
    private busy:boolean = false;
    private clubId:string = "";
    private agentInfo:any = null;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("onExChange", this, "onExChange");
        KBEngine.Event.register("ClubAgentInfo", this, "OnClubAgentInfo");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        // 兑换成功后服务端主动同步属性，余额跟着刷新。
        KBEngine.Event.register("set_gold", this, "RefreshUser");
        KBEngine.Event.register("set_stone", this, "RefreshUser");

        let mask = this.node.getChildByName("msk");
        if(mask != null)
        {
            mask.on(cc.Node.EventType.TOUCH_END,()=>{
                UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
            },this);
        }
    }

    start ()
    {
        super.start();

        if(GameDataManager.getAccount() == null)
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
            return;
        }

        this.clubId = resolveRoomClubId(GameDataManager.getAccount(),"",true);
        this.BuildTiers();
        this.RefreshUser();
        this.RefreshRole();
        this.RefreshTip();
        this.RequestAgentInfo();

        // Label 换字后节点尺寸要等一次排版才准，下一帧再校一遍图标/小钻的贴边位置。
        this.scheduleOnce(()=>this.Relayout(),0);
    }

    private Relayout():void
    {
        if(!cc.isValid(this.node))
            return;
        for(let i = 0; i < this.cards.length; ++i)
        {
            if(cc.isValid(this.cards[i]))
                this.LayoutCardNumber(this.cards[i]);
        }
        this.RefreshUser();
        this.RefreshSuperior();
    }

    //--------------------------------------------------------------------------
    // 档位
    //--------------------------------------------------------------------------
    private BuildTiers():void
    {
        let holder = Tool.GetChild(this.node,"弹窗/档位容器");
        let template = holder == null ? null : holder.getChildByName("档位");
        if(holder == null || template == null)
            return;

        this.cards = [];
        let total = panelExchangeStone.TIER_STONE.length;
        for(let i = 0; i < total; ++i)
        {
            let card = i === 0 ? template : cc.instantiate(template);
            card.active = true;
            card.name = "档位" + i;
            if(i > 0)
                card.parent = holder;

            let col = i % panelExchangeStone.COLUMN;
            let row = Math.floor(i / panelExchangeStone.COLUMN);
            card.x = -holder.width / 2 + panelExchangeStone.CELL_W / 2 + col * (panelExchangeStone.CELL_W + panelExchangeStone.GAP_X);
            card.y = holder.height / 2 - panelExchangeStone.CELL_H / 2 - row * (panelExchangeStone.CELL_H + panelExchangeStone.GAP_Y);

            this.SetCardValue(card,panelExchangeStone.TIER_STONE[i]);
            // 克隆出来的节点没走过 UIViewBase.onLoad 的按钮注册，只能自己挂触摸事件。
            let index = i;
            card.on(cc.Node.EventType.TOUCH_END,()=>this.Select(index),this);
            this.cards.push(card);
        }
        this.Select(0);
    }

    private SetCardValue(card:cc.Node,stone:number):void
    {
        let numNode = card.getChildByName("数量");
        let label = numNode == null ? null : numNode.getComponent(cc.Label);
        if(label != null)
        {
            let text = String(stone);
            label.string = text;
            // 位数越多字号越小，保证 5 位数也不顶到卡边。
            label.fontSize = text.length >= 5 ? 19 : (text.length === 4 ? 23 : 26);
            label.lineHeight = 34;
        }
        this.LayoutCardNumber(card);
    }

    /** 小钻图标 + 数字当成一整组居中，宽度要等 Label 重新排版后才能量。 */
    private LayoutCardNumber(card:cc.Node):void
    {
        let numNode = card.getChildByName("数量");
        let glyph = card.getChildByName("小钻");
        if(numNode == null || glyph == null)
            return;
        let label = numNode.getComponent(cc.Label);
        if(label != null)
            this.ForceLabelLayout(label);

        let textWidth = numNode.width;
        let gap = 7;
        let total = glyph.width + gap + textWidth;
        let left = -total / 2;
        glyph.x = left + glyph.width / 2;
        numNode.x = left + glyph.width + gap + textWidth / 2;
    }

    private Select(index:number):void
    {
        if(index < 0 || index >= this.cards.length)
            return;
        this.selectIndex = index;
        for(let i = 0; i < this.cards.length; ++i)
        {
            let sel = this.cards[i].getChildByName("选中");
            if(sel != null)
                sel.active = i === index;
        }
        this.RefreshTip();
    }

    private RefreshTip():void
    {
        let label = this.Label("弹窗/提示");
        if(label == null)
            return;
        let stone = panelExchangeStone.TIER_STONE[this.selectIndex];
        label.string = "兑换 " + stone + " 钻石需消耗 " + (stone / panelExchangeStone.GOLD_TO_STONE) + " 金币";
    }

    //--------------------------------------------------------------------------
    // 玩家信息 / 角色
    //--------------------------------------------------------------------------
    private RefreshUser():void
    {
        let account:any = GameDataManager.getAccount();
        if(account == null || !cc.isValid(this.node))
            return;

        let guuid = account.guuid == null ? "" : String(account.guuid);
        this.SetLabel("弹窗/昵称",account.name == null ? "" : String(account.name));
        this.SetLabel("弹窗/ID","ID: " + guuid);

        let avatarNode = Tool.GetChild(this.node,"弹窗/头像/mask/img");
        let avatar = avatarNode == null ? null : avatarNode.getComponent(cc.Sprite);
        if(avatar != null)
        {
            // 自己和别人的头像走两套逻辑：自己用本地头像序号（photo=1~100），别人的才是图片地址。
            ImageManager.getInstance().SetLocalAvatar(avatar,account.photo,guuid);
        }

        this.SetBalance("金币行",account.gold);
        this.SetBalance("钻石行",account.stone);
    }

    private SetBalance(rowName:string,value:any):void
    {
        let row = Tool.GetChild(this.node,"弹窗/" + rowName);
        if(row == null)
            return;
        let numNode = row.getChildByName("数量");
        let icon = row.getChildByName("图标");
        let label = numNode == null ? null : numNode.getComponent(cc.Label);
        if(label == null)
            return;

        label.string = this.FormatNumber(value);
        this.ForceLabelLayout(label);

        if(icon == null)
            return;
        // 数字右对齐靠右边界，图标跟着数字左沿走；太长时缩字号，别顶出面板。
        if(numNode.width + 10 + icon.width > 200)
        {
            label.fontSize = 21;
            label.lineHeight = 28;
            this.ForceLabelLayout(label);
        }
        let right = numNode.x;
        icon.x = right - numNode.width - 10 - icon.width / 2;
    }

    private ResolveRoleLabel():string
    {
        if(this.clubId === "")
            return "玩家";
        let account:any = GameDataManager.getAccount();
        if(account == null)
            return "玩家";

        // 老板＝俱乐部创建者。club_make 是账号属性，代理信息没回来也能先判出来。
        if(this.SplitHas(account.club_make,this.clubId))
            return "老板";

        if(this.agentInfo != null)
        {
            if(Number(this.agentInfo.is_creator) === 1)
                return "老板";
            if(Number(this.agentInfo.is_agent) === 1)
                return "代理";
        }
        // 管理员（club_manage）和普通成员在本口子里都按「玩家」显示。
        return "玩家";
    }

    private RefreshRole():void
    {
        let label = this.Label("弹窗/角色/文字");
        if(label != null)
            label.string = this.ResolveRoleLabel();
        this.RefreshSuperior();
    }

    private RefreshSuperior():void
    {
        let titleLabel = this.Label("弹窗/上级");
        let nameLabel = this.Label("弹窗/上级名");
        if(titleLabel == null || nameLabel == null)
            return;

        let info = this.agentInfo;
        let upperName = info == null || info.upper_name == null ? "" : String(info.upper_name).trim();
        let upperId = info == null || info.upper_guuid == null ? "" : String(info.upper_guuid).trim();
        let hasUpper = upperName !== "" || upperId !== "";

        titleLabel.node.active = hasUpper;
        nameLabel.node.active = hasUpper;
        if(!hasUpper)
            return;

        titleLabel.string = "◆ 上级";
        nameLabel.string = upperId === "" ? upperName : (upperName === "" ? upperId : upperName + "[" + upperId + "]");

        this.ForceLabelLayout(titleLabel);
        nameLabel.node.x = titleLabel.node.x + titleLabel.node.width + 8;
    }

    private RequestAgentInfo():void
    {
        if(this.clubId === "")
            return;
        let account:any = GameDataManager.getAccount();
        if(account == null || typeof account.reqHallCommand !== "function")
            return;
        account.reqHallCommand(
            JSON.stringify({header:"查询_俱乐部_代理_信息",club_id:this.clubId}),
            "p@club:agent:" + this.clubId);
    }

    public onHallCommand(nCode:number,param:string)
    {
        // 代理信息的正式结果走 `ClubAgentInfo` 路由，部分环境会塞进大厅回包里。
        if(param == null || param.indexOf("ClubAgentInfo") < 0)
            return;
        this.OnClubAgentInfo(param);
    }

    public OnClubAgentInfo(raw:any)
    {
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data && data.result && !data.club_id)
            data = data.result;
        if(Array.isArray(data))
            data = data.length > 0 ? data[0] : null;
        if(data == null || data.club_id == null)
            return;
        if(String(data.club_id) !== this.clubId)
            return;

        // 只认本人的代理信息，避免把上级/创建者的记录当成本人的角色。
        let account:any = GameDataManager.getAccount();
        if(account != null && data.user_id != null && String(data.user_id) !== String(account.guuid))
            return;

        this.agentInfo = data;
        this.RefreshRole();
    }

    //--------------------------------------------------------------------------
    // 兑换
    //--------------------------------------------------------------------------
    public onButtonClick(button:cc.Button)
    {
        let name = button.node.name;
        if(name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
        else if(name === "确认")
        {
            this.OnConfirm();
        }
    }

    /**
     * 点「确认兑换」的第一道关：只弹二次确认，不发协议。
     * 兑换是单向的（金币扣掉换钻石，不可逆），金额又都是大数，必须挡一下误触。
     */
    private OnConfirm():void
    {
        if(this.busy)
            return;

        let account:any = GameDataManager.getAccount();
        if(account == null)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"登录状态异常，请重新登录后再试！");
            return;
        }

        let stone = panelExchangeStone.TIER_STONE[this.selectIndex];
        let gold = Math.max(1,Math.round(stone / panelExchangeStone.GOLD_TO_STONE));
        let owned = Number(account.gold);
        if(isFinite(owned) && owned < gold)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币不足，请先充值或联系客服！");
            return;
        }

        // 传一个函数当 arrayEx[0]，panelMsgView 自动切成「确定 + 取消」双按钮版。
        // 文案控制在两行内：弹窗文本区只有 450×132（30 号字，每行约 15 字）。
        let message = "确认兑换 " + stone + " 钻石？\n将立即扣除 " + gold + " 金币";
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message,[(confirmed:boolean)=>{
            if(confirmed)
                this.DoSendExchange(stone,gold);
        }]);
    }

    /** 二次确认点「确定」之后才真正发协议。 */
    private DoSendExchange(stone:number,gold:number):void
    {
        if(this.busy || !cc.isValid(this.node))
            return;

        let account:any = GameDataManager.getAccount();
        if(account == null)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"登录状态异常，请重新登录后再试！");
            return;
        }

        // 确认弹窗挂着这段时间金币可能变了（比如刚打完一局），再校一次。
        let owned = Number(account.gold);
        if(isFinite(owned) && owned < gold)
        {
            // 此刻 panelMsgView 刚被 destroy（还挂在父节点上没移除），
            // 同一帧再 showPanel 会命中「已存在」分支而复用旧界面，文本不刷新。挪到下一帧弹。
            this.scheduleOnce(()=>{
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币不足，请先充值或联系客服！");
            },0);
            return;
        }

        this.busy = true;
        this.scheduleOnce(()=>{ this.busy = false; },8);
        // money_value 传**金币数**（消耗量），钻石由服务端按汇率乘出来；
        // money_type 必须是英文逗号 + 字面量「非俱乐部」，服务端不做容错。
        account.reqExChange2(String(account.guuid),gold,"gold,非俱乐部");
    }

    public onExChange(nCode:number)
    {
        this.busy = false;
        if(!cc.isValid(this.node))
            return;

        if(nCode === 0x200)
        {
            this.RefreshUser();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"兑换成功，钻石已到账！");
        }
        else if(nCode === 0x302)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币不足，兑换失败！");
        }
        else if(nCode === 0x307 || nCode === 0x308)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码校验未通过，兑换失败！");
        }
        else
        {
            // 0x301：功能未开启 / 参数非法 / boss 账号 / 风控拦截。
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"兑换失败，请稍后再试或联系客服！");
        }
    }

    //--------------------------------------------------------------------------
    // 小工具
    //--------------------------------------------------------------------------
    private Label(path:string):cc.Label
    {
        let node = Tool.GetChild(this.node,path);
        return node == null ? null : node.getComponent(cc.Label);
    }

    private SetLabel(path:string,text:string):void
    {
        let label = this.Label(path);
        if(label != null)
            label.string = text == null ? "" : text;
    }

    private ForceLabelLayout(label:cc.Label):void
    {
        let forceUpdate = (label as any)._forceUpdateRenderData;
        if(typeof forceUpdate === "function")
            forceUpdate.call(label,true);
    }

    private SplitHas(value:any,target:string):boolean
    {
        if(value == null || target === "")
            return false;
        let list = String(value).split(",");
        for(let i = 0; i < list.length; ++i)
        {
            if(list[i].trim() === target)
                return true;
        }
        return false;
    }

    /** 千分位；非数字一律补 0，避免界面出现 NaN。 */
    private FormatNumber(value:any):string
    {
        let number = Number(value);
        if(!isFinite(number))
            return "0";
        let text = String(Math.floor(number));
        return text.replace(/\B(?=(\d{3})+(?!\d))/g,",");
    }
}
