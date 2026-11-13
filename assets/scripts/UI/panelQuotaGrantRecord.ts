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
 * 协议（《俱乐部俱乐部联盟模式V2方案-客户端接口文档》§8.1，2026-11-09 新增）：
 *   Hall 命令 `查询_联盟_授信_记录`，参数 club_id(可省，空串同省) / count / page / context；
 *   同步回包只有空壳，列表经 `ClubUnionGrantList` 推送。
 *   club_id 为空时服务端按身份取范围：总群主看全联盟，盟主看自己名下俱乐部。
 *   行字段：number / count（真实总条数，不封顶）/ date / type（授信/收回/注资/注资扣减）/
 *   quota（有符号变动额，分）/ quota_after（变动后余额，分；remark 与它同值）/ club_id / club_name /
 *   guuid / name（额度归属账号）/ opter_guuid / opter_name / is_inject / is_self。
 *
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

        KBEngine.Event.register("ClubUnionGrantList", this, "OnGrantList");
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
        this.requestContext = "club:union-grant:" + clubId + ":" + nPage + ":" + Date.now();

        const strParam = JSON.stringify({
            header:"查询_联盟_授信_记录",
            // 空串 = 按身份取范围：总群主看全联盟，盟主看自己名下俱乐部。
            club_id:"",
            count:panelQuotaGrantRecord.PAGE_COUNT,
            page:nPage,
            context:this.requestContext
        });
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    public OnGrantList(strMsg:any,secondaryRaw?:any)
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
        const rows = data["ClubUnionGrantList"];
        let pageNumber:any = data["number"];
        if((pageNumber == null || pageNumber === "") && Array.isArray(rows) && rows.length > 0)
            pageNumber = rows[0]["number"];
        if(pageNumber != null && pageNumber !== "")
        {
            const page = Number(pageNumber);
            if(isFinite(page) && page !== this.requestedPage)
                return;
        }

        this.scrollWater.UpdateList(payload,"ClubUnionGrantList","额度授权记录对象",
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

        if(Array.isArray(data["ClubUnionGrantList"]))
            return JSON.stringify(data);

        const result = data["result"];
        if(result != null && Array.isArray(result["ClubUnionGrantList"]))
            return JSON.stringify(result);

        const retResult = data["ret_result"];
        if(retResult != null && Array.isArray(retResult["ClubUnionGrantList"]))
            return JSON.stringify(retResult);

        return null;
    }

    /** 行：时间 / 盟主 / 授权额度 / 余额。 */
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const type = jItem["type"] == null ? "" : String(jItem["type"]).trim();
        const isInject = Number(jItem["is_inject"]) === 1 || type.indexOf("注资") >= 0;
        const nameNode = node.getChildByName("type");
        if(nameNode != null)
        {
            let name = isInject ? "联盟池" : String(jItem["name"] == null ? "" : jItem["name"]).trim();
            if(name === "" && !isInject)
                name = String(jItem["club_name"] == null ? "" : jItem["club_name"]).trim();
            nameNode.getComponent(cc.Label).string = name === "" ? "—" : name;
        }

        // 服务端 type（授信/收回/注资/注资扣减/额度奖励）直接展示在盟主名下方。
        const typeNode = node.getChildByName("typelabel");
        if(typeNode != null)
        {
            typeNode.active = true;
            const label = typeNode.getComponent(cc.Label);
            if(label != null)
                label.string = type === "" ? "类型：—" : "类型：" + type;
        }

        // 服务端 type 已按正负号定好（授信/收回/注资/注资扣减），这里只按 quota 符号着色。
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
            // quota_after 是变动后余额，单位分；remark 与它同值，兼容只带 remark 的回包。
            const rawAfter = jItem["quota_after"] == null || String(jItem["quota_after"]).trim() === "" ?
                jItem["remark"] : jItem["quota_after"];
            const afterFen = Number(String(rawAfter == null ? "" : rawAfter).replace(/,/g,""));
            nowNode.getComponent(cc.Label).string = rawAfter == null ||
                String(rawAfter).trim() === "" || !isFinite(afterFen) ?
                "--" : panelQuotaGrantRecord.Money(afterFen / 100);
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

        // 0x200 最终成功、0x500 已受理：有列表就先用，没有则等 ClubUnionGrantList 推送。
        if(nCode === 0x200 || nCode === 0x500)
        {
            const payload = panelQuotaGrantRecord.NormalizeList(text);
            if(payload != null)
                this.OnGrantList(payload);
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
            strError !== "" ? strError : "授信记录查询失败，请稍后重试！");
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
