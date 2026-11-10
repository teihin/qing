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
 * 「我的 → 钻石池消耗」。两个页签：
 *
 * 1. 钻石池兑换：`查询_俱乐部_钻石兑换_记录`，列表经 `ClubStoneExchangeList` 推送；
 *    行字段 guuid / name / cost_gold / stone / date。
 * 2. 开房消耗：`查询_俱乐部_钻石流水`，列表经 `ClubStoneWater` 推送；
 *    只取 `钻石房间扣费` 行，展示时间 / 房间号 / 消耗钻石 / 扣除后余额。
 *
 * 美术沿用「金币流向」页的下半部分，标题栏、表头文字、按钮图均单独生成。
 */
@ccclass
export default class panelStonePoolCost extends UIPanelViewBase
{
    private static readonly PAGE_COUNT:number = 10;
    private static readonly TAB_EXCHANGE:number = 0;
    private static readonly TAB_ROOM:number = 1;

    private scrollWater:ScrollViewEx = null;
    private clubId:string = "";
    private currentTab:number = panelStonePoolCost.TAB_EXCHANGE;
    private tabNodes:cc.Node[] = [];
    private headerNodes:cc.Node[] = [];
    private tabOnFrame:cc.SpriteFrame = null;
    private tabOffFrame:cc.SpriteFrame = null;

    private requestContext:string = "";
    private requestedPage:number = 0;
    private pending:boolean = false;
    private pendingToken:number = 0;

    /** 开房消耗：一次取最近 100 条流水，按 `钻石房间扣费` 过滤后在本地分页。 */
    private roomRequestContext:string = "";
    private roomRequestToken:number = 0;
    private roomPending:boolean = false;
    private roomRows:any[] = null;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("ClubStoneExchangeList", this, "OnStoneExchangeList");
        KBEngine.Event.register("ClubStoneWater", this, "OnClubStoneWater");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);

        const exchangeTab = Tool.GetChild(this.node,"页签/页签_钻石池兑换");
        const roomTab = Tool.GetChild(this.node,"页签/页签_开房消耗");
        if(exchangeTab != null)
            this.tabNodes.push(exchangeTab);
        if(roomTab != null)
            this.tabNodes.push(roomTab);
        this.headerNodes.push(Tool.GetChild(this.node,"表头"));
        this.headerNodes.push(Tool.GetChild(this.node,"表头2"));
        if(exchangeTab != null && exchangeTab.getComponent(cc.Sprite) != null)
            this.tabOnFrame = exchangeTab.getComponent(cc.Sprite).spriteFrame;
        if(roomTab != null && roomTab.getComponent(cc.Sprite) != null)
            this.tabOffFrame = roomTab.getComponent(cc.Sprite).spriteFrame;

        this.ApplyTabVisual();

        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.GetExchangeRecords.bind(this);
        this.GetExchangeRecords(0);
    }

    //--------------------------------------------------------------------------
    // 页签
    //--------------------------------------------------------------------------
    private SelectTab(tab:number):void
    {
        if(tab !== panelStonePoolCost.TAB_EXCHANGE && tab !== panelStonePoolCost.TAB_ROOM)
            return;

        this.currentTab = tab;
        this.pending = false;
        this.roomPending = false;
        ++this.pendingToken;
        ++this.roomRequestToken;
        this.ClearRows();

        if(this.scrollWater != null)
        {
            this.scrollWater.nCurPage = 0;
            this.scrollWater.nTotlePage = 0;
            this.SetPageLabel(0);
        }

        this.ApplyTabVisual();
        if(tab === panelStonePoolCost.TAB_EXCHANGE)
        {
            if(this.scrollWater != null)
                this.scrollWater.callBackFresh = this.GetExchangeRecords.bind(this);
            this.GetExchangeRecords(0);
            return;
        }

        this.roomRows = null;
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.PageRoomCost.bind(this);
        this.GetRoomCostRecords();
    }

    private ApplyTabVisual():void
    {
        for(let i = 0; i < this.tabNodes.length; ++i)
        {
            const tab = this.tabNodes[i];
            if(tab == null)
                continue;
            const sprite = tab.getComponent(cc.Sprite);
            if(sprite != null)
            {
                const frame = i === this.currentTab ? this.tabOnFrame : this.tabOffFrame;
                if(frame != null)
                    sprite.spriteFrame = frame;
            }
            const label = tab.getChildByName("文字");
            if(label != null)
            {
                label.color = i === this.currentTab ?
                    new cc.Color(48,30,8,255) : new cc.Color(169,192,214,255);
            }
        }
        for(let i = 0; i < this.headerNodes.length; ++i)
        {
            const header = this.headerNodes[i];
            if(header != null)
                header.active = i === this.currentTab;
        }
    }

    private ClearRows():void
    {
        const content = Tool.GetChild(this.node,"列表/view/content");
        if(content == null)
            return;
        const children = content.children.slice();
        content.removeAllChildren();
        for(const child of children)
            child.destroy();
    }

    private SetPageLabel(page:number, totalPages:number = 0):void
    {
        const label = Tool.GetChild(this.node,"分页/页码");
        if(label == null || label.getComponent(cc.Label) == null)
            return;
        label.getComponent(cc.Label).string = totalPages > 0 ? (page + 1) + "/" + totalPages : "0";
    }

    //--------------------------------------------------------------------------
    // 页签一：钻石池兑换
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
        if(this.currentTab !== panelStonePoolCost.TAB_EXCHANGE)
            return;
        if(this.scrollWater == null || !this.pending || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null || resolveRoomClubId(account) !== this.clubId)
            return;

        let payload = panelStonePoolCost.NormalizeExchangeList(strMsg);
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
            panelStonePoolCost.PAGE_COUNT,this.SetExchangeRowInfo.bind(this));
    }

    private static NormalizeExchangeList(strMsg:any):string
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
    // 页签二：开房消耗（查询_俱乐部_钻石流水）
    //--------------------------------------------------------------------------
    public GetRoomCostRecords()
    {
        let account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        let clubId = resolveRoomClubId(account);
        if(clubId === "")
        {
            this.roomPending = false;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先选择俱乐部");
            return;
        }

        this.clubId = clubId;
        this.roomRequestContext = "club:stone-room-cost:" + clubId + ":" + Date.now();
        this.roomPending = true;
        const token = ++this.roomRequestToken;
        this.scheduleOnce(()=>{
            if(this.roomRequestToken === token)
                this.roomPending = false;
        },10);

        // 服务端总条数最多 100 条；一次取回后按房间扣费过滤，再本地分页。
        const strParam = JSON.stringify({
            header:"查询_俱乐部_钻石流水",
            club_id:clubId,
            count:100,
            page:0,
            context:this.roomRequestContext
        });
        account.reqHallCommand(strParam,"P@" + this.roomRequestContext);
    }

    public OnClubStoneWater(raw:any, secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        if(this.currentTab !== panelStonePoolCost.TAB_ROOM || !this.roomPending)
            return;
        if(this.scrollWater == null || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null || resolveRoomClubId(account) !== this.clubId)
            return;

        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data && data.result && !data.ClubStoneWater)
            data = data.result;
        if(data && data.ret_result && !data.ClubStoneWater)
            data = data.ret_result;
        if(data == null || !Array.isArray(data["ClubStoneWater"]))
            return;

        this.roomPending = false;
        this.roomRows = (data["ClubStoneWater"] as any[]).filter(
            (row:any)=>panelStonePoolCost.IsRoomCostRow(row));
        this.PageRoomCost(0);
    }

    /** 开房扣费行：类型含「房间」或带房间号；兼容字段名差异。 */
    private static IsRoomCostRow(row:any):boolean
    {
        if(row == null)
            return false;
        const type = row["type"] == null ? (row["opt_type"] == null ? "" : String(row["opt_type"])) : String(row["type"]);
        if(type.indexOf("房间") >= 0)
            return true;
        return panelStonePoolCost.PickRoomId(row) !== "" && Number(row["stone"]) < 0;
    }

    /** 服务端已补 `room_id`；兼容历史字段名，避免字段大小写差异时房间号显示为空。 */
    private static PickRoomId(row:any):string
    {
        for(const key of ["room_id","roomid","roomId","room_no","room_number","room"])
        {
            if(row[key] == null)
                continue;
            const value = String(row[key]).trim();
            if(value !== "" && value !== "0")
                return value;
        }
        return "";
    }

    private PageRoomCost(nPage:number = 0):void
    {
        if(this.scrollWater == null)
            return;
        const rows = this.roomRows == null ? [] : this.roomRows;
        const total = rows.length;
        const totalPages = total > 0 ? Math.ceil(total / panelStonePoolCost.PAGE_COUNT) : 0;
        const page = totalPages > 0 ? Math.min(Math.max(0,nPage),totalPages - 1) : 0;

        const start = page * panelStonePoolCost.PAGE_COUNT;
        const slice = rows.slice(start,start + panelStonePoolCost.PAGE_COUNT).map((row:any)=>{
            const copy:any = {};
            for(const key of Object.keys(row))
            {
                if(key !== "number" && key !== "count")
                    copy[key] = row[key];
            }
            return copy;
        });

        this.scrollWater.UpdateList(JSON.stringify({ClubStoneWater:slice}),
            "ClubStoneWater","开房消耗记录对象",panelStonePoolCost.PAGE_COUNT,
            this.SetRoomRowInfo.bind(this));

        this.scrollWater.nCurPage = page;
        this.scrollWater.nTotlePage = totalPages;
        this.scrollWater.nCount = total;
        this.SetPageLabel(page,totalPages);
    }

    //--------------------------------------------------------------------------
    // 列表行
    //--------------------------------------------------------------------------
    private SetExchangeRowInfo(node:cc.Node, jItem:any)
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

        node.getChildByName("time").getComponent(cc.Label).string =
            panelStonePoolCost.FormatTime(jItem["date"]);

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

    private SetRoomRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const room = panelStonePoolCost.PickRoomId(jItem);
        // 服务端若在流水行补了扣费方式（开房 / 周期），跟在房间号后面显示。
        const reason = jItem["reason"] == null ? "" : String(jItem["reason"]).trim();
        const roomLabel = node.getChildByName("room");
        if(roomLabel != null && roomLabel.getComponent(cc.Label) != null)
        {
            let roomText = room;
            if(reason !== "")
                roomText = roomText !== "" ? roomText + " " + reason : reason;
            roomLabel.getComponent(cc.Label).string = roomText !== "" ? roomText : "—";
        }

        const stone = Number(jItem["stone"] == null ? "" : String(jItem["stone"]).replace(/,/g,""));
        const validStone = !isNaN(stone) && isFinite(stone);
        let countNode = node.getChildByName("count");
        if(validStone)
        {
            const value = Math.trunc(stone);
            countNode.getComponent(cc.Label).string =
                value > 0 ? "+" + value.toString() : value.toString();
        }
        else
            countNode.getComponent(cc.Label).string = "--";

        const balance = panelStonePoolCost.ParseRemarkBalance(jItem["remark"]);
        let nowNode = node.getChildByName("now");
        if(isFinite(balance))
            nowNode.getComponent(cc.Label).string = Math.trunc(balance).toString();
        else
            nowNode.getComponent(cc.Label).string = "--";

        node.getChildByName("time").getComponent(cc.Label).string =
            panelStonePoolCost.FormatTime(jItem["date"]);

        countNode.color = validStone && stone < 0 ?
            new cc.Color(167,231,29,255) :
            (validStone && stone > 0 ? new cc.Color(255,65,52,255) : new cc.Color(239,225,194,255));
        nowNode.color = new cc.Color(239,225,194,255);
    }

    private static FormatTime(raw:any):string
    {
        const date = raw == null ? "" : String(raw);
        const match = date.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})[ T]([0-9]{1,2}):([0-9]{2})/);
        if(match == null)
            return date;
        const month = match[1].length === 1 ? "0" + match[1] : match[1];
        const day = match[2].length === 1 ? "0" + match[2] : match[2];
        const hour = match[3].length === 1 ? "0" + match[3] : match[3];
        return month + "/" + day + " " + hour + ":" + match[4];
    }

    /** 流水 remark 形如「扣费前→扣费后」，取箭头后的余额。 */
    private static ParseRemarkBalance(raw:any):number
    {
        const remark = raw == null ? "" : String(raw);
        const parts = remark.split(/→|->/);
        if(parts.length < 2)
            return NaN;
        const value = Number(parts[parts.length - 1].replace(/[^\d.-]/g,""));
        return isFinite(value) ? value : NaN;
    }

    //--------------------------------------------------------------------------
    // 其它
    //--------------------------------------------------------------------------
    public onHallCommand(nCode:number, param:string)
    {
        if(param == null)
            return;
        if(typeof param !== "string")
        {
            try { param = JSON.stringify(param); }
            catch(error) { return; }
        }

        if(this.currentTab === panelStonePoolCost.TAB_ROOM && this.roomRequestContext !== "" &&
            param.indexOf(this.roomRequestContext) >= 0)
        {
            if(nCode === 0x200)
            {
                this.OnClubStoneWater(param);
                return;
            }
            this.roomPending = false;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                panelStonePoolCost.ExtractError(param,"开房消耗记录查询失败，请稍后重试！"));
            return;
        }

        if(this.currentTab !== panelStonePoolCost.TAB_EXCHANGE || this.requestContext === "")
            return;
        if(param.indexOf(this.requestContext) < 0)
            return;

        if(nCode === 0x200)
        {
            const payload = panelStonePoolCost.NormalizeExchangeList(param);
            if(payload != null)
                this.OnStoneExchangeList(payload);
            return;
        }

        this.pending = false;
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            panelStonePoolCost.ExtractError(param,"钻石兑换记录查询失败，请稍后重试！"));
    }

    private static ExtractError(param:string, fallback:string):string
    {
        try
        {
            let msg:any = JSON.parse(param);
            let data = msg == null ? null : (msg["result"] || msg["ret_result"] || msg);
            const error = data == null || data["error"] == null ? "" : String(data["error"]);
            return error !== "" ? error : fallback;
        }
        catch(error) {}
        return fallback;
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "页签_钻石池兑换")
        {
            this.SelectTab(panelStonePoolCost.TAB_EXCHANGE);
            return;
        }
        if(button.node.name === "页签_开房消耗")
        {
            this.SelectTab(panelStonePoolCost.TAB_ROOM);
            return;
        }
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
