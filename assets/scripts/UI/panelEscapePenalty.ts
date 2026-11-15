import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 「我的 → 逃跑惩罚统计」（仅大盟主 / 联盟总群主）。
 *
 * 协议（《俱乐部逃跑惩罚统计-客户端接口文档》2026-11-15）：
 *   Hall 命令 `查询_逃跑_惩罚_统计`，参数 context / date(YYYY-MM-DD，空=今天) / count / page / user_id；
 *   先回 GC_OK，列表经路由 `ClubUnionChengfaStats` 推送。
 *   回包：number / count（当日总条数）/ date / union_id / union_name /
 *   income_gold（今日实际到账，整元）/ total_fen / total（今日应扣，元）/ player_count /
 *   result[] 行：time / user_name / user_guuid / bad_fen / bad_money / club_id / club_name /
 *   union_id / union_name / room_id / room_name / settle_batch。
 *
 * 口径：只统计 union_id 非空的罚款（独立俱乐部不进总群主统计）；income_gold 与 total
 * 可能差几元（按分累计、整元入账、每俱乐部最多 0.99 元结转）。
 */
@ccclass
export default class panelEscapePenalty extends UIPanelViewBase
{
    /** 每页条数，与面板行数一致。 */
    private static readonly PAGE_COUNT:number = 10;

    private scrollWater:ScrollViewEx = null;
    private requestContext:string = "";
    private requestedPage:number = 0;
    private pending:boolean = false;
    private pendingToken:number = 0;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("ClubUnionChengfaStats", this, "OnChengfaStats");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        const listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.GetRecords.bind(this);

        this.GetRecords(0);
    }

    //--------------------------------------------------------------------------
    // 请求 / 回包
    //--------------------------------------------------------------------------
    public GetRecords(nPage:number = 0)
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        this.requestedPage = nPage;
        this.requestContext = "club:chengfa:" + nPage + ":" + Date.now();
        this.pending = true;
        const token = ++this.pendingToken;
        this.scheduleOnce(()=>{
            if(this.pendingToken === token)
                this.pending = false;
        },15);

        const strParam = JSON.stringify({
            header:"查询_逃跑_惩罚_统计",
            date:"",
            count:panelEscapePenalty.PAGE_COUNT,
            page:nPage,
            user_id:"",
            context:this.requestContext
        });
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    public OnChengfaStats(strMsg:any,secondaryRaw?:any)
    {
        // 少数链路以 (nCode, strMsg) 形式派发。
        if(secondaryRaw !== undefined && (typeof strMsg === "number" || typeof strMsg === "boolean"))
            strMsg = secondaryRaw;
        if(this.scrollWater == null)
            return;

        const payload = panelEscapePenalty.NormalizeStats(strMsg);
        if(payload == null)
            return;

        let data:any = payload;
        try { data = JSON.parse(payload); }
        catch(error) { return; }

        // 连续翻页时丢弃旧页回包。
        const pageNumber:any = data["number"];
        if(pageNumber != null && pageNumber !== "")
        {
            const page = Number(pageNumber);
            if(isFinite(page) && page !== this.requestedPage)
                return;
        }

        this.pending = false;
        this.SetSummary(data);
        this.scrollWater.UpdateList(payload,"result","逃跑惩罚记录对象",
            panelEscapePenalty.PAGE_COUNT,this.SetRowInfo.bind(this));
    }

    /** 服务端可能直接推裸对象，也可能包 result / ret_result / ClubUnionChengfaStats。 */
    private static NormalizeStats(strMsg:any):string
    {
        if(strMsg == null || strMsg === "")
            return null;

        let data:any = strMsg;
        if(typeof strMsg === "string")
        {
            try { data = JSON.parse(strMsg); }
            catch(error) { return null; }
        }
        if(data == null || typeof data !== "object")
            return null;

        if(panelEscapePenalty.HasRows(data))
            return JSON.stringify(data);

        for(const key of ["ClubUnionChengfaStats","result","ret_result"])
        {
            const inner = data[key];
            if(inner != null && typeof inner === "object" && panelEscapePenalty.HasRows(inner))
                return JSON.stringify(inner);
        }
        return null;
    }

    private static HasRows(data:any):boolean
    {
        if(data == null || typeof data !== "object")
            return false;
        // 空列表也认：`result: []` 说明今天没有罚款，要清空列表并显示 0。
        return Array.isArray(data["result"]) || data["count"] != null;
    }

    /** 顶部汇总：今日应扣 / 到账 / 笔数 / 人数。 */
    private SetSummary(data:any)
    {
        const node = Tool.GetChild(this.node,"汇总");
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label == null)
            return;

        const total = panelEscapePenalty.ToNumber(data["total"]);
        const income = panelEscapePenalty.ToNumber(data["income_gold"]);
        const count = panelEscapePenalty.ToNumber(data["count"]);
        const players = panelEscapePenalty.ToNumber(data["player_count"]);

        let text = "今日应扣 " + panelEscapePenalty.Money(total) + " 元";
        text += "　到账 " + panelEscapePenalty.Money(income) + " 元";
        text += "　" + Math.max(0,Math.round(count)) + " 笔 / " + Math.max(0,Math.round(players)) + " 人";

        const unionName = data["union_name"] == null ? "" : String(data["union_name"]).trim();
        if(unionName !== "")
            text = unionName + "　" + text;
        label.string = text;
    }

    //--------------------------------------------------------------------------
    // 列表行：时间 / 玩家 / 扣款 / 分盟 / 牌桌
    //--------------------------------------------------------------------------
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const timeNode = node.getChildByName("time");
        if(timeNode != null)
            timeNode.getComponent(cc.Label).string =
                panelEscapePenalty.FormatTime(String(jItem["time"] == null ? "" : jItem["time"]));

        const nameNode = node.getChildByName("name");
        if(nameNode != null)
        {
            let name = String(jItem["user_name"] == null ? "" : jItem["user_name"]).trim();
            if(name === "")
                name = String(jItem["user_guuid"] == null ? "" : jItem["user_guuid"]).trim();
            nameNode.getComponent(cc.Label).string = name === "" ? "—" : name;
        }

        // 扣款金额：bad_money 优先（元），没有就用 bad_fen / 100。
        const money = jItem["bad_money"] != null ? panelEscapePenalty.ToNumber(jItem["bad_money"])
            : panelEscapePenalty.ToNumber(jItem["bad_fen"]) / 100;
        const moneyNode = node.getChildByName("money");
        if(moneyNode != null)
        {
            const label = moneyNode.getComponent(cc.Label);
            label.string = "-" + panelEscapePenalty.Money(money);
            // 客户口径：红色 = 加分，绿色 = 减分，罚款是扣减。
            label.color = new cc.Color(167,231,29,255);
        }

        const clubNode = node.getChildByName("club");
        if(clubNode != null)
        {
            let club = String(jItem["club_name"] == null ? "" : jItem["club_name"]).trim();
            if(club === "")
                club = String(jItem["club_id"] == null ? "" : jItem["club_id"]).trim();
            // settle_batch 为空 = 还没凑整出账，标出来免得玩家对不上账。
            const batch = String(jItem["settle_batch"] == null ? "" : jItem["settle_batch"]).trim();
            if(club !== "" && batch === "")
                club += "\n待结转";
            clubNode.getComponent(cc.Label).string = club === "" ? "—" : club;
        }

        const roomNode = node.getChildByName("room");
        if(roomNode != null)
        {
            let room = String(jItem["room_name"] == null ? "" : jItem["room_name"]).trim();
            if(room === "")
                room = String(jItem["room_id"] == null ? "" : jItem["room_id"]).trim();
            roomNode.getComponent(cc.Label).string = room === "" ? "—" : room;
        }
    }

    //--------------------------------------------------------------------------
    // 工具
    //--------------------------------------------------------------------------
    private static ToNumber(raw:any):number
    {
        const value = Number(String(raw == null ? "" : raw).replace(/,/g,""));
        return isFinite(value) ? value : 0;
    }

    /** 整元不带小数；有角分保留两位。 */
    private static Money(yuan:number):string
    {
        if(!isFinite(yuan))
            return "0";
        if(Math.abs(yuan - Math.round(yuan)) < 0.005)
            return Math.round(yuan).toString();
        return (Math.round(yuan * 100) / 100).toFixed(2);
    }

    /** 服务端只给 `21:38:41`，带日期时也只取时分。 */
    private static FormatTime(raw:string):string
    {
        const text = raw.trim();
        if(text === "")
            return "—";
        const match = text.match(/([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?/);
        if(match == null)
            return text;
        const hour = match[1].length === 1 ? "0" + match[1] : match[1];
        return hour + ":" + match[2];
    }

    //--------------------------------------------------------------------------
    // 错误与按钮
    //--------------------------------------------------------------------------
    public onHallCommand(nCode:number, param:string)
    {
        if(param == null || this.requestContext === "")
            return;

        let text = param;
        if(typeof text !== "string")
        {
            try { text = JSON.stringify(text); }
            catch(error) { return; }
        }
        if(text.indexOf(this.requestContext) < 0)
            return;

        if(nCode === 0x200 || nCode === 0x500)
        {
            const payload = panelEscapePenalty.NormalizeStats(text);
            if(payload != null)
                this.OnChengfaStats(payload);
            return;
        }

        this.pending = false;
        let strError = "";
        try
        {
            const msg:any = JSON.parse(text);
            const data = msg == null ? null : (msg["result"] || msg["ret_result"] || msg);
            if(data != null && typeof data === "object" && data["error"] != null)
                strError = String(data["error"]);
        }
        catch(error) {}
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            strError !== "" ? strError : "逃跑惩罚记录查询失败，请稍后重试！");
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
