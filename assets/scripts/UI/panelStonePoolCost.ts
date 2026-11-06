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
 * 「我的 → 钻石池消耗」。
 *
 * 协议见《俱乐部积分与额度方案-客户端接口文档》§11.4：
 *   Hall 命令 `查询_俱乐部_钻石兑换_记录`，参数 club_id / user_id(留空=自己，群主留空=全俱乐部) /
 *   count / page / context；同步回包只有空壳，列表经 `ClubStoneExchangeList` 推送。
 *   行字段：guuid / name（兑换玩家）、cost_gold（消耗俱乐部积分，元）、stone（得到钻石，个）、date。
 *
 * 美术沿用「金币流向」页的下半部分，标题栏、表头文字、按钮图均单独生成。
 */
@ccclass
export default class panelStonePoolCost extends UIPanelViewBase
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

        KBEngine.Event.register("ClubStoneExchangeList", this, "OnStoneExchangeList");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.GetExchangeRecords.bind(this);

        this.GetExchangeRecords(0);
    }

    //--------------------------------------------------------------------------
    // 请求 / 回包
    //--------------------------------------------------------------------------
    public GetExchangeRecords(nPage:number = 0)
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
        this.requestContext = "club:stone-pool-cost:" + clubId + ":" + nPage + ":" + Date.now();
        this.pending = true;
        const token = ++this.pendingToken;
        this.scheduleOnce(()=>{
            if(this.pendingToken === token)
                this.pending = false;
        },10);

        const strParam = JSON.stringify({
            header:"查询_俱乐部_钻石兑换_记录",
            club_id:clubId,
            user_id:"",
            count:panelStonePoolCost.PAGE_COUNT,
            page:nPage,
            context:this.requestContext
        });
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    public OnStoneExchangeList(strMsg:any)
    {
        if(this.scrollWater == null || !this.pending || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null || resolveRoomClubId(account) !== this.clubId)
            return;

        let payload = panelStonePoolCost.NormalizeList(strMsg);
        if(payload == null)
            return;

        let data:any = payload;
        if(typeof payload === "string")
        {
            try { data = JSON.parse(payload); }
            catch(error) { return; }
        }
        let context = data["context"] == null ? "" : String(data["context"]);
        if(context !== "" && context.indexOf("stone-pool-cost") < 0)
            return;

        // 连续翻页时丢弃旧页回包。
        const rows = data["ClubStoneExchangeList"];
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
        this.scrollWater.UpdateList(payload,"ClubStoneExchangeList","钻石兑换记录对象",
            panelStonePoolCost.PAGE_COUNT,this.SetRowInfo.bind(this));
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

        if(Array.isArray(data["ClubStoneExchangeList"]))
            return JSON.stringify(data);

        let result = data["result"];
        if(result != null && Array.isArray(result["ClubStoneExchangeList"]))
            return JSON.stringify(result);

        let retResult = data["ret_result"];
        if(retResult != null && Array.isArray(retResult["ClubStoneExchangeList"]))
            return JSON.stringify(retResult);

        return null;
    }

    //--------------------------------------------------------------------------
    // 列表行：时间 / 玩家 / 消耗积分 / 获得钻石
    //--------------------------------------------------------------------------
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const name = jItem["name"] == null ? "" : String(jItem["name"]).trim();
        const guuid = jItem["guuid"] == null ? "" : String(jItem["guuid"]).trim();
        node.getChildByName("type").getComponent(cc.Label).string = name || guuid || "—";

        const cost = Number(jItem["cost_gold"] == null ? "" : String(jItem["cost_gold"]).replace(/,/g,""));
        const validCost = !isNaN(cost) && isFinite(cost);
        let countNode = node.getChildByName("count");
        if(validCost)
        {
            const value = Math.trunc(cost);
            countNode.getComponent(cc.Label).string = value > 0 ? "-" + value.toString() : "0";
        }
        else
            countNode.getComponent(cc.Label).string = "--";

        const stone = Number(jItem["stone"] == null ? "" : String(jItem["stone"]).replace(/,/g,""));
        const validStone = !isNaN(stone) && isFinite(stone);
        let nowNode = node.getChildByName("now");
        if(validStone)
        {
            const value = Math.trunc(stone);
            nowNode.getComponent(cc.Label).string = value > 0 ? "+" + value.toString() : "0";
        }
        else
            nowNode.getComponent(cc.Label).string = "--";

        const date = jItem["date"] == null ? "" : String(jItem["date"]);
        const match = date.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})[ T]([0-9]{1,2}):([0-9]{2})/);
        const month = match && match[1].length === 1 ? "0" + match[1] : match ? match[1] : "";
        const day = match && match[2].length === 1 ? "0" + match[2] : match ? match[2] : "";
        const hour = match && match[3].length === 1 ? "0" + match[3] : match ? match[3] : "";
        node.getChildByName("time").getComponent(cc.Label).string = match ?
            month + "/" + day + " " + hour + ":" + match[4] : date;

        for(const key of ["in","out","gift","game","stone"])
        {
            const icon = node.getChildByName("V8类型图标_" + key);
            if(icon != null)
                icon.active = key === "stone";
        }

        // 客户口径（2026-11-07 测试反馈）：红色 = 加分，绿色 = 减分。消耗是减，得到钻石是加。
        countNode.color = validCost && cost > 0 ?
            new cc.Color(167,231,29,255) : new cc.Color(239,225,194,255);
        nowNode.color = validStone && stone > 0 ?
            new cc.Color(255,65,52,255) : new cc.Color(239,225,194,255);
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
            const payload = panelStonePoolCost.NormalizeList(param);
            if(payload != null)
                this.OnStoneExchangeList(payload);
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
            strError !== "" ? strError : "钻石兑换记录查询失败，请稍后重试！");
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
