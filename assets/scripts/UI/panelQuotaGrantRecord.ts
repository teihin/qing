import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import { normalizeRoomClubId, normalizeRoomUnionId, resolveRoomClubId, resolveRoomSettingUnionId } from "../logic/RoomClubContext";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 「我的 → 额度授权记录」。
 *
 * 协议（《俱乐部·联盟模式 V2 客户端接口文档》§8.1）：
 *   Hall 命令 `查询_联盟_授信_记录`，参数 club_id / union_id / count / page / context；
 *   **club_id 与 union_id 都带**：club_id 是当前俱乐部、union_id 是它所属联盟，
 *   服务端两个都用来定位授信流水（缺了会按账号默认俱乐部猜，多俱乐部账号就会「找不到」）。
 *   范围仍由服务端按身份决定 —— 联盟总群主（含 `union_manage` 授权账号）看全联盟，
 *   盟主只看自己名下的俱乐部，平台 boss/bigboss 另需身份标记（客户端没有，不传）。
 *   入口 strUserData 传 `{"club_id":"...","union_id":"..."}`（JSON，同 panelClubPlayerInfo）。
 *   列表经 `ClubUnionGrantList` 推送，只有最近 3 个自然日的授信 / 收回 / 平台注资 / 额度奖励四类。
 *   行字段：number / count / date / type（授信、收回、注资、注资扣减、额度奖励，服务端按符号给中文）/
 *   quota（分，有符号变动额）/ quota_after（分，变动后余额）/ remark（与 quota_after 同值）/
 *   club_id / club_name（目标俱乐部，注资与奖励池侧为空）/ guuid / name（额度归属账号）/
 *   opter_guuid / opter_name（实际操作人）/ is_inject / is_reward / is_self。
 *
 * 分页走服务端：每页条数与面板行数一致，翻页时重新请求并带上页码。
 */
@ccclass
export default class panelQuotaGrantRecord extends UIPanelViewBase
{
    /** 每页条数，与面板表头/行高一致。 */
    private static readonly PAGE_COUNT:number = 10;
    /** 授信记录推送路由。 */
    private static readonly LIST_KEY:string = "ClubUnionGrantList";

    private scrollWater:ScrollViewEx = null;
    private requestContext:string = "";
    private requestedPage:number = 0;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register(panelQuotaGrantRecord.LIST_KEY, this, "OnUnionGrantList");
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

        const entry = this.ReadEntry();
        const clubId = this.ResolveClubId(account,entry.clubId);
        const unionId = this.ResolveUnionId(account,entry.unionId);
        this.requestedPage = nPage;
        this.requestContext = "union:grant-list:" + (clubId === "" ? "-" : clubId) +
            ":" + (unionId === "" ? "-" : unionId) + ":" + nPage + ":" + Date.now();

        const param:any = {
            header:"查询_联盟_授信_记录",
            count:panelQuotaGrantRecord.PAGE_COUNT,
            page:nPage,
            context:this.requestContext
        };
        // 俱乐部 + 联盟都带：服务端靠这两个定位授信范围，缺一个就只能按账号默认俱乐部猜。
        if(clubId !== "")
            param.club_id = clubId;
        if(unionId !== "")
            param.union_id = unionId;
        const strParam = JSON.stringify(param);
        account.reqHallCommand(strParam,"P@" + this.requestContext);
    }

    /**
     * 入口参数：`{"club_id":"...","union_id":"..."}`（panelMain 已经算好，两边口径一致）。
     * 兼容纯字符串：6 位数字按 club_id 处理。
     */
    private ReadEntry():{clubId:string;unionId:string}
    {
        const result = { clubId:"", unionId:"" };
        const raw = this.strUserData == null ? "" : String(this.strUserData).trim();
        if(raw === "")
            return result;

        if(raw.charAt(0) === "{")
        {
            try
            {
                const data:any = JSON.parse(raw);
                if(data != null && typeof data === "object")
                {
                    result.clubId = normalizeRoomClubId(data["club_id"] || data["clubId"]);
                    result.unionId = normalizeRoomUnionId(data["union_id"] || data["unionId"]);
                }
            }
            catch(error) {}
            return result;
        }

        result.clubId = normalizeRoomClubId(raw);
        return result;
    }

    /** 当前俱乐部：入口没给就按大厅当前选中俱乐部解析。 */
    private ResolveClubId(account:any,fromEntry:string):string
    {
        if(fromEntry !== "")
            return fromEntry;
        return resolveRoomClubId(account);
    }

    /**
     * 当前俱乐部所在联盟：入口没给就退回房间 setting 里的 union_id（联盟共享房才有）。
     * 都拿不到返回空串，报文就不带 union_id，交服务端按身份兜底。
     */
    private ResolveUnionId(account:any,fromEntry:string):string
    {
        if(fromEntry !== "")
            return fromEntry;
        return resolveRoomSettingUnionId(account);
    }

    public OnUnionGrantList(strMsg:any,secondaryRaw?:any)
    {
        // KBEngine 偶尔以 (nCode, strMsg) 形式派发，沿用 ClubManagementApi 的兼容写法。
        if(secondaryRaw !== undefined && (typeof strMsg === "number" || typeof strMsg === "boolean"))
            strMsg = secondaryRaw;
        if(this.scrollWater == null)
            return;
        if(GameDataManager.getAccount() == null)
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
        const rows = data[panelQuotaGrantRecord.LIST_KEY];
        let pageNumber:any = data["number"];
        if((pageNumber == null || pageNumber === "") && Array.isArray(rows) && rows.length > 0)
            pageNumber = rows[0]["number"];
        if(pageNumber != null && pageNumber !== "")
        {
            const page = Number(pageNumber);
            if(isFinite(page) && page !== this.requestedPage)
                return;
        }

        this.scrollWater.UpdateList(payload,panelQuotaGrantRecord.LIST_KEY,"额度授权记录对象",
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

        const key = panelQuotaGrantRecord.LIST_KEY;
        if(Array.isArray(data[key]))
            return JSON.stringify(data);

        const result = data["result"];
        if(result != null && Array.isArray(result[key]))
            return JSON.stringify(result);

        const retResult = data["ret_result"];
        if(retResult != null && Array.isArray(retResult[key]))
            return JSON.stringify(retResult);

        return null;
    }

    /**
     * 行：时间 / 归属人（下方一行「类型 · 俱乐部 · 触发人」）/ 变动额 / 变动后余额。
     */
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const type = panelQuotaGrantRecord.Text(jItem["type"]);
        // 额度归属账号（授信/奖励目标侧是盟主，注资/奖励池侧是总群主）与实际触发人是两个人：
        // 上面显示归属人，下面一行补类型和触发人，否则只看得到盟主、看不出这笔额度是谁引发的。
        const owner = panelQuotaGrantRecord.Text(jItem["name"]);
        const opter = panelQuotaGrantRecord.Text(jItem["opter_name"]);
        // 总群主看全联盟时，同一页会混着多家俱乐部，必须把目标俱乐部带出来。
        const clubName = panelQuotaGrantRecord.Text(jItem["club_name"]);

        const nameNode = node.getChildByName("type");
        if(nameNode != null)
        {
            const name = owner !== "" ? owner : (clubName !== "" ? clubName : opter);
            nameNode.getComponent(cc.Label).string = name === "" ? "—" : name;
        }

        const typeNode = node.getChildByName("typelabel");
        if(typeNode != null)
        {
            typeNode.active = true;
            const label = typeNode.getComponent(cc.Label);
            if(label != null)
            {
                const parts:string[] = [type === "" ? "—" : type];
                if(clubName !== "")
                    parts.push(clubName);
                // 触发人与归属人是同一人（自己给自己授信）时不重复显示。
                if(opter !== "" && opter !== owner)
                    parts.push(opter);
                label.string = parts.join(" · ");
            }
        }

        // quota 是带符号变动额（分）：收回/注资扣减为负，授信/注资/奖励为正。
        const quotaText = panelQuotaGrantRecord.Text(jItem["quota"]).replace(/,/g,"");
        const quota = Number(quotaText);
        const valid = quotaText !== "" && isFinite(quota);
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
            const afterFen = panelQuotaGrantRecord.AfterFen(jItem);
            nowNode.getComponent(cc.Label).string = isFinite(afterFen) ?
                panelQuotaGrantRecord.Money(afterFen / 100) : "--";
            nowNode.color = new cc.Color(239,225,194,255);
        }

        const timeNode = node.getChildByName("time");
        if(timeNode != null)
            timeNode.getComponent(cc.Label).string = panelQuotaGrantRecord.FormatDate(panelQuotaGrantRecord.Text(jItem["date"]));

        for(const key of ["in","out","game","stone","quota"])
        {
            const icon = node.getChildByName("V8类型图标_" + key);
            if(icon != null)
                icon.active = key === "quota";
        }
    }

    /** 字段转成去空白的字符串；null/undefined 给空串。 */
    private static Text(raw:any):string
    {
        return raw == null ? "" : String(raw).trim();
    }

    /**
     * 变动后余额（分）：授信记录直接给 `quota_after`；`remark` 与它同值，
     * 老服务端若只回「旧→新」格式则取箭头后半段。
     */
    private static AfterFen(jItem:any):number
    {
        const raw = panelQuotaGrantRecord.Text(jItem["quota_after"]);
        if(raw !== "")
        {
            const fen = Number(raw.replace(/[,，\s]/g,""));
            if(isFinite(fen))
                return fen;
        }
        return panelQuotaGrantRecord.BalanceFen(jItem["remark"]);
    }

    private static BalanceFen(raw:any):number
    {
        let text = panelQuotaGrantRecord.Text(raw);
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

        // 0x200 最终成功、0x500 已受理：有列表就先用，没有则等 ClubUnionGrantList 推送。
        if(nCode === 0x200 || nCode === 0x500)
        {
            const payload = panelQuotaGrantRecord.NormalizeList(text);
            if(payload != null)
                this.OnUnionGrantList(payload);
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
