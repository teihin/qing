import ImageManager from "../logic/ImageManager";
import {ShowPanelMode} from "../common/GameDef";
import UIManager from "../common/UIManager";

export type ClubRole = "owner" | "manager" | "agent" | "member";
export type ClubListKind = "members" | "applications";
export type ClubAction = "leave" | "dissolve" | "approve" | "reject" | "remove" | "promote" |
    "adjustScore" | "setAgent" | "changeAgentRatio" | "cancelAgent";
export interface ClubContext { accountId:string; id:string; name:string; role:ClubRole; ownerId?:string; inviteCode?:string; }
export interface ClubPlayer {
    id:string; name:string; role?:string; balance?:string;
    clubGold?:string; isAgent?:boolean; agentPercent?:string; status?:string;
    /** NumberList statistics are populated by the updated server response. */
    teamCount?:string; points?:string; online?:boolean;
    todayWin?:string; yesterdayWin?:string; totalWin?:string;
    todayContribution?:string; yesterdayContribution?:string; totalContribution?:string;
}
export interface ClubPeoplePage { items:ClubPlayer[]; total:number; }
export interface ClubAgentDownline { items:ClubPlayer[]; }
/** Adapt server payloads here. Resolve act only after the business result, not an async acceptance code. */
export interface ClubManagementApi {
    list(clubId:string,kind:ClubListKind,page:number,count:number,search?:string):Promise<ClubPeoplePage>;
    downline(clubId:string):Promise<ClubAgentDownline>;
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
    private selectedDownline:ClubPlayer[] = [];
    private settingsTab:"member"|"downline" = "member";
    private downlineLoading:boolean = false;
    private readonly pageSize:number = 20;

    constructor(private root:cc.Node,private getContext:()=>ClubContext,private message:(text:string)=>void,private gift:(player:ClubPlayer)=>void = null) {}

    public SetApi(api:ClubManagementApi):void {
        this.api = api;
        this.Refresh();
        const root = this.listRoot();
        if(root && root.active) this.load(0);
    }

    /** Server push integration point; never clear badges merely because the list was opened. */
    public SetPendingCount(clubId:string,count:number):void {
        this.Refresh();
        this.counts[clubId] = Math.max(0,Math.floor(Number(count) || 0));
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
    /** Proxy relation mutations on this full member view are creator-only; admins only manage members. */
    private canManageAgent(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && c.role === "owner";
    }
    /** 代理（持有邀请码）只能看待审申请并同意/拒绝，不能管理成员、比例和解散。 */
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
            this.selectedDownline = [];
            this.settingsTab = "member";
            this.downlineLoading = false;
            for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗","俱乐部操作确认","俱乐部玩家设置弹窗"]) this.active(name,false);
            this.clearRows();
        }
        this.context = next;
        const card = this.at("Main/我的/当前俱乐部");
        this.text("名称",next.id ? next.name || "俱乐部 " + next.id : "暂无俱乐部",card);
        this.text("邀请码",next.id ? next.inviteCode || "" : "从俱乐部选择后查看信息",card);
        this.text("身份",!next.id ? "" : next.role === "owner" ? "老板" : next.role === "manager" ? "管理员" : next.role === "agent" ? "代理" : "成员",card);
        this.active("身份底",!!next.id,card);
        // 代理也走同一个入口，但点进去直接落在「待审申请」，看不到成员列表。
        this.active("操作/管理成员",this.approver(),card);
        this.active("操作/管理解散",!!next.id && next.role === "owner",card);
        this.active("操作/管理退出",!!next.id && next.role !== "owner",card);
        this.active("操作/管理收益",!!next.id && next.role === "owner",card);
        const dot = this.approver() && (this.counts[next.id] || 0) > 0;
        this.active("操作/管理成员/红点",dot,card);
        this.active("Down/我的/红点",dot);
        this.active("俱乐部成员弹窗/面板/管理申请/红点",dot);
        // 代理没有成员列表，「返回成员」在代理视角是死按钮，直接藏掉。
        this.active("俱乐部申请弹窗/面板/管理返回成员",this.manager());
        for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗"])
            this.text(name + "/面板/俱乐部信息",(next.name || "俱乐部") + "  ID: " + next.id);
    }

    public HandleButton(button:cc.Button):boolean {
        const name = button.node.name;
        if(["管理关闭","管理成员","管理返回成员","管理申请","管理上一页","管理下一页",
            "管理第一页","管理最后一页","管理刷新","管理查询成员","管理重置成员搜索",
            "管理退出","管理解散","管理收益","管理取消","管理确认",
            "玩家设置关闭","玩家设置复制ID","玩家设置调整分数","玩家设置踢出俱乐部",
            "玩家设置调整比例","玩家设置代理开关","玩家设置取消代理",
            "玩家设置备注","玩家设置禁止游戏","玩家设置禁止账号",
            "成员设置","成员设置非激活","下级成员","下级成员激活"].indexOf(name) < 0) return false;
        this.Refresh();
        if(name === "玩家设置关闭") {
            this.active("俱乐部玩家设置弹窗",false);
            this.selectedPlayer = null;
        } else if(name === "玩家设置复制ID") {
            if(this.selectedPlayer) this.message("玩家ID：" + this.selectedPlayer.id);
        } else if(name === "玩家设置调整分数") {
            this.submitPlayerValue("adjustScore","玩家设置分数输入","请输入目标积分");
        } else if(name === "玩家设置踢出俱乐部") {
            if(this.selectedPlayer) this.confirm("remove",this.selectedPlayer.id,this.selectedPlayer.name);
        } else if(name === "玩家设置调整比例") {
            if(this.selectedPlayer) {
                const action:ClubAction = this.selectedPlayer.isAgent ? "changeAgentRatio" : "setAgent";
                this.submitPlayerValue(action,"玩家设置比例输入","请输入代理比例（0-100）");
            }
        } else if(name === "玩家设置代理开关") {
            if(this.selectedPlayer && this.selectedPlayer.isAgent)
                this.confirm("cancelAgent",this.selectedPlayer.id,this.selectedPlayer.name);
            else if(this.selectedPlayer)
                this.submitPlayerValue("setAgent","玩家设置比例输入","请输入代理比例（0-100）");
        } else if(name === "玩家设置取消代理") {
            if(this.selectedPlayer) this.confirm("cancelAgent",this.selectedPlayer.id,this.selectedPlayer.name);
        } else if(name === "玩家设置备注" || name === "玩家设置禁止游戏" || name === "玩家设置禁止账号") {
            this.message("服务器接口暂未提供该设置");
        } else if(name === "成员设置" || name === "成员设置非激活") {
            this.showPlayerSettingsTab("member");
        } else if(name === "下级成员" || name === "下级成员激活") {
            this.showPlayerSettingsTab("downline");
        } else if(name === "管理关闭") {
            if(this.busy) return true;
            const popup = button.node && button.node.parent && button.node.parent.parent;
            if(popup) popup.active = false;
            ++this.version;
            this.loading = false;
            this.pending = null;
        } else if(name === "管理成员") {
            // 代理没有成员管理权限，入口直接进自己的待审申请。
            this.open(this.context && this.context.role === "agent" ? "applications" : "members");
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
        if(kind === "members" ? !this.manager() : !this.approver()) return;
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
        if(this.kind === "members" ? !this.manager() : !this.approver()) return;
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
        this.text("统计",kind === "members" ? "成员列表" : "待审批申请",this.panel());
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
            this.text("统计",(kind === "members" ? "成员 " : "待审批 ")+this.total+" 人",this.panel());
            this.text("空状态",kind === "members" ? "暂无成员" : "暂无入会申请",this.panel());
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
            this.text("姓名",item.name || "玩家 "+item.id,row);
            this.text("玩家ID","ID: "+item.id,row);
            const avatar = this.at("头像",row);
            const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
            if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
            if(this.kind === "members") {
                const isOwner = item.id === context.ownerId || item.id === context.accountId && context.role === "owner";
                const isSelf = item.id === context.accountId;
                this.rowText(row,["身份"],isOwner ? "创建者" : isSelf && context.role === "manager" ? "管理员" : item.isAgent ? "代理" : item.role || "成员");
                this.metricText(row,"团队人数",item.teamCount);
                this.metricText(row,"积分",item.clubGold !== undefined ? item.clubGold : item.points);
                this.metricText(row,"今日输赢",item.todayWin);
                this.metricText(row,"昨日输赢",item.yesterdayWin);
                this.metricText(row,"总输赢",item.totalWin);
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
                if(avatar) {
                    avatar.targetOff(this);
                    avatar.on("click",()=>{
                        if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
                        this.openPlayerSettings(item);
                    },this);
                }
            }
            else {
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
    private openPlayerSettings(item:ClubPlayer):void {
        if(!item || !this.manager()) return;
        const modal = this.at("俱乐部玩家设置弹窗");
        const panel = this.at("面板",modal);
        if(!modal || !panel) { this.message("玩家设置面板暂未加载");return; }
        this.selectedPlayer = item;
        this.selectedDownline = [];
        this.settingsTab = "member";
        this.downlineLoading = false;
        this.active("俱乐部玩家设置弹窗",true);
        this.text("玩家姓名",item.name || "玩家 "+item.id,panel);
        this.text("玩家ID","ID: "+item.id,panel);
        this.text("玩家身份",item.isAgent ? "代理" : item.role || "成员",panel);
        this.text("玩家状态",this.status(item),panel);
        this.text("玩家积分值",this.value(item.clubGold !== undefined ? item.clubGold : item.points),panel);
        this.text("备注值","未设置",panel);
        this.text("比例值",item.isAgent ? item.agentPercent !== undefined ? item.agentPercent + "%" : "—" : "未开通",panel);
        this.text("代理开关文字",item.isAgent ? "开" : "关",panel);
        this.active("玩家设置代理开关/开",!!item.isAgent,panel);
        this.active("玩家设置代理开关/关",!item.isAgent,panel);
        const avatar = this.at("头像",panel);
        const avatarSprite = avatar && avatar.getComponent(cc.Sprite);
        if(avatarSprite) ImageManager.getInstance().BindPlayerListAvatar(item.id,avatarSprite);
        const isSelf = item.id === this.context.accountId;
        const isOwner = item.id === this.context.ownerId || isSelf && this.context.role === "owner";
        this.button("玩家设置调整分数",this.manager() && !isOwner,panel);
        this.button("玩家设置踢出俱乐部",this.manager() && !isSelf && !isOwner,panel);
        this.button("玩家设置调整比例",this.canManageAgent() && !isSelf && !isOwner,panel);
        this.button("玩家设置代理开关",this.canManageAgent() && !isSelf && !isOwner,panel);
        // The current server documents score and proxy operations only. These
        // controls stay visible for the competitor layout but are read-only.
        this.button("玩家设置备注",false,panel);
        this.button("玩家设置禁止游戏",false,panel);
        this.button("玩家设置禁止账号",false,panel);
        this.renderDownline(panel);
        this.showPlayerSettingsTab("member");
        if(this.api && this.api.downline) this.loadDownline(panel);
    }
    private settingsMemberNodes():string[] {
        return ["备注","备注底","备注值","玩家设置备注","比例","比例底","比例值",
            "玩家设置比例输入","玩家设置调整比例","代理","代理底","代理开关文字",
            "玩家设置代理开关"];
    }
    private showPlayerSettingsTab(tab:"member"|"downline"):void {
        const panel = this.at("面板",this.at("俱乐部玩家设置弹窗"));
        if(!panel) return;
        this.settingsTab = tab;
        const member = tab === "member";
        this.settingsMemberNodes().forEach(name=>this.active(name,member,panel));
        this.active("玩家设置下级列表",!member,panel);
        this.active("成员设置",member,panel);
        this.active("成员设置非激活",!member,panel);
        this.active("下级成员",member,panel);
        this.active("下级成员激活",!member,panel);
    }
    private async loadDownline(panel:cc.Node):Promise<void> {
        if(!this.api || !this.api.downline || !this.context || !this.context.id) return;
        const context = {...this.context};
        const version = this.version;
        this.downlineLoading = true;
        this.text("下级成员空状态","加载中…",this.at("玩家设置下级列表",panel));
        try {
            const result = await this.api.downline(context.id);
            if(!this.valid(version,context) || this.selectedPlayer === null) return;
            this.selectedDownline = result && Array.isArray(result.items) ? result.items : [];
            this.downlineLoading = false;
            this.renderDownline(panel);
        } catch(error) {
            if(this.valid(version,context)) {
                this.selectedDownline = [];
                this.text("下级成员空状态",error && error.message || "下级成员加载失败",this.at("玩家设置下级列表",panel));
                this.active("下级成员空状态",true,this.at("玩家设置下级列表",panel));
            }
        } finally {
            if(this.valid(version,context)) this.downlineLoading = false;
        }
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
            if(label) label.string = this.downlineLoading ? "加载中…" : "暂无下级成员";
        }
        rows.slice(0,4).forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "下级玩家_" + item.id;
            row.parent = list;
            row.active = true;
            row.setPosition(0,105-index*68);
            this.text("姓名",item.name || "玩家 " + item.id,row);
            this.text("玩家ID","ID: " + item.id,row);
            this.text("比例",item.agentPercent !== undefined ? item.agentPercent + "%" : "—",row);
        });
    }
    private submitPlayerValue(action:ClubAction,inputName:string,emptyMessage:string):void {
        const agentAction = ["setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0;
        if(!this.selectedPlayer || (agentAction ? !this.canManageAgent() : !this.manager())) return;
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
        // 同意/拒绝只需要「能看到申请」的权限（代理即可）；其余成员管理仍限创建者/管理员。
        const needApprover = action === "approve" || action === "reject";
        const agentAction = ["setAgent","changeAgentRatio","cancelAgent"].indexOf(action) >= 0;
        if(action !== "leave" && !(needApprover ? this.approver() : agentAction ? this.canManageAgent() : this.manager())) return;
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
            action === "setAgent" ? "确认给「"+(name || userId)+"」开通代理，比例 "+value+"%？" :
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
