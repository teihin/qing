import UIPanelViewBase from "../common/UIPanelViewBase";
import Debug from "../common/Debug";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import ConfigManager from "../logic/ConfigManager";
import { ClosePanelMode, ShowPanelMode, WEB_IP, WEB_TX_IP } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import ScrollViewEx from "../common/ScrollViewEx";
import MobileManager from "../mobile/MobileManager";
import WebLoadingManager from "../common/WebLoadingManager";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelQianBao extends UIPanelViewBase {

    @property(cc.SpriteFrame)
    paymentAlipayIcon:cc.SpriteFrame = null;

    @property(cc.SpriteFrame)
    paymentUnionPayIcon:cc.SpriteFrame = null;

    @property(cc.SpriteFrame)
    paymentWeChatIcon:cc.SpriteFrame = null;

    @property(cc.SpriteFrame)
    paymentOtherIcon:cc.SpriteFrame = null;

    private PAGE_PER_COUNT:number = 5;
    private paymentDefaultIconFrames:{[key:string]:cc.SpriteFrame} = {};
    private readonly paymentIconContextPrefix:string = "更新支付通道图标:";
    private strCurZhifuConfig:string = ""; //当前支付配置
    private selectedPaymentChannelName:string = "";
    private updatingPaymentChannels:boolean = false;
    private refreshingRechargeLayout:boolean = false;
    private readonly rechargeFollowingNodes:string[] = [
        "V7选择充值金额", "金额", "V7充值提示框", "充值提示", "V8默认充值提示", "确认充值"
    ];
    private rechargeLayoutBase:{viewportHeight:number, panelHeight:number,
        followingTops:{[name:string]:number}} = null;
    private withdrawRowBase:{node:cc.Node, top:number, height:number}[] = null;
    private readonly defaultRechargeNotice:string = "请使用实名认证名下的银行卡充值，\n准确按照订单金额进行转账。";
    private readonly defaultWithdrawNotice:string = "请核对提现信息，提交后不可修改。";
    private strZhifubTxt:string = this.defaultWithdrawNotice;
    private strYinlianTxt:string = this.defaultWithdrawNotice;
    private strUSDTTxt:string = this.defaultWithdrawNotice;

    private scrollExchange:ScrollViewEx = null;

    private strYLInfo:string = "";//交易预留信息

    private strUserName = ""

    private dataHisDD:any = null //历史订单
    private bNeedInitJYPwd:boolean = false;  //是否需要初始化交易密码
    private updatingWalletSelection:boolean = false;
    private selectedWithdrawType:string = "";
    private readonly withdrawInfoContextPrefix:string = "钱包提现预留:";
    private static withdrawInfoRequestId:number = 0;
    private withdrawInfoRequests:{[type:string]:{key:string, context:string}} = {};
    private realnamePasswordCheckPending:boolean = false;
    private readonly withdrawOptionsContextPrefix:string = "钱包提现开关:";
    private readonly withdrawOptionKeys:string[] = ["银行卡提现","支付宝提现","USDT提现","USDT汇率","提现类型"];
    private withdrawOptionsContext:string = "";
    private withdrawOptionValues:{[key:string]:string} = {};
    private withdrawOptionReplies:{[key:string]:boolean} = {};
    private withdrawEnabled:{[type:string]:boolean} = {"银联":false,"支付宝":false,"USDT":false};
    private nTotleSecLeftDD:number = 0; //历史订单剩余时间

    private nZhifu5HandCount = 0 ;//支付5最低手数要求
    onLoad () {
        super.onLoad();

        this.CapturePaymentChannelDefaultIcons();
        this.CaptureRechargeChannelLayout();
        Tool.GetChild(this.node,"容器/充值/根").on(cc.Node.EventType.SIZE_CHANGED,
            this.RefreshRechargeChannelLayout,this);

        KBEngine.Event.register("set_gold", this, "set_gold");
        KBEngine.Event.register("set_gold2", this, "set_gold");
        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo"); 
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ListPlayerExchangeInfo", this, "OnListPlayerExchangeInfo");

        KBEngine.Event.register("UserHashError",this, "OnUserHashError"); 
        KBEngine.Event.register("onPasteData",this, "onPasteData"); 

        Tool.GetChild(this.node,"容器/充值/充值信息").on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            Tool.GetChild(this.node,"容器/充值/充值信息").active = false;
            event.stopPropagation();
        },this);

        Tool.GetChild(this.node,"选择银行").on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            Tool.GetChild(this.node,"选择银行").active = false;
            event.stopPropagation();
        },this);

        Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/银行/银行").on(cc.Node.EventType.TOUCH_START,()=>{
            this.node.getChildByName("选择银行").active = true;
            this.UpdateBankList();
        },this);

        Tool.GetChild(this.node,"容器/提现/提现选项/银行/银行").on(cc.Node.EventType.TOUCH_START,()=>{
            this.node.getChildByName("选择银行").active = true;
            this.UpdateBankList();
        },this);

        Tool.GetChild(this.node,"实名/信息/银行/银行").on(cc.Node.EventType.TOUCH_START,()=>{
            this.node.getChildByName("选择银行").active = true;
            this.UpdateBankList();
        },this);
        
        Tool.GetChild(this.node,"实名").on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
        },this);

        this.set_gold();

        this.scrollExchange = Tool.GetChild(this.node,"容器/记录/列表").getComponent(ScrollViewEx);
        this.scrollExchange.callBackFresh = this.GetJiaoYiInfo.bind(this);

        //查询是否有个人信息
        
        ConfigManager.getInstance().GetOneHashKey("实名文本","实名文本");
        ConfigManager.getInstance().GetOneHashKey("支付配置_提现","更新提现银行");
       
        //监控rmb输入变化，调整usdt
        let editRMB = Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额/input").getComponent(cc.EditBox)
        let editUSDT = Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量/input").getComponent(cc.EditBox)
        editRMB.node.on("text-changed",()=>{
            Debug.Log(editRMB.string)
            editRMB.string =  (Number(editRMB.string)*100/100).toString()

            let nHuilv = this.GetUSDTRate()
            if(nHuilv === 0) return;
            //实时更新usdt数据
            if(editRMB.string != "")
            {
                let nRmb = Number(editRMB.string)
                editUSDT.string = (nRmb/nHuilv).toFixed(3).toString()
            }
            
        },this)

        //监控usdt调整rmb
        editUSDT.node.on("text-changed",()=>{
            Debug.Log(editUSDT.string)
            editUSDT.string =  (Number(editUSDT.string)*1000/1000).toString()

            let nHuilv = this.GetUSDTRate()
            if(nHuilv === 0) return;
            //实时更新usdt数据
            if(editUSDT.string != "")
            {
                let nUSDT = Number(editUSDT.string)
                editRMB.string = ((nUSDT*nHuilv)*100/100).toString()
            }
            
        },this)
    }

    start () {

    }

    private CaptureRechargeChannelLayout():void
    {
        if(this.rechargeLayoutBase != null)
            return;
        const root = Tool.GetChild(this.node,"容器/充值/根");
        const followingTops:{[name:string]:number} = {};
        for(const name of this.rechargeFollowingNodes)
            followingTops[name] = root.getChildByName(name).getComponent(cc.Widget).top;
        this.rechargeLayoutBase = {
            viewportHeight:root.getChildByName("通道视口").height,
            panelHeight:root.getChildByName("V7充值面板").height,
            followingTops
        };
    }

    private RefreshWithdrawBankRows():void
    {
        const root = Tool.GetChild(this.node,"容器/提现/提现选项");
        if(this.withdrawRowBase == null)
            this.withdrawRowBase = ["金额","姓名","银行","支行","卡号","密码"].map(name => {
                const node = root.getChildByName(name);
                return {node,top:node.getComponent(cc.Widget).top,height:node.height};
            });
        const rows = this.withdrawRowBase;
        const hasBranch = root.getChildByName("银行").active && root.getChildByName("支行").active;
        // Six bank fields share the same form span when a branch is required.
        // Only the empty row bases resize; text, icons and inputs retain their size.
        const gap = (rows[1].top-rows[0].top-rows[0].height)/2;
        const height = (rows[5].top+rows[5].height-rows[0].top-gap*5)/6;
        rows.forEach((row,index) => {
            const widget = row.node.getComponent(cc.Widget);
            row.node.height = hasBranch ? height : row.height;
            widget.top = hasBranch ? rows[0].top+index*(height+gap) : row.top;
            widget.updateAlignment();
        });
    }

    private RefreshRechargeChannelLayout():void
    {
        const root = Tool.GetChild(this.node,"容器/充值/根");
        if(!root.activeInHierarchy || this.updatingPaymentChannels || this.refreshingRechargeLayout)
            return;
        this.CaptureRechargeChannelLayout();
        this.refreshingRechargeLayout = true;
        try
        {
            // updateAlignment also aligns ancestors, so a same-frame resize or
            // reopen uses the current phone height before the server list is laid out.
            root.getComponent(cc.Widget).updateAlignment();
            const viewport = root.getChildByName("通道视口");
            const content = viewport.getChildByName("充值渠道");
            const visible = content.children.filter(child => child.active && child.getComponent(cc.Toggle) != null);
            if(visible.length === 0)
                return;
            // The Prefab's native two-column Grid measures only active channels:
            // 1–2 = one row, 3–4 = two rows, etc. Art sizes and gaps stay in the Prefab.
            content.getComponent(cc.Layout).updateLayout();
            const panel = root.getChildByName("V7充值面板");
            const panelWidget = panel.getComponent(cc.Widget);
            const base = this.rechargeLayoutBase;
            const fixedHeight = base.panelHeight-base.viewportHeight;
            const availableHeight = root.height-panelWidget.top-panelWidget.bottom-fixedHeight;
            const viewportHeight = Math.min(content.height,Math.max(visible[0].height,availableHeight));
            const delta = viewportHeight-base.viewportHeight;
            const scroll = viewport.getComponent(cc.ScrollView);
            scroll.stopAutoScroll();
            viewport.height = viewportHeight;
            viewport.getComponent(cc.Widget).updateAlignment();
            for(const name of this.rechargeFollowingNodes)
            {
                const widget = root.getChildByName(name).getComponent(cc.Widget);
                widget.top = base.followingTops[name]+delta;
                widget.updateAlignment();
            }
            panel.height = base.panelHeight+delta;
            panelWidget.updateAlignment();
            scroll.vertical = content.height > viewportHeight+0.1;
            content.getComponent(cc.Widget).updateAlignment();
            // Clamp/reset only the channel content; the rest of the page stays fixed.
            scroll.scrollToTop(0);
        }
        finally
        {
            this.refreshingRechargeLayout = false;
        }
    }

    // update (dt) {}

    onEnable(){
        Debug.Log("显示");

        this.withdrawInfoRequests = {};
        this.selectedWithdrawType = "";
        this.realnamePasswordCheckPending = false;
        this.bNeedInitJYPwd = false;
        this.strUserName = "";
        Tool.GetChild(this.node,"实名").active = false;
        for(const field of ["姓名","银行","卡号","交易密码","确认密码"])
            Tool.GetChild(this.node,"实名/信息/"+field+"/input").getComponent(cc.EditBox).string = "";
        let toggle = Tool.GetChild(this.node,"选项/充值").getComponent(cc.Toggle);
        this.SelectWalletToggle(toggle);

        this.node.getChildByName("选择银行").active = false;

        // V7钱包页顶部始终保留返回入口；Prefab内的高清箭头负责显示，
        // 这里仅保证它在大厅和牌桌两个入口都可点击。
        Tool.GetChild(this.node,"Title/关闭").active = true;
        Tool.GetChild(this.node,"实名/Title/关闭").active = true;
        this.RequestWithdrawInfo("银联");

        Tool.GetChild(this.node,"订单详情").active = false
    }

    onDisable(){
        this.withdrawInfoRequests = {};
        this.selectedWithdrawType = "";
        this.realnamePasswordCheckPending = false;
        this.withdrawOptionsContext = "";
    }

    private SelectWalletToggle(toggle:cc.Toggle):void
    {
        // isChecked may emit both selection and deselection callbacks in 2.4.
        this.updatingWalletSelection = true;
        try { toggle.isChecked = true; }
        finally { this.updatingWalletSelection = false; }
        this.onToggleClick(toggle);
    }

    private RequestWithdrawInfo(type:string):void
    {
        const key = GameDataManager.getAccount().guuid+"_提现预留_"+type;
        const pending = this.withdrawInfoRequests[type];
        if(pending != null && pending.key === key)
            return;
        const context = this.withdrawInfoContextPrefix+(++panelQianBao.withdrawInfoRequestId);
        this.withdrawInfoRequests[type] = {key, context};
        ConfigManager.getInstance().GetOneHashKey(key,context);
    }

    private TakeWithdrawInfoReply(key:string,context:string,missing:boolean = false):string
    {
        if(!this.node.activeInHierarchy)
            return null;
        for(const type of Object.keys(this.withdrawInfoRequests))
        {
            const pending = this.withdrawInfoRequests[type];
            // Missing-profile replies contain only context. Its unique request
            // ID still identifies the stored key; verify that key against the
            // current account, and reject any explicitly mismatched reply key.
            const keyMatches = pending.key === key || (missing && key == null);
            if(keyMatches && pending.context === context &&
                pending.key === GameDataManager.getAccount().guuid+"_提现预留_"+type)
            {
                delete this.withdrawInfoRequests[type];
                return type;
            }
        }
        return null;
    }

    private ShowMissingRealname():void
    {
        Tool.GetChild(this.node,"实名").active = true;
        if(this.realnamePasswordCheckPending)
            return;
        this.realnamePasswordCheckPending = true;
        const strParam = JSON.stringify({header:"校验_玩家_交易密码",old_pwd:""});
        GameDataManager.getAccount().reqHallCommand(strParam,"P@校验_玩家_交易密码");
    }

    private ApplyWithdrawInfo(type:string,content:string):void
    {
        const fields = (content || "").split("#");
        const value = (index:number):string => fields[index] || "";
        // Only the bank profile is the existing real-name source. Alipay/USDT
        // records are optional form defaults, not evidence of missing identity.
        if(type === "银联")
        {
            for(const pair of [["姓名",1],["银行",2],["卡号",5]])
                Tool.GetChild(this.node,"实名/信息/"+pair[0]+"/input").getComponent(cc.EditBox).string = value(Number(pair[1]));
            this.strUserName = value(1);
            if(value(1) && value(2) && value(5))
            {
                Tool.GetChild(this.node,"实名").active = false;
                this.realnamePasswordCheckPending = false;
                this.bNeedInitJYPwd = false;
            }
            else
                this.ShowMissingRealname();
        }
        if(type !== this.selectedWithdrawType || !Tool.GetChild(this.node,"容器/提现").activeInHierarchy)
            return;
        const root = "容器/提现/提现选项/";
        if(type === "USDT")
            Tool.GetChild(this.node,root+"TRC20地址/input").getComponent(cc.EditBox).string = value(6);
        else if(type === "支付宝")
        {
            Tool.GetChild(this.node,root+"姓名/input").getComponent(cc.EditBox).string = value(1) || this.strUserName;
            Tool.GetChild(this.node,root+"支付宝/input").getComponent(cc.EditBox).string = value(4);
        }
        else
            for(const pair of [["姓名",1],["银行",2],["支行",3],["卡号",5]])
                Tool.GetChild(this.node,root+pair[0]+"/input").getComponent(cc.EditBox).string = value(Number(pair[1]));
    }

    private RequestWithdrawOptions():void
    {
        this.withdrawOptionsContext = this.withdrawOptionsContextPrefix+(++panelQianBao.withdrawInfoRequestId);
        this.withdrawOptionValues = {};
        this.withdrawOptionReplies = {};
        this.withdrawEnabled = {"银联":false,"支付宝":false,"USDT":false};
        this.selectedWithdrawType = "";
        this.ResetTxInfo();
        this.ApplyWithdrawOptions();
        for(const key of this.withdrawOptionKeys)
            ConfigManager.getInstance().GetOneHashKey(key,this.withdrawOptionsContext);
    }

    private ReceiveWithdrawOption(key:string,context:string,value:string,missing:boolean):void
    {
        if(context !== this.withdrawOptionsContext || !this.node.activeInHierarchy ||
            !Tool.GetChild(this.node,"容器/提现").activeInHierarchy || this.withdrawOptionKeys.indexOf(key) < 0 ||
            this.withdrawOptionReplies[key])
            return;
        this.withdrawOptionReplies[key] = true;
        if(!missing)
            this.withdrawOptionValues[key] = (value || "").trim();
        if(this.withdrawOptionKeys.some(item => !this.withdrawOptionReplies[item]))
            return;
        const values = this.withdrawOptionValues;
        const legacy = values["提现类型"];
        // Existing bank/Alipay settings survive migration until their new keys
        // are saved. Missing USDT configuration always means disabled.
        this.withdrawEnabled["银联"] = values["银行卡提现"] === undefined ? legacy === "1" || legacy === "3" : values["银行卡提现"] === "开";
        this.withdrawEnabled["支付宝"] = values["支付宝提现"] === undefined ? legacy === "2" || legacy === "3" : values["支付宝提现"] === "开";
        const rate = Number(values["USDT汇率"]);
        const validRate = Number.isFinite(rate) && rate > 0 && rate <= 1000000;
        this.withdrawEnabled["USDT"] = values["USDT提现"] === "开" && validRate;
        Tool.GetChild(this.node,"容器/提现/提现选项/汇率/txt").getComponent(cc.Label).string = validRate ? values["USDT汇率"] : "";
        this.ApplyWithdrawOptions();
    }

    private ApplyWithdrawOptions():void
    {
        const root = Tool.GetChild(this.node,"容器/提现");
        const types = root.getChildByName("类型选择");
        let selected:cc.Toggle = null;
        this.updatingWalletSelection = true;
        try
        {
            for(const pair of [["银联","银行卡提现"],["支付宝","支付宝提现"],["USDT","USDT提现"]])
            {
                const node = types.getChildByName(pair[1]);
                node.active = this.withdrawEnabled[pair[0]];
                if(node.active && (selected == null || pair[0] === this.selectedWithdrawType))
                    selected = node.getComponent(cc.Toggle);
            }
            types.active = selected != null;
            root.getChildByName("提现选项").active = selected != null;
            root.getChildByName("全部提现").active = selected != null;
        }
        finally { this.updatingWalletSelection = false; }
        if(selected != null)
            this.SelectWalletToggle(selected);
    }

    private GetUSDTRate():number
    {
        const rate = Number(Tool.GetChild(this.node,"容器/提现/提现选项/汇率/txt").getComponent(cc.Label).string);
        return Number.isFinite(rate) && rate > 0 && rate <= 1000000 ? rate : 0;
    }

    set_gold(num:number = null)
    {
        Tool.GetChild(this.node,"容器/提现/余额/num").getComponent(cc.Label).string = GameDataManager.getAccount().gold.toString()+(GameDataManager.getAccount().gold2==0?"":("."+GameDataManager.getAccount().gold2.toString().padStart(2,"0")));
        Tool.GetChild(this.node,"订单详情/信息/余额/txt").getComponent(cc.Label).string = GameDataManager.getAccount().gold.toString()+(GameDataManager.getAccount().gold2==0?"":("."+GameDataManager.getAccount().gold2.toString().padStart(2,"0")));
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "关闭")
        {
            // 内嵌钱包由 Main 恢复本次打开来源；牌桌仍走原面板关闭逻辑。
            if(this.node.parent != null && this.node.parent.name === "Main")
            {
                let mainRoot = this.node.parent;
                let panelMain = mainRoot.parent;
                const owner = panelMain.getComponent("panelMain") as cc.Component & { CloseWallet:()=>void };
                if(owner != null && typeof owner.CloseWallet === "function")
                {
                    owner.CloseWallet();
                    return;
                }
                this.node.active = false;
                let discover = mainRoot.getChildByName("发现");
                if(discover != null)
                {
                    discover.active = true;
                }
                let down = panelMain.getChildByName("Down");
                if(down != null)
                {
                    down.active = true;
                    let discoverToggle = down.getChildByName("发现");
                    if(discoverToggle != null)
                    {
                        let toggle = discoverToggle.getComponent(cc.Toggle);
                        if(toggle != null)
                        {
                            toggle.isChecked = true;
                        }
                    }
                }
            }
            else
            {
                UIManager.getInstance().closePanelByName(this.node.name);
            }
        }
        else if(button.node.name === "客服")
        {
            UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover);            
        }
        else if(button.node.name == "进入未完成订单")
        {
            if(this.dataHisDD != null)
            {
                this.showHisDD(this.dataHisDD)
            }
        }
        else if(button.node.name === "确认充值")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"暂未开通，后续处理");
            return;

            //是否有历史订单，如果有直接弹出历史订单
            if(this.dataHisDD != null)
            {
                this.showHisDD(this.dataHisDD)
                return
            }


            //拿渠道
            let arrayToggle = Tool.GetChild(this.node,"容器/充值/根/通道视口/充值渠道").getComponentsInChildren(cc.Toggle);
            let strName:string = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            
            //拿金额
            arrayToggle = Tool.GetChild(this.node,"容器/充值/根/金额").getComponentsInChildren(cc.Toggle);
            let strMoney:string = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strMoney = item.node.name;
                    break;
                }
            }

            if(strName == "自助充值")
            {
                strMoney = Tool.GetChild(this.node,"容器/充值/根/金额输入/input").getComponent(cc.EditBox).string;
            }
            if(strMoney.indexOf(".")>=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额必须为整数！");
                return;
            }

            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择充值渠道！");
                return;
            }

            //如果有输入金额则走输入
            // if(Tool.GetChild(this.node,"容器/充值/根/自行输入").active)
            // {
            //     var inputRange = Tool.GetChild(this.node,"容器/充值/根/自行输入/inputrange").getComponent(cc.Label).string;
            //     var array = inputRange.split(',');
            //     var input = Tool.GetChild(this.node,"容器/充值/根/自行输入/input").getComponent(cc.EditBox).string;
            //     if(input != "")
            //     {
            //         if(Number(input)<Number(array[0])||Number(input)>Number(array[1]))
            //         {
            //             Tool.GetChild(this.node,"容器/充值/根/自行输入/input").getComponent(cc.EditBox).string = "";
            //             UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入"+array[0]+"-"+array[1]+"之间的金额");
            //             return;
            //         }
            //         strMoney = input;
            //     }
            // }


            if(strMoney == "" && strName != "VIP充值"&& strName != "VIP充值2")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请确认充值金额！");
                return;
            }
            if(strName == "自助充值" &&( Number(strMoney)<100||Number(strMoney)>10000))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额必须大于100小于10000！");
                return;
            }

            if(this.strCurZhifuConfig == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付通道未配置！");
                return;
            }

            //校验当前渠道是否需要详细信息
            let data = JSON.parse(this.strCurZhifuConfig);
            if(data == null)
                return;
            if(data["needinfo"])
            {
                let arrayInfo = data["infolist"].split("#");
                let arrayAll = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list").children;
                for(let item of arrayAll)
                {
                    let bFind = false;
                    for(let one of arrayInfo)
                    {
                        if(item.name === one)
                        {
                            bFind = true;
                            break;
                        }
                    }
                    if(bFind)
                    {
                        item.active = true;
                    }
                    else
                    {
                        item.active = false;
                    }
                }
                Tool.GetChild(this.node,"容器/充值/充值信息").active = true;

                //更新预留信息
                ConfigManager.getInstance().GetOneHashKey(GameDataManager.getAccount().guuid+"_支付预留_"+strName,"更新支付预留");
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/银行/input").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/姓名/input").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/卡号/input").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/手机/input").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/身份证/input").getComponent(cc.EditBox).string = "";
            }
            else
            {

                if(strName == "VIP充值")
                {
                    UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover,strName);
                    return;
                }
                if(strName == "VIP充值2")
                {
                    UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover,strName);
                    return;
                }

                // let inName = Tool.GetChild(this.node,"容器/充值/根/姓名输入/input").getComponent(cc.EditBox);
                // if(strName === "自助充值" && inName.string == "")
                // {
                //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入转账人姓名");
                //     return;
                // }
                // if(strName === "自助充值" && !Tool.IsAllChinese(inName.string))
                // {
                //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"姓名必须为中文!");
                //     return;   
                // }

                // if(strName === "自助充值")
                // {
                //     //保存支付信息            
                //     ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+ "_支付预留_"+strName,inName.string);
                // }

                
                
                if(strName == "支付1" ||strName == "支付2" ||strName == "支付3" || strName == "支付4" || strName == "支付5" || strName == "支付7" )
                {
                    //调整为直接获取支付数据不弹出
                    UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
                    Tool.HTTP_GET("http://"+WEB_TX_IP+"/api/JsonPay/createOrder?uuid="+GameDataManager.getAccount().guuid+"&amount="+encodeURIComponent(strMoney)+"&paytype="+encodeURIComponent(strName)+"&realname="+encodeURIComponent(this.strUserName),(ret)=>{
                        Debug.Log(ret)
                        if(ret.status == 200)
                        {
                            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
                            let jRet = JSON.parse(ret.response)
                            
                            Debug.Log(jRet)
                            let arrayToggle = Tool.GetChild(this.node,"容器/充值/根/金额").getComponentsInChildren(cc.Toggle);
                            
                            let data = jRet["data"]

                            if(jRet["status"]["result"]!=0)
                            {
                                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"创建订单失败！")
                                return  
                            }


                            if(data["HAS_ORDER"]) //有订单，则不允许拉起新订单
                            {
                                for(let i=0;i<arrayToggle.length;i++)
                                {
                                    arrayToggle[i].interactable = false
                                }
                                //显示最近订单按钮
                                Tool.GetChild(this.node,"容器/充值/根/进入未完成订单").active = true
                                this.dataHisDD = data
                                this.showHisDD(this.dataHisDD)
                            }
                            else
                            {
                                for(let i=0;i<arrayToggle.length;i++)
                                {
                                    arrayToggle[i].interactable = true
                                }
                                Tool.GetChild(this.node,"容器/充值/根/进入未完成订单").active = false
                                this.dataHisDD = null
                            }
                        }
                    },(err)=>{
                        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
                        // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付网络异常！")
                    })
                }
                else //其他走弹出   
                {
//直接提交
                    let strUrl =Tool.GetConfigString("支付域名","");
                    if(strUrl === "")
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付域名获取失败！");
                        return;
                    }

                    let strOut ="http://"+strUrl+"/api/Pay/createOrder?uuid="+GameDataManager.getAccount().guuid+"&amount="+encodeURIComponent(strMoney)+"&paytype="+encodeURIComponent(strName)+"&realname="+encodeURIComponent(this.strUserName);
                    Debug.Log(strOut)
                    cc.sys.openURL(strOut)
                }
                
            }
        }
        else if(button.node.name === "确认充值2")
        {
            let inBank = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/银行/input").getComponent(cc.EditBox);
            if(inBank.node.parent.active && inBank.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"银行不能为空！");
                return;
            }
            let inName = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/姓名/input").getComponent(cc.EditBox);
            if(inName.node.parent.active && inName.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"姓名不能为空！");
                return;
            }
            if(inName.node.parent.active && !Tool.IsAllChinese(inName.string))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"姓名必须为中文!");
                return;   
            }


            let inCard = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/卡号/input").getComponent(cc.EditBox);
            if(inCard.node.parent.active && inCard.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"卡号不能为空！");
                return;
            }
            let inPhone = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/手机/input").getComponent(cc.EditBox);
            if(inPhone.node.parent.active && inPhone.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"手机号不能为空！");
                return;
            }
            let inIDCard = Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/身份证/input").getComponent(cc.EditBox);
            if(inIDCard.node.parent.active && inIDCard.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"身份证不能为空！");
                return;
            }

            //拿渠道
            let arrayToggle = Tool.GetChild(this.node,"容器/充值/根/通道视口/充值渠道").getComponentsInChildren(cc.Toggle);
            let strName:string = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            
            //拿金额
            arrayToggle = Tool.GetChild(this.node,"容器/充值/根/金额").getComponentsInChildren(cc.Toggle);
            let strMoney:string = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strMoney = item.node.name;
                    break;
                }
            }
            if(strName == "自助充值")
            {
                strMoney = Tool.GetChild(this.node,"容器/充值/根/金额输入/input").getComponent(cc.EditBox).string;
            }

            if(strMoney.indexOf(".")>=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额必须为整数！");
                return;
            }
            if(strMoney == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请确认充值金额！");
                return;
            }
            if(strName == "自助充值" &&( Number(strMoney)<100||Number(strMoney)>50000))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额必须大于100小于50000！");
                return;
            }

            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择充值渠道！");
                return;
            }

            if(strName == "VIP充值")
            {
                UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover,strName);
                return;
            }
            if(strName == "VIP充值2")
            {
                UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover,strName);
                return;
            }

            let strUrl =Tool.GetConfigString("支付域名","");
            if(strUrl === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付域名获取失败！");
                return;
            }

            let strOut = "http://"+strUrl+"/api/Pay/createOrder?uuid="+GameDataManager.getAccount().guuid+"&amount="+strMoney.replace("元","")+"&paytype="+encodeURIComponent(strName)+"&bankname="+(inBank.node.active?encodeURIComponent(inBank.string):"")+"&bankid="+(inCard.node.active?inCard.string:"")+"&phone="+(inPhone.node.active?inPhone.string:"")+"&realname="+(inName.node.active?encodeURIComponent(inName.string):"")+"&idcard="+(inIDCard.node.active?inIDCard.string:"");
            cc.sys.openURL(strOut);

            button.node.parent.parent.active = false;

            //保存支付信息            
            let strValue = inBank.string+"#"+inName.string+"#"+inCard.string+"#"+inPhone.string+"#"+inIDCard.string;
            ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+ "_支付预留_"+strName,strValue);
        }
        else if(button.node.name.indexOf("银行")>=0)
        {
            this.node.getChildByName("选择银行").active = false;
            if(Tool.GetChild(this.node,"容器/充值/充值信息").active)
            {
                Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/银行/input").getComponent(cc.EditBox).string = button.node.name;
            }
            else if(Tool.GetChild(this.node,"实名").active)
            {
                Tool.GetChild(this.node,"实名/信息/银行/input").getComponent(cc.EditBox).string = button.node.name;
            }
            else //提现
            {
                Tool.GetChild(this.node,"容器/提现/提现选项/银行/input").getComponent(cc.EditBox).string = button.node.name;
            }
        }
        else if(button.node.name === "全部提现")
        {
            let strGold = Tool.GetChild(this.node,"容器/提现/余额/num").getComponent(cc.Label).string;
            Tool.GetChild(this.node,"容器/提现/提现选项/金额/input").getComponent(cc.EditBox).string = strGold;
            Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额/input").getComponent(cc.EditBox).string = strGold;

            //计算
            let editRMB = Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额/input").getComponent(cc.EditBox)
            let editUSDT = Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量/input").getComponent(cc.EditBox)
            let nHuilv = this.GetUSDTRate()
            if(nHuilv === 0) return;
            //实时更新usdt数据
            if(editRMB.string != "")
            {
                let nRmb = Number(editRMB.string)
                editUSDT.string = (nRmb/nHuilv).toFixed(3).toString()
            }
        }
        else if(button.node.name === "申请提现")
        {
            if(!this.withdrawEnabled[this.selectedWithdrawType])
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"当前提现方式未开启，请重新进入提现页面");
                return;
            }
            let inMoney = null
            if(Tool.GetChild(this.node,"容器/提现/类型选择/USDT提现").getComponent(cc.Toggle).isChecked)
            {
                inMoney = Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额/input").getComponent(cc.EditBox);
            }
            else
            {
                inMoney = Tool.GetChild(this.node,"容器/提现/提现选项/金额/input").getComponent(cc.EditBox);
            }



            
            if(inMoney.node.parent.active && inMoney.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额不能为空！");
                return;
            }
            if(inMoney.node.parent.active && Number(inMoney.string)<=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"提现金额必须大于0");
                return;
            }

            let inName = Tool.GetChild(this.node,"容器/提现/提现选项/姓名/input").getComponent(cc.EditBox);
            if(inName.node.parent.active && inName.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"姓名不能为空！");
                return;
            }

            if(inName.node.parent.active && !Tool.IsAllChinese(inName.string))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"姓名必须为中文!");
                return;   
            }

            let inPass = Tool.GetChild(this.node,"容器/提现/提现选项/密码/input").getComponent(cc.EditBox);
            if(inPass.node.parent.active && inPass.string == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码不能为空！");
                return;
            }

            // let inYLinfo = Tool.GetChild(this.node,"容器/提现/提现选项/预留信息/input").getComponent(cc.EditBox);
            // if(inYLinfo.string == "")
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入预留信息！");
            //     return;
            // }

            // if(inYLinfo.string != this.strYLInfo)
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"预留信息校验错误，操作失败!");
            //     return;
            // }

            //获取当前提现类型
            let nVipTX = 0
            if(Tool.GetChild(this.node,"容器/提现/提现速度/普通会员").getComponent(cc.Toggle).isChecked)
            {
                nVipTX = 0
            }
            else
            {
                nVipTX = 1
            }



            let inZZB = Tool.GetChild(this.node,"容器/提现/提现选项/支付宝/input").getComponent(cc.EditBox);
            let inBank = Tool.GetChild(this.node,"容器/提现/提现选项/银行/input").getComponent(cc.EditBox);
            let inSubBank = Tool.GetChild(this.node,"容器/提现/提现选项/支行/input").getComponent(cc.EditBox);
            let inCard = Tool.GetChild(this.node,"容器/提现/提现选项/卡号/input").getComponent(cc.EditBox);
            let inTRC20 = Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址/input").getComponent(cc.EditBox);

            if(Tool.GetChild(this.node,"容器/提现/类型选择/支付宝提现").getComponent(cc.Toggle).isChecked)
            {                
                if(inZZB.node.parent.active && inZZB.string == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付宝不能为空！");
                    return;
                }

                let strParam = "{\"header\":\"申请_玩家_提现\",\"money\":\"" + inMoney.string + "\",\"remark\":\"支付宝," + inName.string + "," + inZZB.string+","+nVipTX + "\",\"pwd\":\"" + inPass.string + "\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@申请_玩家_提现"+nVipTX);
    
                let strMsg = inMoney.string+"#"+inName.string+"#"+inBank.string+"#"+inSubBank.string+"#"+inZZB.string+"#"+inCard.string;
                ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+"_提现预留_支付宝",strMsg);
            }
            else if(Tool.GetChild(this.node,"容器/提现/类型选择/USDT提现").getComponent(cc.Toggle).isChecked)
            {
                
                if(inTRC20.node.parent.active && inTRC20.string == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"TRC20地址不能为空!");
                    return;
                }

                let strParam = "{\"header\":\"申请_玩家_提现\",\"money\":\"" + inMoney.string+ "\",\"remark\":\"USDT," + inTRC20.string+ "\",\"pwd\":\"" + inPass.string + "\",\"client_version\":\"2022032201\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@申请_玩家_提现"+nVipTX);

                let strMsg = inMoney.string+"#"+inName.string+"#"+inBank.string+"#"+inSubBank.string+"#"+inZZB.string+"#"+inCard.string+"#"+inTRC20.string;
                ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+"_提现预留_USDT",strMsg);
            }
            else
            {                
                if(inBank.node.parent.active && inBank.string == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"银行不能为空！");
                    return;
                }
                
                if(inSubBank.node.parent.active && inSubBank.string == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支行不能为空！");
                    return;
                }
                
                if(inCard.node.parent.active && inCard.string == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"卡号不能为空！");
                    return;
                }

                let strParam = "{\"header\":\"申请_玩家_提现\",\"money\":\"" + inMoney.string+ "\",\"remark\":\"银联," + inName.string+","+inBank.string+","+inCard.string + ","+ inSubBank.string+","+nVipTX + "\",\"pwd\":\"" + inPass.string + "\",\"client_version\":\"2022032201\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@申请_玩家_提现"+nVipTX);

                let strMsg = inMoney.string+"#"+inName.string+"#"+inBank.string+"#"+inSubBank.string+"#"+inZZB.string+"#"+inCard.string;
                ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+"_提现预留_银联",strMsg);
            }
        }
        else if(button.node.name == "提交实名信息")
        {
            let strName = Tool.GetChild(this.node,"实名/信息/姓名/input").getComponent(cc.EditBox).string
            let strBank = Tool.GetChild(this.node,"实名/信息/银行/input").getComponent(cc.EditBox).string
            let strCard = Tool.GetChild(this.node,"实名/信息/卡号/input").getComponent(cc.EditBox).string

            let strPwd1 = Tool.GetChild(this.node,"实名/信息/交易密码/input").getComponent(cc.EditBox).string
            let strPwd2 = Tool.GetChild(this.node,"实名/信息/确认密码/input").getComponent(cc.EditBox).string

            if(strName == "" || !Tool.IsAllChinese(strName))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请正确输入姓名！");
                return;
            }
            if(strBank == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择银行");
                return;
            }
            if(strCard.length<6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的银行卡号");
                return;
            }



            //设置密码
            if(this.bNeedInitJYPwd)
            {
                if(strPwd1 == "" || strPwd2 == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入交易密码");
                    return;
                }
                if(strPwd1 !=  strPwd2)
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次输入密码不一致");
                    return;
                }
                let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\"\",\"new_pwd\":\"" + strPwd1 + "\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");
            }

            let strMsg = "#"+strName+"#"+strBank+"###"+strCard;
            delete this.withdrawInfoRequests["银联"];
            this.realnamePasswordCheckPending = false;
            ConfigManager.getInstance().SetOneHashKey(GameDataManager.getAccount().guuid+"_提现预留_银联",strMsg);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"提交成功!");
            Tool.GetChild(this.node,"实名").active = false
            this.strUserName = strName


        }
        else if(button.node.name == "充值提示按钮")
        {
            KBEngine.Event.fire("openGG8");
        }
        else if(button.node.name == "刷新订单")
        {
            Tool.HTTP_GET("http://"+WEB_TX_IP+"/api/JsonPay/getLastOrder?uuid="+GameDataManager.getAccount().guuid,(ret)=>{
                if(ret.status == 200)
                {
                    let jRet = JSON.parse(ret.response)
                    Debug.Log(jRet)
                    let arrayToggle = Tool.GetChild(this.node,"容器/充值/根/金额").getComponentsInChildren(cc.Toggle);
                    
                    let data = jRet["data"]
                    if(data["HAS_ORDER"]) //有订单，则不允许拉起新订单
                    {
                        for(let i=0;i<arrayToggle.length;i++)
                        {
                            arrayToggle[i].interactable = false
                        }
                        //显示最近订单按钮
                        Tool.GetChild(this.node,"容器/充值/根/进入未完成订单").active = true
                        this.dataHisDD = data
                        this.showHisDD(this.dataHisDD)
                    }
                    else
                    {
                        for(let i=0;i<arrayToggle.length;i++)
                        {
                            arrayToggle[i].interactable = true
                        }
                        Tool.GetChild(this.node,"容器/充值/根/进入未完成订单").active = false
                        this.dataHisDD = null
                    }
                }
            },(err)=>{
                // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付网络异常！")
            })
        }
        else if(button.node.name == "复制")
        {
            let strTxt = Tool.GetChild(button.node.parent,"txt").getComponent(cc.Label).string
            Debug.Log("复制:"+strTxt)
            MobileManager.getInstance().CopyToPhone(strTxt)
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"复制成功！")
        }
        else if(button.node.name == "粘贴")
        {
            MobileManager.getInstance().GetPasteData()
        }
    }
    public onToggleClick(toggle:cc.Toggle)
    {
        if(this.updatingWalletSelection)
            return;
        // An amount may be switched off by another selection or by a repeat
        // click. Its color must update for both directions, including none.
        if(toggle.node.parent.name === "金额")
        {
            this.SyncRechargeAmountSelection();
            return;
        }
        if(!toggle.isChecked)
            return;
        if(toggle.node.name === "充值")
        {
            this.selectedPaymentChannelName = "";
            this.strCurZhifuConfig = "";
            this.ResetRechargeAmountSelection();
            Tool.GetChild(this.node,"容器/充值/根").active = false;
            this.SwitchTab(toggle.node.name);

            Tool.GetChild(this.node,"容器/充值/充值信息").active = false;

            //查询支付列表
            ConfigManager.getInstance().GetOneHashKey("支付5_手数","支付5_手数");
            ConfigManager.getInstance().GetOneHashKey("支付管理","支付管理");
            ConfigManager.getInstance().GetOneHashKey("支付域名","存储支付域名");
            
        }
        else if(toggle.node.name === "提现")
        {
            this.SwitchTab(toggle.node.name);
            this.strCurZhifuConfig = "";
            ConfigManager.getInstance().GetOneHashKey("支付域名","存储支付域名");            
            ConfigManager.getInstance().GetOneHashKey("提现文本_支付宝","提现文本_支付宝");
            ConfigManager.getInstance().GetOneHashKey("提现文本_USDT","提现文本_USDT");
            ConfigManager.getInstance().GetOneHashKey("提现文本_银联","提现文本_银联");
            ConfigManager.getInstance().GetOneHashKey("支付配置_提现","更新提现银行");
            this.RequestWithdrawOptions();

            ConfigManager.getInstance().GetOneHashKey("预留信息_"+GameDataManager.getAccount().guuid,"预留信息");


        }
        else if(toggle.node.name === "记录")
        {
            this.SwitchTab(toggle.node.name);
            this.GetJiaoYiInfo();
        }
        else if(toggle.node.parent.name === "充值渠道")
        {
            if(!this.updatingPaymentChannels && toggle.isChecked && toggle.node.active)
            {
                //批量初始化结束后和实际点击共用此入口，先清空旧配置再查询。
                this.selectedPaymentChannelName = toggle.node.name;
                this.strCurZhifuConfig = "";
                this.ResetRechargeAmountSelection();
                this.SyncPaymentChannelCheckMarks();
                ConfigManager.getInstance().GetOneHashKey("支付配置_"+toggle.node.name,"更新支付配置");
               // Tool.GetChild(this.node,"容器/充值/根/自行输入").active = false;
               // Tool.GetChild(this.node,"容器/充值/根/自行输入/input").getComponent(cc.EditBox).string = "";
                if(toggle.node.name == "VIP充值" || toggle.node.name == "VIP充值2")
                {
                    Tool.GetChild(this.node,"容器/充值/根/金额").active = false;
                    // Tool.GetChild(this.node,"容器/充值/根/金额输入").active = false;
                    // Tool.GetChild(this.node,"容器/充值/根/姓名输入").active = false;
                }
                else if(toggle.node.name === "自助充值")
                {
                    Tool.GetChild(this.node,"容器/充值/根/金额").active = false;
                    // Tool.GetChild(this.node,"容器/充值/根/金额输入").active = true;
                    // Tool.GetChild(this.node,"容器/充值/根/姓名输入").active = true;
                    ConfigManager.getInstance().GetOneHashKey(GameDataManager.getAccount().guuid+"_支付预留_"+toggle.node.name,"自助充值信息");
                }
                else
                {
                    Tool.GetChild(this.node,"容器/充值/根/金额").active = true;
                    // Tool.GetChild(this.node,"容器/充值/根/金额输入").active = false;
                    // Tool.GetChild(this.node,"容器/充值/根/姓名输入").active = false;
                }
            }
        }
        else if(toggle.node.name === "支付宝提现")
        {
            if(!this.withdrawEnabled["支付宝"]) return;
            this.selectedWithdrawType = "支付宝";
            this.ResetTxInfo();
            Tool.GetChild(this.node,"容器/提现/提现选项/金额").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/姓名").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/银行").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/支行").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/支付宝").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/卡号").active = false;

            Tool.GetChild(this.node,"容器/提现/提现选项/汇率").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址").active = false;

            Tool.GetChild(this.node,"容器/提现/提现选项/提现文本").getComponent(cc.Label).string = this.strZhifubTxt;
            this.RefreshWithdrawBankRows();

            //获取配置            
            this.RequestWithdrawInfo("支付宝");
        }
        else if(toggle.node.name === "银行卡提现")
        {
            if(!this.withdrawEnabled["银联"]) return;
            this.selectedWithdrawType = "银联";
            this.ResetTxInfo();
            Tool.GetChild(this.node,"容器/提现/提现选项/金额").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/姓名").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/银行").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/支行").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/支付宝").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/卡号").active = true;


            Tool.GetChild(this.node,"容器/提现/提现选项/汇率").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址").active = false;


            Tool.GetChild(this.node,"容器/提现/提现选项/提现文本").getComponent(cc.Label).string = this.strYinlianTxt;
            this.RefreshWithdrawBankRows();

            ConfigManager.getInstance().GetOneHashKey("提现需要支行","提现需要支行");            
            this.RequestWithdrawInfo("银联");
        }
        else if(toggle.node.name == "USDT提现")
        {
            if(!this.withdrawEnabled["USDT"]) return;
            this.selectedWithdrawType = "USDT";
            this.ResetTxInfo();
            Tool.GetChild(this.node,"容器/提现/提现选项/金额").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/姓名").active = false;

            Tool.GetChild(this.node,"容器/提现/提现选项/银行").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/支行").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/支付宝").active = false;
            Tool.GetChild(this.node,"容器/提现/提现选项/卡号").active = false;


            Tool.GetChild(this.node,"容器/提现/提现选项/汇率").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量").active = true;
            Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址").active = true;

            Tool.GetChild(this.node,"容器/提现/提现选项/提现文本").getComponent(cc.Label).string = this.strUSDTTxt;
            this.RefreshWithdrawBankRows();
            this.RequestWithdrawInfo("USDT");
        }
    }

    public ResetTxInfo()
    {
        Tool.GetChild(this.node,"容器/提现/提现选项/金额/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/姓名/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/密码/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/支付宝/input").getComponent(cc.EditBox).string = "";  
        Tool.GetChild(this.node,"容器/提现/提现选项/银行/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/支行/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/卡号/input").getComponent(cc.EditBox).string = "";

        Tool.GetChild(this.node,"容器/提现/提现选项/RMB金额/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/USDT数量/input").getComponent(cc.EditBox).string = "";
        Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址/input").getComponent(cc.EditBox).string = "";
    }
    public SwitchTab(strName:string)
    {
        if(strName !== "提现")
            this.withdrawOptionsContext = "";
        if(strName !== "充值")
            this.selectedPaymentChannelName = "";
        let arrayTemp = this.node.getChildByName("容器").children;
        arrayTemp.forEach((item,idx,array)=>{
            if(item.name == strName)
            {
                item.active = true;                               
            }
            else
            {
                item.active = false;
            }
        });

        //复位Toggle
        let arrayToggle = this.node.getChildByName("选项").getComponentsInChildren(cc.Toggle);
        arrayToggle.forEach((item,idx,array)=>{
            if(item.node.name === strName)
            {
                if(!item.isChecked)
                {
                    item.isChecked = true;
                }
            }
            else
            {
                if(item.isChecked)
                {
                    item.isChecked = false;
                }
            }
        });
    }
    public OnUserHashError(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHashInfo"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];
        if(context.indexOf(this.withdrawOptionsContextPrefix) === 0)
            this.ReceiveWithdrawOption(strKey,context,"",true);
        else if(context.indexOf(this.paymentIconContextPrefix) === 0)
        {
            let channelName = context.substring(this.paymentIconContextPrefix.length);
            this.ApplyPaymentChannelIcon(channelName, "default");
        }
        else if(context.indexOf(this.withdrawInfoContextPrefix) === 0)
        {
            const type = this.TakeWithdrawInfoReply(strKey,context,true);
            if(type === "银联")
                this.ShowMissingRealname();
            else if(type === "支付宝" && this.selectedWithdrawType === type &&
                Tool.GetChild(this.node,"容器/提现").activeInHierarchy)
                Tool.GetChild(this.node,"容器/提现/提现选项/姓名/input").getComponent(cc.EditBox).string = this.strUserName;
        }
    }
    public OnUserHashInfo(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHashInfo"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];
        if(context === "支付管理")
        {
            //特殊处理支付5 手数不够隐藏
            if(strContent.indexOf("支付5")>=0)
            {
                
                let strParam:string = GameDataManager.getAccount().remark;
                if (strParam == "")
                    strParam = "0,0,0,0,0,0,0";
                let arrayParam = strParam.split(',');
                let nWin = Number(arrayParam[0]);
                let nLose = Number(arrayParam[1]);
                let nHe = Number(arrayParam[2]);
                let nRu = Number(arrayParam[6]); //入池次数
    
                let nTotle = nWin + nLose + nHe;
                if(nTotle<this.nZhifu5HandCount)
                {
                    strContent = strContent.replace("支付5","---")
                }
            }


            //先完成可用通道和默认状态，再启用容器，避免 ToggleContainer
            //在首次 onEnable 时选中 Prefab 中暂时隐藏的通道。
            if(!this.node.activeInHierarchy || !Tool.GetChild(this.node,"容器/充值").active)
                return;
            let rechargeRoot = Tool.GetChild(this.node,"容器/充值/根");
            let channelRoot = Tool.GetChild(rechargeRoot,"通道视口/充值渠道");
            let arrayToggle = channelRoot.getComponentsInChildren(cc.Toggle);
            let container = channelRoot.getComponent(cc.ToggleContainer);
            let allowSwitchOff = container == null ? false : container.allowSwitchOff;
            let arrayMsg = strContent.split("#");
            let defaultToggle:cc.Toggle = null;
            this.updatingPaymentChannels = true;
            this.selectedPaymentChannelName = "";
            this.strCurZhifuConfig = "";
            rechargeRoot.active = false;
            if(container != null)
                container.allowSwitchOff = true;
            for(let item of arrayToggle)
            {
                this.ApplyPaymentChannelIcon(item.node.name, "default");
                item.isChecked = false;
                item.node.active = arrayMsg.indexOf(item.node.name) >= 0;
                if(item.node.active)
                {
                    if(defaultToggle == null)
                        defaultToggle = item;
                    ConfigManager.getInstance().GetOneHashKey("支付配置_"+item.node.name,this.paymentIconContextPrefix+item.node.name);
                }
            }
            if(defaultToggle != null)
                defaultToggle.isChecked = true;
            if(container != null)
                container.allowSwitchOff = allowSwitchOff;
            rechargeRoot.active = defaultToggle != null;
            this.SyncPaymentChannelCheckMarks();
            this.updatingPaymentChannels = false;
            //isChecked 在迁移开关或值未变化时未必发出事件，显式加载一次。
            if(defaultToggle != null)
            {
                this.onToggleClick(defaultToggle);
                this.RefreshRechargeChannelLayout();
            }

        }
        else if(context.indexOf(this.paymentIconContextPrefix) === 0)
        {
            let channelName = context.substring(this.paymentIconContextPrefix.length);
            try
            {
                let iconConfig = JSON.parse(Tool.Base64Decode(strContent));
                this.ApplyPaymentChannelIcon(channelName, iconConfig == null ? "default" : iconConfig["icon"]);
            }
            catch(error)
            {
                Debug.Log("支付通道图标配置解析失败:"+channelName);
                this.ApplyPaymentChannelIcon(channelName, "default");
            }
        }
        else if(context === "更新支付配置")
        {
            let channelName = strKey.indexOf("支付配置_") === 0 ? strKey.substring("支付配置_".length) : "";
            //快速切换通道或离开充值页后，旧回包不能覆盖当前通道的金额和配置。
            if(channelName === "" || channelName !== this.selectedPaymentChannelName ||
                !this.node.activeInHierarchy || !Tool.GetChild(this.node,"容器/充值").active)
                return;
            let data = JSON.parse(Tool.Base64Decode(strContent));
            if(data == null)
                return;
            if(channelName != "")
                this.ApplyPaymentChannelIcon(channelName, data["icon"]);
            this.strCurZhifuConfig = Tool.Base64Decode(strContent);

            if(data["money"] != "")
            {
                let arrayAll = data["money"].split(",");
                //更新金额列表
                let arrayToggle = Tool.GetChild(this.node,"容器/充值/根/金额").getComponentsInChildren(cc.Toggle);
                for(let i=0;i<arrayToggle.length;i++)
                {
                    let one = arrayToggle[i];
        
                    one.isChecked = false;
                    one.node.active = i < arrayAll.length && arrayAll[i].trim() !== "";
                    if(!one.node.active)
                        continue;
        
                    one.node.name = arrayAll[i] + "元";
                    one.node.getChildByName("txt").getComponent(cc.Label).string = one.node.name;
                }
            }
            this.ResetRechargeAmountSelection();
            //更新通知
            // 未配置通道说明时保留页面默认提示，避免空回包把提示框清空。
            let notice = data["notify"];
            let hasNotice = typeof notice === "string" && notice.trim() !== "";
            let defaultNotice = Tool.GetChild(this.node,"容器/充值/根").getChildByName("V8默认充值提示");
            if(defaultNotice != null)
                defaultNotice.active = !hasNotice;
            Tool.GetChild(this.node,"容器/充值/根/充值提示").getComponent(cc.Label).string =
                hasNotice ? notice : (defaultNotice == null ? this.defaultRechargeNotice : "");
            //自行输入
            //Tool.GetChild(this.node,"容器/充值/根/自行输入").active = data["bOpenInput"];
            //Tool.GetChild(this.node,"容器/充值/根/自行输入/inputrange").getComponent(cc.Label).string = data["inputrange"];

        }
        else if(context === "存储支付域名")
        {
            cc.sys.localStorage.setItem("支付域名",strContent);
        }
        else if(context === "更新支付预留")
        {
            let arrayInfo = strContent.split("#");
            Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/银行/input").getComponent(cc.EditBox).string = arrayInfo[0];
            Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/姓名/input").getComponent(cc.EditBox).string = arrayInfo[1];
            Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/卡号/input").getComponent(cc.EditBox).string = arrayInfo[2];
            Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/手机/input").getComponent(cc.EditBox).string = arrayInfo[3];
            Tool.GetChild(this.node,"容器/充值/充值信息/bk/list/身份证/input").getComponent(cc.EditBox).string = arrayInfo[4];
        }
        else if(context === "自助充值信息")
        {
            Tool.GetChild(this.node,"容器/充值/根/姓名输入/input").getComponent(cc.EditBox).string = strContent;
        }
        else if(context === "提现需要支行")
        {
            const bankSelected = Tool.GetChild(this.node,"容器/提现/类型选择/银行卡提现").getComponent(cc.Toggle).isChecked;
            Tool.GetChild(this.node,"容器/提现/提现选项/支行").active = bankSelected && strContent=="true";
            this.RefreshWithdrawBankRows();
        }
        else if(context === "提现文本_支付宝")
        {
            this.strZhifubTxt = strContent && strContent.trim() ? strContent : this.defaultWithdrawNotice;
        }
        else if(context === "提现文本_银联")
        {
            this.strYinlianTxt = strContent && strContent.trim() ? strContent : this.defaultWithdrawNotice;
            if(Tool.GetChild(this.node,"容器/提现/类型选择/银行卡提现").getComponent(cc.Toggle).isChecked)
            {
                Tool.GetChild(this.node,"容器/提现/提现选项/提现文本").getComponent(cc.Label).string = this.strYinlianTxt;
            }
        }
        else if(context === "提现文本_USDT")
        {
            this.strUSDTTxt = strContent && strContent.trim() ? strContent : this.defaultWithdrawNotice;
        }
        else if(context === "更新提现银行")
        {
            this.strCurZhifuConfig = Tool.Base64Decode(strContent);
            // if(Tool.GetChild(this.node,"容器/提现/类型选择/支付宝提现").getComponent(cc.Toggle).isChecked)
            // {
            //     Tool.GetChild(this.node,"容器/提现/提现选项/提现文本").getComponent(cc.Label).string = this.strCurZhifuConfig;
            // }
        }
        else if(context.indexOf(this.withdrawInfoContextPrefix) === 0)
        {
            const type = this.TakeWithdrawInfoReply(strKey,context);
            if(type != null)
                this.ApplyWithdrawInfo(type,strContent);
        }
        else if(context.indexOf(this.withdrawOptionsContextPrefix) === 0)
            this.ReceiveWithdrawOption(strKey,context,strContent,false);
        else if(context == "预留信息")
        {
            this.strYLInfo = Tool.Base64Decode(strContent);
            Debug.Log("收到预留:"+this.strYLInfo);
        }
        else if(context == "实名文本")
        {
            Tool.GetChild(this.node,"实名/信息/实名文本").getComponent(cc.Label).string = strContent
        }
        else if(context == "支付5_手数")
        {
            this.nZhifu5HandCount = Number(strContent)
        }
    }

    private ResetRechargeAmountSelection():void
    {
        const previous = this.updatingWalletSelection;
        this.updatingWalletSelection = true;
        try
        {
            const amounts = Tool.GetChild(this.node,"容器/充值/根/金额");
            for(const item of amounts.getComponentsInChildren(cc.Toggle))
                item.isChecked = false;
        }
        finally { this.updatingWalletSelection = previous; }
        this.SyncRechargeAmountSelection();
    }

    private SyncRechargeAmountSelection():void
    {
        const amounts = Tool.GetChild(this.node,"容器/充值/根/金额");
        for(const item of amounts.getComponentsInChildren(cc.Toggle))
        {
            const checked = item.node.active && item.isChecked;
            const label = item.node.getChildByName("txt");
            if(label != null)
                label.color = checked ? new cc.Color(4,34,57,255) : new cc.Color(255,237,202,255);
            if(item.checkMark != null)
                item.checkMark.node.active = checked;
        }
    }

    private SyncPaymentChannelCheckMarks()
    {
        let channelRoot = Tool.GetChild(this.node,"容器/充值/根/通道视口/充值渠道");
        for(let item of channelRoot.getComponentsInChildren(cc.Toggle))
        {
            //只同步交互状态；图案、尺寸和层级由正式 Prefab 决定。
            if(item.checkMark != null)
                item.checkMark.node.active = item.node.active && item.isChecked;
        }
    }

    private CapturePaymentChannelDefaultIcons()
    {
        let channelRoot = Tool.GetChild(this.node,"容器/充值/根/通道视口/充值渠道");
        if(channelRoot == null)
            return;
        for(let channelNode of channelRoot.children)
        {
            let background = channelNode.getChildByName("Background");
            let sprite = background == null ? null : background.getComponent(cc.Sprite);
            if(sprite != null && sprite.spriteFrame != null)
                this.paymentDefaultIconFrames[channelNode.name] = sprite.spriteFrame;
        }
    }

    private ApplyPaymentChannelIcon(channelName:string, iconType:any)
    {
        let channelRoot = Tool.GetChild(this.node,"容器/充值/根/通道视口/充值渠道");
        let channelNode = channelRoot == null ? null : channelRoot.getChildByName(channelName);
        let background = channelNode == null ? null : channelNode.getChildByName("Background");
        let sprite = background == null ? null : background.getComponent(cc.Sprite);
        if(sprite == null)
            return;

        let normalized = typeof iconType === "string" ? iconType.toLowerCase() : "default";
        let target:cc.SpriteFrame = null;
        if(normalized === "alipay")
            target = this.paymentAlipayIcon;
        else if(normalized === "unionpay")
            target = this.paymentUnionPayIcon;
        else if(normalized === "wechat")
            target = this.paymentWeChatIcon;
        else if(normalized === "other")
            target = this.paymentOtherIcon;
        else
            target = this.paymentDefaultIconFrames[channelName];

        if(target == null)
            target = this.paymentDefaultIconFrames[channelName];
        if(target != null)
            sprite.spriteFrame = target;
    }
    public UpdateBankList()
    {
        let content = Tool.GetChild(this.node,"选择银行/bk/列表").getComponent(ScrollViewEx).content;
        if(this.strCurZhifuConfig == "")
        {
            content.removeAllChildren();
            return;
        }
        let data = JSON.parse(this.strCurZhifuConfig);
        if(data == null)
            return;
        let strContent:string = data["bank"];
        if(strContent.lastIndexOf("#") == strContent.length-1)
        {
            strContent = strContent.substring(0,strContent.length-1);
            Debug.Log(strContent);
        }
        let arrayAll = strContent.split("#");

        
        for(let i=0;i<arrayAll.length;i++)
        {
            let one = arrayAll[i];               

            if(i>=content.childrenCount)
            {
                WebLoadingManager.loadBlockingRes("Prefabs/银行对象","正在加载银行记录",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        return null;
                    }
                    let add = cc.instantiate(obj);
                    add.parent = content;
                    add.name = one;
                    add.getChildByName("txt").getComponent(cc.Label).string = one;
                    let btn = add.getComponent(cc.Button);
                    btn.node.targetOff(this);
                    btn.node.on("click",()=>{
                        this.onButtonClick(btn);
                    },this);
                });
            }
            else
            {
                content.children[i].name = one;
                content.children[i].getChildByName("txt").getComponent(cc.Label).string = one;      
                let btn = content.children[i].getComponent(cc.Button);
                btn.node.targetOff(this);
                btn.node.on("click",()=>{
                    this.onButtonClick(btn);
                },this);          
            }
        }
        //多余的对象全部删除
        let arrayDel = new Array<cc.Node>();
        for(let i=arrayAll.length;i<content.childrenCount;i++)
        {
            arrayDel.push(content.children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }
    }

    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("申请_玩家_提现")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！");  
                let msg = JSON.parse(param);
                let data = msg["result"];

                let strMoney = data["money"];
                let order = data["work_order"];
                let strVip = "0"
                if(param.indexOf("1")>=0)
                {
                    strVip = "1"
                }
                else
                {
                    strVip = "0"
                }
                this.NotifyServer(GameDataManager.getAccount().guuid,strMoney,order,strVip);
                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("校验_玩家_交易密码")>=0)
        {
            if(!this.realnamePasswordCheckPending || !this.node.activeInHierarchy ||
                !Tool.GetChild(this.node,"实名").active)
                return;
            this.realnamePasswordCheckPending = false;
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
               
                this.bNeedInitJYPwd = true

                Tool.GetChild(this.node,"实名/信息/交易密码").active = true
                Tool.GetChild(this.node,"实名/信息/确认密码").active = true
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.bNeedInitJYPwd = false

                Tool.GetChild(this.node,"实名/信息/交易密码").active = false
                Tool.GetChild(this.node,"实名/信息/确认密码").active = false
            }
        }
    }
    public NotifyServer(strUserID:string,strAmount:string,strWorder:string,strVip:string="0")
    {
        //获取网络配置文件
        let web = new XMLHttpRequest();
        web.onreadystatechange = (event)=>{
            if (web.readyState == 4 && (web.status >= 200 && web.status < 400)) {
                
            }
            else
            {

            }          
            Debug.Log(event);
        };
        web.onerror = (event1:ProgressEvent<EventTarget>)=>{
            console.log(event1);
              
        };
        web.ontimeout = (event)=>{
            console.log(event);
        };
        let random = new Date().getTime();
        //let strUrl = "http://" + WEB_TX_IP+ "/api/pay/autoPay?uuid="+strUserID+"&amount="+strAmount+"&worder="+strWorder+"&vip="+strVip+"&v=" + random; 
        let strUrl = "http://" + WEB_TX_IP+ "/api/vip?id="+strWorder
        console.log(strUrl);
        web.open("GET",strUrl);
        web.send();
    }
    public GetJiaoYiInfo(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_玩家_交易记录\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_交易记录");
    }
    public OnListPlayerExchangeInfo(strMsg:string)
    {
        this.scrollExchange.UpdateList(strMsg,"ListPlayerExchangeInfo","交易查询对象",this.PAGE_PER_COUNT,this.setExchangeItem.bind(this));
    }
    public setExchangeItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        let strType = jItem["work_type"] == null ? "" : jItem["work_type"].toString();
        let strMoney = jItem["money"] == null ? "" : jItem["money"].toString();
        let strDate = jItem["date"] == null ? "" : jItem["date"].toString();
        let bWithdraw = strType.indexOf("提现") >= 0 || Number(strMoney) < 0;

        node.getChildByName("type").getComponent(cc.Label).string = strType;
        node.getChildByName("count").getComponent(cc.Label).string = strMoney;
        node.getChildByName("time").getComponent(cc.Label).string = this.FormatWalletRecordTime(strDate);
        //node.getChildByName("状态").getComponent(cc.Label).string = jItem["status"];
        node.getChildByName("id").getComponent(cc.Label).string = jItem["work_order"];
        if(jItem.hasOwnProperty("remark1"))
        {
            node.getChildByName("txt").getComponent(cc.Label).string = jItem["remark1"];
        }
        
        let strState = jItem["status"] == null ? "" : jItem["status"].toString();
        // let img = node.getChildByName("状态").getComponent(cc.Sprite);
        // Tool.LoadImg(img,"other/"+strState);
        let stateLabel = node.getChildByName("状态文字").getComponent(cc.Label);
        stateLabel.string = strState;
        let finished = strState.indexOf("完成") >= 0 && strState.indexOf("未") < 0;
        let pending = strState.indexOf("审核") >= 0 || strState.indexOf("处理") >= 0;
        stateLabel.node.color = finished ? new cc.Color(151,211,57,255) :
                                pending ? new cc.Color(75,220,222,255) :
                                          new cc.Color(231,197,145,255);
        node.getChildByName("count").color = bWithdraw ?
            new cc.Color(255,92,80,255) : new cc.Color(151,211,57,255);

        let iconIn = node.getChildByName("V7充值图标");
        let iconOut = node.getChildByName("V7提现图标");
        if(iconIn != null)
            iconIn.active = !bWithdraw;
        if(iconOut != null)
            iconOut.active = bWithdraw;
    }

    private FormatWalletRecordTime(value:string):string
    {
        // 服务端常见格式为 yyyy-MM-dd HH:mm:ss；仅压缩显示，不改变原值。
        let match = value.match(/^(\d{4})[-\/]([0-9]{2})[-\/]([0-9]{2})[ T]([0-9]{2}):([0-9]{2})/);
        if(match != null)
            return match[2]+"/"+match[3]+" "+match[4]+":"+match[5];
        return value;
    }


    //显示订单
    public showHisDD(data:any)
    {
        Tool.GetChild(this.node,"订单详情").active = true
        Tool.GetChild(this.node,"订单详情/信息/订单编号/txt").getComponent(cc.Label).string = data["ORDER_ID"]
        Tool.GetChild(this.node,"订单详情/信息/姓名/txt").getComponent(cc.Label).string = data["READY_JSON"]["holder"]
        Tool.GetChild(this.node,"订单详情/信息/银行名称/txt").getComponent(cc.Label).string = data["READY_JSON"]["bank"]
        Tool.GetChild(this.node,"订单详情/信息/银行卡号/txt").getComponent(cc.Label).string = data["READY_JSON"]["account"]
        Tool.GetChild(this.node,"订单详情/信息/充值金额/txt").getComponent(cc.Label).string = data["READY_JSON"]["amount"]
        Tool.GetChild(this.node,"订单详情/信息/结果/txt").getComponent(cc.Label).string = data["READY_JSON"]["msg"]

        //更新倒计时
        let strCreateTime = data["READY_TIME"]
        let nCreate = Tool.getDateFromString(strCreateTime).getTime()
        let timeNow = new Date().getTime();
        this.nTotleSecLeftDD = 600-(timeNow-nCreate)/1000


        //启动定时器刷新
        this.unschedule(this.callbackUpdateTime)
        this.schedule(this.callbackUpdateTime,1,cc.macro.REPEAT_FOREVER,0.1)
    }
    public callbackUpdateTime()
    {
        let strSpan =  Math.trunc((this.nTotleSecLeftDD/60/60))+":"+Math.trunc((this.nTotleSecLeftDD/60%60))+":"+Math.trunc((this.nTotleSecLeftDD%60))
        //Debug.Log("span:"+strSpan)
        
        Tool.GetChild(this.node,"订单详情/信息/info/time").getComponent(cc.Label).string = strSpan
        this.nTotleSecLeftDD--
        if(this.nTotleSecLeftDD<0)
        this.nTotleSecLeftDD = 0
    }

    //来自剪切板的数据
    public onPasteData(strMsg:string)
    {
        Debug.Log("收到粘贴数据："+strMsg)
        Tool.GetChild(this.node,"容器/提现/提现选项/TRC20地址/input").getComponent(cc.EditBox).string = strMsg
    }
}
