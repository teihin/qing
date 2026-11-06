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
 * 展示大盟主（联盟总群主）给各盟主俱乐部授信/收回额度的记录。
 *
 * 协议（见《俱乐部积分与额度方案-客户端接口文档》§11.2 与
 * 《俱乐部俱乐部联盟模式V2方案-客户端接口文档》§6）：
 *   - 联盟成员：`查询_我的_联盟` → 推送 `ClubMyUnion`
 *     `{union_id, union_name, union_quota, members:[{club_id, club_name, owner_guuid, owner_name, union_quota, union_percent}]}`；
 *   - 额度流水：`查询_俱乐部_额度流水` → 推送 `ClubQuotaWater`，参数 club_id / user_id / count / page / context；
 *     行字段 date / type / quota(分) / remark(变动前→变动后, 分) / guuid / name / actor_guuid / opter_name / room_id。
 *
 * 授信在 `club_history_info` 里落两条：联盟池一条（记在总群主名下，quota 为负）、
 * 目标俱乐部一条（记在盟主名下，quota 为正）。本页按「盟主俱乐部」逐条查第二种，
 * 只保留 `额度联盟授信` / `额度联盟注资` 行；若查不到（权限或成员为空），
 * 回退查自己俱乐部的全量额度流水，展示联盟池侧的扣减记录。
 */
@ccclass
export default class panelQuotaGrantRecord extends UIPanelViewBase
{
    /** 每页条数，与面板表头/行高一致。 */
    private static readonly PAGE_COUNT:number = 10;
    /** 成员俱乐部最多查多少个，避免联盟很大时串行太久。 */
    private static readonly MEMBER_LIMIT:number = 24;
    /** 单个俱乐部一次取多少条流水。 */
    private static readonly QUERY_COUNT:number = 50;
    /** 单个请求超时（秒）。 */
    private static readonly TIMEOUT:number = 8;

    /** 0=空闲 1=查联盟 2=查成员俱乐部 3=回退查自己 */
    private phase:number = 0;

    private scrollWater:ScrollViewEx = null;
    private clubId:string = "";
    private selfId:string = "";
    private selfName:string = "";
    private targets:any[] = [];
    private cursor:number = 0;
    private records:any[] = [];
    private currentPage:number = 0;
    private pendingToken:number = 0;
    /** 当前在途请求的 context；ClubQuotaWater 推送常不带 context，只在带了的时候校验。 */
    private pendingContext:string = "";

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("ClubMyUnion", this, "OnClubMyUnion");
        KBEngine.Event.register("ClubQuotaWater", this, "OnClubQuotaWater");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.RenderPage.bind(this);

        this.LoadRecords();
    }

    //--------------------------------------------------------------------------
    // 取数：联盟成员 → 逐个俱乐部查额度流水
    //--------------------------------------------------------------------------
    private LoadRecords()
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
        this.selfId = account.id == null ? "" : String(account.id);
        this.selfName = account.name == null ? "" : String(account.name);
        this.records = [];
        this.targets = [];
        this.cursor = 0;

        this.QueryUnion();
    }

    private QueryUnion()
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        this.phase = 1;
        const context = "quota-grant:union:" + Date.now();
        this.ArmTimeout(context);

        const strParam = JSON.stringify({
            header:"查询_我的_联盟",
            context:context
        });
        account.reqHallCommand(strParam,"P@" + context);
    }

    /** 收到联盟成员后，逐个成员俱乐部查额度流水。 */
    private QueryNextMember()
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        if(this.cursor >= this.targets.length || this.cursor >= panelQuotaGrantRecord.MEMBER_LIMIT)
        {
            this.Finish();
            return;
        }

        const target = this.targets[this.cursor];
        const context = "quota-grant:member:" + target.club_id + ":" + Date.now();
        this.phase = 2;
        this.ArmTimeout(context);

        const payload:any = {
            header:"查询_俱乐部_额度流水",
            club_id:target.club_id,
            count:panelQuotaGrantRecord.QUERY_COUNT,
            page:0,
            context:context
        };
        // 盟主 ID 缺失时退回俱乐部全量，避免误查成自己。
        payload.user_id = target.owner_guuid == null || String(target.owner_guuid) === "" ?
            "ALL" : String(target.owner_guuid);
        account.reqHallCommand(JSON.stringify(payload),"P@" + context);
    }

    /** 回退：查自己俱乐部全量额度流水，展示联盟池侧的扣减。 */
    private QuerySelfPool()
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        this.phase = 3;
        const context = "quota-grant:self:" + Date.now();
        this.ArmTimeout(context);

        const strParam = JSON.stringify({
            header:"查询_俱乐部_额度流水",
            club_id:this.clubId,
            user_id:"ALL",
            count:panelQuotaGrantRecord.QUERY_COUNT,
            page:0,
            context:context
        });
        account.reqHallCommand(strParam,"P@" + context);
    }

    private ArmTimeout(context:string)
    {
        const token = ++this.pendingToken;
        this.pendingContext = context;
        this.scheduleOnce(()=>{
            if(this.pendingToken !== token)
                return;
            this.OnRequestTimeout();
        },panelQuotaGrantRecord.TIMEOUT);
    }

    private OnRequestTimeout()
    {
        if(this.phase === 1)
        {
            // 联盟信息没回来：退化为查自己俱乐部。
            this.QuerySelfPool();
            return;
        }
        if(this.phase === 2)
        {
            this.cursor++;
            this.QueryNextMember();
            return;
        }
        this.phase = 0;
        this.Finish();
    }

    //--------------------------------------------------------------------------
    // 回包
    //--------------------------------------------------------------------------
    public OnClubMyUnion(strMsg:any,secondaryRaw?:any)
    {
        // KBEngine 偶尔以 (nCode, strMsg) 形式派发，沿用 ClubManagementApi 的兼容写法。
        if(secondaryRaw !== undefined && (typeof strMsg === "number" || typeof strMsg === "boolean"))
            strMsg = secondaryRaw;
        if(this.phase !== 1)
            return;

        const candidates = panelQuotaGrantRecord.Unwrap(strMsg);
        if(!this.MatchContext(candidates))
            return;

        let members:any[] = [];
        let found:boolean = false;
        for(const candidate of candidates)
        {
            if(candidate == null || typeof candidate !== "object" || Array.isArray(candidate))
                continue;
            const info:any = candidate["ClubMyUnion"] != null ? candidate["ClubMyUnion"] : candidate;
            if(info != null && Array.isArray(info["members"]))
            {
                members = info["members"];
                found = true;
                break;
            }
        }
        // 没有 members 的不是盟友列表推送（例如只带 union_name 的通知），继续等在途回包。
        if(!found)
            return;

        this.targets = [];
        for(const member of members)
        {
            if(member == null)
                continue;
            const memberClub = member["club_id"] == null ? "" : String(member["club_id"]);
            // 自己俱乐部那条是联盟池视角，不重复算一次授信。
            if(memberClub === "" || memberClub === this.clubId)
                continue;
            this.targets.push({
                club_id:memberClub,
                owner_guuid:member["owner_guuid"],
                owner_name:member["owner_name"] == null ? "" : String(member["owner_name"])
            });
        }

        if(this.targets.length === 0)
        {
            this.QuerySelfPool();
            return;
        }

        this.cursor = 0;
        this.QueryNextMember();
    }

    public OnClubQuotaWater(strMsg:any,secondaryRaw?:any)
    {
        if(secondaryRaw !== undefined && (typeof strMsg === "number" || typeof strMsg === "boolean"))
            strMsg = secondaryRaw;
        if(this.phase !== 2 && this.phase !== 3)
            return;

        const phase = this.phase;
        const target = phase === 2 ? this.targets[this.cursor] : null;
        const candidates = panelQuotaGrantRecord.Unwrap(strMsg);
        // 明确带 context 但不是本次请求的推送，属于别的页面，不能让游标前移。
        if(!this.MatchContext(candidates))
            return;

        let rows:any[] = null;
        for(const candidate of candidates)
        {
            if(Array.isArray(candidate))
            {
                rows = candidate;
                break;
            }
            if(candidate != null && Array.isArray(candidate["ClubQuotaWater"]))
            {
                rows = candidate["ClubQuotaWater"];
                break;
            }
        }
        if(rows != null)
            this.Collect(rows,phase === 2 ? (target ? target.owner_name : "") : "联盟池",phase === 3);

        if(phase === 2)
        {
            this.cursor++;
            this.QueryNextMember();
            return;
        }

        this.phase = 0;
        this.Finish();
    }

    private Collect(rows:any[],ownerName:string,allowPoolInject:boolean = false)
    {
        for(const row of rows)
        {
            if(row == null || typeof row !== "object")
                continue;

            const type = row["type"] == null ? "" : String(row["type"]);
            if(!panelQuotaGrantRecord.IsGrantType(type,allowPoolInject))
                continue;

            const quota = panelQuotaGrantRecord.ToNumber(row["quota"]);
            if(!isFinite(quota) || quota === 0)
                continue;

            const name = ownerName !== "" ? ownerName :
                (row["name"] != null && String(row["name"]).trim() !== "" ?
                    String(row["name"]).trim() : String(row["guuid"] == null ? "" : row["guuid"]));

            this.records.push({
                date:String(row["date"] == null ? "" : row["date"]),
                quota:quota,
                balance:panelQuotaGrantRecord.TailBalance(row["remark"]),
                name:name,
                type:type
            });
        }
    }

    private Finish()
    {
        this.phase = 0;

        if(this.records.length === 0 && this.selfId !== "")
        {
            // 成员侧没有数据（权限不足或确实没授信）：改为看自己俱乐部的池侧记录。
            if(this.targets.length > 0)
            {
                this.targets = [];
                this.QuerySelfPool();
                return;
            }
        }

        this.records.sort((a:any,b:any)=>{
            if(a.date === b.date)
                return 0;
            return a.date < b.date ? 1 : -1;
        });

        this.currentPage = 0;
        this.RenderPage(0);
    }

    //--------------------------------------------------------------------------
    // 列表
    //--------------------------------------------------------------------------
    /** 本地数据分页：PageEx 翻页时按页码切片喂给 ScrollViewEx。 */
    private RenderPage(nPage:number)
    {
        if(this.scrollWater == null)
            return;

        const len = panelQuotaGrantRecord.PAGE_COUNT;
        const total = this.records.length;
        const totalPage = Math.max(1,Math.ceil(total / len));
        let page = isFinite(nPage) ? Math.floor(nPage) : 0;
        page = Math.max(0,Math.min(page,totalPage - 1));
        this.currentPage = page;

        const rows:any[] = [];
        const start = page * len;
        for(let i = start; i < Math.min(start + len,total); i++)
        {
            const item = this.records[i];
            rows.push({
                date:item.date,
                quota:item.quota,
                balance:item.balance,
                name:item.name,
                type:item.type,
                number:page,
                count:total
            });
        }

        const payload:any = {};
        payload["额度授权记录"] = rows;
        payload["number"] = page;
        payload["count"] = total;
        this.scrollWater.UpdateList(JSON.stringify(payload),"额度授权记录","额度授权记录对象",
            len,this.SetRowInfo.bind(this));
    }

    /** 行：时间 / 盟主 / 授权额度 / 余额。 */
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        const nameNode = node.getChildByName("type");
        if(nameNode != null)
            nameNode.getComponent(cc.Label).string =
                jItem["name"] == null || String(jItem["name"]) === "" ? "—" : String(jItem["name"]);

        const quota = Number(jItem["quota"]);
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
            // remark 里的余额单位是分，和「授权额度」一样换算成元后展示。
            const balanceFen = Number(jItem["balance"]);
            nowNode.getComponent(cc.Label).string = jItem["balance"] == null ||
                String(jItem["balance"]) === "" || !isFinite(balanceFen) ?
                "--" : panelQuotaGrantRecord.Money(balanceFen / 100);
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
    private static IsGrantType(type:string,allowPoolInject:boolean = false):boolean
    {
        if(type === "")
            return false;
        // V2「额度联盟授信」、旧模型「额度授信 / 额度收回」；正数增加、负数收回都要显示。
        if(type.indexOf("授信") >= 0 || type.indexOf("收回") >= 0 || type.indexOf("授权") >= 0)
            return true;
        // 「额度联盟注资 / 额度转入」是平台注资到联盟池，只在回退看池侧流水时纳入。
        return allowPoolInject && (type.indexOf("注资") >= 0 || type.indexOf("转入") >= 0);
    }

    private static ToNumber(value:any):number
    {
        if(value == null)
            return NaN;
        const text = String(value).replace(/,/g,"").trim();
        if(text === "")
            return NaN;
        return Number(text);
    }

    /** `remark` 可能是纯数字余额，也可能是 `5015000→5065000` / `联盟池A→B`，取变动后余额（分）。 */
    private static TailBalance(value:any):number
    {
        if(value == null)
            return NaN;
        const text = String(value).trim();
        if(text === "")
            return NaN;
        const parts = text.split(/→|->/);
        const tail = parts.length > 0 ? parts[parts.length - 1] : text;
        const cleaned = String(tail).replace(/[^0-9.\-]/g,"");
        if(cleaned === "" || cleaned === "-" || cleaned === ".")
            return NaN;
        const num = Number(cleaned);
        return isFinite(num) ? num : NaN;
    }

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

    /**
     * 摊平回包：KBEngine 可能给 JSON 字符串、裸数组、裸对象、`result` / `ret_result` 包裹，
     * 也可能把列表再包一层同名 key。返回所有候选，调用方按需要的结构挑一个。
     */
    private static Unwrap(strMsg:any):any[]
    {
        const list:any[] = [];
        if(strMsg == null || strMsg === "")
            return list;

        let data:any = strMsg;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return list; }
        }
        if(data == null || typeof data !== "object")
            return list;
        list.push(data);

        const scan = (obj:any)=>{
            if(obj == null || typeof obj !== "object")
                return;
            for(const key of ["result","ret_result","ClubQuotaWater","ClubMyUnion"])
            {
                let value:any = obj[key];
                if(value == null)
                    continue;
                if(typeof value === "string")
                {
                    try { value = JSON.parse(value); }
                    catch(error) {}
                }
                if(value == null)
                    continue;
                list.push(value);
                if(value != null && typeof value === "object" && !Array.isArray(value))
                {
                    for(const nested of ["result","ret_result"])
                    {
                        let inner:any = value[nested];
                        if(inner == null)
                            continue;
                        if(typeof inner === "string")
                        {
                            try { inner = JSON.parse(inner); }
                            catch(error) {}
                        }
                        if(inner != null)
                            list.push(inner);
                    }
                }
            }
        };
        scan(data);
        for(const item of list.slice())
            scan(item);
        return list;
    }

    /**
     * 推送常常不带 context；带了就必须与在途请求一致，避免别的页面的同名推送串进来。
     * 同步回包里的 context 可能被写成 `p@xxx` / `P@xxx`。
     */
    private MatchContext(candidates:any[]):boolean
    {
        let seen:boolean = false;
        for(const candidate of candidates)
        {
            if(candidate == null || typeof candidate !== "object" || Array.isArray(candidate))
                continue;
            const raw = candidate["context"];
            if(raw == null || String(raw).trim() === "")
                continue;
            seen = true;
            const value = String(raw).trim().replace(/^[pP]@/,"");
            if(value === this.pendingContext || value.indexOf(this.pendingContext) >= 0)
                return true;
        }
        // 完全没带 context：与 ClubManagementApi 一样按串行在途请求配对。
        return !seen;
    }

    //--------------------------------------------------------------------------
    // 错误与按钮
    //--------------------------------------------------------------------------
    public onHallCommand(nCode:number, param:string)
    {
        if(this.phase === 0 || param == null)
            return;

        let text = param;
        if(typeof text !== "string")
        {
            try { text = JSON.stringify(text); }
            catch(error) { return; }
        }
        if(text.indexOf("quota-grant:") < 0)
            return;

        // 迟到回包不能推动串行游标：只认当前在途请求的 context。
        let msg:any = null;
        try { msg = JSON.parse(text); }
        catch(error) { return; }
        const replyContext = msg == null || msg["context"] == null ?
            "" : String(msg["context"]).trim().replace(/^[pP]@/,"");
        if(replyContext !== "" && replyContext !== this.pendingContext)
            return;

        let data:any = msg;
        if(data != null && typeof data["result"] === "string")
        {
            try { data = JSON.parse(data["result"]); }
            catch(error) {}
        }
        const strError = data == null || data["error"] == null ? "" : String(data["error"]);
        // 0x200 最终成功、0x500 已受理；列表本身走推送，超时器负责兜底。
        if(strError === "" && (nCode === 0x200 || nCode === 0x500))
            return;

        if(this.phase === 1)
        {
            // 没有联盟（或查询失败）：退化为查自己俱乐部的额度流水。
            this.QuerySelfPool();
            return;
        }

        if(this.phase === 2)
        {
            // 单个成员查不到（权限/无数据）不打断整个列表。
            this.cursor++;
            this.QueryNextMember();
            return;
        }

        this.phase = 0;
        if(strError !== "")
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strError);
        else
            this.RenderPage(0);
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
