import ImageManager from "../logic/ImageManager";
import {ShowPanelMode} from "../common/GameDef";
import UIManager from "../common/UIManager";

export type ClubRole = "owner" | "manager" | "agent" | "member";
export type ClubListKind = "members" | "applications";
export type ClubAction = "leave" | "dissolve" | "approve" | "reject" | "remove" | "promote" |
    "adjustScore" | "setAgent" | "changeAgentRatio" | "cancelAgent";
export interface ClubContext { accountId:string; id:string; name:string; role:ClubRole; ownerId?:string; inviteCode?:string; isLeader?:boolean; }
export interface ClubPlayer {
    id:string; name:string; role?:string; balance?:string;
    clubGold?:string; isAgent?:boolean; isLeader?:boolean; agentPercent?:string; status?:string;
    remark?:string;
    /** NumberList statistics are populated by the updated server response. */
    teamCount?:string; points?:string; online?:boolean;
    todayWin?:string; yesterdayWin?:string; totalWin?:string;
    todayContribution?:string; yesterdayContribution?:string; totalContribution?:string;
}
export interface ClubPeoplePage { items:ClubPlayer[]; total:number; }
/** Adapt server payloads here. Resolve act only after the business result, not an async acceptance code. */
export interface ClubManagementApi {
    /** 成员列表自 2026-10-26 起为代理直属口径；传 agentId 下钻到指定下级代理的直属成员。 */
    list(clubId:string,kind:ClubListKind,page:number,count:number,search?:string,agentId?:string):Promise<ClubPeoplePage>;
    act(clubId:string,action:ClubAction,userId:string,value?:string):Promise<{message?:string}>;
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
    private inputMode:"ratio"|"remark"|null = null;
    private remarks:{[key:string]:string} = {};
    private readonly pageSize:number = 20;
    /** 与 Prefab 中「玩家设置下级列表」一屏可放的行数一致。 */
    private readonly downlinePageSize:number = 4;

    constructor(private root:cc.Node,private getContext:()=>ClubContext,private message:(text:string)=>void,
        private gift:(player:ClubPlayer)=>void = null,private notify:()=>void = null) {
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
            for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗","俱乐部操作确认","俱乐部玩家设置弹窗","玩家设置输入弹窗"]) this.active(name,false);
            this.clearRows();
        }
        this.context = next;
        // 未加入俱乐部时整张卡片不显示，也不占滚动区高度。
        this.active("Main/我的/滚动区/view/content/当前俱乐部",!!next.id);
        const card = this.at("Main/我的/滚动区/view/content/当前俱乐部");
        this.text("名称",next.id ? next.name || "俱乐部 " + next.id : "暂无俱乐部",card);
        this.text("邀请码",next.id ? next.inviteCode || "" : "从俱乐部选择后查看信息",card);
        // 「我的」卡片只在老板/代理时显示身份牌；普通成员（及管理员，按"只有代理和老板"）不占右侧位置。
        const showIdentity = !!next.id && (next.role === "owner" || next.role === "agent");
        this.text("身份",!showIdentity ? "" : next.role === "owner" ? "老板" : next.isLeader ? "盟主" : "代理",card);
        this.active("身份底",showIdentity,card);
        // 左侧固定位显示俱乐部老板（盟主）的真实头像；没有俱乐部时整块隐藏。
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
        const dot = this.approver() && (this.counts[next.id] || 0) > 0;
        this.active("操作/管理成员/红点",dot,card);
        this.active("Down/我的/红点",dot);
        this.active("俱乐部成员弹窗/面板/管理申请/红点",dot);
        // 代理也能从成员列表切到待审申请，「返回成员」对他必须是可用的。
        this.active("俱乐部申请弹窗/面板/管理返回成员",this.approver());
        // 弹窗抬头只给「俱乐部名 + 邀请码」，与俱乐部列表卡片的码保持一致；
        // 俱乐部 ID 是内部主键，成员不需要看，也不再展示。
        const clubTitle = next.id ? (next.name || "俱乐部 " + next.id) : "";
        const inviteText = next.id && next.inviteCode ? "（邀请码:" + next.inviteCode + "）" : "";
        for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗"])
            this.text(name + "/面板/俱乐部信息",clubTitle + inviteText);
        this.syncProfileScroll(!!next.id);
    }
    /**
     * 「我的」滚动区内容高度：有卡片时 656（按钮区 419.76 + 间距 12 + 卡片 200 + 底部留白 24），
     * 无卡片时去掉卡片与间距只剩 456；内容不高于可视区时撑满 view，避免可滚动的空白。
     */
    public syncProfileScroll(hasClub?:boolean):void {
        if(hasClub === undefined) {
            const current = this.getContext();
            hasClub = !!current && !!current.id;
        }
        const content = this.at("Main/我的/滚动区/view/content");
        const view = this.at("Main/我的/滚动区/view");
        if(!content) return;
        const viewHeight = view ? view.height : 0;
        const height = Math.max(hasClub ? 656 : 456,viewHeight);
        if(Math.abs(content.height - height) > 0.5) content.height = height;
        // content 顶部锚点，贴住 view 顶边；否则缩高后内容会整体下移。
        if(view) content.setPosition(0,viewHeight / 2);
    }

    public HandleButton(button:cc.Button):boolean {
        const name = button.node.name;
        if(["管理关闭","管理成员","管理返回成员","管理申请","管理上一页","管理下一页",
            "管理第一页","管理最后一页","管理刷新","管理查询成员","管理重置成员搜索",
            "管理退出","管理解散","管理收益","管理取消","管理确认",
            "玩家设置关闭","玩家设置复制ID","玩家设置赠送金币","玩家设置调整分数","玩家设置踢出俱乐部",
            "玩家设置调整比例","玩家设置代理开关","玩家设置取消代理",
            "玩家设置备注","玩家设置禁止游戏","玩家设置禁止账号",
            "成员设置","成员设置非激活","下级成员","下级成员激活",
            "下级第一页","下级上一页","下级下一页","下级最后一页",
            "玩家设置输入关闭","玩家设置输入取消","玩家设置输入确认"].indexOf(name) < 0) return false;
        this.Refresh();
        if(["玩家设置赠送金币","玩家设置调整分数","玩家设置踢出俱乐部","玩家设置调整比例",
            "玩家设置代理开关","玩家设置取消代理","玩家设置备注","玩家设置禁止游戏",
            "玩家设置禁止账号"].indexOf(name) >= 0 && this.blockReadOnlyPlayer()) return true;
        if(name === "玩家设置关闭") {
            this.active("俱乐部玩家设置弹窗",false);
            this.selectedPlayer = null;
            this.settingsDepth = 0;
        } else if(name === "玩家设置复制ID") {
            if(this.selectedPlayer) this.message("玩家ID：" + this.selectedPlayer.id);
        } else if(name === "玩家设置赠送金币") {
            if(this.selectedPlayer && this.gift) this.gift(this.selectedPlayer);
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
            this.active("玩家设置输入弹窗",false);
        } else if(name === "玩家设置输入确认") {
            this.finishPlayerInput();
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
        if(!this.approver()) return;
        this.active("俱乐部成员弹窗",kind === "members");
        this.active("俱乐部申请弹窗",kind === "applications");
        this.kind = kind;
        this.load(0);
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
            this.text("统计",(kind === "members" ? "直属 " : "待审批 ")+this.total+" 人",this.panel());
            this.text("空状态",kind === "members" ? "暂无直属成员" : "暂无入会申请",this.panel());
            this.active("空状态",result.items.length === 0,this.panel());
        } catch(error) {
            if(this.valid(version,ctx)) this.text("空状态",error && error.message || "加载失败，请点击刷新重试",this.panel());
        } finally {
            if(this.valid(version,ctx)) { this.loading = false;this.paging(); }
        }
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
    /** 成员列表与下级成员列表共用同一套行内容，保证两处显示一致。 */
    private fillMemberRow(row:cc.Node,item:ClubPlayer):void {
        const context = this.context || {accountId:"",id:"",name:"",role:"member" as ClubRole};
        this.text("姓名",item.name || "玩家 "+item.id,row);
        this.text("玩家ID","ID: "+item.id,row);
        const avatar = this.at("头像",row);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
        const isOwner = item.id === context.ownerId || item.id === context.accountId && context.role === "owner";
        const isSelf = item.id === context.accountId;
        const isAgent = this.isAgentPlayer(item);
        this.rowText(row,["身份"],isOwner ? "创建者" : isSelf && context.role === "manager" ? "管理员" : isAgent ? (item.isLeader ? "盟主" : "代理") : item.role || "成员");
        this.metricText(row,"团队人数",item.teamCount);
        this.metricText(row,"积分",item.clubGold !== undefined ? item.clubGold : item.points);
        // 代理比例只有代理才显示；非代理把「比例」整列（标题+数值）一起藏掉。
        // 模板里这两格的默认文字是「积分」，显示时必须显式改成「比例」。
        this.active("比例",isAgent,row);
        this.active("比例值",isAgent,row);
        if(isAgent) {
            this.text("比例","比例",row);
            this.text("比例值",this.percentText(item),row);
        }
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
                // 自己那一行没有玩家设置（设代理/调比例/踢出都针对别人），点了不弹窗。
                const isSelf = String(item.id || "").trim() === String(context.accountId || "").trim();
                if(!isSelf) this.bindPlayerSettings(this.at("头像",row),item,context,0);
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
        // 玩家设置面板全是针对别人的操作（踢出、设备注、开代理、调比例），
        // 自己那一行不提供设置入口，点了不弹窗。
        if(String(item.id || "").trim() === String(this.context.accountId || "").trim()) return;
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
        this.text("玩家姓名",item.name || "玩家 "+item.id,panel);
        this.text("玩家ID","ID: "+item.id,panel);
        const isAgent = this.isAgentPlayer(item);
        const roleText = isAgent ? (item.isLeader ? "盟主" : "代理") : this.roleText(item);
        this.text("玩家身份",roleText,panel);
        this.layoutRole(roleText,panel);
        const statusText = this.status(item);
        const online = statusText === "在线";
        this.text("玩家状态",statusText,panel);
        this.active("玩家状态/状态点",online,panel);
        const statusNode = this.at("玩家状态",panel);
        if(statusNode) statusNode.color = online ? new cc.Color(155,255,109) : new cc.Color(201,216,228);
        this.text("玩家积分值",this.value(item.clubGold !== undefined ? item.clubGold : item.points),panel);
        this.text("备注值",item.remark || this.remarks[this.remarkKey()] || "未设置",panel);
        this.text("比例值",isAgent ? this.percentText(item) : "未开通",panel);
        this.text("代理开关文字",isAgent ? "开" : "关",panel);
        this.active("玩家设置代理开关/开",isAgent,panel);
        this.active("玩家设置代理开关/关",!isAgent,panel);
        const avatar = this.at("头像",panel);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
        const isSelf = item.id === this.context.accountId;
        const isOwner = item.id === this.context.ownerId || isSelf && this.context.role === "owner";
        // 跨级只读：连按钮一起收起，避免看起来还能点；行内数值仍保留可查看。
        const canAgent = !readOnly && this.canManageAgent();
        // 赠送走个人转赠面板，代理也可对直属下级使用。
        this.active("玩家设置赠送金币",!readOnly,panel);
        // 目前不允许踢出俱乐部，按钮保留但不显示。
        this.active("玩家设置踢出俱乐部",false,panel);
        this.active("玩家设置调整比例",canAgent && isAgent,panel);
        this.active("玩家设置代理开关",canAgent,panel);
        // 「设置备注」暂时停用，按钮与整行由 showPlayerSettingsTab 统一隐藏。
        this.button("玩家设置赠送金币",!readOnly && !isOwner,panel);
        this.button("玩家设置踢出俱乐部",false,panel);
        this.button("玩家设置调整比例",canAgent && isAgent && !isSelf && !isOwner,panel);
        this.button("玩家设置代理开关",canAgent && !isSelf && !isOwner,panel);
        // These two controls remain visible as reserved layout rows but have no
        // documented server command yet.
        this.button("玩家设置禁止游戏",false,panel);
        this.button("玩家设置禁止账号",false,panel);
        this.renderDownline(panel);
        this.showPlayerSettingsTab("member");
    }
    private settingsMemberNodes():string[] {
        return ["比例","比例底","比例值","玩家设置调整比例","代理","代理底",
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
        // 「设置备注」暂时停用：整行保持隐藏，恢复时把四个节点加回 settingsMemberNodes。
        for(const name of ["备注","备注底","备注值","玩家设置备注"])
            this.active(name,false,panel);
        // 页签切换会重新激活比例/代理行按钮，只读态必须在之后统一收起。
        if(this.readOnlyPlayer()) {
            for(const name of ["玩家设置赠送金币","玩家设置踢出俱乐部","玩家设置调整比例",
                "玩家设置代理开关","玩家设置备注"])
                this.active(name,false,panel);
        }
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
            // 与成员列表一致：头像本身带 Button，事件必须绑在头像上才能收到；
            // 点开后同一个弹窗换成该成员资料，可以继续往下看，但不再允许修改。
            const isSelf = String(item.id || "").trim() === String((context && context.accountId) || "").trim();
            if(context && !isSelf) this.bindPlayerSettings(this.at("头像",row),item,context,depth + 1);
        });
        this.downlinePaging(panel);
    }
    private remarkKey():string {
        return (this.context && this.context.id || "") + ":" + (this.selectedPlayer && this.selectedPlayer.id || "");
    }
    private openPlayerInput(mode:"ratio"|"remark"):void {
        // 比例属于代理关系操作（创建者/直属上级代理）；备注是本地数据，代理也可写。
        if(!this.selectedPlayer || (mode === "ratio" ? !this.canManageAgent() : !this.approver())) return;
        if(this.blockReadOnlyPlayer()) return;
        const modal = this.at("玩家设置输入弹窗");
        const panel = this.at("面板",modal);
        const input = this.at("玩家设置输入框",panel);
        const edit = input && input.getComponent(cc.EditBox);
        if(!modal || !panel || !edit) return;
        this.inputMode = mode;
        const title = mode === "ratio" ? "调整比例" : "设置备注";
        const prompt = mode === "ratio" ? "请输入 0-100 的整数比例" : "请输入备注内容";
        this.text("玩家设置输入标题",title,panel);
        this.text("玩家设置输入提示",prompt,panel);
        this.text("提示",prompt,input);
        edit.string = mode === "ratio" ?
            (this.selectedPlayer.agentPercent !== undefined ? String(this.selectedPlayer.agentPercent) : "0") :
            (this.remarks[this.remarkKey()] || "");
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
        if(value.length > 120) {
            this.message("备注不能超过120个字符");
            return;
        }
        this.remarks[this.remarkKey()] = value;
        this.text("备注值",value || "未设置",this.at("面板",this.at("俱乐部玩家设置弹窗")));
        this.inputMode = null;
        this.active("玩家设置输入弹窗",false);
        this.message("备注已更新");
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
        const needApprover = action === "approve" || action === "reject";
        const agentAction = ["setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0;
        const canKick = this.manager() || this.canManageAgent();
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
            const result = await this.api.act(pending.club.id,pending.action,pending.userId,pending.value);
            if(!this.valid(version,pending.club)) return;
            this.active("俱乐部操作确认",false);
            if(["remove","adjustScore","setAgent","changeAgentRatio","cancelAgent"].indexOf(pending.action) >= 0) {
                this.active("俱乐部玩家设置弹窗",false);
                this.selectedPlayer = null;
                this.settingsDepth = 0;
            }
            this.pending = null;
            this.busy = false;
            this.message(result && result.message || (pending.action === "leave" ? "退出申请已提交" : "操作成功"));
            if(["approve","reject","remove","promote","adjustScore","setAgent","changeAgentRatio","cancelAgent"].indexOf(pending.action) >= 0)
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
