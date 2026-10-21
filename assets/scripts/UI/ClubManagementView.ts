import ImageManager from "../logic/ImageManager";

export type ClubRole = "owner" | "manager" | "member";
export type ClubListKind = "members" | "applications";
export type ClubAction = "leave" | "dissolve" | "approve" | "reject" | "remove" | "promote";
export interface ClubContext { accountId:string; id:string; name:string; role:ClubRole; ownerId?:string; }
export interface ClubPlayer { id:string; name:string; role?:string; balance?:string; }
export interface ClubPeoplePage { items:ClubPlayer[]; total:number; }
/** Adapt server payloads here. Resolve act only after the business result, not an async acceptance code. */
export interface ClubManagementApi {
    list(clubId:string,kind:ClubListKind,page:number,count:number):Promise<ClubPeoplePage>;
    act(clubId:string,action:ClubAction,userId:string):Promise<{message?:string}>;
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
    private pending:{club:ClubContext; action:ClubAction; userId:string} = null;
    private readonly pageSize:number = 20;

    constructor(private root:cc.Node,private getContext:()=>ClubContext,private message:(text:string)=>void,private gift:(player:ClubPlayer)=>void = null) {}

    public SetApi(api:ClubManagementApi):void {
        this.api = api;
        this.Refresh();
        if(this.listRoot().active) this.load(0);
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
        if(n) n.getComponent(cc.Label).string = value;
    }
    private manager(c:ClubContext = this.context):boolean {
        return !!c && !!c.id && (c.role === "owner" || c.role === "manager");
    }
    private listRoot():cc.Node { return this.at(this.kind === "members" ? "俱乐部成员弹窗" : "俱乐部申请弹窗"); }
    private panel():cc.Node { return this.at("面板",this.listRoot()); }
    private button(name:string,enabled:boolean,parent:cc.Node):void {
        const n = this.at(name,parent);
        if(n) n.getComponent(cc.Button).interactable = enabled;
    }
    private sameContext(a:ClubContext,b:ClubContext):boolean {
        return !!a && !!b && a.accountId === b.accountId && a.id === b.id && a.role === b.role;
    }

    public Refresh():void {
        const next = this.getContext();
        if(!this.sameContext(this.context,next)) {
            if(!this.context || this.context.accountId !== next.accountId) this.counts = {};
            ++this.version;
            this.loading = false;
            this.busy = false;
            this.pending = null;
            for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗","俱乐部操作确认"]) this.at(name).active = false;
            this.clearRows();
        }
        this.context = next;
        const card = this.at("Main/我的/当前俱乐部");
        this.text("名称",next.id ? next.name || "俱乐部 " + next.id : "暂无俱乐部",card);
        this.text("ID",next.id ? "ID: " + next.id : "从俱乐部选择后查看信息",card);
        this.text("身份",!next.id ? "" : next.role === "owner" ? "创建者" : next.role === "manager" ? "管理员" : "成员",card);
        this.at("操作/管理成员",card).active = this.manager();
        this.at("操作/管理解散",card).active = !!next.id && next.role === "owner";
        this.at("操作/管理退出",card).active = !!next.id && next.role !== "owner";
        this.at("操作/管理收益",card).active = !!next.id && next.role === "owner";
        const dot = this.manager() && (this.counts[next.id] || 0) > 0;
        this.at("操作/管理成员/红点",card).active = dot;
        this.at("Down/我的/红点").active = dot;
        this.at("俱乐部成员弹窗/面板/管理申请/红点").active = dot;
        for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗"])
            this.text(name + "/面板/俱乐部信息",(next.name || "俱乐部") + "  ID: " + next.id);
    }

    public HandleButton(button:cc.Button):boolean {
        const name = button.node.name;
        if(["管理关闭","管理成员","管理返回成员","管理申请","管理上一页","管理下一页",
            "管理刷新","管理退出","管理解散","管理收益","管理取消","管理确认"].indexOf(name) < 0) return false;
        this.Refresh();
        if(name === "管理关闭") {
            if(this.busy) return true;
            button.node.parent.parent.active = false;
            ++this.version;
            this.loading = false;
            this.pending = null;
        } else if(name === "管理成员" || name === "管理返回成员") this.open("members");
        else if(name === "管理申请") this.open("applications");
        else if(name === "管理上一页") { if(!this.loading && this.page > 0) this.load(this.page-1); }
        else if(name === "管理下一页") { if(!this.loading && (this.page+1)*this.pageSize < this.total) this.load(this.page+1); }
        else if(name === "管理刷新") { if(!this.loading) this.load(this.page); }
        else if(name === "管理退出") this.confirm("leave", "", "");
        else if(name === "管理收益") {
            if(this.context.id && this.context.role === "owner") this.message("收益功能暂未开放");
        }
        else if(name === "管理解散") this.confirm("dissolve", "", "");
        else if(name === "管理取消") {
            if(!this.busy) { this.at("俱乐部操作确认").active = false; this.pending = null; }
        } else if(name === "管理确认") this.submit();
        return true;
    }

    private open(kind:ClubListKind):void {
        if(!this.manager() || this.busy) return;
        this.at("俱乐部成员弹窗").active = kind === "members";
        this.at("俱乐部申请弹窗").active = kind === "applications";
        this.kind = kind;
        this.load(0);
    }
    private clearRows():void {
        for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗"]) {
            const content = this.at(name+"/面板/列表/view/content");
            for(const row of content.children.slice()) if(row.name !== "行模板") {
                row.removeFromParent();row.destroy();
            }
        }
    }
    private paging():void {
        this.text("页码",(this.page+1)+" / "+Math.max(1,Math.ceil(this.total/this.pageSize)),this.panel());
        this.button("管理上一页",!this.loading && !this.busy && this.page > 0,this.panel());
        this.button("管理下一页",!this.loading && !this.busy && (this.page+1)*this.pageSize < this.total,this.panel());
        this.button("管理刷新",!this.loading && !this.busy,this.panel());
    }
    private async load(page:number):Promise<void> {
        if(!this.manager() || this.busy) return;
        const version = ++this.version;
        const ctx = {...this.context};
        const kind = this.kind;
        this.page = page;
        this.total = 0;
        this.clearRows();
        this.loading = !!this.api;
        this.paging();
        this.at("空状态",this.panel()).active = true;
        this.text("空状态",this.api ? "加载中…" : "列表暂未开放",this.panel());
        this.text("统计",kind === "members" ? "成员列表" : "待审批申请",this.panel());
        if(!this.api) return;
        try {
            const result = await this.api.list(ctx.id,kind,page,this.pageSize);
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
            this.at("空状态",this.panel()).active = result.items.length === 0;
        } catch(error) {
            if(this.valid(version,ctx)) this.text("空状态",error && error.message || "加载失败，请点击刷新重试",this.panel());
        } finally {
            if(this.valid(version,ctx)) { this.loading = false;this.paging(); }
        }
    }
    private valid(version:number,ctx:ClubContext):boolean {
        return cc.isValid(this.root) && version === this.version && this.sameContext(ctx,this.getContext());
    }
    private render(items:ClubPlayer[]):void {
        const content = this.at("列表/view/content",this.panel());
        const template = content.getChildByName("行模板");
        const pitch = this.kind === "members" ? 178 : 200;
        const firstY = this.kind === "members" ? -89 : -100;
        content.height = Math.max(this.at("列表/view",this.panel()).height,items.length*pitch);
        const context = {...this.context};
        items.forEach((item,index)=>{
            const row = cc.instantiate(template);
            row.name = "玩家_"+item.id; row.parent = content; row.active = true;
            row.setPosition(0,firstY-index*pitch);
            this.text("姓名",item.name || "玩家 "+item.id,row);
            this.text("玩家ID","ID: "+item.id,row);
            ImageManager.getInstance().BindPlayerListAvatar(item.id,this.at("头像",row).getComponent(cc.Sprite));
            if(this.kind === "members") {
                const isOwner = item.id === context.ownerId || item.id === context.accountId && context.role === "owner";
                const isSelf = item.id === context.accountId;
                this.text("身份",isOwner ? "创建者" : isSelf && context.role === "manager" ? "管理员" : item.role || "成员",row);
                this.text("余额","余额 " + (item.balance == null ? "—" : item.balance),row);
                for(const pair of [["成员删除","remove"],["成员设管理员","promote"],["成员赠予","gift"]]) {
                    const button = this.at(pair[0],row);
                    button.active = !isSelf && (pair[1] === "gift" || !isOwner && (pair[1] !== "promote" || context.role === "owner" && item.role !== "管理员"));
                    button.on("click",()=>{
                        if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
                        this.Refresh();
                        if(pair[1] === "gift") {
                            if(this.gift) this.gift(item); else this.message("赠予功能暂未开放");
                        } else this.confirm(pair[1] as ClubAction,item.id,item.name);
                    },this);
                }
            }
            else {
                for(const pair of [["管理同意","approve"],["管理拒绝","reject"]])
                    this.at(pair[0],row).on("click",()=>{
                        if(!this.sameContext(context,this.getContext())) { this.Refresh();return; }
                        this.Refresh();
                        this.confirm(pair[1] as ClubAction,item.id,item.name);
                    },this);
            }
        });
        this.at("列表",this.panel()).getComponent(cc.ScrollView).scrollToTop(0);
    }
    private confirm(action:ClubAction,userId:string,name:string):void {
        if(this.busy || !this.context.id) return;
        if(action !== "leave" && !this.manager()) return;
        if((action === "dissolve" || action === "promote") && this.context.role !== "owner") return;
        if((action === "remove" || action === "promote") && (userId === this.context.accountId || userId === this.context.ownerId)) return;
        if(action === "leave" && this.context.role === "owner") {
            this.message("创建者请使用解散俱乐部功能");return;
        }
        this.pending = {club:{...this.context},action,userId};
        const text = action === "leave" ? "申请退出「"+this.context.name+"」？\n退出结果以审核为准。" :
            action === "dissolve" ? "确认解散「"+this.context.name+"」？\n解散后将无法恢复。" :
            action === "remove" ? "确认将「"+(name || userId)+"」移出俱乐部？\n玩家 ID: "+userId :
            action === "promote" ? "确认将「"+(name || userId)+"」设为管理员？\n玩家 ID: "+userId :
            (action === "approve" ? "同意" : "拒绝")+"「"+(name || userId)+"」加入俱乐部？\n玩家 ID: "+userId;
        this.text("俱乐部操作确认/面板/内容",text);
        this.at("俱乐部操作确认").active = true;
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
            const result = await this.api.act(pending.club.id,pending.action,pending.userId);
            if(!this.valid(version,pending.club)) return;
            this.at("俱乐部操作确认").active = false;
            this.pending = null;
            this.busy = false;
            this.message(result && result.message || (pending.action === "leave" ? "退出申请已提交" : "操作成功"));
            if(["approve","reject","remove","promote"].indexOf(pending.action) >= 0) await this.load(this.page);
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
