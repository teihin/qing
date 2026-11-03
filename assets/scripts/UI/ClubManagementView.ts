import ImageManager from "../logic/ImageManager";
import {ShowPanelMode} from "../common/GameDef";
import UIManager from "../common/UIManager";
import DirectChatManager from "../logic/DirectChatManager";

export type ClubRole = "owner" | "manager" | "agent" | "member";
export type ClubListKind = "members" | "applications" | "union" | "allies";
export type ClubAction = "leave" | "dissolve" | "approve" | "reject" | "remove" | "promote" |
    "adjustScore" | "setAgent" | "changeAgentRatio" | "cancelAgent" | "setNote" |
    "grantQuota" | "increaseQuota" | "decreaseQuota" | "unionApprove" | "unionReject";
export interface ClubContext {
    accountId:string; id:string; name:string; role:ClubRole; ownerId?:string; inviteCode?:string; isLeader?:boolean;
    /** V2 联盟状态：未确认时不显示创建/加入入口，避免把网络未知当成无联盟。 */
    unionKnown?:boolean; hasUnion?:boolean; unionId?:string; unionName?:string; unionApplyId?:string;
    /** 联盟额度：总群主是联盟池（isPool=true），盟主是自己俱乐部额度。 */
    unionQuotaFen?:number; unionQuotaIsPool?:boolean; clubQuotaFen?:number;
    /** 只有联盟总群主能看入盟申请；is_owner 来自 查询_联盟_额度。 */
    unionIsOwner?:boolean;
}
export interface ClubPlayer {
    id:string; name:string; role?:string; balance?:string;
    /** 该成员所属俱乐部；V2 大群主成员列表里的盟主虚拟行会带自己俱乐部的 ID。 */
    clubId?:string;
    clubGold?:string; isAgent?:boolean; isLeader?:boolean; agentPercent?:string; status?:string;
    /** 服务端 NumberList 的 note：俱乐部内该成员的备注，恒存在、无值为空串。 */
    note?:string;
    /** NumberList statistics are populated by the updated server response. */
    teamCount?:string; points?:string; online?:boolean;
    todayWin?:string; yesterdayWin?:string; totalWin?:string;
    todayContribution?:string; yesterdayContribution?:string; totalContribution?:string;
    /** NumberList.quota：V2 给大盟主/盟主行下发的俱乐部额度（分）；代理/玩家不显示。 */
    clubQuotaFen?:number;
}
/** give = 玩家之间赠送（扣自己积分）；updown = 代理按授信额度给成员上下分。 */
export type ClubGiftMode = "give" | "updown";
export interface ClubPeoplePage { items:ClubPlayer[]; total:number; }
/** 联盟入盟申请只有俱乐部维度；服务端不返回分页，一次推送全部待审俱乐部。 */
export interface ClubUnionApplication { clubId:string; clubName:string; ownerId?:string; ownerName?:string; }
export interface ClubUnionApplicationPage { items:ClubUnionApplication[]; total:number; }
/** ClubMyUnion.members：联盟内所有俱乐部（含总群主自己那家），union_quota 单位为分。 */
export interface ClubUnionMember { clubId:string; clubName:string; ownerId?:string; ownerName?:string; quotaFen?:number; }
export interface ClubUnionMemberPage { items:ClubUnionMember[]; total:number; poolQuotaFen?:number; }
/** Adapt server payloads here. Resolve act only after the business result, not an async acceptance code. */
export interface ClubManagementApi {
    /** 成员列表自 2026-10-26 起为代理直属口径；传 agentId 下钻到指定下级代理的直属成员。 */
    list(clubId:string,kind:ClubListKind,page:number,count:number,search?:string,agentId?:string):Promise<ClubPeoplePage>;
    act(clubId:string,action:ClubAction,userId:string,value?:string):Promise<{message?:string}>;
    unionApplications():Promise<ClubUnionApplicationPage>;
    unionAct(clubId:string,targetClubId:string,approve:boolean):Promise<{message?:string}>;
    unionMembers():Promise<ClubUnionMemberPage>;
    unionQuotaAdjust(targetClubId:string,quotaFen:number):Promise<{message?:string}>;
}

/** UI-only controller. All art/layout lives in panelMain.prefab. No adapter means no network writes. */
export default class ClubManagementView {
    private api:ClubManagementApi = null;
    private context:ClubContext = null;
    private counts:{[id:string]:number} = {};
    private kind:ClubListKind = "members";
    private page:number = 0;
    private total:number = 0;
    private version:number = 0;
    private loading:boolean = false;
    private busy:boolean = false;
    private pending:{club:ClubContext; action:ClubAction; userId:string; value?:string} = null;
    private selectedPlayer:ClubPlayer = null;
    /** 0 = 从成员列表打开（自己的直属下级，可管理）；>=1 = 由「下级成员」逐层点开，跨级只读。 */
    private settingsDepth:number = 0;
    private selectedDownline:ClubPlayer[] = [];
    private settingsTab:"member"|"downline" = "member";
    private downlineLoading:boolean = false;
    private downlineError:string = "";
    private downlinePage:number = 0;
    private downlineTotal:number = 0;
    private downlineToken:number = 0;
    /** 当前这一页的成员数据；赠送/上下分成功后用它就地刷新玩家设置卡。 */
    private items:ClubPlayer[] = [];
    /** 卡片加高显示联盟行时子节点要整体上移，避免卡片顶部留出大空白。 */
    private cardBaseY:{[name:string]:number} = {};
    private goldRefreshTimer:any = null;
    private inputMode:"ratio"|"remark"|"quota"|"quotaIncrease"|"quotaDecrease"|null = null;
    /** 盟友管理里的额度调整走同一个输入弹窗，单独记录目标俱乐部和方向。 */
    private selectedUnionMember:ClubUnionMember = null;
    private unionQuotaMode:"increase"|"decrease"|null = null;
    /** 最近一次盟友列表返回的联盟池额度（分），用于弹窗抬头。 */
    private allyPoolQuotaFen:number = undefined;
    /** 文档 4.11：note 上限 30 字（按字符计），服务端超长直接报错、不截断。 */
    private static readonly NOTE_MAX:number = 30;
    private readonly pageSize:number = 20;
    /** 与 Prefab 中「玩家设置下级列表」一屏可放的行数一致。 */
    private readonly downlinePageSize:number = 4;

    constructor(private root:cc.Node,private getContext:()=>ClubContext,private message:(text:string)=>void,
        private gift:(player:ClubPlayer,mode:ClubGiftMode)=>void = null,private notify:()=>void = null,
        private unionAction:(action:"create"|"join")=>void = null) {
        this.raisePopups();
    }

    /**
     * Creator 2.4 的触摸候选按 scene graph 优先级排序，而兄弟层的 _localZOrder
     * 都是 0 时比较结果恒为 0，派发退化成注册顺序——大厅里 onLoad 时就注册好的
     * 按钮会比成员行（运行时创建）先拿到触摸。成员列表首行头像正好压在大厅
     * 「我的」页自己头像和「排行榜」上，于是点头像被下层抢走、弹出「修改个人信息」。
     * 给俱乐部这几个弹窗设递增 zIndex，让排序稳定把它们排在前面；它们本来就是
     * 最上层的兄弟节点，绘制顺序不变。
     */
    private raisePopups():void {
        const layers:{name:string;z:number}[] = [
            {name:"俱乐部成员弹窗",z:100},
            {name:"俱乐部申请弹窗",z:110},
            {name:"俱乐部玩家设置弹窗",z:120},
            {name:"玩家设置输入弹窗",z:125},
            {name:"俱乐部操作确认",z:130}
        ];
        for(const layer of layers) {
            const node = this.at(layer.name);
            if(node && node.zIndex !== layer.z) node.zIndex = layer.z;
        }
    }

    public SetApi(api:ClubManagementApi):void {
        this.api = api;
        this.Refresh();
        const root = this.listRoot();
        if(root && root.active) this.load(0);
    }

    /** Server push integration point; never clear badges merely because the list was opened. */
    public SetPendingCount(clubId:string,count:number):void {
        const next = Math.max(0,Math.floor(Number(count) || 0));
        const previous = this.counts[clubId] || 0;
        this.counts[clubId] = next;
        // 待审数增加（新申请来了，红点亮起）时提示一声；数量不变或减少不打扰。
        if(next > previous && this.notify) this.notify();
        this.Refresh();
    }

    private at(path:string,root:cc.Node = this.root):cc.Node {
        for(const name of path.split('/')) {
            root = root && root.getChildByName(name);
        }
        return root;
    }
    private text(path:string,value:string,root:cc.Node = this.root):void {
        const n = this.at(path,root);
        const label = n && n.getComponent(cc.Label);
        if(label) label.string = value;
    }
    private active(path:string,value:boolean,root:cc.Node = this.root):void {
        const n = this.at(path,root);
        if(n) n.active = value;
    }
    private manager(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && (c.role === "owner" || c.role === "manager");
    }
    /** 只有从成员列表打开的第一层是「自己直属的下级」；继续下钻后只能查看。 */
    private readOnlyPlayer():boolean { return this.settingsDepth > 0; }
    private blockReadOnlyPlayer():boolean {
        if(!this.readOnlyPlayer()) return false;
        this.message("跨级查看，仅可查看不能修改");
        return true;
    }
    /**
     * 代理关系操作（设/调/取消代理）限创建者与目标成员的直属上级代理；
     * 管理员按协议不能操作代理关系，普通成员操作由调用点的直属层级守卫拦截。
     */
    private canManageAgent(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && (c.role === "owner" || c.role === "agent");
    }
    /** 创建者/管理员/代理都能看待审申请；代理另可管理自己直属下级，改积分仍限创建者/管理员。 */
    private approver(c:ClubContext = this.context):boolean {
        return this.manager(c) || !!c && !!c.id && c.role === "agent";
    }
    /**
     * 入盟申请只对联盟总群主开放。`is_owner` 可能因额度推送缺字段迟迟不回来，
     * 因此只要俱乐部已确认在联盟里、且没有被明确判为非总群主（false），就先显示入口；
     * 后台「查询_我的_联盟」探测成功后同样会把 isOwner 落成 true。
     */
    private canReviewUnion(c:ClubContext = this.context):boolean {
        const inUnion = !!String(c && c.unionId || "").trim() || !!c && c.hasUnion === true;
        return !!c && !!c.id && c.role === "owner" && inUnion && c.unionIsOwner !== false;
    }
    private canCreateJoin(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && c.role === "owner" && c.unionKnown === true &&
            !c.hasUnion && !c.unionApplyId;
    }
    /** 已提交入盟申请、等待审批：文档要求只显示「加入联盟」并置灰提示审核中。 */
    private unionApplying(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && c.role === "owner" && c.unionKnown === true &&
            !c.hasUnion && !!c.unionApplyId;
    }
    /** 卡片底部联盟行是否显示：未入盟显示创建/加入，已入盟的总群主显示入盟申请。 */
    private unionRowVisible(c:ClubContext = this.context):boolean {
        return this.canCreateJoin(c) || this.unionApplying(c) || this.canReviewUnion(c);
    }
    /** 卡片底部联盟区：已入盟（显示联盟名/额度）或未入盟但有创建/加入/审核中入口。 */
    private unionSectionVisible(c:ClubContext = this.context):boolean {
        if(!c || !c.id) return false;
        return !!String(c.unionId || "").trim() || this.unionRowVisible(c);
    }
    /**
     * 俱乐部创建者的显示身份：
     * 联盟总群主=大群主；当前俱乐部已入盟=盟主；未入盟=老板。
     */
    private creatorRole(c:ClubContext = this.context):string {
        if(!c || !c.hasUnion) return "老板";
        return c.unionIsOwner === true ? "大群主" : "盟主";
    }
    /**
     * 俱乐部申请与入盟申请共用同一个弹窗：只换标题、抬头和数据源，
     * 行模板的布局与按钮美术保持一致。
     */
    private syncDialogText(clubHeader?:string):void {
        const panel = this.at("面板",this.at("俱乐部申请弹窗"));
        if(!panel) return;
        const union = this.kind === "union" || this.kind === "allies";
        const context = this.context || {accountId:"",id:"",name:"",role:"member" as ClubRole};
        let poolFen = this.kind === "allies" ? this.allyPoolQuotaFen : undefined;
        if(!Number.isFinite(poolFen) && context.unionQuotaIsPool &&
            Number.isFinite(Number(context.unionQuotaFen)))
            poolFen = Number(context.unionQuotaFen);
        const poolText = Number.isFinite(poolFen) ? "  联盟池：" + this.fenText(poolFen) + " 元" : "";
        const header = union ? (context.unionId ?
            (context.unionName || "联盟号：" + context.unionId) + poolText :
            "当前联盟" + poolText) :
            (clubHeader !== undefined ? clubHeader :
                (context.id ? (context.name || "俱乐部 " + context.id) +
                    (context.inviteCode ? "（邀请码:" + context.inviteCode + "）" : "") : ""));
        this.text("标题底/标题",this.kind === "allies" ? "盟友管理" :
            this.kind === "union" ? "入盟申请" : "入会申请",panel);
        this.active("标题底/联盟徽记",union,panel);
        this.text("俱乐部信息",header,panel);
        const headerNode = this.at("俱乐部信息",panel);
        const headerLabel = headerNode && headerNode.getComponent(cc.Label);
        if(headerLabel) headerLabel.overflow = cc.Label.Overflow.SHRINK;
        // 联盟审批是平铺全量列表，没有分页，也没有「返回成员」。
        this.active("管理返回成员",!union && this.approver(),panel);
        for(const name of ["管理第一页","管理上一页","管理下一页","管理最后一页","页码"])
            this.active(name,!union,panel);
    }
    /**
     * 盟友管理用 panel 上的 cc.Widget 按屏幕高度撑开（上下各 60），列表高度 = 面板高 - 200。
     * 这样长屏能看到更多行、短屏不会顶出屏幕；俱乐部申请/入盟审批仍恢复 940 固定布局。
     */
    private applyDialogLayout(allies:boolean):void {
        const panel = this.at("面板",this.at("俱乐部申请弹窗"));
        if(!panel) return;
        const place = (name:string,x:number,y:number):void => {
            const node = this.at(name,panel);
            if(node) node.setPosition(x,y);
        };
        const resize = (node:cc.Node,width:number,height:number):void => {
            if(node) node.setContentSize(width,height);
        };
        const widget = panel.getComponent(cc.Widget);
        const list = this.at("列表",panel);
        const view = this.at("列表/view",panel);
        const stat = this.at("统计",panel);
        if(allies) {
            if(widget) {
                widget.enabled = true;
                widget.alignFlags = 5; // TOP | BOTTOM
                widget.top = 60;
                widget.bottom = 60;
                widget.updateAlignment();
            }
            // Widget 按父弹窗实际高度撑开；若本帧尚未布局出高度，用可视高度兜底。
            const parentHeight = panel.parent && panel.parent.height > 0 ? panel.parent.height : cc.winSize.height;
            let panelHeight = panel.height;
            if(!panelHeight || panelHeight < 100) {
                panelHeight = Math.max(820,parentHeight - 120);
                panel.setContentSize(660,panelHeight);
            }
            const half = panelHeight / 2;
            place("标题底",0,half - 9);
            place("管理关闭",289,half - 39);
            place("俱乐部信息",0,half - 84);
            place("管理返回成员",-185,half - 146);
            // 盟友模式隐藏统计，把空间让给列表（否则会压到第一行）。
            if(stat) stat.active = false;
            const listHeight = Math.max(420,panelHeight - 200);
            place("列表",0,-15);
            resize(list,590,listHeight);
            resize(view,590,listHeight);
            if(view) view.setPosition(0,0);
            place("空状态",0,-15);
            place("管理刷新",0,-half + 40);
        } else {
            if(widget) widget.enabled = false;
            panel.setContentSize(660,940);
            panel.setPosition(0,0);
            place("标题底",0,461);
            place("管理关闭",289,431);
            place("俱乐部信息",0,386);
            place("管理返回成员",-185,324);
            if(stat) stat.active = true;
            place("列表",0,-16);
            resize(list,590,594);
            resize(view,590,594);
            if(view) view.setPosition(0,0);
            place("空状态",0,-12);
            place("管理刷新",0,-445);
            place("管理上一页",-190,-386);
            place("管理下一页",190,-386);
            place("页码",0,-386);
        }
    }
    private listRoot():cc.Node { return this.at(this.kind === "members" ? "俱乐部成员弹窗" : "俱乐部申请弹窗"); }
    private panel():cc.Node { return this.at("面板",this.listRoot()); }
    private button(name:string,enabled:boolean,parent:cc.Node):void {
        const n = this.at(name,parent);
        const button = n && n.getComponent(cc.Button);
        if(button) button.interactable = enabled;
    }
    private sameContext(a:ClubContext,b:ClubContext):boolean {
        return !!a && !!b && a.accountId === b.accountId && a.id === b.id && a.role === b.role;
    }

    public Refresh():void {
        const next = this.getContext() || {accountId:"",id:"",name:"",role:"member" as ClubRole};
        if(!this.sameContext(this.context,next)) {
            if(!this.context || this.context.accountId !== next.accountId) this.counts = {};
            ++this.version;
            this.loading = false;
            this.busy = false;
            this.pending = null;
            this.selectedPlayer = null;
            this.settingsDepth = 0;
            this.selectedDownline = [];
            this.settingsTab = "member";
            this.downlineLoading = false;
            this.downlineError = "";
            this.downlinePage = 0;
            this.downlineTotal = 0;
            ++this.downlineToken;
            this.inputMode = null;
            this.unionQuotaMode = null;
            this.selectedUnionMember = null;
            this.allyPoolQuotaFen = undefined;
            // 换账号/换俱乐部后，列表快照与「我有没有额度」都必须重新取，不能沿用上一家的结论。
            this.items = [];
            if(this.goldRefreshTimer != null) { clearTimeout(this.goldRefreshTimer);this.goldRefreshTimer = null; }
            for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗","俱乐部操作确认","俱乐部玩家设置弹窗","玩家设置输入弹窗"]) this.active(name,false);
            this.clearRows();
        }
        this.context = next;
        // 未加入俱乐部时整张卡片不显示，也不占滚动区高度。
        this.active("Main/我的/滚动区/view/content/当前俱乐部",!!next.id);
        const card = this.at("Main/我的/滚动区/view/content/当前俱乐部");
        this.text("名称",next.id ? next.name || "俱乐部 " + next.id : "暂无俱乐部",card);
        const nameNode = this.at("名称",card);
        const nameLabel = nameNode && nameNode.getComponent(cc.Label);
        if(nameLabel) nameLabel.overflow = cc.Label.Overflow.SHRINK;
        this.text("邀请码",next.id ? next.inviteCode || "" : "从俱乐部选择后查看信息",card);
        // 本俱乐部额度放在上方俱乐部区；下方联盟区只显示联盟名/ID/联盟池。
        const topQuotaFen = Number(next.clubQuotaFen);
        const showTopQuota = next.role === "owner" && Number.isFinite(topQuotaFen);
        this.active("俱乐部额度",showTopQuota,card);
        this.text("俱乐部额度",showTopQuota ? "额度：" + this.fenText(topQuotaFen) + " 元" : "",card);
        const canReviewUnion = this.canReviewUnion(next);
        // 「我的」卡片只在创建者（大群主/盟主/老板）或代理时显示身份牌；普通成员/管理员不占右侧位置。
        const showIdentity = !!next.id && (next.role === "owner" || next.role === "agent");
        this.text("身份",!showIdentity ? "" : next.role === "owner" ? this.creatorRole(next) : "代理",card);
        this.active("身份底",showIdentity,card);
        // 上方只保留俱乐部信息；联盟名+联盟号、额度、联盟池整体放到卡片下方联盟区。
        const unionId = next.id ? String(next.unionId || "").trim() : "";
        const showUnion = unionId !== "";
        const unionName = String(next.unionName || "").trim();
        this.active("栏目",false,card);
        this.active("联盟徽记",showUnion,card);
        // 左侧固定位显示俱乐部创建者（大群主/盟主/老板）的真实头像；没有俱乐部时整块隐藏。
        this.active("俱乐部徽记",!!next.id,card);
        const crest = next.id ? this.at("俱乐部徽记",card) : null;
        const crestSprite = crest && crest.getComponent(cc.Sprite);
        if(crestSprite) {
            if(next.ownerId) ImageManager.getInstance().BindPlayerListAvatar(next.ownerId,crestSprite);
            else ImageManager.getInstance().SetLocalAvatar(crestSprite,"1");
        }
        // 代理也走同一个入口，点进去就是成员列表（只读，管理操作仍限创建者/管理员）。
        this.active("操作/管理成员",this.approver(),card);
        this.active("操作/管理解散",!!next.id && next.role === "owner",card);
        // 目前不允许成员退出俱乐部，按钮保留但不显示。
        this.active("操作/管理退出",false,card);
        this.active("操作/管理收益",!!next.id && next.role === "owner",card);
        const canCreateJoin = this.canCreateJoin(next);
        const canApplyPending = this.unionApplying(next);
        const showUnionSection = this.unionSectionVisible(next);
        this.active("联盟信息",showUnionSection,card);
        if(showUnionSection) {
            const isClubOwner = next.role === "owner";
            const poolFen = Number(next.unionQuotaFen);
            const parts:string[] = [];
            if(showUnion) parts.push(unionName ? unionName + "（" + unionId + "）" : "联盟号 " + unionId);
            else parts.push("尚未加入联盟");
            if(isClubOwner && next.unionQuotaIsPool && Number.isFinite(poolFen))
                parts.push("联盟池 " + this.fenText(poolFen) + " 元");
            this.text("联盟信息",parts.join("  "),card);
        }
        // 联盟状态刷新后已不是总群主（联盟解散/切换俱乐部）时，关闭已打开的审批弹窗。
        if((this.kind === "union" || this.kind === "allies") && !canReviewUnion) this.active("俱乐部申请弹窗",false);
        this.active("联盟分割线",showUnionSection,card);
        this.active("联盟操作",showUnionSection,card);
        this.active("联盟操作/创建联盟",canCreateJoin,card);
        this.active("联盟操作/加入联盟",canCreateJoin || canApplyPending,card);
        // 文档：申请审核中只显示「加入联盟」并置灰提示；此时居中显示，不跟创建按钮并排。
        const joinButton = this.at("联盟操作/加入联盟",card);
        if(joinButton) {
            joinButton.setPosition(canApplyPending ? 0 : 158,0);
            joinButton.opacity = canApplyPending ? 160 : 255;
            const joinLabel = this.at("文字",joinButton);
            if(joinLabel) this.text("文字",canApplyPending ? "审核中" : "加入联盟",joinButton);
            const joinComp = joinButton.getComponent(cc.Button);
            if(joinComp) joinComp.interactable = !canApplyPending;
        }
        this.active("联盟操作/入盟申请",canReviewUnion,card);
        this.active("联盟操作/盟友管理",canReviewUnion,card);
        // 与「创建/加入联盟」同宽同排版；同时兜底文案，旧 Prefab 缓存里若是「加入联盟」也能纠正。
        for(const pair of [["入盟申请","入盟申请",-158],["盟友管理","盟友管理",158]]) {
            const button = this.at("联盟操作/" + pair[0],card);
            if(!button) continue;
            button.setContentSize(292,48);
            button.setPosition(Number(pair[2]),0);
            const icon = this.at("图标",button);
            if(icon) { icon.setContentSize(28,28);icon.setPosition(-98,0); }
            const label = this.at("文字",button);
            if(label) { label.setContentSize(180,40);label.setPosition(20,0); }
            this.text("文字",pair[1],button);
        }
        const dot = this.approver() && (this.counts[next.id] || 0) > 0;
        this.active("操作/管理成员/红点",dot,card);
        this.active("Down/我的/红点",dot);
        this.active("俱乐部成员弹窗/面板/管理申请/红点",dot);
        // 弹窗抬头只给「俱乐部名 + 邀请码」，与俱乐部列表卡片的码保持一致；
        // 俱乐部 ID 是内部主键，成员不需要看，也不再展示。
        const clubTitle = next.id ? (next.name || "俱乐部 " + next.id) : "";
        const inviteText = next.id && next.inviteCode ? "（邀请码:" + next.inviteCode + "）" : "";
        this.text("俱乐部成员弹窗/面板/俱乐部信息",clubTitle + inviteText);
        this.syncDialogText(clubTitle + inviteText);
        this.syncProfileScroll(!!next.id,showUnionSection);
    }
    /**
     * 「我的」滚动区内容高度：有卡片时 550；显示联盟区时卡片 320、内容 670。
     * 卡片加高后中心会下移，子节点需要整体上移 60，才能让标题仍贴住卡片顶部、
     * 联盟行落在底部，而不是在顶部留出一大块空白。
     * 无卡片时只剩按钮区 350，内容不高于可视区时撑满 view，避免可滚动的空白。
     */
    public syncProfileScroll(hasClub?:boolean,hasUnion?:boolean):void {
        const current = this.getContext();
        if(hasClub === undefined)
            hasClub = !!current && !!current.id;
        if(hasUnion === undefined)
            hasUnion = this.unionSectionVisible(current);
        const card = this.at("Main/我的/滚动区/view/content/当前俱乐部");
        if(card) {
            const cardHeight = hasUnion ? 320 : 200;
            if(Math.abs(card.height - cardHeight) > 0.5) card.height = cardHeight;
            const shift = hasUnion ? 60 : 0;
            for(const child of card.children) {
                if(this.cardBaseY[child.name] === undefined) this.cardBaseY[child.name] = child.y;
                child.y = this.cardBaseY[child.name] + shift;
            }
        }
        const content = this.at("Main/我的/滚动区/view/content");
        const view = this.at("Main/我的/滚动区/view");
        if(!content) return;
        const viewHeight = view ? view.height : 0;
        const height = Math.max(hasClub ? (hasUnion ? 670 : 550) : 350,viewHeight);
        if(Math.abs(content.height - height) > 0.5) content.height = height;
        // content 顶部锚点，贴住 view 顶边；否则缩高后内容会整体下移。
        if(view) content.setPosition(0,viewHeight / 2);
    }

    public HandleButton(button:cc.Button):boolean {
        const name = button.node.name;
        if(["管理关闭","管理成员","管理返回成员","管理申请","管理上一页","管理下一页",
            "管理第一页","管理最后一页","管理刷新","管理查询成员","管理重置成员搜索",
            "管理退出","管理解散","管理收益","创建联盟","加入联盟","入盟申请","盟友管理","管理取消","管理确认",
            "玩家设置关闭","玩家设置复制ID","玩家设置赠送金币","玩家设置上下分","玩家设置调整分数","玩家设置踢出俱乐部",
            "玩家设置调整比例","玩家设置代理开关","玩家设置取消代理",
            "玩家设置备注","玩家设置开通额度","玩家设置增加额度","玩家设置减少额度","玩家设置禁止游戏","玩家设置禁止账号",
            "成员设置","成员设置非激活","下级成员","下级成员激活",
            "下级第一页","下级上一页","下级下一页","下级最后一页",
            "玩家设置输入关闭","玩家设置输入取消","玩家设置输入确认"].indexOf(name) < 0) return false;
        this.Refresh();
        if(["玩家设置赠送金币","玩家设置上下分","玩家设置调整分数","玩家设置踢出俱乐部","玩家设置调整比例",
            "玩家设置代理开关","玩家设置取消代理","玩家设置备注","玩家设置开通额度","玩家设置增加额度","玩家设置减少额度","玩家设置禁止游戏",
            "玩家设置禁止账号"].indexOf(name) >= 0 && this.blockReadOnlyPlayer()) return true;
        if(name === "玩家设置关闭") {
            this.active("俱乐部玩家设置弹窗",false);
            this.selectedPlayer = null;
            this.settingsDepth = 0;
        } else if(name === "玩家设置复制ID") {
            if(this.selectedPlayer) this.message("玩家ID：" + this.selectedPlayer.id);
        } else if(name === "玩家设置赠送金币") {
            // 赠送是玩家之间转账（赠送_俱乐部_积分，扣自己的积分）。
            if(this.selectedPlayer && this.gift) this.gift(this.selectedPlayer,"give");
        } else if(name === "玩家设置上下分") {
            // 上下分是代理按授信额度给成员发/收筹码（添加_俱乐部_成员_积分），没额度的代理不出现该入口。
            if(!this.canUpDown()) { this.message("只有俱乐部创建者可以上下分");return true; }
            if(this.selectedPlayer && this.gift) this.gift(this.selectedPlayer,"updown");
        } else if(name === "玩家设置调整分数") {
            // Keep the legacy node callback for older prefabs; the formal V8
            // popup now routes the visible action through panelGivePad.
            this.submitPlayerValue("adjustScore","玩家设置分数输入","请输入目标积分");
        } else if(name === "玩家设置踢出俱乐部") {
            if(this.selectedPlayer) this.confirm("remove",this.selectedPlayer.id,this.selectedPlayer.name);
        } else if(name === "玩家设置调整比例") {
            if(this.selectedPlayer && this.isAgentPlayer(this.selectedPlayer)) this.openPlayerInput("ratio");
        } else if(name === "玩家设置代理开关") {
            if(this.selectedPlayer && this.isAgentPlayer(this.selectedPlayer))
                this.confirm("cancelAgent",this.selectedPlayer.id,this.selectedPlayer.name);
            else if(this.selectedPlayer)
                this.confirm("setAgent",this.selectedPlayer.id,this.selectedPlayer.name,"0");
        } else if(name === "玩家设置取消代理") {
            if(this.selectedPlayer) this.confirm("cancelAgent",this.selectedPlayer.id,this.selectedPlayer.name);
        } else if(name === "玩家设置备注") {
            if(this.selectedPlayer) this.openPlayerInput("remark");
        } else if(name === "玩家设置开通额度") {
            if(this.selectedPlayer) this.openPlayerInput("quota");
        } else if(name === "玩家设置增加额度") {
            if(this.selectedPlayer) this.openPlayerInput("quotaIncrease");
        } else if(name === "玩家设置减少额度") {
            if(this.selectedPlayer) this.openPlayerInput("quotaDecrease");
        } else if(name === "玩家设置禁止游戏" || name === "玩家设置禁止账号") {
            this.message("服务器接口暂未提供该设置");
        } else if(name === "成员设置" || name === "成员设置非激活") {
            this.showPlayerSettingsTab("member");
        } else if(name === "下级成员" || name === "下级成员激活") {
            this.showPlayerSettingsTab("downline");
        } else if(name === "下级第一页") {
            this.loadDownline(0);
        } else if(name === "下级上一页") {
            if(this.downlinePage > 0) this.loadDownline(this.downlinePage - 1);
        } else if(name === "下级下一页") {
            if((this.downlinePage + 1) * this.downlinePageSize < this.downlineTotal)
                this.loadDownline(this.downlinePage + 1);
        } else if(name === "下级最后一页") {
            const last = Math.max(0,Math.ceil(this.downlineTotal / this.downlinePageSize) - 1);
            if(this.downlinePage < last) this.loadDownline(last);
        } else if(name === "玩家设置输入关闭" || name === "玩家设置输入取消") {
            this.inputMode = null;
            this.unionQuotaMode = null;
            this.selectedUnionMember = null;
            this.active("玩家设置输入弹窗",false);
        } else if(name === "玩家设置输入确认") {
            if(this.unionQuotaMode) this.finishUnionQuotaInput();
            else this.finishPlayerInput();
        } else if(name === "管理关闭") {
            if(this.busy) return true;
            const popup = button.node && button.node.parent && button.node.parent.parent;
            if(popup) popup.active = false;
            ++this.version;
            this.loading = false;
            this.pending = null;
        } else if(name === "管理成员") {
            // 「俱乐部成员」对所有能进管理页的角色都应打开成员列表；
            // 代理的待审申请走列表内的「管理申请」入口进入。
            this.open("members");
        }
        else if(name === "管理返回成员") this.open("members");
        else if(name === "管理申请") this.open("applications");
        else if(name === "管理第一页") { if(!this.loading && this.page > 0) this.load(0); }
        else if(name === "管理上一页") { if(!this.loading && this.page > 0) this.load(this.page-1); }
        else if(name === "管理下一页") { if(!this.loading && (this.page+1)*this.pageSize < this.total) this.load(this.page+1); }
        else if(name === "管理最后一页") {
            const last = Math.max(0,Math.ceil(this.total/this.pageSize)-1);
            if(!this.loading && this.page < last) this.load(last);
        }
        else if(name === "管理查询成员") { if(!this.loading) this.load(0); }
        else if(name === "管理重置成员搜索") {
            const input = this.at("俱乐部成员弹窗/面板/成员搜索输入");
            const edit = input && input.getComponent(cc.EditBox);
            if(edit) edit.string = "";
            if(!this.loading) this.load(0);
        }
        else if(name === "管理刷新") { if(!this.loading) this.load(this.page); }
        else if(name === "管理退出") this.confirm("leave", "", "");
        else if(name === "管理收益") {
            // panelMyHongli 按俱乐部口径查收益（查询_俱乐部_代理_收益），必须带 club_id。
            if(this.context.id && this.context.role === "owner")
                UIManager.getInstance().showPanel("panelMyHongli",ShowPanelMode.Cover,
                    JSON.stringify({club_id:this.context.id,club_name:this.context.name || ""}));
        }
        else if(name === "创建联盟" || name === "加入联盟") {
            if(this.unionAction)
                this.unionAction(name === "创建联盟" ? "create" : "join");
        }
        else if(name === "入盟申请") this.openUnionApplications();
        else if(name === "盟友管理") this.openAllies();
        else if(name === "管理解散") this.confirm("dissolve", "", "");
        else if(name === "管理取消") {
            if(!this.busy) { this.active("俱乐部操作确认",false); this.pending = null; }
        } else if(name === "管理确认") this.submit();
        return true;
    }

    private open(kind:ClubListKind):void {
        if(this.busy) return;
        // 成员列表与申请列表都只要求「能进管理」的身份（创建者/管理员/代理）。
        // 代理点「俱乐部成员」同样能看直属列表；行内可操作项由 openPlayerSettings 按角色和层级收紧。
        if(kind === "union" || kind === "allies") {
            if(!this.canReviewUnion()) {
                this.message(kind === "allies" ? "只有联盟大群主可以查看盟友" : "只有联盟大群主可以查看入盟申请");
                return;
            }
        } else if(!this.approver()) return;
        this.active("俱乐部成员弹窗",kind === "members");
        this.active("俱乐部申请弹窗",kind !== "members");
        this.kind = kind;
        this.applyDialogLayout(kind === "allies");
        this.syncDialogText();
        this.load(0);
    }
    private openUnionApplications():void {
        this.open("union");
    }
    private openAllies():void {
        this.open("allies");
    }
    private clearRows():void {
        for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗"]) {
            const content = this.at(name+"/面板/列表/view/content");
            if(!content) continue;
            for(const row of content.children.slice()) if(row.name !== "行模板") {
                row.removeFromParent();row.destroy();
            }
        }
    }
    private paging():void {
        // 入盟申请是一次性全量推送，没有分页；只保留刷新。
        if(this.kind === "union" || this.kind === "allies") {
            for(const name of ["管理第一页","管理上一页","管理下一页","管理最后一页","页码"])
                this.active(name,false,this.panel());
            this.button("管理刷新",!this.loading && !this.busy,this.panel());
            return;
        }
        this.text("页码",(this.page+1)+" / "+Math.max(1,Math.ceil(this.total/this.pageSize)),this.panel());
        this.button("管理第一页",!this.loading && !this.busy && this.page > 0,this.panel());
        this.button("管理上一页",!this.loading && !this.busy && this.page > 0,this.panel());
        this.button("管理下一页",!this.loading && !this.busy && (this.page+1)*this.pageSize < this.total,this.panel());
        const last = Math.max(0,Math.ceil(this.total/this.pageSize)-1);
        this.button("管理最后一页",!this.loading && !this.busy && this.page < last,this.panel());
        this.button("管理刷新",!this.loading && !this.busy,this.panel());
    }
    private async load(page:number):Promise<void> {
        if(this.busy) return;
        if(this.kind === "allies") { await this.loadUnionMembers(); return; }
        if(this.kind === "union") { await this.loadUnionApplications(); return; }
        if(!this.approver()) return;
        const version = ++this.version;
        const ctx = {...this.context};
        const kind = this.kind;
        this.page = page;
        this.total = 0;
        this.clearRows();
        this.loading = !!this.api;
        this.paging();
        this.active("空状态",true,this.panel());
        this.text("空状态",this.api ? "加载中…" : "列表暂未开放",this.panel());
        this.text("统计",kind === "members" ? "直属成员" : "待审批申请",this.panel());
        if(!this.api) return;
        try {
            const result = await this.api.list(ctx.id,kind,page,this.pageSize,kind === "members" ? this.memberSearch() : "");
            if(!this.valid(version,ctx)) return;
            if(!result || !Array.isArray(result.items) || !Number.isFinite(result.total)) throw new Error("列表数据异常");
            this.total = Math.max(0,result.total);
            if(page > 0 && page*this.pageSize >= this.total) {
                this.loading = false;
                this.load(Math.max(0,Math.ceil(this.total/this.pageSize)-1));
                return;
            }
            if(kind === "applications") this.SetPendingCount(ctx.id,this.total);
            this.render(result.items);
            if(kind === "members") {
                const extra = Math.max(0,result.items.length - this.total);
                this.text("统计","直属 " + this.total + " 人" + (extra ? " · 盟主 " + extra : ""),this.panel());
            } else {
                this.text("统计","待审批 " + this.total + " 人",this.panel());
            }
            this.text("空状态",kind === "members" ? "暂无直属成员" : "暂无入会申请",this.panel());
            this.active("空状态",result.items.length === 0,this.panel());
        } catch(error) {
            if(this.valid(version,ctx)) this.text("空状态",error && error.message || "加载失败，请点击刷新重试",this.panel());
        } finally {
            if(this.valid(version,ctx)) { this.loading = false;this.paging(); }
        }
    }
    /** 入盟申请：服务端一次推送全部待审俱乐部，不分页、不按成员搜索。 */
    private async loadUnionApplications():Promise<void> {
        if(!this.canReviewUnion()) return;
        const version = ++this.version;
        const ctx = {...this.context};
        this.page = 0;
        this.total = 0;
        this.clearRows();
        this.loading = !!this.api;
        this.paging();
        this.syncDialogText();
        this.active("空状态",true,this.panel());
        this.text("空状态",this.api ? "加载中…" : "列表暂未开放",this.panel());
        this.text("统计","待审批申请",this.panel());
        if(!this.api) return;
        try {
            const result = await this.api.unionApplications();
            if(!this.valid(version,ctx) || this.kind !== "union") return;
            const items = result && Array.isArray(result.items) ? result.items : [];
            this.total = items.length;
            this.renderUnionApplications(items);
            this.text("统计",items.length ? "待审批 " + items.length + " 个俱乐部" : "待审批申请",this.panel());
            this.text("空状态","暂无入盟申请",this.panel());
            this.active("空状态",items.length === 0,this.panel());
        } catch(error) {
            if(this.valid(version,ctx))
                this.text("空状态",error && error.message || "加载失败，请点击刷新重试",this.panel());
        } finally {
            if(this.valid(version,ctx)) { this.loading = false;this.paging(); }
        }
    }
    /** ClubUnionApply 推送：审批弹窗已打开时直接替换列表，不需要再发一次查询。 */
    public OnUnionApplicationsPushed(page:ClubUnionApplicationPage):void {
        if(!page || !Array.isArray(page.items)) return;
        if(this.kind !== "union" || this.loading || this.busy || !this.canReviewUnion()) return;
        const dialog = this.at("俱乐部申请弹窗");
        if(!dialog || !dialog.active) return;
        const items = page.items;
        this.total = items.length;
        this.clearRows();
        this.renderUnionApplications(items,true);
        this.text("统计",items.length ? "待审批 " + items.length + " 个俱乐部" : "待审批申请",this.panel());
        this.text("空状态","暂无入盟申请",this.panel());
        this.active("空状态",items.length === 0,this.panel());
        this.paging();
    }
    /** ClubMyUnion 推送：盟友管理打开时实时更新各俱乐部额度与联盟池。 */
    public OnUnionMembersPushed(page:ClubUnionMemberPage):void {
        if(!page || !Array.isArray(page.items)) return;
        if(this.kind !== "allies" || this.loading || this.busy || !this.canReviewUnion()) return;
        const dialog = this.at("俱乐部申请弹窗");
        if(!dialog || !dialog.active) return;
        const items = page.items;
        this.total = items.length;
        const poolFen = Number(page.poolQuotaFen);
        if(Number.isFinite(poolFen)) this.allyPoolQuotaFen = poolFen;
        this.clearRows();
        this.renderUnionMembers(items,true);
        this.syncDialogText();
        this.text("统计",items.length ? "共 " + items.length + " 个俱乐部" : "联盟成员",this.panel());
        this.text("空状态","暂无加盟俱乐部",this.panel());
        this.active("空状态",items.length === 0,this.panel());
        this.paging();
    }
    /** ClubUnionQuota 推送更新的是池/本俱乐部额度；盟友列表和成员列表里的额度行都要跟着刷新。 */
    public OnUnionQuotaPushed():void {
        const dialog = this.at(this.kind === "members" ? "俱乐部成员弹窗" : "俱乐部申请弹窗");
        if(!dialog || !dialog.active) return;
        if(this.kind === "allies") {
            if(this.loading || this.busy || !this.canReviewUnion()) return;
            this.loadUnionMembers();
            return;
        }
        // 成员列表的盟主虚拟行/创建者行会显示俱乐部额度，额度变化后重拉当前页。
        if(this.kind === "members" && this.context && this.context.role === "owner" &&
            !this.loading && !this.busy)
            this.load(this.page);
    }
    /** 行模板与俱乐部申请一致：徽记 + 俱乐部名 + 俱乐部ID/群主 + 同意/拒绝。 */
    private renderUnionApplications(items:ClubUnionApplication[],keepScroll:boolean = false):void {
        const content = this.at("列表/view/content",this.panel());
        if(!content) return;
        const template = content.getChildByName("行模板");
        if(!template) return;
        const pitch = 200;
        const view = this.at("列表/view",this.panel());
        content.height = Math.max(view ? view.height : 0,items.length * pitch);
        if(view) content.setPosition(0,view.height / 2);
        const context = {...this.context};
        const icon = this.unionIconFrame();
        items.forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "联盟_" + item.clubId;
            row.parent = content;
            row.active = true;
            row.setPosition(0,-100 - index * pitch);
            this.fillUnionApplicationRow(row,item,icon);
            for(const pair of [["管理同意","unionApprove"],["管理拒绝","unionReject"]])
                if(this.at(pair[0],row)) this.at(pair[0],row).on("click",()=>{
                    if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
                    this.Refresh();
                    this.confirm(pair[1] as ClubAction,item.clubId,item.clubName || item.clubId);
                },this);
        });
        const scroll = this.at("列表",this.panel());
        const scrollView = scroll && scroll.getComponent(cc.ScrollView);
        if(!keepScroll && scrollView) scrollView.scrollToTop(0);
    }
    private fillUnionApplicationRow(row:cc.Node,item:ClubUnionApplication,icon:cc.SpriteFrame):void {
        this.text("姓名",item.clubName || "俱乐部 " + item.clubId,row);
        this.text("玩家ID","俱乐部ID: " + item.clubId + (item.ownerName ? "  群主：" + item.ownerName : ""),row);
        // 俱乐部名与群主名长度不可控，缩放而不是硬截断，保证两行都完整可读。
        for(const name of ["姓名","玩家ID"]) {
            const node = this.at(name,row);
            const label = node && node.getComponent(cc.Label);
            if(label) label.overflow = cc.Label.Overflow.SHRINK;
        }
        const avatar = this.at("头像",row);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite && icon) avatarSprite.spriteFrame = icon;
    }
    /** 盟友管理：查询_我的_联盟 返回联盟内全部俱乐部（含总群主自己那家）。 */
    private async loadUnionMembers():Promise<void> {
        if(!this.canReviewUnion()) return;
        const version = ++this.version;
        const ctx = {...this.context};
        this.page = 0;
        this.total = 0;
        this.clearRows();
        this.loading = !!this.api;
        this.paging();
        this.syncDialogText();
        this.active("空状态",true,this.panel());
        this.text("空状态",this.api ? "加载中…" : "列表暂未开放",this.panel());
        this.text("统计","联盟成员",this.panel());
        if(!this.api) return;
        // 热更新后可能出现「新界面 + 旧 API 脚本」：给出明确提示，避免把 JS TypeError 直接抛到界面。
        if(typeof (this.api as any).unionMembers !== "function") {
            this.loading = false;
            this.paging();
            this.text("空状态","盟友列表需要重新编译/更新客户端后使用",this.panel());
            return;
        }
        try {
            const result = await this.api.unionMembers();
            if(!this.valid(version,ctx) || this.kind !== "allies") return;
            const items = result && Array.isArray(result.items) ? result.items : [];
            this.total = items.length;
            this.renderUnionMembers(items);
            const poolFen = Number(result && result.poolQuotaFen);
            if(Number.isFinite(poolFen)) this.allyPoolQuotaFen = poolFen;
            this.syncDialogText();
            this.text("统计",items.length ? "共 " + items.length + " 个俱乐部" : "联盟成员",this.panel());
            this.text("空状态","暂无加盟俱乐部",this.panel());
            this.active("空状态",items.length === 0,this.panel());
        } catch(error) {
            if(this.valid(version,ctx))
                this.text("空状态",error && error.message || "加载失败，请点击刷新重试",this.panel());
        } finally {
            if(this.valid(version,ctx)) { this.loading = false;this.paging(); }
        }
    }
    private renderUnionMembers(items:ClubUnionMember[],keepScroll:boolean = false):void {
        const content = this.at("列表/view/content",this.panel());
        if(!content) return;
        const template = content.getChildByName("行模板");
        if(!template) return;
        const pitch = 200;
        const view = this.at("列表/view",this.panel());
        content.height = Math.max(view ? view.height : 0,items.length * pitch);
        if(view) content.setPosition(0,view.height / 2);
        const icon = this.unionIconFrame();
        const accountId = String(this.context && this.context.accountId || "");
        items.forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "盟友_" + item.clubId;
            row.parent = content;
            row.active = true;
            row.setPosition(0,-100 - index * pitch);
            this.fillUnionMemberRow(row,item,icon,!!item.ownerId && item.ownerId === accountId);
            // 大群主点俱乐部头像/名字进入该俱乐部成员列表，再点某个人开聊。
            this.bindUnionMemberList(row,item);
            for(const pair of [["管理拒绝","decrease"],["管理同意","increase"]])
                if(this.at(pair[0],row)) this.at(pair[0],row).on("click",()=>{
                    this.openUnionQuotaInput(item,pair[1] as "increase"|"decrease");
                },this);
        });
        const scroll = this.at("列表",this.panel());
        const scrollView = scroll && scroll.getComponent(cc.ScrollView);
        if(!keepScroll && scrollView) scrollView.scrollToTop(0);
    }
    private fillUnionMemberRow(row:cc.Node,item:ClubUnionMember,icon:cc.SpriteFrame,isUnionOwner:boolean):void {
        const name = item.clubName || "俱乐部 " + item.clubId;
        this.text("姓名",name + (isUnionOwner ? "（大群主）" : ""),row);
        this.text("玩家ID","俱乐部ID: " + item.clubId + (item.ownerName ? "  群主：" + item.ownerName : "") +
            " · 点名字查看成员",row);
        const quotaFen = Number(item.quotaFen);
        const quotaNode = this.at("盟友额度",row);
        if(quotaNode) {
            quotaNode.color = new cc.Color(255,238,197);
            quotaNode.setPosition(43,-12);
            quotaNode.setContentSize(386,24);
            const quotaLabel = quotaNode.getComponent(cc.Label);
            if(quotaLabel) { quotaLabel.fontSize = 20;quotaLabel.lineHeight = 24; }
        }
        this.active("盟友额度",Number.isFinite(quotaFen),row);
        if(Number.isFinite(quotaFen))
            this.text("盟友额度","俱乐部额度：" + this.fenText(quotaFen) + " 元",row);
        for(const labelName of ["姓名","玩家ID","盟友额度"]) {
            const node = this.at(labelName,row);
            const label = node && node.getComponent(cc.Label);
            if(label) label.overflow = cc.Label.Overflow.SHRINK;
        }
        // 复用行内两个按钮：左「减少额度」（蓝）、右「增加额度」（金）。
        for(const pair of [["管理拒绝","减少额度"],["管理同意","增加额度"]]) {
            const button = this.at(pair[0],row);
            if(!button) continue;
            button.active = true;
            this.text("文字",pair[1],button);
        }
        const avatar = this.at("头像",row);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) {
            if(item.ownerId) ImageManager.getInstance().BindPlayerListAvatar(item.ownerId,avatarSprite);
            else if(icon) avatarSprite.spriteFrame = icon;
        }
    }
    /**
     * 联盟大群主进入某个加盟俱乐部的成员列表。成员列表页复用 panelMessageMembers，
     * 服务端允许大群主查询联盟内任意俱乐部成员并发起跨俱乐部会话。
     */
    private bindUnionMemberList(row:cc.Node,item:ClubUnionMember):void {
        if(!this.canReviewUnion()) return;
        const open = ():void=>{
            if(!item.clubId) return;
            UIManager.getInstance().showPanel("panelMessageMembers",ShowPanelMode.Cover,
                JSON.stringify({clubId:item.clubId,clubName:item.clubName || ""}));
        };
        for(const name of ["头像","姓名","玩家ID"]) {
            const node = this.at(name,row);
            if(!node) continue;
            node.targetOff(this);
            node.on(cc.Node.EventType.TOUCH_END,open,this);
        }
    }
    private fenText(fen:any):string {
        const number = Number(fen);
        if(!Number.isFinite(number)) return "—";
        const yuan = number / 100;
        return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/\.?0+$/,"");
    }
    /** 复用卡片上「入盟申请」按钮的图标作为俱乐部行徽记，避免再引一份大图。 */
    private unionIconFrame():cc.SpriteFrame {
        const icon = this.at("Main/我的/滚动区/view/content/当前俱乐部/联盟操作/入盟申请/图标");
        const sprite = icon && icon.getComponent(cc.Sprite);
        return sprite ? sprite.spriteFrame : null;
    }
    private valid(version:number,ctx:ClubContext):boolean {
        return cc.isValid(this.root) && version === this.version && this.sameContext(ctx,this.getContext());
    }
    private memberSearch():string {
        const input = this.at("俱乐部成员弹窗/面板/成员搜索输入");
        const edit = input && input.getComponent(cc.EditBox);
        return edit && edit.string ? edit.string.trim() : "";
    }
    private value(value:any):string { return value === undefined || value === null || String(value).trim() === "" ? "—" : String(value); }
    /**
     * 成员列表不一定下发 is_agent：字段存在就只认它（普通成员身上也会带上级给的比例字段，
     * 不能单看 percent），字段缺失时才退回按比例判定——非代理的 percent 恒为 0。
     */
    private isAgentPlayer(item:ClubPlayer):boolean {
        if(item.isAgent !== undefined) return item.isAgent;
        const percent = Number(item.agentPercent);
        return Number.isFinite(percent) && percent > 0;
    }
    private percentText(item:ClubPlayer):string {
        const value = item.agentPercent === undefined || item.agentPercent === null ? "" : String(item.agentPercent).trim();
        return (value === "" ? "0" : value) + "%";
    }
    /** 当前弹窗操作者可给直属代理授信；服务端仍会再次校验直属关系和自己的额度。 */
    private canGrantQuota():boolean {
        const player = this.selectedPlayer;
        if(!player || this.readOnlyPlayer() || !this.canManageAgent()) return false;
        if(!this.isAgentPlayer(player)) return false;
        return String(player.id || "") !== String(this.context && this.context.accountId || "") &&
            String(player.id || "") !== String(this.context && this.context.ownerId || "");
    }
    private fillMemberQuota(row:cc.Node,item:ClubPlayer,identity:string):void {
        if(!item) { this.active("额度",false,row);this.active("额度值",false,row);return; }
        // 只有大群主和盟主有俱乐部额度；代理、普通成员不显示。
        const fen = Number(item.clubQuotaFen);
        const show = (identity === "大群主" || identity === "盟主") && Number.isFinite(fen);
        this.active("额度",show,row);
        this.active("额度值",show,row);
        if(show) {
            this.text("额度","额度",row);
            this.text("额度值",this.fenText(fen),row);
        }
    }
    /**
     * 自己那一行只保留「赠送 / 上下分」：设代理、调比例、备注、授信、踢出这些
     * 针对别人的管理操作全部收起（页签切换会重新激活，所以每次都要再走一遍）。
     */
    private syncSelfActions():void {
        if(!this.isSelfSelected()) return;
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        if(!panel) return;
        for(const name of ["玩家设置调整比例","玩家设置代理开关","玩家设置开通额度",
            "玩家设置增加额度","玩家设置减少额度","玩家设置备注","玩家设置踢出俱乐部"])
            this.active(name,false,panel);
    }
    /** 当前玩家设置卡打开的是不是自己那一行（自己只能赠送/上下分，不能管理自己）。 */
    private isSelfSelected():boolean {
        const player = this.selectedPlayer;
        return !!player && !!this.context && String(player.id) === String(this.context.accountId || "");
    }
    /** V2：上下分只开放给俱乐部创建者（老板）；代理/管理员只能赠送。 */
    private canUpDown():boolean {
        return !!this.context && this.context.role === "owner";
    }
    /** 上下分入口：俱乐部创建者打开其他成员时显示；自己那行/老板行不显示。 */
    private syncUpDownButton():void {
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        const player = this.selectedPlayer;
        if(!panel || !player || !this.context) return;
        // 俱乐部创建者查看自己或他人都可上下分；代理不显示。
        const show = !this.readOnlyPlayer() && this.canUpDown();
        this.active("玩家设置上下分",show,panel);
        this.button("玩家设置上下分",show,panel);
    }
    /**
     * 赠送/上下分成功后由大厅转发过来：成员列表行上的积分和玩家设置卡里的积分都要重取，
     * 服务端记账可能比回包晚一点，所以再补一次刷新，避免停在旧数字上。
     */
    public OnPlayerGoldChanged(userId:string = ""):void {
        const context = this.context;
        if(!context || !context.id) return;
        const members = this.at("俱乐部成员弹窗");
        const settings = this.at("俱乐部玩家设置弹窗");
        const listOpen = !!(members && members.active);
        const settingsOpen = !!(settings && settings.active);
        if(!listOpen && !settingsOpen) return;
        const target = String(userId || (this.selectedPlayer && this.selectedPlayer.id) || "");
        this.refreshMemberData(target);
        if(this.goldRefreshTimer != null) clearTimeout(this.goldRefreshTimer);
        this.goldRefreshTimer = setTimeout(()=>{
            this.goldRefreshTimer = null;
            if(!cc.isValid(this.root)) return;
            const stillOpen = this.at("俱乐部成员弹窗");
            if(!stillOpen || !stillOpen.active) return;
            if(!this.sameContext(context,this.getContext())) return;
            this.refreshMemberData(target);
        },1500);
    }
    private refreshMemberData(targetId:string):void {
        const context = this.context;
        if(!context || !context.id || !this.api) return;
        this.load(this.page).then(()=>{
            if(!this.sameContext(context,this.getContext())) return;
            this.reloadPlayerCard(targetId);
        });
    }
    /** 用新一页数据替换玩家设置卡：只改服务端会变的数值，不动页签/层级状态。 */
    private reloadPlayerCard(targetId:string):void {
        const player = this.selectedPlayer;
        if(!player) return;
        const id = String(targetId || player.id);
        if(String(player.id) !== id) return;
        const fresh = (this.items || []).filter(item=>String(item.id) === id)[0];
        if(!fresh) return;
        this.selectedPlayer = fresh;
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        this.text("玩家积分值",this.value(fresh.clubGold !== undefined ? fresh.clubGold : fresh.points),panel);
        this.text("备注值",fresh.note || "未设置",panel);
        const freshIdentity = this.memberIdentity(fresh,this.context);
        this.text("比例值",(this.isAgentPlayer(fresh) || freshIdentity === "盟主" || freshIdentity === "大群主") ? this.percentText(fresh) : "未开通",panel);
    }
    /** 有备注时统一显示「名字(备注)」，成员列表、下级列表与玩家信息抬头共用。 */
    private displayName(item:ClubPlayer):string {
        const name = item && item.name || (item ? "玩家 " + item.id : "");
        const note = item && item.note != null ? String(item.note).trim() : "";
        return note ? name + "(" + note + ")" : name;
    }
    /**
     * 备注权限与代理比例一致：创建者或该成员当前直属上级代理可写，服务端会兜底校验。
     * 自己与创建者不能写备注，跨级下钻只读。
     */
    private canRemarkPlayer():boolean {
        const player = this.selectedPlayer;
        const context = this.context;
        if(!player || !context || this.readOnlyPlayer() || !this.canManageAgent()) return false;
        return String(player.id) !== String(context.accountId || "") &&
            String(player.id) !== String(context.ownerId || "");
    }
    private status(item:ClubPlayer):string {
        if(item.status && ["online","在线","on","1","true"].indexOf(String(item.status).trim().toLowerCase()) < 0 &&
            ["offline","离线","off","0","false"].indexOf(String(item.status).trim().toLowerCase()) < 0)
            return String(item.status);
        return item.online === undefined ? "—" : item.online ? "在线" : "离线";
    }
    private rowText(row:cc.Node,names:string[],value:string):void {
        for(const name of names) {
            if(this.at(name,row)) { this.text(name,value,row); return; }
        }
    }
    private metricText(row:cc.Node,name:string,value:any):void {
        const valueNode = this.at(name + "值",row);
        if(valueNode) {
            this.text(name,name,row);
            this.text(name + "值",this.value(value),row);
            return;
        }
        this.rowText(row,name === "积分" ? ["积分","余额"] : [name],name + "：" + this.value(value));
    }
    /**
     * 输赢配色：赢（正数）红、输（负数）绿，0 与空值/「—」保持 Prefab 原色。
     * 行节点每次由模板 cc.instantiate 新建，不需要复位颜色，只在需要着色时改。
     */
    private winColor(value:any):cc.Color {
        const text = value === undefined || value === null ? "" : String(value).replace(/[,，\s]/g,"");
        if(text === "" || text === "—" || text === "-" || text === "+") return null;
        const number = Number(text);
        if(!isFinite(number) || number === 0) return null;
        // 与钱包记录的收支配色保持一致：红 255,92,80 / 绿 151,211,57。
        return number > 0 ? new cc.Color(255,92,80) : new cc.Color(151,211,57);
    }
    private winText(row:cc.Node,name:string,value:any):void {
        this.metricText(row,name,value);
        const color = this.winColor(value);
        const node = color ? this.at(name + "值",row) : null;
        if(node) node.color = color;
    }
    /** 成员身份统一口径：创建者（大群主/盟主/老板）、管理员、代理、成员。 */
    private memberIdentity(item:ClubPlayer,context:ClubContext):string {
        if(!item) return "成员";
        const isOwner = item.id === context.ownerId ||
            (item.id === context.accountId && context.role === "owner");
        const isSelf = item.id === context.accountId;
        const isAgent = this.isAgentPlayer(item);
        return isOwner ? this.creatorRole(context) :
            isSelf && context.role === "manager" ? "管理员" :
            isAgent ? "代理" : item.role || "成员";
    }
    /** 成员列表与下级成员列表共用同一套行内容，保证两处显示一致。 */
    private fillMemberRow(row:cc.Node,item:ClubPlayer):void {
        const context = this.context || {accountId:"",id:"",name:"",role:"member" as ClubRole};
        this.text("姓名",this.displayName(item),row);
        this.text("玩家ID","ID: "+item.id,row);
        const avatar = this.at("头像",row);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
        const identity = this.memberIdentity(item,context);
        const isAgent = this.isAgentPlayer(item);
        this.rowText(row,["身份"],identity);
        this.active("盟主底色",identity === "盟主",row);
        this.metricText(row,"团队人数",item.teamCount);
        this.metricText(row,"积分",item.clubGold !== undefined ? item.clubGold : item.points);
        // 代理有代理比例；盟主/大群主默认有联盟比例（盟主虚拟行 is_agent=0，也必须显示）。
        const showPercent = isAgent || identity === "盟主" || identity === "大群主";
        this.active("比例",showPercent,row);
        this.active("比例值",showPercent,row);
        if(showPercent) {
            this.text("比例","比例",row);
            this.text("比例值",this.percentText(item),row);
        }
        this.fillMemberQuota(row,item,identity);
        this.winText(row,"今日输赢",item.todayWin);
        this.winText(row,"昨日输赢",item.yesterdayWin);
        this.winText(row,"总输赢",item.totalWin);
        this.metricText(row,"今日贡献",item.todayContribution);
        this.metricText(row,"昨日贡献",item.yesterdayContribution);
        this.metricText(row,"总贡献",item.totalContribution);
        this.rowText(row,["状态"],this.status(item));
        // Member cards are intentionally read-only. Keep old serialized
        // nodes hidden for prefab compatibility; avatar is the only entry
        // point for player settings.
        for(const name of ["成员删除","成员赠予","设置","成员设管理员"]) {
            const oldAction = this.at(name,row);
            if(oldAction) oldAction.active = false;
        }
        // 行尾「对话」：群主/盟主/代理可以找同俱乐部成员开聊，自己那行不显示。
        this.bindDirectChat(row,item,context);
    }

    /**
     * 俱乐部成员列表的「对话」入口。
     *
     * 群主（owner）、代理（agent/leader）可以发起同俱乐部会话；联盟大群主
     * 还可以对成员行自带的 club_id 发起跨俱乐部会话（盟主虚拟行就是其它俱乐部）。
     * 管理员与普通成员不显示按钮，服务端仍会再校验关系。
     */
    private bindDirectChat(row:cc.Node,item:ClubPlayer,context:ClubContext):void {
        const btn = this.at("对话",row);
        if(!btn) return;
        const selfId = String(context.accountId || "").trim();
        const peerId = String(item.id || "").trim();
        const chatClubId = String(item.clubId || context.id || "").trim();
        const canChat = context.role === "owner" || context.role === "agent" ||
            context.isLeader === true || context.unionIsOwner === true;
        const show = canChat && chatClubId !== "" && peerId !== "" && peerId !== selfId;
        btn.active = show;
        if(!show) return;
        btn.targetOff(this);
        btn.on("click",()=>{ this.openDirectChat(chatClubId,peerId,item); },this);
    }

    /** 先创建/恢复会话（服务端幂等），拿到 conversationId 再进聊天详情。 */
    private openDirectChat(clubId:string,peerId:string,item:ClubPlayer):void {
        if(!clubId || !peerId) return;
        const manager = DirectChatManager.GetInstance();
        manager.OpenConversation(clubId,peerId).then(conversation=>{
            UIManager.getInstance().showPanel("panelMessageChat",ShowPanelMode.Cover,
                JSON.stringify({clubId:clubId,conversationId:conversation.conversationId,peer:conversation.peer}));
        }).catch((error:any)=>{
            const text = error != null && error.message ? String(error.message) : "打开聊天失败，请稍后重试";
            this.message(text);
        });
    }
    /**
     * 行模板里的透明点击层「玩家热区」：盖住头像 + 姓名 + 玩家 ID 一整块，比只点头像好按。
     * 老 prefab 没有这个节点时退回只绑头像，行为保持可用。
     */
    private playerHotzone(row:cc.Node):cc.Node {
        return this.at("玩家热区",row) || this.at("头像",row);
    }
    /** click 依赖 cc.Button 派发，TOUCH_END 是节点自身事件；两条都挂，滑动时按位移过滤。 */
    private bindPlayerSettings(target:cc.Node,item:ClubPlayer,context:ClubContext,depth:number):void {
        if(!target) return;
        let lastTap = 0,moved = false,downX = 0,downY = 0;
        const onDown = (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            downX = point.x;downY = point.y;moved = false;
        };
        const onMove = (event:cc.Event.EventTouch)=>{
            const point = event.getLocation();
            if(Math.abs(point.x - downX) > 20 || Math.abs(point.y - downY) > 20) moved = true;
        };
        const openSettings = ()=>{
            if(moved) return;
            const now = Date.now();
            if(now - lastTap < 300) return;
            lastTap = now;
            if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
            this.openPlayerSettings(item,depth);
        };
        target.targetOff(this);
        target.on(cc.Node.EventType.TOUCH_START,onDown,this);
        target.on(cc.Node.EventType.TOUCH_MOVE,onMove,this);
        target.on(cc.Node.EventType.TOUCH_END,openSettings,this);
        target.on("click",openSettings,this);
    }
    private render(items:ClubPlayer[]):void {
        this.items = items;
        const content = this.at("列表/view/content",this.panel());
        if(!content) return;
        const template = content.getChildByName("行模板");
        if(!template) return;
        const rowHeight = template.height;
        const pitch = this.kind === "members" ? rowHeight + 16 : 200;
        const firstY = this.kind === "members" ? -rowHeight / 2 : -100;
        const view = this.at("列表/view",this.panel());
        content.height = Math.max(view ? view.height : 0,items.length*pitch);
        // content uses a top anchor. Re-center its top edge after the view is
        // stretched by Widget on tall phones, otherwise rows stay at the old
        // 804px authored position and overlap the search area.
        if(view) content.setPosition(0,view.height / 2);
        const context = {...this.context};
        items.forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "玩家_"+item.id; row.parent = content; row.active = true;
            row.setPosition(0,firstY-index*pitch);
            if(this.kind === "members") {
                this.fillMemberRow(row,item);
                // 自己那一行也能进玩家设置（里面只剩赠送/上下分），所以不再跳过绑定。
                this.bindPlayerSettings(this.playerHotzone(row),item,context,0);
            }
            else {
                this.text("姓名",item.name || "玩家 "+item.id,row);
                this.text("玩家ID","ID: "+item.id,row);
                const avatar = this.at("头像",row);
                const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
                if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
                for(const pair of [["管理同意","approve"],["管理拒绝","reject"]])
                    if(this.at(pair[0],row)) this.at(pair[0],row).on("click",()=>{
                        if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
                        this.Refresh();
                        this.confirm(pair[1] as ClubAction,item.id,item.name);
                    },this);
            }
        });
        const scroll = this.at("列表",this.panel());
        const scrollView = scroll && scroll.getComponent(cc.ScrollView);
        if(scrollView) scrollView.scrollToTop(0);
    }
    private openPlayerSettings(item:ClubPlayer,depth:number = 0):void {
        if(!item) return;
        // 创建者、管理员、代理都能打开；代理只管理自己直属的下级，
        // 具体到踢人/改积分等按钮再按角色和层级收紧。
        if(!this.approver()) { this.message("仅创建者/管理员/代理可管理成员");return; }
        // 自己那一行也允许打开（代理给自己补分/赠送），但面板里只保留「赠送」「上下分」，
        // 设代理、调比例、备注、额度、踢出等管理操作对本人一律收起（见下方 isSelf 判断）。
        const modal = this.at("俱乐部玩家设置弹窗");
        const panel = this.at("面板",modal);
        if(!modal || !panel) { this.message("玩家设置面板暂未加载");return; }
        this.selectedPlayer = item;
        this.settingsDepth = Math.max(0,Math.floor(depth) || 0);
        const readOnly = this.readOnlyPlayer();
        this.selectedDownline = [];
        this.settingsTab = "member";
        this.downlineLoading = false;
        this.downlineError = "";
        this.downlinePage = 0;
        this.downlineTotal = 0;
        // 切换玩家后旧请求一律作废；下级列表只在点开「下级成员」页签时才查。
        ++this.downlineToken;
        this.active("俱乐部玩家设置弹窗",true);
        this.active("玩家设置只读提示",readOnly,panel);
        this.text("玩家姓名",this.displayName(item),panel);
        this.text("玩家ID","ID: "+item.id,panel);
        const isAgent = this.isAgentPlayer(item);
        const identity = this.memberIdentity(item,this.context);
        this.text("玩家身份",identity,panel);
        this.layoutRole(identity,panel);
        const statusText = this.status(item);
        const online = statusText === "在线";
        this.text("玩家状态",statusText,panel);
        this.active("玩家状态/状态点",online,panel);
        const statusNode = this.at("玩家状态",panel);
        if(statusNode) statusNode.color = online ? new cc.Color(155,255,109) : new cc.Color(201,216,228);
        this.text("玩家积分值",this.value(item.clubGold !== undefined ? item.clubGold : item.points),panel);
        this.text("备注值",item.note || "未设置",panel);
        this.text("比例值",(isAgent || identity === "盟主" || identity === "大群主") ? this.percentText(item) : "未开通",panel);
        this.text("代理开关文字",isAgent ? "开" : "关",panel);
        this.active("玩家设置代理开关/开",isAgent,panel);
        this.active("玩家设置代理开关/关",!isAgent,panel);
        const avatar = this.at("头像",panel);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
        const isSelf = String(item.id) === String(this.context.accountId || "");
        const isOwner = String(item.id) === String(this.context.ownerId || "") ||
            (isSelf && this.context.role === "owner");
        // 跨级只读：连按钮一起收起，避免看起来还能点；行内数值仍保留可查看。
        const canAgent = !readOnly && this.canManageAgent();
        // 自己那一行只留「赠送 / 上下分」，代理关系类操作整块收起（不给点也不显示）。
        const canManageTarget = !isSelf;
        // 赠送只对“其他人”，自己那行不显示赠送；老板给其他人可赠送+上下分，代理给其他人只有赠送。
        const canGift = !isSelf && !isOwner;
        this.active("玩家设置赠送金币",!readOnly && canGift,panel);
        // 上下分只有俱乐部创建者显示（含自己那行）；代理没有上下分。
        // 目前不允许踢出俱乐部，按钮保留但不显示。
        this.active("玩家设置踢出俱乐部",false,panel);
        this.active("玩家设置调整比例",canAgent && isAgent && canManageTarget,panel);
        this.active("玩家设置代理开关",canAgent && canManageTarget,panel);
        this.button("玩家设置赠送金币",!readOnly && canGift,panel);
        this.button("玩家设置踢出俱乐部",false,panel);
        this.button("玩家设置调整比例",canAgent && isAgent && canManageTarget && !isOwner,panel);
        this.button("玩家设置代理开关",canAgent && canManageTarget && !isOwner,panel);
        // 备注行对所有人可见；「设置备注」按钮由 showPlayerSettingsTab 按权限决定。
        this.button("玩家设置备注",this.canRemarkPlayer(),panel);
        // These two controls remain visible as reserved layout rows but have no
        // documented server command yet.
        this.button("玩家设置禁止游戏",false,panel);
        this.button("玩家设置禁止账号",false,panel);
        this.renderDownline(panel);
        this.showPlayerSettingsTab("member");
    }
    private settingsMemberNodes():string[] {
        return ["备注","备注底","备注值","比例","比例底","比例值","玩家设置调整比例","代理","代理底",
            "代理开关文字","玩家设置代理开关"];
    }
    private roleText(item:ClubPlayer):string {
        const role = String(item.role || "").trim();
        if(role === "owner" || role === "老板" || role === "创建者") return "老板";
        if(role === "manager" || role === "管理员") return "管理员";
        if(role === "agent" || role === "代理") return "代理";
        return "成员";
    }
    /** 身份牌是九宫格，按字数定宽；左边界固定，状态跟着右移，避免叠字。 */
    private layoutRole(text:string,panel:cc.Node):void {
        const width = text.length >= 4 ? 104 : text.length === 3 ? 80 : 60;
        for(const name of ["身份底","玩家身份"]) {
            const node = this.at(name,panel);
            if(!node) continue;
            node.active = true;
            node.setContentSize(width,28);
            node.setPosition(-150 + width / 2,419);
        }
        const status = this.at("玩家状态",panel);
        if(status) status.setPosition(-9 + Math.max(0,width - 60),419);
    }
    private showPlayerSettingsTab(tab:"member"|"downline"):void {
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        if(!panel) return;
        this.settingsTab = tab;
        const member = tab === "member";
        this.settingsMemberNodes().forEach(name=>this.active(name,member,panel));
        // 备注行随成员页签显示；只有创建者/直属上级代理能看到编辑按钮。
        this.active("玩家设置备注",member && this.canRemarkPlayer(),panel);
        this.button("玩家设置备注",member && this.canRemarkPlayer(),panel);
        // 页签切换会重新激活比例/代理行按钮，只读态必须在之后统一收起。
        if(this.readOnlyPlayer()) {
            for(const name of ["玩家设置赠送金币","玩家设置上下分","玩家设置踢出俱乐部","玩家设置调整比例",
                "玩家设置代理开关","玩家设置备注"])
                this.active(name,false,panel);
        }
        // 上下分只有俱乐部创建者显示，切换成员/下级成员页签不会消失。
        this.syncUpDownButton();
        // 切页签会把管理类行按钮重新激活，自己那一行要再统一收起一次。
        this.syncSelfActions();
        this.active("玩家设置下级列表",!member,panel);
        this.active("成员设置",member,panel);
        this.active("成员设置非激活",!member,panel);
        this.active("下级成员",member,panel);
        this.active("下级成员激活",!member,panel);
        this.active("成员设置选中线",member,panel);
        this.active("下级成员选中线",!member,panel);
        this.active("成员设置选中菱形",member,panel);
        this.active("下级成员选中菱形",!member,panel);
        // 分页条只属于下级成员列表，成员设置页签里整组隐藏。
        for(const name of ["下级第一页","下级上一页","下级页码","下级下一页","下级最后一页"])
            this.active(name,!member,panel);
        // 下级成员只在点击页签时查询，避免每次打开玩家设置都多发一次列表请求。
        if(!member) this.loadDownline(this.downlinePage);
    }
    private async loadDownline(page:number):Promise<void> {
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        if(!panel || this.downlineLoading) return;
        const player = this.selectedPlayer;
        const context = this.context ? {...this.context} : null;
        if(!this.api || !context || !context.id || !player) return;
        // 普通成员没有下级；只有代理才能按 agent_id 下钻其直属成员。
        if(!this.isAgentPlayer(player)) {
            this.selectedDownline = [];
            this.downlinePage = 0;
            this.downlineTotal = 0;
            this.renderDownline(panel);
            return;
        }
        const playerId = player.id;
        const token = ++this.downlineToken;
        const version = this.version;
        this.downlinePage = page;
        this.downlineLoading = true;
        this.downlineError = "";
        // 翻页时先清空旧页，避免请求失败后仍显示上一页的行却已换页码。
        this.selectedDownline = [];
        this.renderDownline(panel);
        try {
            const result = await this.api.list(context.id,"members",page,this.downlinePageSize,"",playerId);
            if(token !== this.downlineToken || !this.valid(version,context) ||
                !this.selectedPlayer || this.selectedPlayer.id !== playerId) return;
            const rows = result && Array.isArray(result.items) ? result.items : [];
            // 直属口径回包首行是被查代理本人；「下级成员」页签只列其直属成员。
            this.selectedDownline = rows.filter(item => String(item.id || "") !== String(playerId));
            this.downlineTotal = Math.max(0,Number(result && result.total) || 0);
            this.downlineError = "";
        } catch(error) {
            if(token === this.downlineToken && this.valid(version,context) &&
                this.selectedPlayer && this.selectedPlayer.id === playerId)
                this.downlineError = error && error.message || "下级成员加载失败";
        } finally {
            if(token === this.downlineToken && this.valid(version,context) &&
                this.selectedPlayer && this.selectedPlayer.id === playerId) {
                this.downlineLoading = false;
                this.renderDownline(panel);
            }
        }
    }
    private downlinePages():number {
        return Math.max(1,Math.ceil(this.downlineTotal / this.downlinePageSize));
    }
    private downlinePaging(panel:cc.Node):void {
        this.text("下级页码",(this.downlinePage+1)+" / "+this.downlinePages(),panel);
        const busy = this.downlineLoading || this.busy;
        const hasPrev = this.downlinePage > 0;
        const hasNext = (this.downlinePage+1) * this.downlinePageSize < this.downlineTotal;
        this.button("下级第一页",!busy && hasPrev,panel);
        this.button("下级上一页",!busy && hasPrev,panel);
        this.button("下级下一页",!busy && hasNext,panel);
        this.button("下级最后一页",!busy && hasNext,panel);
    }
    private renderDownline(panel:cc.Node):void {
        const list = this.at("玩家设置下级列表",panel);
        if(!list) return;
        const template = list.getChildByName("下级成员行模板");
        if(!template) return;
        for(const row of list.children.slice()) if(row !== template && row.name.indexOf("下级玩家_") === 0) {
            row.removeFromParent(); row.destroy();
        }
        const rows = this.selectedDownline || [];
        const empty = this.at("下级成员空状态",list);
        if(empty) {
            empty.active = rows.length === 0;
            const label = empty.getComponent(cc.Label);
            if(label) label.string = this.downlineLoading ? "加载中…" : this.downlineError || "暂无直属成员";
        }
        const pitch = list.height / this.downlinePageSize;
        const context = this.context ? {...this.context} : null;
        // 本列表属于当前弹窗玩家：点开的下一层必然再跨一级，只能查看。
        const depth = this.settingsDepth;
        rows.slice(0,this.downlinePageSize).forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "下级玩家_" + item.id;
            row.parent = list;
            row.active = true;
            row.setPosition(0,list.height / 2 - pitch / 2 - index * pitch);
            this.fillMemberRow(row,item);
            // 与成员列表一致：绑在「玩家热区」透明点击层上（含头像/姓名/ID 一块），
            // 点开后同一个弹窗换成该成员资料，可以继续往下看，但不再允许修改。
            if(context) this.bindPlayerSettings(this.playerHotzone(row),item,context,depth + 1);
        });
        this.downlinePaging(panel);
    }
    /** 盟友管理 → 指定俱乐部额度调整：输入元，发送授信_联盟_额度（正数划拨、负数收回）。 */
    private openUnionQuotaInput(member:ClubUnionMember,mode:"increase"|"decrease"):void {
        if(!member || !this.canReviewUnion()) return;
        if(this.busy) { this.message("操作进行中，请稍后再试");return; }
        const modal = this.at("玩家设置输入弹窗");
        const panel = this.at("面板",modal);
        const input = this.at("玩家设置输入框",panel);
        const edit = input && input.getComponent(cc.EditBox);
        if(!modal || !panel || !edit) { this.message("输入弹窗暂未加载");return; }
        this.unionQuotaMode = mode;
        this.selectedUnionMember = member;
        this.inputMode = null;
        const title = mode === "increase" ? "增加联盟额度" : "减少联盟额度";
        const clubName = member.clubName || ("俱乐部 " + member.clubId);
        const prompt = clubName + "：" + (mode === "increase" ?
            "输入增加额度（元），从联盟池划拨" : "输入减少额度（元），退回联盟池");
        this.text("玩家设置输入标题",title,panel);
        this.text("玩家设置输入提示",prompt,panel);
        this.text("提示","请输入额度",input);
        edit.inputMode = cc.EditBox.InputMode.DECIMAL;
        edit.maxLength = 18;
        edit.string = "0";
        this.active("玩家设置输入弹窗",true);
    }
    private finishUnionQuotaInput():void {
        const mode = this.unionQuotaMode;
        const member = this.selectedUnionMember;
        if(!mode || !member) return;
        const panel = this.at("面板",this.at("玩家设置输入弹窗"));
        const input = this.at("玩家设置输入框",panel);
        const edit = input && input.getComponent(cc.EditBox);
        const value = edit && edit.string ? edit.string.trim() : "";
        const yuan = Number(value);
        if(!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(yuan) ||
            yuan <= 0 || yuan > 90071992547409.91) {
            this.message("请输入大于 0 的额度，最多两位小数");
            return;
        }
        const fen = Math.round(yuan * 100);
        this.unionQuotaMode = null;
        this.selectedUnionMember = null;
        this.active("玩家设置输入弹窗",false);
        this.applyUnionQuota(member,mode,fen);
    }
    private async applyUnionQuota(member:ClubUnionMember,mode:"increase"|"decrease",fen:number):Promise<void> {
        if(!this.api) { this.message("该功能暂未开放");return; }
        if(this.busy) { this.message("操作进行中，请稍后再试");return; }
        this.busy = true;
        try {
            const result = await this.api.unionQuotaAdjust(member.clubId,mode === "decrease" ? -fen : fen);
            this.busy = false;
            const clubName = member.clubName || ("俱乐部 " + member.clubId);
            this.message(result && result.message || (clubName + (mode === "increase" ?
                " 额度已增加 " + this.fenText(fen) + " 元" : " 额度已减少 " + this.fenText(fen) + " 元")));
            if(this.kind === "allies") await this.loadUnionMembers();
        } catch(error) {
            this.busy = false;
            this.message(error && error.message || "额度调整失败，请稍后重试");
        }
    }
    private openPlayerInput(mode:"ratio"|"remark"|"quota"|"quotaIncrease"|"quotaDecrease"):void {
        this.unionQuotaMode = null;
        this.selectedUnionMember = null;
        // 比例与备注权限一致：创建者或该成员的直属上级代理。
        const quotaMode = ["quota","quotaIncrease","quotaDecrease"].indexOf(mode) >= 0;
        const allowed = mode === "ratio" ? this.canManageAgent() : quotaMode ? this.canGrantQuota() : this.canRemarkPlayer();
        if(!this.selectedPlayer || !allowed) return;
        if(this.blockReadOnlyPlayer()) return;
        const modal = this.at("玩家设置输入弹窗");
        const panel = this.at("面板",modal);
        const input = this.at("玩家设置输入框",panel);
        const edit = input && input.getComponent(cc.EditBox);
        if(!modal || !panel || !edit) return;
        this.inputMode = mode;
        // 输入框与「调整比例」共用：比例要数字键盘，备注得能录中文/英文；
        // Prefab 里存的是 NUMERIC，不按用途切回来备注就只能打数字。
        edit.inputMode = mode === "remark" ? cc.EditBox.InputMode.SINGLE_LINE :
            quotaMode ? cc.EditBox.InputMode.DECIMAL : cc.EditBox.InputMode.NUMERIC;
        const title = mode === "ratio" ? "调整比例" : mode === "quota" ? "开通额度" :
            mode === "quotaIncrease" ? "增加额度" : mode === "quotaDecrease" ? "减少额度" : "设置备注";
        const prompt = mode === "ratio" ? "请输入 0-100 的整数比例" : quotaMode ?
            (mode === "quotaDecrease" ? "请输入减少额度（元），支持两位小数" : "请输入增加额度（元），支持两位小数") :
            "请输入备注（最多 " + ClubManagementView.NOTE_MAX + " 字，留空可清空）";
        this.text("玩家设置输入标题",title,panel);
        this.text("玩家设置输入提示",prompt,panel);
        // EditBox 会把框内标签强制成单行 CLAMP，长句会被截断；完整说明留在上方提示，框内只放短占位。
        this.text("提示",mode === "ratio" ? prompt : quotaMode ? "请输入额度" : "请输入备注",input);
        // 备注上限按文档 §4.11，超长服务端直接报错；这里先在输入层拦住，提示文案同源。
        edit.maxLength = mode === "remark" ? ClubManagementView.NOTE_MAX : quotaMode ? 18 : 120;
        edit.string = mode === "ratio" ?
            (this.selectedPlayer.agentPercent !== undefined ? String(this.selectedPlayer.agentPercent) : "0") :
            quotaMode ? "0" :
            (this.selectedPlayer.note || "");
        this.active("玩家设置输入弹窗",true);
    }
    private finishPlayerInput():void {
        if(!this.inputMode || !this.selectedPlayer) return;
        if(this.blockReadOnlyPlayer()) return;
        const mode = this.inputMode;
        const input = this.at("玩家设置输入框",this.at("面板",this.at("玩家设置输入弹窗")));
        const edit = input && input.getComponent(cc.EditBox);
        const value = edit && edit.string ? edit.string.trim() : "";
        if(mode === "ratio") {
            const number = Number(value);
            if(!/^\d+$/.test(value) || !Number.isInteger(number) || number < 0 || number > 100) {
                this.message("比例必须是 0-100 的整数");
                return;
            }
            const player = this.selectedPlayer;
            this.inputMode = null;
            this.active("玩家设置输入弹窗",false);
            this.pending = {club:{...this.context},action:"changeAgentRatio",userId:player.id,value:String(number)};
            this.submit();
            return;
        }
        if(mode === "quota" || mode === "quotaIncrease" || mode === "quotaDecrease") {
            const yuan = Number(value);
            if(!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(yuan) ||
                yuan < 0 || mode === "quotaDecrease" && yuan <= 0 || yuan > 90071992547409.91) {
                this.message(mode === "quotaDecrease" ? "减少额度必须大于 0，最多两位小数" : "额度必须是大于等于 0 的数字，最多两位小数");
                return;
            }
            const player = this.selectedPlayer;
            this.inputMode = null;
            this.active("玩家设置输入弹窗",false);
            const fen = Math.round(yuan * 100);
            const action:ClubAction = mode === "quota" ? "grantQuota" : mode === "quotaIncrease" ? "increaseQuota" : "decreaseQuota";
            this.pending = {club:{...this.context},action,userId:player.id,value:String(action === "decreaseQuota" ? -fen : fen)};
            this.submit();
            return;
        }
        if(Array.from(value).length > ClubManagementView.NOTE_MAX) {
            this.message("备注最多 " + ClubManagementView.NOTE_MAX + " 个字");
            return;
        }
        this.inputMode = null;
        this.active("玩家设置输入弹窗",false);
        this.submitRemark(value);
    }
    /** 备注是「(俱乐部, 成员)」上的单一属性，写成功后直接用本地值刷新列表与详情卡。 */
    private async submitRemark(note:string):Promise<void> {
        if(!this.selectedPlayer || !this.context.id) return;
        if(this.busy) { this.message("操作进行中，请稍后再试");return; }
        if(!this.api) { this.message("该功能暂未开放");return; }
        if(!this.canRemarkPlayer()) { this.message("只能给自己的直属下级写备注");return; }
        const player = this.selectedPlayer;
        const club = {...this.context};
        if(!this.sameContext(club,this.getContext())) { this.Refresh();return; }
        this.busy = true;
        let saved = false;
        try {
            const result = await this.api.act(club.id,"setNote",player.id,note);
            if(!this.valid(this.version,club)) return;
            saved = true;
            player.note = note;
            for(const item of this.selectedDownline)
                if(String(item.id) === String(player.id)) item.note = note;
            const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
            this.text("备注值",note || "未设置",panel);
            this.text("玩家姓名",this.displayName(player),panel);
            this.renderDownline(panel);
            this.message(result && result.message || (note ? "备注已更新" : "备注已清空"));
        } catch(error) {
            if(this.valid(this.version,club)) this.message(error && error.message || "备注保存失败，请稍后重试");
        } finally {
            if(cc.isValid(this.root)) this.busy = false;
        }
        if(saved) await this.load(this.page);
    }
    private submitPlayerValue(action:ClubAction,inputName:string,emptyMessage:string):void {
        const agentAction = ["setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0;
        if(!this.selectedPlayer || (agentAction ? !this.canManageAgent() : !this.manager())) return;
        if(this.blockReadOnlyPlayer()) return;
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        const input = this.at(inputName,panel);
        const edit = input && input.getComponent(cc.EditBox);
        const value = edit && edit.string ? edit.string.trim() : "";
        if(!value) { this.message(emptyMessage);return; }
        const number = Number(value);
        if(!Number.isFinite(number) || number < 0 ||
            (action !== "adjustScore" && (!Number.isInteger(number) || number > 100))) {
            this.message(action === "adjustScore" ? "请输入不小于 0 的积分" : "代理比例必须是 0-100 的整数");
            return;
        }
        this.confirm(action,this.selectedPlayer.id,this.selectedPlayer.name,value);
    }
    private confirm(action:ClubAction,userId:string,name:string,value?:string):void {
        if(this.busy || !this.context.id) return;
        if(["remove","adjustScore","setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0 &&
            this.blockReadOnlyPlayer()) return;
        // 同意/拒绝只需要「能看到申请」的权限（代理即可）；代理关系操作限创建者/直属上级代理；
        // 踢人放开给创建者/管理员/代理（代理仅直属，跨级由 blockReadOnlyPlayer 拦截）；改积分仍限创建者/管理员。
        const unionAction = action === "unionApprove" || action === "unionReject";
        const needApprover = action === "approve" || action === "reject" || unionAction;
        const agentAction = ["setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0;
        const canKick = this.manager() || this.canManageAgent();
        if(unionAction && !this.canReviewUnion()) return;
        if(action !== "leave" && !(needApprover ? this.approver() :
            agentAction ? this.canManageAgent() : action === "remove" ? canKick : this.manager())) return;
        if((action === "dissolve" || action === "promote") && this.context.role !== "owner") return;
        if((action === "remove" || action === "promote") && (userId === this.context.accountId || userId === this.context.ownerId)) return;
        if(["adjustScore","setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0 &&
            (userId === this.context.accountId || userId === this.context.ownerId)) return;
        if(action === "leave" && this.context.role === "owner") {
            this.message("创建者请使用解散俱乐部功能");return;
        }
        this.pending = {club:{...this.context},action,userId,value};
        const text = action === "leave" ? "申请退出「"+this.context.name+"」？\n退出结果以审核为准。" :
            action === "dissolve" ? "确认解散「"+this.context.name+"」？\n解散后将无法恢复。" :
            action === "remove" ? "确认将「"+(name || userId)+"」移出俱乐部？\n玩家 ID: "+userId :
            action === "promote" ? "确认将「"+(name || userId)+"」设为管理员？\n玩家 ID: "+userId :
            action === "adjustScore" ? "确认将「"+(name || userId)+"」积分调整为 "+value+"？" :
            action === "setAgent" ? "确认给「"+(name || userId)+"」开通代理？" :
            action === "changeAgentRatio" ? "确认将「"+(name || userId)+"」代理比例调整为 "+value+"%？" :
            action === "cancelAgent" ? "确认取消「"+(name || userId)+"」的代理资格？" :
            action === "unionApprove" ? "同意「"+(name || userId)+"」加入联盟？\n俱乐部ID: "+userId :
            action === "unionReject" ? "拒绝「"+(name || userId)+"」加入联盟？\n俱乐部ID: "+userId :
            (action === "approve" ? "同意" : "拒绝")+"「"+(name || userId)+"」加入俱乐部？\n玩家 ID: "+userId;
        this.text("俱乐部操作确认/面板/内容",text);
        this.active("俱乐部操作确认",true);
        this.button("管理确认",true,this.at("俱乐部操作确认/面板"));
    }
    private async submit():Promise<void> {
        if(!this.pending || this.busy) return;
        const pending = this.pending;
        if(!this.sameContext(pending.club,this.getContext())) { this.Refresh();return; }
        if(!this.api) { this.message("该功能暂未开放");return; }
        const version = this.version;
        this.busy = true;
        this.button("管理确认",false,this.at("俱乐部操作确认/面板"));
        try {
            const unionAction = pending.action === "unionApprove" || pending.action === "unionReject";
            const result = unionAction ?
                await this.api.unionAct(pending.club.id,pending.userId,pending.action === "unionApprove") :
                await this.api.act(pending.club.id,pending.action,pending.userId,pending.value);
            if(!this.valid(version,pending.club)) return;
            this.active("俱乐部操作确认",false);
            if(["remove","adjustScore","setAgent","changeAgentRatio","cancelAgent"].indexOf(pending.action) >= 0) {
                this.active("俱乐部玩家设置弹窗",false);
                this.selectedPlayer = null;
                this.settingsDepth = 0;
            }
            this.pending = null;
            this.busy = false;
            this.message(result && result.message || (pending.action === "leave" ? "退出申请已提交" :
                pending.action === "unionApprove" ? "已同意加入联盟" :
                pending.action === "unionReject" ? "已拒绝入盟申请" : "操作成功"));
            if(["approve","reject","remove","promote","adjustScore","setAgent","changeAgentRatio","cancelAgent",
                "grantQuota","increaseQuota","decreaseQuota","unionApprove","unionReject"].indexOf(pending.action) >= 0)
                await this.load(this.page);
        } catch(error) {
            if(this.valid(version,pending.club)) this.message(error && error.message || "操作失败，请稍后重试");
        } finally {
            if(cc.isValid(this.root) && this.sameContext(pending.club,this.getContext())) {
                this.busy = false;
                this.button("管理确认",true,this.at("俱乐部操作确认/面板"));
            }
        }
    }
}
