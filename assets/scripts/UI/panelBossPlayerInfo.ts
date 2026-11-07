import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ImageManager from "../logic/ImageManager";
import panelClubPlayerInfo from "./panelClubPlayerInfo";
import panelPlayerRecord from "./panelPlayerRecord";
import { normalizeRoomClubId, resolveMyRoomClubId, resolveRoomClubId, resolveRoomSettingClubId } from "../logic/RoomClubContext";
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
 * 分组管理页签的一行：对应《俱乐部玩家分组-客户端与后台接口文档》§3.1 的 groups[]。
 * 全部数值接口下发的是字符串，积分可负，贡献/红利单位是分（展示 ÷100）。
 */
interface ClubGroupRow {
    id:string;
    name:string;
    memberCount:number;
    today:string;
    yesterday:string;
    total:string;
    todayContribFen:string;
    yesterdayContribFen:string;
    contribFen:string;
    todayBonusFen:string;
    yesterdayBonusFen:string;
    bonusFen:string;
    warnEnabled:string;
    warnMin:string;
    warnMax:string;
    warnStatus:string;
    remark:string;
}

/**
 * 组内成员一行：对应接口文档 §3.2 `ClubPlayerGroupMembers.members[]`。
 * `self_*` 是该成员**本人**在管理域内的 9 项统计（输赢/贡献/红利各 3 项），
 * 各行相加 = 分组总计，**不含下线**；成员列表 `NumberList` 是「本人 + 整条下线」，两者不要互相对账。
 */
interface ClubGroupMember {
    id:string;
    name:string;
    role:string;
    isAgent:boolean;
    status:string;
    /** 归属俱乐部：优先 home_club_id，没有就取 club_ids 的第一段。 */
    club:string;
    todayScore:string;
    yesterdayScore:string;
    totalScore:string;
    todayContribFen:string;
    yesterdayContribFen:string;
    totalContribFen:string;
    todayBonusFen:string;
    yesterdayBonusFen:string;
    totalBonusFen:string;
    /** 预警提示（区间 / 越界值 / 未设置），空串表示这一行不显示。 */
    warnText:string;
    warnStatus:string;
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

    // ---- 分组管理（《俱乐部玩家分组》接口文档 2.x/3.x/4.x）----
    /** 当前管理域的全部分组。 */
    private groups:ClubGroupRow[] = [];
    private groupsLoaded:boolean = false;
    private groupContext:string = "";
    /** 写命令（创建/删除/设成员）在途标记：成功后数据走推送，不许重复提交。 */
    private groupBusy:boolean = false;
    /** 0x200 已到但推送未到时的兜底刷新标记。 */
    private groupWaitPush:boolean = false;
    private groupTimer:any = null;
    private static groupSerial:number = 0;
    /** 上次拉列表的时间戳：来回切页签时 2 秒内不重复请求。 */
    private groupStamp:number = 0;
    /** 弹窗模式：create 建组 / addMember 按 ID 加人 / pick 选组加人 / confirm 二次确认。 */
    private dialogMode:string = "";
    private dialogGroupId:string = "";
    private dialogUserId:string = "";
    private pickedGroupId:string = "";

    // ---- 组内成员（接口文档 3.2 / 4.2）----
    private members:ClubGroupMember[] = [];
    private memberTotal:number = 0;
    private memberGroupId:string = "";
    private memberGroupName:string = "";
    /** 打开成员弹窗时那一行分组数据：弹窗顶部汇总卡直接用它填 9 项统计。 */
    private memberGroup:ClubGroupRow = null;
    private memberContext:string = "";
    private memberTimer:any = null;
    private memberLoaded:boolean = false;
    /** 推送顶层 stats_ok："0" 时 self_* 全是 0，界面要如实显示「统计未就绪」。 */
    private memberStatsOk:boolean = true;
    private static memberSerial:number = 0;

    /** 成员弹窗整屏版式：分组汇总卡在标题下方，成员列表占住中段，关闭键贴底。 */
    private static SUMMARY_Y:number = 400;
    private static SUMMARY_H:number = 200;
    /** 汇总卡复用「分组模板」：去掉按钮行后整块内容上收 30px，卡片才只包住 9 项统计。 */
    private static SUMMARY_SHIFT:number = 30;
    private static LIST_Y:number = -155;
    private static LIST_H:number = 830;

    // 本面板只发 `查询_俱乐部_成员_代理链路` 一条命令，不额外调用 `查询_俱乐部_成员`：
    // 团队人数/今日昨日等列若接口没下发就是“—”，由服务端在链路接口里补齐。
    onLoad () {
        super.onLoad();
        // 牌桌按钮在 panelGameView.onLoad 时就注册了触摸，晚创建的全屏面板必须靠 zIndex
        // 稳定压在牌桌之上，否则点头像后仍可能被下层按钮抢走（参见 cocos-touch-passthrough-fix）。
        // 但**不能写死 200**：Normal 里的弹窗都是兄弟节点，抬到 200 会把结算/兑换/客服/
        // 俱乐部设置这些按需弹窗全压到它下面。大厅里走正常层级（0），只有牌桌里才抬到 1。
        this.node.zIndex = Tool.PanelBaseZ(this.node);
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ClubMemberAgentChain", this, "OnAgentChain");
        // 按昵称搜索先查成员列表拿 guuid，回包走 NumberList。
        KBEngine.Event.register("NumberList", this, "OnMemberList");
        // 分组管理：列表走 ClubPlayerGroupList，写操作结果走 ClubPlayerGroupResult。
        KBEngine.Event.register("ClubPlayerGroupList", this, "OnGroupList");
        KBEngine.Event.register("ClubPlayerGroupResult", this, "OnGroupResult");
        // 组内成员列表走 ClubPlayerGroupMembers（查询_俱乐部_分组_成员）。
        KBEngine.Event.register("ClubPlayerGroupMembers", this, "OnGroupMembers");
        // 弹窗遮罩：点空白处关掉（遮罩吞点击但自身仍能收到触摸）。
        const mask = this.At("分组弹窗/遮罩");
        if(mask) {
            mask.on(cc.Node.EventType.TOUCH_END, ()=>{
                if(this.dialogMode !== "")
                    this.CloseDialog();
            }, this);
        }
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
        if(this.groupTimer != null) {
            clearTimeout(this.groupTimer);
            this.groupTimer = null;
        }
        this.ClearMemberTimer();
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

        // 「添加到分组」：把这个玩家加进某个分组（先选组、再确定）。
        const groupBtn = row.getChildByName("添加到分组");
        if(groupBtn != null) {
            groupBtn.active = /^\d+$/.test(id);
            if(groupBtn.active) {
                this.BindTap(groupBtn, ()=>{
                    this.OpenPickDialog(id, t(data.name));
                });
            }
        }

        // 「战绩」：打开这个玩家的战绩面板（独立 Prefab，版式照「我的战绩」）。
        this.BindRecordButton(row, id, t(data.name));
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
        // 分组命令的回执先认掉：它跟代理链不是同一个请求车道。
        if(this.HandleGroupReply(nCode, param))
            return;
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
        // 分组回包同样是「按路由名包一层」，两种结构都拆。
        if(data.groups === undefined && data.ClubPlayerGroupList !== undefined)
            return this.UnwrapInner(data.ClubPlayerGroupList);
        if(data.action === undefined && data.ClubPlayerGroupResult !== undefined)
            return this.UnwrapInner(data.ClubPlayerGroupResult);
        if(data.members === undefined && data.ClubPlayerGroupMembers !== undefined)
            return this.UnwrapInner(data.ClubPlayerGroupMembers);
        return data;
    }

    private UnwrapInner(body:any):any {
        if(typeof body === "string") {
            try { return JSON.parse(body); }
            catch(error) { return null; }
        }
        if(body == null || typeof body !== "object" || Array.isArray(body))
            return null;
        if(body.result !== undefined && body.result !== null) {
            const inner = typeof body.result === "string" ? this.UnwrapInner(body.result) : body.result;
            if(inner != null && typeof inner === "object")
                return inner;
        }
        return body;
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

        // 代理链行同样可以一键加进分组。
        const groupBtn = row.getChildByName("添加到分组");
        if(groupBtn != null) {
            groupBtn.active = /^\d+$/.test(item.guuid);
            if(groupBtn.active)
                this.BindTap(groupBtn, ()=>this.OpenPickDialog(item.guuid, item.name));
        }

        // 代理链行也能直接看这个人的战绩。
        this.BindRecordButton(row, item.guuid, item.name);
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
        // 三个页签共用同一个 content，切换时把另一边的行清掉。
        if(tab === "chain") {
            this.ClearRows("玩家_");
            this.ClearRows("分组_");
        }
        else if(tab === "info") {
            this.ClearRows("链路_");
            this.ClearRows("链标题_");
            this.ClearRows("链空_");
            this.ClearRows("分组_");
        }
        else {
            this.ClearRows("玩家_");
            this.ClearRows("链路_");
            this.ClearRows("链标题_");
            this.ClearRows("链空_");
        }
        const listMode = tab === "chain" || tab === "info" || tab === "group";
        // 注意：页签都在「页签」容器下面，路径必须带前缀，否则 At() 全部取不到，
        // 表现为高亮永远停在 prefab 默认态、切了页签内容却不变。
        const tabs:{key:string,node:string}[] = [
            {key:"info", node:"页签/页签_玩家信息"},
            {key:"chain", node:"页签/页签_代理链"},
            {key:"group", node:"页签/页签_分组管理"}
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

        // 分组管理页签不需要玩家搜索框，顶栏换成「新建分组」。
        this.Active("搜索区", tab !== "group");
        this.Active("新建分组", tab === "group");
        this.Active("列表面板", listMode);
        this.Active("列表", listMode);
        this.Active("说明", listMode);
        if(tab === "info")
            this.Text("说明", "按玩家本人统计（不含下线）；联盟内每个俱乐部一行");
        else if(tab === "group")
            this.Text("说明", "分组统计为组内成员真实值（不套展示折扣）；一人只能属于一个分组");
        else
            this.Text("说明", "代理/群主行按当前俱乐部统计，总群主行按全联盟统计");

        if(!listMode) {
            this.Active("加载", false);
            this.Active("错误", false);
            this.Text("空状态", "该页签正在开发中");
            this.Active("空状态", true);
            return;
        }
        if(tab === "group") {
            this.Active("加载", false);
            this.Active("错误", false);
            if(this.groupsLoaded)
                this.RenderGroups();
            else
                this.Active("空状态", false);
            // 每次进来都刷新一次（2 秒内不重复）：别的端新建的分组也能看到。
            this.QueryGroups();
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
    // 分组管理（《俱乐部玩家分组-客户端与后台接口文档》2.x / 3.x / 4.x）
    // ------------------------------------------------------------------
    /** 分组命令用的 club_id：优先本房间实际结算俱乐部，其次被查玩家所属俱乐部，最后账号自己的俱乐部。 */
    private GroupClubId():string {
        const account:any = GameDataManager.getAccount();
        let id = resolveMyRoomClubId(account, this.userClubId);
        if(id === "")
            id = this.userClubId;
        if(id === "")
            id = this.roomClubId;
        // 从大厅「我的→数据统计」进来时可能没有房间上下文，用账号自己的俱乐部兜底。
        if(id === "")
            id = resolveRoomClubId(account);
        return id;
    }

    /** 查询_俱乐部_分组列表：无分页，一次返回该管理域全部 used 分组。 */
    private QueryGroups(force:boolean = false):void {
        if(this.groupBusy)
            return;
        if(!force && Date.now() - this.groupStamp < 2000)
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowGroupError("网络未就绪，请稍后重试");
            return;
        }
        const clubId = this.GroupClubId();
        if(clubId === "") {
            this.ShowGroupError("缺少俱乐部信息，无法管理分组");
            return;
        }
        this.groupStamp = Date.now();
        this.groupContext = "bossgrp:" + Date.now() + ":" + (++panelBossPlayerInfo.groupSerial);
        this.ClearGroupTimer();
        this.groupTimer = setTimeout(()=>{
            if(this.groupContext === "")
                return;
            this.groupContext = "";
            this.ShowGroupError("分组数据加载超时，请稍后重试");
        }, 10000);
        if(this.currentTab === "group" && !this.groupsLoaded)
            this.ShowLoading();
        try {
            account.reqHallCommand(JSON.stringify({
                header:"查询_俱乐部_分组列表",
                club_id:clubId,
                context:this.groupContext
            }), "P@" + this.groupContext);
        }
        catch(error) {
            this.ShowGroupError("请求发送失败，请稍后重试");
        }
    }

    /** 写命令：创建/删除分组、设置分组成员。成功时数据走推送，回执只带 context。 */
    private SendGroup(header:string, extra:any):void {
        if(this.groupBusy)
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.Toast("网络未就绪，请稍后重试");
            return;
        }
        const clubId = this.GroupClubId();
        if(clubId === "") {
            this.Toast("缺少俱乐部信息，无法管理分组");
            return;
        }
        this.groupBusy = true;
        this.groupContext = "bossgrp:" + Date.now() + ":" + (++panelBossPlayerInfo.groupSerial);
        this.ClearGroupTimer();
        this.groupTimer = setTimeout(()=>{
            if(this.groupContext === "")
                return;
            this.FinishGroup();
            this.Toast("操作超时，请刷新后确认结果");
            this.QueryGroups(true);
        }, 12000);
        const param:any = {header:header, club_id:clubId, context:this.groupContext};
        if(extra != null) {
            for(const key in extra)
                param[key] = extra[key];
        }
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.groupContext);
        }
        catch(error) {
            this.FinishGroup();
            this.Toast("请求发送失败，请稍后重试");
        }
    }

    /** 分组命令回执：按 context 认领，不落到代理链那条逻辑里。 */
    private HandleGroupReply(nCode:number, param:string):boolean {
        const body = param == null ? "" : String(param);
        // 组内成员查询是只读命令，用它自己的 context，别把分组列表的状态搅乱。
        if(this.memberContext !== "" && body.indexOf(this.memberContext) >= 0) {
            this.ClearMemberTimer();
            this.memberContext = "";
            if(nCode === 0x200 || nCode === 0x500)
                return true;   // 数据在推送里
            this.MemberHint(this.ErrorText(body));
            return true;
        }
        if(this.groupContext === "")
            return false;
        const text = param == null ? "" : String(param);
        if(text.indexOf(this.groupContext) < 0)
            return false;
        this.ClearGroupTimer();
        if(nCode === 0x200 || nCode === 0x500) {
            // 命令已受理：立刻放开写锁，否则后面的刷新会被 groupBusy 挡掉。
            // 成功数据在推送里；推送迟到时给 1.2s，还没到就自己重查一次。
            this.groupContext = "";
            this.groupBusy = false;
            this.groupWaitPush = true;
            setTimeout(()=>{
                if(!cc.isValid(this.node))
                    return;
                if(this.groupWaitPush) {
                    this.groupWaitPush = false;
                    this.QueryGroups(true);
                }
            }, 1200);
            return true;
        }
        this.FinishGroup();
        this.ShowGroupError(this.ErrorText(text));
        return true;
    }

    private FinishGroup():void {
        this.ClearGroupTimer();
        this.groupContext = "";
        this.groupBusy = false;
        this.groupWaitPush = false;
    }

    private ClearGroupTimer():void {
        if(this.groupTimer != null) {
            clearTimeout(this.groupTimer);
            this.groupTimer = null;
        }
    }

    /** 分组失败：分组页签里就地显示，其它页签弹提示。 */
    private ShowGroupError(text:string):void {
        this.ClearGroupTimer();
        this.groupBusy = false;
        if(this.currentTab === "group") {
            this.Active("加载", false);
            this.Active("错误", false);
            this.Active("列表面板", true);
            this.Active("列表", true);
            this.Text("空状态", text);
            this.Active("空状态", true);
            return;
        }
        this.Toast(text);
    }

    private Toast(text:string):void {
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, text);
    }

    // ---- 组内成员：查询 / 列表 / 移出（接口文档 3.2、4.2）----

    /** 查询_俱乐部_分组_成员：只读命令，单独一套 context/计时器，不占用 groupBusy。 */
    private QueryMembers(groupId:string):void {
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.MemberHint("网络未就绪，请稍后重试");
            return;
        }
        const clubId = this.GroupClubId();
        if(clubId === "") {
            this.MemberHint("缺少俱乐部信息，无法查看成员");
            return;
        }
        this.memberGroupId = groupId;
        this.memberLoaded = false;
        this.MemberHint("正在加载成员…");
        this.memberContext = "bossmem:" + Date.now() + ":" + (++panelBossPlayerInfo.memberSerial);
        this.ClearMemberTimer();
        const ctx = this.memberContext;
        this.memberTimer = setTimeout(()=>{
            if(this.memberContext !== ctx)
                return;
            this.memberContext = "";
            this.MemberHint("成员列表加载超时，关闭后重试");
        }, 10000);
        try {
            account.reqHallCommand(JSON.stringify({
                header:"查询_俱乐部_分组_成员",
                club_id:clubId,
                group_id:groupId,
                page:0,
                count:100,
                context:ctx
            }), "P@" + ctx);
        }
        catch(error) {
            this.ClearMemberTimer();
            this.memberContext = "";
            this.MemberHint("请求发送失败，请稍后重试");
        }
    }

    private ClearMemberTimer():void {
        if(this.memberTimer != null) {
            clearTimeout(this.memberTimer);
            this.memberTimer = null;
        }
    }

    /** 成员弹窗的提示行（标题下面那行）。 */
    private MemberHint(text:string):void {
        if(this.dialogMode !== "members" && this.dialogMode !== "kick")
            return;
        this.Text("分组弹窗/面板/提示", text);
    }

    /** 推送 ClubPlayerGroupMembers：{group_id,group_name,count,members:[...]}。 */
    public OnGroupMembers(raw:any):void {
        const data = this.Unwrap(raw);
        if(data == null || !Array.isArray(data.members))
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(this.memberContext !== "" && ctx !== "" && ctx !== this.memberContext)
            return;
        this.ClearMemberTimer();
        this.memberContext = "";
        this.memberLoaded = true;
        this.memberGroupId = String(data.group_id == null ? this.memberGroupId : data.group_id);
        this.memberGroupName = String(data.group_name == null ? this.memberGroupName : data.group_name);
        const total = Number(data.count);
        this.members = data.members.map((item:any)=>this.ParseMember(item));
        // stats_ok="0" 时服务端把 self_* 全填 0，要如实显示「—」而不是一排 0。
        this.memberStatsOk = String(data.stats_ok == null ? "1" : data.stats_ok) !== "0";
        this.memberTotal = isFinite(total) ? total : this.members.length;
        if(this.dialogMode === "members")
            this.RenderMembers();
        else if(this.dialogMode === "kick")
            this.Text("分组弹窗/面板/提示", "共 " + this.memberTotal + " 人");
    }

    private ParseMember(raw:any):ClubGroupMember {
        const text = (value:any):string => String(value == null ? "" : value).trim();
        const warnStatus = text(raw && raw.warn_status);
        const clubIds = text(raw && raw.club_ids);
        const firstClub = clubIds !== "" ? clubIds.split(",")[0].trim() : "";
        let warnText = "";
        if(text(raw && raw.warn_enabled) === "1") {
            // 越界时只留「越界 -1200」：区间那串 13 个字 206 宽放不下，会被 SHRINK 压成 12 号。
            warnText = warnStatus === "1" ?
                ("越界 " + text(raw && raw.warn_value)) :
                ("预警 " + text(raw && raw.warn_min) + "~" + text(raw && raw.warn_max));
        }
        else if(warnStatus === "1")
            warnText = "越界 " + text(raw && raw.warn_value);
        else if(warnStatus === "0")
            warnText = "预警 未设置";
        return {
            id:text(raw && raw.guuid) || text(raw && raw.user_id),
            name:text(raw && raw.name),
            role:text(raw && raw.role),
            isAgent:text(raw && raw.is_agent) === "1",
            status:text(raw && raw.status),
            club:text(raw && raw.home_club_id) || firstClub,
            todayScore:text(raw && raw.self_today_score),
            yesterdayScore:text(raw && raw.self_yesterday_score),
            totalScore:text(raw && raw.self_total_score),
            todayContribFen:text(raw && raw.self_today_contrib_fen),
            yesterdayContribFen:text(raw && raw.self_yesterday_contrib_fen),
            totalContribFen:text(raw && raw.self_total_contrib_fen),
            todayBonusFen:text(raw && raw.self_today_bonus_fen),
            yesterdayBonusFen:text(raw && raw.self_yesterday_bonus_fen),
            totalBonusFen:text(raw && raw.self_total_bonus_fen),
            warnText:warnText,
            warnStatus:warnStatus
        };
    }

    /**
     * 成员列表：一行一个玩家，直接克隆「玩家信息」页签的 `行模板`（表对象），
     * 字段、9 项统计、按钮位置和玩家信息完全一致；只把最左边那颗
     * 「添加到分组」换成「移出成员」（他们本来就在组里，不需要再加一次）。
     */
    private RenderMembers():void {
        const list = this.At("分组弹窗/面板/选项列表");
        const view = this.At("分组弹窗/面板/选项列表/view");
        const content = this.At("分组弹窗/面板/选项列表/view/content");
        // 表行模板挂在玩家信息页签的列表里，两个页签共用一份，不另外复制。
        const template = this.At("列表/view/content/行模板");
        if(content == null || template == null) {
            this.MemberHint("界面资源缺失，请重新打开");
            return;
        }
        // 顶部汇总卡先立起来：它独立于列表，不跟着成员行滚动。
        this.RenderMemberSummary();
        for(const child of content.children.slice()) {
            if(child.name.indexOf("成员_") === 0 || child.name.indexOf("选项_") === 0)
                child.destroy();
        }
        // 选组用的那一行要收起来，否则会顶着第一行成员。
        const option = content.getChildByName("选项模板");
        if(option != null)
            option.active = false;
        this.Text("分组弹窗/面板/标题", "组内成员");

        if(!this.memberLoaded) {
            if(view != null) {
                content.height = view.height;
                content.setPosition(0, view.height / 2);
            }
            return;
        }
        const groupName = this.memberGroupName !== "" ? this.memberGroupName : ("分组 " + this.memberGroupId);
        if(this.members.length === 0) {
            this.MemberHint("「" + groupName + "」还没有成员，回分组列表点「＋ 加人」添加");
            if(view != null) {
                content.height = view.height;
                content.setPosition(0, view.height / 2);
            }
            return;
        }
        let hint = "共 " + this.memberTotal + " 人";
        if(this.members.length < this.memberTotal)
            hint += "（当前显示前 " + this.members.length + " 人）";
        hint += "，点「移出成员」可移出";
        this.MemberHint(hint);

        const rowHeight = template.height;
        const pitch = rowHeight + 8;
        let y = 0;
        for(const member of this.members) {
            const row = cc.instantiate(template);
            row.name = "成员_" + member.id;
            row.parent = content;
            row.active = true;
            row.setPosition(0, y - rowHeight / 2);
            this.FillMemberRow(row, member);
            y -= pitch;
        }
        if(view != null) {
            content.height = Math.max(view.height, -y + 4);
            content.setPosition(0, view.height / 2);
        }
        const scrollView = list ? list.getComponent(cc.ScrollView) : null;
        if(scrollView != null)
            scrollView.scrollToTop(0);
    }

    /**
     * 成员弹窗顶部：当前分组的汇总卡（分组名 / 预警 / 备注 / 成员数 + 9 项统计）。
     * 卡片本体直接克隆「分组模板」，只把那一排按钮（成员 / 加人 / 删除分组）收起来、
     * 整块内容上收一点，让高度只包住统计；这样和分组列表的卡片不会长歪两套样式。
     */
    private RenderMemberSummary():void {
        if(this.dialogMode !== "members")
            return;
        const panel = this.At("分组弹窗/面板");
        const template = this.At("列表/view/content/分组模板");
        if(panel == null || template == null)
            return;
        let holder = panel.getChildByName("组统计");
        if(holder == null) {
            holder = new cc.Node("组统计");
            holder.parent = panel;
            holder.setContentSize(690, panelBossPlayerInfo.SUMMARY_H);
            holder.setPosition(0, panelBossPlayerInfo.SUMMARY_Y);
        }
        holder.active = true;
        let card = holder.getChildByName("卡片");
        if(card == null) {
            card = cc.instantiate(template);
            card.name = "卡片";
            card.parent = holder;
            card.active = true;
            card.setPosition(0, 0);
            card.setContentSize(690, panelBossPlayerInfo.SUMMARY_H);
            for(const name of ["成员", "加人", "删除分组"]) {
                const btn = card.getChildByName(name);
                if(btn != null)
                    btn.active = false;
            }
            // 按钮行没了，左栏和 9 项统计整体上收，卡片才不留一条空底。
            const shift = panelBossPlayerInfo.SUMMARY_SHIFT;
            for(const child of card.children) {
                if(child.name === "成员" || child.name === "加人" || child.name === "删除分组")
                    continue;
                child.y -= shift;
            }
            const divider = card.getChildByName("资料分隔线");
            if(divider != null) {
                divider.height = 156;
                divider.y = 1;
            }
        }
        card.active = true;

        if(this.memberGroup != null)
            this.FillGroupStats(card, this.memberGroup);
        else {
            // 没有分组行数据时只填能确定的部分，9 项统计保持模板里的「—」。
            this.Text("分组名", this.memberGroupName !== "" ? this.memberGroupName :
                ("分组 " + this.memberGroupId), card);
            this.Text("备注", "—", card);
            this.Text("预警", "预警 未设置", card);
        }
        const name = this.memberGroupName !== "" ? this.memberGroupName :
            (this.memberGroup != null ? this.memberGroup.name : ("分组 " + this.memberGroupId));
        if(name !== "")
            this.Text("分组名", name, card);
        // 成员数用成员接口下发的 count：移出人之后它比分组列表里那份先更新。
        const total = this.memberLoaded ? this.memberTotal :
            (this.memberGroup != null ? this.memberGroup.memberCount : 0);
        this.Text("成员数值", "成员 " + total + " 人", card);
    }

    /** 成员行：字段和「玩家信息」页签的 FillInfoRow 一一对应，只是数据来源和左下角按钮不同。 */
    private FillMemberRow(row:cc.Node, member:ClubGroupMember):void {
        const id = member.id;
        this.Text("姓名", member.name !== "" ? member.name : ("玩家 " + id), row);
        this.Text("玩家ID", "ID: " + id, row);
        this.Text("身份", member.role !== "" ? member.role : "成员", row);
        this.Text("俱乐部", member.club !== "" ? member.club : "—", row);
        // 成员接口没有俱乐部积分，这一行改放状态（和代理链的颜色一致）。
        this.Text("积分", member.status !== "" ? member.status : "—", row);
        const statusNode = this.At("积分", row);
        if(statusNode != null) {
            statusNode.color = member.status === "游戏中" ? new cc.Color(255,231,112) :
                (member.status === "在线" ? new cc.Color(151,211,57) : new cc.Color(150,168,186));
        }
        // 预警：分组规则或按 home 俱乐部代理线回退的结果，越界标红。
        const warnNode = this.At("附加信息", row);
        if(warnNode != null) {
            warnNode.active = member.warnText !== "";
            this.Text("附加信息", member.warnText, row);
            warnNode.color = member.warnStatus === "1" ?
                new cc.Color(255,92,80) : new cc.Color(150,168,186);
        }
        // 口径：成员列表下发的 self_* 全是本人数据，和玩家信息页签的「个人」一致。
        this.Text("统计口径/文字", "个人", row);

        // 9 项统计。stats_ok=0 时服务端把 self_* 全填 0，要显示成「—」而不是 0。
        const score = (name:string, value:string):void=>{
            if(this.memberStatsOk)
                this.SetScore(name, value, row);
            else
                this.Text(name, "—", row);
        };
        const fen = (value:string):string => this.memberStatsOk ? this.FenText(value) : "—";
        score("今日输赢值", member.todayScore);
        score("昨日输赢值", member.yesterdayScore);
        score("总输赢值", member.totalScore);
        this.Text("今日贡献值", fen(member.todayContribFen), row);
        this.Text("昨日贡献值", fen(member.yesterdayContribFen), row);
        this.Text("总贡献值", fen(member.totalContribFen), row);
        this.Text("今日红利值", fen(member.todayBonusFen), row);
        this.Text("昨日红利值", fen(member.yesterdayBonusFen), row);
        this.Text("总红利值", fen(member.totalBonusFen), row);

        const avatar = this.At("头像", row);
        const sprite = avatar ? avatar.getComponent(cc.Sprite) : null;
        if(sprite != null && id !== "")
            ImageManager.getInstance().BindPlayerListAvatar(id, sprite);

        // 左下角：原本的「添加到分组」改成「移出成员」（人已经在组里了）。
        // 底图是蓝色九宫格，只把字染红，别去乘节点颜色（蓝色×红色会发黑）。
        const kickBtn = row.getChildByName("添加到分组");
        if(kickBtn != null) {
            kickBtn.active = true;
            this.Text("文字", "移出成员", kickBtn);
            const kickLabel = this.At("文字", kickBtn);
            if(kickLabel != null)
                kickLabel.color = new cc.Color(255,138,128);
            this.BindTap(kickBtn, ()=>{
                this.OpenKickDialog(member);
            });
        }

        // 「查看」：打开这个玩家的详情面板（和玩家信息页签同一个入口）。
        const viewBtn = row.getChildByName("查看");
        if(viewBtn != null) {
            viewBtn.active = id !== "";
            if(viewBtn.active) {
                this.BindTap(viewBtn, ()=>{
                    UIManager.getInstance().showPanel("panelClubPlayerInfo", ShowPanelMode.Cover,
                        JSON.stringify({userId:id, clubId:member.club || this.GroupClubId()}));
                });
            }
        }

        // 「代理链」：关掉弹窗跳到代理链页签，直接查这个人。
        const chainBtn = row.getChildByName("代理链");
        if(chainBtn != null) {
            chainBtn.active = id !== "";
            if(chainBtn.active) {
                this.BindTap(chainBtn, ()=>{
                    this.CloseDialog();
                    this.ShowTab("chain", false);
                    this.ApplyTarget(id, member.name);
                });
            }
        }

        // 「战绩」：打开这个玩家的战绩面板。
        this.BindRecordButton(row, id, member.name);
    }

    /** 行「成员」：打开组内成员列表。 */
    private OpenMemberDialog(group:ClubGroupRow):void {
        this.memberGroupId = group.id;
        this.memberGroupName = group.name;
        this.memberGroup = group;
        this.memberTotal = group.memberCount;
        this.members = [];
        this.memberLoaded = false;
        this.memberStatsOk = true;
        this.OpenDialog("members", group.id, "", "组内成员", "正在加载成员…");
        this.QueryMembers(group.id);
    }

    /** 列表里点一行：二次确认移出。取消则回到列表，不用重新查。 */
    private OpenKickDialog(member:ClubGroupMember):void {
        const who = member.name !== "" ? member.name : ("玩家 " + member.id);
        const groupName = this.memberGroupName !== "" ? this.memberGroupName : ("分组 " + this.memberGroupId);
        this.OpenDialog("kick", this.memberGroupId, member.id, "移出成员",
            "把「" + who + "」移出「" + groupName + "」？移出后不再计入该分组统计");
    }

    private BackToMemberList():void {
        // OpenDialog("members") 自己会重新渲染名单（memberLoaded 还是 true）。
        this.OpenDialog("members", this.memberGroupId, "", "组内成员", "正在加载成员…");
    }

    /** 推送 ClubPlayerGroupList：{count,stats_ok,groups:[...]}。 */
    public OnGroupList(raw:any):void {
        const data = this.Unwrap(raw);
        if(data == null || !Array.isArray(data.groups))
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(this.groupContext !== "" && ctx !== "" && ctx !== this.groupContext)
            return;
        this.FinishGroup();
        this.groups = data.groups.map((item:any)=>this.ParseGroupRow(item));
        this.groupsLoaded = true;
        if(this.currentTab === "group")
            this.RenderGroups();
        const modal = this.At("分组弹窗");
        if(modal != null && modal.active && this.dialogMode === "pick")
            this.RenderPickList();
        // 成员弹窗开着时（刚移出一个人等），顶部汇总卡跟着最新的分组数据一起刷。
        if(modal != null && modal.active && this.dialogMode === "members") {
            for(const group of this.groups) {
                if(group.id === this.memberGroupId) {
                    this.memberGroup = group;
                    break;
                }
            }
            this.RenderMemberSummary();
        }
    }

    /** 推送 ClubPlayerGroupResult：{action:create/update/delete/set_member/remove_member,...}。 */
    public OnGroupResult(raw:any):void {
        const data = this.Unwrap(raw);
        if(data == null)
            return;
        const action = String(data.action == null ? "" : data.action);
        if(action === "")
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(this.groupContext !== "" && ctx !== "" && ctx !== this.groupContext)
            return;
        this.FinishGroup();
        const groupName = String(data.group_name == null ? "" : data.group_name);
        if(action === "create")
            this.Toast("已创建分组「" + groupName + "」");
        else if(action === "delete")
            this.Toast("已删除分组「" + groupName + "」");
        else if(action === "set_member") {
            const who = String(data.user_name || data.user_id || "玩家");
            this.Toast("已把「" + who + "」加入「" + groupName + "」");
        }
        else if(action === "remove_member") {
            const who = String(data.user_name || data.user_id || "玩家");
            const groupName = String(data.group_name == null ? "" : data.group_name);
            this.Toast(groupName !== "" ? ("已把「" + who + "」移出「" + groupName + "」")
                                        : ("已把「" + who + "」移出分组"));
        }
        // 文档：创建/改名/删除、加人/移人之后都要自己刷新列表。
        this.groupsLoaded = false;
        this.QueryGroups(true);
        // 成员弹窗还开着就地刷新名单，不用让用户关掉重开。
        if(this.dialogMode === "members" && this.memberGroupId !== "")
            this.QueryMembers(this.memberGroupId);
    }

    private ParseGroupRow(raw:any):ClubGroupRow {
        const text = (value:any):string => String(value == null ? "" : value).trim();
        const count = Number(text(raw && raw.member_count));
        return {
            id:text(raw && raw.group_id),
            name:text(raw && raw.group_name),
            memberCount:isFinite(count) ? count : 0,
            today:text(raw && raw.today_score),
            yesterday:text(raw && raw.yesterday_score),
            total:text(raw && raw.total_score),
            todayContribFen:text(raw && raw.today_contrib_fen),
            yesterdayContribFen:text(raw && raw.yesterday_contrib_fen),
            contribFen:text(raw && raw.total_contrib_fen),
            todayBonusFen:text(raw && raw.today_bonus_fen),
            yesterdayBonusFen:text(raw && raw.yesterday_bonus_fen),
            bonusFen:text(raw && raw.total_bonus_fen),
            warnEnabled:text(raw && raw.warn_enabled),
            warnMin:text(raw && raw.warn_min),
            warnMax:text(raw && raw.warn_max),
            warnStatus:text(raw && raw.warn_status),
            remark:text(raw && raw.remark)
        };
    }

    private RenderGroups():void {
        const list = this.At("列表");
        const content = this.At("列表/view/content");
        const view = list ? list.getChildByName("view") : null;
        if(content == null) {
            this.ShowGroupError("界面资源缺失，请重新打开");
            return;
        }
        const template = content.getChildByName("分组模板");
        if(template == null) {
            this.ShowGroupError("界面资源缺失，请重新打开");
            return;
        }
        for(const child of content.children.slice()) {
            if(child.name.indexOf("分组_") === 0)
                child.destroy();
        }
        template.active = false;
        this.Active("加载", false);
        this.Active("错误", false);
        this.Active("列表面板", true);
        this.Active("列表", true);
        this.Active("说明", true);

        if(this.groups.length === 0) {
            this.Text("空状态", "还没有分组，点「＋ 新建分组」创建");
            this.Active("空状态", true);
            if(view) {
                content.height = view.height;
                content.setPosition(0, view.height / 2);
            }
            return;
        }
        this.Active("空状态", false);

        const rowHeight = template.height;
        const pitch = rowHeight + 10;
        let y = 0;
        for(const group of this.groups) {
            const row = cc.instantiate(template);
            row.name = "分组_" + group.id;
            row.parent = content;
            row.active = true;
            row.setPosition(0, y - rowHeight / 2);
            this.FillGroupRow(row, group);
            y -= pitch;
        }
        if(view) {
            content.height = Math.max(view.height, -y + 4);
            content.setPosition(0, view.height / 2);
        }
        const scrollView = list ? list.getComponent(cc.ScrollView) : null;
        if(scrollView)
            scrollView.scrollToTop(0);
    }

    /**
     * 分组行（卡片式）：左栏 分组名 / 预警 / 备注 / 成员数，
     * 右栏 3 列（输赢 / 贡献 / 红利）× 3 行（今日 / 昨日 / 累计）共 9 项统计，
     * 底部一排按钮（成员 / 加人 / 删除分组）。统计部分和成员弹窗顶部汇总卡共用。
     */
    private FillGroupRow(row:cc.Node, group:ClubGroupRow):void {
        this.FillGroupStats(row, group);

        const memberBtn = row.getChildByName("成员");
        if(memberBtn != null) {
            this.BindTap(memberBtn, ()=>{
                this.OpenMemberDialog(group);
            });
        }
        const addBtn = row.getChildByName("加人");
        if(addBtn != null) {
            this.BindTap(addBtn, ()=>{
                this.OpenAddMemberDialog(group.id, group.name);
            });
        }
        const delBtn = row.getChildByName("删除分组");
        if(delBtn != null) {
            this.BindTap(delBtn, ()=>{
                this.OpenDeleteDialog(group.id, group.name);
            });
        }
    }

    /**
     * 分组卡的左栏 + 9 项统计：分组列表的行和成员弹窗顶部汇总卡都用这一份，
     * 保证两处数字口径、配色（输赢红涨绿跌、贡献/红利金色）完全一致。
     */
    private FillGroupStats(node:cc.Node, group:ClubGroupRow):void {
        this.Text("分组名", group.name !== "" ? group.name : ("分组 " + group.id), node);
        this.Text("备注", this.SubText(group), node);
        this.Text("成员数值", "成员 " + group.memberCount + " 人", node);
        // 9 项统计：输赢是积分（红涨绿跌），贡献/红利是分（÷100）。
        this.SetScore("今日输赢值", group.today, node);
        this.SetScore("昨日输赢值", group.yesterday, node);
        this.SetScore("累计输赢值", group.total, node);
        this.Text("今日贡献值", this.FenText(group.todayContribFen), node);
        this.Text("昨日贡献值", this.FenText(group.yesterdayContribFen), node);
        this.Text("累计贡献值", this.FenText(group.contribFen), node);
        this.Text("今日红利值", this.FenText(group.todayBonusFen), node);
        this.Text("昨日红利值", this.FenText(group.yesterdayBonusFen), node);
        this.Text("累计红利值", this.FenText(group.bonusFen), node);

        this.Text("预警", this.WarnText(group), node);
        const warnNode = this.At("预警", node);
        if(warnNode) {
            // 预警越界用红色，开启且正常用绿色，未设置/关闭用灰蓝。
            warnNode.color = group.warnStatus === "1" ? new cc.Color(255,92,80) :
                (group.warnEnabled === "1" ? new cc.Color(151,211,57) : new cc.Color(150,168,186));
        }
    }

    /**
     * 预警状态一行：越界（红）/ 正常（绿）/ 关闭、未设置（灰）。
     * 区间不塞这一行——13 个字放在 210 宽里会被压成 16 号，改到副标题行。
     */
    private WarnText(group:ClubGroupRow):string {
        if(group.warnEnabled === "1")
            return group.warnStatus === "1" ? "预警 越界" : "预警 正常";
        return group.warnEnabled === "0" ? "预警 关闭" : "预警 未设置";
    }

    /** 副标题行：预警区间 + 备注，两者都有时用「·」连接。 */
    private SubText(group:ClubGroupRow):string {
        const parts:string[] = [];
        if(group.warnEnabled === "1" && group.warnMin !== "" && group.warnMax !== "")
            parts.push("区间 " + this.FenText(group.warnMin) + "~" + this.FenText(group.warnMax));
        if(group.remark !== "")
            parts.push(group.remark);
        return parts.length > 0 ? parts.join(" · ") : "—";
    }

    // ---- 弹窗：选分组 / 输入 / 二次确认 ----
    private OpenCreateDialog():void {
        this.OpenDialog("create", "", "", "新建分组",
            "输入分组名称（最多20字，同管理域内不能重名）");
    }

    private OpenAddMemberDialog(groupId:string, groupName:string):void {
        this.OpenDialog("addMember", groupId, "", "添加玩家",
            "输入玩家ID，加入「" + groupName + "」");
    }

    private OpenDeleteDialog(groupId:string, groupName:string):void {
        this.OpenDialog("confirm", groupId, "", "删除分组",
            "删除「" + groupName + "」后，组内成员会变为未分组，且不可恢复");
    }

    /** 行内「添加到分组」：先选分组，再确定。 */
    private OpenPickDialog(userId:string, userName:string):void {
        if(userId === "")
            return;
        const who = userName !== "" ? userName + "（" + userId + "）" : "玩家 " + userId;
        this.OpenDialog("pick", "", userId, "添加到分组", who + "：选择要加入的分组");
        if(!this.groupsLoaded && !this.groupBusy)
            this.QueryGroups(true);
    }

    /**
     * 分组弹窗一个骨架两套版式：
     *   members（组内成员）拉成整屏 750x1334 —— 顶部标题 + 当前分组汇总卡，下面才是成员列表，
     *   最底一颗「关闭」；
     *   其余（新建 / 加人 / 选组 / 删除确认）还是原来那套 740x800 的小版式。
     * 预制体里存的是大版式的坐标，这里按模式把面板和各块缩回去。
     */
    private LayoutDialog(mode:string):void {
        const tall = mode === "members";
        const panel = this.At("分组弹窗/面板");
        if(panel != null) {
            panel.width = tall ? 750 : 740;
            panel.height = tall ? 1334 : 800;
        }
        const title = this.At("分组弹窗/面板/标题");
        if(title != null)
            title.y = tall ? 600 : 340;
        const hint = this.At("分组弹窗/面板/提示");
        if(hint != null) {
            hint.y = tall ? 548 : 286;
            hint.height = tall ? 52 : 66;
        }
        // 分组汇总卡（运行时挂在面板下的 690x200 容器，卡片本体由「分组模板」克隆）。
        const holder = panel != null ? panel.getChildByName("组统计") : null;
        if(holder != null) {
            holder.active = tall;
            holder.setPosition(0, panelBossPlayerInfo.SUMMARY_Y);
        }
        const list = this.At("分组弹窗/面板/选项列表");
        if(list != null) {
            list.y = tall ? panelBossPlayerInfo.LIST_Y : 20;
            list.height = tall ? panelBossPlayerInfo.LIST_H : 430;
        }
        const view = this.At("分组弹窗/面板/选项列表/view");
        if(view != null)
            view.height = tall ? panelBossPlayerInfo.LIST_H : 430;
        const content = this.At("分组弹窗/面板/选项列表/view/content");
        if(content != null) {
            const height = view != null ? view.height : (tall ? panelBossPlayerInfo.LIST_H : 430);
            content.height = height;
            content.setPosition(0, height / 2);
        }
        const by = tall ? -612 : -330;
        const cancel = this.At("分组弹窗/面板/取消");
        if(cancel != null)
            cancel.y = by;
        const ok = this.At("分组弹窗/面板/确定");
        if(ok != null)
            ok.y = by;
    }

    private OpenDialog(mode:string, groupId:string, userId:string, title:string, hint:string):void {
        const modal = this.At("分组弹窗");
        if(modal == null) {
            this.Toast("界面资源缺失，请重新打开");
            return;
        }
        this.dialogMode = mode;
        this.dialogGroupId = groupId;
        this.dialogUserId = userId;
        this.pickedGroupId = "";
        this.Text("分组弹窗/面板/标题", title);
        this.Text("分组弹窗/面板/提示", hint);
        const isInput = mode === "create" || mode === "addMember";
        const showList = mode === "pick" || mode === "members";
        this.Active("分组弹窗/面板/选项列表", showList);
        this.Active("分组弹窗/面板/输入框", isInput);
        // 成员列表只要一个「关闭」；确定键收起来，取消键挪到正中。
        this.Active("分组弹窗/面板/确定", mode !== "members");
        this.Text("分组弹窗/面板/取消/文字", mode === "members" ? "关闭" : "取消");
        const cancelBtn = this.At("分组弹窗/面板/取消");
        if(cancelBtn)
            cancelBtn.x = mode === "members" ? 0 : -170;
        // 先显示弹窗：EditBox 在 onEnable 里才把 textLabel/placeholder 绑到节点上，
        // 节点还是 inactive 时去写 string/inputMode 会拿到空引用。
        modal.active = true;
        modal.zIndex = 20;
        // 版式要在渲染行之前定下来：RenderMembers 会按 view.height 算 content 高度。
        this.LayoutDialog(mode);
        if(isInput) {
            const input = this.At("分组弹窗/面板/输入框");
            const box = input ? input.getComponent(cc.EditBox) : null;
            if(box) {
                box.string = "";
                box.inputMode = mode === "addMember" ?
                    cc.EditBox.InputMode.NUMERIC : cc.EditBox.InputMode.ANY;
                box.maxLength = mode === "create" ? 20 : 12;
            }
            this.Text("分组弹窗/面板/输入框/提示",
                mode === "create" ? "分组名称" : "玩家ID");
        }
        if(mode === "pick")
            this.RenderPickList();
        else if(mode === "members")
            this.RenderMembers();
    }

    private CloseDialog():void {
        const modal = this.At("分组弹窗");
        if(modal)
            modal.active = false;
        this.dialogMode = "";
        this.dialogGroupId = "";
        this.dialogUserId = "";
        this.pickedGroupId = "";
        this.memberLoaded = false;
    }

    private DialogInput():string {
        const input = this.At("分组弹窗/面板/输入框");
        const box = input ? input.getComponent(cc.EditBox) : null;
        return box ? String(box.string || "").trim() : "";
    }

    private SubmitDialog():void {
        const mode = this.dialogMode;
        if(mode === "create") {
            const name = this.DialogInput();
            if(name === "") {
                this.Toast("请输入分组名称");
                return;
            }
            this.CloseDialog();
            this.SendGroup("创建_俱乐部_分组", {group_name:name});
            return;
        }
        if(mode === "addMember") {
            const userId = this.DialogInput();
            if(!/^\d+$/.test(userId)) {
                this.Toast("请输入正确的玩家ID");
                return;
            }
            const groupId = this.dialogGroupId;
            this.CloseDialog();
            this.SendGroup("设置_俱乐部_分组_成员", {group_id:groupId, user_id:userId});
            return;
        }
        if(mode === "pick") {
            if(this.pickedGroupId === "") {
                this.Toast("请选择要加入的分组");
                return;
            }
            const groupId = this.pickedGroupId;
            const userId = this.dialogUserId;
            this.CloseDialog();
            this.SendGroup("设置_俱乐部_分组_成员", {group_id:groupId, user_id:userId});
            return;
        }
        if(mode === "confirm") {
            const groupId = this.dialogGroupId;
            if(groupId === "") {
                this.CloseDialog();
                return;
            }
            this.CloseDialog();
            this.SendGroup("删除_俱乐部_分组", {group_id:groupId});
            return;
        }
        if(mode === "members") {
            // 成员列表没有「确定」，这里只是兜底（比如点到空白）。
            this.CloseDialog();
            return;
        }
        if(mode === "kick") {
            const userId = this.dialogUserId;
            if(userId === "") {
                this.CloseDialog();
                return;
            }
            // 弹窗留在成员列表上，等推送回来再刷一遍，不打断连续移人。
            this.BackToMemberList();
            // 文档 §4.2：只传 user_id，一个人在一个管理域最多属于一个分组。
            this.SendGroup("移除_俱乐部_分组_成员", {user_id:userId});
        }
    }

    private RenderPickList():void {
        const list = this.At("分组弹窗/面板/选项列表");
        const view = this.At("分组弹窗/面板/选项列表/view");
        const content = this.At("分组弹窗/面板/选项列表/view/content");
        if(content == null)
            return;
        const template = content.getChildByName("选项模板");
        if(template == null)
            return;
        for(const child of content.children.slice()) {
            if(child.name.indexOf("选项_") === 0)
                child.destroy();
        }
        template.active = false;

        if(this.groups.length === 0) {
            this.Text("分组弹窗/面板/提示", this.groupsLoaded ?
                "还没有分组，请先到「分组管理」新建" : "正在加载分组…");
            if(view) {
                content.height = view.height;
                content.setPosition(0, view.height / 2);
            }
            return;
        }

        const rowHeight = template.height;
        const pitch = rowHeight + 8;
        let y = 0;
        for(const group of this.groups) {
            const option = cc.instantiate(template);
            option.name = "选项_" + group.id;
            option.parent = content;
            option.active = true;
            option.setPosition(0, y - rowHeight / 2);
            this.Text("文字", group.name + "（" + group.memberCount + " 人）", option);
            this.BindTap(option, ()=>{
                this.pickedGroupId = group.id;
                this.RefreshPickHighlight();
            });
            y -= pitch;
        }
        if(view) {
            content.height = Math.max(view.height, -y + 4);
            content.setPosition(0, view.height / 2);
        }
        const scrollView = list ? list.getComponent(cc.ScrollView) : null;
        if(scrollView)
            scrollView.scrollToTop(0);
        this.RefreshPickHighlight();
    }

    private RefreshPickHighlight():void {
        const content = this.At("分组弹窗/面板/选项列表/view/content");
        if(content == null)
            return;
        for(const child of content.children) {
            if(child.name.indexOf("选项_") !== 0)
                continue;
            const id = child.name.substring("选项_".length);
            const picked = id === this.pickedGroupId;
            child.opacity = picked ? 255 : 150;
            const label = Tool.GetChild(child, "文字");
            if(label)
                label.color = picked ? new cc.Color(255,231,112) : new cc.Color(200,214,228);
        }
    }

    // ------------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------------
    /**
     * 给运行时克隆出来的节点挂点击（模板行里的按钮不在 onLoad 的按钮扫描范围内）。
     * 滑动超过阈值不算点击，避免列表滚动时误触。
     */
    /**
     * 行内「战绩」：打开玩家的战绩面板。
     * 行是运行时克隆的，基类 onLoad 那次扫不到按钮，所以用 BindTap 自己挂触摸。
     */
    private BindRecordButton(row:cc.Node, userId:string, userName:string):void {
        const btn = row.getChildByName("战绩");
        if(btn == null)
            return;
        btn.active = userId !== "";
        if(!btn.active)
            return;
        this.BindTap(btn, ()=>{
            panelPlayerRecord.Open(userId, userName, this.userClubId || this.roomClubId);
        });
    }

    private BindTap(node:cc.Node, action:()=>void):void {
        let downX = 0;
        let downY = 0;
        let moved = false;
        node.targetOff(this);
        node.on(cc.Node.EventType.TOUCH_START, (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            downX = point.x;
            downY = point.y;
            moved = false;
        }, this);
        node.on(cc.Node.EventType.TOUCH_MOVE, (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            if(Math.abs(point.x - downX) > 20 || Math.abs(point.y - downY) > 20)
                moved = true;
        }, this);
        node.on(cc.Node.EventType.TOUCH_END, ()=>{
            if(moved)
                return;
            action();
        }, this);
    }

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
        if(name === "页签_分组管理") {
            this.ShowTab("group", false);
            return;
        }
        if(name === "新建分组") {
            this.OpenCreateDialog();
            return;
        }
        if(name === "取消") {
            // 移出确认的「取消」退回名单，别把整个弹窗关掉。
            if(this.dialogMode === "kick") {
                this.BackToMemberList();
                return;
            }
            this.CloseDialog();
            return;
        }
        if(name === "确定") {
            this.SubmitDialog();
            return;
        }
    }
}
