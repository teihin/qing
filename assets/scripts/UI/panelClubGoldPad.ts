import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import {ShowPanelMode, ClosePanelMode} from "../common/GameDef";

const KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/** 上分/下分共用的命令名；下分用负数金额表达。 */
const SUBMIT_HEADER = "添加_俱乐部_成员_积分";

/**
 * 玩家间赠送专用命令：从**自己账户的积分**里扣、给对方加，不动任何人的额度。
 * 「添加_俱乐部_成员_积分」是代理按额度上下分的口径，用它做赠送不会扣自己，不能混用。
 */
const GIFT_HEADER = "赠送_俱乐部_积分";

/** 私聊页的俱乐部上下分/赠送弹窗。金额单位沿用俱乐部积分接口的整数单位（元）。 */
@ccclass
export default class panelClubGoldPad extends UIPanelViewBase {
    private clubId:string = "";
    private userId:string = "";
    private userName:string = "";
    private amount:cc.EditBox = null;
    private password:cc.EditBox = null;
    /** 已发请求的金额，成功回包时用来拼系统消息。 */
    private submitAmount:number = 0;
    private pending:boolean = false;
    private requestContext:string = "";
    private action:"up"|"down"|"give"|"" = "";
    /** updown：上下分；give：赠送积分（代理没有可用额度时从自己积分里送）。 */
    private mode:"updown"|"give" = "updown";

    onLoad():void {
        super.onLoad();
        this.amount = this.EditBox("金额");
        this.password = this.EditBox("密码");
        KBEngine.Event.register("onHallCommand",this,"onHallCommand");
    }

    start():void {
        let data:any = null;
        try { data = JSON.parse(this.strUserData || "{}"); }
        catch(error) { data = null; }
        this.clubId = String(data && data.clubId || "").trim();
        this.userId = String(data && data.userId || "").trim();
        this.userName = String(data && data.userName || this.userId).trim();
        if(this.amount != null) {
            this.amount.string = "";
            this.amount.inputMode = cc.EditBox.InputMode.NUMERIC;
        }
        if(this.password != null) {
            this.password.string = "";
            this.password.inputMode = cc.EditBox.InputMode.NUMERIC;
        }
        const target = Tool.GetChild(this.node,"bk/目标");
        if(target != null) {
            const label = target.getComponent(cc.Label);
            if(label != null) label.string = this.userName;
        }
        this.mode = data && data.mode === "give" ? "give" : "updown";
        this.ApplyMode();
    }

    /** 赠送模式换一套标题与按钮：一个居中的「确认赠送」。 */
    private ApplyMode():void {
        const give = this.mode === "give";
        const normalTitle = Tool.GetChild(this.node,"bk/标题");
        const giveTitle = Tool.GetChild(this.node,"bk/标题-赠送");
        const up = Tool.GetChild(this.node,"bk/上分");
        const down = Tool.GetChild(this.node,"bk/下分");
        const confirm = Tool.GetChild(this.node,"bk/确认赠送");
        if(normalTitle != null) normalTitle.active = !give;
        if(giveTitle != null) giveTitle.active = give;
        if(up != null) up.active = !give;
        if(down != null) down.active = !give;
        if(confirm != null) confirm.active = give;
        const hint = Tool.GetChild(this.node,"bk/提示");
        if(hint != null) {
            const label = hint.getComponent(cc.Label);
            if(label != null)
                label.string = give ? "赠送消耗的是你自己的积分，请确认金额与交易密码" : "请选择金额，或直接输入整数";
        }
    }

    onDestroy():void {
        super.onDestroy();
    }

    public onButtonClick(button:cc.Button):void {
        const name = button == null || button.node == null ? "" : button.node.name;
        if(name === "关闭") {
            this.Close();
            return;
        }
        if(name.indexOf("金额_") === 0) {
            const value = name.substr("金额_".length);
            if(this.amount != null) this.amount.string = value;
            return;
        }
        if(name === "确认赠送") {
            this.Submit("give");
            return;
        }
        if(name === "上分") {
            this.Submit("up");
            return;
        }
        if(name === "下分") {
            this.Submit("down");
            return;
        }
        super.onButtonClick(button);
    }

    private Submit(action:"up"|"down"|"give"):void {
        if(this.pending)
            return;
        if(this.clubId === "" || this.userId === "") {
            this.Show("当前聊天对象信息已失效，请重新打开聊天");
            return;
        }
        const amountText = String(this.amount == null ? "" : this.amount.string || "").trim();
        if(!/^[1-9][0-9]*$/.test(amountText)) {
            this.Show("请输入大于 0 的整数金额");
            return;
        }
        const amount = Number(amountText);
        if(!Number.isSafeInteger(amount) || amount <= 0) {
            this.Show("金额超出可操作范围");
            return;
        }
        const pwd = String(this.password == null ? "" : this.password.string || "").trim();
        if(pwd === "") {
            this.Show("请输入交易密码");
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null || typeof account.reqHallCommand !== "function") {
            this.Show("游戏连接尚未就绪，请稍后再试");
            return;
        }
        this.ConfirmThenSubmit(action,amount,pwd);
    }

    /** 上分/下分是资金操作，先让用户确认目标、方向和金额，再发请求。 */
    private ConfirmThenSubmit(action:"up"|"down"|"give",amount:number,pwd:string):void {
        const verb = action === "up" ? "上分" : (action === "down" ? "下分" : "赠送");
        const target = this.userName !== "" ? this.userName : this.userId;
        const message = action === "give"
            ? "确认赠送给「" + target + "」" + amount + " 积分？这会从你自己的积分里扣"
            : "确认给「" + target + "」" + verb + " " + amount + " 积分？";
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,message,[(confirmed:boolean)=>{
            if(confirmed !== true)
                return;
            if(!cc.isValid(this.node) || this.pending)
                return;
            this.DoSubmit(action,amount,pwd);
        }]);
    }

    private DoSubmit(action:"up"|"down"|"give",amount:number,pwd:string):void {
        const account:any = GameDataManager.getAccount();
        if(account == null || typeof account.reqHallCommand !== "function") {
            this.Show("游戏连接尚未就绪，请稍后再试");
            return;
        }
        this.pending = true;
        this.action = action;
        this.submitAmount = amount;
        this.requestContext = "chatgold:" + action + ":" + this.clubId + ":" + this.userId + ":" + Date.now();
        // 上下分走「添加_俱乐部_成员_积分」（代理按额度发筹码），下分把金额取负；
        // 赠送必须走「赠送_俱乐部_积分」：它扣的是自己账户里的积分，不会给别人白送筹码。
        // 「修改_俱乐部_成员_积分」在服务端有问题，不要再用。
        const request:any = {
            header:action === "give" ? GIFT_HEADER : SUBMIT_HEADER,
            club_id:this.clubId,
            user_id:this.userId,
            user_pwd:pwd,
            user_add_gold:action === "down" ? -amount : amount,
            context:this.requestContext
        };
        try {
            account.reqHallCommand(JSON.stringify(request),"P@" + this.requestContext);
        }
        catch(error) {
            this.pending = false;
            this.action = "";
            this.Show("请求发送失败，请稍后重试");
        }
    }

    public onHallCommand(nCode:number,param:string):void {
        if(!this.pending || this.requestContext === "" || param == null)
            return;
        const text = String(param);
        // 俱乐部成员列表那边也在等「添加_俱乐部_成员_积分」的回包（context 为 club:gold:...）：
        // 先排除别人的上下文，否则可能把别人的成功回包当成自己的。
        if(text.indexOf(this.requestContext) < 0 && text.indexOf("club:gold:") >= 0)
            return;
        // 旧服回包不带 context，只能靠命令名兜底，仍由 pending 防止重复处理。
        // 赠送和上下分是两条不同命令，兜底也必须按当前动作区分，不能串。
        const expectedHeader = this.action === "give" ? GIFT_HEADER : SUBMIT_HEADER;
        if(text.indexOf(this.requestContext) < 0 && text.indexOf(expectedHeader) < 0)
            return;
        this.pending = false;
        const action = this.action;
        this.action = "";
        if(nCode === 0x200 || nCode === 0x500) {
            const amount = this.submitAmount;
            const balance = this.BalanceFrom(param);
            KBEngine.Event.fire("ClubGoldGiftChanged",this.clubId);
            // 成功反馈交给聊天页的系统消息条，不再单独弹提示框打断输入。
            KBEngine.Event.fire("ClubGoldNotice",{
                clubId:this.clubId,
                userId:this.userId,
                userName:this.userName,
                action:action,
                amount:amount,
                balance:balance
            });
            this.Close();
            return;
        }
        const error = this.ErrorFrom(param);
        if(error.indexOf("请先设置交易密码") >= 0) {
            this.Close();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,error,[(confirmed:boolean)=>{
                if(confirmed) KBEngine.Event.fire("OpenInitTransactionPassword");
            }]);
            return;
        }
        this.Show(error);
    }

    /** 成功回包里如果带了变更后的积分，用它写系统消息；没有就返回 NaN，由聊天页省略那段。 */
    private BalanceFrom(param:string):number {
        const keys = ["club_gold","user_gold","after_gold","left_gold","gold","score","balance"];
        try {
            const data:any = JSON.parse(param);
            for(const src of [data && data.result,data]) {
                if(src == null || typeof src !== "object")
                    continue;
                for(const key of keys) {
                    if(!(key in src))
                        continue;
                    const value = Number(src[key]);
                    if(isFinite(value) && value >= 0)
                        return value;
                }
            }
        }
        catch(error) {
            // 回包不是 JSON 时直接降级
        }
        return NaN;
    }

    private ErrorFrom(param:string):string {
        try {
            const data:any = JSON.parse(param);
            const result:any = data && data.result;
            return String((result && result.error) || data.error || "操作失败，请稍后重试");
        }
        catch(error) {
            return "操作失败，请稍后重试";
        }
    }

    private EditBox(name:string):cc.EditBox {
        const node = Tool.GetChild(this.node,"bk/" + name);
        return node == null ? null : node.getComponent(cc.EditBox);
    }

    private Close():void {
        this.pending = false;
        this.requestContext = "";
        this.action = "";
        UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Top);
    }

    private Show(text:string):void {
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,text);
    }
}
