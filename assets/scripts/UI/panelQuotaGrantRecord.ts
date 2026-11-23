import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import { resolveRoomClubId } from "../logic/RoomClubContext";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 「我的 → 额度授权记录」。
 *
 * 协议（《俱乐部积分与额度方案-客户端接口文档》§11.2）：
 *   Hall 命令 `查询_俱乐部_额度流水`，参数 club_id / user_id / count / page / context；
 *   `user_id="ALL"` 取俱乐部全部额度流水（仅俱乐部创建者 / 联盟创建者 / boss 可查）；
 *   同步回包只有空壳，列表经 `ClubQuotaWater` 推送。
 *   行字段：number / count / date / type（带入、结算、额度授信、额度收回、额度转入、额度抽水回补、
 *   额度兑换、额度联盟授信、额度联盟注资…原样展示）/ quota（有符号变动额，分）/ remark
 *   （带入/结算 = 变动后余额，分；其它类型通常是「旧→新」）/ room_id /
 *   guuid / name（额度归属账号）/ opter_name / actor_guuid（实际触发人）。
 *
 * 这里不做任何类型过滤：俱乐部所有额度流水都列出来。
 * 分页走服务端：每页条数与面板行数一致，翻页时重新请求并带上页码。
 */
@ccclass
export default class panelQuotaGrantRecord extends UIPanelViewBase
{
    /** 每页条数，与面板表头/行高一致。 */
    private static readonly PAGE_COUNT:number = 10;

    private scrollWater:ScrollViewEx = null;
    private clubId:string = "";
    private requestContext:string = "";
    private requestedPage:number = 0;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("ClubQuotaWater", this, "OnClubQuotaWater");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
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

        const clubId = resolveRoomClubId(account);
        if(clubId === "")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先选择俱乐部");
            return;
        }

        this.clubId = clubId;
        this.requestedPage = nPage;
        this.requestContext = "club:quota-water:" + clubId + ":" + nPage + ":" + Date.now();

        const strParam = JSON.stringify({
            header:"查询_俱乐部_额度流水",
            club_id:clubId,
            // ALL = 俱乐部全部额度流水（服务端仅对俱乐部创建者 / 联盟创建者 / boss 放行）。
            user_id:"ALL",
            count:panelQuotaGrantRecord.PAGE_COUNT,
            page:nPage,
            context:this.requestContext
        });
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    public OnClubQuotaWater(strMsg:any,secondaryRaw?:any)
    {
        // KBEngine 偶尔以 (nCode, strMsg) 形式派发，沿用 ClubManagementApi 的兼容写法。
        if(secondaryRaw !== undefined && (typeof strMsg === "number" || typeof strMsg === "boolean"))
            strMsg = secondaryRaw;
        if(this.scrollWater == null || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null || resolveRoomClubId(account) !== this.clubId)
            return;

        const payload = panelQuotaGrantRecord.NormalizeList(strMsg);
        if(payload == null)
            return;

        let data:any = payload;
        if(typeof payload === "string")
        {
            try { data = JSON.parse(payload); }
            catch(error) { return; }
        }

        // 连续翻页时丢弃旧页回包。
        const rows = data["ClubQuotaWater"];
        let pageNumber:any = data["number"];
        if((pageNumber == null || pageNumber === "") && Array.isArray(rows) && rows.length > 0)
            pageNumber = rows[0]["number"];
        if(pageNumber != null && pageNumber !== "")
        {
            const page = Number(pageNumber);
            if(isFinite(page) && page !== this.requestedPage)
                return;
        }

        this.scrollWater.UpdateList(payload,"ClubQuotaWater","额度授权记录对象",
            panelQuotaGrantRecord.PAGE_COUNT,this.SetRowInfo.bind(this));
    }

    private static NormalizeList(strMsg:any):string
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

        if(Array.isArray(data["ClubQuotaWater"]))
            return JSON.stringify(data);

        const result = data["result"];
        if(result != null && Array.isArray(result["ClubQuotaWater"]))
            return JSON.stringify(result);

        const retResult = data["ret_result"];
        if(retResult != null && Array.isArray(retResult["ClubQuotaWater"]))
            return JSON.stringify(retResult);

        return null;
    }

    /** 行：时间 / 归属人（下方一行补「类型 · 触发人」）/ 变动额 / 变动后余额。 */
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const type = jItem["type"] == null ? "" : String(jItem["type"]).trim();
        // 额度归属账号（V2 通常是俱乐部群主）和实际触发人是两个人：上面显示归属人，
        // 下面一行显示「类型 · 触发人」，否则只看得到盟主，看不出这笔额度是谁引发的。
        const owner = String(jItem["name"] == null ? "" : jItem["name"]).trim();
        const opter = String(jItem["opter_name"] == null ? "" : jItem["opter_name"]).trim();
        const nameNode = node.getChildByName("type");
        if(nameNode != null)
        {
            const name = owner !== "" ? owner : opter;
            nameNode.getComponent(cc.Label).string = name === "" ? "—" : name;
        }

        // 服务端 opt_type 原样展示（带入/结算/额度授信/额度收回/额度转入/额度抽水回补/额度兑换/
        // 额度联盟授信/额度联盟注资…），客户端不按类型过滤。
        const typeNode = node.getChildByName("typelabel");
        if(typeNode != null)
        {
            typeNode.active = true;
            const label = typeNode.getComponent(cc.Label);
            if(label != null)
            {
                const typeText = type === "" ? "—" : type;
                // 触发人与归属人是同一人（玩家自己带入/结算）时不重复显示。
                const trigger = opter !== "" && opter !== owner ? " · " + opter : "";
                label.string = typeText + trigger;
            }
        }

        // quota 是带符号变动额（分）：带入为负、结算/授信为正。
        const quota = Number(String(jItem["quota"] == null ? "" : jItem["quota"]).replace(/,/g,""));
        const valid = isFinite(quota);
        const yuan = valid ? Math.round(quota) / 100 : 0;
        const countNode = node.getChildByName("count");
        if(countNode != null)
        {
            const text = valid ? (yuan > 0 ? "+" + panelQuotaGrantRecord.Money(yuan) : panelQuotaGrantRecord.Money(yuan)) : "--";
            countNode.getComponent(cc.Label).string = text;
            // 客户口径：红色 = 加分，绿色 = 减分。
            countNode.color = valid && yuan > 0 ?
                new cc.Color(255,65,52,255) : new cc.Color(167,231,29,255);
        }

        const nowNode = node.getChildByName("now");
        if(nowNode != null)
        {
            const afterFen = panelQuotaGrantRecord.BalanceFen(jItem["remark"]);
            nowNode.getComponent(cc.Label).string = isFinite(afterFen) ?
                panelQuotaGrantRecord.Money(afterFen / 100) : "--";
            nowNode.color = new cc.Color(239,225,194,255);
        }

        const timeNode = node.getChildByName("time");
        if(timeNode != null)
            timeNode.getComponent(cc.Label).string = panelQuotaGrantRecord.FormatDate(String(jItem["date"] == null ? "" : jItem["date"]));

        for(const key of ["in","out","game","stone","quota"])
        {
            const icon = node.getChildByName("V8类型图标_" + key);
            if(icon != null)
                icon.active = key === "quota";
        }
    }

    /**
     * 变动后余额（分）：`带入`/`结算` 的 remark 直接是余额；其它类型通常写成「旧→新」，
     * 取箭头后半段。兼容千分位与空格。
     */
    private static BalanceFen(raw:any):number
    {
        if(raw == null)
            return NaN;
        let text = String(raw).trim();
        if(text === "")
            return NaN;
        const arrow = text.lastIndexOf("→");
        if(arrow >= 0)
            text = text.substring(arrow + 1);
        text = text.replace(/[,，\s]/g,"");
        const fen = Number(text);
        return isFinite(fen) ? fen : NaN;
    }

    //--------------------------------------------------------------------------
    // 工具
    //--------------------------------------------------------------------------
    private static Money(yuan:number):string
    {
        if(!isFinite(yuan))
            return "--";
        if(Math.abs(yuan - Math.round(yuan)) < 0.005)
            return Math.round(yuan).toString();
        return (Math.round(yuan * 100) / 100).toFixed(2);
    }

    private static FormatDate(date:string):string
    {
        const match = date.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})[ T]([0-9]{1,2}):([0-9]{2})/);
        if(match == null)
            return date;
        const month = match[1].length === 1 ? "0" + match[1] : match[1];
        const day = match[2].length === 1 ? "0" + match[2] : match[2];
        const hour = match[3].length === 1 ? "0" + match[3] : match[3];
        return month + "/" + day + " " + hour + ":" + match[4];
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

        // 0x200 最终成功、0x500 已受理：有列表就先用，没有则等 ClubQuotaWater 推送。
        if(nCode === 0x200 || nCode === 0x500)
        {
            const payload = panelQuotaGrantRecord.NormalizeList(text);
            if(payload != null)
                this.OnClubQuotaWater(payload);
            return;
        }

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
            strError !== "" ? strError : "额度流水查询失败，请稍后重试！");
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
