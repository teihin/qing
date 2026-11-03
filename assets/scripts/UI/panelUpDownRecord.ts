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
 * 「我的 → 上下分记录」。
 *
 * 使用「添加积分」专用记录接口（不是 查询_俱乐部_积分流水）：
 *   Hall 命令 `查询_俱乐部_成员_积分_添加_记录`，不支持 user_id，查当前俱乐部整本记录；
 *   列表经 `AddMemberGoldList` 推送。
 *   行字段：guuid / name（被加分的玩家）、opter_name（操作人）、
 *   gold（整数元，正数加分、负数减分）、remark（变动后余额）、date、type。
 *
 * 接口范围是「添加积分 + 积分受赠」两类；本页只保留 type=添加积分。
 * 美术沿用「金币流向」页的下半部分，标题栏/表头/行模板单独生成。
 */
@ccclass
export default class panelUpDownRecord extends UIPanelViewBase
{
    private static readonly PAGE_COUNT:number = 10;

    private scrollWater:ScrollViewEx = null;
    private clubId:string = "";
    private requestContext:string = "";
    private requestedPage:number = 0;
    private pending:boolean = false;
    private pendingToken:number = 0;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("AddMemberGoldList", this, "OnAddMemberGoldList");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.GetUpDownRecords.bind(this);

        this.GetUpDownRecords(0);
    }

    //--------------------------------------------------------------------------
    // 请求 / 回包
    //--------------------------------------------------------------------------
    public GetUpDownRecords(nPage:number = 0)
    {
        let account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        let clubId = resolveRoomClubId(account);
        if(clubId === "")
        {
            this.pending = false;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先选择俱乐部");
            return;
        }

        this.clubId = clubId;
        this.requestedPage = nPage;
        this.requestContext = "club:updown-record:" + clubId + ":" + nPage + ":" + Date.now();
        this.pending = true;
        const token = ++this.pendingToken;
        this.scheduleOnce(()=>{
            if(this.pendingToken === token)
                this.pending = false;
        },10);

        // 这个接口不支持 user_id，传了也不会按玩家过滤。
        const strParam = JSON.stringify({
            header:"查询_俱乐部_成员_积分_添加_记录",
            club_id:clubId,
            count:panelUpDownRecord.PAGE_COUNT,
            page:nPage,
            context:this.requestContext
        });
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    public OnAddMemberGoldList(strMsg:any)
    {
        if(this.scrollWater == null || !this.pending || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null || resolveRoomClubId(account) !== this.clubId)
            return;

        let payload = panelUpDownRecord.NormalizeList(strMsg);
        if(payload == null)
            return;

        let data:any = payload;
        if(typeof payload === "string")
        {
            try { data = JSON.parse(payload); }
            catch(error) { return; }
        }
        let context = data["context"] == null ? "" : String(data["context"]);
        if(context !== "" && context.indexOf("updown-record") < 0)
            return;

        // 连续翻页时丢弃旧页回包；服务端没带页码时只能按 pending 配对。
        const rows = data["AddMemberGoldList"];
        let pageNumber:any = data["number"];
        if((pageNumber == null || pageNumber === "") && Array.isArray(rows) && rows.length > 0)
            pageNumber = rows[0]["number"];
        if(pageNumber != null && pageNumber !== "")
        {
            const page = Number(pageNumber);
            if(isFinite(page) && page !== this.requestedPage)
                return;
        }

        this.pending = false;
        this.scrollWater.UpdateList(panelUpDownRecord.FilterAddRows(payload),
            "AddMemberGoldList","上下分记录对象",
            panelUpDownRecord.PAGE_COUNT,this.SetRowInfo.bind(this));
    }

    /**
     * 服务端既可能直接推 `{"AddMemberGoldList":[...]}`，也可能包一层 `result`/`ret_result`。
     */
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

        if(Array.isArray(data["AddMemberGoldList"]))
            return JSON.stringify(data);

        let result = data["result"];
        if(result != null && Array.isArray(result["AddMemberGoldList"]))
            return JSON.stringify(result);

        let retResult = data["ret_result"];
        if(retResult != null && Array.isArray(retResult["AddMemberGoldList"]))
            return JSON.stringify(retResult);

        return null;
    }

    /** 接口同时返回「添加积分 + 积分受赠」，本页只看添加积分；保留分页元数据。 */
    private static FilterAddRows(payload:string):string
    {
        let data:any = null;
        try { data = JSON.parse(payload); }
        catch(error) { return payload; }
        let rows = data == null ? null : data["AddMemberGoldList"];
        if(!Array.isArray(rows))
            return payload;

        const filtered = rows.filter((row:any)=>{
            return row != null && String(row["type"] == null ? "" : row["type"]).trim() === "添加积分";
        });
        const first:any = rows.length > 0 ? rows[0] : {};
        const result:any = {AddMemberGoldList:filtered};
        for(const key of ["number","count"])
        {
            if(data[key] != null)
                result[key] = data[key];
            else if(first[key] != null)
                result[key] = first[key];
        }
        return JSON.stringify(result);
    }

    //--------------------------------------------------------------------------
    // 列表行：时间 / 玩家（操作人） / 金额 / 余额
    //--------------------------------------------------------------------------
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const name = jItem["name"] == null ? "" : String(jItem["name"]).trim();
        const guuid = jItem["guuid"] == null ? "" : String(jItem["guuid"]).trim();
        const opter = jItem["opter_name"] == null ? "" : String(jItem["opter_name"]).trim();
        let playerText = name || guuid || "—";
        if(opter !== "")
            playerText += "\n操作:" + opter;
        node.getChildByName("type").getComponent(cc.Label).string = playerText;

        // 接口 gold 单位元：正数加分、负数减分。
        const gold = Number(jItem["gold"] == null ? "" : String(jItem["gold"]).replace(/,/g,""));
        const validGold = !isNaN(gold) && isFinite(gold);
        const amount = validGold ? Math.trunc(gold) : 0;
        let countNode = node.getChildByName("count");
        countNode.getComponent(cc.Label).string = validGold ?
            (amount > 0 ? "+" + amount.toString() : amount.toString()) : "--";

        // remark 是变动后余额。
        const remark = jItem["remark"] == null ? "" : String(jItem["remark"]);
        node.getChildByName("now").getComponent(cc.Label).string = remark || "—";

        const date = jItem["date"] == null ? "" : String(jItem["date"]);
        const match = date.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})[ T]([0-9]{1,2}):([0-9]{2})/);
        const month = match && match[1].length === 1 ? "0" + match[1] : match ? match[1] : "";
        const day = match && match[2].length === 1 ? "0" + match[2] : match ? match[2] : "";
        const hour = match && match[3].length === 1 ? "0" + match[3] : match ? match[3] : "";
        node.getChildByName("time").getComponent(cc.Label).string = match ?
            month + "/" + day + " " + hour + ":" + match[4] : date;

        // 正数加分用 in，负数减分用 out。
        const iconType = amount > 0 ? "in" : amount < 0 ? "out" : "";
        for(const key of ["in","out","gift","game"])
        {
            const icon = node.getChildByName("V8类型图标_" + key);
            if(icon != null)
                icon.active = key === iconType;
        }

        if(amount > 0)
            countNode.color = new cc.Color(167,231,29,255);
        else if(amount < 0)
            countNode.color = new cc.Color(255,65,52,255);
        else
            countNode.color = new cc.Color(239,225,194,255);
    }

    //--------------------------------------------------------------------------
    // 其它
    //--------------------------------------------------------------------------
    public onHallCommand(nCode:number, param:string)
    {
        if(param == null || this.requestContext === "")
            return;
        if(typeof param !== "string")
        {
            try { param = JSON.stringify(param); }
            catch(error) { return; }
        }
        if(param.indexOf(this.requestContext) < 0)
            return;

        if(nCode === 0x200)
        {
            // 少数情况下服务端会把列表塞进同步 result，这里立刻显示；否则等 AddMemberGoldList 推送。
            const payload = panelUpDownRecord.NormalizeList(param);
            if(payload != null)
                this.OnAddMemberGoldList(payload);
            return;
        }

        this.pending = false;
        let strError = "";
        try
        {
            let msg:any = JSON.parse(param);
            let data = msg == null ? null : (msg["result"] || msg["ret_result"] || msg);
            strError = data == null || data["error"] == null ? "" : String(data["error"]);
        }
        catch(error) {}
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            strError !== "" ? strError : "上下分记录查询失败，请稍后重试！");
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
