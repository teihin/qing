import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ImageManager from "../logic/ImageManager";
import panelClubPlayerInfo from "./panelClubPlayerInfo";
import { normalizeRoomClubId, resolveMyRoomClubId, resolveRoomSettingClubId } from "../logic/RoomClubContext";
var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

/**
 * 一行业务数据：与接口文档 §3.2 一一对应。
 * 每行 9 个统计字段 = 今日/昨日/累计 × 输赢/贡献/红利，全部来自
 * `查询_俱乐部_成员_代理链路` 这一条命令，客户端不另发请求。
 */
interface BossChainRow {
    guuid:string;
    name:string;
    /** 行内自己的俱乐部：联盟里一条链上的不同行可能分属不同俱乐部，以行内为准。 */
    clubId:string;
    clubName:string;
    isCreator:boolean;
    isUnionOwner:boolean;
    score:string;
    contribFen:string;
    bonusFen:string;
    todayScore:string;
    yesterdayScore:string;
    todayContribFen:string;
    yesterdayContribFen:string;
    todayBonusFen:string;
    yesterdayBonusFen:string;
}

/** 新接口按俱乐部返回多条链；每条链带自己的 club_id / club_name。 */
interface BossChainGroup {
    clubId:string;
    clubName:string;
    rows:BossChainRow[];
}

/**
 * BOSS 玩家数据全屏面板（多页签，当前实现「代理链」）。
 *
 * 复用入口：
 *   UIManager.showPanel("panelBossPlayerInfo", ShowPanelMode.Cover, "", [playerLogic]);
 * 或直接传 JSON：
 *   UIManager.showPanel("panelBossPlayerInfo", ShowPanelMode.Cover,
 *       JSON.stringify({userId:"123456",clubId:"654321",name:"昵称",role:"合伙人"}));
 *
 * 牌桌内点击头像由 panelGameView 按 BOSS 身份决定是否走这里；其它页面
 * 只要按上面两种入参打开即可复用同一 Prefab。
 */
@ccclass
export default class panelBossPlayerInfo extends UIPanelViewBase {

    private static serial:number = 0;

    /**
     * 通用打开入口（任何界面都能用）：
     *   panelBossPlayerInfo.Open()                     // 空白进来，手动输 ID/昵称查
     *   panelBossPlayerInfo.Open(userId, clubId)       // 直接查这个玩家的代理链
     * 服务端仍按平台 boss 名单鉴权。
     */
    public static Open(userId:string = "", clubId:string = "", userName:string = "", role:string = ""):void {
        UIManager.getInstance().showPanel("panelBossPlayerInfo", ShowPanelMode.Cover,
            JSON.stringify({userId:userId, clubId:clubId, name:userName, role:role}));
    }

    private userId:string = "";
    private userClubId:string = "";
    private userName:string = "";
    private userRole:string = "";
    private userPhoto:string = "";
    /** 本次链路是否属于联盟；已入盟俱乐部的创建者显示“盟主”而不是“群主”。 */
    private inUnion:boolean = false;
    /** 推送顶层的联盟名：有联盟时分组标题用它，没有才用俱乐部名。 */
    private unionName:string = "";
    /** 当前房间归属俱乐部：被点玩家没有 req_club_id 时兜底。 */
    private roomClubId:string = "";

    private currentTab:string = "info";
    private infoLoaded:boolean = false;
    private infoContext:string = "";
    /** 本次玩家信息查询是否用了 stat_scope=self（只有单成员查询支持）。 */
    private infoSelf:boolean = false;
    private static infoSerial:number = 0;
    private chainLoaded:boolean = false;
    private loading:boolean = false;
    private pending:boolean = false;
    private requestContext:string = "";
    private timeoutTimer:any = null;
    private retryCount:number = 0;
    private clubFallbackTried:boolean = false;
    /** 按名字搜索时用的 context / 关键字，回包只认自己这一条。 */
    private searchContext:string = "";
    private searchKey:string = "";
    private static searchSerial:number = 0;

    // 本面板只发 `查询_俱乐部_成员_代理链路` 一条命令，不额外调用 `查询_俱乐部_成员`：
    // 团队人数/今日昨日等列若接口没下发就是“—”，由服务端在链路接口里补齐。
    onLoad () {
        super.onLoad();
        // 牌桌按钮在 panelGameView.onLoad 时就注册了触摸，晚创建的全屏面板必须靠 zIndex
        // 稳定压在牌桌之上，否则点头像后仍可能被下层按钮抢走（参见 cocos-touch-passthrough-fix）。
        this.node.zIndex = 200;
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ClubMemberAgentChain", this, "OnAgentChain");
        // 按昵称搜索先查成员列表拿 guuid，回包走 NumberList。
        KBEngine.Event.register("NumberList", this, "OnMemberList");
    }

    start () {
        this.ReadInput();
        // 点头像进来默认看「玩家信息」，并自动查这个人。
        this.ShowTab("info", true);
        if(this.userId === "")
            this.ShowGuide();
        else
            this.QueryInfo(this.userId);
    }

    onDestroy () {
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 入参
    // ------------------------------------------------------------------
    private ReadInput():void {
        const player:any = this.arrayEx && this.arrayEx.length > 0 ? this.arrayEx[0] : null;
        if(player != null && player.info != null) {
            this.userId = String(player.info.strUserID || "").trim();
            this.userName = String(player.info.strUserName || "").trim();
            this.userRole = String(player.info.role || "").trim();
            this.userPhoto = String(player.info.strPhoto || "").trim();
            const reqClubId = normalizeRoomClubId(player.info.req_club_id);
            const account:any = GameDataManager.getAccount();
            this.roomClubId = resolveRoomSettingClubId(account);
            const isSelf = account != null && this.userId === String(account.guuid || "");
            this.userClubId = isSelf ? resolveMyRoomClubId(account, reqClubId) :
                (reqClubId || resolveMyRoomClubId(account, ""));
            if(this.userClubId === "")
                this.userClubId = this.roomClubId;
            return;
        }

        try {
            const data:any = JSON.parse(this.strUserData || "{}");
            this.userId = String(data.userId || data.user_id || "").trim();
            this.userName = String(data.name || data.userName || "").trim();
            this.userRole = String(data.role || "").trim();
            this.userPhoto = String(data.photo || "").trim();
            const account:any = GameDataManager.getAccount();
            this.roomClubId = resolveRoomSettingClubId(account);
            const reqClubId = normalizeRoomClubId(data.clubId || data.club_id);
            this.userClubId = reqClubId || resolveMyRoomClubId(account, "");
            if(this.userClubId === "")
                this.userClubId = this.roomClubId;
        }
        catch(error) {
            this.userId = "";
        }
    }

    /** 链路身份以接口 flag 为准。 */
    private UserRoleText():string {
        const raw = this.userRole.trim();
        if(raw === "")
            return "";
        const key = raw.toLowerCase();
        if(["agent","leader","代理","合伙人"].indexOf(key) >= 0)
            return "合伙人";
        if(["manager","管理员"].indexOf(key) >= 0)
            return "管理员";
        if(["union_owner","unionowner","大盟主","总群主"].indexOf(key) >= 0)
            return "总群主";
        if(["owner","老板","创建者","群主"].indexOf(key) >= 0)
            return this.inUnion ? "盟主" : "群主";
        if(key === "盟主")
            return "盟主";
        return raw;
    }

    // ------------------------------------------------------------------
    // 请求
    // ------------------------------------------------------------------
    /**
     * 玩家信息页签：按 ID（count=1）或昵称（search_name_id，count=50，便于以后批量）查成员数据。
     */
    private QueryInfo(key:string):void {
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowError("网络未就绪，请稍后重试");
            return;
        }
        const numeric = /^\d+$/.test(key);
        const clubId = this.userClubId || this.roomClubId;
        if(clubId === "" && !numeric) {
            this.ShowError("缺少俱乐部信息，无法按昵称搜索，请直接输入玩家ID");
            return;
        }
        this.infoContext = "bossinfo:" + Date.now() + ":" + (++panelBossPlayerInfo.infoSerial);
        this.pending = true;
        this.ShowLoading();
        if(this.timeoutTimer != null)
            clearTimeout(this.timeoutTimer);
        // 服务端没回包时别把「加载中」永远挂在那儿。
        this.timeoutTimer = setTimeout(()=>{
            if(this.infoContext === "")
                return;
            this.infoContext = "";
            this.pending = false;
            this.ShowError("查询超时，请稍后重试");
        }, 10000);
        const param:any = {
            header:"查询_俱乐部_成员",
            page:"0",
            context:this.infoContext
        };
        if(clubId !== "")
            param.club_id = clubId;
        this.infoSelf = numeric;
        if(numeric) {
            param.user_id = key;
            param.count = "1";
            // v2.18：单成员查询切「本人」口径，六项统计不再含下线；
            // v2.19：联盟内会按俱乐部返回多行。
            param.stat_scope = "self";
        }
        else {
            param.search_name_id = key;
            param.count = "50";
        }
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.infoContext);
        }
        catch(error) {
            this.ShowError("请求发送失败，请稍后重试");
        }
    }

    /** 玩家信息列表：一行一个玩家，字段取成员接口的统计数据。 */
    private RenderInfoRows(rows:any[]):void {
        this.infoLoaded = true;
        this.pending = false;
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        const list = this.At("列表");
        const content = list ? Tool.GetChild(list, "view/content") : null;
        const rowTemplate = content ? content.getChildByName("行模板") : null;
        if(content == null || rowTemplate == null) {
            this.ShowError("界面资源缺失，请重新打开");
            return;
        }
        for(const child of content.children.slice()) {
            if(child.name.indexOf("玩家_") === 0)
                child.destroy();
        }
        rowTemplate.active = false;
        this.Active("加载", false);
        this.Active("错误", false);
        this.Active("列表面板", true);
        this.Active("列表", true);
        this.Active("说明", true);

        if(rows.length === 0) {
            this.Text("空状态", "没有查到该玩家的数据");
            this.Active("空状态", true);
            return;
        }
        this.Active("空状态", false);

        const rowHeight = rowTemplate.height;
        const pitch = rowHeight + 12;
        let y = 0;
        for(const one of rows) {
            const row = cc.instantiate(rowTemplate);
            row.name = "玩家_" + String(one && (one.guuid || one.user_id) || "");
            row.parent = content;
            row.active = true;
            row.setPosition(0, y - rowHeight / 2);
            this.FillInfoRow(row, one);
            y -= pitch;
        }
        const view = list.getChildByName("view");
        if(view) {
            content.height = Math.max(view.height, -y + 4);
            content.setPosition(0, view.height / 2);
        }
        const scrollView = list.getComponent(cc.ScrollView);
        if(scrollView)
            scrollView.scrollToTop(0);
    }

    private FillInfoRow(row:cc.Node, data:any):void {
        const t = (v:any):string => String(v == null ? "" : v).trim();
        const id = t(data.guuid || data.user_id);
        this.Text("姓名", t(data.name) || ("玩家 " + id), row);
        this.Text("玩家ID", "ID: " + id, row);
        const role = t(data.role);
        this.Text("身份", role !== "" ? role : "成员", row);
        const clubId = t(data.club_id);
        this.Text("俱乐部", t(data.club_name) || clubId, row);

        // 玩家信息页签走 stat_scope=self，统计口径是「个人」，与代理链的「团队」区分。
        this.Text("统计口径/文字", "个人", row);

        // 俱乐部积分单独一行放左栏。
        const clubGold = t(data.club_gold);
        const goldNode = this.At("积分", row);
        if(goldNode) {
            goldNode.active = true;
            this.Text("积分", "积分 " + (clubGold === "" ? "—" : clubGold), row);
        }

        // 比例 / 暗扣 合一行放左栏最下面。
        const parts:string[] = [];
        const percent = t(data.percent);
        const dark = t(data.dark_percent);
        const isLeaderRow = t(data.role) === "盟主" || t(data.is_leader) === "1";
        if(percent !== "" && percent !== "0")
            parts.push((isLeaderRow ? "盟主" : "比例") + percent + "%");
        if(dark !== "" && dark !== "0" && dark !== "-1")
            parts.push("暗扣" + dark + "%");
        const extraNode = this.At("附加信息", row);
        if(extraNode) {
            extraNode.active = parts.length > 0;
            this.Text("附加信息", parts.join(" · "), row);
        }
        this.SetScore("今日输赢值", t(data.today_score), row);
        this.SetScore("昨日输赢值", t(data.yesterday_score), row);
        this.SetScore("总输赢值", t(data.total_score), row);
        this.Text("今日贡献值", this.FenText(t(data.today_contrib_fen)), row);
        this.Text("昨日贡献值", this.FenText(t(data.yesterday_contrib_fen)), row);
        this.Text("总贡献值", this.FenText(t(data.total_contrib_fen)), row);
        // v2.18：只有单成员 stat_scope=self 才下发本人红利；搜索/列表固定为 0。
        const bonus = (v:any):string => {
            if(!this.infoSelf)
                return "—";
            return this.FenText(t(v));
        };
        this.Text("今日红利值", bonus(data.today_bonus_fen), row);
        this.Text("昨日红利值", bonus(data.yesterday_bonus_fen), row);
        this.Text("总红利值", bonus(data.total_bonus_fen), row);

        const avatar = this.At("头像", row);
        const sprite = avatar ? avatar.getComponent(cc.Sprite) : null;
        if(sprite && id !== "")
            ImageManager.getInstance().BindPlayerListAvatar(id, sprite);

        const btn = row.getChildByName("查看");
        if(btn != null) {
            btn.active = true;
            btn.targetOff(this);
            btn.on(cc.Node.EventType.TOUCH_END, ()=>{
                if(id === "")
                    return;
                UIManager.getInstance().showPanel("panelClubPlayerInfo", ShowPanelMode.Cover,
                    JSON.stringify({userId:id, clubId:this.userClubId || this.roomClubId}));
            }, this);
        }

        // 「代理链」：直接用这一行的人切到代理链页签查询。
        const chainBtn = row.getChildByName("代理链");
        if(chainBtn != null) {
            if(this.currentTab === "chain") {
                // 已经在代理链页签里，这一列就是链路结果，不用再跳一次。
                chainBtn.active = false;
            }
            else {
                chainBtn.active = true;
                chainBtn.targetOff(this);
                chainBtn.on(cc.Node.EventType.TOUCH_END, ()=>{
                    if(id === "")
                        return;
                    this.ShowTab("chain", false);
                    this.ApplyTarget(id, t(data.name));
                }, this);
            }
        }
    }

    /**
     * 当前该查谁：搜索框有内容就用它，否则用上次查询的玩家 ID。
     * 页签互相切换时靠它重新发起查询（切走会把另一边的行清掉）。
     */
    private CurrentTargetKey():string {
        const editNode = this.At("搜索区/搜索输入");
        const box = editNode ? editNode.getComponent(cc.EditBox) : null;
        const key = box ? String(box.string || "").trim() : "";
        return key !== "" ? key : this.userId;
    }

    /** 没有指定玩家时的引导空态：等用户输入 ID 或昵称。 */
    private ShowGuide():void {
        this.Text("空状态", "输入玩家ID或昵称，查询他的代理链");
        this.Active("空状态", true);
        this.Active("列表面板", true);
        this.Active("列表", true);
        this.Active("加载", false);
        this.Active("错误", false);
        this.Active("说明", true);
        const content = this.At("列表/view/content");
        if(content != null) {
            for(const child of content.children.slice()) {
                if(child.name.indexOf("链路_") === 0 || child.name.indexOf("链标题_") === 0 ||
                    child.name.indexOf("链空_") === 0)
                    child.destroy();
            }
        }
    }

    /**
     * 代理链页签的搜索：
     * - 纯数字直接当玩家 ID 查；
     * - 其它先按昵称查成员列表，拿到 guuid 再查链路。
     */
    private OnSearch():void {
        const editNode = this.At("搜索区/搜索输入");
        const box = editNode ? editNode.getComponent(cc.EditBox) : null;
        const key = box ? String(box.string || "").trim() : "";
        if(key === "") {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入玩家ID或昵称");
            return;
        }
        if(this.currentTab === "info") {
            this.QueryInfo(key);
            return;
        }
        if(/^\d+$/.test(key)) {
            this.ApplyTarget(key, "");
            return;
        }
        this.SearchByName(key);
    }

    private ApplyTarget(userId:string, name:string):void {
        this.userId = userId;
        // 直接输 ID 查的时候拿不到昵称，必须清空旧值，否则抬头还挂着上一个玩家的名字。
        this.userName = name;
        this.userPhoto = "";
        this.retryCount = 0;
        this.clubFallbackTried = false;
        this.QueryChain();
    }

    private SearchByName(key:string):void {
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowError("网络未就绪，请稍后重试");
            return;
        }
        const clubId = this.userClubId || this.roomClubId;
        if(clubId === "") {
            this.ShowError("缺少俱乐部信息，无法按昵称搜索，请直接输入玩家ID");
            return;
        }
        this.searchKey = key;
        this.searchContext = "bosssearch:" + Date.now() + ":" + (++panelBossPlayerInfo.searchSerial);
        this.ShowLoading();
        const param = {
            header:"查询_俱乐部_成员",
            club_id:clubId,
            search_name_id:key,
            page:"0",
            count:"20",
            context:this.searchContext
        };
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.searchContext);
        }
        catch(error) {
            this.ShowError("搜索请求发送失败，请稍后重试");
        }
    }

    /** NumberList 回包：先认「玩家信息」查询，再认代理链的按名搜索。 */
    public OnMemberList(raw:any):void {
        const data = this.ParseSearch(raw);
        if(data == null)
            return;
        const ctx = String(data.context == null ? "" : data.context);

        // 部分服务端版本单人查询不回 context，这里放宽：context 为空也认，
        // 但只要有一条行的 guuid 与目标不符就视为他人回包丢弃。
        if(this.infoContext !== "" && (ctx === "" || ctx === this.infoContext)) {
            const infoRows = this.SearchRows(data);
            if(infoRows == null) {
                if(ctx === "")
                    return;
                this.infoContext = "";
                this.ShowError("查询失败，请稍后重试");
                return;
            }
            this.infoContext = "";
            this.pending = false;
            if(this.timeoutTimer != null) {
                clearTimeout(this.timeoutTimer);
                this.timeoutTimer = null;
            }
            this.RenderInfoRows(infoRows);
            return;
        }

        if(this.searchContext === "")
            return;
        if(ctx !== "" && ctx !== this.searchContext)
            return;
        this.searchContext = "";
        const rows = this.SearchRows(data);
        if(rows == null || rows.length === 0) {
            this.ShowError("没找到昵称包含「" + this.searchKey + "」的成员");
            return;
        }
        let target:any = rows[0];
        for(const one of rows) {
            if(one && typeof one === "object" && String(one.name || "").indexOf(this.searchKey) >= 0) {
                target = one;
                break;
            }
        }
        const guuid = String(target.guuid || target.user_id || "").trim();
        if(guuid === "") {
            this.ShowError("搜索结果缺少玩家ID");
            return;
        }
        const name = String(target.name || "").trim();
        this.ApplyTarget(guuid, name);
    }

    private ParseSearch(raw:any):any {
        if(raw == null)
            return null;
        let data:any = raw;
        if(typeof data === "string") {
            try { data = JSON.parse(data); }
            catch(error) { return null; }
        }
        if(data == null || typeof data !== "object")
            return null;
        if(typeof data.result === "string") {
            try { data.result = JSON.parse(data.result); }
            catch(error) {}
        }
        return data;
    }

    private SearchRows(data:any):any[] {
        const candidates:any[] = [
            data.NumberList,
            data.result && data.result.NumberList,
            Array.isArray(data.result) ? data.result : null,
            Array.isArray(data) ? data : null
        ];
        for(const value of candidates) {
            if(Array.isArray(value))
                return value;
        }
        return null;
    }

    private QueryChain():void {
        if(this.loading)
            return;
        if(this.userId === "") {
            this.ShowGuide();
            return;
        }
        if(this.userClubId === "") {
            this.ShowError("该玩家当前不在俱乐部，无法查询代理链");
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowError("网络未就绪，请稍后重试");
            return;
        }

        this.requestContext = "bosschain:" + Date.now() + ":" + (++panelBossPlayerInfo.serial);
        this.loading = true;
        this.pending = true;
        this.chainLoaded = false;
        this.ShowLoading();

        this.timeoutTimer = setTimeout(()=>{
            if(!this.pending)
                return;
            this.pending = false;
            this.loading = false;
            this.ShowError("请求超时，请稍后重试");
        }, 12000);

        const param = {
            header:"查询_俱乐部_成员_代理链路",
            club_id:this.userClubId,
            user_id:this.userId,
            context:this.requestContext
        };
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.requestContext);
        }
        catch(error) {
            this.FinishPending();
            this.ShowError("请求发送失败，请稍后重试");
        }
    }

    private FinishPending():void {
        this.pending = false;
        this.loading = false;
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    public OnAgentChain(raw:any):void {
        const body = this.Unwrap(raw);
        if(body == null)
            return;
        const ctx = body.context == null ? "" : String(body.context);
        // 推送带 context 时必须对得上；旧服不带 context 时才按“当前只有这一条请求”兜底。
        if(ctx !== "" && ctx !== this.requestContext)
            return;

        let rawChains:any[] = null;
        if(Array.isArray(body.chains))
            rawChains = body.chains;
        else if(Array.isArray(body.chain)) {
            // 旧服：顶层单链，包成一条俱乐部链，避免升级期间白屏。
            rawChains = [{club_id:body.club_id, club_name:"", count:body.count, chain:body.chain}];
        }
        if(rawChains == null)
            return;

        this.inUnion = String(body.union_id == null ? "" : body.union_id).trim() !== "";
        this.unionName = String(body.union_name == null ? "" : body.union_name).trim();

        this.FinishPending();
        this.chainLoaded = true;
        this.retryCount = 0;
        this.clubFallbackTried = false;
        this.RenderChains(rawChains.map(item=>this.ParseGroup(item)));
    }

    public onHallCommand(nCode:number, param:string):void {
        if(!this.pending)
            return;
        const text = param == null ? "" : String(param);
        if(this.requestContext !== "" && text.indexOf(this.requestContext) < 0 &&
            text.indexOf("查询_俱乐部_成员_代理链路") < 0)
            return;

        if(nCode === 0x200) {
            // 正常时序是先推 ClubMemberAgentChain 再回 0x200；推送迟到时交给超时兜底。
            return;
        }

        this.FinishPending();
        const error = this.ErrorText(text);
        // 被点玩家的 req_club_id 可能不是他真正的俱乐部；用房间归属俱乐部再试一次。
        if(error.indexOf("玩家不在该俱乐部") >= 0 && !this.clubFallbackTried &&
            this.roomClubId !== "" && this.roomClubId !== this.userClubId) {
            this.clubFallbackTried = true;
            this.userClubId = this.roomClubId;
            this.ShowLoading();
            setTimeout(()=>{
                if(cc.isValid(this.node))
                    this.QueryChain();
            }, 300);
            return;
        }
        // 服务端代理树还没加载完时会返回这句，文档建议自动重试 1~2 次。
        if(error.indexOf("代理数据加载中") >= 0 && this.retryCount < 1) {
            this.retryCount++;
            this.ShowLoading();
            setTimeout(()=>{
                if(cc.isValid(this.node))
                    this.QueryChain();
            }, 1200);
            return;
        }
        this.ShowError(error);
    }

    private Unwrap(raw:any):any {
        if(raw == null)
            return null;
        if(typeof raw === "object")
            return this.UnwrapObject(raw);
        if(typeof raw !== "string")
            return null;
        try {
            return this.UnwrapObject(JSON.parse(raw));
        }
        catch(error) {
            return null;
        }
    }

    private UnwrapObject(data:any):any {
        if(data == null || typeof data !== "object")
            return null;
        if(Array.isArray(data))
            return null;
        if(data.result !== undefined) {
            if(typeof data.result === "string") {
                try { data = JSON.parse(data.result); }
                catch(error) { return null; }
            }
            else
                data = data.result;
            if(data == null || typeof data !== "object")
                return null;
        }
        // 兼容 {"ClubMemberAgentChain":{...}} 这种按路由包一层的回包。
        if(data.chains === undefined && data.chain === undefined && data.ClubMemberAgentChain !== undefined) {
            const body = data.ClubMemberAgentChain;
            if(typeof body === "string") {
                try { return JSON.parse(body); }
                catch(error) { return null; }
            }
            return body;
        }
        return data;
    }

    private ErrorText(param:string):string {
        try {
            const data:any = JSON.parse(param);
            const result:any = data && data.result !== undefined ? data.result : data;
            if(typeof result === "string")
                return result;
            if(result && result.error)
                return String(result.error);
        }
        catch(error) {}
        return "查询失败，请稍后重试";
    }

    // ------------------------------------------------------------------
    // 渲染
    // ------------------------------------------------------------------
    private RenderChains(groups:BossChainGroup[]):void {
        if(this.currentTab === "chain")
            this.ShowTab("chain", false);
        const list = this.At("列表");
        const content = list ? Tool.GetChild(list, "view/content") : null;
        const rowTemplate = content ? content.getChildByName("行模板") : null;
        const headTemplate = content ? content.getChildByName("链标题") : null;
        const emptyTemplate = content ? content.getChildByName("链空") : null;
        if(content == null || rowTemplate == null) {
            this.ShowError("界面资源缺失，请重新打开");
            return;
        }

        // 清掉上一次动态生成的块，模板保留但隐藏。
        for(const child of content.children.slice()) {
            if(child.name.indexOf("链路_") === 0 || child.name.indexOf("链标题_") === 0 ||
                child.name.indexOf("链空_") === 0)
                child.destroy();
        }
        rowTemplate.active = false;
        if(headTemplate) headTemplate.active = false;
        if(emptyTemplate) emptyTemplate.active = false;

        const hasRows = groups.some(group=>group.rows.length > 0);
        if(groups.length === 0 || !hasRows) {
            this.Text("空状态", "无上级代理/不在本俱乐部");
            this.Active("空状态", true);
            this.Active("列表面板", true);
            this.Active("列表", true);
            const emptyView = list.getChildByName("view");
            content.height = emptyView ? emptyView.height : 0;
            if(emptyView)
                content.setPosition(0, emptyView.height / 2);
            return;
        }

        this.Active("空状态", false);
        this.Active("列表面板", true);
        this.Active("列表", true);

        // 每条链末尾都有总群主行（全联盟汇总，数值相同）。多链时只保留一条，放到最后的汇总块。
        let unionRow:BossChainRow = null;
        const cleaned:BossChainGroup[] = groups.map(group=>{
            const rows:BossChainRow[] = [];
            for(const row of group.rows) {
                if(!row.isUnionOwner) {
                    rows.push(row);
                    continue;
                }
                if(unionRow == null)
                    unionRow = row;
            }
            return {clubId:group.clubId, clubName:group.clubName, rows};
        });
        const multi = cleaned.length > 1;
        if(!multi && unionRow)
            cleaned[0].rows.push(unionRow);

        const rowHeight = rowTemplate.height;
        const rowPitch = rowHeight + 12;
        const headerHeight = 56;
        const headerGap = 6;
        const groupGap = 12;
        let y = 0;

        for(const group of cleaned) {
            // 有联盟显示联盟名，没联盟才显示俱乐部名。
            const title = this.unionName !== "" ? this.unionName :
                (group.clubName || (group.clubId ? "俱乐部 " + group.clubId : "当前俱乐部"));
            y = this.AddGroupTitle(content, headTemplate, title, group.clubId || "club", y, headerHeight, headerGap);
            if(group.rows.length === 0) {
                y = this.AddGroupEmpty(content, emptyTemplate, group.clubId || "club", y);
                y -= groupGap;
                continue;
            }
            for(const item of group.rows) {
                this.AddChainRow(content, rowTemplate, item, y - rowHeight / 2,
                    group.clubId, group.clubName);
                y -= rowPitch;
            }
            y -= groupGap;
        }

        if(multi && unionRow) {
            y = this.AddGroupTitle(content, headTemplate, "总群主（全联盟汇总）", "union", y, headerHeight, headerGap);
            this.AddChainRow(content, rowTemplate, unionRow, y - rowHeight / 2, "",
                this.unionName !== "" ? this.unionName : "全联盟汇总");
            y -= rowPitch + groupGap;
        }

        const view = list.getChildByName("view");
        if(view) {
            content.height = Math.max(view.height, -y + 4);
            content.setPosition(0, view.height / 2);
        }
        const scrollView = list.getComponent(cc.ScrollView);
        if(scrollView)
            scrollView.scrollToTop(0);
    }

    private AddGroupTitle(content:cc.Node, template:cc.Node, title:string, key:string, y:number,
        height:number, gap:number):number {
        if(template == null)
            return y - gap;
        const node = cc.instantiate(template);
        node.name = "链标题_" + key;
        node.parent = content;
        node.active = true;
        node.setPosition(0, y - height / 2);
        this.Text("名称", title, node);
        return y - height - gap;
    }

    private AddGroupEmpty(content:cc.Node, template:cc.Node, key:string, y:number):number {
        if(template == null)
            return y;
        const node = cc.instantiate(template);
        node.name = "链空_" + key;
        node.parent = content;
        node.active = true;
        node.setPosition(0, y - 25);
        return y - 50 - 6;
    }

    private AddChainRow(content:cc.Node, template:cc.Node, item:BossChainRow, y:number,
        clubId:string, clubName:string):void {
        const row = cc.instantiate(template);
        row.name = "链路_" + item.guuid;
        row.parent = content;
        row.active = true;
        row.setPosition(0, y);
        this.FillRow(row, item);
        // 行内俱乐部以行数据自己的 club_name 为准（联盟一条链上可能混着不同俱乐部），
        // 行数据没带才退回到分组/汇总块的俱乐部名。
        this.Text("俱乐部", item.clubName || clubName || item.clubId || "", row);
        for(const hidden of ["附加信息", "积分"]) {
            const node = this.At(hidden, row);
            if(node)
                node.active = false;
        }
        this.BindViewButton(row, item, clubId);
    }

    /**
     * 行内「查看」：打开独立的玩家资料卡 Prefab。
     * 行是运行时克隆的，基类 onLoad 时那次 getComponentsInChildren 扫不到，
     * 所以这里自己挂触摸；滑动超过阈值不算点击。
     */
    private BindViewButton(row:cc.Node, item:BossChainRow, clubId:string):void {
        const btn = row.getChildByName("查看");
        if(btn == null)
            return;
        // 代理链页签里也要能看每个人的资料（含总群主行），只隐藏「代理链」按钮。
        btn.active = true;
        let downX = 0;
        let downY = 0;
        let moved = false;
        btn.targetOff(this);
        btn.on(cc.Node.EventType.TOUCH_START, (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            downX = point.x;
            downY = point.y;
            moved = false;
        }, this);
        btn.on(cc.Node.EventType.TOUCH_MOVE, (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            if(Math.abs(point.x - downX) > 20 || Math.abs(point.y - downY) > 20)
                moved = true;
        }, this);
        btn.on(cc.Node.EventType.TOUCH_END, ()=>{
            if(moved)
                return;
            panelClubPlayerInfo.Open(item.guuid, clubId, item.name);
        }, this);
    }

    private ParseGroup(raw:any):BossChainGroup {
        const data:any = raw || {};
        const rows:any[] = Array.isArray(data.chain) ? data.chain : [];
        return {
            clubId:String(data.club_id == null ? "" : data.club_id),
            clubName:String(data.club_name == null ? "" : data.club_name),
            rows:rows.map(item=>this.ParseRow(item))
        };
    }

    private ParseRow(raw:any):BossChainRow {
        const data:any = raw || {};
        // 9 个统计字段都按“有就显示、没有就空串”解析，缺字段时渲染占位“—”。
        return {
            guuid:String(data.guuid == null ? "" : data.guuid),
            name:String(data.name == null ? "" : data.name),
            clubId:String(data.club_id == null ? "" : data.club_id),
            clubName:String(data.club_name == null ? "" : data.club_name),
            isCreator:String(data.is_creator) === "1",
            isUnionOwner:String(data.is_union_owner) === "1",
            score:String(data.total_score == null ? "" : data.total_score),
            contribFen:String(data.total_contrib_fen == null ? "" : data.total_contrib_fen),
            bonusFen:String(data.total_bonus_fen == null ? "" : data.total_bonus_fen),
            todayScore:String(data.today_score == null ? "" : data.today_score),
            yesterdayScore:String(data.yesterday_score == null ? "" : data.yesterday_score),
            todayContribFen:String(data.today_contrib_fen == null ? "" : data.today_contrib_fen),
            yesterdayContribFen:String(data.yesterday_contrib_fen == null ? "" : data.yesterday_contrib_fen),
            todayBonusFen:String(data.today_bonus_fen == null ? "" : data.today_bonus_fen),
            yesterdayBonusFen:String(data.yesterday_bonus_fen == null ? "" : data.yesterday_bonus_fen)
        };
    }

    private FillRow(row:cc.Node, item:BossChainRow):void {
        this.Text("姓名", item.name || ("玩家 " + item.guuid), row);
        this.Text("玩家ID", "ID: " + item.guuid, row);
        // 联盟内的俱乐部创建者叫“盟主”；未入盟才是“群主”，总群主行固定“总群主”。
        const identity = item.isUnionOwner ? "总群主" :
            (item.isCreator ? (this.inUnion ? "盟主" : "群主") : "合伙人");
        this.Text("身份", identity, row);
        const identityNode = this.At("身份", row);
        if(identityNode)
            identityNode.color = item.isUnionOwner || item.isCreator ?
                new cc.Color(255,231,112) : new cc.Color(160,220,235);

        // 代理链行的统计口径是「团队」（含下线汇总），左下角标出来与玩家信息页签区分。
        this.Text("统计口径/文字", "团队", row);

        const avatar = this.At("头像", row);
        const sprite = avatar ? avatar.getComponent(cc.Sprite) : null;
        if(sprite && item.guuid)
            ImageManager.getInstance().BindPlayerListAvatar(item.guuid, sprite);

        // 三列（输赢 / 贡献 / 红利）× 三行（今日 / 昨日 / 累计），全部取自本命令的行数据。
        this.SetScore("今日输赢值", item.todayScore, row);
        this.SetScore("昨日输赢值", item.yesterdayScore, row);
        this.SetScore("总输赢值", item.score, row);
        this.Text("今日贡献值", this.FenText(item.todayContribFen), row);
        this.Text("昨日贡献值", this.FenText(item.yesterdayContribFen), row);
        this.Text("总贡献值", this.FenText(item.contribFen), row);
        this.Text("今日红利值", this.FenText(item.todayBonusFen), row);
        this.Text("昨日红利值", this.FenText(item.yesterdayBonusFen), row);
        this.Text("总红利值", this.FenText(item.bonusFen), row);
    }

    private SetScore(name:string, value:any, row:cc.Node):void {
        const text = String(value == null ? "" : value);
        this.Text(name, this.ScoreText(text), row);
        const node = this.At(name, row);
        if(node == null)
            return;
        const color = this.ScoreColor(text);
        if(color != null)
            node.color = color;
    }

    private ScoreText(value:string):string {
        const text = String(value == null ? "" : value).replace(/[,，\s]/g, "");
        if(text === "")
            return "—";
        const number = Number(text);
        return isFinite(number) ? String(number) : "—";
    }

    private ScoreColor(value:string):cc.Color {
        const text = String(value == null ? "" : value).replace(/[,，\s]/g, "");
        const number = Number(text);
        if(!isFinite(number) || number === 0)
            return null;
        // 与钱包/成员列表一致：正分红、负分绿。
        return number > 0 ? new cc.Color(255,92,80) : new cc.Color(151,211,57);
    }

    private FenText(fen:string):string {
        const text = String(fen == null ? "" : fen).trim();
        if(text === "")
            return "—";
        const number = Number(text);
        if(!isFinite(number))
            return "—";
        const yuan = number / 100;
        return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/\.?0+$/, "");
    }

    // ------------------------------------------------------------------
    // 页签与状态
    // ------------------------------------------------------------------
    /** 清掉某一类数据行（切换页签时用）。 */
    private ClearRows(prefix:string):void {
        const content = this.At("列表/view/content");
        if(content == null)
            return;
        for(const child of content.children.slice()) {
            if(child.name.indexOf(prefix) === 0 && child.name !== "行模板")
                child.destroy();
        }
    }

    private ShowTab(tab:string, first:boolean):void {
        this.currentTab = tab;
        // 两个列表页签共用同一个 content，切换时把另一边的行清掉。
        if(tab === "chain")
            this.ClearRows("玩家_");
        else if(tab === "info") {
            this.ClearRows("链路_");
            this.ClearRows("链标题_");
            this.ClearRows("链空_");
        }
        const listMode = tab === "chain" || tab === "info";
        // 注意：页签都在「页签」容器下面，路径必须带前缀，否则 At() 全部取不到，
        // 表现为高亮永远停在 prefab 默认态、切了页签内容却不变。
        const tabs:{key:string,node:string}[] = [
            {key:"info", node:"页签/页签_玩家信息"},
            {key:"chain", node:"页签/页签_代理链"},
            {key:"win", node:"页签/页签_输赢详情"},
            {key:"record", node:"页签/页签_牌局详情"}
        ];
        for(const one of tabs) {
            const node = this.At(one.node);
            if(!node)
                continue;
            const active = one.key === tab;
            this.Active(one.node + "/底激活", active);
            this.Active(one.node + "/底非激活", !active);
            const label = Tool.GetChild(node, "文字");
            if(label) {
                // 金底页签用深色字，非激活用浅灰蓝，与「玩家设置」胶囊页签一致。
                // 直接写节点颜色（Label 渲染读的就是 node.color）。
                label.color = active ? new cc.Color(48,30,8) : new cc.Color(169,192,214);
            }
        }

        this.Active("列表面板", listMode);
        this.Active("列表", listMode);
        this.Active("说明", listMode);
        this.Text("说明", tab === "info" ?
            "按玩家本人统计（不含下线）；联盟内每个俱乐部一行" :
            "代理/群主行按当前俱乐部统计，总群主行按全联盟统计");

        if(!listMode) {
            this.Active("加载", false);
            this.Active("错误", false);
            this.Text("空状态", "该页签正在开发中");
            this.Active("空状态", true);
            return;
        }
        if(tab === "info") {
            this.Active("加载", false);
            this.Active("错误", false);
            if(!this.infoLoaded) {
                if(first) {
                    this.Active("空状态", false);
                }
                return;
            }
            this.Active("空状态", !this.HasRows("玩家_"));
            return;
        }
        if(!this.chainLoaded) {
            // 首次查询还没回来：保持当前的加载/错误状态，等推送到达再渲染。
            if(first) {
                this.Active("空状态", false);
                this.Active("加载", false);
                this.Active("错误", false);
            }
            return;
        }
        this.Active("加载", false);
        this.Active("错误", false);
        if(!this.HasRows("链路_")) {
            this.Text("空状态", "无上级代理/不在本俱乐部");
            this.Active("空状态", true);
        }
        else
            this.Active("空状态", false);
    }

    /** 列表里有没有指定前缀的真实数据行；模板本身不算。 */
    private HasRows(prefix:string):boolean {
        const content = this.At("列表/view/content");
        if(content == null)
            return false;
        for(const child of content.children) {
            if(child.name.indexOf(prefix) === 0 && child.active)
                return true;
        }
        return false;
    }

    private ShowLoading():void {
        this.Active("加载", true);
        this.Active("错误", false);
        this.Active("空状态", false);
    }

    private ShowError(text:string):void {
        this.Text("错误/文案", text);
        this.Active("错误", true);
        this.Active("加载", false);
        this.Active("空状态", false);
        this.Active("列表", false);
        this.Active("列表面板", false);
        this.Active("说明", false);
    }

    // ------------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------------
    private At(path:string, root:cc.Node = null):cc.Node {
        let node:cc.Node = root || this.node;
        for(const name of path.split("/")) {
            if(node == null)
                return null;
            node = node.getChildByName(name);
        }
        return node;
    }

    private Text(path:string, value:string, root:cc.Node = null):void {
        const node = this.At(path, root);
        const label = node ? node.getComponent(cc.Label) : null;
        if(label)
            label.string = value;
    }

    private Active(path:string, value:boolean):void {
        const node = this.At(path);
        if(node)
            node.active = value;
    }

    public onButtonClick(button:cc.Button):void {
        const name = button.node.name;
        if(name === "返回" || name === "关闭") {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Normal);
            return;
        }
        if(name === "搜索查询") {
            this.OnSearch();
            return;
        }
        if(name === "重试") {
            this.QueryChain();
            return;
        }
        if(name === "页签_玩家信息") {
            this.ShowTab("info", false);
            const target = this.CurrentTargetKey();
            if(target !== "")
                this.QueryInfo(target);
            else
                this.ShowGuide();
            return;
        }
        if(name === "页签_代理链") {
            this.ShowTab("chain", false);
            // 切走时链路行已被清掉，chainLoaded 还是 true，不能只靠它判断，必须重查。
            const target = this.CurrentTargetKey();
            if(target !== "")
                this.ApplyTarget(target, "");
            else
                this.ShowGuide();
            return;
        }
        if(name === "页签_输赢详情") {
            this.ShowTab("win", false);
            return;
        }
        if(name === "页签_牌局详情") {
            this.ShowTab("record", false);
            return;
        }
    }
}
